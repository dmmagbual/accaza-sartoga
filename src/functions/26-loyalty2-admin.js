// ---------------------------------------------------------------------------
// Accaza Loyalty — claim release, redemption OTP and administered program data.
//
// This section must sort immediately after 26-loyalty.js. The Functions build
// concatenates ordered source sections into one shared module; these callables
// intentionally use the loyalty helpers and configuration limits declared by
// the foundation section. Keeping this operational/admin boundary separate
// prevents the foundation module growing past the reviewed source-file limit.
// ---------------------------------------------------------------------------

/**
 * Gives a claimed reward back when the sale it was claimed for never happens — the
 * customer changes their mind, the card is declined, the cashier clears the ticket.
 *
 * Without this the stamps were simply gone: claimLoyaltyReward debits the balance
 * immediately, and a reward left at "claimed" is not returned by loyaltyMemberSnapshot
 * (which only lists "available"), so the member had paid 10 stamps and had nothing to
 * show for it, with no way back. A redemption that can be taken must be able to be
 * given back, the same way any posted amount must be reversible.
 *
 * Idempotent by construction: only a "claimed" reward moves to "released", so a retry,
 * a double-tap, or two tills racing each other credits the stamps exactly once.
 */
exports.releaseLoyaltyClaim = onCall(
  {region: LOYALTY_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 20, memory: "256MiB"},
  async (request) => {
    const db = getDatabase(); const actor = await requirePortalPermission(db, request, ["pos"]);
    const data = request.data || {};
    const memberId = loyaltyKey(data.memberId, "Member ID"), rewardInstanceId = loyaltyKey(data.rewardInstanceId, "Reward instance ID");
    const reason = financeText(data.reason, 120) || "Sale not completed";
    const rewardRef = db.ref(`/loyaltyRewards/${memberId}/${rewardInstanceId}`);
    // Same Admin SDK cold-cache hazard as claim/finalize: the first callback on a fresh
    // instance sees null even though the record exists, and treating that as "nothing to
    // release" would hard-abort without retry.
    const initialReward = (await rewardRef.get()).val();
    const releaseState = {seen: false};
    const result = await rewardRef.transaction((current) => {
      current = transactionCurrent(current, initialReward, releaseState);
      if (!current || current.status !== "claimed") return; // already redeemed, released or expired — never give stamps back twice
      if (current.grantedReward === true) {
        const restored = Object.assign({}, current, {status: "available", lastReleasedAt: Date.now(), lastReleasedBy: actor.uid, lastReleaseReason: reason});
        delete restored.claimedAt; delete restored.claimedBy; delete restored.verifiedBy; delete restored.discountAmount;
        return restored;
      }
      return Object.assign({}, current, {status: "released", releasedAt: Date.now(), releasedBy: actor.uid, releaseReason: reason});
    }, undefined, false);
    if (!result.committed) throw new HttpsError("failed-precondition", "This reward is no longer an open claim — it was already completed or released.");

    const released = result.snapshot.val() || {};
    if (released.grantedReward === true) {
      await db.ref(`/loyaltyLedger/${memberId}/release_${rewardInstanceId}`).set({type: "earned_reward_claim_release", rewardId: released.rewardId || "", rewardInstanceId, sourceType: released.sourceType || "", sourceSeasonId: released.sourceSeasonId || "", sourceMissionId: released.sourceMissionId || "", occurredAt: Date.now(), cashierUid: actor.uid, reason, schemaVersion: 1});
      logger.info("Earned loyalty claim returned", {memberId, rewardInstanceId});
      return {ok: true, returnedToAvailable: true, currency: null, qty: 0};
    }
    // What was actually charged, taken from the claim record rather than the live catalog.
    const currency = released.costCurrency === "yellow" ? "yellow" : released.costCurrency === "red" ? "red" : null;
    const qty = Loyalty.positiveInt(released.costQty, 0);
    if (currency && qty > 0) {
      const field = currency === "red" ? "redBalance" : "yellowBalance";
      const balances = (await db.ref(`/loyaltyBalances/${memberId}`).get()).val() || {redBalance: 0, yellowBalance: 0};
      const creditState = {seen: false};
      await db.ref(`/loyaltyBalances/${memberId}`).transaction((current) => {
        current = transactionCurrent(current, balances, creditState) || {redBalance: 0, yellowBalance: 0};
        return Object.assign({}, current, {[field]: Loyalty.positiveInt(current[field], 0) + qty, updatedAt: Date.now()});
      }, undefined, false);
      await db.ref(`/loyaltyLedger/${memberId}/release_${rewardInstanceId}`).set({type: "redeem_release", rewardId: released.rewardId || "", rewardInstanceId, occurredAt: Date.now(), cashierUid: actor.uid, currency, qty, reason, schemaVersion: 1});
    }
    logger.info("Loyalty claim released", {memberId, rewardInstanceId, currency, qty});
    return {ok: true, currency, qty};
  },
);

async function verifyLoyaltyOtpProof(db, memberId, otpToken, otp) {
  if (!otpToken) return false;
  const ref = db.ref(`/loyaltyOtp/${loyaltyKey(otpToken, "OTP token")}`);
  const record = (await ref.get()).val();
  if (!record || record.purpose !== "redeem" || record.memberId !== memberId) return false;
  if (Date.now() > Number(record.expiresAt)) { await ref.remove(); return false; }
  if (Number(record.attempts || 0) >= LOYALTY_OTP_MAX_ATTEMPTS) { await ref.remove(); return false; }
  if (loyaltyOtpHash(String(otp || "").trim(), record.otpSalt) !== record.otpHash) { await ref.child("attempts").set(Number(record.attempts || 0) + 1); return false; }
  await ref.remove(); // single-use
  return true;
}

exports.startLoyaltyRedeemOtp = onCall(
  {region: LOYALTY_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 20, memory: "256MiB", secrets: [SEMAPHORE_API_KEY]},
  async (request) => {
    // Used only when the badge camera fails and a redemption still needs
    // presence-verification — never a substitute for the phone-lookup
    // earn-only fallback.
    const db = getDatabase(); await requirePortalPermission(db, request, ["pos"]);
    const memberId = loyaltyKey((request.data || {}).memberId, "Member ID");
    const member = (await db.ref(`/loyaltyMembers/${memberId}`).get()).val();
    if (!member || member.status === "blocked") throw new HttpsError("not-found", "Member not found.");
    const otpToken = crypto.randomBytes(16).toString("hex"), otpSalt = crypto.randomBytes(8).toString("hex"), otp = loyaltyOtpCode(), now = Date.now();
    await db.ref(`/loyaltyOtp/${otpToken}`).set({purpose: "redeem", memberId, otpHash: loyaltyOtpHash(otp, otpSalt), otpSalt, attempts: 0, createdAt: now, expiresAt: now + LOYALTY_OTP_TTL_MS});
    await sendLoyaltySms(member.phone, `Your Accaza Rewards redemption code is ${otp}. It expires in 5 minutes.`);
    return {otpToken, expiresInSeconds: LOYALTY_OTP_TTL_MS / 1000};
  },
);

// ---------------------------------------------------------------------------
// Admin: earning rules + reward catalog CRUD (bounded fields — spec §3/§4).
// ---------------------------------------------------------------------------
exports.manageLoyaltyEarningRule = onCall(
  {region: LOYALTY_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 20, memory: "256MiB"},
  async (request) => {
    const db = getDatabase(); const actor = await requirePortalPermission(db, request, ["loyaltyAdmin"]);
    const data = request.data || {}; const action = String(data.action || "");
    if (action === "list") return {rules: (await /* download-ok: bounded admin-configured rules, not history */ db.ref("/loyaltyEarningRules").get()).val() || {}};
    const trigger = String(data.trigger || "");
    if (!Loyalty.TRIGGER_TYPES.includes(trigger)) throw new HttpsError("invalid-argument", "Trigger type is invalid.");
    const ruleCodes = Loyalty.currencyCodes(Loyalty.normalizeCurrencies((await /* download-ok: bounded admin-configured stamp currencies, not history */ db.ref("/loyaltyCurrencies").get()).val()));
    if (!Loyalty.isCurrency(data.currency, ruleCodes)) throw new HttpsError("invalid-argument", `Stamp must be one of the configured stamps: ${ruleCodes.join(", ")}.`);
    const qty = Loyalty.positiveInt(data.qty, 0);
    if (!(qty > 0)) throw new HttpsError("invalid-argument", "Quantity must be a positive whole number.");
    const ruleId = data.ruleId ? loyaltyKey(data.ruleId) : `rule_${crypto.randomBytes(8).toString("hex")}`;
    const now = Date.now();
    const row = {trigger, currency: data.currency, qty, condition: data.condition && typeof data.condition === "object" ? data.condition : {}, startAt: data.startAt == null ? null : Number(data.startAt), endAt: data.endAt == null ? null : Number(data.endAt), enabled: data.enabled !== false, name: financeText(data.name, 120), updatedAt: now, updatedBy: actor.uid};
    if (data.ruleId) await db.ref(`/loyaltyEarningRules/${ruleId}`).update(row);
    else await createLoyaltyConfigRow(db, "/loyaltyEarningRules", ruleId, row, LOYALTY_CONFIG_LIMITS.rules, "Earning rules");
    await db.ref(`/operationalAudit/${now}_loyalty_rule_${ruleId}`).set(operationalAuditRecord("manage_loyalty_earning_rule", "loyaltyEarningRule", ruleId, actor, row));
    return {ruleId};
  },
);

exports.manageLoyaltyRewardCatalog = onCall(
  {region: LOYALTY_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 20, memory: "256MiB"},
  async (request) => {
    const db = getDatabase(); const actor = await requirePortalPermission(db, request, ["loyaltyAdmin"]);
    const data = request.data || {}; const action = String(data.action || "");
    if (action === "list") return {catalog: (await /* download-ok: bounded admin-configured catalog, not history */ db.ref("/loyaltyRewardCatalog").get()).val() || {}};
    if (action === "disable" || action === "enable") {
      const rewardId = loyaltyKey(data.rewardId, "Reward ID"), now = Date.now();
      await db.ref(`/loyaltyRewardCatalog/${rewardId}/enabled`).set(action === "enable");
      await db.ref(`/operationalAudit/${now}_loyalty_catalog_${rewardId}`).set(operationalAuditRecord(`${action}_loyalty_reward`, "loyaltyRewardCatalog", rewardId, actor, {}));
      return {rewardId, enabled: action === "enable"};
    }
    const catalogCodes = Loyalty.currencyCodes(Loyalty.normalizeCurrencies((await /* download-ok: bounded admin-configured stamp currencies, not history */ db.ref("/loyaltyCurrencies").get()).val()));
    const validated = Loyalty.validateRewardDefinition(data, catalogCodes);
    if (!validated.ok) throw new HttpsError("invalid-argument", validated.errors.join(" "));
    const rewardId = data.rewardId ? loyaltyKey(data.rewardId) : `reward_${crypto.randomBytes(8).toString("hex")}`;
    const now = Date.now();
    const row = Object.assign({}, validated.reward, {updatedAt: now, updatedBy: actor.uid});
    if (data.rewardId) await db.ref(`/loyaltyRewardCatalog/${rewardId}`).update(row);
    else await createLoyaltyConfigRow(db, "/loyaltyRewardCatalog", rewardId, row, LOYALTY_CONFIG_LIMITS.catalog, "Reward catalog");
    await db.ref(`/operationalAudit/${now}_loyalty_catalog_${rewardId}`).set(operationalAuditRecord("manage_loyalty_reward_catalog", "loyaltyRewardCatalog", rewardId, actor, validated.reward));
    return {rewardId};
  },
);

// Admin: the stamp currencies themselves. A stamp can be added, relabelled, recoloured,
// recapped, enabled or disabled -- but NEVER deleted and NEVER renamed, because its code
// names the field holding real member balances (loyaltyBalances/{member}.{code}Balance).
// Deleting or renaming one would strand every stamp a member is holding in it.
//
// Disabling is refused while an enabled rule still awards it or an enabled reward still
// costs it: earning silently ignores awards in an unknown currency, so disabling out from
// under a live rule would drop stamps customers had earned with nobody noticing.
exports.manageLoyaltyCurrency = onCall(
  {region: LOYALTY_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 20, memory: "256MiB"},
  async (request) => {
    const db = getDatabase(); const actor = await requirePortalPermission(db, request, ["loyaltyAdmin"]);
    const data = request.data || {}; const action = String(data.action || "");
    if (action === "list") {
      return {
        currencies: (await /* download-ok: bounded admin-configured stamp currencies, not history */ db.ref("/loyaltyCurrencies").get()).val() || {},
        colors: Loyalty.STAMP_COLORS, // the fixed palette a stamp's colour must come from
      };
    }
    if (action === "disable" || action === "enable") {
      const code = Loyalty.currencyCode(data.code);
      if (!code) throw new HttpsError("invalid-argument", "Stamp code is invalid.");
      if (!(await db.ref(`/loyaltyCurrencies/${code}`).get()).exists()) throw new HttpsError("not-found", "That stamp does not exist.");
      if (action === "disable") {
        const [rulesSnap, catalogSnap] = await Promise.all([/* download-ok: bounded admin-configured rules, not history */ db.ref("/loyaltyEarningRules").get(), /* download-ok: bounded admin-configured catalog, not history */ db.ref("/loyaltyRewardCatalog").get()]);
        const rules = rulesSnap.val() || {}, catalog = catalogSnap.val() || {};
        const usedByRule = Object.keys(rules).some((id) => rules[id] && rules[id].enabled !== false && rules[id].currency === code);
        const usedByReward = Object.keys(catalog).some((id) => catalog[id] && catalog[id].enabled !== false && catalog[id].costCurrency === code);
        if (usedByRule) throw new HttpsError("failed-precondition", "Turn off the earning rules that award this stamp first - otherwise customers would keep qualifying for it and the stamps would be dropped without anyone noticing.");
        if (usedByReward) throw new HttpsError("failed-precondition", "Turn off the rewards that cost this stamp first - otherwise members holding it would have nothing to spend it on.");
      }
      const now = Date.now();
      await db.ref(`/loyaltyCurrencies/${code}/enabled`).set(action === "enable");
      await db.ref(`/operationalAudit/${now}_loyalty_currency_${code}`).set(operationalAuditRecord(`${action}_loyalty_currency`, "loyaltyCurrencies", code, actor, {}));
      return {code, enabled: action === "enable"};
    }
    const validated = Loyalty.validateCurrencyDefinition(data);
    if (!validated.ok) throw new HttpsError("invalid-argument", validated.errors.join(" "));
    const currency = validated.currency, now = Date.now();
    const existing = (await db.ref(`/loyaltyCurrencies/${currency.code}`).get()).val();
    // update() so an existing stamp keeps createdAt and its system flag: saving is an edit
    // of label/colour/cap/order only, never a re-creation.
    const row = Object.assign({}, currency, existing ? {} : {createdAt: now}, {updatedAt: now, updatedBy: actor.uid});
    if (existing) await db.ref(`/loyaltyCurrencies/${currency.code}`).update(row);
    else await createLoyaltyConfigRow(db, "/loyaltyCurrencies", currency.code, row, LOYALTY_CONFIG_LIMITS.currencies, "Stamp currencies");
    await db.ref(`/operationalAudit/${now}_loyalty_currency_${currency.code}`).set(operationalAuditRecord("manage_loyalty_currency", "loyaltyCurrencies", currency.code, actor, currency));
    return {code: currency.code, created: !existing};
  },
);

exports.manageLoyaltyMemberStatus = onCall(
  {region: LOYALTY_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 20, memory: "256MiB"},
  async (request) => {
    const db = getDatabase(); const actor = await requirePortalPermission(db, request, ["loyaltyAdmin"]);
    const data = request.data || {}; const memberId = loyaltyKey(data.memberId, "Member ID"), status = String(data.status || "");
    if (!["active", "blocked"].includes(status)) throw new HttpsError("invalid-argument", "Status must be active or blocked.");
    const member = (await db.ref(`/loyaltyMembers/${memberId}`).get()).val();
    if (!member) throw new HttpsError("not-found", "Member not found.");
    // An anonymized member is a closed book: unblocking the stub would return an empty
    // shell to "active" and re-count it in activeMembers, implying a person who was
    // deliberately forgotten. There is nothing left to manage on this record.
    if (member.anonymizedAt) throw new HttpsError("failed-precondition", "This member was anonymized and can no longer be changed.");
    const now = Date.now(), wasActive = member.status !== "blocked";
    await db.ref(`/loyaltyMembers/${memberId}/status`).set(status);
    // Keep the maintained activeMembers count (read by getLoyaltyReports) in step with the
    // transition actually made, instead of re-scanning every member to recompute it.
    const willBeActive = status !== "blocked";
    if (wasActive && !willBeActive) await loyaltyStatIncrement(db, "/loyaltyStats/activeMembers", -1);
    else if (!wasActive && willBeActive) await loyaltyStatIncrement(db, "/loyaltyStats/activeMembers", 1);
    await db.ref(`/operationalAudit/${now}_loyalty_member_${memberId}`).set(operationalAuditRecord("set_loyalty_member_status", "loyaltyMember", memberId, actor, {status}));
    return {memberId, status};
  },
);

// ---------------------------------------------------------------------------
// Admin reports (spec §13: active members, redemption cost by reward,
// stamps-per-cashier, redemptions-per-cashier vs sales volume).
// ---------------------------------------------------------------------------
const LOYALTY_TENURE_MILESTONES = [{days: 180, key: "6_months"}, {days: 365, key: "1_year"}];
const LOYALTY_TENURE_LOOKBACK_MS = 30 * 86400000; // recognition window: crossed the milestone in the last 30 days

exports.getLoyaltyReports = onCall(
  {region: LOYALTY_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 60, memory: "512MiB"},
  async (request) => {
    const db = getDatabase(); await requirePortalPermission(db, request, ["loyaltyAdmin"]);
    // Every read here targets /loyaltyStats — small, incrementally-maintained aggregates (see
    // the header comment above loyaltyStatIncrement) — or a bounded, indexed date-range query,
    // never a whole-node download of loyaltyMembers/loyaltyRewards/loyaltyLedger, which grow
    // without bound across the business's lifetime (Sep 2026 whole-node download audit).
    const now = Date.now();
    const [activeMembersSnap, costSnap, stampsSnap, redemptionsSnap, staffSnap, ...tenureSnaps] = await Promise.all([
      db.ref("/loyaltyStats/activeMembers").get(),
      db.ref("/loyaltyStats/redemptionCostByReward").get(),
      db.ref("/loyaltyStats/stampsByCashier").get(),
      db.ref("/loyaltyStats/redemptionsByCashier").get(),
      /* download-ok: bounded staff roster - readable names for the cashier tallies */ db.ref("/posStaff").get(),
      ...LOYALTY_TENURE_MILESTONES.map(({days}) => db.ref("/loyaltyMembers").orderByChild("createdAt").startAt(now - days * 86400000 - LOYALTY_TENURE_LOOKBACK_MS).endAt(now - days * 86400000).get()),
    ]);
    // The cashier tallies are keyed by sanitized staff uid; the roster supplies the name
    // so the report reads like people, not identifiers.
    const cashierNames = {};
    Object.values(staffSnap.val() || {}).forEach((row) => { if (row && row.accountUid) cashierNames[loyaltyStatKey(row.accountUid)] = String(row.name || row.displayName || "").slice(0, 60); });
    const tenureMilestones = [];
    LOYALTY_TENURE_MILESTONES.forEach(({key}, i) => {
      const rows = tenureSnaps[i].val() || {};
      Object.keys(rows).forEach((memberId) => {
        const member = rows[memberId] || {};
        tenureMilestones.push({memberId, firstName: financeText(member.name, 80).split(/\s+/)[0] || "", tenureDays: Math.floor((now - (Number(member.createdAt) || now)) / 86400000), milestone: key});
      });
    });
    return {
      activeMembers: Loyalty.positiveInt(activeMembersSnap.val(), 0),
      redemptionCostByReward: costSnap.val() || {},
      stampsByCashier: stampsSnap.val() || {},
      redemptionsByCashier: redemptionsSnap.val() || {},
      cashierNames,
      tenureMilestones,
    };
  },
);
