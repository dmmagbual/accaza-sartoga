import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {createSubscriptionHub} from '../assets/js/admin/realtime-hub.mjs';
import {createHistoricalPeriodStore} from '../assets/js/admin/historical-period-store.mjs';
import {summarizeHistoricalSales} from '../assets/js/admin/historical-sales-summary.mjs';
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

// A successfully loaded period survives tab switches and refreshes only the
// exact orders named by the bounded change journal. Sign-out clears the copy.
const priorSessionStorage=globalThis.sessionStorage,sessionValues=new Map();
globalThis.sessionStorage={getItem:key=>sessionValues.get(key)||null,setItem:(key,value)=>sessionValues.set(key,value),removeItem:key=>sessionValues.delete(key)};
let cacheMarker,cacheReads=0,cacheSource={saved:{id:'saved',completedAt:15,total:50}},cacheRows,cacheMeta;
function cachedStore(){return createHistoricalPeriodStore({watch(cb){cacheMarker=cb;queueMicrotask(()=>cb({sequence:5,changes:{}}));return()=>{};},async read(payload){cacheReads++;return{orders:Object.fromEntries(Object.entries(cacheSource).filter(([id,row])=>payload.mode==='ids'?payload.ids.includes(id):row.completedAt>=payload.startAt&&row.completedAt<=payload.endAt)),hasMore:false};}});}
const firstCache=cachedStore();firstCache.watch({startAt:10,endAt:20},(rows,meta)=>{cacheRows=rows;cacheMeta=meta;},error=>{throw error;});await tick();await tick();assert.equal(cacheReads,1);assert.equal(cacheRows.saved.total,50);firstCache.clear();
const reopenedCache=cachedStore();reopenedCache.watch({startAt:10,endAt:20},(rows,meta)=>{cacheRows=rows;cacheMeta=meta;},error=>{throw error;});assert.equal(cacheRows.saved.total,50,'saved Sales History must render before another Firestore page read');await tick();await tick();assert.equal(cacheReads,1,'an unchanged journal must reuse the saved period without another Firestore page');assert.equal(cacheMeta.stale,false,'the marker confirms that saved rows are current');
cacheSource.saved={...cacheSource.saved,total:75};cacheMarker({sequence:6,changes:{6:{sequence:6,orderId:'saved'}}});await tick();await tick();assert.equal(cacheReads,2);assert.equal(cacheRows.saved.total,75,'a changed sale must patch the saved period by exact order ID');assert.equal(cacheMeta.cached,false);reopenedCache.clear(true);assert.equal([...sessionValues.keys()].filter(key=>key.startsWith('accaza_historical_period_v1:')).length,0,'sign-out must clear saved detailed sales');
if(priorSessionStorage===undefined)delete globalThis.sessionStorage;else globalThis.sessionStorage=priorSessionStorage;

// A summary range reads only its compact day records, and detailed history does
// not silently page beyond the first 100 records.
const compact=summarizeHistoricalSales({'2026-09':{schemaVersion:2,days:{'2026-09-01':{orders:2,grossCents:2000,discountCents:100,refundCents:0,netCents:1900,cogsCents:700,channels:{instore:{orders:2,netCents:1900}},payments:{cash:{netCents:1900}},items:{latte:{name:'Latte',categoryId:'coffee',units:2,netCents:1900}},hours:{9:{orders:2,netCents:1900}}},'2026-09-02':{orders:1,grossCents:1000,discountCents:0,refundCents:0,netCents:1000,cogsCents:300,channels:{online:{orders:1,netCents:1000}},payments:{gcash:{netCents:1000}},items:{tea:{name:'Tea',categoryId:'tea',units:1,netCents:1000}},hours:{10:{orders:1,netCents:1000}}}}}},{startAt:Date.parse('2026-09-01T00:00:00+08:00'),endAt:Date.parse('2026-09-01T23:59:59.999+08:00')});
assert.equal(compact.orders,2);assert.equal(compact.net,19);assert.equal(compact.payments.cash.net,19);assert.equal(compact.items.latte.units,2);assert.equal(compact.items.tea,undefined,'partial date ranges must not include the rest of the month');
let pageCalls=0;const paged=createHistoricalPeriodStore({watch(cb){queueMicrotask(()=>cb({sequence:1}));return()=>{};},async read(payload){pageCalls++;return{orders:{['p'+pageCalls]:{id:'p'+pageCalls,completedAt:15}},cursor:{value:pageCalls,id:'p'+pageCalls},hasMore:pageCalls<2};}});let pageMeta; paged.watch({startAt:10,endAt:20},(_rows,meta)=>pageMeta=meta,()=>{});await tick();assert.equal(pageCalls,1);assert.equal(pageMeta.hasMore,true,'opening a period must fetch one bounded page only');await paged.loadOlder({startAt:10,endAt:20});assert.equal(pageCalls,2);assert.equal(pageMeta.hasMore,false);

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
const hubSource=fs.readFileSync('assets/js/admin/realtime-hub.mjs','utf8');assert(hubSource.includes("archivedOrders:['archive','appcustomers','saleshistory'"),'Dashboard and Analytics must not subscribe to raw archived orders');

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
