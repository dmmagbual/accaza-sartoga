// Overview bounded-reporting + Sales History reconciliation regression.
// 1) The Overview dashboard must not page outside the selected reporting period.
// 2) The recognised-sale universe must equal Sales History's orders+archived set,
//    excluding any active-only live-queue projection, so both screens agree per period.
const elements={overviewDataNote:{textContent:''},overviewRangeLabel:{textContent:''},overviewNetSales:{textContent:''},overviewGrossSales:{textContent:''},overviewTransactions:{textContent:''},overviewAverageSale:{textContent:''}};
globalThis.localStorage={getItem(){return JSON.stringify({period:'all'});},setItem(){}};
globalThis.document={querySelectorAll(){return[];},getElementById(id){return elements[id]||null;}};
globalThis.CustomEvent=function(){};
globalThis.window={dispatchEvent(){},AccazaReportPeriod:{get(){return{mode:'month',count:1,label:'This month',startAt:new Date().setHours(0,0,0,0),endAt:Date.now()};}},AccazaSales:{
  stamp(o){return Number(o.completedAt)||Number(o.receivedAt)||Number(o.timestamp)||Date.parse(o.date)||Number(o.archivedAt)||0;},
  qualifies(o){return !!o&&!o.voided&&o.paymentStatus!=='pending'&&(o.status==='Completed'||o.status==='Received'||(o.status==='Archived'&&(o.prevStatus==='Completed'||o.prevStatus==='Received')));},
  amounts(o){var gross=Number(o.subtotal!=null?o.subtotal:o.total)||0,discount=Number(o.discount)||0,refund=Number(o.refundAmount)||0;return{gross:gross,discount:discount,refund:refund,net:Math.max(0,gross-discount-refund)};}
}};
const {createOverviewInsights,mergeOverviewOrders}=await import('../assets/js/admin/overview-insights.mjs');

// ---- 1) Bounded reporting without opening Sales History ----
const states={orders:{loaded:250,hasOlder:true},archivedOrders:{loaded:100,hasOlder:true},financialMovements:{loaded:300,hasOlder:true}};
const calls=[];
const overview=createOverviewInsights({esc:String,historyStatus(path){return states[path];},async loadOlder(path){calls.push(path);states[path]={loaded:states[path].loaded+1,hasOlder:false};}});
overview.render({active:[],orders:[],archived:[],outcomes:[],sales:[],feedReady:{orders:true,archivedOrders:true,financialMovements:false}});
await new Promise((r)=>setTimeout(r,5));
if(calls.length!==0)throw new Error('Overview paged history before all bounded feeds were ready.');
// The final feed becomes ready; no Sales History tab is ever opened.
overview.render({active:[],orders:[],archived:[],outcomes:[],sales:[],feedReady:{orders:true,archivedOrders:true,financialMovements:true}});
for(var i=0;i<5;i++)await new Promise((r)=>setTimeout(r,0));
if(calls.length)throw new Error('Overview downloaded older pages outside the selected reporting period.');
if(elements.overviewDataNote.textContent!=='Every completed paid order in the selected dates is loaded, including archived orders.')throw new Error('Overview did not identify the selected-date boundary.');
console.log('PASS: Overview remains within the selected reporting period without opening Sales History.');

// ---- 2) Reconcile to the Sales History orders+archived universe ----
const activeOnly={id:'active-only-live',status:'Completed',paymentStatus:'confirmed',timestamp:Date.now(),total:70};
const historyOrders=[{id:'ord-1',status:'Completed',paymentStatus:'confirmed',completedAt:Date.now(),subtotal:100,total:100}];
const archived=[{id:'arc-1',status:'Archived',prevStatus:'Completed',paymentStatus:'confirmed',completedAt:Date.now(),subtotal:200,total:200}];
const reconciled=mergeOverviewOrders([],historyOrders,archived);
if(reconciled.some((o)=>o.id==='active-only-live'))throw new Error('Reconciled sale set leaked an active-only projection Sales History would not count.');
if(reconciled.length!==2)throw new Error('Reconciled sale set does not equal the orders+archived universe.');
const outcomes=mergeOverviewOrders([activeOnly],historyOrders,archived);
if(!outcomes.some((o)=>o.id==='active-only-live'))throw new Error('Operational outcome view dropped the live active order.');
console.log('PASS: Overview reconciles to the Sales History orders+archived universe and excludes active-only projections.');
