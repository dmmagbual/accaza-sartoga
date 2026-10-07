/* AP Integrity Remediation Plan, step 0.4 (AP-01) — concurrent payments on one supplier bill.

   The defect: pay_payable read the bill and validated the amount BEFORE taking its claim, never
   re-read it, and wrote absolute balances — so two payments with different command IDs could both
   pass and the bill was paid twice or a settlement lost. Batch payments, payment reversals and
   purchase reversal/Amend had the same gap or took no claim at all.

   This runs the real claimPayables routine against an in-memory database whose transactions
   interleave like Firebase's, then checks every bill-changing path claims before it reads. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root = path.join(import.meta.dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };

/* ---------- in-memory database: get / set / transaction with real interleaving ---------- */
function fakeDb(initial) {
  const data = structuredClone(initial || {});
  const at = (p) => p.replace(/^\//, '').split('/').filter(Boolean);
  const getAt = (p) => at(p).reduce((node, key) => (node == null ? undefined : node[key]), data);
  const setAt = (p, value) => { const keys = at(p), last = keys.pop(); let node = data; for (const key of keys) node = node[key] = node[key] || {}; if (value === null || value === undefined) delete node[last]; else node[last] = structuredClone(value); };
  const tick = () => new Promise((resolve) => setImmediate(resolve));
  return {
    data,
    ref: (p) => ({
      get: async () => { await tick(); const value = getAt(p); return {exists: () => value !== undefined, val: () => (value === undefined ? null : structuredClone(value))}; },
      set: async (value) => { await tick(); setAt(p, value); },
      transaction: async (fn) => { await tick(); const current = getAt(p); /* Firebase first runs the handler on the (empty) local cache, then retries with the server value. */ let next = fn(null); if (current !== undefined) next = fn(structuredClone(current)); if (next === undefined) return {committed: false, snapshot: {exists: () => current !== undefined, val: () => current}}; setAt(p, next); return {committed: true, snapshot: {exists: () => next !== null, val: () => next}}; },
    }),
    update: async (writes) => { await tick(); Object.keys(writes).forEach((p) => setAt(p, writes[p])); },
  };
}

/* ---------- load the real routine with its bundle dependencies ---------- */
class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
const financeKey = (value) => { const key = String(value || '').trim(); if (!key || /[.#$\[\]/]/.test(key)) throw new HttpsError('invalid-argument', 'bad key'); return key; };
const source = read('src/functions/42-ap-settlement-claims.js');
const {claimPayables, PAYABLE_CLAIM_LEASE_MS} = new Function('financeKey', 'crypto', 'HttpsError', `${source}\nreturn {claimPayables, releasePayableClaims, PAYABLE_CLAIM_LEASE_MS};`)(financeKey, crypto, HttpsError);
const actor = {uid: 'owner'};

/* A payment shaped exactly like the server path: claim → re-read → validate → commit (+ release) → finally release. */
async function pay(db, id, value, commandId, pause) {
  const registry = [];
  try {
    const claim = await claimPayables(db, [id], commandId, actor, registry), doc = claim.doc(id);
    const remaining = Number(doc.remainingAmount);
    if (value > remaining + 0.009) throw new HttpsError('failed-precondition', 'exceeds');
    if (pause) await pause();
    await db.update(Object.assign({[`payables/${id}/remainingAmount`]: remaining - value, [`payables/${id}/paidAmount`]: Number(doc.paidAmount || 0) + value, [`payables/${id}/rev`]: claim.nextRev(id), [`movements/${commandId}`]: {value}}, claim.releaseWrites));
    return 'ok';
  } finally { for (const set of registry) await set.release(); }
}
const outcome = (results) => results.map((r) => (r.status === 'fulfilled' ? r.value : r.reason.code)).sort();

/* 1. Two payments of 60 on a 100 bill at the same moment: exactly one posts. */
let db = fakeDb({payables: {b1: {amount: 100, remainingAmount: 100, paidAmount: 0}}});
let results = await Promise.allSettled([pay(db, 'b1', 60, 'cmdA'), pay(db, 'b1', 60, 'cmdB')]);
check(JSON.stringify(outcome(results)) === JSON.stringify(['aborted', 'ok']), `Two simultaneous 60 payments must give one post and one refusal (got ${JSON.stringify(outcome(results))}).`);
check(db.data.payables.b1.remainingAmount === 40 && Object.keys(db.data.movements).length === 1, 'Only one payment may reach the ledger.');
check(!db.data.payableSettlementClaims || !Object.keys(db.data.payableSettlementClaims).length, 'No claim may be left behind.');

/* 2. Two payments of 50: one posts, the other is refused and succeeds on retry against the FRESH balance. */
db = fakeDb({payables: {b2: {amount: 100, remainingAmount: 100, paidAmount: 0}}});
results = await Promise.allSettled([pay(db, 'b2', 50, 'cmdC'), pay(db, 'b2', 50, 'cmdD')]);
check(JSON.stringify(outcome(results)) === JSON.stringify(['aborted', 'ok']), 'Simultaneous payments must never both act on the same balance.');
check((await pay(db, 'b2', 50, 'cmdD')) === 'ok' && db.data.payables.b2.remainingAmount === 0 && db.data.payables.b2.paidAmount === 100, 'The retried payment must post against the updated balance.');
let refused = false; try { await pay(db, 'b2', 1, 'cmdE'); } catch (error) { refused = error.code === 'failed-precondition'; }
check(refused, 'A payment above the re-read balance must be refused.');

/* 3. A payment that fails after claiming leaves no claim and no movement. */
db = fakeDb({payables: {b3: {amount: 100, remainingAmount: 100}}});
results = await Promise.allSettled([pay(db, 'b3', 30, 'cmdF', async () => { throw new Error('commit failed'); })]);
check(results[0].status === 'rejected' && !db.data.movements && !Object.keys(db.data.payableSettlementClaims || {}).length, 'A failed payment must release its claim and post nothing.');

/* 4. Batch claims are all-or-nothing: if one bill is busy, none stay claimed. */
db = fakeDb({payables: {a: {amount: 10, remainingAmount: 10}, b: {amount: 10, remainingAmount: 10}}, payableSettlementClaims: {b: {token: 'other', commandId: 'busy', claimedAt: Date.now()}}});
let batchError = null; try { await claimPayables(db, ['b', 'a'], 'cmdBatch', actor, []); } catch (error) { batchError = error; }
check(batchError && batchError.code === 'aborted' && !db.data.payableSettlementClaims.a && db.data.payableSettlementClaims.b.token === 'other', 'A busy bill must refuse the whole batch and release the bills already claimed, without touching the other claim.');

/* 5. A retry of the same command may take over its own claim; a stale claim (lease over) may be taken. */
db = fakeDb({payables: {c: {amount: 10, remainingAmount: 10}}, payableSettlementClaims: {c: {token: 'mine', commandId: 'same', claimedAt: Date.now()}}});
check((await claimPayables(db, ['c'], 'same', actor, [])).ids[0] === 'c', 'A retry of the same command must recover its own claim.');
db = fakeDb({payables: {d: {amount: 10, remainingAmount: 10}}, payableSettlementClaims: {d: {token: 'old', commandId: 'x', claimedAt: Date.now() - PAYABLE_CLAIM_LEASE_MS - 1000}}});
check((await claimPayables(db, ['d'], 'new', actor, [])).ids[0] === 'd', 'A claim older than the 15-minute lease must be recoverable.');
check(PAYABLE_CLAIM_LEASE_MS === 180000, 'The lease must outlast the slowest caller (120 s) but stay short (3 minutes).');

/* ---------- every bill-changing path claims before it reads ---------- */
const entry = read('src/functions/42a-financial-command-entry.js'), close = read('src/functions/42d-financial-command-close.js'), purchase = read('src/functions/43b-purchase-corrections.js');
check(entry.includes('const apClaimSets = []; try {') && close.includes('} finally { for (const set of apClaimSets.slice().sort((a, b) => Number(b.custodyPool === true) - Number(a.custodyPool === true))) { try { await set.release(); } catch (error) { logger.error("Financial command claim release failed", {message: String(error && error.message || error)}); } } }'), 'postFinancialCommand must release every claim on every exit.');
check(close.includes('apClaim = isAr ? null : await claimPayables(db, [docId], commandId, actor, apClaimSets), snap = isAr ?'), 'Single payments, refunds and bill reversals must claim before reading the bill.');
check(!/if\(!isAr&&!customerRefund\)\{const lockRef/.test(close), 'The old read-then-claim block must be gone.');
const payAt = close.indexOf('claimPayables(db, [docId], commandId, actor, apClaimSets), snap = isAr'), custodyAt = close.indexOf('poolCustodyOutflow(db,value)');
check(payAt > 0 && custodyAt > payAt, 'The bill must be claimed before any Undeposited Collection cash is allocated.');
check(close.includes('`operationalAudit/${now}_payable_payment_${commandId}`'), 'Every single payment must write an audit row.');
check(close.includes('const apClaim = await claimPayables(db, [docId], commandId, actor, apClaimSets), snap = apClaim.snapshot(docId);'), 'Payment reversal must claim the bill.');
check((close.match(/claimPayables\(/g) || []).length >= 5, 'Close-to-capital, opening-balance reversal and journal void must claim their bill too.');
check(entry.includes('claimPayables(db,unique.map((row)=>row.documentId),commandId,actor,apClaimSets)') && !entry.includes('const claimTokens=[]'), 'Batch payments must claim every bill before reading any.');
check(/reverse_payable_batch_payment[\s\S]*apClaim=await claimPayables\(db,\[docId\]/.test(entry), 'Batch-allocation reversal must claim the bill.');
const purchaseClaimAt = purchase.indexOf('purchaseClaim=await claimPayables('), stockAt = purchase.indexOf('await applyInventoryMovement(db,{movementId:`purchase_reverse_');
check(purchaseClaimAt > 0 && purchaseClaimAt < stockAt && purchase.includes('}finally{await releaseCustodyClaims(custodyClaims);await releasePettyVoucherClaims(voucherClaims);if(purchaseClaim)await purchaseClaim.release();}'), 'Purchase reversal/Amend must claim the bill before moving stock and always release its custody, voucher and payable claims.');
const controls = read('src/functions/42c-financial-command-controls.js');
check(controls.includes('journalClaim=await claimPayables(db,[prepared.linkedPayableId]') && controls.includes('correctionClaim=(original.linkedPayableId||prepared.linkedPayableId)?await claimPayables(') && controls.includes('reimbursementClaim=reimbursementId?await claimPayables('), 'Manual journals, journal corrections and personal-funding reversals that change a bill must claim it.');
check(close.includes('if (!isReverse && (await db.ref(`/financialMovements/${commandId}`).get()).exists()) return {documentId: docId, movementId: commandId, duplicate: true};') && entry.includes('if(alreadyPosted)return{movementId:commandId,duplicate:true};if(!reference)'), 'A retried payment that already posted must return duplicate, not an error.');
check(purchase.includes('`purchase_reverse_${invoiceId}_${crypto.randomBytes(6).toString("hex")}`'), 'Each purchase reversal request must hold its own claim, so two cannot run at once.');
check(close.includes('invoiceReference:financeText(doc.ref,120),purchaseInvoiceId:financeText(doc.purchaseInvoiceId,160),movementId:commandId,custodyAllocations'), 'The payment audit row must trace to the movement, the supplier invoice and any cash custody used.');
check(read('functions/index.js').includes('async function claimPayables('), 'The functions bundle must include the claim routine (run npm run build:artifacts).');

if (failures.length) { console.error(`FAIL: ${failures.length} payable settlement claim check(s)\n- ${failures.join('\n- ')}`); process.exit(1); }
console.log('PASS: concurrent payments on one bill post once, retries use the fresh balance, failures release their claims, and every bill-changing path claims before it reads.');
