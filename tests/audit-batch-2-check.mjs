// Audit batch 2 (4 Nov 2026):
//  A-14/D-06 Admin has no checkout of its own, and /orders is server-only in the rules.
//  C-02      a retried online order after a lost response returns the first order.
//  D-07 is by design (only the four approved cashiers are reported; see analytics-mtd-ytd-check).
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);

// ---------- A-14 / D-06 ----------
{
  const core = fs.readFileSync('assets/js/admin/core.mjs', 'utf8');
  assert.ok(!/set\(ref\(db,\s*'orders\//.test(core), 'Admin must not write orders directly');
  assert.ok(/window\.placeOrder=async function\(\)\{alert\(/.test(core), 'the legacy Admin checkout is a stub');
  const rules = JSON.parse(fs.readFileSync('database.rules.json', 'utf8').replace(/^\s*\/\/.*$/gm, '')).rules;
  assert.equal(rules.orders.$oid['.write'], false, 'orders are server-only');
  assert.deepEqual([rules.orderRequests['.read'], rules.orderRequests['.write']], [false, false], 'order request keys are server-only');
}

// ---------- C-02 ----------
{
  const src = fs.readFileSync('src/functions/30-orders.js', 'utf8');
  const body = src.slice(src.indexOf('exports.createOnlineOrder'), src.indexOf('exports.getPaymentProof'));
  assert.ok(body.indexOf('orderRequests/${uid}/${requestId}') < body.indexOf('enforceOrderRateLimit(db, uid)'), 'a replay is answered before rate limits or shop hours');
  assert.ok(/\[`orderRequests\/\$\{uid\}\/\$\{requestId\}`\]: \{state: "done", orderId, total: finalTotal, at: now\}/.test(body), 'the key is recorded in the same write as the order');
  assert.ok(/if \(requestRef\) \{ try \{ await requestRef\.remove\(\); \}/.test(body), 'a failed save releases the key');
  assert.ok(/now - Number\(current\.at \|\| 0\) < 120000/.test(body), 'a stale pending key expires');
  assert.ok(/if \(held && held\.id\) return \{orderId: held\.id, total: finalTotal, duplicate: true\}/.test(body), 'inside the lock window the saved order is returned, not an error');
  const client = fs.readFileSync('src/customer/core/09-customer-session.mjs', 'utf8');
  assert.ok(/orderPayload\.requestId=_reqId;/.test(client) && /sessionStorage\.removeItem\('accaza_order_request'\)/.test(client), 'the browser keeps one key per checkout and clears it on success');
  // The key generator reuses the key for the same cart and makes a new one for a different cart.
  const gen = client.slice(client.indexOf('var _reqId=(function(){'), client.indexOf('})();', client.indexOf('var _reqId=(function(){')) + 5);
  const store = {}; const ctx = {sessionStorage: {getItem: (k) => store[k] || null, setItem: (k, v) => {store[k] = v;}}, Date, Math, JSON, _sig: 'A'};
  vm.createContext(ctx); vm.runInContext(gen + ';globalThis.first=_reqId;', ctx); vm.runInContext(gen + ';globalThis.again=_reqId;', ctx);
  ctx._sig = 'B'; vm.runInContext(gen + ';globalThis.other=_reqId;', ctx);
  assert.ok(/^rq_/.test(ctx.first)); assert.equal(ctx.again, ctx.first, 'a retry of the same cart reuses its key'); assert.notEqual(ctx.other, ctx.first, 'a different cart gets a new key');
}
console.log('PASS: audit batch 2 (server-only orders, Admin checkout removed, online order replay).');
