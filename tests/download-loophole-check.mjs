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
  assert.ok(warn.alerts.some((x) => x.id === 'backup_download_budget' && x.severity === 'warning' && x.detail.includes('61 MB of the 360 MB')));
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

console.log('PASS: replica-first history reads, tab-stable report listeners, ID-patched archive changes, month-bounded Stock Value journal (equivalent to full history), Books without full archive downloads, and indexed/bounded server reads, bounded per-item inventory idempotency state, day-bucketed Books monthly totals, stale tabs that pick up fixed builds, a backup download budget warning, index-first platform order lookups, and voucher receipts outside the voucher list.');
