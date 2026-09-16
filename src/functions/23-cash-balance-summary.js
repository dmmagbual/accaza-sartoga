const CashBalances = require("./lib/cash-balances");

const CASH_SUMMARY_BATCH_SIZE = 100;
const CASH_SUMMARY_LOCK_MS = 120000;

async function rebuildCashBalanceSummary(db) {
  const movements = (await db.ref("/financialMovements").get()).val() || {};
  const rebuilt = CashBalances.splitSnapshotFromMovements(movements);
  await db.ref().update({cashBalanceSummary: rebuilt.summary, cashBalanceSummaryApplied: rebuilt.applied});
  return rebuilt.summary;
}

async function acquireCashSummaryLock(db, owner) {
  const now = Date.now();
  const result = await db.ref("/cashBalanceSummaryProcessorLock").transaction((current) => {
    if (current && current.owner !== owner && Number(current.expiresAt) > now) return;
    return {owner, acquiredAt: now, expiresAt: now + CASH_SUMMARY_LOCK_MS};
  }, undefined, false);
  return Boolean(result.committed && result.snapshot.val() && result.snapshot.val().owner === owner);
}

async function releaseCashSummaryLock(db, owner) {
  await db.ref("/cashBalanceSummaryProcessorLock").transaction((current) => current && current.owner === owner ? null : current, undefined, false);
}

async function processCashBalancePending(db, owner) {
  if (!await acquireCashSummaryLock(db, owner)) return false;
  try {
    let summary = (await db.ref("/cashBalanceSummary").get()).val() || {};
    if (summary.schemaVersion !== CashBalances.SCHEMA_VERSION || summary.complete !== true || summary.applied) summary = await rebuildCashBalanceSummary(db);
    for (let batch = 0; batch < 20; batch += 1) {
      const pendingSnap = await db.ref("/cashBalanceSummaryPending").limitToFirst(CASH_SUMMARY_BATCH_SIZE).get();
      const pending = pendingSnap.val() || {};
      const pendingKeys = Object.keys(pending);
      if (!pendingKeys.length) return true;
      const movementIds = [...new Set(pendingKeys.map((key) => String(pending[key] && pending[key].movementId || key)).filter(Boolean))];
      const rows = await Promise.all(movementIds.map(async (movementId) => {
        const [movementSnap, appliedSnap] = await Promise.all([
          db.ref(`/financialMovements/${movementId}`).get(),
          db.ref(`/cashBalanceSummaryApplied/${movementId}`).get(),
        ]);
        return {movementId, movement: movementSnap.exists() ? movementSnap.val() : null, applied: appliedSnap.exists() ? appliedSnap.val() : null};
      }));
      const writes = {};
      rows.forEach((row) => {
        if (CashBalances.contributionMatches(row.applied, row.movement)) return;
        const result = CashBalances.applyContribution(summary, row.applied, row.movement);
        summary = result.summary;
        writes[`cashBalanceSummaryApplied/${row.movementId}`] = result.applied;
      });
      writes.cashBalanceSummary = summary;
      pendingKeys.forEach((key) => { writes[`cashBalanceSummaryPending/${key}`] = null; });
      await db.ref().update(writes);
      await db.ref("/cashBalanceSummaryProcessorLock").update({expiresAt: Date.now() + CASH_SUMMARY_LOCK_MS});
    }
    throw new Error("Cash balance pending queue exceeded the bounded drain limit.");
  } finally {
    await releaseCashSummaryLock(db, owner);
  }
}

async function ensureCashBalanceSummary(db) {
  let summary = (await db.ref("/cashBalanceSummary").get()).val() || {};
  const pending = await db.ref("/cashBalanceSummaryPending").limitToFirst(1).get();
  if (summary.schemaVersion !== CashBalances.SCHEMA_VERSION || summary.complete !== true || summary.applied || pending.exists()) {
    await processCashBalancePending(db, `read_${Date.now()}_${Math.random().toString(36).slice(2)}`);
    summary = (await db.ref("/cashBalanceSummary").get()).val() || {};
  }
  if (summary.schemaVersion !== CashBalances.SCHEMA_VERSION || summary.complete !== true) throw new Error("Cash balance summary is not ready.");
  return summary;
}

exports.getCurrentCashBalances = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 60, memory: "256MiB"},
  async (request) => {
    const db = getDatabase();
    await requirePortalPermission(db, request, ["purchases", "cashflow", "payables"]);
    const [settingsSnap, activeShiftSnap] = await Promise.all([db.ref("/posSettings").get(), db.ref("/posActiveShift").get()]);
    const summary = await ensureCashBalanceSummary(db);
    return CashBalances.clientBalances(summary, settingsSnap.val() || {}, activeShiftSnap.val() || {});
  },
);

exports.updateCashBalanceSummary = onValueWritten(
  {ref: "/financialMovements/{movementId}", region: ORDER_REGION, retry: true, timeoutSeconds: 120, memory: "256MiB"},
  async (event) => {
    const db = getDatabase(), movementId = event.params.movementId;
    if (!event.data.before.exists() && !event.data.after.exists()) return;
    const queueKey = CashBalances.pendingKey(event.id, movementId);
    await db.ref(`/cashBalanceSummaryPending/${queueKey}`).set(CashBalances.pendingRecord(movementId));
    await processCashBalancePending(db, `event_${queueKey}`);
  },
);
