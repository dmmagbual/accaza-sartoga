// Audit reliability batch (5 Nov 2026): queued-sale retries with backoff (REL-01), App Check warning on
// the till (SEC-06), module start failures (A-01), no swallowed errors after control actions (A-17),
// uncosted-sales completeness and value (A-06/D-12), and the four release-capacity watch files.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {BUNDLE_BUDGETS} from './bundle-budgets.mjs';
const require = createRequire(import.meta.url);
const read = (p) => fs.readFileSync(p, 'utf8');

// REL-01
{
  const ctx = {window: {}, Promise, Date, Math, JSON, String, Number, Array, Object};
  vm.createContext(ctx); vm.runInContext(read('assets/js/admin/offline-queue.js'), ctx);
  const q = ctx.window.AccazaOfflineQueue;
  assert.deepEqual([1, 2, 3, 4, 5, 6, 9].map(q.retryDelay), [30000, 60000, 120000, 300000, 600000, 900000, 900000], 'backoff 30 s, 1, 2, 5, 10, then 15 min');
  const src = read('assets/js/admin/offline-queue.js');
  assert.ok(/if\(r\.status==='failed'\)return !dueOnly\|\|Number\(r\.nextAttemptAt\|\|0\)<=startedAt;/.test(src), 'the timed retry only takes failed rows that are due');
  assert.ok(/nextAttemptAt:Date\.now\(\)\+retryDelay\(\(Number\(row\.attempts\)\|\|0\)\+1\)/.test(src), 'a failure records when to try next');
  const pos = read('src/admin/pos/00-shared-state.js');
  assert.ok(/setInterval\(function\(\)\{if\(window\.__online===false\|\|document\.hidden\)return;flushOfflineQueue\(\{due:true\}\);\},30000\)/.test(pos), 'the till retries due sales every 30 s');
  assert.ok(/Retries automatically /.test(pos), 'the queue shows when it will try again');
  // SEC-06
  assert.ok(/function renderAppCheckWarning\(\)/.test(pos) && /renderAppCheckWarning\(\);/.test(pos) && /__accazaAppCheckStatus/.test(pos), 'a failed App Check is shown on the till');
}
// A-01
{
  const src = read('assets/js/admin/module-loader.js');
  assert.ok(/window\.addEventListener\('error',startError\)/.test(src) && /failed while starting/.test(src), 'a module that throws while starting fails the load');
}
// A-17
for (const f of ['src/admin/register/40-revolving-fund.js', 'src/admin/register/99-voids-refunds.js', 'src/admin/analytics/30-daily-close-report.js']) {
  const src = read(f);
  for (const done of ["alert('Voucher rejected.');}).catch(function(){})", "alert('Order voided and financial reversal posted.');}).catch(function(){})", "alert('Refund and financial reversal posted.');}).catch(function(){})", "renderDailyReport();}).catch(function(){})", "on the selected posting date.');}).catch(function(){})"]) assert.ok(!src.includes(done), `${f}: a control action ends in an empty catch`);
}
// A-06 / D-12
{
  const U = require('../functions/lib/uncosted-sales.js');
  const rows = U.registerRows({orderId: 'POS-1', order: {id: 'POS-1', timestamp: 1, lineItems: [{qty: 2, unitTotal: 120}, {qty: 1, unitTotal: 90}]}, lines: [{lineIndex: 0, itemKey: 'mocha', itemName: 'Mocha', qty: 2}], now: 1, businessDate: '2026-11-05'});
  assert.equal(Object.values(rows)[0].saleValue, 240, 'a new uncosted line records its sale value');
  const groups = U.summarize(Object.assign({}, rows, {old: {status: 'open', itemKey: 'mocha', itemName: 'Mocha', qty: 1}}));
  assert.deepEqual([groups[0].saleValue, groups[0].unvaluedCount], [240, 1], 'older lines without a value are counted, not guessed');
  const src = read('src/functions/43i-uncosted-sales.js');
  assert.ok(/limitToFirst\(UNCOSTED_LIST_LIMIT \+ 1\)/.test(src) && /truncated: read\.truncated/.test(src), 'the list says when it was cut off');
  const ui = read('assets/js/admin/uncosted-sales.js');
  assert.ok(/d\.truncated\?/.test(ui) && /of sales with no cost/.test(ui), 'the screen shows the cut-off and the value');
}
// Release capacity: the four watch files are split or compacted, not given bigger limits.
{
  const sizes = {'assets/js/admin/register.js': 0, 'assets/js/admin/admin-orders.mjs': 0, 'assets/js/admin/order-archive-eligibility.mjs': 0, 'assets/js/customer/core.mjs': 0};
  const limits = {'assets/js/admin/register.js': 319400, 'assets/js/admin/admin-orders.mjs': 15100, 'assets/js/admin/order-archive-eligibility.mjs': 3900, 'assets/js/customer/core.mjs': 115600};
  for (const f of Object.keys(sizes)) {
    const bytes = Buffer.byteLength(read(f));
    assert.equal(BUNDLE_BUDGETS[f], limits[f], `${f}: the limit is unchanged`);
    assert.ok(bytes <= limits[f] * 0.975, `${f}: ${bytes} bytes is back under the watch line`);
  }
  assert.ok(!/function renderTaxCompliance/.test(read('assets/js/admin/register.js')) && /function renderTaxCompliance/.test(read('assets/js/admin/register-tax.js')), 'Tax Compliance is its own bundle');
  assert.ok(/taxcompliance:\['pos','register','registertax'\]/.test(read('assets/js/admin/module-loader.js')), 'the Tax Compliance tab loads it');
  assert.ok(/installWebsiteOrderRejection\(/.test(read('assets/js/admin/admin-orders.mjs')) && /export function installWebsiteOrderRejection/.test(read('assets/js/admin/order-rejection-dialog.mjs')), 'the rejection dialog is its own module');
  const core = read('assets/js/customer/core.mjs');
  assert.ok(/import\{installPublicReviews\}from"\.\/public-reviews\.mjs"/.test(core) && !/DEFAULT_PUBLIC_REVIEWS/.test(core), 'public reviews are their own module');
  const sw = read('sw.js');
  for (const f of ['/assets/js/admin/register-tax.js', '/assets/js/admin/order-rejection-dialog.mjs', '/assets/js/customer/public-reviews.mjs']) assert.ok(sw.includes(`'${f}'`), `${f} is cached for offline use`);
}
console.log('PASS: audit reliability (queued-sale retries, App Check warning, module start failures, control-action errors, uncosted completeness, release capacity).');
