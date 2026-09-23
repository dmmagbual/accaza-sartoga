import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHistoricalPeriodStore} from '../assets/js/admin/historical-period-store.mjs';

// Saved Sales History must survive reloads, reopen with zero Firestore page
// reads when nothing changed, and catch up only the exact changed orders.
const tick = async (n = 4) => { for (let i = 0; i < n; i++) await new Promise(resolve => setTimeout(resolve, 0)); };
const period = {startAt: 100, endAt: 200};
function memoryCache() {
  const map = new Map();
  return {map, async get(key) { return map.has(key) ? structuredClone(map.get(key)) : undefined; }, async put(key, value) { map.set(key, structuredClone(value)); }, async clear() { map.clear(); }};
}
function harness({cache, owner = 'owner-1', source, log = [], marker}) {
  const calls = [], changeCalls = [];
  let emitMarker = null, rows = null, meta = null, errors = [];
  const store = createHistoricalPeriodStore({
    persist: cache,
    scope: () => owner,
    watch(cb) { emitMarker = cb; queueMicrotask(() => cb(marker)); return () => {}; },
    async changes(after, to) { changeCalls.push([after, to]); return log.filter(change => change.sequence > after && change.sequence <= to); },
    async read(payload) {
      calls.push(payload);
      if (payload.mode === 'ids') return {orders: Object.fromEntries(payload.ids.filter(id => source[id]).map(id => [id, source[id]]))};
      return {orders: Object.fromEntries(Object.entries(source).filter(([, row]) => row.completedAt >= payload.startAt && row.completedAt <= payload.endAt)), hasMore: false};
    },
  });
  store.watch(period, (data, m) => { rows = data; meta = m; }, error => errors.push(error));
  return {store, calls, changeCalls, marker: m => emitMarker(m), get rows() { return rows; }, get meta() { return meta; }, errors};
}

const cache = memoryCache();
const source = {a: {id: 'a', completedAt: 110, total: 100}, b: {id: 'b', completedAt: 150, total: 50}, far: {id: 'far', completedAt: 999, total: 7}};

// 1. First open reads one page and saves it with the sequence it is current to.
const first = harness({cache, source, marker: {sequence: 5, changes: {}}});
await tick();
assert.equal(first.calls.length, 1, 'first open reads one bounded page');
assert.deepEqual(Object.keys(first.rows).sort(), ['a', 'b']);
first.store.clear();
const saved = [...cache.map.values()][0];
assert.equal(saved.sequence, 5); assert.equal(saved.scope, 'owner-1');

// 2. Reload/new tab with no sales change: zero Firestore reads, zero log reads.
const reopened = harness({cache, source, marker: {sequence: 5, changes: {}}});
await tick();
assert.equal(reopened.calls.length, 0, 'an unchanged saved period must cost zero Firestore reads');
assert.equal(reopened.changeCalls.length, 0);
assert.equal(reopened.rows.a.total, 100); assert.equal(reopened.meta.stale, false);
reopened.store.clear();

// 3. Days later, far beyond the 32-entry marker: catch up by exact order ID.
source.a = {...source.a, total: 80, refundAmount: 20};          // changed, in range
source.c = {id: 'c', completedAt: 160, total: 30};               // new, in range
delete source.b;                                                  // deleted, was in range
source.far = {...source.far, total: 8};                          // changed, outside range
const log = [
  {sequence: 6, orderId: 'a', deleted: false, salesAt: 110},
  {sequence: 7, orderId: 'c', deleted: false, salesAt: 160},
  {sequence: 8, orderId: 'b', deleted: true, salesAt: 0},
  {sequence: 9, orderId: 'far', deleted: false, salesAt: 999},
  ...Array.from({length: 60}, (_, i) => ({sequence: 10 + i, orderId: 'far', deleted: false, salesAt: 999})),
];
const caught = harness({cache, source, log, marker: {sequence: 69, changes: {}}});
await tick(8);
assert.deepEqual(caught.changeCalls, [[5, 69]], 'one durable change-log read covers the whole gap');
assert.equal(caught.calls.filter(call => call.mode === 'period').length, 0, 'catch-up must not re-read the period');
assert.deepEqual(caught.calls.map(call => call.mode), ['ids']);
assert.deepEqual(caught.calls[0].ids.sort(), ['a', 'b', 'c'], 'only orders in, or entering, the range are fetched');
assert.equal(caught.rows.a.total, 80); assert.equal(caught.rows.c.total, 30); assert.equal(caught.rows.b, undefined);
assert.equal([...cache.map.values()][0].sequence, 69, 'the saved copy advances to the caught-up sequence');
caught.store.clear();

// 4. A pruned or unwritten log row is a gap: one bounded reload, never a guess.
const gapLog = [{sequence: 70, orderId: 'a', deleted: false, salesAt: 110}, {sequence: 72, orderId: 'a', deleted: false, salesAt: 110}];
const gap = harness({cache, source, log: gapLog, marker: {sequence: 72, changes: {}}});
await tick(8);
assert.deepEqual(gap.calls.map(call => call.mode), ['period'], 'an incomplete change log reloads the watched period once');
gap.store.clear();

// 5. Another account on the same browser never sees the saved copy.
const other = harness({cache, owner: 'owner-2', source, marker: {sequence: 72, changes: {}}});
await tick();
assert.deepEqual(other.calls.map(call => call.mode), ['period'], 'saved rows are scoped to the signed-in account');
other.store.clear();

// 6. Bulk maintenance changes the cache epoch: saved copies reload once.
const retired = harness({cache, source, marker: {sequence: 72, cacheEpoch: 123, changes: {}}});
await tick(8);
assert.deepEqual(retired.calls.map(call => call.mode), ['period'], 'a new cache epoch retires saved rows');
retired.store.clear();
const afterEpoch = harness({cache, source, marker: {sequence: 72, cacheEpoch: 123, changes: {}}});
await tick(8);
assert.equal(afterEpoch.calls.length, 0, 'the reloaded copy is current to the new epoch');

// 7. Live contiguous changes patch by ID while the tab stays open.
source.c = {...source.c, total: 35};
afterEpoch.marker({sequence: 73, cacheEpoch: 123, changes: {73: {sequence: 73, orderId: 'c'}}});
await tick(6);
assert.deepEqual(afterEpoch.calls.at(-1), {mode: 'ids', ids: ['c']}); assert.equal(afterEpoch.rows.c.total, 35);

// 8. Sign-out removes every saved copy from this device.
afterEpoch.store.clear(true);
await tick();
assert.equal(cache.map.size, 0, 'sign-out must clear saved detailed sales');

// 9. A range nobody watches is dropped on a gap, not reloaded in the background.
{
  const reads = [];
  let fire;
  const store = createHistoricalPeriodStore({persist: null, scope: () => '', watch(cb) { fire = cb; queueMicrotask(() => cb({sequence: 1})); return () => {}; },
    async read(payload) { reads.push(payload); return {orders: {a: {id: 'a', completedAt: 110}}, hasMore: false}; }});
  const stop = store.watch(period, () => {}, () => {});
  await tick();
  assert.equal(reads.length, 1); stop();
  fire({sequence: 90}); await tick(6);
  assert.equal(reads.length, 1, 'unwatched ranges must not be reloaded');
}

// Server: durable change log, publish-on-change, and truthful limit messages.
const backend = fs.readFileSync('src/functions/61-historical-archive.js', 'utf8');
assert(backend.includes('if (!result.duplicate || options.publishUnchanged === true) await publishHistoricalChangeReliably'), 'unchanged refreshes must not wake every report');
assert(backend.includes('replicateHistoricalOrder(db, firestore, orderId, order, now, {publishUnchanged: true})'), 'the primary archive trigger still repairs a failed marker on retry');
const publishSource = backend.slice(backend.indexOf('async function publishHistoricalChange'), backend.indexOf('function historicalReadCursor'));
const constants = backend.slice(backend.indexOf('const HISTORICAL_CHANGE_LOG_PATH'), backend.indexOf('const HISTORICAL_CHANGE_LOG_PRUNE_EVERY'));
const writes = {};
let marker = {cacheEpoch: 77};
const db = {ref(path) { return {
  async transaction(update) { if (path === '/historicalArchiveSync') { marker = update(marker); return {committed: true, snapshot: {val: () => marker}}; } throw new Error('unexpected ' + path); },
  async set(value) { writes[path] = value; },
  orderByKey() { return this; }, endAt() { return this; }, limitToFirst() { return this; }, async get() { return {forEach() {}}; }, async update() {},
}; }};
const context = {HistoricalArchive: {salesAt: order => order.completedAt}, Date, Number, String, Math, Object};
vm.createContext(context);
vm.runInContext(constants + 'const HISTORICAL_CHANGE_LOG_PRUNE_EVERY = 100;\n' + publishSource, context);
await context.publishHistoricalChange(db, 'order-1', {completedAt: 150}, 1000);
assert.deepEqual(JSON.parse(JSON.stringify(writes['/historicalArchiveChanges/000000000001'])), {sequence: 1, orderId: 'order-1', deleted: false, salesAt: 150, at: 1000}, 'each change is written to the durable, ordered log');
assert.equal(marker.cacheEpoch, 77, 'publishing must preserve the cache epoch');

const budgetSource = backend.slice(backend.indexOf('async function reserveHistoricalReadBudget'), backend.indexOf('async function reserveHistoricalRollupReadBudget'));
class HttpsError extends Error { constructor(code, message, details) { super(message); this.code = code; this.details = details; } }
function budgetDb(state) { return {ref() { return {async transaction(update) { const next = update(state); return next ? {committed: true, snapshot: {val: () => next}} : {committed: false, snapshot: {val: () => state}}; }}; }}; }
const budget = {HttpsError, Intl, Date, Math, Number, String, Object};
vm.createContext(budget);
vm.runInContext('const HISTORICAL_USER_DAILY_READ_LIMIT = 2000; const HISTORICAL_USER_BURST_READ_LIMIT = 200; const HISTORICAL_USER_BURST_WINDOW_MS = 60000;\n' + budgetSource + '\nthis.reserve = reserveHistoricalReadBudget;', budget);
const today = Object.fromEntries(new Intl.DateTimeFormat('en-US', {timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(new Date()).map(part => [part.type, part.value]));
const day = `${today.year}-${today.month}-${today.day}`;
await assert.rejects(() => budget.reserve(budgetDb({day, reads: 1990, windowStartedAt: Date.now(), windowReads: 0}), 'u', 100, {page: true}),
  error => error.details.reason === 'daily' && /Manila time/.test(error.message) && !/one minute/.test(error.message));
await assert.rejects(() => budget.reserve(budgetDb({day, reads: 300, windowStartedAt: Date.now(), windowReads: 150}), 'u', 100, {page: true}),
  error => error.details.reason === 'burst' && error.details.retryAfterMs <= 60000 && /seconds/.test(error.message));

const rules = fs.readFileSync('database.rules.json', 'utf8');
assert(/"historicalArchiveChanges": \{ "\.indexOn": \["sequence"\], "\.read": "auth != null && root\.child\('admins'\)/.test(rules) && /"historicalArchiveChanges":[^\n]*"\.write": false/.test(rules), 'the change log is management-readable, indexed, and server-write-only');
const hub = fs.readFileSync('assets/js/admin/realtime-hub.mjs', 'utf8');
assert(hub.includes("ref(database,'historicalArchiveChanges'),orderByChild('sequence'),startAt(after+1),endAt(to)"), 'the hub reads only the missing change-log window');
console.log('PASS: Sales History reopens from the saved copy with zero page reads, catches up exact changed orders from the durable change log, reloads only watched ranges on a gap, is account-scoped and cleared at sign-out, and the server reports which read limit applies and when it resets.');
