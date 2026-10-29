// A sale is a sale (Danilo, 29 Oct 2026). Every POS sale posts to Finance Books when captured; an
// unverified e-payment waits in 1060 Payments Awaiting Verification until a manager verifies it
// (money to the bank on the statement date) or records it as not received (the unpaid share of
// the sale is reversed and its cost moves to 6120 Unpaid Sales Loss). Admin counts the same sales.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {createFakeDatabase} from './helpers/fake-rtdb.mjs';
import {loadFunctions} from './helpers/functions-sandbox.mjs';

const require = createRequire(import.meta.url);
const Financial = require('../functions/lib/financial.js');
const realWriteSafety = require('../functions/lib/write-safety.js');
const writeSafety = {...realWriteSafety, safeAtomicUpdate: (database, writes) => realWriteSafety.safeAtomicUpdate(database, structuredClone(writes))};
const NOW = Date.parse('2026-10-29T15:00:00+08:00'), SALE_AT = Date.parse('2026-10-27T10:00:00+08:00');
const sale = (id, extra = {}) => Object.assign({id, source: 'pos', channel: 'instore', status: 'Completed', paymentStatus: 'pending', shiftId: 'SH-A', staff: 'Rya', syncedByUid: 'till_uid', payment: 'Bank Transfer', payments: [{method: 'Bank Transfer', amount: 560, ref: 'BT-1'}], subtotal: 560, total: 560, completedAt: SALE_AT, timestamp: SALE_AT, cogsSnapshot: 200, cogsCategorySnapshot: {beverage: 200}, inventoryDeducted: true}, extra);
const approval = (action, sourceId, amount, by = 'mgr2_uid', role = 'manager') => ({action, sourceId, amount, approvedBy: by, approvedRole: role, approvedEmail: `${by}@example.test`, expiresAt: NOW + 600000});
const db = createFakeDatabase({
  admins: {mgr_uid: 'manager', mgr2_uid: 'manager', sa_uid: 'superadmin', till_uid: 'manager'},
  cfAccounts: {bdo: {name: 'BDO', feedMethods: ['Bank Transfer', 'GCash']}},
  shifts: {'SH-A': {status: 'closed', accountUid: 'till_uid'}},
  shiftCrews: {'SH-A': {crew_uid: {staff: 'Ana'}}},
  accountingPeriods: {'2026-08': {status: 'closed'}},
  financialApprovals: {
    AP_VAL: approval('validate_payment', 'POS-V1', 560), AP_SELF: approval('validate_payment', 'POS-S1', 560, 'crew_uid'),
    AP_SA: approval('validate_payment', 'POS-S1', 560, 'crew_uid', 'superadmin'), AP_NR: approval('payment_not_received', 'POS-N1', 560),
    AP_EARLY: approval('validate_payment', 'POS-E1', 560), AP_SPLIT: approval('payment_not_received', 'POS-SP1', 360),
  },
  orders: {'POS-V1': sale('POS-V1'), 'POS-S1': sale('POS-S1'), 'POS-N1': sale('POS-N1'), 'POS-AR1': sale('POS-AR1'), 'POS-VD1': sale('POS-VD1', {completedAt: NOW - 3600000, timestamp: NOW - 3600000}), 'POS-E1': sale('POS-E1'),
    'POS-R1': sale('POS-R1', {paymentStatus: 'manager_validated'}), 'POS-SP1': sale('POS-SP1', {payment: 'Split', payments: [{method: 'Cash', amount: 200}, {method: 'Bank Transfer', amount: 360, ref: 'BT-9'}]}),
    'POS-C1': sale('POS-C1', {payment: 'GCash', payments: [{method: 'GCash', amount: 560, ref: 'GC-1'}]})},
  archivedOrders: {
    'POS-AUG1': Object.assign(sale('POS-AUG1', {completedAt: Date.parse('2026-08-15T11:00:00+08:00'), timestamp: Date.parse('2026-08-15T11:00:00+08:00')}), {status: 'Archived', prevStatus: 'Completed', archivedAt: Date.parse('2026-08-20T00:00:00+08:00')}),
  },
});
const {exports: fx} = loadFunctions(db, {now: NOW, libOverrides: {'./lib/write-safety': writeSafety}});
const req = (data, uid = 'mgr_uid') => ({auth: {uid, token: {email: `${uid}@example.test`}}, data});
const read = async (path) => (await db.ref(path).get()).val();
const trigger = async (id) => { const order = await read(`orders/${id}`); await fx.onOrderFinancialPosting({params: {orderId: id}, data: {before: {val: () => null}, after: {val: () => order}}}); };
const lines = (mv, account) => (mv && mv.lines || []).filter((l) => l.account === account).reduce((s, l) => Financial.money(s + Number(l.debit || 0) - Number(l.credit || 0)), 0);

// 1. Captured -> posted: revenue on the sale date, the unverified payment in 1060, no bank, no Cash Flow.
for (const id of ['POS-V1', 'POS-S1', 'POS-N1', 'POS-VD1', 'POS-SP1', 'POS-C1']) await trigger(id);
const s1 = await read('financialMovements/sale_POS-V1');
assert.ok(s1, 'an unverified POS sale posts when captured');
assert.equal(lines(s1, 'asset:payment_verification'), 560, 'the unverified payment is debited to 1060');
assert.equal(lines(s1, 'asset:cash_account:bdo'), 0, 'nothing reaches the bank before verification');
assert.equal(Object.values(await read('cfLedger') || {}).length, 0, 'no Cash Flow entry before verification');
assert.equal((await read('paymentVerificationQueue/POS-V1')).amount, 560, 'the payment is queued for verification');
assert.equal(s1.occurredAt, SALE_AT, 'posted on the sale date');

// 2. Admin counts the same sale (shared sales authority), so Admin and Finance agree.
const ctx = {window: {}}; vm.createContext(ctx); vm.runInContext(fs.readFileSync('assets/js/shared/sales-authority.js', 'utf8').replace('(function(global){', '(function(global){').replace(/\}\)\(typeof window[^;]*;?\s*$/, '})(window);'), ctx);
const Sales = ctx.window.AccazaSales || ctx.AccazaSales;
assert.ok(Sales && Sales.qualifies(sale('X')), 'Admin counts an unverified completed sale');
assert.equal(Financial.recognizedSale(sale('X')), true);

// 3. Manager verification (QuickBooks bank deposit): Dr bank, Cr 1060, full amount, sale date, queue closed.
await fx.processOrderAdjustment(req({action: 'manager_validate_payment', orderId: 'POS-V1', approvalId: 'AP_VAL'}));
const pv = await read('financialMovements/payver_POS-V1');
assert.equal(lines(pv, 'asset:cash_account:bdo'), 560, 'verified money reaches the bank');
assert.equal(lines(pv, 'asset:payment_verification'), -560, '1060 is cleared');
assert.equal(pv.lines.length, 2, 'verification is one debit and one credit');
assert.equal(pv.occurredAt, SALE_AT, 'dated on the sale date');
assert.equal(await read('paymentVerificationQueue/POS-V1'), null, 'the queue row closes');
assert.equal(Object.values(await read('cfLedger') || {}).filter((r) => r.ref === 'POS-V1').length, 1, 'Cash Flow records the receipt once');
await fx.processOrderAdjustment(req({action: 'manager_validate_payment', orderId: 'POS-V1', approvalId: 'AP_VAL'})).catch(() => {});
assert.equal(lines(await read('financialMovements/payver_POS-V1'), 'asset:cash_account:bdo'), 560, 'a retry never posts the receipt twice');

// 3b. Flexible like a Xero/QuickBooks deposit: the verifier may choose the account the money landed in.
{const chosen = Financial.verificationPosting(sale('C1'), {bdo: {feedMethods: ['Bank Transfer']}, gcash: {name: 'GCash'}}, {clearing: 560, accountId: 'gcash'});
assert.equal(lines(chosen, 'asset:cash_account:gcash'), 560, 'the chosen receiving account gets the money');
assert.equal(lines(chosen, 'asset:cash_account:bdo'), 0);}

// 4. Separation of duties: the sale's cashier or crew cannot verify; a super admin can (flagged).
await assert.rejects(fx.processOrderAdjustment(req({action: 'manager_validate_payment', orderId: 'POS-S1', approvalId: 'AP_SELF'})), /cannot verify or reject its payment/);
assert.equal((await read('financialApprovals/AP_SELF')).usedAt, undefined, 'a refused verifier does not use up the approval');
await fx.processOrderAdjustment(req({action: 'manager_validate_payment', orderId: 'POS-S1', approvalId: 'AP_SA'}));
assert.equal((await read('orders/POS-S1/paymentVerification')).selfCheck, true, 'a super admin self-check is flagged');

// 5. Payment not received (credit note + stock write-off): revenue and tax reversed, 1060 cleared, cost to 6120.
await assert.rejects(fx.processOrderAdjustment(req({action: 'refund', orderId: 'POS-N1', amount: 100, reason: 'test', approvalId: 'none'})), /Verify this payment first/);
await fx.processOrderAdjustment(req({action: 'payment_not_received', orderId: 'POS-N1', approvalId: 'AP_NR', reasonCode: 'fake_proof', note: 'BDO statement 27-29 Oct searched'}));
const nr = await read('financialMovements/unpaid_POS-N1'), saleN = await read('financialMovements/sale_POS-N1');
assert.equal(lines(nr, 'asset:payment_verification'), -560);
assert.equal(lines(nr, 'revenue:sales_reversal'), 560);
assert.equal(lines(nr, 'expense:unpaid_sales_loss'), 200, 'the cost of the goods moves to Unpaid Sales Loss');
assert.equal(lines(nr, 'cogs:beverage'), -200, 'and leaves COGS');
assert.equal(lines(saleN, 'asset:payment_verification') + lines(nr, 'asset:payment_verification'), 0, '1060 nets to zero');
assert.equal(nr.occurredAt, SALE_AT, 'open month: reversal dated on the sale date');
const nrOrder = await read('orders/POS-N1');
assert.deepEqual([nrOrder.paymentStatus, nrOrder.unpaidSale.amount, nrOrder.unpaidSale.reasonCode], ['not_received', 560, 'fake_proof']);
assert.equal(await read('paymentVerificationQueue/POS-N1'), null);
assert.equal(Financial.orderNetSales(nrOrder), Financial.sourceNetSales([saleN, nr], 'POS-N1'), 'Admin and Finance net sales agree after the reversal');
assert.equal(Sales.amounts(nrOrder).net, 0, 'Admin net sales drop to zero for a fully unpaid sale');
await assert.rejects(fx.processOrderAdjustment(req({action: 'void', orderId: 'POS-N1', reason: 'x', approvalId: 'none'})), /already reversed/);

// 6. Unverified payments cannot be archived (manual Archive), even from a closed shift.
await assert.rejects(fx.manageOrderArchive(req({action: 'archive', orderId: 'POS-AR1'})), /Verify this payment first/);
assert.ok(await read('orders/POS-AR1'), 'the unverified order stays live in the verification queue');

// 7. Catch-up for an archived August sale: closed month -> posted today with the original date kept.
const caught = await fx.processOrderAdjustment(req({action: 'recognize_unverified_sale', orderId: 'POS-AUG1'}));
assert.equal(caught.postedOn, 'today');
const aug = await read('financialMovements/sale_POS-AUG1');
assert.equal(aug.originalSaleDate, '2026-08-15');
assert.equal(lines(aug, 'asset:payment_verification'), 560);
assert.ok(await read('paymentVerificationQueue/POS-AUG1'), 'the August payment joins the verification queue');
assert.ok(await read('archivedOrders/POS-AUG1/salesRecognizedAt'), 'monthly history is refreshed');
assert.equal((await fx.processOrderAdjustment(req({action: 'recognize_unverified_sale', orderId: 'POS-AUG1'}))).duplicate, true, 'posting twice is a no-op');

// 8. Review cases.
// 8a. Voiding an unverified sale reverses 1060 and moves no bank cash.
// (Both void paths build the reversal with fullOrderVoidMovement; the trigger path is exercised here.)
const voided = {...(await read('orders/POS-VD1')), voided: true, voidedAt: NOW};
await db.ref('orders/POS-VD1').set(voided);
await fx.onOrderFinancialPosting({params: {orderId: 'POS-VD1'}, data: {before: {val: () => ({...voided, voided: false})}, after: {val: () => voided}}});
const voidMv = await read('financialMovements/void_POS-VD1');
assert.equal(lines(await read('financialMovements/sale_POS-VD1'), 'asset:payment_verification') + lines(voidMv, 'asset:payment_verification'), 0, 'the void credits 1060');
assert.equal(lines(voidMv, 'asset:cash_account:bdo'), 0, 'the void never touches the bank');
assert.equal(Object.values(await read('cfLedger') || {}).filter((r) => r.ref === 'POS-VD1').length, 0, 'no Cash Flow outflow for money that never arrived');
assert.equal(await read('paymentVerificationQueue/POS-VD1'), null);
// 8b. Verified before the sale posted: the trigger posts the sale to 1060 and settles it in the same run.
await fx.processOrderAdjustment(req({action: 'manager_validate_payment', orderId: 'POS-E1', approvalId: 'AP_EARLY'}));
assert.equal(lines(await read('financialMovements/sale_POS-E1'), 'asset:payment_verification'), 0, 'verified first: the sale posts straight to the bank');
const staleE1 = sale('POS-E1'); await fx.onOrderFinancialPosting({params: {orderId: 'POS-E1'}, data: {before: {val: () => null}, after: {val: () => staleE1}}});
assert.equal(await read('financialMovements/payver_POS-E1'), null, 'a stale trigger run does not post a second receipt');
// 8c. A verified sale left in 1060 (failed write) is settled by the next trigger run.
await db.ref('financialMovements/sale_POS-R1').set(Financial.orderPosting(sale('POS-R1'), {bdo: {feedMethods: ['Bank Transfer']}}, null));
await fx.onOrderFinancialPosting({params: {orderId: 'POS-R1'}, data: {before: {val: () => sale('POS-R1')}, after: {val: () => sale('POS-R1', {paymentStatus: 'manager_validated'})}}});
assert.equal(lines(await read('financialMovements/payver_POS-R1'), 'asset:payment_verification'), -560, 'the settlement step clears a stuck 1060 balance');
// 8c-2. The manual "finish verification" retry is the same idempotent step.
assert.equal((await fx.processOrderAdjustment(req({action: 'settle_verified_payment', orderId: 'POS-R1'}))).duplicate, true, 'retrying a finished verification posts nothing');
// 8d. The till login cannot verify its own sale on the cashier path either.
await assert.rejects(fx.processOrderAdjustment(req({action: 'cashier_verify_payment', orderId: 'POS-C1', reference: 'GC-1'}, 'till_uid')), /cannot verify or reject its payment/);
// 8e. Split cash + e-payment not received: only the e-payment share is reversed, with its share of cost.
await fx.processOrderAdjustment(req({action: 'payment_not_received', orderId: 'POS-SP1', approvalId: 'AP_SPLIT', reasonCode: 'no_transfer_found'}));
const sp = await read('financialMovements/unpaid_POS-SP1');
assert.equal(lines(sp, 'asset:payment_verification'), -360);
assert.equal(lines(sp, 'revenue:sales_reversal'), 360, 'the cash 200 stays a sale');
assert.equal(lines(sp, 'expense:unpaid_sales_loss'), Financial.money(200 * 360 / 560), 'cost moved to loss matches the unpaid share');
assert.equal(Sales.amounts(await read('orders/POS-SP1')).net, 200, 'Admin keeps the cash 200 as a sale');
assert.ok((await read('financialApprovals/AP_SPLIT')).usedAt, 'the approval is marked used');

// 9. Library: VAT is reversed with the unpaid sale.
const vatSale = Financial.orderPosting(sale('VAT1', {total: 112, subtotal: 112, payments: [{method: 'GCash', amount: 112}]}), {}, {mode: 'vat', rate: 12, inclusive: true});
assert.equal(lines(vatSale, 'asset:payment_verification'), 112);
const vatUnpaid = Financial.unpaidSalePosting(sale('VAT1', {total: 112, subtotal: 112}), 112, {mode: 'vat', rate: 12, inclusive: true}, []);
assert.equal(lines(vatUnpaid, 'liability:output_vat'), 12, 'output VAT is reversed with the unpaid sale');

console.log('PASS: every POS sale posts when captured; unverified e-payments wait in 1060, move to the bank on verification (Dr bank / Cr 1060, sale date) or reverse as not received (credit note, cost to 6120); duties are separated, refunds/archive/void are guarded, and Admin matches Finance.');
