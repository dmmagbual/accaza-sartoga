const HISTORICAL_ARCHIVE_BATCH_LIMIT = 100;
const HISTORICAL_READ_PAGE_LIMIT = 100;

async function publishHistoricalChange(db, orderId, order, now = Date.now()) {
  // Atomic, bounded journal: concurrent archivers cannot overwrite unseen IDs.
  // Older clients continue using the top-level marker fields.
  await db.ref("/historicalArchiveSync").transaction((current) => {
    const sequence = (Number(current && current.sequence) || 0) + 1;
    const change = {sequence, orderId, deleted: !order};
    const changes = Object.assign({}, current && current.changes || {}, {[sequence]: change});
    Object.keys(changes).forEach((key) => { if (!changes[key] || Number(key) <= sequence - 32) delete changes[key]; });
    return {version: now, orderId, deleted: !order, salesAt: order ? HistoricalArchive.salesAt(order) : 0,
      orderTimestamp: Number(order && order.timestamp) || 0, schemaVersion: 2, sequence, changes};
  });
}

function historicalReadCursor(raw) {
  if (!raw || typeof raw !== "object") return null;
  const value = Number(raw.value), id = financeText(raw.id, 160);
  return Number.isFinite(value) && id ? {value, id} : null;
}

async function historicalOrdersFromDocuments(db, documents) {
  const unique = new Map();
  documents.forEach((snapshot) => unique.set(snapshot.id, snapshot));
  const rows = {}, fallbackIds = [];
  let unverified = 0;
  for (const [orderId, snapshot] of unique) {
    const document = snapshot.data() || {}, order = document.order;
    // The replica's order copy is rewritten from RTDB on every archivedOrders
    // write before readers are notified, so it is current whether or not its
    // accounting evidence is complete. Evidence completeness is reported by the
    // archive and exception controls; it is not a reason to re-download the
    // source order on every report page (34% of replicas are legacy/unsettled).
    if (!order || document.schemaVersion !== HistoricalArchive.SCHEMA_VERSION) fallbackIds.push(orderId);
    else {
      if (!document.evidence || document.evidence.verified !== true) unverified++;
      rows[orderId] = HistoricalArchive.clean(Object.assign({id: orderId}, order, document.salesLedger ? {_historicalLedger: document.salesLedger} : {}));
    }
  }
  await Promise.all(fallbackIds.map(async (orderId) => {
    const source = (await db.ref(`/archivedOrders/${orderId}`).get()).val();
    if (source) rows[orderId] = HistoricalArchive.clean(Object.assign({id: orderId}, source));
  }));
  return {rows, firestore: unique.size - fallbackIds.length, rtdbFallback: fallbackIds.length, unverified};
}

let historicalSalesAtReadyCache = {value:false, at:0};
async function historicalSalesAtReady(db) {
  const now = Date.now(), ttl = historicalSalesAtReadyCache.value ? 5 * 60000 : 30000;
  if (now - historicalSalesAtReadyCache.at < ttl) return historicalSalesAtReadyCache.value;
  const value = (await db.ref("/systemHealth/historicalArchive/salesAtReady").get()).val() === true;
  historicalSalesAtReadyCache = {value, at:now};
  return value;
}

async function historicalPeriodPage(db, firestore, data, limit) {
  const start = Number(data.startAt), end = Number(data.endAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || end - start > 400 * 86400000) {
    throw new HttpsError("invalid-argument", "Choose a valid historical period of 400 days or less.");
  }
  if (await historicalSalesAtReady(db)) {
    const cursor = historicalReadCursor(data.cursor);
    let query = firestore.collection(HistoricalArchive.COLLECTION)
      .where("salesAt", ">=", start).where("salesAt", "<=", end)
      .orderBy("salesAt", "asc").orderBy(FieldPath.documentId(), "asc");
    if (cursor) query = query.startAfter(cursor.value, cursor.id);
    const snapshot = await query.limit(limit + 1).get(), documents = snapshot.docs.slice(0, limit), last = documents[documents.length - 1];
    return {documents, cursor:last ? {value:Number(last.get("salesAt")) || 0, id:last.id} : cursor, hasMore:snapshot.size > limit};
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

async function historicalLatestPage(db, firestore, data, limit) {
  const cursor = historicalReadCursor(data.cursor);
  const field = await historicalSalesAtReady(db) ? "salesAt" : "order.timestamp";
  let query = firestore.collection(HistoricalArchive.COLLECTION)
    .orderBy(field, "desc").orderBy(FieldPath.documentId(), "desc");
  if (cursor) query = query.startAfter(cursor.value, cursor.id);
  const snapshot = await query.limit(limit + 1).get(), documents = snapshot.docs.slice(0, limit), last = documents[documents.length - 1];
  return {documents, cursor: last ? {value: Number(last.get(field)) || 0, id: last.id} : cursor, hasMore: snapshot.size > limit};
}

async function historicalArchiveInputs(db, orderId, order) {
  const refundCents = Math.round((Number(order && order.refundAmount) || 0) * 100);
  const refundMovementId = refundCents > 0 ? `refund_${orderId}_${refundCents}` : "";
  const remainingCents = Math.max(0, Math.round((Number(order && order.total) || 0) * 100) - refundCents);
  const voidMovementId = order && order.voided === true && remainingCents > 0 ? `void_${orderId}` : "";
  const [movementSnap, inventoryPlanSnap] = await Promise.all([
    db.ref("/financialMovements").orderByChild("sourceId").equalTo(orderId).get(),
    db.ref(`/orderInventoryPlans/${orderId}`).get(),
  ]);
  const salesMovements = movementSnap.val() || {};
  const saleMovement = salesMovements[`sale_${orderId}`] || null;
  const refundMovement = refundMovementId ? salesMovements[refundMovementId] || null : null;
  const voidMovement = voidMovementId ? salesMovements[voidMovementId] || null : null;
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
    saleMovement, saleMovementId: `sale_${orderId}`, salesMovements,
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
  // Publish even for a duplicate: a retry must repair a failed marker write.
  await publishHistoricalChange(db, orderId, order, now);
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
      await publishHistoricalChange(db, orderId, null, now);
      return;
    }
    const result = await replicateHistoricalOrder(db, firestore, orderId, order, now);
    // Always publish after the Firestore transaction. If the marker write is
    // the only failed step, a retry must still wake readers after the document
    // has become an unchanged duplicate.
    logger.info("Historical order replica refreshed", result);
  },
);

// Admin history is served from the Firestore replica. Only records whose
// replica is missing or on an older schema are read from their exact RTDB
// source; the browser never receives a broad archivedOrders snapshot here.
exports.readHistoricalOrders = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 60, memory: "256MiB"},
  async (request) => {
    const db = getDatabase();
    await requirePortalPermission(db, request, ["orders"]);
    const data = request.data || {}, mode = financeText(data.mode, 20).toLowerCase();
    if (!["latest", "before", "period", "ids"].includes(mode)) throw new HttpsError("invalid-argument", "Historical read mode is invalid.");
    const limit = Math.max(1, Math.min(HISTORICAL_READ_PAGE_LIMIT, Math.floor(Number(data.limit) || HISTORICAL_READ_PAGE_LIMIT)));
    const firestore = getFirestore();
    if (mode === "ids") {
      if (!Array.isArray(data.ids) || !data.ids.length || data.ids.length > 32 ||
        data.ids.some((id) => typeof id !== "string" || !id || id.length > 160 || /[.#$\[\]\/\u0000-\u001f\u007f]/.test(id))) {
        throw new HttpsError("invalid-argument", "Choose between 1 and 32 valid order IDs.");
      }
      const ids = [...new Set(data.ids)];
      const documents = await firestore.getAll(...ids.map((id) => firestore.collection(HistoricalArchive.COLLECTION).doc(id)));
      const hydrated = await historicalOrdersFromDocuments(db, documents.filter((document) => document.exists));
      // A missing replica can be a replication race, not a deleted operational sale.
      for (const document of documents.filter((document) => !document.exists)) {
        const order = (await db.ref(`/archivedOrders/${document.id}`).get()).val();
        if (order) hydrated.rows[document.id] = HistoricalArchive.clean(Object.assign({id:document.id},order));
      }
      return {orders:hydrated.rows, hasMore:false, deletionEnabled:false};
    }
    const page = mode === "period" ? await historicalPeriodPage(db, firestore, data, limit) : await historicalLatestPage(db, firestore, data, limit);
    const hydrated = await historicalOrdersFromDocuments(db, page.documents);
    return {
      orders: hydrated.rows, cursor: page.cursor || null, hasMore: page.hasMore,
      source: {firestore: hydrated.firestore, rtdbFallback: hydrated.rtdbFallback, unverified: hydrated.unverified},
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
    if (!["preview", "backfill", "verify", "sales-at-audit", "sales-at-backfill", "sales-at-verify", "sales-ledger-backfill"].includes(action)) {
      throw new HttpsError("invalid-argument", "Choose a supported historical replica maintenance action. RTDB deletion is not available.");
    }
    const requested = Math.floor(Number(data.limit) || 25), limit = Math.max(1, Math.min(HISTORICAL_ARCHIVE_BATCH_LIMIT, requested));
    const cursor = financeText(data.cursor, 160);
    const firestore = getFirestore();
    // This maintenance path deliberately reads only the Firestore replica.
    // Replaying historicalArchiveInputs here would re-read RTDB financial and
    // inventory evidence for every historical order, defeating this cost fix.
    if (["sales-at-audit", "sales-at-backfill", "sales-at-verify", "sales-ledger-backfill"].includes(action)) {
      let runId = financeText(data.runId, 100), stateRef = null;
      if (action === "sales-at-backfill") {
        stateRef = db.ref("/systemHealth/historicalArchive/salesAtBackfill");
        const state = (await stateRef.get()).val() || {};
        if (!cursor) runId = `${Date.now()}_${String(actor.uid).slice(0, 24)}`;
        else if (!runId || state.runId !== runId || state.expectedCursor !== cursor || state.complete === true) {
          throw new HttpsError("failed-precondition", "Continue the active salesAt backfill with its returned run ID and cursor, or restart from the beginning.");
        }
      }
      let query = firestore.collection(HistoricalArchive.COLLECTION).orderBy(FieldPath.documentId());
      if (cursor) query = query.startAfter(cursor);
      const snap = await query.limit(limit).get(), docs = snap.docs;
      const summary = {scanned: docs.length, written: 0, alreadyPresent: 0, legacyOnly: 0, zeroSalesAt: 0};
      const batch = firestore.batch();
      for (const document of docs) {
        const row = document.data() || {}, order = row.order || {};
        const existing = Number(row.salesAt), stamp = HistoricalArchive.salesAt(order);
        const legacyOnly = ![order.completedAt, order.receivedAt, order.timestamp].some((value) => Number.isFinite(Number(value)) && Number(value) > 0);
        if (legacyOnly) summary.legacyOnly++;
        if (!stamp) summary.zeroSalesAt++;
        if (action === "sales-ledger-backfill") {
          if (row.salesLedger && Number(row.salesLedger.schemaVersion) === 1 && row.salesLedgerChecksum === HistoricalArchive.checksum(row.salesLedger)) { summary.alreadyPresent++; continue; }
          const refundCents = Math.round((Number(order.refundAmount) || 0) * 100), remainingCents = Math.max(0, Math.round((Number(order.total) || 0) * 100) - refundCents);
          const saleMovementId = `sale_${document.id}`, refundMovementId = refundCents > 0 ? `refund_${document.id}_${refundCents}` : "", voidMovementId = order.voided === true && remainingCents > 0 ? `void_${document.id}` : "";
          const salesMovements = (await db.ref("/financialMovements").orderByChild("sourceId").equalTo(document.id).get()).val() || {}, salesLedger = HistoricalArchive.salesLedgerSummary({salesMovements, saleMovementId, refundMovementId, voidMovementId});
          batch.update(document.ref, {salesLedger, salesLedgerChecksum:HistoricalArchive.checksum(salesLedger)});
          summary.written++;
          continue;
        }
        if (Number.isFinite(existing)) { summary.alreadyPresent++; continue; }
        if (action === "sales-at-backfill") { batch.update(document.ref, {salesAt: stamp}); summary.written++; }
      }
      if (["sales-at-backfill", "sales-ledger-backfill"].includes(action) && summary.written) await batch.commit();
      const nextCursor = docs.length === limit ? docs[docs.length - 1].id : "";
      if (action === "sales-at-backfill") {
        const progress = {runId, expectedCursor:nextCursor, complete:!nextCursor, updatedAt:Date.now(), updatedBy:actor.uid, lastSummary:summary, schemaVersion:1};
        await stateRef.set(progress);
        if (!nextCursor) {
          await db.ref("/systemHealth/historicalArchive/salesAtReady").set(true);
          historicalSalesAtReadyCache = {value:true, at:Date.now()};
        }
      }
      await db.ref(`/operationalAudit/${Date.now()}_historical_archive_${action}`).set({
        action: `historical_archive_${action}`, sourceType: "historicalOrderArchive", sourceId: nextCursor || "complete",
        actorUid: actor.uid, actorRole: actor.role, ts: Date.now(), cursor, nextCursor, summary, schemaVersion: 1,
        accounting: action === "sales-ledger-backfill"
          ? "Read exact indexed financial movements by source order solely to build a compact Firestore reporting summary; no RTDB order, inventory, subledger, journal, or financial record was changed."
          : "Firestore replica maintenance only; no RTDB order, inventory, financial movement, subledger, or Books journal was read or changed.",
      });
      return {action, cursor: nextCursor, complete: !nextCursor, summary, runId:runId || null};
    }
    let query = db.ref("/archivedOrders").orderByKey();
    if (cursor) query = query.startAt(cursor);
    const snap = await query.limitToFirst(limit + (cursor ? 1 : 0)).get(), rows = snap.val() || {};
    let ids = Object.keys(rows).sort();
    if (cursor && ids[0] === cursor) ids = ids.slice(1);
    ids = ids.slice(0, limit);
    const summary = {scanned: ids.length, written: 0, unchanged: 0, verified: 0, needsReview: 0};
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
