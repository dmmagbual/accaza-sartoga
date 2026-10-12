// Supplier Advances (1115) posting guard (Oct 2026).
//
// A drawer-released supplier advance never reached Finance Books, so applying it credited 1115
// with nothing behind it: the control audit reported "Supplier Advances (1115) Finance Books
// -5637.50 vs open subledger 0.00" and the purchase looked paid although no posted cash left.
// These tests pin the rule that prevents it:
//   1. the posting proof itself (real behaviour, pure function);
//   2. both credit paths refuse before they claim an approval or write (source wiring);
//   3. the retired register route can no longer write an unposted advance.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const posting = require('../functions/lib/supplier-advance-posting.js');
const {ADVANCE_PREFIX, candidateMovementIds, isActiveMovement, postingEvidence} = posting;

const line = (account, debit, credit) => ({account, debit, credit});
const advanceAccount = (id) => `${ADVANCE_PREFIX}${id}`;

// ---------- 1. candidate movement ids ----------
assert.deepEqual(candidateMovementIds('V1', {}), ['petty_V1'], 'a Cash Payments voucher posts as petty_<id>');
assert.deepEqual(
  candidateMovementIds('V2', {voucher: {conversionMovementId: 'conversion_1', sourceJournalId: 'journal_1'}}),
  ['petty_V2', 'conversion_1'],
  'a converted voucher links its conversion movement, which carries the 1115 debit',
);
assert.deepEqual(
  candidateMovementIds('V3', {voucher: {conversionMovementId: 'journal_adoption', sourceJournalId: 'journal_3'}}),
  ['petty_V3', 'journal_3'],
  'an adopted journal has no conversion movement, so its source journal is the candidate',
);
assert.deepEqual(
  candidateMovementIds('padv_9', {shiftPayOut: {shiftId: 'S9', ts: 1791680400000, index: 2}}),
  ['petty_padv_9', 'shift_payout_S9_1791680400000_2'],
  'a register shift pay-out posts as shift_payout_<shiftId>_<ts>_<index>',
);
assert.deepEqual(candidateMovementIds('padv_9', {shiftPayOut: {shiftId: 'S9'}}), ['petty_padv_9'], 'an incomplete shift row adds no invented id');
assert.deepEqual(candidateMovementIds('', {}), [], 'no advance id means nothing to prove');
assert.equal(new Set(candidateMovementIds('V4', {voucher: {conversionMovementId: 'petty_V4'}})).size, 1, 'ids are de-duplicated');

// ---------- 2. the posting proof ----------
const posted = {id: 'petty_V1', lines: [line(advanceAccount('V1'), 1000, 0), line('asset:cash_awaiting_deposit', 0, 1000)]};
assert.deepEqual(postingEvidence('V1', {petty_V1: posted}), {movementId: 'petty_V1', amount: 1000}, 'an active advance debit proves the posting');
assert.equal(postingEvidence('V1', {}), null, 'no movement means no proof');
assert.equal(postingEvidence('V1', {petty_V1: {lines: [line(advanceAccount('V1'), 0, 1000)]}}), null, 'a credit-only movement is not proof');
assert.equal(postingEvidence('V1', {petty_V1: {lines: [line(advanceAccount('OTHER'), 1000, 0)]}}), null, 'another advance does not prove this one');
assert.equal(postingEvidence('V1', {petty_V1: {lines: [line('coa:1900', 1000, 0)]}}), null, 'a movement that never debits 1115 is not proof');
assert.equal(
  postingEvidence('V1', {petty_V1: Object.assign({}, posted, {reversedByMovementId: 'petty_V1_reversal'})}),
  null,
  'a reversed original payment no longer proves the advance is in Finance Books',
);
assert.equal(
  postingEvidence('V1', {petty_V1: Object.assign({}, posted, {reversalOf: 'petty_V1_original'})}),
  null,
  'a reversal movement is not the original payment',
);
assert.deepEqual(
  postingEvidence('V2', {conversion_1: {id: 'conversion_1', type: 'suspense_supplier_advance_conversion', lines: [line(advanceAccount('V2'), 800, 0), line('coa:1900', 0, 800)]}}),
  {movementId: 'conversion_1', amount: 800},
  'a converted voucher is proven by its conversion movement',
);
assert.deepEqual(
  postingEvidence('padv_9', {shift_payout_S9_1_2: {id: 'shift_payout_S9_1_2', lines: [line(advanceAccount('padv_9'), 500, 0), line('asset:register_cash', 0, 500)]}}),
  {movementId: 'shift_payout_S9_1_2', amount: 500},
  'a shift pay-out that really posted does prove its advance',
);
assert.equal(isActiveMovement(posted), true);
assert.equal(isActiveMovement(null), false);
// The retired route's own shape: applied to a purchase, credited, never debited.
assert.equal(
  postingEvidence('padv_live', {petty_padv_live: {lines: [line(advanceAccount('padv_live'), 0, 5637.5)]}}),
  null,
  'the live -5637.50 shape can no longer be applied',
);

// ---------- 3. the credit paths refuse before they write ----------
const apply = read('src/functions/42b-financial-command-transactions.js');
const applyIndex = apply.indexOf('await requireSupplierAdvancePosting(db,advanceId,');
assert.ok(applyIndex > 0, 'applying an advance to a purchase must prove the original posting');
assert.ok(
  applyIndex < apply.indexOf('writes[`${base}/allocations/${invoiceId}`]'),
  'the proof must be required before any allocation write is staged',
);
assert.ok(
  apply.indexOf('requireSupplierAdvancePosting') < apply.indexOf('cashAsset=`asset:purchase_cash_advance:${advanceId}`'),
  'the proof must be required before the advance account is chosen as the credit account',
);

const liquidation = read('src/functions/21-staff-advance-liquidation.js');
const returnIndex = liquidation.indexOf('await requireSupplierAdvancePosting(db,id,{voucher})');
assert.ok(returnIndex > 0, 'returning an unallocated supplier payment must prove the original posting');
assert.ok(
  returnIndex < liquidation.indexOf('claimManagerApproval(db,data,"return_supplier_payment"'),
  'the proof must be required before the return consumes a manager approval',
);
assert.ok(
  returnIndex < liquidation.indexOf('Financial.line(`asset:purchase_cash_advance:${id}`,0,remaining'),
  'the proof must be required before the 1115 credit is built',
);

const guard = read('src/functions/21b-supplier-advance-receipts.js');
assert.match(guard, /async function requireSupplierAdvancePosting\(db, advanceId, options\)/, 'the guard lives with the supplier-advance code');
assert.match(guard, /Backfill \/ verify 3C financial ledger/, 'the refusal names the controlled repair route');
assert.match(guard, /no original posting in Finance Books/, 'the refusal explains why it is refused');
assert.ok(
  !/\.ref\("\/financialMovements"\)\.get\(\)/.test(guard),
  'the proof must read candidate records by key, never download every movement',
);
assert.match(read('src/functions/00-bootstrap-notifications.js'), /require\("\.\/lib\/supplier-advance-posting"\)/, 'the rule is loaded once with the other finance libraries');

// ---------- 4. the retired register route stays retired ----------
const register = read('src/admin/register/40-revolving-fund.js');
assert.ok(!/type:'purchase_advance'/.test(register), 'the register must never write a purchase_advance pay-out again');
assert.ok(!/Release cash for a purchase/.test(register), 'the drawer-release form is gone, not merely shadowed by an early return');
assert.match(register, /function purchaseCashAdvance\(\)\{ alert\('Supplier payments now come from Undeposited Collection/, 'the retired action still explains where supplier payments are recorded');
assert.ok(!/'purchase_cash_advance'/.test(register), 'the register no longer requests the drawer-release approval');
// Cash-in and the shift lifecycle must survive untouched.
assert.match(read('src/admin/register/50-cash-movements.js'), /payIns/, 'cash-in still writes the drawer pay-ins');
assert.match(register, /revolving_fund_replenishment/, 'the revolving-fund replenish path is untouched');

console.log('supplier advance posting guard: proof rule, both credit paths and the retired register route verified');
