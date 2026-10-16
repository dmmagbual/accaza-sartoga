// Voids post on the original sale date (16 Oct 2026).
// Four GrabFood duplicates sold in September were voided on 6 October and posted on 6 October, so
// Finance Books kept them in September while Admin (which drops a voided sale from its sale month)
// did not: Admin was PHP 1,410 short in September and PHP 1,410 over in October. Owner decision:
// Finance follows Admin - a void belongs on its sale date. This check guards:
// 1. the server posts every void on the original sale date and refuses an earlier-day in-store void,
// 2. the void dialog derives that date from the sale timestamp (o.date is display text) and locks it,
// 3. Books > Repair date mismatches finds voids on the wrong date, locks closed months, voids that
//    returned money, paid-out platform orders, VAT crossing a quarter and stock already returned,
//    skips missing orders, and re-dates the rest (order side in the same update) with an optional
//    stock return,
// 4. archived orders can return stock, and the COGS reversal follows the corrected void date.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const BB = require('../functions/lib/books-bridge.js');
const Financial = require('../functions/lib/financial.js');
const AccountingPeriods = require('../functions/lib/accounting-periods.js');
const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const built = read('functions/index.js'), adj = read('src/functions/43g-order-adjustments.js');

// 1. Server rule.
for (const source of [adj, built]) {
  assert.ok(source.includes('originalDate=financeDateFromTimestamp(o.completedAt||o.receivedAt||o.timestamp||now),voidDate=originalDate;'), 'a void posts on the original sale date');
  assert.ok(source.includes('A void posts on the original sale date (${originalDate}) so Finance Books and Admin agree.'), 'a stale client sending another date is refused, never silently re-dated');
  assert.ok(source.includes('const earlierDay=originalDate!==financeDateFromTimestamp(now);if(String(o.channel||"instore").toLowerCase()==="instore"&&earlierDay)'), 'an earlier-day in-store void is refused: its cash was counted in that shift');
  assert.ok(source.includes('is closed, so this sale cannot be voided on its sale date (${originalDate}). Use Refund instead; a refund posts today.'), 'a sale in a closed month is refused with the Refund route, never posted into the closed month');
  assert.ok(source.includes('if (earlierDay && (movement.lines||[]).some((line)=>/^asset:(register_cash|cash)/.test(String(line&&line.account||"")))) throw new HttpsError("failed-precondition"'), 'an earlier-day void that would return money (any channel) must be a Refund');
  assert.ok(source.includes('data.accountingDate=voidDate;'), 'the approval fingerprint and movement date use the sale date');
  assert.ok(!source.includes('voidDate=financeDate(data.accountingDate)'), 'the void date may no longer come from the client');
}
for (const marker of ['movement.occurredAt = (order.voidAccountingDate && Date.parse(`${order.voidAccountingDate}T00:00:00+08:00`)) || Number(order.voidedAt || Date.now());', 'correction.occurredAt=(order.voidAccountingDate&&Date.parse(`${order.voidAccountingDate}T00:00:00+08:00`))||Number(order.voidedAt||order.timestamp||Date.now());']) assert.ok(built.includes(marker), `trigger-posted void and void-balance corrections follow the void accounting date: ${marker}`);
assert.ok(built.includes('movement.occurredAt = data.action === "void" ? (Date.parse(`${financeDate(data.accountingDate)}T00:00:00+08:00`) || now) : now;'), 'the posted movement takes the normalized void date');

// 2. Void dialog.
const ui = read('src/admin/register/99-voids-refunds.js'), adminBundle = read('assets/js/admin/register.js');
for (const source of [ui, adminBundle]) {
  assert.ok(source.includes("saleTs=Number(o.completedAt||o.receivedAt||o.timestamp)||Date.now(),postingDate=window.AccazaDate.key(saleTs);"), 'the dialog derives the sale date like the server');
  assert.ok(source.includes("min:postingDate,max:postingDate,value:postingDate"), 'the posting date is locked to the sale date');
  assert.ok(!source.includes("String(o.date||'').slice(0,10)"), 'o.date is display text ("October 9, 2026") and must never be sliced into a date');
  assert.ok(source.includes("so use Refund instead of Void"), 'the dialog explains the in-store rule');
}
const dateWindow = {}; vm.runInNewContext(read('assets/js/shared/business-date.js'), {window: dateWindow, Intl, Date, Object});
assert.equal(dateWindow.AccazaDate.key(Date.parse('2026-09-30T16:08:28.830Z')), '2026-10-01', 'browser and server agree on the Manila date');
assert.equal(dateWindow.AccazaDate.key(Date.parse('2026-09-30T16:08:28.830Z')), BB.businessDate(Date.parse('2026-09-30T16:08:28.830Z')));

// 3. Repair tool.
const start = built.indexOf('const VOID_MONEY_ACCOUNT'), end = built.indexOf('\n}\n', built.indexOf('async function completeVoidSaleDateRepair(')) + 3;
assert.ok(start > 0 && end > start, 'void repair helpers are in the bundle');
const helpers = built.slice(start, end);
const at = (iso) => Date.parse(iso);
const store = {
  '/orders/GF-SEP': null,
  '/archivedOrders/GF-SEP': {id: 'GF-SEP', channel: 'grabfood', timestamp: at('2026-09-22T10:31:08Z'), voided: true, voidReason: 'Duplicate', inventoryDeducted: true},
  '/archivedOrders/GF-SAME': {id: 'GF-SAME', channel: 'grabfood', timestamp: at('2026-10-06T08:00:00Z'), voided: true},
  '/archivedOrders/GF-AUG': {id: 'GF-AUG', channel: 'grabfood', timestamp: at('2026-08-06T05:00:00Z'), voided: true},
  '/archivedOrders/POS-CASH': {id: 'POS-CASH', channel: 'instore', timestamp: at('2026-09-20T05:00:00Z'), voided: true},
  '/archivedOrders/GF-DONE': {id: 'GF-DONE', channel: 'grabfood', timestamp: at('2026-09-22T05:00:00Z'), voided: true, inventoryDeducted: true, inventoryReversed: true},
  '/orders/GF-LIVE': {id: 'GF-LIVE', channel: 'grabfood', timestamp: at('2026-09-29T05:00:00Z'), voided: true, inventoryDeducted: true},
  '/archivedOrders/GF-PAID': {id: 'GF-PAID', channel: 'grabfood', timestamp: at('2026-09-25T05:00:00Z'), voided: true, payoutId: 'PO-1', settlementStatus: 'settled'},
  '/archivedOrders/GF-VAT': {id: 'GF-VAT', channel: 'grabfood', timestamp: at('2026-09-26T05:00:00Z'), voided: true},
  '/archivedOrders/GF-REST': {id: 'GF-REST', channel: 'grabfood', timestamp: at('2026-09-27T05:00:00Z'), voided: true, inventoryDeducted: true, inventoryReversed: true},
  '/accountingPeriods/2026-08': {status: 'closed'},
};
const db = {ref: (path) => ({get: async () => ({val: () => store[path] === undefined ? null : store[path]})})};
const voidLines = [{account: 'asset:platform_receivable:grabfood', debit: 0, credit: 367.5}, {account: 'expense:platform_commission', debit: 0, credit: 122.5}, {account: 'revenue:sales', debit: 490, credit: 0}];
const movements = {
  void_GF_SEP: {type: 'order_void', sourceId: 'GF-SEP', occurredAt: at('2026-10-06T08:55:21Z'), amount: 490, lines: voidLines},
  void_GF_SAME: {type: 'order_void', sourceId: 'GF-SAME', occurredAt: at('2026-10-06T09:00:00Z'), amount: 100, lines: voidLines},
  void_GF_AUG: {type: 'order_void', sourceId: 'GF-AUG', occurredAt: at('2026-08-24T04:00:00Z'), amount: 50, lines: voidLines},
  void_POS_CASH: {type: 'order_void', sourceId: 'POS-CASH', occurredAt: at('2026-10-02T04:00:00Z'), amount: 80, lines: [{account: 'asset:register_cash', debit: 0, credit: 80}, {account: 'revenue:sales', debit: 80, credit: 0}]},
  void_GONE: {type: 'order_void', sourceId: 'POS-GONE', occurredAt: at('2026-08-21T04:00:00Z'), amount: 10, lines: voidLines},
  void_DONE: {type: 'order_void', sourceId: 'GF-DONE', occurredAt: at('2026-10-06T09:00:00Z'), amount: 70, lines: voidLines, dateRepairSupersededBy: 'finance_datefix_new_void_DONE'},
  void_GF_LIVE: {type: 'order_void', sourceId: 'GF-LIVE', occurredAt: at('2026-10-03T04:00:00Z'), amount: 60, lines: voidLines},
  void_GF_PAID: {type: 'order_void', sourceId: 'GF-PAID', occurredAt: at('2026-10-03T04:00:00Z'), amount: 60, lines: voidLines},
  void_GF_VAT: {type: 'order_void', sourceId: 'GF-VAT', occurredAt: at('2026-10-03T04:00:00Z'), amount: 112, lines: [...voidLines, {account: 'liability:output_vat', debit: 12, credit: 0}]},
  void_GF_REST: {type: 'order_void', sourceId: 'GF-REST', occurredAt: at('2026-10-03T04:00:00Z'), amount: 60, lines: voidLines},
  sale_GF_SEP: {type: 'order_sale', sourceId: 'GF-SEP', occurredAt: at('2026-09-22T10:31:08Z'), amount: 490, lines: voidLines},
};
const merged = [];
const ctx = {BooksBridge: BB, Financial, AccountingPeriods, financeDateFromTimestamp: (ts) => BB.businessDate(ts), Object, Number, String, Date, Promise,
  OrderRecords: {isAuthoritativeOrder: require('../functions/lib/order-records.js').isAuthoritativeOrder, mergeMetadataIntoAuthoritativeOrder: async (dbx, id, metadata) => { merged.push([id, metadata]); }}};
vm.createContext(ctx); vm.runInContext(helpers, ctx);
const rows = await ctx.voidSaleDateMismatches(db, movements);
const byId = Object.fromEntries(rows.map((row) => [row.movementId, row]));
assert.deepEqual(Object.keys(byId).sort(), ['void_GF_AUG', 'void_GF_LIVE', 'void_GF_PAID', 'void_GF_REST', 'void_GF_SEP', 'void_GF_VAT', 'void_POS_CASH'], 'same-date, already repaired, sale and missing-order movements are not listed');
assert.equal(byId.void_GF_SEP.currentDate, '2026-10-06'); assert.equal(byId.void_GF_SEP.targetDate, '2026-09-22');
assert.equal(byId.void_GF_SEP.locked, ''); assert.equal(byId.void_GF_SEP.restockable, true); assert.equal(byId.void_GF_SEP.basis, 'void_sale_date'); assert.equal(byId.void_GF_SEP.amount, 490);
assert.equal(byId.void_GF_AUG.locked, '2026-08 is closed', 'a closed month is never re-dated');
assert.equal(byId.void_POS_CASH.locked, 'returned money: review manually', 'a void that returned money is never re-dated automatically');
assert.equal(byId.void_GF_PAID.locked, 'already in a platform payout: review manually', 'a void of a paid-out platform order stays put');
assert.equal(byId.void_GF_VAT.locked, 'VAT would move to another tax quarter: review manually', 'VAT never moves into another (possibly filed) quarter');
assert.equal(byId.void_GF_REST.locked, 'stock already returned on the void date: review its cost manually', 'a void whose cost reversal is already in the void month is not split from it');
for (const id of ['void_GF_AUG', 'void_POS_CASH', 'void_GF_PAID', 'void_GF_VAT', 'void_GF_REST']) assert.equal(byId[id].restockable, false, `${id} is locked, so it offers no stock return`);
assert.equal(byId.void_GF_SEP.orderNode, 'archivedOrders'); assert.equal(byId.void_GF_LIVE.orderNode, 'orders', 'the order side is written to the authoritative node');
const plain = ctx.voidSaleDateOrderWrites(byId.void_GF_SEP, new Set(), 'Duplicate Grab entries', 1);
assert.deepEqual(JSON.parse(JSON.stringify(plain)), {'archivedOrders/GF-SEP/voidAccountingDate': '2026-09-22', 'archivedOrders/GF-SEP/voidDateRepairedAt': 1}, 'without the tick only the void accounting date changes');
const ticked = ctx.voidSaleDateOrderWrites(byId.void_GF_SEP, new Set(['GF-SEP']), 'Duplicate Grab entries', 1);
assert.equal(ticked['archivedOrders/GF-SEP/inventoryReversalRequested'], true, 'a ticked duplicate requests its stock return in the same update');
assert.equal(ctx.voidSaleDateOrderWrites(byId.void_GF_REST, new Set(['GF-REST']), 'x', 1)['archivedOrders/GF-REST/inventoryReversalRequested'], undefined, 'a locked row can never request stock even if ticked');
await ctx.completeVoidSaleDateRepair(db, byId.void_GF_SEP, new Set(), 'Duplicate Grab entries');
await ctx.completeVoidSaleDateRepair(db, byId.void_GF_SEP, new Set(['GF-SEP']), 'Duplicate Grab entries');
assert.equal(merged[0][1].voidAccountingDate, '2026-09-22'); assert.equal(merged[0][1].inventoryReversalRequested, undefined, 'stock is returned only when ticked');
assert.equal(merged[1][1].inventoryReversalRequested, true, 'a ticked duplicate returns its stock');
assert.match(merged[1][1].inventoryReversalReason, /Duplicate Grab entries \(void re-dated to sale date\)/);
for (const marker of ['mismatches.push(...(await voidSaleDateMismatches(db, movements)).filter((row) => !byMovement[row.movementId]));', 'if (m.ambiguous || m.locked) { skipped++; continue; }', 'm.basis === "void_sale_date" ? voidSaleDateOrderWrites(m, approvedRestock, reason, now) : {}));', 'if (m.basis === "void_sale_date" && pr.duplicate) await completeVoidSaleDateRepair(db, m, approvedRestock, reason);', '"dupPlatformRef","voidAccountingDate","voidDateRepairedAt","inventoryReversalReason"]);', 'if (actor.role !== "superadmin") throw new HttpsError("permission-denied", "Only a Super Admin can apply date corrections.");']) assert.ok(built.includes(marker), `repair tool is missing ${marker}`);

// COGS reversal follows the corrected void accounting date.
const cogs = BB.cogsReversalMovement({voided: true, inventoryReversed: true, voidAccountingDate: '2026-09-22', voidedAt: at('2026-10-06T08:55:21Z'), channel: 'grabfood', cogsSnapshot: 78.74, cogsCategorySnapshot: {beverage: 78.74}}, 'GF-SEP', {}, {});
assert.ok(cogs && cogs.lines.length, 'the fixture produces a COGS reversal');
assert.equal(BB.businessDate(cogs.occurredAt), '2026-09-22', 'the COGS reversal lands in the sale month');

// 4. Archived stock return and Books screen.
assert.ok(built.includes('async function reverseOrderInventoryAt(db, orderId, node) {\n    const orderRef = db.ref(`/${node}/${orderId}`);'), 'one shared stock-return routine');
assert.ok(built.includes('{ref: "/archivedOrders/{orderId}/inventoryReversalRequested", region: ORDER_REGION, retry: true}') && built.includes('await reverseOrderInventoryAt(getDatabase(), event.params.orderId, "archivedOrders");'), 'archived orders can return stock');
assert.ok(built.includes('await reverseOrderInventoryAt(getDatabase(), event.params.orderId, "orders");'), 'live orders keep their trigger');
assert.ok(JSON.parse(read('release-manifest.json')).requiredFunctionExports.includes('onArchivedOrderInventoryReversal'));
assert.ok(require('../functions/lib/dead-letter-resolution.js').PROBES.onArchivedOrderInventoryReversal, 'a stopped archived stock return can auto-close once complete');
const books = read('src/books/app/20-cash-flow.js'), booksBundle = read('assets/js/books/app.js');
for (const source of [books, booksBundle]) {
  assert.ok(source.includes("restockOrderIds:restock"), 'the owner chooses which voids return stock');
  assert.ok(source.includes("Void → sale date") && source.includes("To (correct date)"), 'each row says which date rule it follows');
  assert.ok(source.includes("locked=amb||!!m.locked"), 'locked rows cannot be selected');
}
console.log('Void sale-date checks passed.');
