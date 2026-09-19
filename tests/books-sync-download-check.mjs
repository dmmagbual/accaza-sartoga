// Books "Sync all Finance transactions" download cost (17 Sep 2026 download audit).
//
// One Sync runs ensureFinancialLedger then ensureBooksJournal. On 16 Sep 2026 each Sync cost
// about 40 MB of Realtime Database downloads, mostly because the rebuild re-wrote every
// journal entry (each write fires three triggers and reaches every open journal listener) and
// re-read whole ledgers it already held. This check runs the real Functions bundle against an
// in-memory database and proves that:
//   - a repeat Sync with nothing new writes no journal entry and re-reads nothing it holds;
//   - the rebuilt journal is identical either way;
//   - the ledger backfill skips existence reads for movements it already downloaded;
//   - the historical internal-usage repair reads usage reversals through the type index;
//   - a journal write that changes neither date nor net reads nothing for the monthly totals;
//   - the Books daily mirrors stamp updatedAt inside the one write.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createFakeDatabase} from './helpers/fake-rtdb.mjs';
import {loadFunctions} from './helpers/functions-sandbox.mjs';

const rules = fs.readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8');
const at = (d, h = 3) => Date.parse(`${d}T${String(h).padStart(2, '0')}:00:00+08:00`);
const saleMovement = (id, amount, when) => ({id: `sale_${id}`, type: 'order_sale', sourceType: 'order', sourceId: id, occurredAt: when, postedAt: when, amount,
  lines: [{account: 'asset:register_cash', debit: amount, credit: 0}, {account: 'revenue:sales', debit: 0, credit: amount}]});
const order = (id, total, when) => ({id, total, subtotal: total, status: 'Completed', paymentStatus: 'paid', payment: 'Cash', channel: 'instore', timestamp: when, completedAt: when,
  items: [{name: 'Latte', qty: 1, price: total}], payments: [{method: 'Cash', amount: total}]});

function world() {
  const orders = {}, archivedOrders = {}, financialMovements = {};
  [['POS-A1', 120, at('2026-09-14')], ['POS-A2', 90, at('2026-09-14', 5)], ['POS-B1', 150, at('2026-09-15')]].forEach(([id, total, when]) => {
    archivedOrders[id] = Object.assign(order(id, total, when), {status: 'Archived', prevStatus: 'Completed'});
  });
  orders['POS-C1'] = order('POS-C1', 110, at('2026-09-16'));
  for (const [id, o] of Object.entries(Object.assign({}, archivedOrders, orders))) financialMovements[`sale_${id}`] = saleMovement(id, o.total, o.completedAt);
  financialMovements.opening_cash_acc1 = {id: 'opening_cash_acc1', type: 'opening_balance', sourceType: 'cashAccount', sourceId: 'acc1', occurredAt: at('2026-08-01'), postedAt: at('2026-08-01'),
    lines: [{account: 'asset:cash_account:acc1', debit: 500, credit: 0}, {account: 'equity:opening_balance', debit: 0, credit: 500}]};
  return {
    admins: {owner: 'owner'},
    cfAccounts: {acc1: {name: 'Security Bank 4538', type: 'bank', opening: 500, openingDate: '2026-08-01'}, acc2: {name: 'Security Bank 4389', type: 'bank', opening: 0}},
    orders, archivedOrders, financialMovements,
    inventory: {milk: {name: 'Milk', unit: 'ml', cost: 0.1, inventoryAccount: '1210', costAccount: '5010'}},
    inventoryMovements: {
      use1: {id: 'use1', type: 'staff_use', itemId: 'milk', qty: -10, sourceType: 'internal-usage', occurredAt: at('2026-09-10'), createdAt: at('2026-09-10')},
      rev1: {id: 'rev1', type: 'usage_reversal', reversalOf: 'use1', itemId: 'milk', itemName: 'Milk', qty: 10, occurredAt: at('2026-09-11'), createdAt: at('2026-09-11')},
      sale_POS_A1_milk: {id: 'sale_POS_A1_milk', type: 'sale', itemId: 'milk', qty: -200, sourceType: 'order', sourceId: 'POS-A1', occurredAt: at('2026-09-14'), createdAt: at('2026-09-14')},
    },
    shifts: {SH0: {id: 'SH0', status: 'closed', staff: 'Cashier', openAt: at('2026-09-14', 1), closeAt: at('2026-09-14', 9), variance: 0, shiftReference: 'SHIFT-20260914-01',
      payIns: [{amount: 50, ts: at('2026-09-14', 2), reason: 'Change fund', by: 'Cashier'}]}},
    posSettings: {fixedFloat: 4000, invCategories: {}},
    posActiveShift: {id: 'SH1', openingFloat: 4000},
  };
}
// The 2 Security Bank drawings and the internal-usage original are posted on the first Sync.
function seedUsageOriginal(db) {
  return db.ref('/financialMovements/invmove_use1').set({id: 'invmove_use1', type: 'inventory_staff_use', sourceType: 'inventoryMovement', sourceId: 'use1', occurredAt: at('2026-09-10'), postedAt: at('2026-09-10'), usageAccount: '6077',
    lines: [{account: 'expense:staff_use', debit: 1, credit: 0}, {account: 'asset:inventory:milk', debit: 0, credit: 1}]});
}

const db = createFakeDatabase(world(), {rules});
await seedUsageOriginal(db);
// Records built inside the VM realm are not host-realm plain objects, which the write-safety
// guard rejects; this check is about downloads, so it writes through the fake directly.
const WriteSafety = (await import('node:module')).createRequire(import.meta.url)('../functions/lib/write-safety.js');
const libOverrides = {'./lib/write-safety': Object.assign({}, WriteSafety, {safeAtomicUpdate: (target, writes) => target.ref().update(JSON.parse(JSON.stringify(writes)))})};
const {exports: fx} = loadFunctions(db, {libOverrides});
const request = {auth: {uid: 'owner', token: {email: 'owner@example.test'}}, data: {}};
const wholeReads = (from, path) => db.reads.slice(from).filter((r) => r.path === path && !r.query).length;
const readsOf = (from, test) => db.reads.slice(from).filter(test);

// First Sync: posts what is missing and builds the journal.
await fx.ensureFinancialLedger(request);
const first = await fx.ensureBooksJournal(request);
assert.ok(first.journalWrites > 0, 'the first Sync builds the journal');
const journalAfterFirst = JSON.stringify((await db.ref('/books/journal').get()).val());
const netAfterFirst = JSON.stringify((await db.ref('/books/monthlyNet').get()).val());
assert.ok((await db.ref('/financialMovements/invmove_rev1').get()).exists(), 'the historical usage reversal is posted from the indexed read');
assert.ok(Object.keys((await db.ref('/financialMovements').get()).val()).some((k) => k.startsWith('shift_payin_SH0_')), 'the shift pay-in is posted from the shift already downloaded');

// Second Sync with nothing new.
let mark = db.reads.length;
const ledger = await fx.ensureFinancialLedger(request);
assert.equal(ledger.posted, 0, 'nothing new to post');
assert.equal(wholeReads(mark, 'financialMovements'), 1, 'the ledger backfill downloads the ledger once when it posts nothing (was three times)');
assert.equal(readsOf(mark, (r) => /^financialMovements\/sale_/.test(r.path) && !r.query).length, 0, 'already-posted sales are not re-read one by one');
assert.equal(readsOf(mark, (r) => /^shifts\/./.test(r.path)).length, 0, 'shifts already downloaded are not re-read one by one');

mark = db.reads.length;
const second = await fx.ensureBooksJournal(request);
assert.equal(second.journalWrites, 0, 'an unchanged rebuild writes no journal entry');
assert.ok(second.journalUnchanged > 0);
assert.equal(wholeReads(mark, 'books/journal'), 1, 'the journal is downloaded once when the rebuild changed nothing');
assert.equal(wholeReads(mark, 'inventoryMovements'), 0, 'the internal-usage repair no longer downloads the whole stock ledger');
assert.ok(readsOf(mark, (r) => r.path === 'inventoryMovements' && r.query && r.query.field === 'type').length === 1, 'usage reversals are read through the type index');
assert.equal(JSON.stringify((await db.ref('/books/journal').get()).val()), journalAfterFirst, 'the journal is identical after a repeat Sync');
assert.equal(JSON.stringify((await db.ref('/books/monthlyNet').get()).val()), netAfterFirst, 'the monthly totals are identical after a repeat Sync');

// A new sale is picked up by the next Sync, which then writes only that day's entry.
await db.ref('/orders/POS-C2').set(order('POS-C2', 75, at('2026-09-16', 6)));
await db.ref('/financialMovements/sale_POS-C2').set(saleMovement('POS-C2', 75, at('2026-09-16', 6)));
const third = await fx.ensureBooksJournal(request);
assert.equal(third.journalWrites, 1, 'only the changed day entry is written');
const day = Object.values((await db.ref('/books/journal').get()).val()).find((e) => e.sources && e.sources['sale_POS-C2']);
assert.ok(day && day.net, 'the new sale is in its daily entry');

// Monthly totals: a journal write that changes neither date nor net reads nothing.
{
  const {internal} = loadFunctions(db, {expose: ['applyBooksMonthlyDelta'], libOverrides});
  const entry = {date: '2026-09-16', net: {1000: 75, 4000: -75}, sources: {a: true}};
  mark = db.reads.length;
  await internal.applyBooksMonthlyDelta(db, entry, Object.assign({}, entry, {updatedAt: Date.now()}));
  assert.equal(db.reads.length, mark, 'an updatedAt-only write reads nothing');
  await internal.applyBooksMonthlyDelta(db, entry, Object.assign({}, entry, {net: {1000: 80, 4000: -80}}));
  assert.ok(db.reads.length > mark, 'a changed net recomputes the day');
}

// The daily mirrors stamp updatedAt in the same write and abort when already applied.
{
  const bridge = fs.readFileSync(new URL('../src/functions/10-books-bridge.js', import.meta.url), 'utf8');
  assert.ok(!bridge.includes('child("updatedAt").set('), 'no second updatedAt write after a daily Books posting');
  assert.equal((bridge.match(/next === undefined \? undefined : Object\.assign\(next, \{updatedAt: Date\.now\(\)\}\)/g) || []).length, 2, 'both daily mirrors fold updatedAt into the transaction');
}

// The suspense-to-advance stamp survives a rebuild of the entry.
{
  const BooksBridge = (await import('node:module')).createRequire(import.meta.url)('../functions/lib/books-bridge.js');
  const built = BooksBridge.buildSingle({id: 'mj1', type: 'manual_books_journal', sourceId: 'mj1', occurredAt: at('2026-09-01'), supplierAdvanceConversionId: 'conv_1', lines: [{account: 'asset:suspense', debit: 10, credit: 0}, {account: 'asset:register_cash', debit: 0, credit: 10}]}, {}, {}).entry;
  assert.equal(built.supplierAdvanceConversionId, 'conv_1', 'a rebuilt journal entry keeps its conversion stamp');
}
console.log(`PASS: a repeat Books Sync writes ${second.journalWrites} journal entries (first Sync wrote ${first.journalWrites}), downloads each ledger once, and reads usage reversals by index; no-op journal writes read nothing.`);
