// ---------------------------------------------------------------------------
// Accaza Loyalty Program (Red/Yellow Stamps) — Phase 1 backend foundation.
// Spec: claude/loyalty-program-spec-2026-09-29.md (Claude project doc).
// Pure logic in ./lib/loyalty.js; this file wires it to RTDB + onCall/triggers.
//
// Scope of this file (Phase 1, backend foundation PR):
//   - Member signup + SMS OTP verification (Semaphore)
//   - Rotating badge issuance/verification (HMAC, 60s window)
//   - Server-side earning rules engine, wired into order completion
//   - Daily RED-ONLY cap enforcement (yellow uncapped — confirmed 2026-09-29)
//   - Reward catalog CRUD (admin) with mandatory-cap validation
//   - Reward redemption: badge-scan or OTP only, never phone-lookup alone;
//     server-side transactional claim so two tills can't double-spend one
//     reward. Redemption does NOT create its own financial movement — it
//     returns a discount amount for the POS to write into the order's own
//     `loyaltyDiscount` field (kept separate from `discount`, which stays
//     for Senior/PWD etc.), so it posts to its own GL line (4920 "Loyalty
//     Discounts") instead of blending into the general discounts account.
//     Full order/member/reward attribution for admin reporting still
//     comes from loyaltyLedger/loyaltyRewards. See lib/loyalty.js header
//     for the full accounting rationale.
//   - Void handling: a redeemed reward on a voided order is flagged for
//     review, never silently restored to available.
//   - Admin earning-rules CRUD + reports.
//
// NOT in this file (later PRs): signup web page, badge display page, POS
// camera-scan UI, admin reward-builder UI, admin reports UI.
// ---------------------------------------------------------------------------

const Loyalty = require("./lib/loyalty");

const LOYALTY_REGION = ORDER_REGION;
const LOYALTY_BADGE_WINDOW_SECONDS = 60;
const LOYALTY_OTP_TTL_MS = 5 * 60 * 1000;
const LOYALTY_OTP_MAX_ATTEMPTS = 5;
const SEMAPHORE_API_KEY = defineSecret("SEMAPHORE_API_KEY");

function loyaltyKey(value, label = "ID") {
  const key = String(value || "").trim();
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(key)) throw new HttpsError("invalid-argument", `${label} is invalid.`);
  return key;
}
// Member ids are opaque random values minted at signup start (see startLoyaltySignup) --
// never derived from the phone, so a member can change their number without changing identity.
function loyaltyBadgeWindow(atMs) { return Math.floor((Number(atMs) || Date.now()) / (LOYALTY_BADGE_WINDOW_SECONDS * 1000)); }
function loyaltyBadgeCode(memberId, badgeSecret, timeWindow) {
  return crypto.createHmac("sha256", String(badgeSecret || "")).update(`${memberId}:${timeWindow}`).digest("hex").slice(0, 12);
}
function loyaltyVerifyBadgeCode(memberId, badgeSecret, code, atMs) {
  const supplied = String(code || "");
  const window = loyaltyBadgeWindow(atMs);
  for (const w of [window, window - 1]) { // tolerate one 60s window of clock/latency drift
    const expected = loyaltyBadgeCode(memberId, badgeSecret, w);
    if (supplied.length === expected.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))) return true;
  }
  return false;
}
function loyaltyOtpCode() { return String(crypto.randomInt(0, 1000000)).padStart(6, "0"); }
function loyaltyOtpHash(code, salt) { return crypto.createHash("sha256").update(`${salt}:${code}`).digest("hex"); }
function loyaltyStatKey(value) { return (String(value || "unknown").replace(/[.#$/[\]]/g, "_") || "unknown").slice(0, 160); }

// ---------------------------------------------------------------------------
// /loyaltyStats — small, incrementally-maintained aggregates for admin reports
// (spec §13). getLoyaltyReports reads only these, never the raw, ever-growing
// loyaltyMembers/loyaltyRewards/loyaltyLedger collections (Sep 2026 whole-node
// download audit: those grow with every signup/redemption/earn forever and
// must never be downloaded in full — see tests/download-read-guard-check.mjs).
// Every transaction below always returns a proposal (never `undefined`), so
// none of them carry the cold-cache abort hazard documented elsewhere in this
// file — a stale/cold local read just retries against the server's real value.
// ---------------------------------------------------------------------------
async function loyaltyStatIncrement(db, path, delta) {
  await db.ref(path).transaction((current) => (Number(current) || 0) + delta, undefined, false);
}
async function loyaltyRedemptionCostIncrement(db, rewardId, rewardName, amount) {
  await db.ref(`/loyaltyStats/redemptionCostByReward/${loyaltyKey(rewardId || "unknown")}`).transaction((current) => {
    current = current || {name: rewardName || rewardId, totalCost: 0};
    return {name: rewardName || current.name || rewardId, totalCost: Loyalty.money((Number(current.totalCost) || 0) + amount)};
  }, undefined, false);
}

async function sendLoyaltySms(phoneE164, message) {
  const apiKey = SEMAPHORE_API_KEY.value();
  if (!apiKey) throw new HttpsError("failed-precondition", "SMS is not configured. Set the SEMAPHORE_API_KEY Firebase secret first.");
  const number = phoneE164.replace("+", "");
  const body = new URLSearchParams({apikey: apiKey, number, message, sendername: "Accaza"});
  const response = await fetch("https://api.semaphore.co/api/v4/messages", {method: "POST", headers: {"content-type": "application/x-www-form-urlencoded"}, body});
  if (!response.ok) { const text = await response.text().catch(() => ""); throw new HttpsError("unavailable", `SMS provider error (${response.status}): ${text.slice(0, 200)}`); }
}

async function ensureLoyaltyDefaults(db) {
  // Both reads are admin-configured rules/catalog — sized like chartOfAccounts (a handful
  // of rows), never like order/ledger history — so a whole-node read never grows with sales.
  const [rulesSnap, catalogSnap] = await Promise.all([/* download-ok: bounded admin-configured rules, not history */ db.ref("/loyaltyEarningRules").get(), /* download-ok: bounded admin-configured catalog, not history */ db.ref("/loyaltyRewardCatalog").get()]);
  const writes = {};
  if (!rulesSnap.exists()) {
    const now = Date.now();
    Object.assign(writes, {
      "loyaltyEarningRules/rule_red_per_order": {trigger: "per_order", currency: "red", qty: 1, condition: {}, enabled: true, name: "Red stamp per order", createdAt: now, system: true},
      "loyaltyEarningRules/rule_yellow_500": {trigger: "amount_threshold", currency: "yellow", qty: 1, condition: {minNetAmount: 500}, enabled: true, name: "Yellow stamp · net > ₱500", createdAt: now, system: true},
      "loyaltyEarningRules/rule_yellow_1000": {trigger: "amount_threshold", currency: "yellow", qty: 2, condition: {minNetAmount: 1000}, enabled: true, name: "Yellow stamps (2) · net > ₱1000", createdAt: now, system: true},
      "loyaltyEarningRules/rule_signup_bonus": {trigger: "first_order_after_signup", currency: "red", qty: 3, condition: {}, enabled: true, name: "Signup bonus · first order", createdAt: now, system: true},
    });
  }
  if (!catalogSnap.exists()) {
    const now = Date.now();
    Object.assign(writes, {
      "loyaltyRewardCatalog/reward_free_drink": {costCurrency: "red", costQty: 10, grantType: "free_item_capped", cap: 120, percent: null, itemId: null, expiryDays: 30, stackingAllowed: false, name: "Free drink (up to ₱120)", enabled: true, createdAt: now, system: true},
      "loyaltyRewardCatalog/reward_20_off": {costCurrency: "yellow", costQty: 30, grantType: "percent_off_capped", cap: 200, percent: 20, itemId: null, expiryDays: 30, stackingAllowed: false, name: "20% off order (up to ₱200)", enabled: true, createdAt: now, system: true},
    });
  }
  if (Object.keys(writes).length) await db.ref().update(writes);
}

// ---------------------------------------------------------------------------
// Signup + OTP
// ---------------------------------------------------------------------------
exports.startLoyaltySignup = onCall(
  {region: LOYALTY_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 30, memory: "256MiB", secrets: [SEMAPHORE_API_KEY]},
  async (request) => {
    const db = getDatabase(); const data = request.data || {};
    const phone = Loyalty.normalizePhonePH(data.phone);
    if (!phone) throw new HttpsError("invalid-argument", "Enter a valid Philippine mobile number.");
    const name = financeText(data.name, 80);
    if (!name) throw new HttpsError("invalid-argument", "Name is required.");
    if (data.consent !== true) throw new HttpsError("invalid-argument", "Consent is required to sign up.");
    const phoneKeyId = crypto.createHash("sha256").update(Loyalty.phoneKey(phone)).digest("hex").slice(0, 32);
    const existingIndex = (await db.ref(`/loyaltyMembersByPhone/${phoneKeyId}`).get()).val();
    if (existingIndex && existingIndex.memberId) throw new HttpsError("already-exists", "This phone number is already registered. Use Recover Badge instead (or contact staff).");
    const otpSalt = crypto.randomBytes(8).toString("hex"), otp = loyaltyOtpCode(), now = Date.now();
    const signupToken = crypto.randomBytes(16).toString("hex");
    // Opaque member id, minted here (not derived from the phone) so a member can change their
    // number later without their identity/stamps changing. Carried on the OTP record so a retry
    // of completeLoyaltySignup reuses the same id -- self-healing, as the old phone-hash was.
    const memberId = `mem_${crypto.randomBytes(16).toString("hex")}`;
    await db.ref(`/loyaltyOtp/${signupToken}`).set({purpose: "signup", memberId, phone, name, otpHash: loyaltyOtpHash(otp, otpSalt), otpSalt, attempts: 0, createdAt: now, expiresAt: now + LOYALTY_OTP_TTL_MS});
    await sendLoyaltySms(phone, `Your Accaza Rewards signup code is ${otp}. It expires in 5 minutes.`);
    logger.info("Loyalty signup OTP sent", {maskedPhone: Loyalty.maskPhone(phone)});
    return {signupToken, expiresInSeconds: LOYALTY_OTP_TTL_MS / 1000};
  },
);

exports.completeLoyaltySignup = onCall(
  {region: LOYALTY_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 30, memory: "256MiB"},
  async (request) => {
    const db = getDatabase(); const data = request.data || {};
    const signupToken = loyaltyKey(data.signupToken, "Signup token");
    const otpRef = db.ref(`/loyaltyOtp/${signupToken}`);
    const record = (await otpRef.get()).val();
    if (!record || record.purpose !== "signup") throw new HttpsError("not-found", "Signup session was not found. Start over.");
    if (Date.now() > Number(record.expiresAt)) { await otpRef.remove(); throw new HttpsError("deadline-exceeded", "That code expired. Start over."); }
    if (Number(record.attempts || 0) >= LOYALTY_OTP_MAX_ATTEMPTS) { await otpRef.remove(); throw new HttpsError("resource-exhausted", "Too many incorrect attempts. Start over."); }
    const code = String(data.otp || "").trim();
    if (loyaltyOtpHash(code, record.otpSalt) !== record.otpHash) {
      await otpRef.child("attempts").set(Number(record.attempts || 0) + 1);
      throw new HttpsError("invalid-argument", "Incorrect code.");
    }
    const phone = record.phone, phoneKeyId = crypto.createHash("sha256").update(Loyalty.phoneKey(phone)).digest("hex").slice(0, 32);
    // Reuse the opaque id minted at signup start (idempotent on retry). The fallback covers an
    // in-flight OTP created by the previous deploy that predates the memberId field.
    const memberId = record.memberId ? loyaltyKey(record.memberId, "Member ID") : `mem_${crypto.randomBytes(16).toString("hex")}`;
    const now = Date.now(), badgeSecret = crypto.randomBytes(24).toString("hex");
    const memberRef = db.ref(`/loyaltyMembers/${memberId}`);
    const claim = await db.ref(`/loyaltyMembersByPhone/${phoneKeyId}`).transaction((current) => current && current.memberId ? current : {memberId, claimedAt: now});
    if (!claim.committed || claim.snapshot.val().memberId !== memberId) throw new HttpsError("already-exists", "This phone number is already registered.");
    await memberRef.set({phone, name: record.name, createdAt: now, status: "active", consentAt: now, badgeSecret, schemaVersion: 1});
    await ensureLoyaltyDefaults(db);
    await loyaltyStatIncrement(db, "/loyaltyStats/activeMembers", 1);
    await otpRef.remove();
    logger.info("Loyalty member created", {memberId});
    return {memberId, badgeSecret, name: record.name, maskedPhone: Loyalty.maskPhone(phone)};
  },
);

// ---------------------------------------------------------------------------
// Badge scan (earn context) + phone-lookup fallback (earn-only, never redeem)
// ---------------------------------------------------------------------------
async function loyaltyMemberSnapshot(db, memberId) {
  const [memberSnap, balSnap] = await Promise.all([db.ref(`/loyaltyMembers/${memberId}`).get(), db.ref(`/loyaltyBalances/${memberId}`).get()]);
  const member = memberSnap.val();
  if (!member || member.status === "blocked") return null;
  const balances = balSnap.val() || {redBalance: 0, yellowBalance: 0};
  const rewardsSnap = await db.ref(`/loyaltyRewards/${memberId}`).orderByChild("status").equalTo("available").get();
  const rewards = rewardsSnap.val() || {};
  const now = Date.now();
  const availableRewards = Object.keys(rewards).filter((id) => Number(rewards[id].expiresAt || 0) > now).map((id) => Object.assign({id}, rewards[id]));
  const redBalance = Loyalty.positiveInt(balances.redBalance, 0), yellowBalance = Loyalty.positiveInt(balances.yellowBalance, 0);
  // What this member could redeem right now. The till cannot read the catalog itself —
  // manageLoyaltyRewardCatalog is loyaltyAdmin-only — so without this a cashier has no way
  // to know what rewards exist or what they cost. One small bounded read of admin config,
  // filtered to what the member can actually afford, so the cashier is never offered
  // something the server will refuse. Only the two scan paths reach here; the earn-only
  // phone lookup builds its own reply and deliberately carries no redeemable list at all.
  const catalog = (await /* download-ok: bounded admin-configured catalog, not history */ db.ref("/loyaltyRewardCatalog").get()).val() || {};
  const redeemable = Object.keys(catalog).map((id) => Object.assign({rewardId: id}, catalog[id]))
    .filter((r) => r.enabled !== false)
    .filter((r) => (r.costCurrency === "red" ? redBalance : yellowBalance) >= Loyalty.positiveInt(r.costQty, 0))
    .map((r) => ({rewardId: r.rewardId, name: r.name || r.rewardId, costCurrency: r.costCurrency, costQty: Loyalty.positiveInt(r.costQty, 0), grantType: r.grantType, cap: r.cap == null ? null : Number(r.cap), percent: r.percent == null ? null : Number(r.percent), stackingAllowed: r.stackingAllowed === true}));
  return {memberId, firstName: financeText(member.name, 80).split(/\s+/)[0] || "", maskedPhone: Loyalty.maskPhone(member.phone), redBalance, yellowBalance, availableRewards, redeemable, memberSince: Number(member.createdAt) || null};
}

exports.scanLoyaltyBadge = onCall(
  {region: LOYALTY_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 20, memory: "256MiB"},
  async (request) => {
    const db = getDatabase(); await requirePortalPermission(db, request, ["pos"]);
    const data = request.data || {}; const memberId = loyaltyKey(data.memberId, "Member ID"), code = String(data.code || "");
    const member = (await db.ref(`/loyaltyMembers/${memberId}`).get()).val();
    if (!member) throw new HttpsError("not-found", "Badge not recognized.");
    if (!loyaltyVerifyBadgeCode(memberId, member.badgeSecret, code, Date.now())) throw new HttpsError("permission-denied", "Badge code is invalid or expired. Ask the member to refresh their badge.");
    const snapshot = await loyaltyMemberSnapshot(db, memberId);
    if (!snapshot) throw new HttpsError("failed-precondition", "This member account is blocked.");
    return Object.assign({verifiedBy: "badge_scan"}, snapshot);
  },
);

// The member reading their OWN card from the Rewards page. Same badge-code proof as
// scanLoyaltyBadge, minus the staff permission: holding the device that can derive the
// current 60-second code IS the proof of ownership, so this needs no separate customer
// login. Read-only, and every read is a single record or an indexed status query, so the
// cost does not grow with the member base. The Rewards page calls this once when it opens
// and never subscribes — loyalty balances only move when a sale completes or a reward is
// claimed, and the page can refresh explicitly at those moments.
exports.getLoyaltyMemberCard = onCall(
  {region: LOYALTY_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 20, memory: "256MiB"},
  async (request) => {
    const db = getDatabase();
    const data = request.data || {}; const memberId = loyaltyKey(data.memberId, "Member ID"), code = String(data.code || "");
    const member = (await db.ref(`/loyaltyMembers/${memberId}`).get()).val();
    if (!member) throw new HttpsError("not-found", "Badge not recognized.");
    if (!loyaltyVerifyBadgeCode(memberId, member.badgeSecret, code, Date.now())) throw new HttpsError("permission-denied", "Badge code is invalid or expired. Refresh the page and try again.");
    const snapshot = await loyaltyMemberSnapshot(db, memberId);
    if (!snapshot) throw new HttpsError("failed-precondition", "This member account is blocked. Please talk to our staff.");
    return Object.assign({verifiedBy: "badge_self"}, snapshot);
  },
);

exports.lookupLoyaltyMemberByPhone = onCall(
  {region: LOYALTY_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 20, memory: "256MiB"},
  async (request) => {
    // Earn-only fallback for when the camera fails. Never returns enough to
    // redeem — no rewards list, no ability to claim. See spec §1/§8.
    const db = getDatabase(); await requirePortalPermission(db, request, ["pos"]);
    const phone = Loyalty.normalizePhonePH((request.data || {}).phone);
    if (!phone) throw new HttpsError("invalid-argument", "Enter a valid Philippine mobile number.");
    const phoneKeyId = crypto.createHash("sha256").update(Loyalty.phoneKey(phone)).digest("hex").slice(0, 32);
    const index = (await db.ref(`/loyaltyMembersByPhone/${phoneKeyId}`).get()).val();
    if (!index || !index.memberId) throw new HttpsError("not-found", "No member found for this number.");
    const member = (await db.ref(`/loyaltyMembers/${index.memberId}`).get()).val();
    if (!member || member.status === "blocked") throw new HttpsError("not-found", "No member found for this number.");
    return {memberId: index.memberId, firstName: financeText(member.name, 80).split(/\s+/)[0] || "", maskedPhone: Loyalty.maskPhone(member.phone), verifiedBy: "phone_lookup", redeemAllowed: false};
  },
);

// ---------------------------------------------------------------------------
// Customer account <-> membership link (device -> durable membership)
//
// The customer portal signs in ANONYMOUSLY, so its uid is a per-browser id, not a durable
// person. The durable identity is the loyalty membership (phone + badge). So the link is
// stored on the many-side -- appCustomers/{uid}.loyaltyMemberId -- pointing at the one
// durable member: one member can be reached from many devices. Every link is verified
// (badge possession, or an OTP to the member's own phone), so a recycled phone number can
// never silently inherit someone else's stamps. No stamp value is booked at issuance
// (recognize-on-redemption), so this link is an operational convenience, never a GL balance.
// See claude/loyalty-accounting-identity-2026-09-30.md.
// ---------------------------------------------------------------------------
async function setLoyaltyDeviceLink(db, uid, memberId, via) {
  const member = (await db.ref(`/loyaltyMembers/${memberId}`).get()).val();
  if (!member || member.status === "blocked") throw new HttpsError("failed-precondition", "This membership is not available.");
  await db.ref(`/appCustomers/${uid}`).transaction((current) => {
    const profile = current || {};
    return Object.assign({}, profile, {loyaltyMemberId: memberId, loyaltyLinkedAt: Date.now(), loyaltyLinkedVia: via});
  });
  logger.info("Loyalty membership linked to a customer device", {via});
  return member;
}

// The portal showing "your stamps" for a linked device. Authenticated by the anonymous
// customer session alone -- the stored link IS the proof, no badge needed -- so a member who
// linked by OTP on a new phone still sees their card. One indexed read, no listeners.
exports.getMyLoyaltyCard = onCall(
  {region: LOYALTY_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 20, memory: "256MiB"},
  async (request) => {
    if (!request.auth || !request.auth.uid) throw new HttpsError("unauthenticated", "Customer session is not ready. Refresh and try again.");
    const db = getDatabase();
    const linkedId = (await db.ref(`/appCustomers/${request.auth.uid}/loyaltyMemberId`).get()).val();
    if (!linkedId) return {linked: false};
    const snapshot = await loyaltyMemberSnapshot(db, loyaltyKey(linkedId, "Member ID"));
    if (!snapshot) return {linked: false, unavailable: true};
    return Object.assign({linked: true, verifiedBy: "account_link"}, snapshot);
  },
);

// Same-device link, free (no SMS): the browser already holds the badge, so it can derive the
// current 60s code -- possession IS the proof. The server only re-verifies the code.
exports.linkLoyaltyByBadge = onCall(
  {region: LOYALTY_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 20, memory: "256MiB"},
  async (request) => {
    if (!request.auth || !request.auth.uid) throw new HttpsError("unauthenticated", "Customer session is not ready. Refresh and try again.");
    const db = getDatabase();
    const data = request.data || {}; const memberId = loyaltyKey(data.memberId, "Member ID"), code = String(data.code || "");
    const member = (await db.ref(`/loyaltyMembers/${memberId}`).get()).val();
    if (!member) throw new HttpsError("not-found", "Membership not recognized.");
    if (!loyaltyVerifyBadgeCode(memberId, member.badgeSecret, code, Date.now())) throw new HttpsError("permission-denied", "Badge code is invalid or expired. Refresh your Rewards badge and try again.");
    await setLoyaltyDeviceLink(db, request.auth.uid, memberId, "badge");
    const snapshot = await loyaltyMemberSnapshot(db, memberId);
    return Object.assign({linked: true, verifiedBy: "badge"}, snapshot || {});
  },
);

// Cross-device link (fallback, costs one SMS): send an OTP to the membership's phone. Only a
// phone already registered as a member can receive one, and a 60s per-phone cooldown keeps
// this from being used to spam-text a member.
exports.startLoyaltyLinkOtp = onCall(
  {region: LOYALTY_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 30, memory: "256MiB", secrets: [SEMAPHORE_API_KEY]},
  async (request) => {
    if (!request.auth || !request.auth.uid) throw new HttpsError("unauthenticated", "Customer session is not ready. Refresh and try again.");
    const db = getDatabase(); const uid = request.auth.uid;
    const phone = Loyalty.normalizePhonePH((request.data || {}).phone);
    if (!phone) throw new HttpsError("invalid-argument", "Enter a valid Philippine mobile number.");
    const phoneKeyId = crypto.createHash("sha256").update(Loyalty.phoneKey(phone)).digest("hex").slice(0, 32);
    const index = (await db.ref(`/loyaltyMembersByPhone/${phoneKeyId}`).get()).val();
    if (!index || !index.memberId) throw new HttpsError("not-found", "No Rewards membership was found for that number.");
    const now = Date.now();
    const lastAt = Number(((await db.ref(`/loyaltyLinkThrottle/${phoneKeyId}`).get()).val() || {}).lastAt || 0);
    if (lastAt + 60000 > now) throw new HttpsError("resource-exhausted", "Please wait a minute before requesting another code.");
    await db.ref(`/loyaltyLinkThrottle/${phoneKeyId}`).set({lastAt: now});
    const otpSalt = crypto.randomBytes(8).toString("hex"), otp = loyaltyOtpCode();
    const linkToken = crypto.randomBytes(16).toString("hex");
    await db.ref(`/loyaltyOtp/${linkToken}`).set({purpose: "link", memberId: index.memberId, uid, otpHash: loyaltyOtpHash(otp, otpSalt), otpSalt, attempts: 0, createdAt: now, expiresAt: now + LOYALTY_OTP_TTL_MS});
    await sendLoyaltySms(phone, `Your Accaza Rewards linking code is ${otp}. It expires in 5 minutes.`);
    logger.info("Loyalty link OTP sent");
    return {linkToken, expiresInSeconds: LOYALTY_OTP_TTL_MS / 1000};
  },
);

exports.confirmLoyaltyLinkOtp = onCall(
  {region: LOYALTY_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 20, memory: "256MiB"},
  async (request) => {
    if (!request.auth || !request.auth.uid) throw new HttpsError("unauthenticated", "Customer session is not ready. Refresh and try again.");
    const db = getDatabase(); const uid = request.auth.uid;
    const data = request.data || {};
    const linkToken = loyaltyKey(data.linkToken, "Link token");
    const otpRef = db.ref(`/loyaltyOtp/${linkToken}`);
    const record = (await otpRef.get()).val();
    if (!record || record.purpose !== "link") throw new HttpsError("not-found", "Linking session was not found. Start over.");
    if (record.uid !== uid) throw new HttpsError("permission-denied", "This linking code was requested from a different session.");
    if (Date.now() > Number(record.expiresAt)) { await otpRef.remove(); throw new HttpsError("deadline-exceeded", "That code expired. Start over."); }
    if (Number(record.attempts || 0) >= LOYALTY_OTP_MAX_ATTEMPTS) { await otpRef.remove(); throw new HttpsError("resource-exhausted", "Too many incorrect attempts. Start over."); }
    const code = String(data.otp || "").trim();
    if (loyaltyOtpHash(code, record.otpSalt) !== record.otpHash) {
      await otpRef.child("attempts").set(Number(record.attempts || 0) + 1);
      throw new HttpsError("invalid-argument", "Incorrect code.");
    }
    const memberId = loyaltyKey(record.memberId, "Member ID");
    await setLoyaltyDeviceLink(db, uid, memberId, "otp");
    await otpRef.remove();
    const snapshot = await loyaltyMemberSnapshot(db, memberId);
    return Object.assign({linked: true, verifiedBy: "otp"}, snapshot || {});
  },
);

// A device dropping its link (a shared tablet, or "not me"). Forgetting a link on your own
// device needs no verification; re-linking always re-verifies.
exports.unlinkLoyaltyFromDevice = onCall(
  {region: LOYALTY_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 20, memory: "256MiB"},
  async (request) => {
    if (!request.auth || !request.auth.uid) throw new HttpsError("unauthenticated", "Customer session is not ready.");
    const db = getDatabase();
    await db.ref(`/appCustomers/${request.auth.uid}`).transaction((current) => {
      if (!current) return current;
      const next = Object.assign({}, current); delete next.loyaltyMemberId; delete next.loyaltyLinkedAt; delete next.loyaltyLinkedVia; return next;
    });
    return {linked: false};
  },
);

// ---------------------------------------------------------------------------
// Earning — wired into order completion (POS/instore channel only, Phase 1).
// ---------------------------------------------------------------------------
async function postLoyaltyEarning(db, order) {
  const effectiveStatus = order.status === "Archived" ? order.prevStatus : order.status;
  if (!["Completed", "Received"].includes(String(effectiveStatus || ""))) return {skipped: true};
  if (order.paymentStatus === "pending" || order.voided === true) return {skipped: true};
  if (String(order.channel || "instore").toLowerCase() !== "instore") return {skipped: true}; // Phase 1: POS/walk-in only
  const memberId = order.loyaltyMemberId ? loyaltyKey(order.loyaltyMemberId, "Member ID") : "";
  if (!memberId) return {skipped: true}; // no badge/phone attached to this sale
  const ledgerKey = `earn_${order.id}`;
  const ledgerRef = db.ref(`/loyaltyLedger/${memberId}/${ledgerKey}`);
  if ((await ledgerRef.get()).exists()) return {duplicate: true}; // idempotent — a re-fired trigger never double-earns
  const occurredAt = Number(order.completedAt || order.receivedAt || order.timestamp || Date.now());
  const businessDate = financeDateFromTimestamp(occurredAt);
  const [rulesSnap, member] = await Promise.all([/* download-ok: bounded admin-configured rules, not history */ db.ref("/loyaltyEarningRules").get(), db.ref(`/loyaltyMembers/${memberId}`).get().then((s) => s.val())]);
  if (!member || member.status === "blocked") return {skipped: true};
  const netAmount = Loyalty.money(order.total);
  const isFirstOrder = !(await db.ref(`/loyaltyLedger/${memberId}`).orderByChild("type").equalTo("earn").limitToFirst(1).get()).exists();
  const awards = Loyalty.evaluateEarningRules(rulesSnap.val() || {}, {netAmount, isFirstOrderAfterSignup: isFirstOrder, occurredAt});
  if (!awards.length) return {skipped: true};
  const counterRef = db.ref(`/loyaltyDailyCounters/${memberId}/${businessDate}`);
  const capResult = await counterRef.transaction((current) => {
    current = current || {red: 0};
    const {applied, redEarnedToday} = Loyalty.applyDailyRedCap(awards, current.red, 2);
    return Object.assign({}, current, {red: redEarnedToday, _applied: applied});
  }, undefined, false);
  const applied = (capResult.committed && capResult.snapshot.val() && capResult.snapshot.val()._applied) || [];
  if (!applied.length) return {skipped: true, cappedOut: true};
  const totals = {red: 0, yellow: 0};
  applied.forEach((award) => { totals[award.currency] = (totals[award.currency] || 0) + award.qty; });
  const cashierUid = order.onDuty || order.staff || "", cashierKey = loyaltyStatKey(cashierUid);
  // The ledger entry (this function's own idempotency guard, checked at the top), the balance
  // delta and the per-cashier stats delta commit together as ONE atomic multi-path update —
  // RTDB guarantees a multi-path update() is all-or-nothing. Keeping the balance update as its
  // own separate .transaction() after the ledger write (the earlier shape) left a real gap on
  // this retry:true trigger: if the instance died between that transaction and the ledger
  // write, a retry would re-run the whole computation and credit the balance a second time for
  // the same order, since the ledger-existence check above only protects whichever write lands
  // last. Reading balances/stats fresh right before this single combined write keeps the only
  // remaining race (two genuinely concurrent completions for the same member) as small as this
  // API allows — an acceptable trade for Phase 1's single-till, one-order-at-a-time POS scope.
  const [balancesSnap, statsSnap] = await Promise.all([db.ref(`/loyaltyBalances/${memberId}`).get(), db.ref(`/loyaltyStats/stampsByCashier/${cashierKey}`).get()]);
  const balances = balancesSnap.val() || {redBalance: 0, yellowBalance: 0}, stats = statsSnap.val() || {red: 0, yellow: 0};
  const writes = {
    [`loyaltyLedger/${memberId}/${ledgerKey}`]: {type: "earn", orderId: order.id, occurredAt, businessDate, awards: applied, cashierUid, schemaVersion: 1},
    [`loyaltyBalances/${memberId}`]: {redBalance: Loyalty.positiveInt(balances.redBalance, 0) + totals.red, yellowBalance: Loyalty.positiveInt(balances.yellowBalance, 0) + totals.yellow, updatedAt: Date.now()},
    [`loyaltyStats/stampsByCashier/${cashierKey}`]: {red: Loyalty.positiveInt(stats.red, 0) + totals.red, yellow: Loyalty.positiveInt(stats.yellow, 0) + totals.yellow},
  };
  await db.ref().update(writes);
  return {applied, totals};
}

exports.onOrderLoyaltyEarning = onValueWritten(
  {ref: "/orders/{orderId}", region: LOYALTY_REGION, retry: true},
  async (event) => {
    const before = event.data.before.val() || {}, afterRaw = event.data.after.val();
    if (!afterRaw) return;
    const order = Object.assign({id: event.params.orderId}, afterRaw);
    const db = getDatabase();
    await postLoyaltyEarning(db, order);
    // Void handling: flag (never silently restore) a redeemed reward from a voided order.
    if (order.voided === true && before.voided !== true && order.loyaltyRewardId && order.loyaltyMemberId) {
      const rewardRef = db.ref(`/loyaltyRewards/${loyaltyKey(order.loyaltyMemberId)}/${loyaltyKey(order.loyaltyRewardId)}`);
      // Cold-cache hazard again, one degree worse: the un-guarded ternary this
      // replaced returned `current` itself in its false branch. On a cold
      // instance `current` starts out null even though the reward record
      // genuinely exists, so that branch returned `null` — and returning
      // `null` (unlike `undefined`) is not a safe no-op, it proposes DELETING
      // the reward node. Pre-fetch the real record so the false branch always
      // returns the real (non-null) current value unchanged, a true no-op.
      const initialReward = (await rewardRef.get()).val();
      const voidFlagState = {seen: false};
      await rewardRef.transaction((current) => {
        current = transactionCurrent(current, initialReward, voidFlagState);
        return current && current.status === "redeemed" ? Object.assign({}, current, {status: "redeemed_void_flagged", voidFlaggedAt: Date.now(), voidedOrderId: order.id}) : current;
      }, undefined, false);
    }
  },
);

// ---------------------------------------------------------------------------
// Reward redemption — badge scan or OTP only, transactional claim.
// ---------------------------------------------------------------------------
exports.claimLoyaltyReward = onCall(
  {region: LOYALTY_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 20, memory: "256MiB"},
  async (request) => {
    const db = getDatabase(); const actor = await requirePortalPermission(db, request, ["pos"]);
    const data = request.data || {};
    const memberId = loyaltyKey(data.memberId, "Member ID"), rewardId = loyaltyKey(data.rewardId, "Reward ID");
    const verifiedBy = String(data.verifiedBy || "");
    if (!["badge_scan", "otp"].includes(verifiedBy)) throw new HttpsError("invalid-argument", "Redemption requires a badge scan or OTP — phone lookup alone cannot redeem a reward.");
    const member = (await db.ref(`/loyaltyMembers/${memberId}`).get()).val();
    if (!member || member.status === "blocked") throw new HttpsError("failed-precondition", "This member account is blocked or does not exist.");
    if (verifiedBy === "badge_scan") { if (!loyaltyVerifyBadgeCode(memberId, member.badgeSecret, String(data.code || ""), Date.now())) throw new HttpsError("permission-denied", "Badge code is invalid or expired."); }
    else { if (!(await verifyLoyaltyOtpProof(db, memberId, data.otpToken, data.otp))) throw new HttpsError("permission-denied", "OTP is invalid or expired."); }
    const catalog = (await db.ref(`/loyaltyRewardCatalog/${rewardId}`).get()).val();
    if (!catalog || catalog.enabled === false) throw new HttpsError("not-found", "This reward is not available.");
    const balances = (await db.ref(`/loyaltyBalances/${memberId}`).get()).val() || {redBalance: 0, yellowBalance: 0};
    const currentBalance = catalog.costCurrency === "red" ? Loyalty.positiveInt(balances.redBalance, 0) : Loyalty.positiveInt(balances.yellowBalance, 0);
    if (currentBalance < catalog.costQty) throw new HttpsError("failed-precondition", `Not enough ${catalog.costCurrency} stamps.`);
    const rewardInstanceId = `rwd_${crypto.randomBytes(10).toString("hex")}`;
    const now = Date.now();
    const debitField = catalog.costCurrency === "red" ? "redBalance" : "yellowBalance";
    // The Admin SDK's local cache is cold on a fresh instance, so the callback is first
    // invoked with `current === null` even though we already have the real balance above.
    // Substituting a hardcoded {0,0} there (instead of the fetched `balances`) would make
    // every claim on a cold instance look "insufficient" and hard-abort (returning
    // undefined does not retry — see transaction-cold-cache-check.mjs / Sep 22 PR 570).
    // transactionCurrent() feeds the real fetched value in on that first call only; a
    // genuine retry after that always sees the server's actual current value.
    const debitState = {seen: false};
    const debit = await db.ref(`/loyaltyBalances/${memberId}`).transaction((current) => {
      current = transactionCurrent(current, balances, debitState) || {redBalance: 0, yellowBalance: 0};
      const have = Loyalty.positiveInt(current[debitField], 0);
      if (have < catalog.costQty) return undefined; // genuinely insufficient on the real (cold-cache-corrected) value — undefined here is a true abort, matching claimManagerApproval's pattern
      return Object.assign({}, current, {[debitField]: have - catalog.costQty, updatedAt: now});
    }, undefined, false);
    if (!debit.committed) throw new HttpsError("failed-precondition", `Not enough ${catalog.costCurrency} stamps.`);
    const discountAmount = Loyalty.computeRewardDiscount(catalog, data.itemPrice, data.orderNet);
    const writes = {
      // costCurrency/costQty are recorded on the claim itself, not re-derived from the
      // catalog later: the catalog is admin-editable, so a release that re-read it could
      // refund a different number of stamps than were actually taken. What was charged is
      // a fact about this claim, the same reason a posted journal line keeps its own amount.
      [`loyaltyRewards/${memberId}/${rewardInstanceId}`]: {rewardId, status: "claimed", issuedAt: now, expiresAt: now + catalog.expiryDays * 86400000, claimedAt: now, claimedBy: actor.uid, verifiedBy, discountAmount, grantType: catalog.grantType, name: catalog.name || rewardId, costCurrency: catalog.costCurrency, costQty: catalog.costQty, schemaVersion: 1},
      [`loyaltyLedger/${memberId}/redeem_${rewardInstanceId}`]: {type: "redeem_claim", rewardId, rewardInstanceId, occurredAt: now, cashierUid: actor.uid, currency: catalog.costCurrency, qty: catalog.costQty, schemaVersion: 1},
    };
    await db.ref().update(writes);
    // The per-cashier redemption count is NOT incremented here. It is one half of the
    // spec §10 control (redemptions per cashier against their sales volume), and a claim
    // that is later released gave no product away — counting it would overstate the
    // control and put noise in the one number meant to make give-aways visible. It is
    // booked in finalizeLoyaltyRedemption instead, alongside the cost, so both halves of
    // the control measure the same event: a redemption that actually happened.
    logger.info("Loyalty reward claimed", {memberId, rewardId, rewardInstanceId});
    return {rewardInstanceId, discountAmount, grantType: catalog.grantType, name: catalog.name || rewardId, expiresAt: writes[`loyaltyRewards/${memberId}/${rewardInstanceId}`].expiresAt};
  },
);

/**
 * Called by the POS when the order the claimed reward was attached to
 * actually completes, to move the reward from claimed -> redeemed and
 * stamp it with the real order id (a claim can be abandoned if the POS
 * session is reset before finalizing — those stay "claimed" and simply
 * expire, no manual cleanup needed).
 */
exports.finalizeLoyaltyRedemption = onCall(
  {region: LOYALTY_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 20, memory: "256MiB"},
  async (request) => {
    const db = getDatabase(); await requirePortalPermission(db, request, ["pos"]);
    const data = request.data || {};
    const memberId = loyaltyKey(data.memberId, "Member ID"), rewardInstanceId = loyaltyKey(data.rewardInstanceId, "Reward instance ID"), orderId = loyaltyKey(data.orderId, "Order ID");
    const rewardRef = db.ref(`/loyaltyRewards/${memberId}/${rewardInstanceId}`);
    // Same Admin SDK cold-cache hazard as claimLoyaltyReward above: on a fresh
    // instance the transaction callback is first invoked with `current ===
    // null` even though the reward record genuinely exists as "claimed" —
    // treating that as "not claimed" would hard-abort (no retry) and reject a
    // legitimate finalize call. Pre-fetch the real record and substitute it
    // in via transactionCurrent() on that first call only; a real "already
    // finalized / no longer claimed" still returns undefined and aborts.
    const initialReward = (await rewardRef.get()).val();
    const finalizeState = {seen: false};
    const result = await rewardRef.transaction((current) => {
      current = transactionCurrent(current, initialReward, finalizeState);
      if (!current || current.status !== "claimed") return; // already redeemed/expired/reversed — do not touch
      return Object.assign({}, current, {status: "redeemed", redeemedOrderId: orderId, redeemedAt: Date.now()});
    }, undefined, false);
    if (!result.committed) throw new HttpsError("failed-precondition", "This reward was already finalized or is no longer claimed.");
    // Cost is booked once, at the moment a claim actually becomes a real redemption — matching
    // 4920's GL posting (Financial.orderPosting reads order.loyaltyDiscount, written once the
    // order completes) and excluding claims that were abandoned before the order finalized.
    const finalized = result.snapshot.val() || {};
    await loyaltyRedemptionCostIncrement(db, finalized.rewardId, finalized.name, Number(finalized.discountAmount) || 0);
    // Booked here rather than at claim time so the spec §10 control counts give-aways that
    // really happened. Attributed to whoever authorised the claim, not whoever happened to
    // finalize it — a shift can change hands between ringing the reward and taking payment,
    // and the control is about who handed the product over.
    if (finalized.claimedBy) await loyaltyStatIncrement(db, `/loyaltyStats/redemptionsByCashier/${loyaltyStatKey(finalized.claimedBy)}`, 1);
    return {ok: true};
  },
);

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
      return Object.assign({}, current, {status: "released", releasedAt: Date.now(), releasedBy: actor.uid, releaseReason: reason});
    }, undefined, false);
    if (!result.committed) throw new HttpsError("failed-precondition", "This reward is no longer an open claim — it was already completed or released.");

    const released = result.snapshot.val() || {};
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
    if (!Loyalty.isCurrency(data.currency)) throw new HttpsError("invalid-argument", "Currency must be red or yellow.");
    const qty = Loyalty.positiveInt(data.qty, 0);
    if (!(qty > 0)) throw new HttpsError("invalid-argument", "Quantity must be a positive whole number.");
    const ruleId = data.ruleId ? loyaltyKey(data.ruleId) : `rule_${crypto.randomBytes(8).toString("hex")}`;
    const now = Date.now();
    const row = {trigger, currency: data.currency, qty, condition: data.condition && typeof data.condition === "object" ? data.condition : {}, startAt: data.startAt == null ? null : Number(data.startAt), endAt: data.endAt == null ? null : Number(data.endAt), enabled: data.enabled !== false, name: financeText(data.name, 120), updatedAt: now, updatedBy: actor.uid};
    await db.ref(`/loyaltyEarningRules/${ruleId}`).update(row);
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
    const validated = Loyalty.validateRewardDefinition(data);
    if (!validated.ok) throw new HttpsError("invalid-argument", validated.errors.join(" "));
    const rewardId = data.rewardId ? loyaltyKey(data.rewardId) : `reward_${crypto.randomBytes(8).toString("hex")}`;
    const now = Date.now();
    await db.ref(`/loyaltyRewardCatalog/${rewardId}`).update(Object.assign({}, validated.reward, {updatedAt: now, updatedBy: actor.uid}));
    await db.ref(`/operationalAudit/${now}_loyalty_catalog_${rewardId}`).set(operationalAuditRecord("manage_loyalty_reward_catalog", "loyaltyRewardCatalog", rewardId, actor, validated.reward));
    return {rewardId};
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
    const [activeMembersSnap, costSnap, stampsSnap, redemptionsSnap, ...tenureSnaps] = await Promise.all([
      db.ref("/loyaltyStats/activeMembers").get(),
      db.ref("/loyaltyStats/redemptionCostByReward").get(),
      db.ref("/loyaltyStats/stampsByCashier").get(),
      db.ref("/loyaltyStats/redemptionsByCashier").get(),
      ...LOYALTY_TENURE_MILESTONES.map(({days}) => db.ref("/loyaltyMembers").orderByChild("createdAt").startAt(now - days * 86400000 - LOYALTY_TENURE_LOOKBACK_MS).endAt(now - days * 86400000).get()),
    ]);
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
      tenureMilestones,
    };
  },
);
