// Stale live copies of archived orders (29 Oct 2026). Archiving writes a claim on /orders and then
// deletes the order; each write fires syncActiveOrderProjection, and runs can finish out of order.
// A late run for the claim write re-created /activeOrders after the archive removed it, so five
// archived orders (GF-O76L5Z and others) stayed on Admin > Orders and Archive did nothing.
import assert from 'node:assert/strict';
import {createFakeDatabase} from './helpers/fake-rtdb.mjs';
import {loadFunctions} from './helpers/functions-sandbox.mjs';
import fs from 'node:fs';
const src = fs.readFileSync('assets/js/admin/admin-orders.mjs', 'utf8');

const NOW = Date.parse('2026-10-29T14:00:00+08:00');
const sale = (id, extra = {}) => Object.assign({id, source: 'pos', channel: 'grabfood', status: 'Completed', shiftId: 'SH-OLD', total: 520, payment: 'GrabFood', paymentStatus: 'confirmed', settlementStatus: 'unsettled', service: {state: 'served'}, timestamp: NOW - 3 * 86400000}, extra);
const db = createFakeDatabase({
  admins: {mgr_uid: 'manager'},
  posActiveShift: {id: 'SH-LIVE', status: 'open'},
  shifts: {'SH-OLD': {status: 'closed'}, 'SH-LIVE': {status: 'open'}},
  orders: {'GF-LATE': sale('GF-LATE'), 'GF-OPEN': sale('GF-OPEN', {shiftId: 'SH-LIVE'})},
  archivedOrders: {
    'GF-GHOST': Object.assign(sale('GF-GHOST'), {status: 'Archived', prevStatus: 'Completed', archivedAt: NOW - 3600000}),
    'GF-INFLIGHT': Object.assign(sale('GF-INFLIGHT'), {status: 'Archived', prevStatus: 'Completed', archivedAt: NOW, archivePending: true}),
  },
  activeOrders: {
    'GF-GHOST': Object.assign(sale('GF-GHOST'), {archivePending: 'attempt_1', projectionVersion: 2}),
    'GF-INFLIGHT': Object.assign(sale('GF-INFLIGHT'), {projectionVersion: 2}),
  },
});
const {exports: fx} = loadFunctions(db, {now: NOW});
const req = (data) => ({auth: {uid: 'mgr_uid', token: {email: 'manager@example.test'}}, data});
const read = async (path) => (await db.ref(path).get()).val();
const event = (orderId, after) => ({params: {orderId}, data: {before: {val: () => null}, after: {val: () => after}}});

// 1. A real manual archive, then the late projection run for its claim write: no live copy survives.
const claimed = Object.assign(await read('orders/GF-LATE'), {archivePending: 'attempt_late', archivePendingAt: NOW});
const archived = await fx.manageOrderArchive(req({action: 'archive', orderId: 'GF-LATE'}));
assert.ok(archived.archivedAt, 'a closed-shift, served GrabFood sale is archived by a manager');
assert.equal(await read('orders/GF-LATE'), null);
await fx.syncActiveOrderProjection(event('GF-LATE', claimed));
assert.equal(await read('activeOrders/GF-LATE'), null, 'a late trigger run must not re-create the live copy of an archived order');

// 2. The same trigger still projects an order that is live.
await fx.syncActiveOrderProjection(event('GF-OPEN', await read('orders/GF-OPEN')));
assert.ok(await read('activeOrders/GF-OPEN'), 'an open-shift order stays on the live list');

// 3. Pressing Archive on a leftover copy of a finished archive removes it and audits the repair.
const healed = await fx.manageOrderArchive(req({action: 'archive', orderId: 'GF-GHOST'}));
assert.deepEqual([healed.duplicate, healed.removedStaleCopy], [true, true]);
assert.equal(await read('activeOrders/GF-GHOST'), null, 'the leftover live copy is removed');
assert.equal((await read('archivedOrders/GF-GHOST')).status, 'Archived', 'the archive record is untouched');
const audit = Object.values(await read('operationalAudit') || {}).find((row) => row.action === 'remove_stale_active_order');
assert.equal(audit && audit.sourceId, 'GF-GHOST', 'the repair is audited');

// 4. An archive still in flight is never touched, and a second press is a plain duplicate.
const inflight = await fx.manageOrderArchive(req({action: 'archive', orderId: 'GF-INFLIGHT'}));
assert.equal(inflight.removedStaleCopy, undefined);
assert.ok(await read('activeOrders/GF-INFLIGHT'), 'an in-flight archive keeps its live copy until it finishes');
assert.equal((await fx.manageOrderArchive(req({action: 'archive', orderId: 'GF-GHOST'}))).removedStaleCopy, undefined);

// 5. Review cases: a pending archive is reported, a missing archive record or a live order is never
//    treated as a leftover, and a late run for a claim write never overwrites a finished archive.
await db.ref('archivedOrders/GF-INFLIGHT/archivePending').set(true);
assert.equal((await fx.manageOrderArchive(req({action: 'archive', orderId: 'GF-INFLIGHT'}))).pending, true, 'an unfinished archive is reported as still finishing');
const finished = await read('archivedOrders/GF-LATE');
await fx.syncActiveOrderProjection(event('GF-LATE', Object.assign({}, claimed, {settlementStatus: 'settled'})));
assert.deepEqual(await read('archivedOrders/GF-LATE'), finished, 'a late claim-write run must not overwrite the finished manual archive record');
assert.equal(await read('activeOrders/GF-LATE'), null);
const sandbox2 = createFakeDatabase({admins: {mgr_uid: 'manager'}, posActiveShift: {id: 'SH-LIVE'}, activeOrders: {'GF-X': sale('GF-X')}});
const {exports: fx2} = loadFunctions(sandbox2, {now: NOW});
await assert.rejects(fx2.manageOrderArchive(req({action: 'archive', orderId: 'GF-X'})), /not found/i, 'no archive record: the live copy is not removed as a leftover');
assert.ok((await sandbox2.ref('activeOrders/GF-X').get()).val());
if (!src.includes("var block=o.archivePending?{ok:true}:orderArchiveBlock(o,deps.archiveContext())") || !src.includes('res.pending?alert(')) throw new Error('A leftover copy carrying an archive claim must reach the server, and a pending archive must be reported');

// 6. Orders from the open shift are still refused with the existing message.
await assert.rejects(fx.manageOrderArchive(req({action: 'archive', orderId: 'GF-OPEN'})), /current active shift/);

console.log('PASS: archived orders cannot leave a stale live copy; Archive removes an existing leftover (audited) without touching in-flight archives or open-shift orders.');
