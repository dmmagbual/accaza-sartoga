"use strict";
const {HttpsError} = require("firebase-functions/v2/https");

const POS_DENOM_KEYS = new Set(["b1000", "b500", "b200", "b100", "b50", "p20", "c10", "c5", "c1", "c25", "c10s", "c5s"]);
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
function applyDrawerDelta(row, transactionId, delta, now, actor) {
  if (!row || typeof row !== "object") return row;
  const applied = Object.assign({}, row.offlineSyncApplied || {});if (applied[transactionId]) return row;
  const drawer = Object.assign({}, row.drawer || {});Object.keys(delta).forEach((key) => {drawer[key] = Number(drawer[key] || 0) + delta[key];});
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
  if (!/^(?:POS|GF|FP)-[A-Za-z0-9_-]+$/.test(orderId) || raw.source !== "pos" || raw.status !== "Completed") throw new HttpsError("invalid-argument", "Offline sale identity or status is invalid.");
  if (raw.clientTxnId !== transactionId) throw new HttpsError("invalid-argument", "Offline sale transaction identity does not match.");
  const total = money(raw.total);if (!(total >= 0 && total <= 1000000)) throw new HttpsError("invalid-argument", "Offline sale total is invalid.");
  const lines = listFromFirebase(raw.lineItems);if (!lines.length || lines.length > 200) throw new HttpsError("invalid-argument", "Offline sale items are invalid.");
  const delta = offlineDrawerDelta(data.drawerDelta), orderRef = db.ref(`/orders/${orderId}`), existingSnap = await orderRef.get(), existing = existingSnap.val();
  if (existing && existing.clientTxnId !== transactionId) throw new HttpsError("already-exists", "This order ID already belongs to another transaction.");
  const order = Object.assign({}, raw, {id: orderId, shiftId, total, lineItems: lines, clientTxnId: transactionId, syncState: "synced", syncedAt: existing && existing.syncedAt ? existing.syncedAt : now, syncedByUid: actor.uid, schemaVersion: Math.max(2, Number(raw.schemaVersion) || 0)});
  if (!existing) await db.ref().update({[`orders/${orderId}`]: order, [`activeOrders/${orderId}`]: activeOrderProjection(order), [`offlinePosSync/${transactionId}`]: {orderId, shiftId, state: "order-written", createdAt: Number(raw.timestamp) || now, updatedAt: now, actorUid: actor.uid}});
  const shiftResult = await db.ref(`/shifts/${shiftId}`).transaction((row) => applyDrawerDelta(row, transactionId, delta, now, actor), undefined, false);
  if (!shiftResult.committed || !shiftResult.snapshot.exists()) throw new HttpsError("failed-precondition", "The sale shift no longer exists. Keep this transaction pending and contact a manager.");
  await db.ref("/posActiveShift").transaction((row) => row && row.id === shiftId ? applyDrawerDelta(row, transactionId, delta, now, actor) : row, undefined, false);
  await db.ref(`/offlinePosSync/${transactionId}`).update({state: "synced", syncedAt: now, updatedAt: now});
  return {transactionId, orderId, syncedAt: now, duplicate: !!existing};
}
module.exports={POS_DENOM_KEYS,offlineTxnKey,offlineDrawerDelta,applyDrawerDelta,syncOfflinePosSaleCommand};
