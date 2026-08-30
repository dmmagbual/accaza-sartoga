  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 30, memory: "256MiB"},
  async (request) => {
    const db=getDatabase();await requirePortalPermission(db,request,["petty","cashflow"]);
    const [movementSnap,voucherSnap]=await Promise.all([db.ref("/financialMovements").get(),db.ref("/pettyCashVouchers").get()]);
    const movementMap=movementSnap.val()||{},voucherMap=voucherSnap.val()||{};let undeposited=0,revolving=0;const postedVoucherIds={};
    Object.keys(movementMap).forEach((id)=>{const movement=movementMap[id]||{};(movement.lines||[]).forEach((line)=>{const net=Financial.money((Number(line.debit)||0)-(Number(line.credit)||0));if(line.account==="asset:cash_awaiting_deposit")undeposited=Financial.money(undeposited+net);if(line.account==="asset:petty_cash")revolving=Financial.money(revolving+net);});if(movement.sourceType==="pettyVoucher"&&movement.sourceId)postedVoucherIds[String(movement.sourceId)]=id;});
    const missingApproved=[];Object.keys(voucherMap).forEach((id)=>{const voucher=voucherMap[id]||{};if(voucher.status==="approved"&&voucher.voided!==true&&!postedVoucherIds[id])missingApproved.push(id);});
    return{undepositedBalance:undeposited,revolvingBalance:revolving,postedVoucherIds,missingApprovedVoucherIds:missingApproved,retirementPosted:movementSnap.child("revolving_fund_retirement").exists(),calculatedAt:Date.now(),authority:"server_all_time"};
  },
);

function savedShiftCashSales(shift) {
  const sales = shift && shift.zReport && Array.isArray(shift.zReport.sales) ? shift.zReport.sales : [];
  let cash = 0;
  sales.forEach((order) => {
    const rows = Array.isArray(order.payments) && order.payments.length ? order.payments : [{method: order.payment, amount: order.total}];
    rows.forEach((row) => {if (String(row && row.method || "").toLowerCase() === "cash") cash = Financial.money(cash + Financial.money(row.amount));});
    const refunds = order.refundPayments || {};
    cash = Financial.money(cash - Financial.money(refunds.Cash || refunds.cash));
  });
  return Financial.money(Math.max(0, cash));
}

exports.repairClosedShiftTurnover = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 30, memory: "256MiB"},
  async (request) => {
    const db = getDatabase(), actor = await requirePortalPermission(db, request, ["cashflow", "registerOps"]), data = request.data || {}, shiftId = financeKey(data.shiftId, "Shift ID"), movementId = `shift_custody_${shiftId}`;
    const [shiftSnap, movementSnap, custodySnap] = await Promise.all([db.ref(`/shifts/${shiftId}`).get(), db.ref(`/financialMovements/${movementId}`).get(), db.ref(`/cashCustody/${shiftId}`).get()]);
    const shift = shiftSnap.val() || null;
    if (!shift || shift.status !== "closed") throw new HttpsError("failed-precondition", "Select a closed shift.");
    const amount = savedShiftCashSales(shift);
    if (!(amount > 0)) throw new HttpsError("failed-precondition", "The saved shift transaction lines contain no cash turnover to repair.");
    if (movementSnap.exists() || custodySnap.exists()) return {shiftId, amount, duplicate: true, preview: data.preview === true};
    if (data.preview === true) return {shiftId, amount, staff: financeText(shift.staff, 100), closedAt: Number(shift.closeAt || 0), preview: true, duplicate: false};
    const approval = await claimManagerApproval(db, data, "repair_closed_shift_turnover", shiftId, amount, movementId), now = Date.now(), approvedBy = approval.record.approvedName || approval.record.approvedEmail || approval.record.approvedRole;
    const movement = Financial.movement("shift_cash_to_custody", "shift", shiftId, [Financial.line("asset:cash_awaiting_deposit", amount, 0, "Confirmed closed-shift cash received"), Financial.line("asset:register_cash", 0, amount, "Closed-shift cash handed over")], {occurredAt:Number(shift.closeAt||now),actorName:approvedBy,approvalId:approval.id,repair:true,controlReason:"Manager confirmed omitted cash was physically received"});
    const writes = Object.assign({}, approval.usedWrites, {[`cashCustody/${shiftId}`]:{shiftId,staff:financeText(shift.staff,100),amount,depositedAmount:0,remaining:amount,retainedFloat:Financial.money(shift.retainedFloat),status:"awaiting_deposit",closedAt:Number(shift.closeAt||now),movementId,source:"closed_shift_turnover_repair",schemaVersion:2},[`shifts/${shiftId}/turnoverCorrection`]:{amount,movementId,postedAt:now,postedBy:actor.uid,approvedBy,approvalId:approval.id,reason:"Confirmed cash received into Undeposited Collection",schemaVersion:1},[`operationalAudit/${now}_${shiftId}_turnover_repair`]:operationalAuditRecord("repair_closed_shift_turnover","shift",shiftId,actor,{amount,movementId,approvalId:approval.id,approvedBy})});
    const committed = await commitFinancial(db,movementId,movement,actor,writes);
    return {shiftId,amount,movementId,duplicate:committed.duplicate,repaired:!committed.duplicate};
  },
);

// Links a historical Finance journal that increased Undeposited Collection
// without creating the matching physical-cash custody record. This repairs
// only the subledger: the existing balanced journal remains the sole GL entry.
exports.reconcileUndepositedCustody = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 30, memory: "256MiB"},
  async (request) => {
    const db=getDatabase(),actor=await requirePortalPermission(db,request,["cashflow","registerOps"]),data=request.data||{},movementId=financeKey(data.movementId,"Finance movement ID"),now=Date.now();
    const [movementSnap,movementsSnap,custodySnap,linkSnap]=await Promise.all([db.ref(`/financialMovements/${movementId}`).get(),db.ref("/financialMovements").get(),db.ref("/cashCustody").get(),db.ref(`/financialControlLinks/custodyRepairs/${movementId}`).get()]);
    if(linkSnap.exists())return{movementId,amount:Financial.money(linkSnap.val().amount),duplicate:true,preview:data.preview===true};
    const movement=movementSnap.val(),allMovements=movementsSnap.val()||{},custodyRows=custodySnap.val()||{};
    if(!movement||!Array.isArray(movement.lines)||movement.reversalOf||movement.reversedByMovementId)throw new HttpsError("failed-precondition","Select an active balanced Finance journal.");
    const totals=Financial.totals(movement.lines),amount=Financial.money(movement.lines.reduce((sum,line)=>sum+(line.account==="asset:cash_awaiting_deposit"?(Number(line.debit)||0)-(Number(line.credit)||0):0),0));
    if(Math.abs(totals.debit-totals.credit)>.009||!(amount>0))throw new HttpsError("failed-precondition","The selected journal must be balanced and must increase Undeposited Collection.");
    if(Object.values(custodyRows).some((row)=>row&&row.movementId===movementId))throw new HttpsError("already-exists","This Finance journal already has a cash custody record.");
    let pool=0;Object.values(allMovements).forEach((m)=>{if(!m||!Array.isArray(m.lines))return;m.lines.forEach((line)=>{if(line.account==="asset:cash_awaiting_deposit")pool=Financial.money(pool+Number(line.debit||0)-Number(line.credit||0));});});
    const custodyRemaining=Financial.money(Object.values(custodyRows).reduce((sum,row)=>sum+Number(row&&row.remaining||0),0)),difference=Financial.money(pool-custodyRemaining);
    if(!(difference>0)||Math.abs(difference-amount)>.009)throw new HttpsError("failed-precondition",`The selected journal is ${amount.toFixed(2)}, but the current ledger-to-custody difference is ${difference.toFixed(2)}. Select the exact journal that caused the difference.`);
    if(data.preview===true)return{movementId,amount,difference,memo:financeText(movement.memo||movement.reference||movement.sourceId,200),occurredAt:Number(movement.occurredAt||movement.postedAt||0),preview:true,duplicate:false};
    const reason=financeText(data.reason,500);if(!reason)throw new HttpsError("invalid-argument","Explain why this existing journal represents physical cash awaiting deposit.");
    const approval=await claimManagerApproval(db,data,"reconcile_undeposited_custody",movementId,amount,`reconcile_undeposited_custody_${movementId}`),approvedBy=approval.record.approvedName||approval.record.approvedEmail||approval.record.approvedRole,custodyId=`journal_custody_${movementId}`,occurredAt=Number(movement.occurredAt||movement.postedAt||now);
    const writes=Object.assign({},approval.usedWrites,{[`cashCustody/${custodyId}`]:{shiftId:custodyId,staff:`Finance journal recovery · ${approvedBy}`,amount,depositedAmount:0,remaining:amount,retainedFloat:0,status:"awaiting_deposit",closedAt:occurredAt,movementId,source:"historical_finance_journal_custody_reconciliation",reference:financeText(movement.reference||movement.sourceId,120),createdAt:now,createdBy:actor.uid,approvalId:approval.id,schemaVersion:3},[`financialControlLinks/custodyRepairs/${movementId}`]:{movementId,custodyId,amount,reason,linkedAt:now,linkedBy:actor.uid,approvedBy,approvalId:approval.id,schemaVersion:1},[`operationalAudit/${now}_${movementId}_custody_reconcile`]:operationalAuditRecord("reconcile_undeposited_custody","booksManualJournal",movementId,actor,{amount,custodyId,reason,approvalId:approval.id,approvedBy,newFinancialMovement:false,expectedDifferenceAfter:0})});
    await db.ref().update(writes);return{movementId,custodyId,amount,differenceBefore:difference,differenceAfter:0,duplicate:false,repaired:true,newFinancialMovement:false};
  },
);

// One-time, date-bounded cutover: clears historical variance-control balances
// without deleting source history. Later discrepancies remain operationally open.
exports.legacyOwnerCapitalReset = onCall({region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 60, memory: "256MiB"}, async (request) => {
  const db=getDatabase(),actor=await requirePortalPermission(db,request,["cashflow","discrepancy"]),data=request.data||{},cutoffDate=financeDate(data.cutoffDate||data.date||financeDateFromTimestamp(Date.now())),date=financeDate(data.date||cutoffDate),reason=financeText(data.reason,500),id=`legacy_owner_capital_reset_v5_${cutoffDate}`;
  if(!["owner","superadmin","admin","manager"].includes(actor.role))throw new HttpsError("permission-denied","Only a manager may run the legacy financial reset.");
  if(cutoffDate>"2026-08-29"||date>"2026-08-29")throw new HttpsError("failed-precondition","The legacy close is limited to August 29, 2026 or earlier so August 30 and later activity remains operationally visible.");
  const [journalSnap,discrepancySnap,existingSnap]=await Promise.all([db.ref("/books/journal").get(),db.ref("/discrepancies").get(),db.ref(`/financialMovements/${id}`).get()]);
  const normal={"4990":"credit","6110":"debit","1190":"debit","2100":"credit"},balances={"4990":0,"6110":0,"1190":0,"2100":0};
  const journal=journalSnap.val()||{},journalById=new Map(Object.entries(journal).map(([key,value])=>[key,Object.assign({id:key},value||{})]));
  Object.values(journal).forEach((entry)=>{if(!entry)return;const entryDate=String(entry.date||financeDateFromTimestamp(entry.occurredAt||entry.postedAt||0)).slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(entryDate)||entryDate>cutoffDate)return;(entry.lines||[]).forEach((line)=>{const code=String(line.code||"");if(!Object.prototype.hasOwnProperty.call(balances,code))return;balances[code]=Financial.money(balances[code]+(normal[code]==="debit"?(Number(line.debit)||0)-(Number(line.credit)||0):(Number(line.credit)||0)-(Number(line.debit)||0)));});});
  // A reversal posted in August for an original dated before August is zero
  // all-time, but leaves a misleading negative August expense. Reclass only
  // those linked reversal lines to opening equity; genuine August expenses
  // are deliberately excluded.
  const augustStart="2026-08-01",crossPeriodReversals={"6100":0,"6110":0},crossPeriodSources=[];
  Object.entries(journal).forEach(([key,entry])=>{if(!entry)return;const entryDate=String(entry.date||financeDateFromTimestamp(entry.occurredAt||entry.postedAt||0)).slice(0,10);if(entryDate<augustStart||entryDate>cutoffDate)return;(entry.lines||[]).forEach((line)=>{const code=String(line.code||"");if(!Object.prototype.hasOwnProperty.call(crossPeriodReversals,code))return;crossPeriodReversals[code]=Financial.money(crossPeriodReversals[code]+(Number(line.debit)||0)-(Number(line.credit)||0));});if(entry.reversalOf){const original=journalById.get(String(entry.reversalOf)),originalDate=String(original&&(original.date||financeDateFromTimestamp(original.occurredAt||original.postedAt||0))||"").slice(0,10);if(originalDate&&originalDate<augustStart)crossPeriodSources.push({reversalId:key,originalId:String(entry.reversalOf),reversalDate:entryDate,originalDate});}});
  const lines=[];Object.keys(balances).forEach((code)=>{const value=Financial.money(balances[code]);if(Math.abs(value)<.005)return;if(value>0){lines.push(Financial.line(`coa:${code}`,normal[code]==="debit"?0:value,normal[code]==="debit"?value:0,"Legacy cutover"));lines.push(Financial.line("equity:owner_capital",normal[code]==="debit"?value:0,normal[code]==="debit"?0:value,"Legacy cutover"));}else{const v=Math.abs(value);lines.push(Financial.line(`coa:${code}`,normal[code]==="debit"?v:0,normal[code]==="debit"?0:v,"Legacy cutover"));lines.push(Financial.line("equity:owner_capital",normal[code]==="debit"?0:v,normal[code]==="debit"?v:0,"Legacy cutover"));}});
  Object.keys(crossPeriodReversals).forEach((code)=>{const net=Financial.money(crossPeriodReversals[code]);if(net>=-0.005)return;const value=Math.abs(net);lines.push(Financial.line(`coa:${code}`,value,0,"Close remaining negative August legacy expense activity"));lines.push(Financial.line("equity:owner_capital",0,value,"Negative legacy expense activity reclassified to opening equity"));});
  const protectedDate="2026-08-30",protectedShortage=120,protectedDiscrepancies=[],affected=Object.entries(discrepancySnap.val()||{}).filter(([key,row])=>{if(!row||row.status==="legacy_closed")return false;const rowDate=String(row.date||financeDateFromTimestamp(row.closedAt||row.ts||row.createdAt||0)).slice(0,10),isProtected=rowDate===protectedDate&&Number(row.variance)<0&&Math.abs(Math.abs(Number(row.variance))-protectedShortage)<.005;if(isProtected){protectedDiscrepancies.push(key);return false;}return true;}).map(([key])=>key);
  if(data.preview===true)return{preview:true,date,cutoffDate,balances,crossPeriodReversals,crossPeriodSources,affectedDiscrepancies:affected.length,protectedDiscrepancies:protectedDiscrepancies.length,protectedDate,protectedShortage,duplicate:existingSnap.exists(),movementId:existingSnap.exists()?id:""};if(existingSnap.exists())return{duplicate:true,movementId:id,date,cutoffDate,balances,crossPeriodReversals,crossPeriodSources,affectedDiscrepancies:affected.length,protectedDiscrepancies:protectedDiscrepancies.length};if(!reason)throw new HttpsError("invalid-argument","A legacy cutover reason is required.");if(!lines.length&&!affected.length)throw new HttpsError("failed-precondition","There are no remaining legacy balances, negative August legacy expenses, or discrepancies to close.");
  const now=Date.now(),writes={};affected.forEach((key)=>{writes[`discrepancies/${key}/status`]="legacy_closed";writes[`discrepancies/${key}/financialStatus`]="legacy_cleanup_closed";writes[`discrepancies/${key}/legacyCutover`]={movementId:id,cutoffDate,closedAt:now,closedBy:actor.uid,reason,protectedException:`${protectedDate} shortage ${protectedShortage.toFixed(2)} retained`};});writes[`operationalAudit/${now}_${id}`]=operationalAuditRecord("legacy_owner_capital_reset","legacyCutover",id,actor,{date,cutoffDate,balances,crossPeriodReversals,crossPeriodSources,affectedDiscrepancies:affected.length,protectedDiscrepancies:protectedDiscrepancies.length,protectedDate,protectedShortage,reason});
  const movement=Financial.movement("legacy_owner_capital_reset","legacyCutover",id,lines,{occurredAt:accountingTimestamp(date,now),actorName:actor.role,reference:`LEGACY-CUTOVER-${cutoffDate}`,memo:reason});const committed=await commitFinancial(db,id,movement,actor,writes);return{movementId:id,cutoffDate,balances,affectedDiscrepancies:affected.length,duplicate:committed.duplicate};
});

exports.runFinancialClose = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 60, memory: "512MiB"},
  async (request) => {
    const db=getDatabase(),actor=await requirePortalPermission(db,request,["dailyreport","cashflow","registerOps"]),data=request.data||{},closeType=data.closeType==="SHIFT_CLOSE"?"SHIFT_CLOSE":"DAILY_CLOSE",businessDate=financeText(data.businessDate,10),shiftId=closeType==="SHIFT_CLOSE"?financeKey(data.shiftId,"Shift ID"):"";
    if(!/^\d{4}-\d{2}-\d{2}$/.test(businessDate))throw new HttpsError("invalid-argument","Business date must use YYYY-MM-DD.");
    const closeId=closeType==="SHIFT_CLOSE"?`shift_${shiftId}`:`daily_${businessDate.replace(/-/g,"_")}`,closeRef=db.ref(`/financialCloses/${closeId}`),existing=(await closeRef.get()).val()||{};
    if(data.action==="get")return{closeId,current:existing.current||null,latestRevision:Number(existing.latestRevision||0)};
    if(data.action==="certify"){
      const current=existing.current;if(!current)throw new HttpsError("failed-precondition","Run the reconciliation before certifying this close.");if(!["RECONCILED","RECONCILED_WITH_TIMING_ITEMS"].includes(current.status))throw new HttpsError("failed-precondition","Open exceptions must be resolved or documented before certification.");if(current.certification&&current.certification.approvalId)return{closeId,revision:current.revision,status:"CERTIFIED",duplicate:true};
      const reason=financeText(data.reason,500);if(!reason)throw new HttpsError("invalid-argument","A certification note is required.");const approval=await claimManagerApproval(db,data,"certify_financial_close",closeId,null,`certify_financial_close_${closeId}_${current.revision}`),now=Date.now(),approvedBy=approval.record.approvedName||approval.record.approvedEmail||approval.record.approvedRole,certification={approvalId:approval.id,approvedAt:now,approvedBy,approvedByUid:approval.record.approvedBy,note:reason,snapshotHash:current.snapshotHash};
      await db.ref().update(Object.assign({},approval.usedWrites,{[`financialCloses/${closeId}/current/status`]:"CERTIFIED",[`financialCloses/${closeId}/current/certification`]:certification,[`financialCloses/${closeId}/revisions/${current.revision}/status`]:"CERTIFIED",[`financialCloses/${closeId}/revisions/${current.revision}/certification`]:certification,[`operationalAudit/${now}_${closeId}_certify`]:operationalAuditRecord("certify_financial_close","financialClose",closeId,actor,{revision:current.revision,snapshotHash:current.snapshotHash,approvalId:approval.id,approvedBy,reason})}));return{closeId,revision:current.revision,status:"CERTIFIED",certification,duplicate:false};
    }
    const nodes=["orders","archivedOrders","shifts","financialMovements","inventoryMovements","purchaseInvoices","books/journal","cashCustody","receivables","payables","platformPayouts"],snapshots=await Promise.all(nodes.map((path)=>db.ref(`/${path}`).get())),input={closeType,businessDate,shiftId};nodes.forEach((path,index)=>{input[path==="books/journal"?"booksJournal":path]=snapshots[index].val()||{};});
    const selectedShift=shiftId&&input.shifts[shiftId],cutoff=closeType==="SHIFT_CLOSE"?Number(selectedShift&&selectedShift.closeAt||Date.now()):(Date.parse(`${businessDate}T23:59:59.999+08:00`)||Date.now());if(closeType==="SHIFT_CLOSE"&&(!selectedShift||selectedShift.status!=="closed"))throw new HttpsError("failed-precondition","Only a closed shift can be reconciled and certified.");input.cutoff=cutoff;
    const result=FinancialClose.buildClose(input),current=existing.current;if(current&&current.snapshotHash===result.snapshotHash&&current.status!=="REOPENED")return Object.assign({closeId,revision:current.revision,duplicate:true},current);
    if(data.preview===true)return Object.assign({closeId,revision:Number(existing.latestRevision||0)+1,preview:true,duplicate:false},result);
    const now=Date.now(),claimToken=crypto.randomBytes(12).toString("hex"),claimRef=db.ref(`/financialCloseClaims/${closeId}`),claim=await claimRef.transaction((value)=>{if(value&&value.status==="processing"&&Number(value.claimedAt||0)>now-300000)return;return{status:"processing",token:claimToken,claimedAt:now,claimedBy:actor.uid,snapshotHash:result.snapshotHash};},undefined,false);
    if(!claim.committed||!claim.snapshot.val()||claim.snapshot.val().token!==claimToken)throw new HttpsError("aborted","This close is already being reconciled. Refresh and retry after it finishes.");
    const latest=(await closeRef.get()).val()||{},latestCurrent=latest.current;if(latestCurrent&&latestCurrent.snapshotHash===result.snapshotHash&&latestCurrent.status!=="REOPENED"){await claimRef.set({status:"duplicate",token:claimToken,completedAt:Date.now(),revision:latestCurrent.revision,snapshotHash:result.snapshotHash});return Object.assign({closeId,revision:latestCurrent.revision,duplicate:true},latestCurrent);}
    const revision=Math.max(0,Math.floor(Number(latest.latestRevision)||0))+1,record=Object.assign({},result,{closeId,revision,preparedAt:now,preparedBy:actor.uid,preparedRole:actor.role,previousRevision:latest.latestRevision||null,status:result.status});
    const writes={[`financialCloses/${closeId}/closeId`]:closeId,[`financialCloses/${closeId}/closeType`]:closeType,[`financialCloses/${closeId}/businessDate`]:businessDate,[`financialCloses/${closeId}/shiftId`]:shiftId||null,[`financialCloses/${closeId}/latestRevision`]:revision,[`financialCloses/${closeId}/current`]:record,[`financialCloses/${closeId}/revisions/${revision}`]:record,[`financialCloseIndex/${businessDate}/${closeId}`]:{closeId,closeType,shiftId:shiftId||null,revision,status:record.status,snapshotHash:record.snapshotHash,preparedAt:now,exceptionCount:record.exceptions.length,timingItemCount:record.timingItems.length},[`operationalAudit/${now}_${closeId}_reconcile`]:operationalAuditRecord("run_financial_close","financialClose",closeId,actor,{revision,status:record.status,snapshotHash:record.snapshotHash,exceptionCount:record.exceptions.length,timingItemCount:record.timingItems.length,controlTotals:record.controlTotals})};
    try{await db.ref().update(writes);await claimRef.set({status:"posted",token:claimToken,completedAt:Date.now(),revision,snapshotHash:record.snapshotHash});return Object.assign({duplicate:false},record);}catch(error){await claimRef.transaction((value)=>value&&value.token===claimToken?null:value,undefined,false);throw error;}
  },
);

async function reopenCertifiedFinancialCloses(date,activityId,activity) {
  const db=getDatabase(),index=(await db.ref(`/financialCloseIndex/${date}`).get()).val()||{},now=Date.now(),writes={};
  Object.keys(index).forEach((closeId)=>{const row=index[closeId]||{};if(row.status!=="CERTIFIED")return;writes[`financialCloses/${closeId}/current/status`]="REOPENED";writes[`financialCloses/${closeId}/current/reopenedAt`]=now;writes[`financialCloses/${closeId}/current/reopenedByActivityId`]=activityId;writes[`financialCloses/${closeId}/subsequentActivity/${activityId}`]=Object.assign({detectedAt:now},activity||{});writes[`financialCloseIndex/${date}/${closeId}/status`]="REOPENED";writes[`financialCloseIndex/${date}/${closeId}/reopenedAt`]=now;});if(Object.keys(writes).length)await db.ref().update(writes);
}

exports.reopenFinancialCloseOnMovement = onValueCreated(
  {ref:"/financialMovements/{movementId}",region:ORDER_REGION},
  async (event)=>{const movement=event.data.val()||{},movementId=event.params.movementId,date=BooksBridge.businessDate(movement.occurredAt||movement.postedAt||Date.now());await reopenCertifiedFinancialCloses(date,`movement_${movementId}`,{kind:"financial_movement",movementId,type:movement.type||"",sourceType:movement.sourceType||"",sourceId:movement.sourceId||"",occurredAt:Number(movement.occurredAt||movement.postedAt||Date.now())});},
);

exports.reopenFinancialCloseOnOrderChange = onValueWritten(
  {ref:"/orders/{orderId}",region:ORDER_REGION},
  async (event)=>{const order=event.data.after.val()||event.data.before.val();if(!order)return;const orderId=event.params.orderId,date=order.shiftId?(await getDatabase().ref(`/shifts/${order.shiftId}/openAt`).get()).val():0,businessDate=BooksBridge.businessDate(date||order.completedAt||order.receivedAt||order.timestamp||Date.now());await reopenCertifiedFinancialCloses(businessDate,`order_${orderId}_${Date.now()}`,{kind:"admin_order_change",orderId,shiftId:order.shiftId||"",status:order.status||"",occurredAt:Number(order.completedAt||order.receivedAt||order.timestamp||Date.now())});},
);

// Repairs only the narrow historical case where a payout was reversed first
// and a legacy deposit was posted afterward. The correction is append-only:
// it restores platform clearing, removes the duplicate cash receipt, and
// preserves every original movement and source link.
exports.repairReversedPayoutDeposit = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 30, memory: "256MiB"},
  async (request) => {
    const db = getDatabase(), actor = await requirePortalPermission(db, request, ["cashflow", "receivables"]), data = request.data || {}, payoutId = financeKey(data.payoutId, "Payout ID"), reason = financeText(data.reason, 300), movementId = `repair_reversed_payout_deposit_${payoutId}`;
    if (!reason) throw new HttpsError("invalid-argument", "A correction reason is required.");
    const payout = (await db.ref(`/platformPayouts/${payoutId}`).get()).val();
    if (!payout) throw new HttpsError("not-found", "Payout not found.");
    if (payout.depositReversalMovementId) return {payoutId, movementId:payout.depositReversalMovementId, amount:Financial.money(payout.actualPayout), duplicate:true};
    if (payout.reversed !== true || !payout.depositMovementId) throw new HttpsError("failed-precondition", "Only a reversed payout with an unreversed deposit can be repaired.");
    const amount = Financial.money(payout.actualPayout), channel = financeText(payout.channel, 30), accountId = financeKey(payout.accountId, "Cash account ID"), depositId = financeKey(payout.depositMovementId, "Deposit movement ID");
    if (!(amount > 0)) throw new HttpsError("failed-precondition", "The payout deposit amount is invalid.");
    const [depositSnap, accountSnap] = await Promise.all([db.ref(`/financialMovements/${depositId}`).get(), db.ref(`/cfAccounts/${accountId}`).get()]), deposit = depositSnap.val(), account = accountSnap.val();
    if (!deposit || deposit.type !== "platform_payout_deposit" || deposit.sourceId !== payoutId) throw new HttpsError("failed-precondition", "The linked deposit movement does not match this payout.");
    if (!account) throw new HttpsError("failed-precondition", "The linked receiving account is unavailable.");
    const cashAccount = `asset:cash_account:${accountId}`, clearingAccount = `asset:platform_clearing:${channel}`, cashDebit = Financial.money((deposit.lines||[]).filter((line)=>line.account===cashAccount).reduce((sum,line)=>sum+Number(line.debit||0)-Number(line.credit||0),0)), clearingCredit = Financial.money((deposit.lines||[]).filter((line)=>line.account===clearingAccount).reduce((sum,line)=>sum+Number(line.credit||0)-Number(line.debit||0),0));
    if (Math.abs(cashDebit-amount)>0.009 || Math.abs(clearingCredit-amount)>0.009) throw new HttpsError("failed-precondition", "The linked deposit lines do not match the payout amount and accounts.");
    const approval = await claimManagerApproval(db, data, "repair_reversed_payout_deposit", payoutId, amount, movementId), now = Date.now(), approvedBy = approval.record.approvedName || approval.record.approvedEmail || approval.record.approvedRole, reference = financeText(payout.depositReference || payoutId, 120), movement = Financial.movement("reversed_payout_deposit_repair", "platformPayout", payoutId, [Financial.line(clearingAccount,amount,0,"Restore clearing for deposit posted after payout reversal"),Financial.line(cashAccount,0,amount,`Reverse orphaned payout deposit from ${account.name}`)], {occurredAt:now,actorName:approvedBy,approvalId:approval.id,approvedBy,reason,reference,reversalOf:depositId,repair:true});
    const writes = Object.assign({}, approval.usedWrites, {[`platformPayouts/${payoutId}/depositReversalMovementId`]:movementId,[`platformPayouts/${payoutId}/depositReversedAt`]:now,[`platformPayouts/${payoutId}/depositReversalReason`]:reason,[`platformPayouts/${payoutId}/depositReversalApprovalId`]:approval.id,[`cfLedger/fm_${movementId}`]:cashLedgerRecord({date:financeDateFromTimestamp(now),accountId,dir:"out",category:"Platform payout deposit correction",amount,party:channel,ref:reference,auto:true},movementId,movement,actor),[`operationalAudit/${now}_${payoutId}_deposit_repair`]:operationalAuditRecord("repair_reversed_payout_deposit","platformPayout",payoutId,actor,{amount,channel,accountId,accountName:account.name,depositMovementId:depositId,repairMovementId:movementId,approvalId:approval.id,approvedBy,reason})});
    const committed = await commitFinancial(db, movementId, movement, actor, writes);
    return {payoutId, amount, movementId, accountId, duplicate:committed.duplicate, repaired:!committed.duplicate};
  },
);

exports.setUndepositedOpeningBalance = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 30, memory: "256MiB"},
  async (request) => {
    const db = getDatabase(), actor = await requirePortalPermission(db, request, ["petty", "cashflow"]), data = request.data || {}, amount = Financial.money(data.amount), date = financeDate(data.date), reference = financeText(data.reference, 120), reason = financeText(data.reason, 500);
    if (!(amount > 0)) throw new HttpsError("invalid-argument", "Beginning balance must be greater than zero.");
    if (!reference) throw new HttpsError("invalid-argument", "A cash-count or opening-balance reference is required.");
    if (!reason) throw new HttpsError("invalid-argument", "An opening-balance basis is required.");
    const movementId = "undeposited_opening_balance", custodyId = "undeposited_opening_balance", existing = await db.ref(`/financialMovements/${movementId}`).get();
    if (existing.exists()) throw new HttpsError("already-exists", "The Undeposited Collection beginning balance has already been posted.");
    const approval = await claimManagerApproval(db, data, "set_undeposited_opening_balance", "undepositedCollection", amount, movementId), approvedBy = approval.record.approvedName || approval.record.approvedEmail || approval.record.approvedRole, occurredAt = Date.parse(`${date}T00:00:00+08:00`) || Date.now(), movement = Financial.movement("undeposited_opening_balance", "cashCustody", custodyId, [Financial.line("asset:cash_awaiting_deposit", amount, 0, "Undeposited Collection beginning balance"), Financial.line("equity:opening_balance", 0, amount, "Opening balance source")], {occurredAt,actorName:approvedBy,approvalId:approval.id,reference,reason});
    const writes = Object.assign({}, approval.usedWrites, {[`cashCustody/${custodyId}`]:{shiftId:custodyId,staff:"Beginning balance",amount,depositedAmount:0,remaining:amount,retainedFloat:0,status:"awaiting_deposit",closedAt:occurredAt,movementId,source:"undeposited_opening_balance",reference,createdAt:Date.now(),createdBy:actor.uid,schemaVersion:2},[`undepositedOpeningBalance`]:{amount,date,reference,reason,movementId,custodyId,postedAt:Date.now(),postedBy:actor.uid,approvedBy,approvalId:approval.id,schemaVersion:1},[`operationalAudit/${Date.now()}_undeposited_opening_balance`]:operationalAuditRecord("set_undeposited_opening_balance","cashCustody",custodyId,actor,{amount,date,reference,reason,approvalId:approval.id,movementId})});
    const committed = await commitFinancial(db, movementId, movement, actor, writes); return {amount,date,reference,movementId,duplicate:committed.duplicate};
  },
);

exports.repairPettyVoucherFinancial = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 30, memory: "256MiB"},
  async (request) => {
    const db = getDatabase(), actor = await requirePortalPermission(db, request, ["petty", "cashflow"]), data = request.data || {}, id = financeKey(data.voucherId, "Voucher ID"), movementId = `petty_${id}`, existing = await db.ref(`/financialMovements/${movementId}`).get();
    if (existing.exists()) return {voucherId:id,movementId,duplicate:true};
    const voucher = (await db.ref(`/pettyCashVouchers/${id}`).get()).val();
    if (!voucher || voucher.status !== "approved" || voucher.voided === true) throw new HttpsError("failed-precondition", "Only an active approved cash payment with a missing posting can be repaired.");
    const value = Financial.money(voucher.amount); if (!(value > 0)) throw new HttpsError("failed-precondition", "The approved cash payment amount is invalid.");
    const isAdvance = voucher.transactionType === "purchase_advance", posting = revolvingFundPosting(voucher), custodyOut = await poolCustodyOutflow(db, value);
    if (custodyOut.shortfall > 0.009) throw new HttpsError("failed-precondition", `Post the Undeposited Collection beginning balance first. Available cash is short by ${custodyOut.shortfall.toFixed(2)}.`);
    const movement = Financial.movement(isAdvance?"revolving_fund_purchase_advance":posting.movementType,"pettyVoucher",id,[Financial.line(isAdvance?`asset:purchase_cash_advance:${id}`:posting.account,value,0,isAdvance?(voucher.recipient||"Supplier payment pending allocation"):posting.label),Financial.line("asset:cash_awaiting_deposit",0,value,"Paid from Undeposited Collection")],{occurredAt:cashPaymentOccurredAt(voucher),approvedAt:Number(voucher.approvedAt||0),actorName:voucher.approvedBy||"Manager",voucherNo:financeText(voucher.voucherNo,60),category:financeText(voucher.category,80),payee:financeText(voucher.recipient||voucher.requesterName,160),purpose:financeText(voucher.purpose,300),custodyAllocations:custodyOut.allocations,repairedAt:Date.now(),repairedBy:actor.uid});
    const now=Date.now(),writes=Object.assign({},custodyOut.writes,{[`pettyCashVouchers/${id}/financialMovementId`]:movementId,[`pettyCashVouchers/${id}/financialRepairedAt`]:now,[`pettyCashVouchers/${id}/financialRepairedBy`]:actor.uid,[`operationalAudit/${now}_${id}_financial_repair`]:operationalAuditRecord("repair_petty_voucher_financial","pettyVoucher",id,actor,{amount:value,movementId,custodyAllocations:custodyOut.allocations})}),committed=await commitFinancial(db,movementId,movement,actor,writes);
    return {voucherId:id,movementId,amount:value,duplicate:committed.duplicate};
  },
);

exports.archiveActivityLog = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 60, memory: "256MiB"},
  async (request) => {
    const db = getDatabase(); const actor = await requirePortalPermission(db, request, ["registerOps"]), cutoff = Date.now() - 60 * 24 * 60 * 60 * 1000;
    const snap = await db.ref("/activityLog").orderByChild("ts").endAt(cutoff).limitToFirst(500).get(), writes = {}; let count = 0;
    snap.forEach((child) => {writes[`activityLogArchive/${child.key}`] = Object.assign({}, child.val() || {}, {archivedAt: Date.now(), archivedBy: actor.uid}); writes[`activityLog/${child.key}`] = null; count++;});
    if (count) await db.ref().update(writes); return {archived: count, hasMore: count === 500};
  },
);

// ---------------------------------------------------------------------------
// Release 2C: bounded operational order projection.
// /orders remains authoritative. /activeOrders contains only orders needed by
// the live register/admin workflow and never carries legacy embedded proofs.
// ---------------------------------------------------------------------------
