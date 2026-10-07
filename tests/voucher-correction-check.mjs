/* Approved Cash Voucher correction + projection integrity (7 Oct 2026).

   Incident: PV-202610-0015 (₱1,400, paid from a bank account) was approved dated 28 Oct, 21 days
   ahead. An approved voucher's date could not be edited (void and re-enter only), and Edit always
   posted the correction against Undeposited Collection — a bank-paid voucher's amount change would
   have moved Undeposited Collection cash. The same day the Undeposited Collection screen showed
   custody ₱2,664.01 above the ledger and a false "approved payment missing" banner, because two
   trigger-maintained projections were overwritten by out-of-order trigger runs.

   This runs the real Cloud Functions bundle against the in-memory database and proves:
   - an approved voucher's date / amount / category is corrected by reversing its CURRENT posting on
     its own date and re-posting on the new date, in one write, against its real funding account
     (bank register rows included; Undeposited custody moved only by the difference);
   - both months must be open, reconciled bank rows and legacy-corrected vouchers are refused,
     cash vouchers can never be future-dated (create / approve / correct);
   - the approval binds the exact change and reason, a non-Super-Admin cannot approve their own
     correction, a cross-month move needs Admin+, and a Super Admin's self-approval is audited only;
   - the open-custody projection is written with the custody rows, the racy custody trigger is removed, and the
     Undeposited Collection snapshot repairs and logs any drift. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createFakeDatabase} from './helpers/fake-rtdb.mjs';
import {loadFunctions} from './helpers/functions-sandbox.mjs';
import {createRequire} from 'node:module';
// The Functions bundle runs in a VM realm; hand write-safety plain host-realm objects.
const realWriteSafety = createRequire(import.meta.url)('../functions/lib/write-safety.js');
const writeSafety = {...realWriteSafety, safeAtomicUpdate: (db, writes) => realWriteSafety.safeAtomicUpdate(db, structuredClone(writes))};

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const rules = read('database.rules.json');
const NOW = Date.parse('2026-10-07T18:00:00+08:00');
const at = (date) => Date.parse(`${date}T00:00:00+08:00`);
const L = (account, debit, credit) => ({account, debit, credit, label: account});
const bankVoucher = (extra) => Object.assign({voucherNo: 'PV-202610-0015', status: 'approved', amount: 1400, date: '2026-10-28', transactionType: 'expense', category: 'office_supplies', recipient: 'MARIA', requesterName: 'MARIA', createdBy: 'alex', purpose: 'IRL 626965320396 - PAYMENT FOR TIKTOK ADS', fundingAccountId: 'acc_bank', hasReceipt: false, approvedAt: NOW - 3600000}, extra || {});
const world = () => ({
  admins: {super_uid: 'superadmin', mgr_uid: 'manager', mgr2_uid: 'manager', admin_uid: 'admin'},
  accountingPeriods: {'2026-08': {status: 'closed'}},
  cashBalanceSummary: {meta: {schemaVersion: 4, complete: true}, balances: {undepositedCents: 300000}},
  undepositedPageIndexMeta: {schemaVersion: 1, complete: true},
  pettyCashVouchers: {
    V_BANK: bankVoucher(),
    V_HAND: bankVoucher({voucherNo: 'PV-202610-0018', date: '2026-10-01', fundingAccountId: 'cash_on_hand', purpose: 'CASH-PAID OFFICE SUPPLIES'}),
    V_POOL: bankVoucher({voucherNo: 'PV-202610-0017', amount: 3843, date: '2026-09-29', fundingAccountId: 'undeposited', purpose: 'PAYMENT FOR FUEL'}),
    V_PEND: bankVoucher({voucherNo: '', status: 'pending', date: '2026-10-28'}),
    V_LEGACY: bankVoucher({voucherNo: 'PV-202609-0009', correctionRevision: 1, correctionMovementIds: {1: 'petty_correct_V_LEGACY_1'}}),
    V_RECON: bankVoucher({voucherNo: 'PV-202610-0011', date: '2026-10-03'}),
    V_AUG: bankVoucher({voucherNo: 'PV-202608-0003', date: '2026-08-15'}),
    V_STAFF: bankVoucher({voucherNo: 'PV-202610-0012', transactionType: 'staff_advance', conversionMovementId: 'controlled'}),
  },
  financialMovements: {
    opening_undeposited: {type: 'opening_balance', sourceType: 'cashAccount', sourceId: 'undeposited', occurredAt: at('2026-09-01'), lines: [L('asset:cash_awaiting_deposit', 6843, 0), L('equity:opening_balance', 0, 6843)]},
    petty_V_BANK: {type: 'petty_cash_expense', sourceType: 'pettyVoucher', sourceId: 'V_BANK', occurredAt: at('2026-10-28'), lines: [L('expense:office_supplies', 1400, 0), L('asset:cash_account:acc_bank', 0, 1400)]},
    petty_V_HAND: {type: 'petty_cash_expense', sourceType: 'pettyVoucher', sourceId: 'V_HAND', occurredAt: at('2026-10-01'), lines: [L('expense:office_supplies', 1400, 0), L('asset:register_cash', 0, 1400)]},
    petty_V_POOL: {type: 'petty_cash_expense', sourceType: 'pettyVoucher', sourceId: 'V_POOL', occurredAt: at('2026-09-29'), lines: [L('expense:office_supplies', 3843, 0), L('asset:cash_awaiting_deposit', 0, 3843)]},
    petty_V_RECON: {type: 'petty_cash_expense', sourceType: 'pettyVoucher', sourceId: 'V_RECON', occurredAt: at('2026-10-03'), lines: [L('expense:office_supplies', 1400, 0), L('asset:cash_account:acc_bank', 0, 1400)]},
    petty_V_AUG: {type: 'petty_cash_expense', sourceType: 'pettyVoucher', sourceId: 'V_AUG', occurredAt: at('2026-08-15'), lines: [L('expense:office_supplies', 1400, 0), L('asset:cash_account:acc_bank', 0, 1400)]},
  },
  cfLedger: {
    fm_petty_V_BANK: {accountId: 'acc_bank', dir: 'out', amount: 1400, date: '2026-10-28', movementId: 'petty_V_BANK', source: 'pettyVoucher', linkId: 'V_BANK'},
    fm_petty_V_HAND: {accountId: 'cash_on_hand', dir: 'out', amount: 1400, date: '2026-10-01', movementId: 'petty_V_HAND', source: 'pettyVoucher', linkId: 'V_HAND'},
    fm_petty_V_RECON: {accountId: 'acc_bank', dir: 'out', amount: 1400, date: '2026-10-03', movementId: 'petty_V_RECON', source: 'pettyVoucher', linkId: 'V_RECON', bankReconciled: true},
  },
  cashCustody: {
    C1: {shiftId: 'C1', amount: 5000, paidOutAmount: 4000, depositedAmount: 0, remaining: 1000, closedAt: 1, status: 'partially_paid_out'},
    C2: {shiftId: 'C2', amount: 2000, paidOutAmount: 0, depositedAmount: 0, remaining: 2000, closedAt: 2, status: 'awaiting_deposit'},
    J: {shiftId: 'J', amount: 2997, paidOutAmount: 2997, depositedAmount: 0, remaining: 0, closedAt: 0, status: 'paid_out'},
  },
  // The 7 Oct state: J shows ₱2,664.01 in the projection although it is fully paid out.
  cashCustodyOpenIndex: {
    C1: {id: 'C1', amount: 5000, paidOutAmount: 4000, depositedAmount: 0, remaining: 1000, closedAt: 1},
    C2: {id: 'C2', amount: 2000, paidOutAmount: 0, depositedAmount: 0, remaining: 2000, closedAt: 2},
    J: {id: 'J', amount: 2997, paidOutAmount: 332.99, depositedAmount: 0, remaining: 2664.01, closedAt: 0},
  },
  pettyVoucherPostingIndex: {V_BANK: 'petty_V_BANK', V_POOL: 'petty_V_POOL'},
  pettyVoucherAttentionIndex: {missing: {V_BANK: {id: 'V_BANK', voucherNo: 'PV-202610-0015', amount: 1400, status: 'approved'}}},
});

const db = createFakeDatabase(world(), {rules});
const fx = loadFunctions(db, {now: NOW, expose: ['voucherChangeFingerprint'], libOverrides: {'./lib/write-safety': writeSafety}});
const F = fx.exports, fingerprint = fx.internal.voucherChangeFingerprint;
const val = async (p) => (await db.ref(p).get()).val();
let approvals = 0;
async function approve(voucherId, change, {by = 'super_uid', role = 'superadmin', name = 'SuperdaD'} = {}) {
  const id = `approval_t${++approvals}`;
  const bound = Object.assign({approverName: '', reason: 'Wrong date entered'}, change);
  await db.ref(`financialApprovals/${id}`).set({action: 'correct_petty_voucher', sourceId: voucherId, amount: bound.amount, approvedBy: by, approvedRole: role, approvedName: name, approvedAt: NOW, expiresAt: NOW + 300000, changeHash: fingerprint(voucherId, bound)});
  return id;
}
const correct = (uid, voucherId, cmd, approvalId) => F.managePettyVoucher({auth: {uid, token: {}}, data: Object.assign({action: 'correct', voucherId, reason: 'Wrong date entered', approverName: ''}, cmd, {approvalId})});
const refused = async (promise, pattern, label) => { await assert.rejects(promise, (e) => pattern.test(String(e && e.message)), label); };
const fundingNet = (mv, account) => (mv.lines || []).reduce((s, l) => s + (l.account === account ? Number(l.debit || 0) - Number(l.credit || 0) : 0), 0);
const balanced = (mv) => Math.abs((mv.lines || []).reduce((s, l) => s + Number(l.debit || 0) - Number(l.credit || 0), 0)) < 0.005;
const bankGlVsRegister = async (account) => {
  const movements = await val('financialMovements'), ledger = await val('cfLedger');
  const gl = Object.values(movements).filter((m) => /V_BANK/.test(m.sourceId)).reduce((s, m) => s + fundingNet(m, `asset:cash_account:${account}`), 0);
  const reg = Object.values(ledger).filter((r) => r.linkId === 'V_BANK').reduce((s, r) => s + (r.dir === 'in' ? r.amount : -r.amount), 0);
  return [Math.round(gl * 100) / 100, Math.round(reg * 100) / 100];
};

/* 1. Date correction of a bank-paid voucher (the PV-202610-0015 case), Super Admin self-approved. */
const base = {category: 'office_supplies', payee: 'MARIA', supplierId: '', purpose: 'IRL 626965320396 - PAYMENT FOR TIKTOK ADS'};
let change = Object.assign({expectedRev: 0, date: '2026-10-02', amount: 1400}, base);
const r1 = await correct('super_uid', 'V_BANK', {date: '2026-10-02', amount: 1400, category: 'office_supplies', payee: 'MARIA', purpose: base.purpose}, await approve('V_BANK', change));
assert.equal(r1.financial, true); assert.equal(r1.selfApproved, true, 'a Super Admin may approve their own correction, and it is recorded as self-approved');
const rev1 = await val('financialMovements/petty_corr_V_BANK_r1_rev'), post1 = await val('financialMovements/petty_corr_V_BANK_r1_post');
assert.ok(rev1 && post1, 'the reversal and the corrected posting are both recorded');
assert.equal(rev1.occurredAt, at('2026-10-28'), 'the reversal is dated on the original posting date');
assert.equal(post1.occurredAt, at('2026-10-02'), 'the corrected posting is dated on the new voucher date');
assert.ok(balanced(rev1) && balanced(post1), 'both movements balance');
assert.equal(fundingNet(rev1, 'asset:cash_account:acc_bank'), 1400); assert.equal(fundingNet(post1, 'asset:cash_account:acc_bank'), -1400);
for (const mv of [rev1, post1]) assert.ok(!mv.lines.some((l) => l.account === 'asset:cash_awaiting_deposit'), 'a bank-paid voucher correction never touches Undeposited Collection');
assert.equal((await val('cfLedger/fm_petty_corr_V_BANK_r1_rev')).date, '2026-10-28'); assert.equal((await val('cfLedger/fm_petty_corr_V_BANK_r1_rev')).dir, 'in');
assert.equal((await val('cfLedger/fm_petty_corr_V_BANK_r1_post')).date, '2026-10-02'); assert.equal((await val('cfLedger/fm_petty_corr_V_BANK_r1_post')).dir, 'out');
assert.deepEqual(...(await bankGlVsRegister('acc_bank')), 'the bank register equals the bank GL after the correction');
let v = await val('pettyCashVouchers/V_BANK');
assert.equal(v.date, '2026-10-02'); assert.equal(v.correctionRevision, 1); assert.equal(v.effectivePosting.movementId, 'petty_corr_V_BANK_r1_post');
assert.equal(v.corrections[1].selfApproved, true); assert.equal(v.voucherNo, 'PV-202610-0015', 'the PV number never changes');
assert.ok((await val('financialApprovals/approval_t1')).usedAt, 'the approval is spent');
assert.ok(!read('src/functions/44-reconciliation.js').includes('cash_voucher_self_approved_correction'), 'Super Admin self-approval stays in the audit trail and never becomes an Exception Center item');

/* 2. Correcting a correction: reverse the LATEST posting on its date; independent manager approval. */
change = Object.assign({expectedRev: 1, date: '2026-10-02', amount: 1500}, base);
await refused(correct('mgr_uid', 'V_BANK', {date: '2026-10-02', amount: 1500, category: 'marketing', payee: 'MARIA', purpose: base.purpose}, await approve('V_BANK', change, {by: 'mgr2_uid', role: 'manager', name: 'Rya'})), /does not match/, 'an approval for one change cannot be spent on a different change');
const r2 = await correct('mgr_uid', 'V_BANK', {date: '2026-10-02', amount: 1500, category: 'office_supplies', payee: 'MARIA', purpose: base.purpose}, await approve('V_BANK', change, {by: 'mgr2_uid', role: 'manager', name: 'Rya'}));
assert.equal(r2.revision, 2); assert.equal(r2.selfApproved, false);
const rev2 = await val('financialMovements/petty_corr_V_BANK_r2_rev');
assert.equal(rev2.reversesMovementId, 'petty_corr_V_BANK_r1_post', 'a second correction reverses the first correction\'s posting, not the original');
assert.equal(rev2.occurredAt, at('2026-10-02')); assert.equal(fundingNet(rev2, 'asset:cash_account:acc_bank'), 1400);
assert.equal(fundingNet(await val('financialMovements/petty_corr_V_BANK_r2_post'), 'asset:cash_account:acc_bank'), -1500);
assert.deepEqual(...(await bankGlVsRegister('acc_bank')));
const [glBank] = await bankGlVsRegister('acc_bank'); assert.equal(glBank, -1500, 'the bank account carries exactly the corrected amount');

/* 3. Approval controls. */
change = Object.assign({expectedRev: 2, date: '2026-10-03', amount: 1500}, base);
await refused(correct('mgr_uid', 'V_BANK', {date: '2026-10-03', amount: 1500, category: 'office_supplies', payee: 'MARIA', purpose: base.purpose}, await approve('V_BANK', change, {by: 'mgr_uid', role: 'manager', name: 'Mgr'})), /different manager/, 'a manager cannot approve their own correction');
const reasonBound = Object.assign({}, change, {reason: 'Approved reason'});
await refused(correct('mgr_uid', 'V_BANK', {date: '2026-10-03', amount: 1500, category: 'office_supplies', payee: 'MARIA', purpose: base.purpose, reason: 'Changed after approval'}, await approve('V_BANK', reasonBound, {by: 'mgr2_uid', role: 'manager', name: 'Rya'})), /does not match/, 'the written correction reason cannot change after approval');
change = Object.assign({expectedRev: 2, date: '2026-09-30', amount: 1500}, base);
await refused(correct('mgr_uid', 'V_BANK', {date: '2026-09-30', amount: 1500, category: 'office_supplies', payee: 'MARIA', purpose: base.purpose}, await approve('V_BANK', change, {by: 'mgr2_uid', role: 'manager', name: 'Rya'})), /another month/, 'moving a voucher to another month needs Admin or Super Admin');

/* 4. Dates and periods. */
change = Object.assign({expectedRev: 2, date: '2026-10-08', amount: 1500}, base);
await refused(correct('super_uid', 'V_BANK', {date: '2026-10-08', amount: 1500, category: 'office_supplies', payee: 'MARIA', purpose: base.purpose}, await approve('V_BANK', change)), /in the future/, 'a correction can never future-date a voucher');
change = Object.assign({expectedRev: 0, date: '2026-09-01', amount: 1400}, base);
await refused(correct('super_uid', 'V_AUG', {date: '2026-09-01', amount: 1400, category: 'office_supplies', payee: 'MARIA', purpose: base.purpose}, await approve('V_AUG', change)), /2026-08 is closed/, 'the original month must be open');
change = Object.assign({expectedRev: 0, date: '2026-08-20', amount: 1400}, base);
await refused(correct('super_uid', 'V_RECON', {date: '2026-08-20', amount: 1400, category: 'office_supplies', payee: 'MARIA', purpose: base.purpose}, await approve('V_RECON', change)), /2026-08 is closed/, 'the new month must be open');
change = Object.assign({expectedRev: 0, date: '2026-10-04', amount: 1400}, base);
await refused(correct('super_uid', 'V_RECON', {date: '2026-10-04', amount: 1400, category: 'office_supplies', payee: 'MARIA', purpose: base.purpose}, await approve('V_RECON', change)), /reconciled/, 'a bank-reconciled payment cannot be re-posted');
await refused(correct('super_uid', 'V_LEGACY', {date: '2026-10-04', amount: 1400, category: 'office_supplies', payee: 'MARIA', purpose: base.purpose}, 'approval_none'), /earlier method|missing, expired/, 'a voucher corrected under the old single-movement method is refused');
await refused(correct('super_uid', 'V_STAFF', {date: '2026-10-04', amount: 1400, category: 'office_supplies', payee: 'MARIA', purpose: base.purpose}, 'approval_none'), /cannot be edited in place/, 'controlled types stay void-only');
await refused(correct('super_uid', 'V_RECON', {date: '2026-10-03', amount: 1400, category: 'office_supplies', payee: 'MARIA', purpose: base.purpose}, 'approval_none'), /Nothing was changed/, 'a no-op correction is refused');
await refused(F.managePettyVoucher({auth: {uid: 'super_uid', token: {}}, data: {action: 'approve', voucherId: 'V_PEND', approvalId: 'approval_none'}}), /in the future/, 'a future-dated pending voucher cannot be approved');
await refused(F.managePettyVoucher({auth: {uid: 'super_uid', token: {}}, data: {action: 'correct', voucherId: 'V_PEND', date: '2026-10-09', amount: 1400, category: 'office_supplies', payee: 'MARIA', purpose: 'x', reason: 'r'}}), /in the future/, 'a pending voucher cannot be edited to a future date');

/* 5. Undeposited Collection funding: custody moves by the difference only, projection written with it. */
change = Object.assign({expectedRev: 0, date: '2026-09-29', amount: 4000}, base, {purpose: 'PAYMENT FOR FUEL', category: 'transport'});
await correct('super_uid', 'V_POOL', {date: '2026-09-29', amount: 4000, category: 'transport', payee: 'MARIA', purpose: 'PAYMENT FOR FUEL'}, await approve('V_POOL', change));
const poolRev = await val('financialMovements/petty_corr_V_POOL_r1_rev'), poolPost = await val('financialMovements/petty_corr_V_POOL_r1_post');
assert.equal(fundingNet(poolRev, 'asset:cash_awaiting_deposit') + fundingNet(poolPost, 'asset:cash_awaiting_deposit'), -157, 'Undeposited Collection moves by the ₱157 increase only');
assert.ok(poolPost.lines.some((l) => l.account === 'expense:transportation' && l.debit === 4000), 'the corrected category is posted');
assert.equal((await val('cashCustody/C1')).remaining, 843, 'the increase is drawn FIFO from custody');
assert.equal((await val('cashCustodyOpenIndex/C1')).remaining, 843, 'the open-custody projection is written in the same update');
change = Object.assign({expectedRev: 1, date: '2026-09-29', amount: 3800}, base, {purpose: 'PAYMENT FOR FUEL', category: 'transport'});
await correct('super_uid', 'V_POOL', {date: '2026-09-29', amount: 3800, category: 'transport', payee: 'MARIA', purpose: 'PAYMENT FOR FUEL'}, await approve('V_POOL', change));
assert.equal((await val('cashCustody/corr_V_POOL_r2')).remaining, 200, 'a decrease returns the difference to custody');
assert.equal((await val('cashCustodyOpenIndex/corr_V_POOL_r2')).remaining, 200, 'and its projection is written with it');

/* 6. Payee / purpose only: audited, no Finance posting. */
const before = Object.keys(await val('financialMovements')).length;
change = Object.assign({expectedRev: 2, date: '2026-10-02', amount: 1500}, base, {purpose: 'TikTok ads Oct'});
const meta = await correct('super_uid', 'V_BANK', {date: '2026-10-02', amount: 1500, category: 'office_supplies', payee: 'MARIA', purpose: 'TikTok ads Oct'}, await approve('V_BANK', change));
assert.equal(meta.financial, true); assert.equal(Object.keys(await val('financialMovements')).length, before + 2, 'a description edit reverses and re-posts so Books and the bank register carry the same detail');
assert.equal((await val('pettyCashVouchers/V_BANK')).purpose, 'TikTok ads Oct');

/* 7. Cash in Register and Cash on Hand never fund a cash payment, including legacy corrections. */
const handChange = Object.assign({expectedRev: 0, date: '2026-10-02', amount: 1450}, base, {purpose: 'CASH-PAID OFFICE SUPPLIES'});
await refused(correct('super_uid', 'V_HAND', {date: '2026-10-02', amount: 1450, category: 'office_supplies', payee: 'MARIA', purpose: 'CASH-PAID OFFICE SUPPLIES'}, await approve('V_HAND', handChange)), /Cash in Register and Cash on Hand/, 'a historical Cash on Hand voucher must be voided and re-entered through an allowed funding source');

/* 8. Concurrent corrections serialize on the voucher; one wins and one must refresh. */
const current = await val('pettyCashVouchers/V_BANK'), expectedRev = current.correctionRevision;
const changeA = Object.assign({expectedRev, date: current.date, amount: 1510}, base, {purpose: 'Parallel A'}), changeB = Object.assign({expectedRev, date: current.date, amount: 1520}, base, {purpose: 'Parallel B'});
const concurrent = await Promise.allSettled([
  correct('mgr_uid', 'V_BANK', {date: current.date, amount: 1510, category: 'office_supplies', payee: 'MARIA', purpose: 'Parallel A'}, await approve('V_BANK', changeA, {by: 'mgr2_uid', role: 'manager', name: 'Rya'})),
  correct('admin_uid', 'V_BANK', {date: current.date, amount: 1520, category: 'office_supplies', payee: 'MARIA', purpose: 'Parallel B'}, await approve('V_BANK', changeB, {by: 'mgr2_uid', role: 'manager', name: 'Rya'})),
]);
assert.equal(concurrent.filter((row) => row.status === 'fulfilled').length, 1, 'only one concurrent correction may post');
assert.equal(concurrent.filter((row) => row.status === 'rejected').length, 1, 'the losing correction is told to refresh');

/* 9. Missing bank-register evidence blocks correction instead of creating a register imbalance. */
await db.ref('pettyCashVouchers/V_BAD').set(bankVoucher({voucherNo: 'PV-BAD', date: '2026-10-01'}));
await db.ref('financialMovements/petty_V_BAD').set({type: 'petty_cash_expense', sourceType: 'pettyVoucher', sourceId: 'V_BAD', occurredAt: at('2026-10-01'), lines: [L('expense:office_supplies', 1400, 0), L('asset:cash_account:acc_bank', 0, 1400)]});
const badChange = Object.assign({expectedRev: 0, date: '2026-10-02', amount: 1400}, base);
await refused(correct('super_uid', 'V_BAD', {date: '2026-10-02', amount: 1400, category: 'office_supplies', payee: 'MARIA', purpose: base.purpose}, await approve('V_BAD', badChange)), /bank-register entry is missing/, 'a missing bank-register row must be repaired before correction');

/* 7. Snapshot detective control: the 7 Oct stale projection and false "missing" flag self-repair. */
const snap = await F.getUndepositedControlSnapshot({auth: {uid: 'super_uid', token: {}}, data: {}});
const custodyTruth = Object.values(await val('cashCustody')).reduce((s, r) => s + Number(r.remaining || 0), 0);
assert.equal(snap.custodyRemaining, Math.round(custodyTruth * 100) / 100, 'custody shown = authoritative custody rows');
assert.equal(await val('cashCustodyOpenIndex/J'), null, 'the stale ₱2,664.01 projection row is removed');
assert.ok(snap.indexVerification.custodyRowsRepaired >= 1 && snap.indexVerification.missingVouchersCleared === 1, 'the repair is reported');
assert.equal(snap.missingApprovedVouchers.length, 0, 'the false "missing payment" banner is gone');
assert.equal(await val('pettyVoucherAttentionIndex/missing/V_BANK'), null);
assert.ok(Object.values(await val('operationalAudit')).some((r) => r && r.action === 'repair_undeposited_custody_index'), 'the repair is in the audit log');

/* 11. The racy custody mirror trigger is gone; financial writes own row + projection together. */
assert.equal(typeof F.syncCashCustodyPageIndex, 'undefined', 'an out-of-order custody trigger can no longer overwrite the atomic projection');
let stale = true;
const racing = {ref: (p) => (stale && /pettyVoucherPostingIndex\/V_RACE$/.test(p) ? {get: async () => { stale = false; return {exists: () => false, val: () => null}; }} : db.ref(p))};
await db.ref('pettyVoucherPostingIndex/V_RACE').set('petty_V_RACE');
const fx2 = loadFunctions(racing, {now: NOW, libOverrides: {'./lib/write-safety': writeSafety}}).exports;
await fx2.syncPettyVoucherAttentionIndex({params: {voucherId: 'V_RACE'}, data: {after: {exists: () => true, val: () => bankVoucher({voucherNo: 'PV-RACE'})}}});
assert.equal(await val('pettyVoucherAttentionIndex/missing/V_RACE'), null, 'a voucher trigger that read the posting index too early removes its own false "missing" flag');

/* 12. A later void returns the corrected bank amount in both Books and the bank register. */
const beforeVoid = await val('pettyCashVouchers/V_BANK'), afterVoid = Object.assign({}, beforeVoid, {voided: true, voidedAt: NOW, status: 'approved'});
await F.onPettyVoucherFinancial({params: {voucherId: 'V_BANK'}, data: {before: {val: () => beforeVoid}, after: {val: () => afterVoid}}});
assert.deepEqual(await bankGlVsRegister('acc_bank'), [0, 0], 'voiding a corrected bank voucher clears both the GL and bank register');

/* 13. Screens. */
const fund = read('src/admin/register/40-revolving-fund.js'), approval = read('assets/js/admin/manager-approval.mjs');
assert.ok(fund.includes("fields.push({name:'date',label:'Payment date',type:'date',required:true,max:today,value:v.date||today,validate:noFuture"), 'Edit offers the date on approved vouchers too, never in the future');
assert.ok(fund.includes("{change:change,requireIndependent:authz.role!=='superadmin'}"), 'Edit asks a different approver for every role except Super Admin');
assert.ok(fund.includes('max="\'+today+\'"') && fund.includes("if(date>window.AccazaDate.key()){alert('Cash vouchers cannot be future-dated."), 'a new voucher cannot be future-dated');
assert.ok(approval.includes('change:change||null') && approval.includes('options&&options.change'), 'the approval request carries the change to the server');
assert.ok(read('functions/index.js').includes('async function correctApprovedPettyVoucher('), 'the deployed bundle carries the correction (run npm run build:artifacts)');
console.log('PASS: approved cash vouchers correct by reversal on the original date + re-post on the new date against their real funding account, cannot be future-dated, approvals bind the exact change with segregation of duties, and the Undeposited Collection projections are written atomically, converge, and self-repair with an audit trail.');
