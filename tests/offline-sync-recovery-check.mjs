import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const O=require('../functions/lib/offline-sync.js');
function assert(ok,message){if(!ok)throw new Error(message);}

const state={shifts:{'SH-TEST':{id:'SH-TEST',drawer:{b100:2}}},posActiveShift:{id:'SH-TEST',drawer:{b100:2}}};
let failShiftOnce=true;
const parts=p=>String(p||'').split('/').filter(Boolean);
function read(path){let cur=state;for(const key of parts(path)){if(cur==null)return undefined;cur=cur[key];}return cur;}
function write(path,value){const keys=parts(path);let cur=state;for(let i=0;i<keys.length-1;i++)cur=cur[keys[i]]||(cur[keys[i]]={});cur[keys.at(-1)]=structuredClone(value);}
function updateAt(base,updates){for(const [key,value] of Object.entries(updates)){const full=parts(base).concat(parts(key)).join('/');const old=read(full);write(full,Object.assign({},old&&typeof old==='object'?old:{},value&&typeof value==='object'?value:{}));if(value===null){const keys=parts(full),last=keys.pop();let cur=state;for(const k of keys)cur=cur[k];delete cur[last];}else if(typeof value!=='object')write(full,value);}}
const db={ref(path=''){return{
  async get(){const value=read(path);return{val:()=>structuredClone(value),exists:()=>value!=null};},
  async update(updates){updateAt(path,updates);},
  async transaction(fn){if(path==='/shifts/SH-TEST'&&failShiftOnce){failShiftOnce=false;throw new Error('injected shift transaction failure');}const current=structuredClone(read(path)),next=fn(current);if(next===undefined)return{committed:false,snapshot:{val:()=>current,exists:()=>current!=null}};write(path,next);return{committed:true,snapshot:{val:()=>structuredClone(next),exists:()=>next!=null}};},
};}};
const txn='pos_txn_123456789',order={id:'POS-RECOVERY-1',shiftId:'SH-TEST',clientTxnId:txn,source:'pos',status:'Completed',total:100,lineItems:[{itemKey:'coffee',qty:1,unitTotal:100}],timestamp:10};
const ctx={db,actor:{uid:'cashier-1'},data:{transactionId:txn,order,drawerDelta:{b100:1}},textField:v=>String(v),money:v=>Number(v),listFromFirebase:v=>v,activeOrderProjection:v=>Object.assign({},v,{projectionVersion:1}),now:1000};
let injected=false;try{await O.syncOfflinePosSaleCommand(ctx);}catch(error){injected=error.message==='injected shift transaction failure';}
assert(injected,'partial failure was not injected after authoritative order write');
assert(state.orders['POS-RECOVERY-1'].clientTxnId===txn,'order was not retained before the partial failure');
assert(state.shifts['SH-TEST'].drawer.b100===2,'drawer changed before successful retry');
const repaired=await O.syncOfflinePosSaleCommand({...ctx,now:2000});
assert(repaired.duplicate===true,'retry did not identify the existing transaction');
assert(state.shifts['SH-TEST'].drawer.b100===3&&state.posActiveShift.drawer.b100===3,'retry did not apply drawer delta to both shift records');
await O.syncOfflinePosSaleCommand({...ctx,now:3000});
assert(state.shifts['SH-TEST'].drawer.b100===3&&state.posActiveShift.drawer.b100===3,'duplicate replay changed the drawer twice');
assert(state.offlinePosSync[txn].state==='synced','sync audit did not reach synced state');
let collision=false;try{await O.syncOfflinePosSaleCommand({...ctx,data:{transactionId:'different_txn_12345',order:Object.assign({},order,{clientTxnId:'different_txn_12345'})}});}catch(error){collision=error.code==='already-exists';}
assert(collision,'order-ID collision with a different transaction was accepted');
const directTxn='pos_direct_123456789',directBase=Object.assign({},order,{id:'POS-DIRECT-RECOVERY-1',clientTxnId:directTxn,payment:'GCash',payments:[{method:'GCash',amount:100,ref:'GC-7788'}]});
let directBlocked=false;try{await O.syncOfflinePosSaleCommand({...ctx,data:{transactionId:directTxn,order:directBase,drawerDelta:{}},now:3500});}catch(error){directBlocked=error.code==='failed-precondition';}
assert(directBlocked&&!state.orders['POS-DIRECT-RECOVERY-1'],'direct electronic payment bypassed the cashier verification gate');
const directResult=await O.syncOfflinePosSaleCommand({...ctx,data:{transactionId:directTxn,order:Object.assign({},directBase,{cashierVerificationIntent:true}),drawerDelta:{}},now:3600});
assert(directResult.orderId==='POS-DIRECT-RECOVERY-1'&&state.orders['POS-DIRECT-RECOVERY-1'].paymentStatus==='cashier_verified'&&state.orders['POS-DIRECT-RECOVERY-1'].cashierVerifiedBy==='cashier-1','cashier verification was not stamped by the server');
const platformTxn='pos_platform_123456789',platformOrder=Object.assign({},order,{id:'GF-RECOVERY-1',clientTxnId:platformTxn,total:550});
const platformResult=await O.syncOfflinePosSaleCommand({...ctx,data:{transactionId:platformTxn,order:platformOrder,drawerDelta:{}},now:4000});
assert(platformResult.orderId==='GF-RECOVERY-1'&&state.orders['GF-RECOVERY-1'].clientTxnId===platformTxn,'GrabFood recovery order was rejected');
const pandaTxn='pos_platform_987654321',pandaOrder=Object.assign({},order,{id:'FP-RECOVERY-1',clientTxnId:pandaTxn,total:890});
const pandaResult=await O.syncOfflinePosSaleCommand({...ctx,data:{transactionId:pandaTxn,order:pandaOrder,drawerDelta:{}},now:5000});
assert(pandaResult.orderId==='FP-RECOVERY-1'&&state.orders['FP-RECOVERY-1'].clientTxnId===pandaTxn,'FoodPanda recovery order was rejected');
const cancelledTxn='pos_cancelled_123456789';state.offlinePosSync[cancelledTxn]={state:'cancelled',reason:'test transaction'};
let cancelled=false;try{await O.syncOfflinePosSaleCommand({...ctx,data:{transactionId:cancelledTxn,order:Object.assign({},order,{id:'GF-CANCELLED-1',clientTxnId:cancelledTxn}),drawerDelta:{}},now:6000});}catch(error){cancelled=error.code==='failed-precondition';}
assert(cancelled&&!state.orders['GF-CANCELLED-1'],'management-cancelled transaction was uploaded');
let badDenom=false;try{O.offlineDrawerDelta({fake100:1});}catch(error){badDenom=error.code==='invalid-argument';}
assert(badDenom,'unknown denomination was accepted');
console.log('PASS: offline order retry repairs partial failure and duplicate replay is exactly-once.');
