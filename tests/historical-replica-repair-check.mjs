// Historical replica dead letters repair themselves (15 Oct 2026).
// 21 orders dead-lettered in replicateArchivedOrderToFirestore (Firestore ABORTED
// contention on the shared monthly summary). The trigger had no probe, so a card
// could only be closed by a note, which closed the alert but left the sale missing
// from Sales History and the monthly summary. This check guards:
// 1. which dead letters are repairable and how they are queued,
// 2. the health-scan repair: one order at a time, bounded, closes every letter of
//    a repaired order, leaves failed or still-live orders open,
// 3. the source sync never removes the copy of a sale that is still live,
// 4. Mark resolved repairs before closing, the card text is honest, and the three
//    replica triggers are capped.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const R = require('../functions/lib/dead-letter-resolution.js');
const {buildOperationalExceptions} = require('../functions/lib/operational-exceptions.js');
const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const built = read('functions/index.js');
const src = read('src/functions/20-portal-operations.js') + read('src/functions/61-historical-archive.js');

const now = Date.UTC(2026, 9, 14, 16), WINDOW = 7 * 86400000;
const letter = (fn, params, extra) => Object.assign({function: fn, params, status: 'open', abandonedAt: now - 3600000, attempts: 1, functionStopped: true, failedEventsToday: 48, error: 'Error: 10 ABORTED: Aborted due to cross-transaction contention.'}, extra || {});

// 1. Repairable set and queue.
assert.deepEqual(R.replicaRepairFor(letter('replicateArchivedOrderToFirestore', {orderId: 'POS-0YP3Z5'})), {id: 'POS-0YP3Z5'});
assert.deepEqual(R.replicaRepairFor(letter('refreshHistoricalOrderAfterInventoryPlan', {orderId: 'POS-0LITL3'})), {id: 'POS-0LITL3'});
assert.equal(R.replicaRepairFor(letter('refreshHistoricalOrderAfterJournal', {journalId: 'J1'})), null, 'the journal-keyed refresh stays manual');
assert.equal(R.replicaRepairFor(letter('onOrderFinalize', {orderId: 'POS-1'})), null, 'posting tasks are never auto-repaired by the replica path');
assert.equal(R.replicaRepairFor(letter('replicateArchivedOrderToFirestore', {orderId: '../admins'})), null, 'order IDs are validated before they become database paths');
assert.equal(R.probeFor(letter('replicateArchivedOrderToFirestore', {orderId: 'POS-0YP3Z5'})), null, 'replica repair does not masquerade as a field probe');

const letters = {
  a: letter('replicateArchivedOrderToFirestore', {orderId: 'POS-B'}, {abandonedAt: now - 1000}),
  b: letter('replicateArchivedOrderToFirestore', {orderId: 'POS-A'}, {abandonedAt: now - 5000}),
  c: letter('replicateArchivedOrderToFirestore', {orderId: 'POS-B'}, {abandonedAt: now - 9000}),
  d: letter('replicateArchivedOrderToFirestore', {orderId: 'POS-C'}, {status: 'resolved'}),
  e: letter('replicateArchivedOrderToFirestore', {orderId: 'POS-D'}, {abandonedAt: now - WINDOW - 1}),
  f: letter('onOrderFinalize', {orderId: 'POS-E'}),
};
const queue = R.replicaRepairQueue(letters, now, WINDOW);
assert.deepEqual(queue.map((g) => [g.orderId, g.ids.sort()]), [['POS-B', ['a', 'c']], ['POS-A', ['b']]], 'one entry per order, oldest first, open and in-window only');
assert.match(R.replicaRepairText('POS-A', {state: 'rebuilt'}), /rebuilt from the saved order/);
assert.match(R.replicaRepairText('POS-A', {state: 'current'}), /confirmed current/);
assert.ok(R.MAX_REPAIR_PER_SCAN > 0 && R.MAX_REPAIR_PER_SCAN <= 25 && R.REPAIR_TIME_BUDGET_MS <= 15000, 'repair stays bounded inside the 60s scan');

// Extract one top-level function from the built bundle and run it in a sandbox.
function extract(name) {
  const start = built.indexOf(`async function ${name}(`);
  assert.ok(start >= 0, `${name} is missing from functions/index.js`);
  const end = built.indexOf('\n}\n', start);
  return built.slice(start, end + 3);
}

// 2. Health-scan repair behaviour.
{
  let active = 0, peak = 0;
  const synced = [], closed = [], warnings = [];
  const outcomes = {'POS-A': {state: 'rebuilt', closable: true}, 'POS-B': 'throw', 'POS-L': {state: 'not_archived', closable: false}, 'POS-R': {state: 'current', closable: true}, 'POS-M': {state: 'source_missing', closable: false}};
  const ctx = {
    DeadLetterResolution: R, OperationalExceptions: {DEAD_LETTER_WINDOW_MS: WINDOW}, Date, Object, String, logger: {warn: (m, d) => warnings.push(d)},
    getFirestore: () => ({}),
    syncHistoricalReplicaFromSource: async (db, fs, orderId) => {
      active++; peak = Math.max(peak, active); synced.push(orderId);
      await new Promise((r) => setTimeout(r, 2)); active--;
      if (outcomes[orderId] === 'throw') throw new Error('10 ABORTED');
      return outcomes[orderId];
    },
    closeDeadLetter: async (db, id, fields) => { closed.push([id, fields.resolution, fields.resolutionEvidence.state]); return true; },
  };
  vm.createContext(ctx); vm.runInContext(extract('repairHistoricalReplicaDeadLetters'), ctx);
  const dl = {
    x1: letter('replicateArchivedOrderToFirestore', {orderId: 'POS-A'}, {abandonedAt: now - 4000}),
    x2: letter('replicateArchivedOrderToFirestore', {orderId: 'POS-A'}, {abandonedAt: now - 3000}),
    x3: letter('replicateArchivedOrderToFirestore', {orderId: 'POS-B'}, {abandonedAt: now - 2000}),
    x4: letter('refreshHistoricalOrderAfterInventoryPlan', {orderId: 'POS-L'}, {abandonedAt: now - 1500}),
    x5: letter('replicateArchivedOrderToFirestore', {orderId: 'POS-R'}, {abandonedAt: now - 1000}),
    x7: letter('replicateArchivedOrderToFirestore', {orderId: 'POS-M'}, {abandonedAt: now - 500}),
    x6: letter('onOrderFinalize', {orderId: 'POS-F'}),
  };
  await ctx.repairHistoricalReplicaDeadLetters({}, dl, now);
  assert.equal(peak, 1, 'orders are repaired one at a time so the repair never contends with itself');
  assert.deepEqual(synced, ['POS-A', 'POS-B', 'POS-L', 'POS-R', 'POS-M']);
  assert.deepEqual(closed.map((c) => c[0]).sort(), ['x1', 'x2', 'x5'], 'every letter of a repaired order closes; failed, still-live and source-missing orders stay open');
  assert.equal(dl.x7.status, 'open');
  assert.ok(closed.every((c) => c[1] === 'verified_complete'), 'repairs close as server-verified');
  assert.equal(dl.x1.status, 'resolved'); assert.equal(dl.x3.status, 'open'); assert.equal(dl.x4.status, 'open');
  assert.equal(warnings.length, 1, 'a failed repair is logged, never thrown into the health scan');

  // Bounded by count.
  synced.length = 0;
  const many = {};
  for (let i = 0; i < R.MAX_REPAIR_PER_SCAN + 7; i++) many[`m${i}`] = letter('replicateArchivedOrderToFirestore', {orderId: `POS-N${i}`}, {abandonedAt: now - 100000 + i});
  ctx.syncHistoricalReplicaFromSource = async (db, fs, orderId) => { synced.push(orderId); return {state: 'current', closable: true}; };
  await ctx.repairHistoricalReplicaDeadLetters({}, many, now);
  assert.equal(synced.length, R.MAX_REPAIR_PER_SCAN, 'a backlog is worked through over several scans');
  assert.equal(synced[0], 'POS-N0', 'oldest first');
}

// 3. Source sync: copies the archived order, never deletes a replica.
{
  const calls = [];
  const ref = (values) => (path) => ({get: async () => ({val: () => values[path] === undefined ? null : values[path], exists: () => values[path] !== undefined && values[path] !== null})});
  const ctx = {
    replicateHistoricalOrder: async (db, fs, id, order, now, options) => { calls.push(['replicate', id, options && options.publishUnchanged]); return {duplicate: id === 'SAME', verified: true}; },
    removeHistoricalReplica: async (db, fs, id) => { calls.push(['remove', id]); },
    Date,
  };
  vm.createContext(ctx); vm.runInContext(extract('syncHistoricalReplicaFromSource'), ctx);
  const sync = (values, id) => ctx.syncHistoricalReplicaFromSource({ref: ref(values)}, {}, id);
  const plain = (value) => JSON.parse(JSON.stringify(value));
  assert.deepEqual(plain(await sync({'/archivedOrders/NEW': {status: 'Completed'}}, 'NEW')), {state: 'rebuilt', closable: true, verified: true, issues: []});
  assert.deepEqual(plain(await sync({'/archivedOrders/SAME': {status: 'Completed'}}, 'SAME')), {state: 'current', closable: true, verified: true, issues: []});
  assert.deepEqual(plain(await sync({'/orders/LIVE/status': 'Preparing'}, 'LIVE')), {state: 'not_archived', closable: false});
  assert.deepEqual(plain(await sync({'/orders/NOSTATUS/id': 'NOSTATUS'}, 'NOSTATUS')), {state: 'not_archived', closable: false}, 'a live order without a status yet is still live');
  assert.deepEqual(plain(await sync({}, 'GONE')), {state: 'source_missing', closable: false}, 'a missing source is left for a person, never auto-deleted');
  assert.deepEqual(calls, [['replicate', 'NEW', true], ['replicate', 'SAME', true]], 'the repair never deletes a replica');
}

// 4. Card text, Mark resolved and trigger caps.
const scan = buildOperationalExceptions({deadLetters: {r: Object.assign({id: 'r'}, letter('replicateArchivedOrderToFirestore', {orderId: 'POS-0YP3Z5'})), p: Object.assign({id: 'p'}, letter('onOrderFinalize', {orderId: 'POS-1'}))}}, now).exceptions.filter((x) => x.category === 'background_failure');
const text = (card) => JSON.stringify(card);
const replicaCard = scan.find((x) => text(x).includes('POS-0YP3Z5')), postingCard = scan.find((x) => text(x).includes('POS-1'));
assert.ok(replicaCard && postingCard, 'both cards appear');
assert.match(text(replicaCard), /Finance Books are not affected/);
assert.match(text(replicaCard), /closes this card itself/);
assert.doesNotMatch(text(replicaCard), /not retried until tomorrow/);
assert.match(text(postingCard), /controlled repair workflow/, 'posting tasks keep their manual repair instruction');

for (const marker of [
  'await repairHistoricalReplicaDeadLetters(db, deadLetters, now);\n    await verifyOpenDeadLetters(db, deadLetters, now);',
  'const replica = DeadLetterResolution.replicaRepairFor(row);',
  'result = await syncHistoricalReplicaFromSource(db, getFirestore(), replica.id);',
  'await removeHistoricalReplica(db, firestore, orderId, now);\n      return;',
  'const HISTORICAL_REPLICA_MAX_INSTANCES = 2;',
  'const HISTORICAL_REPLICA_CONCURRENCY = 1;',
  'if (result.state === "not_archived") throw new HttpsError("failed-precondition"',
]) {
  assert.ok(src.includes(marker), `server source is missing ${marker}`);
  assert.ok(built.includes(marker), `functions/index.js is missing ${marker}; run npm run build:runtime`);
}
for (const ref of ['/archivedOrders/{orderId}', '/books/journal/{journalId}', '/orderInventoryPlans/{orderId}']) {
  assert.ok(built.includes(`{ref: "${ref}", region: ORDER_REGION, retry: true, maxInstances: HISTORICAL_REPLICA_MAX_INSTANCES, concurrency: HISTORICAL_REPLICA_CONCURRENCY}`), `${ref} replica trigger must be capped`);
}
assert.ok(built.indexOf('const HISTORICAL_REPLICA_MAX_INSTANCES') < built.indexOf('exports.replicateArchivedOrderToFirestore'), 'the cap must be defined before the first trigger uses it');
assert.match(built, /exports\.getOperationalExceptions = onCall\(\n\s*\{region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 60/, 'the forced scan has room for its bounded repair');

console.log('Historical replica self-repair checks passed.');
