const UNDEPOSITED_PAGE_SIZE = 25;
const UNDEPOSITED_POOL_ACCOUNT = "asset:cash_awaiting_deposit";
const UNDEPOSITED_INDEX_VERSION = 1;

function undepositedMovementProjection(id, movement) {
  if (!movement || !Array.isArray(movement.lines)) return null;
  let incoming = 0, outgoing = 0;
  movement.lines.forEach((line) => {
    if (!line || line.account !== UNDEPOSITED_POOL_ACCOUNT) return;
    incoming = Financial.money(incoming + Financial.money(line.debit));
    outgoing = Financial.money(outgoing + Financial.money(line.credit));
  });
  if (!(incoming > 0) && !(outgoing > 0)) return null;
  if (financeText(movement.type, 80) === "petty_cash_payment_correction" && incoming > 0 && outgoing > 0 && Math.abs(Financial.money(incoming - outgoing)) < 0.005) return null;
  return {
    id,
    occurredAt: Number(movement.occurredAt || movement.postedAt || 0),
    type: financeText(movement.type, 80),
    sourceId: financeText(movement.sourceId, 160),
    sourceType: financeText(movement.sourceType, 80),
    reference: financeText(movement.reference || movement.documentNo || movement.voucherNo, 120),
    documentNo: financeText(movement.documentNo, 60),
    voucherNo: financeText(movement.voucherNo, 60),
    category: financeText(movement.category, 80),
    payee: financeText(movement.payee, 160),
    purpose: financeText(movement.purpose, 300),
    actorName: financeText(movement.actorName, 120),
    inAmount: incoming,
    outAmount: outgoing,
    netAmount: Financial.money(incoming - outgoing),
    reversalOf: financeText(movement.reversalOf, 160),
    reversedByMovementId: financeText(movement.reversedByMovementId, 160),
    schemaVersion: UNDEPOSITED_INDEX_VERSION,
  };
}

function cashCustodyProjection(id, row) {
  if (!row) return null;
  const amount = Financial.money(row.amount), paidOutAmount = Financial.money(row.paidOutAmount), depositedAmount = Financial.money(row.depositedAmount), remaining = Financial.money(row.remaining != null ? row.remaining : amount);
  if (!(amount > 0) && !(paidOutAmount > 0) && !(depositedAmount > 0) && !(remaining > 0)) return null;
  return {
    id,
    closedAt: Number(row.closedAt || row.createdAt || 0),
    shiftId: financeText(row.shiftId, 160),
    shiftReference: financeText(row.shiftReference || row.reference, 120),
    staff: financeText(row.staff, 120),
    movementId: financeText(row.movementId, 160),
    source: financeText(row.source, 80),
    status: financeText(row.status, 60),
    amount,
    paidOutAmount,
    depositedAmount,
    remaining,
    schemaVersion: UNDEPOSITED_INDEX_VERSION,
  };
}

// The open-custody projection rows a multi-path write produces, computed from the custody rows as
// they are now plus the write itself, so a writer can store the projection in the SAME update.
function custodyIndexWrites(rows, writes) {
  const next = {}, out = {}, copy = (value) => (value == null ? null : JSON.parse(JSON.stringify(value)));
  Object.keys(writes || {}).filter((path) => path.startsWith("cashCustody/")).forEach((path) => {
    const keys = path.split("/").slice(1), id = keys[0];
    if (!id) return;
    if (!Object.prototype.hasOwnProperty.call(next, id)) next[id] = copy(rows && rows[id]);
    if (keys.length === 1) { next[id] = copy(writes[path]); return; }
    if (!next[id]) next[id] = {};
    let node = next[id];
    for (const key of keys.slice(1, -1)) { if (!node[key] || typeof node[key] !== "object") node[key] = {}; node = node[key]; }
    const last = keys[keys.length - 1];
    if (writes[path] == null) delete node[last]; else node[last] = copy(writes[path]);
  });
  Object.keys(next).forEach((id) => { const record = cashCustodyProjection(id, next[id]); out[`cashCustodyOpenIndex/${id}`] = record && record.remaining > 0 ? record : null; });
  return out;
}
function openCustodyProjections(rows) {
  const out = {};
  Object.entries(rows || {}).forEach(([id, row]) => { const record = cashCustodyProjection(id, row); if (record && record.remaining > 0) out[id] = record; });
  return out;
}
function custodyIndexDrift(index, truth) {
  const writes = {}, same = (a, b) => !!a && !!b && ["amount", "paidOutAmount", "depositedAmount", "remaining"].every((field) => Financial.money(a[field]) === Financial.money(b[field]));
  Object.keys(index || {}).forEach((id) => { if (!truth[id]) writes[`cashCustodyOpenIndex/${id}`] = null; });
  Object.keys(truth).forEach((id) => { if (!same(index && index[id], truth[id])) writes[`cashCustodyOpenIndex/${id}`] = truth[id]; });
  return writes;
}
// Detective control (7 Oct 2026): every Undeposited Collection snapshot compares the compact
// projections with the authoritative records and repairs any drift, logged, never hidden.
// Cost: one bounded query of the open custody rows (the same rows the projection holds) and one
// single-node read per flagged "missing" voucher. Repairs take the custody pool claim and
// re-read first, so no payment can change a row between the check and the repair.
async function verifyUndepositedIndexes(db, indexRows, missingRows) {
  const verifyLimit = 500, openRows = async () => {
    const rows = (await db.ref("/cashCustody").orderByChild("remaining").startAt(0.005).limitToFirst(verifyLimit + 1).get()).val() || {};
    if (Object.keys(rows).length > verifyLimit) throw new HttpsError("resource-exhausted", "Undeposited Collection has more than 500 open custody rows. Deposit or archive older settled rows before running the control check.");
    return openCustodyProjections(rows);
  };
  let index = indexRows || {}, truth = await openRows(), writes = custodyIndexDrift(index, truth);
  const result = {checked: true, custodyRowsRepaired: 0, missingVouchersCleared: 0, index};
  if (Object.keys(writes).length) {
    const held = [];
    try {
      await claimCustodyPool(db, "undeposited_index_verify", held);
      index = (await db.ref("/cashCustodyOpenIndex").limitToFirst(verifyLimit + 1).get()).val() || {};
      if (Object.keys(index).length > verifyLimit) throw new HttpsError("resource-exhausted", "The custody projection exceeds the 500-row verification limit.");
      truth = await openRows();
      writes = custodyIndexDrift(index, truth);
      if (Object.keys(writes).length) {
        const now = Date.now(), before = {};
        Object.keys(writes).forEach((path) => { const id = path.split("/")[1]; before[id] = index[id] ? Financial.money(index[id].remaining) : null; });
        writes[`operationalAudit/${now}_undeposited_index_repair`] = operationalAuditRecord("repair_undeposited_custody_index", "cashCustody", "openIndex", {uid: "server", role: "server"}, {rows: Object.keys(before).map((id) => ({id, projectedRemaining: before[id], authoritativeRemaining: truth[id] ? Financial.money(truth[id].remaining) : 0})), accounting: "Projection only; no custody row or Finance Books posting changed."});
        await db.ref().update(writes);
        result.custodyRowsRepaired = Object.keys(before).length;
      }
    } catch (error) { logger.warn("Undeposited custody index verify skipped", {message: String(error && error.message || error)}); result.checked = false; return result; }
    finally { await releaseCustodyClaims(held); }
    index = truth;
  }
  const falseMissing = [];
  await Promise.all(Object.keys(missingRows || {}).map(async (id) => { if ((await db.ref(`/pettyVoucherPostingIndex/${financeKey(id, "Voucher ID")}`).get()).exists()) falseMissing.push(id); }));
  if (falseMissing.length) {
    const now = Date.now(), clear = {[`operationalAudit/${now}_voucher_attention_repair`]: operationalAuditRecord("repair_voucher_attention_index", "pettyVoucher", "missingIndex", {uid: "server", role: "server"}, {voucherIds: falseMissing, accounting: "The vouchers are posted; only the stale 'missing' flag was removed."})};
    falseMissing.forEach((id) => { clear[`pettyVoucherAttentionIndex/missing/${id}`] = null; });
    await db.ref().update(clear);
    result.missingVouchersCleared = falseMissing.length;
  }
  result.index = index;
  result.falseMissing = falseMissing;
  await db.ref("/systemHealth/undepositedIndexVerification").set({checkedAt:Date.now(),custodyRowsRepaired:result.custodyRowsRepaired,missingVouchersCleared:result.missingVouchersCleared,checked:result.checked});
  return result;
}

// A failed/delayed voucher trigger can leave an already approved voucher in the pending index.
// Recheck only the bounded rows displayed by the control snapshot; never scan voucher history.
async function verifyPendingVoucherIndex(db, pendingRows) {
  const stale = [];
  await Promise.all(Object.keys(pendingRows || {}).map(async (id) => {
    const snap = await db.ref(`/pettyCashVouchers/${financeKey(id, "Voucher ID")}`).get();
    const row = snap.val();
    if (!row || row.voided === true || row.status !== "pending") stale.push(id);
  }));
  if (!stale.length) return [];
  const auditKey = db.ref("/operationalAudit").push().key, writes = {[`operationalAudit/${auditKey}`]: operationalAuditRecord("repair_voucher_attention_index", "pettyVoucher", "pendingIndex", {uid: "server", role: "server"}, {voucherIds: stale, accounting: "Only stale pending attention flags were removed; voucher and Finance Books postings were not changed."})};
  stale.forEach((id) => { writes[`pettyVoucherAttentionIndex/pending/${financeKey(id, "Voucher ID")}`] = null; });
  await db.ref().update(writes);
  return stale;
}

function pettyVoucherAttentionProjection(id, row) {
  return {id,voucherNo:financeText(row.voucherNo,60),date:financeText(row.date,10),recipient:financeText(row.recipient||row.requesterName,160),purpose:financeText(row.purpose,300),category:financeText(row.category,80),amount:Financial.money(row.amount),status:financeText(row.status,40),voided:row.voided===true};
}

async function writeUndepositedIndexBatches(db, writes) {
  const keys = Object.keys(writes);
  for (let offset = 0; offset < keys.length; offset += 400) {
    const batch = {};
    keys.slice(offset, offset + 400).forEach((key) => {batch[key] = writes[key];});
    await db.ref().update(batch);
  }
}

async function ensureUndepositedPageIndexes(db) {
  const metaRef = db.ref("/undepositedPageIndexMeta"), meta = (await metaRef.get()).val() || {};
  if (meta.schemaVersion === UNDEPOSITED_INDEX_VERSION && meta.complete === true) return;
  const [movementSnap, custodySnap, voucherSnap] = /* download-ok: migration builds the undeposited page indexes once, guarded by undepositedPageIndexMeta */await Promise.all([db.ref("/financialMovements").get(), db.ref("/cashCustody").get(), db.ref("/pettyCashVouchers").get()]);
  const writes = {}, postedVouchers = {};
  Object.entries(movementSnap.val() || {}).forEach(([id, movement]) => {
    const record = undepositedMovementProjection(id, movement);
    if (record) writes[`undepositedLedgerPageIndex/${id}`] = record;
    if (movement && movement.sourceType === "pettyVoucher" && movement.sourceId) {const voucherId=financeKey(movement.sourceId,"Voucher ID");postedVouchers[voucherId]=id;writes[`pettyVoucherPostingIndex/${voucherId}`]=id;}
  });
  Object.entries(custodySnap.val() || {}).forEach(([id, row]) => {
    const record = cashCustodyProjection(id, row);
    if (!record) return;
    if (record.remaining > 0) writes[`cashCustodyOpenIndex/${id}`] = record;
  });
  Object.entries(voucherSnap.val()||{}).forEach(([id,row])=>{if(!row||row.voided===true)return;const projection=pettyVoucherAttentionProjection(id,row);if(row.status==="pending")writes[`pettyVoucherAttentionIndex/pending/${id}`]=projection;if(row.status==="approved"&&!postedVouchers[id])writes[`pettyVoucherAttentionIndex/missing/${id}`]=projection;});
  await writeUndepositedIndexBatches(db, writes);
  await metaRef.set({schemaVersion:UNDEPOSITED_INDEX_VERSION,complete:true,builtAt:Date.now(),movementCount:movementSnap.numChildren(),custodyCount:custodySnap.numChildren(),voucherCount:voucherSnap.numChildren()});
}

exports.getUndepositedControlSnapshot = onCall(
  {region:ORDER_REGION,enforceAppCheck:ENFORCE_APP_CHECK,timeoutSeconds:60,memory:"256MiB"},
  async (request) => {
    const db=getDatabase();await requirePortalPermission(db,request,["petty","cashflow","undeposited"]);await ensureUndepositedPageIndexes(db);
    const [summaryMetaSnap,summaryBalanceSnap,pendingSummarySnap,openCustodySnap,pendingVoucherSnap,missingVoucherSnap,retirementSnap,openingSnap,verificationSnap]=await Promise.all([
      db.ref("/cashBalanceSummary/meta").get(),db.ref("/cashBalanceSummary/balances").get(),db.ref("/cashBalanceSummaryPending").limitToFirst(1).get(),db.ref("/cashCustodyOpenIndex").limitToFirst(501).get(),
      db.ref("/pettyVoucherAttentionIndex/pending").limitToLast(100).get(),db.ref("/pettyVoucherAttentionIndex/missing").limitToLast(100).get(),db.ref("/financialMovements/revolving_fund_retirement").get(),db.ref("/financialMovements/undeposited_opening_balance").get(),
      db.ref("/systemHealth/undepositedIndexVerification").get(),
    ]);
    let undeposited=0,revolving=0,summaryMeta=summaryMetaSnap.val()||{},summaryBalances=summaryBalanceSnap.val()||{};
    if(summaryMeta.schemaVersion!==CashBalances.SCHEMA_VERSION||summaryMeta.complete!==true||pendingSummarySnap.exists()){
      const repairedSummary=await ensureCashBalanceSummary(db);summaryMeta=repairedSummary.meta||{};summaryBalances=repairedSummary.balances||{};
    }
    if(summaryMeta.schemaVersion===CashBalances.SCHEMA_VERSION&&summaryMeta.complete===true){
      undeposited=Financial.money(Number(summaryBalances.undepositedCents||0)/100);revolving=Financial.money(Number(summaryBalances.revolvingCents||0)/100);
    }else{
      const movementMap=/* download-ok: fallback cash-balance summary is incomplete */(await db.ref("/financialMovements").get()).val()||{};
      Object.values(movementMap).forEach((movement)=>{((movement&&movement.lines)||[]).forEach((line)=>{const net=Financial.money((Number(line.debit)||0)-(Number(line.credit)||0));if(line.account===UNDEPOSITED_POOL_ACCOUNT)undeposited=Financial.money(undeposited+net);if(line.account==="asset:petty_cash")revolving=Financial.money(revolving+net);});});
    }
    const openIndex=openCustodySnap.val()||{};if(Object.keys(openIndex).length>500)throw new HttpsError("resource-exhausted","Undeposited Collection has more than 500 open custody rows. Deposit or archive older settled rows before opening this control.");
    const verification=verificationSnap.val()||{},verifyDue=Date.now()-Number(verification.checkedAt||0)>=600000||missingVoucherSnap.exists(),verified=verifyDue?await verifyUndepositedIndexes(db,openIndex,missingVoucherSnap.val()||{}):{checked:false,custodyRowsRepaired:0,missingVouchersCleared:0,index:openIndex,falseMissing:[]};
    const custodyRemaining=Financial.money(Object.values(verified.index||{}).reduce((sum,row)=>sum+Number(row&&row.remaining||0),0));
    const pendingIndex=pendingVoucherSnap.val()||{},stalePendingVoucherIds=await verifyPendingVoucherIndex(db,pendingIndex),pendingVouchers=Object.values(pendingIndex).filter((row)=>row&&!row.voided&&!stalePendingVoucherIds.includes(row.id)).sort((a,b)=>String(b.date).localeCompare(String(a.date))),missingApprovedVouchers=Object.values(missingVoucherSnap.val()||{}).filter((row)=>row&&!row.voided&&!(verified.falseMissing||[]).includes(row.id));
    const custodyGap=Financial.money(undeposited-custodyRemaining);let custodyGapCandidates=[];
    if(custodyGap>0){const candidateSnap=await db.ref("/undepositedLedgerPageIndex").orderByChild("netAmount").equalTo(custodyGap).limitToLast(25).get();custodyGapCandidates=Object.entries(candidateSnap.val()||{}).map(([id,row])=>Object.assign({id},row||{})).filter((row)=>!row.reversalOf&&!row.reversedByMovementId);}
    return{undepositedBalance:undeposited,revolvingBalance:revolving,custodyRemaining,custodyGap,pendingVouchers,missingApprovedVouchers,missingApprovedVoucherIds:missingApprovedVouchers.map((row)=>row.id),custodyGapCandidates,retirementPosted:retirementSnap.exists(),openingPosted:openingSnap.exists(),indexVerification:{checked:verified.checked,custodyRowsRepaired:verified.custodyRowsRepaired,missingVouchersCleared:verified.missingVouchersCleared},calculatedAt:Date.now(),authority:"server_all_time",pageSize:UNDEPOSITED_PAGE_SIZE};
  },
);

exports.syncUndepositedLedgerPageIndex = onValueWritten(
  {ref:"/financialMovements/{movementId}",region:ORDER_REGION,retry:true},
  async (event) => {
    const db = getDatabase(), id = event.params.movementId, before = event.data.before.exists() ? event.data.before.val() : null, movement = event.data.after.exists() ? event.data.after.val() : null, writes = {};
    writes[`undepositedLedgerPageIndex/${id}`] = undepositedMovementProjection(id, movement);
    if (before && before.sourceType === "pettyVoucher" && before.sourceId && (!movement || movement.sourceType !== "pettyVoucher" || movement.sourceId !== before.sourceId)) writes[`pettyVoucherPostingIndex/${financeKey(before.sourceId, "Voucher ID")}`] = null;
    if (movement && movement.sourceType === "pettyVoucher" && movement.sourceId) {const voucherId=financeKey(movement.sourceId,"Voucher ID");writes[`pettyVoucherPostingIndex/${voucherId}`]=id;writes[`pettyVoucherAttentionIndex/missing/${voucherId}`]=null;}
    await db.ref().update(writes);
  },
);

exports.syncPettyVoucherAttentionIndex = onValueWritten(
  {ref:"/pettyCashVouchers/{voucherId}",region:ORDER_REGION,retry:true},
  async (event) => {
    const db=getDatabase(),id=event.params.voucherId,row=event.data.after.exists()?event.data.after.val():null,writes={[`pettyVoucherAttentionIndex/pending/${id}`]:null,[`pettyVoucherAttentionIndex/missing/${id}`]:null};
    if(row&&row.voided!==true&&row.status==="pending")writes[`pettyVoucherAttentionIndex/pending/${id}`]=pettyVoucherAttentionProjection(id,row);
    if(row&&row.voided!==true&&row.status==="approved"&&!(await db.ref(`/pettyVoucherPostingIndex/${id}`).get()).exists())writes[`pettyVoucherAttentionIndex/missing/${id}`]=pettyVoucherAttentionProjection(id,row);
    await db.ref().update(writes);
    // Write-then-verify: the posting trigger sets the posting index and clears "missing" in one
    // update, so whichever trigger runs second leaves the right answer (7 Oct 2026 race).
    if(writes[`pettyVoucherAttentionIndex/missing/${id}`]&&(await db.ref(`/pettyVoucherPostingIndex/${id}`).get()).exists())await db.ref(`/pettyVoucherAttentionIndex/missing/${id}`).remove();
  },
);

function undepositedCursor(data, field) {
  const cursor = data && data.cursor;
  if (!cursor) return null;
  const value = Number(cursor.value), id = financeKey(cursor.id, "Page cursor");
  if (!Number.isFinite(value) || value < 0) throw new HttpsError("invalid-argument", "The page cursor is invalid. Refresh and try again.");
  return {value, id, field};
}

async function readUndepositedIndexPage(db, baseRef, field, data, fromValue, toValue) {
  const cursor = undepositedCursor(data, field);
  let query = baseRef.orderByChild(field);
  if (Number.isFinite(fromValue)) query = query.startAt(fromValue);
  if (cursor) query = query.endAt(cursor.value, cursor.id);
  else if (Number.isFinite(toValue)) query = query.endAt(toValue);
  const snap = await query.limitToLast(UNDEPOSITED_PAGE_SIZE + (cursor ? 2 : 1)).get();
  let rows = Object.entries(snap.val() || {}).map(([id, row]) => Object.assign({id}, row || {}));
  rows.sort((a, b) => (Number(b[field]) - Number(a[field])) || String(b.id).localeCompare(String(a.id)));
  if (cursor) rows = rows.filter((row) => !(Number(row[field]) === cursor.value && row.id === cursor.id));
  const rawHasMore = rows.length > UNDEPOSITED_PAGE_SIZE, neutralLegacyIds = rows.filter((row) => row.type === "petty_cash_payment_correction" && Number(row.inAmount) > 0 && Number(row.outAmount) > 0 && Math.abs(Financial.money(Number(row.inAmount) - Number(row.outAmount))) < 0.005).map((row) => row.id);
  if (neutralLegacyIds.length) {
    const repairedAt = Date.now(), writes = {[`operationalAudit/${repairedAt}_neutral_legacy_undeposited_projection`]:operationalAuditRecord("remove_neutral_legacy_correction_from_undeposited_projection","undepositedLedgerPageIndex","neutralLegacyCorrections",{uid:"server",role:"server"},{movementIds:neutralLegacyIds,accounting:"Projection cleanup only. Posted Finance Books journals remain immutable; these movements net to zero in Undeposited Collection."})};
    neutralLegacyIds.forEach((movementId) => {writes[`undepositedLedgerPageIndex/${movementId}`] = null;});
    await db.ref().update(writes);
    rows = rows.filter((row) => !neutralLegacyIds.includes(row.id));
  }
  const hasMore = rawHasMore || rows.length > UNDEPOSITED_PAGE_SIZE;
  rows = rows.slice(0, UNDEPOSITED_PAGE_SIZE);
  const last = rows[rows.length - 1];
  return {rows,hasMore,nextCursor:hasMore && last ? {value:Number(last[field])||0,id:last.id} : null,pageSize:UNDEPOSITED_PAGE_SIZE};
}

exports.getUndepositedPage = onCall(
  {region:ORDER_REGION,enforceAppCheck:ENFORCE_APP_CHECK,timeoutSeconds:60,memory:"256MiB"},
  async (request) => {
    const db = getDatabase();
    await requirePortalPermission(db, request, ["petty", "cashflow", "undeposited"]);
    const data = request.data || {}, kind = financeText(data.kind, 30);
    if (kind === "voucher") {
      const id = financeKey(data.id, "Voucher ID"), row = (await db.ref(`/pettyCashVouchers/${id}`).get()).val();
      if (!row) throw new HttpsError("not-found", "Cash-payment voucher was not found.");
      const receiptSourceId=row.receiptSourceVoucherId?financeKey(row.receiptSourceVoucherId,"Receipt source voucher"):id,receiptImg=row.receiptImg||(row.hasReceipt===true?((await db.ref(`/pettyCashReceipts/${receiptSourceId}/image`).get()).val()||(receiptSourceId!==id?(await db.ref(`/pettyCashVouchers/${receiptSourceId}/receiptImg`).get()).val():"")):"");
      return {id,voucherNo:financeText(row.voucherNo,60),category:financeText(row.category,80),recipient:financeText(row.recipient||row.requesterName,160),purpose:financeText(row.purpose,300),approvedBy:financeText(row.approvedBy||row.approverName,160),status:row.voided?"voided":financeText(row.status,40),receiptImg:financeText(receiptImg,1500000)};
    }
    if (kind !== "ledger" && kind !== "custody") throw new HttpsError("invalid-argument", "Choose the ledger or custody page.");
    await ensureUndepositedPageIndexes(db);
    if (kind === "custody") return readUndepositedIndexPage(db, db.ref("/cashCustodyOpenIndex"), "closedAt", data);
    const from = financeText(data.from, 10), to = financeText(data.to, 10);
    if (from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new HttpsError("invalid-argument", "From date is invalid.");
    if (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new HttpsError("invalid-argument", "To date is invalid.");
    if (from && to && from > to) throw new HttpsError("invalid-argument", "From date cannot be after To date.");
    const fromValue = from ? Date.parse(`${from}T00:00:00+08:00`) : undefined, toValue = to ? Date.parse(`${to}T23:59:59.999+08:00`) : undefined;
    return readUndepositedIndexPage(db, db.ref("/undepositedLedgerPageIndex"), "occurredAt", data, fromValue, toValue);
  },
);
