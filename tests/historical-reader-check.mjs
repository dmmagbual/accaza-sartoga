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
assert(core.includes('subscriptionHub.readHistoricalPeriod(p)'), 'Overview history must use the Firestore historical reader');
assert(!core.includes("readSalesPeriod(db,{ref,get,query,orderByChild,startAt,endAt},'archivedOrders'"), 'Overview must not directly query archivedOrders in RTDB');
const repair=fs.readFileSync('src/admin/pos/31-recipe-temperature-repair.js','utf8');
assert(repair.includes('cogsFixLoadArchived(null,{})'));
assert(!repair.includes("a.get(a.ref(a.db,'archivedOrders'))"), 'Recipe audit must not download the full RTDB archive');

console.log('historical Firestore reader checks passed');
