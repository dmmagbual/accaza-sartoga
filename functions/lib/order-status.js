"use strict";

const MUTABLE = new Set(["Pending", "Confirmed", "Preparing", "Ready", "Rejected"]);
const TARGETS = new Set([...MUTABLE, "Completed"]);
const TERMINAL = new Set(["Completed", "Received"]);

function cleanKey(value, label) {
  const key = String(value || "").trim();
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(key)) throw Object.assign(new Error(`${label} is invalid.`), {code: "invalid-argument"});
  return key;
}

function normalizeStatus(value) {
  const status = String(value || "").trim();
  return TARGETS.has(status) ? status : "";
}

function canTransition(from, to) {
  if (from === to) return true;
  if (TERMINAL.has(from)) return false;
  return MUTABLE.has(from) && TARGETS.has(to);
}

function raise(options, code, message) {
  if (options && typeof options.error === "function") throw options.error(code, message);
  throw Object.assign(new Error(message), {code});
}

async function updateOrderStatusCommand(options) {
  const {db, actor, data, activeOrderProjection, shouldProjectOrder} = options;
  let orderId, requestId;
  try {
    orderId = cleanKey(data && data.orderId, "Order ID");
    requestId = cleanKey(data && data.requestId, "Request ID");
  } catch (error) {
    raise(options, error.code || "invalid-argument", error.message);
  }
  const targetStatus = normalizeStatus(data && data.status);
  if (!targetStatus) raise(options, "invalid-argument", "Order status is invalid.");
  const expectedStatus = String(data && data.expectedStatus || "").trim();
  const now = Date.now(), commandRef = db.ref(`/orderStatusCommands/${requestId}`);
  let commandConflict = false, commandAlreadyApplied = false;
  await commandRef.transaction((current) => {
    if (current) {
      if (current.orderId !== orderId || current.targetStatus !== targetStatus || current.actorUid !== actor.uid) commandConflict = true;
      else if (current.status === "applied") commandAlreadyApplied = true;
      return current;
    }
    return {requestId, orderId, targetStatus, actorUid: actor.uid, actorRole: actor.role, status: "processing", createdAt: now, schemaVersion: 1};
  }, undefined, false);
  if (commandConflict) raise(options, "already-exists", "That status request ID was already used for another command.");
  if (commandAlreadyApplied) return {orderId, status: targetStatus, duplicate: true};

  const orderRef = db.ref(`/orders/${orderId}`);
  let result = null, updatedOrder = null;
  try {
    // Read-modify-write instead of a transaction. The Admin SDK can invoke a
    // transaction's update function with null on its first pass even when the
    // order exists (cold instance / uncached read); returning undefined there
    // aborts the whole transaction and false-negatives as "Order not found".
    // Reading once with get() and committing via an atomic multi-path update()
    // avoids that footgun. Idempotency is still guaranteed by the
    // orderStatusCommands/{requestId} claim taken above, and expectedStatus
    // rejects stale transitions.
    const snap = await orderRef.get();
    if (!snap.exists()) raise(options, "not-found", "Order not found.");
    const current = snap.val() || {};
    const from = String(current.status || "Pending");
    if (from === targetStatus) {
      result = {orderId, fromStatus: from, status: targetStatus, duplicate: true};
      updatedOrder = current;
    } else {
      if (expectedStatus && expectedStatus !== from) raise(options, "aborted", `Order changed from ${expectedStatus} to ${from}. Refresh and try again.`);
      if (!canTransition(from, targetStatus)) raise(options, "failed-precondition", `Order cannot move from ${from} to ${targetStatus}.`);
      const websiteOrder = current.source === "online" || current.channel === "online";
      const requiresShiftCapture = ["Preparing", "Ready", "Completed"].includes(targetStatus);
      if (websiteOrder && requiresShiftCapture && (!current.shiftId || current.posCaptured !== true || current.paymentStatus !== "confirmed")) {
        raise(options, "failed-precondition", "Verify payment and accept this website order into the open POS shift before preparing or completing it.");
      }
      updatedOrder = Object.assign({}, current, {
        status: targetStatus,
        statusUpdatedAt: now,
        statusUpdatedBy: actor.uid,
        statusUpdatedRole: actor.role,
        statusCommandId: requestId,
      });
      const history = Object.assign({}, current.statusHistory || {});
      history[requestId] = {from, to: targetStatus, at: now, actorUid: actor.uid, actorRole: actor.role};
      updatedOrder.statusHistory = history;
      result = {orderId, fromStatus: from, status: targetStatus, duplicate: false};
    }

    const writes = {
      [`orderStatusCommands/${requestId}/status`]: "applied",
      [`orderStatusCommands/${requestId}/appliedAt`]: Date.now(),
      [`orderStatusCommands/${requestId}/duplicate`]: result.duplicate,
      [`orderStatusCommands/${requestId}/fromStatus`]: result.fromStatus,
    };
    if (!result.duplicate) writes[`orders/${orderId}`] = updatedOrder;
    if (typeof shouldProjectOrder === "function" && typeof activeOrderProjection === "function") {
      const activeShift = (await db.ref("/posActiveShift").get()).val() || null;
      writes[`activeOrders/${orderId}`] = shouldProjectOrder(updatedOrder, activeShift) ? activeOrderProjection(updatedOrder) : null;
    }
    if (updatedOrder.ownerUid) writes[`customerOrders/${updatedOrder.ownerUid}/${orderId}/status`] = targetStatus;
    if (!result.duplicate) writes[`operationalAudit/${now}_${requestId}`] = {
      action: "update_order_status", sourceType: "order", sourceId: orderId,
      actorUid: actor.uid, actorRole: actor.role, previousStatus: result.fromStatus,
      status: targetStatus, requestId, ts: now, schemaVersion: 1,
    };
    await db.ref().update(writes);
    return result;
  } catch (error) {
    try { await commandRef.update({status: "failed", failedAt: Date.now(), errorCode: String(error && error.code || "internal").slice(0, 80)}); } catch (_ignored) {}
    throw error;
  }
}

module.exports = {MUTABLE, TARGETS, TERMINAL, normalizeStatus, canTransition, updateOrderStatusCommand};
