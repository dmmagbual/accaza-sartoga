// A month cannot be closed while it still has payments awaiting verification (Danilo, 2 Nov 2026).
// Verification posts Dr bank / Cr 1060 on the sale date while that month is open, but on the
// verification date once it is closed. A month closed with open 1060 items would therefore show
// those receipts in the next month and its bank balance would not match the statement.
// This check guards:
// 1. the helper picks only rows dated in the month being closed and sums them in whole centavos,
// 2. manageAccountingPeriod refuses to close such a month and writes nothing,
// 3. reopening, and closing a month whose open items belong to other months, still work,
// 4. a row whose sale date or amount cannot be read fails closed and blocks every close.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const AccountingPeriods = require('../functions/lib/accounting-periods.js');
const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const at = (iso) => Date.parse(iso);

// 1. Helper.
const queue = {
  A: {orderId: 'A', saleDate: '2026-10-02', saleAt: at('2026-10-02T03:00:00Z'), amount: 0.1},
  B: {orderId: 'B', saleDate: '2026-10-31', saleAt: at('2026-10-31T15:30:00Z'), amount: 0.2},
  C: {orderId: 'C', saleDate: '2026-11-01', saleAt: at('2026-10-31T16:30:00Z'), amount: 500},
  D: {orderId: 'D', saleAt: at('2026-10-15T04:00:00Z'), amount: '125.50'},
  E: {orderId: 'E', saleAt: at('2026-10-31T16:30:00Z'), amount: 40},
  F: {orderId: 'F', saleDate: '2026/10/05', saleAt: at('2026-10-05T02:00:00Z'), amount: 10},
  nul: null,
};
const oct = AccountingPeriods.openPaymentVerificationsForPeriod(queue, '2026-10');
assert.equal(oct.count, 4, 'October rows only: A, B, D (saleAt fallback) and F (malformed saleDate falls back to saleAt); E is 1 Nov in Manila');
assert.equal(oct.total, 135.8, '0.1 + 0.2 + 125.50 + 10 summed in centavos, no float drift');
assert.deepEqual(oct.unreadable, []);
assert.deepEqual(oct.rows.map((row) => [row.orderId, row.saleDate, row.amount]), [['A', '2026-10-02', 0.1], ['F', '2026-10-05', 10], ['D', '2026-10-15', 125.5], ['B', '2026-10-31', 0.2]], 'sorted by sale date; a missing saleDate is derived in Manila time');
const nov = AccountingPeriods.openPaymentVerificationsForPeriod(queue, '2026-11');
assert.deepEqual(nov.rows.map((row) => row.orderId).sort(), ['C', 'E'], 'a Manila 1 Nov sale belongs to November');
assert.equal(AccountingPeriods.openPaymentVerificationsForPeriod({}, '2026-10').count, 0);
assert.equal(AccountingPeriods.openPaymentVerificationsForPeriod(null, '2026-10').count, 0);
assert.throws(() => AccountingPeriods.openPaymentVerificationsForPeriod({}, '2026-13'), /YYYY-MM/);
const broken = {
  noDate: {orderId: 'noDate', amount: 9},
  badDate: {orderId: 'badDate', saleDate: '2026-1-5', saleAt: 'not a time', amount: 9},
  badAmount: {orderId: 'badAmount', saleDate: '2026-12-01', amount: 'abc'},
  scalar: 'garbage',
};
const unread = AccountingPeriods.openPaymentVerificationsForPeriod(broken, '2026-10');
assert.equal(unread.count, 0);
assert.deepEqual(unread.unreadable.map((row) => row.orderId), ['badAmount', 'badDate', 'noDate', 'scalar'], 'rows without a readable date or amount are reported, never silently skipped');

// 2-3. The callable, run from both the source section and the deployed bundle.
const extract = (source) => {
  const start = source.indexOf('exports.manageAccountingPeriod = onCall(');
  const end = source.indexOf('\n);\n', start) + 4;
  assert.ok(start >= 0 && end > start, 'manageAccountingPeriod is present');
  return source.slice(start, end);
};
class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
const harness = async (code, store, data) => {
  const writes = [];
  const db = {ref: (path) => ({
    get: async () => ({val: () => (store[path] === undefined ? null : store[path]), exists: () => store[path] != null}),
    transaction: async (fn) => { const value = fn(store[path] || null); writes.push(path); store[path] = value; return {committed: true, snapshot: {val: () => value}}; },
    set: async (value) => { writes.push(path); store[path] = value; },
  })};
  const context = {exports: {}, onCall: (options, handler) => handler, HttpsError, AccountingPeriods, ORDER_REGION: 'x', ENFORCE_APP_CHECK: false,
    getDatabase: () => db, requirePortalPermission: async () => ({uid: 'u1', role: 'superadmin'}),
    financeText: (value, max = 160) => String(value == null ? '' : value).trim().slice(0, max),
    operationalAuditRecord: (action) => ({action}), Date, console: {warn: () => {}, log: () => {}, error: () => {}}};
  vm.runInNewContext(code, context);
  try { return {result: await context.exports.manageAccountingPeriod({data}), writes}; } catch (error) { return {error, writes}; }
};
for (const [label, source] of [['source', read('src/functions/20-portal-auth.js')], ['bundle', read('functions/index.js')]]) {
  const code = extract(source);
  assert.ok(code.indexOf('openPaymentVerificationsForPeriod') < code.indexOf('periodRef.transaction('), `${label}: the 1060 check runs before the period is written`);
  const store = {'/paymentVerificationQueue': queue};
  const blocked = await harness(code, store, {action: 'close', period: '2026-10', reason: 'Month end'});
  assert.equal(blocked.error && blocked.error.code, 'failed-precondition', `${label}: closing October with open 1060 items is refused`);
  assert.match(blocked.error.message, /4 payment\(s\) awaiting verification, PHP 135\.80 in 1060/);
  assert.match(blocked.error.message, /Payments awaiting verification/);
  assert.match(blocked.error.message, /A \(2026-10-02, PHP 0\.10\); F \(2026-10-05, PHP 10\.00\); D \(2026-10-15, PHP 125\.50\); B \(2026-10-31, PHP 0\.20\)\./);
  assert.deepEqual(blocked.writes, [], `${label}: a refused close writes nothing`);
  assert.equal(store['/accountingPeriods/2026-10'], undefined);

  const otherMonth = await harness(code, {'/paymentVerificationQueue': {C: queue.C}}, {action: 'close', period: '2026-10', reason: 'Month end'});
  assert.equal(otherMonth.result && otherMonth.result.status, 'closed', `${label}: November items do not block closing October`);

  const unreadableStore = {'/paymentVerificationQueue': {C: queue.C, noDate: broken.noDate}};
  const failClosed = await harness(code, unreadableStore, {action: 'close', period: '2026-10', reason: 'Month end'});
  assert.equal(failClosed.error && failClosed.error.code, 'failed-precondition', `${label}: an unreadable 1060 row blocks the close`);
  assert.match(failClosed.error.message, /1 payment\(s\) awaiting verification have no readable sale date or amount.*noDate/);
  assert.deepEqual(failClosed.writes, []);

  const empty = await harness(code, {}, {action: 'close', period: '2026-10', reason: 'Month end'});
  assert.equal(empty.result && empty.result.status, 'closed', `${label}: an empty queue closes normally`);

  const reopenStore = {'/paymentVerificationQueue': queue, '/accountingPeriods/2026-10': {period: '2026-10', status: 'closed', revision: 1}};
  const reopened = await harness(code, reopenStore, {action: 'reopen', period: '2026-10', reason: 'Late verification'});
  assert.equal(reopened.result && reopened.result.status, 'open', `${label}: reopening is never blocked by 1060 items`);
}

console.log('period-close-payment-verification-check: ok');
