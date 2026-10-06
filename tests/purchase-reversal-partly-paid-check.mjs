/* AP Integrity Remediation Plan, step 0.1 (AP-03) — regression guard.

   The defect: reversing or amending a purchase whose supplier bill was PARTLY paid passed the
   guard (it only refused status "paid"), then debited Accounts Payable for the full invoice
   total. The paid part was left as an orphaned debit and could be paid again after an Amend.
   The same applied to an owner/partner reimbursement already partly settled.

   This locks in: (1) the shared settled-amount rule, (2) the server refusal BEFORE any stock
   moves, (3) the close exception for a bill outside 0..amount, and (4) the Finance Books flag
   for negative bills and bills reversed after payment. */
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
const root = path.join(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };

/* ---------- 1. shared rule: what counts as money already settled on a bill ---------- */
const Financial = require(path.join(root, 'functions/lib/financial.js'));
const has = Financial.payableHasSettlement, settled = Financial.payableSettledAmount;
check(has({status: 'open', amount: 1000, remainingAmount: 1000, paidAmount: 0}) === false, 'An untouched open bill must not count as settled.');
check(has({status: 'open', amount: 1000, remainingAmount: 600, paidAmount: 400}) === true, 'A partly paid bill must count as settled.');
check(settled({status: 'open', amount: 1000, remainingAmount: 600, paidAmount: 400}) === 400, 'The settled amount of a 400 payment on 1000 must be 400.');
check(has({status: 'open', amount: 1000, remainingAmount: 600}) === true, 'A legacy bill with only a reduced remainingAmount must count as settled.');
check(has({status: 'open', amount: 1000, remainingAmount: 1000, settlements: {p1: {amount: 250}}}) === true, 'A live settlement record alone must count as settled.');
check(has({status: 'open', amount: 1000, remainingAmount: 1000, paidAmount: 0, settlements: {p1: {amount: 400, status: 'reversed'}}}) === false, 'A bill whose payment was reversed must be reversible again.');
check(has({status: 'paid', amount: 1000, remainingAmount: 0, paidAmount: 1000}) === true, 'A fully paid bill must count as settled.');
check(has({status: 'open', amount: 300, remainingAmount: 0, paidAmount: 300, settlements: {c: {amount: 300}}}) === true, 'A reimbursement settled to owner capital must count as settled.');
check(has({status: 'reversed', amount: 1000, remainingAmount: 0, paidAmount: 0}) === false, 'A bill reversed whole and never paid must not count as settled.');
check(has(null) === false && settled(undefined) === 0, 'A missing bill must not count as settled.');
check(has({status: 'open', amount: 1000, remainingAmount: 999.995}) === false, 'Sub-centavo rounding must not block a reversal.');

/* ---------- 2. server: refuse before any stock moves; duplicate clean-up unaffected ---------- */
const src = read('src/functions/43b-purchase-corrections.js');
const guardAt = src.indexOf('Financial.payableHasSettlement(payable)');
const reimbursementAt = src.indexOf('Financial.payableHasSettlement(earlyReimbursement)');
const stockAt = src.indexOf('await applyInventoryMovement(db,{movementId:`purchase_reverse_');
check(guardAt > 0, 'Purchase reversal must refuse a partly paid supplier bill.');
check(reimbursementAt > 0, 'Purchase reversal must refuse a partly settled owner reimbursement.');
check(stockAt > 0 && guardAt < stockAt && reimbursementAt < stockAt, 'Both refusals must run before any stock is reversed.');
check(/!duplicateCleanup&&payable&&\(invoice\.payMode==="account"\|\|invoice\.payMode==="pending"\)&&Financial\.payableHasSettlement\(payable\)/.test(src), 'The bill guard must cover on-account and pending bills and leave duplicate clean-up (which relinks the bill) alone.');
check(src.includes('Finance Books → Payables → Show settled → Reverse payment') && src.includes('Undeposited Collection cannot be reversed there yet'), 'The refusal must point to where the payment is reversed and say when it cannot be.');
const bundle = read('functions/index.js');
check(bundle.includes('Financial.payableHasSettlement(payable)') && bundle.includes('Financial.payableHasSettlement(earlyReimbursement)'), 'The deployed functions bundle must contain both refusals (run npm run build:artifacts).');

/* ---------- 3. close: a bill outside 0..amount is an investigation, never netted ---------- */
const Close = require(path.join(root, 'functions/lib/financial-close.js'));
const day = '2026-10-06', base = {closeType: 'DAILY_CLOSE', businessDate: day, cutoff: Date.parse(`${day}T23:59:59+08:00`), orders: {}, archivedOrders: {}, shifts: {}, financialMovements: {}, inventoryMovements: {}, purchaseInvoices: {}, booksJournal: {}, cashCustody: {}, receivables: {}, payables: {}, pettyCashVouchers: {}, platformPayouts: {}};
const negative = structuredClone(base);
negative.payables.bad = {type: 'inventory', status: 'open', amount: 1000, remainingAmount: -400, supplierId: 'sup_x', party: 'Supplier X'};
negative.payables.good = {type: 'inventory', status: 'open', amount: 500, remainingAmount: 200, supplierId: 'sup_x', party: 'Supplier X'};
const flagged = Close.buildClose(negative).exceptions.filter((x) => x.control === 'payable_balance_out_of_range');
check(flagged.length === 1 && flagged[0].sourceId === 'bad', 'Exactly the negative bill must raise payable_balance_out_of_range.');
check(flagged[0] && flagged[0].category === 'INVESTIGATION_REQUIRED' && flagged[0].automaticRepairSafe === false, 'A negative bill must need investigation and never be auto-repaired.');
const clean = structuredClone(base);
clean.payables.good = {type: 'inventory', status: 'open', amount: 500, remainingAmount: 200};
check(!Close.buildClose(clean).exceptions.some((x) => x.control === 'payable_balance_out_of_range'), 'A normal partly paid bill must not raise the exception.');

/* ---------- 4. Finance Books: negative bills and bills reversed after payment are listed ---------- */
const books = read('src/books/app/40-subledgers.js');
const fnSource = (books.match(/function payableReviewIssues\(map\)\{.*\}\n/) || [''])[0];
check(fnSource, 'Books must define payableReviewIssues.');
const issues = fnSource ? new Function(`${fnSource};return payableReviewIssues;`)() : () => [];
const listed = issues({
  neg: {type: 'inventory', status: 'open', amount: 1000, remainingAmount: -400},
  revPaid: {type: 'inventory', status: 'reversed', amount: 1000, remainingAmount: 0, paidAmount: 400, reversalMovementId: 'purchase_ap_reversal_inv1'},
  ownerRevPaid: {type: 'owner reimbursement', status: 'reversed', amount: 300, remainingAmount: 0, paidAmount: 100, reversalMovementId: 'purchase_owner_reversal_inv2'},
  standaloneRemainder: {type: 'rent', status: 'reversed', amount: 1000, remainingAmount: 0, paidAmount: 400, settlements: {p: {amount: 400}}, reversalMovementId: 'cmd_reverse_rent'},
  revClean: {type: 'inventory', status: 'reversed', amount: 1000, remainingAmount: 0, paidAmount: 0, settlements: {p: {amount: 400, status: 'reversed'}}},
  ok: {type: 'inventory', status: 'open', amount: 1000, remainingAmount: 600, paidAmount: 400},
  refund: {type: 'customer_change_refund', status: 'open', amount: 50, remainingAmount: -5},
}).map((d) => d.id).sort();
check(JSON.stringify(listed) === JSON.stringify(['neg', 'ownerRevPaid', 'revPaid']), `Books must list the negative bill and bills reversed through their purchase after payment, but not a standalone bill reversed for its unpaid remainder (got ${JSON.stringify(listed)}).`);
check((books.match(/'\+review\+/g) || []).length === 2, 'The review banner must show on the Payables page whether or not open bills exist.');
check(read('assets/js/books/app.js').includes('function payableReviewIssues('), 'The Books runtime bundle must contain the review list (run npm run build:artifacts).');

if (failures.length) { console.error(`FAIL: ${failures.length} partly-paid purchase reversal check(s)\n- ${failures.join('\n- ')}`); process.exit(1); }
console.log('PASS: partly paid purchases cannot be reversed or amended, and negative or paid-then-reversed bills are flagged in the close and in Finance Books.');
