import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {createSubscriptionHub} from '../assets/js/admin/realtime-hub.mjs';
import {createHistoricalPeriodStore} from '../assets/js/admin/historical-period-store.mjs';
const tick = () => new Promise(resolve => setTimeout(resolve,0));
let marker, stopped=0, calls=[], source={a:{id:'a',completedAt:15,total:100},b:{id:'b',completedAt:25,total:200}};
const store=createHistoricalPeriodStore({watch(cb){marker=cb;queueMicrotask(()=>cb({sequence:1,changes:{1:{sequence:1,orderId:'a'}}}));return()=>stopped++;},async read(payload){calls.push(payload);return{orders:Object.fromEntries(Object.entries(source).filter(([id,row])=>payload.mode==='ids'?payload.ids.includes(id):row.completedAt>=payload.startAt&&row.completedAt<=payload.endAt)),hasMore:false};}});
let month,year;
store.watch({startAt:10,endAt:20},rows=>month=rows,error=>{throw error;});
store.watch({startAt:0,endAt:30},rows=>year=rows,error=>{throw error;});
await tick();assert.equal(calls.length,1);assert.equal(month.a.total,100);assert(year.b);
for(let i=0;i<10;i++)await store.read({startAt:10,endAt:20});
assert.equal(calls.length,1,'overlapping periods and repeated report reads share one history load');
source.a={...source.a,total:80,refundAmount:20};
marker({sequence:2,changes:[null,null,{sequence:2,orderId:'a'}]});await tick();
assert.deepEqual(calls.at(-1),{mode:'ids',ids:['a']});assert.equal(month.a.total,80);assert.equal(year.a.refundAmount,20);
delete source.a;source.b={...source.b,completedAt:17,voided:true};
marker({sequence:4,changes:{3:{sequence:3,orderId:'a'},4:{sequence:4,orderId:'b'}}});await tick();
assert(!month.a);assert(month.b.voided);assert(!year.a);
const beforeDuplicate=calls.length;marker({sequence:4});await tick();assert.equal(calls.length,beforeDuplicate);
marker({sequence:40,changes:{40:{sequence:40,orderId:'b'}}});await tick();
assert.equal(calls.length,beforeDuplicate+1,'missed journal entries reconcile overlapping periods with one covering read');
source.b={...source.b,total:90};marker({version:99,orderId:'b'});await tick();
assert.equal(month.b.total,90,'legacy markers safely reconcile during backend rollout');
let newPeriod;store.watch({startAt:16,endAt:18},rows=>newPeriod=rows,error=>{throw error;});await tick();assert(newPeriod.b,'new periods also load with a legacy marker');
store.clear();assert.equal(stopped,1);

// A response completing after sign-out cannot deliver records into another session.
let resolveRead, deliveries=0;
const delayed=createHistoricalPeriodStore({watch(cb){queueMicrotask(()=>cb({sequence:1}));return()=>{};},read(){return new Promise(resolve=>resolveRead=resolve);}});
delayed.watch({startAt:0,endAt:30},()=>deliveries++,()=>{});await tick();delayed.clear();resolveRead({orders:source});await tick();assert.equal(deliveries,0);

// Execute the production journal transaction against concurrent successive changes.
const backend=fs.readFileSync('src/functions/61-historical-archive.js','utf8');
const publish=backend.slice(backend.indexOf('async function publishHistoricalChange'),backend.indexOf('function historicalReadCursor'));
const context={HistoricalArchive:{salesAt:o=>o.completedAt},Date};vm.createContext(context);vm.runInContext(publish,context);
let journal=null;const db={ref(path){assert.equal(path,'/historicalArchiveSync');return{async transaction(update){journal=update(journal);}};}};
for(let i=1;i<=40;i++)await context.publishHistoricalChange(db,'order-'+i,{completedAt:i},i);
assert.equal(journal.sequence,40);assert.equal(Object.keys(journal.changes).length,32);assert.equal(journal.changes['9'].orderId,'order-9');
await context.publishHistoricalChange(db,'order-40',null,41);assert.equal(journal.deleted,true);
const core=fs.readFileSync('assets/js/admin/core.mjs','utf8');
assert(!core.includes('ensureOverviewFullHistory'),'redrawing must not start a second selected-period loader');
assert(!core.includes("subscriptionHub.subscribe('financialMovements'"),'dashboard must not read unused financial movements');
assert(core.includes("activeScope!=='dashboard'"),'hidden dashboard callbacks must not reopen report listeners');

// Execute the exact-ID callable: permission check first, bounded validation,
// verified replica reads, and source fallback for absent/unverified replicas.
const historical=createRequire(import.meta.url)('../functions/lib/historical-archive.js');
let allowed=true,requested=[],fallback=[];
const server={exports:{},ORDER_REGION:'test',ENFORCE_APP_CHECK:false,Date,HistoricalArchive:historical,
  onValueWritten:(_options,handler)=>handler,onCall:(_options,handler)=>handler,
  financeText:(value,length)=>String(value||'').slice(0,length),
  HttpsError:class extends Error{constructor(code,message){super(message);this.code=code;}},
  requirePortalPermission:async()=>{if(!allowed)throw new Error('permission-denied');},
  getDatabase:()=>({ref(path){fallback.push(path);return{get:async()=>({val:()=>path.endsWith('/deleted')?null:{id:path.split('/').at(-1),total:75,proof:'private-image'}})};}}),
  getFirestore:()=>({collection:()=>({doc:id=>({id})}),getAll:async(...refs)=>{requested.push(refs.map(ref=>ref.id));return refs.map(ref=>({id:ref.id,exists:ref.id==='verified',data:()=>({schemaVersion:historical.SCHEMA_VERSION,evidence:{verified:true},order:{id:ref.id,total:100,proof:'private-image'}})}));}})
};
vm.createContext(server);vm.runInContext(backend,server);
const readIds=server.exports.readHistoricalOrders;
for(const ids of [[],['bad/path'],['bad\nkey'],Array(33).fill('a')])await assert.rejects(readIds({data:{mode:'ids',ids}}),/valid order IDs/);
assert.equal(requested.length,0);allowed=false;await assert.rejects(readIds({data:{mode:'ids',ids:['verified']}}),/permission-denied/);assert.equal(requested.length,0);allowed=true;
const exact=await readIds({data:{mode:'ids',ids:['verified','missing','deleted','verified']}});
assert.equal(requested[0].length,3);assert.equal(exact.orders.verified.total,100);assert.equal(exact.orders.missing.total,75);assert(!exact.orders.deleted);assert(!exact.orders.verified.proof);assert(!exact.orders.missing.proof);
assert.deepEqual(fallback,['/archivedOrders/missing','/archivedOrders/deleted']);

// The year chart is page-scoped; leaving Overview detaches all its live queries.
const attached=[];
const hub=createSubscriptionHub({}, {
  ref:(_db,path)=>({path}),query:(target,...parts)=>Object.assign({},target,...parts),orderByChild:field=>({field}),startAt:start=>({start}),endAt:end=>({end}),
  onValue(target,callback){const listener={target,callback,stopped:false};attached.push(listener);queueMicrotask(()=>{if(!listener.stopped)callback({val:()=>target.path==='historicalArchiveSync'?{sequence:1}:{}});});return()=>{listener.stopped=true;};},
  readHistoricalOrders:async()=>({orders:{},hasMore:false})
});
hub.authorize();let yearUpdates=0;
const stopYear=hub.watchRollingSales({startAt:0,endAt:30},()=>yearUpdates++,error=>{throw error;});
await tick();assert.equal(yearUpdates,1);assert.equal(attached.filter(item=>item.target.path==='orders').length,1,'the rolling year chart uses one live-order listener');
hub.activate('pos');assert.equal(stopYear.active,false);assert(attached.every(item=>item.stopped));hub.deauthorize();
console.log('PASS: shared history reads, refund/void/delete updates, missed changes, legacy rollout, session isolation and bounded archive journal.');
