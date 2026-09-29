"use strict";
/* ============================================================
   Accaza Loyalty Program (Red/Yellow Stamps) — pure logic.
   Spec: claude/loyalty-program-spec-2026-09-29.md (Claude project doc).
   Mirrors the style of ./financial.js: pure functions, no DB access,
   no Firebase imports. Cloud Function wiring lives in
   src/functions/26-loyalty.js.

   Design notes (decisions confirmed 2026-09-29):
   - Daily earning cap applies to RED ONLY. Yellow is uncapped.
   - Overlapping promotions STACK — every matching enabled rule fires
     and its award is summed independently; the daily red cap is the
     only thing that bounds the result.
   - Redemption never posts its own financial movement. It claims a
     reward and reports back a discount amount; the caller (POS
     finalize flow) writes that amount to the order's own
     `loyaltyDiscount` field — deliberately NOT the existing `discount`
     field used by Senior/PWD and other discounts. Financial.orderPosting()
     posts `loyaltyDiscount` to its own GL line (expense:loyalty_discount
     -> Books code 4920 "Loyalty Discounts"), separate from the general
     4900 "Discounts & Comps" account, per the owner's explicit
     instruction (2026-09-29): "we should use separate discount for this
     kind of loyalty program so we know how much we are spending on it."
     Every surface that reads `order.discount` for computation — GL
     posting, net-sales reporting, the Z-report, the manager-correction
     control gate — reads `order.loyaltyDiscount` alongside it, so a
     redemption is charged/reported/controlled exactly like any other
     discount, just booked separately. Per-reward attribution for
     admin reporting still comes from loyaltyLedger/loyaltyRewards
     (full order/member/reward detail); the 4920 GL line is the
     aggregate financial-statement view, not a replacement for that.
     (The spec's original draft proposed reusing "4910 Loyalty
     Discounts", which collides with the real, live 4910 — "Sales
     Returns & Refunds" — so 4920 is used instead. See
     claude-project-doc §9/§12 for the full decision record.)
   ============================================================ */

const MONEY_EPSILON = 0.005;
function money(value) { return Math.round((Number(value) || 0) * 100) / 100; }
function safe(value, max = 160) { return String(value == null ? "" : value).trim().slice(0, max); }
function positiveInt(value, fallback = 0) { const n = Math.floor(Number(value)); return Number.isFinite(n) && n >= 0 ? n : fallback; }

const CURRENCIES = ["red", "yellow"];
function isCurrency(value) { return CURRENCIES.includes(String(value || "")); }

// ---------------------------------------------------------------------------
// Phone normalization — Philippine E.164 (+63XXXXXXXXXX), single canonical key.
// ---------------------------------------------------------------------------
function normalizePhonePH(raw) {
  let digits = String(raw || "").replace(/[^\d+]/g, "");
  if (digits.startsWith("+63")) digits = digits.slice(3);
  else if (digits.startsWith("63") && digits.length > 10) digits = digits.slice(2);
  else if (digits.startsWith("0")) digits = digits.slice(1);
  digits = digits.replace(/\D/g, "");
  if (!/^9\d{9}$/.test(digits)) return null; // PH mobile: 9XXXXXXXXX (10 digits)
  return `+63${digits}`;
}
function phoneKey(e164) { return String(e164 || "").replace(/[^\d+]/g, ""); }
function maskPhone(e164) {
  const value = String(e164 || "");
  if (value.length < 8) return value;
  return `${value.slice(0, 6)}•••${value.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// Earning rules engine — bounded trigger types (spec §3).
// ---------------------------------------------------------------------------
const TRIGGER_TYPES = ["per_order", "amount_threshold", "order_count", "first_order_after_signup"];

function ruleActiveAt(rule, atMs) {
  rule = rule || {};
  if (rule.enabled === false) return false;
  const start = rule.startAt == null ? null : Number(rule.startAt);
  const end = rule.endAt == null ? null : Number(rule.endAt);
  if (start != null && atMs < start) return false;
  if (end != null && atMs > end) return false;
  return true;
}

/**
 * Evaluate every enabled, in-range rule against one completed order and
 * return the stamps to award, PRE-cap. Rules stack — every match fires and
 * sums independently (confirmed 2026-09-29). Cap enforcement is separate
 * (see applyDailyRedCap) because it needs the day's running total, which
 * this pure function does not have.
 *
 * @param {object} rules   /loyaltyEarningRules — {ruleId: {trigger, currency, qty, condition, startAt, endAt, enabled}}
 * @param {object} context {netAmount, isFirstOrderAfterSignup, orderCount, occurredAt}
 * @returns {Array<{ruleId, currency, qty}>}
 */
function evaluateEarningRules(rules, context) {
  context = context || {};
  const netAmount = money(context.netAmount);
  const occurredAt = Number(context.occurredAt) || Date.now();
  const awards = [];
  // amount_threshold rules form a TIER LADDER per currency — spec §1/§12:
  // "Yellow tiers are flat (cross ₱500 → 1, cross ₱1,000 → 2), not incremental."
  // Crossing ₱1,000 must award 2 total, not 1 (for ₱500) + 2 (for ₱1,000). So
  // only the highest-qualifying amount_threshold rule fires per currency;
  // every other trigger type (per_order / order_count / first_order_after_signup)
  // stacks freely across all matching enabled rules, per the confirmed
  // "overlapping promotions stack" decision — those are independent grants,
  // not bands of one continuous metric.
  const bestThresholdByCurrency = {};
  Object.keys(rules || {}).forEach((ruleId) => {
    const rule = rules[ruleId] || {};
    if (!TRIGGER_TYPES.includes(rule.trigger)) return;
    if (!ruleActiveAt(rule, occurredAt)) return;
    if (!isCurrency(rule.currency)) return;
    const qty = positiveInt(rule.qty, 0);
    if (!qty) return;
    if (rule.trigger === "amount_threshold") {
      const minNetAmount = money((rule.condition || {}).minNetAmount);
      if (netAmount <= minNetAmount) return;
      const current = bestThresholdByCurrency[rule.currency];
      if (!current || minNetAmount > current.minNetAmount) bestThresholdByCurrency[rule.currency] = {ruleId, currency: rule.currency, qty, minNetAmount};
      return;
    }
    let matches = false;
    if (rule.trigger === "per_order") matches = true;
    else if (rule.trigger === "order_count") {
      const every = positiveInt((rule.condition || {}).every, 0);
      matches = every > 0 && positiveInt(context.orderCount, 0) > 0 && positiveInt(context.orderCount, 0) % every === 0;
    } else if (rule.trigger === "first_order_after_signup") matches = context.isFirstOrderAfterSignup === true;
    if (matches) awards.push({ruleId, currency: rule.currency, qty});
  });
  Object.values(bestThresholdByCurrency).forEach(({ruleId, currency, qty}) => awards.push({ruleId, currency, qty}));
  return awards;
}

/**
 * Apply the RED-ONLY daily cap to a list of pre-cap awards.
 * Yellow awards pass through unchanged. Red awards are capped against
 * `alreadyEarnedToday` (from loyaltyDailyCounters/{memberId}/{date}.red).
 * Returns {applied: [{ruleId,currency,qty}], reddedAwarded, cappedOut: bool}
 * — qty on a partially-capped red award is reduced, never dropped whole,
 * so a member sitting at 1/2 red today who then qualifies for +3 red
 * across stacked rules still banks the 1 remaining slot.
 */
function applyDailyRedCap(awards, alreadyEarnedToday, dailyRedCap) {
  const cap = positiveInt(dailyRedCap, 2);
  let redSoFar = positiveInt(alreadyEarnedToday, 0);
  const applied = [];
  let cappedOut = false;
  (awards || []).forEach((award) => {
    if (award.currency !== "red") { applied.push(award); return; }
    const room = Math.max(0, cap - redSoFar);
    if (room <= 0) { cappedOut = true; return; }
    const grant = Math.min(award.qty, room);
    if (grant < award.qty) cappedOut = true;
    if (grant > 0) { applied.push({ruleId: award.ruleId, currency: "red", qty: grant}); redSoFar += grant; }
  });
  return {applied, redEarnedToday: redSoFar, cappedOut};
}

// ---------------------------------------------------------------------------
// Reward catalog validation (spec §4) — the form cannot submit an uncapped reward.
// ---------------------------------------------------------------------------
const GRANT_TYPES = ["free_item_capped", "percent_off_capped", "fixed_off_capped", "free_item_no_sub"];
function validateRewardDefinition(input) {
  input = input || {};
  const errors = [];
  const costCurrency = isCurrency(input.costCurrency) ? input.costCurrency : null;
  if (!costCurrency) errors.push("Cost currency must be red or yellow.");
  const costQty = positiveInt(input.costQty, 0);
  if (!(costQty > 0)) errors.push("Cost quantity must be a positive whole number.");
  const grantType = GRANT_TYPES.includes(input.grantType) ? input.grantType : null;
  if (!grantType) errors.push("Grant type is invalid.");
  let cap = null;
  if (grantType === "free_item_capped" || grantType === "fixed_off_capped") {
    cap = money(input.cap);
    if (!(cap > 0)) errors.push("A peso cap is required for this grant type.");
  } else if (grantType === "percent_off_capped") {
    const percent = Number(input.percent);
    if (!(percent > 0 && percent <= 100)) errors.push("Percent must be between 0 and 100.");
    cap = money(input.cap);
    if (!(cap > 0)) errors.push("A peso cap is required even for a percent-off reward — an uncapped percent discount cannot be saved.");
  } else if (grantType === "free_item_no_sub") {
    if (!safe(input.itemId, 120)) errors.push("A specific free item is required for this grant type.");
  }
  const expiryDays = positiveInt(input.expiryDays, 0);
  if (!(expiryDays > 0)) errors.push("Expiry (days) must be a positive whole number.");
  if (errors.length) return {ok: false, errors};
  return {
    ok: true,
    reward: {
      costCurrency, costQty, grantType,
      cap: cap == null ? null : cap,
      percent: grantType === "percent_off_capped" ? Number(input.percent) : null,
      itemId: grantType === "free_item_no_sub" ? safe(input.itemId, 120) : null,
      expiryDays,
      stackingAllowed: input.stackingAllowed === true,
      name: safe(input.name, 120) || null,
      enabled: input.enabled !== false,
    },
  };
}

/**
 * Compute the peso discount amount for a redeemed reward against the
 * order's net (pre-loyalty-discount) amount.
 */
function computeRewardDiscount(reward, itemPrice, orderNet) {
  reward = reward || {};
  if (reward.grantType === "free_item_capped" || reward.grantType === "free_item_no_sub") {
    return money(Math.min(Number(itemPrice) || 0, reward.cap == null ? Number(itemPrice) || 0 : reward.cap));
  }
  if (reward.grantType === "fixed_off_capped") return money(Math.min(reward.cap, Number(orderNet) || 0));
  if (reward.grantType === "percent_off_capped") return money(Math.min(money((Number(orderNet) || 0) * (Number(reward.percent) || 0) / 100), reward.cap));
  return 0;
}

module.exports = {
  MONEY_EPSILON, money, safe, positiveInt, CURRENCIES, isCurrency,
  normalizePhonePH, phoneKey, maskPhone,
  TRIGGER_TYPES, ruleActiveAt, evaluateEarningRules, applyDailyRedCap,
  GRANT_TYPES, validateRewardDefinition, computeRewardDiscount,
};
