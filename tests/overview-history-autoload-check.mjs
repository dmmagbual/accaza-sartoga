import fs from 'node:fs';
const elements={overviewDataNote:{textContent:''},overviewRangeLabel:{textContent:''},overviewNetSales:{textContent:''},overviewGrossSales:{textContent:''},overviewTransactions:{textContent:''},overviewAverageSale:{textContent:''}};
globalThis.localStorage={getItem(){return JSON.stringify({period:'all'});},setItem(){}};
globalThis.document={querySelectorAll(){return[];},getElementById(id){return elements[id]||null;}};
globalThis.CustomEvent=function(){};
/* Overview resolves "today" through window.AccazaDate, the Philippine business date, exactly as
   admin.html does. Without this stub the fallback in overview-insights.mjs uses the UTC date, so
   between 16:00 and 24:00 UTC (00:00-08:00 Manila) the month-to-date period ends before now and a
   just-completed order falls outside it. That made this check fail for eight hours every day. */
globalThis.window={dispatchEvent(){},AccazaDate:{key(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}},AccazaReportPeriod:{get(){return{mode:'month',count:1,label:'This month',startAt:new Date().setHours(0,0,0,0),endAt:Date.now()};},set(){return this.get();}}};
Object.assign(globalThis.window,(function(){var w={};new Function('window',fs.readFileSync(new URL('../assets/js/shared/sales-authority.js',import.meta.url),'utf8'))(w);return w;})());
const {createOverviewInsights,mergeOverviewOrders}=await import('../assets/js/admin/overview-insights.mjs');
const states={orders:{loaded:1,hasOlder:true},archivedOrders:{loaded:1,hasOlder:true},financialMovements:{loaded:1,hasOlder:true}},calls=[];
const overview=createOverviewInsights({esc:String,historyStatus(path){return states[path];},async loadOlder(path){calls.push(path);states[path]={loaded:2,hasOlder:false};}});
overview.render({historyComplete:true,active:[],orders:[{id:'old-order',timestamp:1,total:100,status:'Completed',paymentStatus:'confirmed'}],archived:[{id:'old-archive',timestamp:1,archivedAt:2,total:200,status:'Archived',prevStatus:'Completed',paymentStatus:'confirmed'}],outcomes:[],sales:[]});
for(var i=0;i<5;i++)await new Promise((resolve)=>setTimeout(resolve,0));
if(calls.length)throw new Error('Overview must not download older report pages automatically.');
if(elements.overviewDataNote.textContent!=='Every completed paid order in the selected dates is loaded, including archived orders.')throw new Error('Overview did not disclose the selected-date behavior.');
console.log('PASS: Overview uses only the selected reporting period without automatic historical downloads.');

const raceStates={orders:{loaded:1,hasOlder:true},archivedOrders:{loaded:1,hasOlder:false},financialMovements:{loaded:1,hasOlder:false}},raceChecks={orders:0,archivedOrders:0,financialMovements:0},raceCalls=[];
let releaseRace;
const raceGate=new Promise(function(resolve){releaseRace=resolve;});
const raced=createOverviewInsights({esc:String,historyStatus(path){raceChecks[path]++;return raceStates[path];},async loadOlder(path){raceCalls.push(path);await raceGate;raceStates[path]={loaded:2,hasOlder:false};}});
const raceData={historyComplete:true,active:[],orders:[{id:'race-order',timestamp:1,total:50,status:'Completed'}],archived:[],outcomes:[],sales:[]};
raced.render(raceData);
raced.render(raceData);
releaseRace();
for(var j=0;j<5;j++)await new Promise((resolve)=>setTimeout(resolve,0));
if(raceCalls.length)throw new Error('Overview attempted historical pagination after a live refresh.');
console.log('PASS: Overview remains bounded when live data refreshes.');

const shortcutStates={orders:{loaded:250,hasOlder:true},archivedOrders:{loaded:100,hasOlder:true},financialMovements:{loaded:300,hasOlder:true}},shortcutCalls=[];
const shortcut=createOverviewInsights({esc:String,historyStatus(path){return shortcutStates[path];},async loadOlder(path){shortcutCalls.push(path);shortcutStates[path]={loaded:shortcutStates[path].loaded+1,hasOlder:false};}});
shortcut.render({historyComplete:true,active:[],orders:[{id:'period-covered',timestamp:Date.now(),total:10,status:'Completed'}],archived:[],outcomes:[],sales:[]});
for(var k=0;k<5;k++)await new Promise((resolve)=>setTimeout(resolve,0));
if(shortcutCalls.length)throw new Error('Overview exceeded the selected-period query by loading older pages.');
console.log('PASS: Overview does not bypass selected-period bounds.');

const dateStates={orders:{loaded:1,hasOlder:false},archivedOrders:{loaded:1,hasOlder:false},financialMovements:{loaded:1,hasOlder:false}};
const dated=createOverviewInsights({esc:String,historyStatus(path){return dateStates[path];},async loadOlder(){return{loaded:0,hasOlder:false};}});
const completedNow={id:'completed-this-month',timestamp:1,completedAt:Date.now(),total:125,status:'Completed',paymentStatus:'confirmed'};
dated.render({historyComplete:true,active:[],orders:[completedNow],archived:[],outcomes:[completedNow],sales:[completedNow]});
for(var n=0;n<20&&elements.overviewTransactions.textContent!=='1';n++)await new Promise((resolve)=>setTimeout(resolve,0));
window.AccazaReportPeriod.set({period:'month'});
if(elements.overviewTransactions.textContent!=='1'||elements.overviewGrossSales.textContent!=='₱125.00')throw new Error('Overview did not use the Sales History completedAt date authority.');
console.log('PASS: Overview and Sales History assign completed orders to the same reporting period.');

const staleActive={id:'duplicate-order',status:'Completed',paymentStatus:'confirmed',timestamp:1,total:90};
const completedHistory={id:'duplicate-order',status:'Completed',paymentStatus:'confirmed',timestamp:1,completedAt:Date.now(),total:125};
const mergedDuplicate=mergeOverviewOrders([staleActive],[completedHistory],[]);
if(mergedDuplicate.length!==1||mergedDuplicate[0]!==completedHistory)throw new Error('A stale active-order projection overwrote authoritative order history in Overview.');
dated.render({historyComplete:true,active:[staleActive],orders:[completedHistory],archived:[],outcomes:mergedDuplicate,sales:mergedDuplicate});
if(elements.overviewTransactions.textContent!=='1'||elements.overviewGrossSales.textContent!=='₱125.00')throw new Error('Overview totals still used the stale active-order copy after duplicate resolution.');
const archivedAuthority={id:'duplicate-order',status:'Archived',prevStatus:'Completed',paymentStatus:'confirmed',completedAt:Date.now(),total:125};
const mergedArchived=mergeOverviewOrders([staleActive],[completedHistory],[archivedAuthority]);
if(mergedArchived.length!==1||mergedArchived[0]!==archivedAuthority)throw new Error('Archived order authority did not win Overview duplicate resolution.');
console.log('PASS: Overview duplicate resolution prefers order history and archives over stale active projections.');
