// Serving queue runtime check (29 Sep 2026). Executes the BUILT POS bundle with a minimal DOM and
// Firebase stub, opens the POS tab and feeds live orders. Build 615 shipped a section placed after
// the bundle's closing "})();", so it ran outside the POS scope and the POS tab failed to load;
// static checks could not see that. This check runs the code for real.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const src=fs.readFileSync(new URL('../assets/js/admin/pos.js',import.meta.url),'utf8');
assert.ok(src.trimEnd().endsWith('})();'),'the POS bundle must end with its closing IIFE so every section shares the POS scope');
assert.equal((src.match(/^\}\)\(\);$/gm)||[]).length,1,'the POS IIFE closes exactly once, at the end');
function el(id){return {id,innerHTML:'',style:{},hidden:false,disabled:false,classList:{toggle(){},add(){},remove(){},contains(){return false;}},parentNode:{classList:{toggle(){}}},querySelectorAll(){return [];},querySelector(){return el('q');},setAttribute(){},getAttribute(){return '';},hasAttribute(){return false;},appendChild(){},remove(){},contains(){return false;},addEventListener(){},focus(){},textContent:'',value:'',checked:false,options:[]};}
const els={},subs={},intervals=[];
let posClick;const document={getElementById(id){return els[id]||(els[id]=el(id));},createElement:t=>el(t),body:el('body'),head:el('head'),addEventListener(type,fn){if(type==='click')posClick=fn;},querySelector(){return null;},querySelectorAll(){return [];},visibilityState:'visible',hasFocus(){return true;}};
const ctx={document,console,setInterval:f=>{intervals.push(f);return intervals.length;},clearInterval(){},setTimeout:()=>0,clearTimeout(){},performance:{now:()=>Date.now()},localStorage:{getItem(){return null;},setItem(){}},navigator:{onLine:true},alert(m){throw new Error('unexpected alert: '+m);},Intl,Date,Math,JSON,Object,Array,String,Number,Promise,RegExp,Error,Set,Map};
ctx.window=ctx;ctx.addEventListener=()=>{};ctx.__accazaRegisterModule=(name,handler)=>{if(name==='pos')ctx.__posHandler=handler;};
ctx.__accaza={getCats:()=>[],menuItemsMap:{},subscribe(path,cb){subs[path]=cb;},callables:{}};
ctx.AccazaOfflineQueue={summary:()=>Promise.resolve({rows:[]}),all:()=>Promise.resolve([]),flush:()=>Promise.resolve({}),storageHealth:()=>Promise.resolve({queue:{}}),closeReadiness:()=>Promise.resolve({ready:true}),compactSynced:()=>Promise.resolve(),prune:()=>Promise.resolve()};
ctx.AccazaPosSyncHealth={report(){return Promise.resolve();}};
vm.createContext(ctx);vm.runInContext(src,ctx);
intervals.splice(0).forEach(f=>f()); // the POS init poll
assert.equal(typeof subs.activeOrders,'function','POS subscribes to the live order feed');
ctx.__posShift={id:'S1',status:'open',staff:'Maria'};
ctx.__posHandler('pos');
assert.match(els.posServeQueue.innerHTML,/Order flow/,'order-flow rail renders on the POS tab');
const now=Date.now();
subs.activeOrders({val:()=>({
  'POS-A1':{source:'pos',channel:'instore',shiftId:'S1',status:'Completed',name:'Ana',total:150,timestamp:now-700000,lineItems:[{name:'Latte (L)',qty:2,optLabels:['Oat']}],service:{state:'queued',queuedAt:now-700000}},
  'GF-9':{source:'pos',channel:'grabfood',shiftId:'S1',status:'Completed',platformRef:'GF-123',total:200,timestamp:now,service:{state:'queued',queuedAt:now}},
  'OD-1':{source:'online',channel:'online',status:'Confirmed',posCaptured:true,shiftId:'S1',name:'Web',total:90,timestamp:now,lineItems:[{name:'Americano',size:'M',qty:1}]},
  'POS-B2':{source:'pos',channel:'instore',shiftId:'S1',status:'Completed',service:{state:'served'}}})});
ctx.__posHandler('pos');
const html=els.posServeQueue.innerHTML;
assert.equal((html.match(/class="sq-card /g)||[]).length,3,'queued walk-in, Grab and accepted website order are listed; served order is not');
assert.ok(html.indexOf('Ana')<html.indexOf('GF-123'),'oldest first');
assert.match(html,/age-late/,'an order waiting over 10 minutes is red');
assert.equal((html.match(/>Start prep<\/button>/g)||[]).length,3,'every queued order has one Start prep action');
assert.doesNotMatch(html,/data-sq-prepare|PREPARE|Picked up now/,'the rail has no obsolete prepare modal action');
assert.match(html,/Americano \(M\)/,'website order sizes are shown');
assert.equal(String(els.posActiveCount.textContent),'4','Shift Orders badge counts every current-shift order, including an order already served');
assert.equal(typeof ctx.__serveQueueCloseReview,'function','close review is exposed to the register module');
subs.activeOrders({val:()=>( {'POS-READY':{source:'pos',channel:'instore',shiftId:'S1',status:'Completed',name:'Lana',total:150,timestamp:now,lineItems:[{name:'Spanish Latte (L)',qty:1}],service:{state:'ready',queuedAt:now}} })});
ctx.__accaza.callables.manageOrderService=command=>{assert.equal(command.action,'serve');assert.equal(command.orderId,'POS-READY');return Promise.resolve({data:{state:'served'}});};
const servedButton={closest(){return this;},hasAttribute(name){return name==='data-sq-stage';},getAttribute(name){return name==='data-sq-stage'?'POS-READY':'';}};
posClick({target:{closest(){return servedButton;}}});
await new Promise(resolve=>setImmediate(resolve));
assert.doesNotMatch(els.posServeQueue.innerHTML,/POS-READY|Lana/,'a server-confirmed Served action stays out of Order Flow even before the next Firebase snapshot');
// A stale live copy must never trap an order. The card and the tap read ONE view, and every
// server answer is adopted, so the first tap may repeat a step (the server answers duplicate) and
// the card then shows the truth — the very next tap sends the real next step. Before this fix the
// rail re-sent the stale step forever: the server called it a harmless duplicate, so nothing
// moved, nothing errored, and the order stayed in its stage (13 Oct 2026, POS-6RBDQR stalled in
// Now preparing for 43 minutes and was handed over at shift close).
function staleTarget(id){return {closest(){return this;},hasAttribute(name){return name==='data-sq-stage';},getAttribute(name){return name==='data-sq-stage'?id:'';}};}
const staleAt=now-30000,sent=[],expected=[['start_preparing','queued'],['mark_ready','preparing']];
subs.activeOrders({val:()=>({'POS-STALE':{source:'pos',channel:'instore',shiftId:'S1',status:'Completed',name:'Nico',total:120,timestamp:staleAt,lineItems:[{name:'Brewed Coffee (M)',qty:1}],service:{state:'queued',queuedAt:staleAt}}})});
ctx.__accaza.callables.manageOrderService=command=>{const want=expected[sent.length];assert.ok(want,'the rail stopped tapping after it converged');assert.equal(command.action,want[0],'tap '+(sent.length+1)+' sends the step the card is showing');assert.equal(command.believedStage,want[1],'the device reports the stage it believed it was acting on');sent.push(command.action);return Promise.resolve({data:{state:command.action==='start_preparing'?'preparing':'ready',duplicate:command.action==='start_preparing'}});};
posClick({target:{closest(){return staleTarget('POS-STALE');}}});
await new Promise(resolve=>setImmediate(resolve));
assert.match(els.posServeQueue.innerHTML,/Mark ready/,'after a duplicate the card adopts the stage the server actually holds');
posClick({target:{closest(){return staleTarget('POS-STALE');}}});
await new Promise(resolve=>setImmediate(resolve));
assert.deepEqual(sent,['start_preparing','mark_ready'],'a stale card can never re-send the same step forever');
assert.match(els.posServeQueue.innerHTML,/>Served</,'the confirmed answer moves the card up the flow');
console.log('PASS: the built POS bundle loads, opens the POS tab and renders the serving queue from live orders.');
