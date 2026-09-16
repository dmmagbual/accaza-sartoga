// Release check: Admin/POS, Finance Books and the customer site must not download a growing
// Realtime Database node in full (Sep 2026 download audit). Every whole-node read or listener in
// the browser code is either a small configuration node, listed below with the reason it is
// acceptable, or annotated in place with /* download-ok: <kind> <why> */.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {HISTORY_BOUNDS, BOOTSTRAPPED_INCREMENTAL_BOUNDS, GROWING_PATHS, WINDOWED_PATHS, createSubscriptionHub} from '../assets/js/admin/realtime-hub.mjs';
import {rulesIndex} from '../tools/download-read-graph.mjs';

const root = new URL('..', import.meta.url).pathname;
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const walk = (dir) => fs.readdirSync(path.join(root, dir), {withFileTypes: true}).flatMap((e) => e.isDirectory() ? walk(`${dir}/${e.name}`) : /\.m?js$/.test(e.name) ? [`${dir}/${e.name}`] : []);
// Every browser file, not a hand-picked subset. The built bundles are excluded only because
// they are generated from the src/ sections that are already listed here (the drift check
// proves they match). The 2026-09-16 audit found whole-node listeners in assets/js/admin and
// assets/js/books files that this list used to skip entirely.
const BUILT = new Set(['assets/js/admin/pos.js', 'assets/js/admin/register.js', 'assets/js/admin/analytics.js', 'assets/js/admin/finance.js', 'assets/js/books/app.js', 'assets/js/customer/core.mjs']);
const FILES = [...new Set([...walk('src/admin'), ...walk('src/books'), ...walk('src/customer'), ...walk('assets/js/admin'), ...walk('assets/js/books'), ...walk('assets/js/customer'), ...walk('assets/js/shared')])].filter((f) => !BUILT.has(f));

// Small configuration or single-record nodes.
const SMALL = new Set(['.info/connected', 'settings', 'config', 'payment', 'calBlocks', 'availability', 'channelPrices', 'posStaff', 'posActiveShift', 'cfAccounts', 'chartOfAccounts',
  'accountingPeriods', 'publicCatalogVersion', 'historicalArchiveSync', 'books/monthlyNet', 'booksChart', 'cashFlowIndexMeta', 'cashFlowOpenings', 'cashFlowMonthly',
  'staffAccounts', 'adminAccounts', 'admins', 'adminPerms', 'usageTypes', 'expenseItems', 'platformVarAccounts', 'pettyCashSettings', 'heldOrders', 'receivables',
  'systemHealth', 'staffReceiptIndex']);
// Whole-node reads that are accepted, with the reason. Anything new must be added here on purpose.
const ACCEPTED = {
  'payables': 'Finance Books supplier ledger and reversal flows need every bill; about 12 KB (follow-up: open bills only)',
  'suppliers': 'supplier master list (about 70 records) for supplier pickers',
  'fixedAssets': 'fixed-asset register, opened on the Fixed Assets page only',
  'personalFundings': 'owner funding register, Transactions page only',
  'menuItems': 'menu catalog (configuration), read by menu, recipe and insight pages',
  'categories': 'menu categories (configuration)',
  'optionGroups': 'menu option groups (configuration)',
  'packagingRules': 'packaging configuration',
  'packages': 'menu packages (configuration)',
  'recipes': 'recipe book (configuration), recipe tools only',
  'optionRecipes': 'option recipes (configuration)',
  'inventorySku': 'SKU master for the SKU manager (configuration)',
  'posSettings/packagingAssignments': 'packaging configuration value',
  'posSettings/optionCosts': 'shared choice ingredient configuration value',
  'posSettings/payMethods': 'payment method configuration value',
  'posSettings/cashRounding': 'register setting value',
  'posSettings': 'register settings (configuration), register settings pages',
  'reservations': 'open reservations only (archived ones move to archivedReservations)',
  'feedbacks': 'customer feedback list, Comments page only',
  'reviews': 'customer reviews (a handful), Reviews page only',
  'appCustomers': 'installed-app customer list, App Customers page only',
  'monthlyExpenses': 'one row per month, P&L page only',
  'posDeviceHealth': 'device status for the one open shift, Live Operations page only; read as posDeviceHealth/<shiftId>, a single shift record',
  'shiftCloseReceipts': 'one small control record per closed shift; no browser reads the node',
  'ownerDailySummaries': 'one row per day, Live Operations page only; read as ownerDailySummaries/<day>, a single day record',
  'pettyCashVouchers': 'cash payment vouchers; images live in pettyCashReceipts, and any inline legacy copy that survives the move is a follow-up (see moveLegacyVoucherReceipts)',
  'pettyCashReplenishments': 'revolving fund replenishments, Cash Payments page only',
  'inventory': 'stock item master, attached per child (incremental)',
  'activeOrders': 'open orders only, attached per child (incremental)',
};
const KINDS = /download-ok:\s*(manual|action|catalog|bounded|fallback|migration)\b/;
// A read of a single named record under an otherwise-growing node (systemHealth/backups/latest)
// inherits the policy of the longest prefix that is documented as small or accepted.
function smallOrAccepted(path) {
  const parts = path.split('/');
  for (let n = parts.length; n > 0; n -= 1) {
    const candidate = parts.slice(0, n).join('/');
    if (SMALL.has(candidate) || ACCEPTED[candidate]) return true;
  }
  return false;
}

const findings = [];
const WHOLE = /(?:\b(?:get|onValue|onChildAdded|watchValue|watchMap)\((?:a\.)?ref\((?:a\.)?(?:db|database),\s*|return ref\(db,\s*)(['"])\/?([^'"]+)\1\)/g;
for (const file of FILES) {
  const src = read(file);
  for (const m of src.matchAll(WHOLE)) {
    const node = m[2].replace(/\/$/, '');
    if (smallOrAccepted(node)) continue;
    const lineStart = src.lastIndexOf('\n', m.index) + 1, before = src.slice(lineStart, m.index);
    if (KINDS.test(before)) continue;
    findings.push(`${file}:${src.slice(0, m.index).split('\n').length} downloads /${node} in full`);
  }
}

// Admin subscription hub: every path attached without a bound must be small or accepted.
const hub = read('assets/js/admin/realtime-hub.mjs');
const constKeys = (name) => { const m = new RegExp(`const ${name}=\\{(.*)\\};`).exec(hub); assert.ok(m, `${name} not found`); return new Set([...m[1].matchAll(/['"]?([\w/]+)['"]?\s*:/g)].map((x) => x[1])); };
const bounded = new Set([...Object.keys(HISTORY_BOUNDS), ...constKeys('INCREMENTAL_PATHS'), ...constKeys('VERSIONED_MASTER_PATHS'), ...constKeys('CURRENT_MONTH_PATHS'), ...constKeys('OPEN_ROW_PATHS'), ...constKeys('BOOTSTRAPPED_INCREMENTAL_BOUNDS')]);
const scopesMatch = /var scopes=\{([\s\S]*?)\n  \};/.exec(hub);
assert.ok(scopesMatch, 'hub scopes not found');
const scoped = [...scopesMatch[1].matchAll(/(?:^|,|\n)\s*['"]?([\w/]+)['"]?\s*:\s*\[/g)].map((x) => x[1]);
assert.ok(scoped.length > 40, `expected the hub to scope more than 40 paths, found ${scoped.length}`);
for (const node of scoped) if (!bounded.has(node) && !GROWING_PATHS[node] && !WINDOWED_PATHS[node] && !SMALL.has(node) && !ACCEPTED[node]) findings.push(`realtime-hub.mjs attaches /${node} in full; bound it or document why it is acceptable`);
// A node that grows with trading volume is only safe when the hub either bounds it with a
// query or attaches it per child. The growing list must not contain anything that is also
// treated as a whole-node listener, and every path any file subscribes to must be accounted
// for -- including paths subscribed with explicit options, which the hub scope list misses.
// Top-level keys of an object literal whose values are themselves objects (WINDOWED_PATHS).
const topKeys = (name) => {
  const at = hub.indexOf(`${name}={`); assert.ok(at >= 0, `${name} not found`);
  const body = hub.slice(at + name.length + 2);
  let depth = 0, end = body.length;
  for (let i = 0; i < body.length; i += 1) {
    if (body[i] === '{') depth += 1;
    else if (body[i] === '}') { if (depth === 0) { end = i; break; } depth -= 1; }
  }
  // Blank out nested objects so only the literal's own keys remain.
  let flat = '', level = 0;
  for (const ch of body.slice(0, end)) {
    if (ch === '{') { level += 1; continue; }
    if (ch === '}') { level -= 1; continue; }
    flat += level === 0 ? ch : ' ';
  }
  return [...new Set([...flat.matchAll(/(?:^|,)\s*(?:'([\w/]+)'|"([\w/]+)"|([\w/]+))\s*:/g)].map((m) => m[1] || m[2] || m[3]))];
};
assert.deepEqual(topKeys('WINDOWED_PATHS'), Object.keys(WINDOWED_PATHS), 'windowed-path keys were not read correctly');
const growing = new Set([...Object.keys(GROWING_PATHS), ...Object.keys(WINDOWED_PATHS)]);
assert.ok(growing.size >= 10, `expected the hub to declare the growing nodes it attaches per child, found ${growing.size}`);
// A path is accounted for when it, or the longest prefix of it, is bounded / incremental /
// small / accepted. This is what lets a dynamic child (posDeviceHealth/<shiftId>,
// staffReceiptIndex/<uid>) inherit the policy of the node it lives under.
function accounted(path) {
  const parts = path.split('/');
  for (let n = parts.length; n > 0; n -= 1) {
    const candidate = parts.slice(0, n).join('/');
    if (bounded.has(candidate) || GROWING_PATHS[candidate] || WINDOWED_PATHS[candidate] || SMALL.has(candidate) || ACCEPTED[candidate]) return true;
  }
  return false;
}
const SUBSCRIBE = /\.subscribe\(\s*(['"])([^'"]+)\1/g;
for (const file of FILES) for (const m of read(file).matchAll(SUBSCRIBE)) {
  if (!accounted(m[2])) findings.push(`${file} subscribes to /${m[2]} without a bound, an incremental attach or a documented reason`);
}

// Every browser query must be backed by an .indexOn rule; otherwise the SDK downloads the whole
// node and filters it on the device.
const indexed = rulesIndex(read('database.rules.json'));
const QUERY = /query\((?:a\.)?ref\((?:a\.)?(?:db|database|base),\s*(['"])\/?([^'"]+)\1\),\s*(?:a\.)?orderByChild\((['"])([^'"]+)\3\)/g;
for (const file of FILES) for (const m of read(file).matchAll(QUERY)) if (!indexed(m[2], m[4])) findings.push(`${file} queries /${m[2]} by ${m[4]} without an .indexOn rule`);
for (const node of Object.keys(HISTORY_BOUNDS)) if (!indexed(node, HISTORY_BOUNDS[node].field)) findings.push(`realtime-hub.mjs bounds /${node} by ${HISTORY_BOUNDS[node].field} without an .indexOn rule`);
const liveSrc = read('assets/js/books/live-pos.mjs');
for (const m of liveSrc.matchAll(/var base=ref\(db,"\/([^"]+)"\);return\[([^\]]*)\]/g)) for (const f of m[2].matchAll(/orderByChild\("([^"]+)"\)/g)) if (!indexed(m[1], f[1])) findings.push(`live-pos.mjs queries /${m[1]} by ${f[1]} without an .indexOn rule`);
indexed('cashCustody', 'remaining') || findings.push('cashCustody needs an index on remaining');

assert.deepEqual(findings, [], `Browser code downloads growing nodes in full:\n${findings.join('\n')}`);

// Specific regressions from the 16 Sep 2026 audit.
const live = read('assets/js/books/live-pos.mjs');
assert.ok(!live.includes('"/books/reviewQueue"'), 'Books must not download the review queue (no page reads it)');
assert.ok(live.includes('query(base,orderByChild("status"),endBefore("reviewed"))'), 'Books reads only open cash variances');
assert.ok(live.includes('query(ref(db,"/cashCustody"),orderByChild("remaining"),startAt(0.005))'), 'Cash Flow reads only custody that still holds cash');
assert.ok(live.includes('orderByChild("depositMovementId"),equalTo(null)'), 'Cash Flow reads only payouts not yet deposited');
assert.ok(live.includes('query(ref(db,"/purchaseInvoices"),orderByChild("date"),startAt('), 'the Purchases register reads the selected period');
assert.ok(read('src/admin/pos/20-purchasing.js').includes("a.orderByChild('ing'),a.equalTo(id)"), 'brand breakdown reads one item\'s receipts');
// Admin Cash Flow attaches custody through the remaining index.
{
  const attached = [];
  const ops = {ref: (_db, p) => ({path: p}), query: (t, ...parts) => Object.assign({}, t, ...parts), orderByChild: (field) => ({field}), limitToLast: (limit) => ({limit}), startAt: (start) => ({start}), endAt: (end) => ({end}), endBefore: () => ({}),
    onValue: (target) => { attached.push(target); return () => {}; }, onChildAdded: () => () => {}, onChildChanged: () => () => {}, onChildRemoved: () => () => {}, get: async () => ({val: () => ({})}), readHistoricalOrders: async () => ({orders: {}, hasMore: false})};
  globalThis.window = globalThis.window || {AccazaDate: {key: () => '2026-09-16'}, addEventListener() {}};
  const hub = createSubscriptionHub({}, ops);
  hub.subscribe('cashCustody', () => {}); hub.authorize(); hub.activate('cashflow');
  await new Promise((r) => setTimeout(r, 0));
  const custody = attached.find((t) => t.path === 'cashCustody');
  assert.ok(custody && custody.field === 'remaining' && custody.start === 0.005, 'Admin Cash Flow reads only custody that still holds cash');
}
// Regressions from the Sep 2026 follow-up audit: nodes that grow with trading volume, were
// attached with a plain onValue, and so re-downloaded everything on every write.
{
  const attached = [], childPaths = [], bootstrapped = [];
  const ops = {ref: (_db, p) => ({path: p}), query: (t, ...parts) => Object.assign({}, t, ...parts), orderByChild: (field) => ({field, ordered: true}), limitToLast: (limit) => ({limit}), startAt: (start) => ({start}), endAt: (end) => ({end}), endBefore: () => ({}),
    onValue: (target, _cb, _err, opts) => { attached.push(Object.assign({}, target, {onlyOnce: !!(opts && opts.onlyOnce)})); return () => {}; },
    onChildAdded: (target) => { childPaths.push(target); return () => {}; }, onChildChanged: (target) => { childPaths.push(target); return () => {}; }, onChildRemoved: (target) => { childPaths.push(target); return () => {}; },
    get: async (target) => { bootstrapped.push(target); return {val: () => ({})}; }, readHistoricalOrders: async () => ({orders: {}, hasMore: false})};
  // A persistent whole-node value listener is what must not exist. A one-time value event on
  // the same target shares the child listeners' single listen and costs nothing extra.
  const persistent = (t) => !t.onlyOnce;
  globalThis.window = globalThis.window || {AccazaDate: {key: () => '2026-09-16'}, addEventListener() {}};
  const hub = createSubscriptionHub({}, ops);
  // A customer review on the shop dashboard, a staff message, one device health ping and one
  // staff member's own receipt index -- the shapes that used to re-download whole nodes.
  for (const path of ['reviews', 'staffMessages', 'posDeviceHealth/SH1', 'staffReceiptIndex/u1', 'reservations']) hub.subscribe(path, () => {}, {critical: true, scopes: ['dashboard', 'liveoperations']});
  hub.authorize(); hub.activate('dashboard'); hub.activate('liveoperations');
  await new Promise((r) => setTimeout(r, 0));
  for (const path of ['reviews', 'posDeviceHealth/SH1', 'staffReceiptIndex/u1']) {
    assert.ok(!attached.some((t) => t.path === path && persistent(t)), `/${path} must not attach a whole-node onValue listener`);
    assert.ok(childPaths.some((t) => t.path === path), `/${path} must attach per-child listeners`);
  }
  // /reservations must stay whole-node. Its page decides that a booking is new by diffing the
  // previous key list, so per-child delivery would make the second and every later key of the
  // first batch look new and chime for bookings that were already open.
  assert.ok(attached.some((t) => t.path === 'reservations'), '/reservations keeps its aggregate snapshot so new-booking detection stays correct');
  assert.ok(!childPaths.some((t) => t.path === 'reservations'), '/reservations must not attach per-child listeners');
  assert.ok(!GROWING_PATHS.reservations, '/reservations is not a growth problem: archived bookings move to archivedReservations');
  // staffMessages takes its first snapshot from a one-time value event on the windowed query,
  // then applies changes per child -- so one new message no longer re-downloads every message.
  const messages = attached.find((t) => t.path === 'staffMessages');
  assert.ok(messages && messages.onlyOnce && messages.field === 'createdAt' && messages.start > 0, 'the Staff Inbox reads only the active message window');
  assert.ok(childPaths.some((t) => t.path === 'staffMessages' && t.field === 'createdAt'), 'the Staff Inbox applies message changes per child on the same window');
  assert.ok(!attached.some((t) => t.path === 'staffMessages' && persistent(t)), 'the Staff Inbox must not hold a whole-node message listener');
  // 17 Sep 2026: a get() before the child listeners downloaded every per-child path twice,
  // because the SDK drops a completed get() from its cache before the listen starts.
  assert.equal(bootstrapped.length, 0, 'per-child paths must not bootstrap with a separate get()');
}
// The Staff Inbox reads its own index instead of every staff member's receipts, and reads the
// legacy receipt one active message at a time while it bridges them.
{
  const inbox = read('assets/js/admin/staff-inbox.js');
  assert.ok(!/subscribe\(\s*['"]staffMessageReceipts['"]/.test(inbox), 'the Staff Inbox must not subscribe to the whole receipts node');
  assert.ok(inbox.includes("a.subscribe('staffReceiptIndex/'+u"), 'the Staff Inbox reads the reader\'s own receipt index');
  assert.ok(inbox.includes("'staffMessageReceipts/'+id+'/'+u"), 'legacy receipts are bridged one active message at a time');
  assert.ok(inbox.includes('seeded') && inbox.includes('seeding'), 'the legacy receipt bridge runs once');
}
// Finance Books must not download /suspenseAdvanceConversions, and the server maintains the
// per-reader receipt index that replaced the whole-node receipt listener.
{
  assert.ok(!/\bonValue\s*\(/.test(read('assets/js/books/suspense-advance.mjs')), 'Finance Books must not listen to the whole conversions node');
  const auth = read('src/functions/20-portal-auth.js');
  assert.ok(auth.includes('staffReceiptIndex/${actor.uid}/${messageId}'), 'manageStaffMessage must maintain the reader\'s own receipt index');
  assert.ok(read('database.rules.json').includes('"staffReceiptIndex"'), 'the receipt index needs a rules block');
}
console.log(`client download guard: ${FILES.length} files and ${scoped.length} hub paths checked`);
