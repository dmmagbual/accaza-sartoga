exports.pruneEphemeralNodes = onSchedule(
  {schedule: "every day 03:30", timeZone: "Asia/Manila", region: ORDER_REGION, timeoutSeconds: 300, memory: "256MiB"},
  async () => {
    const db = getDatabase(), now = Date.now(), DAY = 86400000;
    try { logger.info("Books net summaries healed", await healRecentBooksNet(db, now)); } catch (error) { logger.error("Books net summary heal failed", {error: String(error)}); }
    const deletions = {};
    const mark = (path) => { deletions[path] = null; };

    // orderLocks/{uid}/{signature} = {t} — duplicate-submit guard (minute-scale)
    const locks = /* download-ok: bounded pruned by this daily job */(await db.ref("/orderLocks").get()).val() || {};
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
    const cmds = /* download-ok: bounded pruned by this daily job */(await db.ref("/orderStatusCommands").get()).val() || {};
    Object.keys(cmds).forEach((rid) => {
      const ts = Number((cmds[rid] && (cmds[rid].appliedAt || cmds[rid].createdAt)) || 0);
      if (ts && now - ts > 45 * DAY) mark(`orderStatusCommands/${rid}`);
    });

    // orderCorrectionCommands/{requestId} — correction idempotency claims;
    // durable correction evidence remains in orderCorrections and audit records.
    const correctionCmds = /* download-ok: bounded pruned by this daily job */(await db.ref("/orderCorrectionCommands").get()).val() || {};
    Object.keys(correctionCmds).forEach((rid) => {
      const ts = Number((correctionCmds[rid] && (correctionCmds[rid].postedAt || correctionCmds[rid].claimedAt)) || 0);
      if (ts && now - ts > 45 * DAY) mark(`orderCorrectionCommands/${rid}`);
    });

    // functionRetryAttempts/{key} — failure counters of events that later succeeded
    const staleAttempts = (await db.ref("/functionRetryAttempts").orderByChild("lastFailedAt").endAt(now - 2 * DAY).get()).val() || {};
    Object.keys(staleAttempts).forEach((key) => mark(`${RetryGuard.ATTEMPTS_ROOT}/${key}`));

    // functionFailureBudget/{function}/{day} — daily retry budgets, keep a week
    const budgets = /* download-ok: bounded one small record per failing function per day, pruned here */(await db.ref("/functionFailureBudget").get()).val() || {};
    const budgetCutoff = financeDateFromTimestamp(now - 7 * DAY);
    Object.keys(budgets).forEach((fn) => Object.keys(budgets[fn] || {}).forEach((day) => { if (day < budgetCutoff) mark(`functionFailureBudget/${fn}/${day}`); }));

    // clientTelemetryDaily/{YYYY-MM-DD} — keep ~4 months
    const cutoffDay = financeDateFromTimestamp(now - 120 * DAY);
    const tel = /* download-ok: bounded pruned by this daily job */(await db.ref("/clientTelemetryDaily").get()).val() || {};
    Object.keys(tel).forEach((day) => { if (day < cutoffDay) mark(`clientTelemetryDaily/${day}`); });

    // Historical-report rebuild throttles are transient daily counters. Keep
    // two weeks for incident review without allowing the maintenance node to grow.
    const maintenanceCutoff = financeDateFromTimestamp(now - 14 * DAY);
    const historicalBudgets = (await db.ref("/systemMaintenance/historicalArchiveDaily").get()).val() || {};
    Object.keys(historicalBudgets).forEach((day) => { if (day < maintenanceCutoff) mark(`systemMaintenance/historicalArchiveDaily/${day}`); });

    // Production-monitor history is change-only and sanitized; retain the same
    // bounded four-month window as client telemetry.
    const monitorHistory = (await db.ref("/systemHealth/productionMonitor/history").get()).val() || {};
    Object.keys(monitorHistory).forEach((day) => { if (day < cutoffDay) mark(`systemHealth/productionMonitor/history/${day}`); });

    // Loyalty, QR and AI scratch state (Oct 2026). None of it is history: OTP challenges and
    // SMS throttles expire in minutes, a QR duplicate-submit lock lives minutes, a daily stamp
    // cap or QR queue counter only matters on its own business day, and the AI usage/health
    // counters are kept a month for review. Indexed or key-range reads touch only stale rows.
    const staleOtp = (await db.ref("/loyaltyOtp").orderByChild("expiresAt").endAt(now - DAY).get()).val() || {};
    Object.keys(staleOtp).forEach((token) => mark(`loyaltyOtp/${token}`));
    const staleThrottle = (await db.ref("/loyaltyLinkThrottle").orderByChild("lastAt").endAt(now - 2 * DAY).get()).val() || {};
    Object.keys(staleThrottle).forEach((key) => mark(`loyaltyLinkThrottle/${key}`));
    const qrLocks = /* download-ok: bounded pruned by this daily job */(await db.ref("/qrOrderLocks").get()).val() || {};
    Object.keys(qrLocks).forEach((uid) => Object.keys(qrLocks[uid] || {}).forEach((sig) => {
      if (now - Number((qrLocks[uid][sig] && qrLocks[uid][sig].t) || 0) > 2 * DAY) mark(`qrOrderLocks/${uid}/${sig}`);
    }));
    const keepDays = (days) => financeDateFromTimestamp(now - days * DAY);
    const pruneDayKeys = async (root, days) => {
      const cutoff = keepDays(days), rows = (await db.ref(`/${root}`).orderByKey().endAt(cutoff).get()).val() || {};
      Object.keys(rows).forEach((day) => { if (day < cutoff) mark(`${root}/${day}`); });
    };
    await pruneDayKeys("qrOrderCounters", 7);
    await pruneDayKeys("accazaAiGuestUsage", 30);
    await pruneDayKeys("accazaAiProviderHealth", 30);
    const counterCutoff = keepDays(3);
    const counters = /* download-ok: bounded pruned by this daily job to three business days per member */(await db.ref("/loyaltyDailyCounters").get()).val() || {};
    Object.keys(counters).forEach((memberId) => Object.keys(counters[memberId] || {}).forEach((day) => { if (day < counterCutoff) mark(`loyaltyDailyCounters/${memberId}/${day}`); }));

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
        if (order == null) return null; // cold Admin SDK cache: let the server supply the order
        if (!readyForAutoComplete(order, now)) return;
        return Object.assign({}, order, {status: "Completed", completedAt: now, statusUpdatedAt: now, statusUpdatedBy: "system", completionReason: "ready_timeout"});
      });
      if (!result.committed || !result.snapshot.exists()) continue;
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

// Admin history counts archived orders only, while Finance Books posts at sale
// time, so a live order that is never archived quietly widens the Admin/Finance
// gap (Sep-Oct 2026: 88 orders, PHP 38,135.13). This sweep archives only orders a
// manager could already archive by hand, and never one whose shift is still open,
// that is still in the serving queue, that is unpaid, or that was completed
// moments ago - so an open shift and the till are never touched. Bounded,
// idempotent and audited; the whole run is skipped when
// /systemHealth/orderArchiveSweep/enabled is false, without a deploy.
const ORDER_ARCHIVE_SWEEP_SCAN_LIMIT = 300;
const ORDER_ARCHIVE_SWEEP_ARCHIVE_LIMIT = 150;

exports.sweepOrderArchive = onSchedule(
  {schedule: "every 3 hours", timeZone: "Asia/Manila", region: ORDER_REGION, timeoutSeconds: 300, memory: "256MiB"},
  async () => {
    const db = getDatabase(), stateRef = db.ref("/systemHealth/orderArchiveSweep"), state = (await stateRef.get()).val() || {};
    if (state.enabled === false) return null;
    const keys = /* download-ok: keys only, never values; the sweep needs to know how many live orders remain */ (await shallowDatabaseKeys(db, "orders")).sort(), cursor = String(state.cursor || "");
    const from = cursor ? keys.findIndex((key) => key > cursor) : 0;
    const candidates = keys.slice(from === -1 ? 0 : from).slice(0, ORDER_ARCHIVE_SWEEP_SCAN_LIMIT);
    const summary = {live: keys.length, scanned: candidates.length, archived: 0, skipped: {}};
    let lastKey = "";
    for (const orderId of candidates) {
      // The cursor records the last order this run actually decided, so a run
      // stopped by the archive cap resumes at the next one instead of skipping it.
      if (summary.archived >= ORDER_ARCHIVE_SWEEP_ARCHIVE_LIMIT) break;
      lastKey = orderId;
      try {
        const check = await orderArchiveCheck(db, orderId, {strict: true});
        if (!check.ok) { summary.skipped[check.reason] = (summary.skipped[check.reason] || 0) + 1; continue; }
        await archiveOrderNow(db, check.order, {uid: "system", role: "system"}, "auto-sweep");
        summary.archived++;
      } catch (error) {
        summary.skipped.error = (summary.skipped.error || 0) + 1;
        logger.warn("Order archive sweep skipped an order", {orderId, error: String(error && error.message || error)});
      }
    }
    const now = Date.now(), more = !!lastKey && lastKey < keys[keys.length - 1];
    summary.cursor = more ? lastKey : "";
    // One multi-path write: the run's progress and its audit record cannot half-apply.
    await db.ref().update(Object.assign({
      "systemHealth/orderArchiveSweep/cursor": summary.cursor,
      "systemHealth/orderArchiveSweep/lastRunAt": now,
      "systemHealth/orderArchiveSweep/lastSummary": summary,
      "systemHealth/orderArchiveSweep/schemaVersion": 1,
    }, {[`operationalAudit/${now}_order_archive_sweep`]: operationalAuditRecord("sweep_order_archive", "orderArchive", summary.cursor || "complete", {uid: "system", role: "system"}, summary)}));
    logger.info("sweepOrderArchive complete", summary);
    return null;
  },
);


// Release 8B: automated recovery point. Snapshots the durable business data to
// Cloud Storage once a day and keeps 30 days. Transient/reconstructable nodes
// (active-order projections, locks, rate windows, status-command claims, offline
// sync scratch, daily telemetry) are excluded — a restore rebuilds those. This
// is the safety net behind a corrupt write, a bad delete, or human error.
const BACKUP_EXCLUDE = new Set(["activeOrders", "orderLocks", "qrOrderLocks", "loyaltyOtp", "loyaltyLinkThrottle", "rateLimits", "orderStatusCommands", "orderCorrectionCommands", "offlinePosSync", "clientTelemetryDaily", BackupDelta.DIRTY_ROOT]);
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

// Full nightly copy (17 Oct 2026). From Sep 2026 the backup ran incrementally: 34 per-record
// marker triggers (markBackupDirty*) recorded every write to the history nodes so the nightly
// run could skip re-reading them. That saved about 20 MB of database download a night but the
// markers fired on every write all day and grew to about half of all Cloud Functions time (Oct
// 2026 Cloud Monitoring billable instance time). One full read of the database at 03:00 (29.3 MB
// on 14 Oct 2026) costs far less, needs no previous backup file and cannot miss a record whose
// marker failed. The envelope format is unchanged, so restores and the restore drill are too.
// functions/lib/backup-delta.js keeps the unused incremental planner in case database growth
// ever makes it worthwhile again.
async function createVerifiedDatabaseBackup(now = Date.now()) {
    const db = getDatabase(), bucket = getStorage().bucket(PROOF_BUCKET);
    const snapshot = {};
    const root = /* download-ok: the nightly full backup reads the database once */ (await db.ref("/").get()).val() || {};
    Object.keys(root).forEach((node) => { if (!BACKUP_EXCLUDE.has(node)) snapshot[node] = root[node]; });
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
    await db.ref("/systemHealth/backups/latest").set({takenAt: now, objectName, bytes: payload.length, nodes: Object.keys(snapshot).length, version: "backup-v2", dataSha256: validation.actualSha256, validation: "passed", mode: "full", lastFullAt: now});
    // The retired incremental markers left /backupDirty behind; removing it is a write, not a download.
    try { await db.ref(`/${BackupDelta.DIRTY_ROOT}`).remove(); } catch (error) { logger.warn("Retired backup marker cleanup skipped", {error: String(error)}); }
    // Legacy inline receipt images leave the voucher list after they are safely in this backup.
    // The voucher node is read in full by every backup, so this costs no extra download.
    try { await moveLegacyVoucherReceipts(db, snapshot.pettyCashVouchers || {}, now); } catch (error) { logger.warn("Legacy voucher receipt move skipped", {error: String(error)}); }
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
    logger.info("backupDatabaseDaily complete", {objectName, bytes: payload.length, nodes: Object.keys(snapshot).length, dataSha256: validation.actualSha256, removed, mode: "full", rev: 5});
    await evaluateProductionHealthNow(db,Date.now());
    return {takenAt:now,objectName,bytes:payload.length,nodes:Object.keys(snapshot).length,dataSha256:validation.actualSha256,validation:"passed",version:"backup-v2"};
}

// 2 GiB (15 Oct 2026): the whole-database snapshot outgrew 512 MiB and crashed nightly on
// 6-12 Oct unnoticed. ~25 s once a night, so the larger size costs cents a month and gives
// years of growth room; the "Daily backup failed" owner alert texts if it is ever outgrown.
exports.backupDatabaseDaily = onSchedule(
  {schedule: "every day 03:00", timeZone: "Asia/Manila", region: ORDER_REGION, timeoutSeconds: 300, memory: "2GiB"},
  async () => {await createVerifiedDatabaseBackup();return null;},
);

// A manager may recover a missed schedule without console access. This uses
// the exact scheduled path and returns metadata only, never backup contents.
exports.runDatabaseBackupNow = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 300, memory: "2GiB"},
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
