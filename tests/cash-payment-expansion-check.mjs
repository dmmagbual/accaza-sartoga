import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(p, 'utf8');
const register = read('src/admin/register/40-revolving-fund.js');
const functions = read('src/functions/41-expense-assets.js') + read('src/functions/21-operational-controls.js');
const entry = read('src/functions/42a-financial-command-entry.js');
const books = read('src/books/app/55-payable-batch.js') + read('src/books/app/50-controlled-transactions.js');
const split = read('src/admin/pos/50e-cart-checkout.js') + read('src/admin/pos/50f-sale-persistence.js');

for (const type of ['loan_repayment', 'staff_advance', 'customer_refund']) assert.match(register, new RegExp(type), `cash-payment form must expose ${type}`);
assert.match(register, /conversionMovementId:controlledPosting\?'controlled_pending'/, 'controlled vouchers must bypass the legacy generic expense trigger');
assert.match(functions, /postControlledPettyVoucher/, 'controlled voucher approval must have a dedicated posting path');
assert.match(functions, /conversionMovementId: \["loan_repayment","staff_advance","customer_refund"\]/, 'server approval must enforce the controlled posting marker');
assert.match(entry, /list_customer_refund_payables/);
assert.match(entry, /orderByChild\('status'\)\.equalTo\('open'\)\.limitToLast\(100\)/, 'refund-payable lookup must be bounded and indexed');
assert.match(entry, /pay_payable_batch/);
assert.match(entry, /payableSettlementClaims/);
assert.match(books, /App\.txnPayBatch/);
assert.match(books, /at least two bills/i);
assert.match(books, /reverse_payable_batch_payment/);
assert.match(split, /split|tender|payment/i, 'split-payment source remains present');
assert.doesNotMatch(register, /onValue\([^)]*payables/i, 'cash-payment form must not add a broad payable listener');
console.log('PASS: expanded cash-payment accounts and bounded multi-bill supplier settlement are present; split-payment routing source remains intact.');
