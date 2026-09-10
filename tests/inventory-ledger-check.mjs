import fs from 'node:fs';
import vm from 'node:vm';

function assert(ok,message){if(!ok)throw new Error(message);}
const functions=fs.readFileSync('functions/index.js','utf8');
const pos=fs.readFileSync('assets/js/admin/pos.js','utf8');
const register=fs.readFileSync('assets/js/admin/register.js','utf8');
const core=fs.readFileSync('assets/js/admin/core.mjs','utf8');
const firebaseClient=fs.readFileSync('assets/js/admin/firebase-client.mjs','utf8');
const rules=fs.readFileSync('database.rules.json','utf8');

for(const marker of ['applyInventoryMovement','inventoryAccounting','inventoryMovements','inventoryBalances','exports.postInventoryMovements','exports.ensureInventoryLedger','exports.onOrderInventoryReversal'])assert(functions.includes(marker),`missing 3A server marker: ${marker}`);
assert(functions.includes('state.applied[movementId]'),'per-item idempotency claim is missing');
assert(functions.includes('retry: true'),'inventory triggers are not retry-enabled');
assert(functions.includes('serverOnly = new Set'),'callers can forge server-only movement types');
assert(functions.includes('inventory finalization is not complete; retry reversal'),'refund/void reversal can race ahead of sale finalization');
assert(!/runTransaction\(a\.ref\(a\.db,'inventory\/[^']*\/stock/.test(pos+register),'browser still directly transacts inventory stock');
assert(!/updates\['inventory\/[^']+\/(?:stock|cost)'\]/.test(pos),'purchase flow still writes stock/cost directly');
assert(pos.includes("type:'purchase'")&&pos.includes("type:'manual_edit'")&&pos.includes("'usage_reversal'")&&pos.includes("'rnd_testing'")&&pos.includes("'staff_use'"),'not all admin inventory flows post ledger movements');
assert(register.includes("processOrderAdjustment({action:'void'")&&register.includes("processOrderAdjustment({action:'refund'")&&functions.includes('inventoryReversalRequested`] = true'),'void/refund restocking is not server-requested');
assert(firebaseClient.includes("'postInventoryMovements'")&&firebaseClient.includes("'ensureInventoryLedger'")&&core.includes('postInventoryMovements:postInventoryMovementsCall'),'3A callable bridge missing');
for(const node of ['inventoryAccounting','inventoryMovements','inventoryBalances'])assert(rules.includes(`"${node}"`),`rules missing ${node}`);
assert(rules.includes('"inventoryAccounting": { ".read": false, ".write": false }'),'accounting state is not private');
assert(rules.includes('"inventoryMovements"')&&rules.includes('".write": false'),'movement projection is not server-write-only');
assert(rules.includes("newData.child('stock').val() === data.child('stock').val()"),'legacy inventory projection is not locked after migration');

// Execute the production ledger functions against a tiny in-memory RTDB. Fail once
// after the authoritative item transaction, then retry the same movement ID.
const start=functions.indexOf('const INVENTORY_MOVEMENT_TYPES');
const end=functions.indexOf('exports.postInventoryMovements',start);
assert(start>=0&&end>start,'could not isolate production ledger functions for failure test');
const sandbox={
  HttpsError:class HttpsError extends Error{},
  money:(value)=>Math.round((Number(value)||0)*100)/100,
  console,
};
const api=vm.runInNewContext(`(function(){${functions.slice(start,end)};return {applyInventoryMovement};})()`,sandbox);
const state={inventory:{milk:{name:'Milk',unit:'ml',stock:100,cost:2,inventoryAccount:'1210',costAccount:'5010'}}};
let failProjectionWrite=true;
let emptyFirstTransactionFor='';
const parts=(path)=>String(path||'').split('/').filter(Boolean);
function read(path){let cur=state;for(const key of parts(path)){if(cur==null)return undefined;cur=cur[key];}return cur;}
function write(path,value){const keys=parts(path);let cur=state;for(let i=0;i<keys.length-1;i++)cur=cur[keys[i]]||(cur[keys[i]]={});if(!keys.length)throw new Error('root set unsupported');cur[keys.at(-1)]=structuredClone(value);}
function applyUpdates(base,updates){for(const [path,value] of Object.entries(updates)){const full=[...parts(base),...parts(path)].join('/');write(full,value);}}
const db={ref(path=''){return {
  async get(){const value=read(path);return {val:()=>structuredClone(value),exists:()=>value!=null};},
  async set(value){write(path,value);},
  async update(updates){if(!parts(path).length&&failProjectionWrite){failProjectionWrite=false;throw new Error('injected projection failure');}applyUpdates(path,updates);},
  async transaction(fn){const current=structuredClone(read(path));const first=path===emptyFirstTransactionFor?undefined:current;emptyFirstTransactionFor='';const next=fn(first);if(next===undefined)return {committed:false,snapshot:{val:()=>current}};write(path,next);return {committed:true,snapshot:{val:()=>structuredClone(next)}};},
};}};
const movement={movementId:'purchase_doc1_milk',itemId:'milk',type:'purchase',qty:50,unitCost:4,sourceId:'doc1'};
let injected=false,caughtMessage='';
try{await api.applyInventoryMovement(db,movement,{uid:'tester',role:'manager'});}catch(error){caughtMessage=error&&error.message||String(error);injected=caughtMessage==='injected projection failure';}
assert(injected,'failure injection did not interrupt the first projection write; caught: '+caughtMessage);
assert(state.inventoryAccounting.milk.balance===150,'authoritative transaction did not commit before injected failure');
const retry=await api.applyInventoryMovement(db,movement,{uid:'tester',role:'manager'});
assert(retry.duplicate===true,'retry did not recognize the deterministic movement ID');
assert(state.inventoryAccounting.milk.balance===150,'retry applied the same quantity twice');
assert(state.inventory.milk.stock===150&&state.inventoryBalances.milk.qty===150,'retry did not repair both balance projections');
assert(Math.abs(state.inventory.milk.cost-2.666667)<0.000001,'weighted-average cost projection is incorrect');
state.inventory.powder={name:'Powder',unit:'g',stock:-100,cost:2,inventoryAccount:'1220',costAccount:'5020'};
await api.applyInventoryMovement(db,{movementId:'purchase_doc2_powder',itemId:'powder',type:'purchase',qty:50,unitCost:10,sourceId:'doc2'},{uid:'tester',role:'manager'});
assert(state.inventory.powder.stock===-50,'negative stock purchase balance is incorrect');
assert(state.inventory.powder.cost===10,'receipt against negative stock produced an invalid blended WAC');

// A stale legacy projection must not block a valid reversal when RTDB invokes
// the transaction updater once with an empty local cache.
state.inventory.coffee={name:'Coffee Beans',unit:'g',stock:1196,cost:1.431,inventoryAccount:'1200',costAccount:'5000'};
state.inventoryAccounting.coffee={balance:3047,unitCost:1.278,version:1,applied:{purchase_coffee:{id:'purchase_coffee',itemId:'coffee',qty:2000,unitCost:1.278}}};
emptyFirstTransactionFor='/inventoryAccounting/coffee';
await api.applyInventoryMovement(db,{movementId:'purchase_reverse_coffee',itemId:'coffee',type:'purchase_reversal',qty:-2000,unitCost:1.278,sourceId:'duplicate',reversalOf:'purchase_coffee'},{uid:'tester',role:'manager'});
assert(state.inventoryAccounting.coffee.balance===1047,'stale inventory projection falsely blocked an authoritative-ledger reversal');
assert(state.inventory.coffee.stock===1047,'reversal did not repair the stale stock projection');

console.log('PASS: Release 3A authority, mutation routing, partial-failure retry, WAC, and rule guards passed.');
