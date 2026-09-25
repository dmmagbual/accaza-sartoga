// Accaza AI business profile + campaign log (Sep 2026): management-only, validated, stored only
// in its own Firestore collections, never hard-deleted; measure_campaign compares during vs
// before in integer centavos and nets the campaign cost off the estimated extra gross profit.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const analytics=fs.readFileSync(path.join(root,'src/functions/62b-accaza-ai-analytics.js'),'utf8'),business=fs.readFileSync(path.join(root,'src/functions/62c-accaza-ai-business.js'),'utf8');
class HttpsError extends Error{constructor(code,message){super(message);this.code=code;}}
// In-memory Firestore with just what the feature uses.
function memoryFirestore(){
  const store={};let auto=0;
  const docRef=(col,id)=>({id,path:`${col}/${id}`,async get(){const v=store[`${col}/${id}`];return{exists:v!==undefined,id,data:()=>v&&JSON.parse(JSON.stringify(v))};},async set(v){store[`${col}/${id}`]=JSON.parse(JSON.stringify(v));}});
  const api={store,
    collection(col){return{doc(id){return docRef(col,id||`auto${String(++auto).padStart(6,'0')}`);},orderBy(field,dir){const q={limit(n){return{async get(){const docs=Object.keys(store).filter(k=>k.startsWith(col+'/')).map(k=>({id:k.slice(col.length+1),data:()=>JSON.parse(JSON.stringify(store[k]))})).sort((a,b)=>dir==='desc'?String(b.data()[field]).localeCompare(String(a.data()[field])):String(a.data()[field]).localeCompare(String(b.data()[field]))).slice(0,n);return{docs};}};}};return q;}};},
    async getAll(...refs){return Promise.all(refs.map(r=>r.get()));},
    async runTransaction(fn){return fn({get:r=>r.get(),set:(r,v)=>{store[r.path]=JSON.parse(JSON.stringify(v));}});}};
  return api;
}
const firestore=memoryFirestore(),exportsObj={},TOOLS={};
let actor={uid:'u1',role:'owner',name:'Danilo'};
const manilaDay=ms=>new Date(Number(ms)+8*3600000).toISOString().slice(0,10);
const load=new Function('exports','ACCAZA_AI_RECORD_TOOLS','ACCAZA_AI_TOOL_ROLES','HttpsError','getFirestore','getDatabase','requirePortalUser','onCall','ORDER_REGION','ENFORCE_APP_CHECK','financeDateFromTimestamp','HistoricalArchive','readPosSettings','readCatalogKeyed','Costing',
  `${analytics}\n${business}\nreturn {measure:ACCAZA_AI_RECORD_TOOLS.measure_campaign,context:ACCAZA_AI_RECORD_TOOLS.get_business_context};`);
const tools=load(exportsObj,TOOLS,['owner','superadmin','admin','manager'],HttpsError,()=>firestore,()=>({ref:()=>({get:async()=>({val:()=>({item_1:{name:'Spanish Latte'},item_2:{name:'Croffle'}})})})}),async()=>actor,(opts,fn)=>fn,'asia-southeast1',false,manilaDay,{MONTH_COLLECTION:'historicalSalesMonths'},null,null,null);
const call=data=>exportsObj.manageAccazaAiBusiness({data});

// Management only.
actor={uid:'c1',role:'cashier'};await assert.rejects(call({action:'load'}),e=>e.code==='permission-denied');actor={uid:'u1',role:'owner',name:'Danilo'};
// Validation.
await assert.rejects(call({action:'save_campaign',campaign:{name:'X',startDate:'2026-09-01',endDate:'2026-09-02'}}),/name/);
await assert.rejects(call({action:'save_campaign',campaign:{name:'Bundle',startDate:'2026-09-10',endDate:'2026-09-01'}}),/before the start/);
await assert.rejects(call({action:'save_campaign',campaign:{name:'Bundle',startDate:'2026-09-10',endDate:'2026-09-12',cost:-5}}),/between 0/);
// Profile money is stored in centavos and read back in pesos.
const profile=(await call({action:'save_profile',profile:{goals:'Grow weekdays',monthlyMarketingBudget:'2500.505'}})).profile;
assert.equal(firestore.store['aiBusiness/profile'].monthlyBudgetCents,250051);assert.equal(profile.monthlyMarketingBudget,2500.51);
// Create, edit, archive, restore: history kept, nothing deleted.
const created=(await call({action:'save_campaign',campaign:{name:'Grab merienda bundle',type:'bundle',channel:'grabfood',startDate:'2026-09-11',endDate:'2026-09-20',cost:'500',items:['item_1','bad key!'],itemNames:['Spanish Latte']}})).campaign;
assert.equal(created.channel,'grabfood');assert.deepEqual(created.items,['item_1'],'item keys are sanitised');assert.equal(created.cost,500);
await call({action:'save_campaign',campaign:Object.assign({},created,{notes:'extended flyer run'})});
const archived=(await call({action:'archive_campaign',id:created.id})).campaign;assert.equal(archived.status,'archived');
const restored=(await call({action:'restore_campaign',id:created.id})).campaign;assert.notEqual(restored.status,'archived');
const stored=firestore.store[`aiCampaigns/${created.id}`];assert.deepEqual(stored.history.map(h=>h.action),['created','edited','archived','restored']);
await assert.rejects(call({action:'save_campaign',campaign:{id:'missingcampaign',name:'Ghost',startDate:'2026-09-01',endDate:'2026-09-01'}}),e=>e.code==='not-found');

// measure_campaign: 10 days before at PHP 1,000/day (GrabFood PHP 400/day), 10 days during at
// PHP 1,500/day (GrabFood PHP 900/day), 80% gross margin, cost PHP 500.
const days={};
const put=(day,net,grab)=>{days[day]={netCents:net*100,orders:10,cogsCents:net*20,channels:{grabfood:{orders:4,netCents:grab*100},instore:{orders:6,netCents:(net-grab)*100}},items:{item_1:{units:3,netCents:30000}}};};
for(let d=1;d<=10;d+=1)put(`2026-09-${String(d).padStart(2,'0')}`,1000,400);
for(let d=11;d<=20;d+=1)put(`2026-09-${String(d).padStart(2,'0')}`,1500,900);
await firestore.collection('historicalSalesMonths').doc('2026-09').set({days});await firestore.collection('historicalSalesMonths').doc('2026-08').set({days:{}});
const ctx={};const out=(await tools.measure.run(null,null,{campaign_id:created.id},ctx)).result;
assert.equal(out.before.channelNetPerDay,400);assert.equal(out.during.channelNetPerDay,900);assert.equal(out.change.channelNetPerDayPct,125);
assert.equal(out.estimate.extraNetSales,5000,'10 days × PHP 500 extra GrabFood net');assert.equal(out.estimate.grossMarginUsedPct,80);
assert.equal(out.estimate.extraGrossProfit,4000);assert.equal(out.estimate.estimatedReturnAfterCost,3500,'cost is netted off');
assert.ok(/estimate/i.test(out.caveats));
const context=(await tools.context.run(null,null,{},{})).result;assert.equal(context.campaigns.length,1);assert.equal(context.profile.goals,'Grow weekdays');
console.log('PASS: campaign log is management-only, validated, audited and never deleted; measure_campaign nets cost off extra gross profit in centavos.');
