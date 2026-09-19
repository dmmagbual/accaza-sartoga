// Guards the Firebase download-storm controls found in the 16 Sep 2026 billing investigation:
// 1. every `retry: true` database trigger is bounded (dead letter instead of endless redelivery),
// 2. dead letters are surfaced as critical operational exceptions and stay server-only,
// 3. onOrderFinalize does not re-download the catalog when the sale-time plan already exists,
// 4. non-management sessions never call System Health and failures back off.
import fs from 'node:fs';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const RetryGuard = require('../functions/lib/retry-guard.js');
const {buildOperationalExceptions, DEAD_LETTER_WINDOW_MS} = require('../functions/lib/operational-exceptions.js');
const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const fail = (message) => { throw new Error(message); };

const HOUR = 3600000, now = Date.UTC(2026, 8, 16, 2);
function harness() {
  const letters = [], logs = [];
  const counts = {}, budgets = {};
  const deps = {now: () => now, functionName: () => 'onOrderFinalize', recordDeadLetter: async (key, row) => { letters.push({key, row}); }, logError: (m, c) => logs.push({m, c}),
    countFailure: async (key) => (counts[key] = (counts[key] || 0) + 1), clearFailures: async (key) => { delete counts[key]; },
    recordFunctionFailure: async ({function: fn, day, newEvent}) => { const b = budgets[`${fn}/${day}`] = budgets[`${fn}/${day}`] || {events: 0, failures: 0}; b.events += newEvent ? 1 : 0; b.failures++; return Object.assign({}, b); }};
  return {letters, logs, deps, counts, budgets};
}
const boom = async () => { throw new Error('Inventory movement quantity cannot be zero.'); };
const event = (ageMs) => ({id: 'evt-1', time: new Date(now - ageMs).toISOString(), params: {orderId: 'POS-ZRYDBO'}});

// Inside the retry window: rethrow so the platform retries transient failures.
{
  const h = harness(), handler = RetryGuard.guardRetryHandler('/orders/{orderId}', boom, h.deps);
  let threw = false; try { await handler(event(5 * 60000)); } catch (_e) { threw = true; }
  if (!threw || h.letters.length) fail('A fresh failing event must be rethrown for platform retry and must not be dead-lettered.');
}
// A failing event gets the first delivery plus 10 retries, then it is acknowledged, even when young.
{
  if (RetryGuard.MAX_RETRIES !== 10 || RetryGuard.MAX_ATTEMPTS !== 11) fail('Retried events must stop after 10 retries.');
  const h = harness(), handler = RetryGuard.guardRetryHandler('/orders/{orderId}', boom, h.deps);
  let thrown = 0;
  for (let attempt = 1; attempt <= 11; attempt++) { try { if (await handler(event(60000)) === null && attempt !== 11) fail(`Attempt ${attempt} must still be retried.`); } catch (_e) { thrown++; } }
  if (thrown !== 10 || h.letters.length !== 1 || h.letters[0].row.attempts !== 11) fail('Ten retries are allowed; the eleventh failure is dead-lettered with its attempt count.');
  if (Object.keys(h.counts).length) fail('The failure counter is cleared once the event is dead-lettered.');
}
// A systematic fault: after 20 distinct failed events in a Manila day, the function stops retrying.
{
  if (RetryGuard.MAX_FAILED_EVENTS_PER_DAY !== 20) fail('The daily failure budget must be 20 events per function.');
  const h = harness(), handler = RetryGuard.guardRetryHandler('/financialMovements/{movementId}', boom, h.deps);
  const ev = (i) => ({id: `evt-${i}`, time: new Date(now - 1000).toISOString(), params: {movementId: `m${i}`}});
  let thrown = 0;
  for (let i = 1; i <= 20; i++) { try { await handler(ev(i)); } catch (_e) { thrown++; } }
  if (thrown !== 20 || h.letters.length) fail('The first 20 failing events keep their retries.');
  if (await handler(ev(21)) !== null || h.letters.length !== 1 || h.letters[0].row.functionStopped !== true || h.letters[0].row.failedEventsToday !== 21) fail('The 21st failing event is dead-lettered at once and flagged as a stopped function.');
  if (await handler(ev(3)) !== null || h.letters.length !== 2) fail('Once stopped, retries of earlier events are not attempted again that day.');
  const exceptions = buildOperationalExceptions({deadLetters: {a: h.letters[0].row}}, now);
  const stopped = (exceptions.exceptions || exceptions).find ? (exceptions.exceptions || exceptions).find((x) => x.category === 'background_failure') : null;
  if (!stopped || stopped.severity !== 'critical' || !/stopped for today/.test(stopped.title) || !/More than 20 events/.test(stopped.detail)) fail('A stopped function is raised as one critical System Health item.');
  if (RetryGuard.budgetDay(Date.UTC(2026, 8, 16, 17)) !== '2026-09-17') fail('The budget day follows the Manila calendar.');
}
// If the budget cannot be read, the per-event limit still applies.
{
  const h = harness(); h.deps.recordFunctionFailure = async () => { throw new Error('rtdb unavailable'); };
  const handler = RetryGuard.guardRetryHandler('/x', boom, h.deps);
  let thrown = 0; for (let i = 0; i < 11; i++) { try { await handler(event(60000)); } catch (_e) { thrown++; } }
  if (thrown !== 10 || h.letters.length !== 1) fail('Without the daily budget each event still stops after 10 retries.');
}
// If the counter cannot be written, a young event keeps retrying and the age backstop still applies.
{
  const h = harness(); h.deps.countFailure = async () => { throw new Error('rtdb unavailable'); };
  const handler = RetryGuard.guardRetryHandler('/x', boom, h.deps);
  let threw = false; try { await handler(event(60000)); } catch (_e) { threw = true; }
  if (!threw || h.letters.length) fail('Without a counter a young event must be retried.');
  if (await handler(event(RetryGuard.DEFAULT_MAX_RETRY_AGE_MS + HOUR)) !== null || h.letters.length !== 1) fail('Without a counter an expired event is still dead-lettered.');
}
// Past the retry window: record once, acknowledge, never throw.
{
  const h = harness(), handler = RetryGuard.guardRetryHandler('/orders/{orderId}', boom, h.deps);
  const result = await handler(event(RetryGuard.DEFAULT_MAX_RETRY_AGE_MS + HOUR));
  if (result !== null || h.letters.length !== 1) fail('An expired failing event must be acknowledged and dead-lettered exactly once.');
  const {key, row} = h.letters[0];
  if (!/^[a-f0-9]{40}$/.test(key) || key !== RetryGuard.deadLetterKey('onOrderFinalize', event(RetryGuard.DEFAULT_MAX_RETRY_AGE_MS + HOUR))) fail('Dead-letter keys must be deterministic per function and event.');
  if (row.status !== 'open' || row.function !== 'onOrderFinalize' || row.params.orderId !== 'POS-ZRYDBO' || row.ref !== '/orders/{orderId}' || !/cannot be zero/.test(row.error) || row.abandonedAt !== now) fail('Dead-letter record lost its audit fields.');
  if (!h.logs.length) fail('Abandoning an event must be logged as an error.');
}
// If the audit record cannot be written, keep retrying rather than lose the trail.
{
  const h = harness(); h.deps.recordDeadLetter = async () => { throw new Error('rtdb unavailable'); };
  const handler = RetryGuard.guardRetryHandler('/x', boom, h.deps);
  let threw = false; try { await handler(event(RetryGuard.DEFAULT_MAX_RETRY_AGE_MS + HOUR)); } catch (_e) { threw = true; }
  if (!threw) fail('A dead letter that cannot be written must not acknowledge the event.');
}
// Success passes through untouched; only retry:true registrations are wrapped.
{
  const h = harness(), ok = RetryGuard.guardRetryHandler('/x', async () => 'done', h.deps);
  if (await ok(event(10 * HOUR)) !== 'done' || h.letters.length) fail('Successful handlers must pass through.');
  const seen = [];
  const factory = RetryGuard.wrapTriggerFactory((opts, fn) => { seen.push({opts, fn}); return fn; }, h.deps);
  factory({ref: '/a', retry: true}, boom); factory({ref: '/b'}, boom); factory('/c', boom);
  if (seen[0].fn === boom || seen[1].fn !== boom || seen[2].fn !== boom) fail('Only retry:true triggers may be wrapped.');
}

// The deployed bundle must route every database trigger through the guard.
const functionsIndex = read('functions/index.js');
if ((functionsIndex.match(/require\("firebase-functions\/v2\/database"\)/g) || []).length !== 1 || !functionsIndex.includes('const DatabaseTriggers = require("firebase-functions/v2/database");')) fail('Database trigger factories must be imported once, through the retry guard.');
for (const name of ['onValueUpdated', 'onValueWritten', 'onValueCreated', 'onValueDeleted']) {
  if (!functionsIndex.includes(`const ${name} = RetryGuard.wrapTriggerFactory(DatabaseTriggers.${name}, retryGuardDeps);`)) fail(`${name} is not bounded by the retry guard.`);
}
if (/DatabaseTriggers\.onValue\w+\(/.test(functionsIndex)) fail('A trigger bypasses the retry guard by calling the raw factory.');
const retryTriggers = (functionsIndex.match(/retry:\s*true/g) || []).length;
if (retryTriggers < 20) fail(`Expected the reviewed retry:true trigger set, found ${retryTriggers}.`);

// Turning retry on for an already-deployed function makes `firebase deploy` stop unless that
// function is in the workflow's scoped --force step (PR #499's deploy failed this way on 16 Sep).
// Changing this set is a deliberate release step: update the list below AND, for a function that
// newly retries, add it to the --force line in .github/workflows/deploy-functions.yml.
{
  const marks = [...functionsIndex.matchAll(/exports\.([A-Za-z0-9_]+)\s*=/g)].map((m) => [m[1], m.index]);
  const retrying = marks.filter(([, at], i) => {
    const body = functionsIndex.slice(at, i + 1 < marks.length ? marks[i + 1][1] : functionsIndex.length);
    const arrow = body.indexOf('=>');
    // backupDirtyTrigger(path) registers a retrying trigger (asserted below).
    return /retry:\s*true/.test(body.slice(0, arrow > 0 ? arrow : 400)) || /^exports\.\w+\s*=\s*backupDirtyTrigger\(/.test(body);
  }).map(([name]) => name).sort();
  const reviewed = ['markBackupDirtyActivityLog', 'markBackupDirtyArchivedOrders', 'markBackupDirtyBooksJournal', 'markBackupDirtyCashBalanceApplied', 'markBackupDirtyCfLedger', 'markBackupDirtyFinancialApprovals', 'markBackupDirtyFinancialCommandClaims', 'markBackupDirtyFinancialMovements', 'markBackupDirtyInternalUsage', 'markBackupDirtyInventoryAccounting', 'markBackupDirtyInventoryAdjustments', 'markBackupDirtyInventoryMovements', 'markBackupDirtyOperationalAudit', 'markBackupDirtyOrderInventoryPlans', 'markBackupDirtyPettyCashReceipts', 'markBackupDirtyPlatformPayouts', 'markBackupDirtyPurchaseInvoices', 'markBackupDirtyShifts', 'markBackupDirtyStockReceipts', 'onOrderFinalize', 'onOrderFinancialPosting', 'onOrderInventoryReversal', 'onPettyReplenishmentFinancial', 'onPettyVoucherFinancial', 'onShiftCloseAssurance', 'onShiftCloseFinancial', 'onShiftOpenFinancial', 'onShiftPayInsFinancial', 'onShiftPayOutsFinancial', 'preservePostedOrderOnDelete', 'refreshHistoricalOrderAfterInventoryPlan', 'refreshHistoricalOrderAfterJournal', 'replicateArchivedOrderToFirestore', 'syncCashCustodyPageIndex', 'syncPettyVoucherAttentionIndex', 'syncUndepositedLedgerPageIndex', 'updateBooksMonthlyNet', 'updateCashBalanceSummary', 'updatePublicCatalogVersionOnCategories', 'updatePublicCatalogVersionOnMenuItems', 'updatePublicCatalogVersionOnOptionGroups'];
  if (JSON.stringify(retrying) !== JSON.stringify(reviewed)) fail(`The set of retry:true functions changed (now ${retrying.join(', ')}). A function that newly retries must be added to the scoped --force deploy step in .github/workflows/deploy-functions.yml, or the production deploy fails.`);
  const factory = functionsIndex.slice(functionsIndex.indexOf('function backupDirtyTrigger(path)'), functionsIndex.indexOf('exports.markBackupDirtyArchivedOrders'));
  if (!/retry: true/.test(factory)) fail('backupDirtyTrigger must register retrying triggers.');
  const workflow = read('.github/workflows/deploy-functions.yml');
  for (const name of ['updateBooksMonthlyNet', ...reviewed.filter((n) => n.startsWith('markBackupDirty'))]) if (!workflow.includes(`functions:${name}`)) fail(`${name} newly retries and must be in the scoped --force deploy step.`);
}

// Dead letters are critical, time-boxed, and read with a bounded indexed query.
const exceptions = buildOperationalExceptions({deadLetters: {
  a: {status: 'open', function: 'updateCashBalanceSummary', abandonedAt: now - HOUR, params: {movementId: 'sale_1'}, error: 'Error: boom'},
  b: {status: 'open', function: 'old', abandonedAt: now - DEAD_LETTER_WINDOW_MS - HOUR},
  c: {status: 'resolved', function: 'done', abandonedAt: now - HOUR},
}}, now).exceptions.filter((x) => x.category === 'background_failure');
if (exceptions.length !== 1 || exceptions[0].id !== 'a' || exceptions[0].severity !== 'critical' || !exceptions[0].detail.includes('movementId sale_1')) fail('Open dead letters inside the window must surface as one critical background_failure.');
if (!functionsIndex.includes('db.ref(`/${RetryGuard.DEAD_LETTER_ROOT}`).orderByChild("abandonedAt").startAt(now - OperationalExceptions.DEAD_LETTER_WINDOW_MS).limitToLast(50).get()')) fail('The health scan must read dead letters with a bounded, indexed query.');
const rules = read('database.rules.json');
if (!rules.includes('"functionDeadLetters": { ".indexOn": "abandonedAt", ".read": false, ".write": false }')) fail('functionDeadLetters must be server-only and indexed on abandonedAt.');
if (!read('assets/js/admin/operations-dashboard.js').includes('background_failure:{owner:')) fail('System Health has no guidance for background_failure.');

// onOrderFinalize reads the immutable plan first and skips the catalog when it exists.
const finalize = functionsIndex.slice(functionsIndex.indexOf('exports.onOrderFinalize'), functionsIndex.indexOf('exports.onOrderInventoryReversal'));
// Costing itself reads only the records the order uses (calculateOrderInventoryPlan / readCatalogKeyed).
const planAt = finalize.indexOf('const planSnap = await db.ref(`/orderInventoryPlans/${orderId}`).get();'), catalogAt = finalize.indexOf('calculateOrderInventoryPlan(db,o,capturedAt,orderId)');
if (planAt < 0 || catalogAt < 0 || planAt > catalogAt || !finalize.includes('candidate=hasPlan?null:await calculateOrderInventoryPlan(') || finalize.includes('db.ref("/recipes").get()')) fail('onOrderFinalize must not download the catalog when the sale-time plan already exists.');

// System Health: management-only on the client too, with failure backoff.
const overview = read('assets/js/admin/overview-command.mjs');
for (const marker of ['function systemHealthAllowed(){const authz=window.__accazaAuthz;return !!(authz&&authz.isPrivileged);}', 'if(!systemHealthAllowed())return exceptionData;', 'SYSTEM_HEALTH_FAILURE_BACKOFF_MS', 'exceptionFailedAt=Date.now()']) {
  if (!overview.includes(marker)) fail(`System Health client guard is missing: ${marker}`);
}
console.log(`PASS: ${retryTriggers} retry:true triggers are bounded with audited dead letters; dead letters surface as critical, server-only exceptions; finalization skips catalog re-downloads; System Health is management-only with failure backoff.`);
