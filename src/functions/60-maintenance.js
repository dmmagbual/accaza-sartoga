exports.pruneEphemeralNodes = onSchedule(
  {schedule: "every day 03:30", timeZone: "Asia/Manila", region: ORDER_REGION, timeoutSeconds: 300, memory: "256MiB"},
  async () => {
    const db = getDatabase(), now = Date.now(), DAY = 86400000;
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

    // clientTelemetryDaily/{YYYY-MM-DD} — keep ~4 months
    const cutoffDay = financeDateFromTimestamp(now - 120 * DAY);
    const tel = (await db.ref("/clientTelemetryDaily").get()).val() || {};
    Object.keys(tel).forEach((day) => { if (day < cutoffDay) mark(`clientTelemetryDaily/${day}`); });

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
const BACKUP_EXCLUDE = new Set(["activeOrders", "orderLocks", "rateLimits", "orderStatusCommands", "offlinePosSync", "clientTelemetryDaily"]);
exports.backupDatabaseDaily = onSchedule(
  {schedule: "every day 03:00", timeZone: "Asia/Manila", region: ORDER_REGION, timeoutSeconds: 300, memory: "256MiB"},
  async () => {
    const db = getDatabase(), bucket = getStorage().bucket(PROOF_BUCKET), now = Date.now();
    const root = (await db.ref("/").get()).val() || {};
    const snapshot = {};
    Object.keys(root).forEach((node) => { if (!BACKUP_EXCLUDE.has(node)) snapshot[node] = root[node]; });
    const stamp = new Date(now).toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const objectName = `db-backups/accaza-${stamp}.json`;
    const payload = JSON.stringify({takenAt: now, version: "backup-v1", excluded: [...BACKUP_EXCLUDE], data: snapshot});
    await bucket.file(objectName).save(payload, {
      resumable: false, contentType: "application/json",
      metadata: {cacheControl: "private, max-age=0, no-store", metadata: {takenAt: String(now)}},
    });
    await db.ref("/systemHealth/backups/latest").set({takenAt: now, objectName, bytes: payload.length, nodes: Object.keys(snapshot).length, version: "backup-v1"});
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
    logger.info("backupDatabaseDaily complete", {objectName, bytes: payload.length, nodes: Object.keys(snapshot).length, removed, rev: 2});
    return null;
  },
);
