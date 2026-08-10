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
  let failure = null, result = null, updatedOrder = null;
  try {
    // Confirm existence against the server and prime the local cache first.
    // A cold Admin SDK transaction can be invoked with null on its first pass
    // even when the order exists, which would abort and false-negative as
    // "Order not found". get() before transaction() avoids that race.
    const existingSnap = await orderRef.get();
    if (!existingSnap.exists()) raise(options, "not-found", "Order not found.");
    await orderRef.transaction((current) => {
      if (!current) { failure = ["not-found", "Order not found."]; return; }
      const from = String(current.status || "Pending");
      if (from === targetStatus) { result = {orderId, fromStatus: from, status: targetStatus, duplicate: true}; updatedOrder = current; return current; }
      if (expectedStatus && expectedStatus !== from) { failure = ["aborted", `Order changed from ${expectedStatus} to ${from}. Refresh and try again.`]; return; }
      if (!canTransition(from, targetStatus)) { failure = ["failed-precondition", `Order cannot move from ${from} to ${targetStatus}.`]; return; }
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
      return updatedOrder;
    }, undefined, false);
    if (failure) raise(options, failure[0], failure[1]);
    if (!result || !updatedOrder) raise(options, "aborted", "Order status could not be updated. Refresh and try again.");

    const writes = {
      [`orderStatusCommands/${requestId}/status`]: "applied",
      [`orderStatusCommands/${requestId}/appliedAt`]: Date.now(),
      [`orderStatusCommands/${requestId}/duplicate`]: result.duplicate,
      [`orderStatusCommands/${requestId}/fromStatus`]: result.fromStatus,
    };
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
