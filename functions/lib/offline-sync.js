"use strict";
const {HttpsError} = require("firebase-functions/v2/https");
const PaymentVerification = require("./payment-verification");
const Handover = require("./shift-handover");
const ShiftCrew = require("./shift-crew");

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
function validatePaymentReconciliation(raw, money) {
  const channel = String(raw && raw.channel || "instore").toLowerCase(), platform = channel === "grabfood" || channel === "foodpanda";
  const payments = Array.isArray(raw && raw.payments) ? raw.payments : [], total = money(raw && raw.total || 0), refund = money(raw && raw.preCompletionCashRefund && raw.preCompletionCashRefund.amount || 0);
  if (!payments.length) {
    if (total === 0) return {payments: [], paid: 0, refund: 0};
    throw new HttpsError("invalid-argument", "At least one payment is required before completing the sale.");
  }
  let paid = 0;
  payments.forEach((row) => {
    const method = String(row && row.method || "").trim(), amount = money(row && row.amount || 0);
    if (!method || !(amount > 0)) throw new HttpsError("invalid-argument", "Every payment must have a method and a positive amount.");
    paid = money(paid + amount);
    if (!platform && PaymentVerification.isCashMethod(method)) {
      const tendered = money(row && row.tendered || 0), change = money(row && row.change || 0), tip = money(row && row.tipRounding || 0);
      if (!(tendered > 0) || change < 0 || tip < 0 || Math.abs(tendered - change - tip - amount) > .009) throw new HttpsError("failed-precondition", "Cash received, change, and retained rounding do not reconcile to the cash payment.");
    }
  });
  if (refund > 0) {
    if (Math.abs(paid - refund - total) > .009) throw new HttpsError("invalid-argument", "Confirmed payment, corrected sale, and cash refund do not reconcile.");
  } else if (Math.abs(paid - total) > .009) {
    throw new HttpsError("failed-precondition", paid < total ? "Payment is short of the order total." : "Payment exceeds the order total without a recorded customer refund.");
  }
  return {payments, paid, refund};
}
function applyDrawerDelta(row, transactionId, delta, now, actor) {
  if (!row || typeof row !== "object") return row;
  if(row.status==='closed')return;
  const applied = Object.assign({}, row.offlineSyncApplied || {});if (applied[transactionId]) return row;
  const drawer = Object.assign({}, row.drawer || {});for(const key of Object.keys(delta)){const next=Number(drawer[key]||0)+delta[key];if(next<0)return;drawer[key]=next;}
  applied[transactionId] = {at: now, by: actor.uid};return Object.assign({}, row, {drawer, offlineSyncApplied: applied});
}
// A dedicated gate avoids transacting the entire (frequently updated) shift.
// Its empty value is a valid starting state, including on an uncached RTDB read.
async function claimShiftSync(db,shiftId,transactionId,now){
  const token=`${now}_${Math.random().toString(36).slice(2)}`;
  const ref=db.ref(`/shiftSyncGates/${shiftId}`);
  const result=await ref.transaction(value=>{
    const gate=value||{};
    if(Number(gate.finalizingAt||0)>Date.now()-180000)return;
    return {...gate,pending:{...gate.pending,[transactionId]:{at:now,token}}};
  },undefined,false);
  if(!result.committed)throw new HttpsError('aborted','Shift reconciliation is running. Keep this sale queued and retry shortly.');
  return token;
}
async function releaseShiftSync(db,shiftId,transactionId,token){
  await db.ref(`/shiftSyncGates/${shiftId}/pending/${transactionId}`).transaction(value=>value&&value.token===token?null:value,undefined,false);
}
// Management recovery replays a rejected sale as the shift owner. The person who actually
// rang it stays on the order: as crew when their membership covered the sale, otherwise
// as a recovered sale that the manager accepted into the owner's drawer.
function recoveredSeller(ctx, shift, seller, ts) {
  const recovery = ctx && ctx.recovery;
  if (!recovery || !seller || seller.role !== "owner" || !recovery.sellerUid || !shift || recovery.sellerUid === shift.accountUid) return seller;
  const crew = recovery.sellerCrew || null, asCrew = ShiftCrew.saleSeller(shift, crew, recovery.sellerUid, ts);
  if (asCrew) return asCrew;
  return {role: "recovered", uid: recovery.sellerUid, staffId: String(recovery.sellerStaffId || ""), staff: String(recovery.sellerStaff || "")};
}
// Loads who originally rang a sale that management is recovering: their crew record for
// the shift (if any) and their linked staff profile, so the order keeps the real seller.
async function recoveryContext(db, shiftId, sellerUid, managerUid) {
  const uid = String(sellerUid || "");
  if (!/^[A-Za-z0-9_-]{6,128}$/.test(uid)) return {managerUid};
  const [crewSnap, staffSnap] = await Promise.all([db.ref(`/shiftCrews/${shiftId}/${uid}`).get(), /* download-ok: bounded POS staff list (a handful of profiles) */ db.ref("/posStaff").get()]);
  const staff = Object.entries(staffSnap.val() || {}).find(([, row]) => row && row.accountUid === uid) || [];
  return {managerUid, sellerUid: uid, sellerCrew: crewSnap.val() || null, sellerStaffId: staff[0] || "", sellerStaff: (staff[1] && staff[1].name) || ""};
}
// Ends every open crew session when the shift is handed over or closed. Sales rung before
// that moment stay recoverable into the shift; nothing after it is accepted from the crew.
async function endShiftCrew(db, shiftId, at, endedBy, reason) {
  const ended = [];
  await db.ref(`/shiftCrews/${shiftId}`).transaction((value) => {
    ended.length = 0;
    if (value == null) return null;
    const next = {};
    for (const [uid, row] of Object.entries(value)) {
      const closed = ShiftCrew.leaveRecord(row, at, endedBy, reason);
      if (closed !== row) ended.push(uid);
      next[uid] = closed;
    }
    return next;
  }, undefined, false);
  if (ended.length) await db.ref().update(Object.fromEntries(ended.map((uid) => [`shifts/${shiftId}/crew/${uid}/leftAt`, at])));
  return ended;
}
// Every rejected POS sale is captured the moment the server refuses it: who rang it, why,
// and the exact command, so management is alerted and can recover it without the device
// or anyone's password. A later successful sync of the same transaction resolves it.
const PERMANENT_SYNC_CODES = new Set(["permission-denied", "failed-precondition", "already-exists", "invalid-argument", "not-found"]);
function syncAlertCode(error) { return String((error && error.code) || "internal").replace(/^functions\//, ""); }
async function recordSyncAlert(db, actor, data, error, now, notify) {
  let transactionId; try { transactionId = offlineTxnKey(data && data.transactionId); } catch (_e) { return null; }
  const raw = data && data.order && typeof data.order === "object" && !Array.isArray(data.order) ? data.order : null;
  const command = raw && Buffer.byteLength(JSON.stringify(raw), "utf8") <= 250000 ? {transactionId, order: raw, drawerDelta: data.drawerDelta && typeof data.drawerDelta === "object" ? data.drawerDelta : {}} : null;
  const code = syncAlertCode(error), message = String((error && error.message) || error || "Sync failed").slice(0, 500);
  const ref = db.ref(`/posSyncAlerts/${transactionId}`);
  const result = await ref.transaction((value) => {
    const current = value || {};
    if (current.state && current.state !== "open") return current;
    return Object.assign({}, current, {transactionId, orderId: String((raw && raw.id) || current.orderId || "").slice(0, 120), shiftId: String((raw && raw.shiftId) || current.shiftId || "").slice(0, 120), actorUid: current.actorUid || actor.uid, lastActorUid: actor.uid, total: Number(raw && raw.total) || Number(current.total) || 0, orderTimestamp: Number(raw && raw.timestamp) || Number(current.orderTimestamp) || 0, code, message, state: "open", firstAt: Number(current.firstAt) || now, lastAt: now, count: (Number(current.count) || 0) + 1, command: current.command || command, schemaVersion: 1});
  }, undefined, false);
  const row = result.committed && result.snapshot.val();
  if (!row || row.state !== "open" || row.notifiedAt) return row;
  if (!(PERMANENT_SYNC_CODES.has(code) || Number(row.count) >= 3 || now - Number(row.firstAt) >= 5 * 60 * 1000)) return row;
  const claim = await ref.child("notifiedAt").transaction((value) => (value ? undefined : now), undefined, false);
  if (claim.committed && typeof notify === "function") await notify("🚨 POS sale not saved", `${row.orderId || transactionId} · PHP ${Number(row.total || 0).toFixed(2)} · ${message}`.slice(0, 180));
  return row;
}
async function resolveSyncAlert(db, transactionId, now) {
  let key; try { key = offlineTxnKey(transactionId); } catch (_e) { return; }
  await db.ref(`/posSyncAlerts/${key}`).transaction((value) => (value == null ? null : value.state === "open" ? Object.assign({}, value, {state: "resolved", resolvedAt: now}) : value), undefined, false);
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
  const ownedShift = (await db.ref(`/shifts/${shiftId}`).get()).val();
  // The shift owner, or a crew member who was on the shift when the sale was rung.
  const crewRow = ownedShift && ownedShift.accountUid && ownedShift.accountUid !== actor.uid ? (await db.ref(`/shiftCrews/${shiftId}/${actor.uid}`).get()).val() : null;
  const seller = recoveredSeller(ctx, ownedShift, ShiftCrew.saleSeller(ownedShift, crewRow, actor.uid, raw.timestamp), raw.timestamp) || null;
  if(ownedShift&&syncAudit&&syncAudit.state==='synced'&&syncAudit.orderId===orderId){
    const accepted=existing||((await db.ref(`/archivedOrders/${orderId}`).get()).val());
    // A sale already accepted (for example by management recovery) is acknowledged to any
    // device still holding it, so its queue clears without applying anything twice.
    if(accepted&&accepted.clientTxnId===transactionId&&(ownedShift.status==='closed'||!existing||(!seller&&money(accepted.total)===money(raw.total))))return {transactionId,orderId,syncedAt:syncAudit.syncedAt,duplicate:true};
  }
  // Management recovery of a sale rung during a shift that has since closed (24 Sep 2026): the
  // sale joins its original shift and that shift's Z report is re-issued as an amendment.
  // The closed drawer is history and is not changed; the cash is settled in Discrepancies.
  const lateClosed = !!(ctx.lateRecovery && ownedShift && ownedShift.status === "closed" && Number(raw.timestamp) >= Number(ownedShift.openAt) && Number(raw.timestamp) <= Number(ownedShift.closeAt || 0));
  if (!ownedShift || (ownedShift.status === "closed" && !lateClosed)) throw new HttpsError("failed-precondition", "The POS shift is no longer open.");
  if(!seller)throw new HttpsError('permission-denied',`This sale belongs to ${ownedShift.staff||'another cashier'}'s shift. Join the shift before ringing sales.`);
  const syncToken=await claimShiftSync(db,shiftId,transactionId,now);
  try {
  let handover = (await db.ref(`/shiftHandovers/${shiftId}`).get()).val();
  if (handover) {
    if(handover.state!=='pending'&&!lateClosed)throw new HttpsError('failed-precondition','The original shift has already been reconciled. Keep the sale queued and contact a manager.');
    const command = {transactionId,order:raw,drawerDelta:data.drawerDelta||{}},hash=Handover.commandDigest(command);
    if(!(Number(raw.timestamp)>=Number(ownedShift.openAt)&&Number(raw.timestamp)<=handover.at))throw new HttpsError('permission-denied','Only a sale rung during the original shift can be recovered.');
    const claim=await db.ref(`/shiftHandovers/${shiftId}/commands/${transactionId}`).transaction(sealed=>{
      // Compare the sale itself in its stored form; hashes saved before Sep 2026 were taken
      // over the device payload and never match a copy read back from the database.
      if(sealed)return Handover.sameCommand(sealed.command,command)?sealed:undefined;
      return {command,hash,orderId,lastError:''};
    },undefined,false);
    if(!claim.committed)throw new HttpsError('already-exists','The retained sale payload differs from the original transaction.');
  }
  if (existing && existing.clientTxnId !== transactionId) throw new HttpsError("already-exists", "This order ID already belongs to another transaction.");
  const channel = String(raw.channel || "instore").toLowerCase(), platform = channel === "grabfood" || channel === "foodpanda", reconciliation = validatePaymentReconciliation(raw, money), payments = reconciliation.payments, direct = PaymentVerification.directPaymentRows(payments), posSettings = (await db.ref("/posSettings").get()).val() || {}, verificationPolicy = platform ? null : PaymentVerification.paymentPolicy(payments, posSettings.payMethods), prepaid = raw.preCompletionCashRefund && typeof raw.preCompletionCashRefund === "object" ? raw.preCompletionCashRefund : null;
  if (!platform && direct.length && verificationPolicy === PaymentVerification.CASHIER_MANAGER && raw.cashierVerificationIntent !== true) throw new HttpsError("failed-precondition", "Cashier verification is required before completing this direct electronic payment sale.");
  if (!platform && direct.some((row) => !String(row && row.ref || "").trim())) throw new HttpsError("invalid-argument", "Every direct electronic payment requires a transaction reference.");
  let prepaidShiftApplied=false;
  if (prepaid) {
    const refund=money(prepaid.amount),paid=money(direct.reduce((sum,row)=>sum+money(row.amount),0)),reason=textField(prepaid.reason,"Order change reason",300,true),ack=textField(prepaid.customerAcknowledgement,"Customer acknowledgement",160,true),cashRefund=money(raw.refundPayments&&raw.refundPayments.Cash);
    if(platform||channel!=="instore"||direct.length!==1||payments.length!==1)throw new HttpsError("failed-precondition","A pre-completion cash refund requires one verified in-store GCash, Maya, or bank payment.");
    if(!(refund>0)||Math.abs(paid-total-refund)>.009||Math.abs(cashRefund-refund)>.009||money(raw.refundAmount)!==0)throw new HttpsError("invalid-argument","Confirmed payment, corrected sale, and cash refund do not reconcile.");
    if(verificationPolicy!==PaymentVerification.CASHIER_MANAGER||raw.cashierVerificationIntent!==true||prepaid.refundMethod!=="Cash"||prepaid.shiftId!==shiftId)throw new HttpsError("failed-precondition","Verify the electronic receipt and current shift before completing this refund.");
    const active=(await db.ref("/posActiveShift").get()).val()||null,shiftRow=(await db.ref(`/shifts/${shiftId}`).get()).val()||null;if(!handover&&(!active||!shiftRow||active.id!==shiftId||active.status==="closed"||shiftRow.status==="closed"))throw new HttpsError("failed-precondition","The POS shift changed. Recheck the order before returning cash.");prepaidShiftApplied=!!(shiftRow.offlineSyncApplied&&shiftRow.offlineSyncApplied[transactionId]);
    if(posSettings.denomTracking){if(Math.abs(drawerDeltaValue(delta)+refund)>.009)throw new HttpsError("invalid-argument","Cash refund denominations must equal the refund amount.");if(!prepaidShiftApplied)for(const key of Object.keys(delta))if(-Number(delta[key]||0)>Number((shiftRow.drawer||{})[key]||0))throw new HttpsError("failed-precondition","The drawer no longer has the selected refund denominations.");}
    if(Object.values(delta).some((qty)=>qty>0))throw new HttpsError("invalid-argument","A GCash overpayment refund cannot add cash to the drawer.");
    if(!handover&&!existing&&!prepaidShiftApplied&&ctx.availableCash){const cash=await ctx.availableCash(db);if(refund>money(cash.available)+.009)throw new HttpsError("failed-precondition",`Refund exceeds register cash available above the protected float by ${money(refund-cash.available).toFixed(2)}.`);}
    prepaid.reason=reason;prepaid.customerAcknowledgement=ack;prepaid.amount=refund;prepaid.paidAmount=paid;
  }
  const paymentControl = platform || !direct.length ? {paymentStatus: "confirmed"} : verificationPolicy === PaymentVerification.MANAGER_ONLY ? {paymentStatus: "pending", paymentVerificationPolicy: verificationPolicy} : {paymentStatus: "cashier_verified", paymentVerificationPolicy: verificationPolicy, cashierVerifiedAt: now, cashierVerifiedBy: actor.uid, cashierVerifiedRole: actor.role, cashierVerifiedAmount: money(direct.reduce((sum, row) => sum + money(row.amount), 0))};
  // Platform sales always carry an explicit settlement state so receivable readers can
  // use the indexed "unsettled" subset instead of downloading every archived order.
  const settlementDefault = platform && !raw.settlementStatus ? {settlementStatus: "unsettled"} : {};
  const order = Object.assign({}, raw, settlementDefault, paymentControl, {id: orderId, shiftId, total, lineItems: lines, clientTxnId: transactionId, syncState: "synced", syncedAt: existing && existing.syncedAt ? existing.syncedAt : now, syncedByUid: actor.uid, soldByUid: seller.uid, soldByStaffId: seller.staffId, soldBy: seller.staff, soldByRole: seller.role, recoveredBy: ctx.recovery ? ctx.recovery.managerUid : null, schemaVersion: Math.max(2, Number(raw.schemaVersion) || 0)}); delete order.cashierVerificationIntent;
  const prepared=!existing&&ctx.prepareOrder?await ctx.prepareOrder(order,now):{order},durableOrder=prepared&&prepared.order||order;
  let shiftResult;if(prepaid&&!existing){const reservation=await db.ref(`/offlinePosSync/${transactionId}`).transaction((row)=>{if(row&&row.orderId&&row.orderId!==orderId)return;return row||{orderId,shiftId,state:"refund-reserved",createdAt:Number(raw.timestamp)||now,updatedAt:now,actorUid:actor.uid};},undefined,false);if(!reservation.committed)throw new HttpsError("already-exists","This POS transaction is already linked to another order.");shiftResult=await db.ref(`/shifts/${shiftId}`).transaction((row)=>applyDrawerDelta(row,transactionId,delta,now,actor),undefined,false);if(!shiftResult.committed||!shiftResult.snapshot.exists())throw new HttpsError("failed-precondition","The drawer no longer has enough cash for this refund. Recheck the denominations.");}
  if (!existing){const writes={[`orders/${orderId}`]:durableOrder,[`activeOrders/${orderId}`]:activeOrderProjection(durableOrder),[`offlinePosSync/${transactionId}`]:{orderId,shiftId,state:"order-written",createdAt:Number(raw.timestamp)||now,updatedAt:now,actorUid:actor.uid}};if(prepaid)writes[`operationalAudit/${now}_precompletion_cash_refund_${orderId}`]={action:"complete_instore_prepaid_cash_refund",sourceType:"order",sourceId:orderId,amount:prepaid.amount,confirmedElectronicAmount:prepaid.paidAmount,correctedOrderTotal:total,reason:prepaid.reason,customerAcknowledgement:prepaid.customerAcknowledgement,shiftId,actorUid:actor.uid,actorRole:actor.role,ts:now,schemaVersion:1};if(prepared&&prepared.inventoryPlan)writes[`orderInventoryPlans/${orderId}`]=prepared.inventoryPlan;await db.ref().update(writes);}
  if(!shiftResult&&lateClosed){await db.ref(`/shifts/${shiftId}/lateRecoveredSales/${transactionId}`).update({orderId,at:now,by:(ctx.recovery&&ctx.recovery.managerUid)||actor.uid});shiftResult={committed:true,snapshot:{exists:()=>true}};}
  if(!shiftResult)shiftResult = await db.ref(`/shifts/${shiftId}`).transaction((row) => applyDrawerDelta(row, transactionId, delta, now, actor), undefined, false);
  if (!shiftResult.committed || !shiftResult.snapshot.exists()) throw new HttpsError("failed-precondition", "The sale shift no longer exists. Keep this transaction pending and contact a manager.");
  await db.ref("/posActiveShift").transaction((row) => row && row.id === shiftId ? applyDrawerDelta(row, transactionId, delta, now, actor) : row, undefined, false);
  await db.ref(`/offlinePosSync/${transactionId}`).update({state: "synced", syncedAt: now, updatedAt: now});
  if(handover)await db.ref(`/shiftHandovers/${shiftId}/commands/${transactionId}`).update({syncedAt:now,lastError:""});
  return {transactionId, orderId, syncedAt: now, duplicate: !!existing};
  } finally {await releaseShiftSync(db,shiftId,transactionId,syncToken);}
}
module.exports={POS_DENOM_KEYS,offlineTxnKey,offlineDrawerDelta,drawerDeltaValue,validatePaymentReconciliation,applyDrawerDelta,recoveryContext,endShiftCrew,recordSyncAlert,resolveSyncAlert,syncOfflinePosSaleCommand};
