"use strict";

const crypto = require("node:crypto");
const Financial = require("./financial");

const REGISTER_ACCOUNT = "asset:register_cash";
const UNDEPOSITED_ACCOUNT = "asset:cash_awaiting_deposit";
const REVOLVING_ACCOUNT = "asset:petty_cash";
const CASH_ACCOUNT_PREFIX = "asset:cash_account:";
// v4 (Sep 2026): applied records carry the movement's Manila day so the cash-flow day/month
// index can be maintained incrementally; bumping the version rebuilds everything once.
const SCHEMA_VERSION = 4;
const FLOW_INDEX_VERSION = 1;

function cents(value) { return Math.round((Number(value) || 0) * 100); }
function pesos(value) { return Financial.money((Number(value) || 0) / 100); }
function emptyDelta() { return {registerCents: 0, undepositedCents: 0, revolvingCents: 0, cashAccountCents: {}}; }
function emptyBalances() { return {registerCents: 0, undepositedCents: 0, revolvingCents: 0, cashAccountCents: {}}; }

function addDelta(target, delta, sign = 1) {
  if (!target || !delta) return target;
  target.registerCents += sign * (Number(delta.registerCents) || 0);
  target.undepositedCents += sign * (Number(delta.undepositedCents) || 0);
  target.revolvingCents += sign * (Number(delta.revolvingCents) || 0);
  Object.keys(delta.cashAccountCents || {}).forEach((id) => {
    target.cashAccountCents[id] = (Number(target.cashAccountCents[id]) || 0) + sign * (Number(delta.cashAccountCents[id]) || 0);
    if (!target.cashAccountCents[id]) delete target.cashAccountCents[id];
  });
  return target;
}

function movementDelta(movement) {
  const delta = emptyDelta();
  (movement && Array.isArray(movement.lines) ? movement.lines : []).forEach((line) => {
    const account = String(line && line.account || "");
    const value = cents(line && line.debit) - cents(line && line.credit);
    if (!value) return;
    if (account === REGISTER_ACCOUNT) delta.registerCents += value;
    else if (account === UNDEPOSITED_ACCOUNT) delta.undepositedCents += value;
    else if (account === REVOLVING_ACCOUNT) delta.revolvingCents += value;
    else if (account.indexOf(CASH_ACCOUNT_PREFIX) === 0) {
      const id = account.slice(CASH_ACCOUNT_PREFIX.length);
      if (id) delta.cashAccountCents[id] = (Number(delta.cashAccountCents[id]) || 0) + value;
    }
  });
  return delta;
}

function manilaDay(ts) {
  const n = Number(ts);
  return new Date((Number.isFinite(n) && n > 0 ? n : 0) + 8 * 3600000).toISOString().slice(0, 10);
}
// Opening balances of cash accounts are presented on the account's opening date, which can
// change, so the Books cash flow reads them from their own small index instead of by ledger day.
function isCashAccountOpening(movement) {
  return /^opening_balance/.test(String(movement && movement.type || "")) && String(movement && movement.sourceType || "") === "cashAccount";
}
function movementDay(movement) { return manilaDay(movement && (movement.occurredAt || movement.postedAt)); }
function isZeroDelta(delta) {
  return !delta || (!delta.registerCents && !delta.undepositedCents && !delta.revolvingCents && !Object.keys(delta.cashAccountCents || {}).some((id) => delta.cashAccountCents[id]));
}
function appliedRecord(movement) {
  return {fingerprint: fingerprint(movement), delta: movementDelta(movement), day: movementDay(movement), opening: isCashAccountOpening(movement)};
}
function openingRecord(movementId, movement, applied) {
  return {movementId: String(movementId), accountId: String(movement && movement.sourceId || ""), type: String(movement && movement.type || ""), sourceType: "cashAccount", occurredAt: Number(movement && movement.occurredAt) || 0, day: applied.day, delta: applied.delta};
}
// Apply one contribution change to the cash-flow index maps (mutates the given maps).
// daily/monthly: {key: delta}; openings: {movementId: record|null}.
function applyFlowContribution(flow, movementId, prior, applied, movement) {
  const bump = (map, key, delta, sign) => { map[key] = addDelta(Object.assign(emptyDelta(), JSON.parse(JSON.stringify(map[key] || emptyDelta()))), delta, sign); };
  if (prior && prior.day) {
    if (prior.opening) flow.openings[movementId] = null;
    else { bump(flow.daily, prior.day, prior.delta, -1); bump(flow.monthly, prior.day.slice(0, 7), prior.delta, -1); }
  }
  if (applied) {
    if (applied.opening) flow.openings[movementId] = openingRecord(movementId, movement, applied);
    else { bump(flow.daily, applied.day, applied.delta, 1); bump(flow.monthly, applied.day.slice(0, 7), applied.delta, 1); }
  }
  return flow;
}
function flowValue(delta) { return isZeroDelta(delta) ? null : delta; }

function fingerprint(value) { return crypto.createHash("sha256").update(JSON.stringify(value == null ? null : value)).digest("hex"); }

function splitSnapshotFromMovements(movements, now = Date.now()) {
  const balances = emptyBalances(), applied = {}, flow = {daily: {}, monthly: {}, openings: {}};
  Object.keys(movements || {}).forEach((id) => {
    const movement = movements[id] || {};
    const record = appliedRecord(movement);
    addDelta(balances, record.delta);
    applied[id] = record;
    applyFlowContribution(flow, id, null, record, movement);
  });
  ["daily", "monthly"].forEach((kind) => Object.keys(flow[kind]).forEach((key) => { if (!flowValue(flow[kind][key])) delete flow[kind][key]; }));
  Object.keys(flow.openings).forEach((key) => { if (!flow.openings[key]) delete flow.openings[key]; });
  const count = Object.keys(applied).length;
  return {
    summary: {schemaVersion: SCHEMA_VERSION, complete: true, balances, meta: {schemaVersion: SCHEMA_VERSION, complete: true, movementCount: count, builtAt: now, updatedAt: now}},
    applied,
    flow: Object.assign(flow, {meta: {schemaVersion: FLOW_INDEX_VERSION, summarySchemaVersion: SCHEMA_VERSION, complete: true, builtAt: now}}),
  };
}

function snapshotFromMovements(movements, now = Date.now()) { return splitSnapshotFromMovements(movements, now).summary; }

function applyContribution(summary, prior, after, now = Date.now()) {
  if (!summary || summary.schemaVersion !== SCHEMA_VERSION || summary.complete !== true) return null;
  const next = JSON.parse(JSON.stringify(summary));
  next.balances = next.balances || emptyBalances();
  next.balances.cashAccountCents = next.balances.cashAccountCents || {};
  if (prior) addDelta(next.balances, prior.delta, -1);
  const applied = after == null ? null : appliedRecord(after);
  if (applied) addDelta(next.balances, applied.delta);
  const priorCount = Number(next.meta && next.meta.movementCount) || 0;
  const movementCount = Math.max(0, priorCount + (prior ? -1 : 0) + (applied ? 1 : 0));
  next.meta = Object.assign({}, next.meta || {}, {schemaVersion: SCHEMA_VERSION, complete: true, movementCount, updatedAt: now});
  return {summary: next, applied};
}

function contributionMatches(applied, movement) {
  if (movement == null) return !applied;
  return Boolean(applied && applied.fingerprint === fingerprint(movement));
}

function resolveFloat(settings, activeShift) {
  settings = settings || {}; activeShift = activeShift || {};
  if (settings.fixedFloat != null && Financial.money(settings.fixedFloat) > 0) return Financial.money(settings.fixedFloat);
  const retained = activeShift.retainedFloat != null ? activeShift.retainedFloat : activeShift.openingFloat;
  if (Financial.money(retained) > 0) return Financial.money(retained);
  return 4000;
}

function clientBalances(snapshot, settings, activeShift) {
  const balances = snapshot && snapshot.balances || emptyBalances();
  const registerGross = pesos(balances.registerCents);
  const registerFloatAmount = resolveFloat(settings, activeShift);
  const out = {cash_on_hand: Financial.money(Math.max(0, registerGross - registerFloatAmount)), undeposited: pesos(balances.undepositedCents), revolving: pesos(balances.revolvingCents), cash_float: registerFloatAmount};
  Object.keys(balances.cashAccountCents || {}).forEach((id) => {out[id] = pesos(balances.cashAccountCents[id]);});
  return {balances: out, registerFloatAmount, registerGross, source: "cashBalanceSummary", summary: Object.assign({}, snapshot && snapshot.meta || {})};
}

function pendingRecord(movementId, now = Date.now()) { return {movementId: String(movementId || ""), queuedAt: now}; }
function pendingKey(eventId, movementId) { return fingerprint(`${String(eventId || "event")}:${String(movementId || "")}`).slice(0, 40); }

module.exports = {SCHEMA_VERSION, FLOW_INDEX_VERSION, manilaDay, isCashAccountOpening, movementDay, isZeroDelta, appliedRecord, applyFlowContribution, flowValue, cents, pesos, emptyDelta, emptyBalances, addDelta, movementDelta, fingerprint, splitSnapshotFromMovements, snapshotFromMovements, applyContribution, contributionMatches, resolveFloat, clientBalances, pendingRecord, pendingKey};
