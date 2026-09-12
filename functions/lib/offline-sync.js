"use strict";
const {HttpsError} = require("firebase-functions/v2/https");
const PaymentVerification = require("./payment-verification");

const POS_DENOM_KEYS = new Set(["b1000", "b500", "b200", "b100", "b50", "p20", "c10", "c5", "c1", "c25", "c10s", "c5s"]);
const POS_DENOM_VALUES = {b1000:1000,b500:500,b200:200,b100:100,b50:50,p20:20,c10:10,c5:5,c1:1,c25:.25,c10s:.1,c5s:.05};
function offlineTxnKey(value) {
  const key = String(value || "").trim();
  if (!/^[A-Za-z0-9_-]{12,120}$/.test(key)) throw new HttpsError("invalid-argument", "Offline transaction ID is invalid.");
  return key;
}
function offlineDrawerDelta(value) {
  const raw = value && typeof value === "object" ? value : {}, out = {};
  Object.keys(raw).forEach((key) => {if (!POS_DENOM_KEYS.has(key)) throw new HttpsError("invalid-argument", "Offline drawer denomination is invalid.");const qty = Number(raw[key]);if (!Number.isInteger(qty) || Math.abs(qty) > 10000) throw new HttpsError("invalid-argument", "Offline drawer quantity is invalid.");if (qty) out[key] = qty;});
  return out;
}
function drawerDeltaValue(delta) {return Math.round(Object.keys(delta || {}).reduce((sum,key)=>sum+Number(delta[key]||0)*Number(POS_DENOM_VALUES[key]||0),0)*100)/100;}
function applyDrawerDelta(row, transactionId, delta, now, actor) {
  if (!row || typeof row !== "object") return row;
  const applied = Object.assign({}, row.offlineSyncApplied || {});if (applied[transactionId]) return row;
  const drawer = Object.assign({}, row.drawer || {});for(const key of Object.keys(delta)){const next=Number(drawer[key]||0)+delta[key];if(next<0)return;drawer[key]=next;}
  applied[transactionId] = {at: now, by: actor.uid};return Object.assign({}, row, {drawer, offlineSyncApplied: applied});
}
async function syncOfflinePosSaleCommand(ctx) {
  const {db, actor, data, textField, money, listFromFirebase, activeOrderProjection} = ctx, now = Number(ctx.now) || Date.now();
  const transactionId = offlineTxnKey(data.transactionId), raw = data.order;
  const syncAudit = (await db.ref(`/offlinePosSync/${transactionId}`).get()).val();
  if (syncAudit && syncAudit.state === "cancelled") throw new HttpsError("failed-precondition", "This offline transaction was cancelled by management.");
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new HttpsError("invalid-argument", "Offline sale payload is missing.");
  if (Buffer.byteLength(JSON.stringify(raw), "utf8") > 250000) throw new HttpsError("invalid-argument", "Offline sale payload is too large.");
  const orderId = textField(raw.id, "Order ID", 120, true), shiftId = textField(raw.shiftId, "Shift ID", 120, true);
  if(syncAudit&&syncAudit.orderId&&syncAudit.orderId!==orderId)throw new HttpsError("already-exists","This POS transaction is already linked to another order.");
  if (!/^(?:POS|GF|FP)-[A-Za-z0-9_-]+$/.test(orderId) || raw.source !== "pos" || raw.status !== "Completed") throw new HttpsError("invalid-argument", "Offline sale identity or status is invalid.");
  if (raw.clientTxnId !== transactionId) throw new HttpsError("invalid-argument", "Offline sale transaction identity does not match.");
  const total = money(raw.total);if (!(total >= 0 && total <= 1000000)) throw new HttpsError("invalid-argument", "Offline sale total is invalid.");
  const lines = listFromFirebase(raw.lineItems);if (!lines.length || lines.length > 200) throw new HttpsError("invalid-argument", "Offline sale items are invalid.");
  const delta = offlineDrawerDelta(data.drawerDelta), orderRef = db.ref(`/orders/${orderId}`), existingSnap = await orderRef.get(), existing = existingSnap.val();
  if (existing && existing.clientTxnId !== transactionId) throw new HttpsError("already-exists", "This order ID already belongs to another transaction.");
  const channel = String(raw.channel || "instore").toLowerCase(), platform = channel === "grabfood" || channel === "foodpanda", payments = Array.isArray(raw.payments) ? raw.payments : [], direct = PaymentVerification.directPaymentRows(payments), posSettings = (await db.ref("/posSettings").get()).val() || {}, verificationPolicy = platform ? null : PaymentVerification.paymentPolicy(payments, posSettings.payMethods), prepaid = raw.preCompletionCashRefund && typeof raw.preCompletionCashRefund === "object" ? raw.preCompletionCashRefund : null;
  if (!platform && direct.length && verificationPolicy === PaymentVerification.CASHIER_MANAGER && raw.cashierVerificationIntent !== true) throw new HttpsError("failed-precondition", "Cashier verification is required before completing this direct electronic payment sale.");
  if (!platform && direct.some((row) => !String(row && row.ref || "").trim())) throw new HttpsError("invalid-argument", "Every direct electronic payment requires a transaction reference.");
  let prepaidShiftApplied=false;
  if (prepaid) {
    const refund=money(prepaid.amount),paid=money(direct.reduce((sum,row)=>sum+money(row.amount),0)),reason=textField(prepaid.reason,"Order change reason",300,true),ack=textField(prepaid.customerAcknowledgement,"Customer acknowledgement",160,true),cashRefund=money(raw.refundPayments&&raw.refundPayments.Cash);
    if(platform||channel!=="instore"||direct.length!==1||payments.length!==1)throw new HttpsError("failed-precondition","A pre-completion cash refund requires one verified in-store GCash, Maya, or bank payment.");
    if(!(refund>0)||Math.abs(paid-total-refund)>.009||Math.abs(cashRefund-refund)>.009||money(raw.refundAmount)!==0)throw new HttpsError("invalid-argument","Confirmed payment, corrected sale, and cash refund do not reconcile.");
    if(verificationPolicy!==PaymentVerification.CASHIER_MANAGER||raw.cashierVerificationIntent!==true||prepaid.refundMethod!=="Cash"||prepaid.shiftId!==shiftId)throw new HttpsError("failed-precondition","Verify the electronic receipt and current shift before completing this refund.");
    const active=(await db.ref("/posActiveShift").get()).val()||null,shiftRow=(await db.ref(`/shifts/${shiftId}`).get()).val()||null;if(!active||!shiftRow||active.id!==shiftId||active.status==="closed"||shiftRow.status==="closed")throw new HttpsError("failed-precondition","The POS shift changed. Recheck the order before returning cash.");prepaidShiftApplied=!!(shiftRow.offlineSyncApplied&&shiftRow.offlineSyncApplied[transactionId]);
    if(posSettings.denomTracking){if(Math.abs(drawerDeltaValue(delta)+refund)>.009)throw new HttpsError("invalid-argument","Cash refund denominations must equal the refund amount.");if(!prepaidShiftApplied)for(const key of Object.keys(delta))if(-Number(delta[key]||0)>Number((shiftRow.drawer||{})[key]||0))throw new HttpsError("failed-precondition","The drawer no longer has the selected refund denominations.");}
    if(Object.values(delta).some((qty)=>qty>0))throw new HttpsError("invalid-argument","A GCash overpayment refund cannot add cash to the drawer.");
    if(!existing&&!prepaidShiftApplied&&ctx.availableCash){const cash=await ctx.availableCash(db);if(refund>money(cash.available)+.009)throw new HttpsError("failed-precondition",`Refund exceeds register cash available above the protected float by ${money(refund-cash.available).toFixed(2)}.`);}
    prepaid.reason=reason;prepaid.customerAcknowledgement=ack;prepaid.amount=refund;prepaid.paidAmount=paid;
  }
  const paymentControl = platform || !direct.length ? {paymentStatus: "confirmed"} : verificationPolicy === PaymentVerification.MANAGER_ONLY ? {paymentStatus: "pending", paymentVerificationPolicy: verificationPolicy} : {paymentStatus: "cashier_verified", paymentVerificationPolicy: verificationPolicy, cashierVerifiedAt: now, cashierVerifiedBy: actor.uid, cashierVerifiedRole: actor.role, cashierVerifiedAmount: money(direct.reduce((sum, row) => sum + money(row.amount), 0))};
  const order = Object.assign({}, raw, paymentControl, {id: orderId, shiftId, total, lineItems: lines, clientTxnId: transactionId, syncState: "synced", syncedAt: existing && existing.syncedAt ? existing.syncedAt : now, syncedByUid: actor.uid, schemaVersion: Math.max(2, Number(raw.schemaVersion) || 0)}); delete order.cashierVerificationIntent;
  const prepared=!existing&&ctx.prepareOrder?await ctx.prepareOrder(order,now):{order},durableOrder=prepared&&prepared.order||order;
  let shiftResult;if(prepaid&&!existing){const reservation=await db.ref(`/offlinePosSync/${transactionId}`).transaction((row)=>{if(row&&row.orderId&&row.orderId!==orderId)return;return row||{orderId,shiftId,state:"refund-reserved",createdAt:Number(raw.timestamp)||now,updatedAt:now,actorUid:actor.uid};},undefined,false);if(!reservation.committed)throw new HttpsError("already-exists","This POS transaction is already linked to another order.");shiftResult=await db.ref(`/shifts/${shiftId}`).transaction((row)=>applyDrawerDelta(row,transactionId,delta,now,actor),undefined,false);if(!shiftResult.committed||!shiftResult.snapshot.exists())throw new HttpsError("failed-precondition","The drawer no longer has enough cash for this refund. Recheck the denominations.");}
  if (!existing){const writes={[`orders/${orderId}`]:durableOrder,[`activeOrders/${orderId}`]:activeOrderProjection(durableOrder),[`offlinePosSync/${transactionId}`]:{orderId,shiftId,state:"order-written",createdAt:Number(raw.timestamp)||now,updatedAt:now,actorUid:actor.uid}};if(prepaid)writes[`operationalAudit/${now}_precompletion_cash_refund_${orderId}`]={action:"complete_instore_prepaid_cash_refund",sourceType:"order",sourceId:orderId,amount:prepaid.amount,confirmedElectronicAmount:prepaid.paidAmount,correctedOrderTotal:total,reason:prepaid.reason,customerAcknowledgement:prepaid.customerAcknowledgement,shiftId,actorUid:actor.uid,actorRole:actor.role,ts:now,schemaVersion:1};if(prepared&&prepared.inventoryPlan)writes[`orderInventoryPlans/${orderId}`]=prepared.inventoryPlan;await db.ref().update(writes);}
  if(!shiftResult)shiftResult = await db.ref(`/shifts/${shiftId}`).transaction((row) => applyDrawerDelta(row, transactionId, delta, now, actor), undefined, false);
  if (!shiftResult.committed || !shiftResult.snapshot.exists()) throw new HttpsError("failed-precondition", "The sale shift no longer exists. Keep this transaction pending and contact a manager.");
  await db.ref("/posActiveShift").transaction((row) => row && row.id === shiftId ? applyDrawerDelta(row, transactionId, delta, now, actor) : row, undefined, false);
  await db.ref(`/offlinePosSync/${transactionId}`).update({state: "synced", syncedAt: now, updatedAt: now});
  return {transactionId, orderId, syncedAt: now, duplicate: !!existing};
}
module.exports={POS_DENOM_KEYS,offlineTxnKey,offlineDrawerDelta,drawerDeltaValue,applyDrawerDelta,syncOfflinePosSaleCommand};
