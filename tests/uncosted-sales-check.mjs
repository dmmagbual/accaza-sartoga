// Sales without a usable recipe (24 Sep 2026).
// On 23 Sep a cashier could not produce her Z report: one Mango Muesli (a pastry marked
// "needs building" with no recipe) costed to an empty stock usage, the database dropped the
// empty map, and order finalization threw on every retry, so the close check waited forever.
// This proves: sales always proceed, uncosted lines are flagged, finalization always completes,
// and a manager can post the missing cost later exactly once, reversed with the sale.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createFakeDatabase} from './helpers/fake-rtdb.mjs';
import {loadFunctions} from './helpers/functions-sandbox.mjs';

const require = createRequire(import.meta.url);
const Costing = require('../functions/lib/costing.js');
const U = require('../functions/lib/uncosted-sales.js');
const HistoricalArchive = require('../functions/lib/historical-archive.js');
const OperationalExceptions = require('../functions/lib/operational-exceptions.js');
const ShiftHandover = require('../functions/lib/shift-handover.js');
const rules = fs.readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8');

const SALE_AT = Date.parse('2026-09-23T18:59:30+08:00');
const menuItems = {
  latte: {name: 'Cafe Latte', cat: 'coffee', priceS: 120},
  mango: {name: 'Mango Muesli', cat: 'pastry', needsBuilding: true, priceS: 145},
  broken: {name: 'Broken Frappe', cat: 'frappe', priceS: 150},
  syrup: {name: 'Sugar Syrup', cat: 'addon', priceS: 20, noRecipe: true},
};
const inventory = {
  milk: {name: 'Fresh Milk', unit: 'ml', stock: 10000, cost: 0.1, inventoryAccount: '1230', costAccount: '5000'},
  oats: {name: 'Rolled Oats', unit: 'g', stock: 5000, cost: 0.2, inventoryAccount: '1220', costAccount: '5030'},
};
const recipes = {latte: {base: [{ing: 'milk', qtyS: 200, qtyM: 200, qtyL: 200}]}, broken: {base: [{ing: 'ghost', qtyS: 1, qtyM: 1, qtyL: 1}]}};
const catalog = {recipes, inventory, menuItems, sharedBaseIngredients: {}, optionCosts: {}, optionRecipes: {}, optionGroups: {}, packagingRules: {}, packagingAssignments: {}};
const line = (itemKey, qty = 1) => ({itemKey, name: menuItems[itemKey] ? menuItems[itemKey].name : itemKey, qty, size: 'S', optLabels: []});

// 1. Tolerant costing: fully costed orders are unchanged; unusable lines are excluded and reported.
{
  const ctx = Object.assign({}, catalog, {lineItems: [line('latte', 2)]});
  assert.deepEqual(U.costOrderTolerant(ctx), Object.assign(Costing.costOrder(ctx), {uncosted: []}), 'a fully costed order is costed exactly as before');
  const mango = U.costOrderTolerant(Object.assign({}, catalog, {lineItems: [line('mango')]}));
  assert.equal(mango.ok, true, 'a sale is never refused');
  assert.deepEqual(mango.usage, {}, 'no stock is taken for a line without a recipe');
  assert.equal(mango.uncosted.length, 1);
  assert.equal(mango.uncosted[0].reason, 'missing_recipe');
  const mixed = U.costOrderTolerant(Object.assign({}, catalog, {lineItems: [line('latte'), line('mango'), line('broken')]}));
  assert.equal(Costing.costOrder(Object.assign({}, catalog, {lineItems: [line('latte'), line('broken')]})).ok, false, 'the engine still rejects a broken recipe');
  assert.equal(mixed.ok, true);
  assert.deepEqual(mixed.usage, {milk: 200}, 'costed lines still deduct stock');
  assert.equal(mixed.totalCost, 20);
  assert.deepEqual(mixed.uncosted.map((row) => [row.lineIndex, row.reason]), [[1, 'missing_recipe'], [2, 'broken_recipe']]);
  assert.ok(mixed.uncosted[1].codes.includes('BROKEN_INVENTORY_REFERENCE'));
  assert.equal(mixed.cogsCovered, false);
  const confirmed = U.costOrderTolerant(Object.assign({}, catalog, {lineItems: [line('latte'), line('syrup')]}));
  assert.equal(confirmed.uncosted.length, 0, 'an item marked "no recipe needed" is not flagged');
  assert.equal(confirmed.cogsCovered, true);
  // The database drops an empty usage map. Such a plan is empty, not missing.
  assert.equal(U.validPlan({schemaVersion: 1, capturedBy: 'server', totalCost: 0, warnings: [{code: 'MISSING_RECIPE'}]}), true);
  assert.equal(U.validPlan({schemaVersion: 1, capturedBy: 'server', totalCost: 5}), false, 'a costed plan without usage is still invalid');
  assert.equal(HistoricalArchive.validInventoryPlan({schemaVersion: 1, capturedBy: 'server', totalCost: 0, emptyUsage: true}), true, 'archiving accepts an empty plan');
  assert.deepEqual(U.legacyUncostedLines({warnings: [{code: 'MISSING_RECIPE', itemKey: 'mango'}]}, [line('latte'), line('mango')], menuItems).map((row) => row.lineIndex), [1]);
  const lines = U.financeLines([{itemId: 'milk', totalCost: -20}, {itemId: 'oats', totalCost: -4.5}, {itemId: 'unmapped', totalCost: -1}], inventory, 'x');
  assert.deepEqual(lines.map((l) => [l.account, l.debit, l.credit]), [['coa:5030', 4.5, 0], ['coa:1220', 0, 4.5], ['coa:5000', 20, 0], ['coa:1230', 0, 20], ['coa:5090', 1, 0], ['coa:1290', 0, 1]]);
}

// 2. End to end against the real Functions bundle and an index-enforcing database.
const order = (id, lineItems, extra = {}) => Object.assign({id, status: 'Completed', source: 'pos', channel: 'instore', shiftId: 'SH-1', timestamp: SALE_AT, completedAt: SALE_AT, total: 145, subtotal: 145, payment: 'Cash', payments: [{method: 'Cash', amount: 145}], paymentStatus: 'confirmed', lineItems}, extra);
const data = {
  admins: {owner1: 'owner', cashier1: {role: 'staff'}},
  adminPerms: {cashier1: {recipes: true}},
  menuItems, inventory, recipes, posSettings: {},
  orders: {
    'POS-MANGO1': order('POS-MANGO1', [line('mango')]),
    'POS-MIXED1': order('POS-MIXED1', [line('latte'), line('mango')], {total: 265}),
    'POS-VOID1': order('POS-VOID1', [line('mango')]),
  },
  // The stuck production sale: its plan was stored before this release, without usage.
  archivedOrders: {'POS-LEGACY1': order('POS-LEGACY1', [line('mango')], {status: 'Archived', prevStatus: 'Completed', timestamp: SALE_AT - 86400000, completedAt: SALE_AT - 86400000})},
  orderInventoryPlans: {'POS-LEGACY1': {schemaVersion: 1, capturedAt: 1, capturedBy: 'server', engineVersion: '3F-4', totalCost: 0, cogsCovered: false, categorySnapshot: {food: 0}, warnings: [{code: 'MISSING_RECIPE', itemKey: 'mango', message: 'Mango Muesli has no recipe.'}]}},
};
const NOW = Date.parse('2026-09-24T10:00:00+08:00');
const db = createFakeDatabase(data, {rules});
// Objects built inside the sandbox belong to another realm; the host-realm write-safety check
// would call them non-plain. Re-create them in this realm first (production has one realm).
const WriteSafety = require('../functions/lib/write-safety.js');
const hostRealm = (value) => JSON.parse(JSON.stringify(value));
const writeSafety = Object.assign({}, WriteSafety, {normalizeAtomicUpdatePaths: (input) => WriteSafety.normalizeAtomicUpdatePaths(hostRealm(input)), safeAtomicUpdate: (store, writes) => WriteSafety.safeAtomicUpdate(store, hostRealm(writes))});
const {exports: fx, internal: I} = loadFunctions(db, {now: NOW, expose: ['finalizeOrderInventory'], libOverrides: {'./lib/write-safety': writeSafety}});
const val = async (path) => (await db.ref(path).get()).val();
const as = (uid, payload) => fx.manageUncostedSales({auth: {uid, token: {}}, data: payload});

// The exact 23 Sep failure: finalization completes, the sale is confirmed and flagged.
for (const id of ['POS-MANGO1', 'POS-MIXED1', 'POS-VOID1']) await I.finalizeOrderInventory(db, id, await val(`orders/${id}`));
{
  const o = await val('orders/POS-MANGO1'), plan = await val('orderInventoryPlans/POS-MANGO1');
  assert.equal(o.inventoryDeducted, true, 'an all-uncosted sale is confirmed, so the shift can close');
  assert.equal(o.costPendingLines, 1);
  assert.equal(plan.usage, undefined, 'the database dropped the empty usage map');
  assert.equal(plan.emptyUsage, true);
  assert.equal((await val('uncostedSales/POS-MANGO1__sale_0')).status, 'open');
  const mixed = await val('orders/POS-MIXED1');
  assert.deepEqual(mixed.inventoryUsage, {milk: 200}, 'the costed line of a mixed sale still deducts stock');
  assert.equal(mixed.cogsSnapshot, 20);
  assert.equal(mixed.costPendingLines, 1);
  assert.equal(await val('uncostedSales/POS-MIXED1__sale_0'), null, 'the costed line is not flagged');
  assert.equal((await val('uncostedSales/POS-MIXED1__sale_1')).itemKey, 'mango');
  // Finalizing again changes nothing.
  await I.finalizeOrderInventory(db, 'POS-MANGO1', await val('orders/POS-MANGO1'));
  assert.equal(Object.keys((await val('inventoryMovements')) || {}).filter((id) => id.includes('POS-MANGO1')).length, 0);
}

// Management recovery of the stuck legacy sale, plus the list.
{
  await assert.rejects(as('cashier1', {action: 'scan'}), /Only a manager/, 'staff cannot run the recovery scan');
  const scan = await as('owner1', {action: 'scan', since: '2026-09-01'});
  assert.equal(scan.finalized, 1, 'the stuck archived sale is finalized');
  assert.equal((await val('archivedOrders/POS-LEGACY1')).inventoryDeducted, true);
  assert.equal((await val('uncostedSales/POS-LEGACY1__sale_0')).reason, 'missing_recipe', 'a plan written before this release is still flagged');
  const again = await as('owner1', {action: 'scan', since: '2026-09-01'});
  assert.equal(again.flagged, 0, 'the scan is idempotent');
  const list = await as('cashier1', {action: 'list'});
  assert.equal(list.canResolve, false);
  const mango = list.groups.find((g) => g.itemKey === 'mango');
  assert.equal(mango.count, 4);
  await assert.rejects(as('cashier1', {action: 'apply_recipe', itemKey: 'mango', expectedTotal: 0}), /Only a manager/);
}

// The recipe is still missing: nothing can be posted.
await assert.rejects(as('owner1', {action: 'apply_recipe', itemKey: 'mango', expectedTotal: 0}), /recipe is not complete/);

// Build the recipe, void one sale, close the legacy sale's period, then apply.
await db.ref('recipes/mango').set({base: [{ing: 'oats', qtyS: 50, qtyM: 50, qtyL: 50}, {ing: 'milk', qtyS: 100, qtyM: 100, qtyL: 100}]});
await db.ref('orders/POS-VOID1/voided').set(true);
{
  const preview = await as('owner1', {action: 'preview', itemKey: 'mango'});
  assert.equal(preview.readyCount, 4);
  assert.equal(preview.total, 80, 'four servings of 10 g oats cost + 10 ml milk cost');
  await assert.rejects(as('owner1', {action: 'apply_recipe', itemKey: 'mango', expectedTotal: 60}), /Review the new preview/, 'a total different from the approved preview is refused');
  await db.ref('accountingPeriods/2026-09').set({status: 'closed'});
  const closedPreview = await as('owner1', {action: 'preview', itemKey: 'mango'});
  assert.ok(closedPreview.rows.every((row) => row.postedToOriginalDate === false && row.postDate === '2026-09-24'), 'a closed period posts today');
  await db.ref('accountingPeriods/2026-09').set({status: 'open'});
  const result = await as('owner1', {action: 'apply_recipe', itemKey: 'mango', expectedTotal: 80, reason: 'Recipe built 24 Sep'});
  assert.equal(result.applied, 3, "three open sales are costed");
  assert.equal(result.skipped.filter((row) => row.skipped === 'voided').length, 1, 'the voided sale is closed, not costed');
  assert.equal(result.amount, 60);
  const row = await val('uncostedSales/POS-MANGO1__sale_0');
  assert.equal(row.status, 'resolved');
  assert.equal(row.resolution.postedToOriginalDate, true);
  const fin = await val('financialMovements/ucogs_POS-MANGO1__sale_0');
  assert.equal(fin.type, 'order_cost_correction');
  assert.equal(fin.sourceId, 'POS-MANGO1');
  assert.equal(fin.occurredAt, SALE_AT, 'posted on the original sale date');
  const debit = fin.lines.reduce((s, l) => s + l.debit, 0), credit = fin.lines.reduce((s, l) => s + l.credit, 0);
  assert.equal(Math.round(debit * 100), 2000);
  assert.equal(Math.round(credit * 100), 2000, 'the correction is balanced');
  assert.deepEqual(fin.lines.map((l) => l.account).sort(), ['coa:1220', 'coa:1230', 'coa:5000', 'coa:5030']);
  assert.equal((await val('inventoryMovements/ucs_POS-MANGO1__sale_0_oats')).qty, -50);
  const o = await val('orders/POS-MANGO1');
  assert.equal(o.costCorrectionTotal, 20);
  assert.equal(o.costPendingLines, undefined, 'the sale no longer has pending lines');
  assert.equal(o.cogsSnapshot, 0, 'the posted sale is not rewritten');
  assert.equal((await val('uncostedSales/POS-VOID1__sale_0')).status, 'void');
  assert.equal((await val('archivedOrders/POS-LEGACY1')).costCorrectionTotal, 20, 'archived sales are corrected in place');
  // Nothing is posted twice.
  const stockBefore = await val('inventoryAccounting/oats/balance');
  await assert.rejects(as('owner1', {action: 'apply_recipe', itemKey: 'mango', expectedTotal: 0}), /No open sales remain/);
  assert.equal(await val('inventoryAccounting/oats/balance'), stockBefore);
}

// A void with stock returned also returns what the correction deducted, and reverses its cost.
{
  await db.ref('orders/POS-MANGO1/voided').set(true);
  await db.ref('orders/POS-MANGO1/inventoryReversalRequested').set(true);
  const oatsBefore = await val('inventoryAccounting/oats/balance');
  await fx.onOrderInventoryReversal({params: {orderId: 'POS-MANGO1'}, data: {after: {val: () => true}}, id: 'evt-1', time: new Date(NOW).toISOString()});
  assert.equal(await val('inventoryAccounting/oats/balance'), oatsBefore + 50, 'the corrected stock returns');
  const rev = await val('financialMovements/ucogs_rev_POS-MANGO1__sale_0');
  assert.ok(rev, 'the correction cost is reversed');
  assert.equal(rev.lines.find((l) => l.account === 'coa:5000').credit, 10);
  assert.equal((await val('orders/POS-MANGO1')).inventoryReversed, true, 'an order with no original usage still completes its reversal');
}

// Confirm no cost closes the flags at zero and stops future flags.
{
  const o = order('POS-COOKIE1', [line('cookie')]);
  await db.ref('menuItems/cookie').set({name: 'Chocolate Chip Cookie', cat: 'cookies', priceS: 60});
  await db.ref('orders/POS-COOKIE1').set(o);
  await I.finalizeOrderInventory(db, 'POS-COOKIE1', o);
  await assert.rejects(as('owner1', {action: 'confirm_no_cost', itemKey: 'cookie', reason: 'x'}), /Explain why/);
  const done = await as('owner1', {action: 'confirm_no_cost', itemKey: 'cookie', reason: 'Bought-in, costed as supplies', markNoRecipe: true});
  assert.equal(done.resolved, 1);
  assert.equal((await val('uncostedSales/POS-COOKIE1__sale_0')).resolution.type, 'no_cost');
  assert.equal(await val('menuItems/cookie/noRecipe'), true);
  assert.equal((await val('orders/POS-COOKIE1')).costPendingLines, undefined);
}

// 3. Exceptions, close and Z report surface open flags.
{
  const ex = OperationalExceptions.buildOperationalExceptions({uncostedSales: {a: {status: 'open', itemKey: 'mango', itemName: 'Mango Muesli', occurredAt: SALE_AT}, b: {status: 'open', itemKey: 'mango', itemName: 'Mango Muesli'}, c: {status: 'resolved', itemKey: 'x'}}}, NOW);
  const row = ex.exceptions.find((x) => x.category === 'uncosted_sale');
  assert.match(row.title, /Mango Muesli: 2 sales/);
  assert.equal(row.tab, 'recipes');
  const z = ShiftHandover.report({id: 'SH-1', openingFloat: 0}, {'POS-A': {shiftId: 'SH-1', status: 'Completed', total: 145, payments: [{method: 'Cash', amount: 145}], costPendingLines: 1}}, {cash: {countedCash: 145}, at: 1});
  assert.equal(z.uncostedCount, 1, 'the Z report counts lines sold without a recipe');
}

console.log('PASS: sales without a usable recipe proceed, finalize, reach the Z report, and are costed once by a manager with linked, reversible stock and Finance postings.');
