import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {readSalesPeriod,salesStamp,watchSalesPeriod} from '../assets/js/admin/sales-period-data.mjs';
import {createSubscriptionHub} from '../assets/js/admin/realtime-hub.mjs';
import {createOverviewHistoryLoader,mergeOverviewOrders} from '../assets/js/admin/overview-insights.mjs';

const events={},storage=new Map();let today='2026-09-03';
const win={AccazaDate:{key:()=>today},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},addEventListener:(n,f)=>(events[n]??=[]).push(f),dispatchEvent:e=>(events[e.type]||[]).forEach(f=>f(e))};
const context={window:win,document:{addEventListener(){}},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},Intl,Date,Promise,setTimeout,clearTimeout};
vm.runInNewContext(fs.readFileSync('assets/js/shared/admin-report-periods.js','utf8'),context);
const periods=win.AccazaAdminPeriods;
assert.equal(periods.get('sales').from,'2026-09-01');assert.equal(periods.get('sales').to,today);
today='2026-09-04';periods.refresh();assert.equal(periods.get('sales').to,today);
periods.set('sales',{from:'2026-09-01',to:'2026-09-02'});today='2026-09-05';periods.refresh();assert.equal(periods.get('sales').to,'2026-09-02');assert.equal(periods.get('sales').month,'');
periods.setMonth('sales','2026-08');assert.equal(periods.get('sales').to,'2026-08-31');
assert.equal(periods.get('sales').startAt,Date.parse('2026-08-01T00:00:00+08:00'));
assert.throws(()=>periods.set('sales',{from:'2026-02-30',to:today}));
assert.throws(()=>periods.set('sales',{from:'',to:today}));
assert.throws(()=>periods.set('sales',{from:'2025-09-01',to:'2026-09-01'}));
assert.throws(()=>periods.setMonth('sales','2026-13'));
assert.throws(()=>periods.setMonth('sales','2026-10'));
today='2026-10-01';periods.refresh();assert.equal(periods.get('sales').from,today);assert.equal(periods.get('sales').to,today);
periods.setMonth('sales','2026-09');
const button={textContent:'Apply',disabled:false,classList:{add(){},remove(){}},setAttribute(){},removeAttribute(){}};
let releaseApply;const applied=periods.press(button,()=>new Promise(resolve=>{releaseApply=resolve;}));
assert.equal(button.textContent,'Applying…');await new Promise(r=>setTimeout(r,150));assert.equal(button.textContent,'Applying…');releaseApply(true);await applied;assert.equal(button.textContent,'Applied ✓');
const badButton={...button,disabled:false,textContent:'Apply'};await assert.rejects(periods.press(badButton,()=>false));assert.equal(badButton.textContent,'Apply');assert.equal(badButton.disabled,false);

const p=periods.get('sales'),ts=date=>Date.parse(date+'T12:00:00+08:00'),sale=(id,extra={})=>({id,status:'Completed',paymentStatus:'confirmed',total:100,subtotal:100,lineItems:[{name:'Latte',itemKey:'latte',qty:1,unitTotal:100}],...extra});
const data={orders:{
  cross:sale('cross',{timestamp:ts('2026-08-31'),completedAt:ts('2026-09-01')}),
  received:sale('received',{status:'Received',timestamp:ts('2026-08-30'),receivedAt:ts('2026-09-02')}),
  outside:sale('outside',{timestamp:ts('2026-09-01'),completedAt:ts('2026-10-01')}),
  legacy:sale('legacy',{date:'September 3, 2026'}),
  string:sale('string',{timestamp:ts('2026-08-31'),completedAt:String(ts('2026-09-04'))}),
  zero:sale('zero',{timestamp:0,date:'2026-09-05'}),
  archiveOnlyDate:sale('archiveOnlyDate',{archivedAt:ts('2026-09-06')}),
  invalidTimestamp:sale('invalidTimestamp',{timestamp:'legacy',date:'2026-09-07'}),
  prior:sale('prior',{timestamp:ts('2026-08-20')}),
  refunded:sale('refunded',{timestamp:ts('2026-09-08'),refundAmount:100}),
  duplicate:sale('duplicate',{timestamp:ts('2026-09-09')}),
  voidCopy:sale('voidCopy',{timestamp:ts('2026-09-10')}),
  pending:sale('pending',{timestamp:ts('2026-09-11'),paymentStatus:'pending'})
},archivedOrders:{duplicate:sale('duplicate',{status:'Archived',prevStatus:'Completed',timestamp:ts('2026-09-09'),total:200,subtotal:200}),voidCopy:sale('voidCopy',{status:'Archived',prevStatus:'Completed',timestamp:ts('2026-09-10'),voided:true})},activeOrders:{ancient:{status:'Preparing',timestamp:1}},financialMovements:{
  sale_cross:{sourceId:'cross',sourceType:'order',type:'order_sale',occurredAt:ts('2026-09-01'),lines:[]},
  refund_cross:{sourceId:'cross',sourceType:'order',type:'order_refund',occurredAt:ts('2026-10-01'),lines:[]},
  unrelated:{sourceId:'unrelated',sourceType:'order',type:'order_sale',occurredAt:ts('2025-01-01'),lines:[]}
}};
const calls=[],listeners=[];
function rank(v){return v==null?0:typeof v==='boolean'?1:typeof v==='number'?2:typeof v==='string'?3:4;}
function compare(a,b){return rank(a)-rank(b)||(a==null?0:a<b?-1:a>b?1:0);}
function snapshot(target){let entries=Object.entries(data[target.path]||{}),f=target.field;if(f)entries=entries.filter(([,row])=>(!('start' in target)||compare(row[f],target.start)>=0)&&(!('end' in target)||compare(row[f],target.end)<=0));if(target.limit)entries=entries.slice(-target.limit);const map=Object.fromEntries(entries);return{val:()=>map,forEach:fn=>entries.forEach(([key,value])=>fn({key,val:()=>value}))};}
const ops={ref:(_db,path)=>({path}),orderByChild:field=>({field}),startAt:start=>({start}),endAt:end=>({end}),endBefore:end=>({end}),limitToLast:limit=>({limit}),query:(base,...constraints)=>Object.assign({},base,...constraints),get:async target=>{calls.push(target);return snapshot(target);},onValue:(target,callback)=>{const entry={target,callback,stopped:false};listeners.push(entry);queueMicrotask(()=>{if(!entry.stopped)callback(snapshot(target));});return()=>{entry.stopped=true;};}};
const actual=await readSalesPeriod({},ops,'orders',p),expected=Object.keys(data.orders).filter(k=>salesStamp(data.orders[k])>=p.startAt&&salesStamp(data.orders[k])<=p.endAt).sort();
assert.deepEqual(Object.keys(actual).sort(),expected);assert(!calls.some(q=>q.limit));
assert(calls.some(q=>q.field==='completedAt'));assert(calls.some(q=>q.field==='receivedAt'));assert(calls.some(q=>q.field==='archivedAt'));
let snapshots=0;const stop=watchSalesPeriod({},ops,'orders',p,()=>snapshots++,error=>{throw error;});await new Promise(r=>setTimeout(r,0));assert.equal(snapshots,1);stop();

globalThis.window=win;
const hub=createSubscriptionHub({},ops),feeds={};
for(const path of ['orders','archivedOrders','financialMovements','activeOrders'])hub.subscribe(path,s=>{feeds[path]=s.val();});
hub.activate('saleshistory');hub.authorize();await hub.whenReady(['orders','archivedOrders','financialMovements']);
assert.deepEqual(Object.keys(feeds.orders).sort(),expected);assert(feeds.activeOrders.ancient);
assert(feeds.financialMovements.refund_cross,'Later refund must be fetched by source reference');assert(!feeds.financialMovements.unrelated);
assert.equal(hub.historyStatus('orders').hasOlder,false);
hub.activate('analytics');await hub.whenReady(['orders','archivedOrders']);assert(feeds.orders.prior,'Analytics previous-period comparisons must be loaded');
hub.activate('dashboard');await hub.whenReady(['orders','archivedOrders']);assert(!feeds.orders.prior);
periods.setMonth('sales','2026-08');assert.equal(hub.historyStatus('orders').loading,true);await hub.whenReady(['orders','archivedOrders']);assert(feeds.orders.prior);assert(!feeds.orders.cross);
hub.activate('purchases');const activeBefore=listeners.filter(l=>!l.stopped).length;periods.setMonth('sales','2026-09');assert.equal(listeners.filter(l=>!l.stopped).length,activeBefore,'Sales dates must not rebind operational tabs');hub.deauthorize();

let key='august';const pending={},deliveries=[];const loader=createOverviewHistoryLoader({key:()=>key,read:k=>new Promise(resolve=>{pending[k]=resolve;}),onData:value=>deliveries.push(value)});
const first=loader.load();await Promise.resolve();key='september';const second=loader.load();await Promise.resolve();pending.september({orders:{new:{}},archived:{}});await second;pending.august({orders:{old:{}},archived:{}});await first;assert.equal(deliveries.length,1);assert(loader.snapshot().orders.new);assert(!loader.snapshot().orders.old);

// Execute each view's actual sales model on the same adversarial fixture.
const sandbox={window:{AccazaAdminPeriods:periods,__accazaRegisterModule(){}},document:{getElementById(){return null;}},Intl,Date,console,setTimeout,clearTimeout};
vm.createContext(sandbox);vm.runInContext(fs.readFileSync('assets/js/shared/sales-authority.js','utf8'),sandbox);
vm.runInContext(fs.readFileSync('assets/js/admin/sales-history.js','utf8').replace("window.__accazaRegisterModule('saleshistory'", "window.testHistory={set:function(o,a){orders=o;archived=a;},filtered:filtered};window.__accazaRegisterModule('saleshistory'"),sandbox);
sandbox.window.testHistory.set(data.orders,data.archivedOrders);
const history=sandbox.window.testHistory.filtered();
sandbox.ordersMap=data.orders;sandbox.archMap=data.archivedOrders;
vm.runInContext(fs.readFileSync('src/admin/analytics/10-sales-model-history.js','utf8'),sandbox);
const analytics=sandbox.salesBetween(p.startAt,p.endAt+1);
const authority=sandbox.window.AccazaSales;
const overview=mergeOverviewOrders([],Object.values(data.orders),Object.values(data.archivedOrders)).filter(o=>authority.qualifies(o)&&authority.stamp(o)>=p.startAt&&authority.stamp(o)<=p.endAt);
const ids=rows=>Array.from(rows,o=>o.id).sort();assert.deepEqual(ids(history.map(x=>x.o)),ids(overview));assert.deepEqual(ids(analytics.map(x=>x.o)),ids(overview));
const net=overview.reduce((n,o)=>n+authority.amounts(o).net,0);assert.equal(analytics.reduce((n,o)=>n+o.net,0),net);assert.equal(history.reduce((n,x)=>n+authority.amounts(x.o).net,0),net);
assert(!overview.some(o=>o.id==='voidCopy'||o.id==='outside'||o.id==='pending'));assert(overview.some(o=>o.id==='refunded'));
assert(!fs.readFileSync('src/admin/analytics/00-bootstrap-subscriptions.js','utf8').includes('completedAt:Date.now()'),'Opening Analytics must never alter completion dates');
console.log('PASS: current-month rollover, validation, Apply feedback, sales-date queries, legacy/archive coverage, scoped live feeds, cross-period refunds, race protection, and identical three-view sales totals.');
