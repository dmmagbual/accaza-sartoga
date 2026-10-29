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

// 16 Oct 2026 (owner decision): a completed-sale void is the one reversal that does NOT take a
// chosen date - it always posts on the original sale date so Finance Books follows Admin net sales.
// The dialog shows that date locked, and the server rejects any other date.
assert.match(salesUi, /name:'accountingDate',label:'Posting date \(original sale date\)',type:'date',required:true,min:postingDate,max:postingDate,value:postingDate[\s\S]*title:'Void completed sale'/,
  'Completed-sale voids must show the posting date locked to the original sale date.');
assert.match(salesServer, /originalDate=financeDateFromTimestamp\(o\.completedAt\|\|o\.receivedAt\|\|o\.timestamp\|\|now\),voidDate=originalDate/,
  'The sale-void server must post the void on the original sale date.');
assert.match(salesServer, /financeDate\(data\.accountingDate\)!==originalDate\)throw new HttpsError\("invalid-argument"/,
  'The sale-void server must reject any other posting date.');
assert.match(payoutUi, /title:'Reverse settled '[\s\S]*name:'accountingDate',label:'Posting date',type:'date'/,
  'Platform payout reversals must ask for the posting date.');
assert.match(payoutUi, /function voidPayoutOrder\(orderId,o\)[\s\S]*total=Math\.round\(\(Number\(o\.total\)\|\|0\)\*100\)\/100,refunded=Math\.round\(\(Number\(o\.refundAmount\)\|\|0\)\*100\)\/100,amount=Math\.round\(Math\.max\(0,total-refunded\)\*100\)\/100[\s\S]*name:'accountingDate',label:'Posting date \(original sale date\)',type:'date',required:true,min:postingDate,max:postingDate,value:postingDate/,
  'Platform order voids must show the original sale date and bind the remaining reversible order amount, not the payout gross display value.');
assert.match(payoutUi, /saleTs=Number\(o\.completedAt\|\|o\.receivedAt\|\|o\.timestamp\)\|\|Date\.now\(\),postingDate=window\.AccazaDate\.key\(saleTs\)/,
  'Platform order voids must derive the locked posting date from the same authoritative timestamp precedence as the server.');
assert.match(payoutUi, /if\(!o\)\{alert\('The order details changed[\s\S]*return;\}[\s\S]*if\(!\(amount>0\)\)\{alert\('This order has no remaining amount to void[\s\S]*return;\}[\s\S]*managerApproval\('void'/,
  'Platform order voids must fail closed before approval when the loaded order is missing or has no reversible balance.');
assert.match(payoutUi, /managerApproval\('void',orderId,amount,v\.reason,\{change:change\}\)[\s\S]*processOrderAdjustment\(\{action:'void',orderId:orderId,accountingDate:v\.accountingDate/,
  'Platform order void approval and execution must submit the same posting date, amount and reason.');
assert.match(payoutUi, /voidPayoutOrder\(id,entry&&entry\.o\)/,
  'Platform order voids must pass the authoritative loaded order snapshot into the approval dialog.');
assert.doesNotMatch(payoutUi, /managerApproval\('void',orderId,Number\(gross\)/,
  'Platform order voids must not approve against a gross display value that can differ from the remaining reversible order amount.');
assert.match(payoutServer, /reversalDate=financeDate\(data\.accountingDate\)/,
  'The payout-reversal server must require and validate the selected date.');
assert.match(booksShell, /Reverse journal[\s\S]*id="rev_date" type="date"/,
  'Manual journal reversals and voids must ask for the posting date instead of silently using today.');
assert.match(payablesUi, /title:'Reverse payable'[\s\S]*name:'accountingDate',label:'Posting date',type:'date'/,
  'Admin payable reversals must ask for the posting date.');

console.log('PASS: Cash Payment, Purchase, completed-sale and Platform Payout void/reversal flows require the correct server-bound accounting date.');
