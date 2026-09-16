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
// database.rules.json carries comments, so read a node's indexes directly.
const ruleIndexes = (node) => { const m = read('database.rules.json').match(new RegExp(`\\n    "${node}":\\s*\\{\\s*"\\.indexOn":\\s*\\[([^\\]]*)\\]`)); assert.ok(m, `${node} has no .indexOn`); return JSON.parse(`[${m[1]}]`); };

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
  assert(ruleIndexes('archivedOrders').includes('settlementStatus'), 'archivedOrders.settlementStatus must be indexed');
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

// 8. Books monthly totals are rebuilt from day totals: a journal write reads only its day
// and the month's day totals, and the result always equals a full journal recompute.
{
  const functions = read('functions/index.js');
  const start = functions.indexOf('function booksEntryNet'), end = functions.indexOf('// Compact immutable-history index.');
  const api = vm.runInNewContext(`(function(){${functions.slice(start, end)};return {applyBooksMonthlyDelta, rebuildBooksMonthlyNet, healRecentBooksNet, booksEntryNet};})()`,
    {Financial: require('../functions/lib/financial.js'), financeDateFromTimestamp: () => '2026-09-16', console});
  const state = {books: {journal: {}}};
  const parts = (path) => String(path || '').split('/').filter(Boolean);
  const get = (path) => parts(path).reduce((cur, key) => cur == null ? undefined : cur[key], state);
  const put = (path, value) => {const keys = parts(path); let cur = state; for (let i = 0; i < keys.length - 1; i++) cur = cur[keys[i]] || (cur[keys[i]] = {}); if (value === null || (value && typeof value === 'object' && !Object.keys(value).length)) delete cur[keys.at(-1)]; else cur[keys.at(-1)] = structuredClone(value);};
  let bytesRead = 0;
  const node = (path, q = {}) => ({
    orderByChild: (field) => node(path, {...q, field}), orderByKey: () => node(path, {...q, key: true}),
    startAt: (v) => node(path, {...q, start: v}), endAt: (v) => node(path, {...q, end: v}),
    async get() {let v = structuredClone(get(path)); if (v && (q.field || q.key)) v = Object.fromEntries(Object.entries(v).filter(([k, row]) => {const x = q.key ? k : row && row[q.field]; return (q.start === undefined || x >= q.start) && (q.end === undefined || x <= q.end);})); bytesRead += JSON.stringify(v || {}).length; return {val: () => v, exists: () => v != null};},
    async set(v) {put(path, v);}, async update(u) {for (const [k, v] of Object.entries(u)) put([...parts(path), ...parts(k)].join('/'), v);},
  });
  const db = {ref: (path = '') => node(path)};
  let seq = 0;
  const entry = (date, amount) => ({date, lines: [{code: '1000', debit: amount, credit: 0}, {code: '4000', debit: 0, credit: amount}]});
  const write = async (id, value) => {const before = structuredClone(state.books.journal[id] || null); put(`books/journal/${id}`, value); await api.applyBooksMonthlyDelta(db, before, value);};
  const full = () => {const m = {}; for (const e of Object.values(state.books.journal)) {const month = e.date.slice(0, 7); m[month] = m[month] || {}; for (const [c, v] of Object.entries(api.booksEntryNet(e))) m[month][c] = Math.round(((m[month][c] || 0) + v) * 100) / 100;} return m;};
  for (let d = 1; d <= 28; d++) for (let i = 0; i < 12; i++) state.books.journal[`aug_${d}_${i}`] = entry(`2026-08-${String(d).padStart(2, '0')}`, 10 + i + d / 100);
  await write('seed', entry('2026-09-01', 5)); // schema 1 -> full rebuild
  assert.deepEqual(state.books.monthlyNet, full());
  bytesRead = 0; await write('sep_a', entry('2026-09-16', 12.34));
  assert(bytesRead < 3000, `a journal write must not re-read its whole month (${bytesRead} bytes)`);
  await write('sep_a', entry('2026-08-31', 12.34)); // moved to a previous month
  await write('aug_3_4', null); await write('aug_5_1', entry('2026-08-05', 99.99));
  assert.deepEqual(state.books.monthlyNet, full(), 'incremental day totals equal a full journal recompute');
  state.books.monthlyNet['2026-08']['1000'] = 1; state.books.dailyNet['2026-08-07'] = {'1000': 5};
  const healed = await api.healRecentBooksNet(db, Date.now());
  assert.equal(JSON.stringify(healed.months), '["2026-08","2026-09"]');
  assert.deepEqual(state.books.monthlyNet, full(), 'the nightly heal repairs drifted day and month totals');
}

// 9. Stale tabs: every app checks the published build and reloads an idle Admin/Books tab
// once per build, never over a POS sale, an edited field, or while offline.
{
  const manifest = JSON.parse(read('release-manifest.json'));
  const published = JSON.parse(read('build-version.json'));
  const metas = {admin: read('admin.html'), books: read('books.html'), customer: read('index.html')};
  for (const [app, html] of Object.entries(metas)) {
    const build = Number((html.match(new RegExp(`<meta name="accaza-${app}-build" content="(\\d+)"`)) || [])[1]);
    assert.equal(build, manifest.builds[app], `${app} page build must equal the release manifest`);
    assert.equal(build, published.builds[app], `${app} page build must equal build-version.json, or every open tab would reload once for nothing`);
    assert.equal((html.match(/<script src="assets\/js\/shared\/build-freshness\.js(\?v=\d+)?"><\/script>/g) || []).length, 1, `${app} must load the stale-tab guard once`);
  }
  // release-manifest.json is excluded from GitHub Pages (it 404s in production), so the guard
  // must read the small public build-version.json instead.
  const jekyllExcludes = read('_config.yml');
  assert.ok(/-\s*release-manifest\.json/.test(jekyllExcludes) && !/build-version/.test(jekyllExcludes), 'build-version.json must be published while the release manifest stays private');
  assert.ok(read('sw.js').includes("'/assets/js/shared/build-freshness.js'") && read('sw.js').includes("'/build-version.json'"), 'the guard is part of the offline shell');
  const source = read('assets/js/shared/build-freshness.js');
  function run({app = 'admin', running = 533, published = 534, cart = false, syncing = 0, edited = false, online = true, storage = true, reloadedFor = ''} = {}) {
    let now = Date.UTC(2026, 8, 16, 4), interval = null, reloads = 0, fetches = 0;
    const store = new Map(reloadedFor ? [['accazaFreshnessReloadedFor', String(reloadedFor)]] : []);
    const listeners = {}, body = {children: [], appendChild(n) { this.children.push(n); }};
    const field = {isConnected: true, type: 'text', value: edited ? 'draft' : '', defaultValue: '', getClientRects: () => [1], closest: () => null};
    const el = () => ({style: {}, setAttribute() {}, appendChild() {}, textContent: ''});
    const document = {body, visibilityState: 'hidden', querySelector: (sel) => sel === `meta[name="accaza-${app}-build"]` ? {getAttribute: () => String(running)} : null,
      getElementById: (id) => body.children.find((c) => c.id === id) || null, createElement: el, addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); }};
    class FakeDate extends Date { static now() { return now; } }
    const sessionStorage = {getItem: (k) => { if (!storage) throw new Error('blocked'); return store.has(k) ? store.get(k) : null; }, setItem: (k, v) => { if (!storage) throw new Error('blocked'); store.set(k, String(v)); }, removeItem: (k) => store.delete(k)};
    const win = {document, sessionStorage, navigator: {onLine: online}, location: {reload: () => { reloads += 1; }}, addEventListener() {}, setInterval: (fn, ms) => { interval = {fn, ms}; },
      fetch: async (url, opts) => { fetches += 1; assert.equal(url, '/build-version.json'); assert.equal(opts.cache, 'no-store'); return {ok: true, json: async () => ({builds: {[app]: published}})}; },
      __pos: {hasItems: () => cart}, __posOfflineState: () => ({syncing})};
    const context = vm.createContext({window: win, Date: FakeDate, String, Number, Boolean});
    vm.runInContext(source, context);
    if (edited) listeners.input.forEach((fn) => fn({target: field}));
    return {
      interval, get reloads() { return reloads; }, get fetches() { return fetches; }, store, bar: () => body.children.find((c) => c.id === 'accazaUpdateReady'),
      async tick(ms) { now += ms; interval.fn(); for (let i = 0; i < 5; i += 1) await tick(); },
      touch() { listeners.pointerdown.forEach((fn) => fn({})); },
    };
  }
  let t = run();
  assert.equal(t.interval.ms, 15 * 60 * 1000, 'the manifest is checked every 15 minutes, not continuously');
  await t.tick(5 * 60 * 1000);
  assert.equal(t.reloads, 0, 'a recently used tab is never reloaded');
  assert.ok(t.bar(), 'a stale tab shows the reload bar');
  await t.tick(15 * 60 * 1000);
  assert.equal(t.reloads, 1, 'an idle stale Admin tab reloads');
  assert.equal(t.store.get('accazaFreshnessReloadedFor'), '534');
  t = run({reloadedFor: 534}); await t.tick(20 * 60 * 1000);
  assert.equal(t.reloads, 0, 'a tab reloads at most once per published build (no reload loop if the page lags the manifest)');
  for (const [label, opts] of [['POS sale in progress', {cart: true}], ['offline sale syncing', {syncing: 1}], ['edited field on screen', {edited: true}], ['offline', {online: false}], ['storage unavailable', {storage: false}], ['customer page', {app: 'customer', running: 71, published: 72}]]) {
    t = run(opts); await t.tick(20 * 60 * 1000);
    assert.equal(t.reloads, 0, `no automatic reload: ${label}`);
    assert.ok(t.bar(), `the reload bar still shows: ${label}`);
  }
  t = run({running: 534, published: 534}); await t.tick(20 * 60 * 1000);
  assert.equal(t.reloads + (t.bar() ? 1 : 0), 0, 'a current tab does nothing');
  t = run(); t.touch(); await t.tick(60 * 1000); await t.tick(30 * 1000);
  assert.equal(t.fetches, 1, 'checks are throttled to one a minute');
}

// 10. The daily backup downloads the whole database; its growth is flagged long before the free allowance.
{
  const Health = require('../functions/lib/production-health.js');
  const now = Date.UTC(2026, 8, 16, 4);
  const backup = (bytes) => ({takenAt: now - 3600000, version: 'backup-v2', validation: 'passed', dataSha256: 'a'.repeat(64), bytes});
  const ids = (bytes) => Health.evaluate({backup: backup(bytes), telemetry: [], operational: {counts: {}}}, now).alerts.map((x) => x.id);
  assert.ok(!ids(13 * 1048576).includes('backup_download_budget'), 'today\'s 13 MB backup is inside budget');
  const warn = Health.evaluate({backup: backup(61 * 1048576), telemetry: [], operational: {counts: {}}}, now);
  assert.equal(warn.status, 'warning');
  assert.ok(warn.alerts.some((x) => x.id === 'backup_download_budget' && x.severity === 'warning' && x.detail.includes('61 MB') && x.detail.includes('360 MB')));
  assert.ok(Health.BACKUP_DOWNLOAD_WARN_BYTES * 6 <= Health.DAILY_FREE_DOWNLOAD_BYTES, 'the warning fires at no more than a sixth of the daily allowance');
  assert.ok(read('src/functions/60-maintenance.js').includes('bytes: payload.length'), 'the backup records its size for the budget check');
}

// 11. Platform-order lookups (payout corrections, late entries) read the reference index and one
// record; a missing index entry falls back to that channel only, and is then backfilled.
{
  for (const node of ['orders', 'archivedOrders']) assert.ok(ruleIndexes(node).includes('channel'), `${node}.channel must be indexed for platform lookups`);
  const bundle = read('functions/index.js');
  const start = bundle.indexOf('function platformRefKey(ref)'), end = bundle.indexOf('exports.indexPlatformOrderRef');
  const presettle = bundle.slice(bundle.indexOf('exports.correctPlatformPresettlement'), bundle.indexOf('if (!found) throw new HttpsError("not-found", "No matching GrabFood'));
  assert.ok(!/db\.ref\("\/(orders|archivedOrders)"\)\.get\(\)/.test(presettle) && presettle.includes('findPlatformOrder(db,'), 'correctPlatformPresettlement must not download whole order nodes');
  assert.ok(!/db\.ref\("\/(orders|archivedOrders)"\)\.get\(\)/.test(bundle.slice(start, end)), 'platform lookups must not download whole order nodes');
  const data = {
    orders: {'GF-LIVE': {channel: 'grabfood', platformRef: 'gf-100', total: 10}, 'POS-1': {channel: 'instore', total: 5}},
    archivedOrders: {'GF-OLD': {channel: 'grabfood', platformRef: 'GF-200'}, 'FP-OLD': {channel: 'foodpanda', platformRef: 'FP-9'}, 'GF-MOVED': {channel: 'grabfood', platformRef: 'GF-301'}},
    platformRefIndex: {grabfood: {'GF-100': {orderId: 'GF-LIVE'}, 'GF-300': {orderId: 'GF-MOVED'}}},
  };
  const reads = [];
  const at = (path) => path.split('/').filter(Boolean).reduce((node, part) => node == null ? undefined : node[part], data);
  const setAt = (path, value) => { const parts = path.split('/').filter(Boolean); let node = data; parts.slice(0, -1).forEach((p) => { node = node[p] = node[p] || {}; }); node[parts.at(-1)] = value; };
  const snap = (value) => ({exists: () => value !== undefined && value !== null, val: () => value === undefined ? null : JSON.parse(JSON.stringify(value))});
  const ref = (path) => {
    const q = {child: null, equal: undefined};
    const api = {
      orderByChild(child) { q.child = child; return api; }, equalTo(value) { q.equal = value; return api; },
      async get() {
        const value = at(path);
        if (!q.child) { reads.push(path); return snap(value); }
        reads.push(`${path}?${q.child}=${q.equal}`);
        return snap(Object.fromEntries(Object.entries(value || {}).filter(([, row]) => row && row[q.child] === q.equal)));
      },
      async transaction(fn) { const next = fn(at(path) ?? null); if (next !== undefined) setAt(path, next); return {committed: next !== undefined}; },
    };
    return api;
  };
  const db = {ref};
  const context = vm.createContext({module: {exports: {}}, exports: {}, db, Date, String, Number, Object, Array, JSON, Promise});
  vm.runInContext(`${bundle.slice(start, end)};globalThis.find = findPlatformOrder; globalThis.existing = existingPlatformOrder;`, context);
  const {find, existing} = context;
  const hit = await find(db, ['grabfood', 'foodpanda'], 'GF-100');
  assert.equal(hit.id, 'GF-LIVE'); assert.equal(hit.node, 'orders');
  assert.deepEqual(reads.splice(0), ['/platformRefIndex/grabfood/GF-100', '/orders/GF-LIVE'], 'an indexed lookup reads one index entry and one order');
  const old = await find(db, ['grabfood'], 'gf-200');
  assert.equal(old.id, 'GF-OLD'); assert.equal(old.node, 'archivedOrders');
  assert.deepEqual(reads.splice(0), ['/platformRefIndex/grabfood/GF-200', '/orders?channel=grabfood', '/archivedOrders?channel=grabfood'], 'an unindexed order falls back to its channel only');
  assert.equal(data.platformRefIndex.grabfood['GF-200'].orderId, 'GF-OLD', 'the fallback backfills the index');
  await find(db, ['grabfood'], 'GF-200'); assert.equal(reads.splice(0).length, 3, 'the next lookup of that order is index-only');
  assert.equal((await find(db, ['grabfood'], 'GF-300')), null, 'a stale index entry whose order changed reference is not trusted');
  reads.splice(0);
  assert.equal((await existing(db, 'grabfood', 'GF-100', 'GF-LIVE')), null, 'the order being corrected is not its own duplicate');
  data.archivedOrders['GF-DUP'] = {channel: 'grabfood', platformRef: 'GF-100'};
  assert.equal((await existing(db, 'grabfood', 'GF-100', 'GF-LIVE')).id, 'GF-DUP', 'a second order with the same reference is still found');
  assert.equal((await existing(db, 'foodpanda', 'GF-100')), null, 'references are matched within their channel');
  assert.ok(!reads.some((r) => r === '/orders' || r === '/archivedOrders'), 'no lookup downloads a whole order node');
}

// 12. Petty voucher receipts live beside the voucher, so the voucher listeners stay small, and
// approvals transact on one voucher instead of downloading and re-uploading the whole node.
{
  const bundle = read('functions/index.js');
  const pettyAt = bundle.indexOf('exports.managePettyVoucher'), petty = bundle.slice(pettyAt, bundle.indexOf('\nexports.', pettyAt + 10));
  assert.ok(!petty.includes('db.ref("/pettyCashVouchers").get()') && !petty.includes('db.ref("/pettyCashVouchers")'), 'managePettyVoucher must not read or transact the whole voucher node');
  assert.ok(petty.includes('const result = await ref.transaction((row) => {'), 'voucher review transacts on the single voucher');
  const register = read('assets/js/admin/register.js');
  assert.ok(!/receiptImg:img/.test(register), 'new vouchers must not embed the receipt image');
  assert.ok(register.includes("a.update(a.ref(a.db),writes)") && register.includes("writes['pettyCashReceipts/'+id]"), 'voucher and receipt are written atomically');
  const start = bundle.indexOf('async function voucherHasReceipt'), end = bundle.indexOf('exports.managePettyVoucher');
  const reads = [];
  const db = {ref: (path) => ({get: async () => { reads.push(path); return {exists: () => path === '/pettyCashReceipts/pv_new/meta'}; }})};
  const context = vm.createContext({db});
  vm.runInContext(`${bundle.slice(start, end)};globalThis.has = voucherHasReceipt;`, context);
  assert.equal(await context.has(db, 'pv_old', {receiptImg: 'data:image/jpeg;base64,AA'}), true);
  assert.equal(await context.has(db, 'pv_new', {hasReceipt: true}), true);
  assert.equal(await context.has(db, 'pv_fake', {hasReceipt: true}), false, 'a hasReceipt flag without a stored receipt is not evidence');
  assert.equal(await context.has(db, 'pv_none', {purpose: 'x'}), false);
  assert.deepEqual(reads, ['/pettyCashReceipts/pv_new/meta', '/pettyCashReceipts/pv_fake/meta'], 'evidence checks read only the small meta child');
}

// 13. Cash controls read the maintained cash summary (plus in-flight recent movements) instead of
// the whole ledger, and still agree with a full-ledger computation.
{
  const CashBalances = require('../functions/lib/cash-balances.js');
  const clone = (v) => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
  function fakeDb(data, reads, hooks = {}) {
    const parts = (path) => path.split('/').filter(Boolean);
    const at = (path) => parts(path).reduce((n, k) => n == null ? undefined : n[k], data);
    const put = (path, value) => { const p = parts(path); let n = data; p.slice(0, -1).forEach((k) => { n = n[k] = n[k] && typeof n[k] === 'object' ? n[k] : {}; }); if (value === null) delete n[p.at(-1)]; else n[p.at(-1)] = clone(value); };
    const snap = (v) => ({exists: () => v !== undefined && v !== null, val: () => v === undefined ? null : clone(v)});
    function ref(path = '/') {
      const q = {};
      const api = {
        orderByChild(c) { q.child = c; return api; }, startAt(v) { q.start = v; return api; }, limitToFirst(n) { q.first = n; return api; },
        async get() {
          reads.push(q.child ? `${path}?${q.child}>=${q.start ?? ''}` : path);
          if (hooks.onGet) hooks.onGet(path, q);
          let v = at(path);
          if (q.child && v && typeof v === 'object') {
            let rows = Object.entries(v).filter(([, r]) => q.start === undefined || Number(r && r[q.child]) >= q.start);
            rows.sort((a, b) => Number(a[1][q.child]) - Number(b[1][q.child]));
            if (q.first) rows = rows.slice(0, q.first);
            v = Object.fromEntries(rows);
          } else if (q.first && v && typeof v === 'object') v = Object.fromEntries(Object.entries(v).slice(0, q.first));
          return snap(v);
        },
        async set(v) { put(path, v); }, async update(w) { for (const [k, v] of Object.entries(w)) put(`${path}/${k}`, v); },
        async transaction(fn) { const next = fn(clone(at(path)) ?? null); if (next !== undefined) put(path, next); return {committed: next !== undefined, snapshot: snap(at(path))}; },
      };
      return api;
    }
    return {ref};
  }
  const src = read('src/functions/23-cash-balance-summary.js');
  const sandbox = {shallowDatabaseKeys: async () => [], require: (m) => m === './lib/cash-balances' ? CashBalances : null, exports: {}, onCall: () => null, onValueWritten: () => null, ORDER_REGION: 'x', ENFORCE_APP_CHECK: false, Date, Math, JSON, Object, Number, String, Promise, Boolean, Array, Error};
  vm.createContext(sandbox);
  vm.runInContext(`${src};globalThis.current = currentCashBalances;`, sandbox);
  const now = Date.UTC(2026, 8, 16, 7);
  const mv = (id, account, debit, credit, extra = {}) => ({id, occurredAt: now - 86400000, postedAt: now - 86400000, lines: [{account, debit, credit}, {account: 'revenue:sales', debit: credit, credit: debit}], ...extra});
  const ledger = {
    old1: mv('old1', 'asset:register_cash', 500, 0),
    old2: mv('old2', 'asset:cash_account:bdo', 1200.25, 0),
    edited: mv('edited', 'asset:register_cash', 50, 0),
  };
  const built = CashBalances.splitSnapshotFromMovements(ledger, now - 3600000);
  // After the summary was built: one new sale (trigger not processed yet) and one edit.
  ledger.fresh = mv('fresh', 'asset:register_cash', 75.5, 0, {postedAt: now - 30000});
  ledger.edited = mv('edited', 'asset:register_cash', 80, 0, {updatedAt: now - 20000});
  const state = {financialMovements: clone(ledger), cashBalanceSummary: built.summary, cashBalanceSummaryApplied: built.applied, cashBalanceSummaryPending: {}};
  const reads = [];
  const result = await sandbox.current(fakeDb(state, reads), now);
  const full = CashBalances.splitSnapshotFromMovements(ledger, now).summary.balances;
  assert.equal(result.source, 'summary');
  assert.equal(result.balances.registerCents, full.registerCents, 'register cash equals the full-ledger figure');
  assert.equal(result.balances.registerCents, 65550);
  assert.deepEqual(result.balances.cashAccountCents, full.cashAccountCents);
  assert.ok(!reads.includes('/financialMovements'), 'no whole-ledger read on the normal path');
  // A summary that changes mid-read is re-read, never double counted.
  const racing = {financialMovements: clone(ledger), cashBalanceSummary: clone(built.summary), cashBalanceSummaryApplied: clone(built.applied), cashBalanceSummaryPending: {}};
  let raced = false;
  const racingDb = fakeDb(racing, [], {onGet: (path) => {
    if (!raced && path.startsWith('/cashBalanceSummaryApplied/')) {
      raced = true;
      const applied = CashBalances.applyContribution(racing.cashBalanceSummary, null, racing.financialMovements.fresh, now - 1000);
      racing.cashBalanceSummary = applied.summary; racing.cashBalanceSummaryApplied.fresh = applied.applied;
    }
  }});
  const retried = await sandbox.current(racingDb, now);
  assert.equal(retried.balances.registerCents, full.registerCents, 'a concurrent summary update is not double counted');
  // A stuck queue entry older than the window falls back to the full ledger.
  const stuck = {financialMovements: clone(ledger), cashBalanceSummary: clone(built.summary), cashBalanceSummaryApplied: clone(built.applied), cashBalanceSummaryPending: {k: {movementId: 'fresh', queuedAt: now - 3600000}}, cashBalanceSummaryProcessorLock: {owner: 'someone', expiresAt: Date.now() + 86400000}};
  const stuckReads = [];
  const fallback = await sandbox.current(fakeDb(stuck, stuckReads), now);
  assert.equal(fallback.source, 'ledger'); assert.equal(fallback.balances.registerCents, full.registerCents);
  // A rebuild never writes more than 400 applied records at once (each fires a backup-marker
  // trigger; one write may trigger at most 1,000 functions) and writes the summary last.
  {
    const many = {};
    for (let i = 0; i < 1269; i += 1) many[`m${i}`] = mv(`m${i}`, 'asset:register_cash', 1);
    const rstate = {financialMovements: many, cashBalanceSummary: {schemaVersion: 3, complete: true, balances: {}}, cashBalanceSummaryApplied: {stale_one: {fingerprint: 'x', delta: {}}}, cashBalanceSummaryPending: {}};
    const updates = [];
    const rdb = fakeDb(rstate, []);
    const origRef = rdb.ref;
    rdb.ref = (path = '/') => { const r = origRef(path); if (path === '/' || path === undefined) r.update = async (w) => { updates.push(Object.keys(w)); for (const [k, v] of Object.entries(w)) await origRef(`/${k}`).set(v === null ? null : v); }; return r; };
    const origSet = null;
    sandbox.shallowDatabaseKeys = async (_db, path) => Object.keys(rstate[path] || {});
    const rebuilt = await sandbox.current(rdb, now);
    const appliedWrites = updates.map((keys) => keys.filter((k) => k.startsWith('cashBalanceSummaryApplied/')).length);
    assert.ok(Math.max(...appliedWrites) <= 400, `applied records are written in chunks (${Math.max(...appliedWrites)})`);
    assert.ok(updates.at(-1).includes('cashBalanceSummary') && updates.at(-1).includes('cashFlowIndexMeta'), 'the summary and cash-flow index are written last');
    assert.equal(Object.keys(rstate.cashBalanceSummaryApplied).length, 1269, 'stale applied records are removed');
    assert.equal(rstate.cashBalanceSummary.schemaVersion, CashBalances.SCHEMA_VERSION);
    assert.equal(rebuilt.balances.registerCents, 126900);
  }
  // Callers of the cash control no longer read the ledger themselves.
  const bundle = read('functions/index.js');
  assert.ok(bundle.includes('for (let i = 0; i < paths.length; i += 150)'), 'Books journal sync writes at most 150 entries per update');
  const available = bundle.slice(bundle.indexOf('async function availableCashOnHandAboveFloat'), bundle.indexOf('function poolCustodyInflowRecord'));
  assert.ok(available.includes('currentCashBalances(db)') && !available.includes('db.ref("/financialMovements")'), 'availableCashOnHandAboveFloat must use the cash summary');
  const review = bundle.slice(bundle.indexOf('exports.reviewDiscrepancy'), bundle.indexOf('\nexports.', bundle.indexOf('exports.reviewDiscrepancy') + 10));
  assert.ok(!review.includes('db.ref("/financialMovements").get()') && review.includes('discrepancyCandidateMovements(db,shiftId,shiftRow,row,raw)'), 'cash-difference reviews read a bounded window');
  for (const index of ['postedAt', 'updatedAt']) assert.ok(ruleIndexes('financialMovements').includes(index), `financialMovements.${index} must be indexed`);
  assert.ok(read('database.rules.json').includes('"cashBalanceSummaryPending": { ".indexOn": "queuedAt", ".read": false, ".write": false }'));
  // Discrepancy candidates: window + legacy variance + the manager's explicit selection only.
  const hs = bundle.indexOf('const DISCREPANCY_RECOVERY_LOOKBACK_MS'), he = bundle.indexOf('exports.managePettyVoucher');
  const dctx = vm.createContext({Math, Number, String, Object, Array, Set, Promise});
  vm.runInContext(`${bundle.slice(hs, he)};globalThis.pick = discrepancyCandidateMovements;`, dctx);
  const dstate = {financialMovements: {early: {occurredAt: 10}, recovery: {occurredAt: 9 * 86400000}, shift_variance_s1: {occurredAt: 5}, picked: {occurredAt: 1}}};
  const dreads = [];
  const picked = await dctx.pick(fakeDb(dstate, dreads), 's1', {openAt: 10 * 86400000}, {ts: 10 * 86400000 + 5}, [{details: {correctionMovementId: 'picked'}}, {details: {correctionMovementId: 'bad/id'}}]);
  assert.deepEqual(Object.keys(picked).sort(), ['picked', 'recovery', 'shift_variance_s1']);
  assert.ok(!dreads.includes('/financialMovements'));
}

// 14. Books Cash Flow: period movements + server day/month cash indexes reproduce the
// full-history statement exactly, and the Cash Flow tab no longer runs the control audit.
{
  const CashBalances = require('../functions/lib/cash-balances.js');
  const D = (day, hour = 12) => Date.parse(`${day}T${String(hour).padStart(2, '0')}:00:00+08:00`);
  const L = (account, debit, credit = 0) => ({account, debit, credit});
  const reg = 'asset:register_cash', und = 'asset:cash_awaiting_deposit', pet = 'asset:petty_cash', bdo = 'asset:cash_account:bdo', gc = 'asset:cash_account:gcash';
  const ledger = {
    open_bdo: {type: 'opening_balance', sourceType: 'cashAccount', sourceId: 'bdo', occurredAt: D('2026-09-10'), lines: [L(bdo, 5000), L('equity:opening', 0, 5000)]},
    open_gc: {type: 'opening_balance', sourceType: 'cashAccount', sourceId: 'gcash', occurredAt: D('2026-07-01'), lines: [L(gc, 300), L('equity:opening', 0, 300)]},
    open_gc_extra: {type: 'opening_balance_adjustment', sourceType: 'cashAccount', sourceId: 'gcash', occurredAt: D('2026-08-02'), lines: [L(gc, 50), L('equity:opening', 0, 50)]},
    sale_jul: {type: 'order_sale', sourceType: 'order', sourceId: 'o1', occurredAt: D('2026-07-15'), lines: [L(reg, 120.5), L('revenue:sales', 0, 120.5)]},
    sale_aug: {type: 'order_sale', sourceType: 'order', sourceId: 'o2', occurredAt: D('2026-08-20'), lines: [L(reg, 99.99), L('revenue:sales', 0, 99.99)]},
    deposit_aug: {type: 'cash_deposit', sourceType: 'custody', sourceId: 'c1', occurredAt: D('2026-08-25'), lines: [L(bdo, 80), L(und, 0, 80)]},
    move_aug: {type: 'register_to_undeposited', sourceType: 'shift', sourceId: 's1', occurredAt: D('2026-08-25', 23), lines: [L(und, 80), L(reg, 0, 80)]},
    // Fully reversed pair straddling the period start.
    sale_straddle: {type: 'order_sale', sourceType: 'order', sourceId: 'o3', occurredAt: D('2026-08-31', 23), lines: [L(reg, 45), L('revenue:sales', 0, 45)]},
    sale_straddle_void: {type: 'order_sale_void', sourceType: 'order', sourceId: 'o3', occurredAt: D('2026-09-02'), lines: [L('revenue:sales', 45), L(reg, 0, 45)]},
    // Fully reversed pair inside the period.
    sale_in: {type: 'order_sale', sourceType: 'order', sourceId: 'o4', occurredAt: D('2026-09-05'), lines: [L(reg, 70), L('revenue:sales', 0, 70)]},
    sale_in_void: {type: 'order_sale_void', sourceType: 'order', sourceId: 'o4', occurredAt: D('2026-09-06'), lines: [L('revenue:sales', 70), L(reg, 0, 70)]},
    // Fully reversed pair before the period.
    sale_old: {type: 'order_sale', sourceType: 'order', sourceId: 'o5', occurredAt: D('2026-07-20'), lines: [L(reg, 33), L('revenue:sales', 0, 33)]},
    sale_old_void: {type: 'order_sale_void', sourceType: 'order', sourceId: 'o5', occurredAt: D('2026-07-21'), lines: [L('revenue:sales', 33), L(reg, 0, 33)]},
    // A reversal whose source has two originals is not a clean pair.
    pv_a: {type: 'petty_cash_expense', sourceType: 'pettyVoucher', sourceId: 'pv1', occurredAt: D('2026-08-10'), lines: [L('expense:x', 20), L(pet, 0, 20)]},
    pv_b: {type: 'petty_cash_expense', sourceType: 'pettyVoucher', sourceId: 'pv1', occurredAt: D('2026-08-11'), lines: [L('expense:x', 5), L(pet, 0, 5)]},
    pv_void: {type: 'petty_cash_void', sourceType: 'pettyVoucher', sourceId: 'pv1', occurredAt: D('2026-09-03'), lines: [L(pet, 20), L('expense:x', 0, 20)]},
    // Reversal after the period end: not paired for a September report.
    sale_late: {type: 'order_sale', sourceType: 'order', sourceId: 'o6', occurredAt: D('2026-09-08'), lines: [L(reg, 15), L('revenue:sales', 0, 15)]},
    sale_late_void: {type: 'order_sale_void', sourceType: 'order', sourceId: 'o6', occurredAt: D('2026-10-02'), lines: [L('revenue:sales', 15), L(reg, 0, 15)]},
    fund: {type: 'petty_cash_replenishment', sourceType: 'fund', sourceId: 'f1', occurredAt: D('2026-06-30'), lines: [L(pet, 500), L(und, 0, 500)]},
    manual: {type: 'manual_books_journal', sourceType: 'booksManualJournal', sourceId: 'j1', occurredAt: D('2026-09-07'), lines: [L(gc, 12.34), L('equity:x', 0, 12.34)]},
    edge_midnight: {type: 'order_sale', sourceType: 'order', sourceId: 'o7', occurredAt: D('2026-09-01', 0), lines: [L(reg, 1), L('revenue:sales', 0, 1)]},
    payout: {type: 'platform_payout_deposit', sourceType: 'platformPayout', sourceId: 'p1', occurredAt: D('2026-09-09'), lines: [L(bdo, 900), L('asset:platform_clearing:grabfood', 0, 900)]},
  };
  const accounts = {bdo: {name: 'BDO', openingDate: '2026-09-01', opening: 5000, order: 1}, gcash: {name: 'GCash', opening: 300, order: 2}, bank2: {name: 'Other', opening: 750, openingDate: '2026-08-15', order: 3}};
  const periodOf = (from, to) => ({from, to, startAt: D(from, 0), endAt: Date.parse(`${to}T23:59:59.999+08:00`)});
  const flow = CashBalances.splitSnapshotFromMovements(ledger, D('2026-09-16')).flow;
  function runStatement(file, win, from, to) {
    const code = read(file);
    const ctx = vm.createContext({window: win, Intl, Date, Math, Number, String, Object, Array, Set, Map, JSON, RegExp, App: {}, document: {}, r2: (n) => Math.round((Number(n) || 0) * 100) / 100, todayStr: () => to, periodBounds: () => ({start: from, end: to}), ENTRIES: () => [], globalThis: null});
    ctx.globalThis = ctx;
    vm.runInContext(`${file.includes('fixtures') ? code : code.slice(0, code.indexOf('App.cashAccountEdit'))};globalThis.run = () => cfStatement(); globalThis.balance = (id) => cfAccountLedgerBalance(id);`, ctx);
    return ctx;
  }
  const basisSrc = read('assets/js/shared/cash-flow-basis.js');
  for (const [from, to] of [['2026-09-01', '2026-09-16'], ['2026-09-03', '2026-09-30'], ['2026-08-01', '2026-08-31'], ['2026-07-15', '2026-09-10'], ['2026-09-02', '2026-09-02'], ['2026-10-01', '2026-10-05']]) {
    const oldCtx = runStatement('tests/fixtures/cash-flow-full-history-reference.js', {__financialMovements: ledger, __cfAccounts: accounts}, from, to);
    const p = periodOf(from, to);
    const period = Object.fromEntries(Object.entries(ledger).filter(([, m]) => m.occurredAt >= p.startAt && m.occurredAt <= p.endAt));
    const win = {__financialMovements: period, __cashFlowPeriodReady: true, __cfAccounts: accounts, __cashFlowMonthly: flow.monthly, __cashFlowMonthlyReady: true, __cashFlowOpenings: flow.openings, __cashFlowOpeningsReady: true, __cashFlowIndexMeta: flow.meta, __cashFlowDailyMonth: from.slice(0, 7), __cashFlowDaily: Object.fromEntries(Object.entries(flow.daily).filter(([day]) => day.startsWith(from.slice(0, 7)))), __cashFlowGroups: {}};
    vm.runInContext(basisSrc, vm.createContext(win));
    win.AccazaCashFlowBasis = win.AccazaCashFlowBasis || (() => { const c = vm.createContext({}); vm.runInContext(basisSrc, c); return c.AccazaCashFlowBasis; })();
    const need = win.AccazaCashFlowBasis.reversalSources(period);
    const newCtx = runStatement('src/books/app/20-cash-flow.js', win, from, to);
    if (Object.keys(need).length) assert.equal(newCtx.run().loading, true, `${from}..${to}: a reversal source that has not loaded yet keeps the statement in its loading state`);
    for (const key of Object.keys(need)) win.__cashFlowGroups[key] = Object.fromEntries(Object.entries(ledger).filter(([, m]) => String(m.sourceId) === need[key].sourceId));
    const before = oldCtx.run(), after = newCtx.run();
    assert.equal(after.loading, false);
    for (const field of ['begin', 'ending', 'add', 'ded', 'detail', 'corrections', 'correctionDetail', 'totBegin', 'totEnd', 'totAdd', 'totDed']) {
      const norm = (v) => JSON.stringify(v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).filter(([, x]) => Math.abs(Number(x)) >= 0.005).sort()) : v);
      assert.equal(norm(after[field]), norm(before[field]), `${from}..${to}: ${field} differs from the full-history statement`);
    }
    for (const id of ['bdo', 'gcash', 'bank2']) assert.equal(newCtx.balance(id), oldCtx.balance(id), `ledger balance for ${id}`);
  }
  // Wiring: the Books feed reads only the period, the indexes, and reversal sources.
  const live = read('assets/js/books/live-pos.mjs');
  assert.ok(live.includes('query(ref(db,"/financialMovements"),orderByChild("occurredAt"),startAt(p.startAt),endAt(p.endAt))'), 'Cash Flow must read only the selected period');
  assert.ok(!/ref\(db,"\/financialMovements"\)\)/.test(live) && !live.includes('endAt(Number(p.endAt)||Date.now())'), 'no all-history Finance movement listener');
  assert.ok(live.includes("orderByChild('sourceId'),equalTo(need[key].sourceId)"), 'reversal sources are read through the sourceId index');
  assert.ok(!read('assets/js/books/app.js').includes('window.__auditControls().then(function(r){window.__controlAudit=r||{};})'), 'opening Cash Flow must not run the whole-archive control audit');
  assert.equal((read('books.html').match(/assets\/js\/shared\/cash-flow-basis\.js/g) || []).length, 1);
  const bundle = read('functions/index.js');
  assert.ok(bundle.includes('cashFlowDaily: rebuilt.flow.daily, cashFlowMonthly: rebuilt.flow.monthly, cashFlowOpenings: rebuilt.flow.openings, cashFlowIndexMeta: rebuilt.flow.meta'), 'the cash summary rebuild writes the cash-flow indexes');
  // Incremental maintenance equals a rebuild, including edits, day moves and deletions.
  let state = CashBalances.splitSnapshotFromMovements({}, 1);
  let summary = state.summary, applied = {}, index = {daily: {}, monthly: {}, openings: {}};
  const step = (id, movement) => {
    const prior = applied[id] || null;
    const result = CashBalances.applyContribution(summary, prior, movement, 2);
    summary = result.summary;
    if (result.applied) applied[id] = result.applied; else delete applied[id];
    CashBalances.applyFlowContribution(index, id, prior, result.applied, movement);
  };
  Object.entries(ledger).forEach(([id, m]) => step(id, m));
  step('sale_aug', {...ledger.sale_aug, occurredAt: D('2026-09-04')});
  step('open_gc_extra', null);
  step('manual', {...ledger.manual, lines: [L(gc, 10), L('equity:x', 0, 10)]});
  const expected = {...ledger, sale_aug: {...ledger.sale_aug, occurredAt: D('2026-09-04')}, manual: {...ledger.manual, lines: [L(gc, 10), L('equity:x', 0, 10)]}};
  delete expected.open_gc_extra;
  const rebuilt = CashBalances.splitSnapshotFromMovements(expected, 3);
  const clean = (map) => Object.fromEntries(Object.entries(map).map(([k, v]) => [k, CashBalances.flowValue(v)]).filter(([, v]) => v).map(([k, v]) => [k, JSON.parse(JSON.stringify(v, (key, val) => (key === 'cashAccountCents' && val && !Object.keys(val).some((x) => val[x])) ? undefined : val))]));
  assert.deepEqual(clean(index.daily), clean(rebuilt.flow.daily), 'incremental daily index equals a rebuild');
  assert.deepEqual(clean(index.monthly), clean(rebuilt.flow.monthly), 'incremental monthly index equals a rebuild');
  assert.deepEqual(Object.fromEntries(Object.entries(index.openings).filter(([, v]) => v)), rebuilt.flow.openings, 'incremental openings equal a rebuild');
}

// 15. Incremental daily backups: tracked history nodes are rebuilt from the previous verified
// backup plus dirty records, produce the same envelope data as a full read, and read no
// tracked node in full on incremental days.
{
  const BackupDelta = require('../functions/lib/backup-delta.js');
  const RecoveryValidation = require('../functions/lib/recovery-validation.js');
  const clone = (v) => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
  const bal = (id, amount) => ({id, lines: [{account: 'asset:register_cash', debit: amount, credit: 0}, {account: 'revenue:sales', debit: 0, credit: amount}]});
  let state = {
    archivedOrders: {a1: {total: 10}, a2: {total: 20}},
    inventoryMovements: {m1: {qty: 1}, m2: {qty: 2}},
    orderInventoryPlans: {a1: {lines: [1, 2]}},
    financialMovements: {f1: bal('f1', 10)},
    books: {journal: {j1: bal('j1', 10)}, monthlyNet: {'2026-09': {'1000': 10}}, config: {x: 1}},
    shifts: {s1: {openAt: 1}},
    cashBalanceSummaryApplied: {f1: {fingerprint: 'x'}},
    operationalAudit: {'1_x': {action: 'x'}},
    financialCommandClaims: {f1: {status: 'posted'}},
    inventoryAccounting: {milk: {balance: 1}},
    financialApprovals: {ap1: {status: 'used'}},
    activityLog: {l1: {action: 'x'}},
    cfLedger: {c1: {amount: 1}},
    menuItems: {latte: {price: 100}},
    activeOrders: {a3: {status: 'Pending'}},
    systemHealth: {backups: {latest: {}}},
  };
  const reads = [], files = {}, logs = [];
  const at = (path) => path.split('/').filter(Boolean).reduce((n, k) => n == null ? undefined : n[k], state);
  // Like the database, removing the last child removes the parent.
  const put = (path, value) => { const parts = path.split('/').filter(Boolean), chain = [state]; let n = state; parts.slice(0, -1).forEach((k) => { n = n[k] = n[k] || {}; chain.push(n); }); if (value === null) delete n[parts.at(-1)]; else n[parts.at(-1)] = clone(value); for (let i = chain.length - 1; i > 0; i -= 1) if (!Object.keys(chain[i]).length) delete chain[i - 1][parts[i - 1]]; };
  const snap = (v) => ({exists: () => v != null, val: () => v === undefined ? null : clone(v)});
  const db = {ref: (path = '/') => ({
    toString: () => 'https://example.firebasedatabase.app/',
    async get() { reads.push(path); return snap(path === '/' ? state : at(path)); },
    async set(v) { put(path, v); },
    async transaction(fn) { const next = fn(clone(at(path)) ?? null); if (next !== undefined) put(path, next); return {committed: true}; },
    orderByKey() {
      const range = {};
      const q = {startAt(k) { range.start = k; return q; }, endBefore(k) { range.before = k; return q; }, async get() {
        reads.push(`${path}?slice`);
        const node = at(path) || {};
        const rows = Object.entries(node).filter(([k]) => BackupDelta.inSlice(k, {start: range.start ?? null, before: range.before ?? null}));
        return snap(rows.length ? Object.fromEntries(rows) : null);
      }};
      return q;
    },
  })};
  const bucket = {
    async getFiles({prefix}) { return [Object.keys(files).filter((n) => n.startsWith(prefix)).map((name) => ({name, metadata: {timeCreated: new Date(files[name].at).toISOString()}, download: async () => [Buffer.from(files[name].body)], delete: async () => { delete files[name]; }}))]; },
    file: (name) => ({save: async (body) => { files[name] = {body, at: clock}; }}),
  };
  let clock = Date.UTC(2026, 8, 17, 19);
  const shallow = async (url) => {
    const path = url.replace('https://example.firebasedatabase.app/', '').replace(/\/?\.json\?shallow=true$/, '');
    reads.push(`shallow:${path}`);
    const v = path ? at(path) : state;
    return {ok: true, json: async () => Object.fromEntries(Object.keys(v || {}).map((k) => [k, true]))};
  };
  const bundle = read('functions/index.js');
  const start = bundle.indexOf('const BACKUP_EXCLUDE = new Set('), end = bundle.indexOf('exports.backupDatabaseDaily = onSchedule(');
  const ctx = vm.createContext({
    BackupDelta, RecoveryValidation, getDatabase: () => db, getStorage: () => ({bucket: () => bucket}), PROOF_BUCKET: 'b',
    getApp: () => ({options: {credential: {getAccessToken: async () => ({access_token: 't'})}}}), fetch: shallow,
    logger: {info: (m, c) => logs.push([m, c]), warn: (m, c) => logs.push([m, c])}, evaluateProductionHealthNow: async () => null,
    exports: {}, onValueWritten: (opts, fn) => ({opts, fn}), ORDER_REGION: 'asia-southeast1', Date: class extends Date { static now() { return clock; } }, JSON, Object, Promise, String, Number, Buffer, Math, Set, Array, Error,
  });
  vm.runInContext(`${bundle.slice(start, end)};globalThis.backup = createVerifiedDatabaseBackup; globalThis.trigger = backupDirtyTrigger;`, ctx);
  const fullData = () => { const out = clone(state); delete out.activeOrders; delete out.backupDirty; return out; };
  // A backup file written before this release exists, but markers only start now: full read.
  files['db-backups/accaza-2026-09-16-19-00-00.json'] = {body: JSON.stringify(RecoveryValidation.createEnvelope({menuItems: {}}, clock - 86400000, [])), at: clock - 86400000};
  let result = await ctx.backup(clock);
  assert.equal(state.systemHealth.backups.latest.fullReason, 'markers_new');
  assert.equal(result.version, 'backup-v2');
  assert.equal(state.systemHealth.backups.latest.mode, 'full');
  // Writes between backups, each marked by its trigger (the trigger is the real factory).
  const write = async (path, key, value) => { put(`${path}/${key}`, value); const t = ctx.trigger(path); await t.fn({params: {key}}); };
  clock += 86400000;
  await write('archivedOrders', 'a2', {total: 25, settlementStatus: 'settled'});
  await write('archivedOrders', 'a4', {total: 40});
  await write('archivedOrders', 'a1', null);
  await write('financialMovements', 'f2', bal('f2', 5));
  await write('inventoryMovements', 'm1', null);
  await write('books/journal', 'j2', bal('j2', 5));
  put('menuItems/latte/price', 110); put('books/monthlyNet/2026-09/1000', 15); put('newNode', {x: 1});
  assert.deepEqual(Object.keys(state.backupDirty).sort(), ['archivedOrders', 'books~journal', 'financialMovements', 'inventoryMovements']);
  // Day 2: incremental.
  reads.length = 0;
  result = await ctx.backup(clock);
  const latest = state.systemHealth.backups.latest;
  assert.equal(latest.mode, 'incremental', 'the second day is incremental');
  assert.equal(latest.recordsReread, 6, 'only the marked records are re-read');
  const newest = Object.keys(files).sort().at(-1), envelope = JSON.parse(files[newest].body);
  assert.ok(RecoveryValidation.validateEnvelope(envelope).ok, 'the incremental envelope validates, including debit/credit balance');
  const expected = fullData(); expected.systemHealth = envelope.data.systemHealth;
  assert.equal(RecoveryValidation.canonicalJson(envelope.data), RecoveryValidation.canonicalJson(expected), 'incremental backup data equals a full read');
  for (const tracked of ['/', ...BackupDelta.TRACKED_PATHS.map((p) => `/${p}`)]) assert.ok(!reads.includes(tracked), `incremental backup must not read ${tracked} in full`);
  assert.ok(reads.includes('/menuItems') && reads.includes('/newNode') && reads.includes('/books/monthlyNet'), 'untracked nodes are still read in full');
  assert.equal(Object.keys(state.backupDirty || {}).length, 0, 'processed dirty markers are cleared');
  // A marker written after capture survives (the change is picked up next time).
  const captured = {archivedOrders: {a9: 1}};
  put('backupDirty/archivedOrders/a9', 2);
  const clearStart = bundle.indexOf('async function clearBackupDirty'), clearEnd = bundle.indexOf('async function createVerifiedDatabaseBackup');
  vm.runInContext(`${bundle.slice(clearStart, clearEnd)};globalThis.clear = clearBackupDirty;`, ctx);
  await ctx.clear(db, captured);
  assert.equal(state.backupDirty.archivedOrders.a9, 2, 'a newer marker is not cleared');
  delete state.backupDirty;
  // A change whose trigger never ran is corrected (and reported) when its key range is verified.
  clock += 86400000;
  const baseNow = JSON.parse(files[Object.keys(files).sort().at(-1)].body);
  const slice = BackupDelta.rotationSlice(clock, BackupDelta.verificationSlices(baseNow));
  assert.ok(slice && BackupDelta.TRACKED_PATHS.includes(slice.path));
  const existing = Object.keys(at(slice.path) || {}).find((k) => BackupDelta.inSlice(k, slice));
  put(`${slice.path}/${existing}/unmarkedNote`, 'written without a marker');
  reads.length = 0;
  await ctx.backup(clock);
  const day3 = state.systemHealth.backups.latest, envelope3 = JSON.parse(files[Object.keys(files).sort().at(-1)].body);
  assert.equal(day3.mode, 'incremental'); assert.equal(day3.verifiedSlice.path, slice.path); assert.equal(day3.driftRecords, 1, 'the unmarked change is reported');
  const expected3 = fullData(); expected3.systemHealth = envelope3.data.systemHealth;
  assert.equal(RecoveryValidation.canonicalJson(envelope3.data), RecoveryValidation.canonicalJson(expected3), 'the verification read corrects the unmarked change');
  assert.ok(reads.includes(`/${slice.path}?slice`) && !reads.includes('/') && !reads.includes(`/${slice.path}`), 'only a key range is re-read for verification');
  // A backup file older than eight days forces a full read.
  clock += 9 * 86400000;
  await ctx.backup(clock);
  assert.equal(state.systemHealth.backups.latest.mode, 'full');
  assert.equal(state.systemHealth.backups.latest.fullReason, 'stale_base');
  // Plan rules.
  const plan = BackupDelta.planIncremental({base: {data: {archivedOrders: {}, books: {journal: {}}}}, topLevel: ['archivedOrders', 'books', 'activeOrders', 'shifts', 'menuItems'], children: {books: ['journal', 'config']}, excluded: ['activeOrders'], dirty: {archivedOrders: {x: 1}, shifts: {y: 1}, 'books~journal': {z: 1}}});
  assert.deepEqual(plan, {fullNodes: ['books/config', 'menuItems'], copyPaths: ['archivedOrders', 'books/journal'], records: [{path: 'archivedOrders', key: 'x'}, {path: 'books/journal', key: 'z'}], fullTracked: ['shifts'], verifySlice: null});
  assert.equal(BackupDelta.needsFullBackup({base: {takenAt: 1}, now: 2, lastMode: 'full'}), '');
  assert.equal(BackupDelta.needsFullBackup({base: {takenAt: 1}, now: 8 * 86400000 + 2, lastMode: 'incremental'}), 'stale_base');
  assert.equal(BackupDelta.needsFullBackup({base: {takenAt: 1}, now: 2}), 'markers_new', 'the first run after this release (markers just started) reads everything');
  // Slices partition each tracked node by key within the byte budget, cover keys added later, and
  // no single day verifies more than about one budget of history.
  const big = {}; for (let i = 0; i < 40; i += 1) big[`k${String(i).padStart(2, '0')}`] = {pad: 'x'.repeat(1000)};
  const slices = BackupDelta.verificationSlices({data: {archivedOrders: big}}, ['archivedOrders'], 5000);
  assert.ok(slices.length >= 8 && slices[0].start === null && slices.at(-1).before === null);
  for (const key of [...Object.keys(big), 'a_first', 'k05x', 'zz_last']) assert.equal(slices.filter((sl) => BackupDelta.inSlice(key, sl)).length, 1, `key ${key} is in exactly one slice`);
  assert.ok(slices.every((sl) => Object.keys(big).filter((k) => BackupDelta.inSlice(k, sl)).length <= 5));
  assert.equal(new Set(Array.from({length: slices.length}, (_, i) => BackupDelta.rotationSlice(i * 86400000, slices))).size, slices.length, 'every slice is verified once per cycle');
  const sliced = {p: {a: 1, b: 2, c: 3}};
  assert.deepEqual(BackupDelta.applyVerifiedSlice(sliced, {path: 'p', start: 'b', before: null}, {c: 4, d: 5}).sort(), ['p/b', 'p/c', 'p/d'], 'unmarked deletes, edits and additions in the range are reported');
  assert.deepEqual(sliced, {p: {a: 1, c: 4, d: 5}}, 'the verified range replaces the incremental copy; keys outside it are untouched');
  assert.ok(BackupDelta.keyCompare('2', '10') < 0 && BackupDelta.keyCompare('10', 'a') < 0 && BackupDelta.keyCompare('B', 'a') < 0, 'database key order');
  assert.ok(read('src/functions/60-maintenance.js').includes('BackupDelta.DIRTY_ROOT]);'), 'dirty markers are never backed up');
}

console.log('PASS: replica-first history reads, tab-stable report listeners, ID-patched archive changes, month-bounded Stock Value journal (equivalent to full history), Books without full archive downloads, and indexed/bounded server reads, bounded per-item inventory idempotency state, day-bucketed Books monthly totals, stale tabs that pick up fixed builds, a backup download budget warning, index-first platform order lookups, voucher receipts outside the voucher list, summary-based cash controls, a period-bounded Books Cash Flow, and incremental daily backups.');
