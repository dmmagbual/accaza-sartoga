// Release check: no Cloud Function may download a growing Realtime Database node in full
// (Sep 2026 download audit). Each whole-node read found by tools/download-read-graph.mjs
// must either target a small, bounded configuration node, or carry an annotation inside
// the same statement:
//   /* download-ok: migration <why> */  one-time work guarded by a marker
//   /* download-ok: fallback <why> */   only when a maintained index/summary is missing
//   /* download-ok: manual <why> */     reachable only from the manual tools listed below
//   /* download-ok: action <why> */     an explicit, rarely used owner action inside a general command
//   /* download-ok: catalog <why> */    menu or recipe configuration, not business history
//   /* download-ok: bounded <why> */    the node cannot grow with business history
//   /* download-ok: backup <why> */     the daily backup itself (backup functions only)
// Every orderByChild query must also be backed by an .indexOn rule; without one the Admin SDK
// downloads the whole node and filters it in memory.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {readGraph, indexUses, rulesIndex} from '../tools/download-read-graph.mjs';

const src = fs.readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
const graph = readGraph(src);

// Configuration nodes whose size does not depend on sales, cash or history volume.
export const SMALL_NODES = new Set([
  '/', 'admins', 'adminPerms', 'settings', 'config', 'payment', 'calBlocks', 'availability', 'usageTypes', 'expenseItems', 'expenseCategories',
  'cfAccounts', 'chartOfAccounts', 'platformVarAccounts', 'pettyCashSettings', 'posStaff', 'staffPushTokens', 'channelPrices',
  'posActiveShift', 'accountingPeriods', 'publicCatalogVersion', 'dataVersions', 'undepositedOpeningBalance', 'documentCounters',
  'books/monthlyNet', 'books/monthlyNetMeta', 'books/config', 'books/reconciliationConfig', 'books/chartCodeMigrations',
  'cashBalanceSummary', 'cashBalanceSummaryMeta', 'cashFlowIndexMeta', 'undepositedPageIndexMeta', 'supplierAdvanceShiftIndexMeta',
  'systemHealth', 'systemMaintenance', 'supplierMigrations', 'historicalArchiveSync', 'posSettings/invCategories', 'posSettings/tolerances',
  'inventoryReconciliations/openingBalance', 'financialControlLinks/correctionMovements', 'rateLimits/orders',
  // POS settings children are small configuration values; the whole settings node is not.
  'posSettings/payMethods', 'posSettings/fixedFloat', 'posSettings/denomTracking', 'posSettings/sharedBaseIngredients', 'posSettings/optionCosts', 'posSettings/packagingAssignments',
  // Small maintained indexes: shifts that hold a supplier advance, custody rows that still hold cash.
  'supplierAdvanceShifts', 'cashCustodyOpenIndex',
]);
// Buttons an owner or manager presses on purpose to rebuild or audit history. They may read
// history in full; they are listed so that no automatic path can reach the same code.
export const MANUAL_TOOLS = new Set([
  'ensureFinancialLedger', 'auditFinancialControls', 'ensureBooksJournal', 'ensureInventoryLedger', 'repairFinanceDates',
  'repairPettyExpenseClassifications', 'reconcileUndepositedCustody', 'retireRevolvingFund', 'legacyOwnerCapitalReset',
  'runDatabaseBackupNow', 'repairOrderInventoryMarker', 'runFinancialClose',
]);
const BACKUP_FUNCTIONS = new Set(['backupDatabaseDaily', 'runDatabaseBackupNow']);
const KINDS = new Set(['migration', 'fallback', 'manual', 'action', 'catalog', 'bounded', 'backup']);

function isSmall(path) {
  if (path === '<dynamic>') return true; // per-record reads built from ids
  if (path === '<dynamic-root>') return false; // a whole node chosen at run time must be justified
  const parts = path.split('/');
  for (let n = parts.length; n > 0; n--) if (SMALL_NODES.has(parts.slice(0, n).join('/'))) return true;
  // A child of a growing node (e.g. financialMovements/opening_x) is a single record.
  return parts.length > 1 && !['books', 'systemHealth', 'posSettings', 'systemMaintenance', 'inventoryReconciliations', 'financialControlLinks', 'rateLimits'].includes(parts[0]) || (parts[0] === 'books' && parts.length > 2);
}

export function violations(g) {
  const out = [];
  for (const fn of g) for (const r of fn.reads) {
    if (r.query.length || isSmall(r.path)) continue;
    if (!r.annotation) { out.push(`${fn.name}: whole read of /${r.path} (functions/index.js:${r.line}, via ${r.via.join(' > ')}) has no download-ok annotation`); continue; }
    if (!KINDS.has(r.annotation)) { out.push(`${fn.name}: unknown download-ok kind "${r.annotation}" at functions/index.js:${r.line}`); continue; }
    if (r.annotation === 'manual' && !MANUAL_TOOLS.has(fn.name)) out.push(`${fn.name}: reaches the manual-only full read of /${r.path} at functions/index.js:${r.line} (via ${r.via.join(' > ')})`);
    if (r.annotation === 'backup' && !BACKUP_FUNCTIONS.has(fn.name)) out.push(`${fn.name}: reaches a backup-only full read of /${r.path} at functions/index.js:${r.line} (via ${r.via.join(' > ')})`);
  }
  return [...new Set(out)];
}

export function missingIndexes(source, rulesText) {
  const indexed = rulesIndex(rulesText), out = [];
  for (const use of indexUses(source)) for (const field of use.fields) {
    if (use.path.startsWith('<') || field === '<dynamic>') continue;
    if (!indexed(use.path, field)) out.push(`functions/index.js:${use.line} queries /${use.path} by ${field} without an .indexOn rule`);
  }
  return out;
}

const rulesText = fs.readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8');
const found = violations(graph).concat(missingIndexes(src, rulesText));
if (process.argv.includes('--list')) { console.log(found.join('\n')); process.exit(0); }
assert.ok(graph.length > 100, `expected the function bundle to export more than 100 functions, found ${graph.length}`);
assert.deepEqual(found, [], `Whole-node downloads without a justification:\n${found.join('\n')}`);

// Self-test of the guard on a synthetic bundle.
const sample = `
function helper(db){ return db.ref("/financialMovements").get(); }
function manualOnly(db){ return /* download-ok: manual rebuild */ db.ref("/archivedOrders").get(); }
exports.hot = onCall({region:"x"}, async () => { const db = getDatabase(); await helper(db); await db.ref("/orders").orderByChild("status").equalTo("open").get(); await db.ref(\`/orders/\${id}\`).get(); await manualOnly(db); });
exports.ensureFinancialLedger = onCall({region:"x"}, async () => { await manualOnly(getDatabase()); });
exports.cfg = onCall({region:"x"}, async () => { await getDatabase().ref("/cfAccounts").get(); });
`;
const sampleFound = violations(readGraph(sample));
assert.equal(sampleFound.length, 2, sampleFound.join('\n'));
assert.ok(sampleFound.some((v) => /hot: whole read of \/financialMovements/.test(v)));
assert.ok(sampleFound.some((v) => /hot: reaches the manual-only full read of \/archivedOrders/.test(v)));
assert.deepEqual(missingIndexes('db.ref("/orders").orderByChild("status").equalTo(1).get(); db.ref("/orders").orderByChild("shiftId").equalTo(1).get();', '{"rules": {"orders": {".indexOn": ["status"]}}}'), ['functions/index.js:1 queries /orders by shiftId without an .indexOn rule']);
console.log(`download read guard: ${graph.length} functions checked, no unjustified whole-node downloads`);
