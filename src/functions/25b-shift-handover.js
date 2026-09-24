
const ShiftHandover = require('./lib/shift-handover');
// Shift close must always end with a Z report (Danilo, 24 Sep 2026, after SH-945869).
// 1. A normal close prints the final Z at the till.
// 2. A handover, whatever caused it, prints a PROVISIONAL Z at once: the server's orders plus
//    the retained sales already in the counted drawer, with every open item listed.
// 3. The server then issues the FINAL Z by itself: at handover and every 5 minutes it replays
//    retained sales and closes as soon as the evidence a normal close needs is present
//    (verifyShiftCloseReadiness: device queues empty, crew reported, postings done, period open).
// 4. When the next shift ends, a handover still open is closed with a final Z that lists the
//    remaining items as exceptions; unrecovered sales go to Sales needing recovery and can
//    still be recovered into the original shift, which re-issues the Z as an amendment.
// A manager can finalize at any point with the device attestation. All paths share
// finalizeShiftHandover: the same leases, sync-gate freeze, Z calculation and period lock.
const HANDOVER_AUTO_ACTOR={uid:'server',role:'server'},HANDOVER_CREW_REPORT_MAX_AGE_MS=5*60*1000;
const HANDOVER_AUTO_REASON='Automatic close at handover: no retained sale, every device queue reported empty, and every sale posted to inventory and Finance Books.';
const HANDOVER_GRACE_REASON='Final Z issued when the next shift ended; the open items listed on the report remain for management.';
function handoverAutoDelays(){return typeof HANDOVER_AUTO_FINALIZE_DELAYS_MS!=='undefined'&&Array.isArray(HANDOVER_AUTO_FINALIZE_DELAYS_MS)?HANDOVER_AUTO_FINALIZE_DELAYS_MS:[2000,3000,4000];}
function handoverShiftSummary(shift,handover){return {id:shift.id||handover.shiftId,staff:shift.staff||handover.staff||'',openAt:Number(shift.openAt)||0,closeAt:Number(handover.at)||0,openingFloat:Number(shift.openingFloat)||0,floatMode:shift.floatMode||null,configuredFloat:shift.configuredFloat!=null?Number(shift.configuredFloat):null,shiftReference:shift.shiftReference||null,status:'closed'};}
// Everything that can keep a handover open, as data: it blocks an automatic close, prints on
// the provisional Z, and becomes the exception list of a final Z issued at the next shift end.
async function handoverOpenItems(db,id,handover,orders){
  const [devices,crew]=(await Promise.all([db.ref(`/posDeviceHealth/${id}`).get(),db.ref(`/shiftCrews/${id}`).get()])).map(snap=>snap.val()||{});
  const retainedSales=[];
  for(const [key,row] of Object.entries(handover.commands||{})){
    if(!row||row.syncedAt)continue;
    if(!row.quarantined){const audit=(await db.ref(`/offlinePosSync/${row.command.transactionId}`).get()).val();if(audit&&audit.state==='synced'&&audit.orderId===row.orderId)continue;}
    retainedSales.push({transactionId:key,orderId:String(row.orderId||key).slice(0,120),total:Number(row.command&&row.command.order&&row.command.order.total)||0,quarantined:!!row.quarantined,lastError:String(row.lastError||'').slice(0,200)});
  }
  const otherDevices=Object.values(devices).filter(row=>row&&row.deviceId!==handover.deviceId&&Number(row.outstanding||0)>0).map(row=>({deviceId:String(row.deviceId||'').slice(0,100),outstanding:Number(row.outstanding)||0,lastContactAt:Number(row.lastContactAt)||0}));
  // Crew still on the shift at handover must have confirmed an empty queue recently;
  // otherwise their unsent sales would meet a closed shift instead of recovering into it.
  const crewUnreported=[];
  for(const [uid,member] of Object.entries(crew)){
    if(uid===handover.ownerUid||!Object.values(member&&member.sessions||{}).some(s=>s&&Number(s.joinedAt||0)<=handover.at&&(!s.leftAt||Number(s.leftAt)>=handover.at)))continue;
    if(!Object.values(devices).some(row=>row&&row.reportedBy===uid&&!Number(row.outstanding||0)&&handover.at-Number(row.lastContactAt||0)<=HANDOVER_CREW_REPORT_MAX_AGE_MS))crewUnreported.push({uid,staff:financeText(member.staff||'A crew member',60)});
  }
  const state=await assurancePostingState(db,orders);
  return {retainedSales,otherDevices,crewUnreported,postingInventory:state.inventoryOutstanding.slice(0,50),postingFinance:state.financeOutstanding.slice(0,50),saleCount:state.saleCount,closeCheckError:handover.closeCheckError||''};
}
function openItemBlocker(items,scope){
  const all=!scope,retained=items.retainedSales[0];
  if(retained)return retained.quarantined?`Sale evidence ${retained.orderId} needs management recovery.`:`Sale ${retained.orderId} still needs recovery.`;
  if(all&&items.otherDevices.length)return `${items.otherDevices.reduce((sum,row)=>sum+row.outstanding,0)} sale(s) on ${items.otherDevices.length} other POS device(s) still require synchronization.`;
  if(all&&items.crewUnreported.length)return `${items.crewUnreported[0].staff}'s device has not confirmed an empty sale queue in the 5 minutes before handover.`;
  if(scope!=='retained'&&(items.postingInventory.length||items.postingFinance.length))return `Server postings remain: inventory ${items.postingInventory.length}, Finance ${items.postingFinance.length}.`;
  return '';
}
function closeExceptions(items){const out={};for(const key of ['retainedSales','otherDevices','crewUnreported','postingInventory','postingFinance'])if(items[key].length)out[key]=items[key];return Object.keys(out).length?out:null;}
async function finalizeShiftHandover(db,id,actor,options){
  const href=db.ref(`/shiftHandovers/${id}`),sref=db.ref(`/shifts/${id}`),mode=options.mode,reason=options.reason;
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
  const orders=await shiftOrdersForAssurance(db,id),items=await handoverOpenItems(db,id,handover,orders);
  if(mode==='manager'){
    const retained=openItemBlocker(items,'retained');if(retained)throw new HttpsError('failed-precondition',`${retained} The next shift can continue trading.`);
    if(options.devicesChecked!==true)throw new HttpsError('failed-precondition','Confirm that every device used for this shift has been checked for unsynchronized sales.');
    const posting=openItemBlocker(items,'posting');if(posting)throw new HttpsError('failed-precondition',`${posting} The next shift can continue trading.`);
  }else if(mode==='automatic'){const blocker=openItemBlocker(items);if(blocker)throw new HttpsError('failed-precondition',blocker);}
  const z=ShiftHandover.report(shift,orders,handover),now=Date.now(),exceptions=mode==='grace'?closeExceptions(items):null;
  z.closeMode=`${mode}_handover`;z.shiftReference=shift.shiftReference||null;
  if(handover.closeCheckError)z.closeCheckError=handover.closeCheckError;
  if(exceptions)z.exceptions=exceptions;
  await assertAccountingPeriodOpen(db,handover.at,'finalizing the original shift reconciliation');
  const writes={[`pendingShiftHandovers/${id}`]:null,[`shifts/${id}/status`]:'closed',[`shifts/${id}/reconciliationStatus`]:'resolved',[`shifts/${id}/reconciliationMode`]:mode,[`shifts/${id}/zReport`]:z,[`shifts/${id}/provisionalZReport`]:null,[`shiftHandovers/${id}/state`]:'resolved',[`shiftHandovers/${id}/resolvedAt`]:now,[`shiftHandovers/${id}/resolvedBy`]:actor.uid,[`shiftHandovers/${id}/resolutionMode`]:mode,[`shiftHandovers/${id}/resolutionReason`]:reason,[`shiftHandovers/${id}/autoFinalize`]:null,[`shiftCloseVerifications/${id}`]:{shiftId:id,verifiedAt:now,verifiedBy:actor.uid,saleCount:items.saleCount,inventoryOutstanding:items.postingInventory.length,financeOutstanding:items.postingFinance.length,handover:true,mode},[`operationalAudit/handover_reconciled_${id}`]:{action:mode==='manager'?'reconcile_shift_handover':mode==='automatic'?'auto_finalize_shift_handover':'grace_finalize_shift_handover',sourceType:'shift',sourceId:id,actorUid:actor.uid,ts:now,reason,variance:z.variance,closeCheckError:handover.closeCheckError||'',exceptionCount:exceptions?Object.values(exceptions).reduce((sum,list)=>sum+list.length,0):0}};
  for(const key of ['tx','gross','discounts','refunds','cashRefunds','net','cashSales','tips','voidCount','voidAmt','pending','pendingCount','byMethod','byChannel','payIns','payOuts','expectedCash','variance','varianceStatus'])writes[`shifts/${id}/${key}`]=z[key];
  if(z.variance)writes[`discrepancies/handover_${id}`]={kind:'cash',expected:z.expectedCash,actual:z.countedCash,variance:z.variance,value:z.variance,type:z.variance<0?'shortage':'overage',shiftId:id,staff:shift.staff||'',status:'open',financialStatus:'pending_manager_reconciliation',pendingMovementId:`shift_variance_${id}`,ts:handover.at};
  if(exceptions)writes[`shiftCloseFollowUps/${id}`]={shiftId:id,staff:shift.staff||'',kind:'closed_with_exceptions',at:now,closedAt:handover.at,exceptions,state:'open',schemaVersion:1};
  await db.ref().update(writes);
  // A sale still retained when the next shift ended is not lost: it moves to Sales needing
  // recovery with its exact command, and recovering it re-issues this shift's Z report.
  if(exceptions&&exceptions.retainedSales)for(const row of exceptions.retainedSales){const sealed=handover.commands&&handover.commands[row.transactionId];if(sealed&&sealed.command)await OfflineSync.recordSyncAlert(db,{uid:handover.ownerUid},sealed.command,{code:'failed-precondition',message:`Retained at the ${shift.staff||'cashier'} handover and not recovered before the next shift ended. Recover it into the original shift.`},now);}
  return {shiftId:id,resolved:true,mode,automatic:mode!=='manager',variance:z.variance,zReport:z,shift:handoverShiftSummary(shift,handover)};
  }finally{await db.ref(`/shiftSyncGates/${id}/finalizingAt`).transaction(value=>value===lease?0:value,undefined,false);await href.child('reconcileLease').transaction(value=>value===lease?0:value,undefined,false);}
}
// Replays the exact commands retained at handover through normal sale validation.
async function retryRetainedSales(db,id,handover,actor){
  const href=db.ref(`/shiftHandovers/${id}`),results=[];
  for(const [key,row] of Object.entries(handover.commands||{}).filter(([,row])=>!row.syncedAt).slice(0,25)){
    if(row.quarantined){results.push({id:key,synced:false,error:row.lastError});continue;}
    try{
      const recovery=await OfflineSync.recoveryContext(db,id,row.command&&row.command.order&&row.command.order.soldByUid,actor.uid);
      await OfflineSync.syncOfflinePosSaleCommand({db,actor:{...actor,uid:handover.ownerUid},recovery,data:row.command,textField,money,listFromFirebase,activeOrderProjection,availableCash:availableCashOnHandAboveFloat,prepareOrder:async(order,now)=>({order,inventoryPlan:await calculateOrderInventoryPlan(db,order,now)})});
      await href.child(`commands/${key}`).update({syncedAt:Date.now(),lastError:'',recoveredBy:actor.uid});results.push({id:key,synced:true});
    }catch(e){const message=String(e.message||e).slice(0,500);await href.child(`commands/${key}`).update({lastError:message});results.push({id:key,synced:false,error:message});}
  }
  return results;
}
// Server postings (inventory, Finance Books) follow a sale by a few seconds. Wait briefly
// for them without holding the sync gate, then let the locked check decide.
async function autoFinalizeShiftHandover(db,id,delays){
  delays=delays||handoverAutoDelays();
  for(let attempt=0;attempt<delays.length;attempt++){
    const state=await assurancePostingState(db,await shiftOrdersForAssurance(db,id));
    if(!state.inventoryOutstanding.length&&!state.financeOutstanding.length)break;
    await new Promise(resolve=>setTimeout(resolve,delays[attempt]));
  }
  return finalizeShiftHandover(db,id,HANDOVER_AUTO_ACTOR,{mode:'automatic',reason:HANDOVER_AUTO_REASON});
}
// One resolution pass: replay retained sales, close automatically when clean, and when the
// next shift has ended (force) close with the remaining items listed as exceptions.
async function resolveShiftHandover(db,id,options){
  options=options||{};
  const href=db.ref(`/shiftHandovers/${id}`),handover=(await href.get()).val();
  if(!handover||handover.state!=='pending')return {shiftId:id,resolved:!!handover&&handover.state==='resolved',skipped:true};
  // Once the next shift has ended the final Z is due; remember it so a pass that could not
  // finish (a sale syncing at that moment) is completed by the 5-minute pass.
  const force=!!(options.force||handover.graceDueAt);
  if(options.force&&!handover.graceDueAt)await href.update({graceDueAt:Date.now()});
  if(Object.values(handover.commands||{}).some(row=>row&&!row.syncedAt&&!row.quarantined))await retryRetainedSales(db,id,handover,HANDOVER_AUTO_ACTOR);
  let blocker;
  try{return await autoFinalizeShiftHandover(db,id,options.delays);}catch(e){blocker=String(e&&e.message||e).slice(0,300);}
  if(force){try{return await finalizeShiftHandover(db,id,HANDOVER_AUTO_ACTOR,{mode:'grace',reason:HANDOVER_GRACE_REASON});}catch(e){blocker=`Could not issue the final Z: ${String(e&&e.message||e)}`.slice(0,300);}}
  await href.update({autoFinalize:{at:Date.now(),blocker}}).catch(()=>{});
  return {shiftId:id,resolved:false,blocker};
}
async function provisionalShiftZ(db,id){
  const shift=(await db.ref(`/shifts/${id}`).get()).val(),handover=(await db.ref(`/shiftHandovers/${id}`).get()).val();
  if(!shift||!handover||handover.state!=='pending')return null;
  const orders=await shiftOrdersForAssurance(db,id),items=await handoverOpenItems(db,id,handover,orders);
  const z={...ShiftHandover.provisionalReport(shift,orders,handover,closeExceptions(items)||{}),shiftReference:shift.shiftReference||null,generatedAt:Date.now()};
  if(handover.closeCheckError)z.closeCheckError=handover.closeCheckError;
  await db.ref(`/shifts/${id}`).update({provisionalZReport:z});
  return z;
}
// A late sale recovered into a closed shift re-issues its Z report as an amendment. The cash
// variance already posted at close is not rewritten: the amended Z shows both figures and a
// follow-up asks management to settle the difference through Discrepancies.
async function amendClosedShiftZ(db,id,actor,details){
  const shift=(await db.ref(`/shifts/${id}`).get()).val();
  if(!shift||shift.status!=='closed')return null;
  const previous=shift.zReport||{},pick=key=>previous[key]!=null?previous[key]:shift[key];
  const cash={countedCash:Number(pick('countedCash'))||0,closeCount:pick('closeCount')||{},retainedFloat:Number(pick('retainedFloat'))||0,actualFloatRetained:Number(pick('actualFloatRetained'))||0,floatShortfall:Number(pick('floatShortfall'))||0,cashToSettle:Number(pick('cashToSettle'))||0};
  const orders=await shiftOrdersForAssurance(db,id),z=ShiftHandover.report(shift,orders,{cash,at:Number(previous.capturedAt||shift.closeAt)||Date.now()}),now=Date.now(),n=Number(previous.amendmentCount||0)+1;
  for(const key of ['calculation','floatMode','configuredFloat','tolerance','reconcileTotalOnly','closeMode','closeCheckError','shiftReference'])if(previous[key]!=null)z[key]=previous[key];
  const postedVariance=previous.postedVariance!=null?Number(previous.postedVariance):Number(pick('variance'))||0;
  Object.assign(z,{amendmentCount:n,amendedAt:now,amendedBy:actor.uid,amendmentReason:financeText(details.reason,300),amendedOrderId:String(details.orderId||'').slice(0,120),postedVariance,varianceStatus:previous.varianceStatus||shift.varianceStatus||'reconciled'});
  if(previous.exceptions){const exceptions={...previous.exceptions};if(exceptions.retainedSales){exceptions.retainedSales=exceptions.retainedSales.filter(row=>row.orderId!==details.orderId);if(!exceptions.retainedSales.length)delete exceptions.retainedSales;}if(Object.keys(exceptions).length)z.exceptions=exceptions;}
  const writes={[`shiftZHistory/${id}/${n}`]:{...previous,supersededAt:now},[`shifts/${id}/zReport`]:z,[`operationalAudit/${now}_shift_z_amended_${id}`]:{action:'amend_shift_z_report',sourceType:'shift',sourceId:id,actorUid:actor.uid,ts:now,orderId:z.amendedOrderId,amendment:n,previousNet:Number(previous.net)||0,net:z.net,postedVariance,recalculatedVariance:z.variance}};
  // Sales totals follow the amendment; the posted cash-control figures stay as closed.
  for(const key of ['tx','gross','discounts','refunds','cashRefunds','net','cashSales','tips','voidCount','voidAmt','pending','pendingCount','byMethod','byChannel'])writes[`shifts/${id}/${key}`]=z[key];
  if(Math.abs(z.variance-postedVariance)>=.005)writes[`shiftCloseFollowUps/${id}`]={shiftId:id,staff:shift.staff||'',kind:'late_sale_variance',at:now,closedAt:Number(shift.closeAt)||0,postedVariance,recalculatedVariance:z.variance,orderId:z.amendedOrderId,state:'open',schemaVersion:1};
  await db.ref().update(writes);
  return z;
}
exports.manageShiftHandover=onCall({region:ORDER_REGION,enforceAppCheck:ENFORCE_APP_CHECK,timeoutSeconds:120,memory:'512MiB'},async request=>{
  const db=getDatabase(),actor=await requirePortalPermission(db,request,['pos','registerOps']),data=request.data||{},action=data.action||'submit';
  const manager=['owner','superadmin','admin','manager'].includes(actor.role);
  if(action==='list'){
    if(!manager)throw new HttpsError('permission-denied','Only management can review other cashier handovers.');
    const [snap,follow]=await Promise.all([db.ref('/pendingShiftHandovers').orderByChild('at').limitToFirst(50).get(),db.ref('/shiftCloseFollowUps').orderByChild('state').equalTo('open').limitToFirst(50).get()]);
    return {rows:Object.entries(snap.val()||{}).map(([shiftId,h])=>({shiftId,...h})),followUps:Object.entries(follow.val()||{}).map(([shiftId,f])=>({...f,shiftId}))};
  }
  if(action==='review_followup'){
    if(!manager)throw new HttpsError('permission-denied','Only management can review shift close follow-ups.');
    const shiftId=posAssuranceKey(data.shiftId,'Shift ID'),reason=financeText(data.reason,300);if(reason.length<5)throw new HttpsError('invalid-argument','Record what was checked or corrected.');
    const now=Date.now(),claim=await db.ref(`/shiftCloseFollowUps/${shiftId}`).transaction(row=>row==null?null:row.state==='open'?{...row,state:'reviewed',reviewedAt:now,reviewedBy:actor.uid,reviewReason:reason}:row,undefined,false);
    const row=claim.snapshot.val();if(!row)throw new HttpsError('not-found','That follow-up was not found.');
    await db.ref().update({[`operationalAudit/${now}_shift_close_followup_${shiftId}`]:{action:'review_shift_close_followup',sourceType:'shift',sourceId:shiftId,actorUid:actor.uid,ts:now,reason,kind:row.kind||''}});
    return {shiftId,state:row.state};
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
    // The server replays the retained sales itself and closes when the evidence is clean.
    // Otherwise the cashier still leaves with a provisional Z report listing what is open.
    let outcome;try{outcome=await resolveShiftHandover(db,id);}catch(e){outcome={resolved:false,blocker:String(e&&e.message||e).slice(0,300)};}
    if(outcome.resolved&&outcome.zReport)return {shiftId:id,handedOver:true,resolved:true,automatic:true,cash:handover.cash,pendingSales,zReport:outcome.zReport,shift:outcome.shift,variance:outcome.variance};
    let provisional=null;try{provisional=await provisionalShiftZ(db,id);}catch(_e){provisional=null;}
    return {shiftId:id,handedOver:true,cash:handover.cash,pendingSales,autoFinalizeBlocker:outcome.blocker||'',provisionalZReport:provisional,shift:handoverShiftSummary(shift,handover)};
  }
  if(!handover)throw new HttpsError('not-found','No handover exists for this shift.');
  if(action==='retry'){
    // Management can replay only the exact command retained at handover. Normal
    // sale validation, inventory posting, period locks and idempotency still apply.
    return {results:await retryRetainedSales(db,id,handover,actor)};
  }
  if(action==='inspect')return {shiftId:id,state:handover.state,cash:handover.cash,closeCheckError:handover.closeCheckError||'',autoFinalizeBlocker:(handover.autoFinalize&&handover.autoFinalize.blocker)||'',devices:handover.devices||{},commands:Object.entries(handover.commands||{}).map(([key,r])=>({id:key,orderId:r.orderId,lastError:r.lastError||'',syncedAt:r.syncedAt||0}))};
  if(action==='provisional_z'){if(handover.state!=='pending'){const closed=(await sref.get()).val()||{};return {shiftId:id,zReport:closed.zReport||null,shift:handoverShiftSummary(closed,handover)};}return {shiftId:id,provisionalZReport:await provisionalShiftZ(db,id),shift:handoverShiftSummary(shift,handover)};}
  if(action!=='reconcile'||!manager)throw new HttpsError('permission-denied','A manager must finalize the reconciliation.');
  if(handover.state==='resolved')return {shiftId:id,resolved:true,duplicate:true};
  const reason=financeText(data.reason,500);if(reason.length<5)throw new HttpsError('invalid-argument','Record how every device queue and the cash handover were checked.');
  return finalizeShiftHandover(db,id,actor,{mode:'manager',reason,devicesChecked:data.devicesChecked===true});
});
// Every 5 minutes: replay retained sales and issue the final Z for any handover that is now
// clean. Reads only the pending list (normally empty).
exports.resolvePendingShiftHandovers=onSchedule({schedule:'every 5 minutes',timeZone:'Asia/Manila',region:ORDER_REGION,timeoutSeconds:300,memory:'512MiB'},async()=>{
  const db=getDatabase(),rows=(await db.ref('/pendingShiftHandovers').orderByChild('at').limitToFirst(20).get()).val()||{};
  for(const id of Object.keys(rows)){try{const out=await resolveShiftHandover(db,id,{delays:[]});if(out.resolved&&!out.skipped)logger.info('Shift handover closed automatically',{shiftId:id,mode:out.mode});}catch(error){logger.warn('Shift handover resolution failed',{shiftId:id,error:String(error&&error.message||error)});}}
});
// When a shift ends (closed or handed over), any earlier handover still open gets its final
// Z now, with the remaining items listed as exceptions (Danilo: "until the next shift closes").
exports.onShiftEndResolveEarlierHandovers=onValueWritten({ref:'/shifts/{shiftId}/status',region:ORDER_REGION,retry:false},async event=>{
  const after=event.data.after.val(),before=event.data.before.val();
  if(!['closed','handover_pending'].includes(after)||before===after)return;
  const db=getDatabase(),shiftId=event.params.shiftId,shift=(await db.ref(`/shifts/${shiftId}`).get()).val()||{},openAt=Number(shift.openAt)||0;
  if(!openAt)return;
  const rows=(await db.ref('/pendingShiftHandovers').orderByChild('at').endAt(openAt).limitToFirst(20).get()).val()||{};
  for(const [id,row] of Object.entries(rows)){if(id===shiftId||!(Number(row&&row.at)<=openAt))continue;try{await resolveShiftHandover(db,id,{force:true,delays:[]});}catch(error){logger.warn('Grace shift handover resolution failed',{shiftId:id,error:String(error&&error.message||error)});}}
});
