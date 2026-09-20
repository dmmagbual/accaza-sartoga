// Sales History movement-feed consolidation (17 Sep 2026 download audit, F-1).
//
// Archived replica rows now carry compact Finance summaries. The hub keeps one live period
// feed and uses an exact-source fallback only for a legacy replica that has not been backfilled.
// This check pins the transitional shape against a recorded wire:
//   * exactly one live listener on financialMovements (the occurredAt range);
//   * zero live sourceId listeners, one one-time fetch only for the legacy archived row;
//   * the live base feed wins over a stale fetched copy of the same movement;
//   * tearing the scope down detaches the base listener.
import assert from 'node:assert/strict';
import {createSubscriptionHub} from '../assets/js/admin/realtime-hub.mjs';

const T0 = Date.parse('2026-09-15T16:00:00Z'); // 2026-09-16 00:00 in Manila (+08:00)
const T1 = Date.parse('2026-09-16T15:59:59Z'); // end of that Manila day
const PERIOD = {startAt: T0, endAt: T1};

const WORLD = {
  orders: {
    O1: {id: 'POS-1001', timestamp: T0 + 3600000, total: 200},
    O2: {id: 'POS-1002', timestamp: T0 + 7200000, total: 150},
    O_out: {id: 'POS-0999', timestamp: T0 - 86400000, total: 10}, // outside the period
  },
  historicalArchiveSync: {},
  financialMovements: {
    m1: {occurredAt: T0 + 3600000, type: 'order_sale', sourceType: 'order', sourceId: 'POS-1001', amount: 200},
    mv_dup: {occurredAt: T0 + 4000000, type: 'order_sale', sourceType: 'order', sourceId: 'POS-1001', amount: 999},
    m2: {occurredAt: T0 + 4200000, type: 'cash_deposit', amount: 40},
    // An old movement that belongs to a period order: only the per-source fetch can reach it.
    mv_old: {occurredAt: T0 - 86400000, type: 'order_sale', sourceType: 'order', sourceId: 'POS-1002', amount: 150},
    mv_unrelated: {occurredAt: T0 - 86400000, type: 'order_sale', sourceType: 'order', sourceId: 'POS-9999', amount: 7},
  },
};
const ARCHIVED_PERIOD = {A1: {id: 'POS-1003', timestamp: T0 + 5400000, total: 80}};

// A wire-recording stand-in database over the fixture, at the ops surface the hub uses.
const parts = (p) => String(p).split('/').filter(Boolean);
const keyCompare = (a, b) => /^-?\d+$/.test(a) && /^-?\d+$/.test(b) ? Number(a) - Number(b) : a < b ? -1 : a > b ? 1 : 0;
function createFake(world) {
  const listeners = [], gets = [];
  const at = (p) => parts(p).reduce((n, k) => n == null || typeof n !== 'object' ? undefined : n[k], world);
  function view(path, q) {
    const node = at(path);
    if (!q.by) return node;
    const val = (k) => q.field.split('.').reduce((n, f) => n == null || typeof n !== 'object' ? undefined : n[f], node[k]);
    let keys = Object.keys(node || {}).sort((a, b) => {
      const va = val(a), vb = val(b);
      if (va === vb) return keyCompare(a, b);
      return va == null ? -1 : vb == null ? 1 : va < vb ? -1 : 1;
    });
    if ('start' in q) keys = keys.filter((k) => { const v = val(k); return v != null && v >= q.start; });
    if ('end' in q) keys = keys.filter((k) => { const v = val(k); return v != null && v <= q.end; });
    if (q.last) keys = keys.slice(-q.last);
    if (!keys.length) return undefined;
    const out = {}; keys.forEach((k) => { out[k] = node[k]; });
    return out;
  }
  const snap = (v) => ({val: () => v === undefined ? null : v});
  const noListen = () => () => {};
  return {
    listeners, gets,
    ops: {
      ref: (_db, path) => ({path}),
      query: (target, ...mods) => Object.assign({}, target, ...mods),
      orderByChild: (field) => ({by: 'child', field}),
      limitToLast: (n) => ({last: n}),
      startAt: (start) => ({start}),
      endAt: (end) => ({end}),
      endBefore: (value, key) => ({endBefore: [value, key]}),
      onValue(target, cb) { const l = {target, cb, active: true}; listeners.push(l); cb(snap(view(target.path, target))); return () => { l.active = false; }; },
      onChildAdded: noListen, onChildChanged: noListen, onChildRemoved: noListen,
      async get(target) {
        gets.push(target);
        let v = view(target.path, target);
        // Simulate a stale one-time read for POS-1001: the fetched copy of mv_dup lags the
        // live base feed so the merge can only be right if the live feed wins.
        if (v && target.field === 'sourceId' && target.start === 'POS-1001') {
          v = JSON.parse(JSON.stringify(v));
          if (v.mv_dup) v.mv_dup.amount = 111;
        }
        return snap(v);
      },
      readHistoricalOrders: async (payload) => payload && payload.mode === 'period' ? {orders: ARCHIVED_PERIOD, hasMore: false} : {orders: {}, hasMore: false},
    },
  };
}

globalThis.window = {AccazaAdminPeriods: {get: (key) => key === 'sales' ? PERIOD : null}, addEventListener() {}};

const fake = createFake(WORLD);
const hub = createSubscriptionHub({}, fake.ops);
const fmSnapshots = [];
hub.subscribe('orders', () => {});
hub.subscribe('archivedOrders', () => {});
hub.subscribe('financialMovements', (snap) => fmSnapshots.push(snap.val() || {}));
hub.authorize();
hub.activate('saleshistory');
// Let the orders page, the archive page, and the batched source fetches all settle.
for (let i = 0; i < 12; i += 1) await new Promise((r) => setTimeout(r, 0));

// 1. One live listener on the period range; no live per-source listeners at all.
const fmListeners = fake.listeners.filter((l) => l.target.path === 'financialMovements');
assert.equal(fmListeners.length, 1, `one live movement feed remains (got ${fmListeners.length})`);
assert.equal(fmListeners[0].target.field, 'occurredAt', 'the base feed is the occurredAt range');
assert.equal(Number(fmListeners[0].target.start), T0, 'the range starts at the period start');
assert.equal(Number(fmListeners[0].target.end), T1, 'the range ends at the period end');
assert.equal(fake.listeners.filter((l) => l.target.field === 'sourceId').length, 0, 'no live sourceId fan-out remains');

// 2. Only the legacy archived row without a compact replica summary uses a source query.
const sourceGets = fake.gets.filter((g) => g.path === 'financialMovements' && g.field === 'sourceId');
const fetchedIds = sourceGets.map((g) => g.start).sort();
assert.deepEqual(fetchedIds, ['POS-1003'], 'only a legacy archived row is fetched by source ID');
assert.ok(sourceGets.every((g) => g.start === g.end), 'each fetch is the exact-id indexed range');

// 3. The merged page keeps the live period rows and excludes unrelated/out-of-period rows.
const merged = fmSnapshots[fmSnapshots.length - 1];
assert.ok(fmSnapshots.length > 0, 'the page received at least one merged snapshot');
assert.equal(merged.m1.amount, 200, 'in-period order movement arrives from the base feed');
assert.equal(merged.m2.amount, 40, 'in-period untagged movement arrives from the base feed');
assert.equal(merged.mv_dup.amount, 999, 'the live base feed wins over a stale fetched copy');
assert.ok(!('mv_old' in merged), 'active rows do not cause an out-of-period source query');
assert.ok(!('mv_unrelated' in merged), 'movements of other orders are not fetched');

// 4. Tearing the scope down detaches the base listener and stops deliveries.
const baseStop = fake.listeners.filter((l) => l.active && l.target.path === 'financialMovements');
hub.deauthorize();
assert.equal(fake.listeners.filter((l) => l.active && l.target.path === 'financialMovements').length, 0, 'deauthorize detaches the base listener');
const delivered = fmSnapshots.length;
fmListeners[0].cb({val: () => ({late: {occurredAt: T0 + 1, amount: 1}})});
for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0));
assert.equal(fmSnapshots.length, delivered, 'a late base event after teardown is not delivered');

console.log('Sales History feed consolidation: one live period feed plus one-time per-order fetches, with live precedence.');
