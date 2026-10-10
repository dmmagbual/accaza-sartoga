import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const vouchers = read('src/admin/register/40-revolving-fund.js');
const purchases = read('src/admin/pos/20-purchasing.js');
const voucherCommand = read('src/functions/21-staff-advance-liquidation.js');
const voucherPosting = read('src/functions/41-expense-assets.js');
const approvals = read('src/functions/20-portal-operations.js');
const purchaseCorrection = read('src/functions/43b-purchase-corrections.js');
const salesUi = read('src/admin/register/99-voids-refunds.js');
const salesServer = read('src/functions/43g-order-adjustments.js');
const payoutUi = read('src/admin/analytics/40-platform-payout-reconciliation.js');
const payoutServer = read('src/functions/43e-platform-reversal.js');
const booksShell = read('src/books/app/10-application-shell.js');
const payablesUi = read('src/admin/finance/40-payables-api.js');

assert.match(vouchers, /title:'Void cash-payment voucher'[\s\S]*name:'accountingDate',label:'Posting date',type:'date'/,
  'Cash Payment Void must ask for the reversal posting date.');
assert.match(vouchers, /managePettyVoucher\(\{action:'void',voucherId:id,accountingDate:x\.accountingDate/,
  'The selected Cash Payment reversal date must reach the server command.');
assert.match(vouchers, /managerApproval\('void_petty_voucher'[\s\S]*\{change:change\}/,
  'The privileged approval must bind the exact Cash Payment reversal date.');
assert.match(vouchers, /data-pvrd=/,
  'A voided Cash Payment must expose the controlled reversal-date repair action.');

assert.match(approvals, /bindsReversalDate = \["void_petty_voucher","reverse_purchase","void","reverse_platform_payout"\]/,
  'Void approval must be cryptographically bound to the selected accounting date.');
assert.match(voucherCommand, /reversalAccountingDate/,
  'The Cash Payment source record must retain its explicit reversal accounting date.');
assert.match(voucherCommand, /action === "correct_reversal_date"/,
  'Cash Payments must provide a controlled repair for an already-misdated reversal.');
assert.match(voucherPosting, /function cashVoucherReversalOccurredAt\(/,
  'Every Cash Payment reversal posting path must use one accounting-date authority.');
assert.doesNotMatch(voucherPosting, /occurredAt=isVoid\?Number\(after\.voidedAt\|\|now\)/,
  'Controlled Cash Payment reversals must not use the processing timestamp as their accounting date.');
assert.doesNotMatch(voucherPosting, /occurredAt=Number\(after\.voidedAt \|\| Date\.now\(\)\)/,
  'Trigger-posted Cash Payment reversals must not use the processing timestamp as their accounting date.');

assert.match(purchases, /title:'Reverse a purchase'[\s\S]*name:'accountingDate',label:'Posting date',type:'date'/,
  'Purchase reversal must ask for the reversal posting date.');
assert.match(purchases, /managePurchaseCorrection\(\{action:'reverse',invoiceId:inv\.id,accountingDate:v\.accountingDate/,
  'The selected Purchase reversal date must reach the server command.');
assert.match(purchaseCorrection, /reversalDate=financeDate\(data\.accountingDate\|\|invoice\.date\)/,
  'The Purchase server authority must use the explicitly selected accounting date.');

assert.match(salesUi, /name:'accountingDate',label:'Posting date',type:'date'[\s\S]*title:'Void completed sale'/,
  'Completed-sale voids must ask for the posting date.');
assert.match(salesServer, /voidDate=financeDate\(data\.accountingDate\)/,
  'The sale-void server must require and validate the selected date.');
assert.match(payoutUi, /title:'Reverse settled '[\s\S]*name:'accountingDate',label:'Posting date',type:'date'/,
  'Platform payout reversals must ask for the posting date.');
assert.match(payoutServer, /reversalDate=financeDate\(data\.accountingDate\)/,
  'The payout-reversal server must require and validate the selected date.');
assert.match(booksShell, /Reverse journal[\s\S]*id="rev_date" type="date"/,
  'Manual journal reversals and voids must ask for the posting date instead of silently using today.');
assert.match(payablesUi, /title:'Reverse payable'[\s\S]*name:'accountingDate',label:'Posting date',type:'date'/,
  'Admin payable reversals must ask for the posting date.');

console.log('PASS: Cash Payment and Purchase void/reversal flows require one explicit, server-validated accounting date, and Cash Payments provide a controlled historical date repair.');
