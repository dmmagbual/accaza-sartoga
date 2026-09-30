// ---------------------------------------------------------------------------
// Accaza Loyalty — member management (Phase 2, 30 Sep 2026).
//
// Three member problems the Phase 1 foundation left open:
//   1. Staff had no way to look a member up for support, and browsing
//      /loyaltyMembers is forbidden (it grows with every signup forever —
//      Sep 2026 download audit). searchLoyaltyMembers resolves ONE member by
//      exact phone (through the private hash index) or by member id:
//      single-record reads, never a member-list download.
//   2. A member who lost their phone or cleared their browser lost their
//      badge, because the badgeSecret exists only in that device's
//      localStorage. startLoyaltyBadgeRecovery / confirmLoyaltyBadgeRecovery
//      let the member recover on ANY device with an OTP to their own
//      registered number — the same possession proof the device-link flow
//      uses. Confirming ROTATES the secret, so the badge on the lost phone
//      stops deriving valid codes the moment the new one is issued.
//   3. A member can ask for their personal data to be deleted (PH Data
//      Privacy Act). manageLoyaltyMemberAnonymize strips the PII (name,
//      phone, badge secret, phone index entry) and blocks the stub — one
//      way, never reversible. The loyalty ledger, balances and reward claims
//      are KEPT: stamps carry no GL value at issuance and every redemption
//      posts through the order's own loyaltyDiscount line (GL 4920), so
//      forgetting the person must not break the loyalty subledger that the
//      order-tied financial history still reconciles against.
// ---------------------------------------------------------------------------

exports.searchLoyaltyMembers = onCall(
  {region: LOYALTY_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 20, memory: "256MiB"},
  async (request) => {
    const db = getDatabase(); await requirePortalPermission(db, request, ["loyaltyAdmin"]);
    const data = request.data || {};
    // Exact phone or member id only, by design. A name search would mean
    // downloading the whole member list to filter it — the one read this
    // system must never make.
    const phone = data.phone ? Loyalty.normalizePhonePH(data.phone) : "";
    let memberId = data.memberId ? loyaltyKey(data.memberId, "Member ID") : "";
    if (phone) {
      const phoneKeyId = crypto.createHash("sha256").update(Loyalty.phoneKey(phone)).digest("hex").slice(0, 32);
      const index = (await db.ref(`/loyaltyMembersByPhone/${phoneKeyId}`).get()).val();
      if (!index || !index.memberId) throw new HttpsError("not-found", "No Rewards member was found for that number.");
      memberId = index.memberId;
    }
    if (!memberId) throw new HttpsError("invalid-argument", "Enter the member's mobile number or member ID.");
    const member = (await db.ref(`/loyaltyMembers/${memberId}`).get()).val();
    if (!member) throw new HttpsError("not-found", "No Rewards member was found. Check the member ID.");
    const [balSnap, currenciesSnap] = await Promise.all([db.ref(`/loyaltyBalances/${memberId}`).get(), /* download-ok: bounded admin-configured stamp currencies, not history */ db.ref("/loyaltyCurrencies").get()]);
    const balances = balSnap.val() || {};
    const stamps = Loyalty.normalizeCurrencies(currenciesSnap.val()).map((currency) => Object.assign({}, currency, {balance: Loyalty.positiveInt(balances[Loyalty.balanceField(currency.code)], 0)}));
    // This one member's open rewards — a single record under the rewards node, never the node.
    const rewards = (await db.ref(`/loyaltyRewards/${memberId}`).orderByChild("status").equalTo("available").get()).val() || {};
    const now = Date.now(), openRewards = Object.keys(rewards).filter((id) => Number(rewards[id].expiresAt || 0) > now).length;
    return {
      member: {
        memberId,
        name: financeText(member.name, 80) || "",
        maskedPhone: member.phone ? Loyalty.maskPhone(member.phone) : "",
        status: member.anonymizedAt ? "anonymized" : member.status === "blocked" ? "blocked" : "active",
        stamps,
        openRewards,
        memberSince: Number(member.createdAt) || null,
        anonymizedAt: Number(member.anonymizedAt) || null,
      },
    };
  },
);

// Recovery step 1: send the code. Throttled on the SAME per-phone node the link flow
// uses, so alternating link and recovery requests cannot text a member faster than
// one SMS per minute. The member must still be active and still have a registered
// number — an anonymized member has neither, so their membership can never be revived.
exports.startLoyaltyBadgeRecovery = onCall(
  {region: LOYALTY_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 30, memory: "256MiB", secrets: [SEMAPHORE_API_KEY]},
  async (request) => {
    if (!request.auth || !request.auth.uid) throw new HttpsError("unauthenticated", "Customer session is not ready. Refresh and try again.");
    const db = getDatabase(); const uid = request.auth.uid;
    const phone = Loyalty.normalizePhonePH((request.data || {}).phone);
    if (!phone) throw new HttpsError("invalid-argument", "Enter a valid Philippine mobile number.");
    const phoneKeyId = crypto.createHash("sha256").update(Loyalty.phoneKey(phone)).digest("hex").slice(0, 32);
    const index = (await db.ref(`/loyaltyMembersByPhone/${phoneKeyId}`).get()).val();
    if (!index || !index.memberId) throw new HttpsError("not-found", "No Rewards membership was found for that number.");
    const member = (await db.ref(`/loyaltyMembers/${index.memberId}`).get()).val();
    if (!member || member.status !== "active" || !member.phone) throw new HttpsError("failed-precondition", "This membership cannot be recovered. Please ask our staff for help.");
    const now = Date.now();
    const lastAt = Number(((await db.ref(`/loyaltyLinkThrottle/${phoneKeyId}`).get()).val() || {}).lastAt || 0);
    if (lastAt + 60000 > now) throw new HttpsError("resource-exhausted", "Please wait a minute before requesting another code.");
    await db.ref(`/loyaltyLinkThrottle/${phoneKeyId}`).set({lastAt: now});
    const otpSalt = crypto.randomBytes(8).toString("hex"), otp = loyaltyOtpCode();
    const recoveryToken = crypto.randomBytes(16).toString("hex");
    await db.ref(`/loyaltyOtp/${recoveryToken}`).set({purpose: "recovery", memberId: index.memberId, uid, otpHash: loyaltyOtpHash(otp, otpSalt), otpSalt, attempts: 0, createdAt: now, expiresAt: now + LOYALTY_OTP_TTL_MS});
    await sendLoyaltySms(member.phone, `Your Accaza Rewards recovery code is ${otp}. It expires in 5 minutes.`);
    logger.info("Loyalty badge recovery OTP sent");
    return {recoveryToken, expiresInSeconds: LOYALTY_OTP_TTL_MS / 1000};
  },
);

// Recovery step 2: verify the code and hand the member a fresh badge secret. Rotation is
// what makes recovery safe — the secret left on a lost or sold phone stops deriving valid
// codes the instant this one is issued, so a recovered badge is never a shared badge.
exports.confirmLoyaltyBadgeRecovery = onCall(
  {region: LOYALTY_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 20, memory: "256MiB"},
  async (request) => {
    if (!request.auth || !request.auth.uid) throw new HttpsError("unauthenticated", "Customer session is not ready. Refresh and try again.");
    const db = getDatabase(); const uid = request.auth.uid;
    const data = request.data || {};
    const recoveryToken = loyaltyKey(data.recoveryToken, "Recovery token");
    const otpRef = db.ref(`/loyaltyOtp/${recoveryToken}`);
    const record = (await otpRef.get()).val();
    if (!record || record.purpose !== "recovery") throw new HttpsError("not-found", "Recovery session was not found. Start over.");
    if (record.uid !== uid) throw new HttpsError("permission-denied", "This recovery code was requested from a different session.");
    if (Date.now() > Number(record.expiresAt)) { await otpRef.remove(); throw new HttpsError("deadline-exceeded", "That code expired. Start over."); }
    if (Number(record.attempts || 0) >= LOYALTY_OTP_MAX_ATTEMPTS) { await otpRef.remove(); throw new HttpsError("resource-exhausted", "Too many incorrect attempts. Start over."); }
    const code = String(data.otp || "").trim();
    if (loyaltyOtpHash(code, record.otpSalt) !== record.otpHash) {
      await otpRef.child("attempts").set(Number(record.attempts || 0) + 1);
      throw new HttpsError("invalid-argument", "Incorrect code.");
    }
    const memberId = loyaltyKey(record.memberId, "Member ID");
    const member = (await db.ref(`/loyaltyMembers/${memberId}`).get()).val();
    if (!member || member.status !== "active" || !member.phone) { await otpRef.remove(); throw new HttpsError("failed-precondition", "This membership cannot be recovered. Please ask our staff for help."); }
    const badgeSecret = crypto.randomBytes(24).toString("hex");
    await db.ref(`/loyaltyMembers/${memberId}/badgeSecret`).set(badgeSecret);
    // Keyed to the token so a replayed confirm overwrites one entry instead of piling up:
    // every rotation of this member's badge stays visible in their own ledger.
    await db.ref(`/loyaltyLedger/${memberId}/rotate_${recoveryToken}`).set({type: "badge_rotate", occurredAt: Date.now(), schemaVersion: 1});
    await otpRef.remove();
    logger.info("Loyalty badge secret rotated", {memberId});
    // Same shape completeLoyaltySignup returns, so the Rewards page stores it identically.
    return {memberId, badgeSecret, name: member.name, maskedPhone: Loyalty.maskPhone(member.phone), memberSince: Number(member.createdAt) || null};
  },
);

// One-way anonymization: the member asked for their personal data to be deleted, or the
// record was created in error. Personal data goes (name, phone, badge secret, phone
// index entry); accounting stays (ledger, balances, reward claims). Blocking the stub is
// what makes it inert everywhere — every badge, claim and earning path already refuses
// blocked members — and with the secret gone no code can ever be derived for this id again.
exports.manageLoyaltyMemberAnonymize = onCall(
  {region: LOYALTY_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 20, memory: "256MiB"},
  async (request) => {
    const db = getDatabase(); const actor = await requirePortalPermission(db, request, ["loyaltyAdmin"]);
    const data = request.data || {};
    const memberId = loyaltyKey(data.memberId, "Member ID");
    if (data.confirm !== true) throw new HttpsError("invalid-argument", "Anonymizing a member is permanent. Confirm it explicitly.");
    const member = (await db.ref(`/loyaltyMembers/${memberId}`).get()).val();
    if (!member) throw new HttpsError("not-found", "Member not found.");
    if (member.anonymizedAt) throw new HttpsError("failed-precondition", "This member is already anonymized.");
    // The audit keeps what was forfeited, because after this the person behind the record
    // is gone for good and this is the only place the forfeiture is recorded.
    const balances = (await db.ref(`/loyaltyBalances/${memberId}`).get()).val() || {};
    const forfeited = {};
    Loyalty.normalizeCurrencies((await /* download-ok: bounded admin-configured stamp currencies, not history */ db.ref("/loyaltyCurrencies").get()).val()).forEach((currency) => {
      const qty = Loyalty.positiveInt(balances[Loyalty.balanceField(currency.code)], 0);
      if (qty > 0) forfeited[currency.code] = qty;
    });
    const now = Date.now(), wasActive = member.status !== "blocked";
    const phoneKeyId = member.phone ? crypto.createHash("sha256").update(Loyalty.phoneKey(member.phone)).digest("hex").slice(0, 32) : "";
    const writes = {
      [`loyaltyMembers/${memberId}/name`]: null,
      [`loyaltyMembers/${memberId}/phone`]: null,
      [`loyaltyMembers/${memberId}/badgeSecret`]: null,
      [`loyaltyMembers/${memberId}/status`]: "blocked",
      [`loyaltyMembers/${memberId}/anonymizedAt`]: now,
      [`loyaltyMembers/${memberId}/anonymizedBy`]: actor.uid,
    };
    if (phoneKeyId) writes[`loyaltyMembersByPhone/${phoneKeyId}`] = null;
    await db.ref().update(writes);
    if (wasActive) await loyaltyStatIncrement(db, "/loyaltyStats/activeMembers", -1);
    await db.ref(`/operationalAudit/${now}_loyalty_member_${memberId}`).set(operationalAuditRecord("anonymize_loyalty_member", "loyaltyMember", memberId, actor, {forfeited, note: "Personal data removed; ledger, balances and reward claims retained for accounting."}));
    return {memberId, anonymized: true, forfeited};
  },
);
