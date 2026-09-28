// Serving queue (29 Sep 2026). A paid POS sale waits in the serving queue until staff mark it
// served; the queue survives shift close; "not collected" waits for a manager; the close review
// is recorded on the shift; nothing here touches the sale, stock or Finance Books.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const Service=require('../functions/lib/order-service.js'),OfflineSync=require('../functions/lib/offline-sync.js'),Financial=require('../functions/lib/financial.js'),Exceptions=require('../functions/lib/operational-exceptions.js'),H=require('../functions/lib/shift-handover.js');

// Admin-SDK-faithful mock: transactions first see the cold cache (null); keys are validated.
const copy=x=>x==null?null:structuredClone(x),state={};
const keys=p=>p.split('/').filter(Boolean),read=p=>keys(p).reduce((v,k)=>v?.[k],state);
function assertKeys(v,where){if(v&&typeof v==='object')for(const [k,x] of Object.entries(v)){if(!k||/[.#$/\[\]]/.test(k))throw new Error(`Invalid Realtime Database key "${k}" at ${where}`);if(x===undefined)throw new Error(`undefined value at ${where}/${k}`);assertKeys(x,where+'/'+k);}}
function write(p,v){assertKeys(v,p);v=H.storedForm(v);const a=keys(p),last=a.pop();let row=state;for(const k of a)row=row[k]??={};if(v==null)delete row[last];else row[last]=copy(v);}
const snap=v=>({val:()=>copy(v),exists:()=>v!=null});
function ref(p=''){return {get:async()=>snap(read(p)),child:k=>ref(p+'/'+k),update:async u=>{for(const [k,v] of Object.entries(u))write((p?p+'/':'')+k,v);},set:async v=>write(p,v),
  transaction:async fn=>{let v=fn(null);if(v===undefined)return {committed:false,snapshot:snap(null)};const actual=read(p);if(actual!=null){v=fn(copy(actual));if(v===undefined)return {committed:false,snapshot:snap(actual)};}write(p,v);return {committed:true,snapshot:snap(v)};},
  orderByChild(){return this;},equalTo(){return this;},limitToLast(){return this;},limitToFirst(){return this;}};}
const db={ref};
const projection=o=>Object.assign({},o,{projectionVersion:2});
// Same rule the deployed shouldProjectOrder applies first (src/functions/30-orders.js).
const project=(o,active)=>Service.keepsOrderLive(o)||(!!active&&o.shiftId===active.id);
const call=(data,actor,now)=>Service.manageOrderServiceCommand({db,actor,data,now,activeOrderProjection:projection,shouldProjectOrder:project});

const CASHIER={uid:'maria_uid',role:'staff',name:'Maria'},BAR={uid:'bar_uid',role:'staff',name:'Joy'},MANAGER={uid:'mgr_uid',role:'manager',name:'Dan'};
const shift={id:'SH-SQ',status:'open',staff:'Maria',staffId:'st_maria',accountUid:CASHIER.uid,openAt:1000,openingFloat:100,drawer:{b100:1}};
write('/shifts/SH-SQ',shift);write('/posActiveShift',shift);write('/posSettings',{fixedFloat:100});
write('/posStaff',{st_maria:{name:'Maria',accountUid:CASHIER.uid}});
let n=0;const now=Date.now();
function sale(extra={}){const i=++n,id=`pos_sqtest_${String(i).padStart(4,'0')}`,order=Object.assign({id:`POS-SQ${i}`,clientTxnId:id,shiftId:'SH-SQ',source:'pos',channel:'instore',status:'Completed',timestamp:now+i*1000,total:150,subtotal:150,payment:'Cash',payments:[{method:'Cash',amount:150,tendered:150,change:0}],lineItems:[{itemKey:'latte',name:'Spanish Latte (L)',qty:1,unitTotal:150}],preparationStatus:'not_prepared',name:'Walk-in'},extra);return {transactionId:id,order,drawerDelta:{}};}
const sync=(command,extra={})=>OfflineSync.syncOfflinePosSaleCommand({db,actor:CASHIER,data:command,textField:x=>String(x),money:Financial.money,listFromFirebase:x=>x,activeOrderProjection:projection,...extra});

// 1. The server queues every accepted sale, whatever the device claims.
const a=sale({service:{state:'served',servedAt:1}});await sync(a);
const aOrder=read(`/orders/${a.order.id}`);
assert.equal(aOrder.service.state,'queued','a device cannot skip the serving queue');
assert.equal(aOrder.service.queuedAt,a.order.timestamp,'queue age starts when the sale was rung');
assert.equal(aOrder.status,'Completed','the sale itself stays completed (revenue unchanged)');
assert.equal(Service.needsService(aOrder),true);
const g=sale({id:'GF-SQ1',channel:'grabfood',payment:'GrabFood',payments:[{method:'GrabFood',amount:150,ref:'GF123'}],platformRef:'GF123'});
g.order.id='GF-SQ1';await sync(g);
assert.equal(read('/orders/GF-SQ1/service/state'),'queued','platform orders wait for rider pickup');

// 2. Management recovery of a past sale is history: not queued.
const rec=sale();await sync(rec,{recovery:{managerUid:MANAGER.uid}}).catch(()=>{});
if(read(`/orders/${rec.order.id}`))assert.equal(read(`/orders/${rec.order.id}/service`),undefined,'recovered sales are not queued');

// 3. Served: idempotent, locks completed-order correction, audited, no finance/inventory fields.
const before=read(`/orders/${a.order.id}`);
const r1=await call({action:'serve',orderId:a.order.id,requestId:'serve_req_0001'},BAR,now+60000);
assert.equal(r1.state,'served');assert.equal(r1.duplicate,false);
const served=read(`/orders/${a.order.id}`);
assert.equal(served.service.servedByName,'Joy');assert.equal(served.preparationStartedAt,now+60000,'correction locks once served');assert.equal(served.preparationStatus,'served');
assert.equal(served.status,'Completed');assert.equal(served.total,150);
for(const k of ['total','subtotal','payments','lineItems','payment','shiftId','soldByUid'])assert.deepEqual(served[k],before[k],'serving never changes '+k);
assert.equal((await call({action:'serve',orderId:a.order.id,requestId:'serve_req_0001'},BAR,now+61000)).duplicate,true,'a retried tap is a duplicate');
assert.equal((await call({action:'serve',orderId:a.order.id,requestId:'serve_req_0002'},CASHIER,now+62000)).duplicate,true,'a second device tapping Served is harmless');
assert.ok(Object.keys(read('/operationalAudit')).some(k=>k.endsWith('_service_serve_req_0001')),'serving is audited');
assert.equal(Service.needsService(read(`/orders/${a.order.id}`)),false);
await assert.rejects(call({action:'return_to_queue',orderId:a.order.id,requestId:'serve_req_0001',reason:'x'},BAR,now),/already used/,'a request ID cannot be reused for another action');

// 4. Return to queue keeps the correction lock.
await call({action:'return_to_queue',orderId:a.order.id,requestId:'return_req_0001',reason:'tapped by mistake'},CASHIER,now+70000);
assert.equal(read(`/orders/${a.order.id}/service/state`),'queued');assert.equal(read(`/orders/${a.order.id}/preparationStartedAt`),now+60000);

// 5. Voided and fully refunded orders leave the queue and cannot be served.
const v=sale();await sync(v);write(`/orders/${v.order.id}/voided`,true);
assert.equal(Service.needsService(read(`/orders/${v.order.id}`)),false);
await assert.rejects(call({action:'serve',orderId:v.order.id,requestId:'serve_void_001'},BAR,now),/voided/);
assert.equal(Service.needsService(Object.assign({},read(`/orders/${a.order.id}`),{refundAmount:150})),false,'a full refund leaves the queue');
assert.equal(Service.needsService(Object.assign({},read(`/orders/${a.order.id}`),{refundAmount:50})),true,'a partial refund still needs serving');

// 6. Not collected needs a reason; only a manager reviews it; it stays live until reviewed.
const nc=sale({name:'Ana'});await sync(nc);
await assert.rejects(call({action:'not_collected',orderId:nc.order.id,requestId:'nc_req_00001',reason:''},CASHIER,now),/why/);
await call({action:'not_collected',orderId:nc.order.id,requestId:'nc_req_00001',reason:'customer left'},CASHIER,now+80000);
const ncOrder=read(`/orders/${nc.order.id}`);
assert.equal(ncOrder.service.state,'not_collected');assert.equal(Service.needsService(ncOrder),false);assert.equal(Service.keepsOrderLive(ncOrder),true,'kept live for the manager');
await assert.rejects(call({action:'review_not_collected',orderId:nc.order.id,requestId:'rv_req_00001',note:'refunded'},CASHIER,now),/manager/i);
await assert.rejects(call({action:'review_not_collected',orderId:nc.order.id,requestId:'rv_req_00001',note:''},MANAGER,now),/decided/);
await call({action:'review_not_collected',orderId:nc.order.id,requestId:'rv_req_00001',note:'Refunded through Voids & Refunds'},MANAGER,now+90000);
assert.equal(Service.keepsOrderLive(read(`/orders/${nc.order.id}`)),false,'reviewed: free to archive');

// 7. Carry-over: a queued sale stays live after its shift closes; a served one does not.
const q=sale({name:'Ben'});await sync(q);
const nextShift={id:'SH-NEXT',status:'open'};
assert.equal(project(read(`/orders/${q.order.id}`),nextShift),true,'queued order survives shift close');
assert.equal(project(read(`/orders/${nc.order.id}`),nextShift),false);
write('/posActiveShift',nextShift);
await call({action:'serve',orderId:'GF-SQ1',requestId:'serve_gf_0001'},BAR,now+100000);
assert.equal(project(read('/orders/GF-SQ1'),nextShift),false,'served order is archived with its shift');
assert.equal(read('/activeOrders/GF-SQ1'),undefined,'projection removed once served after the shift changed');

// 8. Website orders: queue from POS acceptance; Served completes through the status command; not collected works.
const web={id:'OD-SQ1',source:'online',channel:'online',status:'Confirmed',posCaptured:true,shiftId:'SH-SQ',paymentStatus:'confirmed',total:200,timestamp:now,lineItems:[{name:'Americano',size:'M',qty:1,unitTotal:200}]};
write('/orders/OD-SQ1',web);
assert.equal(Service.needsService(web),true);assert.equal(Service.needsService(Object.assign({},web,{status:'Pending'})),false,'unverified website orders stay in the Online tab');
await assert.rejects(call({action:'serve',orderId:'OD-SQ1',requestId:'serve_web_001'},BAR,now),/status/);
await call({action:'not_collected',orderId:'OD-SQ1',requestId:'nc_web_00001',reason:'no show'},CASHIER,now);
assert.equal(read('/orders/OD-SQ1/status'),'Confirmed','website status untouched by not collected');assert.equal(Service.needsService(read('/orders/OD-SQ1')),false);

// 9. Close review: explicit outcomes recorded on the shift; per-order failures never throw.
const s1=sale({name:'Cara'}),s2=sale({name:'Dee'}),s3=sale({name:'Eli'});write('/posActiveShift',shift);for(const x of [s1,s2,s3])await sync(x);
const review=await call({action:'close_review',shiftId:'SH-SQ',requestId:'review_req_0001',items:[
  {orderId:s1.order.id,outcome:'served'},{orderId:s2.order.id,outcome:'handover'},{orderId:s3.order.id,outcome:'not_collected',reason:'walked out'},
  {orderId:'POS-MISSING',outcome:'served'},{orderId:'POS-UNSYNCED',outcome:'served',unsynced:true},{orderId:s1.order.id,outcome:'handover'},{orderId:'bad id!',outcome:'served'}]},CASHIER,now+120000);
assert.deepEqual(review.counts,{served:3,handover:1,notCollected:1});
assert.equal(read(`/orders/${s1.order.id}/service/state`),'served');assert.equal(read(`/orders/${s2.order.id}/service/state`),'queued','handover leaves it queued');assert.equal(read(`/orders/${s3.order.id}/service/state`),'not_collected');
const stored=read('/shifts/SH-SQ/serviceReview');assert.equal(stored.items.length,5,'duplicates and malformed rows are dropped');
assert.match(stored.items.find(x=>x.orderId==='POS-MISSING').error,/not found/i);assert.equal(stored.items.find(x=>x.orderId==='POS-UNSYNCED').applied,false);
assert.equal((await call({action:'close_review',shiftId:'SH-SQ',requestId:'review_req_0001',items:[]},CASHIER,now)).duplicate,true,'a retried review is a duplicate');

// 10. Exception Center: queued > 3 h and unreviewed not-collected orders are flagged.
const active={[s2.order.id]:Object.assign({},read(`/orders/${s2.order.id}`)),[s3.order.id]:read(`/orders/${s3.order.id}`)};
active[s2.order.id].service=Object.assign({},active[s2.order.id].service,{queuedAt:now-4*3600000});
const ex=Exceptions.buildOperationalExceptions({activeOrders:active,orders:{}},now);
assert.ok(ex.exceptions?.some?.(x=>x.category==='unserved_order')||ex.some?.(x=>x.category==='unserved_order'),'stale queued order is flagged');
assert.ok((ex.exceptions||ex).some(x=>x.category==='uncollected_order'),'not collected order is flagged for a manager');

// 11. The POS column uses the same rule as the server.
const posSource=fs.readFileSync(new URL('../src/admin/pos/51-serve-queue.js',import.meta.url),'utf8');
const fnSource=['sqIsOnline','sqNeedsService'].map(name=>{const m=posSource.match(new RegExp(`function ${name}\\(o\\)\\{[\\s\\S]*?\\n?\\}\\n`));assert.ok(m,`${name} not found`);return m[0];}).join('\n');
const ctx={};vm.createContext(ctx);vm.runInContext(fnSource,ctx);
const fixtures=[aOrder,read(`/orders/${a.order.id}`),read(`/orders/${v.order.id}`),ncOrder,web,Object.assign({},web,{status:'Pending'}),Object.assign({},web,{posCaptured:false}),read('/orders/GF-SQ1'),Object.assign({},aOrder,{refundAmount:150}),{source:'pos',status:'Completed'},null];
for(const o of fixtures)assert.equal(ctx.sqNeedsService(o?structuredClone(o):o),Service.needsService(o),'POS queue and server disagree on '+(o&&o.id));

// 12. Wiring: charge hook, queue column in every POS view, close review before the cash count, Z section.
const pos=fs.readFileSync(new URL('../assets/js/admin/pos.js',import.meta.url),'utf8'),register=fs.readFileSync(new URL('../assets/js/admin/register.js',import.meta.url),'utf8'),fn=fs.readFileSync(new URL('../functions/index.js',import.meta.url),'utf8'),posCss=fs.readFileSync(new URL('../assets/css/admin/pos-workflow.css',import.meta.url),'utf8');
assert.ok(pos.includes('showReceipt(receipt); sqAfterCharge(receipt);'),'charge sends the confirmed sale straight to the serving queue');
assert.ok(pos.includes('<aside id="posServeQueue"')&&pos.includes("+'</div>'))+'</div></div>';"),'queue column wraps every POS view');
assert.ok(!/SQ_CARD_MS|sq-charge-card|data-sq-card/.test(pos)&&pos.includes("sqState.recent[o.id]")&&pos.includes('data-sq-prepare'),'there is no post-charge wait; the sale appears immediately with PREPARE');
assert.ok(pos.includes("mask.className='sq-prepare-mask'")&&pos.includes('data-sq-prepared-served')&&pos.includes('data-sq-prepared-back'),'PREPARE opens one centered Served / Back to queue decision');
assert.ok(pos.includes("sqIsPlatform(o)?'PICKED UP NOW':'SERVED'"),'platform preparation cards say PICKED UP NOW and other orders say SERVED');
assert.ok(pos.includes('class="pz-btn sq-complete-btn"'),'SERVED and PICKED UP NOW use the dedicated green completion button');
assert.ok(posCss.includes('body.admin-pos-workspace button:not(:disabled):active')&&posCss.includes('translateY(2px) scale(.985)')&&posCss.includes('button:focus-visible'),'every enabled POS button has visible pressed and keyboard-focus feedback');
assert.ok(register.indexOf('window.__serveQueueCloseReview')<register.indexOf('var recon=denomTrackingOnR()'),'review happens before the cash count');
assert.ok(register.includes('zServiceReviewHtml(z.serviceReview||shift.serviceReview)'),'Z report prints the review');
assert.ok(/function shouldProjectOrder[\s\S]{0,700}OrderService\.keepsOrderLive\(order\)/.test(fn),'queued orders are not archived at shift close');
assert.ok(fn.includes('exports.manageOrderService'),'serving callable exported');
console.log('PASS: serving queue — server-stamped queue, served/undo-safe idempotency, carry-over, not-collected review, close review, exceptions and POS parity.');
