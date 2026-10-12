// AP step 0.2 — the legacy supplier link sweep must not run on its own once it has completed.
//
// Finance Books calls manageSupplier({action:'initialize_legacy'}) on sign-in, from two client
// bundles. The sweep links unlinked purchases, vouchers, payables, receipts and batches to a supplier
// master — creating that master from the name on the record when none exists. While the migration was
// incomplete that was the point. Once legacyToMaster.status is "complete" a human has reviewed the
// result, and a later automatic run could only invent masters from names on its own, days later.
//
// So: completed migration + no explicit force => skip, and skip *before* the unlinked scans, so a
// completed workspace pays nothing on sign-in. force:true remains the deliberate Super Admin re-run.
import assert from 'node:assert/strict';
import {createFakeDatabase} from './helpers/fake-rtdb.mjs';
import {loadFunctions} from './helpers/functions-sandbox.mjs';
import {createRequire} from 'node:module';

const realWriteSafety = createRequire(import.meta.url)('../functions/lib/write-safety.js');
const writeSafety = {...realWriteSafety, safeAtomicUpdate: (db, writes) => realWriteSafety.safeAtomicUpdate(db, structuredClone(writes))};

const NOW = Date.parse('2026-10-12T10:00:00+08:00');
const YESTERDAY = NOW - 90000000; // longer ago than the 24-hour throttle

function setup(extra = {}) {
  const db = createFakeDatabase({
    admins: {mgr_uid: 'manager'},
    supplierMigrations: {legacySweepCheckedAt: YESTERDAY},
    ...extra,
  });
  return {db, fx: loadFunctions(db, {now: NOW, libOverrides: {'./lib/write-safety': writeSafety}}).exports};
}
const req = (data) => ({auth: {uid: 'mgr_uid', token: {email: 'manager@example.test'}}, data});

// 1. A completed migration is never swept again on sign-in, and the unlinked scans do not run.
{
  const {db, fx} = setup({supplierMigrations: {legacySweepCheckedAt: YESTERDAY, legacyToMaster: {status: 'complete', completedAt: YESTERDAY, linkedWrites: 527}}});
  db.resetReads();
  const result = await fx.manageSupplier(req({action: 'initialize_legacy'}));
  assert.equal(result.skipped, true, 'a completed legacy migration must be skipped');
  assert.equal(result.reason, 'migration_complete', 'the skip must say why');
  assert.equal(result.linkedWrites, 0);
  const swept = db.reads.filter((read) => /^purchaseInvoices|^pettyCashVouchers|^payables|^stockReceipts|^inventoryBatch/.test(read.path));
  assert.equal(swept.length, 0, 'a completed migration must not pay for the unlinked scans on sign-in');
  assert.equal((await db.ref('supplierMigrations/legacySweepCheckedAt').get()).val(), YESTERDAY, 'a skipped sweep must not consume the once-a-day window either');
}

// 2. An explicit force run still sweeps: it is the deliberate Super Admin route.
{
  const {db, fx} = setup({
    supplierMigrations: {legacySweepCheckedAt: YESTERDAY, legacyToMaster: {status: 'complete', completedAt: YESTERDAY, linkedWrites: 527}},
    purchaseInvoices: {pinv_legacy: {id: 'pinv_legacy', supplier: 'Ice Plant', total: 500, date: '2026-09-01'}},
  });
  const result = await fx.manageSupplier(req({action: 'initialize_legacy', force: true}));
  assert.equal(result.skipped, undefined, 'an explicit force run must sweep');
  // One link is four writes: the supplier master, its name index, the record's supplierId and its
  // preserved display name.
  assert.equal(result.linkedWrites, 4, 'the unlinked purchase is linked and its master created');
  const purchase = (await db.ref('purchaseInvoices/pinv_legacy').get()).val() || {};
  assert.ok(purchase.supplierId, 'the unlinked purchase receives a stable supplier id');
  assert.equal(purchase.supplier, 'Ice Plant', 'the human-readable supplier name is preserved');
  const migration = (await db.ref('supplierMigrations/legacyToMaster').get()).val() || {};
  assert.equal(migration.status, 'complete');
  assert.equal(migration.linkedWrites, 4, 'the completion record reflects the forced sweep');
}

// 3. While the migration is incomplete the daily sweep still runs, so nothing is stranded.
{
  const {db, fx} = setup({
    purchaseInvoices: {pinv_open: {id: 'pinv_open', supplier: 'Shopee', total: 250, date: '2026-09-02'}},
  });
  const result = await fx.manageSupplier(req({action: 'initialize_legacy'}));
  assert.equal(result.skipped, undefined, 'an incomplete migration must still sweep');
  assert.equal(result.linkedWrites, 4, 'one legacy row links with its master and name index');
  const purchase = (await db.ref('purchaseInvoices/pinv_open').get()).val() || {};
  assert.ok(purchase.supplierId, 'unlinked legacy rows are still linked while the migration is open');
  assert.equal((await db.ref('supplierMigrations/legacyToMaster/status').get()).val(), 'complete', 'the completion record is written when the sweep does work');
}

// 4. A sweep inside the 24-hour window is still throttled, whatever the migration state.
{
  const {db, fx} = setup({supplierMigrations: {legacySweepCheckedAt: NOW - 60000}});
  const result = await fx.manageSupplier(req({action: 'initialize_legacy'}));
  assert.equal(result.skipped, true, 'the once-a-day throttle still applies');
  assert.equal(result.reason, undefined, 'the throttle skip keeps its original shape');
}

console.log('PASS: the legacy supplier sweep stops on its own once complete, sweeps on explicit force, and still links while the migration is open.');
