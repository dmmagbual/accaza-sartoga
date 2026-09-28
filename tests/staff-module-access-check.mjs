import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = rel => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const serverSource = read('src/functions/20b-portal-accounts.js');
const coreSource = read('assets/js/admin/core.mjs');
const screenSource = read('assets/js/admin/staff-access.js');
const navHtml = read('src/html/admin/50-admin-workspace.html');
const rules = read('database.rules.json');
const undepositedSource = read('src/functions/21a-undeposited-pages.js');
const historySource = read('src/functions/61-historical-archive.js');

const grab = (source, pattern, label) => { const m = source.match(pattern); assert.ok(m, `${label} not found`); return m[1]; };
const evalIn = (code, context = {}) => vm.runInNewContext(code, context);

// 1. One key set everywhere: server allow-list, Admin gating defaults, and the account screen.
const serverKeys = evalIn(grab(serverSource, /const PORTAL_PERMISSION_KEYS = (\[[^\]]*\]);/, 'server keys'));
const coreDefaults = evalIn(`(${grab(coreSource, /var DEFAULT_STAFF_PERMS=(\{[^}]*\})/, 'Admin defaults')})`);
const screenDefaults = evalIn(`(${grab(screenSource, /var DEFAULTS=(\{[^}]*\});/, 'screen defaults')})`);
const nav = evalIn(`(${grab(screenSource, /var NAV=(\[[\s\S]*?\n\]);/, 'screen NAV')})`);
const navKeys = nav.flatMap(g => g.tabs.filter(t => t.key).map(t => t.key));
const sorted = keys => Array.from(keys).sort();
assert.deepEqual(sorted(Object.keys(coreDefaults)), sorted(serverKeys), 'Admin gating and server allow-list disagree');
assert.deepEqual(sorted(Object.keys(screenDefaults)), sorted(serverKeys), 'account screen defaults and server allow-list disagree');
assert.deepEqual(sorted(navKeys), sorted(serverKeys), 'account screen rows and server allow-list disagree');
assert.equal(new Set(navKeys).size, navKeys.length, 'a permission key appears on two rows');
assert.deepEqual(Object.keys(coreDefaults).filter(k => coreDefaults[k] !== screenDefaults[k]), [], 'new-account defaults differ between screen and Admin');

// 2. The account screen mirrors the Admin navigation: same groups, same order, one row per tab.
const groups = [...navHtml.matchAll(/showTabGroup\('([a-z]+)',this\)"[^>]*>([^<]+)</g)].map(m => m[2].replace('&amp;', '&').trim());
const adminGroups = Array.from(nav.filter(g => g.group !== "Outside Admin"), g => g.group);
assert.deepEqual(adminGroups, groups, 'account screen groups must match the Admin navigation');
const rows = [...navHtml.matchAll(/data-grp="([a-z]+)"|(?:posSwitchTab|switchTab|showAdminSection)\('([a-zA-Z]+)'/g)];
const tabsPerGroup = {}; let current = null;
for (const m of rows) { if (m[1]) { current = m[1]; tabsPerGroup[current] ||= []; } else if (current && !tabsPerGroup[current].includes(m[2])) tabsPerGroup[current].push(m[2]); }
const groupIds = [...navHtml.matchAll(/showTabGroup\('([a-z]+)',this\)/g)].map(m => m[1]);
// Reservations and Calendar share one key, so the screen shows them as one row.
const sharedRows = ['calendar'];
groupIds.forEach((id, i) => assert.equal(nav[i].tabs.length, tabsPerGroup[id].filter(t => !sharedRows.includes(t)).length, `${nav[i].group} lists ${nav[i].tabs.length} tabs but Admin has ${tabsPerGroup[id].filter(t => !sharedRows.includes(t)).length}`));
for (const g of nav) assert.ok(g.tabs.some(t => t.key), `${g.group} has no tickable tab`);

// 3. Every Admin tab a staff account can reach is controlled: gated by a key, locked, or always on.
const tabMap = evalIn(`(${grab(coreSource, /var _permTabMap=(\{[^}]*\});/, 'tab map')})`);
const alwaysHide = evalIn(grab(coreSource, /var _permAlwaysHide=(\[[^\]]*\]);/, 'locked tabs')).map(t => t.replace(/'/g, ''));
const mapped = Object.fromEntries(Object.entries(tabMap).map(([k, v]) => [k.replace(/'/g, ''), v]));
const alwaysOn = ['inbox', 'changepw'];
for (const tab of Object.values(tabsPerGroup).flat()) {
  const states = [tab in mapped, alwaysHide.includes(tab), alwaysOn.includes(tab)].filter(Boolean).length;
  assert.equal(states, 1, `Admin tab ${tab} must be exactly one of: keyed, locked, always on`);
}
for (const key of Object.values(mapped)) assert.ok(serverKeys.includes(key), `Admin gates a tab on ${key}, which a Super Admin cannot grant`);

// 4. Settings is locked for staff-level roles except Channel Pricing (tickable) and Change Password.
for (const tab of tabsPerGroup.settings) {
  if (tab === 'channelpricing') assert.equal(mapped[tab], 'channelpricing');
  else if (tab === 'changepw') assert.ok(alwaysOn.includes(tab));
  else assert.ok(alwaysHide.includes(tab), `Settings tab ${tab} must stay locked for staff`);
}
for (const locked of ['dedupe', 'possettings', 'payouts']) assert.ok(!serverKeys.includes(locked), `${locked} must not be grantable to staff`);
assert.ok(alwaysHide.includes('payouts'), 'Platform Payouts stays locked for staff');
assert.ok(alwaysHide.includes('operations'), 'Operations Center is management-only on the server and must stay locked');

// 5. Existing accounts keep today's access until a Super Admin saves them (server and Admin agree).
const serverLegacy = evalIn(`(${grab(serverSource, /const PORTAL_PERMISSION_LEGACY = (\{[^;]*\});/, 'server legacy')})`);
const serverPerms = evalIn(`${grab(serverSource, /(function portalAccountPermissions\(value, legacy\) \{[\s\S]*?\n\})/, 'server permission builder')}; portalAccountPermissions`, {PORTAL_PERMISSION_KEYS: serverKeys, PORTAL_PERMISSION_LEGACY: serverLegacy});
const staffPermsFrom = evalIn(`var DEFAULT_STAFF_PERMS=${JSON.stringify(coreDefaults)};${grab(coreSource, /(var LEGACY_STAFF_PERMS=[^;]*;)/, 'Admin legacy')}${grab(coreSource, /(function staffPermsFrom\(stored\)\{[^\n]*\})/, 'Admin permission builder')};staffPermsFrom`);
const cases = [
  [{orders: true, pos: true}, {saleshistory: true, undeposited: false, dashboard: false, liveoperations: false}],
  [{orders: false, petty: true}, {saleshistory: false, undeposited: true, dashboard: false}],
  [{dashboard: true, pos: true}, {dashboard: true}],
  [{cashflow: true}, {undeposited: true, dashboard: false}],
  [{orders: true, saleshistory: false, dashboard: false, undeposited: true}, {saleshistory: false, dashboard: false, undeposited: true}],
];
for (const [stored, expected] of cases) {
  const server = serverPerms(stored, true), admin = staffPermsFrom(stored);
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(server[key], value, `server list shows ${key}=${server[key]} for ${JSON.stringify(stored)}`);
    assert.equal(admin[key], value, `Admin shows ${key}=${admin[key]} for ${JSON.stringify(stored)}`);
  }
}
assert.equal(serverPerms({orders: true}, false).saleshistory, false, 'saving stores only what was ticked');
assert.equal(serverPerms({dedupe: true, channelpricing: true}, false).dedupe, undefined, 'a Settings key cannot be saved');
assert.ok(serverSource.includes('permissions: portalAccountPermissions(permissions[uid], true),'), 'the account list must show inherited access');

// 6. A ticked tab works on its own: the server calls and database rules accept its key.
assert.ok(undepositedSource.includes('requirePortalPermission(db,request,["petty","cashflow","undeposited"])') && undepositedSource.includes('requirePortalPermission(db, request, ["petty", "cashflow", "undeposited"])'), 'Undeposited Collection services must accept the undeposited key');
assert.ok(/requirePortalPermission\(db, request, \["orders", "saleshistory"[^\]]*\]\)/.test(historySource.slice(historySource.indexOf('exports.readHistoricalOrders'), historySource.indexOf('exports.readHistoricalSalesRollup'))), 'Sales History orders service must accept the saleshistory key');
assert.ok(historySource.includes('requirePortalPermission(db, request, ["orders", "saleshistory", "dashboard"])'), 'Sales History summaries must accept the saleshistory key');
const ruleLine = node => rules.split('\n').find(l => new RegExp(`^\\s+"${node}"`).test(l)) || '';
const readOf = node => { const l = rules.split('\n').slice(rules.split('\n').findIndex(x => new RegExp(`^\\s+"${node}"`).test(x))).find(x => x.includes('".read"')); return l.slice(l.indexOf('".read"')).split('", "')[0]; };
const perm = key => `root.child('adminPerms').child(auth.uid).child('${key}').val() === true`;
assert.ok(readOf('cfAccounts').includes(perm('undeposited')), 'Undeposited Collection needs the cash account list');
assert.ok(readOf('activeOrders').includes(perm('liveoperations')) && readOf('posActiveShift').includes(perm('liveoperations')), 'Live Operations needs the live board and open shift');

// 7. Cashiers keep Grab and FoodPanda prices in the POS; editing them needs Channel Pricing.
const channel = ruleLine('channelPrices'), channelRead = channel.slice(channel.indexOf('".read"'), channel.indexOf('".write"')), channelWrite = channel.slice(channel.indexOf('".write"'));
assert.ok(channelRead.includes(perm('pos')), 'POS access must still read channel prices');
assert.ok(channelWrite.includes(perm('channelpricing')) && !channelWrite.includes(perm('pos')), 'only Channel Pricing may edit channel prices');

// 8. Dashboard: admins always; staff only with the Dashboard tick (off by default). Its data access
// follows the staff-screen rule in tests/staff-screen-data-access-check.mjs.
assert.equal(coreDefaults.dashboard, false, 'Dashboard must be off by default for staff');
assert.ok(!('dashboard' in serverLegacy), 'existing staff accounts must not inherit the Dashboard');
assert.ok(coreSource.includes('function dashboardAllowed(){return adminLoggedIn||(staffLoggedIn&&staffDashboardAllowed);}') && coreSource.includes('staffDashboardAllowed=perms.dashboard===true;'), 'Dashboard gate must follow the Dashboard tick');
assert.ok(coreSource.includes("if(!dashboardAllowed()||subscriptionHub.stats().activeScope!=='dashboard'){overviewInsights.stop();return;}") && !coreSource.includes("if(!adminLoggedIn||subscriptionHub.stats().activeScope!=='dashboard')"), 'renderDashboard must use the shared gate');
const rollupGate = historySource.slice(historySource.indexOf('exports.readHistoricalSalesRollup'), historySource.indexOf('exports.manageHistoricalOrderArchive'));
assert.ok(rollupGate.includes('requirePortalPermission(db, request, ["orders", "saleshistory", "dashboard"])'), 'Dashboard summaries must accept the dashboard key');

// 9. Staff and Cashier start on POS, and their first data scope is POS (no Dashboard download at sign-in).
assert.ok(coreSource.includes("var target={cashier:'pos',kitchen:'orders',finance:'finance',staff:'pos'}"), 'Staff must land on POS');
assert.ok(coreSource.includes("subscriptionHub.activate(effectiveRole==='cashier'||effectiveRole==='staff'?'pos':'dashboard');subscriptionHub.authorize();"), 'Staff sign-in must start on the POS data scope');

console.log('PASS: staff module access mirrors the Admin navigation, Settings stays locked except Channel Pricing and Change Password, and every ticked tab works on its own.');
