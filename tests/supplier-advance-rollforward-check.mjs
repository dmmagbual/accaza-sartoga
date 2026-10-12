// Regression coverage for tools/supplier-advance-rollforward.mjs (read-only 1115 diagnostic).
//
// The Cash Flow control audit reports account 1115 as one net figure, e.g.
// "Finance Books -5637.50 vs open subledger 0.00". These cases pin the roll-forward that
// names the advance behind the figure, and pin the fact that the audit's open-subledger
// total is NOT the whole population (cash-difference advances are absent from it).
// The tool must never write: it returns a report and writes only its own JSON output file.
import assert from 'node:assert/strict';
import {ADVANCE_PREFIX, VERDICTS, supplierAdvanceRollforward, renderSummary} from '../tools/supplier-advance-rollforward.mjs';

const AT = Date.parse('2026-10-11T09:00:00+08:00');
const line = (account, debit, credit, description = '') => ({account, debit, credit, description});
const approvedAdvance = (extra = {}) => ({
  status: 'approved', transactionType: 'purchase_advance', amount: 100, remainingAmount: 100,
  recipient: 'Supplier', purpose: 'Stock', date: '2026-10-01', voucherNo: 'PV-202610-0001',
  fundingAccountId: 'undeposited', ...extra,
});

// --- Full fixture ---------------------------------------------------------
const report = supplierAdvanceRollforward({
  movements: {
    // A correctly posted advance that is still unallocated.
    petty_V_OK: {type: 'revolving_fund_purchase_advance', sourceType: 'pettyVoucher', sourceId: 'V_OK', occurredAt: AT, lines: [line(`${ADVANCE_PREFIX}V_OK`, 1000, 0), line('asset:cash_awaiting_deposit', 0, 1000)]},
    // A purchase that applied a register shift advance whose original payment was never posted.
    purchase_cash_INV1: {type: 'purchase_cash', sourceType: 'purchaseInvoice', sourceId: 'INV1', payee: 'Airuss Printing', occurredAt: AT, lines: [line('expense:supplies', 5637.5, 0), line(`${ADVANCE_PREFIX}PADV_MISSING`, 0, 5637.5)]},
    // A voided shift advance whose void credited 1115 without any original debit.
    revolving_fund_purchase_advance_void_PADV_VOID: {type: 'revolving_fund_purchase_advance_void', sourceType: 'pettyVoucher', sourceId: 'PADV_VOID', occurredAt: AT, lines: [line('asset:cash_awaiting_deposit', 500, 0), line(`${ADVANCE_PREFIX}PADV_VOID`, 0, 500)]},
    // A cash-difference advance: correctly posted, but never counted by the audit subledger.
    variance_purchase_D1: {type: 'cash_difference_purchase', sourceType: 'discrepancy', sourceId: 'D1', occurredAt: AT, lines: [line(`${ADVANCE_PREFIX}CDA_1`, 250, 0), line('asset:cash_shortage_pending', 0, 250)]},
    // A payment and its reversal: the audit sums both, so the roll-forward must too.
    petty_V_REV: {type: 'revolving_fund_purchase_advance', sourceType: 'pettyVoucher', sourceId: 'V_REV', occurredAt: AT, reversedByMovementId: 'petty_V_REV_reversal', lines: [line(`${ADVANCE_PREFIX}V_REV`, 300, 0), line('asset:cash_awaiting_deposit', 0, 300)]},
    petty_V_REV_reversal: {type: 'revolving_fund_purchase_advance_void', sourceType: 'pettyVoucher', sourceId: 'V_REV', reversalOf: 'petty_V_REV', occurredAt: AT, lines: [line('asset:cash_awaiting_deposit', 300, 0), line(`${ADVANCE_PREFIX}V_REV`, 0, 300)]},
    // An advance line with no advance id at all: reported, never silently absorbed.
    books_manual_orphan: {type: 'booksManualJournal', occurredAt: AT, lines: [line(ADVANCE_PREFIX, 0, 25), line('coa:1900', 25, 0)]},
    // A non-advance movement: must not appear anywhere in the roll-forward.
    sale_ORDER1: {type: 'order_sale', occurredAt: AT, lines: [line('asset:register_cash', 100, 0), line('revenue:sales', 0, 100)]},
  },
  pettyVouchers: {
    V_OK: approvedAdvance({amount: 1000, remainingAmount: 1000, recipient: 'Bean Supplier'}),
    V_REV: approvedAdvance({amount: 300, remainingAmount: 0, voucherNo: 'PV-202610-0002'}),
    V_OPEN_UNPOSTED: approvedAdvance({amount: 400, remainingAmount: 400, voucherNo: 'PV-202610-0003'}),
    // A voided advance must never be counted as open.
    V_VOIDED: approvedAdvance({amount: 900, remainingAmount: 900, voided: true}),
    // A non-advance voucher share the same node and must be ignored.
    EXPENSE: {status: 'approved', transactionType: 'operating_expense', amount: 50},
  },
  supplierAdvanceShifts: {S1: true},
  shifts: {
    S1: {payOuts: [
      {id: 'PADV_MISSING', type: 'purchase_advance', status: 'fully_allocated', amount: 5637.5, remainingAmount: 0, recipient: 'Airuss Printing', ts: AT},
      {id: 'PADV_VOID', type: 'purchase_advance', status: 'cancelled_pending', voided: true, amount: 500, remainingAmount: 500, ts: AT},
      {id: 'PADV_OTHER', type: 'cash_out', reason: 'Delivery', amount: 80, ts: AT},
    ]},
    // S9 holds an advance but is absent from /supplierAdvanceShifts, so the audit ignores it.
    S9: {payOuts: [{id: 'PADV_S9', type: 'purchase_advance', status: 'pending_details', amount: 700, ts: AT}]},
  },
  cashDifferencePurchaseAdvances: {
    CDA_1: {id: 'CDA_1', purchaseAdvanceId: 'CDA_1', status: 'pending_inventory_allocation', amount: 250, remainingAmount: 250, details: {supplier: 'Print Shop', purpose: 'Receipts'}, createdAt: AT},
    // Registered as open with no Finance Books posting at all.
    CDA_2: {id: 'CDA_2', purchaseAdvanceId: 'CDA_2', status: 'pending_inventory_allocation', amount: 75, remainingAmount: 75, details: {supplier: 'Courier', purpose: 'Delivery'}, createdAt: AT},
  },
  purchaseInvoices: {
    INV1: {supplier: 'Airuss Printing', documentNo: 'PUR-202610-0001', total: 5637.5, date: '2026-10-05', purchaseAdvanceId: 'PADV_MISSING', advanceSource: 'shift'},
  },
});

const find = (id) => report.advances.find((row) => row.advanceId === id);

// Finance Books side: every 1115 line, including reversal lines (audit parity).
assert.equal(report.gl.debit, 1550, 'debits: V_OK 1000 + CDA_1 250 + V_REV 300');
assert.equal(report.gl.credit, 6462.5, 'credits: PADV_MISSING 5637.50 + PADV_VOID 500 + V_REV reversal 300 + unattributed 25');
assert.equal(report.gl.net, -4912.5);
assert.equal(report.auditSubledger.revolving, 1400, 'open revolving advances: V_OK 1000 + V_OPEN_UNPOSTED 400 (V_REV 0, V_VOIDED excluded)');
assert.equal(report.auditSubledger.shift, 0, 'both indexed shift advances are fully allocated or voided');
assert.equal(report.auditSubledger.total, 1400);
assert.equal(report.gap, report.gl.net - report.auditSubledger.total, 'the gap must be exactly the audit comparison');
assert.equal(report.auditSubledger.indexUsed, true);

// The named culprit behind an unposted register advance.
const missing = find('PADV_MISSING');
assert.equal(missing.verdict, VERDICTS.CREDIT_WITHOUT_ORIGINAL_PAYMENT);
assert.equal(missing.glDebit, 0);
assert.equal(missing.glCredit, 5637.5);
assert.equal(missing.open, 0);
assert.equal(missing.gap, -5637.5);
assert.equal(missing.label, 'Airuss Printing');
assert.equal(missing.shiftPayOut.remainingAmount, 0);
assert.equal(missing.purchaseAllocations.length, 1, 'the purchase that applied the advance is traced');
assert.equal(missing.purchaseAllocations[0].invoiceId, 'INV1');
assert.ok(missing.flags.includes('no_debit_in_finance_books'));
assert.match(missing.nextStep, /Backfill \/ verify 3C financial ledger/, 'the route for a drawer pay-out is named');
assert.ok(missing.movements.some((movement) => movement.type === 'purchase_cash' && movement.credit === 5637.5));

// Open but never posted.
const unposted = find('V_OPEN_UNPOSTED');
assert.equal(unposted.verdict, VERDICTS.OPEN_ADVANCE_NEVER_POSTED);
assert.equal(unposted.open, 400);
assert.equal(unposted.gap, -400);
assert.equal(unposted.rollForwardGap, -400);

// A correctly posted advance reconciles.
const ok = find('V_OK');
assert.equal(ok.verdict, VERDICTS.RECONCILED);
assert.equal(ok.gap, 0);
assert.equal(ok.movements[0].date, '2026-10-11', 'movement dates are Manila business dates');

// Voided advances leave the open subledger but their credit still has to be explained.
const voided = find('PADV_VOID');
assert.equal(voided.open, 0, 'a voided shift advance is never counted as open');
assert.equal(voided.verdict, VERDICTS.CREDIT_WITHOUT_ORIGINAL_PAYMENT);

// Cash-difference advances: posted, open, and invisible to the audit subledger.
const cda = find('CDA_1');
assert.equal(cda.verdict, VERDICTS.OUTSIDE_AUDIT_SUBLEDGER);
assert.equal(cda.open, 0, 'the audit subledger never counts a cash-difference advance');
assert.equal(cda.openOutsideAudit, 250, 'its own remaining amount still has to agree with Finance Books');
assert.equal(cda.expectedOpen, 250);
assert.equal(cda.glNet, 250);
assert.equal(cda.gap, 250, 'the audit comparison gap is reported as it stands');
assert.equal(cda.rollForwardGap, 0, 'but the posting itself is correct');
assert.ok(cda.flags.includes('excluded_from_audit_subledger'));
assert.ok(cda.flags.includes('audit_gap_not_a_posting_error'));
assert.ok(cda.notes.some((note) => /excluded from the audit open-subledger/.test(note)));
assert.equal(report.totals.excludedCashDifferenceAdvances, 325, 'CDA_1 250 + CDA_2 75');

// A cash-difference advance that is open with no posting at all is a real gap.
const cdaUnposted = find('CDA_2');
assert.equal(cdaUnposted.verdict, VERDICTS.OPEN_ADVANCE_NEVER_POSTED);
assert.equal(cdaUnposted.glDebit, 0);
assert.equal(cdaUnposted.glCredit, 0);
assert.equal(cdaUnposted.expectedOpen, 75);
assert.equal(cdaUnposted.rollForwardGap, -75);
assert.equal(report.totals.openAdvancesNeverPosted, 475, 'V_OPEN_UNPOSTED 400 + CDA_2 75');

// Reversal lines are counted (audit parity) and flagged, not hidden.
const reversed = find('V_REV');
assert.equal(reversed.verdict, VERDICTS.RECONCILED);
assert.equal(reversed.glDebit, 300);
assert.equal(reversed.glCredit, 300);
assert.ok(reversed.flags.includes('reversal_line_present'));
assert.equal(report.gl.reversedDebit, 300);
assert.equal(report.gl.reversedCredit, 300);

// A shift outside the index is not part of the audit subledger at all.
assert.equal(find('PADV_S9'), undefined, 'an unindexed shift advance cannot appear in the audit comparison');

// A 1115 line with no advance id is reported, never absorbed.
assert.equal(report.totals.unattributedLines, 1);
assert.equal(report.unattributed[0].credit, 25);
assert.equal(report.unattributed[0].movementId, 'books_manual_orphan');

// Non-advance movements and non-advance vouchers stay out of the report.
assert.equal(report.sources.purchaseAdvanceVouchers, 4, 'only purchase_advance vouchers are read');
assert.equal(report.advances.length, 7, 'V_OK, V_REV, V_OPEN_UNPOSTED, PADV_MISSING, PADV_VOID, CDA_1, CDA_2');
assert.equal(find('V_VOIDED'), undefined, 'a voided voucher that touches nothing is counted, not listed');
assert.equal(report.sources.inertSourceRecords, 1);
assert.equal(report.verdictCounts[VERDICTS.RECONCILED], 2);
assert.equal(report.totals.creditsWithoutOriginalPayment, 6137.5, '5637.50 + 500 of credits with no original payment');

// --- Live symptom shape ---------------------------------------------------
// Finance Books -5637.50 against an open subledger of 0.00 must name one advance.
const live = supplierAdvanceRollforward({
  movements: {purchase_cash_INV: {type: 'purchase_cash', sourceType: 'purchaseInvoice', sourceId: 'INV', occurredAt: AT, lines: [line('expense:supplies', 5637.5, 0), line(`${ADVANCE_PREFIX}padv_live`, 0, 5637.5)]}},
  pettyVouchers: {},
  supplierAdvanceShifts: {S_LIVE: true},
  shifts: {S_LIVE: {payOuts: [{id: 'padv_live', type: 'purchase_advance', status: 'fully_allocated', amount: 5637.5, remainingAmount: 0, recipient: 'Airuss Printing', ts: AT}]}},
});
assert.equal(live.gl.net, -5637.5, 'the audit figure is reproduced exactly');
assert.equal(live.auditSubledger.total, 0, 'the audit open subledger is reproduced exactly');
assert.equal(live.gap, -5637.5);
assert.equal(live.advances.length, 1);
assert.equal(live.advances[0].advanceId, 'padv_live');
assert.equal(live.advances[0].verdict, VERDICTS.CREDIT_WITHOUT_ORIGINAL_PAYMENT);

// The summary must state the two sides, the gap and the route.
const summary = renderSummary(live);
assert.match(summary, /Finance Books: debit 0\.00 · credit 5637\.50 · net -5637\.50/);
assert.match(summary, /Gap \(audit compares these two figures\): -5637\.50/);
assert.match(summary, /\[credit_without_original_payment\] padv_live · Airuss Printing/);
assert.match(summary, /Next: /);

// The tool is analysis only: it must not carry any database write capability.
const source = await import('node:fs').then((fs) => fs.readFileSync(new URL('../tools/supplier-advance-rollforward.mjs', import.meta.url), 'utf8'));
assert.ok(!/\bref\(|firebase-admin|firebase\/database|firebase\/app|googleapis/.test(source), 'the diagnostic must never reach the database');
assert.ok(!/\.writeFileSync\([^)]*financialMovements|\.writeFileSync\([^)]*pettyCash/.test(source), 'it may only write its own report');
assert.equal(live.readOnly, true);

console.log('supplier advance roll-forward: 1115 attribution, audit parity and read-only contract verified');
