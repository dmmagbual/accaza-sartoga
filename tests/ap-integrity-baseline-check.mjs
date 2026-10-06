/* AP Integrity Remediation Plan, step 0.3 — read-only AP baseline report.

   Locks in what each finding means (so the report never cries wolf on correct records and
   never hides a real one), that the callable is Super-Admin only and read-only apart from one
   audit row, and that Finance Books can run it. */
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
const root = path.join(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };
const ids = (section) => section.items.map((row) => row.payableId || row.invoiceId || row.key).sort();

const Ap = require(path.join(root, 'functions/lib/ap-integrity.js'));

const payables = {
  ok_open: {type: 'inventory', status: 'open', amount: 1000, remainingAmount: 600, paidAmount: 400, supplierId: 's1', ref: 'A-1', purchaseInvoiceId: 'inv_ok'},
  over: {type: 'inventory', status: 'paid', amount: 1000, remainingAmount: 0, paidAmount: 1400, supplierId: 's1', ref: 'A-2', purchaseInvoiceId: 'inv_over'},
  negative: {type: 'rent', status: 'open', amount: 500, remainingAmount: -50, paidAmount: 550, supplierId: 's2', ref: 'R-9'},
  rev_purchase_paid: {type: 'inventory', status: 'reversed', amount: 1000, remainingAmount: 0, paidAmount: 400, reversalMovementId: 'purchase_ap_reversal_inv_rev', supplierId: 's1', ref: 'A-3'},
  rev_own_remainder: {type: 'rent', status: 'reversed', amount: 1000, remainingAmount: 0, paidAmount: 400, settlements: {p: {amount: 400}}, reversalMovementId: 'cmd_x', supplierId: 's2', ref: 'R-1'},
  rev_payment_undone: {type: 'inventory', status: 'reversed', amount: 800, remainingAmount: 0, paidAmount: 0, settlements: {p: {amount: 800, status: 'reversed'}}, reversalMovementId: 'purchase_ap_reversal_inv_x', supplierId: 's1', ref: 'A-4'},
  refund: {type: 'customer_change_refund', status: 'open', amount: 20, remainingAmount: -5},
  manual_dup: {type: 'utilities', status: 'open', amount: 300, remainingAmount: 300, supplierId: 's1', ref: 'inv 001'},
  stale_mirror: {type: 'inventory', status: 'open', amount: 700, remainingAmount: 400, paidAmount: 300, supplierId: 's3', ref: 'M-1', purchaseInvoiceId: 'inv_mirror'},
};
const purchaseMovements = {
  mv_ok: {type: 'purchase', qty: 10, unitCost: 100},
  mv_gap: {type: 'purchase', qty: 4, unitCost: 50},
  mv_vat: {type: 'purchase', qty: 2, unitCost: 250},
};
const purchaseInvoices = {
  inv_ok: {supplierId: 's1', supplier: 'Global', ref: 'A-1', payMode: 'account', payableId: 'ok_open', total: 1000, movementIds: ['mv_ok'], lines: [], paidAmount: 400, remainingAmount: 600, paymentStatus: 'partially_paid'},
  inv_nobill: {supplierId: 's1', supplier: 'Global', ref: 'A-5', payMode: 'account', payableId: '', total: 250, movementIds: [], lines: [{lineType: 'expense', total: 250}]},
  inv_missinglink: {supplierId: 's1', supplier: 'Global', ref: 'A-6', payMode: 'pending', payableId: 'gone', total: 100, movementIds: [], lines: [{lineType: 'expense', total: 100}]},
  inv_gap: {supplierId: 's2', supplier: 'Beans', ref: 'B-1', payMode: 'paid', total: 260, movementIds: ['mv_gap'], lines: [{lineType: 'expense', total: 50}]},
  inv_vat: {supplierId: 's2', supplier: 'Beans', ref: 'B-2', payMode: 'paid', total: 560, inputVat: 60, movementIds: ['mv_vat'], lines: []},
  inv_missingmove: {supplierId: 's2', supplier: 'Beans', ref: 'B-3', payMode: 'paid', total: 0, movementIds: ['mv_absent'], lines: []},
  inv_dup: {supplierId: 's1', supplier: 'Global', ref: 'INV-001', payMode: 'paid', total: 300, movementIds: [], lines: [{lineType: 'expense', total: 300}]},
  inv_reversed_dup: {supplierId: 's1', supplier: 'Global', ref: 'INV-001', payMode: 'paid', total: 300, reversed: true},
  inv_pending_ref: {supplierId: 's1', supplier: 'Global', ref: 'PENDING-x', payMode: 'paid', total: 10, movementIds: [], lines: [{lineType: 'expense', total: 10}]},
  inv_pending_ref2: {supplierId: 's1', supplier: 'Global', ref: 'PENDING-x', payMode: 'paid', total: 10, movementIds: [], lines: [{lineType: 'expense', total: 10}]},
  inv_mirror: {supplierId: 's3', supplier: 'Milk', ref: 'M-1', payMode: 'account', payableId: 'stale_mirror', total: 700, movementIds: [], lines: [{lineType: 'expense', total: 700}]},
  inv_over: {supplierId: 's1', supplier: 'Global', ref: 'A-2', payMode: 'account', payableId: 'over', total: 1000, movementIds: [], lines: [{lineType: 'expense', total: 1000}], paidAmount: 1400, paymentStatus: 'paid', remainingAmount: 0},
};
const custodyRows = {c1: {remaining: 300}, c2: {remaining: 120.5}, closed: {remaining: 0}};
const report = Ap.buildReport({payables, purchaseInvoices, purchaseMovements, custodyRows, undepositedGl: 500, generatedAt: 1});

check(JSON.stringify(ids(report.overpaidBills)) === JSON.stringify(['negative', 'over']), `Overpaid/negative bills must be exactly the over-paid and negative bills (got ${JSON.stringify(ids(report.overpaidBills))}).`);
check(report.overpaidBills.items.find((r) => r.payableId === 'over').excess === 400, 'The excess on a 1,400 payment of a 1,000 bill must be 400.');
check(JSON.stringify(ids(report.reversedAfterPayment)) === JSON.stringify(['rev_purchase_paid']), 'Only a bill cleared by its purchase reversal after payment may be listed; a bill reversed for its own remainder, or whose payment was undone first, is correct.');
check(JSON.stringify(report.purchasesWithoutBill.items.map((row) => row.invoiceId).sort()) === JSON.stringify(['inv_missinglink', 'inv_nobill']), 'On-account/pending purchases with no live bill must be listed, and only those.');
check(JSON.stringify(ids(report.purchaseValueGaps)) === JSON.stringify(['inv_gap', 'inv_missingmove']), `Value gaps must flag a total that differs from posted stock + other lines + VAT and a missing movement, but not a correct VAT invoice (got ${JSON.stringify(ids(report.purchaseValueGaps))}).`);
check(report.purchaseValueGaps.items.find((r) => r.invoiceId === 'inv_gap').gap === 10, 'The gap must be total minus (stock value + other lines + VAT).');
check(report.custody.custody === 420.5 && report.custody.gl === 500 && report.custody.difference === 79.5 && report.custody.reconciled === false, 'Custody drift must compare open custody with GL 1030.');
check(Ap.buildReport({custodyRows: {a: {remaining: 10}}, undepositedGl: 10}).custody.reconciled === true, 'Matching custody and GL must reconcile.');
check(report.duplicateRefs.total === 1 && report.duplicateRefs.items[0].entries.map((e) => e.id).sort().join() === 'inv_dup,manual_dup', 'A purchase and a separate bill with the same supplier reference (any spacing/case) must be one duplicate group; reversed purchases and PENDING placeholders are ignored.');
check(!report.duplicateRefs.items.some((g) => g.entries.some((e) => e.id === 'ok_open')), 'A purchase and its own linked bill must never count as a duplicate.');
const mirror = report.paymentMirrorDrift.items.map((r) => r.invoiceId).sort();
check(JSON.stringify(mirror) === JSON.stringify(['inv_mirror']), `Only a purchase whose payment status disagrees with its bill may be listed (got ${JSON.stringify(mirror)}).`);
check(report.counts.custodyDrift === 1 && report.issues === 2 + 1 + 2 + 2 + 1 + 1 + 1, 'Counts and the issue total must add up.');
check(Ap.buildReport({}).issues === 0, 'An empty database must report no issues.');

const big = {};
for (let i = 0; i < Ap.LIST_LIMIT + 5; i += 1) big[`n${i}`] = {type: 'rent', status: 'open', amount: 10, remainingAmount: -1};
const capped = Ap.buildReport({payables: big}).overpaidBills;
check(capped.items.length === Ap.LIST_LIMIT && capped.total === Ap.LIST_LIMIT + 5 && capped.truncated === true, 'Long lists must be capped and say they were truncated.');

const fn = read('src/functions/44b-ap-integrity.js');
check(/actor\.role !== "superadmin"\) throw new HttpsError\("permission-denied"/.test(fn), 'The AP integrity check must be Super Admin only.');
const writes = fn.match(/\.(set|update|push|transaction|remove)\(/g) || [];
check(writes.length === 1 && fn.includes('/operationalAudit/${now}_ap_integrity_baseline`).set('), 'The AP integrity check must write nothing except its one audit row.');
check(read('src/functions/00-bootstrap-notifications.js').includes('const ApIntegrity = require("./lib/ap-integrity");'), 'The functions bundle must load the AP integrity library.');
check(read('functions/index.js').includes('exports.apIntegrityBaseline'), 'The deployed functions bundle must export apIntegrityBaseline (run npm run build:artifacts).');
const manifest = JSON.parse(read('release-manifest.json'));
check(JSON.stringify(manifest).includes('functions/lib/ap-integrity.js') && manifest.requiredFunctionExports.includes('apIntegrityBaseline'), 'The release manifest must ship the library and require the export.');
check(read('assets/js/books/live-pos.mjs').includes('httpsCallable(fns,"apIntegrityBaseline")'), 'Finance Books must be able to call the AP integrity check.');
check(read('src/books/app/40-subledgers.js').includes('App.runApIntegrityCheck()') && read('assets/js/books/app.js').includes('App.runApIntegrityCheck=function'), 'Finance Books Payables must offer the AP integrity check (run npm run build:artifacts).');

/* Review fixes: a purchase pointing at a REVERSED bill has no liability; duplicates are found across
   supplier ID and name; a bill linked one way to its own purchase is not a duplicate; negative custody
   rows count; purchases with no stock movement links are counted apart from value gaps. */
const fixes = Ap.buildReport({
  payables: {
    revBill: {type: 'inventory', status: 'reversed', amount: 500, remainingAmount: 0, reversalMovementId: 'cmd_x'},
    legacyBill: {type: 'inventory', status: 'open', amount: 300, remainingAmount: 300, supplierId: '', party: 'Global ', ref: 'Z-9'},
    oneWay: {type: 'inventory', status: 'open', amount: 200, remainingAmount: 200, supplierId: 's9', party: 'Nine', ref: 'N-1'},
  },
  purchaseInvoices: {
    livePurchase: {supplierId: 's1', supplier: 'Global', ref: 'z 9', payMode: 'account', payableId: 'revBill', total: 500, movementIds: [], lines: [{lineType: 'expense', total: 500}], paidAmount: 0, paymentStatus: 'unpaid'},
    linkedPurchase: {supplierId: 's9', supplier: 'Nine', ref: 'N-1', payMode: 'account', payableId: 'oneWay', total: 200, movementIds: [], lines: [{lineType: 'expense', total: 200}]},
    legacyStock: {supplierId: 's5', supplier: 'Five', ref: 'F-1', payMode: 'paid', total: 80, movementIds: [], lines: [{lineType: 'inventory', total: 80}]},
  },
  purchaseMovements: {}, custodyRows: {c1: {remaining: 100}, c2: {remaining: -20}}, undepositedGl: 80, generatedAt: 1,
});
check(fixes.purchasesWithoutBill.items.some((row) => row.invoiceId === 'livePurchase' && row.reason === 'linked bill reversed'), 'A live purchase whose bill was reversed has no liability and must be listed.');
check(!fixes.paymentMirrorDrift.items.some((row) => row.invoiceId === 'livePurchase'), 'A reversed bill must not drive a payment-status comparison.');
const dupSig = fixes.duplicateRefs.items.map((group) => group.entries.map((entry) => entry.id).sort().join('+'));
check(JSON.stringify(dupSig) === JSON.stringify(['legacyBill+livePurchase']), `Duplicates must match across supplier ID and name, once, and never pair a bill with its own purchase (got ${JSON.stringify(dupSig)}).`);
check(fixes.custody.negativeRows === 1 && fixes.custody.custody === 80 && fixes.custody.reconciled === false, 'A custody row below zero must count and be flagged even when the totals agree.');
check(fixes.counts.purchasesWithoutStockLinks === 1 && fixes.counts.purchaseValueGaps === 0 && fixes.totals.purchaseValueGapNet === 0, 'Purchases with no stock movement links must be counted apart from value gaps.');

if (failures.length) { console.error(`FAIL: ${failures.length} AP integrity baseline check(s)\n- ${failures.join('\n- ')}`); process.exit(1); }
console.log('PASS: the read-only AP integrity baseline flags over-paid and negative bills, bills cleared by a purchase reversal after payment, purchases without a bill or with a value gap, custody vs 1030 drift, duplicate supplier references and payment-status drift — Super Admin only, one audit row, nothing else written.');
