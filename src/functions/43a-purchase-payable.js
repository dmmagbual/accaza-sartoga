
exports.reconcilePurchasePayable = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 60, memory: "256MiB"},
  async (request) => {
    const db = getDatabase(), actor = await requirePortalPermission(db, request, ["purchases", "payables"]), data = request.data || {};
    const requestedId = financeText(data.invoiceId, 160), requestedRef = financeText(data.invoiceRef, 120);
    const invoices = (await db.ref("/purchaseInvoices").get()).val() || {};
    let invoiceId = requestedId && invoices[requestedId] ? requestedId : "";
    if (!invoiceId && requestedRef) {
      const matches = Object.keys(invoices).filter((id) => financeText(invoices[id] && invoices[id].ref, 120).toLowerCase() === requestedRef.toLowerCase());
      if (matches.length > 1) throw new HttpsError("failed-precondition", "More than one purchase uses this invoice reference. Use the purchase invoice ID.");
      invoiceId = matches[0] || "";
    }
    if (!invoiceId) throw new HttpsError("not-found", "Purchase invoice was not found.");
    const invoice = invoices[invoiceId] || {};
    const legacyNoLiability = invoice.payMode === "none" && data.recovery === true, provisional = invoice.payMode === "pending";
    if (invoice.payMode !== "account" && !provisional && !legacyNoLiability) throw new HttpsError("failed-precondition", "This purchase is not eligible for payable reconciliation.");
    const amount = Financial.money(invoice.total); if (!(amount > 0)) throw new HttpsError("failed-precondition", "Purchase invoice total is invalid.");
    const party = financeText(invoice.supplier, 120); if (!party) throw new HttpsError("failed-precondition", "A supplier is required before recording the obligation.");
    const ref = financeText(data.invoiceRef || invoice.ref || `PENDING-${invoiceId}`, 120), date = financeDate(invoice.date), due = data.due ? financeDate(data.due, true) : (invoice.due ? financeDate(invoice.due, true) : ""), finalizing = provisional && data.finalize === true;
    if (finalizing && (!financeText(data.invoiceRef,120) || !due)) throw new HttpsError("invalid-argument", "Final invoice reference and due date are required.");
    const payables = (await db.ref("/payables").get()).val() || {}, baseCanonicalId=financeKey(`ap_${invoiceId}`,"Payable ID"), repairingReversed=payables[baseCanonicalId]&&payables[baseCanonicalId].status==="reversed", canonicalId=repairingReversed?financeKey(`ap_repair_${invoiceId}`,"Payable ID"):baseCanonicalId, movementId=financeKey(`${repairingReversed?"purchase_ap_repair":"purchase_ap"}_${invoiceId}`,"Movement ID");
    const candidates = Object.keys(payables).filter((id) => {const row=payables[id]||{},claimedBy=financeText(row.purchaseInvoiceId,160);return row.status==="open"&&Financial.money(row.amount)===amount&&financeText(row.party,120).toLowerCase()===party.toLowerCase()&&(!claimedBy||claimedBy===invoiceId);}).map((id)=>({id,party:financeText(payables[id].party,120),ref:financeText(payables[id].ref,120),due:payables[id].due||"",amount:Financial.money(payables[id].amount)}));
    if (data.preview === true) return {invoiceId,amount,party,candidates};
    const requestedPayableId=financeText(data.linkPayableId,160);
    if (requestedPayableId) {
      const selected=payables[financeKey(requestedPayableId,"Payable ID")],selectedId=financeKey(requestedPayableId,"Payable ID");if (!selected||selected.status!=="open") throw new HttpsError("failed-precondition","The selected payable is missing or is no longer open.");if (Financial.money(selected.amount)!==amount||financeText(selected.party,120).toLowerCase()!==party.toLowerCase()) throw new HttpsError("failed-precondition","The payable supplier or amount does not match this purchase.");if (selected.purchaseInvoiceId&&selected.purchaseInvoiceId!==invoiceId) throw new HttpsError("failed-precondition","The selected payable is already linked to another purchase.");const claimed=Object.keys(invoices).some((id)=>id!==invoiceId&&financeText(invoices[id]&&invoices[id].payableId,160)===selectedId);if (claimed) throw new HttpsError("failed-precondition","Another purchase already claims this payable.");const now=Date.now(),reason=financeText(data.reason,300);if (!reason) throw new HttpsError("invalid-argument","A linking reason is required.");const writes={[`purchaseInvoices/${invoiceId}/payMode`]:"account",[`purchaseInvoices/${invoiceId}/payableId`]:selectedId,[`purchaseInvoices/${invoiceId}/due`]:selected.due||invoice.due||"",[`purchaseInvoices/${invoiceId}/payableReconciledAt`]:now,[`payables/${selectedId}/purchaseInvoiceId`]:invoiceId,[`payables/${selectedId}/linkedAt`]:now,[`operationalAudit/${now}_purchase_link_${invoiceId}`]:{action:"link_existing_purchase_payable",sourceType:"purchaseInvoice",sourceId:invoiceId,payableId:selectedId,amount,reason,actorUid:actor.uid,actorRole:actor.role,ts:now,schemaVersion:1}};(invoice.receiptIds||[]).forEach((id)=>{writes[`stockReceipts/${id}/payMode`]="account";writes[`stockReceipts/${id}/payableId`]=selectedId;});await db.ref().update(writes);return {invoiceId,payableId:selectedId,amount,result:"linked_existing"};
    }
    const linkedId = financeText(invoice.payableId, 160), exact = [], refConflicts = [];
    Object.keys(payables).forEach((id) => {const row = payables[id] || {}, open=row.status==="open", sameLink = open&&(id === canonicalId || id === linkedId || row.purchaseInvoiceId === invoiceId || row.movementId === movementId), sameRef = open&&ref&&financeText(row.ref, 120).toLowerCase() === ref.toLowerCase();if (sameLink || (sameRef && Financial.money(row.amount) === amount && financeText(row.party, 120).toLowerCase() === party.toLowerCase())) exact.push(id);else if (sameRef) refConflicts.push(id);});
    const unique = [...new Set(exact)];
    if (unique.length > 1) throw new HttpsError("failed-precondition", "Multiple payables may belong to this purchase. Management review is required before recovery.");
    if (!unique.length && refConflicts.length) throw new HttpsError("failed-precondition", "A payable with this invoice reference has a different supplier or amount. Review it before recovery.");
    const now = Date.now(), auditId = `${now}_purchase_payable_${invoiceId}`;
    if (unique.length === 1) {
      const payableId = unique[0], row = payables[payableId] || {};
      if (Financial.money(row.amount) !== amount) throw new HttpsError("failed-precondition", "The linked payable amount does not match the purchase invoice.");
      const linkedWrites = {[`purchaseInvoices/${invoiceId}/payableId`]:payableId,[`purchaseInvoices/${invoiceId}/payableReconciledAt`]:now,[`purchaseInvoices/${invoiceId}/due`]:due||row.due||"",[`payables/${payableId}/purchaseInvoiceId`]:invoiceId,[`operationalAudit/${auditId}`]:{action:"reconcile_purchase_payable",sourceType:"purchaseInvoice",sourceId:invoiceId,payableId,result:finalizing?"invoice_finalized":"linked_existing",amount,actorUid:actor.uid,actorRole:actor.role,ts:now,schemaVersion:1}};
      if (finalizing) {const finalizeId=`purchase_grni_finalize_${invoiceId}`, movement=Financial.movement("grni_finalized","purchaseInvoice",invoiceId,[Financial.line(`liability:grni:${payableId}`,amount,0,"Clear goods received not invoiced"),Financial.line(`liability:payable:${payableId}`,0,amount,"Recognize supplier invoice")],{occurredAt:now,actorName:actor.role});Object.assign(linkedWrites,{[`purchaseInvoices/${invoiceId}/payMode`]:"account",[`purchaseInvoices/${invoiceId}/ref`]:ref,[`purchaseInvoices/${invoiceId}/invoiceFinalizedAt`]:now,[`payables/${payableId}/ref`]:ref,[`payables/${payableId}/due`]:due,[`payables/${payableId}/type`]:"inventory",[`payables/${payableId}/provisional`]:false,[`payables/${payableId}/invoiceFinalizedAt`]:now});await commitFinancial(db,finalizeId,movement,actor,linkedWrites);} else await db.ref().update(linkedWrites);
      return {invoiceId, payableId, amount, result: finalizing ? "invoice_finalized" : "linked_existing"};
    }
    const payable = {party,type:provisional?"inventory_pending_invoice":"inventory",amount,date,due,ref,status:"open",provisional,movementId,purchaseInvoiceId:invoiceId,ts:now,createdBy:actor.uid,recovered:data.recovery === true,schemaVersion:1};
    const writes = {[`payables/${canonicalId}`]:payable,[`purchaseInvoices/${invoiceId}/payableId`]:canonicalId,[`purchaseInvoices/${invoiceId}/payableReconciledAt`]:now,[`purchaseInvoices/${invoiceId}/due`]:due,[`purchaseInvoices/${invoiceId}/ref`]:ref,[`purchaseInvoices/${invoiceId}/payMode`]:legacyNoLiability?"account":invoice.payMode,[`operationalAudit/${auditId}`]:{action:"reconcile_purchase_payable",sourceType:"purchaseInvoice",sourceId:invoiceId,payableId:canonicalId,result:provisional?"grni_created":(legacyNoLiability?"legacy_liability_created":"created"),amount,actorUid:actor.uid,actorRole:actor.role,ts:now,schemaVersion:1}};
    const movementSnap = await db.ref(`/financialMovements/${movementId}`).get();
    if (movementSnap.exists()) await db.ref().update(writes);
    else {const inventoryLines=await purchaseInventoryLines(db,invoice,false),movement = Financial.movement(provisional?"grni_created":"payable_created", "payable", canonicalId, inventoryLines.concat([Financial.line(provisional?`liability:grni:${canonicalId}`:`liability:payable:${canonicalId}`, 0, amount, party)]), {occurredAt:Number(Date.parse(`${date}T00:00:00+08:00`)||now),actorName:actor.role});await commitFinancial(db, movementId, movement, actor, writes);}
    return {invoiceId, payableId: canonicalId, amount, result: movementSnap.exists() ? "recreated_from_movement" : "created"};
  },
);
