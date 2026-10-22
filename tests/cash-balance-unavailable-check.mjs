// 23 Oct 2026: every cold Cloud Function start failed for 85 minutes (Google-side).
// getCurrentCashBalances could not answer, and Purchases showed every bank and
// e-wallet at ₱0.00 — a false balance that hid the outage. This check proves a
// balance that did not load is reported as unavailable, never as zero, and that
// recovery is automatic but bounded (no runaway function calls).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const finance = read('assets/js/admin/finance.js');
const pos = read('assets/js/admin/pos.js');

const pick = (src, name) => {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} is missing from the Finance bundle`);
  const end = src.indexOf('\n', start);
  return src.slice(start, end);
};

function sandbox(getCurrentCashBalances) {
  const timers = [], events = [];
  const ctx = {
    console: {error() {}},
    peso: (v) => '₱' + Number(v || 0).toFixed(2),
    setTimeout: (fn, ms) => { timers.push({fn, ms}); return timers.length; },
    CustomEvent: function (type) { this.type = type; },
    window: {dispatchEvent: (e) => events.push(e.type)},
    A: () => ({getCurrentCashBalances}),
    timers, events,
  };
  vm.createContext(ctx);
  vm.runInContext([
    "var cashBalancesMap={},cashBalancesReady=false,cashBalancesError='',cashBalanceRetries=0,cashRegisterGross=0,cashBalanceRefresh=null,registerFloatAmount=4000;",
    pick(finance, 'cashBalanceText'),
    pick(finance, 'currentCashBalance'),
    pick(finance, 'refreshCashBalances'),
  ].join('\n'), ctx);
  return ctx;
}

// 1. Server call fails: no account may show ₱0.00.
{
  const ctx = sandbox(() => Promise.reject(new Error('internal')));
  assert.equal(await vm.runInContext('refreshCashBalances()', ctx), false);
  for (const id of ['undeposited', 'bdo_savings', 'gcash', 'cash_on_hand']) {
    assert.equal(vm.runInContext(`currentCashBalance('${id}')`, ctx), null, `${id} must be null when balances did not load`);
    assert.equal(vm.runInContext(`cashBalanceText(currentCashBalance('${id}'))`, ctx), 'balance unavailable');
  }
  assert.equal(vm.runInContext("currentCashBalance('cash_float')", ctx), 4000, 'the float is a setting and stays visible');
  assert.match(vm.runInContext('cashBalancesError', ctx), /internal/);
  assert.ok(ctx.events.includes('accaza:cash-balances-updated'), 'screens must redraw to show the failure');

  // 2. Bounded retry: three attempts (30 s, 90 s, 5 min), then stop.
  for (let i = 0; i < 5; i += 1) {
    const t = ctx.timers.shift();
    if (!t) break;
    await t.fn();
    await new Promise((r) => setImmediate(r));
  }
  assert.equal(vm.runInContext('cashBalanceRetries', ctx), 3, 'auto-retry must stop after three attempts');
  assert.equal(ctx.timers.length, 0, 'no retry may be left scheduled after the third failure');
}

// 3. Server call succeeds: real balances, retry counter reset.
{
  const ctx = sandbox(() => Promise.resolve({data: {source: 'cashBalanceSummary', balances: {undeposited: 1250.5, bdo_savings: 18400}, registerGross: 6000, registerFloatAmount: 4000}}));
  vm.runInContext('cashBalanceRetries=2', ctx);
  assert.equal(await vm.runInContext('refreshCashBalances()', ctx), true);
  assert.equal(vm.runInContext("currentCashBalance('bdo_savings')", ctx), 18400);
  assert.equal(vm.runInContext("cashBalanceText(currentCashBalance('undeposited'))", ctx), '₱1250.50');
  assert.equal(vm.runInContext("currentCashBalance('cash_on_hand')", ctx), 2000, 'cash on hand still excludes the protected float');
  assert.equal(vm.runInContext("currentCashBalance('new_account')", ctx), 0, 'a loaded account with no movements is a true zero');
  assert.equal(vm.runInContext('cashBalanceRetries', ctx), 0);
}

// 4. Every screen that prints these balances goes through the unavailable-aware formatter.
assert.ok(finance.includes("balanceText:function(v){return cashBalanceText(v);}"), 'Finance must expose the formatter to Purchases');
assert.ok(finance.includes("Undeposited Collection ('+cashBalanceText(currentCashBalance('undeposited'))+')"), 'Finance account picker must not print an unloaded balance as zero');
assert.ok(pos.includes("window.__cf.balanceText(x.balance)"), 'Purchases dropdown must use the unavailable-aware formatter');
assert.ok(pos.includes('Account balances could not be loaded, so they are hidden, not zero.'), 'Purchases must say why balances are missing');
assert.ok(pos.includes('data-pur-retry-bal') && pos.includes('window.__cf.retryBalances()'), 'Purchases must offer a manual retry');
assert.doesNotMatch(finance, /if\(!cashBalancesReady\)return 0;/, 'an unloaded balance must never be reported as 0');

console.log('Cash balance unavailable checks passed.');
