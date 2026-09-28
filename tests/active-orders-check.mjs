import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const OrderService=createRequire(import.meta.url)('../functions/lib/order-service.js');

function fail(message){throw new Error(message);}
const source=fs.readFileSync(new URL('../functions/index.js',import.meta.url),'utf8');
const start=source.indexOf('const ACTIVE_ONLINE_TTL_MS');
const end=source.indexOf('async function rebuildActiveOrders',start);
if(start<0||end<0)fail('active-order projection helpers missing');
const sandbox={Date,Intl,Object,OrderService,result:null};
const pureHelpers=source.slice(start,end).replace(/\/\/ ---------------------------------------------------------------------------\r?\n\/\/ Release 5B:[\s\S]*?(?=function archivedOrderRecord)/,'');
vm.runInNewContext(`${pureHelpers};result={activeOrderProjection,shouldProjectOrder,archivedOrderRecord,readyForAutoComplete,ACTIVE_ONLINE_TTL_MS,READY_AUTO_COMPLETE_MS};`,sandbox);
const {activeOrderProjection,shouldProjectOrder,archivedOrderRecord,readyForAutoComplete,ACTIVE_ONLINE_TTL_MS,READY_AUTO_COMPLETE_MS}=sandbox.result;
const now=2_000_000_000_000;

if(!shouldProjectOrder({status:'Pending'},null,now))fail('Pending order must remain active');
if(!shouldProjectOrder({status:'Confirmed'},null,now))fail('Confirmed order must remain active');
if(!shouldProjectOrder({status:'Completed',source:'pos',shiftId:'S1'},{id:'S1'},now))fail('Current-shift sale must remain active');
if(shouldProjectOrder({status:'Completed',source:'pos',shiftId:'S1'},null,now))fail('Resolved closed-shift sale must leave active orders');
if(!shouldProjectOrder({status:'Completed',source:'pos',paymentStatus:'pending'},null,now))fail('Unverified payment must remain active');
if(!shouldProjectOrder({status:'Completed',source:'pos',paymentStatus:'cashier_verified'},null,now))fail('Cashier-verified payment must remain active until manager validation');
if(!shouldProjectOrder({status:'Completed',source:'pos',channel:'grabfood',settlementStatus:'unsettled'},null,now))fail('Unsettled platform sale must remain active');
if(shouldProjectOrder({status:'Completed',source:'pos',channel:'grabfood',settlementStatus:'settled'},null,now))fail('Settled closed-shift platform sale must leave active orders');
if(!shouldProjectOrder({status:'Received',source:'online',timestamp:now-ACTIVE_ONLINE_TTL_MS+1},null,now))fail('Recent received online order must remain active');
if(shouldProjectOrder({status:'Received',source:'online',timestamp:now-ACTIVE_ONLINE_TTL_MS-1},null,now))fail('Expired received online order must leave active orders');
// Serving queue (29 Sep 2026): a sale still waiting to be served, or not collected and unreviewed, stays live after its shift closes.
if(!shouldProjectOrder({status:'Completed',source:'pos',channel:'instore',shiftId:'S1',service:{state:'queued'}},{id:'S2'},now))fail('Queued sale must survive shift close');
if(shouldProjectOrder({status:'Completed',source:'pos',channel:'instore',shiftId:'S1',service:{state:'served'}},{id:'S2'},now))fail('Served closed-shift sale must leave active orders');
if(shouldProjectOrder({status:'Completed',source:'pos',channel:'instore',shiftId:'S1',voided:true,service:{state:'queued'}},{id:'S2'},now))fail('Voided sale must leave the serving queue');
if(!shouldProjectOrder({status:'Completed',source:'pos',shiftId:'S1',service:{state:'not_collected'}},{id:'S2'},now))fail('Unreviewed not-collected sale must remain active');
if(shouldProjectOrder({status:'Completed',source:'pos',shiftId:'S1',service:{state:'not_collected',reviewedAt:1}},{id:'S2'},now))fail('Reviewed not-collected sale must leave active orders');
if(readyForAutoComplete({status:'Ready',channel:'online',statusUpdatedAt:now-READY_AUTO_COMPLETE_MS+1},now))fail('Fresh Ready online order completed too early');
if(!readyForAutoComplete({status:'Ready',channel:'online',statusUpdatedAt:now-READY_AUTO_COMPLETE_MS},now))fail('Two-hour Ready online order did not become eligible');
if(readyForAutoComplete({status:'Ready',channel:'instore',statusUpdatedAt:now-READY_AUTO_COMPLETE_MS},now))fail('In-store order entered online timeout flow');
if(readyForAutoComplete({status:'Completed',channel:'online',statusUpdatedAt:now-READY_AUTO_COMPLETE_MS},now))fail('Completed order re-entered timeout flow');

const projected=activeOrderProjection({id:'O1',proof:'data:image/png;base64,large',proofData:'large',proofPath:'payment-proofs/u/O1.png',orderInventoryPlan:{large:true},cogsDetail:{large:true},total:100});
if('proof' in projected||'proofData' in projected)fail('embedded proof leaked into active projection');
if('orderInventoryPlan' in projected||'cogsDetail' in projected)fail('accounting-heavy evidence leaked into active projection');
if(projected.proofPath!=='payment-proofs/u/O1.png'||projected.total!==100||projected.projectionVersion!==2)fail('active projection lost required fields');
const archived=archivedOrderRecord({id:'O1',status:'Completed',total:100},now,'test');
if(archived.timestamp!==now)fail('Archived orders must retain a numeric report-query timestamp');
if(archived.status!=='Archived'||archived.prevStatus!=='Completed'||archived.archivedAt!==now||archived.archiveReason!=='test')fail('archive record is incomplete');

console.log('PASS: active-order lifecycle, proof stripping, and closed-shift archival checks passed.');
