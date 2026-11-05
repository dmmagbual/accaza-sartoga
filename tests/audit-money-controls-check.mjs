// Audit money controls (4 Nov 2026):
//  D-10 a till's wrong clock cannot move a sale outside [shift opened, server now + 5 min].
//  D-09 a reused GCash/Maya/bank reference is saved and flagged (flag only).
//  D-15/C-17 one delivery stamps at a time; a number whose order was not saved is recorded as cancelled.
//  D-05 refunds/voids dated in a closed month post in the open month.
//  D-13 the till asks before charging the same sale twice within 20 s.
//  A-07 cash to settle uses one rule everywhere (never below zero).
//  R-09 menu price changes are recorded.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const O = require('../functions/lib/offline-sync.js');
const OE = require('../functions/lib/operational-exceptions.js');

function fakeDb(state, opts = {}) {
  const parts = (p) => String(p || '').split('/').filter(Boolean);
  const read = (path) => {let cur = state; for (const k of parts(path)) {if (cur == null) return undefined; cur = cur[k];} return cur;};
  const write = (path, value) => {const keys = parts(path); let cur = state; for (let i = 0; i < keys.length - 1; i++) cur = cur[keys[i]] || (cur[keys[i]] = {}); if (value === null) delete cur[keys.at(-1)]; else cur[keys.at(-1)] = structuredClone(value);};
  return {state, ref(path = '') {return {
    async get() {const v = read(path); return {val: () => structuredClone(v), exists: () => v != null};},
    async update(u) {if (opts.failUpdate && opts.failUpdate(u)) throw new Error('injected write failure'); for (const [k, v] of Object.entries(u)) write(parts(path).concat(parts(k)).join('/'), v);},
    async set(v) {write(path, v);},
    async transaction(fn) {const cur = structuredClone(read(path)), next = fn(cur); if (next === undefined) return {committed: false, snapshot: {val: () => cur, exists: () => cur != null}}; write(path, next); return {committed: true, snapshot: {val: () => structuredClone(next), exists: () => next != null}};},
  };}};
}
const openAt = Date.now() - 3600000;
const state0 = () => ({shifts: {'SH-A': {id: 'SH-A', openAt, drawer: {b100: 5}}}, posActiveShift: {id: 'SH-A', openAt, drawer: {b100: 5}}, posSettings: {payMethods: [{name: 'Bank Transfer', verificationPolicy: 'manager_only'}]}});
const ctxOf = (db, data) => ({db, actor: {uid: 'cashier-1'}, data, textField: (v) => String(v), money: (v) => Math.round((Number(v) || 0) * 100) / 100, listFromFirebase: (v) => v, activeOrderProjection: (v) => Object.assign({}, v)});
const sale = (id, txn, over) => Object.assign({id, shiftId: 'SH-A', clientTxnId: txn, source: 'pos', status: 'Completed', channel: 'instore', payment: 'Cash', payments: [{method: 'Cash', amount: 100, tendered: 100, change: 0}], total: 100, subtotal: 100, discount: 0, lineItems: [{itemKey: 'latte', qty: 1, unitTotal: 100}], timestamp: Date.now() - 60000}, over || {});

// ---------- D-10 ----------
{
  const db = fakeDb(state0());
  const future = Date.now() + 3 * 86400000;
  await O.syncOfflinePosSaleCommand(ctxOf(db, {transactionId: 'pos_txn_d10_000001', order: sale('POS-D10-1', 'pos_txn_d10_000001', {timestamp: future}), drawerDelta: {}}));
  const o = db.state.orders['POS-D10-1'];
  assert.ok(o.timestamp <= Date.now() && o.timestampAdjusted === true && o.clientTimestamp === future, 'a future till clock is pulled back to server time, keeping the till time');
  { const cmd = sale('POS-D10-4', 'pos_txn_d10_000004', {timestamp: future}); await O.syncOfflinePosSaleCommand(ctxOf(db, {transactionId: 'pos_txn_d10_000004', order: cmd, drawerDelta: {}})); assert.equal(cmd.timestamp, future, 'the incoming command is not changed (handover digests compare it)'); }
  await O.syncOfflinePosSaleCommand(ctxOf(db, {transactionId: 'pos_txn_d10_000002', order: sale('POS-D10-2', 'pos_txn_d10_000002', {timestamp: openAt - 86400000}), drawerDelta: {}}));
  assert.equal(db.state.orders['POS-D10-2'].timestamp, openAt, 'a sale cannot be dated before its shift opened');
  await O.syncOfflinePosSaleCommand(ctxOf(db, {transactionId: 'pos_txn_d10_000003', order: sale('POS-D10-3', 'pos_txn_d10_000003'), drawerDelta: {}}));
  assert.equal(db.state.orders['POS-D10-3'].timestampAdjusted, undefined, 'a correct clock is left alone');
}

// ---------- D-09 ----------
{
  const db = fakeDb(state0());
  const bank = (id, txn) => sale(id, txn, {payment: 'Bank Transfer', payments: [{method: 'Bank Transfer', amount: 100, ref: 'bdo-7788 '}]});
  await O.syncOfflinePosSaleCommand(ctxOf(db, {transactionId: 'pos_txn_d09_000001', order: bank('POS-D09-1', 'pos_txn_d09_000001'), drawerDelta: {}}));
  assert.equal(db.state.orders['POS-D09-1'].paymentReferenceCheck, undefined, 'the first use of a reference is not flagged');
  await O.syncOfflinePosSaleCommand(ctxOf(db, {transactionId: 'pos_txn_d09_000001', order: bank('POS-D09-1', 'pos_txn_d09_000001'), drawerDelta: {}}));
  await O.syncOfflinePosSaleCommand(ctxOf(db, {transactionId: 'pos_txn_d09_000002', order: bank('POS-D09-2', 'pos_txn_d09_000002'), drawerDelta: {}}));
  const flagged = db.state.orders['POS-D09-2'];
  assert.ok(flagged && flagged.total === 100, 'the second sale is still saved (flag only)');
  assert.equal(flagged.paymentReferenceCheck.duplicates[0].firstOrderId, 'POS-D09-1', 'it names the first sale');
  assert.equal(db.state.posPaymentReferenceChecks['POS-D09-2'].duplicates[0].ref, 'bdo-7788 ');
  const list = OE.buildOperationalExceptions({activeOrders: {}, orders: {}, offlinePosSync: {}, cashCustody: {}, financialMovements: {}, telemetry: {}, payMethods: [], cfAccounts: {}, posPaymentReferenceChecks: db.state.posPaymentReferenceChecks}, Date.now()).exceptions;
  assert.ok(list.some((x) => x.category === 'payment_reference_reused'), 'Operations lists the reuse');
}

// ---------- D-15 / C-17 ----------
{
  let failOnce = true;
  const db = fakeDb(state0(), {failUpdate: (u) => failOnce && Object.keys(u).some((k) => k.startsWith('orders/')) && !(failOnce = false)});
  await assert.rejects(O.syncOfflinePosSaleCommand(ctxOf(db, {transactionId: 'pos_txn_d15_000001', order: sale('POS-D15-1', 'pos_txn_d15_000001'), drawerDelta: {}})), /injected write failure/);
  const voided = Object.values(db.state.posInvoiceVoided || {});
  assert.equal(voided.length, 1, 'the burned number is recorded as cancelled');
  assert.deepEqual([voided[0].invoiceNumber, voided[0].amountCents, voided[0].reason], ['SI-000001', 10000, 'pos_sale_not_saved']);
  assert.equal(db.state.offlinePosSync.pos_txn_d15_000001.state, 'pending', 'the claim is released for the retry');
  await O.syncOfflinePosSaleCommand(ctxOf(db, {transactionId: 'pos_txn_d15_000001', order: sale('POS-D15-1', 'pos_txn_d15_000001'), drawerDelta: {}}));
  assert.equal(db.state.orders['POS-D15-1'].invoiceNumber, 'SI-000002', 'the retry takes the next number');
  // A second delivery while the first is mid-save takes no number.
  const db2 = fakeDb(Object.assign(state0(), {offlinePosSync: {pos_txn_d15_000002: {orderId: 'POS-D15-2', state: 'stamping', stampingAt: Date.now()}}}));
  await assert.rejects(O.syncOfflinePosSaleCommand(ctxOf(db2, {transactionId: 'pos_txn_d15_000002', order: sale('POS-D15-2', 'pos_txn_d15_000002'), drawerDelta: {}})), /already being saved/);
  assert.equal(db2.state.posInvoiceControl, undefined, 'no invoice number was taken');
  const db3 = fakeDb(Object.assign(state0(), {offlinePosSync: {pos_txn_d15_000003: {orderId: 'POS-D15-3', state: 'order-written'}}}));
  await assert.rejects(O.syncOfflinePosSaleCommand(ctxOf(db3, {transactionId: 'pos_txn_d15_000003', order: sale('POS-D15-3', 'pos_txn_d15_000003'), drawerDelta: {}})), /already saved/);
  assert.equal(db3.state.posInvoiceControl, undefined, 'a late duplicate delivery takes no second number');
  let commitThenFail = true;
  const db4 = fakeDb(state0()); const realRef = db4.ref.bind(db4);
  db4.ref = (p) => {const r = realRef(p); if (p === '' || p === undefined) {const up = r.update.bind(r); r.update = async (u) => {await up(u); if (commitThenFail && Object.keys(u).some((k) => k.startsWith('orders/'))) {commitThenFail = false; throw new Error('reported failure after commit');}};} return r;};
  await O.syncOfflinePosSaleCommand(ctxOf(db4, {transactionId: 'pos_txn_d15_000004', order: sale('POS-D15-4', 'pos_txn_d15_000004'), drawerDelta: {}}));
  assert.equal(db4.state.posInvoiceVoided, undefined, 'a write that committed is not listed as cancelled');
  assert.equal(db4.state.orders['POS-D15-4'].invoiceNumber, 'SI-000001');
  const cards = OE.buildOperationalExceptions({activeOrders: {}, orders: {}, offlinePosSync: {}, cashCustody: {}, financialMovements: {}, telemetry: {}, payMethods: [], cfAccounts: {}, posInvoiceVoided: db.state.posInvoiceVoided}, Date.now()).exceptions;
  assert.ok(cards.some((x) => x.category === 'invoice_cancelled'), 'Operations lists the cancelled number');
  const online = fs.readFileSync('src/functions/30-orders.js', 'utf8');
  assert.ok(/if \(invoiceStamp\) \{ try \{ await ShiftHandover\.recordVoidedInvoice\(db, invoiceStamp, orderId, "online_order_not_saved"/.test(online), 'a failed online order records its number as cancelled');
}

// ---------- D-05, A-07, D-13 (source) ----------
{
  const fin = fs.readFileSync('src/functions/40-sales-finance.js', 'utf8');
  assert.ok(/movement\.occurredAt = await openPostingTime\(db, order\.refundedAt\)/.test(fin), 'a late refund posts in the open month');
  assert.ok(/movement\.occurredAt = await openPostingTime\(db, \(order\.voidAccountingDate/.test(fin), 'a late void posts in the open month');
  assert.ok(/now=await openPostingTime\(db,order\.refundedAt\|\|order\.timestamp\)/.test(fin), 'a late pre-completion refund posts in the open month');
  assert.ok(/async function openPostingTime\(db, at\)/.test(fs.readFileSync('src/functions/43n-payment-verification.js', 'utf8')));
  assert.ok(/z\.cashToSettle=Math\.max\(0,/.test(fs.readFileSync('src/admin/register/20-z-report-payment-methods.js', 'utf8')), 'cash to settle never shows below zero');
  const pos = fs.readFileSync('src/admin/pos/50f-sale-persistence.js', 'utf8');
  assert.ok(/accaza_last_charge/.test(pos) && /Date\.now\(\)-Number\(__lastCharge\.t\|\|0\)<20000&&!confirm\(/.test(pos), 'a repeat charge within 20 s asks first');
  assert.ok(pos.indexOf("localStorage.setItem('accaza_last_charge'") > pos.indexOf('return savePromise.then(function(saved){'), 'the cart is remembered only after the sale is saved or queued');
}

// ---------- R-09 ----------
{
  const src = fs.readFileSync('src/functions/24-public-catalog-version.js', 'utf8');
  const writes = [], txs = [];
  const ctx = {Object, String, Number, Date, getDatabase: () => ({ref: (p) => ({update: async (w) => {writes.push(w);}, transaction: async (fn) => {txs.push(p); return {committed: true};}})})};
  vm.createContext(ctx); vm.runInContext(src.slice(src.indexOf('function menuPriceChanges'), src.indexOf('exports.')), ctx);
  const ev = (before, after, id) => ({id, authId: 'u-manager', authType: 'app_user', data: {before: {val: () => before}, after: {val: () => after}}});
  await ctx.bumpPublicCatalogVersion('menuItems')(ev({latte: {name: 'Latte', priceS: 120, priceM: 140}}, {latte: {name: 'Latte', priceS: 130, priceM: 140}}, 'evt-1'));
  const row = writes[0]['menuPriceHistory/latte/evt-1'];
  assert.deepEqual([row.fields.priceS.from, row.fields.priceS.to, row.byUid, row.fields.priceM], [120, 130, 'u-manager', undefined], 'the change, its old and new value and who saved it are kept');
  await ctx.bumpPublicCatalogVersion('menuItems')(ev({latte: {name: 'Latte', priceS: 130}}, {latte: {name: 'Latte Hot', priceS: 130}}, 'evt-2'));
  assert.equal(writes.length, 1, 'a rename without a price change records nothing');
  assert.equal(txs.length, 2, 'the catalog version still bumps');
  await ctx.bumpPublicCatalogVersion('menuItems')(ev({latte: {name: 'Latte', priceNote: 'promo'}}, {latte: {name: 'Latte', priceNote: 'promo'}}, 'evt-3'));
  assert.equal(writes.length, 1, 'a non-numeric price field that did not change records nothing');
}
console.log('PASS: audit money controls (clock clamp, reference reuse, cancelled invoices, late refunds, double charge, cash to settle, price history).');
