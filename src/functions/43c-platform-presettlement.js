
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
