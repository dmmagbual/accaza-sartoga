// The three /posActiveShift triggers were merged into onPosActiveShiftWritten (31 Oct 2026) to stop
// three instance starts per shift write. This proves the merged trigger keeps each part's
// behaviour, skips work when the relevant field did not change, and keeps the parts independent.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';

const source = fs.readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
const slice = (from, to) => { const a = source.indexOf(from), b = source.indexOf(to, a); assert.ok(a >= 0 && b > a, `missing ${from}`); return source.slice(a, b + to.length); };
const code = [
  slice('function resolveRegisterFloat(settings, activeShift) {', '\n}\n'),
  slice('function activeShiftFloatRaw(shift) {', '\n}\n'),
  slice('async function syncActiveRegisterCashFloat(db, beforeShift, afterShift, at) {', '\n}\n'),
  slice('async function pruneClosedShiftOrders(db, before, after) {', '\n}\n'),
  slice('const PUBLIC_ORDER_STATUS_REFRESH_MS = ', '\n}\n'),
  slice('exports.onPosActiveShiftWritten = onValueWritten(', '\n);\n'),
].join('\n');
const Financial = createRequire(import.meta.url)('../functions/lib/financial.js');

function harness({store = {}, failPublic = false} = {}) {
  const calls = {settingsReads: 0, floatPosts: [], sets: [], updates: [], orderQueries: 0, statusReads: 0, errors: []};
  const db = {
    ref(path) {
      return {
        async get() { if (path === '/publicOrderStatus') { calls.statusReads++; if (failPublic) throw new Error('status read failed'); } return {val: () => store[path] ?? null}; },
        async set(value) { calls.sets.push([path, value]); store[path] = value; },
        async update(value) { calls.updates.push(value); },
        orderByChild() { return {equalTo: (id) => ({get: async () => { calls.orderQueries++; const rows = Object.entries(store.orders || {}).filter(([, o]) => o.shiftId === id); return {forEach: (fn) => rows.forEach(([key, val]) => fn({key, val: () => val}))}; }})}; },
      };
    },
  };
  const exportsObj = {};
  const deps = {
    exports: exportsObj, onValueWritten: (_opts, handler) => handler, ORDER_REGION: 'asia-southeast1', getDatabase: () => db,
    logger: {error: (...args) => calls.errors.push(args)}, Financial,
    readPosSettings: async () => { calls.settingsReads++; return store.settings || {}; },
    postRegisterFloatTarget: async (_db, control, _at, action) => { calls.floatPosts.push([control.amount, action]); return 1; },
    liveRegisterFloat: async () => ({amount: 5000, source: 'live'}),
    shouldProjectOrder: (order) => order.status !== 'completed', isPlatformRekeyOrder: () => false,
    archivedOrderRecord: (order) => ({...order, archived: true}),
  };
  new Function(...Object.keys(deps), code)(...Object.values(deps));
  const run = (before, after) => exportsObj.onPosActiveShiftWritten({data: {before: {val: () => before}, after: {val: () => after, exists: () => after != null}}});
  return {run, calls, store};
}

// 1. A routine same-shift write (e.g. totals) with the status already published: no settings read,
//    no order query, no status rewrite, no float posting.
{
  const h = harness({store: {'/publicOrderStatus': {acceptingOrders: true, updatedAt: Date.now()}}});
  await h.run({id: 's1', status: 'open', openingFloat: 4000, total: 1}, {id: 's1', status: 'open', openingFloat: 4000, total: 2});
  assert.equal(h.calls.settingsReads, 0); assert.equal(h.calls.orderQueries, 0);
  assert.deepEqual(h.calls.sets, []); assert.deepEqual(h.calls.floatPosts, []);
}
// 2. Shift closes and a new one opens with a different float: status published, float re-posted
//    from the live float, previous shift's finished POS orders archived.
{
  const h = harness({store: {'/publicOrderStatus': {acceptingOrders: true, updatedAt: Date.now()}, orders: {o1: {shiftId: 's1', source: 'pos', status: 'completed'}, o2: {shiftId: 's1', source: 'pos', status: 'preparing'}}}});
  await h.run({id: 's1', status: 'open', openingFloat: 4000}, {id: 's2', status: 'closed', openingFloat: 5000});
  assert.deepEqual(h.calls.sets.map(([p, v]) => [p, v.acceptingOrders]), [['/publicOrderStatus', false]]);
  assert.deepEqual(h.calls.floatPosts, [[5000, 'register_float_synced']]);
  assert.equal(h.calls.updates.length, 1);
  assert.deepEqual(Object.keys(h.calls.updates[0]).sort(), ['activeOrders/o1', 'archivedOrders/o1', 'orders/o1']);
}
// 3. Same float amount on a new shift posts nothing (fixed float setting wins on both sides).
{
  const h = harness({store: {'/publicOrderStatus': {acceptingOrders: true, updatedAt: Date.now()}, settings: {fixedFloat: 4000}}});
  await h.run({id: 's1', status: 'open', retainedFloat: 3000}, {id: 's2', status: 'open', retainedFloat: 3500});
  assert.equal(h.calls.settingsReads, 1); assert.deepEqual(h.calls.floatPosts, []);
}
// 4. Missing or drifted /publicOrderStatus is repaired; shift removal publishes closed.
{
  const h = harness();
  await h.run({id: 's1', status: 'open'}, {id: 's1', status: 'open'});
  assert.equal(h.calls.sets[0][1].acceptingOrders, true);
  const g = harness({store: {'/publicOrderStatus': {acceptingOrders: true, updatedAt: Date.now()}}});
  await g.run({id: 's1', status: 'open', openingFloat: 4000}, null);
  assert.equal(g.calls.sets[0][1].acceptingOrders, false);
}
// 4b. A same-value status older than 12 hours is refreshed for System Health's freshness check;
//     a recent one is left alone.
{
  const h = harness({store: {'/publicOrderStatus': {acceptingOrders: true, updatedAt: Date.now() - 13 * 3600000}}});
  await h.run({id: 's1', status: 'open'}, {id: 's1', status: 'open'});
  assert.equal(h.calls.sets.length, 1);
  const g = harness({store: {'/publicOrderStatus': {acceptingOrders: true, updatedAt: Date.now() - 3600000}}});
  await g.run({id: 's1', status: 'open'}, {id: 's1', status: 'open'});
  assert.equal(g.calls.sets.length, 0);
}
// 4c. The early exit never skips a float change the old trigger would have posted: compare the old
//     decision (always read settings, compare resolved amounts) with the new one across tricky inputs.
{
  const floats = [undefined, null, 0, -50, 'abc', '4000', 4000, 4000.004, 4000.01, 0.004, NaN, 3500];
  const shifts = [null, {}];
  for (const a of floats) for (const b of floats) shifts.push({retainedFloat: a, openingFloat: b});
  for (const fixedFloat of [undefined, 0, -1, 4000, 'x']) {
    for (const before of shifts) for (const after of shifts.slice(0, 40)) {
      const h = harness({store: {'/publicOrderStatus': {acceptingOrders: true, updatedAt: Date.now()}, settings: {fixedFloat}}});
      await h.run(before, after && {...after, status: 'open'});
      const m = (s) => { s = s || {}; const r = s.retainedFloat != null ? s.retainedFloat : s.openingFloat; return Financial.money(fixedFloat) > 0 && fixedFloat != null ? Financial.money(fixedFloat) : (Financial.money(r) > 0 ? Financial.money(r) : 4000); };
      const oldPosts = Math.abs(m(before) - m(after && {...after, status: 'open'})) >= 0.005;
      assert.equal(h.calls.floatPosts.length, oldPosts ? 1 : 0, `float decision changed for ${JSON.stringify({before, after, fixedFloat})}`);
    }
  }
}
// 5. Parts stay independent: a failing status update does not stop float posting or cleanup, and
//    the failure is still reported.
{
  const h = harness({failPublic: true, store: {orders: {o1: {shiftId: 's1', source: 'pos', status: 'completed'}}}});
  await assert.rejects(() => h.run({id: 's1', status: 'open', openingFloat: 4000}, {id: 's2', status: 'open', openingFloat: 6000}), /status read failed/);
  assert.deepEqual(h.calls.floatPosts, [[5000, 'register_float_synced']]);
  assert.equal(h.calls.updates.length, 1);
  assert.equal(h.calls.errors.length, 1);
}
console.log('POS active-shift trigger checks passed: one trigger, unchanged behaviour, early exits, independent parts.');
