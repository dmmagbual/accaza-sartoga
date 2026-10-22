
// Purchase Amend (Danilo, 22 Oct 2026): "Amend reopens the purchase details on the entry card and Save
// updates the same purchase in place, with no reversal" — like Xero / QuickBooks. A Super Admin adds,
// removes or changes lines (quantity, amount, brand, expense account), the input VAT and the description
// of a posted purchase while its month is open. The purchase keeps its PUR number and an edit history.
// Stock moves by the difference only. Stock that was already sold when a line is removed or reduced
// cannot leave the shelf again, so its value is charged back to the item's COGS account (decision
// 22 Oct 2026); a price change on stock already used goes to COGS as in Purchase Edit. A bill with any
// payment against it must have the payment reversed first (Xero rule, decision 22 Oct 2026).
// ONE amendment journal dated on the purchase date carries the difference.
// Called from managePurchaseCorrection (action "amend") under the purchase correction lock.
// Every check runs BEFORE any stock moves, so a refused amendment changes nothing; a retry of the
// same amendment replays the stored stock plan, so it cannot move stock twice.
function amendLineSignature(line) {
  return [String(line.lineType || "stock"), String(line.itemId || ""), String(line.expenseAccount || ""), String(line.itemName || ""), String(line.skuId || ""), qty6(line.qty), Financial.money(line.total)].join("|");
}
function amendStockValue(movement) {
  // The stock ledger values an item at quantity x unit cost, so its true value change is after - before.
  const m = movement || {};
  return Financial.money(qty6(m.balanceAfter) * qty6(m.costAfter) - qty6(m.balanceBefore) * qty6(m.costBefore));
}
async function amendPurchase(db, actor, invoiceId, invoice, data, reason, now) {
  if (actor.role !== "superadmin") throw new HttpsError("permission-denied", "Only a Super Admin can amend a posted purchase.");
  if (invoice.reversed === true) throw new HttpsError("failed-precondition", "This purchase is voided. Enter a new purchase instead.");
  // Finish an amendment that stopped part-way: replay exactly the request that was staged.
  if (data.resume === true) {
    const staged = invoice.pendingEdit || null;
    if (!staged || staged.kind !== "amend" || !staged.request) throw new HttpsError("failed-precondition", "There is no unfinished amendment to finish on this purchase.");
    data = Object.assign({}, staged.request, {expectedRevision: Math.trunc(Number(invoice.editRevision || 0)), expectedTotal: invoice.total});
    reason = financeText(staged.request.reason, 300) || reason;
  }
  const date = financeDate(invoice.date), accountingAt = Date.parse(`${date}T00:00:00+08:00`) || now;
  await assertAccountingPeriodOpen(db, date, "amending this purchase");
  const revision = Math.trunc(Number(invoice.editRevision || 0)), nextRevision = revision + 1;
  if (Math.trunc(Number(data.expectedRevision)) !== revision || Financial.money(data.expectedTotal) !== Financial.money(invoice.total)) throw new HttpsError("failed-precondition", "This purchase changed after you opened it. Close the amendment, open it again and re-enter your changes.");
  const lines = Array.isArray(invoice.lines) ? invoice.lines : [], rows = Array.isArray(data.lines) ? data.lines.slice(0, 200) : [];
  if (!rows.length) throw new HttpsError("invalid-argument", "A purchase needs at least one line. To cancel the whole purchase, use Void.");
  const kept = new Set(), next = [], keeps = [], adds = [];
  let addSeq = 0;
  for (const row of rows) {
    const hasOrig = row && row.origIndex !== null && row.origIndex !== undefined && row.origIndex !== "";
    const newQty = qty6(row && row.qty), newTotal = Financial.money(row && row.total);
    if (hasOrig) {
      const index = Math.trunc(Number(row.origIndex)), line = lines[index];
      if (!Number.isInteger(index) || index < 0 || !line || kept.has(index)) throw new HttpsError("invalid-argument", "Each original purchase line can appear once. Close the amendment, open it again and retry.");
      kept.add(index);
      const lineType = line.lineType === "expense" ? "expense" : line.lineType === "fixed_asset" ? "fixed_asset" : "stock", oldQty = qty6(line.qty), oldTotal = Financial.money(line.total);
      if (lineType === "fixed_asset") {
        if (newQty !== oldQty || newTotal !== oldTotal) throw new HttpsError("failed-precondition", "Equipment lines are linked to fixed-asset cards and can't be amended. Void the purchase and enter it again to change them.");
        next.push(Object.assign({}, line)); continue;
      }
      if (lineType === "stock" && financeText(row.itemId, 160) && financeText(row.itemId, 160) !== financeText(line.itemId, 160)) throw new HttpsError("invalid-argument", "To change the item on a line, remove the line and add the new item.");
      if (!(newQty > 0) || newQty > 100000000) throw new HttpsError("invalid-argument", `Line ${next.length + 1}: enter a quantity greater than zero, or remove the line.`);
      if (!(newTotal > 0) || newTotal > 100000000) throw new HttpsError("invalid-argument", `Line ${next.length + 1}: enter an amount greater than zero.`);
      if (lineType === "stock" && (!line.itemId || !line.receiptId)) throw new HttpsError("failed-precondition", `Line ${index + 1} has no linked stock receipt. Repair the purchase receipt before amending it.`);
      const n = Object.assign({}, line, {qty: newQty, total: newTotal, unitCost: lineType === "stock" ? qty6(newTotal / newQty) : Math.round((newTotal / newQty) * 100000) / 100000});
      if (lineType === "expense") {const account = financeText(row.expenseAccount, 4), name = financeText(row.itemName, 120); if (account) n.expenseAccount = account; if (name) n.itemName = name;}
      if (lineType === "stock" && row.skuId !== undefined) {n.skuId = financeText(row.skuId, 160); n.skuBrand = financeText(row.skuBrand, 120);}
      next.push(n); keeps.push({index, key: `l${index}`, line, n, stock: lineType === "stock", oldQty, newQty, oldTotal, newTotal});
    } else {
      const lineType = row && row.lineType === "expense" ? "expense" : "stock";
      if (!(newQty > 0) || newQty > 100000000) throw new HttpsError("invalid-argument", `New line ${addSeq + 1}: enter a quantity greater than zero.`);
      if (!(newTotal > 0) || newTotal > 100000000) throw new HttpsError("invalid-argument", `New line ${addSeq + 1}: enter an amount greater than zero.`);
      const key = `a${addSeq}`; addSeq += 1;
      if (lineType === "expense") {
        const name = financeText(row.itemName, 120); if (!name) throw new HttpsError("invalid-argument", "Describe each new expense line.");
        const n = {lineType: "expense", itemName: name, expenseAccount: financeText(row.expenseAccount, 4), qty: newQty, unit: "use", unitCost: Math.round((newTotal / newQty) * 100000) / 100000, total: newTotal, addedRevision: nextRevision};
        next.push(n); adds.push({key, n, stock: false, newQty, newTotal});
      } else {
        const itemId = financeKey(row.itemId, "Inventory item"), receiptId = `rcpt_${invoiceId}_r${nextRevision}${key}`;
        const n = {receiptId, itemId, itemName: "", recipeItem: true, skuId: financeText(row.skuId, 160), skuBrand: financeText(row.skuBrand, 120), qty: newQty, unit: "", unitCost: qty6(newTotal / newQty), total: newTotal, addedRevision: nextRevision};
        next.push(n); adds.push({key, n, stock: true, itemId, receiptId, batchId: `bat_${invoiceId}_r${nextRevision}${key}`, newQty, newTotal, recvQty: Number(row.recvQty) > 0 ? qty6(row.recvQty) : newQty, recvUnit: financeText(row.recvUnit, 40)});
      }
    }
  }
  const removes = [];
  lines.forEach((line, index) => {
    if (!line || kept.has(index)) return;
    if (line.lineType === "fixed_asset") throw new HttpsError("failed-precondition", "Equipment lines are linked to fixed-asset cards and can't be removed. Void the purchase and enter it again.");
    const stock = line.lineType !== "expense";
    if (stock && (!line.itemId || !line.receiptId)) throw new HttpsError("failed-precondition", `Line ${index + 1} has no linked stock receipt. Repair the purchase receipt before amending it.`);
    removes.push({index, key: `l${index}`, line, stock, oldQty: qty6(line.qty), newQty: 0, oldTotal: Financial.money(line.total), newTotal: 0});
  });
  // Fill new stock lines from the item master (name, unit) and require its accounts.
  const items = {};
  const loadItem = async (itemId, label) => {
    if (items[itemId]) return items[itemId];
    const [itemSnap, poolSnap] = await Promise.all([db.ref(`/inventory/${itemId}`).get(), db.ref(`/inventoryAccounting/${itemId}`).get()]), item = itemSnap.val();
    if (!item) throw new HttpsError("failed-precondition", `Stock item ${label || itemId} no longer exists.`);
    if (item.archivedAt) throw new HttpsError("failed-precondition", `${item.name || itemId} is archived. Restore it under Stock Items first.`);
    const pool = poolSnap.val() || {}, mapping = BooksBridge.itemAccounts(item);
    const invAcct = String(item.inventoryAccount || ""), costAcct = String(item.costAccount || item.cogsAccount || "");
    // Same account rule the stock engine applies to a purchase movement, checked before anything moves.
    if (!mapping.inventory || !mapping.cost || !["1200", "1210", "1220", "1230", "1240", "1270", "1280"].includes(invAcct) || !["5000", "5010", "5020", "5030", "5040", "6070", "6075"].includes(costAcct)) throw new HttpsError("failed-precondition", `${item.name || itemId} is missing its Inventory (12xx) or COGS (5xxx) account. Map it under Stock Items, then amend again.`);
    return (items[itemId] = {item, mapping, balance: qty6(pool.balance !== undefined ? pool.balance : item.stock), cost: qty6(pool.unitCost || item.cost)});
  };
  for (const add of adds.filter((a) => a.stock)) {
    const it = await loadItem(add.itemId, add.itemId);
    Object.assign(add.n, {itemName: financeText(it.item.name, 160), unit: financeText(it.item.unit, 40), recipeItem: it.item.recipeItem !== false});
    if (!add.recvUnit) add.recvUnit = add.n.unit;
  }
  const oldVat = Financial.money(invoice.inputVat), vatGiven = data.inputVat !== undefined && data.inputVat !== null && data.inputVat !== "", newVat = vatGiven ? Financial.money(data.inputVat) : oldVat;
  if (!(newVat >= 0)) throw new HttpsError("invalid-argument", "Enter a valid input VAT amount.");
  const linesNet = Financial.money(next.reduce((sum, line) => sum + Financial.money(line.total), 0));
  if (newVat > 0 && newVat >= linesNet) throw new HttpsError("invalid-argument", "Input VAT must be less than the line amounts. Enter line costs net of VAT.");
  const description = data.description === undefined ? financeText(invoice.description, 240) : financeText(data.description, 240);
  // The total moves by the change in lines and VAT, so any posted difference between the old lines and the
  // old total (held in 1290) is carried, not silently dropped from the supplier bill.
  const oldLinesNet = Financial.money(lines.reduce((sum, line) => sum + Financial.money(line && line.total), 0));
  const oldTotal = Financial.money(invoice.total), newTotal = Financial.money(oldTotal + (linesNet - oldLinesNet) + (newVat - oldVat)), totalDelta = Financial.money(newTotal - oldTotal);
  if (!(newTotal > 0)) throw new HttpsError("invalid-argument", "The purchase total must stay above zero.");
  const changedKeeps = keeps.filter((k) => amendLineSignature(k.line) !== amendLineSignature(k.n));
  if (!changedKeeps.length && !adds.length && !removes.length && newVat === oldVat && description === financeText(invoice.description, 240)) throw new HttpsError("invalid-argument", "Nothing was changed.");
  const after = Object.assign({}, invoice, {lines: next, total: newTotal, inputVat: newVat});
  // The journal accounts are resolved now (this throws on bad coding) so nothing moves before they are known.
  const [oldGl, newGl] = [await purchaseInventoryLines(db, invoice, false), await purchaseInventoryLines(db, after, false)];
  const glSum = (gl) => Financial.money(gl.reduce((sum, line) => sum + Number(line.debit || 0), 0));
  if (Financial.money(glSum(newGl) - glSum(oldGl)) !== totalDelta) throw new HttpsError("failed-precondition", "This purchase's posted lines and total don't agree, so it can't be amended safely. Nothing was changed; ask for a review.");

  const payMode = String(invoice.payMode || ""), writes = {}, payableClaims = [];
  let fundingAccount = "", payableId = "", cashAccountId = "";
  try {
    if (payMode === "account" || payMode === "pending") {
      payableId = financeText(invoice.payableId, 160);
      if (!payableId) throw new HttpsError("failed-precondition", "This purchase has no linked supplier bill. Use Purchase corrections → Repair payable first, then amend.");
      const claim = await claimPayables(db, [payableId], `purchase_amend_${invoiceId}_r${nextRevision}`, actor, payableClaims), payable = claim.doc(payableId);
      if (!payable || payable.status !== "open") throw new HttpsError("failed-precondition", "The supplier bill for this purchase is not open, so it can't be amended. Open it in Finance Books → Payables.");
      if (Financial.payableHasSettlement(payable)) throw new HttpsError("failed-precondition", `This supplier bill already has ${Financial.payableSettledAmount(payable).toFixed(2)} paid against it. Reverse the payment first (Finance Books → Payables → Show settled → Reverse payment), then amend the purchase.`);
      fundingAccount = payable.provisional === true ? `liability:grni:${payableId}` : `liability:payable:${payableId}`;
      if (totalDelta !== 0) Object.assign(writes, {[`payables/${payableId}/amount`]: newTotal, [`payables/${payableId}/lastEditAt`]: now, [`payables/${payableId}/lastEditRevision`]: nextRevision});
      Object.assign(writes, {[`payables/${payableId}/rev`]: claim.nextRev(payableId)}, claim.releaseWrites);
    } else if (payMode === "paid") {
      const paymentId = financeText(invoice.paymentMovementId, 160) || `purchase_cash_${invoiceId}`, payment = (await db.ref(`/financialMovements/${financeKey(paymentId, "Movement ID")}`).get()).val();
      const cashLine = payment && payment.sourceId === invoiceId && Array.isArray(payment.lines) ? payment.lines.find((line) => /^asset:cash_account:/.test(String(line && line.account || "")) && Number(line.credit) > 0) : null;
      if (!cashLine) throw new HttpsError("failed-precondition", "Only purchases paid from a bank or e-wallet account can be amended for now. A purchase paid from Cash on Hand or Undeposited Collection must be voided and entered again.");
      fundingAccount = String(cashLine.account); cashAccountId = fundingAccount.slice("asset:cash_account:".length);
    } else {
      throw new HttpsError("failed-precondition", "Purchases paid by a supplier advance or personally by the owner can't be amended yet. Void the purchase and enter it again.");
    }

    // Stock plan. Every touched item is loaded and must carry its Inventory and COGS accounts.
    const stockKeeps = keeps.filter((k) => k.stock && (k.newQty !== k.oldQty || k.newTotal !== k.oldTotal)), stockRemoves = removes.filter((r) => r.stock), stockAdds = adds.filter((a) => a.stock);
    const changedStockKeeps = keeps.filter((k) => k.stock && amendLineSignature(k.line) !== amendLineSignature(k.n));
    for (const k of changedStockKeeps.concat(stockRemoves)) {k.itemId = financeKey(k.line.itemId, "Inventory item"); k.receiptId = financeKey(k.line.receiptId, "Stock receipt ID"); await loadItem(k.itemId, k.line.itemName);}
    // Source records must exist and match before anything moves: receipts (and batches for changed lines).
    const batches = (changedStockKeeps.length || stockRemoves.length) ? ((await db.ref("/inventoryBatch").orderByChild("invoiceId").equalTo(invoiceId).get()).val() || {}) : {};
    const batchFor = (receiptId) => Object.keys(batches).find((id) => batches[id] && batches[id].receiptId === receiptId);
    for (const k of changedStockKeeps.concat(stockRemoves)) {
      k.receipt = (await db.ref(`/stockReceipts/${k.receiptId}`).get()).val(); k.batchId = batchFor(k.receiptId);
      if (!k.receipt || k.receipt.invoiceId !== invoiceId || financeText(k.receipt.ing, 160) !== k.itemId) throw new HttpsError("failed-precondition", `The stock receipt for line ${k.index + 1} is missing or does not match. Repair the purchase receipt before amending.`);
      if (k.newQty > 0 && !k.batchId) throw new HttpsError("failed-precondition", `The stock batch for line ${k.index + 1} is missing. Repair the purchase receipt before amending.`);
    }
    // A brand must be an active approved brand of the same item (the screen checks this too).
    for (const row of changedStockKeeps.filter((k) => k.n.skuId && k.n.skuId !== financeText(k.line.skuId, 160)).map((k) => ({itemId: k.itemId, n: k.n})).concat(stockAdds.filter((a) => a.n.skuId).map((a) => ({itemId: a.itemId, n: a.n})))) {
      const sku = (await db.ref(`/inventorySku/${financeKey(row.n.skuId, "Brand ID")}`).get()).val();
      if (!sku || sku.masterId !== row.itemId || sku.active === false) throw new HttpsError("failed-precondition", `The brand chosen for ${row.n.itemName || row.itemId} is not an active approved brand of that item. Choose the brand again.`);
      row.n.skuBrand = financeText(sku.brand, 120) || row.n.skuBrand;
    }
    const invoiceQty = {};
    next.forEach((line) => {if (line && line.itemId && line.lineType !== "expense" && line.lineType !== "fixed_asset") invoiceQty[line.itemId] = qty6((invoiceQty[line.itemId] || 0) + qty6(line.qty));});
    const lineSignature = next.map((line) => amendLineSignature(line)), intent = crypto.createHash("sha256").update(JSON.stringify({l: lineSignature, v: newVat, d: description, r: nextRevision})).digest("hex").slice(0, 16), pending = invoice.pendingEdit || null;
    if (pending && Number(pending.revision) === nextRevision && pending.intent !== intent) throw new HttpsError("failed-precondition", "An earlier change to this purchase did not finish. Save exactly the same amendment again first, then make further changes.");
    let plan;
    if (pending && pending.intent === intent && Array.isArray(pending.plan)) {
      plan = pending.plan; // Replay the stored plan: the stock already moved by part of it must not be recalculated.
    } else {
      plan = [];
      const sim = {}, base = `purchase_amend_${invoiceId}_r${nextRevision}`;
      Object.keys(items).forEach((id) => {sim[id] = {b: items[id].balance, v: Financial.money(items[id].balance * items[id].cost)};});
      // 1) Stock coming in: new lines and raised quantities, at the line's purchase cost.
      stockAdds.forEach((a) => {plan.push({id: `${base}_${a.key}_in`, key: a.key, itemId: a.itemId, type: "purchase", qty: a.newQty, unitCost: qty6(a.newTotal / a.newQty)}); sim[a.itemId].b = qty6(sim[a.itemId].b + a.newQty); sim[a.itemId].v = Financial.money(sim[a.itemId].v + a.newTotal);});
      stockKeeps.filter((k) => k.newQty > k.oldQty).forEach((k) => {const u = qty6(k.oldTotal / k.oldQty), q = qty6(k.newQty - k.oldQty); plan.push({id: `${base}_${k.key}_in`, key: k.key, itemId: k.itemId, type: "purchase", qty: q, unitCost: u}); sim[k.itemId].b = qty6(sim[k.itemId].b + q); sim[k.itemId].v = Financial.money(sim[k.itemId].v + q * u);});
      // 2) Stock going out: removed lines and lowered quantities. Only what is still on hand can leave;
      //    the part already sold is charged back to COGS by the amendment journal.
      stockRemoves.concat(stockKeeps.filter((k) => k.newQty < k.oldQty)).forEach((k) => {
        const s = sim[k.itemId], u = qty6(k.oldTotal / k.oldQty), cover = qty6(Math.max(0, Math.min(qty6(k.oldQty - k.newQty), s.b)));
        if (!(cover > 0)) return;
        const after = qty6(s.b - cover), value = Financial.money(s.v - cover * u);
        if (after > 0 && value < -0.005) throw new HttpsError("failed-precondition", `${items[k.itemId].item.name || k.itemId} does not have enough stock value to take this line out. Review the stock first.`);
        plan.push({id: `${base}_${k.key}_out`, key: k.key, itemId: k.itemId, type: "purchase_reversal", qty: -cover, unitCost: u}); s.b = after; s.v = after > 0 ? value : 0;
      });
      // 3) Price changes on kept lines: the on-hand share restates stock, the used share goes to COGS.
      stockKeeps.filter((k) => k.newQty > 0).forEach((k) => {
        const u = qty6(k.oldTotal / k.oldQty), delta = Financial.money(k.newTotal - k.newQty * u), s = sim[k.itemId], lineQty = invoiceQty[k.itemId];
        if (Math.abs(delta) < 0.005 || !(lineQty > 0)) return;
        const share = s.b > 0 ? Math.round(delta * (Math.max(0, Math.min(s.b, lineQty)) / lineQty) * 100) / 100 : 0;
        if (s.b > 0 && s.v + share < -0.005) throw new HttpsError("failed-precondition", `${items[k.itemId].item.name || k.itemId} does not have enough stock value to absorb this price reduction. Review the stock first.`);
        plan.push({id: `${base}_${k.key}_cost`, key: k.key, itemId: k.itemId, type: "purchase_cost_correction", valueDelta: delta, lineQty}); s.v = Financial.money(s.v + share);
      });
    }
    // Void reverses one movement per item still on the purchase: keep the original movements of items
    // still present, drop items that left the purchase, and add the first receipt of a new item.
    const nextItems = new Set(next.filter((l) => l && l.itemId && l.lineType !== "expense" && l.lineType !== "fixed_asset").map((l) => String(l.itemId))), movementIds = [], covered = new Set(), firstIn = {};
    plan.forEach((op) => {if (op.type === "purchase" && !firstIn[op.itemId]) firstIn[op.itemId] = op.id;});
    for (const id of (Array.isArray(invoice.movementIds) ? invoice.movementIds : [])) {
      const original = (await db.ref(`/inventoryMovements/${financeKey(id, "Movement ID")}`).get()).val(), itemId = String(original && original.itemId || "");
      if (itemId && nextItems.has(itemId) && !covered.has(itemId)) {movementIds.push(id); covered.add(itemId);}
    }
    nextItems.forEach((itemId) => {if (!covered.has(itemId)) {if (!firstIn[itemId]) throw new HttpsError("failed-precondition", "The original stock movement of an item on this purchase is missing. Run inventory review before amending."); movementIds.push(firstIn[itemId]); covered.add(itemId);}});
    // Every refusable check has passed: stage the plan and the request so a stopped amendment can be finished.
    if (!pending || pending.intent !== intent) await db.ref(`/purchaseInvoices/${invoiceId}/pendingEdit`).set({kind: "amend", revision: nextRevision, intent, at: now, by: actor.uid, plan, request: {lines: rows, inputVat: vatGiven ? newVat : null, description: data.description === undefined ? null : description, reason}});

    // Execute the plan. Movement IDs are deterministic, so a replay never moves stock twice.
    const actual = {}, stockMovementIds = [], note = (key) => `Amend purchase ${invoice.documentNo || invoice.ref || invoiceId} ${key}: ${reason}`;
    for (const op of plan) {
      const raw = {movementId: op.id, itemId: op.itemId, type: op.type, qty: op.type === "purchase_cost_correction" ? 0 : op.qty, unitCost: op.type === "purchase_cost_correction" ? 0 : op.unitCost, sourceType: "purchase-amend", sourceId: invoiceId, sourceLine: op.key, note: note(op.key), actorName: actor.role, occurredAt: now};
      if (op.type === "purchase_cost_correction") Object.assign(raw, {valueDelta: op.valueDelta, lineQty: op.lineQty});
      if (op.type === "purchase_reversal" && !(await db.ref(`/inventoryMovements/${op.id}`).get()).exists()) {
        // A sale since the plan was made may have used some of this stock: take out only what is on hand now.
        const live = (await db.ref(`/inventoryAccounting/${op.itemId}/balance`).get()).val(), onHand = qty6(live === null || live === undefined ? items[op.itemId].balance : live), cap = qty6(Math.min(-op.qty, Math.max(0, onHand)));
        if (!(cap > 0)) continue;
        raw.qty = -cap;
      }
      let moved = (await applyInventoryMovement(db, raw, actor)).movement;
      if (!moved) moved = (await db.ref(`/inventoryMovements/${op.id}`).get()).val();
      if (!moved) throw new HttpsError("internal", "A stock movement of this amendment could not be confirmed. Save the same amendment again.");
      stockMovementIds.push(op.id);
      actual[op.itemId] = Financial.money((actual[op.itemId] || 0) + amendStockValue(moved));
    }
    // Inventory in the books follows the stock ledger exactly; the rest of each item's change is COGS.
    const expected = {};
    lines.forEach((line) => {if (line && line.itemId && line.lineType !== "expense" && line.lineType !== "fixed_asset") expected[line.itemId] = Financial.money((expected[line.itemId] || 0) - Financial.money(line.total));});
    next.forEach((line) => {if (line && line.itemId && line.lineType !== "expense" && line.lineType !== "fixed_asset") expected[line.itemId] = Financial.money((expected[line.itemId] || 0) + Financial.money(line.total));});
    const used = [];
    Object.keys(items).forEach((itemId) => {const value = Financial.money((expected[itemId] || 0) - (actual[itemId] || 0)); if (Math.abs(value) >= 0.005) used.push({itemId, inventory: items[itemId].mapping.inventory, cost: items[itemId].mapping.cost, value});});

    // Source documents: the purchase lines, its stock receipts and batches show the amended figures.
    changedStockKeeps.forEach((k) => {
      const receiptId = k.receiptId, batchId = k.batchId, ratio = qty6(k.receipt.qty) > 0 && Number(k.receipt.recvQty) > 0 ? Number(k.receipt.recvQty) / qty6(k.receipt.qty) : 1;
      Object.assign(writes, {[`stockReceipts/${receiptId}/qty`]: k.newQty, [`stockReceipts/${receiptId}/total`]: k.newTotal, [`stockReceipts/${receiptId}/unitCost`]: k.n.unitCost, [`stockReceipts/${receiptId}/skuId`]: k.n.skuId || "", [`stockReceipts/${receiptId}/skuBrand`]: k.n.skuBrand || "", [`stockReceipts/${receiptId}/brand`]: k.n.skuBrand || "", [`stockReceipts/${receiptId}/editRevision`]: nextRevision});
      if (k.newQty !== k.oldQty) writes[`stockReceipts/${receiptId}/recvQty`] = qty6(k.newQty * ratio); // received units, not stock units
      if (batchId) Object.assign(writes, {[`inventoryBatch/${batchId}/qtyRecv`]: k.newQty, [`inventoryBatch/${batchId}/qtyRemaining`]: qty6(Math.max(0, qty6(batches[batchId].qtyRemaining) + k.newQty - k.oldQty)), [`inventoryBatch/${batchId}/unitCost`]: k.n.unitCost, [`inventoryBatch/${batchId}/skuId`]: k.n.skuId || "", [`inventoryBatch/${batchId}/brand`]: k.n.skuBrand || "", [`inventoryBatch/${batchId}/editRevision`]: nextRevision});
    });
    stockRemoves.forEach((r) => {
      const batchId = r.batchId;
      Object.assign(writes, {[`stockReceipts/${r.receiptId}/qty`]: 0, [`stockReceipts/${r.receiptId}/recvQty`]: 0, [`stockReceipts/${r.receiptId}/total`]: 0, [`stockReceipts/${r.receiptId}/removed`]: true, [`stockReceipts/${r.receiptId}/removedAt`]: now, [`stockReceipts/${r.receiptId}/removedRevision`]: nextRevision, [`stockReceipts/${r.receiptId}/editRevision`]: nextRevision});
      if (batchId) Object.assign(writes, {[`inventoryBatch/${batchId}/qtyRemaining`]: 0, [`inventoryBatch/${batchId}/closed`]: true, [`inventoryBatch/${batchId}/removedRevision`]: nextRevision});
    });
    const receiptTs = Number(invoice.ts) || now;
    stockAdds.forEach((a) => {
      writes[`stockReceipts/${a.receiptId}`] = {ing: a.itemId, skuId: a.n.skuId, skuBrand: a.n.skuBrand, name: a.n.itemName, unit: a.n.unit, qty: a.newQty, recvQty: a.recvQty, recvUnit: a.recvUnit, unitCost: a.n.unitCost, total: a.newTotal, supplierId: financeText(invoice.supplierId, 160), supplier: financeText(invoice.supplier, 120), brand: a.n.skuBrand, ref: financeText(invoice.ref, 120), date, receivedBy: financeText(invoice.by, 120), payMode, invoiceId, ts: receiptTs, addedRevision: nextRevision};
      writes[`inventoryBatch/${a.batchId}`] = {skuId: a.n.skuId, masterId: a.itemId, brand: a.n.skuBrand, supplierId: financeText(invoice.supplierId, 160), supplier: financeText(invoice.supplier, 120), qtyRecv: a.newQty, qtyRemaining: a.newQty, unit: a.n.unit, unitCost: a.n.unitCost, recvDate: date, expiry: "", lot: "", branch: "main", source: "purchase", invoiceId, receiptId: a.receiptId, createdAt: now};
    });
    // One amendment journal: the difference between the amended and the posted purchase, with the
    // inventory side matched to the stock ledger and the remainder charged to each item's COGS.
    const diff = {};
    oldGl.forEach((line) => {diff[line.account] = Financial.money((diff[line.account] || 0) - Number(line.debit || 0));});
    newGl.forEach((line) => {diff[line.account] = Financial.money((diff[line.account] || 0) + Number(line.debit || 0));});
    used.forEach((u) => {diff[`coa:${u.inventory}`] = Financial.money((diff[`coa:${u.inventory}`] || 0) - u.value); diff[`coa:${u.cost}`] = Financial.money((diff[`coa:${u.cost}`] || 0) + u.value);});
    const memo = `Amend ${invoice.documentNo || invoice.ref || "purchase"} · ${financeText(invoice.supplier, 80)}`, journal = [], journalId = `purchase_amend_${invoiceId}_r${nextRevision}`;
    Object.keys(diff).sort().forEach((account) => {const value = Financial.money(diff[account]); if (Math.abs(value) >= 0.005) journal.push(Financial.line(account, value > 0 ? value : 0, value < 0 ? -value : 0, memo));});
    if (Math.abs(totalDelta) >= 0.005) journal.push(Financial.line(fundingAccount, totalDelta < 0 ? -totalDelta : 0, totalDelta > 0 ? totalDelta : 0, memo));
    const usedToCost = Financial.money(used.reduce((sum, u) => sum + u.value, 0)), usedAbs = Financial.money(used.filter((u) => Math.abs(u.value) > 0.05).reduce((sum, u) => sum + Math.abs(u.value), 0)); // cost rounding of a few centavos must not block a later Void
    const summary = (list) => list.map((line, i) => ({line: i + 1, type: line.lineType === "expense" ? "expense" : line.lineType === "fixed_asset" ? "fixed_asset" : "stock", item: financeText(line.itemName || line.itemId, 120), qty: qty6(line.qty), total: Financial.money(line.total)}));
    Object.assign(writes, {
      [`purchaseInvoices/${invoiceId}/lines`]: next, [`purchaseInvoices/${invoiceId}/total`]: newTotal, [`purchaseInvoices/${invoiceId}/inputVat`]: newVat, [`purchaseInvoices/${invoiceId}/description`]: description,
      [`purchaseInvoices/${invoiceId}/lineCount`]: next.length, [`purchaseInvoices/${invoiceId}/expenseLineCount`]: next.filter((l) => l.lineType === "expense").length,
      [`purchaseInvoices/${invoiceId}/receiptIds`]: next.filter((l) => l.receiptId).map((l) => l.receiptId), [`purchaseInvoices/${invoiceId}/removedReceiptIds`]: (Array.isArray(invoice.removedReceiptIds) ? invoice.removedReceiptIds : []).concat(stockRemoves.map((r) => r.receiptId)),
      [`purchaseInvoices/${invoiceId}/movementIds`]: movementIds,
      [`purchaseInvoices/${invoiceId}/editRevision`]: nextRevision, [`purchaseInvoices/${invoiceId}/lastEditAt`]: now, [`purchaseInvoices/${invoiceId}/lastEditBy`]: actor.uid, [`purchaseInvoices/${invoiceId}/lastEditReason`]: reason, [`purchaseInvoices/${invoiceId}/amendedAt`]: now,
      [`purchaseInvoices/${invoiceId}/editUsedValueTotal`]: Financial.money(Math.abs(Financial.money(invoice.editUsedValueTotal)) + usedAbs), [`purchaseInvoices/${invoiceId}/pendingEdit`]: null,
      [`purchaseInvoices/${invoiceId}/editHistory/r${nextRevision}`]: {kind: "amend", at: now, by: actor.uid, byName: financeText(actor.name || actor.role, 120), reason, before: {total: oldTotal, inputVat: oldVat, lines: summary(lines)}, after: {total: newTotal, inputVat: newVat, lines: summary(next)}, added: adds.length, removed: removes.length, usedValueToCost: usedToCost, journalId: journal.length ? journalId : "", stockMovementIds},
      [`operationalAudit/${now}_purchase_amend_${invoiceId}`]: {action: "amend_purchase", sourceType: "purchaseInvoice", sourceId: invoiceId, revision: nextRevision, beforeTotal: oldTotal, afterTotal: newTotal, totalDelta, linesAdded: adds.length, linesRemoved: removes.length, usedValueToCost: usedToCost, fundingAccount, reason, actorUid: actor.uid, actorRole: actor.role, ts: now, schemaVersion: 1},
    });
    if (journal.length) {
      if (!BooksBridge.linesBalanced(journal)) throw new HttpsError("failed-precondition", "The purchase amendment is not balanced. Nothing was posted to Finance Books; save the same amendment again or ask for a review.");
      const movement = Financial.movement("purchase_amend", "purchaseInvoice", invoiceId, journal, {occurredAt: accountingAt, actorName: financeText(actor.name || actor.role, 120), revision: nextRevision, reason, documentNo: financeText(invoice.documentNo, 40), supplierId: financeText(invoice.supplierId, 160)});
      if (cashAccountId && Math.abs(totalDelta) >= 0.005) writes[`cfLedger/fm_${journalId}`] = cashLedgerRecord({date, accountId: cashAccountId, dir: totalDelta > 0 ? "out" : "in", category: "Purchase correction", amount: Math.abs(totalDelta), party: invoice.supplier, ref: invoice.documentNo || invoice.ref, auto: true}, journalId, movement, actor);
      await commitFinancial(db, journalId, movement, actor, writes);
    } else {
      await db.ref().update(writes);
    }
    return {invoiceId, result: "amended", revision: nextRevision, oldTotal, newTotal, totalDelta, linesAdded: adds.length, linesRemoved: removes.length, usedValueToCost: usedAbs ? usedToCost : 0, journalLines: journal.length};
  } finally {
    for (const set of payableClaims) await set.release();
  }
}

// Discard an amendment that stopped before any stock moved (nothing to undo). One that moved stock must be finished.
async function discardPendingAmend(db, actor, invoiceId, invoice, reason, now) {
  if (actor.role !== "superadmin") throw new HttpsError("permission-denied", "Only a Super Admin can discard an unfinished amendment.");
  const staged = invoice.pendingEdit || null;
  if (!staged || staged.kind !== "amend") throw new HttpsError("failed-precondition", "There is no unfinished amendment on this purchase.");
  for (const op of (Array.isArray(staged.plan) ? staged.plan : [])) if ((await db.ref(`/inventoryMovements/${financeKey(op.id, "Movement ID")}`).get()).exists()) throw new HttpsError("failed-precondition", "Stock already moved for this amendment, so it can't be discarded. Finish it instead.");
  await db.ref().update({[`purchaseInvoices/${invoiceId}/pendingEdit`]: null, [`operationalAudit/${now}_purchase_amend_discard_${invoiceId}`]: {action: "discard_purchase_amend", sourceType: "purchaseInvoice", sourceId: invoiceId, revision: Number(staged.revision) || 0, reason, actorUid: actor.uid, actorRole: actor.role, ts: now, schemaVersion: 1}});
  return {invoiceId, result: "amend_discarded"};
}
