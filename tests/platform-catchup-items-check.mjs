// A missed Grab/FoodPanda order re-keyed from Payout Reconciliation must carry its items
// (29 Sep 2026). Amount-only entries (GF-LATE-*) booked revenue with no stock deduction and no
// cost. The items become the order's line items, so the standard order finalization deducts
// stock and records COGS like a till sale.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createFakeDatabase} from './helpers/fake-rtdb.mjs';
import {loadFunctions} from './helpers/functions-sandbox.mjs';

const require = createRequire(import.meta.url);
const realWriteSafety = require('../functions/lib/write-safety.js');
const writeSafety = {...realWriteSafety, safeAtomicUpdate: (db, writes) => realWriteSafety.safeAtomicUpdate(db, structuredClone(writes))};
const NOW = Date.parse('2026-09-29T10:00:00+08:00');
const approval = (ref, amount) => ({action: 'rekey_platform_order', sourceId: ref, amount, approvedBy: 'mgr_uid', approvedRole: 'manager', approvedName: 'Manager', expiresAt: NOW + 600000});
const db = createFakeDatabase({
  admins: {mgr_uid: 'manager'},
  menuItems: {item_006: {name: 'Spanish Latte', priceL: 290}, item_045: {name: 'Dark Chocolate Croffle', priceM: 195}},
  financialApprovals: {A1: approval('GF-111', 485), A2: approval('GF-222', 290), A3: approval('GF-333', 290)},
});
const fx = loadFunctions(db, {now: NOW, libOverrides: {'./lib/write-safety': writeSafety}}).exports;
const req = (data) => ({auth: {uid: 'mgr_uid', token: {email: 'manager@example.test'}}, data});
const base = {channel: 'grabfood', date: '2026-09-17', commission: 97, reference: 'Missed order — late entry'};

await assert.rejects(fx.recordPlatformCatchup(req({...base, platformRef: 'GF-222', gross: 290, approvalId: 'A2'})), /Enter the items/, 'an amount-only entry is refused');
await assert.rejects(fx.recordPlatformCatchup(req({...base, platformRef: 'GF-333', gross: 290, approvalId: 'A3', lineItems: [{itemKey: 'item_999', size: 'L', qty: 1}]})), /not on the menu/, 'unknown items are refused');
await assert.rejects(fx.recordPlatformCatchup(req({...base, platformRef: 'GF-333', gross: 290, approvalId: 'A3', lineItems: [{itemKey: 'item_006', size: 'XL', qty: 1}]})), /size/, 'sizes are S, M or L');

const done = await fx.recordPlatformCatchup(req({...base, platformRef: 'GF-111', gross: 485, approvalId: 'A1', lineItems: [{itemKey: 'item_006', size: 'l', qty: 1}, {itemKey: 'item_045', size: 'M', qty: 1}]}));
const order = (await db.ref(`orders/${done.orderId}`).get()).val();
assert.equal(order.status, 'Completed');
assert.deepEqual(order.lineItems.map((l) => [l.itemKey, l.size, l.qty, l.name]), [['item_006', 'L', 1, 'Spanish Latte (L)'], ['item_045', 'M', 1, 'Dark Chocolate Croffle (M)']]);
assert.equal(order.items, 'Spanish Latte (L) x1, Dark Chocolate Croffle (M) x1');
assert.equal(order.cogsSkipped, undefined, 'the order is no longer marked as skipping cost');
assert.equal(order.grossPlatform, 485); assert.equal(order.netPlatform, 388);
console.log('PASS: missed platform orders require menu items (size S/M/L, qty 1-50) and store them as line items so stock and COGS post through standard finalization.');
