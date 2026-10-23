
// Purchase date correction (Danilo, 23 Oct 2026): Edit details changes the date of a posted purchase, in
// place, the way the purchase-reversal date correction already works. Every Finance Books posting of the
// purchase that sits on the old date (the purchase itself, its payment, amendments and account
// corrections), their bank / Undeposited Collection ledger rows, the supplier bill, and the stock receipts
// and batches move to the new date. Amounts, accounts, stock quantities and the stock ledger's posting
// order do not change. Super Admin only; both months must be open. Refused when the supplier bill has a
// payment, when a cash row is bank-reconciled, when another posting of the purchase would end up before
// it, when the purchase is paid by a supplier advance or by the owner, or when the year changes (the PUR
// number belongs to its year). Each change keeps a dated revision with before/after values.
async function redatePurchase(db, actor, invoiceId, invoice, data, reason, now) {
  if (actor.role !== "superadmin") throw new HttpsError("permission-denied", "Only a Super Admin can change the date of a posted purchase.");
  if (invoice.reversed === true) throw new HttpsError("failed-precondition", "This purchase is voided; its date can't be changed. Use Correct reversal date for the void.");
  if (invoice.pendingEdit) throw new HttpsError("failed-precondition", "A change to this purchase did not finish. Open Amend and save the same change again before changing its date.");
  const oldDate = financeDate(invoice.date), newDate = financeDate(data.date), revision = Math.max(0, Math.trunc(Number(invoice.dateRevision) || 0)), nextRevision = revision + 1;
  if (newDate === oldDate) return {invoiceId, result: "date_unchanged", date: newDate, duplicate: true};
  if (Math.trunc(Number(data.expectedDateRevision)) !== revision) throw new HttpsError("aborted", "This purchase's date was changed after you opened it. Refresh and try again.");
  if (newDate.slice(0, 4) !== oldDate.slice(0, 4) && invoice.documentNo) throw new HttpsError("failed-precondition", `${invoice.documentNo} belongs to ${oldDate.slice(0, 4)}, so it can't move to ${newDate.slice(0, 4)}. Void it and enter the purchase again in ${newDate.slice(0, 4)}.`);
  await assertAccountingPeriodOpen(db, oldDate, "changing this purchase date");
  await assertAccountingPeriodOpen(db, newDate, "moving this purchase into it");
  const payMode = String(invoice.payMode || ""), paidFrom = financeText(invoice.accountId, 120);
  if (payMode === "advance" || payMode === "owner_funded") throw new HttpsError("failed-precondition", "Purchases paid by a supplier advance or personally by the owner can't be re-dated yet. Void the purchase and enter it again.");
  if (payMode === "paid" && (paidFrom === "cash_on_hand" || paidFrom === "register")) throw new HttpsError("failed-precondition", "This purchase was paid from register cash, which belongs to a counted shift. Void it and enter it again on the right date.");

  // Every Finance Books posting of this purchase (bounded: indexed by sourceId). A bill purchase's own
  // posting (payable_created / grni_created) is filed under the supplier bill, not the purchase.
  const payableKey = financeText(invoice.payableId, 160);
  if ((payMode === "account" || payMode === "pending") && !payableKey) throw new HttpsError("failed-precondition", "This purchase has no linked supplier bill. Use Repair payable first, then change the date.");
  const [ownSnap, billSnap] = await Promise.all([db.ref("/financialMovements").orderByChild("sourceId").equalTo(invoiceId).get(), payableKey ? db.ref("/financialMovements").orderByChild("sourceId").equalTo(payableKey).get() : Promise.resolve(null)]);
  const own = ownSnap.val() || {}, bill = (billSnap && billSnap.val()) || {}, linked = {};
  Object.keys(own).forEach((id) => {if (own[id] && own[id].sourceType === "purchaseInvoice") linked[id] = own[id];});
  Object.keys(bill).forEach((id) => {if (bill[id] && bill[id].sourceType === "payable" && ["payable_created", "grni_created"].includes(String(bill[id].type || ""))) linked[id] = bill[id];});
  const day = (date) => Date.parse(`${date}T00:00:00+08:00`), shift = day(newDate) - day(oldDate), moves = [];
  for (const id of Object.keys(linked).sort()) {
    const movement = linked[id], at = Number(movement.occurredAt || movement.postedAt || 0), date = financeDateFromTimestamp(at);
    if (date === oldDate) {moves.push({id, movement, at}); continue;}
    if (date < newDate) throw new HttpsError("failed-precondition", `Another posting of this purchase is dated ${date}, before ${newDate}. Nothing was changed; ask for a review.`);
  }
  // The purchase's own posting must be among the moved rows, or Books would keep it on the old date.
  const paymentId = financeText(invoice.paymentMovementId, 160) || `purchase_cash_${invoiceId}`;
  const main = payMode === "paid" ? moves.find((m) => m.id === paymentId) : moves.find((m) => m.movement.sourceType === "payable");
  if (!main) throw new HttpsError("failed-precondition", `The ${payMode === "paid" ? "payment" : "supplier bill"} posting of this purchase is not dated ${oldDate}, so the date can't be moved safely. Nothing was changed; ask for a review.`);
  // Undeposited Collection: the cash that paid it must already have been collected on the new date.
  if (payMode === "paid" && paidFrom === "undeposited") {
    const allocations = purchaseCustodyNet(invoice, main.movement);
    for (const id of Object.keys(allocations)) {
      const row = (await db.ref(`/cashCustody/${financeKey(id, "Custody ID")}`).get()).val(), collected = row && Number(row.closedAt) ? financeDateFromTimestamp(Number(row.closedAt)) : "";
      if (collected && collected > newDate) throw new HttpsError("failed-precondition", `This purchase was paid from Undeposited Collection cash collected on ${collected}, so it can't be dated ${newDate}.`);
    }
  }

  const payableClaims = [], writes = {};
  let closeClaims = [];
  try {
    const payableId = payableKey;
    if (payableId) {
      const claim = await claimPayables(db, [payableId], `purchase_redate_${invoiceId}_r${nextRevision}`, actor, payableClaims), payable = claim.doc(payableId);
      if (payable && Financial.payableHasSettlement(payable)) throw new HttpsError("failed-precondition", `This supplier bill already has ${Financial.payableSettledAmount(payable).toFixed(2)} paid against it. Reverse the payment first (Finance Books → Payables → Show settled → Reverse payment), then change the date.`);
      if (payable) Object.assign(writes, {[`payables/${payableId}/date`]: newDate, [`payables/${payableId}/rev`]: claim.nextRev(payableId)}, claim.releaseWrites);
    }
    const before = {}, after = {}, movementIds = [];
    for (const m of moves) {
      const key = financeKey(m.id, "Movement ID"), [journalSnap, ledgerSnap] = await Promise.all([db.ref(`/books/journal/${key}`).get(), db.ref(`/cfLedger/fm_${key}`).get()]), journal = journalSnap.val(), ledger = ledgerSnap.val();
      if (!journal || journal.sourceId !== String(m.movement.sourceId || "")) throw new HttpsError("failed-precondition", `The Finance Books journal for ${key} is missing or points elsewhere. Refresh Books and try again.`);
      if (ledger && (ledger.bankReconciled === true || ledger.reconciled === true || ledger.reconciledAt || ledger.bankReconciliationId || ledger.statementId)) throw new HttpsError("failed-precondition", "The payment of this purchase is bank-reconciled. Reopen that bank reconciliation before changing the date.");
      const occurredAt = m.at + shift;
      writes[`financialMovements/${key}`] = Object.assign({}, m.movement, {occurredAt, accountingDate: newDate, accountingDateRevision: nextRevision, accountingDateReason: reason, accountingDateUpdatedAt: now, accountingDateUpdatedBy: actor.uid});
      // Only the date moves; the journal's lines stay exactly as posted (Books totals follow via updateBooksMonthlyNet).
      writes[`books/journal/${key}`] = Object.assign({}, journal, {date: newDate, updatedAt: now, updatedBy: actor.uid, accountingDateRevision: nextRevision});
      if (ledger) writes[`cfLedger/fm_${key}`] = Object.assign({}, ledger, {date: newDate, ts: occurredAt, accountingDateRevision: nextRevision, accountingDateUpdatedAt: now, accountingDateUpdatedBy: actor.uid});
      writes[`cashJournalRevisions/${key}/${nextRevision}`] = {revision: nextRevision, reason, changedAt: now, changedBy: actor.uid, changedByRole: actor.role, before: {occurredAt: m.at, journalDate: journal.date || oldDate, ledgerDate: ledger ? ledger.date : null}, after: {occurredAt, journalDate: newDate, ledgerDate: ledger ? newDate : null}, kind: "purchase_accounting_date"};
      before[key] = m.at; after[key] = occurredAt; movementIds.push(key);
    }
    // Source documents: the purchase, its stock receipts and batches show the new date.
    (Array.isArray(invoice.receiptIds) ? invoice.receiptIds : []).concat(Array.isArray(invoice.removedReceiptIds) ? invoice.removedReceiptIds : []).forEach((id) => {writes[`stockReceipts/${financeKey(id, "Stock receipt ID")}/date`] = newDate;});
    const batches = (await db.ref("/inventoryBatch").orderByChild("invoiceId").equalTo(invoiceId).get()).val() || {};
    Object.keys(batches).forEach((id) => {if (batches[id] && financeText(batches[id].recvDate, 10) === oldDate) writes[`inventoryBatch/${id}/recvDate`] = newDate;});
    Object.assign(writes, {
      [`purchaseInvoices/${invoiceId}/date`]: newDate, [`purchaseInvoices/${invoiceId}/dateRevision`]: nextRevision,
      [`purchaseInvoices/${invoiceId}/lastDateCorrectionAt`]: now, [`purchaseInvoices/${invoiceId}/lastDateCorrectionBy`]: actor.uid, [`purchaseInvoices/${invoiceId}/lastDateCorrectionReason`]: reason,
      [`purchaseInvoices/${invoiceId}/dateHistory/r${nextRevision}`]: {from: oldDate, to: newDate, at: now, by: actor.uid, byName: financeText(actor.name || actor.role, 120), reason, movementIds},
      [`operationalAudit/${now}_purchase_redate_${invoiceId}_${nextRevision}`]: {action: "correct_purchase_date", sourceType: "purchaseInvoice", sourceId: invoiceId, revision: nextRevision, fromDate: oldDate, toDate: newDate, movementIds, before, after, payableId: payableId || "", total: Financial.money(invoice.total), reason, actorUid: actor.uid, actorRole: actor.role, ts: now, schemaVersion: 1},
    });
    // Closes covering either date are reopened, as the reversal-date correction does.
    closeClaims = await claimPurchaseReversalCloseLocks(db, [oldDate, newDate], actor, invoiceId);
    for (const date of [oldDate, newDate]) {
      const indexes = (await db.ref(`/financialCloseIndex/${date}`).get()).val() || {};
      for (const closeId of Object.keys(indexes)) {
        if (!(await db.ref(`/financialCloses/${closeId}/current`).get()).val()) continue;
        Object.assign(writes, {[`financialCloses/${closeId}/current/status`]: "REOPENED", [`financialCloses/${closeId}/current/reopenedAt`]: now, [`financialCloses/${closeId}/current/reopenedByActivityId`]: `purchase_redate_${invoiceId}_${nextRevision}`, [`financialCloseIndex/${date}/${closeId}/status`]: "REOPENED"});
      }
    }
    // One atomic update keeps the purchase, its postings, Books, the cash ledger, the bill and the audit in step.
    await db.ref().update(writes);
    return {invoiceId, result: "date_corrected", fromDate: oldDate, toDate: newDate, revision: nextRevision, movements: movementIds.length};
  } finally {
    await releasePurchaseReversalCloseLocks(closeClaims);
    for (const set of payableClaims) await set.release();
  }
}
