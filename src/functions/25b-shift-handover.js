
const ShiftHandover = require('./lib/shift-handover');
exports.manageShiftHandover=onCall({region:ORDER_REGION,enforceAppCheck:ENFORCE_APP_CHECK,timeoutSeconds:120,memory:'512MiB'},async request=>{
  const db=getDatabase(),actor=await requirePortalPermission(db,request,['pos','registerOps']),data=request.data||{},action=data.action||'submit';
  const manager=['owner','superadmin','admin','manager'].includes(actor.role);
  if(action==='list'){
    if(!manager)throw new HttpsError('permission-denied','Only management can review other cashier handovers.');
    const snap=await db.ref('/pendingShiftHandovers').orderByChild('at').limitToFirst(50).get();
    return {rows:Object.entries(snap.val()||{}).map(([shiftId,h])=>({shiftId,...h}))};
  }
  const id=posAssuranceKey(data.shiftId,'Shift ID'),href=db.ref(`/shiftHandovers/${id}`),sref=db.ref(`/shifts/${id}`);
  let handover=(await href.get()).val(),shift=(await sref.get()).val();
  if(!shift)throw new HttpsError('not-found','Shift was not found.');
  if(!manager&&shift.accountUid!==actor.uid)throw new HttpsError('permission-denied','This shift belongs to another cashier.');
  if(action==='submit'){
    if(!handover){
      const active=(await db.ref('/posActiveShift').get()).val();
      if(!active||active.id!==id||shift.status!=='open')throw new HttpsError('failed-precondition','This shift is no longer active.');
      const at=Date.now(),deviceId=posAssuranceKey(data.deviceId,'Device ID');
      let cash,commands;try{cash=ShiftHandover.cashSnapshot(shift,data.closeCount,(await db.ref('/posSettings/fixedFloat').get()).val());commands=ShiftHandover.sealCommands(data.rows||[],shift,at);}catch(e){throw new HttpsError('invalid-argument',e.message);}
      const devices=(await db.ref(`/posDeviceHealth/${id}`).get()).val()||{};
      // The submitting device's fresh queue is captured with the handover. Old reports
      // from other devices remain explicit recovery tasks, never silently discarded.
      devices[deviceId]={deviceId,reportedBy:actor.uid,outstanding:Object.keys(commands).length,lastContactAt:at};
      const record={state:'pending',shiftId:id,staff:shift.staff||'',ownerUid:shift.accountUid||actor.uid,at,by:actor.uid,deviceId,cash,commands,devices,schemaVersion:1};
      const claim=await href.transaction(current=>current||record,undefined,false);handover=claim.snapshot.val();
    }
    if(handover.state==='resolved')return {shiftId:id,alreadyResolved:true,cash:handover.cash};
    // A retry after a lost response must preserve the first cash count and must never
    // clear an incoming cashier's shift. Saving evidence precedes releasing the till.
    await sref.transaction(row=>row&&row.status!=='closed'?{...row,status:'handover_pending',handoverAt:handover.at,closeAt:handover.at,...handover.cash,reconciliationStatus:'pending',handoverId:id}:row,undefined,false);
    await db.ref().update({[`pendingShiftHandovers/${id}`]:{staff:handover.staff,at:handover.at,cash:handover.cash},[`operationalAudit/handover_${id}`]:{action:'cashier_shift_handover',sourceType:'shift',sourceId:id,actorUid:handover.by,ts:handover.at,countedCash:handover.cash.countedCash,cashToSettle:handover.cash.cashToSettle},[`ownerDailySummaries/${financeDateFromTimestamp(handover.at)}/${id}`]:{shiftId:id,staff:handover.staff,closedAt:handover.at,status:'handover_pending',controlTotals:handover.cash}});
    await db.ref('/posActiveShift').transaction(row=>row&&row.id===id?null:row,undefined,false);
    await OfflineSync.endShiftCrew(db,id,handover.at,handover.by,'shift_handover');
    return {shiftId:id,handedOver:true,cash:handover.cash,pendingSales:Object.keys(handover.commands||{}).length};
  }
  if(!handover)throw new HttpsError('not-found','No handover exists for this shift.');
  if(action==='retry'){
    // Management can replay only the exact command retained at handover. Normal
    // sale validation, inventory posting, period locks and idempotency still apply.
    const results=[];
    for(const [key,row] of Object.entries(handover.commands||{}).filter(([,row])=>!row.syncedAt).slice(0,25)){
      if(row.quarantined){results.push({id:key,synced:false,error:row.lastError});continue;}
      try{
        const recovery=await OfflineSync.recoveryContext(db,id,row.command&&row.command.order&&row.command.order.soldByUid,actor.uid);
        await OfflineSync.syncOfflinePosSaleCommand({db,actor:{...actor,uid:handover.ownerUid},recovery,data:row.command,textField,money,listFromFirebase,activeOrderProjection,availableCash:availableCashOnHandAboveFloat,prepareOrder:async(order,now)=>({order,inventoryPlan:await calculateOrderInventoryPlan(db,order,now)})});
        await href.child(`commands/${key}`).update({syncedAt:Date.now(),lastError:'',recoveredBy:actor.uid});results.push({id:key,synced:true});
      }catch(e){const message=String(e.message||e).slice(0,500);await href.child(`commands/${key}`).update({lastError:message});results.push({id:key,synced:false,error:message});}
    }
    return {results};
  }
  if(action==='inspect')return {shiftId:id,state:handover.state,cash:handover.cash,devices:handover.devices||{},commands:Object.entries(handover.commands||{}).map(([key,r])=>({id:key,orderId:r.orderId,lastError:r.lastError||'',syncedAt:r.syncedAt||0}))};
  if(action!=='reconcile'||!manager)throw new HttpsError('permission-denied','A manager must finalize the reconciliation.');
  if(handover.state==='resolved')return {shiftId:id,resolved:true,duplicate:true};
  const reason=financeText(data.reason,500);if(reason.length<5)throw new HttpsError('invalid-argument','Record how every device queue and the cash handover were checked.');
  const lease=Date.now();
  const locked=await href.child('reconcileLease').transaction(value=>Number(value||0)>lease-180000?undefined:lease,undefined,false);
  if(!locked.committed)throw new HttpsError('aborted','Another reconciliation is running. Retry shortly.');
  try{
  const frozen=await db.ref(`/shiftSyncGates/${id}`).transaction(value=>{
    const gate=value||{};
    if(Number(gate.finalizingAt||0)>lease-180000||Object.values(gate.pending||{}).some(entry=>Number(entry&&entry.at||entry)>lease-180000))return;
    return {...gate,finalizingAt:lease};
  },undefined,false);
  if(!frozen.committed)throw new HttpsError('failed-precondition','A sale still needs recovery or is syncing. The next shift can continue trading.');
  shift=(await sref.get()).val();
  if(!shift||shift.status!=='handover_pending')throw new HttpsError('failed-precondition','The shift is no longer pending reconciliation.');
  handover=(await href.get()).val();
  if(!handover||handover.state!=='pending')throw new HttpsError('failed-precondition','The handover is no longer pending reconciliation.');
  for(const row of Object.values(handover.commands||{})){
    if(row.quarantined)throw new HttpsError('failed-precondition',`Sale evidence ${row.orderId} needs management recovery. The next shift can continue trading.`);
    const audit=(await db.ref(`/offlinePosSync/${row.command.transactionId}`).get()).val();
    if(!audit||audit.state!=='synced'||audit.orderId!==row.orderId)throw new HttpsError('failed-precondition',`Sale ${row.orderId} still needs recovery. The next shift can continue trading.`);
  }
  if(data.devicesChecked!==true)throw new HttpsError('failed-precondition','Confirm that every device used for this shift has been checked for unsynchronized sales.');
  const orders=await shiftOrdersForAssurance(db,id),state=await assurancePostingState(db,orders);
  if(state.inventoryOutstanding.length||state.financeOutstanding.length)throw new HttpsError('failed-precondition',`Server postings remain: inventory ${state.inventoryOutstanding.length}, Finance ${state.financeOutstanding.length}. The next shift can continue trading.`);
  const z=ShiftHandover.report(shift,orders,handover),now=Date.now();
  await assertAccountingPeriodOpen(db,handover.at,'finalizing the original shift reconciliation');
  const writes={[`pendingShiftHandovers/${id}`]:null,[`shifts/${id}/status`]:'closed',[`shifts/${id}/reconciliationStatus`]:'resolved',[`shifts/${id}/zReport`]:z,[`shiftHandovers/${id}/state`]:'resolved',[`shiftHandovers/${id}/resolvedAt`]:now,[`shiftHandovers/${id}/resolvedBy`]:actor.uid,[`shiftHandovers/${id}/resolutionReason`]:reason,[`shiftCloseVerifications/${id}`]:{shiftId:id,verifiedAt:now,verifiedBy:actor.uid,saleCount:state.saleCount,inventoryOutstanding:0,financeOutstanding:0,handover:true},[`operationalAudit/handover_reconciled_${id}`]:{action:'reconcile_shift_handover',sourceType:'shift',sourceId:id,actorUid:actor.uid,ts:now,reason,variance:z.variance}};
  for(const key of ['tx','gross','discounts','refunds','cashRefunds','net','cashSales','tips','voidCount','voidAmt','pending','pendingCount','byMethod','byChannel','payIns','payOuts','expectedCash','variance','varianceStatus'])writes[`shifts/${id}/${key}`]=z[key];
  if(z.variance)writes[`discrepancies/handover_${id}`]={kind:'cash',expected:z.expectedCash,actual:z.countedCash,variance:z.variance,value:z.variance,type:z.variance<0?'shortage':'overage',shiftId:id,staff:shift.staff||'',status:'open',financialStatus:'pending_manager_reconciliation',pendingMovementId:`shift_variance_${id}`,ts:handover.at};
  await db.ref().update(writes);
  return {shiftId:id,resolved:true,variance:z.variance};
  }finally{await db.ref(`/shiftSyncGates/${id}/finalizingAt`).transaction(value=>value===lease?0:value,undefined,false);await href.child('reconcileLease').transaction(value=>value===lease?0:value,undefined,false);}
});
