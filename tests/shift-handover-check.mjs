import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),H=require('../functions/lib/shift-handover.js'),OfflineSync=require('../functions/lib/offline-sync.js'),Financial=require('../functions/lib/financial.js');
const copy=x=>x==null?null:structuredClone(x),state={};
const keys=p=>p.split('/').filter(Boolean);
const read=p=>keys(p).reduce((v,k)=>v?.[k],state);
// Mirror Realtime Database key rules: an invalid key rejects the whole write.
function assertKeys(v,where){if(v&&typeof v==='object')for(const [k,x] of Object.entries(v)){if(!k||/[.#$/\[\]]/.test(k))throw new Error(`Invalid Realtime Database key "${k}" at ${where}`);assertKeys(x,where+'/'+k);}}
// Realtime Database also drops null, empty objects and empty arrays on write.
function write(p,v){for(const k of keys(p))assertKeys({[k]:1},p);assertKeys(v,p);v=H.storedForm(v);const a=keys(p),last=a.pop();let row=state;for(const k of a)row=row[k]??={};if(v==null)delete row[last];else row[last]=copy(v);}
const snap=v=>({val:()=>copy(v),exists:()=>v!=null});
let preOrderShiftTransactions=0,coldTransactions=0;
const db={ref(p=''){return {get:async()=>snap(read(p)),child:k=>db.ref(p+'/'+k),update:async updates=>{for(const [k,v]of Object.entries(updates))write(p+'/'+k,v);},transaction:async fn=>{if(p==='/shifts/SH-TEST'&&!read('/orders/POS-TEST'))preOrderShiftTransactions++;coldTransactions++;/* Admin SDK: the first callback sees the cold local cache (null); undefined aborts without asking the server. */let v=fn(null);if(v===undefined)return {committed:false,snapshot:snap(null)};const actual=read(p);if(actual!=null){v=fn(copy(actual));if(v===undefined)return {committed:false,snapshot:snap(actual)};}write(p,v);return {committed:true,snapshot:snap(v)};},orderByChild(){return this;},equalTo(){return this;},limitToFirst(){return this;},endAt(){return this;},limitToLast(){return this;}};}};
class HttpsError extends Error{constructor(code,message){super(message);this.code=code;}}
let locked=false,postingOutstanding=[];
const ctx={exports:{},require:()=>H,onCall:(_o,fn)=>fn,ORDER_REGION:'test',ENFORCE_APP_CHECK:false,getDatabase:()=>db,requirePortalPermission:async(_db,r)=>r.actor,HttpsError,posAssuranceKey:x=>x,financeText:(x,n)=>String(x||'').slice(0,n),financeDateFromTimestamp:()=> '2026-09-22',OfflineSync,textField:x=>String(x),money:Financial.money,listFromFirebase:x=>x,activeOrderProjection:x=>x,availableCashOnHandAboveFloat:async()=>({available:99999}),calculateOrderInventoryPlan:async()=>({}),shiftOrdersForAssurance:async(_db,id)=>Object.fromEntries(Object.entries(state.orders||{}).filter(([,o])=>o.shiftId===id)),assurancePostingState:async()=>({saleCount:Object.keys(state.orders||{}).length,inventoryOutstanding:postingOutstanding.slice(),financeOutstanding:[]}),setTimeout,HANDOVER_AUTO_FINALIZE_DELAYS_MS:[1,1],onSchedule:(_o,fn)=>fn,onValueWritten:(_o,fn)=>fn,logger:{info(){},warn(){}},assertAccountingPeriodOpen:async()=>{if(locked)throw new Error('Period locked');},Date,Buffer};
vm.createContext(ctx);vm.runInContext(fs.readFileSync(new URL('../src/functions/25b-shift-handover.js',import.meta.url),'utf8'),ctx);
const call=(data,actor={uid:'cashier',role:'staff'})=>ctx.exports.manageShiftHandover({data,actor});
const shift={id:'SH-TEST',status:'open',staff:'Cashier',accountUid:'cashier',openAt:1000,openingFloat:100,drawer:{b100:1}};
write('/shifts/SH-TEST',shift);write('/posActiveShift',shift);write('/posSettings',{fixedFloat:100});
// Real POS payloads carry nulls and empty lists that the database does not store (22 Sep 2026).
const order={id:'POS-TEST',clientTxnId:'pos_test_transaction',shiftId:shift.id,source:'pos',status:'Completed',timestamp:2000,total:50,subtotal:50,payment:'Cash',payments:[{method:'Cash',amount:50,tendered:50,change:0}],lineItems:[{itemKey:'coffee',qty:1,unitTotal:50,stream:null,pkg:null}],discountLines:[],packages:[],paymentVerificationPolicy:null,notes:''};
const rows=[{id:order.clientTxnId,status:'failed',order,drawerDelta:{b50:1},lastError:'Connection failed'}];
assert.equal(H.countCash({c25:3,c10s:1,c5s:1}),90);
assert.throws(()=>H.countCash({b100:-1}));assert.throws(()=>H.countCash({b100:1.5}));assert.throws(()=>H.countCash({fake:2}));
assert.equal(Object.values(H.sealCommands([{status:'failed',order:{shiftId:shift.id,id:'bad'}}],shift,3000))[0].quarantined,true,'malformed sales remain recoverable without blocking handover');
assert.deepEqual(H.cashSnapshot(shift,{b50:1},100),{countedCash:50,closeCount:{b50:1},retainedFloat:100,actualFloatRetained:50,floatShortfall:50,cashToSettle:0});
await assert.rejects(call({shiftId:shift.id,deviceId:'device',closeCount:{b100:1,b50:1},rows},{uid:'other',role:'staff'}),/another cashier/);
// Keep the server's own replay of the retained sale blocked here so the manager flow below
// can be exercised; the automatic replay is covered further down.
write('/shiftSyncGates/SH-TEST/finalizingAt',Date.now());
const receipt=await call({shiftId:shift.id,deviceId:'device',closeCount:{b100:1,b50:1},rows});
// The cashier still leaves with a provisional Z report that counts the retained sale.
assert.equal(receipt.provisionalZReport.status,'provisional');assert.equal(receipt.provisionalZReport.net,50);assert.equal(receipt.provisionalZReport.variance,0,'retained cash sale reconciles the counted drawer');
assert.equal(receipt.provisionalZReport.sales[0].unsynced,true);assert.equal(receipt.provisionalZReport.openItems.retainedSales[0].orderId,'POS-TEST');
assert.equal(read('/shifts/SH-TEST/provisionalZReport/status'),'provisional');assert.ok(receipt.autoFinalizeBlocker);
assert.equal(receipt.handedOver,true);assert.equal(read('/posActiveShift'),undefined);assert.equal(read('/shifts/SH-TEST/status'),'handover_pending');assert.equal(receipt.cash.cashToSettle,50);
assert.equal(read('/shiftHandovers/SH-TEST/commands/pos_test_transaction/command/order/total'),50);
write('/posActiveShift',{id:'SH-NEXT',status:'open',drawer:{b100:1}});
await call({shiftId:shift.id,deviceId:'device',closeCount:{b100:999},rows:[]});
assert.equal(read('/posActiveShift/id'),'SH-NEXT');assert.equal(read('/shiftHandovers/SH-TEST/cash/countedCash'),150,'retry keeps the original count');
const shiftTransactionsBeforeRecovery=preOrderShiftTransactions;
const manager={uid:'manager',role:'manager'};
write('/shiftSyncGates/SH-TEST/finalizingAt',Date.now());
await assert.rejects(OfflineSync.syncOfflinePosSaleCommand({db,actor:{uid:'cashier'},data:{transactionId:order.clientTxnId,order,drawerDelta:{b50:1}},textField:x=>x,money:Financial.money,listFromFirebase:x=>x}),/reconciliation is running/);
write('/shiftSyncGates/SH-TEST/finalizingAt',0);
await assert.rejects(call({action:'reconcile',shiftId:shift.id,reason:'All devices checked',devicesChecked:true},manager),/needs recovery/);
let retried=await call({action:'retry',shiftId:shift.id},manager);
assert.equal(retried.results[0].synced,true,JSON.stringify(retried.results));
assert.equal(preOrderShiftTransactions,shiftTransactionsBeforeRecovery,'sale recovery must not reserve by transacting the heavily updated shift');
assert.equal(read('/orders/POS-TEST/shiftId'),shift.id);assert.equal(read('/orders/POS-TEST/timestamp'),2000);assert.equal(read('/posActiveShift/drawer/b50'),undefined,'late sale must not touch the new drawer');
await call({action:'retry',shiftId:shift.id},manager);assert.equal(read('/shifts/SH-TEST/drawer/b50'),1,'retry applies the old drawer once');
const fake=copy(order);fake.total=999;
await assert.rejects(OfflineSync.syncOfflinePosSaleCommand({db,actor:{uid:'other'},data:{transactionId:order.clientTxnId,order:fake,drawerDelta:{b50:1}},textField:x=>x,money:Financial.money,listFromFirebase:x=>x}),/belongs to .*shift/);
locked=true;await assert.rejects(call({action:'reconcile',shiftId:shift.id,reason:'All devices checked',devicesChecked:true},manager),/Period locked/);locked=false;
assert.equal(read('/shifts/SH-TEST/status'),'handover_pending');
const final=await call({action:'reconcile',shiftId:shift.id,reason:'All devices and the physical cash handover checked',devicesChecked:true},manager);
assert.equal(final.variance,0);assert.equal(read('/shifts/SH-TEST/status'),'closed');assert.equal(read('/shifts/SH-TEST/zReport/capturedAt'),read('/shiftHandovers/SH-TEST/at'));assert.equal(read('/posActiveShift/id'),'SH-NEXT');
assert.equal((await call({action:'reconcile',shiftId:shift.id},manager)).duplicate,true);
const duplicateContext={db,actor:{uid:'cashier'},data:{transactionId:order.clientTxnId,order,drawerDelta:{b50:1}},textField:x=>x,money:Financial.money,listFromFirebase:x=>x};
assert.equal((await OfflineSync.syncOfflinePosSaleCommand(duplicateContext)).duplicate,true,'origin browser can acknowledge a sale recovered before final close');
assert.equal((await OfflineSync.syncOfflinePosSaleCommand({...duplicateContext,actor:{uid:'other'}})).duplicate,true,'any device still holding an already-recovered sale clears it without applying it twice');
write('/archivedOrders/POS-TEST',read('/orders/POS-TEST'));write('/orders/POS-TEST',null);
assert.equal((await OfflineSync.syncOfflinePosSaleCommand(duplicateContext)).duplicate,true,'archived recovery is acknowledged without recreating the order');
assert.equal(read('/orders/POS-TEST'),undefined);
// Use the actual financial trigger: custody posts at handover, variance waits.
const source=fs.readFileSync(new URL('../src/functions/40-sales-finance.js',import.meta.url),'utf8');
const trigger=source.split('\n').find(l=>l.startsWith('exports.onShiftCloseFinancial ='));
const movements={},financeCtx={exports:{},onValueWritten:(_o,fn)=>fn,ORDER_REGION:'test',getDatabase:()=>db,Date,Financial,financeText:x=>x,ensureShiftReferenceRecord:async()=> 'SHIFT-TEST',commitFinancial:async(_db,id,m)=>{Financial.assertBalanced(m.lines);movements[id]??=m;}};
vm.createContext(financeCtx);vm.runInContext(trigger,financeCtx);
write('/shifts/SH-TEST/status','handover_pending');write('/shifts/SH-TEST/variance',25);
const event=status=>({params:{shiftId:shift.id},data:{before:{val:()=> 'open'},after:{val:()=>status}}});
await financeCtx.exports.onShiftCloseFinancial(event('handover_pending'));
assert.ok(movements.shift_custody_SH_TEST===undefined);assert.ok(movements['shift_custody_SH-TEST']);assert.equal(movements['shift_variance_SH-TEST'],undefined);
write('/shifts/SH-TEST/status','closed');await financeCtx.exports.onShiftCloseFinancial(event('closed'));
assert.ok(movements['shift_variance_SH-TEST']);assert.equal(Object.keys(movements).length,2);
// Every payment shape must produce a Z report that the Realtime Database accepts.
const mixed=H.report({id:'SH-MIX',openingFloat:100},{a:{shiftId:'SH-MIX',status:'Completed',channel:'instore',total:50,subtotal:50,payments:[{method:'Cash',amount:50}]},b:{shiftId:'SH-MIX',status:'Completed',channel:'instore',total:80,subtotal:80,payments:[{method:'Bank Transfer · B.D.O',paymentMethod:'Bank Transfer',receivingAccountName:'B.D.O [Main]',amount:80}]},c:{shiftId:'SH-MIX',status:'Completed',channel:'grabfood',total:120,grossPlatform:120,netSalesPlatform:120,payments:[{method:'GrabFood',amount:120}]}},{cash:{countedCash:150}});
assert.doesNotThrow(()=>assertKeys(mixed,'/shifts/SH-MIX/zReport'),'Z report keys must be valid Realtime Database keys');
assert.equal(mixed.byMethod.Cash,50);assert.equal(mixed.byMethodAccount['Bank Transfer']['B_D_O _Main_'],80);assert.deepEqual(mixed.byMethodAccount.Cash,{});assert.equal(mixed.cashSales,50);assert.equal(mixed.variance,0);
// 24 Sep 2026 (Alex, SH-945869): the till's second close check failed on the device although
// nothing was outstanding. A handover with no retained sale now closes with a Z report when the
// server holds the same evidence a normal close needs, and records why the till check failed.
const alex={uid:'alex',role:'staff'},openShift=(id)=>{const row={id,status:'open',staff:'Alex',accountUid:'alex',openAt:5000,openingFloat:100,drawer:{b100:1}};write(`/shifts/${id}`,row);write('/posActiveShift',row);return row;};
openShift('SH-CLEAN');
write('/orders/POS-CLEAN',{shiftId:'SH-CLEAN',status:'Completed',channel:'instore',total:25,subtotal:25,payments:[{method:'Cash',amount:25}],timestamp:6000,inventoryDeducted:true});
// The submitting tablet's own stale report is superseded by its sealed (empty) queue.
write('/posDeviceHealth/SH-CLEAN',{tablet:{deviceId:'tablet',shiftId:'SH-CLEAN',outstanding:3},other:{deviceId:'other',shiftId:'SH-CLEAN',outstanding:0}});
const auto=await call({shiftId:'SH-CLEAN',deviceId:'tablet',closeCount:{b100:1,p20:1,c5:1},rows:[],closeCheckError:'[timeout] The sync check did not finish within 30 seconds.'},alex);
assert.equal(auto.resolved,true);assert.equal(auto.automatic,true);assert.equal(auto.zReport.closeMode,'automatic_handover');assert.equal(auto.zReport.net,25);assert.equal(auto.zReport.cashSales,25);assert.equal(auto.zReport.variance,0);assert.equal(auto.zReport.sales.length,1);
assert.equal(auto.shift.closeAt,read('/shiftHandovers/SH-CLEAN/at'));
assert.equal(read('/shifts/SH-CLEAN/status'),'closed');assert.equal(read('/shifts/SH-CLEAN/reconciliationMode'),'automatic');assert.equal(read('/shifts/SH-CLEAN/zReport/closeCheckError'),'[timeout] The sync check did not finish within 30 seconds.');
assert.equal(read('/pendingShiftHandovers/SH-CLEAN'),undefined);assert.equal(read('/shiftHandovers/SH-CLEAN/resolvedBy'),'server');assert.equal(read('/shiftHandovers/SH-CLEAN/resolutionMode'),'automatic');
assert.equal(read('/shiftCloseVerifications/SH-CLEAN/mode'),'automatic');assert.equal(read('/operationalAudit/handover_reconciled_SH-CLEAN/action'),'auto_finalize_shift_handover');
assert.equal(read('/discrepancies/handover_SH-CLEAN'),undefined,'no variance, no discrepancy');
assert.equal(read('/shiftSyncGates/SH-CLEAN/finalizingAt'),0,'sync gate released');assert.equal(read('/shiftHandovers/SH-CLEAN/reconcileLease'),0,'lease released');
const again=await call({shiftId:'SH-CLEAN',deviceId:'tablet',closeCount:{b100:9},rows:[]},alex);
assert.equal(again.alreadyResolved,true);assert.equal(again.zReport.net,25,'a lost response is retried into the same Z report');assert.equal(read('/shifts/SH-CLEAN/countedCash'),125);
assert.equal((await call({action:'reconcile',shiftId:'SH-CLEAN',reason:'Checked',devicesChecked:true},manager)).duplicate,true);
// Another device still holding sales: stays pending for a manager, with the reason shown.
openShift('SH-BUSY');write('/posDeviceHealth/SH-BUSY',{other:{deviceId:'other',shiftId:'SH-BUSY',outstanding:2}});
const busy=await call({shiftId:'SH-BUSY',deviceId:'tablet',closeCount:{b100:1},rows:[],closeCheckError:'[connection] offline'},alex);
assert.equal(busy.resolved,undefined);assert.match(busy.autoFinalizeBlocker,/2 sale\(s\) on 1 other POS device/);assert.equal(read('/shifts/SH-BUSY/status'),'handover_pending');assert.ok(read('/pendingShiftHandovers/SH-BUSY'));
const seen=await call({action:'inspect',shiftId:'SH-BUSY'},manager);assert.match(seen.autoFinalizeBlocker,/other POS device/);assert.equal(seen.closeCheckError,'[connection] offline');
await assert.rejects(call({action:'reconcile',shiftId:'SH-BUSY',reason:'All devices checked'},manager),/Confirm that every device/,'the manager path still requires the device attestation');
write('/posDeviceHealth/SH-BUSY/other/outstanding',0);
const managed=await call({action:'reconcile',shiftId:'SH-BUSY',reason:'Other tablet synced, cash checked',devicesChecked:true},manager);
assert.equal(managed.resolved,true);assert.equal(managed.automatic,false);assert.equal(read('/shifts/SH-BUSY/reconciliationMode'),'manager');assert.equal(read('/shiftHandovers/SH-BUSY/autoFinalize'),undefined);
// A crew member still on the shift must have confirmed an empty queue within 5 minutes.
openShift('SH-CREWAUTO');write('/shiftCrews/SH-CREWAUTO/louize',{staff:'Louize',sessions:{s1:{joinedAt:5500}}});
write('/posDeviceHealth/SH-CREWAUTO',{lz:{deviceId:'lz',reportedBy:'louize',shiftId:'SH-CREWAUTO',outstanding:0,lastContactAt:1}});
const crewHeld=await call({shiftId:'SH-CREWAUTO',deviceId:'tablet',closeCount:{b100:1},rows:[]},alex);
assert.match(crewHeld.autoFinalizeBlocker,/Louize's device has not confirmed/);assert.equal(read('/shifts/SH-CREWAUTO/status'),'handover_pending');
openShift('SH-CREWOK');write('/shiftCrews/SH-CREWOK/louize',{staff:'Louize',sessions:{s1:{joinedAt:5500}},});write('/shiftCrews/SH-CREWOK/left',{staff:'Rya',sessions:{s1:{joinedAt:5500,leftAt:5600}}});
write('/posDeviceHealth/SH-CREWOK',{lz:{deviceId:'lz',reportedBy:'louize',shiftId:'SH-CREWOK',outstanding:0,lastContactAt:Date.now()-60000}});
const crewOk=await call({shiftId:'SH-CREWOK',deviceId:'tablet',closeCount:{b100:1},rows:[]},alex);
assert.equal(crewOk.resolved,true,'a crew device that reported an empty queue a minute ago does not block; a member who left earlier is ignored');
// Postings still running after the short wait: stays pending.
openShift('SH-POST');postingOutstanding=['POS-LATE'];
const post=await call({shiftId:'SH-POST',deviceId:'tablet',closeCount:{b100:1},rows:[]},alex);
assert.match(post.autoFinalizeBlocker,/inventory 1/);assert.equal(read('/shifts/SH-POST/status'),'handover_pending');postingOutstanding=[];
// Locked accounting period: stays pending, nothing half-written.
openShift('SH-LOCK');locked=true;
const lock=await call({shiftId:'SH-LOCK',deviceId:'tablet',closeCount:{b100:1},rows:[]},alex);locked=false;
assert.match(lock.autoFinalizeBlocker,/Period locked/);assert.equal(read('/shifts/SH-LOCK/status'),'handover_pending');assert.equal(read('/shifts/SH-LOCK/zReport'),undefined);assert.equal(read('/shiftSyncGates/SH-LOCK/finalizingAt'),0);
// The server replays a retained sale itself at handover and issues the final Z.
openShift('SH-REPLAY');
const replayOrder={...order,id:'POS-REPLAY',clientTxnId:'pos_replay_transaction',shiftId:'SH-REPLAY',timestamp:6000};
const replay=await call({shiftId:'SH-REPLAY',deviceId:'tablet',closeCount:{b100:1,b50:1},rows:[{id:replayOrder.clientTxnId,status:'failed',order:replayOrder,drawerDelta:{b50:1},lastError:'Connection failed'}]},alex);
assert.equal(replay.resolved,true,JSON.stringify(replay));assert.equal(replay.zReport.net,50);assert.equal(read('/orders/POS-REPLAY/shiftId'),'SH-REPLAY');assert.equal(read('/shifts/SH-REPLAY/status'),'closed');assert.equal(read('/shiftHandovers/SH-REPLAY/commands/pos_replay_transaction/recoveredBy'),'server');
// Grace: when the next shift ends, a handover still open gets a final Z listing its exceptions,
// and its unrecovered sale moves to Sales needing recovery.
openShift('SH-STUCK');
const stuckOrder={...order,id:'POS-STUCK',clientTxnId:'pos_stuck_transaction',shiftId:'SH-STUCK',timestamp:6000};
write('/shiftSyncGates/SH-STUCK/finalizingAt',Date.now());
const stuck=await call({shiftId:'SH-STUCK',deviceId:'tablet',closeCount:{b100:1,b50:1},rows:[{id:stuckOrder.clientTxnId,status:'failed',order:stuckOrder,drawerDelta:{b50:1}}]},alex);
assert.equal(stuck.resolved,undefined);assert.equal(stuck.provisionalZReport.net,50);write('/shiftSyncGates/SH-STUCK/finalizingAt',0);
write('/shiftHandovers/SH-STUCK/commands/pos_stuck_transaction/quarantined',false);
// Make replay fail permanently (a sale the server refuses) so only the grace close can end it.
write('/offlinePosSync/pos_stuck_transaction',{state:'cancelled'});
const stuckPending=await ctx.exports.resolvePendingShiftHandovers();assert.equal(read('/shifts/SH-STUCK/status'),'handover_pending','the 5-minute pass never force-closes');
const nextShift={id:'SH-AFTER',openAt:Date.now(),status:'closed',staff:'Louize'};write('/shifts/SH-AFTER',nextShift);
// A sale syncing at the moment the next shift ends: the grace close waits, is remembered,
// and the next 5-minute pass completes it.
write('/shiftSyncGates/SH-STUCK/pending/other_txn',{at:Date.now(),token:'t'});
await ctx.exports.onShiftEndResolveEarlierHandovers({params:{shiftId:'SH-AFTER'},data:{before:{val:()=> 'open'},after:{val:()=> 'closed'}}});
assert.equal(read('/shifts/SH-STUCK/status'),'handover_pending');assert.ok(read('/shiftHandovers/SH-STUCK/graceDueAt'));assert.match(read('/shiftHandovers/SH-STUCK/autoFinalize/blocker'),/Could not issue the final Z/);
write('/shiftSyncGates/SH-STUCK/pending/other_txn',null);
await ctx.exports.resolvePendingShiftHandovers();
assert.equal(read('/shifts/SH-STUCK/status'),'closed');assert.equal(read('/shifts/SH-STUCK/reconciliationMode'),'grace');
const graceZ=read('/shifts/SH-STUCK/zReport');assert.equal(graceZ.closeMode,'grace_handover');assert.equal(graceZ.exceptions.retainedSales[0].orderId,'POS-STUCK');assert.equal(graceZ.net,0);assert.equal(graceZ.variance,50,'the unrecovered cash sale shows as an overage until it is recovered');
assert.equal(read('/shiftCloseFollowUps/SH-STUCK/kind'),'closed_with_exceptions');assert.equal(read('/posSyncAlerts/pos_stuck_transaction/state'),'open');assert.equal(read('/posSyncAlerts/pos_stuck_transaction/command/order/id'),'POS-STUCK');
assert.equal(read('/discrepancies/handover_SH-STUCK/variance'),50);assert.equal(read('/shifts/SH-STUCK/provisionalZReport'),undefined);
// The sale left over after the grace close is recovered into its original shift and the Z is
// re-issued as an amendment; an ordinary device sync still never reopens a closed shift.
write('/offlinePosSync/pos_stuck_transaction',null);
const lateCtx={db,actor:{uid:'alex'},data:{transactionId:stuckOrder.clientTxnId,order:stuckOrder,drawerDelta:{b50:1}},textField:x=>x,money:Financial.money,listFromFirebase:x=>x,activeOrderProjection:x=>x};
await assert.rejects(OfflineSync.syncOfflinePosSaleCommand(lateCtx),/no longer open/);
const drawerBefore=JSON.stringify(read('/shifts/SH-STUCK/drawer'));
await OfflineSync.syncOfflinePosSaleCommand({...lateCtx,lateRecovery:true,recovery:{managerUid:'manager'}});
assert.equal(read('/orders/POS-STUCK/shiftId'),'SH-STUCK');assert.equal(JSON.stringify(read('/shifts/SH-STUCK/drawer')),drawerBefore,'the closed drawer is not changed');assert.equal(read('/shifts/SH-STUCK/lateRecoveredSales/pos_stuck_transaction/orderId'),'POS-STUCK');
await assert.rejects(OfflineSync.syncOfflinePosSaleCommand({...lateCtx,lateRecovery:true,data:{...lateCtx.data,transactionId:'pos_outside_window',order:{...stuckOrder,id:'POS-OUTSIDE',clientTxnId:'pos_outside_window',timestamp:Date.now()+86400000}}}),/no longer open/,'a sale rung after the shift closed is not taken into it');
const amended=await ctx.amendClosedShiftZ(db,'SH-STUCK',manager,{reason:'Recovered retained sale',orderId:'POS-STUCK'});
assert.equal(amended.net,50);assert.equal(amended.variance,0);assert.equal(amended.postedVariance,50);assert.equal(amended.amendmentCount,1);assert.equal(amended.closeMode,'grace_handover');assert.equal(amended.exceptions,undefined,'the recovered sale leaves the exception list');
assert.equal(read('/shifts/SH-STUCK/net'),50);assert.equal(read('/shifts/SH-STUCK/variance'),50,'the posted cash variance is not rewritten');assert.equal(read('/shiftZHistory/SH-STUCK/1/closeMode'),'grace_handover');
assert.equal(read('/shiftCloseFollowUps/SH-STUCK/kind'),'late_sale_variance');assert.equal(read('/shiftCloseFollowUps/SH-STUCK/recalculatedVariance'),0);
assert.equal((await ctx.amendClosedShiftZ(db,'SH-STUCK',manager,{reason:'again',orderId:'POS-STUCK'})).amendmentCount,2,'each amendment keeps the previous report');
const listed=await call({action:'list'},manager);assert.ok(listed.followUps.some(f=>f.shiftId==='SH-STUCK'));
await call({action:'review_followup',shiftId:'SH-STUCK',reason:'Sale recovered, overage reviewed'},manager);assert.equal(read('/shiftCloseFollowUps/SH-STUCK/state'),'reviewed');
await assert.rejects(call({action:'review_followup',shiftId:'SH-STUCK',reason:'x'},alex),/Only management/);
console.log('PASS: pending-sale handover releases the till, preserves immutable count and sale commands, recovers once into the original shift, protects the next drawer, enforces roles/period locks, and separates custody from final variance; a clean handover closes itself with a Z report, and any blocker stays pending with its reason.');
