import fs from 'node:fs';
import vm from 'node:vm';

function fail(message){throw new Error(message);}
const source=fs.readFileSync(new URL('../functions/index.js',import.meta.url),'utf8');
const start=source.indexOf('const ACTIVE_ONLINE_TTL_MS');
const end=source.indexOf('async function rebuildActiveOrders',start);
if(start<0||end<0)fail('active-order projection helpers missing');
const sandbox={Date,Intl,Object,result:null};
const pureHelpers=source.slice(start,end).replace(/\/\/ ---------------------------------------------------------------------------\r?\n\/\/ Release 5B:[\s\S]*?(?=function archivedOrderRecord)/,'');
vm.runInNewContext(`${pureHelpers};result={activeOrderProjection,shouldProjectOrder,archivedOrderRecord,ACTIVE_ONLINE_TTL_MS};`,sandbox);
const {activeOrderProjection,shouldProjectOrder,archivedOrderRecord,ACTIVE_ONLINE_TTL_MS}=sandbox.result;
const now=2_000_000_000_000;

if(!shouldProjectOrder({status:'Pending'},null,now))fail('Pending order must remain active');
if(!shouldProjectOrder({status:'Confirmed'},null,now))fail('Confirmed order must remain active');
if(!shouldProjectOrder({status:'Completed',source:'pos',shiftId:'S1'},{id:'S1'},now))fail('Current-shift sale must remain active');
if(shouldProjectOrder({status:'Completed',source:'pos',shiftId:'S1'},null,now))fail('Resolved closed-shift sale must leave active orders');
if(!shouldProjectOrder({status:'Completed',source:'pos',paymentStatus:'pending'},null,now))fail('Unverified payment must remain active');
if(!shouldProjectOrder({status:'Completed',source:'pos',channel:'grabfood',settlementStatus:'unsettled'},null,now))fail('Unsettled platform sale must remain active');
if(shouldProjectOrder({status:'Completed',source:'pos',channel:'grabfood',settlementStatus:'settled'},null,now))fail('Settled closed-shift platform sale must leave active orders');
if(!shouldProjectOrder({status:'Received',source:'online',timestamp:now-ACTIVE_ONLINE_TTL_MS+1},null,now))fail('Recent received online order must remain active');
if(shouldProjectOrder({status:'Received',source:'online',timestamp:now-ACTIVE_ONLINE_TTL_MS-1},null,now))fail('Expired received online order must leave active orders');

const projected=activeOrderProjection({id:'O1',proof:'data:image/png;base64,large',proofData:'large',proofPath:'payment-proofs/u/O1.png',total:100});
if('proof' in projected||'proofData' in projected)fail('embedded proof leaked into active projection');
if(projected.proofPath!=='payment-proofs/u/O1.png'||projected.total!==100||projected.projectionVersion!==1)fail('active projection lost required fields');
const archived=archivedOrderRecord({id:'O1',status:'Completed',total:100},now,'test');
if(archived.status!=='Archived'||archived.prevStatus!=='Completed'||archived.archivedAt!==now||archived.archiveReason!=='test')fail('archive record is incomplete');

console.log('PASS: active-order lifecycle, proof stripping, and closed-shift archival checks passed.');
