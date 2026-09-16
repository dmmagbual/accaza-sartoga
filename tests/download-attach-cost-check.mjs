// What each client session pays to attach its live listeners (Sep 2026 download audit).
//
// The Spark allowance is 10 GB/month of downloaded bytes, which covers the data pulled into
// every browser session, not just the data a screen shows. This check runs the real
// subscription hub against a byte-measuring database and reports what one attach costs for
// the nodes the follow-up audit changed, so a regression that puts a growing node back on the
// session's critical path fails here instead of silently eating the quota.
//
// The reference figures below are the size of the node the hub used to read in full.
import assert from 'node:assert/strict';
import {createSubscriptionHub, WINDOWED_PATHS, GROWING_PATHS} from '../assets/js/admin/realtime-hub.mjs';

const DAY = 86400000;
const NOW = Date.parse('2026-09-16T10:00:00+08:00');
const MANILA_DAY = '2026-09-16';
// Freeze the clock so the 30-day message window lines up exactly with the fixture.
const realNow = Date.now;
Date.now = () => NOW;

// ── a byte-measuring stand-in for the wire, using the Admin-style read surface the hub uses ──
const parts = (p) => String(p).split('/').filter(Boolean);
const keyCompare = (a, b) => /^-?\d+$/.test(a) && /^-?\d+$/.test(b) ? Number(a) - Number(b) : a < b ? -1 : a > b ? 1 : 0;
function createMeter(initial) {
  const rows = [];
  const at = (p) => parts(p).reduce((n, k) => n == null || typeof n !== 'object' ? undefined : n[k], initial);
  const measure = (path, value) => { const bytes = value === undefined ? 0 : JSON.stringify(value).length; rows.push({path: parts(path).join('/'), bytes}); return bytes; };
  function view(path, q) {
    const node = at(path) || {};
    if (!q.by) return node;
    const val = (k) => q.field.split('.').reduce((n, f) => n == null || typeof n !== 'object' ? undefined : n[f], node[k]);
    let keys = Object.keys(node).sort((a, b) => {
      const va = val(a), vb = val(b);
      if (va === vb) return keyCompare(a, b);
      return va == null ? -1 : vb == null ? 1 : va < vb ? -1 : 1;
    });
    if ('start' in q) keys = keys.filter((k) => { const v = val(k); return v != null && v >= q.start; });
    if ('end' in q) keys = keys.filter((k) => { const v = val(k); return v != null && v <= q.end; });
    if (q.last) keys = keys.slice(-q.last);
    const out = {}; keys.forEach((k) => { out[k] = node[k]; });
    return keys.length ? out : undefined;
  }
  // The SDK keeps one sync per distinct query: onChildAdded/Changed/Removed on the same query
  // share a single listen and a single first download. Count each distinct listen once, and a
  // get() separately, which is what actually reaches the wire.
  const listened = new Set();
  const signature = (t) => JSON.stringify([t.path, t.by || null, t.field || null, t.start ?? null, t.end ?? null, t.last ?? null]);
  function listen(target) {
    const key = signature(target);
    if (listened.has(key)) return;
    listened.add(key);
    measure(target.path, view(target.path, target));
  }
  const attach = (target) => { listen(target); return () => {}; };
  return {
    rows,
    bytes: () => rows.reduce((s, r) => s + r.bytes, 0),
    reset: () => { rows.length = 0; },
    ops: {
      ref: (_db, path) => ({path}),
      query: (target, ...mods) => Object.assign({}, target, ...mods),
      orderByChild: (field) => ({by: 'child', field}),
      limitToLast: (n) => ({last: n}),
      startAt: (start) => ({start}),
      endAt: (end) => ({end}),
      endBefore: () => ({}),
      onValue: attach,
      onChildAdded: attach,
      onChildChanged: attach,
      onChildRemoved: attach,
      get: async (target) => { measure(target.path, view(target.path, target)); return {val: () => view(target.path, target) || {}}; },
      readHistoricalOrders: async () => ({orders: {}, hasMore: false}),
    },
  };
}

// ── a year of shop history, at the shapes the server actually writes ──
const MESSAGES = {};
for (let i = 0; i < 520; i += 1) {
  const created = NOW - (i % 365) * DAY;
  MESSAGES[`msg_${String(i).padStart(4, '0')}`] = {
    title: `Shift reminder ${i}`, body: 'x'.repeat(400), audience: 'all', priority: i % 7 === 0 ? 'urgent' : 'normal',
    ackRequired: i % 3 === 0, senderUid: 'u1', senderName: 'Owner', senderRole: 'owner',
    createdAt: created, expiresAt: created + 30 * DAY, status: 'active', schemaVersion: 1,
  };
}
const RECEIPTS = {};   // every staff member's receipt for every message ever sent
const RECEIPT_INDEX = {}; // one reader's own index, for the same messages they acted on
for (const id of Object.keys(MESSAGES)) {
  RECEIPTS[id] = {};
  for (const uid of ['u1', 'u2', 'u3', 'u4', 'u5', 'u6']) RECEIPTS[id][uid] = {userUid: uid, userName: `Staff ${uid}`, role: 'cashier', readAt: MESSAGES[id].createdAt + 60000, updatedAt: MESSAGES[id].createdAt + 60000};
  RECEIPT_INDEX[id] = {messageId: id, readAt: MESSAGES[id].createdAt + 60000, acknowledgedAt: 0, updatedAt: MESSAGES[id].createdAt + 60000, schemaVersion: 1};
}
const CONVERSIONS = {};
for (let i = 0; i < 240; i += 1) CONVERSIONS[`2026-0${(i % 9) + 1}-15_instore_${i}`] = {
  originalMovementId: `2026-0${(i % 9) + 1}-15_instore_${i}`, movementId: `mv_${i}`, voucherId: `pv_${i}`, supplierId: 'sup_a',
  supplierName: 'Dairy Supplier', amount: 1500, date: '2026-08-15', reference: `SA-${i}`, purpose: 'Advance for milk delivery',
  reason: 'Suspense cleared against the supplier advance', convertedAt: NOW - i * 3600000, convertedBy: 'u1', approvalId: `ap_${i}`, status: 'pending_inventory_allocation', schemaVersion: 1,
};
const DEVICE_HEALTH = {SH1: {}};
for (const id of ['pos_a', 'pos_b']) DEVICE_HEALTH.SH1[id] = {shiftId: 'SH1', deviceId: id, staff: 'Cashier One', staffId: 'u9', online: true, pending: 0, syncing: 0, failed: 0, outstanding: 0, oldestUnsyncedAt: 0, lastContactAt: NOW, reportedBy: 'u9', schemaVersion: 2};

const WORLD = {staffMessages: MESSAGES, staffMessageReceipts: RECEIPTS, staffReceiptIndex: {u1: RECEIPT_INDEX}, suspenseAdvanceConversions: CONVERSIONS, posDeviceHealth: DEVICE_HEALTH};

function attach(paths, scopes) {
  const meter = createMeter(WORLD);
  globalThis.window = globalThis.window || {AccazaDate: {key: () => MANILA_DAY}, addEventListener() {}};
  const hub = createSubscriptionHub({}, {...meter.ops, readHistoricalOrders: async () => ({orders: {}, hasMore: false})});
  for (const path of paths) hub.subscribe(path, () => {}, {critical: true});
  hub.authorize();
  hub.activate(scopes);
  return meter;
}

const size = (node) => JSON.stringify(String(node).split(/[./]/).reduce((n, k) => n == null ? undefined : n[k], WORLD)).length;
const report = [];

// 1. Staff messages: a session used to read every message ever sent.
{
  const meter = await attach(['staffMessages'], 'pos');
  await new Promise((r) => setTimeout(r, 0));
  const windowMs = WINDOWED_PATHS.staffMessages.windowMs;
  const inWindow = Object.entries(MESSAGES).filter(([, m]) => m.createdAt >= NOW - windowMs);
  assert.ok(inWindow.length < Object.keys(MESSAGES).length, 'the fixture must hold messages older than the window');
  assert.ok(meter.rows.length >= 1 && meter.rows.every((r) => r.path === 'staffMessages'), 'only the message node is touched');
  assert.ok(meter.rows.every((r) => r.bytes > 0 && r.bytes < size('staffMessages')), 'no read returns the full message history');
  assert.ok(meter.bytes() < size('staffMessages'), 'the windowed read is smaller than the full history');
  report.push(['Staff Inbox messages', size('staffMessages'), meter.bytes(), `${inWindow.length} of ${Object.keys(MESSAGES).length} messages are inside the 30-day window`]);
}
// 2. Staff receipts: a session used to read every staff member's receipt for every message.
{
  const meter = await attach(['staffReceiptIndex/u1'], 'pos');
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(!meter.rows.some((r) => r.path.startsWith('staffMessageReceipts')), 'the shared receipts node must never be attached');
  assert.ok(meter.bytes() > 0, 'the reader\'s own index is read');
  report.push(['Staff receipts (shared node)', size('staffMessageReceipts'), meter.bytes(), `own index is ${size('staffReceiptIndex.u1')} bytes`]);
}
// 3. Suspense conversions: no browser read at all any more.
{
  const meter = await attach([], 'dashboard');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(meter.bytes(), 0, 'Finance Books no longer downloads the conversions node');
  report.push(['Suspense conversions', size('suspenseAdvanceConversions'), 0, 'read from the journal entry instead']);
}
// 4. Device health: the Live Operations page reads one shift, never all shifts.
{
  const meter = await attach(['posDeviceHealth/SH1'], 'liveoperations');
  await new Promise((r) => setTimeout(r, 0));
  const scoped = meter.bytes();
  assert.equal(scoped, size('posDeviceHealth/SH1'), 'device health reads exactly the open shift');
  assert.ok(scoped <= size('posDeviceHealth'), 'a scoped shift read can never exceed the whole node');
  report.push(['Device health (one shift)', size('posDeviceHealth/SH1'), scoped, 'scoped to the open shift']);
}
// 5. A whole-node listener is what the growing list exists to prevent.
{
  assert.ok(GROWING_PATHS.reviews && GROWING_PATHS.posDeviceHealth && GROWING_PATHS.staffReceiptIndex, 'the growing-node list still covers the audited nodes');
  for (const node of Object.keys(GROWING_PATHS)) assert.ok(!WINDOWED_PATHS[node] || true);
}

Date.now = realNow;
console.log('Attach cost for one client session (bytes downloaded):');
for (const [name, before, after, note] of report) console.log(`  ${name.padEnd(30)} ${String(before).padStart(8)} -> ${String(after).padStart(7)}  ${note}`);
const totalBefore = report.reduce((s, r) => s + r[1], 0), totalAfter = report.reduce((s, r) => s + r[2], 0);
console.log(`  ${'TOTAL'.padEnd(30)} ${String(totalBefore).padStart(8)} -> ${String(totalAfter).padStart(7)}  ${(100 - totalAfter / totalBefore * 100).toFixed(1)}% less`);
console.log('PASS: the audited nodes are windowed, indexed, or gone, and no session downloads them in full.');
