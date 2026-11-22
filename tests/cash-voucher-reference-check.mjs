/* Cash Voucher reference (7 Oct 2026, Danilo's rule).

   Cash Payments vouchers are Cash Vouchers numbered PV-YYYYMM-NNNN. The number used to be drawn on
   the device BEFORE the voucher was saved (a failed save left a gap; an unreachable counter fell back
   to a timestamp number), and Finance Books showed the voucher as "POS revolving fund … pv_<key>"
   under a separate JE number. Now:
   - the server numbers new requests after creation and keeps the number through approval or
     rejection. Approval also numbers older requests that were saved without a number;
   - the voucher's own posting carries that number as its document number, so Finance Books,
     Undeposited Collection and the cash ledger capture the same reference as the voucher;
   - screens and journal text say Cash Voucher, never POS / Revolving Fund / the internal key. */
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
const root = path.join(import.meta.dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const require = createRequire(import.meta.url);
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };

/* ---------- 1. the real numbering helper ---------- */
const sales = read('src/functions/40-sales-finance.js');
const voucherModule = read('src/functions/21-staff-advance-liquidation.js');
const block = voucherModule.slice(voucherModule.indexOf('async function cashVoucherNumber('), voucherModule.indexOf('// End of cash voucher numbering.'));
check(block.startsWith('async function cashVoucherNumber('), 'cashVoucherNumber must be defined in 21-staff-advance-liquidation.js.');
class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
const financeText = (v, n) => String(v == null ? '' : v).trim().slice(0, n || 160);
const financeKey = (v) => String(v);
const date = sales.match(/^function financeDateFromTimestamp\(.*$/m)[0];
const cashVoucherNumber = new Function('financeText', 'financeKey', 'HttpsError', `${date}\n${block}\nreturn cashVoucherNumber;`)(financeText, financeKey, HttpsError);
function fakeDb(data) {
  const at = (p) => p.replace(/^\//, '').split('/').filter(Boolean);
  const get = (p) => at(p).reduce((n, k) => (n == null ? undefined : n[k]), data);
  const set = (p, v) => { const k = at(p), last = k.pop(); let n = data; for (const x of k) n = n[x] = n[x] || {}; n[last] = v; };
  return {data, ref: (p) => ({
    get: async () => ({val: () => structuredClone(get(p) ?? null)}),
    set: async (value) => set(p, structuredClone(value)),
    update: async (writes) => Object.entries(writes).forEach(([key,value]) => set(key,structuredClone(value))),
    /* Admin SDK shape: first pass on an empty cache (null); undefined there aborts; else re-run on the server value. */
    transaction: async (fn) => { const cur = get(p); let next = fn(null); if (next === undefined) return {committed: false, snapshot: {val: () => null}}; if (cur !== undefined) next = fn(cur); if (next === undefined) return {committed: false, snapshot: {val: () => cur}}; set(p, next); return {committed: true, snapshot: {val: () => next}}; },
  })};
}
const key = new Date(Date.now() + 28800000).toISOString().slice(0, 7).replace('-', '');
const db = fakeDb({pettyCashCounter: {[key]: 17}, pettyCashVouchers: {pv_new: {voucherNo: '', status: 'pending'}, pv_old: {voucherNo: 'PV-202609-0004', status: 'pending'}, pv_other: {voucherNo: ''}}});
const first = await cashVoucherNumber(db, Object.assign({}, db.data.pettyCashVouchers.pv_new), 'pv_new');
check(first === `PV-${key}-0018` && db.data.pettyCashVouchers.pv_new.voucherNo === first, `The first approval must issue the next number in the existing monthly series and keep it on the voucher (got ${first}).`);
const retried = await cashVoucherNumber(db, {voucherNo: ''}, 'pv_new');
check(retried === first && db.data.pettyCashCounter[key] === 18, 'A retried approval of the same voucher must reuse its number, never draw a new one.');
const legacy = await cashVoucherNumber(db, Object.assign({}, db.data.pettyCashVouchers.pv_old), 'pv_old');
check(legacy === 'PV-202609-0004' && db.data.pettyCashCounter[key] === 18, 'A voucher that already has a number keeps it (no history is renumbered).');
const race = fakeDb({pettyCashCounter: {}, pettyCashVouchers: {pv_r: {}}});
const [r1, r2] = await Promise.all([cashVoucherNumber(race, {}, 'pv_r'), cashVoucherNumber(race, {}, 'pv_r')]);
check(r1 === r2 && race.data.pettyCashVouchers.pv_r.voucherNo === r1, 'Concurrent approvals of one voucher must agree on a single number.');

/* ---------- 2. pending creation, retries and reuse at approval ---------- */
const attention = read('src/functions/21a-undeposited-pages.js');
const projection = attention.slice(attention.indexOf('function pettyVoucherAttentionProjection('), attention.indexOf('async function voucherHasPostingEvidence('));
const eventHandler = attention.slice(attention.indexOf('async function syncPettyVoucherAttentionEvent('), attention.indexOf('function undepositedCursor('));
const pending = {voucherNo:'',status:'pending',date:'2026-11-30',amount:42,recipient:'Maria'};
const queue = fakeDb({pettyCashVouchers:{pv_created:{...pending},pv_legacy:{...pending},pv_rejected:{...pending,status:'rejected'}}});
let allocatedClaims=0,releases=0,failIssue=false;
const claim = async () => {allocatedClaims++;return {release:async()=>{releases++;}};};
const issue = async (...args) => {if(failIssue)throw new Error('Counter unavailable');return cashVoucherNumber(...args);};
const handler = new Function('getDatabase','claimPettyVoucherMutation','cashVoucherNumber','financeText','financeKey','Financial',`${projection}\n${eventHandler}\nreturn syncPettyVoucherAttentionEvent;`)(()=>queue,claim,issue,financeText,financeKey,{money:Number});
const snap = value => ({exists:()=>value!=null,val:()=>structuredClone(value)});
const event = (id,before,after) => ({params:{voucherId:id},time:'2026-11-30T16:05:00Z',data:{before:snap(before),after:snap(after)}});
const requested = event('pv_created',null,{...pending});
failIssue=true;
try {await handler(requested);check(false,'An allocation failure should retry the creation event.');} catch(error) {check(error.message==='Counter unavailable','The trigger must surface allocation failure for retry.');}
check(queue.data.pettyVoucherAttentionIndex.pending.pv_created.status==='pending'&&releases===1,'A failed number assignment must leave the request visible and release the claim.');
failIssue=false;
await handler(requested);
const created = structuredClone(queue.data.pettyCashVouchers.pv_created);
check(created.voucherNo==='PV-202612-0001'&&created.status==='pending'&&created.amount===42,'The official number must use the creation event’s Manila month and preserve pending status and value.');
await handler(event('pv_created',pending,created));
await handler(requested);
check(queue.data.pettyVoucherAttentionIndex.pending.pv_created.voucherNo===created.voucherNo&&queue.data.pettyCashCounter['202612']===1,'The numbered request must reach the queue and duplicate delivery must keep its number.');
check(await cashVoucherNumber(queue,created,'pv_created')===created.voucherNo&&queue.data.pettyCashCounter['202612']===1,'Approval must reuse the pending voucher number without advancing the counter.');
const verifySource = attention.slice(attention.indexOf('async function verifyPendingVoucherIndex('), attention.indexOf('async function voucherHasPostingEvidence('));
const verify = new Function('financeKey','financeText','Financial',`${verifySource}\nreturn verifyPendingVoucherIndex;`)(financeKey,financeText,{money:Number});
await queue.ref('pettyCashVouchers/pv_created/amount').set(52);
for(const delayedRow of [pending,created]){
  await handler(event('pv_created',pending,delayedRow));
  const [visible] = await verify(queue,queue.data.pettyVoucherAttentionIndex.pending);
  check(visible.voucherNo===created.voucherNo&&visible.amount===52,'A delayed index event must not show an old amount or strip the official PV number from the queue.');
}
await handler(event('pv_legacy',pending,pending));
check(!queue.data.pettyCashVouchers.pv_legacy.voucherNo,'A later update must not backfill a legacy pending request.');
await handler(event('pv_rejected',null,pending));
check(queue.data.pettyCashVouchers.pv_rejected.status==='rejected'&&queue.data.pettyCashVouchers.pv_rejected.voucherNo==='PV-202612-0002'&&!queue.data.pettyVoucherAttentionIndex.pending.pv_rejected,'A new request rejected before numbering keeps its official number and stays out of the pending queue.');
await handler(event('pv_deleted',null,pending));
check(!queue.data.pettyCashVouchers.pv_deleted&&queue.data.pettyCashCounter['202612']===2,'A delayed event must not recreate a removed request or draw a number for it.');
check(allocatedClaims===releases,'All creation-event numbering claims must be released.');

const manage = read('src/functions/21-staff-advance-liquidation.js');
check(manage.includes('const issuedVoucherNo = action === "approve" ? await cashVoucherNumber(db, voucher, id) : "";'), 'The approval path must retain the fallback for older requests.');
check(manage.indexOf('await cashVoucherNumber(') > manage.indexOf('approvalAction = "approve_petty_voucher";'), 'The approval-time fallback must stay behind the existing validation.');
check(manage.includes('all[id] = Object.assign({}, current, {voucherNo: financeText(current.voucherNo, 60) || issuedVoucherNo, status: "approved",'), 'The approved voucher must carry its issued number.');
check(!manage.includes('Revolving Fund voucher not found'), 'Messages must say cash voucher, not Revolving Fund.');

/* ---------- 3. the voucher posting's document number IS the voucher number ---------- */
const rule = 'if (!financeText(record.documentNo, 40) && record.sourceType === "pettyVoucher" && movementId === `petty_${financeText(record.sourceId, 160)}` && /^PV-\\d{6}-\\d{4,}$/.test(financeText(record.voucherNo, 60))) record.documentNo = financeText(record.voucherNo, 60);';
check(sales.includes(rule) && sales.indexOf(rule) < sales.indexOf('if (!financeText(record.documentNo, 40)) {'), 'commitFinancial must give a cash voucher posting the voucher number before any JE number is drawn.');
const pv = /^PV-\d{6}-\d{4,}$/;
check(pv.test('PV-202610-0018') && !pv.test('SA-20261007-ABC123') && !pv.test(''), 'Only real cash voucher numbers become document numbers; system SA/STA vouchers keep their JE number.');
check(read('src/functions/21a-undeposited-pages.js').includes('reference: financeText(movement.reference || movement.documentNo || movement.voucherNo, 120),'), 'Undeposited Collection must show the voucher number as the reference.');
check(read('functions/index.js').includes('async function cashVoucherNumber(') && read('functions/index.js').includes(rule), 'The deployed functions bundle must contain the numbering and the document-number rule (run npm run build:artifacts).');

/* ---------- 4. Finance Books journal text ---------- */
const B = require(path.join(root, 'functions/lib/books-bridge.js'));
const t = Date.parse('2026-10-07T10:00:00+08:00');
const posting = B.buildSingle({id: 'petty_pv_new', type: 'petty_cash_expense', sourceType: 'pettyVoucher', sourceId: 'pv_new', documentNo: 'PV-202610-0018', voucherNo: 'PV-202610-0018', payee: 'MARIA', purpose: 'Cleaning supplies', occurredAt: t, lines: [{account: 'expense:supplies', debit: 89, credit: 0}, {account: 'asset:cash_awaiting_deposit', debit: 0, credit: 89}]}, {}).entry;
check(posting.ref === 'PV-202610-0018', `The journal reference must be the voucher number (got ${posting.ref}).`);
check(posting.memo === 'Cash Voucher PV-202610-0018 — MARIA · Cleaning supplies' && !/POS|revolving|pv_/i.test(posting.memo), `The journal memo must read as a Cash Voucher (got ${posting.memo}).`);
const reversal = B.buildSingle({id: 'petty_void_pv_new', type: 'petty_cash_expense_void', sourceType: 'pettyVoucher', sourceId: 'pv_new', documentNo: 'JE-2026-0900', voucherNo: 'PV-202610-0018', payee: 'MARIA', occurredAt: t, lines: [{account: 'asset:cash_awaiting_deposit', debit: 89, credit: 0}, {account: 'expense:supplies', debit: 0, credit: 89}]}, {}).entry;
check(/^Cash Voucher reversal PV-202610-0018/.test(reversal.memo), 'A voided voucher reads as a Cash Voucher reversal of the same voucher number.');
const shift = B.buildSingle({id: 'x', type: 'shift_cash_to_custody', sourceType: 'shift', sourceId: 'SH-1', documentNo: 'JE-1', occurredAt: t, lines: [{account: 'asset:cash_awaiting_deposit', debit: 1, credit: 0}, {account: 'asset:register_cash', debit: 0, credit: 1}]}, {}).entry;
check(/^POS shift cash to custody/.test(shift.memo), 'Real POS movements keep their POS wording.');

/* ---------- 5. Cash Payments screen ---------- */
const fund = read('src/admin/register/40-revolving-fund.js');
const numbering = fund.slice(fund.indexOf('function nextVoucherNo('), fund.indexOf('function cashVoucherActionsMenu('));
check(numbering.includes("cb('');") && !/runTransaction|pettyCashCounter|Date\.now\(\)/.test(numbering), 'The device must never draw a cash voucher number.');
check(read('assets/js/admin/undeposited.js').includes("esc(v.voucherNo||'PV number pending')"), 'The approval queue must show the official PV number or a pending label.');
check(fund.includes('CASH VOUCHER') && !fund.includes('REVOLVING FUND VOUCHER'), 'The printed voucher must be titled Cash Voucher.');
check(fund.includes("'</td><td>'+cashVoucherActionsMenu(act)+'</td></tr>';") && fund.includes("root.querySelectorAll('details.purchase-actions').forEach("), 'Each voucher row must use one Actions menu.');
check(!read('src/books/app/50-controlled-transactions.js').includes('>Revolving Fund</option>'), 'The retired Revolving Fund must not be offered as a payment source.');

if (failures.length) { console.error(`FAIL: ${failures.length} cash voucher reference check(s)\n- ${failures.join('\n- ')}`); process.exit(1); }
console.log('PASS: the server numbers new cash voucher requests, retries and approval keep that number, and the posting uses it as the Finance Books reference.');
