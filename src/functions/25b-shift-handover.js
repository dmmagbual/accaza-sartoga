
const ShiftHandover = require('./lib/shift-handover');
// 24 Sep 2026 (Alex, SH-945869): the server confirmed the shift ready to close, then the
// tablet's second close check failed on the device and the cashier was sent to a handover.
// Nothing was outstanding, yet the Z report waited for a manager. finalizeShiftHandover is
// now the single finalization path. A manager uses it with an attestation. The server uses
// it automatically at handover only on the evidence a normal close needs
// (verifyShiftCloseReadiness): no retained sale, every other device queue reported empty,
// every sale posted to inventory and Finance Books, and an open accounting period, plus a
// recent empty-queue report from every crew member still on the shift.
const HANDOVER_AUTO_ACTOR={uid:'server',role:'server'},HANDOVER_CREW_REPORT_MAX_AGE_MS=5*60*1000;
const HANDOVER_AUTO_REASON='Automatic close at handover: no retained sale, every device queue reported empty, and every sale posted to inventory and Finance Books.';
function handoverAutoDelays(){return typeof HANDOVER_AUTO_FINALIZE_DELAYS_MS!=='undefined'&&Array.isArray(HANDOVER_AUTO_FINALIZE_DELAYS_MS)?HANDOVER_AUTO_FINALIZE_DELAYS_MS:[2000,3000,4000];}
function handoverShiftSummary(shift,handover){return {id:shift.id||handover.shiftId,staff:shift.staff||handover.staff||'',openAt:Number(shift.openAt)||0,closeAt:Number(handover.at)||0,openingFloat:Number(shift.openingFloat)||0,floatMode:shift.floatMode||null,configuredFloat:shift.configuredFloat!=null?Number(shift.configuredFloat):null,shiftReference:shift.shiftReference||null,status:'closed'};}
async function finalizeShiftHandover(db,id,actor,options){
  const href=db.ref(`/shiftHandovers/${id}`),sref=db.ref(`/shifts/${id}`),automatic=options.mode==='automatic',reason=options.reason;
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
  const shift=(await sref.get()).val();
  if(!shift||shift.status!=='handover_pending')throw new HttpsError('failed-precondition','The shift is no longer pending reconciliation.');
  const handover=(await href.get()).val();
  if(!handover||handover.state!=='pending')throw new HttpsError('failed-precondition','The handover is no longer pending reconciliation.');
  for(const row of Object.values(handover.commands||{})){
    if(row.quarantined)throw new HttpsError('failed-precondition',`Sale evidence ${row.orderId} needs management recovery. The next shift can continue trading.`);
    const audit=(await db.ref(`/offlinePosSync/${row.command.transactionId}`).get()).val();
    if(!audit||audit.state!=='synced'||audit.orderId!==row.orderId)throw new HttpsError('failed-precondition',`Sale ${row.orderId} still needs recovery. The next shift can continue trading.`);
  }
  if(automatic){
    // The submitting device's queue is the sealed command list (empty here). Every other
    // device must have last reported an empty queue, exactly as verifyShiftCloseReadiness.
    const devices=(await db.ref(`/posDeviceHealth/${id}`).get()).val()||{};
    const busy=Object.values(devices).filter(row=>row&&row.deviceId!==handover.deviceId&&Number(row.outstanding||0)>0);
    if(busy.length)throw new HttpsError('failed-precondition',`${busy.reduce((sum,row)=>sum+Number(row.outstanding||0),0)} sale(s) on ${busy.length} other POS device(s) still require synchronization.`);
    // A handover happens in a degraded state, so crew members still on the shift must have
    // confirmed an empty queue recently; otherwise their unsent sales would be refused by a
    // closed shift instead of recovering into it. A manager finalizes those.
    const crew=(await db.ref(`/shiftCrews/${id}`).get()).val()||{};
    for(const [uid,member] of Object.entries(crew)){
      if(uid===handover.ownerUid||!Object.values(member&&member.sessions||{}).some(s=>s&&Number(s.joinedAt||0)<=handover.at&&(!s.leftAt||Number(s.leftAt)>=handover.at)))continue;
      if(!Object.values(devices).some(row=>row&&row.reportedBy===uid&&!Number(row.outstanding||0)&&handover.at-Number(row.lastContactAt||0)<=HANDOVER_CREW_REPORT_MAX_AGE_MS))throw new HttpsError('failed-precondition',`${financeText(member.staff||'A crew member',60)}'s device has not confirmed an empty sale queue in the 5 minutes before handover.`);
    }
  }else if(options.devicesChecked!==true)throw new HttpsError('failed-precondition','Confirm that every device used for this shift has been checked for unsynchronized sales.');
  const orders=await shiftOrdersForAssurance(db,id),state=await assurancePostingState(db,orders);
  if(state.inventoryOutstanding.length||state.financeOutstanding.length)throw new HttpsError('failed-precondition',`Server postings remain: inventory ${state.inventoryOutstanding.length}, Finance ${state.financeOutstanding.length}. The next shift can continue trading.`);
  const z=ShiftHandover.report(shift,orders,handover),now=Date.now(),mode=automatic?'automatic':'manager';
  z.closeMode=automatic?'automatic_handover':'manager_handover';
  if(handover.closeCheckError)z.closeCheckError=handover.closeCheckError;
  await assertAccountingPeriodOpen(db,handover.at,'finalizing the original shift reconciliation');
  const writes={[`pendingShiftHandovers/${id}`]:null,[`shifts/${id}/status`]:'closed',[`shifts/${id}/reconciliationStatus`]:'resolved',[`shifts/${id}/reconciliationMode`]:mode,[`shifts/${id}/zReport`]:z,[`shiftHandovers/${id}/state`]:'resolved',[`shiftHandovers/${id}/resolvedAt`]:now,[`shiftHandovers/${id}/resolvedBy`]:actor.uid,[`shiftHandovers/${id}/resolutionMode`]:mode,[`shiftHandovers/${id}/resolutionReason`]:reason,[`shiftHandovers/${id}/autoFinalize`]:null,[`shiftCloseVerifications/${id}`]:{shiftId:id,verifiedAt:now,verifiedBy:actor.uid,saleCount:state.saleCount,inventoryOutstanding:0,financeOutstanding:0,handover:true,mode},[`operationalAudit/handover_reconciled_${id}`]:{action:automatic?'auto_finalize_shift_handover':'reconcile_shift_handover',sourceType:'shift',sourceId:id,actorUid:actor.uid,ts:now,reason,variance:z.variance,closeCheckError:handover.closeCheckError||''}};
  for(const key of ['tx','gross','discounts','refunds','cashRefunds','net','cashSales','tips','voidCount','voidAmt','pending','pendingCount','byMethod','byChannel','payIns','payOuts','expectedCash','variance','varianceStatus'])writes[`shifts/${id}/${key}`]=z[key];
  if(z.variance)writes[`discrepancies/handover_${id}`]={kind:'cash',expected:z.expectedCash,actual:z.countedCash,variance:z.variance,value:z.variance,type:z.variance<0?'shortage':'overage',shiftId:id,staff:shift.staff||'',status:'open',financialStatus:'pending_manager_reconciliation',pendingMovementId:`shift_variance_${id}`,ts:handover.at};
  await db.ref().update(writes);
  return {shiftId:id,resolved:true,automatic,variance:z.variance,zReport:z,shift:handoverShiftSummary(shift,handover)};
  }finally{await db.ref(`/shiftSyncGates/${id}/finalizingAt`).transaction(value=>value===lease?0:value,undefined,false);await href.child('reconcileLease').transaction(value=>value===lease?0:value,undefined,false);}
}
// Server postings (inventory, Finance Books) follow a sale by a few seconds. Wait briefly
// for them without holding the sync gate, then let the locked check decide.
async function autoFinalizeShiftHandover(db,id){
  const delays=handoverAutoDelays();
  for(let attempt=0;attempt<delays.length;attempt++){
    const state=await assurancePostingState(db,await shiftOrdersForAssurance(db,id));
    if(!state.inventoryOutstanding.length&&!state.financeOutstanding.length)break;
    await new Promise(resolve=>setTimeout(resolve,delays[attempt]));
  }
  return finalizeShiftHandover(db,id,HANDOVER_AUTO_ACTOR,{mode:'automatic',reason:HANDOVER_AUTO_REASON});
}
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
      const closeCheckError=financeText(data.closeCheckError,300);
      const record={state:'pending',shiftId:id,staff:shift.staff||'',ownerUid:shift.accountUid||actor.uid,at,by:actor.uid,deviceId,cash,commands,devices,schemaVersion:1};if(closeCheckError)record.closeCheckError=closeCheckError;
      const claim=await href.transaction(current=>current||record,undefined,false);handover=claim.snapshot.val();
    }
    if(handover.state==='resolved'){const closed=(await sref.get()).val()||{};return {shiftId:id,alreadyResolved:true,resolved:true,cash:handover.cash,zReport:closed.zReport||null,shift:handoverShiftSummary(closed,handover)};}
    // A retry after a lost response must preserve the first cash count and must never
    // clear an incoming cashier's shift. Saving evidence precedes releasing the till.
    await sref.transaction(row=>row&&row.status!=='closed'?{...row,status:'handover_pending',handoverAt:handover.at,closeAt:handover.at,...handover.cash,reconciliationStatus:'pending',handoverId:id}:row,undefined,false);
    await db.ref().update({[`pendingShiftHandovers/${id}`]:{staff:handover.staff,at:handover.at,cash:handover.cash},[`operationalAudit/handover_${id}`]:{action:'cashier_shift_handover',sourceType:'shift',sourceId:id,actorUid:handover.by,ts:handover.at,countedCash:handover.cash.countedCash,cashToSettle:handover.cash.cashToSettle,closeCheckError:handover.closeCheckError||''},[`ownerDailySummaries/${financeDateFromTimestamp(handover.at)}/${id}`]:{shiftId:id,staff:handover.staff,closedAt:handover.at,status:'handover_pending',controlTotals:handover.cash}});
    await db.ref('/posActiveShift').transaction(row=>row&&row.id===id?null:row,undefined,false);
    await OfflineSync.endShiftCrew(db,id,handover.at,handover.by,'shift_handover');
    const pendingSales=Object.keys(handover.commands||{}).length;
    // Nothing retained: close the shift and produce the Z report now if the server agrees.
    // Any blocker leaves the handover pending for a manager, with the reason recorded.
    if(!pendingSales){
      try{const closed=await autoFinalizeShiftHandover(db,id);return {shiftId:id,handedOver:true,resolved:true,automatic:true,cash:handover.cash,pendingSales:0,zReport:closed.zReport,shift:closed.shift,variance:closed.variance};}
      catch(e){const blocker=String(e&&e.message||e).slice(0,300);await href.update({autoFinalize:{at:Date.now(),blocker}}).catch(()=>{});return {shiftId:id,handedOver:true,cash:handover.cash,pendingSales,autoFinalizeBlocker:blocker};}
    }
    return {shiftId:id,handedOver:true,cash:handover.cash,pendingSales};
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
  if(action==='inspect')return {shiftId:id,state:handover.state,cash:handover.cash,closeCheckError:handover.closeCheckError||'',autoFinalizeBlocker:(handover.autoFinalize&&handover.autoFinalize.blocker)||'',devices:handover.devices||{},commands:Object.entries(handover.commands||{}).map(([key,r])=>({id:key,orderId:r.orderId,lastError:r.lastError||'',syncedAt:r.syncedAt||0}))};
  if(action!=='reconcile'||!manager)throw new HttpsError('permission-denied','A manager must finalize the reconciliation.');
  if(handover.state==='resolved')return {shiftId:id,resolved:true,duplicate:true};
  const reason=financeText(data.reason,500);if(reason.length<5)throw new HttpsError('invalid-argument','Record how every device queue and the cash handover were checked.');
  return finalizeShiftHandover(db,id,actor,{mode:'manager',reason,devicesChecked:data.devicesChecked===true});
});
