// A missed Grab/FoodPanda order re-keyed from Payout Reconciliation is a back-office record
// (29 Oct 2026, GF-LATE-A2429BBF): it never belonged to a till shift, so it must not sit in the
// live Admin order list, and a manager must be able to archive it without a shift. The shift
// exemption needs the server-only manager approval, so a forged order cannot use it.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createFakeDatabase} from './helpers/fake-rtdb.mjs';
import {loadFunctions} from './helpers/functions-sandbox.mjs';

const require = createRequire(import.meta.url);
const realWriteSafety = require('../functions/lib/write-safety.js');
const writeSafety = {...realWriteSafety, safeAtomicUpdate: (db, writes) => realWriteSafety.safeAtomicUpdate(db, structuredClone(writes))};
const NOW = Date.parse('2026-10-29T10:00:00+08:00');
const approval = (ref, amount) => ({action: 'rekey_platform_order', sourceId: ref, amount, approvedBy: 'mgr_uid', approvedRole: 'manager', approvedName: 'Manager', expiresAt: NOW + 600000});
const db = createFakeDatabase({
  admins: {mgr_uid: 'manager'},
  menuItems: {item_006: {name: 'Cinnamon Oat Latte', priceL: 275}},
  financialApprovals: {
    A1: approval('GF-A2429BBF', 275),
    OTHER: {action: 'void', sourceId: 'X', usedAt: NOW, usedBy: 'rekey_X'},
    // A re-key recorded before 29 Oct 2026: used, but without the order binding.
    LEGACY: {action: 'rekey_platform_order', sourceId: 'GF-LEGACY1', usedAt: NOW - 86400000, usedBy: 'rekey_GF-LEGACY1'},
  },
  platformRefIndex: {grabfood: {'GF-LEGACY1': {orderId: 'GF-LATE-LEGACY01', ref: 'GF-LEGACY1'}}},
  posActiveShift: {id: 'SH-LIVE', status: 'open'},
});
const {exports: fx, internal} = loadFunctions(db, {now: NOW, expose: ['shouldProjectOrder', 'isPlatformRekeyOrder', 'orderArchiveCheck'], libOverrides: {'./lib/write-safety': writeSafety}});
const req = (data) => ({auth: {uid: 'mgr_uid', token: {email: 'manager@example.test'}}, data});
const read = async (path) => (await db.ref(path).get()).val();
// A separate fake database holding one order beside the same approvals and reference index.
const fakeOrder = (row, id = row.id) => createFakeDatabase({orders: {[id]: row}, financialApprovals: {LEGACY: {action: 'rekey_platform_order', sourceId: 'GF-LEGACY1', usedAt: NOW - 86400000, usedBy: 'rekey_GF-LEGACY1'}}, platformRefIndex: {grabfood: {'GF-LEGACY1': {orderId: 'GF-LATE-LEGACY01', ref: 'GF-LEGACY1'}}}});

const done = await fx.recordPlatformCatchup(req({channel: 'grabfood', platformRef: 'GF-A2429BBF', date: '2026-10-15', gross: 275, commission: 55, reference: 'Missed GrabFood order — late entry', approvalId: 'A1', lineItems: [{itemKey: 'item_006', size: 'L', qty: 1}]}));
const order = await read(`orders/${done.orderId}`);
assert.equal(order.enteredVia, 'payout-rekey');
assert.equal(order.shiftId, undefined, 'a re-keyed order is never attached to a till shift');
assert.equal((await read('financialApprovals/A1')).usedForOrderId, done.orderId, 'the re-key approval is bound to the order it created');

// 1. Never in the live order list, even while its receivable is unsettled.
assert.equal(internal.isPlatformRekeyOrder(order), true);
assert.equal(internal.shouldProjectOrder(order, {id: 'SH-LIVE'}), false, 'a re-keyed order must not be projected to Active Orders');
await fx.syncActiveOrderProjection({params: {orderId: done.orderId}, data: {before: {val: () => null}, after: {val: () => order}}});
assert.equal(await read(`activeOrders/${done.orderId}`), null, 'the projection trigger must not show a re-keyed order');
assert.ok(await read(`orders/${done.orderId}`), 'the projection trigger must not archive it while stock and Books posting are still running');

// 2. Till sales are unchanged: an unsettled platform sale with a shift stays live, and a
//    look-alike record that carries a shift is not treated as a re-key.
const till = {status: 'Completed', source: 'pos', channel: 'grabfood', settlementStatus: 'unsettled', shiftId: 'SH-1'};
assert.equal(internal.shouldProjectOrder(till, null), true, 'unsettled till platform sales stay live');
assert.equal(internal.isPlatformRekeyOrder({...order, shiftId: 'SH-1'}), false, 'an order with a shift is never a re-key');
assert.equal(internal.shouldProjectOrder({...order, shiftId: 'SH-1'}, null), true);

// 3. The posting-gated sweep waits for stock finalization, then may archive it.
assert.equal((await internal.orderArchiveCheck(db, done.orderId, {strict: true})).reason, 'posting_incomplete', 'the sweep waits for inventory finalization');
await db.ref(`orders/${done.orderId}`).update({inventoryDeducted: true, inventoryLedgerVersion: 1});
assert.equal((await internal.orderArchiveCheck(db, done.orderId, {strict: true})).ok, true, 'a fully posted re-key is archivable by the sweep without a shift');

// 4. Forged or mismatched proof keeps the closed-shift guard.
const forged = {...order, id: 'GF-LATE-FORGED', catchupApprovalId: 'MISSING'};
await db.ref('orders/GF-LATE-FORGED').set(forged);
await assert.rejects(fx.manageOrderArchive(req({action: 'archive', orderId: 'GF-LATE-FORGED'})), /not linked to a confirmed closed shift/, 'a re-key marker without its approval is refused');
await db.ref('orders/GF-LATE-FORGED').update({catchupApprovalId: 'A1'});
await assert.rejects(fx.manageOrderArchive(req({action: 'archive', orderId: 'GF-LATE-FORGED'})), /not linked to a confirmed closed shift/, 'the genuine approval cannot vouch for a different order');
await db.ref('orders/GF-LATE-FORGED').update({catchupApprovalId: 'OTHER'});
await assert.rejects(fx.manageOrderArchive(req({action: 'archive', orderId: 'GF-LATE-FORGED'})), /not linked to a confirmed closed shift/, 'an approval for another action is refused');
await db.ref('orders/GF-LATE-FORGED').update({catchupApprovalId: '../bad'});
await assert.rejects(fx.manageOrderArchive(req({action: 'archive', orderId: 'GF-LATE-FORGED'})), /not linked to a confirmed closed shift/, 'an invalid approval key is refused');
await db.ref('orders/TILL-NOSHIFT').set({id: 'TILL-NOSHIFT', source: 'pos', channel: 'instore', status: 'Completed', paymentStatus: 'confirmed'});
await assert.rejects(fx.manageOrderArchive(req({action: 'archive', orderId: 'TILL-NOSHIFT'})), /not linked to a confirmed closed shift/, 'a till sale without a shift is still refused');

// Legacy re-keys (no order binding on the approval) need the approved reference and the
// server reference index to name the same order.
const legacy = {...order, id: 'GF-LATE-LEGACY01', platformRef: 'GF-LEGACY1', catchupApprovalId: 'LEGACY'};
assert.equal((await internal.orderArchiveCheck(fakeOrder(legacy), 'GF-LATE-LEGACY01', {})).ok, true, 'a pre-fix re-key is archivable when the reference index names it');
assert.equal((await internal.orderArchiveCheck(fakeOrder({...legacy, id: 'GF-LATE-LEGACY02'}, 'GF-LATE-LEGACY02'), 'GF-LATE-LEGACY02', {})).reason, 'shift_missing', 'a copy citing a legacy approval is refused');
assert.equal((await internal.orderArchiveCheck(fakeOrder({...legacy, platformRef: 'GF-OTHER'}), 'GF-LATE-LEGACY01', {})).reason, 'shift_missing', 'a legacy approval for another reference is refused');

// 5. The manager Archive button works for the genuine re-key and keeps it settle-able.
const archiveResult = await fx.manageOrderArchive(req({action: 'archive', orderId: done.orderId}));
assert.ok(archiveResult.archivedAt > 0, 'the manager archive completes');
assert.equal(await read(`orders/${done.orderId}`), null, 'the live record is removed');
const archived = await read(`archivedOrders/${done.orderId}`);
assert.equal(archived.status, 'Archived');
assert.equal(archived.settlementStatus, 'unsettled', 'the archived re-key stays in the unsettled payout queue');
assert.equal(archived.platformRef, 'GF-A2429BBF');

console.log('PASS: re-keyed platform orders stay out of Active Orders, are archived only after posting (sweep) or by a manager with the server-held re-key approval bound to that order, and remain settle-able; till sales keep the closed-shift guard.');
