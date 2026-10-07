import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = rel => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const dashboardSource = read('assets/js/admin/operations-dashboard.js');
const coreSource = read('assets/js/admin/core.mjs');
const overviewSource = read('assets/js/admin/overview-command.mjs');
const adminHtml = read('admin.html');
const exceptionSource = read('functions/lib/operational-exceptions.js');
const monitorSource = read('functions/lib/production-health.js');

// Finance Books routing table, exactly as core.mjs declares it.
const booksMatch = coreSource.match(/window\.AccazaFinanceBooksPages=Object\.freeze\((\{[^}]*\})\)/);
assert.ok(booksMatch, 'core.mjs must declare window.AccazaFinanceBooksPages');
const booksPages = vm.runInNewContext(`(${booksMatch[1]})`);
assert.equal(booksPages.cashflow, 'cashflow', 'Admin cashflow must open Finance Books Cash Flow');
assert.ok(coreSource.includes("if(booksPage){openFinanceBooks(booksPage);return true;}"), 'moved screens must open Finance Books and report a successful route');
assert.ok(coreSource.includes("window.open('','accazaFinanceBooks')") && coreSource.includes('books.App.go(page)'), 'Finance Books must reuse one named tab and switch pages in place, never stack tabs with their own listeners');
const booksOpener = coreSource.slice(coreSource.indexOf('function openFinanceBooks(page){'), coreSource.indexOf('window.switchTab=function(tab,btn){'));
assert.ok(booksOpener.length > 0 && !booksOpener.includes('_blank'), 'Finance Books routing must not open a fresh tab per click');
assert.ok(coreSource.includes("if(!document.getElementById('tab-'+tab)){console.warn("), 'switchTab must refuse a screen that does not exist before hiding the current one');
const switchStart = coreSource.indexOf('window.switchTab=function(tab,btn){');
assert.ok(switchStart >= 0 && coreSource.indexOf("var booksPage=window.AccazaFinanceBooksPages[tab]", switchStart) < coreSource.indexOf("document.querySelectorAll('.admin-tab-content').forEach(function(t){t.style.display='none';});", switchStart), 'routing guard must run before Admin hides its screens');

const window = {AccazaFinanceBooksPages: booksPages, __accazaRegisterModule() {}};
window.window = window;
vm.runInNewContext(dashboardSource, {window, Date, Math, Number, String, Object, Array, JSON, console});
const health = window.__accazaOperationsHealth;
assert.ok(health && typeof health.classifyDomains === 'function', 'operations dashboard must expose its card classification for tests');

const adminTabs = new Set([...adminHtml.matchAll(/id="tab-([a-z]+)"/g)].map(m => m[1]));
const reachable = tab => adminTabs.has(tab) || Object.prototype.hasOwnProperty.call(booksPages, tab);

// 1. Every card, server exception, and Home shortcut opens a real Admin screen or Finance Books.
for (const d of health.domains) assert.ok(reachable(d.tab), `card ${d.name} routes to missing screen ${d.tab}`);
const serverTabs = new Set([...exceptionSource.matchAll(/, "([a-z]+)"\)\);/g)].map(m => m[1]));
assert.ok(serverTabs.has('cashflow') && serverTabs.has('ops'), 'exception tab scan found no tabs');
for (const tab of serverTabs) assert.ok(reachable(tab), `server exception routes to missing screen ${tab}`);
const overviewTabs = overviewSource.match(/ALLOWED_TABS=new Set\(\[([^\]]*)\]\)/);
assert.ok(overviewTabs, 'Home shortcut allow-list not found');
for (const tab of overviewTabs[1].match(/[a-z]+/g)) assert.ok(reachable(tab), `Home shortcut routes to missing screen ${tab}`);
assert.equal(health.tabLabel('cashflow'), 'Finance Books');
assert.equal(health.tabLabel('possettings'), 'POS Settings');
for (const stale of ['Open Cash Flow', "'Open '+x.tab"]) assert.ok(!dashboardSource.includes(stale), `dashboard still shows ${stale}`);
assert.ok(!overviewSource.includes('Open Financials'), 'Home still labels Finance Books as Financials');

// 2. Every category the server emits belongs to a card and has specific fix steps.
const categories = new Set([...exceptionSource.matchAll(/item\("([a-z_]+)"/g)].map(m => m[1]));
assert.ok(categories.size >= 14, `expected the full exception catalogue, found ${categories.size}`);
const claimed = new Set(health.domains.flatMap(d => d.cats || []));
for (const category of categories) {
  assert.ok(claimed.has(category), `server category ${category} has no card`);
  const guidance = health.issueGuidance({category, detail: 'SERVER DETAIL'});
  assert.notEqual(guidance.action, 'SERVER DETAIL', `server category ${category} has no written fix steps`);
}

// 3. Every hourly-monitor alert is shown on a specific card (or deliberately covered elsewhere).
const monitorIds = [...monitorSource.matchAll(/alert\(("?)(`?)([a-z_]+)/g)].map(m => m[3]).filter(id => id !== 'id');
assert.ok(monitorIds.includes('client_errors') && monitorIds.includes('backup_stale'), 'monitor alert scan failed');
const fresh = Date.now();
const healthyBackup = {takenAt: fresh - 3600000};
const healthyMonitor = {status: 'healthy', evaluatedAt: fresh - 600000, alerts: []};
const run = input => Object.fromEntries(health.classifyDomains({now: fresh, backup: healthyBackup, monitor: healthyMonitor, ...input}).map(d => [d.name, d]));
for (const id of monitorIds) {
  const cards = Object.values(run({backup: {takenAt: fresh - 3600000}, monitor: {...healthyMonitor, status: 'warning', alerts: [{id: id.startsWith('performance') ? 'performance_pos_boot' : id, severity: 'warning', title: id, detail: ''}]}}));
  const showing = cards.filter(d => d.reasons.length).map(d => d.name);
  if (id === 'operational_critical') assert.deepEqual(showing, [], 'operational_critical repeats the source cards and must not add another');
  else assert.equal(showing.length, 1, `monitor alert ${id} shows on ${showing.length} cards`);
  if (id === 'client_errors' || id.startsWith('performance')) assert.deepEqual(showing, ['Frontend & customer app']);
  if (id.startsWith('backup_')) assert.deepEqual(showing, ['Backup & recovery']);
}

// 4. Card colour rules.
const exc = (category, severity, extra = {}) => ({category, severity, id: `${category}_1`, title: `${category} title`, detail: 'detail', at: fresh - 60000, tab: 'operations', ...extra});
const state = d => d.bad ? 'red' : d.watch ? 'amber' : 'green';
const allGreen = run({});
for (const d of Object.values(allGreen)) {
  assert.equal(state(d), 'green', `${d.name} is not green on a healthy system`);
  assert.equal(d.reasons.length, 0);
}
assert.equal(Object.keys(allGreen).length, 10, 'Business Operating Status must show ten cards');
assert.equal(state(run({exceptions: [exc('background_failure', 'critical')]})['Automation & monitoring']), 'red');
assert.equal(state(run({exceptions: [exc('pos_sale_rejected', 'critical', {tab: 'ops'})]})['POS & order service']), 'red');
assert.equal(state(run({exceptions: [exc('shift_handover_pending', 'critical', {tab: 'ops'})]})['POS & order service']), 'amber', 'a provisional Z report must not pause the POS');
assert.equal(state(run({exceptions: [exc('payment_routing', 'critical', {tab: 'possettings'})]})['Cash & payment systems']), 'red');
assert.equal(state(run({exceptions: [exc('payment_routing', 'warning', {tab: 'possettings'})]})['Cash & payment systems']), 'amber');
assert.equal(state(run({exceptions: [exc('uncosted_sale', 'warning', {tab: 'recipes'})]})['Recipes & costing']), 'amber');
assert.equal(state(run({exceptions: [exc('clearing_residual', 'warning', {tab: 'cashflow'})]})['Finance Books']), 'amber');
const gap = run({exceptions: [exc('financial_gap', 'critical', {tab: 'cashflow'})]});
assert.equal(state(gap['Finance Books']), 'red');
assert.equal(state(gap['Cash & payment systems']), 'red');
assert.equal(state(gap['Automation & monitoring']), 'green', 'a claimed category must not also land in the catch-all card');
assert.equal(state(run({exceptions: [exc('ai_provider', 'critical')]})['Automation & monitoring']), 'amber', 'AI only advises, so it never pauses an area');
const unknown = run({exceptions: [exc('brand_new_category', 'critical')]});
assert.equal(state(unknown['Automation & monitoring']), 'red', 'an unclaimed critical exception must still reach a card');
assert.equal(unknown['Automation & monitoring'].reasons[0].title, 'brand_new_category title');
const unknownAlert = run({monitor: {...healthyMonitor, alerts: [{id: 'future_signal', severity: 'warning', title: 'Future signal'}]}});
assert.equal(state(unknownAlert['Automation & monitoring']), 'amber', 'an unclaimed monitor alert must still reach a card');
assert.equal(state(run({checks: [{id: 'payment_configuration', status: 'blocked', label: 'Payment settings'}]})['Cash & payment systems']), 'red');
assert.equal(state(run({checks: [{id: 'incident_register', status: 'blocked', label: 'Incidents'}]})['Automation & monitoring']), 'amber');
assert.equal(state(run({checks: [{id: 'incident_register', status: 'passed', label: 'Incidents'}]})['Automation & monitoring']), 'green');

// 5. Hourly monitor and backup freshness.
const stale = run({monitor: {...healthyMonitor, evaluatedAt: fresh - 4 * 3600000}})['Automation & monitoring'];
assert.equal(state(stale), 'amber');
assert.match(stale.reasons[0].title, /last reported 4h ago/);
assert.match(run({monitor: null})['Automation & monitoring'].reasons[0].title, /has not reported yet/);
const oldBackup = run({backup: {takenAt: fresh - 50 * 3600000}, monitor: {...healthyMonitor, alerts: [{id: 'backup_stale', severity: 'critical', title: 'Database backup is stale'}]}})['Backup & recovery'];
assert.equal(state(oldBackup), 'amber', 'an old backup needs follow-up but does not pause trading');
assert.equal(oldBackup.reasons.length, 1, 'stale backup must be listed once, not once per source');
assert.equal(oldBackup.reasons[0].backupNow, true, 'stale backup fix must offer Create verified backup now');

// 6. How to fix: fix steps, owner, and action buttons for every non-green card; critical first.
const mixed = run({exceptions: [exc('shift_close_follow_up', 'warning', {tab: 'ops'}), exc('pos_sale_rejected', 'critical', {tab: 'ops'})]})['POS & order service'];
assert.deepEqual(Array.from(mixed.reasons, r => r.severity), ['critical', 'warning']);
for (const r of mixed.reasons) assert.ok(r.owner && r.action && r.exception, 'each reason needs an owner, steps, and its source record');
assert.match(mixed.reasons[0].action, /Sales needing recovery/);
assert.ok(dashboardSource.includes('How to fix ('), 'cards must render a How to fix list');
assert.ok(dashboardSource.includes("querySelectorAll('#opsBackupNow,[data-ops-backup-now]')"), 'card backup button must use the audited backup flow');
assert.match(health.issueGuidance({category: 'financial_gap'}).action, /Finance Books → Cash Flow, select Run control audit/);

console.log('PASS: Business Operating Status covers every server problem type and monitor alert, How to fix lists match card colour, and Admin never routes to a missing screen.');
