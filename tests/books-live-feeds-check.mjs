// Runs assets/js/books/live-pos.mjs against stub Firebase modules and checks what each Finance
// Books tab listens to (Sep 2026 download audit): nothing unbounded on growing nodes, the
// Purchases register follows the selected period, and Payables reads only the invoices its bills name.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../assets/js/books/live-pos.mjs', import.meta.url), 'utf8')
  .replace(/^import\s*\{([^}]*)\}\s*from\s*"[^"]+";/gm, '');
const listeners = [], gets = [], data = {purchaseInvoices: {PI1: {date: '2026-09-02', total: 10}, PI2: {date: '2026-08-01', total: 20}}};
const describe = (target) => (target.path + (target.constraints || []).map((c) => `|${Object.entries(c).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(',')}`).join(''));
let authCallback = null;
const windowListeners = {};
const win = {
  App: {render() {}, rebuildPeriodSel() {}},
  AccazaReportPeriod: {get: () => ({from: '2026-09-01', to: '2026-09-16', startAt: 1, endAt: 2})},
  addEventListener: (type, fn) => { windowListeners[type] = fn; },
};
const snapshot = (key, value) => ({key, exists: () => value != null, val: () => value});
const context = {
  window: win, document: {getElementById: () => null}, console, requestAnimationFrame: (fn) => fn(), setTimeout,
  todayStr: () => '2026-09-16',
  initializeApp: () => ({}), getDatabase: () => ({}), getAuth: () => ({currentUser: {email: 'owner@example.com'}}), getFunctions: () => ({}),
  httpsCallable: () => async () => ({data: {}}),
  ref: (_db, path) => ({path: String(path).replace(/^\//, '')}),
  query: (target, ...constraints) => ({path: target.path, constraints}),
  orderByChild: (f) => ({orderByChild: f}), orderByKey: () => ({orderByKey: true}), equalTo: (v) => ({equalTo: v}),
  startAt: (v) => ({startAt: v}), endAt: (v) => ({endAt: v}), endBefore: (v) => ({endBefore: v}), startAfter: (v) => ({startAfter: v}),
  get: async (target) => { gets.push(describe(target)); const parts = target.path.split('/'); const value = parts.reduce((n, p) => n && n[p], data); return snapshot(parts.at(-1), value ?? null); },
  onValue: (target) => { listeners.push({kind: 'value', target: describe(target), active: true}); const l = listeners.at(-1); return () => { l.active = false; }; },
  onChildAdded: (target, cb) => { listeners.push({kind: 'child', target: describe(target), active: true}); const l = listeners.at(-1); return () => { l.active = false; }; },
  onChildChanged: () => () => {}, onChildRemoved: () => () => {},
  onAuthStateChanged: (_auth, cb) => { authCallback = cb; },
  signInWithEmailAndPassword: async () => {}, signOut: async () => {}, setPersistence: async () => {}, browserLocalPersistence: {},
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(source, context);
context.App = win.App;
assert.ok(authCallback, 'Books waits for sign-in');
authCallback({email: 'owner@example.com'});
const active = () => listeners.filter((l) => l.active).map((l) => l.target);
const tab = (id) => windowListeners['accaza-books-tab']({detail: {id}});

// Base feeds after sign-in: no review queue, orders only through indexed queries.
assert.ok(!active().some((t) => t.startsWith('books/reviewQueue')), 'the unused review queue is not downloaded');
assert.ok(active().every((t) => !/^(orders|archivedOrders|financialMovements|purchaseInvoices|discrepancies|platformPayouts|cashCustody)$/.test(t)), `no growing node is attached in full: ${active().join(' ; ')}`);

tab('journal');
assert.ok(active().includes('discrepancies|orderByChild="status"|endBefore="reviewed"') && active().includes('discrepancies|orderByChild="status"|startAfter="reviewed"'), 'journal lists only open cash variances');
assert.ok(!active().includes('discrepancies'));

tab('cashflow');
assert.ok(active().includes('cashCustody|orderByChild="remaining"|startAt=0.005'), 'custody holding cash only');
assert.ok(active().includes('platformPayouts|orderByChild="depositMovementId"|equalTo=null') && active().includes('platformPayouts|orderByChild="reversed"|equalTo=true'), 'payouts awaiting deposit only');
assert.ok(!active().includes('cashCustody') && !active().includes('platformPayouts'));

tab('payables');
assert.ok(!active().some((t) => t.startsWith('purchaseInvoices')), 'Payables attaches no purchase register');
win.__booksEnsurePurchaseInvoices(['PI1', 'PI1', '', 'bad/key', undefined]);
await new Promise((r) => setTimeout(r, 0));
assert.deepEqual(gets.filter((g) => g.startsWith('purchaseInvoices')), ['purchaseInvoices/PI1'], 'only the named invoice is read, once');
assert.equal(win.__piMap.PI1.total, 10);

tab('purchases');
assert.ok(active().includes('purchaseInvoices|orderByChild="date"|startAt="2026-09-01"|endAt="2026-09-16"'), 'the register reads the selected period');
assert.equal(Object.keys(win.__piMap).length, 0, 'the register starts empty, not with invoices loaded for Payables');

tab('payables');
assert.ok(!active().some((t) => t.startsWith('purchaseInvoices')), 'leaving Purchases detaches the register');
win.__booksEnsurePurchaseInvoices(['PI1']);
await new Promise((r) => setTimeout(r, 0));
assert.equal(gets.filter((g) => g === 'purchaseInvoices/PI1').length, 2, 'an invoice is read again after the map was reset');
assert.equal(win.__piMap.PI1.total, 10);
console.log('PASS: Finance Books tabs attach only bounded feeds; Purchases follows the period and Payables loads named invoices only.');
