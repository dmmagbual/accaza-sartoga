// Retention of the duplicate-protection registers (owner decision, 5 Nov 2026), plus the customer
// core split. The daily prune deletes website checkout replay keys older than 90 days and used
// e-payment reference claims older than 13 months, through an index for the claims (the fake
// database refuses an unindexed query, as the real one would download the whole node instead).
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createFakeDatabase} from './helpers/fake-rtdb.mjs';
import {BUNDLE_BUDGETS} from './bundle-budgets.mjs';
const read = (p) => fs.readFileSync(p, 'utf8');
const bundle = read('functions/index.js'), rules = read('database.rules.json');
const DAY = 86400000, now = Date.parse('2026-11-05T02:00:00Z');
const manilaDay = (ms) => new Date(Number(ms) + 8 * 3600000).toISOString().slice(0, 10);

{
  const db = createFakeDatabase({
    orderRequests: {
      custA: {oldDone: {state: 'done', orderId: 'ORD-1', total: 150, at: now - 91 * DAY}, recentDone: {state: 'done', orderId: 'ORD-2', total: 90, at: now - 89 * DAY}, pending: {state: 'pending', at: now - 60000}},
      custB: {old: {state: 'done', orderId: 'ORD-3', total: 75, at: now - 200 * DAY}},
    },
    paymentReferenceClaims: {
      gcash_OLD1: {orderId: 'POS-1', at: now - 400 * DAY},
      gcash_KEEP: {orderId: 'POS-2', at: now - 380 * DAY},
      maya_NEW: {orderId: 'POS-3', at: now - DAY},
    },
  }, {rules});
  const start = bundle.indexOf('exports.pruneEphemeralNodes = onSchedule('), end = bundle.indexOf('exports.autoCompleteReadyOnlineOrders', start);
  assert.ok(start >= 0 && end > start, 'prune job not found');
  class FixedDate extends Date { static now() { return now; } }
  const ctx = vm.createContext({exports: {}, onSchedule: (opts, fn) => fn, getDatabase: () => db, healRecentBooksNet: async () => ({}), logger: {info() {}, error() {}, warn() {}},
    financeDateFromTimestamp: manilaDay, RetryGuard: {ATTEMPTS_ROOT: 'functionRetryAttempts'}, ORDER_REGION: 'asia-southeast1', Date: FixedDate, Object, Number, String, Promise, Math, JSON, Array});
  vm.runInContext(bundle.slice(start, end), ctx);
  await ctx.exports.pruneEphemeralNodes();
  const data = db.data();
  assert.deepEqual(Object.keys(data.orderRequests.custA).sort(), ['pending', 'recentDone'], 'replay keys older than 90 days go; recent and in-flight ones stay');
  assert.equal(data.orderRequests.custB, undefined, 'a customer with only old keys is emptied');
  assert.deepEqual(Object.keys(data.paymentReferenceClaims).sort(), ['gcash_KEEP', 'maya_NEW'], 'reference claims are kept 13 months');
  assert.ok(db.reads.some((r) => r.path === 'paymentReferenceClaims' && r.query && r.query.by === 'child'), 'reference claims are pruned through their index');
}
assert.ok(rules.includes('"paymentReferenceClaims": { ".indexOn": "at", ".read": false, ".write": false }'), 'the claims index exists and the node stays server only');
assert.ok(rules.includes('"orderRequests": { ".read": false, ".write": false }'), 'replay keys stay server only');

// Customer core split: the contact and feedback forms are their own module; the limit is unchanged.
{
  const core = read('assets/js/customer/core.mjs'), limit = 115600;
  assert.equal(BUNDLE_BUDGETS['assets/js/customer/core.mjs'], limit, 'customer core limit is unchanged');
  assert.ok(Buffer.byteLength(core) <= limit * 0.95, `customer core is ${Buffer.byteLength(core)} bytes`);
  assert.ok(/import\{installFeedback\}from"\.\/feedback\.mjs"/.test(core) && /installFeedback\(\{push,feedbacksRef\}\)/.test(core) && !/window\.submitContact=/.test(core), 'core installs the forms from their own module');
  const fb = read('assets/js/customer/feedback.mjs');
  for (const name of ['submitContact', 'updateFbCounter', 'submitFeedback']) assert.ok(fb.includes(`window.${name}=`), `${name} is still installed for the page buttons`);
  assert.ok(read('sw.js').includes("'/assets/js/customer/feedback.mjs'"), 'the forms module is cached for offline use');
}
console.log('PASS: audit retention (replay keys 90 days, e-payment reference claims 13 months, indexed) and the customer core forms split.');
