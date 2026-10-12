/* Re-dating a void reversal that landed in the wrong month (owner report, Oct 2026).

   PV-202610-0034: an owner withdrawal dated 29 Sep 2026 was created, approved and voided inside six
   minutes on 10 Oct 2026, so the withdrawal posted in September and its reversal in October. Both
   months were misstated and the September Undeposited Collection / bank position could not tie.

   This runs the real Cloud Functions bundle against the in-memory database and proves the correction
   command re-dates the reversal that already exists — the movement, its Finance Books journal, the
   custody return row and the Admin ledger projection — at the SAME movement id, leaving amounts,
   accounts and custody totals unchanged, preserving the time the void was executed, auditing the
   change, and refusing a closed month, a missing reason, an insufficient role and an impossible date.
   Re-running it changes nothing. */
import assert from 'node:assert/strict';
import {createFakeDatabase} from './helpers/fake-rtdb.mjs';
import {loadFunctions} from './helpers/functions-sandbox.mjs';
import {createRequire} from 'node:module';

const realWriteSafety = createRequire(import.meta.url)('../functions/lib/write-safety.js');
const writeSafety = {...realWriteSafety, safeAtomicUpdate: (db, writes) => realWriteSafety.safeAtomicUpdate(db, structuredClone(writes))};
const at = (date) => Date.parse(`${date}T00:00:00+08:00`);
const L = (account, debit, credit) => ({account, debit, credit, label: account});
const EXECUTED = at('2026-10-10') + 7.5 * 3600000;   // the live record: voided 10 Oct 2026 07:30
const NOW = at('2026-10-10') + 18 * 3600000;
const ownerVoucher = (extra) => Object.assign({
  voucherNo: 'PV-202610-0034', status: 'approved', amount: 5075, date: '2026-09-29', transactionType: 'owner_withdrawal',
  category: 'owner_draw', recipient: 'ALEX', requesterName: 'ALEX', purpose: 'Owner withdrawal — Owner\'s Drawings (3100)',
  approvedBy: 'Danilo', approvedAt: EXECUTED - 325000, createdAt: EXECUTED - 360000, fundingAccountId: 'undeposited',
  hasReceipt: false, voided: true, voidedAt: EXECUTED, voidReason: 'VOID', voidedBy: 'dmmagbual',
}, extra || {});
const world = (extra = {}) => Object.assign({
  admins: {super_uid: 'superadmin', owner_uid: 'owner', mgr_uid: 'manager'},
  accountingPeriods: {},
  pettyCashVouchers: {V_OWNER: ownerVoucher()},
  financialMovements: {
    petty_V_OWNER: {type: 'revolving_fund_owner_withdrawal', sourceType: 'pettyVoucher', sourceId: 'V_OWNER', voucherNo: 'PV-202610-0034', occurredAt: at('2026-09-29'), lines: [L('equity:owner_draw', 5075, 0), L('asset:cash_awaiting_deposit', 0, 5075)]},
    petty_void_V_OWNER: {id: 'petty_void_V_OWNER', type: 'revolving_fund_owner_withdrawal_void', sourceType: 'pettyVoucher', sourceId: 'V_OWNER', voucherNo: 'PV-202610-0034', amount: 5075, occurredAt: EXECUTED, postedAt: EXECUTED + 800, documentNo: 'JE-2026-1000', lines: [L('asset:cash_awaiting_deposit', 5075, 0), L('equity:owner_draw', 0, 5075)]},
  },
  books: {journal: {petty_void_V_OWNER: {id: 'petty_void_V_OWNER', date: '2026-10-10', ref: 'JE-2026-1000', source: 'pos-bridge', sourceType: 'pettyVoucher', sourceId: 'V_OWNER', lines: [{code: '1001', debit: 5075, credit: 0}, {code: '3100', debit: 0, credit: 5075}]}}},
  cashCustody: {petty_void_V_OWNER: {shiftId: 'petty_void_V_OWNER', staff: 'Expense voided', amount: 5075, depositedAmount: 0, remaining: 5075, retainedFloat: 0, status: 'awaiting_deposit', closedAt: EXECUTED, movementId: 'petty_void_V_OWNER', source: 'pool_inflow', schemaVersion: 2}},
  cashCustodyOpenIndex: {petty_void_V_OWNER: {id: 'petty_void_V_OWNER', amount: 5075, paidOutAmount: 0, depositedAmount: 0, remaining: 5075, closedAt: EXECUTED, movementId: 'petty_void_V_OWNER', source: 'pool_inflow'}},
  undepositedLedgerPageIndex: {petty_void_V_OWNER: {id: 'petty_void_V_OWNER', occurredAt: EXECUTED, type: 'revolving_fund_owner_withdrawal_void', sourceId: 'V_OWNER', sourceType: 'pettyVoucher', voucherNo: 'PV-202610-0034', inAmount: 5075, outAmount: 0, netAmount: 5075}},
}, extra);
const setup = (extra) => {
  const db = createFakeDatabase(world(extra));
  return {db, F: loadFunctions(db, {now: NOW, libOverrides: {'./lib/write-safety': writeSafety}}).exports};
};
const val = async (db, path) => (await db.ref(path).get()).val();
const req = (uid, data) => ({auth: {uid, token: {}}, data});
const refused = async (promise, pattern, label) => { await assert.rejects(promise, (e) => (typeof pattern === 'function' ? pattern(e) : pattern.test(String(e && e.message))), label); };

/* 1. The mis-dated reversal is found, previewed and corrected in place. */
{
  const {db, F} = setup();
  const found = await F.repairReversalAccountingDate(req('super_uid', {action: 'candidates'}));
  assert.equal(found.candidates.length, 1, 'the mis-dated void is discoverable as a candidate');
  assert.deepEqual([found.candidates[0].paidDate, found.candidates[0].reversalDate, found.candidates[0].voucherNo], ['2026-09-29', '2026-10-10', 'PV-202610-0034']);

  const preview = await F.repairReversalAccountingDate(req('super_uid', {action: 'preview', voucherId: 'V_OWNER'}));
  assert.deepEqual([preview.currentDate, preview.targetDate, preview.journalDate, preview.custodyDate, preview.custodyRemaining, preview.movesMonth, preview.registerLocked, preview.canApply], ['2026-10-10', '2026-09-29', '2026-10-10', '2026-10-10', 5075, true, false, true]);

  const applied = await F.repairReversalAccountingDate(req('super_uid', {action: 'apply', voucherId: 'V_OWNER', accountingDate: '2026-09-29', reason: 'The cash came back the day it was paid; the void was recorded on 10 Oct'}));
  assert.equal(applied.duplicate, false);
  const movement = await val(db, 'financialMovements/petty_void_V_OWNER');
  assert.equal(movement.occurredAt, at('2026-09-29'), 'the reversal moves to the day the cash came back');
  assert.equal(movement.reversalAccountingDateRepair.fromDate, '2026-10-10', 'the original date stays in the audit trail');
  assert.equal(movement.documentNo, 'JE-2026-1000', 'the document number is untouched');
  assert.deepEqual(movement.lines, [L('asset:cash_awaiting_deposit', 5075, 0), L('equity:owner_draw', 0, 5075)], 'the posting itself is unchanged');
  const journal = await val(db, 'books/journal/petty_void_V_OWNER');
  assert.equal(journal.date, '2026-09-29', 'Finance Books moves the journal into September');
  assert.equal(journal.reversalDateRevision, 1, 'the journal carries a revision stamp');
  assert.equal((await val(db, 'cashCustody/petty_void_V_OWNER')).closedAt, at('2026-09-29'), 'the custody return row moves with it');
  assert.equal((await val(db, 'cashCustody/petty_void_V_OWNER')).remaining, 5075, 'custody totals are unchanged');
  assert.equal((await val(db, 'cashCustodyOpenIndex/petty_void_V_OWNER')).closedAt, at('2026-09-29'));
  assert.equal((await val(db, 'undepositedLedgerPageIndex/petty_void_V_OWNER')).occurredAt, at('2026-09-29'), 'the Admin ledger row shows 29 Sep');
  const repaired = await val(db, 'pettyCashVouchers/V_OWNER');
  assert.deepEqual([repaired.reversalAccountingDate, repaired.reversalAccountingTimestamp, repaired.voidedAt], ['2026-09-29', at('2026-09-29'), EXECUTED]);
  assert.ok(Object.values(await val(db, 'operationalAudit') || {}).some((r) => r && r.action === 'repair_reversal_accounting_date'), 'the correction is audited');
  assert.equal((await F.repairReversalAccountingDate(req('super_uid', {action: 'apply', voucherId: 'V_OWNER', accountingDate: '2026-09-29', reason: 'retry'}))).duplicate, true, 're-running the correction changes nothing');
  assert.equal((await F.repairReversalAccountingDate(req('super_uid', {action: 'candidates'}))).candidates.length, 0, 'the corrected void is no longer a candidate');
}

/* 2. A closed month, a missing reason, the wrong role and an impossible date are all refused. */
{
  const {db, F} = setup({accountingPeriods: {'2026-10': {period: '2026-10', status: 'closed'}}});
  await refused(F.repairReversalAccountingDate(req('super_uid', {action: 'apply', voucherId: 'V_OWNER', accountingDate: '2026-09-29', reason: 'late void'})), (e) => e.code === 'failed-precondition', 'a closed October refuses the re-date');
  assert.equal((await val(db, 'financialMovements/petty_void_V_OWNER')).occurredAt, EXECUTED, 'nothing moved');
}
{
  const {F} = setup();
  await refused(F.repairReversalAccountingDate(req('super_uid', {action: 'apply', voucherId: 'V_OWNER', accountingDate: '2026-09-29'})), /correction reason is required/i, 'a reason is required');
  await refused(F.repairReversalAccountingDate(req('mgr_uid', {action: 'apply', voucherId: 'V_OWNER', accountingDate: '2026-09-29', reason: 'late void'})), /Only an Owner, Super Admin or Admin/i, 'a manager cannot apply without an owner-level role');
  await refused(F.repairReversalAccountingDate(req('super_uid', {action: 'apply', voucherId: 'V_OWNER', accountingDate: '2026-13-01', reason: 'typo'})), /not a real calendar date/i, 'an impossible calendar date is refused, not silently ignored');
  await refused(F.repairReversalAccountingDate(req('super_uid', {action: 'apply', voucherId: 'V_OWNER', accountingDate: '2026-09-01', reason: 'before the payment'})), /cannot be dated before the payment/i, 'a reversal before the payment date is refused');
}
console.log('PASS: a mis-dated void reversal is re-dated in place at the same movement id — movement, Finance Books journal, custody return row and Admin ledger row all move to the day the cash came back — with amounts, custody totals and the execution time preserved, an audit trail, a closed month, missing reason, insufficient role and impossible date refused, and a no-op on retry.');
