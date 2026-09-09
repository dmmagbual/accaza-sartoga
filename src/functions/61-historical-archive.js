const HISTORICAL_ARCHIVE_BATCH_LIMIT = 100;
const HISTORICAL_READ_PAGE_LIMIT = 100;

function historicalReadCursor(raw) {
  if (!raw || typeof raw !== "object") return null;
  const value = Number(raw.value), id = financeText(raw.id, 160);
  return Number.isFinite(value) && id ? {value, id} : null;
}

async function historicalOrdersFromDocuments(db, documents) {
  const unique = new Map();
  documents.forEach((snapshot) => unique.set(snapshot.id, snapshot));
  const rows = {}, fallbackIds = [];
  for (const [orderId, snapshot] of unique) {
    const document = snapshot.data() || {}, order = document.order;
    if (!order || document.schemaVersion !== HistoricalArchive.SCHEMA_VERSION || !document.evidence || document.evidence.verified !== true) fallbackIds.push(orderId);
    else rows[orderId] = HistoricalArchive.clean(Object.assign({id: orderId}, order));
  }
  await Promise.all(fallbackIds.map(async (orderId) => {
    const source = (await db.ref(`/archivedOrders/${orderId}`).get()).val();
    if (source) rows[orderId] = HistoricalArchive.clean(Object.assign({id: orderId}, source));
  }));
  return {rows, firestore: unique.size - fallbackIds.length, rtdbFallback: fallbackIds.length};
}

async function historicalPeriodPage(firestore, data, limit) {
  const start = Number(data.startAt), end = Number(data.endAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || end - start > 732 * 86400000) {
    throw new HttpsError("invalid-argument", "Choose a valid historical period of 732 days or less.");
  }
  const incoming = data.cursor && typeof data.cursor === "object" ? data.cursor : {}, nextCursor = {};
  const pages = await Promise.all(["completedAt", "receivedAt", "timestamp"].map(async (field) => {
    const cursor = historicalReadCursor(incoming[field]);
    let query = firestore.collection(HistoricalArchive.COLLECTION)
      .where(`order.${field}`, ">=", start).where(`order.${field}`, "<=", end)
      .orderBy(`order.${field}`, "asc").orderBy(FieldPath.documentId(), "asc");
    if (cursor) query = query.startAfter(cursor.value, cursor.id);
    const snapshot = await query.limit(limit + 1).get(), documents = snapshot.docs.slice(0, limit), last = documents[documents.length - 1];
    if (last) nextCursor[field] = {value: Number(last.get(`order.${field}`)) || 0, id: last.id};
    else if (cursor) nextCursor[field] = cursor;
    return {documents, hasMore: snapshot.size > limit};
  }));
  const documents = pages.flatMap((page) => page.documents).filter((snapshot) => {
    const order = (snapshot.data() || {}).order || {}, stamp = HistoricalArchive.salesAt(order);
    return stamp >= start && stamp <= end;
  });
  return {documents, cursor: nextCursor, hasMore: pages.some((page) => page.hasMore)};
}

async function historicalLatestPage(firestore, data, limit) {
  const cursor = historicalReadCursor(data.cursor);
  let query = firestore.collection(HistoricalArchive.COLLECTION)
    .orderBy("order.timestamp", "desc").orderBy(FieldPath.documentId(), "desc");
  if (cursor) query = query.startAfter(cursor.value, cursor.id);
  const snapshot = await query.limit(limit + 1).get(), documents = snapshot.docs.slice(0, limit), last = documents[documents.length - 1];
  return {documents, cursor: last ? {value: Number(last.get("order.timestamp")) || 0, id: last.id} : cursor, hasMore: snapshot.size > limit};
}

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
  const inventoryPlan = inventoryPlanSnap.val() || null;
  // Legacy orders predate sale-time plans. Read only their deterministic
  // order-linked movement prefix; never recalculate history from current recipes.
  const inventoryMovements = HistoricalArchive.validInventoryPlan(inventoryPlan) ? null :
    (await db.ref("/inventoryMovements").orderByKey().startAt(`sale_${orderId}_`).endAt(`sale_${orderId}_\uf8ff`).get()).val() || null;
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
    inventoryPlan,
    inventoryMovements,
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
    const db = getDatabase(), firestore = getFirestore(), orderId = event.params.orderId, order = event.data.after.val(), now = Date.now();
    if (!order) {
      await firestore.collection(HistoricalArchive.COLLECTION).doc(orderId).delete();
      await db.ref("/historicalArchiveSync").set({version: now, orderId, deleted: true, schemaVersion: 1});
      return;
    }
    const result = await replicateHistoricalOrder(db, firestore, orderId, order, now);
    // Always publish after the Firestore transaction. If the marker write is
    // the only failed step, a retry must still wake readers after the document
    // has become an unchanged duplicate.
    await db.ref("/historicalArchiveSync").set({
      version: now, orderId, deleted: false, orderTimestamp: Number(order.timestamp) || 0,
      salesAt: HistoricalArchive.salesAt(order), schemaVersion: 1,
    });
    logger.info("Historical order replica refreshed", result);
  },
);

// Admin history is served from the Firestore replica. Records whose financial
// or inventory evidence is incomplete are read from their exact RTDB source;
// the browser never receives a broad archivedOrders snapshot from this route.
exports.readHistoricalOrders = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 60, memory: "256MiB"},
  async (request) => {
    const db = getDatabase();
    await requirePortalPermission(db, request, ["orders"]);
    const data = request.data || {}, mode = financeText(data.mode, 20).toLowerCase();
    if (!["latest", "before", "period"].includes(mode)) throw new HttpsError("invalid-argument", "Historical read mode is invalid.");
    const limit = Math.max(1, Math.min(HISTORICAL_READ_PAGE_LIMIT, Math.floor(Number(data.limit) || HISTORICAL_READ_PAGE_LIMIT)));
    const firestore = getFirestore();
    const page = mode === "period" ? await historicalPeriodPage(firestore, data, limit) : await historicalLatestPage(firestore, data, limit);
    const hydrated = await historicalOrdersFromDocuments(db, page.documents);
    return {
      orders: hydrated.rows, cursor: page.cursor || null, hasMore: page.hasMore,
      source: {firestore: hydrated.firestore, rtdbFallback: hydrated.rtdbFallback},
      deletionEnabled: false,
    };
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

// If inventory finalization finishes after an order is archived, refresh the
// replica from the immutable plan. This closes the trigger race without using
// current recipes or changing the archived RTDB source.
exports.refreshHistoricalOrderAfterInventoryPlan = onValueWritten(
  {ref: "/orderInventoryPlans/{orderId}", region: ORDER_REGION, retry: true},
  async (event) => {
    if (!event.data.after.exists()) return;
    const db = getDatabase(), orderId = event.params.orderId;
    const archived = (await db.ref(`/archivedOrders/${orderId}`).get()).val();
    if (archived) await replicateHistoricalOrder(db, getFirestore(), orderId, archived);
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
