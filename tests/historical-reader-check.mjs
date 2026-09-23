import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createSubscriptionHub} from '../assets/js/admin/realtime-hub.mjs';

const listeners=[],calls=[];
const ops={
  ref(_db,path){return path;},
  onValue(target,success){listeners.push(target);queueMicrotask(()=>success({val:()=>({version:1})}));return()=>{};},
  query(){throw new Error('The historical reader must not query archivedOrders in RTDB.');},
  orderByChild(){},limitToLast(){},startAt(){},endAt(){},endBefore(){},get(){},
  async readHistoricalOrders(payload){
    calls.push(payload);
    if(payload.mode==='latest')return{orders:{newest:{id:'newest',timestamp:20}},cursor:{value:20,id:'newest'},hasMore:true};
    if(payload.mode==='before')return{orders:{older:{id:'older',timestamp:10}},cursor:{value:10,id:'older'},hasMore:false};
    throw new Error('Unexpected mode '+payload.mode);
  }
};
const hub=createSubscriptionHub({},ops);let current={};
hub.subscribe('archivedOrders',snapshot=>{current=snapshot.val();},{scopes:['archive']});
hub.authorize();hub.activate('archive');
await new Promise(resolve=>setTimeout(resolve,0));
assert.deepEqual(listeners,['historicalArchiveSync']);
assert.equal(current.newest.id,'newest');
assert.equal(calls[0].mode,'latest');
const older=await hub.loadOlder('archivedOrders');
assert.equal(older.loaded,1);assert.equal(older.hasOlder,false);assert.equal(current.older.id,'older');
assert.equal(calls[1].mode,'before');

const core=fs.readFileSync('assets/js/admin/core.mjs','utf8');
assert(core.includes('readHistoricalSalesRollup'), 'Overview must use the compact historical sales summary');
assert(!core.includes('subscriptionHub.readHistoricalPeriod('), 'Overview must never reopen a paged historical reader');
assert(!core.includes("readSalesPeriod(db,{ref,get,query,orderByChild,startAt,endAt},'archivedOrders'"), 'Overview must not directly query archivedOrders in RTDB');
const repair=fs.readFileSync('src/admin/pos/31-recipe-temperature-repair.js','utf8');
assert(repair.includes('cogsFixLoadArchived(null,{})'));
assert(!repair.includes("a.get(a.ref(a.db,'archivedOrders'))"), 'Recipe audit must not download the full RTDB archive');

console.log('historical Firestore reader checks passed');

const vm=await import('node:vm');
const server=fs.readFileSync('src/functions/61-historical-archive.js','utf8');
const budgetSource=server.slice(0,server.indexOf('async function reserveHistoricalMaintenanceBudget'));
const rollupSource=server.slice(server.indexOf('exports.readHistoricalSalesRollup'),server.indexOf('// Books may be posted'));
let counters={},queries=0,rollupDocs=[],rollupState={complete:false,schemaVersion:5,runId:'first-incomplete'};
const fakeDb={ref(path){return {async get(){return {val:()=>path.endsWith("salesRollupBackfill")?rollupState:true};},async transaction(update){const next=update(counters[path]);if(next===undefined)return {committed:false};counters[path]=next;return {committed:true};}};}};
const budgetContext={Intl,Date,Object,String,Number,Math,exports:{},ORDER_REGION:'test',ENFORCE_APP_CHECK:false,onCall(options,handler){return handler;},getDatabase(){return fakeDb;},requirePortalPermission:async()=>({uid:'test_user'}),financeText:value=>String(value||''),HttpsError:class extends Error{constructor(code,message){super(message);this.code=code;}},HistoricalArchive:{MONTH_COLLECTION:'months'},FieldPath:{documentId:()=> '__name__'},getFirestore(){return {collection(){const query={orderBy(){return query;},startAt(){return query;},endAt(){return query;},limit(){return query;},async get(){queries++;return {docs:rollupDocs};}};return query;}};}};
vm.createContext(budgetContext);vm.runInContext(budgetSource+rollupSource,budgetContext);
const partial=await budgetContext.exports.readHistoricalSalesRollup({data:{from:'2026-01',to:'2026-12'}});assert.equal(partial.ready,false);assert.equal(queries,0,'a first-ever incomplete rollup must fail closed');
rollupState={complete:false,schemaVersion:5,runId:'upgrade',compatibleBaseReady:true};
const upgrading=await budgetContext.exports.readHistoricalSalesRollup({data:{from:'2026-01',to:'2026-12'}});assert.equal(upgrading.ready,true);assert.equal(upgrading.schemaVersion,2,'a proven V4 base remains readable during its V5 upgrade');
rollupState={complete:true,schemaVersion:4,runId:'v4-complete'};
for(let i=0;i<15;i++)await budgetContext.exports.readHistoricalSalesRollup({data:{from:'2026-01',to:'2026-12'}});
await assert.rejects(()=>budgetContext.exports.readHistoricalSalesRollup({data:{from:'2026-01',to:'2026-12'}}),error=>error.code==='resource-exhausted');
assert.equal(queries,16,'burst rejection happens before any additional Firestore query');
assert(Object.keys(counters).every(key=>key.includes('historicalSummaryReadsV1')),'summaries must not exhaust detailed-history allowance');
counters={};rollupState={complete:false,schemaVersion:8,runId:'v8-running',compatibleBaseReady:true};rollupDocs=[{id:'2026-09',data:()=>({schemaVersion:3,analyticsSchemaVersion:2})}];
const incompleteCoverage=await budgetContext.exports.readHistoricalSalesRollup({data:{from:'2026-01',to:'2026-09'}});
assert.equal(incompleteCoverage.coverageComplete,false,'an unfinished rebuild cannot prove that absent calendar months are zero');
assert.equal(incompleteCoverage.analyticsReady,false,'comparison charts must stay hidden while exact V8 coverage is unfinished');
assert.deepEqual([...incompleteCoverage.missingMonths],['2026-01','2026-02','2026-03','2026-04','2026-05','2026-06','2026-07','2026-08']);
counters={};rollupState={complete:true,schemaVersion:8,runId:'v8-complete'};rollupDocs=[
  {id:'2026-07',data:()=>({schemaVersion:3,analyticsSchemaVersion:2})},
  {id:'2026-08',data:()=>({schemaVersion:3,analyticsSchemaVersion:2})},
  {id:'2026-09',data:()=>({schemaVersion:3,analyticsSchemaVersion:2})},
];
const operationStartCoverage=await budgetContext.exports.readHistoricalSalesRollup({data:{from:'2026-01',to:'2026-09'}});
assert.equal(operationStartCoverage.coverageComplete,true,'completed V8 proves pre-operation months with no documents are zero-sales months');
assert.equal(operationStartCoverage.analyticsReady,true,'YTD analytics must render when the completed source pass contains July-to-date operations');
assert.deepEqual([...operationStartCoverage.missingMonths],[],'January-to-June must not be requested for a shop that began in July');
console.log('PASS: old summary clients are limited before Firestore reads, with an independent atomic budget.');
