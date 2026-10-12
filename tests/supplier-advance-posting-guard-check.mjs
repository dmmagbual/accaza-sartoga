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
const {ADVANCE_PREFIX, candidateMovementIds, isActiveMovement, advanceNet, postingEvidence} = posting;

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
assert.match(guard, /cannot be applied, returned or voided/, 'the refusal covers every credit path it guards');
assert.ok(
  !/\.ref\("\/financialMovements"\)\.get\(\)/.test(guard),
  'the proof must read candidate records by key, never download every movement',
);
assert.match(read('src/functions/00-bootstrap-notifications.js'), /require\("\.\/lib\/supplier-advance-posting"\)/, 'the rule is loaded once with the other finance libraries');

// ---------- 3b. the void path is guarded and linked ----------
// Voiding posts the reversal of what Finance Books holds. Without the guard an unposted advance could
// be voided into a fresh 1115 credit, and without the link the voided original still looked posted,
// so the advance could be applied again — the exact defect this change removes.
const voidCommand = liquidation.indexOf('} else if (action === "void") {');
assert.ok(voidCommand > 0, 'the void action must exist in Cash Payments');
const voidGuard = liquidation.indexOf('if (voucher.transactionType === "purchase_advance") await requireSupplierAdvancePosting(db, id, {voucher});', voidCommand);
assert.ok(voidGuard > voidCommand, 'voiding a supplier payment must prove the original posting');
assert.ok(
  voidGuard < liquidation.indexOf('approvalAction = "void_petty_voucher"', voidCommand),
  'the proof must be required before the void approval is requested',
);
assert.ok(
  voidGuard < liquidation.indexOf('claimManagerApproval(db, data, approvalAction, id, value', voidCommand),
  'the proof must be required before the void approval is claimed',
);
assert.ok(
  voidGuard < liquidation.indexOf('{voided: true, status:', voidCommand),
  'the proof must be required before the voucher is marked voided',
);

const trigger = read('src/functions/41-expense-assets.js');
const voidBranch = trigger.indexOf('if (after.voided === true && before.voided !== true && after.status === "approved" && value > 0) {');
assert.ok(voidBranch > 0, 'the void trigger branch must exist');
const triggerProof = trigger.indexOf('await requireSupplierAdvancePosting(db,id,{voucher:after})', voidBranch);
assert.ok(triggerProof > voidBranch, 'the void trigger must refuse to post a credit with nothing behind it');
assert.ok(
  trigger.indexOf('await commitFinancial(db, movementId, movement, actor, writes)', voidBranch) > triggerProof,
  'the proof must be required before the void movement is committed',
);
assert.ok(
  trigger.indexOf('if((await db.ref(`/financialMovements/${movementId}`).get()).exists())return;', voidBranch) > voidBranch,
  'an already-posted void must stay idempotent and skip the proof',
);
const triggerIdempotent = trigger.indexOf('if((await db.ref(`/financialMovements/${movementId}`).get()).exists())return;', voidBranch);
assert.ok(triggerIdempotent < triggerProof, 'idempotency is checked before the proof, so a replayed void cannot dead-letter');
assert.ok(
  trigger.includes('writes[`financialMovements/petty_${id}/reversedByMovementId`]=movementId;'),
  'a voided supplier payment must be linked to its reversal',
);
assert.ok(
  trigger.includes('writes[`financialMovements/petty_${id}/voidedAt`]=Date.now();'),
  'the link must record when the payment was voided',
);

// A voided advance can never be proved again, even though its debit line is still on record.
assert.equal(
  postingEvidence('V1', {petty_V1: Object.assign({}, posted, {reversedByMovementId: 'petty_void_V1', voidedAt: 1})}),
  null,
  'after a linked void the original no longer proves the advance can be applied',
);
assert.deepEqual(
  postingEvidence('V1', {petty_V1: posted, petty_void_V1: {lines: [line(advanceAccount('V1'), 0, 1000)]}}),
  {movementId: 'petty_V1', amount: 1000},
  'an unlinked void credit must not be treated as proof, and must not erase a real posting either',
);

// ---------- 4. Supplier Advances stays closed to manual journals ----------
// The replacement journal in the live Oct 2026 case reached 1115 through the chart code (coa:1115),
// which is exactly why the reconciliation had to resolve by code. The rule that a manual journal may
// not post to 1115 exists and is enforced on the chart code the journal carries, so the chart form
// cannot slip past it again.
const accountRules = read('src/functions/40-sales-finance.js');
assert.match(accountRules, /"1115":\{postingRule:"blocked"/, 'Supplier Advances must refuse manual journals');
assert.match(accountRules, /"1110":\{postingRule:"blocked"/, 'receivable control accounts must refuse manual journals too');
const manualJournal = read('src/functions/42c-financial-command-controls.js');
assert.match(manualJournal, /action === "manual_journal"/, 'the manual journal command must exist');
assert.match(
  manualJournal,
  /manualCodes=new Set\(\(Array\.isArray\(data\.lines\)\?data\.lines:\[\]\)\.map\(\(line\)=>String\(line&&line\.code\|\|""\)\)\)/,
  'the control-account rule must be checked against the chart code each line carries, not the account string',
);
assert.match(manualJournal, /if\(blockedRow\)throw new HttpsError\("failed-precondition",blockedRow\.message/, 'a blocked control account must refuse the journal outright');

// ---------- 5. the retired register route stays retired ----------
const register = read('src/admin/register/40-revolving-fund.js');
assert.ok(!/type:'purchase_advance'/.test(register), 'the register must never write a purchase_advance pay-out again');
assert.ok(!/Release cash for a purchase/.test(register), 'the drawer-release form is gone, not merely shadowed by an early return');
assert.match(register, /function purchaseCashAdvance\(\)\{ alert\('Supplier payments now come from Undeposited Collection/, 'the retired action still explains where supplier payments are recorded');
assert.ok(!/'purchase_cash_advance'/.test(register), 'the register no longer requests the drawer-release approval');
// Cash-in and the shift lifecycle must survive untouched.
assert.match(read('src/admin/register/50-cash-movements.js'), /payIns/, 'cash-in still writes the drawer pay-ins');
assert.match(register, /revolving_fund_replenishment/, 'the revolving-fund replenish path is untouched');

// ---------- 5. void-and-replace is net-neutral on 1115 and re-provable only through the replacement ----------
// The legacy void-and-replace route reverses the original and posts a linked replacement against the
// same account. On 1115 the two legs cancel, and because the original is linked as reversed only the
// replacement can prove an advance afterwards. Nothing pinned that before.
{
  const original = {id: 'petty_LEG', lines: [line(advanceAccount('LEG'), 1000, 0), line('asset:cash_account:bank', 0, 1000)], reversedByMovementId: 'petty_void_LEG'};
  const voidLeg = {id: 'petty_void_LEG', type: 'manual_books_journal_correction_reversal', lines: [line(advanceAccount('LEG'), 0, 1000), line('asset:cash_account:bank', 1000, 0)]};
  const replacement = {id: 'petty_LEG_replace', lines: [line(advanceAccount('LEG_replace'), 1000, 0), line('asset:cash_account:bank', 0, 1000)]};
  assert.equal(advanceNet(original, 'LEG') + advanceNet(voidLeg, 'LEG'), 0, 'the replaced original must be fully reversed on 1115');
  assert.equal(advanceNet(replacement, 'LEG_replace'), 1000, 'the replacement carries the advance value under its own key');
  assert.equal(postingEvidence('LEG', {petty_LEG: original}), null, 'the replaced original must not prove an advance any more');
  assert.deepEqual(postingEvidence('LEG_replace', {petty_LEG_replace: replacement}), {movementId: 'petty_LEG_replace', amount: 1000}, 'the replacement carries the provable advance');
  const legacy = read('src/functions/21c-voucher-correction.js');
  assert.match(legacy, /\[`financialMovements\/\$\{originalId\}\/reversedByMovementId`\]:reverseId/, 'void-and-replace must link the original it replaced');
  assert.match(legacy, /postId = `petty_\$\{replacementId\}`|postId=`petty_\$\{replacementId\}`/, 'void-and-replace must post the replacement under its own key');
  assert.match(legacy, /reverseId = `petty_void_\$\{id\}`|reverseId=`petty_void_\$\{id\}`/, 'void-and-replace must post the reversal under the void key');
}

// ---------- 6. the advance key the guard proves is the key the posting writes ----------
// The shift pay-out posting writes asset:purchase_cash_advance:${financeKey(entry.id)}, while the guard
// builds its account from the raw id. That is safe only while financeKey returns the key unchanged, so
// the invariant is pinned here: if financeKey ever starts normalising ids, this test fails first and
// points at the guard instead of silently refusing valid advances.
{
  const bundle = read('functions/index.js');
  const start = bundle.indexOf('function financeKey(');
  assert.ok(start > 0, 'financeKey must exist in the Functions bundle');
  let depth = 0, end = bundle.indexOf('{', start);
  for (let i = end; i < bundle.length; i += 1) { if (bundle[i] === '{') depth += 1; else if (bundle[i] === '}' && --depth === 0) { end = i + 1; break; } }
  // HttpsError lives in the bundle's scope, so the extracted function gets a stand-in that keeps the
  // same shape: the first argument is the code, the second is the human message.
  class FakeHttpsError extends Error { constructor(code, message) { super(message || code); this.code = code; } }
  const financeKey = new Function('HttpsError', `${bundle.slice(start, end)}\nreturn financeKey;`)(FakeHttpsError);
  for (const id of ['pv_mtk3lbxtkn2', 'padv_live', 'variance_purchase_disc_mv2zxhlexd6_amv4u1a9j0', 'journal_staff_advance_books_edit_1', 'suspense_advance_books_manual_1']) {
    assert.equal(financeKey(id, 'Advance ID'), id, `financeKey must not transform a valid advance key (${id}); the posting and the guard must agree on the account`);
  }
  assert.equal(financeKey('  pv_trim_me  ', 'Advance ID'), 'pv_trim_me', 'financeKey trims surrounding whitespace');
  assert.throws(() => financeKey('bad.key', 'Advance ID'), (error) => error instanceof FakeHttpsError && error.code === 'invalid-argument' && /is invalid/.test(error.message), 'financeKey still refuses a key the ledger cannot hold');
}

console.log('supplier advance posting guard: proof rule, apply/return/void credit paths, void linking and the retired register route verified');
