// Bounded server reads (Sep 2026 download audit): each rewritten read gives exactly the result
// the previous whole-node read gave, and downloads less. Runs the real Functions bundle against
// an in-memory database that enforces the .indexOn rules. The same comparison was run once
// against the 16 Sep 2026 production backup (473 sales, 642 Books entries, 37 closes: all identical).
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createFakeDatabase, rtdbValue} from './helpers/fake-rtdb.mjs';
import {loadFunctions} from './helpers/functions-sandbox.mjs';

const require = createRequire(import.meta.url);
const Costing = require('../functions/lib/costing.js');
const UncostedSales = require('../functions/lib/uncosted-sales.js');
const BooksBridge = require('../functions/lib/books-bridge.js');
const FinancialClose = require('../functions/lib/financial-close.js');
const {trackedRead} = require('../functions/lib/tracked-read.js');
const rules = fs.readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8');
const stable = (v) => JSON.stringify(v, (k, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x);
const day = (d, h = 3) => Date.parse(`${d}T0${h}:00:00+08:00`);

// 1. trackedRead: keyed reads, enumeration fallback, errors while records are missing.
{
  const store = {a: {v: 1}, b: {v: 2}, c: {v: 3}}, log = [];
  const spec = {m: {readKey: async (k) => { log.push(k); return store[k] || null; }, readAll: async () => { log.push('*'); return store; }}};
  const out = await trackedRead(spec, (maps) => { if (!maps.m.a) throw new Error('missing'); return maps.m.a.v + (maps.m.zz ? 100 : 0) + maps.m.b.v; }, {withStats: true});
  assert.equal(out.result, 3);
  assert.deepEqual(log.sort(), ['a', 'b', 'zz'], 'only looked-up keys are read, absent keys included');
  log.length = 0;
  assert.equal(await trackedRead(spec, (maps) => Object.keys(maps.m).length), 3, 'listing the keys reads the map in full');
  assert.deepEqual(log, ['*']);
  await assert.rejects(trackedRead(spec, (maps) => { if (maps.m.a) throw new Error('real failure'); }), /real failure/);
  await assert.rejects(trackedRead(spec, (maps) => { maps.m.a = 1; }), /read-only/);
}

// Synthetic shop: catalog, two shifts, live and archived sales, ledger, custody, payables, payouts.
const unit = (ing) => ({milk: 'ml', bean: 'g', cup12: 'pc', lid: 'pc', hotcup: 'pc'}[ing]);
const row = (ing, s, m, l) => ({ing, unit: unit(ing), stockUnit: unit(ing), qtyS: s, qtyM: m, qtyL: l});
const inventory = {
  milk: {name: 'Milk', unit: 'ml', cost: 0.1, category: 'cat_milk', inventoryAccount: '1210', costAccount: '5010'},
  bean: {name: 'Beans', unit: 'g', cost: 1.4, category: 'cat_coffee', inventoryAccount: '1200', costAccount: '5000'},
  cup12: {name: '12oz Cup', unit: 'pc', cost: 3.9, category: 'cat_packaging', inventoryAccount: '1240', costAccount: '5040'},
  lid: {name: 'Lid', unit: 'pc', cost: 1.2, category: 'cat_packaging', inventoryAccount: '1240', costAccount: '5040'},
  hotcup: {name: 'Hot Cup', unit: 'pc', cost: 5.6, category: 'cat_packaging', inventoryAccount: '1240', costAccount: '5040'},
  unused1: {name: 'Unused', unit: 'g', cost: 9, category: 'cat_other'}, unused2: {name: 'Unused 2', unit: 'g', cost: 9, category: 'cat_other'},
};
const optionGroups = {og_temp: {name: 'Temperature', type: 'single', choices: [{label: 'Hot'}, {label: 'Iced', price: 10}]}, og_other: {name: 'Other', choices: [{label: 'Extra', price: 5}]}};
const menuItems = {
  latte: {name: 'Latte', cat: 'coffee', options: ['og_temp'], price: 120, prices: {S: 110, M: 120, L: 130}},
  americano: {name: 'Americano', cat: 'coffee', price: 90},
  croissant: {name: 'Croissant', cat: 'pastry', price: 80, noRecipe: true},
  unusedItem: {name: 'Unused', cat: 'coffee', price: 1},
};
const recipes = {
  latte: {base: [row('milk', 200, 250, 300), row('bean', 18, 18, 18)], choiceAdd: {og_temp: {Hot: {label: 'Hot', ings: [row('hotcup', 1, 1, 1)]}, Iced: {label: 'Iced', ings: [row('cup12', 1, 1, 1), row('lid', 1, 1, 1)]}}}},
  americano: {base: [row('bean', 18, 18, 18), row('ghost', 1, 1, 1)]},
  unusedRecipe: {base: [row('milk', 1, 1, 1)]},
};
const lines = (key, labels = [], size = 'M', qty = 1) => [{itemKey: key, name: menuItems[key].name, size, qty, optLabels: labels}];
const sale = (id, amount, at, extra = {}) => ({id: `sale_${id}`, type: 'order_sale', sourceType: 'order', sourceId: id, occurredAt: at, postedAt: at, amount, lines: [{account: 'asset:register_cash', debit: amount, credit: 0}, {account: 'revenue:sales', debit: 0, credit: amount}], ...extra});
const data = {
  inventory, optionGroups, menuItems, recipes, availability: {Latte: true}, packages: {},
  packagingRules: {Iced: {rows: [row('lid', 1, 1, 1)]}, Unused: {rows: [row('milk', 1, 1, 1)]}},
  optionRecipes: {},
  posSettings: {fixedFloat: 3000, payMethods: [{name: 'Cash', cash: true}], sharedBaseIngredients: {}, optionCosts: {}, packagingAssignments: {}, invCategories: {cat_packaging: {name: 'Packaging'}, cat_milk: {name: 'Milk'}}, bigUnrelated: {x: 'y'.repeat(4000)}},
  shifts: {
    SH1: {id: 'SH1', openAt: day('2026-09-15', 1), closeAt: day('2026-09-15', 9), status: 'closed', variance: 0},
    SH2: {id: 'SH2', openAt: day('2026-09-16', 1), status: 'open', payOuts: [{id: 'adv1', type: 'purchase_advance', amount: 100, supplierId: 'sup_a'}]},
    SH0: {id: 'SH0', openAt: day('2026-09-14', 1), closeAt: day('2026-09-14', 9), status: 'closed', variance: -20, varianceStatus: 'open'},
  },
  orders: {
    O3: {id: 'O3', status: 'Completed', shiftId: 'SH2', timestamp: day('2026-09-16'), completedAt: day('2026-09-16', 4), total: 130, lineItems: lines('latte', ['Iced']), payments: [{method: 'Cash', amount: 130}], cogsSnapshot: 20},
    O4: {id: 'O4', status: 'Completed', shiftId: 'SH1', timestamp: day('2026-09-15', 8), total: 90, lineItems: lines('americano'), inventoryDeducted: true, cogsSnapshot: 25},
  },
  archivedOrders: {
    O1: {id: 'O1', status: 'Archived', prevStatus: 'Completed', shiftId: 'SH1', timestamp: day('2026-09-15'), completedAt: day('2026-09-15', 4), total: 120, lineItems: lines('latte', ['Hot']), cogsSnapshot: 30, channel: 'instore'},
    O2: {id: 'O2', status: 'Archived', prevStatus: 'Completed', timestamp: day('2026-09-14', 5), completedAt: day('2026-09-15', 2), total: 80, lineItems: lines('croissant'), channel: 'grabfood', settlementStatus: 'unsettled'},
    O4: {id: 'O4', status: 'Archived', prevStatus: 'Completed', shiftId: 'SH1', timestamp: day('2026-09-15', 8), total: 999, lineItems: lines('americano')},
    O5: {id: 'O5', status: 'Archived', prevStatus: 'Completed', shiftId: 'SH0', timestamp: day('2026-09-14', 3), total: 55, lineItems: lines('latte', ['Hot'], 'S', 2)},
    O6: {id: 'O6', status: 'Archived', prevStatus: 'Completed', timestamp: day('2026-09-12'), total: 40, lineItems: lines('americano')},
  },
  financialMovements: {
    sale_O1: sale('O1', 120, day('2026-09-15', 4)), sale_O2: sale('O2', 80, day('2026-09-15', 2), {channel: 'grabfood'}), sale_O5: sale('O5', 55, day('2026-09-15', 1)), sale_O9: sale('O9', 10, day('2026-09-15', 6)),
    dep1: {id: 'dep1', type: 'cash_deposit', sourceType: 'deposit', sourceId: 'dep1', occurredAt: day('2026-09-15', 5), amount: 50, custodyAllocations: {SH1: 50}, lines: [{account: 'asset:cash_account:bank', debit: 50, credit: 0}, {account: 'asset:cash_awaiting_deposit', debit: 0, credit: 50}]},
    dep2: {id: 'dep2', type: 'cash_deposit', sourceType: 'deposit', sourceId: 'dep2', occurredAt: day('2026-09-17', 5), amount: 20, custodyAllocations: {SH1: 20}, lines: [{account: 'asset:cash_account:bank', debit: 20, credit: 0}, {account: 'asset:cash_awaiting_deposit', debit: 0, credit: 20}]},
    ap1: {id: 'ap1', type: 'purchase_ap', sourceType: 'purchaseInvoice', sourceId: 'PI1', occurredAt: day('2026-09-15', 3), lines: [{account: 'coa:1210', debit: 300, credit: 0}, {account: 'liability:payable:ap_PI1', debit: 0, credit: 300}]},
  },
  inventoryMovements: {
    sale_O1_milk: {sourceType: 'order', sourceId: 'O1', type: 'sale_usage', itemId: 'milk', qty: -250, occurredAt: day('2026-09-15', 4)},
    sale_O6_bean: {sourceType: 'order', sourceId: 'O6', type: 'sale_usage', itemId: 'bean', qty: -18, occurredAt: day('2026-09-12')},
    purchase_x: {sourceType: 'purchase', sourceId: 'PI1', type: 'purchase', itemId: 'milk', qty: 1000, occurredAt: day('2026-09-15', 3)},
  },
  purchaseInvoices: {PI1: {date: '2026-09-15', total: 300, supplier: 'Dairy', supplierId: 'sup_a', payMode: 'account', movementIds: ['ap1'], ts: day('2026-09-15', 3), lines: [{itemId: 'milk', total: 300}]}, PI0: {date: '2026-09-10', total: 50, supplier: 'Old', movementIds: ['missing'], ts: day('2026-09-10')}},
  books: {journal: {
    '2026-09-15_instore': {date: '2026-09-15', channel: 'instore', sources: {cogs_O1: true, sale_O1: true}, net: {}},
    '2026-09-16_instore': {date: '2026-09-16', channel: 'instore', sources: {}, net: {}},
    'far_bucket': {date: '2026-08-01', sources: {cogs_O4: true}, net: {}},
    'single_1': {date: '2026-09-01', memo: 'x', lines: [{code: '1011', debit: 1, credit: 0}]},
  }},
  cashCustody: {SH1: {shiftId: 'SH1', remaining: 30, amount: 100, closedAt: day('2026-09-15', 9)}, SH0: {shiftId: 'SH0', remaining: 0, amount: 40, closedAt: day('2026-09-14', 9), recoveries: {r1: {amount: 5, recoveredAt: day('2026-09-16')}}}, recov_x: {shiftId: 'SH9', movementId: 'shift_custody_SH7', remaining: 12, closedAt: day('2026-09-13')}},
  receivables: {R1: {status: 'open', amount: 10}, R2: {status: 'paid', amount: 99}},
  payables: {ap_PI1: {status: 'open', amount: 300, party: 'Dairy', purchaseInvoiceId: 'PI1', supplierId: 'sup_a'}, ap_old: {status: 'paid', amount: 20, party: 'Old', supplierId: ''}, cc1: {status: 'open', type: 'customer_change_refund', amount: 3}},
  pettyCashVouchers: {pv1: {transactionType: 'purchase_advance', status: 'approved', amount: 200, remainingAmount: 150, supplierId: 'sup_a'}, pv2: {transactionType: 'expense', status: 'approved', amount: 20}},
  platformPayouts: {P1: {actualPayout: 70, channel: 'grabfood', owingOutstanding: 0}, P2: {actualPayout: 40, depositMovementId: 'dep9', channel: 'grabfood'}, P3: {actualPayout: 30, reversed: true, depositMovementId: 'dep8', owingOutstanding: 12, channel: 'grabfood'}, P4: {actualPayout: 0, depositMovementId: ''}},
  suppliers: {sup_a: {name: 'Dairy'}},
  stockReceipts: {sr1: {ing: 'milk', supplierId: 'sup_a'}, sr2: {ing: 'bean'}},
  inventoryBatch: {b1: {invoiceId: 'PI1', supplierId: 'sup_a', masterId: 'milk'}, b2: {closed: true, masterId: 'bean'}},
  inventorySku: {s1: {supplierId: 'sup_a'}},
  cfAccounts: {bank: {name: 'Bank', active: true}},
};
const NOW = day('2026-09-16', 6);
const view = rtdbValue(JSON.parse(JSON.stringify(data)));
const db = createFakeDatabase(data, {rules});
const {internal: I} = loadFunctions(db, {now: NOW, expose: ['calculateOrderInventoryPlan', 'buildOrderInventoryPlan', 'readCatalogKeyed', 'priceOrderLinesServer', 'financialCloseInput', 'custodyRowsForShift', 'openCustodyRows', 'touchedCustodyRows', 'supplierAdvanceShiftPayOuts', 'purchaseInventoryLines', 'moveLegacyVoucherReceipts', 'readPosSettings']});

// 2. Sale costing and pricing: identical results, catalog read record by record.
{
  const ps = view.posSettings;
  const catalogBytes = ['recipes', 'inventory', 'menuItems', 'posSettings', 'optionGroups', 'packagingRules'].reduce((s, k) => s + JSON.stringify(view[k]).length, 0);
  for (const [id, order] of Object.entries(Object.assign({}, view.archivedOrders, view.orders))) {
    let before, after;
    try {
      // 24 Sep 2026: sale-time costing never refuses a sale; unusable recipe lines are flagged.
      const costing = UncostedSales.costOrderTolerant({lineItems: order.lineItems, recipes: view.recipes, inventory: view.inventory, menuItems: view.menuItems, sharedBaseIngredients: {}, optionCosts: {}, optionRecipes: {}, optionGroups: view.optionGroups, packagingRules: view.packagingRules, packagingAssignments: {}});
      if (!costing.ok) throw new Error('Authoritative costing rejected order ' + id + ': ' + costing.errors.slice(0, 5).map((r) => r.code + ': ' + r.message).join(' | '));
      before = stable(I.buildOrderInventoryPlan(costing, view.inventory, ps, 7));
    } catch (e) { before = e.message; }
    db.resetReads();
    try { after = stable(await I.calculateOrderInventoryPlan(db, order, 7, id)); } catch (e) { after = e.message; }
    assert.equal(after, before, `costing of ${id} is unchanged`);
    assert.ok(db.bytesRead() < catalogBytes / 2, `costing ${id} read ${db.bytesRead()} bytes, the catalog is ${catalogBytes}`);
    assert.ok(!db.reads.some((r) => r.path === 'inventory' || r.path === 'recipes' || r.path === 'menuItems' || r.path === 'posSettings'), 'no whole catalog node is read');
    let p1, p2;
    try { p1 = stable(I.priceOrderLinesServer(order.lineItems, view.menuItems, view.optionGroups, view.availability, view.packages)); } catch (e) { p1 = e.message; }
    try { p2 = stable(await I.readCatalogKeyed(db, ['menuItems', 'optionGroups', 'packages'], (m) => I.priceOrderLinesServer(order.lineItems, m.menuItems, m.optionGroups, view.availability, m.packages))); } catch (e) { p2 = e.message; }
    assert.equal(p2, p1, `pricing of ${id} is unchanged`);
  }
  {
    // A recipe pointing at a missing item no longer refuses the sale: the line is excluded from
    // stock and cost and recorded for a manager to resolve (24 Sep 2026).
    const plan = await I.calculateOrderInventoryPlan(db, view.orders.O4, 7, 'O4');
    assert.equal(plan.uncostedLines.length, 1, 'the broken-recipe line is flagged');
    assert.equal(plan.uncostedLines[0].reason, 'broken_recipe');
    assert.ok(plan.uncostedLines[0].codes.includes('BROKEN_INVENTORY_REFERENCE'));
    assert.equal(plan.emptyUsage, true, 'no stock is taken for the excluded line');
    assert.equal(plan.totalCost, 0);
    assert.equal(Costing.costOrder({lineItems: view.orders.O4.lineItems, recipes: view.recipes, inventory: view.inventory, menuItems: view.menuItems}).ok, false, 'the costing engine itself still reports the broken recipe');
  }
  db.resetReads();
  const invoiceLines = stable(await I.purchaseInventoryLines(db, view.purchaseInvoices.PI1, false));
  assert.match(invoiceLines, /coa:1210/);
  assert.ok(db.reads.some((r) => r.path === 'inventory/milk') && !db.reads.some((r) => r.path === 'inventory'), 'purchase lines read only their items');
}

// 3. Cash custody: open rows, the rows a write touches, the rows of a shift.
{
  assert.deepEqual(Object.keys(await I.openCustodyRows(db)), ['SH1', 'recov_x'], 'open rows, in database key order');
  assert.deepEqual(Object.keys(await I.touchedCustodyRows(db, {'cashCustody/SH0/remaining': 1, 'cashCustody/NEW': {remaining: 1}, 'financialMovements/x': {}})), ['SH0']);
  assert.deepEqual(Object.keys(await I.custodyRowsForShift(db, 'SH7')), ['recov_x'], 'rows naming the shift custody movement are found');
  assert.deepEqual(Object.keys(await I.custodyRowsForShift(db, 'SH1')), ['SH1']);
  assert.ok(!db.reads.some((r) => r.path === 'cashCustody' && !r.query), 'custody is never read in full here');
}

// 4. Supplier advances held in shifts come from the maintained index.
{
  assert.equal(stable(await I.supplierAdvanceShiftPayOuts(db)), stable({SH2: view.shifts.SH2.payOuts}));
  assert.equal((await db.ref('/supplierAdvanceShiftIndexMeta/complete').get()).val(), true);
  db.resetReads();
  await I.supplierAdvanceShiftPayOuts(db);
  assert.deepEqual(db.reads.map((r) => r.path).sort(), ['shifts/SH2/payOuts', 'supplierAdvanceShiftIndexMeta', 'supplierAdvanceShifts'], 'after the index exists, only indexed shifts are read');
}

// 5. Financial Close: identical reconciliation from bounded inputs.
{
  const nodes = ['orders', 'archivedOrders', 'shifts', 'financialMovements', 'inventoryMovements', 'purchaseInvoices', 'booksJournal', 'cashCustody', 'receivables', 'payables', 'pettyCashVouchers', 'platformPayouts'];
  const strip = (r) => { const x = JSON.parse(JSON.stringify(r)); delete x.shiftStateEvaluatedAt; return stable(x); };
  for (const [closeType, businessDate, shiftId] of [['DAILY_CLOSE', '2026-09-15', ''], ['DAILY_CLOSE', '2026-09-14', ''], ['DAILY_CLOSE', '2026-09-16', ''], ['SHIFT_CLOSE', '2026-09-15', 'SH1'], ['SHIFT_CLOSE', '2026-09-14', 'SH0']]) {
    const full = {closeType, businessDate, shiftId};
    nodes.forEach((n) => { full[n] = n === 'booksJournal' ? view.books.journal : view[n]; });
    const cutoff = (input) => closeType === 'SHIFT_CLOSE' ? Number(input.shifts[shiftId].closeAt || NOW) : Date.parse(`${businessDate}T23:59:59.999+08:00`);
    full.cutoff = cutoff(full);
    db.resetReads();
    const bounded = await I.financialCloseInput(db, closeType, businessDate, shiftId);
    bounded.cutoff = cutoff(bounded);
    assert.equal(strip(FinancialClose.buildClose(bounded)), strip(FinancialClose.buildClose(full)), `${closeType} ${businessDate} ${shiftId} is unchanged`);
    const whole = db.reads.filter((r) => !r.query && !r.path.includes('/')).map((r) => r.path).sort();
    assert.deepEqual(whole.filter((p) => !['shifts', 'supplierAdvanceShifts', 'supplierAdvanceShiftIndexMeta'].includes(p)), ['cashCustody', 'financialMovements'], 'only the ledger and custody are read in full');
  }
}

// 6. Legacy receipt images move out of vouchers only after an exact copy exists.
{
  const img = 'data:image/jpeg;base64,' + 'A'.repeat(64);
  // Above the old 1.5 M-character ceiling. The portal's own proof decoder accepts a 5 MB
  // image, whose base64 form is about 6.7 M characters, so a ceiling that low stranded the
  // largest receipts in /pettyCashVouchers for ever -- and every nightly backup still reads
  // that node in full. The move must not skip a receipt merely for being large.
  const huge = 'data:image/jpeg;base64,' + 'A'.repeat(1_600_000);
  await db.ref('/pettyCashVouchers/pvImg').set({transactionType: 'expense', status: 'approved', amount: 5, receiptImg: img, createdAt: 11});
  await db.ref('/pettyCashVouchers/pvHuge').set({transactionType: 'expense', status: 'approved', amount: 5, receiptImg: huge, createdAt: 12});
  await db.ref('/pettyCashVouchers/pvBad').set({transactionType: 'expense', status: 'approved', amount: 5, receiptImg: 'http://not-inline'});
  await db.ref('/pettyCashReceipts/pvClash').set({meta: {createdAt: 1, bytes: 3}, image: 'data:image/png;base64,QQ=='});
  await db.ref('/pettyCashVouchers/pvClash').set({transactionType: 'expense', amount: 5, receiptImg: img});
  const vouchers = (await db.ref('/pettyCashVouchers').get()).val();
  const result = await I.moveLegacyVoucherReceipts(db, vouchers, 99);
  assert.deepEqual([...result.moved].sort(), ['pvHuge', 'pvImg']);
  assert.deepEqual([...result.kept].sort(), ['pvBad', 'pvClash']);
  assert.equal((await db.ref('/pettyCashReceipts/pvHuge/image').get()).val(), huge, 'a large receipt moves out too');
  assert.equal((await db.ref('/pettyCashReceipts/pvImg/image').get()).val(), img, 'the evidence is intact');
  const moved = (await db.ref('/pettyCashVouchers/pvImg').get()).val();
  assert.equal(moved.receiptImg, undefined); assert.equal(moved.hasReceipt, true);
  assert.equal((await db.ref('/pettyCashVouchers/pvClash/receiptImg').get()).val(), img, 'a conflicting copy leaves the inline image in place');
  assert.ok(Object.keys(db.data().operationalAudit || {}).some((k) => k.endsWith('voucher_receipt_moved_pvImg')), 'the move is audited');
  assert.equal((await I.moveLegacyVoucherReceipts(db, (await db.ref('/pettyCashVouchers').get()).val(), 100)).moved.length, 0, 'running again moves nothing');
}

// 7. The fake database refuses unindexed queries, like a production download would silently do.
assert.throws(() => db.ref('/orders').orderByChild('notIndexed'), /Unindexed/);
console.log('PASS: keyed catalog costing and pricing, custody lookups, indexed supplier advances, bounded Financial Close inputs and the receipt move give identical results with bounded downloads.');
