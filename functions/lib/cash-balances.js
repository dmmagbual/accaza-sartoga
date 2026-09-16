"use strict";

const crypto = require("node:crypto");
const Financial = require("./financial");

const REGISTER_ACCOUNT = "asset:register_cash";
const UNDEPOSITED_ACCOUNT = "asset:cash_awaiting_deposit";
const REVOLVING_ACCOUNT = "asset:petty_cash";
const CASH_ACCOUNT_PREFIX = "asset:cash_account:";
const SCHEMA_VERSION = 3;

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

function fingerprint(value) { return crypto.createHash("sha256").update(JSON.stringify(value == null ? null : value)).digest("hex"); }

function splitSnapshotFromMovements(movements, now = Date.now()) {
  const balances = emptyBalances(), applied = {};
  Object.keys(movements || {}).forEach((id) => {
    const movement = movements[id] || {};
    const delta = movementDelta(movement);
    addDelta(balances, delta);
    applied[id] = {fingerprint: fingerprint(movement), delta};
  });
  const count = Object.keys(applied).length;
  return {
    summary: {schemaVersion: SCHEMA_VERSION, complete: true, balances, meta: {schemaVersion: SCHEMA_VERSION, complete: true, movementCount: count, builtAt: now, updatedAt: now}},
    applied,
  };
}

function snapshotFromMovements(movements, now = Date.now()) { return splitSnapshotFromMovements(movements, now).summary; }

function applyContribution(summary, prior, after, now = Date.now()) {
  if (!summary || summary.schemaVersion !== SCHEMA_VERSION || summary.complete !== true) return null;
  const next = JSON.parse(JSON.stringify(summary));
  next.balances = next.balances || emptyBalances();
  next.balances.cashAccountCents = next.balances.cashAccountCents || {};
  if (prior) addDelta(next.balances, prior.delta, -1);
  const applied = after == null ? null : {fingerprint: fingerprint(after), delta: movementDelta(after)};
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

module.exports = {SCHEMA_VERSION, cents, pesos, emptyDelta, emptyBalances, addDelta, movementDelta, fingerprint, splitSnapshotFromMovements, snapshotFromMovements, applyContribution, contributionMatches, resolveFloat, clientBalances, pendingRecord, pendingKey};
