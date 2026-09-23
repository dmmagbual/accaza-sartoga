// Shift crew + refused-sale recovery (Sep 2026). Uses an Admin-SDK-faithful mock: every
// transaction first sees the cold local cache (null) and every write enforces Realtime
// Database key rules, the two behaviours that broke POS sync on 22 Sep 2026.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const H=require('../functions/lib/shift-handover.js'),OfflineSync=require('../functions/lib/offline-sync.js'),ShiftCrew=require('../functions/lib/shift-crew.js'),Financial=require('../functions/lib/financial.js'),Exceptions=require('../functions/lib/operational-exceptions.js');
const copy=x=>x==null?null:structuredClone(x),state={};
const keys=p=>p.split('/').filter(Boolean),read=p=>keys(p).reduce((v,k)=>v?.[k],state);
function assertKeys(v,where){if(v&&typeof v==='object')for(const [k,x] of Object.entries(v)){if(!k||/[.#$/\[\]]/.test(k))throw new Error(`Invalid Realtime Database key "${k}" at ${where}`);assertKeys(x,where+'/'+k);}}
function write(p,v){assertKeys(v,p);v=H.storedForm(v);const a=keys(p),last=a.pop();let row=state;for(const k of a)row=row[k]??={};if(v==null)delete row[last];else row[last]=copy(v);}
const snap=v=>({val:()=>copy(v),exists:()=>v!=null});
function ref(p='',query={}){return {
  get:async()=>{let v=read(p);if(query.child&&v&&typeof v==='object')v=Object.fromEntries(Object.entries(v).filter(([,row])=>row&&row[query.child]===query.equal));return snap(v);},
  child:k=>ref(p+'/'+k),update:async updates=>{for(const [k,v] of Object.entries(updates))write(p+'/'+k,v);},set:async v=>write(p,v),
  transaction:async fn=>{let v=fn(null);if(v===undefined)return {committed:false,snapshot:snap(null)};const actual=read(p);if(actual!=null){v=fn(copy(actual));if(v===undefined)return {committed:false,snapshot:snap(actual)};}write(p,v);return {committed:true,snapshot:snap(v)};},
  orderByChild(child){return ref(p,{...query,child});},equalTo(equal){return ref(p,{...query,equal});},limitToLast(){return this;},limitToFirst(){return this;}};}
const db={ref};
class HttpsError extends Error{constructor(code,message){super(message);this.code=code;}}
const notices=[];
const base={exports:{},onCall:(_o,fn)=>fn,ORDER_REGION:'test',ENFORCE_APP_CHECK:false,getDatabase:()=>db,requirePortalPermission:async(_db,r)=>r.actor,HttpsError,posAssuranceKey:(x,l)=>{if(!/^[A-Za-z0-9_-]{3,100}$/.test(String(x||'')))throw new HttpsError('invalid-argument',`${l} is invalid.`);return String(x);},financeText:(x,n)=>String(x||'').trim().slice(0,n),OfflineSync,textField:x=>String(x),money:Financial.money,listFromFirebase:x=>x,activeOrderProjection:x=>x,availableCashOnHandAboveFloat:async()=>({available:99999}),calculateOrderInventoryPlan:async()=>({}),posPinValid:(pin,row)=>row&&pin===row.testPin,posStaffText:x=>String(x),operationalAuditRecord:(action,sourceType,sourceId,actor,details)=>({action,sourceType,sourceId,actorUid:actor.uid,...details}),financeDateFromTimestamp:()=> '2026-09-23',shiftOrdersForAssurance:async(_db,id)=>Object.fromEntries(Object.entries(state.orders||{}).filter(([,o])=>o.shiftId===id)),assurancePostingState:async()=>({saleCount:0,inventoryOutstanding:[],financeOutstanding:[]}),assertAccountingPeriodOpen:async()=>{},Date,Buffer};
function load(file,requireMap){const ctx={...base,exports:{},require:name=>requireMap[name]};vm.createContext(ctx);vm.runInContext(fs.readFileSync(new URL(file,import.meta.url),'utf8'),ctx);return ctx.exports;}
const Crew=load('../src/functions/25c-shift-crew.js',{'./lib/shift-crew':ShiftCrew}),Hand=load('../src/functions/25b-shift-handover.js',{'./lib/shift-handover':H});
const crewCall=(data,actor)=>Crew.managePosShiftCrew({data,actor}),recoveryCall=(data,actor)=>Crew.managePosSaleRecovery({data,actor}),handCall=(data,actor)=>Hand.manageShiftHandover({data,actor});
const MARIA={uid:'maria_uid',role:'staff'},LOUIZE={uid:'louize_uid',role:'staff'},ALEX={uid:'alex_uid',role:'staff'},RYA={uid:'rya_uid_x',role:'staff'},MANAGER={uid:'manager_uid',role:'manager'};
const shift={id:'SH-CREW',status:'open',staff:'Maria',staffId:'st_maria',accountUid:MARIA.uid,openAt:1000,openingFloat:100,drawer:{b100:1}};
write('/shifts/SH-CREW',shift);write('/posActiveShift',shift);write('/posSettings',{fixedFloat:100});
write('/posStaff',{st_maria:{name:'Maria',accountUid:MARIA.uid,testPin:'1111'},st_louize:{name:'Ma. Louize',accountUid:LOUIZE.uid,testPin:'2222'},st_alex:{name:'alex',accountUid:ALEX.uid,testPin:'3333'},st_rya:{name:'Rya',accountUid:RYA.uid,testPin:'4444'}});
const sync=(actor,command,extra={})=>OfflineSync.syncOfflinePosSaleCommand({db,actor,data:command,textField:x=>String(x),money:Financial.money,listFromFirebase:x=>x,activeOrderProjection:x=>x,...extra});
// The deployed callable wrapper: capture the refusal as an alert, resolve it on success.
async function deviceSync(actor,command){try{const r=await sync(actor,command);await OfflineSync.resolveSyncAlert(db,r.transactionId,Date.now());return r;}catch(error){await OfflineSync.recordSyncAlert(db,actor,command,error,Date.now(),async(title,body)=>{notices.push({title,body});});throw error;}}
let n=0;function sale(ts,total=100){const id=`pos_crewtest_${String(++n).padStart(4,'0')}`,order={id:`POS-CREW${n}`,clientTxnId:id,shiftId:'SH-CREW',source:'pos',status:'Completed',timestamp:ts,total,subtotal:total,payment:'Cash',payments:[{method:'Cash',amount:total,tendered:total,change:0}],lineItems:[{itemKey:'latte',qty:1,unitTotal:total}]};return {transactionId:id,order,drawerDelta:total%100?{b100:Math.floor(total/100),b50:1}:{b100:total/100}};}
const now=Date.now();

// 1. Joining: linked staff + own PIN, only the open shift, idempotent, owner is implicit.
assert.equal((await crewCall({action:'join',shiftId:'SH-CREW',pin:'1111'},MARIA)).owner,true,'the shift owner never needs to join');
await assert.rejects(crewCall({action:'join',shiftId:'SH-CREW',pin:'9999'},LOUIZE),/PIN is incorrect/);
const joined=await crewCall({action:'join',shiftId:'SH-CREW',pin:'2222'},LOUIZE);
assert.equal(joined.joined,true);assert.equal(joined.duplicate,false);
assert.equal((await crewCall({action:'join',shiftId:'SH-CREW',pin:'2222'},LOUIZE)).duplicate,true,'a retried join keeps the original session');
assert.equal(read('/posActiveShift/crew/louize_uid/staff'),'Ma. Louize','display mirror on the live shift');
assert.equal(Object.keys(read('/shiftCrews/SH-CREW/louize_uid/sessions')).length,1);
const joinedAt=read('/shiftCrews/SH-CREW/louize_uid/sessions')[Object.keys(read('/shiftCrews/SH-CREW/louize_uid/sessions'))[0]].joinedAt;

// 2. Crew sale is accepted under the crew member's own name; the drawer stays the owner's.
const crewSale=sale(now+1000,200);
const accepted=await deviceSync(LOUIZE,crewSale);
assert.equal(accepted.duplicate,false);
const crewOrder=read(`/orders/${crewSale.order.id}`);
assert.equal(crewOrder.soldByUid,LOUIZE.uid);assert.equal(crewOrder.soldBy,'Ma. Louize');assert.equal(crewOrder.soldByRole,'crew');assert.equal(crewOrder.soldByStaffId,'st_louize');
assert.equal(read('/shifts/SH-CREW/drawer/b100'),3,'crew cash lands in the one shift drawer');
const ownerSale=sale(now+2000,100);await deviceSync(MARIA,ownerSale);
assert.equal(read(`/orders/${ownerSale.order.id}/soldByRole`),'owner');assert.equal(read(`/orders/${ownerSale.order.id}/soldBy`),'Maria');
// A client cannot claim another seller: the server stamps who actually synced it.
const spoof=sale(now+2500,100);spoof.order.soldByUid=MARIA.uid;spoof.order.soldBy='Maria';await deviceSync(LOUIZE,spoof);
assert.equal(read(`/orders/${spoof.order.id}/soldByUid`),LOUIZE.uid);

// 3. Not on the crew: refused, captured with the exact command, management alerted once.
const stray=sale(now+3000,150);
await assert.rejects(deviceSync(ALEX,stray),/belongs to Maria's shift/);
await assert.rejects(deviceSync(ALEX,stray),/belongs to Maria's shift/);
const alert=read(`/posSyncAlerts/${stray.transactionId}`);
assert.equal(alert.state,'open');assert.equal(alert.count,2);assert.equal(alert.actorUid,ALEX.uid);assert.equal(alert.command.order.total,150);assert.equal(alert.code,'permission-denied');
assert.equal(notices.filter(x=>x.body.includes(stray.order.id)).length,1,'one push per refused sale, not one per retry');
// A sale rung before joining (beyond clock tolerance) is refused even for crew.
const early=sale(joinedAt-ShiftCrew.CLOCK_TOLERANCE_MS-60000,100);
await assert.rejects(deviceSync(LOUIZE,early),/belongs to Maria's shift/);
// The Exception Center shows refused sales as critical work.
const ex=Exceptions.buildOperationalExceptions({posSyncAlerts:read('/posSyncAlerts'),pendingShiftHandovers:{}},now);
assert.ok(ex.exceptions.some(x=>x.category==='pos_sale_rejected'&&x.severity==='critical'&&x.id===stray.transactionId));

// 4. Leaving / removal. Only the owner or management may remove someone.
await assert.rejects(crewCall({action:'remove',shiftId:'SH-CREW',uid:LOUIZE.uid},ALEX),/shift owner or a manager/);
await crewCall({action:'join',shiftId:'SH-CREW',pin:'4444'},RYA);
await crewCall({action:'remove',shiftId:'SH-CREW',uid:RYA.uid},MARIA);
assert.equal(read('/posActiveShift/crew/rya_uid_x'),undefined);assert.ok(read('/shifts/SH-CREW/crew/rya_uid_x/leftAt'));
const afterRemoval=sale(Date.now()+ShiftCrew.CLOCK_TOLERANCE_MS+60000,100);
await assert.rejects(deviceSync(RYA,afterRemoval),/belongs to Maria's shift/,'a removed member cannot keep ringing sales');

// 5. Management recovery of the refused sale keeps the real seller and clears the device.
await assert.rejects(recoveryCall({action:'list'},LOUIZE),/Only management/);
const listed=(await recoveryCall({action:'list'},MANAGER)).rows.find(r=>r.transactionId===stray.transactionId);
assert.equal(listed.recoverable,true);assert.equal(listed.rungBy,'alex');assert.equal(listed.shiftStaff,'Maria');
await assert.rejects(recoveryCall({action:'recover',transactionId:stray.transactionId,reason:''},MANAGER),/Record why/);
const recovered=await recoveryCall({action:'recover',transactionId:stray.transactionId,reason:'Rung by alex on Maria till, cash in drawer'},MANAGER);
assert.equal(recovered.state,'recovered');
const strayOrder=read(`/orders/${stray.order.id}`);
assert.equal(strayOrder.shiftId,'SH-CREW');assert.equal(strayOrder.soldByUid,ALEX.uid);assert.equal(strayOrder.soldByRole,'recovered');assert.equal(strayOrder.soldBy,'alex');assert.equal(strayOrder.recoveredBy,MANAGER.uid);
assert.equal(read(`/posSyncAlerts/${stray.transactionId}/state`),'recovered');
assert.equal((await deviceSync(ALEX,stray)).duplicate,true,'the device still holding it clears its queue');
assert.equal(read('/shifts/SH-CREW/drawer/b100'),6,'recovered cash applied exactly once');assert.equal(read('/shifts/SH-CREW/drawer/b50'),1);

// 6. Handover ends the crew; crew sales rung before it still recover into the shift.
const late=sale(Date.now(),100);
const handed=await handCall({shiftId:'SH-CREW',deviceId:'device',closeCount:{b100:7,b50:1},rows:[]},MARIA);
assert.equal(handed.handedOver,true);
assert.ok(Object.values(read('/shiftCrews/SH-CREW/louize_uid/sessions')).every(s=>s.leftAt),'handover closes every crew session');
const lateResult=await deviceSync(LOUIZE,late);
assert.equal(lateResult.duplicate,false);assert.ok(read(`/shiftHandovers/SH-CREW/commands/${late.transactionId}`),'late crew sale is claimed into the handover evidence');
await assert.rejects(crewCall({action:'join',shiftId:'SH-CREW',pin:'2222'},LOUIZE),/Only the open shift/);
const final=await handCall({action:'reconcile',shiftId:'SH-CREW',reason:'All devices checked',devicesChecked:true},MANAGER);
assert.equal(final.resolved,true);
const z=read('/shifts/SH-CREW/zReport');
assert.equal(z.bySeller.st_louize.tx,3);assert.equal(z.bySeller.st_louize.name,'Ma. Louize');assert.equal(z.bySeller.st_maria.tx,1);assert.equal(z.bySeller.st_alex.tx,1);
assert.equal(Object.values(z.bySeller).reduce((s,r)=>s+r.net,0),z.net,'per-seller split adds back to the shift total');

// 7. Dismissal is audited and clears the alert.
const junk=sale(now+4000,100);junk.order.shiftId='SH-MISSING';
await assert.rejects(deviceSync(ALEX,junk));
await recoveryCall({action:'dismiss',transactionId:junk.transactionId,reason:'Test sale on a deleted shift'},MANAGER);
assert.equal(read(`/posSyncAlerts/${junk.transactionId}/state`),'dismissed');

// 8. The till itself refuses payment before money is taken (the server re-checks anyway).
const cart=fs.readFileSync(new URL('../src/admin/pos/50e-cart-checkout.js',import.meta.url),'utf8'),persist=fs.readFileSync(new URL('../src/admin/pos/50f-sale-persistence.js',import.meta.url),'utf8');
assert.ok(cart.includes("button.disabled=posChargeBusy||!keys.length||!shift||!posSellerState().ok"),'Charge must be disabled for anyone not on the shift');
assert.ok(cart.includes("var _seller=posSellerState();if(!_seller.ok)"),'Charge click must refuse anyone not on the shift');
assert.ok(cart.includes('id="posJoinShift"')&&cart.includes('joinPosShift()'),'The till must offer Join shift');
assert.ok(cart.includes('<div id="posShiftBar"')&&cart.includes('<div id="posOfflineBar"'),'The sale panel must render the shift/crew banner and the sync status (their containers were missing after a redesign)');
assert.ok(cart.includes("Join the shift to take payment"),'A locked Charge button must say why');
assert.ok(persist.includes("var seller=posSellerState(); if(!seller.ok)")&&persist.includes('soldByUid:seller.uid'),'chargeSale must refuse and stamp the seller');
console.log('PASS: shift crew joins with own login/PIN, crew sales carry the real seller into the owner drawer, refused sales are captured, alerted once and recovered by management, and handover ends the crew.');
