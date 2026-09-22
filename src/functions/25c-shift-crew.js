const ShiftCrew = require('./lib/shift-crew');
// Shift crew (Sep 2026): the cashier who opens the shift keeps the one cash drawer; other
// linked staff join the open shift with their own login and PIN and ring sales under their
// own name. /shiftCrews is the only authority; the posActiveShift/shifts copies are for display.
const POS_MANAGEMENT_ROLES=['owner','superadmin','admin','manager'];
async function linkedPosStaff(db,uid){
  const rows=(/* download-ok: bounded POS staff list (a handful of profiles) */await db.ref('/posStaff').get()).val()||{},matches=Object.entries(rows).filter(([,row])=>row&&row.accountUid===uid);
  if(matches.length!==1)throw new HttpsError('failed-precondition','Your login is not linked to one POS staff profile. Ask a manager to link it in POS Settings.');
  return {staffId:matches[0][0],row:matches[0][1]};
}
async function mirrorCrewMember(db,shiftId,uid,mirror){
  // Display copies only. posActiveShift is updated only while it is still this shift.
  await db.ref('/posActiveShift').transaction(row=>{
    if(row==null)return null;
    if(row.id!==shiftId)return row;
    const crew=Object.assign({},row.crew||{});if(mirror)crew[uid]=mirror;else delete crew[uid];
    return Object.assign({},row,{crew});
  },undefined,false);
  await db.ref(`/shifts/${shiftId}/crew/${uid}`).update(mirror?Object.assign({},mirror,{leftAt:null}):{leftAt:Date.now()});
}
exports.managePosShiftCrew=onCall({region:ORDER_REGION,enforceAppCheck:ENFORCE_APP_CHECK,timeoutSeconds:30,memory:'256MiB'},async request=>{
  const db=getDatabase(),actor=await requirePortalPermission(db,request,['pos','registerOps']),data=request.data||{},action=String(data.action||'');
  const shiftId=posAssuranceKey(data.shiftId,'Shift ID'),manager=POS_MANAGEMENT_ROLES.includes(actor.role);
  const [activeSnap,shiftSnap]=await Promise.all([db.ref('/posActiveShift').get(),db.ref(`/shifts/${shiftId}`).get()]),active=activeSnap.val()||{},shift=shiftSnap.val();
  if(!shift)throw new HttpsError('not-found','Shift was not found.');
  const crewRef=db.ref(`/shiftCrews/${shiftId}`),now=Date.now();
  if(action==='join'){
    if(active.id!==shiftId||active.status==='closed'||shift.status!=='open')throw new HttpsError('failed-precondition','Only the open shift can be joined.');
    if(!shift.accountUid||shift.accountUid===actor.uid)return {shiftId,owner:true};
    const {staffId,row}=await linkedPosStaff(db,actor.uid);
    if(!posPinValid(data.pin,row))throw new HttpsError('permission-denied','Your POS PIN is incorrect.');
    const member={uid:actor.uid,staffId,staff:posStaffText(row.name,'Staff name',120),joinedBy:actor.uid};
    let created=false;
    const result=await crewRef.child(actor.uid).transaction(current=>{const next=ShiftCrew.joinRecord(current,member,now);created=next!==current;return next;},undefined,false);
    const saved=result.snapshot.val(),mirror=ShiftCrew.mirrorOf(saved);
    if(!result.committed||!mirror)throw new HttpsError('aborted','Could not join the shift. Try again.');
    const duplicate=!created;
    await mirrorCrewMember(db,shiftId,actor.uid,mirror);
    if(!duplicate)await db.ref(`/operationalAudit/${now}_pos_crew_join_${shiftId}_${actor.uid}`).set(operationalAuditRecord('join_pos_shift_crew','shift',shiftId,actor,{staffId,staff:member.staff,shiftOwner:shift.staff||''}));
    return {shiftId,joined:true,duplicate,crew:mirror};
  }
  if(action==='leave'||action==='remove'){
    const target=action==='leave'?actor.uid:posAssuranceKey(data.uid,'Staff login');
    if(action==='remove'&&!manager&&shift.accountUid!==actor.uid)throw new HttpsError('permission-denied','Only the shift owner or a manager can remove crew.');
    const reason=action==='leave'?'left':'removed';
    const result=await crewRef.child(target).transaction(current=>current==null?null:ShiftCrew.leaveRecord(current,now,actor.uid,reason),undefined,false);
    const saved=result.snapshot.val();
    if(!saved)throw new HttpsError('not-found','That person is not on this shift crew.');
    await mirrorCrewMember(db,shiftId,target,null);
    await db.ref(`/operationalAudit/${now}_pos_crew_${reason}_${shiftId}_${target}`).set(operationalAuditRecord(`${reason==='left'?'leave':'remove'}_pos_shift_crew`,'shift',shiftId,actor,{uid:target,staff:saved.staff||''}));
    return {shiftId,uid:target,left:true};
  }
  throw new HttpsError('invalid-argument','Unknown shift crew action.');
});

// Management recovery of sales the server refused (captured in /posSyncAlerts). The exact
// command the device sent is replayed through normal sale validation into the original
// shift as its owner; the person who rang it stays on the order. Nothing is edited by hand.
exports.managePosSaleRecovery=onCall({region:ORDER_REGION,enforceAppCheck:ENFORCE_APP_CHECK,timeoutSeconds:120,memory:'512MiB'},async request=>{
  const db=getDatabase(),actor=await requirePortalPermission(db,request,['registerOps']),data=request.data||{},action=String(data.action||'list');
  if(!POS_MANAGEMENT_ROLES.includes(actor.role))throw new HttpsError('permission-denied','Only management can recover POS sales.');
  if(action==='list'){
    const rows=(await db.ref('/posSyncAlerts').orderByChild('state').equalTo('open').limitToLast(100).get()).val()||{};
    const shiftIds=[...new Set(Object.values(rows).map(r=>r&&r.shiftId).filter(id=>/^[A-Za-z0-9_-]{3,100}$/.test(String(id||''))))];
    const shifts=Object.fromEntries(await Promise.all(shiftIds.map(async id=>[id,(await db.ref(`/shifts/${id}`).get()).val()||{}])));
    const staff=(/* download-ok: bounded POS staff list */await db.ref('/posStaff').get()).val()||{},nameOf=uid=>{const hit=Object.values(staff).find(r=>r&&r.accountUid===uid);return hit?String(hit.name||''):'';};
    return {rows:Object.entries(rows).map(([id,r])=>{const s=shifts[r.shiftId]||{};return {transactionId:id,orderId:r.orderId||'',shiftId:r.shiftId||'',shiftStaff:s.staff||'',shiftStatus:s.status||'missing',rungBy:nameOf((r.command&&r.command.order&&r.command.order.soldByUid)||r.actorUid)||r.actorUid||'',sentBy:nameOf(r.lastActorUid||r.actorUid)||'',total:Number(r.total)||0,orderTimestamp:Number(r.orderTimestamp)||0,code:r.code||'',message:r.message||'',count:Number(r.count)||0,firstAt:Number(r.firstAt)||0,lastAt:Number(r.lastAt)||0,recoverable:!!r.command&&['open','handover_pending'].includes(s.status),items:String(r.command&&r.command.order&&r.command.order.items||'').slice(0,200)};}).sort((a,b)=>a.orderTimestamp-b.orderTimestamp)};
  }
  const transactionId=OfflineSync.offlineTxnKey(data.transactionId),reason=financeText(data.reason,300);
  if(reason.length<5)throw new HttpsError('invalid-argument','Record why this sale is being recovered or dismissed.');
  const ref=db.ref(`/posSyncAlerts/${transactionId}`),alert=(await ref.get()).val();
  if(!alert)throw new HttpsError('not-found','That rejected sale was not found.');
  if(alert.state!=='open')return {transactionId,state:alert.state,duplicate:true};
  const now=Date.now();
  if(action==='dismiss'){
    await db.ref().update({[`posSyncAlerts/${transactionId}/state`]:'dismissed',[`posSyncAlerts/${transactionId}/dismissedAt`]:now,[`posSyncAlerts/${transactionId}/dismissedBy`]:actor.uid,[`posSyncAlerts/${transactionId}/resolutionReason`]:reason,[`operationalAudit/${now}_pos_sale_dismiss_${transactionId}`]:operationalAuditRecord('dismiss_rejected_pos_sale','posSyncAlert',transactionId,actor,{orderId:alert.orderId||'',total:Number(alert.total)||0,reason})});
    return {transactionId,state:'dismissed'};
  }
  if(action!=='recover')throw new HttpsError('invalid-argument','Unknown recovery action.');
  if(!alert.command||alert.command.transactionId!==transactionId)throw new HttpsError('failed-precondition','No sale evidence was captured for this transaction.');
  const shift=(await db.ref(`/shifts/${alert.shiftId}`).get()).val();
  if(!shift||!['open','handover_pending'].includes(shift.status))throw new HttpsError('failed-precondition','The original shift is already closed. Record this sale as a manager correction instead.');
  // The till stamps who rang the sale; a different login may have sent it later.
  const recovery=await OfflineSync.recoveryContext(db,alert.shiftId,(alert.command.order&&alert.command.order.soldByUid)||alert.actorUid,actor.uid);
  let result;
  try{result=await OfflineSync.syncOfflinePosSaleCommand({db,actor:{...actor,uid:shift.accountUid||actor.uid},recovery,data:alert.command,textField,money,listFromFirebase,activeOrderProjection,availableCash:availableCashOnHandAboveFloat,prepareOrder:async(order,at)=>({order,inventoryPlan:await calculateOrderInventoryPlan(db,order,at)})});}
  catch(error){await ref.update({lastRecoveryError:String(error&&error.message||error).slice(0,500),lastRecoveryAt:now,lastRecoveryBy:actor.uid});throw error;}
  await db.ref().update({[`posSyncAlerts/${transactionId}/state`]:'recovered',[`posSyncAlerts/${transactionId}/recoveredAt`]:now,[`posSyncAlerts/${transactionId}/recoveredBy`]:actor.uid,[`posSyncAlerts/${transactionId}/resolutionReason`]:reason,[`operationalAudit/${now}_pos_sale_recover_${transactionId}`]:operationalAuditRecord('recover_rejected_pos_sale','order',result.orderId,actor,{transactionId,shiftId:alert.shiftId,rungBy:alert.actorUid||'',total:Number(alert.total)||0,reason,duplicate:!!result.duplicate})});
  return {transactionId,orderId:result.orderId,state:'recovered',duplicate:!!result.duplicate};
});
