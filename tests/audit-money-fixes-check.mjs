// 3 Nov 2026 audit money fixes (Danilo's decisions):
//  D-02/D-03 till count: a sale always updates the note/coin count, even below zero, and a negative
//            count becomes an Operations recount task; a prepaid cash refund writes its order first.
//  D-01      flag only: a POS sale whose lines, discount and tax do not give its charged total is
//            accepted, posted at the charged total and flagged for review.
//  D-04      COGS posts on the same date as its sale movement.
//  C-01      a "refund due" rejection books the money received and owes it back through 2030;
//            recording the refund paid clears 2030; reopening reverses an unpaid refund due.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const O = require('../functions/lib/offline-sync.js');
const OE = require('../functions/lib/operational-exceptions.js');
const BB = require('../functions/lib/books-bridge.js');
const F = require('../functions/lib/financial.js');

// ---------- fake RTDB (same shape as offline-sync-recovery-check) ----------
function fakeDb(state) {
  const parts = (p) => String(p || '').split('/').filter(Boolean);
  const read = (path) => {let cur = state; for (const key of parts(path)) {if (cur == null) return undefined; cur = cur[key];} return cur;};
  const write = (path, value) => {const keys = parts(path); let cur = state; for (let i = 0; i < keys.length - 1; i++) cur = cur[keys[i]] || (cur[keys[i]] = {}); if (value === null) delete cur[keys.at(-1)]; else cur[keys.at(-1)] = structuredClone(value);};
  return {state, ref(path = '') {return {
    async get() {const value = read(path); return {val: () => structuredClone(value), exists: () => value != null};},
    async update(updates) {for (const [key, value] of Object.entries(updates)) write(parts(path).concat(parts(key)).join('/'), value);},
    async set(value) {write(path, value);},
    async transaction(fn) {const current = structuredClone(read(path)), next = fn(current); if (next === undefined) return {committed: false, snapshot: {val: () => current, exists: () => current != null}}; write(path, next); return {committed: true, snapshot: {val: () => structuredClone(next), exists: () => next != null}};},
    child(name) {return this;},
  };}};
}
const baseCtx = (db, data) => ({db, actor: {uid: 'cashier-1'}, data, textField: (v) => String(v), money: (v) => Math.round((Number(v) || 0) * 100) / 100, listFromFirebase: (v) => v, activeOrderProjection: (v) => Object.assign({}, v, {projectionVersion: 1})});
const shiftState = (drawer) => ({shifts: {'SH-A': {id: 'SH-A', drawer: Object.assign({}, drawer)}}, posActiveShift: {id: 'SH-A', drawer: Object.assign({}, drawer)}, posSettings: {payMethods: []}});
const cashSale = (id, txn, over) => Object.assign({id, shiftId: 'SH-A', clientTxnId: txn, source: 'pos', status: 'Completed', channel: 'instore', payment: 'Cash', payments: [{method: 'Cash', amount: 100, tendered: 100, change: 0}], total: 100, subtotal: 100, discount: 0, lineItems: [{itemKey: 'latte', name: 'Latte', qty: 1, unitTotal: 100}], timestamp: 1000}, over || {});

// ---------- D-02: the count goes below zero instead of refusing a sale that already happened ----------
assert.equal(O.applyDrawerDelta({status: 'closed', drawer: {}}, 't', {b100: 1}, 1, {uid: 'u'}), undefined, 'a closed shift still refuses the drawer change');
assert.deepEqual(O.applyDrawerDelta({drawer: {b100: 0}}, 't', {b500: 1, b100: -4}, 1, {uid: 'u'}).drawer, {b100: -4, b500: 1}, 'change given from a stale count is kept');
{
  const db = fakeDb(shiftState({b100: 0})), txn = 'pos_txn_d02_000001';
  const order = cashSale('POS-D02-1', txn, {payments: [{method: 'Cash', amount: 100, tendered: 500, change: 400}]});
  const result = await O.syncOfflinePosSaleCommand(baseCtx(db, {transactionId: txn, order, drawerDelta: {b500: 1, b100: -4}}));
  assert.equal(result.orderId, 'POS-D02-1');
  assert.equal(db.state.offlinePosSync[txn].state, 'synced', 'the sale syncs instead of sitting failed with a wrong cause');
  assert.deepEqual([db.state.shifts['SH-A'].drawer.b100, db.state.posActiveShift.drawer.b100], [-4, -4], 'both shift records carry the out-of-date count');
  const again = await O.syncOfflinePosSaleCommand(baseCtx(db, {transactionId: txn, order, drawerDelta: {b500: 1, b100: -4}}));
  assert.equal(again.duplicate, true); assert.equal(db.state.shifts['SH-A'].drawer.b100, -4, 'a replay does not move the count twice');
  const shortfalls = OE.drawerCountShortfalls(db.state.posActiveShift.drawer);
  assert.deepEqual(shortfalls.map((r) => [r.key, r.count]), [['b100', -4]]);
  assert.match(shortfalls[0].label, /₱100 note/);
}
// The Operations queue lists a negative count and clears once recounted.
{
  const base = {activeOrders: {}, orders: {}, offlinePosSync: {}, cashCustody: {}, financialMovements: {}, telemetry: {}, payMethods: [], cfAccounts: {}};
  const list = (out) => out.exceptions || out.items || [];
  const withNeg = list(OE.buildOperationalExceptions(Object.assign({}, base, {activeShiftDrawer: {b100: -4, b500: 3}}), 5000));
  assert.ok(withNeg.some((x) => x.category === 'drawer_count_negative' && /-4 × ₱100 note/.test(x.title)), 'a negative count is a recount task');
  const recounted = list(OE.buildOperationalExceptions(Object.assign({}, base, {activeShiftDrawer: {b100: 2}}), 5000));
  assert.ok(!recounted.some((x) => x.category === 'drawer_count_negative'), 'a recounted drawer clears the task');
  const now = 10 * 86400000;
  const checks = list(OE.buildOperationalExceptions(Object.assign({}, base, {posTotalChecks: {A: {orderId: 'POS-A', total: 60, expectedTotal: 100, difference: -40, at: now - 3600000}, B: {orderId: 'POS-B', total: 1, expectedTotal: 2, difference: -1, at: now - 8 * 86400000}}}), now));
  const flagged = checks.filter((x) => x.category === 'pos_total_check');
  assert.deepEqual(flagged.map((x) => x.id), ['pos_total_A'], 'a total check shows for seven days');
}

// ---------- D-03: a prepaid cash refund writes its order before the drawer moves ----------
{
  const src = fs.readFileSync('functions/lib/offline-sync.js', 'utf8');
  const prepaidBlock = src.slice(src.indexOf('let shiftResult;if(prepaid&&!existing)'), src.indexOf('if (!existing){const stamp'));
  assert.ok(prepaidBlock.length > 50 && !/applyDrawerDelta/.test(prepaidBlock), 'the refund drawer change must not run before the order write');
}

// ---------- D-01: POS total check, flag only ----------
const check = (raw) => O.posTotalCheck(raw, raw.total, raw.lineItems);
const line = (qty, unitTotal) => ({qty, unitTotal});
assert.equal(check({total: 100, subtotal: 100, lineItems: [line(2, 50)]}).ok, true, 'lines equal total');
assert.equal(check({total: 60, subtotal: 100, discount: 40, lineItems: [line(1, 100)]}).ok, true, 'discount');
assert.equal(check({total: 90, subtotal: 100, discount: 0, loyaltyDiscount: 10, lineItems: [line(1, 100)]}).ok, true, 'loyalty discount');
assert.equal(check({total: 100, subtotal: 99.6, lineItems: [line(1, 99.6)]}).ok, true, 'whole-peso cash rounding');
assert.equal(check({total: 112, subtotal: 100, tax: {inclusive: false, rate: 12}, lineItems: [line(1, 100)]}).ok, true, 'VAT-exclusive add-on');
assert.equal(check({total: 106, subtotal: 100, vatExemptSales: 50, tax: {inclusive: false, rate: 12}, lineItems: [line(1, 100)]}).ok, true, 'VAT-exempt senior portion');
assert.equal(check({total: 130, subtotal: 130, packages: [{extraCost: 30}], lineItems: [line(1, 100)]}).ok, true, 'QR package extra');
const bad = check({total: 60, subtotal: 100, lineItems: [line(1, 100)]});
assert.deepEqual([bad.ok, bad.expectedTotal, bad.difference], [false, 100, -40], 'an understated total is flagged');
assert.equal(check({total: 100, subtotal: 100, lineItems: [line(1, 70)]}).ok, false, 'lines that do not reach the subtotal are flagged');
{
  const db = fakeDb(shiftState({b100: 5})), txn = 'pos_txn_d01_000001';
  const order = cashSale('POS-D01-1', txn, {total: 60, payments: [{method: 'Cash', amount: 60, tendered: 60, change: 0}]});
  await O.syncOfflinePosSaleCommand(baseCtx(db, {transactionId: txn, order, drawerDelta: {}}));
  assert.equal(db.state.orders['POS-D01-1'].total, 60, 'the sale keeps its charged total');
  assert.equal(db.state.orders['POS-D01-1'].totalCheck.difference, -40, 'the order carries the finding');
  assert.equal(db.state.posTotalChecks['POS-D01-1'].expectedTotal, 100, 'the review row exists');
  const okTxn = 'pos_txn_d01_000002';
  await O.syncOfflinePosSaleCommand(baseCtx(db, {transactionId: okTxn, order: cashSale('POS-D01-2', okTxn), drawerDelta: {}}));
  assert.equal(db.state.orders['POS-D01-2'].totalCheck, undefined); assert.equal(db.state.posTotalChecks['POS-D01-2'], undefined, 'a consistent sale is not flagged');
  const gfTxn = 'pos_txn_d01_000003';
  await O.syncOfflinePosSaleCommand(baseCtx(db, {transactionId: gfTxn, order: cashSale('GF-D01-3', gfTxn, {channel: 'grabfood', payment: 'GrabFood', payments: [{method: 'GrabFood', amount: 50, tendered: 0, change: 0}], total: 50}), drawerDelta: {}}));
  assert.equal(db.state.posTotalChecks['GF-D01-3'], undefined, 'platform pricing is not checked');
}

// ---------- D-04: COGS follows its sale's posting date ----------
const sold = Date.parse('2026-09-30T10:00:00+08:00'), posted = Date.parse('2026-10-02T09:00:00+08:00');
assert.equal(BB.cogsMovement({completedAt: sold}, 'X', {}, {}).occurredAt, sold, 'no sale date given: the sale time');
assert.equal(BB.cogsMovement({completedAt: sold}, 'X', {}, {}, posted).occurredAt, posted, 'COGS takes the sale movement date');
// A cost already in its sale-date bucket stays there: a re-fired mirror cannot add it to a second
// day, and a Books rebuild cannot move history out of a closed month.
assert.equal(BB.cogsPostedAt(true, posted), 0, 'already in the sale-date bucket: keep the sale date');
assert.equal(BB.cogsPostedAt(false, posted), posted, 'not yet applied: follow the sale movement');
assert.equal(BB.cogsPostedAt(false, null), 0, 'sale not posted yet: the sale time');
assert.equal(BB.cogsLegacyBucketKey({completedAt: sold, channel: 'instore'}), '2026-09-30_instore');
{
  const src = fs.readFileSync('src/functions/10-books-bridge.js', 'utf8');
  assert.ok(/cogsMovement\(order, orderId, maps\.inventory, categories, postedAt\)/.test(src) && /sources\/cogs_\$\{orderId\}`\)\.get\(\)/.test(src), 'the live mirror checks the sale-date bucket before moving the cost');
  const timing = src.slice(src.indexOf('async function cogsPostingTime'), src.indexOf('exports.mirrorPosCogsToBooks'));
  assert.ok(timing.indexOf('sources/cogs_') < timing.indexOf('financialMovements/sale_') && timing.indexOf('financialMovements/sale_') < timing.indexOf('periodOpenFor'), 'an applied cost stays put; a posted sale decides the date; the period is checked only while the sale is unposted');
  assert.ok(/BooksBridge\.cogsPostedAt\(inSaleDate, movements\[`sale_\$\{id\}`\]/.test(src), 'the Books rebuild uses the same rule');
  assert.ok(/waits for its sale to post: the sale month is closed/.test(src), 'COGS for a late sale waits for the sale instead of landing in the closed month');
}

// ---------- C-01: refund-due rejection postings ----------
const accounts = {acc_gcash: {name: 'GCash', feedMethods: ['GCash']}, acc_bdo: {name: 'BDO', feedMethods: ['Bank Transfer · BDO']}};
const web = {id: 'OD-1', name: 'Ana', source: 'online', payment: 'GCash', total: 245.5, payments: [{method: 'GCash', amount: 245.5, receivingAccountId: 'acc_gcash'}]};
const due = F.rejectionRefundDuePosting(web, 'rejection_refund_OD-1_1', 245.5, accounts);
assert.deepEqual(due.lines.map((l) => [l.account, l.debit, l.credit]), [['asset:cash_account:acc_gcash', 245.5, 0], ['liability:customer_change_refund:rejection_refund_OD-1_1', 0, 245.5]]);
assert.deepEqual(F.rejectionRefundPaidPosting(due).map((l) => [l.account, l.debit, l.credit]), [['liability:customer_change_refund:rejection_refund_OD-1_1', 245.5, 0], ['asset:cash_account:acc_gcash', 0, 245.5]]);
assert.equal(F.rejectionRefundDuePosting(Object.assign({}, web, {payments: [{method: 'QR Wallet', amount: 245.5}]}), 'p', 245.5, accounts).lines[0].account, 'asset:unmapped_payment:qr_wallet', 'an unmapped wallet goes to review, not to a guessed bank');
assert.equal(BB.mapAccount('liability:customer_change_refund:rejection_refund_OD-1_1', 'online', {}).code, '2030', 'the payable lands in 2030');

{
  const source = fs.readFileSync('src/functions/43g-order-adjustments.js', 'utf8');
  const slice = source.slice(source.indexOf('function rejectionKeys('));
  const committed = {};
  const ctx = {Financial: F, logger: {warn() {}, error() {}}, exports: {}, ORDER_REGION: 'asia-southeast1',
    onValueWritten: (opts, fn) => fn,
    financeKey: (v) => String(v), financeText: (v, max = 160) => String(v == null ? '' : v).trim().slice(0, max),
    financeDateFromTimestamp: (t) => new Date(Number(t) + 8 * 3600000).toISOString().slice(0, 10),
    periodOpenFor: async () => true,
    cashLedgerRecord: (entry, movementId) => Object.assign({movementId}, entry),
    getDatabase: () => ctx.db,
    commitFinancial: async (db, id, movement, actor, writes) => {if (db.state.financialMovements && db.state.financialMovements[id]) return {duplicate: true}; assert.ok(Math.abs(F.totals(movement.lines).debit - F.totals(movement.lines).credit) < .005, `${id} must balance`); await db.ref().update(Object.assign({[`financialMovements/${id}`]: Object.assign({id}, movement)}, writes)); committed[id] = (committed[id] || 0) + 1; return {duplicate: false};},
  };
  vm.createContext(ctx); vm.runInContext(slice, ctx);
  const handler = ctx.exports.onOrderRejectionFinancial;
  const fire = (before, after, orderId = 'OD-1') => handler({params: {orderId}, data: {before: {val: () => before}, after: {val: () => after}}});
  const rejection = {outcome: 'refund_due', refundStatus: 'owed', refundAmount: 245.5, at: 111, byUid: 'm1', byRole: 'manager'};
  ctx.db = fakeDb({cfAccounts: accounts, orders: {'OD-1': Object.assign({}, web, {status: 'Rejected', rejection})}});
  await fire(null, rejection);
  const p = ctx.db.state.payables['rejection_refund_OD-1_111'];
  assert.deepEqual([p.type, p.status, p.amount, p.remainingAmount], ['customer_change_refund', 'open', 245.5, 245.5], 'an open 2030 customer payable reconciles the daily close');
  assert.equal(ctx.db.state.cfLedger['rejdue_OD-1_111_0'].dir, 'in', 'Cash Flow shows the money received');
  await fire(null, rejection); assert.equal(committed['rejection_due_OD-1_111'], 1, 'a redelivery posts once');
  const paid = Object.assign({}, rejection, {refundStatus: 'paid', refundPaidAt: 222, refundMethod: 'GCash', refundReference: 'GC-1'});
  ctx.db.state.orders['OD-1'].rejection = paid;
  await fire(rejection, paid);
  const pp = ctx.db.state.payables['rejection_refund_OD-1_111'];
  assert.deepEqual([pp.status, pp.remainingAmount], ['paid', 0]);
  assert.equal(ctx.db.state.financialMovements['rejection_paid_OD-1_111'].lines[1].account, 'asset:cash_account:acc_gcash', 'the refund leaves the account it came in to');
  assert.equal(ctx.db.state.cfLedger['rejpaid_OD-1_111_0'].dir, 'out');
  await fire(rejection, paid); assert.equal(committed['rejection_paid_OD-1_111'], 1, 'paying twice posts once');
  // Refund sent by another method that maps to an account: that account is credited.
  const r2 = Object.assign({}, rejection, {at: 333});
  ctx.db = fakeDb({cfAccounts: accounts, orders: {'OD-1': Object.assign({}, web, {status: 'Rejected', rejection: r2})}});
  await fire(null, r2); const paid2 = Object.assign({}, r2, {refundStatus: 'paid', refundPaidAt: 334, refundMethod: 'Bank Transfer · BDO', refundReference: 'B-1'}); ctx.db.state.orders['OD-1'].rejection = paid2; await fire(r2, paid2);
  assert.equal(ctx.db.state.financialMovements['rejection_paid_OD-1_333'].lines[1].account, 'asset:cash_account:acc_bdo');
  // Reopened before the refund was paid: the refund due is reversed so the later sale posts once.
  const r3 = Object.assign({}, rejection, {at: 444});
  ctx.db = fakeDb({cfAccounts: accounts, orders: {'OD-1': Object.assign({}, web, {status: 'Rejected', rejection: r3})}});
  await fire(null, r3); delete ctx.db.state.orders['OD-1'].rejection; ctx.db.state.orders['OD-1'].status = 'Preparing';
  await fire(r3, null);
  const rev = ctx.db.state.financialMovements['rejection_due_reversal_OD-1_444'];
  assert.deepEqual(rev.lines.map((l) => [l.account, l.debit, l.credit]), [['asset:cash_account:acc_gcash', 0, 245.5], ['liability:customer_change_refund:rejection_refund_OD-1_444', 245.5, 0]]);
  assert.deepEqual([ctx.db.state.payables['rejection_refund_OD-1_444'].status, ctx.db.state.payables['rejection_refund_OD-1_444'].remainingAmount], ['reversed', 0]);
  // A redelivered reopen event posts nothing more and does not dead-letter.
  await fire(r3, null);
  assert.equal(committed['rejection_due_reversal_OD-1_444'], 1, 'a second reopen event is a duplicate, not an alert');
  // A late or retried reject event for an order that is already reopened posts nothing.
  const r5 = Object.assign({}, rejection, {at: 777});
  ctx.db = fakeDb({cfAccounts: accounts, orders: {'OD-1': Object.assign({}, web, {status: 'Preparing'})}});
  await fire(null, r5);
  assert.equal(ctx.db.state.financialMovements, undefined, 'a stale reject event cannot book a refund due on a live order');
  // Archived (the order moved to archivedOrders with its rejection): not a reopen, and a late
  // refund-paid event still posts from the archived copy.
  const r4 = Object.assign({}, rejection, {at: 555});
  ctx.db = fakeDb({cfAccounts: accounts, orders: {'OD-1': Object.assign({}, web, {status: 'Rejected', rejection: r4})}});
  await fire(null, r4);
  const paid4 = Object.assign({}, r4, {refundStatus: 'paid', refundPaidAt: 556, refundMethod: 'GCash', refundReference: 'GC-4'});
  ctx.db.state.archivedOrders = {'OD-1': Object.assign({}, ctx.db.state.orders['OD-1'], {rejection: paid4})}; delete ctx.db.state.orders['OD-1'];
  await fire(paid4, null);
  assert.equal(ctx.db.state.financialMovements['rejection_due_reversal_OD-1_555'], undefined, 'archiving does not reverse the refund due');
  assert.ok(ctx.db.state.financialMovements['rejection_paid_OD-1_555'], 'the refund paid still posts after archiving');
  // The refund clears what the receipt debited, even if the wallet was mapped in between.
  const r6 = Object.assign({}, rejection, {at: 888});
  const unmappedOrder = Object.assign({}, web, {payments: [{method: 'GCash', amount: 245.5}], status: 'Rejected', rejection: r6});
  ctx.db = fakeDb({cfAccounts: {}, orders: {'OD-1': unmappedOrder}});
  await fire(null, r6);
  assert.equal(ctx.db.state.financialMovements['rejection_due_OD-1_888'].lines[0].account, 'asset:unmapped_payment:gcash');
  ctx.db.state.cfAccounts = accounts;
  const paid6 = Object.assign({}, r6, {refundStatus: 'paid', refundPaidAt: 889, refundMethod: 'GCash', refundReference: 'GC-6'});
  ctx.db.state.orders['OD-1'].rejection = paid6;
  await fire(r6, paid6);
  assert.equal(ctx.db.state.financialMovements['rejection_paid_OD-1_888'].lines[1].account, 'asset:unmapped_payment:gcash', 'the refund clears the account the receipt used');
  // A refund sent by a method that maps to no account goes to review, not to the incoming wallet.
  const r7 = Object.assign({}, rejection, {at: 901});
  ctx.db = fakeDb({cfAccounts: accounts, orders: {'OD-1': Object.assign({}, web, {status: 'Rejected', rejection: r7})}});
  await fire(null, r7);
  const paid7 = Object.assign({}, r7, {refundStatus: 'paid', refundPaidAt: 902, refundMethod: 'Maya', refundReference: 'M-1'});
  ctx.db.state.orders['OD-1'].rejection = paid7; await fire(r7, paid7);
  assert.equal(ctx.db.state.financialMovements['rejection_paid_OD-1_901'].lines[1].account, 'asset:unmapped_payment:maya');
  assert.equal(ctx.db.state.payables['rejection_refund_OD-1_901'].settlingBy, undefined, 'the settlement claim is cleared once paid');
  // A payable already being settled elsewhere is not paid a second time.
  const r8 = Object.assign({}, rejection, {at: 903});
  ctx.db = fakeDb({cfAccounts: accounts, orders: {'OD-1': Object.assign({}, web, {status: 'Rejected', rejection: r8})}});
  await fire(null, r8);
  ctx.db.state.payables['rejection_refund_OD-1_903'].status = 'settling';
  const paid8 = Object.assign({}, r8, {refundStatus: 'paid', refundPaidAt: 904, refundMethod: 'GCash', refundReference: 'GC-8'});
  ctx.db.state.orders['OD-1'].rejection = paid8; await fire(r8, paid8);
  assert.equal(ctx.db.state.financialMovements['rejection_paid_OD-1_903'], undefined, 'a claimed payable is not settled twice');
  // Reopened after the refund was paid: stop and alert rather than let the sale book it again.
  const r9 = Object.assign({}, rejection, {at: 905, refundStatus: 'paid'});
  ctx.db = fakeDb({cfAccounts: accounts, orders: {'OD-1': Object.assign({}, web, {status: 'Preparing'})}});
  await assert.rejects(fire(r9, null), /reopened after its refund was paid/);
  // Payment not found posts nothing.
  ctx.db = fakeDb({cfAccounts: accounts, orders: {'OD-2': Object.assign({}, web, {id: 'OD-2', status: 'Rejected'})}});
  await fire(null, {outcome: 'payment_not_found', at: 666}, 'OD-2');
  assert.equal(ctx.db.state.financialMovements, undefined, 'payment not found posts nothing');
}
console.log('PASS: audit money fixes (till count, POS total check, COGS date, refund-due rejections).');
