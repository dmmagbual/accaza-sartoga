function correctionRequestKey(value) {
  const key = String(value || "").trim();
  if (!/^[A-Za-z0-9_-]{12,80}$/.test(key)) throw new HttpsError("invalid-argument", "Order correction request ID is invalid.");
  return key;
}
function correctionItemText(lines) {
  return (lines || []).map((line) => `${line.name}${line.size ? ` (${line.size})` : ""}${line.optLabels && line.optLabels.length ? ` [${line.optLabels.join(", ")}]` : ""} x${line.qty}`).join(", ");
}
function correctionPlanMetadata(plan, now) {
  return {inventoryDeducted:true,inventoryUsage:positiveOrderInventoryUsage(plan.usage),inventoryDeductedAt:now,cogsSnapshot:Number(plan.totalCost)||0,cogsCategorySnapshot:plan.categorySnapshot||{},cogsCategorySnapshotVersion:1,cogsAccountSnapshot:plan.accountSnapshot||{},cogsAccountSnapshotVersion:1,cogsCovered:plan.cogsCovered,cogsDetail:{engineVersion:plan.engineVersion,computedAt:plan.capturedAt,totalCost:Number(plan.totalCost)||0,lines:plan.lines||[],warnings:plan.warnings||[]},costingEngineVersion:plan.engineVersion,deductedBy:"server-order-correction",inventoryLedgerVersion:1};
}
async function applyCompletedOrderCorrectionInventory(db, order, plan, token, now, actor) {
  const original = positiveOrderInventoryUsage(order.inventoryUsage), corrected = positiveOrderInventoryUsage(plan.usage);
  for (const itemId of Object.keys(original).sort()) await applyInventoryMovement(db,{movementId:`crr_${token}_${itemId}`,itemId,type:"refund_reversal",qty:qty6(original[itemId]),sourceType:"order_correction",sourceId:order.id,sourceLine:itemId,note:`Reverse original usage for corrected order ${order.id}`,reversalOf:`sale_${order.id}_${itemId}`,occurredAt:now,actorName:actor.role},actor);
  for (const itemId of Object.keys(corrected).sort()) await applyInventoryMovement(db,{movementId:`crs_${token}_${itemId}`,itemId,type:"sale_usage",qty:-qty6(corrected[itemId]),sourceType:"order_correction",sourceId:order.id,sourceLine:itemId,note:`Corrected ingredient usage for order ${order.id}`,occurredAt:now,actorName:actor.role},actor);
}

exports.processOrderAdjustment = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 120, memory: "512MiB"},
  async (request) => {
    const db = getDatabase(); const actor = await requirePortalPermission(db, request, ["registerOps"]); const data = request.data || {}; let found = await findOrder(db, data.orderId), o = found.order;
    if (data.action === "start_instore_preparation") {
      if (found.node !== "orders" || o.source !== "pos" || String(o.channel || "instore").toLowerCase() !== "instore" || o.status !== "Completed") throw new HttpsError("failed-precondition", "Only a current in-store completed sale can start preparation.");
      const active = (await db.ref("/posActiveShift").get()).val() || null;
      if (!active || active.id !== o.shiftId || active.status === "closed") throw new HttpsError("failed-precondition", "This sale is not in the currently open shift.");
      if (o.preparationStatus === "preparing") return {duplicate:true,preparationStatus:"preparing"};
      if (o.preparationStatus !== "not_prepared" || o.correctionPending || o.completedOrderCorrectionId) throw new HttpsError("failed-precondition", "This sale is no longer eligible to start preparation from this screen.");
      const now = Date.now(), ref = db.ref(`/orders/${o.id}`); let blocked = false;
      // The Admin SDK first calls a transaction with its cold local cache (null). Returning
      // null lets the server supply the real order; aborting there rejected every request.
      const changed = await ref.transaction((current) => {blocked = false; if (current == null) return null; if (current.preparationStatus !== "not_prepared" || current.correctionPending || current.completedOrderCorrectionId) {blocked = true; return;}return Object.assign({},current,{preparationStatus:"preparing",preparationStartedAt:now,preparationStartedBy:actor.uid,preparationStartedRole:actor.role});},undefined,false);
      if (!changed.committed || !changed.snapshot.exists()) {if (blocked || changed.committed) throw new HttpsError("aborted", "The order changed. Refresh before starting preparation.");throw new HttpsError("internal", "Preparation status could not be saved.");}
      const updated=Object.assign({id:o.id},changed.snapshot.val()||{});await db.ref().update({[`activeOrders/${o.id}`]:activeOrderProjection(updated),[`operationalAudit/${now}_start_preparation_${o.id}`]:{action:"start_instore_preparation",sourceType:"order",sourceId:o.id,shiftId:o.shiftId,actorUid:actor.uid,actorRole:actor.role,ts:now,schemaVersion:1}});return{duplicate:false,preparationStatus:"preparing"};
    }
    if (data.action === "cashier_verify_payment") {
      if (["grabfood", "foodpanda"].includes(String(o.channel || "").toLowerCase())) throw new HttpsError("failed-precondition", "Platform orders are settled through their platform payout.");
      if (["cashier_verified", "manager_validated", "confirmed"].includes(o.paymentStatus)) return {alreadyVerified: true, paymentStatus: o.paymentStatus};
      const payments = (Array.isArray(o.payments) && o.payments.length ? o.payments : [{method: o.payment, amount: o.total}]).map((row) => Object.assign({}, row));
      const direct = PaymentVerification.directPaymentRows(payments), posSettings = await readPosSettings(db, ["payMethods"]), verificationPolicy = PaymentVerification.paymentPolicy(payments, posSettings.payMethods);
      if (!direct.length) throw new HttpsError("failed-precondition", "This order has no direct GCash, Maya, or bank payment to verify.");
      if (verificationPolicy === PaymentVerification.MANAGER_ONLY) throw new HttpsError("permission-denied", "This payment method requires manager-only verification.");
      const suppliedRef = financeText(data.reference, 120); if (direct.length === 1 && !financeText(direct[0].ref, 120) && suppliedRef) direct[0].ref = suppliedRef;
      if (direct.some((row) => !financeText(row.ref, 120))) throw new HttpsError("invalid-argument", "Enter the transaction reference for every direct electronic payment.");
      const now = Date.now(), website = o.source === "online" || o.channel === "online", nextStatus = website && String(o.status || "Pending") === "Pending" ? "Confirmed" : String(o.status || "Pending");
      const verified = Object.assign({}, o, {payments, paymentStatus: "cashier_verified", paymentVerificationPolicy: verificationPolicy, cashierVerifiedAt: now, cashierVerifiedBy: actor.uid, cashierVerifiedRole: actor.role, cashierVerifiedAmount: Financial.money(direct.reduce((sum, row) => sum + Financial.money(row.amount), 0)), status: nextStatus});
      if (nextStatus !== o.status) { verified.statusUpdatedAt = now; verified.statusUpdatedBy = actor.uid; }
      const writes = {[`${found.node}/${o.id}`]: verified, [`activeOrders/${o.id}`]: activeOrderProjection(verified), [`operationalAudit/${now}_cashier_verify_${o.id}`]: {action: "cashier_verify_payment", sourceType: "order", sourceId: o.id, amount: verified.cashierVerifiedAmount, actorUid: actor.uid, actorRole: actor.role, ts: now, schemaVersion: 1}};
      if (verified.ownerUid) writes[`customerOrders/${verified.ownerUid}/${o.id}/status`] = nextStatus;
      // A sale already posted with this payment in 1060 moves it to the bank now.
      const receivingAccountId = await verifiedReceivingAccount(db, data), verifierCheck = await paymentVerifierCheck(db, o, actor.uid, actor.role);
      verified.paymentReceivingAccountId = receivingAccountId || null; verified.paymentSelfCheck = verifierCheck.selfCheck;
      await db.ref().update(writes); const accounts = (await db.ref("/cfAccounts").get()).val() || {}, taxSettings = (await db.ref("/taxSettings").get()).val() || {}, posted = await postOrderFinancial(db, verified, accounts, {uid: "server", role: "server"}, taxSettings);
      await settleVerifiedPayment(db, o.id, actor);
      return {verified: true, status: nextStatus, paymentStatus: "cashier_verified", financialPosted: !posted.skipped, duplicate: posted.duplicate === true};
    }
    if (data.action === "manager_validate_payment") {
      return withPaymentDecisionLock(db, o.id, actor, async () => {
      found = await findOrder(db, o.id); o = found.order;
      if (o.paymentStatus === "manager_validated" || o.paymentStatus === "confirmed") {await settleVerifiedPayment(db, o.id, actor);return {alreadyValidated: true};}
      const payments = (Array.isArray(o.payments) && o.payments.length ? o.payments : [{method: o.payment, amount: o.total}]).map((row) => Object.assign({}, row)), direct = PaymentVerification.directPaymentRows(payments), posSettings = await readPosSettings(db, ["payMethods"]), verificationPolicy = PaymentVerification.paymentPolicy(payments, posSettings.payMethods);
      if (!direct.length) throw new HttpsError("failed-precondition", "This order has no direct electronic payment to validate.");
      if (verificationPolicy === PaymentVerification.CASHIER_MANAGER && o.paymentStatus !== "cashier_verified") throw new HttpsError("failed-precondition", "Cashier verification is required before manager validation.");
      if (verificationPolicy === PaymentVerification.MANAGER_ONLY && !["pending", "cashier_verified"].includes(o.paymentStatus)) throw new HttpsError("failed-precondition", "This payment is not awaiting manager verification.");
      if (direct.some((row) => !financeText(row.ref, 120))) throw new HttpsError("invalid-argument", "Every direct electronic payment requires a transaction reference.");
      const directAmount = Financial.money(direct.reduce((sum, row) => sum + Financial.money(row.amount), 0));
      if (!(directAmount > 0)) throw new HttpsError("failed-precondition", "This order has no electronic payment awaiting validation.");
      const receivingAccountId = await verifiedReceivingAccount(db, data), pendingApproval = (await db.ref(`/financialApprovals/${financeKey(data.approvalId, "Privileged approval")}`).get()).val() || {};
      const verifierCheck = await paymentVerifierCheck(db, o, pendingApproval.approvedBy, pendingApproval.approvedRole);
      const approval = await claimManagerApproval(db, data, "validate_payment", o.id, directAmount, `validate_${o.id}`);
      // Only after the manager approval is claimed: a receipt the cashier's check already banked
      // moves back into 1060 (one idempotent Dr 1060 / Cr bank) under the approving manager's name.
      if (found.node === "orders" && o.paymentStatus === "cashier_verified" && Financial.money(o.refundAmount) <= 0) await prepareActivePaymentReview(db, o.id, {uid: approval.record.approvedBy, role: approval.record.approvedRole});
      const now = Date.now(), approvedBy = approval.record.approvedEmail || approval.record.approvedRole, website = o.source === "online" || o.channel === "online", nextStatus = website && String(o.status || "Pending") === "Pending" ? "Confirmed" : String(o.status || "Pending");
      const validated = Object.assign({}, o, {paymentReceivingAccountId: receivingAccountId || null, paymentSelfCheck: verifierCheck.selfCheck, payments, paymentStatus: "manager_validated", paymentVerificationPolicy: verificationPolicy, managerValidatedAt: now, managerValidatedBy: approval.record.approvedBy, managerValidatedRole: approval.record.approvedRole, managerValidatedName: approvedBy, paymentApprovalId: approval.id, status: nextStatus});
      if (nextStatus !== o.status) { validated.statusUpdatedAt = now; validated.statusUpdatedBy = actor.uid; }
      const activeShift = (await db.ref("/posActiveShift").get()).val() || null;
      const writes = Object.assign({}, approval.usedWrites, {[`${found.node}/${o.id}`]: validated, [`activeOrders/${o.id}`]: shouldProjectOrder(validated, activeShift, now) ? activeOrderProjection(validated) : null, [`operationalAudit/${now}_manager_validate_${o.id}`]: {action: "manager_validate_payment", sourceType: "order", sourceId: o.id, actorUid: actor.uid, actorRole: actor.role, approvedBy: approval.record.approvedBy, approvedRole: approval.record.approvedRole, approvalId: approval.id, ts: now, schemaVersion: 1}});
      if (validated.ownerUid) writes[`customerOrders/${validated.ownerUid}/${o.id}/status`] = nextStatus;
      await db.ref().update(writes); const accounts = (await db.ref("/cfAccounts").get()).val() || {}, taxSettings = (await db.ref("/taxSettings").get()).val() || {}, posted = await postOrderFinancial(db, validated, accounts, {uid: "server", role: "server"}, taxSettings);
      await settleVerifiedPayment(db, o.id, actor);
      return {validated: true, paymentStatus: "manager_validated", approvedBy, financialPosted: !posted.skipped, duplicate: posted.duplicate === true};
      });
    }
    if (data.action === "payment_not_received") {
      return withPaymentDecisionLock(db, o.id, actor, async () => {
      found = await findOrder(db, o.id); o = found.order;
      if (!Financial.recognizedSale(o) || !Financial.paymentAwaitingVerification(o)) throw new HttpsError("failed-precondition", "Only a completed sale whose payment is still awaiting verification can be recorded as not received.");
      if (Financial.money(o.refundAmount) > 0) throw new HttpsError("failed-precondition", "This manager-review sale already has a refund. Use a controlled financial correction so revenue, cash and the original refund are not reversed twice.");
      const reason = paymentNotReceivedReason(data);
      const pendingApproval = (await db.ref(`/financialApprovals/${financeKey(data.approvalId, "Privileged approval")}`).get()).val() || {};
      const verifierCheck = await paymentVerifierCheck(db, o, pendingApproval.approvedBy, pendingApproval.approvedRole);
      // A live cashier-verified sale whose receipt an older cashier step already banked moves back
      // into 1060 first (one idempotent Dr 1060 / Cr bank), exactly as manager validation does, so
      // "not received" never needs the retired "Move current reviews to 1060" batch (3 Nov 2026).
      // It runs only after the separation-of-duties check, so the sale's own crew cannot trigger it.
      // The approval must already be a live, unused not-received approval for this sale (its amount is
      // checked when it is claimed below), so a missing or spent approval moves no money.
      if (found.node === "orders" && o.paymentStatus === "cashier_verified" && String(o.paymentVerificationPolicy || "cashier_manager") === "cashier_manager") {
        if (pendingApproval.action !== "payment_not_received" || pendingApproval.sourceId !== String(o.id) || pendingApproval.usedAt || Number(pendingApproval.expiresAt || 0) < Date.now()) throw new HttpsError("failed-precondition", "Privileged approval is missing, expired, already used, or does not match this action.");
        await prepareActivePaymentReview(db, o.id, actor);
        found = await findOrder(db, o.id); o = found.order;
      }
      const state = await paymentVerificationOpenAmount(db, financeKey(o.id, "Order ID")), clearing = state.clearing;
      if (!(clearing > 0)) throw new HttpsError("failed-precondition", "This sale has no payment waiting in Payments Awaiting Verification. Post it to Finance Books first.");
      const approval = await claimManagerApproval(db, data, "payment_not_received", o.id, clearing, `not_received_${o.id}`), approvedBy = approval.record.approvedEmail || approval.record.approvedRole;
      const result = await commitUnpaidSale(db, found.node, o, clearing, reason, actor, {verifierUid: approval.record.approvedBy, verifierRole: approval.record.approvedRole, verifierName: approvedBy, approvalId: approval.id, selfCheck: verifierCheck.selfCheck, usedWrites: approval.usedWrites});
      return {orderId: o.id, notReceived: true, amount: clearing, duplicate: result && result.duplicate === true, approvedBy};
      });
    }
    if (data.action === "prepare_payment_review") {
      if (!["owner", "superadmin", "admin", "manager"].includes(actor.role)) throw new HttpsError("permission-denied", "Only managers may move a cashier-verified payment into manager review.");
      return withPaymentDecisionLock(db, o.id, actor, () => prepareActivePaymentReview(db, o.id, actor));
    }
    if (data.action === "record_rejection_refund") {
      // A website order rejected with "refund due" (Nov 2026). No sale was posted for it; the refund
      // due sits in 2030, and onOrderRejectionFinancial clears it when this records the refund paid.
      if (!["owner", "superadmin", "admin", "manager"].includes(actor.role)) throw new HttpsError("permission-denied", "Only a manager can record that a refund was paid.");
      const paidAlready = o.rejection && o.rejection.outcome === "refund_due" && o.rejection.refundStatus === "paid";
      if (paidAlready) return {orderId: o.id, duplicate: true};
      if (found.node !== "orders" || OrderService.rejectionState(o) !== "refund_owed") throw new HttpsError("failed-precondition", "This order has no refund owed.");
      const method = financeText(data.refundMethod, 40), reference = financeText(data.refundReference, 120);
      if (!method || !reference) throw new HttpsError("invalid-argument", "Enter how the refund was sent and its reference.");
      const now = Date.now(); let blocked = false;
      // Same cold-cache rule as start_instore_preparation: a null first pass is handed back.
      const changed = await db.ref(`/orders/${o.id}/rejection`).transaction((current) => {
        blocked = false;
        if (current == null) return null;
        if (current.refundStatus === "paid") return current;
        if (current.outcome !== "refund_due") { blocked = true; return; }
        return Object.assign({}, current, {refundStatus: "paid", refundPaidAt: now, refundPaidByUid: actor.uid, refundPaidByRole: actor.role, refundMethod: method, refundReference: reference});
      }, undefined, false);
      const rejection = changed.snapshot.val();
      if (blocked || !changed.committed || !rejection) throw new HttpsError("aborted", "The order changed. Refresh and try again.");
      if (rejection.refundPaidAt !== now) return {orderId: o.id, duplicate: true};
      const updated = Object.assign({}, o, {rejection}), activeShift = (await db.ref("/posActiveShift").get()).val() || null;
      await db.ref().update({
        [`activeOrders/${o.id}`]: shouldProjectOrder(updated, activeShift) ? activeOrderProjection(updated) : null,
        [`operationalAudit/${now}_rejection_refund_${o.id}`]: operationalAuditRecord("record_rejection_refund", "order", o.id, actor, {amount: Financial.money(rejection.refundAmount), method, reference, accounting: "Clears 2030 Customer Change / Refund Payable (posted by onOrderRejectionFinancial)."}),
      });
      return {orderId: o.id, refunded: true, amount: Financial.money(rejection.refundAmount)};
    }
    if (data.action === "recognize_unverified_sale") return recognizeUnverifiedSale(db, found, actor);
    if (data.action === "settle_verified_payment") {
      if (!["owner", "superadmin", "admin", "manager"].includes(actor.role)) throw new HttpsError("permission-denied", "Only managers may finish a payment verification.");
      const settled = await settleVerifiedPayment(db, o.id, actor);
      return {orderId: o.id, settled: !!settled && !settled.duplicate, duplicate: !!(settled && settled.duplicate), nothingToSettle: !settled};
    }
    if (data.action === "complete_order_item_correction") {
      const requestId=correctionRequestKey(data.requestId),commandRef=db.ref(`/orderCorrectionCommands/${requestId}`),existingCommand=(await commandRef.get()).val();
      if(existingCommand&&existingCommand.status==="posted"){if(existingCommand.orderId!==o.id)throw new HttpsError("already-exists","This correction request belongs to another order.");return{duplicate:true,correctionId:existingCommand.correctionId,refundAmount:Number(existingCommand.refundAmount)||0,correctedOrderTotal:Number(existingCommand.correctedOrderTotal)||0};}
      if(found.node!=="orders"||o.source!=="pos"||String(o.channel||"instore").toLowerCase()!=="instore"||o.status!=="Completed")throw new HttpsError("failed-precondition","Only a current completed in-store POS sale can be corrected here.");
      if(o.preparationStatus!=="not_prepared"||o.preparationStartedAt)throw new HttpsError("failed-precondition","This order has already entered preparation and can no longer be changed.");
      if(o.completedOrderCorrectionId||(o.correctionPending&&o.correctionPending!==requestId)||Financial.money(o.refundAmount)>0)throw new HttpsError("failed-precondition","This order was already corrected or refunded.");
      if(Financial.money(o.discount)>0||Financial.money(o.loyaltyDiscount)>0||(Array.isArray(o.packages)&&o.packages.length))throw new HttpsError("failed-precondition","Discounted or packaged sales require the manager correction workflow.");
      const payments=Array.isArray(o.payments)&&o.payments.length?o.payments:[{method:o.payment,amount:o.total}],payment=payments[0]||{};
      if(!["cashier_verified","manager_validated","confirmed"].includes(String(o.paymentStatus||""))||!financeText(payment.ref,120))throw new HttpsError("failed-precondition","The electronic payment must remain verified with its transaction reference.");
      if(Math.abs(Financial.money(payment.amount)-Financial.money(o.total))>.009)throw new HttpsError("failed-precondition","The original payment must exactly match the posted sale before item correction.");
      if(o.inventoryDeducted!==true)throw new HttpsError("failed-precondition","Wait for the original sale inventory posting to finish, then retry.");
      if(Object.keys(o.costCorrections||{}).length)throw new HttpsError("failed-precondition","A manager already posted the missing recipe cost for this sale. Use manager review; no stock was changed.");
      const active=(await db.ref("/posActiveShift").get()).val()||null;if(!active||active.id!==o.shiftId||active.status==="closed")throw new HttpsError("failed-precondition","This order is not in the currently open shift.");
      const reason=financeText(data.reason,300),acknowledgement=financeText(data.customerAcknowledgement,160);if(!reason||!acknowledgement)throw new HttpsError("invalid-argument","Reason and customer acknowledgement are required.");
      const [availabilitySnap,oldPlanSnap,posSettings,accountsSnap,taxSettingsSnap]=await Promise.all([db.ref("/availability").get(),db.ref(`/orderInventoryPlans/${o.id}`).get(),readPosSettings(db,["denomTracking"]),db.ref("/cfAccounts").get(),db.ref("/taxSettings").get()]);
      const paymentKind=OrderCorrection.paymentKind(o,accountsSnap.val()||{});if(!paymentKind)throw new HttpsError("failed-precondition","Completed-order changes require one verified bank or configured e-wallet payment.");
      const oldPlan=oldPlanSnap.val();if(!UncostedSales.validPlan(oldPlan))throw new HttpsError("failed-precondition","The original immutable inventory plan is missing. Use manager review; no stock was changed.");
      const priced=await readCatalogKeyed(db,["menuItems","optionGroups","packages"],(maps)=>priceOrderLinesServer(data.lineItems,maps.menuItems,maps.optionGroups,availabilitySnap.val()||{},maps.packages)),correctionTax=Financial.effectiveTaxFor(taxSettingsSnap.val()||{},Number(o.completedAt||o.timestamp||Date.now())),expected=Financial.money(data.expectedTotal),originalTotal=Financial.money(o.total);
      // Tax-exclusive original sale: the corrected order carries the same add-on the
      // original was charged (original regime via the effective-date wall), so the cash
      // refund includes the tax on removed items and matches the POS cart's math.
      let correctedTotal=Financial.money(priced.total);if(correctionTax&&correctionTax.inclusive===false&&correctedTotal>0)correctedTotal=Financial.money(correctedTotal+Math.round(correctedTotal*correctionTax.rate)/100);
      if(!(correctedTotal>0)||correctedTotal>originalTotal+.009)throw new HttpsError("invalid-argument","The corrected order must be greater than zero and cannot exceed the original paid total.");
      if(Math.abs(expected-correctedTotal)>.009)throw new HttpsError("failed-precondition",`Current menu pricing makes the corrected order PHP ${correctedTotal.toFixed(2)}. Refresh and review it.`);
      const itemSignature=(rows)=>JSON.stringify((rows||[]).map((line)=>[line.itemKey,line.size||"",line.optLabels||[],Number(line.qty)||0]));
      if(itemSignature(priced.lines)===itemSignature(OrderCorrection.currentLines(o)))throw new HttpsError("invalid-argument","Change at least one coffee item before completing the correction.");
      const refund=Financial.money(originalTotal-correctedTotal),now=Date.now(),token=crypto.createHash("sha256").update(`${o.id}|${requestId}`).digest("hex").slice(0,16),correctionId=`COR-${o.id}-${token.slice(0,8)}`;
      const drawerDelta=OfflineSync.offlineDrawerDelta(data.drawerDelta),settings=posSettings,shiftRow=(await db.ref(`/shifts/${o.shiftId}`).get()).val()||{};
      if(Object.values(drawerDelta).some((qty)=>qty>0))throw new HttpsError("invalid-argument","A completed-order refund cannot add cash to the drawer.");
      if(!settings.denomTracking&&Object.keys(drawerDelta).length)throw new HttpsError("invalid-argument","Drawer denominations are disabled for this shift.");
      if(settings.denomTracking&&Math.abs(OfflineSync.drawerDeltaValue(drawerDelta)+refund)>.009)throw new HttpsError("invalid-argument","Cash refund denominations must equal the calculated refund.");
      if(settings.denomTracking)for(const key of Object.keys(drawerDelta))if(-Number(drawerDelta[key]||0)>Number((shiftRow.drawer||{})[key]||0))throw new HttpsError("failed-precondition","The drawer no longer has the selected refund denominations.");
      if(refund>0){const cash=await availableCashOnHandAboveFloat(db);if(refund>cash.available+.009)throw new HttpsError("failed-precondition",`Refund exceeds register cash available above the protected float by ${Financial.money(refund-cash.available).toFixed(2)}.`);}
      const plan=await calculateOrderInventoryPlan(db,{lineItems:priced.lines},now);
      const approvalOperation=`completed_order_correction_${o.id}_${requestId}`,correctionApproval=await claimManagerApproval(db,data,"correct_completed_order",o.id,originalTotal,approvalOperation,actor.uid),refundApproval=refund>0?await claimManagerApproval(db,{approvalId:data.refundApprovalId},"completed_order_cash_refund",o.id,refund,`${approvalOperation}_cash_refund`,actor.uid):null,approvedBy=correctionApproval.record.approvedName||correctionApproval.record.approvedEmail||correctionApproval.record.approvedRole;
      const claim=await commandRef.transaction((current)=>{if(current)return current;return{status:"processing",orderId:o.id,correctionId,claimedAt:now,actorUid:actor.uid,schemaVersion:1};},undefined,false),claimValue=claim.snapshot.val()||{};
      if(!claim.committed||claimValue.orderId!==o.id){if(claimValue.status==="posted")return{duplicate:true,correctionId:claimValue.correctionId,refundAmount:Number(claimValue.refundAmount)||0,correctedOrderTotal:Number(claimValue.correctedOrderTotal)||0};throw new HttpsError("aborted","This correction request is already being processed.");}
      const locked=await db.ref(`/orders/${o.id}`).transaction((current)=>{if(current==null)return null;if(current.archivePending||current.preparationStatus!=="not_prepared"||current.preparationStartedAt||current.completedOrderCorrectionId||(current.correctionPending&&current.correctionPending!==requestId))return;return Object.assign({},current,{correctionPending:requestId,correctionPendingAt:now});},undefined,false);
      if(!locked.committed||!locked.snapshot.exists()){await commandRef.transaction((current)=>current&&current.status==="processing"?null:current,undefined,false);throw new HttpsError("aborted","The order changed or preparation started. Refresh before trying again.");}
      if(refund>0){const shifted=await db.ref(`/shifts/${o.shiftId}`).transaction((row)=>OfflineSync.applyDrawerDelta(row,requestId,drawerDelta,now,actor),undefined,false);if(!shifted.committed||!shifted.snapshot.exists())throw new HttpsError("failed-precondition","The order's shift is closed or missing, so the refund cannot come from its drawer.");await db.ref("/posActiveShift").transaction((row)=>row&&row.id===o.shiftId?OfflineSync.applyDrawerDelta(row,requestId,drawerDelta,now,actor):row,undefined,false);}
      await applyCompletedOrderCorrectionInventory(db,o,plan,token,now,actor);
      const initiatedByStaff=financeText(active.staff,100),correctedMeta=correctionPlanMetadata(plan,now),updated=Object.assign({},o,{correctedOrderId:correctionId,completedOrderCorrectionId:correctionId,correctedOrderTotal:correctedTotal,correctedLineItems:priced.lines,correctedItems:correctionItemText(priced.lines),correctedPackages:priced.packages,correctedExtraCost:priced.extraCost,correctedAt:now,correctedBy:actor.uid,correctionInitiatedByStaff:initiatedByStaff,correctionReason:reason,correctionCustomerAcknowledgement:acknowledgement,correctionApprovalId:correctionApproval.id,correctionApprovedBy:approvedBy,correctionApprovedByUid:correctionApproval.record.approvedBy,correctionApprovedRole:correctionApproval.record.approvedRole,correctionReviewStatus:"manager_approved",preparationStatus:"not_prepared",refundAmount:refund,refundPayments:refund>0?Object.assign({},o.refundPayments||{},{Cash:refund}):(o.refundPayments||{}),refunded:refund>0,refundedAt:refund>0?now:(o.refundedAt||null),refundedBy:refund>0?actor.uid:(o.refundedBy||""),refundReason:refund>0?reason:(o.refundReason||""),cashRefundApprovalId:refundApproval?refundApproval.id:(o.cashRefundApprovalId||""),cashRefundApprovedBy:refundApproval?(refundApproval.record.approvedName||refundApproval.record.approvedEmail||refundApproval.record.approvedRole):(o.cashRefundApprovedBy||""),cashRefundApprovedByUid:refundApproval?refundApproval.record.approvedBy:(o.cashRefundApprovedByUid||""),cashRefundReviewStatus:refund>0?"manager_approved":(o.cashRefundReviewStatus||""),cashRefundShiftId:refund>0?o.shiftId:(o.cashRefundShiftId||""),correctedInventoryUsage:correctedMeta.inventoryUsage,correctionInventoryToken:token,correctedCogsSnapshot:correctedMeta.cogsSnapshot,correctedCogsCategorySnapshot:correctedMeta.cogsCategorySnapshot,correctedCogsAccountSnapshot:correctedMeta.cogsAccountSnapshot,correctedCogsCovered:correctedMeta.cogsCovered,correctionPending:null});
      const correctedUncosted=Array.isArray(plan.uncostedLines)?plan.uncostedLines:[],uncostedVariant=`cor_${token.slice(0,8)}`;updated.costPendingLines=correctedUncosted.length||null;
      if(refund>0)updated.refundHistory=Object.assign({},o.refundHistory||{},{[`refund_${o.id}_${Math.round(refund*100)}`]:{amount:refund,payments:[{method:"Cash",amount:refund}],reason,at:now,by:actor.uid,actorRole:actor.role,approvalMode:"independent_manager",approvalId:refundApproval.id,approvedBy:refundApproval.record.approvedBy,reviewStatus:"manager_approved",shiftId:o.shiftId,correctedOrderTotal:correctedTotal,customerAcknowledgement:acknowledgement,orderStage:"completed_not_prepared",inventoryOutcome:"original_reversed_corrected_deducted"}});
      const correctionRecord={id:correctionId,orderId:o.id,shiftId:o.shiftId,status:"completed",paymentKind,originalPaymentReference:financeText(payment.ref,120),originalTotal,correctedOrderTotal:correctedTotal,refundAmount:refund,originalLineItems:o.lineItems||[],correctedLineItems:priced.lines,originalInventoryPlanId:o.id,correctedInventoryPlan:plan,reason,customerAcknowledgement:acknowledgement,preparationStatus:"not_prepared",approvalId:correctionApproval.id,approvedBy,approvedByUid:correctionApproval.record.approvedBy,approvedRole:correctionApproval.record.approvedRole,cashRefundApprovalId:refundApproval?refundApproval.id:"",createdAt:now,createdBy:actor.uid,createdByRole:actor.role,initiatedByStaff,reviewStatus:"manager_approved",schemaVersion:1};
      const movementOrder=Object.assign({},o,{cogsAccountSnapshot:o.cogsAccountSnapshot||oldPlan.accountSnapshot||{}}),movement=OrderCorrection.movement(movementOrder,plan,refund,accountsSnap.val()||{},Financial.effectiveTaxFor(taxSettingsSnap.val()||{},Number(o.completedAt||o.timestamp||Date.now()))),movementId=refund>0?`refund_${o.id}_${Math.round(refund*100)}`:`correction_${o.id}_${token}`,writes=Object.assign({},correctionApproval.usedWrites,refundApproval?refundApproval.usedWrites:{},{[`orders/${o.id}`]:updated,[`activeOrders/${o.id}`]:activeOrderProjection(updated),[`orderCorrections/${correctionId}`]:correctionRecord,[`orderCorrectionCommands/${requestId}`]:{status:"posted",orderId:o.id,correctionId,refundAmount:refund,correctedOrderTotal:correctedTotal,movementId:movement?movementId:"",approvalId:correctionApproval.id,cashRefundApprovalId:refundApproval?refundApproval.id:"",claimedAt:now,postedAt:Date.now(),actorUid:actor.uid,schemaVersion:1},[`operationalAudit/${now}_completed_order_correction_${o.id}`]:{action:"complete_order_item_correction",sourceType:"order",sourceId:o.id,correctionId,movementId:movement?movementId:"",paymentKind,originalTotal,correctedOrderTotal:correctedTotal,refundAmount:refund,customerAcknowledgement:acknowledgement,inventoryOutcome:"original_reversed_corrected_deducted",approvalId:correctionApproval.id,approvedByUid:correctionApproval.record.approvedBy,approvedRole:correctionApproval.record.approvedRole,cashRefundApprovalId:refundApproval?refundApproval.id:"",shiftId:o.shiftId,initiatedByStaff,actorUid:actor.uid,actorRole:actor.role,ts:now,schemaVersion:1}});
      if(movement){movement.occurredAt=now;movement.actorName=actor.role;movement.correctionId=correctionId;movement.approvalId=correctionApproval.id;movement.approvedBy=approvedBy;if(refundApproval)movement.cashRefundApprovalId=refundApproval.id;movement.controlReason="Completed in-store order changed with independent manager approval; original electronic receipt retained, item usage replaced, and any approved difference returned from register cash.";addOrderCashWrites(writes,movement,movementId,o,actor);await commitFinancial(db,movementId,movement,actor,writes);}else await db.ref().update(writes);
      // Flags follow the corrected lines: the old lines' flags close, the new ones open.
      await supersedeUncostedSale(db,o.id,uncostedVariant);if(correctedUncosted.length)await registerUncostedSale(db,o.id,Object.assign({},o,{completedAt:now}),correctedUncosted,uncostedVariant);
      return{duplicate:false,correctionId,refundAmount:refund,correctedOrderTotal:correctedTotal,movementId:movement?movementId:""};
    }
    if (o.unpaidSale && ["refund", "void", "cash_order_change_refund"].includes(data.action)) throw new HttpsError("failed-precondition", "This sale was already reversed because its payment was not received.");
    if (Financial.paymentAwaitingVerification(o) && ["refund", "cash_order_change_refund"].includes(data.action)) throw new HttpsError("failed-precondition", "Verify this payment first. A sale whose e-payment has not been verified cannot be refunded — verify it, or record it as not received.");
    const reason = financeText(data.reason, 300); if (!reason) throw new HttpsError("invalid-argument", "Reason is required."); const accounts = (await db.ref("/cfAccounts").get()).val() || {}, taxSettings = (await db.ref("/taxSettings").get()).val() || {}; await postOrderFinancial(db, o, accounts, {uid: "server", role: "server"}, taxSettings);
    const now = Date.now(), writes = {}, saleTax = Financial.effectiveTaxFor(taxSettings, Number(o.completedAt||o.receivedAt||o.timestamp||Date.now())); let movementId, movement;
    if (data.action === "cash_order_change_refund") {
      if (["grabfood", "foodpanda"].includes(String(o.channel || "").toLowerCase())) throw new HttpsError("failed-precondition", "Platform orders must be corrected through platform settlement.");
      if (String(o.channel || "instore").toLowerCase() !== "instore") throw new HttpsError("failed-precondition", "This cashier cash-refund workflow is for in-store orders only.");
      if (o.voided) throw new HttpsError("failed-precondition", "A voided order cannot receive another refund.");
      if (!["cashier_verified", "manager_validated", "confirmed"].includes(String(o.paymentStatus || ""))) throw new HttpsError("failed-precondition", "Verify the electronic payment before returning cash.");
      const original = (Array.isArray(o.payments) && o.payments.length ? o.payments : [{method:o.payment || "", amount:o.total}]), direct = PaymentVerification.directPaymentRows(original);
      if (!direct.length || original.some((row) => String(row && row.method || "").trim().toLowerCase() === "cash")) throw new HttpsError("failed-precondition", "Cashier order-change refunds are only for orders paid fully by GCash, Maya, or bank transfer.");
      if (direct.some((row) => !financeText(row.ref, 120))) throw new HttpsError("failed-precondition", "The verified electronic payment must keep its transaction reference.");
      const activeShift = (await db.ref("/posActiveShift").get()).val() || null;
      if (!activeShift || !activeShift.id || activeShift.status === "closed") throw new HttpsError("failed-precondition", "Open a POS shift before returning cash.");
      if (!o.shiftId || o.shiftId !== activeShift.id) throw new HttpsError("failed-precondition", "This order is not captured in the currently open shift. Use the controlled manager refund workflow for an earlier shift.");
      const originalTotal = Financial.money(o.total), already = Financial.money(o.refundAmount), currentNet = Financial.money(Math.max(0, originalTotal - already)), correctedTotal = Financial.money(data.correctedTotal);
      if (correctedTotal < 0 || correctedTotal >= currentNet - 0.009) throw new HttpsError("invalid-argument", "Corrected total must be lower than the order's current net total.");
      const delta = Financial.money(currentNet - correctedTotal), cumulative = Financial.money(already + delta), acknowledgement = financeText(data.customerAcknowledgement, 160), inventoryOutcome = financeText(data.inventoryOutcome, 80), effectiveStatus = o.status === "Archived" ? o.prevStatus : o.status, processed = ["Completed", "Received"].includes(String(effectiveStatus || ""));
      if (!acknowledgement) throw new HttpsError("invalid-argument", "Customer acknowledgement is required before cash is released.");
      if (processed && !inventoryOutcome) throw new HttpsError("invalid-argument", "Record what happened to the prepared or issued items.");
      const cash = await availableCashOnHandAboveFloat(db); if (delta > cash.available + 0.009) throw new HttpsError("failed-precondition", `Refund exceeds register cash available above the protected float by ${Financial.money(delta-cash.available).toFixed(2)}.`);
      const lockRef=db.ref(`/orderCashRefundLocks/${o.id}`),lockToken=crypto.randomBytes(12).toString("hex"),lock=await lockRef.transaction((current)=>{if(!current||Number(current.claimedAt||0)<now-60000)return{token:lockToken,claimedAt:now,actorUid:actor.uid};return;},undefined,false);
      if(!lock.committed)throw new HttpsError("aborted","Another refund is being processed for this order. Refresh before trying again.");
      const latest=(await db.ref(`/${found.node}/${o.id}`).get()).val()||{};
      if(Financial.money(latest.refundAmount)!==already){await lockRef.transaction((current)=>current&&current.token===lockToken?null:current,undefined,false);throw new HttpsError("aborted","The refundable balance changed. Refresh the order before trying again.");}
      movementId = `refund_${o.id}_${Math.round(cumulative * 100)}`;
      movement = Financial.reversalPosting(o, delta, "refund", accounts, [{method:"Cash", amount:delta}], saleTax);
      movement.controlReason = "Customer order changed after verified electronic payment; cashier returned the system-calculated difference from the current register.";
      movement.refundShiftId = activeShift.id; movement.originalPaymentMethods = direct.map((row) => financeText(row.method, 60)); movement.correctedOrderTotal = correctedTotal;
      const prior = o.refundPayments || {}, nextRefundPayments = Object.assign({}, prior, {Cash:Financial.money(Number(prior.Cash || 0) + delta)});
      writes[`${found.node}/${o.id}/refundAmount`] = cumulative; writes[`${found.node}/${o.id}/refundPayments`] = nextRefundPayments;
      writes[`${found.node}/${o.id}/refundHistory/${movementId}`] = {amount:delta,payments:[{method:"Cash",amount:delta}],reason,at:now,by:actor.uid,actorRole:actor.role,approvalMode:"cashier_preauthorized",reviewStatus:"pending_shift_review",shiftId:activeShift.id,correctedOrderTotal:correctedTotal,customerAcknowledgement:acknowledgement,orderStage:processed?"processed":"not_processed",inventoryOutcome:processed?inventoryOutcome:"not_yet_deducted"};
      writes[`${found.node}/${o.id}/correctedOrderTotal`] = correctedTotal; writes[`${found.node}/${o.id}/orderChangeReason`] = reason; writes[`${found.node}/${o.id}/orderChangeInventoryOutcome`] = processed?inventoryOutcome:"not_yet_deducted"; writes[`${found.node}/${o.id}/refundReason`] = reason; writes[`${found.node}/${o.id}/refundedAt`] = now; writes[`${found.node}/${o.id}/refundedBy`] = actor.uid; writes[`${found.node}/${o.id}/refunded`] = true; writes[`${found.node}/${o.id}/cashRefundReviewStatus`] = "pending_shift_review"; writes[`${found.node}/${o.id}/cashRefundShiftId`] = activeShift.id;
      writes[`orderCashRefundLocks/${o.id}`]=null;
      writes[`operationalAudit/${now}_cash_order_change_refund_${o.id}`] = {action:"cash_order_change_refund",sourceType:"order",sourceId:o.id,movementId,amount:delta,originalTotal,currentNetBefore:currentNet,correctedOrderTotal:correctedTotal,originalPaymentMethods:movement.originalPaymentMethods,customerAcknowledgement:acknowledgement,orderStage:processed?"processed":"not_processed",inventoryOutcome:processed?inventoryOutcome:"not_yet_deducted",shiftId:activeShift.id,actorUid:actor.uid,actorRole:actor.role,ts:now,schemaVersion:1};
    }
    else if (data.action === "refund") { const delta = Financial.money(data.amount), already = Financial.money(o.refundAmount), max = Financial.money(o.total); if (!(delta > 0) || already + delta > max + 0.009) throw new HttpsError("invalid-argument", "Refund exceeds the refundable amount."); const cumulative = Financial.money(already + delta), original = (Array.isArray(o.payments)&&o.payments.length?o.payments:[{method:o.payment||"Cash",amount:o.total}]), prior = o.refundPayments || {}, tender = Array.isArray(data.refundPayments)?data.refundPayments.map((row) => ({method:financeText(row.method,60),amount:Financial.money(row.amount)})).filter((row) => row.method&&row.amount>0):[]; if (String(o.channel||"instore").toLowerCase() === "instore") {if (Math.abs(tender.reduce((s,row)=>Financial.money(s+row.amount),0)-delta)>0.009) throw new HttpsError("invalid-argument","Refund tender allocations must equal the refund amount."); const allowed={}; original.forEach((row)=>{allowed[row.method]=Financial.money((allowed[row.method]||0)+Financial.money(row.amount));}); tender.forEach((row)=>{if (!allowed[row.method] || Financial.money((prior[row.method]||0)+row.amount)>allowed[row.method]+0.009) throw new HttpsError("invalid-argument",`Refund through ${row.method} exceeds the original payment.`);});} movementId = `refund_${o.id}_${Math.round(cumulative * 100)}`; const approval = await claimManagerApproval(db, data, "refund", o.id, delta, movementId); movement = Financial.reversalPosting(o, delta, "refund", accounts, tender, saleTax); Object.assign(writes, approval.usedWrites); const nextRefundPayments=Object.assign({},prior);tender.forEach((row)=>{nextRefundPayments[row.method]=Financial.money((nextRefundPayments[row.method]||0)+row.amount);}); writes[`${found.node}/${o.id}/refundAmount`] = cumulative; writes[`${found.node}/${o.id}/refundPayments`] = nextRefundPayments; writes[`${found.node}/${o.id}/refundHistory/${movementId}`] = {amount:delta,payments:tender,reason,at:now,by:actor.uid,approvalId:approval.id,approvedBy:approval.record.approvedEmail||approval.record.approvedRole}; writes[`${found.node}/${o.id}/refundReason`] = reason; writes[`${found.node}/${o.id}/refundedAt`] = now; writes[`${found.node}/${o.id}/refundedBy`] = actor.uid; writes[`${found.node}/${o.id}/refunded`] = true; }
    else if (data.action === "void") { if (o.voided) throw new HttpsError("already-exists", "Order is already voided."); const value = Financial.money(Math.max(0, Financial.money(o.total) - Financial.money(o.refundAmount))),originalDate=financeDateFromTimestamp(o.completedAt||o.receivedAt||o.timestamp||now),voidDate=originalDate; if (!(value > 0)) throw new HttpsError("failed-precondition", "Nothing remains to void.");if(data.accountingDate!=null&&data.accountingDate!==""&&financeDate(data.accountingDate)!==originalDate)throw new HttpsError("invalid-argument",`A void posts on the original sale date (${originalDate}) so Finance Books and Admin agree. Refresh the page and void again.`);const earlierDay=originalDate!==financeDateFromTimestamp(now);if(String(o.channel||"instore").toLowerCase()==="instore"&&earlierDay)throw new HttpsError("failed-precondition",`This in-store sale is from ${originalDate}. Its cash was counted in that day's shift, so use Refund instead of Void.`);data.accountingDate=voidDate;{const period=AccountingPeriods.periodForDate(voidDate);if(AccountingPeriods.isClosed((await db.ref(`/accountingPeriods/${period}`).get()).val()))throw new HttpsError("failed-precondition",`${period} is closed, so this sale cannot be voided on its sale date (${originalDate}). Use Refund instead; a refund posts today.`);}await assertAccountingPeriodOpen(db,voidDate,"voiding this completed sale"); movementId = `void_${o.id}`; const approval = await claimManagerApproval(db, data, "void", o.id, value, movementId, null, reversalApprovalFingerprint("void",o.id,{accountingDate:voidDate,amount:value,reason})), original=(Array.isArray(o.payments)&&o.payments.length?o.payments:[{method:o.payment||"Cash",amount:o.total}]), prior=o.refundPayments||{}, tender=[]; if (String(o.channel||"instore").toLowerCase()==="instore") {let rem=value; original.forEach((row)=>{const available=Financial.money(Math.max(0,Financial.money(row.amount)-Financial.money(prior[row.method]))),use=Financial.money(Math.min(rem,available));if(use>0){tender.push({method:row.method,amount:use});rem=Financial.money(rem-use);}});if(rem>0.009)throw new HttpsError("failed-precondition","Original payment allocation cannot support the void reversal.");} movement = await fullOrderVoidMovement(db, o, accounts, tender, taxSettings); if (!movement) throw new HttpsError("failed-precondition", "The void has no remaining financial balance to reverse."); if (earlierDay && (movement.lines||[]).some((line)=>/^asset:(register_cash|cash)/.test(String(line&&line.account||"")))) throw new HttpsError("failed-precondition", `This sale is from ${originalDate} and voiding it would return money today, so use Refund instead of Void.`); Object.assign(writes, approval.usedWrites); writes[`${found.node}/${o.id}/voided`] = true; writes[`${found.node}/${o.id}/voidPayments`] = tender; writes[`${found.node}/${o.id}/voidApprovalId`] = approval.id; writes[`${found.node}/${o.id}/voidApprovedBy`] = approval.record.approvedEmail||approval.record.approvedRole; writes[`${found.node}/${o.id}/voidReason`] = reason; writes[`${found.node}/${o.id}/voidedAt`] = now; writes[`${found.node}/${o.id}/voidAccountingDate`] = voidDate; writes[`${found.node}/${o.id}/voidedBy`] = actor.uid; }
    else throw new HttpsError("invalid-argument", "Adjustment action is invalid.");
    if (data.action === "void") writes[`paymentVerificationQueue/${o.id}`] = null;
    if (data.restock === true) {writes[`${found.node}/${o.id}/inventoryReversalRequested`] = true; writes[`${found.node}/${o.id}/inventoryReversalReason`] = reason;}
    movement.occurredAt = data.action === "void" ? (Date.parse(`${financeDate(data.accountingDate)}T00:00:00+08:00`) || now) : now; movement.actorName = actor.role; if (data.approvalId) movement.approvalId=financeText(data.approvalId,160); addOrderCashWrites(writes, movement, movementId, o, actor); const committed = await commitFinancial(db, movementId, movement, actor, writes); return {movementId, duplicate: committed.duplicate, amount:movement.amount, correctedOrderTotal:movement.correctedOrderTotal, refundShiftId:movement.refundShiftId};
  },
);

// Refund-due rejections in the books (Danilo, 3 Nov 2026: keep it Xero-simple). Rejecting a paid
// website order with "refund due" records the customer's money in the account it came in to and
// owes it back through 2030 Customer Change / Refund Payable (an open customer payable, so the
// daily-close control still reconciles 2030). Recording the refund paid clears 2030 from the
// account it was sent from. Reopening an unpaid refund-due order reverses the entry so the later
// sale posts once. The trigger acts on the order's current rejection, not on the event alone, so a
// late or retried event cannot post for a rejection that has since been reopened. Every movement
// id is fixed by the rejection's own timestamp, so redelivery posts nothing twice.
function rejectionKeys(orderId, rejection) {
  const id = financeKey(orderId, "Order ID"), at = Number(rejection && rejection.at) || 0;
  return {id, at, payableId: `rejection_refund_${id}_${at}`, dueId: `rejection_due_${id}_${at}`, paidId: `rejection_paid_${id}_${at}`, reversalId: `rejection_due_reversal_${id}_${at}`};
}
function sameRefundDue(a, b) { return !!(a && b && a.outcome === "refund_due" && b.outcome === "refund_due" && Number(a.at) === Number(b.at)); }
async function rejectionPostingTime(db, at) { return at && await periodOpenFor(db, at) ? at : Date.now(); }
function rejectionCashRows(writes, prefix, sources, dir, category, order, movementId, movement, actor, date) {
  sources.forEach((row, index) => {if (row.accountId) writes[`cfLedger/${prefix}_${index}`] = cashLedgerRecord({date, accountId: row.accountId, dir, category, amount: row.amount, party: order.name || "Online customer", ref: order.id, method: row.method, auto: true}, movementId, movement, actor);});
}
async function postRejectionRefundDue(db, order, rejection, actor) {
  const k = rejectionKeys(order.id, rejection);
  if ((await db.ref(`/financialMovements/${k.dueId}`).get()).exists()) return {duplicate: true};
  if ((await db.ref(`/financialMovements/${k.reversalId}`).get()).exists()) return {skipped: true};
  const accounts = (await db.ref("/cfAccounts").get()).val() || {}, amount = Financial.money(rejection.refundAmount != null ? rejection.refundAmount : order.total);
  const due = Financial.rejectionRefundDuePosting(order, k.payableId, amount, accounts);
  const occurredAt = await rejectionPostingTime(db, k.at), date = financeDateFromTimestamp(occurredAt);
  const movement = Financial.movement("customer_refund_due", "order_rejection", k.id, due.lines, {occurredAt, actorName: financeText(rejection.byRole || "Orders", 60), reference: k.id, amount, payableId: k.payableId, refundSources: due.sources, controlReason: "Website order rejected: refund due to customer"});
  const writes = {[`payables/${k.payableId}`]: {party: financeText(order.name || "Online customer", 120), type: "customer_change_refund", amount, remainingAmount: amount, paidAmount: 0, date, ref: k.id, status: "open", movementId: k.dueId, liabilityAccount: due.liability, sourceType: "order_rejection", sourceId: k.id, reason: "Website order rejected: refund due", ts: Date.now(), createdBy: financeText(rejection.byUid || actor.uid, 160), schemaVersion: 2}};
  rejectionCashRows(writes, `rejdue_${k.id}_${k.at}`, due.sources, "in", "Rejected order · refund due", order, k.dueId, movement, actor, date);
  return commitFinancial(db, k.dueId, movement, actor, writes);
}
async function postRejectionRefundPaid(db, order, rejection, actor) {
  const k = rejectionKeys(order.id, rejection);
  if ((await db.ref(`/financialMovements/${k.paidId}`).get()).exists()) return {duplicate: true};
  const original = (await db.ref(`/financialMovements/${k.dueId}`).get()).val(), payable = (await db.ref(`/payables/${k.payableId}`).get()).val();
  if (!original) throw new Error(`Refund due for rejected order ${k.id} is not posted yet.`);
  // Already paid through Cash Payments, or closed in Books: nothing is left to clear here.
  if (!payable || payable.status !== "open") return {skipped: true};
  const amount = Financial.money(original.amount), remaining = Financial.money(payable.remainingAmount != null ? payable.remainingAmount : payable.amount);
  if (Math.abs(remaining - amount) > .009) {logger.warn("Rejection refund partly paid elsewhere; remainder left open", {orderId: k.id, remaining}); return {skipped: true};}
  if (!(await claimRejectionPayable(db, k, k.paidId, amount))) return {skipped: true};
  // The refund clears what the receipt actually debited, unless staff sent it by another method that maps to an account.
  const accounts = (await db.ref("/cfAccounts").get()).val() || {}, method = financeText(rejection.refundMethod, 40), reference = financeText(rejection.refundReference, 120);
  const recorded = Array.isArray(original.refundSources) && original.refundSources.length ? original.refundSources : (original.lines || []).filter((row) => Number(row.debit) > 0).map((row) => ({account: row.account, accountId: String(row.account || "").indexOf("asset:cash_account:") === 0 ? String(row.account).split(":")[2] : "", amount: Financial.money(row.debit), method: ""}));
  // Same method: the account the receipt used. Another method: its mapped account, or review
  // (unmapped) when nothing maps, never a silent credit to the wallet the money came in to.
  const sources = recorded.map((row) => {const same = !method || (row.method && Financial.methodKey(row.method) === Financial.methodKey(method)); if (same) return row; const other = Financial.accountForMethod(method, accounts); return other ? Object.assign({}, row, {accountId: other, account: `asset:cash_account:${other}`, method}) : Object.assign({}, row, {accountId: "", account: `asset:unmapped_payment:${method.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`, method});});
  const liability = ((original.lines || []).find((row) => Number(row.credit) > 0) || {}).account || `liability:customer_change_refund:${k.payableId}`;
  const occurredAt = await rejectionPostingTime(db, Number(rejection.refundPaidAt) || 0), date = financeDateFromTimestamp(occurredAt);
  const lines = Financial.rejectionRefundPaidPosting({liability, amount, sources}, `Refund sent · ${method}${reference ? ` · ${reference}` : ""}`);
  const movement = Financial.movement("customer_change_refunded", "order_rejection", k.id, lines, {occurredAt, actorName: financeText(rejection.refundPaidByRole || "Manager", 60), reference: reference || k.id, amount, payableId: k.payableId});
  const writes = {[`payables/${k.payableId}/status`]: "paid", [`payables/${k.payableId}/remainingAmount`]: 0, [`payables/${k.payableId}/paidAmount`]: amount, [`payables/${k.payableId}/settlementMovementId`]: k.paidId, [`payables/${k.payableId}/paidAt`]: occurredAt, [`payables/${k.payableId}/settlingBy`]: null, [`payables/${k.payableId}/settlingAt`]: null};
  rejectionCashRows(writes, `rejpaid_${k.id}_${k.at}`, sources, "out", "Customer refund paid · rejected order", order, k.paidId, movement, actor, date);
  try { return await commitFinancial(db, k.paidId, movement, actor, writes); } catch (error) { await releaseRejectionPayable(db, k, k.paidId); throw error; }
}
// One settlement at a time: the payable is claimed (open → settling) before the trigger pays or
// reverses it, so a second path that checks the claim cannot settle the same refund twice.
async function claimRejectionPayable(db, k, claimId, amount) {
  const result = await db.ref(`/payables/${k.payableId}`).transaction((row) => {
    if (row == null) return row;
    const left = Financial.money(row.remainingAmount != null ? row.remainingAmount : row.amount);
    if (row.status !== "open" || Math.abs(left - amount) > .009) return;
    return Object.assign({}, row, {status: "settling", settlingBy: claimId, settlingAt: Date.now()});
  }, undefined, false);
  return !!(result.committed && result.snapshot.val() && result.snapshot.val().settlingBy === claimId);
}
async function releaseRejectionPayable(db, k, claimId) {
  await db.ref(`/payables/${k.payableId}`).transaction((row) => row && row.status === "settling" && row.settlingBy === claimId ? Object.assign({}, row, {status: "open", settlingBy: null, settlingAt: null}) : row, undefined, false);
}
async function reverseRejectionRefundDue(db, order, rejection, actor) {
  const k = rejectionKeys(order.id, rejection);
  if ((await db.ref(`/financialMovements/${k.reversalId}`).get()).exists()) return {duplicate: true};
  const original = (await db.ref(`/financialMovements/${k.dueId}`).get()).val();
  if (!original) return {skipped: true};
  const payable = (await db.ref(`/payables/${k.payableId}`).get()).val() || {};
  const remaining = Financial.money(payable.remainingAmount != null ? payable.remainingAmount : payable.amount);
  // A refund partly paid through Cash Payments cannot simply be undone; stop and alert instead.
  if (payable.status !== "open" || Math.abs(remaining - Financial.money(original.amount)) > .009 || !(await claimRejectionPayable(db, k, k.reversalId, Financial.money(original.amount)))) throw new Error(`Rejected order ${k.id} was reopened after part of its refund was paid. Review 2030 before completing it.`);
  const reversal = Financial.reverseMovement(Object.assign({id: k.dueId}, original), "customer_refund_due_reversed", "Rejected order reopened: refund due reversed");
  reversal.occurredAt = Date.now(); reversal.sourceType = "order_rejection"; reversal.sourceId = k.id; reversal.payableId = k.payableId;
  const date = financeDateFromTimestamp(reversal.occurredAt), writes = {[`payables/${k.payableId}/status`]: "reversed", [`payables/${k.payableId}/remainingAmount`]: 0, [`payables/${k.payableId}/reversalMovementId`]: k.reversalId, [`payables/${k.payableId}/settlingBy`]: null, [`payables/${k.payableId}/settlingAt`]: null};
  const sources = (original.lines || []).filter((row) => Number(row.debit) > 0 && String(row.account || "").indexOf("asset:cash_account:") === 0).map((row) => ({accountId: String(row.account).split(":")[2], amount: Financial.money(row.debit), method: ""}));
  rejectionCashRows(writes, `rejrev_${k.id}_${k.at}`, sources, "out", "Rejected order reopened · refund due reversed", order, k.reversalId, reversal, actor, date);
  try { return await commitFinancial(db, k.reversalId, reversal, actor, writes); } catch (error) { await releaseRejectionPayable(db, k, k.reversalId); throw error; }
}
// The order's current rejection: live, or archived once it has left /orders.
async function currentRejectedOrder(db, orderId) {
  const live = (await db.ref(`/orders/${orderId}`).get()).val();
  if (live) return {order: Object.assign({id: orderId}, live), archived: false};
  const archived = (await db.ref(`/archivedOrders/${orderId}`).get()).val();
  return archived ? {order: Object.assign({id: orderId}, archived), archived: true} : null;
}
exports.onOrderRejectionFinancial = onValueWritten(
  {ref: "/orders/{orderId}/rejection", region: ORDER_REGION, retry: true},
  async (event) => {
    const before = event.data.before.val() || null, after = event.data.after.val() || null, orderId = event.params.orderId;
    if (!(before && before.outcome === "refund_due") && !(after && after.outcome === "refund_due")) return;
    const db = getDatabase(), actor = {uid: "server", role: "server"}, found = await currentRejectedOrder(db, orderId);
    if (!found) return;
    const current = found.order.rejection || null;
    // An earlier refund due this order no longer carries (reopened, or replaced): reverse it.
    // An archived order keeps its rejection, so archiving is never mistaken for a reopen.
    if (before && before.outcome === "refund_due" && !sameRefundDue(before, current)) {
      // Reopening is refused once the refund is paid; if one gets through, stop and alert, because
      // the later sale would book money the customer already has back.
      if (before.refundStatus === "paid") throw new Error(`Rejected order ${orderId} was reopened after its refund was paid. Review it before completing the sale.`);
      await reverseRejectionRefundDue(db, found.order, before, actor);
    }
    // Post only what the order currently carries, never a stale event's copy.
    if (!(current && current.outcome === "refund_due")) return;
    if (!Number(current.at)) {logger.error("Refund-due rejection has no timestamp; not posted", {orderId}); return;}
    await postRejectionRefundDue(db, found.order, current, actor);
    // Re-check after posting: if the order was reopened meanwhile, undo at once.
    const after2 = await currentRejectedOrder(db, orderId), now2 = after2 && after2.order.rejection;
    if (!sameRefundDue(current, now2)) {await reverseRejectionRefundDue(db, found.order, current, actor); return;}
    if (now2.refundStatus === "paid") await postRejectionRefundPaid(db, after2.order, now2, actor);
  },
);
