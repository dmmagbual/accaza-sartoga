
// Reverse a settled platform payout: unwinds the settlement posting (append-only
// reversing entry), and sends its orders back to unsettled so they can be
// re-settled correctly. The payout record is kept and marked reversed (audit).
exports.reversePlatformPayout = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 60, memory: "256MiB"},
  async (request) => {
    const db = getDatabase(); const actor = await requirePortalPermission(db, request, ["receivables"]);
    const data = request.data || {}, payoutId = financeKey(data.payoutId, "Payout ID"), reason = financeText(data.reason, 300);
    if (!reason) throw new HttpsError("invalid-argument", "Reversal reason is required.");
    const payout = (await db.ref(`/platformPayouts/${payoutId}`).get()).val();
    if (!payout) throw new HttpsError("not-found", "Payout not found.");
    if (payout.reversed) throw new HttpsError("already-exists", "This payout has already been reversed.");
    const channel = financeText(payout.channel, 30), ids = Array.isArray(payout.orderIds) ? payout.orderIds : [];
    const expected = Financial.money(payout.expectedNet), actual = Financial.money(payout.actualPayout), allocations = payout.allocations || {}, allocationRefs = payout.allocationRefs || {}, allocationMeta = payout.allocationMeta || {};
    const owing = Financial.money(payout.owing), owingApplied = Financial.money(payout.owingApplied), owingOutstanding = Financial.money(payout.owingOutstanding);
    if (owing > 0.009 && Math.abs(owingOutstanding - owing) > 0.009) throw new HttpsError("failed-precondition", "This payout\u2019s owing was already recovered by a later payout. Reverse that payout first.");
    const approval = await claimManagerApproval(db, data, "reverse_platform_payout", payoutId, null, `reverse_payout_${payoutId}`);
    const defs = (await db.ref("/platformVarAccounts").get()).val() || {};
    const lines = [Financial.line(`asset:platform_receivable:${channel}`, expected, 0, "Restore platform receivable")];
    if (payout.depositMovementId && !payout.depositReversalMovementId) { const depositAccount=accountIdFor((await db.ref("/cfAccounts").get()).val()||{},payout.accountId); lines.push(Financial.line(`asset:platform_clearing:${channel}`,actual,0,"Reverse deposited payout")); lines.push(Financial.line(`asset:cash_account:${depositAccount}`,0,actual,"Reverse deposited payout")); }
    if (owing > 0.009) { lines.push(Financial.line(`liability:platform_owing:${channel}`, owing, 0, "Reverse owing to platform")); } else { lines.push(Financial.line(`asset:platform_clearing:${channel}`, 0, actual, "Reverse actual payout clearing")); if (owingApplied > 0.009) lines.push(Financial.line(`liability:platform_owing:${channel}`, 0, owingApplied, "Reverse prior-owing recovery")); }
    Object.keys(allocations).forEach((id) => { const value = Financial.money(allocations[id]); if (!(value > 0)) return; const def = allocationMeta[id] || defs[id] || {}, sourceRef = financeText(def.sourceRef || allocationRefs[id], 120), label = `Reverse ${def.name || id}${sourceRef ? ` · ${sourceRef}` : ""}`; if (def.type === "revenue") lines.push(Financial.line(`revenue:platform_variance:${id}`, value, 0, label)); else lines.push(Financial.line(`expense:platform_variance:${id}`, 0, value, label)); });
    const now = Date.now(), movement = Financial.movement("platform_payout_reversal", "platformPayout", payoutId, lines, {occurredAt: now, approvalId: approval.id, approvedBy: approval.record.approvedEmail || approval.record.approvedRole});
    const writes = Object.assign({}, approval.usedWrites);
    const found = await Promise.all(ids.map((id) => findOrder(db, id).catch(() => null)));
    found.forEach((entry) => { if (!entry) return; if ((entry.order.payoutId || "") === payoutId) { writes[`${entry.node}/${entry.id}/settlementStatus`] = "unsettled"; writes[`${entry.node}/${entry.id}/payoutId`] = ""; } });
    if (owingApplied > 0.009 && Array.isArray(payout.owingRecoveredSources)) { const allPo = (await db.ref("/platformPayouts").get()).val() || {}; payout.owingRecoveredSources.forEach((sid) => { const src = allPo[sid] || {}; writes[`platformPayouts/${sid}/owingOutstanding`] = Financial.money(src.owing); writes[`platformPayouts/${sid}/owingRecoveredBy`] = null; writes[`platformPayouts/${sid}/owingRecoveredAt`] = null; }); }
    writes[`platformPayouts/${payoutId}/reversed`] = true;
    writes[`platformPayouts/${payoutId}/reversedAt`] = now;
    writes[`platformPayouts/${payoutId}/reversedBy`] = actor.uid;
    writes[`platformPayouts/${payoutId}/reversalReason`] = reason;
    writes[`platformPayouts/${payoutId}/reversalApprovalId`] = approval.id;
    if (payout.depositMovementId && !payout.depositReversalMovementId) { const reverseDate=financeDateFromTimestamp(now); writes[`platformPayouts/${payoutId}/depositReversalMovementId`]=`reverse_payout_${payoutId}`; writes[`platformPayouts/${payoutId}/depositReversedAt`]=now; writes[`cfLedger/fm_reverse_payout_${payoutId}`]=cashLedgerRecord({date:reverseDate,accountId:payout.accountId,dir:"out",category:"Platform payout reversal",amount:actual,party:channel,ref:payout.depositReference||payoutId,auto:true},`reverse_payout_${payoutId}`,movement,actor); }
    writes[`operationalAudit/${now}_reverse_payout_${payoutId}`] = {action: "reverse_platform_payout", sourceType: "platformPayout", sourceId: payoutId, channel, amount: actual, orderCount: ids.length, actorUid: actor.uid, actorRole: actor.role, approvalId: approval.id, reason, ts: now, schemaVersion: 1};
    const committed = await commitFinancial(db, `reverse_payout_${payoutId}`, movement, actor, writes);
    return {payoutId, orderCount: ids.length, duplicate: committed.duplicate};
  },
);
