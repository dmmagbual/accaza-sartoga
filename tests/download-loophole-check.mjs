// Regression guards for the 16 Sep 2026 download audit (Admin/POS, Finance Books, server).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {createSubscriptionHub} from '../assets/js/admin/realtime-hub.mjs';
import {reconcileInventoryBooks, journalBasisThrough} from '../assets/js/admin/inventory-books-reconciliation.mjs';

const require = createRequire(import.meta.url);
const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

// 1. readHistoricalOrders serves every current-schema replica from Firestore, verified or not.
{
  const historical = require('../functions/lib/historical-archive.js');
  const backend = read('src/functions/61-historical-archive.js');
  const rtdbReads = [];
  const doc = (id, verified) => ({id, exists: true, data: () => ({schemaVersion: historical.SCHEMA_VERSION, evidence: {verified}, order: {id, total: 50, proof: 'private'}})});
  const server = {exports: {}, ORDER_REGION: 'test', ENFORCE_APP_CHECK: false, Date, HistoricalArchive: historical, FieldPath: {documentId: () => '__id__'},
    onValueWritten: (_o, h) => h, onCall: (_o, h) => h, logger: {info() {}},
    financeText: (v, n) => String(v || '').slice(0, n), HttpsError: class extends Error {constructor(code, message) {super(message); this.code = code;}},
    requirePortalPermission: async () => ({uid: 'u'}),
    getDatabase: () => ({ref(path) {rtdbReads.push(path); return {get: async () => ({val: () => ({id: path.split('/').at(-1), total: 1})})};}}),
    getFirestore: () => ({collection: () => ({doc: (id) => ({id})}), getAll: async (...refs) => refs.map((r) => r.id === 'gone' ? {id: r.id, exists: false} : doc(r.id, r.id === 'verified'))}),
  };
  vm.createContext(server); vm.runInContext(backend, server);
  const result = await server.exports.readHistoricalOrders({data: {mode: 'ids', ids: ['verified', 'legacy', 'unsettled', 'gone']}});
  assert.equal(result.orders.legacy.total, 50, 'unverified replicas are served from Firestore');
  assert.equal(result.orders.unsettled.total, 50);
  assert(!result.orders.legacy.proof, 'binary proof fields stay omitted');
  assert.deepEqual(rtdbReads, ['/archivedOrders/gone'], 'only a missing replica may fall back to RTDB');
}

// 2-4. Hub: tab switches keep unchanged queries, archive changes patch by ID, journal is month-bounded.
{
  const listeners = [], historicalCalls = [];
  const ops = {
    ref: (_db, path) => ({path}), query: (target, ...parts) => Object.assign({}, target, ...parts),
    orderByChild: (field) => ({field}), limitToLast: (limit) => ({limit}), startAt: (start) => ({start}), endAt: (end) => ({end}), endBefore: () => ({}),
    onValue(target, callback) {const l = {target, callback, stopped: false}; listeners.push(l); queueMicrotask(() => {if (!l.stopped) callback({val: () => target.path === 'historicalArchiveSync' ? {sequence: 5} : {}});}); return () => {l.stopped = true;};},
    onChildAdded: () => () => {}, onChildChanged: () => () => {}, onChildRemoved: () => () => {},
    get: async () => ({val: () => ({})}),
    readHistoricalOrders: async (payload) => {historicalCalls.push(payload); return {orders: payload.mode === 'ids' ? Object.fromEntries(payload.ids.map((id) => [id, {id, total: 9}])) : {a: {id: 'a'}}, hasMore: false};},
  };
  globalThis.window = {AccazaDate: {key: () => '2026-09-16'}, addEventListener() {}};
  const hub = createSubscriptionHub({}, ops);
  const got = {};
  for (const path of ['financialMovements', 'cfLedger', 'archivedOrders', 'books/journal', 'books/monthlyNet']) hub.subscribe(path, (s) => {got[path] = s.val();});
  hub.authorize(); hub.activate('cashflow'); await tick(); await tick();
  const active = (path) => listeners.filter((l) => l.target.path === path && !l.stopped);
  const fmListener = active('financialMovements')[0];
  assert(fmListener, 'cash flow attaches financial movements');
  hub.activate('payables'); await tick();
  assert.equal(active('financialMovements')[0], fmListener, 'switching between tabs with the same query keeps the listener');
  assert.equal(active('cfLedger').length, 0, 'queries the new tab does not use are detached');
  hub.activate('cashflow'); await tick(); await tick();
  const archiveCallsBefore = historicalCalls.length;
  const marker = active('historicalArchiveSync').at(-1);
  marker.callback({val: () => ({sequence: 7, changes: {6: {sequence: 6, orderId: 'x'}, 7: {sequence: 7, orderId: 'y'}}})}); await tick(); await tick();
  assert.deepEqual(historicalCalls.slice(archiveCallsBefore), [{mode: 'ids', ids: ['x', 'y']}], 'an archive change reads only the changed orders');
  assert.equal(got.archivedOrders.y.total, 9);
  marker.callback({val: () => ({sequence: 20, changes: {20: {sequence: 20, orderId: 'z'}}})}); await tick(); await tick();
  assert.equal(historicalCalls.at(-1).mode, 'latest', 'a gap in the change journal reloads the latest page');
  hub.activate('stockvalue'); await tick();
  const journal = active('books/journal')[0];
  assert(journal && journal.target.field === 'date' && journal.target.start === '2026-09-01', 'Stock Value holds only the current month of journal rows live');
  assert(active('books/monthlyNet')[0], 'Stock Value subscribes to the monthly journal totals');
  hub.activate('pos'); await tick();
  assert.equal(listeners.filter((l) => l.target.path !== 'historicalArchiveSync' && !l.stopped && !['.info/connected'].includes(l.target.path)).length, 0, 'leaving report tabs still detaches their queries');
  hub.deauthorize(); delete globalThis.window;
}

// 5. Stock Value journal basis equals the full journal for current- and past-month cutoffs.
{
  const source = read('src/admin/analytics/60-inventory-valuation.js');
  const start = source.indexOf('function inventoryBooksMonthKey'), end = source.indexOf('function inventoryReconciliationHtml');
  const journal = {
    a1: {date: '2026-07-20', lines: [{code: '1200', debit: 500, credit: 0}, {code: '2000', debit: 0, credit: 500}]},
    d1: {date: '2026-08-02', net: {'1200': -120.5, '1210': 40}},
    d2: {date: '2026-08-20', lines: [{code: '1210', debit: 0, credit: 15.25}, {code: '1290', debit: 3, credit: 0}]},
    s1: {date: '2026-09-03', net: {'1200': -30}}, s2: {date: '2026-09-15', lines: [{code: '1220', debit: 12, credit: 0}]},
  };
  const monthly = {};
  for (const e of Object.values(journal)) {const m = e.date.slice(0, 7), t = monthly[m] || (monthly[m] = {}); const net = e.net || e.lines.reduce((o, l) => {o[l.code] = (o[l.code] || 0) + l.debit - l.credit; return o;}, {}); for (const c of Object.keys(net)) t[c] = Math.round(((t[c] || 0) + net[c]) * 100) / 100;}
  const rendered = [];
  const ctx = {journalBasisThrough, window: {AccazaDate: {key: () => '2026-09-16'}, __accaza: {readBooksJournalRange: async (from, to) => Object.fromEntries(Object.entries(journal).filter(([, e]) => e.date >= from && e.date <= to))}}, console, Intl, JSON, Object, String,
    isTab: () => true, renderStockValue: () => rendered.push(1),
    inventoryBooksJournal: Object.fromEntries(Object.entries(journal).filter(([, e]) => e.date >= '2026-09-01')), inventoryBooksMonthly: monthly, inventoryBooksPastMonth: {key: '', rows: null}};
  vm.createContext(ctx); vm.runInContext(source.slice(start, end), ctx);
  const full = Object.entries(journal).map(([id, e]) => ({id, ...e}));
  const values = (rows, cutoff) => reconcileInventoryBooks([], rows, cutoff).rows.map((r) => r.booksValue);
  for (const cutoff of ['2026-09-16', '2026-09-10', '2026-09-02']) assert.deepEqual(values(ctx.inventoryBooksEntriesThrough(cutoff), cutoff), values(full, cutoff), `current-month cutoff ${cutoff}`);
  assert.equal(ctx.inventoryBooksEntriesThrough('2026-08-10'), null, 'a past-month cutoff waits for its month rows');
  await tick(); await tick();
  assert.deepEqual(values(ctx.inventoryBooksEntriesThrough('2026-08-10'), '2026-08-10'), values(full, '2026-08-10'), 'past-month cutoff');
  assert(rendered.length >= 1);
}

// 6. Finance Books, rules and server guards.
{
  const books = read('assets/js/books/live-pos.mjs');
  assert(!books.includes('query(ref(db,"/archivedOrders"),orderByChild("settlementStatus"),equalTo(null))'), 'Books must not download every in-store archived order');
  assert(books.includes('query(ref(db,"/archivedOrders"),orderByChild("settlementStatus"),equalTo("unsettled"))'));
  for (const marker of ['function syncInsightsOrders()', "httpsCallable(fns,\"readHistoricalOrders\")", "mode:'period'", 'resetInsightsOrders();']) assert(books.includes(marker), `Books insights loader missing: ${marker}`);
  assert(read('src/books/business-intelligence.js').includes('window.__booksInsightsOrders'), 'Insights uses the on-demand history');
  assert(read('database.rules.json').includes('"archivedOrders":       { ".indexOn": ["archivedAt", "timestamp", "completedAt", "receivedAt", "shiftId", "settlementStatus"]'), 'archivedOrders.settlementStatus must be indexed');
  const functions = read('functions/index.js');
  assert(functions.includes('await db.ref("/financialMovements").orderByChild("sourceId").equalTo(String(order.id || "")).get()'), 'full-void netting reads only the order movements');
  assert(!/async function fullOrderVoidMovement[\s\S]{0,200}db\.ref\("\/financialMovements"\)\.get\(\)/.test(functions));
  assert(read('functions/lib/offline-sync.js').includes('platform && !raw.settlementStatus ? {settlementStatus: "unsettled"} : {}'), 'platform sales must carry an explicit settlement state');
  assert(read('assets/js/admin/core.mjs').includes('readBooksJournalRange:function(from,to)'));
}
// 7. Inventory idempotency state stays bounded: legacy copies migrate to markers, projected
// duplicates never move stock, and old markers are pruned.
{
  const functions = read('functions/index.js');
  const start = functions.indexOf('const INVENTORY_MOVEMENT_TYPES'), end = functions.indexOf('exports.postInventoryMovements', start);
  const api = vm.runInNewContext(`(function(){${functions.slice(start, end)};return {applyInventoryMovement, INVENTORY_APPLIED_RETENTION_MS};})()`, {HttpsError: class extends Error {}, money: (v) => Math.round((Number(v) || 0) * 100) / 100, console});
  const day = 86400000, now = Date.now();
  const legacyCopy = (id, qty, ageDays) => ({id, itemId: 'cup', qty, unitCost: 2, createdAt: now - ageDays * day, occurredAt: now - ageDays * day, type: 'sale_usage'});
  const applied = {};
  for (let i = 0; i < 300; i++) applied[`sale_old${i}_cup`] = legacyCopy(`sale_old${i}_cup`, -1, 30);
  applied.sale_recent_cup = {projectedAt: now - day, version: 301};
  applied.sale_stale_marker_cup = {projectedAt: now - 30 * day, version: 5};
  const state = {inventory: {cup: {name: 'Cup', unit: 'pc', stock: 700, cost: 2, inventoryAccount: '1230', costAccount: '5030'}}, inventoryAccounting: {cup: {balance: 700, unitCost: 2, version: 302, applied}}, inventoryMovements: {}};
  for (let i = 0; i < 300; i++) if (i % 3) state.inventoryMovements[`sale_old${i}_cup`] = legacyCopy(`sale_old${i}_cup`, -1, 30);
  const parts = (path) => String(path || '').split('/').filter(Boolean);
  const get = (path) => parts(path).reduce((cur, key) => cur == null ? undefined : cur[key], state);
  const put = (path, value) => {const keys = parts(path); let cur = state; for (let i = 0; i < keys.length - 1; i++) cur = cur[keys[i]] || (cur[keys[i]] = {}); if (value === null) delete cur[keys.at(-1)]; else cur[keys.at(-1)] = structuredClone(value);};
  let transactionBytes = 0;
  const db = {ref(path = '') {return {
    async get() {const v = get(path); return {val: () => structuredClone(v), exists: () => v != null};},
    async set(v) {put(path, v);}, async update(u) {for (const [k, v] of Object.entries(u)) put([...parts(path), ...parts(k)].join('/'), v);},
    async transaction(fn) {const cur = structuredClone(get(path)); if (String(path).includes('inventoryAccounting')) transactionBytes += JSON.stringify(cur || {}).length; const next = fn(cur); if (next === undefined) return {committed: false, snapshot: {val: () => cur}}; put(path, next); return {committed: true, snapshot: {val: () => structuredClone(next)}};},
  };}};
  const actor = {uid: 'server', role: 'server'};
  const first = await api.applyInventoryMovement(db, {movementId: 'sale_new1_cup', itemId: 'cup', type: 'sale_usage', qty: -2, sourceType: 'order', sourceId: 'new1'}, actor);
  assert.equal(first.duplicate, false);
  assert.equal(state.inventoryAccounting.cup.balance, 698);
  const keys = Object.keys(state.inventoryAccounting.cup.applied);
  assert(!keys.some((k) => k.startsWith('sale_old')), 'legacy copies older than the retention window are pruned after their projections are confirmed');
  assert(!keys.includes('sale_stale_marker_cup') && keys.includes('sale_recent_cup'), 'only markers older than the retention window are pruned');
  assert.deepEqual(state.inventoryAccounting.cup.applied.sale_new1_cup && Object.keys(state.inventoryAccounting.cup.applied.sale_new1_cup).sort(), ['projectedAt', 'version'], 'a projected movement keeps only a marker');
  for (let i = 0; i < 300; i++) assert(state.inventoryMovements[`sale_old${i}_cup`], 'missing legacy projections are restored before their copies are removed');
  assert(JSON.stringify(state.inventoryAccounting.cup).length < 1000, 'item accounting state is bounded');
  const before = transactionBytes;
  const again = await api.applyInventoryMovement(db, {movementId: 'sale_new1_cup', itemId: 'cup', type: 'sale_usage', qty: -2, sourceType: 'order', sourceId: 'new1'}, actor);
  assert.equal(again.duplicate, true); assert.equal(again.movement.qty, -2); assert.equal(state.inventoryAccounting.cup.balance, 698, 'a projected duplicate never moves stock');
  assert.equal(transactionBytes, before, 'a projected duplicate needs no accounting transaction');
  state.inventoryAccounting.cup.applied.sale_race_cup = {projectedAt: now, version: 999};
  state.inventoryMovements.sale_race_cup = {id: 'sale_race_cup', itemId: 'cup', qty: -1};
  delete state.inventoryMovements.sale_race_cup; // projection not yet visible to the pre-check
  const racing = api.applyInventoryMovement(db, {movementId: 'sale_race_cup', itemId: 'cup', type: 'sale_usage', qty: -1, sourceType: 'order', sourceId: 'race'}, actor);
  state.inventoryMovements.sale_race_cup = {id: 'sale_race_cup', itemId: 'cup', qty: -1};
  const raced = await racing;
  assert.equal(raced.duplicate, true); assert.equal(state.inventoryAccounting.cup.balance, 698, 'a marker found inside the transaction is a duplicate');
}

console.log('PASS: replica-first history reads, tab-stable report listeners, ID-patched archive changes, month-bounded Stock Value journal (equivalent to full history), Books without full archive downloads, and indexed/bounded server reads, and bounded per-item inventory idempotency state.');
