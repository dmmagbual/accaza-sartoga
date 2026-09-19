const CashBalances = require("./lib/cash-balances");

const CASH_SUMMARY_BATCH_SIZE = 100;
const CASH_SUMMARY_LOCK_MS = 120000;

// One database write may trigger at most 1,000 function runs, and every applied record fires the
// backup marker trigger. The rebuild therefore writes applied records in bounded chunks and the
// summary last: an interrupted rebuild leaves the old summary version, so it simply runs again.
// (On 16 Sep 2026 a single 1,269-record write failed with TOO_MANY_TRIGGERS.)
const CASH_REBUILD_WRITE_CHUNK = 400;
async function rebuildCashBalanceSummary(db) {
  const movements = /* download-ok: fallback rebuild only when the cash-balance summary schema changes or is missing */(await db.ref("/financialMovements").get()).val() || {};
  const rebuilt = CashBalances.splitSnapshotFromMovements(movements);
  const existing = await shallowDatabaseKeys(db, "cashBalanceSummaryApplied");
  const applied = {};
  existing.forEach((key) => { if (!rebuilt.applied[key]) applied[key] = null; });
  Object.keys(rebuilt.applied).forEach((key) => { applied[key] = rebuilt.applied[key]; });
  const keys = Object.keys(applied);
  for (let i = 0; i < keys.length; i += CASH_REBUILD_WRITE_CHUNK) {
    const batch = {};
    keys.slice(i, i + CASH_REBUILD_WRITE_CHUNK).forEach((key) => { batch[`cashBalanceSummaryApplied/${key}`] = applied[key]; });
    await db.ref().update(batch);
  }
  // The Books cash-flow day/month index is written with the summary.
  await db.ref().update({cashFlowDaily: rebuilt.flow.daily, cashFlowMonthly: rebuilt.flow.monthly, cashFlowOpenings: rebuilt.flow.openings, cashFlowIndexMeta: rebuilt.flow.meta, cashBalanceSummary: rebuilt.summary});
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
      const writes = {}, changed = rows.filter((row) => !CashBalances.contributionMatches(row.applied, row.movement));
      // Current cash-flow index buckets touched by this batch (small day/month records).
      const days = new Set(), flow = {daily: {}, monthly: {}, openings: {}};
      changed.forEach((row) => {
        if (row.applied && row.applied.day && !row.applied.opening) days.add(row.applied.day);
        if (row.movement && !CashBalances.isCashAccountOpening(row.movement)) days.add(CashBalances.movementDay(row.movement));
      });
      const months = new Set([...days].map((day) => day.slice(0, 7)));
      await Promise.all([
        ...[...days].map(async (day) => { flow.daily[day] = (await db.ref(`/cashFlowDaily/${day}`).get()).val() || null; }),
        ...[...months].map(async (month) => { flow.monthly[month] = (await db.ref(`/cashFlowMonthly/${month}`).get()).val() || null; }),
      ]);
      changed.forEach((row) => {
        const result = CashBalances.applyContribution(summary, row.applied, row.movement);
        summary = result.summary;
        writes[`cashBalanceSummaryApplied/${row.movementId}`] = result.applied;
        CashBalances.applyFlowContribution(flow, row.movementId, row.applied, result.applied, row.movement);
      });
      Object.keys(flow.daily).forEach((day) => { writes[`cashFlowDaily/${day}`] = CashBalances.flowValue(flow.daily[day]); });
      Object.keys(flow.monthly).forEach((month) => { writes[`cashFlowMonthly/${month}`] = CashBalances.flowValue(flow.monthly[month]); });
      Object.keys(flow.openings).forEach((id) => { writes[`cashFlowOpenings/${id}`] = flow.openings[id]; });
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

// Cash balances for controls (e.g. "is there enough register cash for this refund?") without
// downloading the whole ledger: the maintained summary with its queue drained, corrected for
// movements posted or edited in the last ten minutes that the summary has not applied yet (their
// trigger may still be in flight). The processor writes the summary and its applied records in
// one update, so an unchanged summary timestamp proves the applied reads are consistent with it.
// If the queue holds an entry older than the window, fall back to the full ledger.
const CASH_RECENT_WINDOW_MS = 10 * 60 * 1000;
async function currentCashBalances(db, now = Date.now()) {
  const since = now - CASH_RECENT_WINDOW_MS;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const summary = await ensureCashBalanceSummary(db);
    const oldest = (await db.ref("/cashBalanceSummaryPending").orderByChild("queuedAt").limitToFirst(1).get()).val() || {};
    if (Object.values(oldest).some((row) => Number(row && row.queuedAt || 0) < since)) break;
    const [posted, edited] = await Promise.all([
      db.ref("/financialMovements").orderByChild("postedAt").startAt(since).get(),
      db.ref("/financialMovements").orderByChild("updatedAt").startAt(since).get(),
    ]);
    const recent = Object.assign({}, posted.val() || {}, edited.val() || {}), balances = JSON.parse(JSON.stringify(summary.balances || CashBalances.emptyBalances()));
    balances.cashAccountCents = balances.cashAccountCents || {};
    const applied = await Promise.all(Object.keys(recent).map(async (id) => [id, (await db.ref(`/cashBalanceSummaryApplied/${id}`).get()).val()]));
    applied.forEach(([id, row]) => {
      if (CashBalances.contributionMatches(row, recent[id])) return;
      if (row) CashBalances.addDelta(balances, row.delta, -1);
      CashBalances.addDelta(balances, CashBalances.movementDelta(recent[id]));
    });
    const after = (await db.ref("/cashBalanceSummary/meta/updatedAt").get()).val();
    if (Number(after) === Number(summary.meta && summary.meta.updatedAt)) return {balances, source: "summary", recentCorrections: applied.length};
  }
  const movements = /* download-ok: fallback summary lags and cannot be reconciled from the recent window */(await db.ref("/financialMovements").get()).val() || {};
  return {balances: CashBalances.splitSnapshotFromMovements(movements, now).summary.balances, source: "ledger", recentCorrections: 0};
}

exports.getCurrentCashBalances = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 60, memory: "256MiB"},
  async (request) => {
    const db = getDatabase();
    await requirePortalPermission(db, request, ["purchases", "cashflow", "payables"]);
    const [settings, activeShiftSnap] = await Promise.all([readPosSettings(db, ["fixedFloat"]), db.ref("/posActiveShift").get()]);
    const summary = await ensureCashBalanceSummary(db);
    return CashBalances.clientBalances(summary, settings, activeShiftSnap.val() || {});
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
