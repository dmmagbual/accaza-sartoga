// Release check: Admin/POS, Finance Books and the customer site must not download a growing
// Realtime Database node in full (Sep 2026 download audit). Every whole-node read or listener in
// the browser code is either a small configuration node, listed below with the reason it is
// acceptable, or annotated in place with /* download-ok: <kind> <why> */.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {HISTORY_BOUNDS, createSubscriptionHub} from '../assets/js/admin/realtime-hub.mjs';
import {rulesIndex} from '../tools/download-read-graph.mjs';

const root = new URL('..', import.meta.url).pathname;
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const walk = (dir) => fs.readdirSync(path.join(root, dir), {withFileTypes: true}).flatMap((e) => e.isDirectory() ? walk(`${dir}/${e.name}`) : /\.m?js$/.test(e.name) ? [`${dir}/${e.name}`] : []);
const FILES = [...walk('src/admin'), ...walk('src/books'), ...walk('src/customer'), 'assets/js/books/live-pos.mjs', 'assets/js/admin/core.mjs', 'assets/js/admin/realtime-hub.mjs', ...fs.readdirSync(path.join(root, 'assets/js/shared')).filter((f) => f.endsWith('.js')).map((f) => `assets/js/shared/${f}`)];

// Small configuration or single-record nodes.
const SMALL = new Set(['.info/connected', 'settings', 'config', 'payment', 'calBlocks', 'availability', 'channelPrices', 'posStaff', 'posActiveShift', 'cfAccounts', 'chartOfAccounts',
  'accountingPeriods', 'publicCatalogVersion', 'historicalArchiveSync', 'books/monthlyNet', 'booksChart', 'cashFlowIndexMeta', 'cashFlowOpenings', 'cashFlowMonthly',
  'staffAccounts', 'adminAccounts', 'admins', 'adminPerms', 'usageTypes', 'expenseItems', 'platformVarAccounts', 'pettyCashSettings', 'heldOrders', 'receivables']);
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
  'posDeviceHealth': 'device status per shift, Live Operations page only (follow-up: recent shifts only)',
  'shiftCloseReceipts': 'shift close receipts, Live Operations page only (follow-up: recent shifts only)',
  'ownerDailySummaries': 'one row per day, Live Operations page only (follow-up: recent days only)',
  'pettyCashVouchers': 'cash payment vouchers without receipt images (images live in pettyCashReceipts)',
  'pettyCashReplenishments': 'revolving fund replenishments, Cash Payments page only',
  'inventory': 'stock item master, attached per child (incremental)',
  'activeOrders': 'open orders only, attached per child (incremental)',
};
const KINDS = /download-ok:\s*(manual|action|catalog|bounded|fallback|migration)\b/;

const findings = [];
const WHOLE = /(?:\b(?:get|onValue|onChildAdded|watchValue|watchMap)\((?:a\.)?ref\((?:a\.)?(?:db|database),\s*|return ref\(db,\s*)(['"])\/?([^'"]+)\1\)/g;
for (const file of FILES) {
  const src = read(file);
  for (const m of src.matchAll(WHOLE)) {
    const node = m[2].replace(/\/$/, '');
    if (SMALL.has(node) || ACCEPTED[node]) continue;
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
for (const node of scoped) if (!bounded.has(node) && !SMALL.has(node) && !ACCEPTED[node]) findings.push(`realtime-hub.mjs attaches /${node} in full; bound it or document why it is acceptable`);

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
console.log(`client download guard: ${FILES.length} files and ${scoped.length} hub paths checked`);
