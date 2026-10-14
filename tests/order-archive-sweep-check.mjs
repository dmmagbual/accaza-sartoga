// Order archive sweep (Oct 2026). Live orders that are never archived are missing
// from Admin historical reporting while Finance Books already posted them, which is
// how the Admin/Finance net-sales gap appeared. The sweep archives only what a
// manager could already archive by hand, and never an order whose shift is still
// open, that is still in the serving queue, that is unpaid, or that was completed
// moments ago - so an open shift and the till are never touched.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const archiveSource = fs.readFileSync('src/functions/21-operational-controls.js', 'utf8');
const maintenanceSource = fs.readFileSync('src/functions/60-maintenance.js', 'utf8');

// ---- the shared eligibility decision (the till guard lives here) ----
const helpers = archiveSource.slice(archiveSource.indexOf('const ORDER_ARCHIVE_SWEEP_GRACE_MS'), archiveSource.indexOf('exports.manageOrderArchive'));
const lookup = (store, path) => {
  const parts = path.split('/').filter(Boolean);
  let node = store;
  for (const part of parts) { if (node == null || typeof node !== 'object') return undefined; node = node[part]; }
  return node;
};
function fakeDb(store, writes) {
  return {
    ref: (path) => ({
      // RTDB DataSnapshot: exists() is a method, unlike Firestore's exists property.
      get: async () => { const value = path === undefined ? store : lookup(store, path); return {exists: () => value !== undefined, val: () => value}; },
      update: async (patch) => { writes.push(patch); },
      set: async (value) => { writes.push({[path]: value}); },
    }),
  };
}
const ctx = {
  financeKey: (value) => { if (!/^[A-Za-z0-9_-]+$/.test(String(value || ''))) throw new Error('Shift ID is invalid.'); return String(value); },
  OrderService: {keepsOrderLive: (order) => order.servingQueue === true},
  archivedOrderRecord: (order, now, reason) => Object.assign({}, order, {status: 'Archived', prevStatus: order.status, archivedAt: now, archiveReason: reason}),
  operationalAuditRecord: (action, sourceType, sourceId, actor, details = {}) => Object.assign({action, sourceType, sourceId, actorUid: actor.uid, ts: 1}, details),
  HttpsError: class extends Error { constructor(code, message) { super(message); this.code = code; } },
  Date, Number, String, Object, Promise, Array, Set,
};
vm.createContext(ctx);
vm.runInContext(helpers, ctx);

const completed = {status: 'Completed', paymentStatus: 'manager_validated', shiftId: 'SH-1', completedAt: Date.now() - 2 * 3600000};
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
// 2. The serving queue is respected.
{
  const db = fakeDb({orders: {A: Object.assign({}, completed, {servingQueue: true})}, shifts: closedShift.SH}, []);
  assert.equal((await ctx.orderArchiveCheck(db, 'A', {strict: true})).reason, 'serving_queue');
}
// 3. Strict mode leaves an unsettled or brand-new order for a human.
{
  const db = fakeDb({orders: {A: Object.assign({}, completed, {paymentStatus: 'pending'})}, shifts: closedShift.SH}, []);
  assert.equal((await ctx.orderArchiveCheck(db, 'A', {strict: true})).reason, 'payment_unsettled');
  const fresh = fakeDb({orders: {A: Object.assign({}, completed, {completedAt: Date.now() - 60000})}, shifts: closedShift.SH}, []);
  assert.equal((await ctx.orderArchiveCheck(fresh, 'A', {strict: true})).reason, 'too_recent');
}
// 4. Only final statuses leave the live order list.
{
  const db = fakeDb({orders: {A: Object.assign({}, completed, {status: 'Preparing'})}, shifts: closedShift.SH}, []);
  assert.equal((await ctx.orderArchiveCheck(db, 'A', {strict: true})).reason, 'not_final');
}
// 5. An eligible order archives in ONE multi-path write that cannot half-apply.
{
  const writes = [];
  const db = fakeDb({orders: {A: completed}, shifts: closedShift.SH}, writes);
  const check = await ctx.orderArchiveCheck(db, 'A', {strict: true});
  assert.equal(check.ok, true);
  const result = await ctx.archiveOrderNow(db, check.order, {uid: 'system', role: 'system'}, 'auto-sweep');
  assert.equal(result.orderId, 'A');
  assert.equal(writes.length, 1);
  const patch = writes[0];
  assert.equal(patch['orders/A'], null, 'the live order is cleared');
  assert.equal(patch['activeOrders/A'], null, 'the active projection is cleared');
  assert.equal(patch['archivedOrders/A'].status, 'Archived');
  assert.equal(patch['archivedOrders/A'].archiveReason, 'auto-sweep');
  const auditKey = Object.keys(patch).find((key) => key.startsWith('operationalAudit/'));
  assert.equal(patch[auditKey].action, 'archive_order');
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
]) assert(maintenanceSource.includes(marker), 'order archive sweep safeguard missing: ' + marker);
assert(archiveSource.includes('const check = await orderArchiveCheck(db, orderId);'), 'the manager action must use the same eligibility decision as the sweep');

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
const stateWrite = sweepWrites.find((patch) => patch.cursor !== undefined);
assert(stateWrite, 'the sweep records its progress');
assert.equal(stateWrite.cursor, 'O0149', 'the cursor advances to the last scanned key so the next run continues');
const auditWrite = sweepWrites.find((patch) => Object.keys(patch).some((key) => key.includes('order_archive_sweep')));
assert(auditWrite, 'each run leaves one audit record');
assert.equal(auditWrite[Object.keys(auditWrite)[0]].archived, 150);

// a completed pass resets the cursor so the next run starts from the top again
archived = 0;
sweepCtx.shallowDatabaseKeys = async () => ['A', 'B'];
await runSweep(['A', 'B'], {cursor: 'A'});
const finalState = sweepWrites.find((patch) => patch.cursor !== undefined);
assert.equal(finalState.cursor, '', 'finishing a pass returns the cursor to the start');

console.log('PASS: the order archive sweep archives only closed-shift, served, settled orders in one multi-path write, is bounded and idempotent, has a no-deploy kill switch, and never touches an open shift or the till.');
