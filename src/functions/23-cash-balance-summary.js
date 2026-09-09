const CashBalances = require("./lib/cash-balances");

async function applyPendingCashBalanceEvents(db) {
  const pendingRef = db.ref("/cashBalanceSummaryPending"), pendingSnap = await pendingRef.get();
  const pending = pendingSnap.val() || {};
  if (!Object.keys(pending).length) return;
  await db.ref("/cashBalanceSummary").transaction((current) => {
    if (!current || current.schemaVersion !== 1 || current.complete !== true) return current;
    return CashBalances.applyPending(current, pending);
  }, undefined, false);
  const applied = (await db.ref("/cashBalanceSummary").get()).val() || {};
  const appliedRows = applied.applied || {};
  const writes = {};
  Object.keys(pending).forEach((id) => {
    if (appliedRows[id] && appliedRows[id].fingerprint === pending[id].fingerprint) writes[`cashBalanceSummaryPending/${id}`] = null;
  });
  if (Object.keys(writes).length) await db.ref().update(writes);
}

exports.getCurrentCashBalances = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 60, memory: "256MiB"},
  async (request) => {
    const db = getDatabase();
    await requirePortalPermission(db, request, ["purchases", "cashflow", "payables"]);
    const [summaryMetaSnap, balancesSnap, settingsSnap, activeShiftSnap, pendingProbeSnap] = await Promise.all([
      db.ref("/cashBalanceSummary/meta").get(), db.ref("/cashBalanceSummary/balances").get(), db.ref("/posSettings").get(), db.ref("/posActiveShift").get(), db.ref("/cashBalanceSummaryPending").limitToFirst(1).get(),
    ]);
    const settings = settingsSnap.val() || {}, activeShift = activeShiftSnap.val() || {};
    const meta = summaryMetaSnap.val() || {};
    if (meta.schemaVersion !== 1 || meta.complete !== true || pendingProbeSnap.exists()) {
      if (meta.schemaVersion === 1 && meta.complete === true && pendingProbeSnap.exists()) await applyPendingCashBalanceEvents(db);
      let summary = (await db.ref("/cashBalanceSummary").get()).val() || {};
      if (summary.schemaVersion !== 1 || summary.complete !== true) {
        const movements = (await db.ref("/financialMovements").get()).val() || {};
        summary = CashBalances.snapshotFromMovements(movements);
        const pending = (await db.ref("/cashBalanceSummaryPending").get()).val() || {};
        if (Object.keys(pending).length) CashBalances.applyPending(summary, pending);
        await db.ref("/cashBalanceSummary").transaction((current) => current && current.schemaVersion === 1 && current.complete === true ? current : summary, undefined, false);
        await applyPendingCashBalanceEvents(db);
        summary = (await db.ref("/cashBalanceSummary").get()).val() || summary;
      }
      return CashBalances.clientBalances(summary, settings, activeShift);
    }
    return CashBalances.clientBalances({balances: balancesSnap.val() || {}, meta}, settings, activeShift);
  },
);

exports.updateCashBalanceSummary = onValueWritten(
  {ref: "/financialMovements/{movementId}", region: ORDER_REGION, retry: true},
  async (event) => {
    const db = getDatabase(), movementId = event.params.movementId;
    const before = event.data.before.exists() ? event.data.before.val() : null;
    const after = event.data.after.exists() ? event.data.after.val() : null;
    if (before == null && after == null) return;
    const fingerprint = CashBalances.fingerprint(after);
    const apply = async () => db.ref("/cashBalanceSummary").transaction((current) => CashBalances.applyEvent(current, movementId, before, after), undefined, false);
    await apply();
    const current = (await db.ref("/cashBalanceSummary/meta").get()).val() || {};
    if (current.schemaVersion === 1 && current.complete === true) {
      await db.ref(`/cashBalanceSummaryPending/${movementId}`).transaction((row) => row && row.fingerprint === fingerprint ? null : row, undefined, false);
      return;
    }
    await db.ref(`/cashBalanceSummaryPending/${movementId}`).transaction((row) => row && row.fingerprint === fingerprint ? row : CashBalances.pendingRecord(before, after), undefined, false);
    await apply();
    const ready = (await db.ref("/cashBalanceSummary/meta").get()).val() || {};
    if (ready.schemaVersion === 1 && ready.complete === true) await db.ref(`/cashBalanceSummaryPending/${movementId}`).transaction((row) => row && row.fingerprint === fingerprint ? null : row, undefined, false);
  },
);
