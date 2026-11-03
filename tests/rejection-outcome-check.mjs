// Website-order rejection outcome (Danilo, Nov 2026). Staff must say what happens to the
// customer's money when rejecting a website order: "payment not found" or "refund due".
// A refund still owed keeps the order live in Register Ops until a manager records the
// payback; nothing posts, because a rejected order never posted a sale.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const OrderService = require('../functions/lib/order-service.js');
const Status = require('../functions/lib/order-status.js');

// ---- 1. the shared rule ----
const web = {id: 'OD-1', source: 'online', channel: 'online', status: 'Rejected', total: 245.5, paymentStatus: 'manager_validated', shiftId: 'S1', posCaptured: true, timestamp: 1};
assert.equal(OrderService.rejectionState(Object.assign({}, web, {rejection: {outcome: 'refund_due', refundStatus: 'owed'}})), 'refund_owed');
assert.equal(OrderService.rejectionState(Object.assign({}, web, {rejection: {outcome: 'refund_due', refundStatus: 'paid'}})), 'released');
assert.equal(OrderService.rejectionState(Object.assign({}, web, {paymentStatus: 'cashier_verified', rejection: {outcome: 'payment_not_found'}})), 'released');
assert.equal(OrderService.rejectionState(web), '', 'a pre-outcome rejection after capture keeps the old payment-review rule');
assert.equal(OrderService.rejectionState({source: 'online', status: 'Rejected', paymentStatus: 'pending'}), 'released', 'pre-outcome, never accepted: released as before');
assert.equal(OrderService.rejectionState(Object.assign({}, web, {status: 'Ready', rejection: {outcome: 'refund_due'}})), '', 'only Rejected orders carry a rejection state');
assert.equal(OrderService.rejectionState(Object.assign({}, web, {source: 'pos', channel: 'instore', rejection: {outcome: 'refund_due'}})), '', 'till orders are out of scope');

// ---- 2. the status command records, requires and clears the outcome ----
function fakeDb(data) {
  const parts = (p) => String(p || '').split('/').filter(Boolean);
  const at = (p) => parts(p).reduce((v, k) => v && v[k], data);
  const put = (p, v) => { const ks = parts(p); let c = data; for (const k of ks.slice(0, -1)) c = c[k] || (c[k] = {}); if (v === null) delete c[ks.at(-1)]; else c[ks.at(-1)] = structuredClone(v); };
  const snap = (v) => ({val: () => (v == null ? null : structuredClone(v)), exists: () => v != null});
  return {data, ref: (path = '/') => ({
    get: async () => snap(at(path)),
    update: async (w) => Object.entries(w).forEach(([k, v]) => put(path === '/' ? k : path + '/' + k, v)),
    transaction: async (fn) => { const cur = at(path), next = fn(cur == null ? null : structuredClone(cur)); if (next === undefined) return {committed: false, snapshot: snap(cur)}; put(path, next); return {committed: true, snapshot: snap(next)}; },
  })};
}
const run = (db, data, actor = {uid: 'c1', role: 'cashier'}) => Status.updateOrderStatusCommand({db, actor, data, activeOrderProjection: (o) => o, shouldProjectOrder: () => true});
{
  const db = fakeDb({orders: {A: {id: 'A', source: 'online', channel: 'online', status: 'Confirmed', total: 245.5, ownerUid: 'u1', paymentStatus: 'manager_validated', shiftId: 'S1', posCaptured: true}}});
  await assert.rejects(run(db, {orderId: 'A', status: 'Rejected', expectedStatus: 'Confirmed', requestId: 'r_missing'}), /payment not found, or refund due/, 'a website rejection needs an outcome');
  await assert.rejects(run(db, {orderId: 'A', status: 'Rejected', expectedStatus: 'Confirmed', requestId: 'r_forged', rejectionOutcome: 'keep_money'}), /payment not found, or refund due/);
  assert.equal(db.data.orders.A.status, 'Confirmed');
  await run(db, {orderId: 'A', status: 'Rejected', expectedStatus: 'Confirmed', requestId: 'r_refund', rejectionOutcome: 'refund_due'});
  const r = db.data.orders.A.rejection;
  assert.equal(db.data.orders.A.status, 'Rejected');
  assert.deepEqual([r.outcome, r.refundStatus, r.refundAmount, r.byUid], ['refund_due', 'owed', 245.5, 'c1']);
  assert.equal(db.data.orders.A.statusHistory.r_refund.rejectionOutcome, 'refund_due');
  assert.equal(Object.values(db.data.operationalAudit)[0].rejectionOutcome, 'refund_due');
  // A verified payment cannot be written off as "not found".
  await assert.rejects(run(db, {orderId: 'A', status: 'Rejected', expectedStatus: 'Rejected', requestId: 'r_same', rejectionOutcome: 'payment_not_found'}).then((r) => { assert.equal(r.duplicate, true); throw new Error('same-status replay is a no-op'); }), /no-op/);
  assert.equal(db.data.orders.A.rejection.outcome, 'refund_due', 'a re-reject never overwrites a recorded outcome');
  // Reopening an order with a refund owed needs a manager, and clears the outcome.
  const manager = {uid: 'm1', role: 'manager'};
  await assert.rejects(run(db, {orderId: 'A', status: 'Confirmed', expectedStatus: 'Rejected', requestId: 'r_reopen_cashier'}), /Only a manager can reopen/);
  await run(db, {orderId: 'A', status: 'Confirmed', expectedStatus: 'Rejected', requestId: 'r_reopen'}, manager);
  assert.equal(db.data.orders.A.rejection, undefined);
  await assert.rejects(run(db, {orderId: 'A', status: 'Rejected', expectedStatus: 'Confirmed', requestId: 'r_nf_verified', rejectionOutcome: 'payment_not_found'}), /already verified as received/, 'verified money cannot become payment not found');
  // An unverified payment may be rejected as not found; it owes nothing.
  db.data.orders.P = {id: 'P', source: 'online', channel: 'online', status: 'Pending', total: 120, paymentStatus: 'pending'};
  await run(db, {orderId: 'P', status: 'Rejected', expectedStatus: 'Pending', requestId: 'r_nf', rejectionOutcome: 'payment_not_found'});
  assert.equal(db.data.orders.P.rejection.outcome, 'payment_not_found');
  assert.equal(db.data.orders.P.rejection.refundStatus, undefined, 'payment not found owes nothing');
  // A paid refund can never be reopened, by anyone.
  db.data.orders.A.status = 'Rejected';
  db.data.orders.A.rejection = {outcome: 'refund_due', refundStatus: 'paid', refundAmount: 245.5};
  await assert.rejects(run(db, {orderId: 'A', status: 'Confirmed', expectedStatus: 'Rejected', requestId: 'r_reopen_paid'}, manager), /already recorded as paid/);
  // A rejection from before outcomes existed can have its outcome recorded now.
  db.data.orders.L = {id: 'L', source: 'online', channel: 'online', status: 'Rejected', total: 90, paymentStatus: 'cashier_verified', shiftId: 'S1', posCaptured: true};
  assert.equal(OrderService.paymentHoldReason(db.data.orders.L), 'payment_review', 'a legacy rejection after capture is held');
  await run(db, {orderId: 'L', status: 'Rejected', expectedStatus: 'Rejected', requestId: 'r_legacy', rejectionOutcome: 'refund_due'});
  assert.deepEqual([db.data.orders.L.rejection.outcome, db.data.orders.L.rejection.refundStatus], ['refund_due', 'owed']);
  assert.equal(OrderService.paymentHoldReason(db.data.orders.L), 'refund_owed');
}

// ---- 3. live list and archive follow the outcome (real projection + archive sources) ----
const ordersSource = fs.readFileSync('src/functions/30-orders.js', 'utf8');
const archiveSource = fs.readFileSync('src/functions/21-operational-controls.js', 'utf8');
const ctx = {OrderService, ACTIVE_ONLINE_TTL_MS: 2 * 3600000, Date, Number, String, Object, Array, Promise, JSON, crypto,
  financeKey: (v) => String(v), HttpsError: class extends Error { constructor(c, m) { super(m); this.code = c; } }, logger: {warn() {}}};
vm.createContext(ctx);
vm.runInContext(ordersSource.slice(ordersSource.indexOf('function shouldProjectOrder('), ordersSource.indexOf('exports.syncOfflinePosSale')), ctx);
vm.runInContext(archiveSource.slice(archiveSource.indexOf('const ORDER_ARCHIVE_SWEEP_GRACE_MS'), archiveSource.indexOf('exports.manageOrderArchive')), ctx);
{
  const old = Date.now() - 3 * 3600000, closed = {S1: {status: 'closed'}};
  const owed = Object.assign({}, web, {timestamp: old, rejection: {outcome: 'refund_due', refundStatus: 'owed', refundAmount: 245.5}});
  assert.equal(ctx.shouldProjectOrder(owed, null), true, 'a refund owed stays on the register');
  const check = async (o) => ctx.orderArchiveCheck(fakeDb({orders: {[o.id]: o}, shifts: closed}), o.id, {strict: true});
  assert.equal((await check(owed)).reason, 'refund_owed');
  const paid = Object.assign({}, owed, {rejection: Object.assign({}, owed.rejection, {refundStatus: 'paid'})});
  assert.equal(ctx.shouldProjectOrder(paid, null), false);
  assert.equal((await check(paid)).ok, true, 'once paid back the order archives');
  const notFound = Object.assign({}, web, {timestamp: old, paymentStatus: 'cashier_verified', rejection: {outcome: 'payment_not_found'}});
  assert.equal((await check(notFound)).ok, true, 'payment not found replaces the payment review');
}

// ---- 4. record_rejection_refund: manager only, idempotent, posts nothing ----
const adjustments = fs.readFileSync('src/functions/43g-order-adjustments.js', 'utf8');
const block = adjustments.slice(adjustments.indexOf('    if (data.action === "record_rejection_refund") {'), adjustments.indexOf('    if (data.action === "recognize_unverified_sale")'));
assert.ok(block.length > 100 && !/commitFinancial|cfLedger|financialMovements/.test(block), 'recording a rejection refund must not post');
const actx = Object.assign({}, ctx, {
  financeText: (v, max = 160) => String(v == null ? '' : v).trim().slice(0, max),
  activeOrderProjection: (o) => Object.assign({}, o, {projectionVersion: 2}),
  operationalAuditRecord: (action, sourceType, sourceId, actor, details) => Object.assign({action, sourceId, actorUid: actor.uid}, details),
  Financial: {money: (v) => Math.round((Number(v) || 0) * 100) / 100},
});
vm.createContext(actx);
vm.runInContext(ordersSource.slice(ordersSource.indexOf('function shouldProjectOrder('), ordersSource.indexOf('exports.syncOfflinePosSale')), actx);
vm.runInContext('globalThis.handler = async function (db, actor, data, found, o) {\n' + block + '  return "fallthrough";\n};', actx);
{
  const order = Object.assign({}, web, {timestamp: Date.now() - 3 * 3600000, rejection: {outcome: 'refund_due', refundStatus: 'owed', refundAmount: 245.5}});
  const db = fakeDb({orders: {[order.id]: structuredClone(order)}, activeOrders: {[order.id]: {id: order.id}}});
  const call = (actor, data) => actx.handler(db, actor, Object.assign({action: 'record_rejection_refund', orderId: order.id}, data), {node: 'orders', order: db.data.orders[order.id]}, Object.assign({id: order.id}, db.data.orders[order.id]));
  await assert.rejects(call({uid: 'c1', role: 'cashier'}, {refundMethod: 'GCash', refundReference: 'X1'}), /Only a manager/);
  await assert.rejects(call({uid: 'm1', role: 'manager'}, {refundMethod: 'GCash', refundReference: ' '}), /how the refund was sent/);
  const done = await call({uid: 'm1', role: 'manager'}, {refundMethod: 'GCash', refundReference: 'GC-778899'});
  assert.deepEqual([done.refunded, done.amount], [true, 245.5]);
  const r = db.data.orders[order.id].rejection;
  assert.deepEqual([r.refundStatus, r.refundMethod, r.refundReference, r.refundPaidByUid], ['paid', 'GCash', 'GC-778899', 'm1']);
  assert.equal(db.data.activeOrders[order.id], undefined, 'paid back: it leaves the live register list');
  assert.equal(Object.keys(db.data.operationalAudit).length, 1);
  const again = await call({uid: 'm1', role: 'manager'}, {refundMethod: 'GCash', refundReference: 'GC-778899'});
  assert.equal(again.duplicate, true, 'a second tap records nothing new');
  assert.equal(Object.keys(db.data.operationalAudit).length, 1);
  const none = fakeDb({orders: {B: {id: 'B', source: 'online', status: 'Rejected', rejection: {outcome: 'payment_not_found'}}}});
  await assert.rejects(actx.handler(none, {uid: 'm1', role: 'manager'}, {action: 'record_rejection_refund', orderId: 'B', refundMethod: 'GCash', refundReference: 'x'}, {node: 'orders'}, Object.assign({id: 'B'}, none.data.orders.B)), /no refund owed/);
}

// ---- 5. every reject entry point asks for the outcome ----
const pos = fs.readFileSync('src/admin/pos/50a-register-shell.js', 'utf8'), adminOrders = fs.readFileSync('assets/js/admin/admin-orders.mjs', 'utf8');
assert.ok(/data-online-reject[\s\S]{0,300}window\.__rejectWebsiteOrder\(id,o\)/.test(pos), 'POS Online Orders reject must ask for the outcome');
assert.ok(!/status:'Rejected',expectedStatus:o\.status/.test(pos), 'POS must not reject without an outcome');
assert.ok(/this\.value==='Rejected'&&website\?window\.__rejectWebsiteOrder/.test(adminOrders), 'Admin Orders status select must ask for the outcome');
assert.ok(/rejectionOutcome:v\.outcome/.test(adminOrders) && /'payment_not_found'/.test(adminOrders) && /'refund_due'/.test(adminOrders));
console.log('PASS: rejecting a website order records payment-not-found or refund-due; a refund owed stays in Register Ops until a manager records it paid, then the order archives, with no posting.');
