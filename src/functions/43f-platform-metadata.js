
// Correct descriptive payout metadata from the platform or bank statement.
// This deliberately cannot change money, linked orders, receiving account, or
// Finance movements. Those remain controlled settlement/reversal workflows.
exports.setPlatformPayoutDate = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 30, memory: "256MiB"},
  async (request) => {
    const db = getDatabase(); const actor = await requirePortalPermission(db, request, ["receivables"]);
    const data = request.data || {}, payoutId = financeKey(data.payoutId, "Payout ID"), raw = financeText(data.payoutDate, 10);
    if (raw && !/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new HttpsError("invalid-argument", "Payout date must be YYYY-MM-DD.");
    const payoutSnap = await db.ref(`/platformPayouts/${payoutId}`).get();
    if (!payoutSnap.exists()) throw new HttpsError("not-found", "Payout not found.");
    const payout = payoutSnap.val() || {}, hasDepositReference = Object.prototype.hasOwnProperty.call(data, "depositReference"), hasPlatformStatementReference = Object.prototype.hasOwnProperty.call(data, "platformStatementReference"), hasNotes = Object.prototype.hasOwnProperty.call(data, "notes"), depositReference = hasDepositReference ? financeText(data.depositReference, 120) : financeText(payout.depositReference, 120), platformStatementReference = hasPlatformStatementReference ? financeText(data.platformStatementReference, 120) : financeText(payout.platformStatementReference, 120), notes = hasNotes ? financeText(data.notes, 500) : financeText(payout.notes, 500);
    const now = Date.now();
    const writes = {
      [`platformPayouts/${payoutId}/payoutDate`]: raw || null,
      [`platformPayouts/${payoutId}/metadataUpdatedAt`]: now,
      [`platformPayouts/${payoutId}/metadataUpdatedBy`]: actor.uid,
      [`operationalAudit/${now}_update_payout_metadata_${payoutId}`]: {action: "update_platform_payout_metadata", sourceType: "platformPayout", sourceId: payoutId, detail: {payoutDate: raw || "", depositReference: depositReference || "", platformStatementReference: platformStatementReference || "", notes: notes || ""}, previous: {payoutDate: payout.payoutDate || "", depositReference: payout.depositReference || "", platformStatementReference: payout.platformStatementReference || "", notes: payout.notes || ""}, financialEffect: "none", actorUid: actor.uid, actorRole: actor.role, ts: now, schemaVersion: 1},
    };
    if (hasDepositReference) writes[`platformPayouts/${payoutId}/depositReference`] = depositReference || null;
    if (hasPlatformStatementReference) writes[`platformPayouts/${payoutId}/platformStatementReference`] = platformStatementReference || null;
    if (hasNotes) writes[`platformPayouts/${payoutId}/notes`] = notes || null;
    await db.ref().update(writes);
    return {payoutId, payoutDate: raw || "", depositReference, platformStatementReference, notes, financialEffect: "none"};
  },
);
