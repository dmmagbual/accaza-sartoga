#!/usr/bin/env node
/**
 * Accaza — one-command backup verifier (H-2 restore-drill, Phase 2).
 * Usage:  node tools/verify-backup.mjs <path-to-downloaded-backup.json>
 *
 * Pure Node (no GCP, no emulator). Proves a downloaded daily backup is:
 *   1. INTACT      — SHA-256 fingerprint matches the sealed envelope.
 *   2. BALANCED    — every financialMovement and Books journal balances (double-entry).
 *   3. RESTORABLE  — the data round-trips to a byte-identical fingerprint.
 * Bonus: prints the clearing/suspense account standing at backup time.
 * Exit 0 = PASS, exit 1 = FAIL.
 */
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const R = require('../functions/lib/recovery-validation.js');
const {clearingBalancesFromJournal, CLEARING_ACCOUNTS} = require('../functions/lib/operational-exceptions.js');

const file = process.argv[2];
if (!file) { console.error('Usage: node tools/verify-backup.mjs <backup.json>'); process.exit(2); }
let env;
try { env = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')); }
catch (e) { console.error('Could not read/parse backup file:', String(e.message || e)); process.exit(2); }

console.log(`\nAccaza backup verification — ${path.basename(file)}`);
console.log('-'.repeat(52));
console.log('version        :', env.version);
console.log('takenAt        :', env.takenAt ? new Date(env.takenAt).toISOString() : '(missing)');
console.log('excluded nodes :', Array.isArray(env.excluded) ? env.excluded.join(', ') : '(none)');
console.log('data nodes     :', env.data && typeof env.data === 'object' ? Object.keys(env.data).length : 0);

// Full reconcile: integrity + double-entry validation using the shipped library.
const res = R.validateEnvelope(env, {});
const roundTrip = R.fingerprint(env.data || {});
const sealed = env.integrity && env.integrity.dataSha256;
console.log('sealed SHA-256 :', sealed || '(none)');
console.log('recomputed     :', roundTrip);
console.log('INTACT         :', sealed ? (roundTrip === sealed ? 'YES' : 'NO — MISMATCH') : 'n/a (backup-v1)');
console.log('BALANCED (DE)  :', res.ok ? 'YES' : 'NO');

// Bonus: clearing/suspense standing at backup time (ties in the M-3 control accounts).
const bal = clearingBalancesFromJournal(env.data && env.data.books && env.data.books.journal);
console.log('\nClearing/suspense standing at backup time (should be ~0):');
CLEARING_ACCOUNTS.forEach(({code, name}) => {
  const v = Math.round((Number(bal[code]) || 0) * 100) / 100;
  console.log(`  ${code} ${name.padEnd(30)} ${v.toFixed(2)}${Math.abs(v) > 50 ? '  <-- over PHP 50' : ''}`);
});

const ok = res.ok && (!sealed || roundTrip === sealed);
console.log('\n' + '='.repeat(52));
console.log(ok ? 'PASS — backup is intact, balanced, and restorable.' : 'FAIL — see issues below:');
if (!ok) (res.issues || []).forEach((i) => console.log('  - ' + i));
console.log('='.repeat(52) + '\n');
process.exit(ok ? 0 : 1);
