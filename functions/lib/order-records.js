"use strict";

function isAuthoritativeOrder(order) {
  return !!(order && (order.id || order.status || Array.isArray(order.lineItems) || order.total != null || order.timestamp));
}

function isOnlyAttemptedMetadata(order, metadata) {
  if (!order || typeof order !== "object") return false;
  const keys = Object.keys(order), allowed = new Set(Object.keys(metadata || {}));
  return keys.length > 0 && keys.every((key) => allowed.has(key) && JSON.stringify(order[key]) === JSON.stringify(metadata[key]));
}

async function mergeAt(ref, node, metadata) {
  const before = (await ref.get()).val();
  if (!isAuthoritativeOrder(before)) return null;
  await ref.update(metadata);
  const after = (await ref.get()).val();
  if (isAuthoritativeOrder(after)) return {node, order:after};
  // Archival can move the order between the read and update. Remove only the
  // exact metadata-only node this attempt created; never remove an ambiguous
  // or newly authoritative record.
  if (isOnlyAttemptedMetadata(after, metadata)) {
    await ref.remove();
    return null;
  }
  throw new Error(`Order metadata update for ${node} lost its authoritative identity.`);
}

async function mergeMetadataIntoAuthoritativeOrder(db, orderId, metadata) {
  const liveRef = db.ref(`/orders/${orderId}`);
  const live = await mergeAt(liveRef, "orders", metadata);
  if (live) return live;
  const archivedRef = db.ref(`/archivedOrders/${orderId}`);
  const archived = await mergeAt(archivedRef, "archivedOrders", metadata);
  if (archived) return archived;
  throw new Error(`Order ${orderId} has no authoritative live or archived record.`);
}

module.exports = {isAuthoritativeOrder, isOnlyAttemptedMetadata, mergeMetadataIntoAuthoritativeOrder};
