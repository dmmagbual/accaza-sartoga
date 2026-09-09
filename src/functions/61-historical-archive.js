const HISTORICAL_ARCHIVE_BATCH_LIMIT = 100;

async function historicalArchiveInputs(db, orderId, order) {
  const refundCents = Math.round((Number(order && order.refundAmount) || 0) * 100);
  const refundMovementId = refundCents > 0 ? `refund_${orderId}_${refundCents}` : "";
  const remainingCents = Math.max(0, Math.round((Number(order && order.total) || 0) * 100) - refundCents);
  const voidMovementId = order && order.voided === true && remainingCents > 0 ? `void_${orderId}` : "";
  const [saleMovementSnap, refundMovementSnap, voidMovementSnap, inventoryPlanSnap] = await Promise.all([
    db.ref(`/financialMovements/sale_${orderId}`).get(),
    refundMovementId ? db.ref(`/financialMovements/${refundMovementId}`).get() : Promise.resolve(null),
    voidMovementId ? db.ref(`/financialMovements/${voidMovementId}`).get() : Promise.resolve(null),
    db.ref(`/orderInventoryPlans/${orderId}`).get(),
  ]);
  const saleMovement = saleMovementSnap.val() || null;
  const refundMovement = refundMovementSnap && refundMovementSnap.val() || null;
  const voidMovement = voidMovementSnap && voidMovementSnap.val() || null;
  const movements = [
    {name: "sale", id: `sale_${orderId}`, movement: saleMovement},
    {name: "refund", id: refundMovementId, movement: refundMovement},
    {name: "void", id: voidMovementId, movement: voidMovement},
  ];
  const journalIds = movements.map((item) => item.movement ? BooksBridge.bucketFor(Object.assign({id: item.id}, item.movement)).key : "");
  const journals = await Promise.all(journalIds.map((id) => id ? db.ref(`/books/journal/${id}`).get() : Promise.resolve(null)));
  const linked = {};
  movements.forEach((item, index) => {
    const journal = journals[index] && journals[index].val() || null, journalId = journalIds[index];
    linked[item.name] = journal && journal.sources && journal.sources[item.id] ? {journal: {id: journalId, sourceId: item.id, included: true}, journalId} : {journal: null, journalId: ""};
  });
  return {
    order,
    saleMovement,
    // Daily Books journals contain many orders. Archive only exact membership
    // evidence so an unrelated posting cannot change this order's checksum.
    saleJournal: linked.sale.journal, saleJournalId: linked.sale.journalId,
    refundMovement, refundMovementId, refundJournal: linked.refund.journal, refundJournalId: linked.refund.journalId,
    voidMovement, voidMovementId, voidJournal: linked.void.journal, voidJournalId: linked.void.journalId,
    inventoryPlan: inventoryPlanSnap.val() || null,
  };
}

async function replicateHistoricalOrder(db, firestore, orderId, order, now = Date.now()) {
  if (!order || typeof order !== "object") return {orderId, skipped: true, reason: "source_missing"};
  const input = await historicalArchiveInputs(db, orderId, order);
  const next = HistoricalArchive.buildDocument(orderId, input, now);
  const ref = firestore.collection(HistoricalArchive.COLLECTION).doc(orderId);
  const result = await firestore.runTransaction(async (transaction) => {
    const currentSnap = await transaction.get(ref), current = currentSnap.exists ? currentSnap.data() : null;
    if (HistoricalArchive.unchanged(current, next)) return {duplicate: true};
    transaction.set(ref, next);
    return {duplicate: false};
  });
  return {orderId, duplicate: result.duplicate, verified: next.evidence.verified, issues: next.evidence.issues};
}

// Firestore is a historical replica only. RTDB remains the live POS and posting
// authority, and this trigger never removes or modifies the source record.
exports.replicateArchivedOrderToFirestore = onValueWritten(
  {ref: "/archivedOrders/{orderId}", region: ORDER_REGION, retry: true},
  async (event) => {
    const order = event.data.after.val();
    if (!order) return;
    const result = await replicateHistoricalOrder(getDatabase(), getFirestore(), event.params.orderId, order);
    logger.info("Historical order replica refreshed", result);
  },
);

// Books may be posted just after an order is archived. Refreshing from the
// journal event closes that race without making Firestore an accounting writer.
exports.refreshHistoricalOrderAfterJournal = onValueWritten(
  {ref: "/books/journal/{journalId}", region: ORDER_REGION, retry: true},
  async (event) => {
    const before = event.data.before.val() || {}, after = event.data.after.val() || {};
    const beforeSources = before.sources || {}, afterSources = after.sources || {};
    const movementIds = Object.keys(afterSources).filter((id) => !beforeSources[id]).slice(0, 20);
    if (!movementIds.length) return;
    const db = getDatabase(), firestore = getFirestore();
    for (const movementId of movementIds) {
      const movement = (await db.ref(`/financialMovements/${movementId}`).get()).val() || {};
      const sourceId = String(movement.sourceId || "");
      if (!sourceId || !BooksBridge.isSaleMovement(movement)) continue;
      const archived = (await db.ref(`/archivedOrders/${sourceId}`).get()).val();
      if (archived) await replicateHistoricalOrder(db, firestore, sourceId, archived);
    }
  },
);

exports.manageHistoricalOrderArchive = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 300, memory: "512MiB"},
  async (request) => {
    const db = getDatabase(), actor = await requirePortalUser(db, request);
    if (!["owner", "superadmin"].includes(actor.role)) {
      throw new HttpsError("permission-denied", "Historical archive management is restricted to owners.");
    }
    const data = request.data || {}, action = financeText(data.action, 20);
    if (!["preview", "backfill", "verify"].includes(action)) {
      throw new HttpsError("invalid-argument", "Use preview, backfill, or verify. RTDB deletion is not available.");
    }
    const requested = Math.floor(Number(data.limit) || 25), limit = Math.max(1, Math.min(HISTORICAL_ARCHIVE_BATCH_LIMIT, requested));
    const cursor = financeText(data.cursor, 160);
    let query = db.ref("/archivedOrders").orderByKey();
    if (cursor) query = query.startAt(cursor);
    const snap = await query.limitToFirst(limit + (cursor ? 1 : 0)).get(), rows = snap.val() || {};
    let ids = Object.keys(rows).sort();
    if (cursor && ids[0] === cursor) ids = ids.slice(1);
    ids = ids.slice(0, limit);
    const firestore = getFirestore(), summary = {scanned: ids.length, written: 0, unchanged: 0, verified: 0, needsReview: 0};
    for (const orderId of ids) {
      const input = await historicalArchiveInputs(db, orderId, rows[orderId]);
      const next = HistoricalArchive.buildDocument(orderId, input);
      const ref = firestore.collection(HistoricalArchive.COLLECTION).doc(orderId);
      if (action === "preview") {
        if (next.evidence.verified) summary.verified++; else summary.needsReview++;
        continue;
      }
      const currentSnap = await ref.get(), current = currentSnap.exists ? currentSnap.data() : null;
      if (action === "verify") {
        if (HistoricalArchive.unchanged(current, next) && next.evidence.verified) summary.verified++;
        else summary.needsReview++;
        continue;
      }
      if (HistoricalArchive.unchanged(current, next)) summary.unchanged++;
      else { await ref.set(next); summary.written++; }
      if (next.evidence.verified) summary.verified++; else summary.needsReview++;
    }
    const nextCursor = ids.length === limit ? ids[ids.length - 1] : "";
    await db.ref(`/operationalAudit/${Date.now()}_historical_archive_${action}`).set({
      action: `historical_archive_${action}`, sourceType: "historicalOrderArchive", sourceId: nextCursor || "complete",
      actorUid: actor.uid, actorRole: actor.role, ts: Date.now(), summary, schemaVersion: 1,
    });
    return {action, cursor: nextCursor, complete: !nextCursor, summary, deletionEnabled: false};
  },
);
