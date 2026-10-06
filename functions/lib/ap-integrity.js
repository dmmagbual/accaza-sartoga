/* AP Integrity Remediation Plan, step 0.3 — read-only baseline of existing AP damage.
   Pure functions, no Firebase: the callable apIntegrityBaseline feeds it the live records and
   returns the report. Nothing here writes, repairs or reclassifies; every finding needs a
   person to review it and correct it with a documented reversal or adjustment. */
const Financial = require("./financial");

const money = Financial.money;
const TOLERANCE = 0.01;
const LIST_LIMIT = 200;

function rows(map) { return Object.keys(map || {}).map((id) => Object.assign({id}, map[id] || {})); }
function text(value, max) { return String(value == null ? "" : value).trim().slice(0, max || 160); }
function refKey(value) { return text(value, 120).toLowerCase().replace(/[\s\-/#]+/g, ""); }
function liveSettled(row) { return Object.values((row && row.settlements) || {}).reduce((sum, entry) => (entry && entry.status !== "reversed" ? money(sum + money(entry.amount)) : sum), 0); }
function paidOn(row) { return money(Math.max(money(row && row.paidAmount), liveSettled(row))); }
function remainingOf(row) { return money(row.remainingAmount != null ? row.remainingAmount : row.amount); }
function isSupplierBill(row) { return row.type !== "customer_change_refund"; }
function cap(list) { return {items: list.slice(0, LIST_LIMIT), total: list.length, truncated: list.length > LIST_LIMIT}; }
function billSummary(row) { return {payableId: row.id, supplierId: text(row.supplierId), party: text(row.party, 120), ref: text(row.ref, 120), date: text(row.date, 10), type: text(row.type, 60), amount: money(row.amount), purchaseInvoiceId: text(row.purchaseInvoiceId)}; }

/* 1. A bill (not reversed) carrying more payment than its amount, or a negative balance. */
function overpaidBills(payables) {
  return payables.filter((row) => isSupplierBill(row) && row.status !== "reversed").map((row) => {
    const amount = money(row.amount), paid = paidOn(row), remaining = remainingOf(row);
    return Object.assign(billSummary(row), {status: text(row.status, 30) || "open", paid, remaining, excess: money(Math.max(paid - amount, -remaining, 0))});
  }).filter((row) => row.paid > row.amount + TOLERANCE || row.remaining < -TOLERANCE);
}

/* 2. A bill cleared by its PURCHASE reversal after money was paid against it. A bill reversed on
   its own clears only its unpaid balance and is correct, so it is not listed. */
function reversedAfterPayment(payables) {
  return payables.filter((row) => isSupplierBill(row) && row.status === "reversed" && /^purchase_(ap|owner)_reversal_/.test(text(row.reversalMovementId)) && paidOn(row) > TOLERANCE)
    .map((row) => Object.assign(billSummary(row), {paid: paidOn(row), reversalMovementId: text(row.reversalMovementId)}));
}

/* 3a. An on-account or pending purchase with no live bill. 3b. A purchase whose total differs from
   the stock value actually posted plus its expense / fixed-asset lines and input VAT. */
function purchaseFindings(invoices, payablesById, purchaseMovements) {
  const withoutBill = [], valueGaps = [];
  invoices.filter((inv) => inv.reversed !== true).forEach((inv) => {
    const base = {invoiceId: inv.id, supplierId: text(inv.supplierId), supplier: text(inv.supplier, 120), ref: text(inv.ref, 120), date: text(inv.date, 10), payMode: text(inv.payMode, 30), total: money(inv.total)};
    if ((inv.payMode === "account" || inv.payMode === "pending") && (!inv.payableId || !payablesById[inv.payableId] || payablesById[inv.payableId].status === "reversed")) withoutBill.push(Object.assign(base, {payableId: text(inv.payableId), reason: !inv.payableId ? "no bill linked" : !payablesById[inv.payableId] ? "linked bill is missing" : "linked bill reversed"}));
    const ids = Array.isArray(inv.movementIds) ? inv.movementIds : [];
    const lines = Array.isArray(inv.lines) ? inv.lines : [];
    const missing = ids.filter((id) => !purchaseMovements[id]);
    const stock = money(ids.reduce((sum, id) => { const m = purchaseMovements[id]; return m ? sum + Number(m.qty || 0) * Number(m.unitCost || 0) : sum; }, 0));
    const other = money(lines.filter((line) => line && (line.lineType === "expense" || line.lineType === "fixed_asset")).reduce((sum, line) => sum + money(line.total), 0));
    const expected = money(stock + other + money(inv.inputVat));
    const gap = money(base.total - expected);
    if (missing.length || Math.abs(gap) > TOLERANCE) valueGaps.push(Object.assign(base, {postedStockValue: stock, otherLines: other, inputVat: money(inv.inputVat), expected, gap, missingMovementIds: missing.slice(0, 20), noMovementLinks: ids.length === 0}));
  });
  return {withoutBill, valueGaps};
}

/* 4. Undeposited Collection: cash custody still held vs the General Ledger 1030 balance. */
function custodyDrift(custodyRows, undepositedGl) {
  const all = rows(custodyRows), open = all.filter((row) => money(row.remaining) > 0.005), negative = all.filter((row) => money(row.remaining) < -0.005);
  const custody = money(open.concat(negative).reduce((sum, row) => sum + money(row.remaining), 0)), gl = money(undepositedGl);
  return {gl, custody, difference: money(gl - custody), openRows: open.length, negativeRows: negative.length, reconciled: Math.abs(gl - custody) <= TOLERANCE && !negative.length};
}

/* 5. The same supplier invoice reference recorded more than once. A purchase and its own bill
   share a reference, so only bills NOT linked to a purchase are compared with purchases. */
function duplicateRefs(invoices, payables) {
  // Each record is indexed under its supplier ID AND its normalized supplier name, because older
  // manual bills carry no supplier ID. A group found under both keys is reported once.
  const groups = {}, nameKey = (value) => `name:${text(value, 120).toLowerCase().replace(/\s+/g, " ")}`;
  const add = (keys, ref, entry) => { const key = refKey(ref); if (!key || /^pending/.test(key)) return; [...new Set(keys.filter(Boolean))].forEach((supplierKey) => { const id = `${supplierKey}|${key}`; (groups[id] = groups[id] || []).push(entry); }); };
  const live = invoices.filter((inv) => inv.reversed !== true), linkedBills = new Set(live.map((inv) => text(inv.payableId)).filter(Boolean));
  live.forEach((inv) => add([text(inv.supplierId), nameKey(inv.supplier)], inv.ref, {kind: "purchase", id: inv.id, ref: text(inv.ref, 120), party: text(inv.supplier, 120), amount: money(inv.total), date: text(inv.date, 10)}));
  payables.filter((row) => isSupplierBill(row) && row.type !== "owner reimbursement" && row.status !== "reversed" && !row.purchaseInvoiceId && !linkedBills.has(row.id)).forEach((row) => add([text(row.supplierId), nameKey(row.party)], row.ref, {kind: "bill", id: row.id, ref: text(row.ref, 120), party: text(row.party, 120), amount: money(row.amount), date: text(row.date, 10)}));
  const seen = new Set();
  return Object.keys(groups).sort().filter((key) => groups[key].length > 1).map((key) => ({key, entries: groups[key]})).filter((group) => { const signature = group.entries.map((entry) => `${entry.kind}:${entry.id}`).sort().join(","); if (seen.has(signature)) return false; seen.add(signature); return true; });
}

/* 6. A purchase invoice whose payment status disagrees with its bill (the bill is the authority). */
function mirrorDrift(invoices, payablesById) {
  return invoices.filter((inv) => inv.reversed !== true && inv.payableId && payablesById[inv.payableId] && payablesById[inv.payableId].status !== "reversed").map((inv) => {
    const bill = payablesById[inv.payableId], billPaid = paidOn(bill), billRemaining = bill.status === "reversed" ? 0 : remainingOf(bill);
    const expectedStatus = bill.status === "paid" || (billPaid > TOLERANCE && billRemaining <= TOLERANCE) ? "paid" : billPaid > TOLERANCE ? "partially_paid" : "unpaid";
    const invoicePaid = money(inv.paidAmount), invoiceStatus = text(inv.paymentStatus, 30) || "unpaid";
    const differences = [];
    if (Math.abs(invoicePaid - billPaid) > TOLERANCE) differences.push("paid amount");
    if (inv.remainingAmount != null && Math.abs(money(inv.remainingAmount) - billRemaining) > TOLERANCE) differences.push("remaining amount");
    if (invoiceStatus !== expectedStatus) differences.push("payment status");
    return {invoiceId: inv.id, payableId: inv.payableId, supplier: text(inv.supplier, 120), ref: text(inv.ref, 120), invoicePaid, billPaid, invoiceStatus, expectedStatus, differences};
  }).filter((row) => row.differences.length);
}

function buildReport(input) {
  const source = input || {};
  const payables = rows(source.payables), invoices = rows(source.purchaseInvoices), payablesById = source.payables || {};
  const overpaid = overpaidBills(payables), reversed = reversedAfterPayment(payables);
  const purchases = purchaseFindings(invoices, payablesById, source.purchaseMovements || {});
  const custody = custodyDrift(source.custodyRows, source.undepositedGl);
  const duplicates = duplicateRefs(invoices, payables), mirror = mirrorDrift(invoices, payablesById);
  const counts = {overpaidBills: overpaid.length, reversedAfterPayment: reversed.length, purchasesWithoutBill: purchases.withoutBill.length, purchaseValueGaps: purchases.valueGaps.filter((row) => !row.noMovementLinks).length, purchasesWithoutStockLinks: purchases.valueGaps.filter((row) => row.noMovementLinks).length, custodyDrift: custody.reconciled ? 0 : 1, duplicateRefGroups: duplicates.length, paymentMirrorDrift: mirror.length};
  return {
    generatedAt: Number(source.generatedAt) || 0,
    scanned: {payables: payables.length, purchaseInvoices: invoices.length, purchaseMovements: Object.keys(source.purchaseMovements || {}).length, custodyRows: rows(source.custodyRows).length},
    counts,
    issues: Object.values(counts).reduce((sum, value) => sum + value, 0),
    totals: {overpaidExcess: money(overpaid.reduce((sum, row) => sum + row.excess, 0)), reversedAfterPaymentPaid: money(reversed.reduce((sum, row) => sum + row.paid, 0)), purchasesWithoutBill: money(purchases.withoutBill.reduce((sum, row) => sum + row.total, 0)), purchaseValueGapNet: money(purchases.valueGaps.filter((row) => !row.noMovementLinks).reduce((sum, row) => sum + row.gap, 0)), purchasesWithoutStockLinks: money(purchases.valueGaps.filter((row) => row.noMovementLinks).reduce((sum, row) => sum + row.gap, 0))},
    overpaidBills: cap(overpaid),
    reversedAfterPayment: cap(reversed),
    purchasesWithoutBill: cap(purchases.withoutBill),
    purchaseValueGaps: cap(purchases.valueGaps),
    custody,
    duplicateRefs: cap(duplicates),
    paymentMirrorDrift: cap(mirror),
  };
}

module.exports = {TOLERANCE, LIST_LIMIT, refKey, paidOn, overpaidBills, reversedAfterPayment, purchaseFindings, custodyDrift, duplicateRefs, mirrorDrift, buildReport};
