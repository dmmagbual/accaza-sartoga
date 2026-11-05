// Audit reporting batch (5 Nov 2026): report data coverage stamps (A-08), the read-only menu price
// history (R-09) and cancelled invoice numbers (C-17) screens, and the build number check (R-01).
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {reportCoverage} from '../assets/js/admin/report-coverage.mjs';
const read = (p) => fs.readFileSync(p, 'utf8');

// A-08: coverage states how far back each feed reaches and whether that covers the report period.
{
  const day = (d) => Date.parse(`${d}T00:00:00+08:00`), now = Date.parse('2026-11-05T15:00:00+08:00');
  const hub = (map) => ({historyStatus: (p) => map[p]});
  const all = {bounded: true, ready: true, hasOlder: false, oldestAt: day('2026-10-01')};
  const partial = {bounded: true, ready: true, hasOlder: true, oldestAt: day('2026-10-20')};
  let c = reportCoverage(hub({orders: all, platformPayouts: partial}), ['orders', 'platformPayouts'], day('2026-10-01'), now);
  assert.equal(c.complete, false, 'payouts that start after the period start leave the period incomplete');
  assert.match(c.text, /^Incomplete for this period \(as at .+ Manila\): platform payouts only from 20 Oct 2026\. Load older records/);
  c = reportCoverage(hub({orders: all, platformPayouts: partial}), ['orders', 'platformPayouts'], day('2026-11-01'), now);
  assert.equal(c.complete, true, 'a window reaching back past the period start covers it');
  assert.match(c.text, /^Complete for this period from 1 Nov 2026/);
  c = reportCoverage(hub({orders: partial}), ['orders'], 0, now);
  assert.equal(c.complete, false); assert.match(c.text, /^Recent records only .*orders from 20 Oct 2026/, 'with no fixed period the stamp states how far back the figures reach');
  c = reportCoverage(hub({orders: {bounded: true, ready: false}}), ['orders'], 0, now);
  assert.match(c.text, /^Still loading orders/);
  c = reportCoverage(hub({orders: {bounded: true, ready: false, error: 'denied'}}), ['orders'], day('2026-11-01'), now);
  assert.equal(c.complete, false); assert.match(c.text, /^Incomplete .*orders could not load/);
  const hubSrc = read('assets/js/admin/realtime-hub.mjs');
  assert.ok(/oldestAt:oldestLoaded\(e,s\)/.test(hubSrc), 'history status reports the earliest loaded record');
  const pager = read('assets/js/admin/history-pager.mjs');
  assert.ok(/window\.AccazaReportCoverage=function\(tab\)/.test(pager) && /data-report-coverage/.test(pager) && /setInterval\(paint,5000\)/.test(pager), 'every history tab shows a live coverage line');
  assert.ok(!/Bounded history:<\/b> reports use the recent loaded pages/.test(pager), 'the vague bounded-history note is replaced by the coverage stamp');
  const analytics = read('assets/js/admin/analytics.js');
  assert.ok(/\(window\.AccazaReportStart=window\.AccazaReportStart\|\|\{\}\)\.pnl=function\(\)\{return Date\.parse\(prevMonthKey\(/.test(analytics), 'the P&L coverage includes the comparison month');
  assert.ok(/\(window\.AccazaReportStart=window\.AccazaReportStart\|\|\{\}\)\.dailyreport=function\(\)/.test(analytics) && /printDailyReport\(d,drCoverage\(\)\)/.test(analytics) && /exportDailyXlsx\(d,drCoverage\(\)\)/.test(analytics), 'daily report outputs carry the stamp');
  assert.ok(/coverage:\(window\.AccazaReportCoverage&&window\.AccazaReportCoverage\('pnl'\)/.test(analytics) && /rows\.push\(\['Data coverage',d\.coverage\]\)/.test(read('assets/js/admin/pnl-export.mjs')), 'the P&L CSV carries the stamp');
  const out = read('assets/js/admin/daily-report-output.mjs');
  assert.ok(/X\.coverage\?'<br>Data coverage: '\+esc\(X\.coverage\)/.test(out) && /re\.push\(\['Data coverage','','',X\.coverage\]\)/.test(out), 'daily print and Excel carry the stamp');
}
// R-09 / C-17: read-only registers through one server callable.
{
  const fn = read('src/functions/24b-audit-registers.js');
  assert.ok(/register === "price_history"\) \{ await requirePortalPermission\(db, request, \["availability"\]\)/.test(fn), 'price history needs menu access');
  assert.ok(/register === "cancelled_invoices"\) \{ await requirePortalPermission\(db, request, \["taxcompliance"\]\)/.test(fn), 'cancelled invoices need Tax Compliance access');
  assert.ok(!/\)\.(set|update|remove|push|transaction)\(/.test(fn.replace(/\/\/.*$/gm, '')), 'the registers callable never writes to the database');
  assert.ok(/limitToLast\(AUDIT_REGISTER_LIMIT \+ 1\)/.test(fn) && /truncated: rows\.length > AUDIT_REGISTER_LIMIT/.test(fn), 'both lists say when they are cut off');
  const rules = read('database.rules.json');
  assert.ok(rules.includes('"menuPriceHistory": { ".read": false, ".write": false }') && rules.includes('"posInvoiceVoided": { ".indexOn": "at", ".read": false, ".write": false }'), 'both registers stay server only');
  const ui = read('assets/js/admin/audit-registers.mjs');
  assert.ok(/callables\.getAuditRegisters\(\{register:kind\}\)/.test(ui) && /Download CSV/.test(ui) && /escHtml\(r\.name\|\|r\.itemId\)/.test(ui), 'the screens read through the callable and escape what they show');
  assert.ok(/import\('\.\/audit-registers\.mjs'\)/.test(read('assets/js/admin/core.mjs')), 'the registers load only when opened');
  assert.ok(/data-audit-register="price_history" data-audit-target="menuPriceHistoryRoot"/.test(read('admin.html')), 'Menu has a Price history panel');
  assert.ok(/data-audit-register="cancelled_invoices" data-audit-target="taxCancelledList"/.test(read('assets/js/admin/register-tax.js')), 'Tax Compliance lists cancelled invoice numbers');
  assert.ok(/callableNames\.unshift\('getAuditRegisters'\)/.test(read('assets/js/admin/firebase-client.mjs')));
  const sw = read('sw.js');
  for (const f of ['/assets/js/admin/audit-registers.mjs', '/assets/js/admin/report-coverage.mjs']) assert.ok(sw.includes(`'${f}'`), `${f} is cached`);
}
// R-01
{
  assert.ok(/node tests\/build-number-check\.mjs/.test(JSON.parse(read('package.json')).scripts['test:release']), 'the release tests check build numbers');
  assert.ok(/git fetch --no-tags --depth=1 origin main:refs\/remotes\/origin\/main/.test(read('.github/workflows/quality-gate.yml')), 'CI fetches main before the check');
}
console.log('PASS: audit reporting (coverage stamps on reports and exports, price history and cancelled invoice registers, build number check).');
