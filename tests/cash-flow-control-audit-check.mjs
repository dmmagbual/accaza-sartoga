// Regression coverage for Cash Flow control-audit findings.  These cases use the
// callable itself so the reported exception and its repair contract stay aligned.
import assert from 'node:assert/strict';
import {createFakeDatabase} from './helpers/fake-rtdb.mjs';
import {loadFunctions} from './helpers/functions-sandbox.mjs';

const NOW = Date.parse('2026-10-09T10:00:00+08:00');
const line = (account, debit, credit) => ({account, debit, credit});
const approvedVoucher = (extra = {}) => ({
  status: 'approved', amount: 100, date: '2026-09-02', transactionType: 'operating_expense',
  category: 'operating_supplies', recipient: 'Supplier', voucherNo: 'PV-202609-0001',
  fundingAccountId: 'bank_main', ...extra,
});
const db = createFakeDatabase({
  admins: {manager_uid: 'manager'},
  pettyCashVouchers: {
    ADOPTED: approvedVoucher({voucherNo: 'STA-20260902-685650', amount: 1000, transactionType: 'staff_advance', conversionMovementId: 'journal_adoption', sourceJournalId: 'staff_advance_original'}),
    ADOPTED_REVERSED: approvedVoucher({voucherNo: 'STA-REVERSED', amount: 900, transactionType: 'staff_advance', conversionMovementId: 'journal_adoption', sourceJournalId: 'staff_advance_reversed'}),
    CONVERTED_REVERSED: approvedVoucher({voucherNo: 'SA-REVERSED', amount: 800, transactionType: 'purchase_advance', conversionMovementId: 'supplier_conversion_reversed', sourceJournalId: 'supplier_advance_original'}),
    MISSING: approvedVoucher({voucherNo: 'PV-MISSING', amount: 125}),
    BANK: approvedVoucher({voucherNo: 'PV-BANK', amount: 150}),
  },
  financialMovements: {
    staff_advance_original: {type: 'manual_books_journal', sourceType: 'booksManualJournal', staffAdvanceConversionId: 'ADOPTED', occurredAt: NOW, lines: [line('coa:1120', 1000, 0), line('asset:cash_account:bank_main', 0, 1000)]},
    staff_advance_reversed: {type: 'manual_books_journal', sourceType: 'booksManualJournal', staffAdvanceConversionId: 'ADOPTED_REVERSED', reversedByMovementId: 'staff_advance_reversal', occurredAt: NOW, lines: [line('coa:1120', 900, 0), line('asset:cash_account:bank_main', 0, 900)]},
    supplier_advance_original: {type: 'manual_books_journal', sourceType: 'booksManualJournal', supplierAdvanceConversionId: 'supplier_conversion_reversed', occurredAt: NOW, lines: [line('coa:1900', 800, 0), line('asset:cash_account:bank_main', 0, 800)]},
    supplier_conversion_reversed: {type: 'suspense_supplier_advance_conversion', sourceType: 'booksManualJournal', voucherId: 'CONVERTED_REVERSED', reversedByMovementId: 'supplier_conversion_reversal', occurredAt: NOW, lines: [line('asset:purchase_cash_advance:CONVERTED_REVERSED', 800, 0), line('coa:1900', 0, 800)]},
    petty_BANK: {type: 'petty_cash_expense', sourceType: 'pettyVoucher', sourceId: 'BANK', occurredAt: NOW, lines: [line('expense:supplies', 150, 0), line('asset:cash_account:bank_main', 0, 150)]},
  },
  discrepancies: {
    PARTIAL: {kind: 'cash', status: 'partially_resolved', date: '2026-09-02', variance: -100, resolvedAmount: 60, remainingAmount: 40},
    OPEN: {kind: 'cash', status: 'open', date: '2026-09-03', value: 50},
  },
  books: {journal: {
    shortage_original: {date: '2026-09-02', lines: [{code: '1190', debit: 100, credit: 0}]},
    shortage_clearing: {date: '2026-09-03', lines: [{code: '1190', debit: 0, credit: 90}]},
    overage: {date: '2026-09-04', lines: [{code: '2100', debit: 0, credit: 190}]},
  }},
});
const fx = loadFunctions(db, {now: NOW}).exports;
const request = {auth: {uid: 'manager_uid', token: {email: 'manager@example.test'}}, data: {}};
const audit = await fx.auditFinancialControls(request);
const find = (kind, source) => audit.issues.find((issue) => issue.kind === kind && issue.source === source);

assert.equal(find('cash_payment_missing_custody', 'ADOPTED'), undefined, 'a proven adopted staff advance must not be reported as a second missing cash payment');
assert.ok(find('cash_payment_missing_custody', 'ADOPTED_REVERSED'), 'a reversed adopted journal cannot suppress its missing-custody exception');
assert.ok(find('cash_payment_missing_custody', 'CONVERTED_REVERSED'), 'a reversed supplier conversion cannot suppress its missing-custody exception');
assert.ok(find('cash_payment_missing_custody', 'MISSING'), 'an ordinary approved voucher without a posting remains a critical exception');
const bankGap = find('cash_payment_missing_bank_ledger', 'BANK');
assert.equal(bankGap && bankGap.repairAction, 'repair_cash_payment_bank_ledger', 'a posted bank voucher without its cash-register row offers the narrow register-only repair');
const discrepancy = find('unreviewed_discrepancies', 'discrepancies');
assert.equal(discrepancy && discrepancy.amount, 90, 'the discrepancy summary must show only the remaining unresolved amounts');
const shortage = find('holding_account_balance', '1190');
assert.equal(shortage && shortage.amount, 10, 'the shortage control shows its absolute outstanding balance');
assert.match(shortage && shortage.detail || '', /2 post-cutover journal entries.*net debit balance 10\.00 remains/, 'the shortage control calls entries activity rather than uncleared cases');
const overage = find('holding_account_balance', '2100');
assert.equal(overage && overage.amount, 190, 'the overage control presents its outstanding balance as a positive amount');
assert.match(overage && overage.detail || '', /net credit balance 190\.00 remains/, 'the overage control explains its normal credit balance');

const undeposited = await fx.getUndepositedControlSnapshot(request);
assert.deepEqual(Array.from(undeposited.missingApprovedVoucherIds || []).sort(), ['ADOPTED_REVERSED', 'CONVERTED_REVERSED', 'MISSING'], 'the Undeposited repair list excludes only proven active conversions and keeps genuine missing postings');
db.resetReads();
await fx.getUndepositedControlSnapshot(request);
assert.equal(db.reads.some((read) => /^pettyCashVouchers\//.test(read.path)), false, 'an unresolved attention row does not re-read each voucher on every Undeposited screen open');

await assert.rejects(
  () => fx.repairPettyVoucherFinancial({auth: request.auth, data: {voucherId: 'ADOPTED'}}),
  /adopted or converted/i,
  'a conversion record must never be recreated as a new Undeposited cash payment',
);
assert.equal((await db.ref('financialMovements/petty_ADOPTED').get()).exists(), false, 'the blocked repair leaves the original cash history unchanged');
// Oct 2026: account 1115 is reached in two account-string forms — the per-advance key a payment
// workflow writes, and the chart code (coa:1115) a validated manual journal or its correction
// carries. The audit must compare the ACCOUNT, not the string; matching the string reported a
// critical mismatch for a reclassified advance that reconciled (live case PV-202609-0001).
const liveDb = createFakeDatabase({
  admins: {manager_uid: 'manager'},
  financialMovements: {
    petty_live: {type: 'revolving_fund_purchase_advance', sourceType: 'pettyVoucher', sourceId: 'pv_live', occurredAt: NOW, reversedByMovementId: 'books_edit_reverse_live', lines: [line('asset:purchase_cash_advance:pv_live', 5637.5, 0), line('asset:cash_account:wallet', 0, 5637.5)]},
    books_edit_reverse_live: {type: 'manual_books_journal_correction_reversal', sourceType: 'pettyVoucher', sourceId: 'pv_live', occurredAt: NOW, reversalOf: 'petty_live', lines: [line('asset:purchase_cash_advance:pv_live', 0, 5637.5), line('asset:cash_account:wallet', 5637.5, 0)]},
    books_edit_replace_live: {type: 'manual_books_journal', sourceType: 'booksManualJournal', occurredAt: NOW, lines: [line('coa:1115', 5637.5, 0), line('asset:cash_account:wallet', 0, 5637.5)]},
    purchase_cash_live: {type: 'purchase_cash', sourceType: 'purchaseInvoice', occurredAt: NOW, lines: [line('coa:1230', 5637.5, 0), line('asset:purchase_cash_advance:pv_live', 0, 5637.5)]},
  },
});
const liveAudit = await loadFunctions(liveDb, {now: NOW}).exports.auditFinancialControls(request);
assert.equal(liveAudit.issues.find((issue) => issue.kind === 'supplier_advances_control_mismatch'), undefined, 'a supplier advance reclassified through the chart code must not be reported as a mismatch when the account reconciles');

const brokenDb = createFakeDatabase({
  admins: {manager_uid: 'manager'},
  financialMovements: {orphan: {type: 'purchase_cash', sourceType: 'purchaseInvoice', occurredAt: NOW, lines: [line('asset:purchase_cash_advance:missing', 0, 120), line('coa:1230', 120, 0)]}},
});
const brokenAudit = await loadFunctions(brokenDb, {now: NOW}).exports.auditFinancialControls(request);
const brokenAdvance = brokenAudit.issues.find((issue) => issue.kind === 'supplier_advances_control_mismatch');
assert.ok(brokenAdvance, 'a real supplier-advance mismatch must still be reported');
assert.equal(brokenAdvance.amount, -120, 'the reported difference must be the account-level gap');
assert.equal(brokenAdvance.severity, 'critical', 'a real control mismatch stays critical');
// A real mismatch must name the advance, not print one net figure: the message a manager reads has
// to carry the culprit, and the structured list has to be usable by the Finance Books screen.
assert.match(brokenAdvance.detail, /Largest: missing/, 'the exception must name the advance behind the gap');
assert.match(brokenAdvance.detail, /net -120\.00, open 0\.00/, 'the named advance must carry its ledger net and open subledger amount');
assert.ok(Array.isArray(brokenAdvance.advances) && brokenAdvance.advances.length === 1, 'the exception must expose the attributed advances');
assert.equal(brokenAdvance.advances[0].advanceId, 'missing');
assert.equal(brokenAdvance.advances[0].gap, -120, 'the attributed gap must equal the exception amount');
// The reconciled case must stay silent and must not carry attribution noise.
assert.equal(liveAudit.issues.find((issue) => issue.kind === 'supplier_advances_control_mismatch'), undefined);

// Oct 2026, same class as the Supplier Advances case: Undeposited Collection is reached in the
// workflow form and in the chart form a validated manual journal carries (coa:1001). The custody
// comparison must count both, or a chart-form posting raises a false critical mismatch.
const undepositedDb = createFakeDatabase({
  admins: {manager_uid: 'manager'},
  financialMovements: {dep_coa: {type: 'manual_books_journal', sourceType: 'booksManualJournal', occurredAt: NOW, lines: [line('coa:1001', 500, 0), line('coa:3100', 0, 500)]}},
  cashCustody: {c1: {movementId: 'dep_coa', amount: 500, remaining: 500, status: 'awaiting_deposit', closedAt: NOW}},
});
const undepositedAudit = await loadFunctions(undepositedDb, {now: NOW}).exports.auditFinancialControls(request);
assert.equal(undepositedAudit.issues.find((issue) => issue.kind === 'undeposited_subledger_mismatch'), undefined, 'a chart-form Undeposited posting with matching custody must not be reported');
assert.equal(undepositedAudit.cashAwaitingDeposit.amount, 500, 'the custody figure is unchanged by how the ledger was posted');

const missingCustodyAudit = await loadFunctions(createFakeDatabase({
  admins: {manager_uid: 'manager'},
  financialMovements: {dep_coa: {type: 'manual_books_journal', sourceType: 'booksManualJournal', occurredAt: NOW, lines: [line('coa:1001', 500, 0), line('coa:3100', 0, 500)]}},
}), {now: NOW}).exports.auditFinancialControls(request);
const missingCustody = missingCustodyAudit.issues.find((issue) => issue.kind === 'undeposited_subledger_mismatch');
assert.ok(missingCustody, 'Undeposited cash with no custody must still be reported');
assert.equal(missingCustody.amount, 500, 'the reported difference must be the account-level gap');

console.log('PASS: the Cash Flow control audit excludes proven conversions, reports real remaining exceptions, and exposes only the safe bank-register repair.');
