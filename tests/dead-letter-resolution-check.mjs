// Background-task dead letters close only on evidence (25 Sep 2026).
// POS-DZQN35 and POS-CFRIGZ stayed critical in System Health after the stuck sales
// were repaired, because nothing ever closed a dead letter. This check guards:
// 1. the verified close only fires when the linked order proves completion,
// 2. a manual close needs a real note and is refused while the order is still incomplete,
// 3. closing is idempotent and removes the card from the saved scan,
// 4. server, client, manifest and UI are wired together.
import fs from 'node:fs';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const R = require('../functions/lib/dead-letter-resolution.js');
const {buildOperationalExceptions} = require('../functions/lib/operational-exceptions.js');
const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const fail = (message) => { throw new Error(message); };

const now = Date.UTC(2026, 8, 25, 2);
const letter = (fn, params, extra) => Object.assign({function: fn, params, status: 'open', abandonedAt: now - 2 * 86400000, attempts: 11, error: 'Error: Immutable server inventory plan is missing for order POS-DZQN35'}, extra || {});
const finalize = letter('onOrderFinalize', {orderId: 'POS-DZQN35'});

// 1. Verification states.
if (R.evaluate(finalize, {live: {status: 'Completed', inventoryDeducted: true, inventoryLedgerVersion: 1}, archived: null}).state !== 'complete') fail('A finalized live order must verify as complete.');
if (R.evaluate(finalize, {live: {status: null, inventoryDeducted: null, inventoryLedgerVersion: null}, archived: {status: 'Completed', inventoryDeducted: true, inventoryLedgerVersion: 1}}).state !== 'complete') fail('A finalized archived order must verify as complete.');
if (R.evaluate(finalize, {live: {status: 'Completed', inventoryDeducted: null, inventoryLedgerVersion: null}, archived: null}).state !== 'incomplete') fail('An order without inventoryDeducted must stay incomplete.');
if (R.evaluate(finalize, {live: {status: 'Completed', inventoryDeducted: true, inventoryLedgerVersion: null}, archived: null}).state !== 'incomplete') fail('A pre-ledger inventoryDeducted flag alone is not proof of completion.');
if (R.evaluate(finalize, {live: {status: null, inventoryDeducted: null, inventoryLedgerVersion: null}, archived: {status: null, inventoryDeducted: null, inventoryLedgerVersion: null}}).state !== 'record_missing') fail('A missing order must be reported as missing, not complete.');
const reversal = letter('onOrderInventoryReversal', {orderId: 'POS-AAAAAA'});
if (R.evaluate(reversal, {live: {status: 'Completed', inventoryReversed: true}}).state !== 'complete') fail('A confirmed reversal must verify as complete.');
if (R.evaluate(reversal, {live: {status: 'Completed', inventoryReversed: null}}).state !== 'incomplete') fail('An unreversed order must stay incomplete.');
if (R.evaluate(letter('onShiftCloseFinancial', {shiftId: 'SH-1'}), null).state !== 'unverifiable') fail('Triggers without a probe must never auto-close.');
if (R.probeFor(letter('onOrderFinalize', {orderId: '../admins'}))) fail('Probe IDs must be validated before they become database paths.');

// 2. Notes.
if (R.cleanNote('ok').ok || R.cleanNote('          ').ok || R.cleanNote(null).ok) fail('A manual close must require a real note.');
const note = R.cleanNote('  Ran Check past sales;   order finalized  ');
if (!note.ok || note.text !== 'Ran Check past sales; order finalized') fail('Notes must be trimmed and collapsed.');
if (R.cleanNote('x'.repeat(900)).text.length !== R.NOTE_MAX) fail('Notes must be capped.');

// 3. Idempotent close and audit fields.
const fields = R.resolutionFields({method: 'manual', note: note.text, actor: {uid: 'u1', role: 'manager'}, evidence: {recordId: 'POS-DZQN35', state: 'record_missing', checkedAt: now}, now});
const closed = R.closeIfOpen(finalize, fields);
if (!closed || closed.status !== 'resolved' || closed.resolution !== 'manual' || closed.resolvedBy !== 'u1' || closed.error !== finalize.error) fail('Closing must keep the original failure and record who closed it.');
if (R.closeIfOpen(closed, fields) !== undefined || R.closeIfOpen(null, fields) !== undefined) fail('An already closed or missing dead letter must not be rewritten.');
const verified = R.resolutionFields({method: 'verified', note: 'done', now});
if (verified.resolvedBy !== 'server' || verified.resolution !== 'verified_complete') fail('A verified close must be attributed to the server.');

// A closed dead letter leaves the live exception list.
const scan = buildOperationalExceptions({deadLetters: {a: finalize, b: closed}}, now).exceptions.filter((x) => x.category === 'background_failure');
if (scan.length !== 1 || scan[0].id !== 'a') fail('Only open dead letters may appear in System Health.');
const saved = {counts: {critical: 2, warning: 1, total: 3}, exceptions: [{category: 'background_failure', severity: 'critical', id: 'a'}, {category: 'background_failure', severity: 'critical', id: 'b'}, {category: 'uncosted_sale', severity: 'warning', id: 'a'}]};
const trimmed = R.withoutException(saved, 'a');
if (trimmed.exceptions.length !== 2 || trimmed.counts.critical !== 1 || trimmed.counts.warning !== 1 || trimmed.counts.total !== 2) fail('Closing must remove only that card from the saved scan and recount.');
if (R.withoutException(saved, 'zzz') !== saved) fail('An unknown ID must leave the saved scan untouched.');

// 4. Wiring.
const src = read('src/functions/20-portal-auth.js'), built = read('functions/index.js');
for (const marker of ['exports.resolveBackgroundFailure = onCall', 'await verifyOpenDeadLetters(db, deadLetters, now);', 'check.state === "incomplete"', 'dropFromCachedOperationalScan', 'current === null ? null : DeadLetterResolution.closeIfOpen(current, fields)', '"resolve_background_failure"', 'MAX_VERIFY_PER_SCAN']) {
  if (!src.includes(marker)) fail(`Server source is missing ${marker}`);
  if (!built.includes(marker)) fail(`Built functions/index.js is missing ${marker}; run npm run build:artifacts`);
}
if (!src.includes('if (!["owner", "superadmin", "admin", "manager"].includes(actor.role)) throw new HttpsError("permission-denied", "Only management accounts can close a background failure.");')) fail('Closing a background failure must be restricted to management.');
if (!read('functions/index.js').includes('require("./lib/dead-letter-resolution")')) fail('Functions must load the dead-letter resolution library.');
if (!JSON.parse(read('release-manifest.json')).requiredFunctionExports.includes('resolveBackgroundFailure')) fail('resolveBackgroundFailure must be a required function export.');
if (!read('assets/js/admin/firebase-client.mjs').includes("'resolveBackgroundFailure'")) fail('The admin client must register resolveBackgroundFailure.');
if (!read('assets/js/admin/core.mjs').includes('resolveBackgroundFailure:function(id,note)')) fail('Admin core must expose resolveBackgroundFailure.');
const ops = read('assets/js/admin/operations-dashboard.js');
for (const marker of ['data-resolve-background', 'Mark resolved', 'resolveBackgroundFailure(id,values.note)', 'AccazaFormDialog.run', 'close on their own at the next health check']) if (!ops.includes(marker)) fail(`System Health UI is missing ${marker}`);
if (!/"functionDeadLetters":\s*\{\s*"\.indexOn":\s*"abandonedAt",\s*"\.read":\s*false,\s*"\.write":\s*false\s*\}/.test(read('database.rules.json'))) fail('functionDeadLetters must stay server-only.');

console.log('Dead-letter resolution check passed.');
