import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// A staff tick controls whether a screen is shown. It must never cut the data another ticked
// screen needs: every screen's own tick must be able to READ everything that screen loads.
// Writes stay with each screen's own tick and are not widened here.
const read = rel => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const hub = read('assets/js/admin/realtime-hub.mjs');
const core = read('assets/js/admin/core.mjs');
const rules = read('database.rules.json').split('\n');
const history = read('src/functions/61-historical-archive.js');
const cashBalances = read('src/functions/23-cash-balance-summary.js');

const scopeSource = hub.slice(hub.indexOf('var scopes={') + 11);
const scopes = vm.runInNewContext('(' + scopeSource.slice(0, scopeSource.indexOf('};') + 1).replace(/\/\/[^\n]*/g, '') + ')');
const historyPaths = vm.runInNewContext('(' + hub.match(/const HISTORY_TAB_PATHS=(\{[^;]*\});/)[1] + ')');
const tabKeys = Object.fromEntries(Object.entries(vm.runInNewContext('(' + core.match(/var _permTabMap=(\{[^}]*\});/)[1] + ')')).map(([tab, key]) => [tab.replace(/'/g, ''), key]));
assert.ok(Object.keys(tabKeys).length >= 20, 'staff tab map not found');

function readRule(node) {
  const start = rules.findIndex(line => new RegExp(`^\\s+"${node}"\\s*:`).test(line));
  if (start < 0) return null;
  for (const line of rules.slice(start, start + 15)) {
    const m = line.match(/"\.read":\s*(true|false|"((?:[^"\\]|\\.)*)")/);
    if (m) return m[1] === 'true' ? 'true' : m[1] === 'false' ? 'false' : m[2];
  }
  return null;
}
const OPEN = new Set(['true', 'auth != null', "auth != null && root.child('admins').child(auth.uid).exists()"]);
function canRead(path, key) {
  const [top, child] = path.split('/');
  const rule = readRule(top) ?? (child ? readRule(child) : null);
  assert.notEqual(rule, null, `no read rule found for ${path}`);
  return OPEN.has(rule) || rule.includes(`root.child('adminPerms').child(auth.uid).child('${key}').val() === true`);
}

// 1. Realtime Database: every path a staff screen attaches is readable with that screen's tick.
const gaps = [];
for (const [tab, key] of Object.entries(tabKeys)) {
  const paths = new Set([...Object.keys(scopes).filter(path => scopes[path].includes(tab)), ...(historyPaths[tab] || [])]);
  for (const path of paths) if (!canRead(path, key)) gaps.push(`${tab} (${key}) cannot read ${path}`);
}
assert.deepEqual(gaps, [], `staff screens depend on another screen's tick:\n${gaps.join('\n')}`);

// 2. Screens that load archived orders go through readHistoricalOrders; it must accept their ticks.
const ordersGate = history.slice(history.indexOf('exports.readHistoricalOrders'), history.indexOf('exports.readHistoricalSalesRollup')).match(/requirePortalPermission\(db, request, (\[[^\]]*\])\)/);
assert.ok(ordersGate, 'readHistoricalOrders permission list not found');
const ordersKeys = vm.runInNewContext(ordersGate[1]);
for (const [tab, key] of Object.entries(tabKeys)) {
  const loadsArchive = (historyPaths[tab] || []).includes('archivedOrders') || (scopes.archivedOrders || []).includes(tab);
  if (loadsArchive) assert.ok(ordersKeys.includes(key), `${tab} loads archived orders but readHistoricalOrders refuses ${key}`);
}

// 3. Cash Payments shows current cash balances from getCurrentCashBalances.
const cashGate = cashBalances.slice(cashBalances.indexOf('exports.getCurrentCashBalances')).match(/requirePortalPermission\(db, request, (\[[^\]]*\])\)/);
assert.ok(cashGate && vm.runInNewContext(cashGate[1]).includes('petty'), 'Cash Payments must read current cash balances with its own tick');

// 4. Reading is not editing: Recipes can read stock-item costs but cannot change stock items.
const writeRule = node => { const start = rules.findIndex(line => new RegExp(`^\\s+"${node}"\\s*:`).test(line)); const line = rules.slice(start, start + 15).find(l => l.includes('".write"')); return line ? line.slice(line.indexOf('".write"')) : ''; };
assert.ok(canRead('inventory', 'recipes'), 'Recipes must read ingredient costs without Stock Items');
assert.ok(!writeRule('inventory').includes("child('recipes').val() === true"), 'Recipes must not gain write access to stock items');
assert.ok(canRead('channelPrices', 'pos'), 'POS must read Grab/FoodPanda prices without Channel Pricing');

console.log('PASS: every staff screen can read all the data it loads with its own tick; unticking one screen never breaks another.');
