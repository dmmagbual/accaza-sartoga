"use strict";

// Supplier Advances (1115) posting proof (Oct 2026).
//
// A supplier advance is an asset: paying it DEBITS 1115, and applying it to a purchase, returning
// it or voiding it CREDITS 1115. Cash released from the register drawer under the retired
// drawer-funding model never reached Finance Books, so its advance was only ever credited. The
// control audit then reports a negative Supplier Advances balance against an open subledger of
// zero, a purchase looks paid although no posted cash ever left, and the drift is found weeks
// later with no way to name the advance.
//
// This module answers one question and nothing else: is there an ACTIVE Finance Books movement
// that debits this advance? Callers read the candidate movements by key — a handful of single
// record reads, never a whole-node download — and refuse the credit path when nothing proves the
// original payment.
//
// Side-effect free: no database, no clock, no currency formatting. The caller owns the reads and
// the error, so the rule can be tested without a database.

const ADVANCE_PREFIX = "asset:purchase_cash_advance:";

function money(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function text(value, max) {
  const out = value == null ? "" : String(value).trim();
  return max && out.length > max ? out.slice(0, max) : out;
}

// Movement ids that can carry the original advance debit.
//  - a Cash Payments voucher posts as `petty_<voucherId>`;
//  - a converted or adopted voucher links a second movement (its conversion movement, or the
//    source journal it was adopted from) and that movement carries the 1115 debit;
//  - a register shift pay-out -- the retired route -- posted as
//    `shift_payout_<shiftId>_<ts>_<index>`.
function candidateMovementIds(advanceId, options) {
  const id = text(advanceId, 120), out = [];
  const add = (value) => {
    const key = text(value, 160);
    if (key && out.indexOf(key) < 0) out.push(key);
  };
  if (!id) return out;
  add(`petty_${id}`);
  const voucher = (options && options.voucher) || {};
  const conversion = text(voucher.conversionMovementId, 160);
  if (conversion === "journal_adoption") add(voucher.sourceJournalId);
  else if (conversion && conversion !== "controlled_pending") add(conversion);
  const shift = (options && options.shiftPayOut) || {};
  if (shift.shiftId && shift.ts != null && shift.index != null) {
    add(`shift_payout_${text(shift.shiftId, 120)}_${Number(shift.ts) || 0}_${Number(shift.index) || 0}`);
  }
  return out;
}

// Posted history is immutable. A movement that reverses another, or that has itself been
// reversed, no longer proves the advance is in Finance Books.
function isActiveMovement(movement) {
  return !!movement && !movement.reversalOf && !movement.reversedByMovementId;
}

// Debit-positive effect of one movement on this advance's account.
function advanceNet(movement, advanceId) {
  const account = ADVANCE_PREFIX + text(advanceId, 120);
  return money((((movement && movement.lines) || [])).reduce((sum, line) => (
    String((line && line.account) || "") === account ? sum + (Number(line.debit) || 0) - (Number(line.credit) || 0) : sum
  ), 0));
}

// {movementId, amount} when an active movement debits the advance, otherwise null.
function postingEvidence(advanceId, movements) {
  const map = movements && typeof movements === "object" ? movements : {};
  const keys = Object.keys(map).sort();
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index], movement = map[key];
    if (!isActiveMovement(movement)) continue;
    const amount = advanceNet(movement, advanceId);
    if (amount >= 0.005) return {movementId: text((movement && movement.id) || key, 160), amount};
  }
  return null;
}

module.exports = {ADVANCE_PREFIX, candidateMovementIds, isActiveMovement, advanceNet, postingEvidence};
