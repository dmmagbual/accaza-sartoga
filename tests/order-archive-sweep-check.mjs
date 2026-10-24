// Order archive sweep (Oct 2026). Live orders that are never archived are missing
// from Admin historical reporting while Finance Books already posted them, which is
// how the Admin/Finance net-sales gap appeared. The sweep archives only what a
// manager could already archive by hand, and never an order whose shift is still
// open, that is still in the serving queue, that is unpaid, or that was completed
// moments ago - so an open shift and the till are never touched.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import crypto from 'node:crypto';
const require = createRequire(import.meta.url);
// The real operational rule, not a stub: an order waiting to be served or a
// "not collected" outcome awaiting a manager must stay live.
const OrderService = require('../functions/lib/order-service.js');

const archiveSource = fs.readFileSync('src/functions/21-operational-controls.js', 'utf8');
const maintenanceSource = fs.readFileSync('src/functions/60-maintenance.js', 'utf8');
const ordersSource = fs.readFileSync('src/functions/30-orders.js', 'utf8');
// The production live-projection rule, evaluated for real: the sweep must not be
// a second opinion about which orders the register still shows.
const projection = ordersSource.slice(ordersSource.indexOf('function shouldProjectOrder('), ordersSource.indexOf('exports.syncOfflinePosSale'));

// ---- the shared eligibility decision (the till guard lives here) ----
const helpers = archiveSource.slice(archiveSource.indexOf('const ORDER_ARCHIVE_SWEEP_GRACE_MS'), archiveSource.indexOf('exports.manageOrderArchive'));
const lookup = (store, path) => {
  const parts = path.split('/').filter(Boolean);
  let node = store;
  for (const part of parts) { if (node == null || typeof node !== 'object') return undefined; node = node[part]; }
  return node;
};
function fakeDb(store, writes) {
  const assign = (path, value) => { const parts=path.split('/').filter(Boolean);let node=store;for(const part of parts.slice(0,-1))node=node[part]||(node[part]={});const key=parts.at(-1);if(value===null)delete node[key];else node[key]=value; };
  return {
    ref: (path) => ({
      // RTDB DataSnapshot: exists() is a method, unlike Firestore's exists property.
      get: async () => { const value = path === undefined ? store : lookup(store, path); return {exists: () => value !== undefined, val: () => value}; },
      update: async (patch) => { writes.push(patch);Object.keys(patch).forEach((key)=>assign(key,patch[key])); },
      set: async (value) => { writes.push({[path]: value}); },
      transaction: async (fn) => {const current=lookup(store,path),next=fn(current);if(next===undefined)return{committed:false,snapshot:{exists:()=>current!==undefined,val:()=>current}};assign(path,next);writes.push({[path]:next});return{committed:true,snapshot:{exists:()=>next!==undefined&&next!==null,val:()=>next}};},
    }),
  };
}
const ctx = {
  financeKey: (value) => { if (!/^[A-Za-z0-9_-]+$/.test(String(value || ''))) throw new Error('Shift ID is invalid.'); return String(value); },
  OrderService,
  archivedOrderRecord: (order, now, reason) => Object.assign({}, order, {status: 'Archived', prevStatus: order.status, archivedAt: now, archiveReason: reason}),
  operationalAuditRecord: (action, sourceType, sourceId, actor, details = {}) => Object.assign({action, sourceType, sourceId, actorUid: actor.uid, ts: 1}, details),
  HttpsError: class extends Error { constructor(code, message) { super(message); this.code = code; } },
  ACTIVE_ONLINE_TTL_MS: 2 * 3600000,
  Date, Number, String, Object, Promise, Array, Set, JSON, crypto,
  shallowDatabaseKeys: async () => [], logger: {warn: () => {}},
};
vm.createContext(ctx);
vm.runInContext(projection, ctx);
vm.runInContext(helpers, ctx);

const completed = {id:'A',status: 'Completed', paymentStatus: 'manager_validated', shiftId: 'SH-1', completedAt: Date.now() - 2 * 3600000,inventoryDeducted:true,inventoryLedgerVersion:1};
const closedShift = {SH: {'SH-1': {status: 'closed'}}};
const openShift = {SH: {'SH-1': {status: 'open'}}};

// 1. An order whose shift is still open must never be archived by the sweep.
{
  const writes = [];
  const db = fakeDb({orders: {A: completed}, shifts: openShift.SH}, writes);
  const check = await ctx.orderArchiveCheck(db, 'A', {strict: true});
  assert.equal(check.ok, false, 'a sweep must not archive while the shift is open');
  assert.equal(check.reason, 'shift_open');
  assert.equal(writes.length, 0);
}
// 2. The serving queue and a not-collected order awaiting a manager are respected,
//    using the real order-service rule.
{
  const serving = fakeDb({orders: {A: Object.assign({}, completed, {source: 'pos', channel: 'instore', service: {state: 'ready'}})}, shifts: closedShift.SH}, []);
  assert.equal((await ctx.orderArchiveCheck(serving, 'A', {strict: true})).reason, 'serving_queue', 'an order still being served stays live');
  const notCollected = fakeDb({orders: {A: Object.assign({}, completed, {source: 'pos', channel: 'instore', service: {state: 'not_collected'}})}, shifts: closedShift.SH}, []);
  assert.equal((await ctx.orderArchiveCheck(notCollected, 'A', {strict: true})).reason, 'serving_queue', 'a not-collected order awaiting a manager stays live');
}
// 3. Strict mode reuses the live-projection rule, so an electronic payment a
//    manager must still validate, or an unsettled platform order, stays in the
//    register's review list and its Z-report total.
{
  const cashier = fakeDb({orders: {A: Object.assign({}, completed, {paymentStatus: 'cashier_verified'})}, shifts: closedShift.SH}, []);
  assert.equal((await ctx.orderArchiveCheck(cashier, 'A', {strict: true})).reason, 'still_live', 'a cashier-verified electronic payment must stay live for the manager');
  const pending = fakeDb({orders: {A: Object.assign({}, completed, {paymentStatus: 'pending'})}, shifts: closedShift.SH}, []);
  assert.equal((await ctx.orderArchiveCheck(pending, 'A', {strict: true})).reason, 'still_live');
  const platform = fakeDb({orders: {A: Object.assign({}, completed, {channel: 'grabfood', settlementStatus: 'unsettled'})}, shifts: closedShift.SH}, []);
  assert.equal((await ctx.orderArchiveCheck(platform, 'A', {strict: true})).reason, 'still_live', 'an unsettled platform order must stay live');
  const fresh = fakeDb({orders: {A: Object.assign({}, completed, {completedAt: Date.now() - 60000})}, shifts: closedShift.SH}, []);
  assert.equal((await ctx.orderArchiveCheck(fresh, 'A', {strict: true})).reason, 'too_recent');
  const undated = fakeDb({orders: {A: Object.assign({}, completed, {completedAt: 0, receivedAt: 0, timestamp: 0})}, shifts: closedShift.SH}, []);
  assert.equal((await ctx.orderArchiveCheck(undated, 'A', {strict: true})).reason, 'too_recent', 'an order with no timestamp is never archived automatically');
}
// 4. Only final statuses leave the live order list.
{
  const db = fakeDb({orders: {A: Object.assign({}, completed, {status: 'Preparing'})}, shifts: closedShift.SH}, []);
  assert.equal((await ctx.orderArchiveCheck(db, 'A', {strict: true})).reason, 'not_final');
}
// 5. An eligible order archives in ONE multi-path write that cannot half-apply.
{
  const writes = [];
  const state={orders: {A: completed}, shifts: closedShift.SH,financialMovements:{sale_A:{id:'sale_A'}}};
  const db = fakeDb(state, writes);
  const check = await ctx.orderArchiveCheck(db, 'A', {strict: true});
  assert.equal(check.ok, true);
  const result = await ctx.archiveOrderNow(db, check.order, {uid: 'system', role: 'system'}, 'auto-sweep',check.fingerprint);
  assert.equal(result.orderId, 'A');
  assert.equal(state.orders.A, undefined, 'the unchanged live order is conditionally cleared');
  assert.equal(state.archivedOrders.A.status, 'Archived');
  assert.equal(state.archivedOrders.A.archiveReason, 'auto-sweep');
  assert.equal(state.archivedOrders.A.archivePending, undefined, 'the staged archive is finalized');
  const auditPatch=writes.find((patch)=>Object.keys(patch).some((key)=>key.startsWith('operationalAudit/'))),auditKey=Object.keys(auditPatch).find((key)=>key.startsWith('operationalAudit/'));
  assert.equal(auditPatch[auditKey].action, 'archive_order');
}
// 6. Re-running is idempotent: an already archived order is a duplicate, not a second archive.
{
  const db = fakeDb({archivedOrders: {A: {status: 'Archived'}}, shifts: closedShift.SH}, []);
  assert.equal((await ctx.orderArchiveCheck(db, 'A', {strict: true})).reason, 'already_archived');
}

// ---- the scheduled sweep itself ----
for (const marker of [
  'exports.sweepOrderArchive = onSchedule',
  'schedule: "every 3 hours"',
  'timeZone: "Asia/Manila"',
  'region: ORDER_REGION',
  'ORDER_ARCHIVE_SWEEP_SCAN_LIMIT = 300',
  'ORDER_ARCHIVE_SWEEP_ARCHIVE_LIMIT = 150',
  'await shallowDatabaseKeys(db, "orders")',
  'orderArchiveCheck(db, orderId, {strict: true})',
  'if (state.enabled === false) return null',
  'sweep_order_archive',
  'systemHealth/orderArchiveSweep/cursor',
]) assert(maintenanceSource.includes(marker), 'order archive sweep safeguard missing: ' + marker);
assert(archiveSource.includes('if (shouldProjectOrder(order, null) || order.correctionPending || order.archivePending) return {ok: false, reason: "still_live"};'), 'the sweep must reuse the live-projection rule instead of its own payment list');
assert(archiveSource.includes('orderArchiveFingerprint(current) !== fingerprint'), 'archive removal must abort when the order changed after eligibility was checked');
for(const marker of ['action === "archive_eligible"','ORDER_ARCHIVE_MANUAL_SCAN_LIMIT = 300','ORDER_ARCHIVE_MANUAL_ARCHIVE_LIMIT = 150','shallowDatabaseKeys(db, "orders")','{strict: true, excludeShiftId}','bulk_archive_orders'])if(!archiveSource.includes(marker))throw new Error('Manual bulk archive safeguard missing: '+marker);

// The current active shift is protected even if its history row is stale and
// incorrectly says closed.
{
  const db=fakeDb({orders:{A:completed},shifts:{'SH-1':{status:'closed'}}},[]);
  assert.equal((await ctx.orderArchiveCheck(db,'A',{strict:true,excludeShiftId:'SH-1'})).reason,'current_shift');
}

const sweepBlock = maintenanceSource.slice(maintenanceSource.indexOf('const ORDER_ARCHIVE_SWEEP_SCAN_LIMIT'), maintenanceSource.indexOf('// Release 8B: automated recovery point'));
let handler = null;
const sweepCtx = {
  exports: {},
  ORDER_REGION: "asia-southeast1",
  onSchedule: (options, fn) => { handler = {options, fn}; return fn; },
  getDatabase: () => null,
  shallowDatabaseKeys: async () => sweepKeys,
  orderArchiveCheck: async () => ({ok: true, order: {id: 'X'}}),
  archiveOrderNow: async () => ({archivedAt: 1}),
  operationalAuditRecord: (action, sourceType, sourceId, actor, details = {}) => Object.assign({action, sourceType, sourceId}, details),
  logger: {info: () => {}, warn: () => {}},
  Date, Number, String, Object, Promise, Array,
};
let sweepKeys = [];
const sweepWrites = [];
vm.createContext(sweepCtx);
vm.runInContext(sweepBlock, sweepCtx);
assert(handler, 'the sweep must register on a schedule');
assert.equal(handler.options.schedule, 'every 3 hours');
assert.equal(handler.options.region, 'asia-southeast1');
const runSweep = (keys, state) => { sweepKeys = keys; sweepWrites.length = 0; sweepCtx.getDatabase = () => fakeDb({systemHealth: {orderArchiveSweep: state}}, sweepWrites); return handler.fn(); };

// kill switch: one flag stops the whole run without a deploy
await runSweep(['A'], {enabled: false});
assert.equal(sweepWrites.length, 0, 'a disabled sweep must not read orders or write anything');

// bounded scan and bounded archive, with a cursor that advances
const many = Array.from({length: 400}, (_, i) => 'O' + String(i).padStart(4, '0'));
let archived = 0;
sweepCtx.orderArchiveCheck = async () => ({ok: true, order: {id: 'X'}});
sweepCtx.archiveOrderNow = async () => { archived++; return {archivedAt: 1}; };
sweepCtx.shallowDatabaseKeys = async () => many;
await runSweep(many, {});
assert.equal(archived, 150, 'one run archives at most its cap');
const stateWrite = sweepWrites.find((patch) => patch['systemHealth/orderArchiveSweep/cursor'] !== undefined);
assert(stateWrite, 'the sweep records its progress');
assert.equal(stateWrite['systemHealth/orderArchiveSweep/cursor'], 'O0149', 'the cursor advances to the last scanned key so the next run continues');
const auditKey = Object.keys(stateWrite).find((key) => key.includes('order_archive_sweep'));
assert(auditKey, 'the run progress and its audit record travel in one multi-path write');
assert.equal(stateWrite[auditKey].archived, 150);

// a completed pass resets the cursor so the next run starts from the top again
archived = 0;
sweepCtx.shallowDatabaseKeys = async () => ['A', 'B'];
await runSweep(['A', 'B'], {cursor: 'A'});
const finalState = sweepWrites.find((patch) => patch['systemHealth/orderArchiveSweep/cursor'] !== undefined);
assert.equal(finalState['systemHealth/orderArchiveSweep/cursor'], '', 'finishing a pass returns the cursor to the start');

console.log('PASS: the order archive sweep archives only closed-shift, served, settled orders in one multi-path write, is bounded and idempotent, has a no-deploy kill switch, and never touches an open shift or the till.');
