/* Cash Voucher reference (7 Oct 2026, Danilo's rule).

   Cash Payments vouchers are Cash Vouchers numbered PV-YYYYMM-NNNN. The number used to be drawn on
   the device BEFORE the voucher was saved (a failed save left a gap; an unreachable counter fell back
   to a timestamp number), and Finance Books showed the voucher as "POS revolving fund … pv_<key>"
   under a separate JE number. Now:
   - the server issues the number when the voucher is approved (a rejected or never-approved request
     never takes one), keeps it on the voucher at once, and a retried approval reuses it;
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
const cashVoucherNumber = new Function('financeText', 'financeKey', 'HttpsError', `${block}\nreturn cashVoucherNumber;`)(financeText, financeKey, HttpsError);
function fakeDb(data) {
  const at = (p) => p.replace(/^\//, '').split('/').filter(Boolean);
  const get = (p) => at(p).reduce((n, k) => (n == null ? undefined : n[k]), data);
  const set = (p, v) => { const k = at(p), last = k.pop(); let n = data; for (const x of k) n = n[x] = n[x] || {}; n[last] = v; };
  return {data, ref: (p) => ({
    get: async () => ({val: () => (get(p) === undefined ? null : get(p))}),
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

/* ---------- 2. issued on approval only, kept on the approved voucher ---------- */
const manage = read('src/functions/21-staff-advance-liquidation.js');
check(manage.includes('const issuedVoucherNo = action === "approve" ? await cashVoucherNumber(db, voucher, id) : "";'), 'Only an approval may issue a cash voucher number.');
check(manage.indexOf('await cashVoucherNumber(') > manage.indexOf('approvalAction = "approve_petty_voucher";'), 'The number must be issued only after every approval check has passed.');
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
check(numbering.includes("cb('');") && !/runTransaction|pettyCashCounter|Date\.now\(\)/.test(numbering), 'The device must never draw a cash voucher number (the server issues it on approval).');
check(fund.includes("'<span style=\"color:var(--tl);\">Awaiting approval</span>'"), 'A voucher awaiting approval must say so instead of showing a number.');
check(fund.includes('CASH VOUCHER') && !fund.includes('REVOLVING FUND VOUCHER'), 'The printed voucher must be titled Cash Voucher.');
check(fund.includes("'</td><td>'+cashVoucherActionsMenu(act)+'</td></tr>';") && fund.includes("root.querySelectorAll('details.purchase-actions').forEach("), 'Each voucher row must use one Actions menu.');
check(!read('src/books/app/50-controlled-transactions.js').includes('>Revolving Fund</option>'), 'The retired Revolving Fund must not be offered as a payment source.');

if (failures.length) { console.error(`FAIL: ${failures.length} cash voucher reference check(s)\n- ${failures.join('\n- ')}`); process.exit(1); }
console.log('PASS: cash vouchers are numbered PV-YYYYMM-NNNN by the server on approval (reused on retry, never on the device), the posting carries the voucher number as its Finance Books reference, and screens and journal text say Cash Voucher.');
