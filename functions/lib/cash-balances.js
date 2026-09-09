"use strict";

const crypto = require("node:crypto");
const Financial = require("./financial");

const REGISTER_ACCOUNT = "asset:register_cash";
const UNDEPOSITED_ACCOUNT = "asset:cash_awaiting_deposit";
const REVOLVING_ACCOUNT = "asset:petty_cash";
const CASH_ACCOUNT_PREFIX = "asset:cash_account:";

function cents(value) {
  return Math.round((Number(value) || 0) * 100);
}

function pesos(value) {
  return Financial.money((Number(value) || 0) / 100);
}

function emptyDelta() {
  return {registerCents: 0, undepositedCents: 0, revolvingCents: 0, cashAccountCents: {}};
}

function emptyBalances() {
  return {registerCents: 0, undepositedCents: 0, revolvingCents: 0, cashAccountCents: {}};
}

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

function fingerprint(movement) {
  return crypto.createHash("sha256").update(JSON.stringify(movement == null ? null : movement)).digest("hex");
}

function snapshotFromMovements(movements, now = Date.now()) {
  const balances = emptyBalances(), applied = {};
  Object.keys(movements || {}).forEach((id) => {
    const movement = movements[id] || {};
    const delta = movementDelta(movement);
    addDelta(balances, delta);
    applied[id] = {fingerprint: fingerprint(movement), delta};
  });
  return {schemaVersion: 1, complete: true, balances, applied, meta: {schemaVersion: 1, complete: true, movementCount: Object.keys(applied).length, builtAt: now, updatedAt: now}};
}

// Returns undefined when the event was already applied, allowing an RTDB
// transaction to abort without writing. The applied movement delta makes
// retries and in-place audited edits idempotent.
function applyEvent(snapshot, movementId, before, after, now = Date.now()) {
  if (!snapshot || snapshot.schemaVersion !== 1 || snapshot.complete !== true) return undefined;
  const id = String(movementId || "");
  if (!id) return undefined;
  const next = snapshot;
  next.balances = next.balances || emptyBalances();
  next.balances.cashAccountCents = next.balances.cashAccountCents || {};
  next.applied = next.applied || {};
  const nextFingerprint = after == null ? fingerprint(null) : fingerprint(after);
  const prior = next.applied[id];
  if (prior && prior.fingerprint === nextFingerprint) return undefined;
  if (prior) addDelta(next.balances, prior.delta, -1);
  if (after == null) delete next.applied[id];
  else {const delta = movementDelta(after); addDelta(next.balances, delta); next.applied[id] = {fingerprint: nextFingerprint, delta};}
  next.meta = Object.assign({}, next.meta || {}, {schemaVersion: 1, complete: true, movementCount: Object.keys(next.applied).length, updatedAt: now});
  return next;
}

function resolveFloat(settings, activeShift) {
  settings = settings || {};
  activeShift = activeShift || {};
  if (settings.fixedFloat != null && Financial.money(settings.fixedFloat) > 0) return Financial.money(settings.fixedFloat);
  const retained = activeShift.retainedFloat != null ? activeShift.retainedFloat : activeShift.openingFloat;
  if (Financial.money(retained) > 0) return Financial.money(retained);
  return 4000;
}

function clientBalances(snapshot, settings, activeShift) {
  const balances = snapshot && snapshot.balances || emptyBalances();
  const registerGross = pesos(balances.registerCents);
  const registerFloatAmount = resolveFloat(settings, activeShift);
  const out = {
    cash_on_hand: Financial.money(Math.max(0, registerGross - registerFloatAmount)),
    undeposited: pesos(balances.undepositedCents),
    revolving: pesos(balances.revolvingCents),
    cash_float: registerFloatAmount,
  };
  Object.keys(balances.cashAccountCents || {}).forEach((id) => {out[id] = pesos(balances.cashAccountCents[id]);});
  return {balances: out, registerFloatAmount, registerGross, source: "cashBalanceSummary", summary: Object.assign({}, snapshot && snapshot.meta || {})};
}

function pendingRecord(before, after, now = Date.now()) {
  return {fingerprint: fingerprint(after == null ? null : after), beforeDelta: movementDelta(before), afterDelta: movementDelta(after), afterExists: after != null, updatedAt: now};
}

function applyPending(snapshot, pending, now = Date.now()) {
  Object.keys(pending || {}).sort().forEach((id) => {
    const row = pending[id] || {};
    const prior = snapshot.applied && snapshot.applied[id];
    if (prior && prior.fingerprint === row.fingerprint) return;
    if (prior) addDelta(snapshot.balances, prior.delta, -1);
    if (row.afterExists) {
      const delta = row.afterDelta || emptyDelta();
      addDelta(snapshot.balances, delta);
      snapshot.applied = snapshot.applied || {};
      snapshot.applied[id] = {fingerprint: row.fingerprint, delta};
    } else if (snapshot.applied) delete snapshot.applied[id];
  });
  snapshot.meta = Object.assign({}, snapshot.meta || {}, {schemaVersion: 1, complete: true, movementCount: Object.keys(snapshot.applied || {}).length, updatedAt: now});
  return snapshot;
}

module.exports = {cents, pesos, emptyDelta, emptyBalances, addDelta, movementDelta, fingerprint, snapshotFromMovements, applyEvent, resolveFloat, clientBalances, pendingRecord, applyPending};
