"use strict";

async function mergeMetadataIntoAuthoritativeOrder(db, orderId, metadata) {
  const liveRef = db.ref(`/orders/${orderId}`);
  const live = await liveRef.transaction((current) => current ? Object.assign({}, current, metadata) : undefined);
  if (live.committed) return {node:"orders", order:live.snapshot.val()};
  const archivedRef = db.ref(`/archivedOrders/${orderId}`);
  const archived = await archivedRef.transaction((current) => current ? Object.assign({}, current, metadata) : undefined);
  if (archived.committed) return {node:"archivedOrders", order:archived.snapshot.val()};
  throw new Error(`Order ${orderId} has no authoritative live or archived record.`);
}

module.exports = {mergeMetadataIntoAuthoritativeOrder};
