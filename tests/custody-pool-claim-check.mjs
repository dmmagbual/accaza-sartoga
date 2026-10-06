/* AP Integrity Remediation Plan, step 0.5 (AP-02) — Undeposited Collection custody pool claim.

   The defect: poolCustodyOutflow read the open cash-custody rows, allocated FIFO and returned
   ABSOLUTE remaining writes with no lock. Two cash-outs a moment apart (bill payments, cash
   purchases, cash payments, deposits) could both use the same peso, so Σ custody remaining no
   longer matched GL 1030 Undeposited Collection.

   This runs the real claim and FIFO routines against an in-memory database whose operations
   interleave like Firebase's: without the claim the race is reproduced; with it the books hold.
   It then checks that every custody-changing path claims first, and that shift close / Z report
   (which only create rows) never wait for it. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
const root = path.join(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };

/* ---------- in-memory database with real interleaving ---------- */
function fakeDb(initial) {
  const data = structuredClone(initial || {});
  const at = (p) => p.replace(/^\//, '').split('/').filter(Boolean);
  const getAt = (p) => at(p).reduce((node, key) => (node == null ? undefined : node[key]), data);
  const setAt = (p, value) => { const keys = at(p), last = keys.pop(); let node = data; for (const key of keys) node = node[key] = node[key] || {}; if (value === null || value === undefined) delete node[last]; else node[last] = structuredClone(value); };
  const tick = () => new Promise((resolve) => setImmediate(resolve));
  const snap = (value) => ({exists: () => value !== undefined && value !== null, val: () => (value === undefined ? null : structuredClone(value))});
  return {
    data,
    ref: (p) => ({
      get: async () => { await tick(); return snap(getAt(p)); },
      orderByChild: (child) => ({startAt: (min) => ({get: async () => { await tick(); const rows = getAt(p) || {}, out = {}; Object.keys(rows).forEach((k) => { if (Number(rows[k] && rows[k][child]) >= min) out[k] = rows[k]; }); return snap(out); }})}),
      transaction: async (fn) => { await tick(); const current = getAt(p); /* Firebase first runs the handler on the (empty) local cache, then retries with the server value. */ let next = fn(null); if (current !== undefined) next = fn(structuredClone(current)); if (next === undefined) return {committed: false, snapshot: snap(current)}; setAt(p, next); return {committed: true, snapshot: snap(next)}; },
    }),
    update: async (writes) => { await tick(); Object.keys(writes).forEach((p) => setAt(p, writes[p])); },
  };
}

/* ---------- load the real routines (claim + FIFO outflow) from the source ---------- */
class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
const Financial = require(path.join(root, 'functions/lib/financial.js'));
const BackupDelta = require(path.join(root, 'functions/lib/backup-delta.js'));
const financeText = (value, max) => String(value == null ? '' : value).trim().slice(0, max || 160);
const logger = {error: () => {}};
const sales = read('src/functions/40-sales-finance.js');
const start = sales.indexOf('function custodyInKeyOrder('), end = sales.indexOf('async function poolCustodyDeposit(');
check(start > 0 && end > start, 'The custody routines must be found in 40-sales-finance.js.');
function load({wait = 1, attempts = 400} = {}) {
  const block = sales.slice(start, end).replace(/CUSTODY_POOL_WAIT_MS = \d+/, `CUSTODY_POOL_WAIT_MS = ${wait}`).replace(/CUSTODY_POOL_ATTEMPTS = \d+/, `CUSTODY_POOL_ATTEMPTS = ${attempts}`);
  return new Function('Financial', 'BackupDelta', 'financeText', 'crypto', 'logger', 'HttpsError', `${block}\nreturn {claimCustodyPool, releaseCustodyClaims, withCustodyPool, poolCustodyOutflow, CUSTODY_POOL_CLAIM_PATH, CUSTODY_POOL_LEASE_MS};`)(Financial, BackupDelta, financeText, crypto, logger, HttpsError);
}
const C = load();
const LOCK = C.CUSTODY_POOL_CLAIM_PATH.replace(/^\//, '').split('/');
const lockOf = (db) => LOCK.reduce((node, key) => (node == null ? undefined : node[key]), db.data);
const tick = () => new Promise((resolve) => setImmediate(resolve));

/* A cash-out shaped like the server: (claim) → read custody → FIFO → validate → commit with the GL line. */
async function cashOut(db, routines, commandId, value, locked) {
  const work = async () => {
    const out = await routines.poolCustodyOutflow(db, value);
    if (out.shortfall > 0.009) throw new HttpsError('failed-precondition', 'exceeds Undeposited Collection');
    await tick(); await tick();
    await db.update(Object.assign({}, out.writes, {[`gl1030/${commandId}`]: -value}));
    return 'ok';
  };
  return locked ? routines.withCustodyPool(db, commandId, work) : work();
}
const pool = () => ({cashCustody: {shiftA: {amount: 20, remaining: 20, closedAt: 1}, shiftB: {amount: 30, remaining: 30, closedAt: 2}}, gl1030: {opening: 50}});
const custodySum = (db) => Financial.money(Object.values(db.data.cashCustody || {}).reduce((s, r) => s + Number(r.remaining || 0), 0));
const glSum = (db) => Financial.money(Object.values(db.data.gl1030 || {}).reduce((s, v) => s + Number(v), 0));
const outcome = (results) => results.map((r) => (r.status === 'fulfilled' ? r.value : r.reason.code));

/* 1. Without the claim the race is real: ten ₱10 cash-outs on ₱50 break custody = GL 1030. */
let db = fakeDb(pool());
let results = await Promise.allSettled(Array.from({length: 10}, (_, i) => cashOut(db, C, `u${i}`, 10, false)));
check(custodySum(db) !== glSum(db) || outcome(results).filter((x) => x === 'ok').length > 5, 'The unlocked control run must reproduce the defect, or this test proves nothing.');

/* 2. With the claim: exactly five post, five are refused, and custody still equals GL 1030. */
db = fakeDb(pool());
results = await Promise.allSettled(Array.from({length: 10}, (_, i) => cashOut(db, C, `p${i}`, 10, true)));
const okCount = outcome(results).filter((x) => x === 'ok').length, refusedCount = outcome(results).filter((x) => x === 'failed-precondition').length;
check(okCount === 5 && refusedCount === 5, `Ten simultaneous ₱10 cash-outs on ₱50 must give five posts and five refusals (got ${JSON.stringify(outcome(results))}).`);
check(custodySum(db) === 0 && glSum(db) === 0, `Σ custody remaining must equal GL 1030 after the run (custody ${custodySum(db)}, GL ${glSum(db)}).`);
check(lockOf(db) === undefined, 'No custody claim may be left behind after the run.');

/* 3. Uneven amounts across rows keep the FIFO allocation exact. */
db = fakeDb(pool());
results = await Promise.allSettled([7, 13, 25, 4, 9].map((v, i) => cashOut(db, C, `q${i}`, v, true)));
check(custodySum(db) === glSum(db) && custodySum(db) >= 0, `Mixed amounts must keep custody equal to GL 1030 (custody ${custodySum(db)}, GL ${glSum(db)}).`);
check(Object.values(db.data.cashCustody).every((r) => r.remaining >= 0), 'No custody row may go negative.');

/* 4. A failure after the claim releases it; the error still reaches the caller. */
db = fakeDb(pool());
let message = '';
try { await C.withCustodyPool(db, 'fails', async () => { throw new HttpsError('failed-precondition', 'boom'); }); } catch (error) { message = error.message; }
check(message === 'boom' && lockOf(db) === undefined, 'A failed posting must release the custody claim and surface its own error.');

/* 5. A waiter gives up with a clear retry message; the holder keeps its claim. */
db = fakeDb(pool());
const holder = []; await C.claimCustodyPool(db, 'holder', holder);
const quick = load({wait: 1, attempts: 3});
let refused = null; try { await quick.claimCustodyPool(db, 'other', []); } catch (error) { refused = error; }
check(refused && refused.code === 'aborted' && /Undeposited Collection/.test(refused.message), 'A second cash-out must wait, then be refused with a retry message.');
check(lockOf(db) && lockOf(db).owner === 'holder', 'The waiting cash-out must not disturb the holder.');

/* 6. Reuse within one call: a second claim on the same registry costs nothing and releases once. */
const again = await C.claimCustodyPool(db, 'holder', holder);
check(again === holder[0] && holder.length === 1, 'A call must reuse the claim it already holds.');

/* 7. Shift close / Z report only create rows: they never wait for the claim. */
await db.update({'cashCustody/shiftC': {amount: 15, remaining: 15, closedAt: 3}, 'gl1030/shiftC': 15});
check(db.data.cashCustody.shiftC && lockOf(db).owner === 'holder', 'A new shift custody row must be written while a cash-out holds the claim.');
await C.releaseCustodyClaims(holder);
check(lockOf(db) === undefined, 'Releasing must clear the holder claim.');

/* 8. A live claim is never taken over, not even by a retry of the same command (a takeover that
      then failed would drop the lock while the first holder was still writing). */
db = fakeDb(pool());
const first = []; await C.claimCustodyPool(db, 'cmd1', first);
let retryRefused = false; try { await quick.claimCustodyPool(db, 'cmd1', []); } catch (error) { retryRefused = error.code === 'aborted'; }
check(retryRefused && lockOf(db).token === first[0].token, 'A second call with the same command must wait for the live claim, not take it over.');
const stale = {custodyPool: true}; Object.assign(stale, first[0]); await C.releaseCustodyClaims(first);
check(lockOf(db) === undefined, 'The holder must release its own claim.');
const fresh = []; await C.claimCustodyPool(db, 'cmd2', fresh);
await stale.release();
check(lockOf(db) && lockOf(db).token === fresh[0].token, 'Releasing an old claim twice must not remove a newer claim.');
await C.releaseCustodyClaims(fresh);

/* 9. A crashed holder expires after the lease. */
db = fakeDb(Object.assign(pool(), {financialControlLocks: {cashCustodyPool: {owner: 'crashed', token: 'x', claimedAt: Date.now() - C.CUSTODY_POOL_LEASE_MS - 1000}}}));
const taker = []; await quick.claimCustodyPool(db, 'next', taker);
check(lockOf(db).owner === 'next', 'An expired claim must be taken over.');
await quick.releaseCustodyClaims(taker);

/* ---------- 10. every custody-changing path claims first ---------- */
const functionsDir = path.join(root, 'src/functions');
const sources = Object.fromEntries(fs.readdirSync(functionsDir).filter((f) => f.endsWith('.js')).map((f) => [f, fs.readFileSync(path.join(functionsDir, f), 'utf8')]));
const calls = (re) => Object.entries(sources).reduce((n, [, s]) => n + (s.match(re) || []).length, 0);
/* Recurrence guard: a NEW caller changes these counts and must be reviewed for the claim. */
check(calls(/await poolCustodyOutflow\(/g) === 10, `poolCustodyOutflow call sites changed (${calls(/await poolCustodyOutflow\(/g)}); add the custody claim to the new path, then update this count.`);
check(calls(/await poolCustodyDeposit\(/g) === 1, 'poolCustodyDeposit call sites changed; add the custody claim to the new path, then update this count.');
for (const [file, s] of Object.entries(sources)) {
  if (file === '40-sales-finance.js') continue;
  const touches = /await poolCustodyOutflow\(|await poolCustodyDeposit\(|cashCustody\/\$\{[^}]+\}\/(remaining|depositedAmount|paidOutAmount)`\]\s*=|cashCustody\/\$\{[^}]+\}`\]\s*=\s*null/.test(s);
  if (touches) check(/claimCustodyPool\(|withCustodyPool\(/.test(s), `${file} changes custody remaining but never takes the custody claim.`);
}
const has = (file, text, message) => check(sources[file].includes(text), message);
has('42d-financial-command-close.js', 'await claimCustodyPool(db,commandId,apClaimSets);const custodyOut=await poolCustodyOutflow(db,value);', 'A single bill payment from Undeposited Collection must claim before reading custody.');
has('42d-financial-command-close.js', 'value=0;await claimCustodyPool(db,commandId,apClaimSets);', 'A cash deposit must claim before reading custody.');
has('42d-financial-command-close.js', 'if(custodyId){await claimCustodyPool(db,commandId,apClaimSets);const custody=', 'Voiding a journal linked to recovered cash must claim before checking and deleting its custody row.');
has('42d-financial-command-close.js', '} finally { for (const set of apClaimSets.slice().sort((a, b) => Number(b.custodyPool === true) - Number(a.custodyPool === true))) { try { await set.release(); } catch (error) {', 'postFinancialCommand must release the custody pool first and keep releasing if one release fails.');
has('42a-financial-command-entry.js', 'await claimCustodyPool(db,commandId,apClaimSets);const custodyOut=await poolCustodyOutflow(db,total);', 'A batch bill payment must claim before reading custody.');
has('42a-financial-command-entry.js', 'await claimCustodyPool(db,commandId,apClaimSets);for(const [cid,raw] of Object.entries(allocations))', 'A batch payment reversal must claim before restoring custody.');
has('42b-financial-command-transactions.js', 'await claimCustodyPool(db, commandId, apClaimSets);const custodyOut = await poolCustodyOutflow(db, value);', 'A cash purchase from Undeposited Collection must claim before reading custody.');
has('42c-financial-command-controls.js', 'await claimCustodyPool(db,commandId,apClaimSets);const existingReceipt=', 'A cash-journal edit must claim before recomputing custody.');
const pr = sources['43b-purchase-corrections.js'];
check(pr.indexOf('await claimCustodyPool(db,`purchase_cash_reversal_${invoiceId}`,custodyClaims)') > 0 && pr.indexOf('await claimCustodyPool(db,`purchase_cash_reversal_${invoiceId}`,custodyClaims)') < pr.indexOf('await applyInventoryMovement(db,{movementId:`purchase_reverse_'), 'Reversing a purchase paid from Undeposited Collection must claim before any stock moves.');
has('43b-purchase-corrections.js', '}finally{await releaseCustodyClaims(custodyClaims);', 'Purchase reversal must release the custody claim.');
has('21-staff-advance-liquidation.js', 'await claimCustodyPool(db,correctionId,custodyClaims);const custodyOut=await poolCustodyOutflow(db,delta);', 'Editing a cash payment upward must claim before reading custody.');
has('21-staff-advance-liquidation.js', 'await claimCustodyPool(db, `petty_settlement_reversal_${id}`, custodyClaims); const custodyOut = await poolCustodyOutflow(db, settlementValue);', 'Reversing a cash repayment must claim before reading custody.');
has('21-staff-advance-liquidation.js', '} finally { await releaseCustodyClaims(custodyClaims); } },', 'managePettyVoucher must release the custody claim.');
has('22-close-controls.js', 'await claimCustodyPool(db, movementId, custodyClaims);\n    const isAdvance', 'The missing-posting repair must claim before reading custody.');
has('22-close-controls.js', '} finally { await releaseCustodyClaims(custodyClaims); }', 'The missing-posting repair must release the custody claim.');
has('21-operational-controls.js', 'if(!countCustody.rows)await claimCustodyPool(db,`review_discrepancy_${id}`,custodyClaims);', 'A recount correction must claim before changing an existing custody row.');
has('21-operational-controls.js', 'await claimCustodyPool(db,`review_discrepancy_${id}`,custodyClaims);const custodyRows=await custodyRowsForShift', 'Recovered cash added to an existing custody row must claim first.');
has('21-operational-controls.js', '} finally { await releaseCustodyClaims(custodyClaims); } },', 'reviewDiscrepancy must release the custody claim.');
has('41-expense-assets.js', 'async (event) => pettyVoucherFinancialLocked(event),', 'The cash-payment approval trigger must go through the custody claim.');
has('41-expense-assets.js', 'return withCustodyPool(getDatabase(), `petty_${event.params.voucherId}`, () => pettyVoucherFinancialEvent(event));', 'An approved Undeposited Collection cash payment must post under the custody claim.');
has('41-expense-assets.js', 'return withCustodyPool(db,`petty_${id}`,()=>postControlledPettyVoucherUnlocked(db,id,before,after,actor));', 'Controlled cash payments must post under the custody claim.');
has('41-expense-assets.js', 'return withCustodyPool(db, `petty_${id}`, () => backfillPettyVoucherUnlocked(db, id, row));', 'The cash-payment backfill must post under the custody claim.');

/* ---------- 11. shift close / Z report never take or wait for the claim ---------- */
const shiftClose = sales.slice(sales.indexOf('exports.onShiftCloseFinancial'));
check(shiftClose.length > 20 && !/claimCustodyPool|withCustodyPool/.test(shiftClose), 'Shift close must never wait for the custody claim.');
check(!/claimCustodyPool|withCustodyPool/.test(sales.slice(sales.indexOf('function poolCustodyInflowRecord('), sales.indexOf('function accountIdFor('))), 'Creating a custody row must never need the claim.');
for (const file of Object.keys(sources).filter((f) => /shift|handover|z-report|zreport/i.test(f))) check(!/claimCustodyPool|withCustodyPool/.test(sources[file]), `${file} (shift close / Z report) must not take the custody claim.`);

/* ---------- 12. deployed bundle ---------- */
const bundle = read('functions/index.js');
check(bundle.includes('async function claimCustodyPool(') && bundle.includes('async function pettyVoucherFinancialLocked(') && bundle.includes('await claimCustodyPool(db,commandId,apClaimSets);const custodyOut=await poolCustodyOutflow(db,value);'), 'The deployed functions bundle must contain the custody claim (run npm run build:artifacts).');

if (failures.length) { console.error(`FAIL: ${failures.length} custody pool claim check(s)\n- ${failures.join('\n- ')}`); process.exit(1); }
console.log('PASS: Undeposited Collection cash-outs are serialized by one short claim, custody stays equal to GL 1030 under concurrency, failures release it, and shift close / Z report never wait for it.');
