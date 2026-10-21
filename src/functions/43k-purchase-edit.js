
// Purchase Edit (corrections only) — Danilo, 21 Oct 2026: "if you edit the amount then change the
// amount, if you edit the quantity then change the quantity." A Super Admin corrects the quantity
// and/or amount of the lines of a posted purchase (and its input VAT) while the purchase month is
// open. Nothing posted is deleted or renumbered: stock receives correction movements, the unpaid
// bill or the bank payment is adjusted, and ONE correction journal dated on the purchase date
// carries only the difference. The purchase keeps its PUR number and an edit history.
// Called from managePurchaseCorrection (action "edit_lines") under the purchase correction lock.
// Every check runs BEFORE any stock moves, so a refused edit changes nothing.
async function editPurchaseLines(db, actor, invoiceId, invoice, data, reason, now) {
  if (actor.role !== "superadmin") throw new HttpsError("permission-denied", "Only a Super Admin can edit a posted purchase.");
  if (invoice.reversed === true) throw new HttpsError("failed-precondition", "This purchase is voided. Enter a new purchase instead.");
  const date = financeDate(invoice.date), accountingAt = Date.parse(`${date}T00:00:00+08:00`) || now;
  await assertAccountingPeriodOpen(db, date, "editing this purchase");
  const revision = Math.trunc(Number(invoice.editRevision || 0)), nextRevision = revision + 1;
  if (Math.trunc(Number(data.expectedRevision)) !== revision || Financial.money(data.expectedTotal) !== Financial.money(invoice.total)) throw new HttpsError("failed-precondition", "This purchase changed after you opened it. Refresh and edit it again.");
  const lines = Array.isArray(invoice.lines) ? invoice.lines : [], next = lines.map((line) => Object.assign({}, line)), changes = [], seen = new Set();
  for (const row of (Array.isArray(data.lines) ? data.lines : []).slice(0, 200)) {
    const index = Math.trunc(Number(row && row.lineIndex)), line = lines[index];
    if (!Number.isInteger(index) || index < 0 || !line || seen.has(index)) throw new HttpsError("invalid-argument", "Each purchase line can be corrected once per edit. Refresh and try again.");
    seen.add(index);
    const oldQty = qty6(line.qty), oldTotal = Financial.money(line.total), newQty = qty6(row.qty), newTotal = Financial.money(row.total);
    // The form states what it saw; a line corrected elsewhere since then must not be silently overwritten.
    if (qty6(row.expectedQty) !== oldQty || Financial.money(row.expectedTotal) !== oldTotal) throw new HttpsError("failed-precondition", `Line ${index + 1} changed after you opened the form. Refresh and edit it again.`);
    if (newQty === oldQty && newTotal === oldTotal) continue;
    if (line.lineType === "fixed_asset") throw new HttpsError("failed-precondition", "Equipment lines are linked to fixed-asset cards. Void the purchase and enter it again to change them.");
    if (!(newQty > 0) || newQty > 100000000) throw new HttpsError("invalid-argument", "Enter a quantity greater than zero.");
    if (!(newTotal >= 0) || newTotal > 100000000) throw new HttpsError("invalid-argument", "Enter a valid line amount.");
    const stock = line.lineType !== "expense";
    if (stock && !(newTotal > 0)) throw new HttpsError("invalid-argument", "A stock line must have an amount greater than zero.");
    if (stock && (!line.itemId || !line.receiptId)) throw new HttpsError("failed-precondition", "This stock line has no linked stock receipt. Repair the purchase receipt before editing it.");
    next[index] = Object.assign(next[index], {qty: newQty, total: newTotal, unitCost: stock ? qty6(newTotal / newQty) : Math.round((newTotal / newQty) * 100000) / 100000, editRevision: nextRevision});
    changes.push({index, line, stock, oldQty, newQty, oldTotal, newTotal});
  }
  const oldVat = Financial.money(invoice.inputVat), vatGiven = data.inputVat !== undefined && data.inputVat !== null && data.inputVat !== "", newVat = vatGiven ? Financial.money(data.inputVat) : oldVat;
  if (!(newVat >= 0)) throw new HttpsError("invalid-argument", "Enter a valid input VAT amount.");
  if (!changes.length && newVat === oldVat) throw new HttpsError("invalid-argument", "Nothing was changed.");
  const linesNet = Financial.money(next.reduce((sum, line) => sum + Financial.money(line.total), 0));
  if (newVat > 0 && newVat >= linesNet) throw new HttpsError("invalid-argument", "Input VAT must be less than the line amounts. Enter line costs net of VAT.");
  const oldTotal = Financial.money(invoice.total), lineDelta = Financial.money(changes.reduce((sum, c) => sum + c.newTotal - c.oldTotal, 0));
  const newTotal = Financial.money(oldTotal + lineDelta + (newVat - oldVat)), totalDelta = Financial.money(newTotal - oldTotal);
  if (!(newTotal > 0)) throw new HttpsError("invalid-argument", "The purchase total must stay above zero.");
  const after = Object.assign({}, invoice, {lines: next, total: newTotal, inputVat: newVat});
  // The journal accounts are resolved now (this throws on bad coding) so nothing moves before they are known.
  const [oldGl, newGl] = [await purchaseInventoryLines(db, invoice, false), await purchaseInventoryLines(db, after, false)];

  const payMode = String(invoice.payMode || ""), writes = {}, payableClaims = [];
  let fundingAccount = "", payableId = "", cashAccountId = "";
  try {
    // Funding side: the same bill, or the same bank / e-wallet account the purchase was paid from.
    if (payMode === "account" || payMode === "pending") {
      payableId = financeText(invoice.payableId, 160);
      if (!payableId) throw new HttpsError("failed-precondition", "This purchase has no linked supplier bill. Use Purchase corrections → Repair payable first, then edit.");
      const claim = await claimPayables(db, [payableId], `purchase_edit_${invoiceId}_r${nextRevision}`, actor, payableClaims), payable = claim.doc(payableId);
      if (!payable || payable.status !== "open") throw new HttpsError("failed-precondition", "The supplier bill for this purchase is not open, so it can't be edited. Open it in Finance Books → Payables.");
      if (Financial.payableHasSettlement(payable)) throw new HttpsError("failed-precondition", `This supplier bill already has ${Financial.payableSettledAmount(payable).toFixed(2)} paid against it. Reverse the payment first (Finance Books → Payables → Show settled → Reverse payment), then edit the purchase.`);
      fundingAccount = payable.provisional === true ? `liability:grni:${payableId}` : `liability:payable:${payableId}`;
      if (totalDelta !== 0) Object.assign(writes, {[`payables/${payableId}/amount`]: newTotal, [`payables/${payableId}/lastEditAt`]: now, [`payables/${payableId}/lastEditRevision`]: nextRevision});
      Object.assign(writes, {[`payables/${payableId}/rev`]: claim.nextRev(payableId)}, claim.releaseWrites);
    } else if (payMode === "paid") {
      const paymentId = financeText(invoice.paymentMovementId, 160) || `purchase_cash_${invoiceId}`, payment = (await db.ref(`/financialMovements/${financeKey(paymentId, "Movement ID")}`).get()).val();
      const cashLine = payment && payment.sourceId === invoiceId && Array.isArray(payment.lines) ? payment.lines.find((line) => /^asset:cash_account:/.test(String(line && line.account || "")) && Number(line.credit) > 0) : null;
      if (!cashLine) throw new HttpsError("failed-precondition", "Only purchases paid from a bank or e-wallet account can be edited. A purchase paid from Cash on Hand or Undeposited Collection must be voided and entered again.");
      fundingAccount = String(cashLine.account); cashAccountId = fundingAccount.slice("asset:cash_account:".length);
    } else {
      throw new HttpsError("failed-precondition", "Purchases paid by a supplier advance or personally by the owner can't be edited yet. Void the purchase and enter it again.");
    }

    // Stock pre-checks: item, receipt, batch and account mapping exist; the item's stock can absorb
    // the quantity and value change. The on-hand share of a price change is capped at the item's
    // total quantity on THIS purchase (all its lines), split pro rata per line.
    const stockChanges = changes.filter((c) => c.stock), batches = stockChanges.length ? ((await db.ref("/inventoryBatch").orderByChild("invoiceId").equalTo(invoiceId).get()).val() || {}) : {}, items = {};
    for (const change of stockChanges) {
      const {line} = change, itemId = financeKey(line.itemId, "Inventory item");
      if (!items[itemId]) {
        const [itemSnap, poolSnap] = await Promise.all([db.ref(`/inventory/${itemId}`).get(), db.ref(`/inventoryAccounting/${itemId}`).get()]), item = itemSnap.val();
        if (!item) throw new HttpsError("failed-precondition", `Stock item ${line.itemName || itemId} no longer exists.`);
        const pool = poolSnap.val() || {}, invoiceQty = qty6(next.filter((l) => l && l.itemId === line.itemId && l.lineType !== "expense" && l.lineType !== "fixed_asset").reduce((sum, l) => sum + qty6(l.qty), 0));
        items[itemId] = {item, mapping: BooksBridge.itemAccounts(item), balance: qty6(pool.balance !== undefined ? pool.balance : item.stock), cost: qty6(pool.unitCost || item.cost), invoiceQty, qtyDelta: 0, stockValue: 0};
      }
      const receiptId = financeKey(line.receiptId, "Stock receipt ID"), receipt = (await db.ref(`/stockReceipts/${receiptId}`).get()).val(), batchId = Object.keys(batches).find((id) => batches[id] && batches[id].receiptId === receiptId);
      if (!receipt || receipt.invoiceId !== invoiceId || financeText(receipt.ing, 160) !== financeText(line.itemId, 160)) throw new HttpsError("failed-precondition", `The stock receipt for line ${change.index + 1} is missing or does not match. Repair the purchase receipt before editing.`);
      if (!batchId) throw new HttpsError("failed-precondition", `The stock batch for line ${change.index + 1} is missing. Repair the purchase receipt before editing.`);
      if (change.newTotal !== change.oldTotal && (!items[itemId].mapping.inventory || !items[itemId].mapping.cost)) throw new HttpsError("failed-precondition", `${items[itemId].item.name || itemId} is missing its Inventory (12xx) or COGS (5xxx) account. Map it under Stock Items, then edit again.`);
      Object.assign(change, {itemId, receiptId, receipt, batchId});
      items[itemId].qtyDelta = qty6(items[itemId].qtyDelta + change.newQty - change.oldQty);
    }
    Object.keys(items).forEach((itemId) => {const it = items[itemId], balanceAfterQty = qty6(it.balance + it.qtyDelta); if (it.qtyDelta < 0 && balanceAfterQty < 0) throw new HttpsError("failed-precondition", `${it.item.name || itemId} does not have enough stock on hand to lower this quantity. Count and adjust the stock first.`); it.balanceAfterQty = balanceAfterQty;});
    for (const change of stockChanges.filter((c) => c.newTotal !== c.oldTotal)) {
      const it = items[change.itemId], onHand = Math.max(0, Math.min(it.balanceAfterQty, it.invoiceQty)), share = it.balanceAfterQty > 0 && it.invoiceQty > 0 ? Math.round((change.newTotal - change.oldTotal) * (onHand / it.invoiceQty) * 100) / 100 : 0;
      it.stockValue = Financial.money(it.stockValue + share); change.expectedStockShare = share;
    }
    Object.keys(items).forEach((itemId) => {const it = items[itemId]; if (it.balanceAfterQty > 0 && (it.balanceAfterQty * it.cost) + it.stockValue < -0.005) throw new HttpsError("failed-precondition", `${it.item.name || itemId} does not have enough stock value to absorb this price reduction. Review the stock first.`);});

    // Guard against a half-finished earlier attempt with different values.
    const intent = crypto.createHash("sha256").update(JSON.stringify({c: changes.map((c) => [c.index, c.newQty, c.newTotal]), v: newVat, r: nextRevision})).digest("hex").slice(0, 16), pending = invoice.pendingEdit || null;
    if (pending && Number(pending.revision) === nextRevision && pending.intent !== intent) throw new HttpsError("failed-precondition", "An earlier edit of this purchase did not finish. Retry exactly the same change first, then make further corrections.");
    if (!pending || pending.intent !== intent) await db.ref(`/purchaseInvoices/${invoiceId}/pendingEdit`).set({revision: nextRevision, intent, at: now, by: actor.uid});

    // Stock: all quantity corrections first (value kept), then value corrections against the corrected pool.
    const used = [], stockMovementIds = [], base = (c) => `purchase_edit_${invoiceId}_r${nextRevision}_${c.index}`, note = (c) => `Edit purchase ${invoice.documentNo || invoice.ref || invoiceId} line ${c.index + 1}: ${reason}`;
    for (const change of stockChanges.filter((c) => c.newQty !== c.oldQty)) {
      const moved = await applyInventoryMovement(db, {movementId: `${base(change)}_qty`, itemId: change.itemId, type: "purchase_quantity_correction", qty: qty6(change.newQty - change.oldQty), unitCost: qty6(change.oldTotal / change.newQty), sourceType: "purchase-edit", sourceId: invoiceId, sourceLine: String(change.index), note: note(change), actorName: actor.role, occurredAt: now}, actor);
      if (moved.movement) stockMovementIds.push(moved.movement.id);
    }
    for (const change of stockChanges.filter((c) => c.newTotal !== c.oldTotal)) {
      const it = items[change.itemId], moved = (await applyInventoryMovement(db, {movementId: `${base(change)}_cost`, itemId: change.itemId, type: "purchase_cost_correction", qty: 0, unitCost: 0, valueDelta: Financial.money(change.newTotal - change.oldTotal), lineQty: it.invoiceQty, sourceType: "purchase-edit", sourceId: invoiceId, sourceLine: String(change.index), note: note(change), actorName: actor.role, occurredAt: now}, actor)).movement || {};
      if (moved.id) stockMovementIds.push(moved.id);
      const usedValue = Financial.money(moved.usedValueDelta);
      if (usedValue) used.push({inventory: it.mapping.inventory, cost: it.mapping.cost, value: usedValue});
    }
    for (const change of stockChanges) {
      const batch = batches[change.batchId];
      Object.assign(writes, {[`stockReceipts/${change.receiptId}/qty`]: change.newQty, [`stockReceipts/${change.receiptId}/total`]: change.newTotal, [`stockReceipts/${change.receiptId}/unitCost`]: next[change.index].unitCost, [`stockReceipts/${change.receiptId}/editRevision`]: nextRevision,
        [`inventoryBatch/${change.batchId}/qtyRecv`]: change.newQty, [`inventoryBatch/${change.batchId}/qtyRemaining`]: qty6(Math.max(0, qty6(batch.qtyRemaining) + change.newQty - change.oldQty)), [`inventoryBatch/${change.batchId}/unitCost`]: next[change.index].unitCost, [`inventoryBatch/${change.batchId}/editRevision`]: nextRevision});
      if (financeText(change.receipt.recvUnit, 40) === financeText(change.receipt.unit, 40)) writes[`stockReceipts/${change.receiptId}/recvQty`] = change.newQty;
    }

    // One correction journal: the difference between the corrected and the posted purchase lines,
    // with any already-used share of a price change charged to the item's cost account.
    const diff = {};
    oldGl.forEach((line) => {diff[line.account] = Financial.money((diff[line.account] || 0) - Number(line.debit || 0));});
    newGl.forEach((line) => {diff[line.account] = Financial.money((diff[line.account] || 0) + Number(line.debit || 0));});
    used.forEach((u) => {diff[`coa:${u.inventory}`] = Financial.money((diff[`coa:${u.inventory}`] || 0) - u.value); diff[`coa:${u.cost}`] = Financial.money((diff[`coa:${u.cost}`] || 0) + u.value);});
    const memo = `Edit ${invoice.documentNo || invoice.ref || "purchase"} · ${financeText(invoice.supplier, 80)}`, journal = [], journalId = `purchase_edit_${invoiceId}_r${nextRevision}`;
    Object.keys(diff).sort().forEach((account) => {const value = Financial.money(diff[account]); if (Math.abs(value) >= 0.005) journal.push(Financial.line(account, value > 0 ? value : 0, value < 0 ? -value : 0, memo));});
    if (Math.abs(totalDelta) >= 0.005) journal.push(Financial.line(fundingAccount, totalDelta < 0 ? -totalDelta : 0, totalDelta > 0 ? totalDelta : 0, memo));
    const usedTotal = Financial.money(used.reduce((sum, u) => sum + u.value, 0));
    Object.assign(writes, {
      [`purchaseInvoices/${invoiceId}/lines`]: next, [`purchaseInvoices/${invoiceId}/total`]: newTotal, [`purchaseInvoices/${invoiceId}/inputVat`]: newVat,
      [`purchaseInvoices/${invoiceId}/editRevision`]: nextRevision, [`purchaseInvoices/${invoiceId}/lastEditAt`]: now, [`purchaseInvoices/${invoiceId}/lastEditBy`]: actor.uid, [`purchaseInvoices/${invoiceId}/lastEditReason`]: reason,
      [`purchaseInvoices/${invoiceId}/editUsedValueTotal`]: Financial.money(Financial.money(invoice.editUsedValueTotal) + usedTotal), [`purchaseInvoices/${invoiceId}/pendingEdit`]: null,
      [`purchaseInvoices/${invoiceId}/editHistory/r${nextRevision}`]: {at: now, by: actor.uid, byName: financeText(actor.name || actor.role, 120), reason, before: {total: oldTotal, inputVat: oldVat, lines: changes.map((c) => ({line: c.index + 1, item: financeText(c.line.itemName, 120), qty: c.oldQty, total: c.oldTotal}))}, after: {total: newTotal, inputVat: newVat, lines: changes.map((c) => ({line: c.index + 1, item: financeText(c.line.itemName, 120), qty: c.newQty, total: c.newTotal}))}, usedValueToCost: usedTotal, journalId: journal.length ? journalId : "", stockMovementIds},
      [`operationalAudit/${now}_purchase_edit_${invoiceId}`]: {action: "edit_purchase_lines", sourceType: "purchaseInvoice", sourceId: invoiceId, revision: nextRevision, beforeTotal: oldTotal, afterTotal: newTotal, totalDelta, usedValueToCost: usedTotal, fundingAccount, reason, actorUid: actor.uid, actorRole: actor.role, ts: now, schemaVersion: 1},
    });
    if (journal.length) {
      if (!BooksBridge.linesBalanced(journal)) throw new HttpsError("failed-precondition", "The purchase correction is not balanced. Nothing was posted to Finance Books; retry the same change or ask for a review.");
      const movement = Financial.movement("purchase_edit", "purchaseInvoice", invoiceId, journal, {occurredAt: accountingAt, actorName: financeText(actor.name || actor.role, 120), revision: nextRevision, reason, documentNo: financeText(invoice.documentNo, 40), supplierId: financeText(invoice.supplierId, 160)});
      // A bank-paid purchase also corrects the cash ledger, so the bank account's ledger stays equal to Finance Books.
      if (cashAccountId && Math.abs(totalDelta) >= 0.005) writes[`cfLedger/fm_${journalId}`] = cashLedgerRecord({date, accountId: cashAccountId, dir: totalDelta > 0 ? "out" : "in", category: "Purchase correction", amount: Math.abs(totalDelta), party: invoice.supplier, ref: invoice.documentNo || invoice.ref, auto: true}, journalId, movement, actor);
      await commitFinancial(db, journalId, movement, actor, writes);
    } else {
      await db.ref().update(writes);
    }
    return {invoiceId, result: "edited", revision: nextRevision, oldTotal, newTotal, totalDelta, usedValueToCost: usedTotal, journalLines: journal.length};
  } finally {
    for (const set of payableClaims) await set.release();
  }
}
