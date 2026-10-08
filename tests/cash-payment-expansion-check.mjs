import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(p, 'utf8');
const register = read('src/admin/register/40-revolving-fund.js');
const registerBootstrap = read('src/admin/register/00-bootstrap-payment-controls.js');
const subscriptionHub = read('assets/js/admin/realtime-hub.mjs');
const functions = read('src/functions/41-expense-assets.js') + read('src/functions/21-operational-controls.js') + read('src/functions/21-staff-advance-liquidation.js') + read('src/functions/42c-financial-command-controls.js');
const entry = read('src/functions/42a-financial-command-entry.js');
const books = read('src/books/app/55-payable-batch.js') + read('src/books/app/50-controlled-transactions.js');
const split = read('src/admin/pos/50e-cart-checkout.js') + read('src/admin/pos/50f-sale-persistence.js');

for (const type of ['loan_repayment', 'staff_advance', 'customer_refund']) assert.match(register, new RegExp(type), `cash-payment form must expose ${type}`);
for (const marker of ['Adopt journal-created staff advance','function adoptJournalStaffAdvance','adopt_journal_staff_advance','It does not pay cash or change the original journal again']) assert.match(register, new RegExp(marker), `Cash Payments must support adopting eligible journal-created staff advances: ${marker}`);
assert.match(registerBootstrap, /a\.subscribe\('booksChart',function\(s\)\{booksChartMap=s\.val\(\)\|\|\{\};if\(isTab\('petty'\)\)renderPetty\(\);\}\);/, 'Cash Payments must refresh its controlled loan and interest selectors when the Finance Books chart arrives');
assert.match(subscriptionHub, /booksChart:\['discrepancy','purchases','petty'\]/, 'Cash Payments must activate the Finance Books chart subscription before rendering loan and interest selectors');
assert.match(register, /conversionMovementId:controlledPosting\?'controlled_pending'/, 'controlled vouchers must bypass the legacy generic expense trigger');
assert.match(functions, /postControlledPettyVoucher/, 'controlled voucher approval must have a dedicated posting path');
assert.match(functions, /adopt_journal_staff_advance/, 'journal-created staff-advance adoption must be server controlled');
assert.match(functions, /conversionMovementId: \["loan_repayment","staff_advance","customer_refund"\]/, 'server approval must enforce the controlled posting marker');
assert.match(entry, /list_customer_refund_payables/);
assert.match(entry, /orderByChild\('status'\)\.equalTo\('open'\)\.limitToLast\(100\)/, 'refund-payable lookup must be bounded and indexed');
assert.match(entry, /pay_payable_batch/);
assert.match(entry, /claimPayables\(db,unique\.map\(\(row\)=>row\.documentId\),commandId,actor,apClaimSets\)/, 'batch payments must claim every bill before reading it');
assert.match(books, /App\.txnPayBatch/);
assert.match(books, /Pay supplier bills/, 'the action label must cover one or multiple bills');
assert.match(books, /Choose one or more bills/i, 'the payment form must allow a single selected bill');
assert.match(books, /allocations\.length<1/, 'the UI must reject an empty selection');
assert.match(entry, /normalizePayableBatchAllocations\(data\.allocations\)/, 'the server must normalize and validate single or multiple bill allocations');
assert.match(books, /reverse_payable_batch_payment/);
assert.match(split, /split|tender|payment/i, 'split-payment source remains present');
assert.doesNotMatch(register, /onValue\([^)]*payables/i, 'cash-payment form must not add a broad payable listener');

class AllocationError extends Error { constructor(code, message) { super(message); this.code = code; } }
const helper = entry.match(/function normalizePayableBatchAllocations\(raw\) \{[\s\S]*?\n\}/);
assert.ok(helper, 'the server must expose testable allocation normalization');
const normalize = new Function('financeKey', 'Financial', 'HttpsError', `${helper[0]}\nreturn normalizePayableBatchAllocations;`)(
  (value, label) => { const id = String(value || '').trim(); if (!id || /[.#$\/\[\]]/.test(id)) throw new AllocationError('invalid-argument', `${label} is invalid.`); return id; },
  {money: value => Math.round((Number(value) || 0) * 100) / 100},
  AllocationError
);
assert.deepEqual(normalize([{documentId:'gp-bill',amount:9360}]), [{documentId:'gp-bill',amount:9360}], 'one bill must be payable');
assert.deepEqual(normalize([{documentId:'gp-bill',amount:1000}]), [{documentId:'gp-bill',amount:1000}], 'a partial single-bill amount must stay partial');
assert.equal(normalize([{documentId:'bill-a',amount:10},{documentId:'bill-b',amount:20}]).length, 2, 'multiple bill allocation must remain supported');
assert.throws(() => normalize([]), error => error.code === 'invalid-argument', 'an empty selection must be rejected');
assert.throws(() => normalize([{documentId:'gp-bill',amount:0}]), error => error.code === 'invalid-argument', 'zero allocations must be rejected');
assert.throws(() => normalize([{documentId:'gp-bill',amount:10},{documentId:'gp-bill',amount:10}]), error => error.code === 'invalid-argument', 'duplicate bill IDs must be rejected');
assert.throws(() => normalize([{documentId:'bad/bill',amount:10}]), error => error.code === 'invalid-argument', 'malformed bill IDs must be rejected');
assert.throws(() => normalize(Array.from({length:21}, (_,i) => ({documentId:'bill-'+i,amount:1}))), error => error.code === 'invalid-argument', 'the existing 20-bill allocation cap must remain enforced');
console.log('PASS: expanded cash-payment accounts and bounded multi-bill supplier settlement are present; split-payment routing source remains intact.');
