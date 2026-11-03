// Customer checkout behaviour (Nov 2026). Runs the real placeOrder and
// syncPlaceOrderButton source in a VM against a stub DOM, so a validation path
// that strands the "Placing order…" lock is caught by behaviour, not by text.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const state = fs.readFileSync('src/customer/core/03-state-helpers.mjs', 'utf8');
const session = fs.readFileSync('src/customer/core/09-customer-session.mjs', 'utf8');
const slice = (src, from, to) => { const a = src.indexOf(from), b = src.indexOf(to, a); assert(a >= 0 && b > a, `missing section ${from}`); return src.slice(a, b); };
const helpers = slice(state, 'function canOrder()', 'function syncQrOrderButton()');
const checkout = slice(session, 'window.placeOrder=async function()', 'window.resetOrder=function()');

function harness(overrides = {}) {
  const el = (extra = {}) => Object.assign({value: '', textContent: '', style: {}, files: [], disabled: false, setAttribute() {}}, extra);
  const nodes = {
    custName: el({value: 'Maria'}), custPhone: el({value: '09170000000'}), custNotes: el(), custContact: el(),
    deliveryAddr: el(), paymentProof: el({files: [{name: 'r.jpg'}]}), bankChoice: el({style: {display: 'block'}}),
    displayOrderId: el(), orderConfirm: el({style: {display: 'none'}}),
  };
  const button = el({textContent: 'Place Order'});
  const calls = {alerts: [], auth: 0, create: []};
  const ctx = {
    navigator: {onLine: true}, publicOrdersOpen: true, customerLiveConnected: true, customerAuthProblem: null,
    auth: {currentUser: {uid: 'u1'}},
    document: {getElementById: (id) => nodes[id] || null, querySelector: (q) => (q === '.btn-place-order' ? button : null)},
    localStorage: {getItem: () => null, setItem() {}},
    alert: (m) => calls.alerts.push(String(m)), setTimeout: () => 0,
    cart: {k1: {name: 'Latte', qty: 1, unitTotal: 150, itemKey: 'k1'}},
    orderType: 'pickup', paymentType: 'gcash', paymentRow: '', paymentSettings: {gcashAccountId: '1010'}, contactMethod: 'whatsapp',
    paymentProofBusy: false, paymentProofData: 'data:image/jpeg;base64,AA', myOrderIds: [],
    ensureCustomerAuth: async () => { calls.auth++; },
    createOnlineOrderCall: async (payload) => { calls.create.push(payload); return {data: {orderId: 'OD-TEST01'}}; },
    updateCartDisplay() {}, renderOrderSection() {}, renderCustomerOrders() {}, removeProof() {},
  };
  Object.assign(ctx, overrides);
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(helpers + '\n' + checkout, ctx);
  return {ctx, nodes, button, calls};
}

// 1. Bank Transfer with the bank chooser shown but no bank chosen: the customer is told,
//    and the button is NOT left locked on "Placing order…" (the defect this guards).
{
  const h = harness({paymentType: 'bank', paymentRow: ''});
  await h.ctx.placeOrder();
  assert.ok(h.calls.alerts.some((m) => m.includes('choose the bank')), 'the customer must be asked to choose a bank');
  assert.ok(!h.ctx._placingOrder, 'validation must not leave the in-flight lock set');
  assert.notEqual(h.button.textContent, '⏳ Placing order…', 'the button must not be stranded on Placing order');
  assert.equal(h.calls.create.length, 0, 'no order is sent');
  assert.equal(h.calls.auth, 0, 'validation fails before any network work');
  h.ctx.syncPlaceOrderButton();
  assert.equal(h.button.disabled, false, 'the button is usable again');
  assert.equal(h.button.textContent, 'Place Order');
  // The customer picks a bank and retries: the order goes through.
  h.ctx.paymentRow = 'bdo';
  await h.ctx.placeOrder();
  assert.equal(h.calls.create.length, 1, 'a retry after choosing a bank submits once');
  assert.equal(h.calls.create[0].paymentRow, 'bdo');
}
// 2. Happy path: one server call, server-checkable total, lock released, cart cleared.
{
  const h = harness();
  await h.ctx.placeOrder();
  assert.equal(h.calls.create.length, 1);
  assert.equal(h.calls.create[0].expectedTotal, 150, 'the client sends the total the server re-prices against');
  assert.equal(h.calls.create[0].paymentRow, 'gcash');
  assert.ok(!h.ctx._placingOrder);
  assert.equal(h.nodes.displayOrderId.textContent, 'OD-TEST01');
  assert.equal(Object.keys(h.ctx.cart).length, 0);
  assert.deepEqual(h.ctx.myOrderIds, ['OD-TEST01']);
}
// 3. Server failure: lock released and the button restored, so the customer can retry.
{
  const h = harness({createOnlineOrderCall: async () => { throw Object.assign(new Error('Prices changed'), {code: 'failed-precondition'}); }});
  await h.ctx.placeOrder();
  assert.ok(!h.ctx._placingOrder, 'a server error releases the lock');
  assert.equal(h.button.disabled, false);
  assert.equal(h.button.textContent, 'Place Order');
  assert.ok(h.calls.alerts.some((m) => m.startsWith('Could not place order: Prices changed')));
}
// 4. Double tap: two taps while the first is in flight submit exactly one order.
{
  let release;
  const gate = new Promise((r) => { release = r; });
  const h = harness({createOnlineOrderCall: async (p) => { h.calls.create.push(p); await gate; return {data: {orderId: 'OD-TEST02'}}; }});
  const first = h.ctx.placeOrder(), second = h.ctx.placeOrder();
  await second;
  release();
  await first;
  assert.equal(h.calls.create.length, 1, 'a second tap while placing must not submit again');
}
console.log('PASS: customer checkout validates before locking, releases the lock on every exit, and submits each order once.');
