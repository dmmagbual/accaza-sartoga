// Supplier Advances (1115) per-advance roll-forward — READ-ONLY diagnostic.
//
// Why this exists (Oct 2026): the Cash Flow control audit reports one net line for
// account 1115, e.g. "Supplier Advances (1115) · Finance Books -5637.50 vs open subledger
// 0.00". A single net figure cannot say WHICH advance is wrong, and the open-subledger
// figure it is compared against is not complete on its own: advances created by the cash
// difference workflow (/cashDifferencePurchaseAdvances) are never part of that subledger.
//
// This tool rebuilds the same evidence the server audit uses, then attributes every
// journal line on `asset:purchase_cash_advance:<advanceId>` to that advance and states a
// verdict per advance. It only reads the JSON exports it is given: it never writes to the
// database, never posts, and never repairs. Corrections stay in the owning workflow
// (Admin > Cash Payments, Admin > Purchases, Admin > Discrepancies); account 1115 refuses
// manual journals by design.
//
// Usage (see tools/supplier-advance-rollforward.ps1 for the fetch step):
//   node tools/supplier-advance-rollforward.mjs "<dir with the JSON exports>"
//
// Recognised files in that directory (all optional except financialMovements.json):
//   financialMovements.json             /financialMovements            (required)
//   pettyCashVouchers.json              /pettyCashVouchers?transactionType=purchase_advance
//   supplierAdvanceShifts.json          /supplierAdvanceShifts
//   shifts.json                         { "<shiftId>": { "payOuts": [...] } }  (only indexed shifts)
//   cashDifferencePurchaseAdvances.json /cashDifferencePurchaseAdvances
//   purchaseInvoices.json               /purchaseInvoices
//
// Cost: one full /financialMovements read plus small indexed and per-shift reads — the same
// envelope as one "Run control audit". Manual tool: run it when an exception needs naming.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

// The same Books bridge the server uses, so an account string resolves to its GL code here too.
const require = createRequire(import.meta.url);
const BooksBridge = require('../functions/lib/books-bridge.js');

/** Advanced payments are stored per advance: asset:purchase_cash_advance:<advanceId>. */
export const ADVANCE_PREFIX = 'asset:purchase_cash_advance:';

/** Verdict wording stays stable so tests and runbooks can rely on it. */
export const VERDICTS = Object.freeze({
  RECONCILED: 'reconciled',
  CREDIT_WITHOUT_ORIGINAL_PAYMENT: 'credit_without_original_payment',
  OPEN_ADVANCE_NEVER_POSTED: 'open_advance_never_posted',
  CREDITS_EXCEED_ORIGINAL_PAYMENT: 'credits_exceed_original_payment',
  ORPHAN_CREDIT: 'orphan_credit',
  OUTSIDE_AUDIT_SUBLEDGER: 'outside_audit_subledger',
  UNEXPLAINED_MISMATCH: 'unexplained_mismatch',
});

/** The controlled route for each verdict. Never a manual journal to 1115. */
export const NEXT_STEP = Object.freeze({
  [VERDICTS.RECONCILED]: 'Nothing to do for this advance.',
  [VERDICTS.CREDIT_WITHOUT_ORIGINAL_PAYMENT]:
    'The advance was applied in Finance Books but its original payment was never posted. If the cash really left the register drawer, run Admin > Finance > Cash Flow > "Backfill / verify 3C financial ledger" (idempotent) so the pay-out posts; otherwise record the payment in Admin > Cash Payments. Do not journal 1115.',
  [VERDICTS.OPEN_ADVANCE_NEVER_POSTED]:
    'This advance is still counted as open but has no Finance Books posting. Post it from Admin > Cash Payments, or correct/remove the stale source record in Admin > Purchases. Do not journal 1115.',
  [VERDICTS.CREDITS_EXCEED_ORIGINAL_PAYMENT]:
    'More was applied to purchases than the original payment. Reverse the extra application at source: Admin > Purchases > "Reverse & re-enter", or correct the cash payment in Admin > Cash Payments.',
  [VERDICTS.ORPHAN_CREDIT]:
    'Finance Books carries this advance but no source record remains. Escalate for an approved correction linked to the original document; 1115 refuses manual journals.',
  [VERDICTS.OUTSIDE_AUDIT_SUBLEDGER]:
    'This advance is correctly posted and still open, but a cash-difference advance is not part of the audit open-subledger total, so the audit comparison reports a gap that is not a posting error. Finish it in Admin > Purchases (allocate it) so the comparison returns to zero.',
  [VERDICTS.UNEXPLAINED_MISMATCH]:
    'The advance posting and its source record disagree. Compare the movement list below with the advance record before any correction.',
});

const money = (value) => Math.round((Number(value) || 0) * 100) / 100;
const text = (value, max) => {
  const out = value == null ? '' : String(value).trim();
  return max && out.length > max ? out.slice(0, max) : out;
};
const rows = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
const has = (value) => value !== null && value !== undefined && value !== '';

/** RTDB returns arrays as arrays, but an export may keep numeric keys. Accept both. */
function toList(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  const keys = Object.keys(value);
  if (!keys.length) return [];
  if (!keys.every((key) => /^\d+$/.test(key))) return [];
  return keys.sort((a, b) => Number(a) - Number(b)).map((key) => value[key]);
}

/** Manila business date, matching functions/lib/books-bridge.js businessDate(). */
function businessDate(ms) {
  const at = Number(ms);
  if (!(at > 0)) return '';
  return new Date(at + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

/** Mirrors the server audit: remainingAmount when present, otherwise the original amount. */
function openAmount(row) {
  if (!row || typeof row !== 'object') return 0;
  return money(row.remainingAmount != null ? row.remainingAmount : row.amount);
}

function movementDate(movement) {
  return businessDate(Number((movement && (movement.occurredAt || movement.postedAt || movement.createdAt)) || 0));
}

function entryFor(map, advanceId) {
  const id = String(advanceId || '');
  if (!map.has(id)) {
    map.set(id, {
      advanceId: id,
      glDebit: 0,
      glCredit: 0,
      reversedDebit: 0,
      reversedCredit: 0,
      open: 0,
      inAuditSubledger: false,
      cashPaymentVoucher: null,
      shiftPayOut: null,
      cashDifferenceAdvance: null,
      purchaseAllocations: [],
      movements: [],
      movementCount: 0,
      movementTypes: [],
      notes: [],
    });
  }
  return map.get(id);
}

/**
 * Build the 1115 roll-forward.
 * @param {{movements?:object, pettyVouchers?:object, shifts?:object, supplierAdvanceShifts?:object, cashDifferencePurchaseAdvances?:object, purchaseInvoices?:object}} input
 * @returns {object} report
 */
export function supplierAdvanceRollforward(input) {
  const source = input || {};
  const movements = rows(source.movements);
  const vouchers = rows(source.pettyVouchers);
  const shifts = rows(source.shifts);
  const shiftIndex = rows(source.supplierAdvanceShifts);
  const differenceAdvances = rows(source.cashDifferencePurchaseAdvances);
  const invoices = rows(source.purchaseInvoices);

  const advances = new Map();
  const unattributed = [];
  const chartFormLines = [];
  let glDebit = 0;
  let glCredit = 0;
  let reversedDebit = 0;
  let reversedCredit = 0;
  let chartFormDebit = 0;
  let chartFormCredit = 0;

  Object.keys(movements).forEach((movementId) => {
    const movement = movements[movementId] || {};
    const reversed = !!(movement.reversalOf || movement.reversedByMovementId);
    const date = movementDate(movement);
    toList(movement.lines).forEach((line) => {
      const account = String((line && line.account) || '');
      const debit = money(line.debit);
      const credit = money(line.credit);
      const perAdvance = account.indexOf(ADVANCE_PREFIX) === 0;
      // Account 1115 is reached in two forms: the per-advance key a payment workflow writes, and
      // the bare chart code a validated manual journal (or its correction) carries. Both are the
      // same account, so both belong in the total the control audit compares; only the per-advance
      // form can be attributed to one advance. Counting just the per-advance form is what made a
      // correctly reclassified advance look like a critical mismatch (Oct 2026).
      const resolvedCode = perAdvance ? '1115' : String((BooksBridge.mapAccount(account, 'instore', {}) || {}).code || '');
      if (!perAdvance && resolvedCode !== '1115') return;
      const advanceId = perAdvance ? account.slice(ADVANCE_PREFIX.length) : '';
      if (!perAdvance) {
        chartFormDebit = money(chartFormDebit + debit);
        chartFormCredit = money(chartFormCredit + credit);
        if (chartFormLines.length < 40) {
          chartFormLines.push({id: movementId, type: text(movement.type, 80), date, debit, credit, account: text(account, 80), memo: text(line.description || line.memo, 120)});
        }
      }
      glDebit = money(glDebit + debit);
      glCredit = money(glCredit + credit);
      if (reversed) {
        reversedDebit = money(reversedDebit + debit);
        reversedCredit = money(reversedCredit + credit);
      }
      if (!advanceId) {
        if (perAdvance) unattributed.push({movementId, type: text(movement.type, 80), date, debit, credit});
        return;
      }
      const entry = entryFor(advances, advanceId);
      entry.glDebit = money(entry.glDebit + debit);
      entry.glCredit = money(entry.glCredit + credit);
      if (reversed) {
        entry.reversedDebit = money(entry.reversedDebit + debit);
        entry.reversedCredit = money(entry.reversedCredit + credit);
      }
      entry.movementCount += 1;
      const type = text(movement.type, 80) || 'movement';
      if (!entry.movementTypes.includes(type)) entry.movementTypes.push(type);
      if (entry.movements.length < 40) {
        entry.movements.push({
          id: movementId,
          type,
          date,
          debit,
          credit,
          reversed,
          sourceId: text(movement.sourceId, 120),
          payee: text(movement.payee || movement.voucherNo || movement.reference, 120),
          memo: text(line.description || line.memo, 120),
        });
      }
    });
  });

  // --- Source records -----------------------------------------------------
  // Cash Payments vouchers. The fetch uses the audit's own indexed query
  // (transactionType == purchase_advance); a full node read also works.
  Object.keys(vouchers).forEach((voucherId) => {
    const row = vouchers[voucherId] || {};
    if (row.transactionType !== 'purchase_advance') return;
    const entry = entryFor(advances, voucherId);
    const open = openAmount(row);
    const counts = row.status === 'approved' && row.voided !== true;
    entry.cashPaymentVoucher = {
      id: voucherId,
      status: text(row.status, 40),
      voided: row.voided === true,
      amount: money(row.amount),
      remainingAmount: row.remainingAmount != null ? money(row.remainingAmount) : null,
      open: counts ? open : 0,
      payee: text(row.recipient || row.supplierName, 160),
      purpose: text(row.purpose, 300),
      date: text(row.date, 10),
      voucherNo: text(row.voucherNo, 60),
      fundingAccountId: text(row.fundingAccountId, 80),
      conversionMovementId: text(row.conversionMovementId, 120),
    };
    if (counts) {
      entry.inAuditSubledger = true;
      entry.open = money(entry.open + open);
    }
  });

  // Register shift pay-outs. Only shifts listed in /supplierAdvanceShifts are part of the
  // audit's subledger; when the export carries no index the tool uses every shift given and
  // says so, because that changes parity with the audit.
  const indexUsed = Object.keys(shiftIndex).length > 0;
  Object.keys(shifts).forEach((shiftId) => {
    if (indexUsed && !shiftIndex[shiftId]) return;
    const shift = shifts[shiftId] || {};
    toList(shift.payOuts).forEach((row, index) => {
      const payOut = row || {};
      if (payOut.type !== 'purchase_advance') return;
      const id = text(payOut.id, 120);
      if (!id) {
        unattributed.push({movementId: `shifts/${shiftId}/payOuts/${index}`, type: 'shift_pay_out_without_id', date: '', debit: 0, credit: 0});
        return;
      }
      const entry = entryFor(advances, id);
      const open = openAmount(payOut);
      const counts = payOut.voided !== true && payOut.status !== 'cancelled';
      entry.shiftPayOut = {
        id,
        shiftId,
        status: text(payOut.status, 40),
        voided: payOut.voided === true,
        amount: money(payOut.amount),
        remainingAmount: payOut.remainingAmount != null ? money(payOut.remainingAmount) : null,
        open: counts ? open : 0,
        payee: text(payOut.recipient, 160),
        purpose: text(payOut.purpose, 300),
        date: businessDate(Number(payOut.ts)),
        indexed: indexUsed,
      };
      if (counts) {
        entry.inAuditSubledger = true;
        entry.open = money(entry.open + open);
      }
    });
  });

  // Cash-difference advances. These DO post a debit to 1115 but are never part of the
  // audit's open-subledger total, which is a known reason for the two figures to differ.
  Object.keys(differenceAdvances).forEach((key) => {
    const row = differenceAdvances[key] || {};
    const id = text(row.purchaseAdvanceId || row.id || key, 120);
    if (!id) return;
    const entry = entryFor(advances, id);
    entry.cashDifferenceAdvance = {
      key,
      status: text(row.status, 60),
      amount: money(row.amount),
      remainingAmount: row.remainingAmount != null ? money(row.remainingAmount) : openAmount(row),
      supplier: text(row.details && row.details.supplier, 160),
      purpose: text(row.details && row.details.purpose, 300),
      discrepancyId: text(row.discrepancyId || row.id, 120),
      shiftId: text(row.shiftId, 120),
      date: businessDate(Number(row.createdAt || row.ts)),
      countedInAuditSubledger: false,
    };
    entry.notes.push('A cash-difference advance posts a debit to 1115 but is excluded from the audit open-subledger total.');
  });

  // Purchase invoices that applied an advance.
  Object.keys(invoices).forEach((invoiceId) => {
    const invoice = invoices[invoiceId] || {};
    const linked = text(invoice.purchaseAdvanceId, 120);
    if (!linked || !advances.has(linked)) return;
    entryFor(advances, linked).purchaseAllocations.push({
      invoiceId,
      supplier: text(invoice.supplier, 160),
      documentNo: text(invoice.documentNo, 80),
      ref: text(invoice.ref, 120),
      total: money(invoice.total),
      date: text(invoice.date, 10),
      advanceSource: text(invoice.advanceSource, 40),
      reversed: invoice.reversed === true || !!invoice.reversalMovementId,
    });
  });

  // --- Verdicts -----------------------------------------------------------
  let inertSourceRecords = 0;
  const list = [...advances.values()].map((entry) => {
    const glNet = money(entry.glDebit - entry.glCredit);
    const gap = money(glNet - entry.open);
    // The audit only counts vouchers and indexed shift pay-outs. A cash-difference advance is
    // open in its own right, so judge the posting against that too — otherwise a correctly
    // posted advance would read as a mismatch simply because the audit cannot see it.
    const openOutsideAudit = entry.cashDifferenceAdvance && !entry.inAuditSubledger
      ? money(entry.cashDifferenceAdvance.remainingAmount)
      : 0;
    const expectedOpen = money(entry.open + openOutsideAudit);
    const rollForwardGap = money(glNet - expectedOpen);

    // A source record that touches no journal line and holds nothing open explains nothing;
    // count it rather than padding the report with it.
    if (entry.glDebit === 0 && entry.glCredit === 0 && expectedOpen <= 0.005 && !entry.notes.length) {
      inertSourceRecords += 1;
      return null;
    }

    const flags = [];
    if (entry.glDebit === 0 && entry.glCredit > 0) flags.push('no_debit_in_finance_books');
    if (expectedOpen > 0.005 && entry.glDebit === 0) flags.push('counted_open_without_posting');
    if (entry.glDebit > 0 && glNet < -0.005) flags.push('credits_exceed_payment');
    if (entry.reversedDebit > 0 || entry.reversedCredit > 0) flags.push('reversal_line_present');
    const sourced = !!(entry.cashPaymentVoucher || entry.shiftPayOut || entry.cashDifferenceAdvance || entry.purchaseAllocations.length);
    if (!sourced && (entry.glDebit > 0 || entry.glCredit > 0)) flags.push('no_source_record');
    if (entry.cashDifferenceAdvance && !entry.inAuditSubledger) flags.push('excluded_from_audit_subledger');
    if (Math.abs(gap) >= 0.005 && Math.abs(rollForwardGap) < 0.005 && openOutsideAudit > 0.005) flags.push('audit_gap_not_a_posting_error');

    let verdict = VERDICTS.UNEXPLAINED_MISMATCH;
    if (entry.glDebit === 0 && entry.glCredit > 0) verdict = VERDICTS.CREDIT_WITHOUT_ORIGINAL_PAYMENT;
    else if (entry.glDebit === 0 && entry.glCredit === 0 && expectedOpen > 0.005) verdict = VERDICTS.OPEN_ADVANCE_NEVER_POSTED;
    else if (entry.glDebit > 0 && glNet < -0.005) verdict = VERDICTS.CREDITS_EXCEED_ORIGINAL_PAYMENT;
    else if (flags.includes('no_source_record') && entry.glCredit > 0) verdict = VERDICTS.ORPHAN_CREDIT;
    else if (flags.includes('excluded_from_audit_subledger') && glNet > 0 && Math.abs(rollForwardGap) < 0.005) verdict = VERDICTS.OUTSIDE_AUDIT_SUBLEDGER;
    else if (Math.abs(rollForwardGap) < 0.005) verdict = VERDICTS.RECONCILED;

    const label = text(
      (entry.cashPaymentVoucher && (entry.cashPaymentVoucher.payee || entry.cashPaymentVoucher.voucherNo))
      || (entry.shiftPayOut && entry.shiftPayOut.payee)
      || (entry.cashDifferenceAdvance && entry.cashDifferenceAdvance.supplier)
      || (entry.purchaseAllocations[0] && entry.purchaseAllocations[0].supplier),
      160,
    );

    return {
      advanceId: entry.advanceId,
      label,
      verdict,
      nextStep: NEXT_STEP[verdict],
      flags,
      glDebit: money(entry.glDebit),
      glCredit: money(entry.glCredit),
      glNet,
      open: money(entry.open),
      openOutsideAudit,
      expectedOpen,
      gap,
      rollForwardGap,
      inAuditSubledger: entry.inAuditSubledger,
      movementTypes: entry.movementTypes,
      movementCount: entry.movementCount,
      movementsTruncated: entry.movementCount > entry.movements.length,
      movements: entry.movements,
      cashPaymentVoucher: entry.cashPaymentVoucher,
      shiftPayOut: entry.shiftPayOut,
      cashDifferenceAdvance: entry.cashDifferenceAdvance,
      purchaseAllocations: entry.purchaseAllocations,
      notes: entry.notes,
    };
  }).filter(Boolean).sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap) || Math.abs(b.glNet) - Math.abs(a.glNet) || a.advanceId.localeCompare(b.advanceId));

  // --- Totals -------------------------------------------------------------
  const sumOpen = (predicate) => money(list.reduce((total, row) => total + (predicate(row) ? row.open : 0), 0));
  const revolving = sumOpen((row) => !!row.cashPaymentVoucher && row.inAuditSubledger && row.open > 0);
  const shift = sumOpen((row) => !!row.shiftPayOut && row.inAuditSubledger && row.open > 0);
  const auditSubledgerTotal = money(revolving + shift);
  const excluding = (value) => Math.abs(value) >= 0.005;
  const verdictCounts = {};
  list.forEach((row) => { verdictCounts[row.verdict] = (verdictCounts[row.verdict] || 0) + 1; });

  return {
    schemaVersion: 1,
    generatedAt: Date.now(),
    readOnly: true,
    account: {code: '1115', name: 'Supplier Advances', prefix: ADVANCE_PREFIX},
    sources: {
      movements: Object.keys(movements).length,
      purchaseAdvanceVouchers: Object.keys(vouchers).filter((id) => (vouchers[id] || {}).transactionType === 'purchase_advance').length,
      shiftsProvided: Object.keys(shifts).length,
      supplierAdvanceShiftIndex: indexUsed,
      supplierAdvanceShiftIndexEntries: Object.keys(shiftIndex).length,
      cashDifferenceAdvances: Object.keys(differenceAdvances).length,
      purchaseInvoices: Object.keys(invoices).length,
      inertSourceRecords,
    },
    gl: {
      debit: money(glDebit),
      credit: money(glCredit),
      net: money(glDebit - glCredit),
      reversedDebit: money(reversedDebit),
      reversedCredit: money(reversedCredit),
    },
    auditSubledger: {revolving, shift, total: auditSubledgerTotal, indexUsed},
    gap: money(money(glDebit - glCredit) - auditSubledgerTotal),
    // True when the account itself agrees with the open subledger, whatever form the postings took.
    // Per-advance verdicts below then describe presentation, not a financial error to correct.
    accountReconciled: Math.abs(money(money(glDebit - glCredit) - auditSubledgerTotal)) < 0.005,
    chartForm: {debit: money(chartFormDebit), credit: money(chartFormCredit), net: money(chartFormDebit - chartFormCredit), count: chartFormLines.length, lines: chartFormLines},
    totals: {
      advances: list.length,
      creditsWithoutOriginalPayment: money(list.reduce((total, row) => total + (row.verdict === VERDICTS.CREDIT_WITHOUT_ORIGINAL_PAYMENT ? -row.glNet : 0), 0)),
      openAdvancesNeverPosted: money(list.reduce((total, row) => total + (row.verdict === VERDICTS.OPEN_ADVANCE_NEVER_POSTED ? row.expectedOpen : 0), 0)),
      excludedCashDifferenceAdvances: money(list.reduce((total, row) => total + (row.cashDifferenceAdvance ? (row.cashDifferenceAdvance.remainingAmount || 0) : 0), 0)),
      unattributedLines: unattributed.length,
    },
    verdictCounts,
    unattributed: unattributed.filter((row) => excluding(row.debit) || excluding(row.credit) || row.type === 'shift_pay_out_without_id'),
    advances: list,
  };
}

/** Human-readable summary; the JSON report is the machine-readable record. */
export function renderSummary(report) {
  const lines = [];
  const peso = (value) => (Number(value) || 0).toFixed(2);
  lines.push(`Supplier Advances (1115) roll-forward — read-only`);
  lines.push(`Finance Books: debit ${peso(report.gl.debit)} · credit ${peso(report.gl.credit)} · net ${peso(report.gl.net)}`);
  lines.push(`Audit open subledger: ${peso(report.auditSubledger.total)} (revolving ${peso(report.auditSubledger.revolving)} + shift ${peso(report.auditSubledger.shift)})`);
  lines.push(`Gap (audit compares these two figures): ${peso(report.gap)}`);
  if (report.accountReconciled) {
    lines.push('ACCOUNT RECONCILES — no correction needed. Account 1115 agrees with the open subledger.');
    if (Math.abs(report.chartForm.net) >= 0.005) lines.push(`  ${peso(report.chartForm.net)} of it was posted through the chart code (coa:1115) rather than a per-advance key; the two forms offset each other. Any per-advance verdict below is presentation, not a financial error.`);
  }
  if (!report.auditSubledger.indexUsed) lines.push('NOTE: no /supplierAdvanceShifts index in the input, so every shift provided was used. The server audit only counts indexed shifts.');
  lines.push(`Advances named: ${report.totals.advances} · credits with no original payment: ${peso(report.totals.creditsWithoutOriginalPayment)} · open but never posted: ${peso(report.totals.openAdvancesNeverPosted)}`);
  if (Math.abs(report.totals.excludedCashDifferenceAdvances) >= 0.005) lines.push(`NOTE: ${peso(report.totals.excludedCashDifferenceAdvances)} of cash-difference advances carry a 1115 debit but are excluded from the audit open-subledger total.`);
  if (report.totals.unattributedLines) lines.push(`Unattributed 1115 lines: ${report.totals.unattributedLines}`);
  lines.push('');
  report.advances.forEach((row) => {
    lines.push(`[${row.verdict}] ${row.advanceId}${row.label ? ' · ' + row.label : ''}`);
    lines.push(`    Finance Books debit ${peso(row.glDebit)} / credit ${peso(row.glCredit)} = net ${peso(row.glNet)}`);
    lines.push(`    Open: audit subledger ${peso(row.open)}${row.openOutsideAudit ? ` + outside audit ${peso(row.openOutsideAudit)}` : ''} = ${peso(row.expectedOpen)} · audit gap ${peso(row.gap)} · posting gap ${peso(row.rollForwardGap)}`);
    if (row.flags.includes('audit_gap_not_a_posting_error')) lines.push('    The audit gap here is a control-coverage gap, not a wrong posting.');
    row.movements.slice(0, 5).forEach((movement) => {
      lines.push(`    ${movement.date || 'undated'} ${movement.type} ${movement.id}${movement.reversed ? ' (reversal line)' : ''} debit ${peso(movement.debit)} credit ${peso(movement.credit)}`);
    });
    if (row.movementCount > 5) lines.push(`    … ${row.movementCount - 5} more movement(s) in the JSON report`);
    lines.push(`    ${report.accountReconciled ? 'No action: account 1115 reconciles.' : 'Next: ' + row.nextStep}`);
    lines.push('');
  });
  return lines.join('\n');
}

const FILE_NAMES = {
  movements: 'financialMovements.json',
  pettyVouchers: 'pettyCashVouchers.json',
  shifts: 'shifts.json',
  supplierAdvanceShifts: 'supplierAdvanceShifts.json',
  cashDifferencePurchaseAdvances: 'cashDifferencePurchaseAdvances.json',
  purchaseInvoices: 'purchaseInvoices.json',
};

/** Read the JSON exports from a directory. A missing optional file is reported, not fatal. */
export function readExportDirectory(dir) {
  const input = {};
  const missing = [];
  Object.keys(FILE_NAMES).forEach((key) => {
    const file = path.join(dir, FILE_NAMES[key]);
    if (!fs.existsSync(file)) {
      missing.push(FILE_NAMES[key]);
      input[key] = {};
      return;
    }
    const raw = fs.readFileSync(file, 'utf8').trim();
    if (!raw || raw === 'null') {
      input[key] = {};
      return;
    }
    input[key] = JSON.parse(raw);
  });
  return {input, missing};
}

function main(argv) {
  const dir = argv[2];
  if (!dir) {
    process.stderr.write('Usage: node tools/supplier-advance-rollforward.mjs "<dir with the JSON exports>"\n');
    process.exit(2);
  }
  if (!fs.existsSync(dir)) {
    process.stderr.write(`Directory not found: ${dir}\n`);
    process.exit(2);
  }
  const {input, missing} = readExportDirectory(dir);
  if (!Object.keys(input.movements).length) {
    process.stderr.write(`Refusing to report: ${FILE_NAMES.movements} is missing or empty in ${dir}. Fetch it first (see tools/supplier-advance-rollforward.ps1).\n`);
    process.exit(2);
  }
  const report = supplierAdvanceRollforward(input);
  report.sourceFilesMissing = missing;
  const outFile = path.join(dir, '1115-rollforward.json');
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  process.stdout.write(renderSummary(report));
  process.stdout.write(`\nJSON report: ${outFile}\n`);
  if (missing.length) process.stdout.write(`Not provided (optional): ${missing.join(', ')}\n`);
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) main(process.argv);
