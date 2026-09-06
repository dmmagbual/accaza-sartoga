"use strict";

async function mergeMetadataIntoAuthoritativeOrder(db, orderId, metadata) {
  const liveRef = db.ref(`/orders/${orderId}`);
  // Prime the Admin SDK cache before the conditional transaction. A cold
  // Realtime Database transaction may invoke its update callback with null
  // before the server value is locally available; returning undefined at that
  // point aborts the transaction and falsely reports an existing order missing.
  // The transaction still rechecks existence, so an order moved or deleted
  // after this read cannot be recreated as a metadata-only ghost.
  const liveExisting = await liveRef.get();
  if (liveExisting.exists()) {
    const live = await liveRef.transaction((current) => current ? Object.assign({}, current, metadata) : undefined, undefined, false);
    if (live.committed) return {node:"orders", order:live.snapshot.val()};
  }
  const archivedRef = db.ref(`/archivedOrders/${orderId}`);
  const archivedExisting = await archivedRef.get();
  if (archivedExisting.exists()) {
    const archived = await archivedRef.transaction((current) => current ? Object.assign({}, current, metadata) : undefined, undefined, false);
    if (archived.committed) return {node:"archivedOrders", order:archived.snapshot.val()};
  }
  throw new Error(`Order ${orderId} has no authoritative live or archived record.`);
}

module.exports = {mergeMetadataIntoAuthoritativeOrder};
