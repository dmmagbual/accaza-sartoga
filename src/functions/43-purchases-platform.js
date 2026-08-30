
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

// Controlled purchase correction boundary. Metadata corrections preserve the
// original financial amount. Reversals offset inventory and finance with
// deterministic IDs so an interrupted request is safe to retry.
exports.managePurchaseCorrection = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 120, memory: "256MiB"},
  async (request) => {
    const db = getDatabase(), actor = await requirePortalPermission(db, request, ["purchases"]), data = request.data || {}, action = financeText(data.action, 30);
    const invoices = (await db.ref("/purchaseInvoices").get()).val() || {}, requestedId = financeText(data.invoiceId, 160), requestedRef = financeText(data.invoiceRef, 120);
    let invoiceId = requestedId && invoices[requestedId] ? requestedId : "";
    if (!invoiceId && requestedRef) {const matches = Object.keys(invoices).filter((id) => financeText(invoices[id] && invoices[id].ref, 120).toLowerCase() === requestedRef.toLowerCase());if (matches.length > 1) throw new HttpsError("failed-precondition", "More than one purchase uses this reference. Management review is required.");invoiceId = matches[0] || "";}
    if (!invoiceId) throw new HttpsError("not-found", "Purchase invoice was not found.");
    const invoice = invoices[invoiceId] || {}, safeInvoice = {id:invoiceId,supplier:financeText(invoice.supplier,120),ref:financeText(invoice.ref,120),date:invoice.date||"",due:invoice.due||"",by:financeText(invoice.by,120),description:financeText(invoice.description,240),payMode:invoice.payMode||"none",payableId:invoice.payableId||"",total:Financial.money(invoice.total),lines:Array.isArray(invoice.lines)?invoice.lines:[]};
    if (action === "lookup") return {invoice:safeInvoice,reversed:invoice.reversed===true};
    if (invoice.reversed === true) throw new HttpsError("failed-precondition", "This purchase has already been reversed.");
    const now = Date.now(), reason = financeText(data.reason, 300); if (!reason) throw new HttpsError("invalid-argument", "A correction reason is required.");
    if (action === "correct_details") {
      const next = {supplier:financeText(data.supplier,120),ref:financeText(data.ref,120),due:data.due?financeDate(data.due, true):"",by:financeText(data.by,120),description:financeText(data.description,240)}; if (!next.supplier) throw new HttpsError("invalid-argument", "Supplier is required.");if (!next.ref) throw new HttpsError("invalid-argument", "Invoice reference is required.");
      const duplicate = Object.keys(invoices).some((id) => id !== invoiceId && financeText(invoices[id] && invoices[id].ref,120).toLowerCase() === next.ref.toLowerCase());if (duplicate) throw new HttpsError("already-exists", "Another purchase already uses this invoice reference.");
      const writes = {[`purchaseInvoices/${invoiceId}/supplier`]:next.supplier,[`purchaseInvoices/${invoiceId}/ref`]:next.ref,[`purchaseInvoices/${invoiceId}/due`]:next.due,[`purchaseInvoices/${invoiceId}/by`]:next.by,[`purchaseInvoices/${invoiceId}/description`]:next.description,[`purchaseInvoices/${invoiceId}/lastCorrectionAt`]:now,[`purchaseInvoices/${invoiceId}/lastCorrectionBy`]:actor.uid,[`purchaseInvoices/${invoiceId}/lastCorrectionReason`]:reason,[`operationalAudit/${now}_purchase_correct_${invoiceId}`]:{action:"correct_purchase_details",sourceType:"purchaseInvoice",sourceId:invoiceId,before:{supplier:invoice.supplier||"",ref:invoice.ref||"",due:invoice.due||"",by:invoice.by||"",description:invoice.description||""},after:next,reason,actorUid:actor.uid,actorRole:actor.role,ts:now,schemaVersion:1}};
      (invoice.receiptIds||[]).forEach((id,index) => {writes[`stockReceipts/${id}/supplier`]=next.supplier;writes[`stockReceipts/${id}/ref`]=next.ref;writes[`stockReceipts/${id}/receivedBy`]=next.by;writes[`inventoryBatch/bat_${invoiceId}_${index}/supplier`]=next.supplier;});if (invoice.payableId) {writes[`payables/${invoice.payableId}/party`]=next.supplier;writes[`payables/${invoice.payableId}/ref`]=next.ref;writes[`payables/${invoice.payableId}/due`]=next.due;}
      await db.ref().update(writes);return {invoiceId,result:"corrected",invoice:Object.assign({},safeInvoice,next)};
    }
    if (action !== "reverse") throw new HttpsError("invalid-argument", "Purchase correction action is invalid.");
    const linkedAssetIds=Array.isArray(invoice.fixedAssetIds)?invoice.fixedAssetIds:[],linkedAssets={};for(const assetId of linkedAssetIds){const key=financeKey(assetId,"Asset ID"),asset=(await db.ref(`/fixedAssets/${key}`).get()).val();if(!asset)throw new HttpsError("failed-precondition","A linked fixed-asset card is missing. Repair the asset register before reversing this purchase.");if(asset.status==="disposed"||Financial.money(asset.accumulatedDepreciation||0)>0)throw new HttpsError("failed-precondition","Dispose or reverse posted depreciation before reversing this equipment purchase.");linkedAssets[key]=asset;}
    let approval;
    if (data.ownerAmend === true) { if (!["owner","superadmin"].includes(actor.role)) throw new HttpsError("permission-denied", "Only the owner can amend a purchase in one step; other roles need a manager approval to reverse."); approval = {id:`owner_amend_${invoiceId}`, usedWrites:{}}; }
    else { approval = await claimManagerApproval(db, data, "reverse_purchase", invoiceId, safeInvoice.total, `reverse_purchase_${invoiceId}`); }
    const movementIds = Array.isArray(invoice.movementIds)?invoice.movementIds:[], originals=[];
    const payable = invoice.payableId ? (await db.ref(`/payables/${financeKey(invoice.payableId,"Payable ID")}`).get()).val() : null,keepInvoiceId=financeText(data.keepInvoiceId,160),keepInvoice=keepInvoiceId&&invoices[keepInvoiceId],duplicateCleanup=data.duplicate===true&&keepInvoice&&keepInvoiceId!==invoiceId&&keepInvoice.reversed!==true&&financeText(keepInvoice.ref,120).toLowerCase()===financeText(invoice.ref,120).toLowerCase()&&financeText(keepInvoice.supplier,120).toLowerCase()===financeText(invoice.supplier,120).toLowerCase()&&Financial.money(keepInvoice.total)===safeInvoice.total;if (data.duplicate===true&&!duplicateCleanup) throw new HttpsError("failed-precondition","A single matching purchase must be selected as the record to keep.");if (payable && payable.status === "paid") throw new HttpsError("failed-precondition", "This payable has already been paid. Reverse the supplier payment before reversing the purchase.");const orphanAccount=invoice.payMode==="account"&&!payable;if (!duplicateCleanup&&orphanAccount&&(await db.ref(`/financialMovements/purchase_ap_${invoiceId}`).get()).exists()) throw new HttpsError("failed-precondition","This purchase has a payable movement but its payable record is missing. Repair the payable before reversal.");if (!duplicateCleanup&&invoice.payMode === "pending"&&(!payable||payable.status!=="open")) throw new HttpsError("failed-precondition", "The linked provisional obligation is missing or is no longer open.");if (!duplicateCleanup&&invoice.payMode==="account"&&payable&&payable.status!=="open") throw new HttpsError("failed-precondition","The linked supplier payable is no longer open.");
    const paidAccountId=invoice.payMode==="paid"?financeText(invoice.accountId,120):"",paidSpecial=paidAccountId==="cash_on_hand"||paidAccountId==="undeposited"||paidAccountId==="register",paidCashAccount=invoice.payMode==="paid"&&!paidSpecial?accountIdFor((await db.ref("/cfAccounts").get()).val()||{},paidAccountId):paidAccountId;
    for (const movementId of movementIds) {const movement=(await db.ref(`/inventoryMovements/${financeKey(movementId,"Movement ID")}`).get()).val();if (!movement) throw new HttpsError("failed-precondition", "An original inventory movement is missing. Run inventory review before reversal.");const accounting=(await db.ref(`/inventoryAccounting/${movement.itemId}`).get()).val()||{},reversalId=`purchase_reverse_${invoiceId}_${movement.itemId}`,already=accounting.applied&&accounting.applied[reversalId];if (!already&&qty6(accounting.balance)+0.000001<qty6(movement.qty)) throw new HttpsError("failed-precondition", `Not enough remaining stock to reverse ${movement.itemName||movement.itemId}.`);if (!already&&qty6(accounting.balance)>qty6(movement.qty)&&((qty6(accounting.balance)*qty6(accounting.unitCost))-(qty6(movement.qty)*qty6(movement.unitCost)))<-.000001) throw new HttpsError("failed-precondition", `The remaining stock value for ${movement.itemName||movement.itemId} cannot support this reversal.`);originals.push(movement);}
    for (const movement of originals) await applyInventoryMovement(db,{movementId:`purchase_reverse_${invoiceId}_${movement.itemId}`,itemId:movement.itemId,type:"purchase_reversal",qty:-qty6(movement.qty),unitCost:qty6(movement.unitCost),sourceType:"purchase-invoice-reversal",sourceId:invoiceId,sourceLine:movement.sourceLine||movement.itemId,note:`Reverse purchase ${invoice.ref||invoiceId}: ${reason}`,reversalOf:movement.id,actorName:actor.role,occurredAt:now},actor);
    const writes = Object.assign({},approval.usedWrites,{[`purchaseInvoices/${invoiceId}/reversed`]:true,[`purchaseInvoices/${invoiceId}/reversedAt`]:now,[`purchaseInvoices/${invoiceId}/reversedBy`]:actor.uid,[`purchaseInvoices/${invoiceId}/reversalReason`]:reason,[`operationalAudit/${now}_purchase_reverse_${invoiceId}`]:{action:duplicateCleanup?"reverse_duplicate_purchase":"reverse_purchase",sourceType:"purchaseInvoice",sourceId:invoiceId,keptPurchaseId:duplicateCleanup?keepInvoiceId:"",amount:safeInvoice.total,reason,approvalId:approval.id,actorUid:actor.uid,actorRole:actor.role,ts:now,schemaVersion:1}});if (duplicateCleanup&&payable) {if (payable.status==="open") {writes[`payables/${invoice.payableId}/purchaseInvoiceId`]=keepInvoiceId;writes[`purchaseInvoices/${keepInvoiceId}/payableId`]=invoice.payableId;} else {writes[`purchaseInvoices/${keepInvoiceId}/payableId`]=null;writes[`purchaseInvoices/${keepInvoiceId}/payableReconciledAt`]=null;}}(invoice.receiptIds||[]).forEach((id)=>{writes[`stockReceipts/${id}/reversed`]=true;writes[`stockReceipts/${id}/reversedAt`]=now;});
    Object.keys(linkedAssets).forEach((id)=>{writes[`fixedAssets/${id}/status`]="acquisition_reversed";writes[`fixedAssets/${id}/reversedAt`]=now;writes[`fixedAssets/${id}/reversalReason`]=reason;});
    const batches=(await db.ref("/inventoryBatch").get()).val()||{};Object.keys(batches).forEach((id)=>{if (batches[id]&&batches[id].invoiceId===invoiceId){writes[`inventoryBatch/${id}/closed`]=true;writes[`inventoryBatch/${id}/reversedAt`]=now;}});
    if (invoice.payMode === "owner_funded") {
      const ownerReversalLines=await purchaseInventoryLines(db,invoice,true),financialId=`purchase_owner_reversal_${invoiceId}`,reimbursementId=financeText(invoice.ownerReimbursementId,160),reimbursement=reimbursementId?(await db.ref(`/payables/${reimbursementId}`).get()).val():null;
      if(reimbursement&&reimbursement.status==="paid")throw new HttpsError("failed-precondition","Reimbursement was already paid. Reverse the reimbursement before reversing this purchase.");
      const ownerOffset=invoice.ownerTreatment==="reimburse"?`liability:due_to_owner:${reimbursementId||`owner_${invoiceId}`}`:"equity:capital_in";
      const ownerReversal=Financial.movement("purchase_owner_funded_reversed","purchaseInvoice",invoiceId,[Financial.line(ownerOffset,safeInvoice.total,0,"Reverse owner/partner-funded purchase")].concat(ownerReversalLines),{occurredAt:now,actorName:actor.role,ownerName:invoice.ownerName||"",ownerTreatment:invoice.ownerTreatment||"capital"});
      if(reimbursementId){writes[`payables/${reimbursementId}/status`]="reversed";writes[`payables/${reimbursementId}/reversedAt`]=now;writes[`payables/${reimbursementId}/reversalMovementId`]=financialId;}
      writes[`purchaseInvoices/${invoiceId}/fundingReversalMovementId`]=financialId;
      await commitFinancial(db,financialId,ownerReversal,actor,writes);
      return {invoiceId,result:"reversed",amount:safeInvoice.total,invoice:safeInvoice};
    }
    const reversalInventoryLines=await purchaseInventoryLines(db,invoice,true);let financialMovement=null,financialId="";if (!duplicateCleanup&&(invoice.payMode === "account"||invoice.payMode === "pending")&&payable) {financialId=`purchase_ap_reversal_${invoiceId}`;financialMovement=Financial.movement("purchase_payable_reversed","purchaseInvoice",invoiceId,[Financial.line(invoice.payMode==="pending"?`liability:grni:${invoice.payableId}`:`liability:payable:${invoice.payableId}`,safeInvoice.total,0,"Reverse supplier obligation")].concat(reversalInventoryLines),{occurredAt:now,actorName:actor.role});writes[`payables/${invoice.payableId}/status`]="reversed";writes[`payables/${invoice.payableId}/reversedAt`]=now;writes[`payables/${invoice.payableId}/reversalMovementId`]=financialId;} else if (invoice.payMode === "paid") {financialId=`purchase_cash_reversal_${invoiceId}`;const paidAsset=paidCashAccount==="cash_on_hand"||paidCashAccount==="register"?"asset:register_cash":paidCashAccount==="undeposited"?"asset:cash_awaiting_deposit":`asset:cash_account:${paidCashAccount}`;financialMovement=Financial.movement("purchase_cash_reversed","purchaseInvoice",invoiceId,[Financial.line(paidAsset,safeInvoice.total,0,"Reverse purchase payment")].concat(reversalInventoryLines),{occurredAt:now,actorName:actor.role,accountId:paidCashAccount});if(paidCashAccount==="undeposited"){const original=(await db.ref(`/financialMovements/purchase_cash_${invoiceId}`).get()).val()||{},allocations=original.custodyAllocations||{};if(!Object.keys(allocations).length)throw new HttpsError("failed-precondition","The original Undeposited Collection custody allocation is missing. Repair it before reversing this purchase.");for(const id of Object.keys(allocations)){const key=financeKey(id,"Custody ID"),row=(await db.ref(`/cashCustody/${key}`).get()).val();if(!row)throw new HttpsError("failed-precondition",`Cash custody ${key} is missing.`);const restore=Financial.money(allocations[id]),remaining=Financial.money(Number(row.remaining||0)+restore),paidOut=Financial.money(Math.max(0,Number(row.paidOutAmount||0)-restore));writes[`cashCustody/${key}/remaining`]=remaining;writes[`cashCustody/${key}/paidOutAmount`]=paidOut;writes[`cashCustody/${key}/status`]="awaiting_deposit";writes[`cashCustody/${key}/lastPaymentReversalMovementId`]=financialId;}}writes[`cfLedger/fm_${financialId}`]=cashLedgerRecord({date:financeDateFromTimestamp(now),accountId:paidCashAccount==="register"?"cash_on_hand":paidCashAccount,dir:"in",category:"Purchase reversal",amount:safeInvoice.total,party:invoice.supplier,ref:invoice.ref,auto:true},financialId,financialMovement,actor);} else if (invoice.payMode === "advance" && invoice.purchaseAdvanceId) {const advanceId=financeKey(invoice.purchaseAdvanceId,"Purchase advance ID");let base="",advance=null;if(invoice.advanceSource==="revolving"){base=`pettyCashVouchers/${advanceId}`;advance=(await db.ref(`/${base}`).get()).val();}else{const shifts=(await db.ref("/shifts").get()).val()||{};for(const shiftId of Object.keys(shifts)){const rows=Array.isArray(shifts[shiftId].payOuts)?shifts[shiftId].payOuts:[],index=rows.findIndex((row)=>row&&row.id===advanceId);if(index>=0){base=`shifts/${shiftId}/payOuts/${index}`;advance=rows[index];break;}}}if(!advance||!(advance.allocations&&advance.allocations[invoiceId]))throw new HttpsError("failed-precondition","The linked supplier-payment allocation is missing. Repair it before reversing this purchase.");const restored=Financial.money(Number(advance.remainingAmount!=null?advance.remainingAmount:advance.amount)+safeInvoice.total),allocated=Financial.money(Math.max(0,Number(advance.allocatedAmount||0)-safeInvoice.total));writes[`${base}/allocations/${invoiceId}`]=null;writes[`${base}/remainingAmount`]=restored;writes[`${base}/allocatedAmount`]=allocated;writes[`${base}/allocationStatus`]=allocated>0?"partially_allocated":"pending_allocation";financialId=`purchase_advance_reversal_${invoiceId}`;financialMovement=Financial.movement("purchase_advance_allocation_reversed","purchaseInvoice",invoiceId,[Financial.line(`asset:purchase_cash_advance:${advanceId}`,safeInvoice.total,0,"Restore supplier payment for allocation")].concat(reversalInventoryLines),{occurredAt:now,actorName:actor.role});}
    if (financialMovement) await commitFinancial(db,financialId,financialMovement,actor,writes);else await db.ref().update(writes);
    return {invoiceId,result:"reversed",amount:safeInvoice.total,invoice:safeInvoice};
  },
);

// Correct an amount-only platform mismatch before payout settlement. The
// operational order is updated to the statement-confirmed figures while an
// append-only movement preserves the original posting and audit trail.
exports.correctPlatformPresettlement = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 60, memory: "256MiB"},
  async (request) => {
    const db = getDatabase(), actor = await requirePortalPermission(db, request, ["payouts", "receivables"]), data = request.data || {};
    const requested = financeText(data.platformRef, 60), channelHint = financeText(data.channel, 20).toLowerCase();
    if (!requested) throw new HttpsError("invalid-argument", "Platform order reference is required.");
    const [ordersSnap, archiveSnap] = await Promise.all([db.ref("/orders").get(), db.ref("/archivedOrders").get()]);
    const wanted = platformRefKey(requested); let found = null;
    for (const [node, rows] of [["orders", ordersSnap.val() || {}], ["archivedOrders", archiveSnap.val() || {}]]) {
      for (const id of Object.keys(rows)) {
        const order = Object.assign({id}, rows[id] || {}), channel = financeText(order.channel, 20).toLowerCase();
        if (!["grabfood", "foodpanda"].includes(channel) || (channelHint && channel !== channelHint)) continue;
        if (platformRefKey(order.platformRef || order.id || id) === wanted) {found = {id, node, order}; break;}
      }
      if (found) break;
    }
    if (!found) throw new HttpsError("not-found", "No matching GrabFood or FoodPanda order was found.");
    const o = found.order, channel = financeText(o.channel, 20).toLowerCase(), oldGross = Financial.money(o.grossPlatform != null ? o.grossPlatform : (o.subtotal != null ? o.subtotal : o.total)), oldCommission = Financial.money(o.commission), oldMerchantPromo=Financial.money(o.platformMerchantPromo), oldDeliveryFeeDiscount=Financial.money(o.platformDeliveryFeeDiscount), oldAdsMarketing=Financial.money(o.platformAdsMarketing), oldMarketingFee=Financial.money(o.platformMarketingFee), oldWht=Financial.money(o.platformWht), oldVat=Financial.money(o.platformVat), oldNet=Financial.money(o.netPlatform != null ? o.netPlatform : oldGross-oldCommission-Financial.money(o.platformDiscount)-oldWht-oldVat-oldAdsMarketing-oldMarketingFee);
    if (data.action === "lookup") return {orderId: found.id, platformRef: o.platformRef || found.id, channel, gross: oldGross, commission: oldCommission, merchantPromo:oldMerchantPromo, deliveryFeeDiscount:oldDeliveryFeeDiscount, adsMarketing:oldAdsMarketing, marketingFee:oldMarketingFee, wht:oldWht, vat:oldVat, net:oldNet, settlementStatus: o.settlementStatus || "unsettled", hasStructuredItems: Array.isArray(o.lineItems) && o.lineItems.length > 0};
    if (o.voided) throw new HttpsError("failed-precondition", "A voided order cannot be corrected.");
    if ((o.settlementStatus || "unsettled") === "settled" || o.payoutId) throw new HttpsError("failed-precondition", "This order is already settled. Reverse its payout before correcting it.");
    const previousPlatformRef = financeText(o.platformRef || found.id, 60), newPlatformRef = financeText(data.newPlatformRef || previousPlatformRef, 60).trim(), oldRefKey = platformRefKey(previousPlatformRef), newRefKey = platformRefKey(newPlatformRef);
    if (!newPlatformRef || !newRefKey) throw new HttpsError("invalid-argument", "The corrected platform order reference is required.");
    if (newRefKey !== oldRefKey) {
      const duplicate = await existingPlatformOrder(db, channel, newPlatformRef, found.id);
      if (duplicate) throw new HttpsError("already-exists", `Platform reference ${newPlatformRef} already belongs to another ${channel === "grabfood" ? "GrabFood" : "FoodPanda"} order.`);
      const indexed = (await db.ref(`/platformRefIndex/${channel}/${newRefKey}`).get()).val();
      if (indexed && indexed.orderId !== found.id) throw new HttpsError("already-exists", `Platform reference ${newPlatformRef} is already reserved by another order.`);
    }
    const gross = Financial.money(data.gross), commission = Financial.money(data.commission), merchantPromo=Financial.money(data.merchantPromo), deliveryFeeDiscount=Financial.money(data.deliveryFeeDiscount), adsMarketing=Financial.money(data.adsMarketing), marketingFee=Financial.money(data.marketingFee), reason = financeText(data.reason, 300);
    if (!(gross > 0)) throw new HttpsError("invalid-argument", "Verified gross must be greater than zero.");
    if (commission < 0 || commission > gross + 0.009) throw new HttpsError("invalid-argument", "Verified commission must be between zero and the verified gross.");
    if (!reason) throw new HttpsError("invalid-argument", "A correction reason is required.");
    if ([merchantPromo,deliveryFeeDiscount,adsMarketing,marketingFee].some((value)=>value<0)) throw new HttpsError("invalid-argument", "Verified platform deductions cannot be negative.");
    const discount = Financial.money(merchantPromo+deliveryFeeDiscount), wht = oldWht, vat = oldVat, net = Financial.money(gross - commission - discount - wht - vat - adsMarketing - marketingFee);
    if (net < -0.009) throw new HttpsError("failed-precondition", "The verified platform deductions exceed the verified gross.");
    const delta = Financial.money(Math.abs(oldNet - net)), referenceChanged = newPlatformRef !== previousPlatformRef,figuresChanged=[oldGross-gross,oldCommission-commission,oldMerchantPromo-merchantPromo,oldDeliveryFeeDiscount-deliveryFeeDiscount,oldAdsMarketing-adsMarketing,oldMarketingFee-marketingFee].some((value)=>Math.abs(value)>0.009); if (!referenceChanged && !figuresChanged) throw new HttpsError("failed-precondition", "The verified reference and figures are unchanged.");
    const version = Math.max(1, Number(o.preSettlementCorrectionVersion || 0) + 1), movementId = `platform_presettle_${found.id}_${version}`;
    const approval = await claimManagerApproval(db, data, "correct_platform_presettlement", found.id, delta, movementId), now = Date.now(), accounts = (await db.ref("/cfAccounts").get()).val() || {};
    const corrected = Object.assign({}, o, {platformRef:newPlatformRef,grossPlatform:gross,subtotal:gross,total:gross,platformDiscount:discount,platformMerchantPromo:merchantPromo,platformDeliveryFeeDiscount:deliveryFeeDiscount,platformAdsMarketing:adsMarketing,platformMarketingFee:marketingFee,netSalesPlatform:Financial.money(gross-discount),commission,netPlatform:Math.max(0,net),preSettlementCorrected:true,preSettlementCorrectionVersion:version,preSettlementCorrectedAt:now,preSettlementCorrectedBy:actor.uid,preSettlementCorrectionReason:reason});
    delete corrected.dupPlatformRef;
    if (Array.isArray(corrected.payments)) corrected.payments = corrected.payments.map((payment) => Object.assign({}, payment, {amount:corrected.payments.length === 1 ? gross : payment.amount, ref:platformRefKey(payment.ref) === oldRefKey ? newPlatformRef : payment.ref}));
    const beforePosting = Financial.orderPosting(o, accounts), afterPosting = Financial.orderPosting(corrected, accounts), movement = Financial.postingDifference(beforePosting, afterPosting, "platform_presettlement_correction", found.id, "Pre-settlement correction");
    const approvedBy = approval.record.approvedEmail || approval.record.approvedRole;
    if (movement) {movement.occurredAt = Number(o.timestamp || now); movement.approvalId = approval.id; movement.approvedBy = approvedBy; movement.correctionRecordedAt = now; movement.platformRef = newPlatformRef; movement.previousPlatformRef = previousPlatformRef;}
    const history = {version,before:{platformRef:previousPlatformRef,gross:oldGross,commission:oldCommission,merchantPromo:oldMerchantPromo,deliveryFeeDiscount:oldDeliveryFeeDiscount,adsMarketing:oldAdsMarketing,marketingFee:oldMarketingFee,net:oldNet},after:{platformRef:newPlatformRef,gross,commission,merchantPromo,deliveryFeeDiscount,adsMarketing,marketingFee,net:Math.max(0,net)},reason,platformRef:newPlatformRef,previousPlatformRef,approvalId:approval.id,approvedBy,actorUid:actor.uid,actorRole:actor.role,at:now,inventoryEffect:0,cogsEffect:0,movementId:movement?movementId:""};
    corrected.preSettlementCorrections = Object.assign({}, o.preSettlementCorrections || {}, {[version]:history});
    const writes = Object.assign({}, approval.usedWrites, {[`${found.node}/${found.id}`]:corrected,[`operationalAudit/${now}_platform_presettle_${found.id}`]:{action:"correct_platform_presettlement",sourceType:"order",sourceId:found.id,platformRef:newPlatformRef,previousPlatformRef,channel,before:history.before,after:history.after,reason,approvalId:approval.id,actorUid:actor.uid,actorRole:actor.role,inventoryEffect:0,cogsEffect:0,financialEffect:movement?"posting_difference":"none",ts:now,schemaVersion:1}});
    if (referenceChanged) {writes[`platformRefIndex/${channel}/${newRefKey}`]={orderId:found.id,ref:newPlatformRef,at:Number(o.timestamp)||now,correctedAt:now}; if (newRefKey !== oldRefKey) {const oldIndex=(await db.ref(`/platformRefIndex/${channel}/${oldRefKey}`).get()).val(); if (oldIndex && oldIndex.orderId === found.id) writes[`platformRefIndex/${channel}/${oldRefKey}`]=null;} writes[`platformRefDuplicates/${found.id}`]=null;}
    const active=(await db.ref(`/activeOrders/${found.id}`).get()).val(); if (active) {writes[`activeOrders/${found.id}/platformRef`]=newPlatformRef; if (Array.isArray(active.payments)) writes[`activeOrders/${found.id}/payments`]=corrected.payments;}
    let duplicate=false; if (movement) {const committed=await commitFinancial(db,movementId,movement,actor,writes);duplicate=committed.duplicate;} else await db.ref().update(writes);
    return {orderId:found.id,previousPlatformRef,platformRef:newPlatformRef,gross,commission,merchantPromo,deliveryFeeDiscount,adsMarketing,marketingFee,net:Math.max(0,net),movementId:movement?movementId:"",financialPosted:!!movement,duplicate};
  },
);

exports.settlePlatformPayout = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 60, memory: "256MiB"},
  async (request) => {
    const db = getDatabase(); const actor = await requirePortalPermission(db, request, ["receivables"]); const data = request.data || {}, payoutId = financeKey(data.payoutId, "Payout ID"), channel = financeText(data.channel, 30); if (!["grabfood", "foodpanda"].includes(channel)) throw new HttpsError("invalid-argument", "Platform is invalid.");
    const accounts=(await db.ref("/cfAccounts").get()).val()||{};
    const ids = Array.isArray(data.orderIds) ? [...new Set(data.orderIds.map((id) => financeKey(id, "Order ID")))] : []; if (!ids.length) throw new HttpsError("invalid-argument", "Select at least one order.");
    const found = await Promise.all(ids.map((id) => findOrder(db, id))); let expected = 0; found.forEach((entry) => { const o = entry.order; if (o.channel !== channel || o.voided || (o.settlementStatus || "unsettled") === "settled") throw new HttpsError("failed-precondition", `Order ${entry.id} is not eligible for this payout.`); expected += Financial.money(o.netPlatform != null ? o.netPlatform : Financial.money(o.grossPlatform || o.total) - Financial.money(o.commission) - Financial.money(o.platformDiscount) - Financial.money(o.platformWht) - Financial.money(o.platformVat) - Financial.money(o.platformAdsMarketing) - Financial.money(o.platformMarketingFee)); }); expected = Financial.money(expected);
    const actual = Financial.money(data.actualPayout),destinationAccountId=actual>0?accountIdFor(accounts,data.destinationAccountId):""; const approval = await claimManagerApproval(db, data, "settle_platform_payout", payoutId, actual, `payout_${payoutId}`), variance = Financial.money(actual - expected), configuredDefs = (await db.ref("/platformVarAccounts").get()).val() || {}, defs = Object.assign({}, configuredDefs, {va_refund:{name:"Grab refund / cancellation deduction",type:"expense"},va_refund_recovery:{name:"Grab refund recovery / reversal",type:"revenue"}}), allocations = data.allocations || {}, requestedAllocationRefs = data.allocationRefs || {}, allocationRefs = {}, allocationMeta = {}; const _allPo = (await db.ref("/platformPayouts").get()).val() || {}; let outstandingOwing = 0; const owingSources = []; Object.keys(_allPo).forEach((k) => { const po = _allPo[k] || {}; if (po.channel === channel && !po.reversed && Financial.money(po.owingOutstanding) > 0.009) { outstandingOwing = Financial.money(outstandingOwing + Financial.money(po.owingOutstanding)); owingSources.push(k); } });
    let netAlloc = 0, owingApplied = 0, owingCreated = 0; const lines = [];
    if (actual < 0) { owingCreated = Financial.money(-actual); lines.push(Financial.line(`liability:platform_owing:${channel}`, 0, owingCreated, "Owing to platform (penalties exceeded payout)")); } else { lines.push(Financial.line(`asset:platform_clearing:${channel}`, actual, 0, "Actual payout clearing")); if (outstandingOwing > 0.009) { owingApplied = outstandingOwing; lines.push(Financial.line(`liability:platform_owing:${channel}`, owingApplied, 0, "Recover prior owing to platform")); } }
    Object.keys(allocations).forEach((id) => { const value = Financial.money(allocations[id]), suppliedSourceRef = financeText(requestedAllocationRefs[id], 120), payoutSourced = ["va_refund", "va_refund_recovery"].includes(id), automaticPayoutSource = payoutSourced ? financeText(`${channel === "grabfood" ? "Grab" : "FoodPanda"} payout ${payoutId} · ${financeText(data.payoutDate, 10) || "date pending"} · ${financeText(data.periodStart, 10) || "open"} to ${financeText(data.periodEnd, 10) || "open"}`, 120) : "", sourceRef = suppliedSourceRef || automaticPayoutSource; if (!(value > 0) || !defs[id]) throw new HttpsError("invalid-argument", "Variance allocation is invalid."); const name = financeText(defs[id].name || id, 120), type = defs[id].type === "revenue" ? "revenue" : "expense", label = `${name}${sourceRef ? ` · ${sourceRef}` : ""}`; if (sourceRef) allocationRefs[id] = sourceRef; allocationMeta[id] = {name,type,sourceRef,sourceKind:suppliedSourceRef ? "entered_reference" : (payoutSourced ? "payout" : "none")}; if (type === "revenue") {netAlloc += value; lines.push(Financial.line(`revenue:platform_variance:${id}`, 0, value, label));} else {netAlloc -= value; lines.push(Financial.line(`expense:platform_variance:${id}`, value, 0, label));} });
    if (Math.abs(Financial.money(netAlloc) - Financial.money(variance + owingApplied)) > 0.009) throw new HttpsError("failed-precondition", "Variance allocations do not equal the server-calculated variance.");
    const writes = Object.assign({}, approval.usedWrites), settledAt = Date.now(), payoutDate=/^\d{4}-\d{2}-\d{2}$/.test(financeText(data.payoutDate, 10))?financeText(data.payoutDate, 10):null;if(!payoutDate)throw new HttpsError("invalid-argument","The platform payout date is required.");
    const platformStatementReference=financeText(data.platformStatementReference,120),depositReference=financeText(data.depositReference,120);if(actual>0&&!depositReference)throw new HttpsError("invalid-argument","The bank transaction or payout reference is required.");
    const payoutRecord = {channel, periodStart: financeText(data.periodStart, 10), periodEnd: financeText(data.periodEnd, 10), payoutDate, platformStatementReference:platformStatementReference||null, depositReference:depositReference||null, owing: owingCreated || null, owingOutstanding: owingCreated || 0, owingApplied: owingApplied || null, owingRecoveredSources: (owingApplied > 0 ? owingSources : null), expectedNet: expected, actualPayout: actual, variance, allocations, allocationRefs, allocationMeta, orderIds: ids, by: actor.role, actorUid: actor.uid, approvedBy: approval.record.approvedEmail || approval.record.approvedRole, approvalId: approval.id, settledAt, movementId: `payout_${payoutId}`, schemaVersion: 1};
    const movement = Financial.platformPayoutPosting(Object.assign({id:payoutId}, payoutRecord), defs);
    if(actual>0){const accountId=destinationAccountId,platformName=channel==="grabfood"?"Grab":"FoodPanda",depositId=`payout_deposit_${payoutId}`,reference=depositReference,occurredAt=accountingTimestamp(payoutDate,settledAt),deposit=Financial.movement("platform_payout_deposit","platformPayout",payoutId,[Financial.line(`asset:cash_account:${accountId}`,actual,0,`${platformName} payout deposited directly to ${accounts[accountId].name}`),Financial.line(`asset:platform_clearing:${channel}`,0,actual,`Clear ${platformName} payout in transit`)],{occurredAt,reference,accountId,automatic:true});payoutRecord.depositMovementId=depositId;payoutRecord.depositedAt=settledAt;payoutRecord.accountId=accountId;payoutRecord.autoDeposited=true;writes[`financialMovements/${depositId}`]=financeRecord(depositId,deposit,actor);writes[`cfLedger/fm_${depositId}`]=cashLedgerRecord({date:payoutDate,accountId,dir:"in",category:`${platformName} payout`,amount:actual,party:channel,ref:reference,auto:true},depositId,deposit,actor);writes[`operationalAudit/${settledAt}_${channel}_direct_deposit_${payoutId}`]=operationalAuditRecord("platform_payout_auto_deposit","platformPayout",payoutId,actor,{channel,amount:actual,date:payoutDate,accountId,accountName:accounts[accountId].name,movementId:depositId,reference,platformStatementReference});}
    found.forEach((entry) => {writes[`${entry.node}/${entry.id}/settlementStatus`] = "settled"; writes[`${entry.node}/${entry.id}/payoutId`] = payoutId;}); owingSources.forEach((sid) => { writes[`platformPayouts/${sid}/owingOutstanding`] = 0; writes[`platformPayouts/${sid}/owingRecoveredBy`] = payoutId; writes[`platformPayouts/${sid}/owingRecoveredAt`] = settledAt; }); writes[`platformPayouts/${payoutId}`] = payoutRecord;
    const committed = await commitFinancial(db, `payout_${payoutId}`, movement, actor, writes); return {payoutId, expectedNet: expected, actualPayout: actual, variance, orderCount: ids.length, owingApplied, owingCreated,depositMovementId:payoutRecord.depositMovementId||"",depositAccountId:payoutRecord.accountId||"", duplicate: committed.duplicate};
  },
);

// Reverse a settled platform payout: unwinds the settlement posting (append-only
// reversing entry), and sends its orders back to unsettled so they can be
// re-settled correctly. The payout record is kept and marked reversed (audit).
exports.reversePlatformPayout = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 60, memory: "256MiB"},
  async (request) => {
    const db = getDatabase(); const actor = await requirePortalPermission(db, request, ["receivables"]);
    const data = request.data || {}, payoutId = financeKey(data.payoutId, "Payout ID"), reason = financeText(data.reason, 300);
    if (!reason) throw new HttpsError("invalid-argument", "Reversal reason is required.");
    const payout = (await db.ref(`/platformPayouts/${payoutId}`).get()).val();
    if (!payout) throw new HttpsError("not-found", "Payout not found.");
    if (payout.reversed) throw new HttpsError("already-exists", "This payout has already been reversed.");
    const channel = financeText(payout.channel, 30), ids = Array.isArray(payout.orderIds) ? payout.orderIds : [];
    const expected = Financial.money(payout.expectedNet), actual = Financial.money(payout.actualPayout), allocations = payout.allocations || {}, allocationRefs = payout.allocationRefs || {}, allocationMeta = payout.allocationMeta || {};
    const owing = Financial.money(payout.owing), owingApplied = Financial.money(payout.owingApplied), owingOutstanding = Financial.money(payout.owingOutstanding);
    if (owing > 0.009 && Math.abs(owingOutstanding - owing) > 0.009) throw new HttpsError("failed-precondition", "This payout\u2019s owing was already recovered by a later payout. Reverse that payout first.");
    const approval = await claimManagerApproval(db, data, "reverse_platform_payout", payoutId, null, `reverse_payout_${payoutId}`);
    const defs = (await db.ref("/platformVarAccounts").get()).val() || {};
    const lines = [Financial.line(`asset:platform_receivable:${channel}`, expected, 0, "Restore platform receivable")];
    if (payout.depositMovementId && !payout.depositReversalMovementId) { const depositAccount=accountIdFor((await db.ref("/cfAccounts").get()).val()||{},payout.accountId); lines.push(Financial.line(`asset:platform_clearing:${channel}`,actual,0,"Reverse deposited payout")); lines.push(Financial.line(`asset:cash_account:${depositAccount}`,0,actual,"Reverse deposited payout")); }
    if (owing > 0.009) { lines.push(Financial.line(`liability:platform_owing:${channel}`, owing, 0, "Reverse owing to platform")); } else { lines.push(Financial.line(`asset:platform_clearing:${channel}`, 0, actual, "Reverse actual payout clearing")); if (owingApplied > 0.009) lines.push(Financial.line(`liability:platform_owing:${channel}`, 0, owingApplied, "Reverse prior-owing recovery")); }
    Object.keys(allocations).forEach((id) => { const value = Financial.money(allocations[id]); if (!(value > 0)) return; const def = allocationMeta[id] || defs[id] || {}, sourceRef = financeText(def.sourceRef || allocationRefs[id], 120), label = `Reverse ${def.name || id}${sourceRef ? ` · ${sourceRef}` : ""}`; if (def.type === "revenue") lines.push(Financial.line(`revenue:platform_variance:${id}`, value, 0, label)); else lines.push(Financial.line(`expense:platform_variance:${id}`, 0, value, label)); });
    const now = Date.now(), movement = Financial.movement("platform_payout_reversal", "platformPayout", payoutId, lines, {occurredAt: now, approvalId: approval.id, approvedBy: approval.record.approvedEmail || approval.record.approvedRole});
    const writes = Object.assign({}, approval.usedWrites);
    const found = await Promise.all(ids.map((id) => findOrder(db, id).catch(() => null)));
    found.forEach((entry) => { if (!entry) return; if ((entry.order.payoutId || "") === payoutId) { writes[`${entry.node}/${entry.id}/settlementStatus`] = "unsettled"; writes[`${entry.node}/${entry.id}/payoutId`] = ""; } });
    if (owingApplied > 0.009 && Array.isArray(payout.owingRecoveredSources)) { const allPo = (await db.ref("/platformPayouts").get()).val() || {}; payout.owingRecoveredSources.forEach((sid) => { const src = allPo[sid] || {}; writes[`platformPayouts/${sid}/owingOutstanding`] = Financial.money(src.owing); writes[`platformPayouts/${sid}/owingRecoveredBy`] = null; writes[`platformPayouts/${sid}/owingRecoveredAt`] = null; }); }
    writes[`platformPayouts/${payoutId}/reversed`] = true;
    writes[`platformPayouts/${payoutId}/reversedAt`] = now;
    writes[`platformPayouts/${payoutId}/reversedBy`] = actor.uid;
    writes[`platformPayouts/${payoutId}/reversalReason`] = reason;
    writes[`platformPayouts/${payoutId}/reversalApprovalId`] = approval.id;
    if (payout.depositMovementId && !payout.depositReversalMovementId) { const reverseDate=financeDateFromTimestamp(now); writes[`platformPayouts/${payoutId}/depositReversalMovementId`]=`reverse_payout_${payoutId}`; writes[`platformPayouts/${payoutId}/depositReversedAt`]=now; writes[`cfLedger/fm_reverse_payout_${payoutId}`]=cashLedgerRecord({date:reverseDate,accountId:payout.accountId,dir:"out",category:"Platform payout reversal",amount:actual,party:channel,ref:payout.depositReference||payoutId,auto:true},`reverse_payout_${payoutId}`,movement,actor); }
    writes[`operationalAudit/${now}_reverse_payout_${payoutId}`] = {action: "reverse_platform_payout", sourceType: "platformPayout", sourceId: payoutId, channel, amount: actual, orderCount: ids.length, actorUid: actor.uid, actorRole: actor.role, approvalId: approval.id, reason, ts: now, schemaVersion: 1};
    const committed = await commitFinancial(db, `reverse_payout_${payoutId}`, movement, actor, writes);
    return {payoutId, orderCount: ids.length, duplicate: committed.duplicate};
  },
);

// Correct descriptive payout metadata from the platform or bank statement.
// This deliberately cannot change money, linked orders, receiving account, or
// Finance movements. Those remain controlled settlement/reversal workflows.
exports.setPlatformPayoutDate = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 30, memory: "256MiB"},
  async (request) => {
    const db = getDatabase(); const actor = await requirePortalPermission(db, request, ["receivables"]);
    const data = request.data || {}, payoutId = financeKey(data.payoutId, "Payout ID"), raw = financeText(data.payoutDate, 10);
    if (raw && !/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new HttpsError("invalid-argument", "Payout date must be YYYY-MM-DD.");
    const payoutSnap = await db.ref(`/platformPayouts/${payoutId}`).get();
    if (!payoutSnap.exists()) throw new HttpsError("not-found", "Payout not found.");
    const payout = payoutSnap.val() || {}, hasDepositReference = Object.prototype.hasOwnProperty.call(data, "depositReference"), hasPlatformStatementReference = Object.prototype.hasOwnProperty.call(data, "platformStatementReference"), hasNotes = Object.prototype.hasOwnProperty.call(data, "notes"), depositReference = hasDepositReference ? financeText(data.depositReference, 120) : financeText(payout.depositReference, 120), platformStatementReference = hasPlatformStatementReference ? financeText(data.platformStatementReference, 120) : financeText(payout.platformStatementReference, 120), notes = hasNotes ? financeText(data.notes, 500) : financeText(payout.notes, 500);
    const now = Date.now();
    const writes = {
      [`platformPayouts/${payoutId}/payoutDate`]: raw || null,
      [`platformPayouts/${payoutId}/metadataUpdatedAt`]: now,
      [`platformPayouts/${payoutId}/metadataUpdatedBy`]: actor.uid,
      [`operationalAudit/${now}_update_payout_metadata_${payoutId}`]: {action: "update_platform_payout_metadata", sourceType: "platformPayout", sourceId: payoutId, detail: {payoutDate: raw || "", depositReference: depositReference || "", platformStatementReference: platformStatementReference || "", notes: notes || ""}, previous: {payoutDate: payout.payoutDate || "", depositReference: payout.depositReference || "", platformStatementReference: payout.platformStatementReference || "", notes: payout.notes || ""}, financialEffect: "none", actorUid: actor.uid, actorRole: actor.role, ts: now, schemaVersion: 1},
    };
    if (hasDepositReference) writes[`platformPayouts/${payoutId}/depositReference`] = depositReference || null;
    if (hasPlatformStatementReference) writes[`platformPayouts/${payoutId}/platformStatementReference`] = platformStatementReference || null;
    if (hasNotes) writes[`platformPayouts/${payoutId}/notes`] = notes || null;
    await db.ref().update(writes);
    return {payoutId, payoutDate: raw || "", depositReference, platformStatementReference, notes, financialEffect: "none"};
  },
);

exports.processOrderAdjustment = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 60, memory: "256MiB"},
  async (request) => {
    const db = getDatabase(); const actor = await requirePortalPermission(db, request, ["registerOps"]); const data = request.data || {}, found = await findOrder(db, data.orderId), o = found.order;
    if (data.action === "cashier_verify_payment") {
      if (["grabfood", "foodpanda"].includes(String(o.channel || "").toLowerCase())) throw new HttpsError("failed-precondition", "Platform orders are settled through their platform payout.");
      if (["cashier_verified", "manager_validated", "confirmed"].includes(o.paymentStatus)) return {alreadyVerified: true, paymentStatus: o.paymentStatus};
      const payments = (Array.isArray(o.payments) && o.payments.length ? o.payments : [{method: o.payment, amount: o.total}]).map((row) => Object.assign({}, row));
      const direct = PaymentVerification.directPaymentRows(payments), posSettings = (await db.ref("/posSettings").get()).val() || {}, verificationPolicy = PaymentVerification.paymentPolicy(payments, posSettings.payMethods);
      if (!direct.length) throw new HttpsError("failed-precondition", "This order has no direct GCash, Maya, or bank payment to verify.");
      if (verificationPolicy === PaymentVerification.MANAGER_ONLY) throw new HttpsError("permission-denied", "This payment method requires manager-only verification.");
      const suppliedRef = financeText(data.reference, 120); if (direct.length === 1 && !financeText(direct[0].ref, 120) && suppliedRef) direct[0].ref = suppliedRef;
      if (direct.some((row) => !financeText(row.ref, 120))) throw new HttpsError("invalid-argument", "Enter the transaction reference for every direct electronic payment.");
      const now = Date.now(), website = o.source === "online" || o.channel === "online", nextStatus = website && String(o.status || "Pending") === "Pending" ? "Confirmed" : String(o.status || "Pending");
      const verified = Object.assign({}, o, {payments, paymentStatus: "cashier_verified", paymentVerificationPolicy: verificationPolicy, cashierVerifiedAt: now, cashierVerifiedBy: actor.uid, cashierVerifiedRole: actor.role, cashierVerifiedAmount: Financial.money(direct.reduce((sum, row) => sum + Financial.money(row.amount), 0)), status: nextStatus});
      if (nextStatus !== o.status) { verified.statusUpdatedAt = now; verified.statusUpdatedBy = actor.uid; }
      const writes = {[`${found.node}/${o.id}`]: verified, [`activeOrders/${o.id}`]: activeOrderProjection(verified), [`operationalAudit/${now}_cashier_verify_${o.id}`]: {action: "cashier_verify_payment", sourceType: "order", sourceId: o.id, amount: verified.cashierVerifiedAmount, actorUid: actor.uid, actorRole: actor.role, ts: now, schemaVersion: 1}};
      if (verified.ownerUid) writes[`customerOrders/${verified.ownerUid}/${o.id}/status`] = nextStatus;
      await db.ref().update(writes); const accounts = (await db.ref("/cfAccounts").get()).val() || {}, posted = await postOrderFinancial(db, verified, accounts, {uid: "server", role: "server"});
      return {verified: true, status: nextStatus, paymentStatus: "cashier_verified", financialPosted: !posted.skipped, duplicate: posted.duplicate === true};
    }
    if (data.action === "manager_validate_payment") {
      if (o.paymentStatus === "manager_validated" || o.paymentStatus === "confirmed") return {alreadyValidated: true};
      const payments = (Array.isArray(o.payments) && o.payments.length ? o.payments : [{method: o.payment, amount: o.total}]).map((row) => Object.assign({}, row)), direct = PaymentVerification.directPaymentRows(payments), posSettings = (await db.ref("/posSettings").get()).val() || {}, verificationPolicy = PaymentVerification.paymentPolicy(payments, posSettings.payMethods);
      if (!direct.length) throw new HttpsError("failed-precondition", "This order has no direct electronic payment to validate.");
      if (verificationPolicy === PaymentVerification.CASHIER_MANAGER && o.paymentStatus !== "cashier_verified") throw new HttpsError("failed-precondition", "Cashier verification is required before manager validation.");
      if (verificationPolicy === PaymentVerification.MANAGER_ONLY && !["pending", "cashier_verified"].includes(o.paymentStatus)) throw new HttpsError("failed-precondition", "This payment is not awaiting manager verification.");
      if (direct.some((row) => !financeText(row.ref, 120))) throw new HttpsError("invalid-argument", "Every direct electronic payment requires a transaction reference.");
      const approval = await claimManagerApproval(db, data, "validate_payment", o.id, Financial.money(o.total), `validate_${o.id}`), now = Date.now(), approvedBy = approval.record.approvedEmail || approval.record.approvedRole, website = o.source === "online" || o.channel === "online", nextStatus = website && String(o.status || "Pending") === "Pending" ? "Confirmed" : String(o.status || "Pending");
      const validated = Object.assign({}, o, {payments, paymentStatus: "manager_validated", paymentVerificationPolicy: verificationPolicy, managerValidatedAt: now, managerValidatedBy: approval.record.approvedBy, managerValidatedRole: approval.record.approvedRole, managerValidatedName: approvedBy, paymentApprovalId: approval.id, status: nextStatus});
      if (nextStatus !== o.status) { validated.statusUpdatedAt = now; validated.statusUpdatedBy = actor.uid; }
      const activeShift = (await db.ref("/posActiveShift").get()).val() || null;
      const writes = Object.assign({}, approval.usedWrites, {[`${found.node}/${o.id}`]: validated, [`activeOrders/${o.id}`]: shouldProjectOrder(validated, activeShift, now) ? activeOrderProjection(validated) : null, [`operationalAudit/${now}_manager_validate_${o.id}`]: {action: "manager_validate_payment", sourceType: "order", sourceId: o.id, actorUid: actor.uid, actorRole: actor.role, approvedBy: approval.record.approvedBy, approvedRole: approval.record.approvedRole, approvalId: approval.id, ts: now, schemaVersion: 1}});
      if (validated.ownerUid) writes[`customerOrders/${validated.ownerUid}/${o.id}/status`] = nextStatus;
      await db.ref().update(writes); const accounts = (await db.ref("/cfAccounts").get()).val() || {}, posted = await postOrderFinancial(db, validated, accounts, {uid: "server", role: "server"}); return {validated: true, paymentStatus: "manager_validated", approvedBy, financialPosted: !posted.skipped, duplicate: posted.duplicate === true};
    }
    const reason = financeText(data.reason, 300); if (!reason) throw new HttpsError("invalid-argument", "Reason is required."); const accounts = (await db.ref("/cfAccounts").get()).val() || {}; await postOrderFinancial(db, o, accounts, {uid: "server", role: "server"});
    const now = Date.now(), writes = {}; let movementId, movement;
    if (data.action === "refund") { const delta = Financial.money(data.amount), already = Financial.money(o.refundAmount), max = Financial.money(o.total); if (!(delta > 0) || already + delta > max + 0.009) throw new HttpsError("invalid-argument", "Refund exceeds the refundable amount."); const cumulative = Financial.money(already + delta), original = (Array.isArray(o.payments)&&o.payments.length?o.payments:[{method:o.payment||"Cash",amount:o.total}]), prior = o.refundPayments || {}, tender = Array.isArray(data.refundPayments)?data.refundPayments.map((row) => ({method:financeText(row.method,60),amount:Financial.money(row.amount)})).filter((row) => row.method&&row.amount>0):[]; if ((o.channel||"instore") === "instore") {if (Math.abs(tender.reduce((s,row)=>Financial.money(s+row.amount),0)-delta)>0.009) throw new HttpsError("invalid-argument","Refund tender allocations must equal the refund amount."); const allowed={}; original.forEach((row)=>{allowed[row.method]=Financial.money((allowed[row.method]||0)+Financial.money(row.amount));}); tender.forEach((row)=>{if (!allowed[row.method] || Financial.money((prior[row.method]||0)+row.amount)>allowed[row.method]+0.009) throw new HttpsError("invalid-argument",`Refund through ${row.method} exceeds the original payment.`);});} movementId = `refund_${o.id}_${Math.round(cumulative * 100)}`; const approval = await claimManagerApproval(db, data, "refund", o.id, delta, movementId); movement = Financial.reversalPosting(o, delta, "refund", accounts, tender); Object.assign(writes, approval.usedWrites); const nextRefundPayments=Object.assign({},prior);tender.forEach((row)=>{nextRefundPayments[row.method]=Financial.money((nextRefundPayments[row.method]||0)+row.amount);}); writes[`${found.node}/${o.id}/refundAmount`] = cumulative; writes[`${found.node}/${o.id}/refundPayments`] = nextRefundPayments; writes[`${found.node}/${o.id}/refundHistory/${movementId}`] = {amount:delta,payments:tender,reason,at:now,by:actor.uid,approvalId:approval.id,approvedBy:approval.record.approvedEmail||approval.record.approvedRole}; writes[`${found.node}/${o.id}/refundReason`] = reason; writes[`${found.node}/${o.id}/refundedAt`] = now; writes[`${found.node}/${o.id}/refundedBy`] = actor.uid; writes[`${found.node}/${o.id}/refunded`] = true; }
    else if (data.action === "void") { if (o.voided) throw new HttpsError("already-exists", "Order is already voided."); const value = Financial.money(Math.max(0, Financial.money(o.total) - Financial.money(o.refundAmount))); if (!(value > 0)) throw new HttpsError("failed-precondition", "Nothing remains to void."); movementId = `void_${o.id}`; const approval = await claimManagerApproval(db, data, "void", o.id, value, movementId), original=(Array.isArray(o.payments)&&o.payments.length?o.payments:[{method:o.payment||"Cash",amount:o.total}]), prior=o.refundPayments||{}, tender=[]; if ((o.channel||"instore")==="instore") {let rem=value; original.forEach((row)=>{const available=Financial.money(Math.max(0,Financial.money(row.amount)-Financial.money(prior[row.method]))),use=Financial.money(Math.min(rem,available));if(use>0){tender.push({method:row.method,amount:use});rem=Financial.money(rem-use);}});if(rem>0.009)throw new HttpsError("failed-precondition","Original payment allocation cannot support the void reversal.");} movement = await fullOrderVoidMovement(db, o, accounts, tender); if (!movement) throw new HttpsError("failed-precondition", "The void has no remaining financial balance to reverse."); Object.assign(writes, approval.usedWrites); writes[`${found.node}/${o.id}/voided`] = true; writes[`${found.node}/${o.id}/voidPayments`] = tender; writes[`${found.node}/${o.id}/voidApprovalId`] = approval.id; writes[`${found.node}/${o.id}/voidApprovedBy`] = approval.record.approvedEmail||approval.record.approvedRole; writes[`${found.node}/${o.id}/voidReason`] = reason; writes[`${found.node}/${o.id}/voidedAt`] = now; writes[`${found.node}/${o.id}/voidedBy`] = actor.uid; }
    else throw new HttpsError("invalid-argument", "Adjustment action is invalid.");
    if (data.restock === true) {writes[`${found.node}/${o.id}/inventoryReversalRequested`] = true; writes[`${found.node}/${o.id}/inventoryReversalReason`] = reason;}
    movement.occurredAt = now; movement.actorName = actor.role; movement.approvalId=financeText(data.approvalId,160); addOrderCashWrites(writes, movement, movementId, o, actor); const committed = await commitFinancial(db, movementId, movement, actor, writes); return {movementId, duplicate: committed.duplicate};
  },
);

// Re-key a missed Grab/FoodPanda order from the Payout Reconciliation screen.
// Amount-only (no line items, no COGS/inventory deduction — by design). Books
// revenue + commission + the platform receivable, dated on the real order date.
// Duplicate-safe via platformRefIndex; requires a privileged approval (managers
// self-approve on the client, other roles need a manager sign-in).
exports.recordPlatformCatchup = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 30, memory: "256MiB"},
  async (request) => {
    const db = getDatabase();
    const actor = await requirePortalPermission(db, request, ["payouts", "receivables"]);
    const data = request.data || {};
    const channel = financeText(data.channel, 20).toLowerCase();
    if (channel !== "grabfood" && channel !== "foodpanda") throw new HttpsError("invalid-argument", "Channel must be grabfood or foodpanda.");
    const prefix = channel === "grabfood" ? "GF-" : "FP-";
    let ref = financeText(data.platformRef, 60).trim();
    if (!ref) throw new HttpsError("invalid-argument", "Platform order number is required.");
    if (!new RegExp("^" + prefix, "i").test(ref)) ref = prefix + ref;
    const gross = Financial.money(data.gross);
    if (!(gross > 0)) throw new HttpsError("invalid-argument", "Gross amount must be greater than zero.");
    const commission = Financial.money(data.commission);
    if (commission < 0 || commission > gross + 0.009) throw new HttpsError("invalid-argument", "Commission must be between 0 and the gross amount.");
    const dateStr = financeText(data.date, 10);
    const parsedTs = Date.parse(dateStr + "T12:00:00+08:00");
    if (!parsedTs) throw new HttpsError("invalid-argument", "A valid order date (YYYY-MM-DD) is required.");
    if (parsedTs > Date.now() + 86400000) throw new HttpsError("invalid-argument", "Order date cannot be in the future.");
    const reference = financeText(data.reference, 200);
    const key = platformRefKey(ref);
    const historical = await existingPlatformOrder(db, channel, ref);
    if (historical) throw new HttpsError("already-exists", `${ref} was already recorded (order ${historical.id}). A platform reference can only be used once.`);
    const idxSnap = await db.ref(`/platformRefIndex/${channel}/${key}`).get();
    if (idxSnap.exists()) { const ex = idxSnap.val() || {}; throw new HttpsError("already-exists", `${ref} was already recorded (order ${ex.orderId || "unknown"}). A platform reference can only be used once.`); }
    const approval = await claimManagerApproval(db, data, "rekey_platform_order", ref, gross, `rekey_${ref}`);
    const now = Date.now(), net = Financial.money(gross - commission);
    const oid = prefix + "LATE-" + crypto.randomBytes(4).toString("hex").toUpperCase();
    const d = new Date(parsedTs), label = channel === "grabfood" ? "GrabFood" : "FoodPanda";
    const order = {
      id: oid, source: "pos", channel, platformRef: ref,
      name: label + " (late entry)", type: label, payment: label,
      grossPlatform: gross, commission, commissionRate: Financial.money(data.commissionRate), platformDiscount: 0,
      netSalesPlatform: gross, netPlatform: net, total: gross,
      settlementStatus: "unsettled", payoutId: "",
      status: "Completed", paymentStatus: "confirmed", receivedByCustomer: true,
      lateEntry: true, catchup: true, enteredVia: "payout-rekey", cogsSkipped: true,
      reference, catchupBy: actor.uid, catchupByRole: actor.role, catchupApprovalId: approval.id,
      staff: actor.email || actor.role, onDuty: actor.email || actor.role,
      date: d.toLocaleDateString("en-PH", {year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Manila"}),
      time: d.toLocaleTimeString("en-PH", {hour: "2-digit", minute: "2-digit", timeZone: "Asia/Manila"}),
      timestamp: parsedTs, completedAt: parsedTs, schemaVersion: 2,
    };
    const accounts = (await db.ref("/cfAccounts").get()).val() || {};
    const writes = Object.assign({}, approval.usedWrites, {
      [`orders/${oid}`]: order,
      [`operationalAudit/${now}_rekey_${oid}`]: {action: "rekey_platform_order", sourceType: "order", sourceId: oid, platformRef: ref, channel, amount: gross, actorUid: actor.uid, actorRole: actor.role, approvalId: approval.id, reference, orderDate: dateStr, ts: now, schemaVersion: 1},
    });
    await db.ref().update(writes);
    const posted = await postOrderFinancial(db, order, accounts, {uid: actor.uid, role: actor.role});
    return {orderId: oid, platformRef: ref, net, financialPosted: !posted.skipped, duplicate: posted.duplicate === true};
  },
);
