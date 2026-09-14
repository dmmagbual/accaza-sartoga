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
  return {
    id,
    occurredAt: Number(movement.occurredAt || movement.postedAt || 0),
    type: financeText(movement.type, 80),
    sourceId: financeText(movement.sourceId, 160),
    sourceType: financeText(movement.sourceType, 80),
    reference: financeText(movement.reference || movement.documentNo, 120),
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
  const [movementSnap, custodySnap, voucherSnap] = await Promise.all([db.ref("/financialMovements").get(), db.ref("/cashCustody").get(), db.ref("/pettyCashVouchers").get()]);
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
    const db=getDatabase();await requirePortalPermission(db,request,["petty","cashflow"]);await ensureUndepositedPageIndexes(db);
    const [summaryMetaSnap,summaryBalanceSnap,pendingSummarySnap,openCustodySnap,pendingVoucherSnap,missingVoucherSnap,retirementSnap,openingSnap]=await Promise.all([
      db.ref("/cashBalanceSummary/meta").get(),db.ref("/cashBalanceSummary/balances").get(),db.ref("/cashBalanceSummaryPending").limitToFirst(1).get(),db.ref("/cashCustodyOpenIndex").get(),
      db.ref("/pettyVoucherAttentionIndex/pending").limitToLast(100).get(),db.ref("/pettyVoucherAttentionIndex/missing").limitToLast(100).get(),db.ref("/financialMovements/revolving_fund_retirement").get(),db.ref("/financialMovements/undeposited_opening_balance").get(),
    ]);
    let undeposited=0,revolving=0;const summaryMeta=summaryMetaSnap.val()||{},summaryBalances=summaryBalanceSnap.val()||{};
    if(summaryMeta.schemaVersion===1&&summaryMeta.complete===true&&!pendingSummarySnap.exists()){
      undeposited=Financial.money(Number(summaryBalances.undepositedCents||0)/100);revolving=Financial.money(Number(summaryBalances.revolvingCents||0)/100);
    }else{
      const movementMap=(await db.ref("/financialMovements").get()).val()||{};
      Object.values(movementMap).forEach((movement)=>{((movement&&movement.lines)||[]).forEach((line)=>{const net=Financial.money((Number(line.debit)||0)-(Number(line.credit)||0));if(line.account===UNDEPOSITED_POOL_ACCOUNT)undeposited=Financial.money(undeposited+net);if(line.account==="asset:petty_cash")revolving=Financial.money(revolving+net);});});
    }
    const custodyRemaining=Financial.money(Object.values(openCustodySnap.val()||{}).reduce((sum,row)=>sum+Number(row&&row.remaining||0),0));
    const pendingVouchers=Object.values(pendingVoucherSnap.val()||{}).filter((row)=>row&&!row.voided).sort((a,b)=>String(b.date).localeCompare(String(a.date))),missingApprovedVouchers=Object.values(missingVoucherSnap.val()||{}).filter((row)=>row&&!row.voided);
    const custodyGap=Financial.money(undeposited-custodyRemaining);let custodyGapCandidates=[];
    if(custodyGap>0){const candidateSnap=await db.ref("/undepositedLedgerPageIndex").orderByChild("netAmount").equalTo(custodyGap).limitToLast(25).get();custodyGapCandidates=Object.entries(candidateSnap.val()||{}).map(([id,row])=>Object.assign({id},row||{})).filter((row)=>!row.reversalOf&&!row.reversedByMovementId);}
    return{undepositedBalance:undeposited,revolvingBalance:revolving,custodyRemaining,custodyGap,pendingVouchers,missingApprovedVouchers,missingApprovedVoucherIds:missingApprovedVouchers.map((row)=>row.id),custodyGapCandidates,retirementPosted:retirementSnap.exists(),openingPosted:openingSnap.exists(),calculatedAt:Date.now(),authority:"server_all_time",pageSize:UNDEPOSITED_PAGE_SIZE};
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
  },
);

exports.syncCashCustodyPageIndex = onValueWritten(
  {ref:"/cashCustody/{custodyId}",region:ORDER_REGION,retry:true},
  async (event) => {
    const db = getDatabase(), id = event.params.custodyId, row = event.data.after.exists() ? event.data.after.val() : null, record = cashCustodyProjection(id, row);
    await db.ref(`/cashCustodyOpenIndex/${id}`).set(record && record.remaining > 0 ? record : null);
  },
);

function undepositedCursor(data, field) {
  const cursor = data && data.cursor;
  if (!cursor) return null;
  const value = Number(cursor.value), id = financeKey(cursor.id, "Page cursor");
  if (!Number.isFinite(value) || value < 0) throw new HttpsError("invalid-argument", "The page cursor is invalid. Refresh and try again.");
  return {value, id, field};
}

async function readUndepositedIndexPage(baseRef, field, data, fromValue, toValue) {
  const cursor = undepositedCursor(data, field);
  let query = baseRef.orderByChild(field);
  if (Number.isFinite(fromValue)) query = query.startAt(fromValue);
  if (cursor) query = query.endAt(cursor.value, cursor.id);
  else if (Number.isFinite(toValue)) query = query.endAt(toValue);
  const snap = await query.limitToLast(UNDEPOSITED_PAGE_SIZE + (cursor ? 2 : 1)).get();
  let rows = Object.entries(snap.val() || {}).map(([id, row]) => Object.assign({id}, row || {}));
  rows.sort((a, b) => (Number(b[field]) - Number(a[field])) || String(b.id).localeCompare(String(a.id)));
  if (cursor) rows = rows.filter((row) => !(Number(row[field]) === cursor.value && row.id === cursor.id));
  const hasMore = rows.length > UNDEPOSITED_PAGE_SIZE;
  rows = rows.slice(0, UNDEPOSITED_PAGE_SIZE);
  const last = rows[rows.length - 1];
  return {rows,hasMore,nextCursor:hasMore && last ? {value:Number(last[field])||0,id:last.id} : null,pageSize:UNDEPOSITED_PAGE_SIZE};
}

exports.getUndepositedPage = onCall(
  {region:ORDER_REGION,enforceAppCheck:ENFORCE_APP_CHECK,timeoutSeconds:60,memory:"256MiB"},
  async (request) => {
    const db = getDatabase();
    await requirePortalPermission(db, request, ["petty", "cashflow"]);
    const data = request.data || {}, kind = financeText(data.kind, 30);
    if (kind === "voucher") {
      const id = financeKey(data.id, "Voucher ID"), row = (await db.ref(`/pettyCashVouchers/${id}`).get()).val();
      if (!row) throw new HttpsError("not-found", "Cash-payment voucher was not found.");
      return {id,voucherNo:financeText(row.voucherNo,60),category:financeText(row.category,80),recipient:financeText(row.recipient||row.requesterName,160),purpose:financeText(row.purpose,300),approvedBy:financeText(row.approvedBy||row.approverName,160),status:row.voided?"voided":financeText(row.status,40),receiptImg:financeText(row.receiptImg,1500000)};
    }
    if (kind !== "ledger" && kind !== "custody") throw new HttpsError("invalid-argument", "Choose the ledger or custody page.");
    await ensureUndepositedPageIndexes(db);
    if (kind === "custody") return readUndepositedIndexPage(db.ref("/cashCustodyOpenIndex"), "closedAt", data);
    const from = financeText(data.from, 10), to = financeText(data.to, 10);
    if (from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new HttpsError("invalid-argument", "From date is invalid.");
    if (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new HttpsError("invalid-argument", "To date is invalid.");
    if (from && to && from > to) throw new HttpsError("invalid-argument", "From date cannot be after To date.");
    const fromValue = from ? Date.parse(`${from}T00:00:00+08:00`) : undefined, toValue = to ? Date.parse(`${to}T23:59:59.999+08:00`) : undefined;
    return readUndepositedIndexPage(db.ref("/undepositedLedgerPageIndex"), "occurredAt", data, fromValue, toValue);
  },
);
