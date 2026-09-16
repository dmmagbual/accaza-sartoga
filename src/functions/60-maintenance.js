exports.pruneEphemeralNodes = onSchedule(
  {schedule: "every day 03:30", timeZone: "Asia/Manila", region: ORDER_REGION, timeoutSeconds: 300, memory: "256MiB"},
  async () => {
    const db = getDatabase(), now = Date.now(), DAY = 86400000;
    try { logger.info("Books net summaries healed", await healRecentBooksNet(db, now)); } catch (error) { logger.error("Books net summary heal failed", {error: String(error)}); }
    const deletions = {};
    const mark = (path) => { deletions[path] = null; };

    // orderLocks/{uid}/{signature} = {t} — duplicate-submit guard (minute-scale)
    const locks = (await db.ref("/orderLocks").get()).val() || {};
    Object.keys(locks).forEach((uid) => {
      const sigs = locks[uid] || {};
      Object.keys(sigs).forEach((sig) => {
        if (now - Number((sigs[sig] && sigs[sig].t) || 0) > 7 * DAY) mark(`orderLocks/${uid}/${sig}`);
      });
    });

    // rateLimits/orders/{uid} = {start,count} — 1-minute windows
    const rl = (await db.ref("/rateLimits/orders").get()).val() || {};
    Object.keys(rl).forEach((uid) => {
      if (now - Number((rl[uid] && rl[uid].start) || 0) > 7 * DAY) mark(`rateLimits/orders/${uid}`);
    });

    // orderStatusCommands/{requestId} = {createdAt,appliedAt} — status idempotency
    const cmds = (await db.ref("/orderStatusCommands").get()).val() || {};
    Object.keys(cmds).forEach((rid) => {
      const ts = Number((cmds[rid] && (cmds[rid].appliedAt || cmds[rid].createdAt)) || 0);
      if (ts && now - ts > 45 * DAY) mark(`orderStatusCommands/${rid}`);
    });

    // orderCorrectionCommands/{requestId} — correction idempotency claims;
    // durable correction evidence remains in orderCorrections and audit records.
    const correctionCmds = (await db.ref("/orderCorrectionCommands").get()).val() || {};
    Object.keys(correctionCmds).forEach((rid) => {
      const ts = Number((correctionCmds[rid] && (correctionCmds[rid].postedAt || correctionCmds[rid].claimedAt)) || 0);
      if (ts && now - ts > 45 * DAY) mark(`orderCorrectionCommands/${rid}`);
    });

    // clientTelemetryDaily/{YYYY-MM-DD} — keep ~4 months
    const cutoffDay = financeDateFromTimestamp(now - 120 * DAY);
    const tel = (await db.ref("/clientTelemetryDaily").get()).val() || {};
    Object.keys(tel).forEach((day) => { if (day < cutoffDay) mark(`clientTelemetryDaily/${day}`); });

    // Production-monitor history is change-only and sanitized; retain the same
    // bounded four-month window as client telemetry.
    const monitorHistory = (await db.ref("/systemHealth/productionMonitor/history").get()).val() || {};
    Object.keys(monitorHistory).forEach((day) => { if (day < cutoffDay) mark(`systemHealth/productionMonitor/history/${day}`); });

    const paths = Object.keys(deletions);
    for (let i = 0; i < paths.length; i += 400) {
      const chunk = {};
      paths.slice(i, i + 400).forEach((p) => { chunk[p] = null; });
      await db.ref().update(chunk);
    }
    logger.info("pruneEphemeralNodes complete", {deleted: paths.length});
    return null;
  },
);

// Customer confirmation is optional. If neither the customer nor cashier closes
// a Ready online order, finalize it after two hours so it cannot remain active
// indefinitely. The authoritative order remains available for history/reports.
exports.autoCompleteReadyOnlineOrders = onSchedule(
  {schedule: "every 15 minutes", timeZone: "Asia/Manila", region: ORDER_REGION, timeoutSeconds: 120, memory: "256MiB"},
  async () => {
    const db = getDatabase(), now = Date.now();
    const active = (await db.ref("/activeOrders").orderByChild("status").equalTo("Ready").limitToLast(250).get()).val() || {};
    let completed = 0;
    for (const orderId of Object.keys(active)) {
      if (!readyForAutoComplete(active[orderId], now)) continue;
      const result = await db.ref(`/orders/${orderId}`).transaction((order) => {
        if (!readyForAutoComplete(order, now)) return;
        return Object.assign({}, order, {status: "Completed", completedAt: now, statusUpdatedAt: now, statusUpdatedBy: "system", completionReason: "ready_timeout"});
      });
      if (!result.committed) continue;
      const order = result.snapshot.val() || {}, writes = {
        [`operationalAudit/${now}_auto_complete_${orderId}`]: {action: "auto_complete_ready_order", sourceType: "order", sourceId: orderId, ts: now, actorUid: "system", actorRole: "system", schemaVersion: 1},
      };
      if (order.ownerUid) writes[`customerOrders/${order.ownerUid}/${orderId}/status`] = "Completed";
      await db.ref().update(writes);
      completed++;
    }
    logger.info("autoCompleteReadyOnlineOrders complete", {completed});
    return null;
  },
);

// Release 8B: automated recovery point. Snapshots the durable business data to
// Cloud Storage once a day and keeps 30 days. Transient/reconstructable nodes
// (active-order projections, locks, rate windows, status-command claims, offline
// sync scratch, daily telemetry) are excluded — a restore rebuilds those. This
// is the safety net behind a corrupt write, a bad delete, or human error.
const BACKUP_EXCLUDE = new Set(["activeOrders", "orderLocks", "rateLimits", "orderStatusCommands", "orderCorrectionCommands", "offlinePosSync", "clientTelemetryDaily", BackupDelta.DIRTY_ROOT]);
// Keys of a node without downloading its values (REST shallow read with the
// function's own credential).
async function shallowDatabaseKeys(db, path) {
  const token = await getApp().options.credential.getAccessToken();
  const base = db.ref().toString().replace(/\/$/, "");
  const response = await fetch(`${base}/${path ? `${path}/` : ""}.json?shallow=true`, {headers: {Authorization: `Bearer ${token.access_token}`}});
  if (!response.ok) throw new Error(`Shallow read of /${path} failed with HTTP ${response.status}`);
  const value = await response.json();
  return value && typeof value === "object" ? Object.keys(value) : [];
}

async function latestBackupEnvelope(bucket) {
  const [files] = await bucket.getFiles({prefix: "db-backups/accaza-"});
  const newest = files.filter((file) => /\.json$/.test(file.name)).sort((a, b) => String(b.name).localeCompare(String(a.name)))[0];
  if (!newest) return null;
  const [buffer] = await newest.download();
  const envelope = JSON.parse(buffer.toString("utf8"));
  const check = RecoveryValidation.validateEnvelope(envelope, {reconcile: false});
  return check.ok ? Object.assign(envelope, {objectName: newest.name}) : null;
}

// Incremental snapshot: tracked history nodes come from the previous verified backup plus the
// records marked dirty since; every other node is read in full, and one ~2 MB key range of the
// tracked history is re-read and verified in rotation (see functions/lib/backup-delta.js).
async function incrementalSnapshot(db, base, dirty, now) {
  const topLevel = await shallowDatabaseKeys(db, ""), children = {};
  for (const root of Object.keys(BackupDelta.partialRoots())) if (topLevel.includes(root)) children[root] = await shallowDatabaseKeys(db, root);
  const slice = BackupDelta.rotationSlice(now, BackupDelta.verificationSlices(base));
  const plan = BackupDelta.planIncremental({base, topLevel, children, excluded: BACKUP_EXCLUDE, dirty, verify: slice});
  const values = {};
  for (const path of plan.fullNodes.concat(plan.fullTracked)) values[path] = (await db.ref(`/${path}`).get()).val();
  for (let i = 0; i < plan.records.length; i += 50) {
    await Promise.all(plan.records.slice(i, i + 50).map(async ({path, key}) => { values[`${path}/${key}`] = (await db.ref(`/${path}/${key}`).get()).val(); }));
  }
  let sliceValue = null;
  if (plan.verifySlice) {
    let query = db.ref(`/${plan.verifySlice.path}`).orderByKey();
    if (plan.verifySlice.start != null) query = query.startAt(plan.verifySlice.start);
    if (plan.verifySlice.before != null) query = query.endBefore(plan.verifySlice.before);
    sliceValue = (await query.get()).val();
  }
  const data = BackupDelta.mergeIncremental(base, plan, values);
  const drift = BackupDelta.applyVerifiedSlice(data, plan.verifySlice, sliceValue);
  return {data, plan, drift};
}

async function clearBackupDirty(db, dirty) {
  const jobs = [];
  Object.keys(dirty || {}).forEach((node) => Object.keys(dirty[node] || {}).forEach((key) => {
    const seen = dirty[node][key];
    jobs.push(() => db.ref(`/${BackupDelta.DIRTY_ROOT}/${node}/${key}`).transaction((current) => (current === seen ? null : current), undefined, false));
  }));
  for (let i = 0; i < jobs.length; i += 50) await Promise.all(jobs.slice(i, i + 50).map((job) => job()));
  return jobs.length;
}

async function createVerifiedDatabaseBackup(now = Date.now(), options = {}) {
    const db = getDatabase(), bucket = getStorage().bucket(PROOF_BUCKET);
    const latest = (await db.ref("/systemHealth/backups/latest").get()).val() || {};
    // Markers are captured before any record is read, so a change during the backup keeps its marker.
    const dirty = (await db.ref(`/${BackupDelta.DIRTY_ROOT}`).get()).val() || {};
    let base = null;
    try { base = await latestBackupEnvelope(bucket); } catch (error) { logger.warn("Previous backup could not be loaded; running a full backup", {error: String(error)}); }
    const fullReason = BackupDelta.needsFullBackup({base, now, force: options.full === true, lastMode: latest.mode});
    let snapshot = {}, mode = "full", drift = null, records = 0, verified = null;
    if (fullReason) {
      const root = (await db.ref("/").get()).val() || {};
      Object.keys(root).forEach((node) => { if (!BACKUP_EXCLUDE.has(node)) snapshot[node] = root[node]; });
    } else {
      const built = await incrementalSnapshot(db, base, dirty, now);
      verified = built.plan.verifySlice;
      snapshot = built.data; mode = "incremental"; records = built.plan.records.length; drift = built.drift;
      if (drift.length) logger.warn("Incremental backup drift corrected by today's verification read", {slice: verified, count: drift.length, sample: drift.slice(0, 20)});
    }
    const stamp = new Date(now).toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const objectName = `db-backups/accaza-${stamp}.json`;
    const envelope = RecoveryValidation.createEnvelope(snapshot, now, BACKUP_EXCLUDE);
    // Always preserve a recovery point, even when the business data later needs
    // reconciliation. Upload is blocked only for an invalid/corrupt envelope;
    // the isolated restore gate performs the strict accounting validation.
    const validation = RecoveryValidation.validateEnvelope(envelope, {reconcile: false});
    if (!validation.ok) throw new Error(`Backup validation failed: ${validation.issues.join("; ")}`);
    const payload = JSON.stringify(envelope);
    await bucket.file(objectName).save(payload, {
      resumable: false, contentType: "application/json",
      metadata: {cacheControl: "private, max-age=0, no-store", metadata: {takenAt: String(now), dataSha256: validation.actualSha256, backupVersion: "backup-v2"}},
    });
    const lastFullAt = mode === "full" ? now : Number(latest.lastFullAt) || null;
    await db.ref("/systemHealth/backups/latest").set({takenAt: now, objectName, bytes: payload.length, nodes: Object.keys(snapshot).length, version: "backup-v2", dataSha256: validation.actualSha256, validation: "passed", mode, fullReason: fullReason || null, lastFullAt, baseObject: mode === "incremental" ? base.objectName : null, recordsReread: records, verifiedSlice: verified, driftRecords: drift ? drift.length : null});
    const cleared = await clearBackupDirty(db, dirty);
    // Retention: delete snapshots older than 30 days.
    let removed = 0;
    try {
      const [files] = await bucket.getFiles({prefix: "db-backups/"});
      const cutoff = now - 30 * 86400000;
      await Promise.all(files.map(async (file) => {
        const created = Date.parse((file.metadata && file.metadata.timeCreated) || "") || 0;
        if (created && created < cutoff) { await file.delete({ignoreNotFound: true}); removed++; }
      }));
    } catch (error) { logger.warn("Backup retention sweep failed", {error: String(error)}); }
    logger.info("backupDatabaseDaily complete", {objectName, bytes: payload.length, nodes: Object.keys(snapshot).length, dataSha256: validation.actualSha256, removed, mode, fullReason: fullReason || null, recordsReread: records, dirtyCleared: cleared, driftRecords: drift ? drift.length : null, rev: 4});
    await evaluateProductionHealthNow(db,Date.now());
    return {takenAt:now,objectName,bytes:payload.length,nodes:Object.keys(snapshot).length,dataSha256:validation.actualSha256,validation:"passed",version:"backup-v2"};
}
// Mark written history records for the next incremental backup (tiny writes, idempotent).
function backupDirtyTrigger(path) {
  return onValueWritten({ref: `/${path}/{key}`, region: ORDER_REGION, retry: true, timeoutSeconds: 30, memory: "256MiB"}, async (event) => {
    await getDatabase().ref(`/${BackupDelta.DIRTY_ROOT}/${BackupDelta.dirtyKey(path)}/${event.params.key}`).set(Date.now());
  });
}
exports.markBackupDirtyArchivedOrders = backupDirtyTrigger("archivedOrders");
exports.markBackupDirtyInventoryMovements = backupDirtyTrigger("inventoryMovements");
exports.markBackupDirtyOrderInventoryPlans = backupDirtyTrigger("orderInventoryPlans");
exports.markBackupDirtyFinancialMovements = backupDirtyTrigger("financialMovements");
exports.markBackupDirtyCashBalanceApplied = backupDirtyTrigger("cashBalanceSummaryApplied");
exports.markBackupDirtyBooksJournal = backupDirtyTrigger("books/journal");
exports.markBackupDirtyShifts = backupDirtyTrigger("shifts");
exports.markBackupDirtyOperationalAudit = backupDirtyTrigger("operationalAudit");
exports.markBackupDirtyFinancialCommandClaims = backupDirtyTrigger("financialCommandClaims");
exports.markBackupDirtyInventoryAccounting = backupDirtyTrigger("inventoryAccounting");
exports.markBackupDirtyFinancialApprovals = backupDirtyTrigger("financialApprovals");
exports.markBackupDirtyActivityLog = backupDirtyTrigger("activityLog");
exports.markBackupDirtyCfLedger = backupDirtyTrigger("cfLedger");

exports.backupDatabaseDaily = onSchedule(
  {schedule: "every day 03:00", timeZone: "Asia/Manila", region: ORDER_REGION, timeoutSeconds: 300, memory: "512MiB"},
  async () => {await createVerifiedDatabaseBackup();return null;},
);

// A manager may recover a missed schedule without console access. This uses
// the exact scheduled path and returns metadata only, never backup contents.
exports.runDatabaseBackupNow = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 300, memory: "512MiB"},
  async (request) => {const db=getDatabase(),actor=await requirePortalUser(db,request);if(!["owner","superadmin","admin","manager"].includes(actor.role))throw new HttpsError("permission-denied","Database backup is restricted to management accounts.");return createVerifiedDatabaseBackup();},
);

async function evaluateProductionHealthNow(db=getDatabase(),now=Date.now()) {
    const today=financeDateFromTimestamp(now),yesterday=financeDateFromTimestamp(now-86400000);
    const [backupSnap,todaySnap,yesterdaySnap,previousSnap,operational]=await Promise.all([db.ref("/systemHealth/backups/latest").get(),db.ref(`/clientTelemetryDaily/${today}`).get(),db.ref(`/clientTelemetryDaily/${yesterday}`).get(),db.ref("/systemHealth/productionMonitor/current").get(),getCachedOperationalExceptions(db,now)]);
    const health=ProductionHealth.evaluate({backup:backupSnap.val()||{},telemetry:[todaySnap.val()||{},yesterdaySnap.val()||{}],operational},now),previous=previousSnap.val()||{},writes={"systemHealth/productionMonitor/current":health};
    if(previous.signature!==health.signature||previous.status!==health.status)writes[`systemHealth/productionMonitor/history/${today}/${now}`]={evaluatedAt:now,status:health.status,signature:health.signature,counts:health.counts,alerts:health.alerts};
    await db.ref().update(writes);
    logger.info("Production health evaluated",{status:health.status,critical:health.counts.critical,warning:health.counts.warning,changed:previous.signature!==health.signature,notification:"disabled"});return health;
}

// Phase 13: hourly, read-only early-warning evaluation. It records sanitized
// health evidence only; it never edits an order, stock, subledger, or journal.
exports.evaluateProductionHealth = onSchedule(
  {schedule: "every 60 minutes", timeZone: "Asia/Manila", region: ORDER_REGION, timeoutSeconds: 120, memory: "256MiB"},
  async () => {await evaluateProductionHealthNow();return null;},
);
