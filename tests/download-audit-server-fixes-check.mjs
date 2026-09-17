// Server-side 17 Sep 2026 download-audit fixes.
//
// F-4 (backup coverage): the daily incremental backup now tracks the five money-adjacent
// nodes that had a full daily read but no restore coverage. A tracked-set change must force
// one FULL backup so the newly tracked history is captured from day one.
// F-5 (POS health pings): a health ping per active till per minute made the portal-role
// lookup and the open-shift read cost 2-3 reads per call. reportPosDeviceHealth memoizes the
// role (5 minutes per uid) and the open-shift row (60 seconds while the reported shift still
// matches); a ping for a different shift always reads fresh. Shift-close readiness keeps its
// uncached reads.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {loadFunctions} from './helpers/functions-sandbox.mjs';
import {createFakeDatabase} from './helpers/fake-rtdb.mjs';

const require = createRequire(import.meta.url);
const BackupDelta = require('../functions/lib/backup-delta.js');

// ── F-4: backup coverage grows, and the first run after the change is a full backup ──
for (const node of ['stockReceipts', 'purchaseInvoices', 'platformPayouts', 'internalUsage', 'inventoryAdjustments']) {
  assert.ok(BackupDelta.TRACKED_PATHS.includes(node), `backup must now track ${node}`);
}
assert.ok(BackupDelta.TRACKED_PATHS.includes('pettyCashReceipts'), 'previously tracked nodes stay tracked');
const now = Date.now();
const recentBase = {takenAt: now - 3600000};
const previousList = BackupDelta.TRACKED_PATHS.filter((p) => !['stockReceipts', 'purchaseInvoices', 'platformPayouts', 'internalUsage', 'inventoryAdjustments'].includes(p));
assert.equal(BackupDelta.needsFullBackup({base: recentBase, now, lastMode: 'incremental', lastTracked: previousList}), 'tracked_changed', 'a tracked-set change forces a full backup');
assert.equal(BackupDelta.needsFullBackup({base: recentBase, now, lastMode: 'incremental', lastTracked: BackupDelta.TRACKED_PATHS}), '', 'no forced full backup once the new list is recorded');
const bundle = fs.readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
for (const name of ['markBackupDirtyStockReceipts', 'markBackupDirtyPurchaseInvoices', 'markBackupDirtyPlatformPayouts', 'markBackupDirtyInternalUsage', 'markBackupDirtyInventoryAdjustments']) {
  assert.ok(bundle.includes(`exports.${name} = backupDirtyTrigger(`), `bundle exports the dirty trigger ${name}`);
}

// ── F-5: the health stop-watch path pays its reads once per TTL window, not once a minute ──
const db = createFakeDatabase({
  admins: {u1: {role: 'cashier', name: 'Cashier One'}},
  adminPerms: {u1: {pos: true}},
  sessionControl: {cutoff: {at: 0}},
  posActiveShift: {id: 'SH1', staff: 'Cashier One', staffId: 'u1', status: 'open'},
});
const fns = loadFunctions(db);
const ping = (shiftId) => fns.exports.reportPosDeviceHealth({auth: {uid: 'u1'}, data: {shiftId, deviceId: 'pos_a', pending: 0, syncing: 0, failed: 0, idle: false}});

await ping('SH1');
const firstCallReads = db.reads.map((r) => r.path);
assert.ok(firstCallReads.some((p) => p === 'admins/u1'), 'the first ping reads the portal role');
assert.ok(firstCallReads.some((p) => p === 'adminPerms/u1'), 'the first ping reads the role grants');
assert.ok(firstCallReads.some((p) => p === 'posActiveShift'), 'the first ping reads the open shift');

db.resetReads();
await ping('SH1');
await ping('SH1');
assert.equal(db.reads.length, 0, `steady-state pings read nothing (got ${db.reads.map((r) => r.path).join(', ') || 'none'})`);

// A ping for a DIFFERENT shift must hit the database again even inside the TTL: a newly
// opened or closed shift can never be answered from the memo.
db.resetReads();
let rejected = null;
try { await ping('SH2'); } catch (error) { rejected = error; }
assert.ok(rejected && rejected.code === 'failed-precondition', 'a ping against another shift is refused');
assert.ok(db.reads.some((r) => r.path === 'posActiveShift'), 'a shift change reads the open shift fresh');

// The memo refreshed itself with that fresh read, so the next same-shift ping is free again.
db.resetReads();
await ping('SH1');
assert.equal(db.reads.filter((r) => r.path === 'posActiveShift').length, 0, 'the refreshed shift memo serves the next ping');

// The written health row keeps its schema.
const health = (await db.ref('/posDeviceHealth/SH1/pos_a').get()).val();
db.resetReads();
assert.equal(health.schemaVersion, 2, 'the health row schema is unchanged');
assert.equal(health.shiftId, 'SH1', 'the health row is filed under the reported shift');

console.log('Audit server fixes: backup tracks the five ledgers with a forced full run; the POS health ping reads once per TTL.');
