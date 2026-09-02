
// Correct payout metadata and keep the authoritative payout date synchronized
// across the Admin subledger, Finance movements, Books journals, and cash ledger.
exports.setPlatformPayoutDate = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 30, memory: "256MiB"},
  async (request) => {
    const db = getDatabase(); const actor = await requirePortalPermission(db, request, ["receivables"]);
    const data = request.data || {}, payoutId = financeKey(data.payoutId, "Payout ID"), raw = financeDate(financeText(data.payoutDate, 10));
    const lockRef=db.ref(`/platformPayoutDateEditLocks/${payoutId}`),token=crypto.randomBytes(12).toString("hex"),startedAt=Date.now(),lock=await lockRef.transaction((current)=>!current||Number(current.claimedAt||0)<startedAt-120000?{token,claimedAt:startedAt,actorUid:actor.uid}:current,undefined,false);
    if(!lock.committed||!lock.snapshot.exists()||lock.snapshot.val().token!==token)throw new HttpsError("aborted","This payout is already being edited. Wait a moment, refresh, and try again.");
    try{
      const payoutSnap = await db.ref(`/platformPayouts/${payoutId}`).get();
      if (!payoutSnap.exists()) throw new HttpsError("not-found", "Payout not found.");
      const payout = payoutSnap.val() || {}, hasDepositReference = Object.prototype.hasOwnProperty.call(data, "depositReference"), hasPlatformStatementReference = Object.prototype.hasOwnProperty.call(data, "platformStatementReference"), hasNotes = Object.prototype.hasOwnProperty.call(data, "notes"), depositReference = hasDepositReference ? financeText(data.depositReference, 120) : financeText(payout.depositReference, 120), platformStatementReference = hasPlatformStatementReference ? financeText(data.platformStatementReference, 120) : financeText(payout.platformStatementReference, 120), notes = hasNotes ? financeText(data.notes, 500) : financeText(payout.notes, 500), oldDate=financeText(payout.payoutDate,10)||financeDateFromTimestamp(Number(payout.accountingOccurredAt||payout.settledAt)),dateChanged=oldDate!==raw,now=Date.now(),occurredAt=accountingTimestamp(raw,now),settlementMovementId=financeText(payout.movementId,160)||`payout_${payoutId}`,depositMovementId=financeText(payout.depositMovementId,160);
      const writes = {
        [`platformPayouts/${payoutId}/payoutDate`]: raw,
        [`platformPayouts/${payoutId}/metadataUpdatedAt`]: now,
        [`platformPayouts/${payoutId}/metadataUpdatedBy`]: actor.uid,
      };
      let linkedRecordsUpdated=0;
      if(dateChanged){
        await assertAccountingPeriodOpen(db,oldDate,"changing this payout date");await assertAccountingPeriodOpen(db,raw,"changing this payout date");
        const movementIds=[settlementMovementId].concat(depositMovementId?[depositMovementId]:[]),movementSnaps=await Promise.all(movementIds.map(id=>db.ref(`/financialMovements/${id}`).get())),journalSnaps=await Promise.all(movementIds.map(id=>db.ref(`/books/journal/${id}`).get())),ledgerSnap=depositMovementId?await db.ref("/cfLedger").orderByChild("movementId").equalTo(depositMovementId).get():null;
        movementSnaps.forEach((snap,index)=>{if(!snap.exists())throw new HttpsError("failed-precondition",`Linked Finance movement ${movementIds[index]} is missing. Run financial reconciliation before editing this payout date.`);});
        journalSnaps.forEach((snap,index)=>{if(!snap.exists())throw new HttpsError("failed-precondition",`Linked Finance Books journal ${movementIds[index]} is missing. Run financial reconciliation before editing this payout date.`);});
        const ledger=ledgerSnap&&ledgerSnap.val()||{};if(Object.values(ledger).some(row=>row&&(row.bankReconciled===true||row.reconciled===true||row.reconciledAt||row.bankReconciliationId||row.statementId)))throw new HttpsError("failed-precondition","This payout is bank-reconciled. Reopen its bank reconciliation before changing the payout date.");
        writes[`platformPayouts/${payoutId}/accountingOccurredAt`]=occurredAt;
        movementIds.forEach((id,index)=>{const movement=movementSnaps[index].val()||{},journal=journalSnaps[index].val()||{};writes[`financialMovements/${id}`]=Object.assign({},movement,{occurredAt,payoutDateRevision:Number(movement.payoutDateRevision||0)+1,payoutDateUpdatedAt:now,payoutDateUpdatedBy:actor.uid});writes[`books/journal/${id}`]=Object.assign({},journal,{date:raw,payoutDateRevision:Number(journal.payoutDateRevision||0)+1,updatedAt:now,updatedBy:actor.uid});linkedRecordsUpdated+=2;});
        Object.keys(ledger).forEach(id=>{const row=ledger[id]||{};writes[`cfLedger/${id}`]=Object.assign({},row,{date:raw,ts:occurredAt,payoutDateRevision:Number(row.payoutDateRevision||0)+1,payoutDateUpdatedAt:now,payoutDateUpdatedBy:actor.uid});linkedRecordsUpdated++;});
        const dates=[...new Set([oldDate,raw])];for(const date of dates){const indexes=(await db.ref(`/financialCloseIndex/${date}`).get()).val()||{};for(const closeId of Object.keys(indexes)){const current=(await db.ref(`/financialCloses/${closeId}/current`).get()).val();if(current){writes[`financialCloses/${closeId}/current/status`]="REOPENED";writes[`financialCloses/${closeId}/current/reopenedAt`]=now;writes[`financialCloses/${closeId}/current/reopenedByActivityId`]=`${now}_update_payout_date_${payoutId}`;writes[`financialCloseIndex/${date}/${closeId}/status`]="REOPENED";}}}
        writes[`platformPayoutDateRevisions/${payoutId}/${now}`]={from:oldDate,to:raw,settlementMovementId,depositMovementId:depositMovementId||null,linkedRecordsUpdated,changedAt:now,changedBy:actor.uid,changedByRole:actor.role,schemaVersion:1};
      }
      if (hasDepositReference) writes[`platformPayouts/${payoutId}/depositReference`] = depositReference || null;
      if (hasPlatformStatementReference) writes[`platformPayouts/${payoutId}/platformStatementReference`] = platformStatementReference || null;
      if (hasNotes) writes[`platformPayouts/${payoutId}/notes`] = notes || null;
      writes[`operationalAudit/${now}_update_payout_metadata_${payoutId}`] = {action: dateChanged?"update_platform_payout_date":"update_platform_payout_metadata", sourceType: "platformPayout", sourceId: payoutId, detail: {payoutDate: raw, depositReference: depositReference || "", platformStatementReference: platformStatementReference || "", notes: notes || ""}, previous: {payoutDate: oldDate, depositReference: payout.depositReference || "", platformStatementReference: payout.platformStatementReference || "", notes: payout.notes || ""}, financialEffect: dateChanged?"linked_dates_updated":"none",linkedRecordsUpdated, actorUid: actor.uid, actorRole: actor.role, ts: now, schemaVersion: 1};
      assertNoOverlappingUpdatePaths(writes,"platform payout date edit");await safeFinancialUpdate(db,writes,"platform payout date edit");
      return {payoutId, payoutDate: raw, depositReference, platformStatementReference, notes, financialEffect: dateChanged?"linked_dates_updated":"none",linkedRecordsUpdated};
    }finally{try{await lockRef.transaction(current=>current&&current.token===token?null:current,undefined,false);}catch(error){logger.error("Payout date edit lock release failed",{payoutId,message:error.message});}}
  },
);
