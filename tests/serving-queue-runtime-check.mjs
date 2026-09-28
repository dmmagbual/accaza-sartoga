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
const document={getElementById(id){return els[id]||(els[id]=el(id));},createElement:t=>el(t),body:el('body'),head:el('head'),addEventListener(){},querySelector(){return null;},querySelectorAll(){return [];},visibilityState:'visible',hasFocus(){return true;}};
const ctx={document,console,setInterval:f=>{intervals.push(f);return intervals.length;},clearInterval(){},setTimeout:()=>0,clearTimeout(){},performance:{now:()=>Date.now()},localStorage:{getItem(){return null;},setItem(){}},navigator:{onLine:true},alert(m){throw new Error('unexpected alert: '+m);},Intl,Date,Math,JSON,Object,Array,String,Number,Promise,RegExp,Error,Set,Map};
ctx.window=ctx;ctx.addEventListener=()=>{};ctx.__accazaRegisterModule=(name,handler)=>{if(name==='pos')ctx.__posHandler=handler;};
ctx.__accaza={getCats:()=>[],menuItemsMap:{},subscribe(path,cb){subs[path]=cb;},callables:{}};
ctx.AccazaOfflineQueue={summary:()=>Promise.resolve({rows:[]}),all:()=>Promise.resolve([]),flush:()=>Promise.resolve({}),storageHealth:()=>Promise.resolve({queue:{}}),closeReadiness:()=>Promise.resolve({ready:true}),compactSynced:()=>Promise.resolve(),prune:()=>Promise.resolve()};
ctx.AccazaPosSyncHealth={report(){return Promise.resolve();}};
vm.createContext(ctx);vm.runInContext(src,ctx);
intervals.splice(0).forEach(f=>f()); // the POS init poll
assert.equal(typeof subs.activeOrders,'function','POS subscribes to the live order feed');
ctx.__posHandler('pos');
assert.match(els.posServeQueue.innerHTML,/Serving queue/,'queue column renders on the POS tab');
const now=Date.now();
subs.activeOrders({val:()=>({
  'POS-A1':{source:'pos',channel:'instore',status:'Completed',name:'Ana',total:150,timestamp:now-700000,lineItems:[{name:'Latte (L)',qty:2,optLabels:['Oat']}],service:{state:'queued',queuedAt:now-700000}},
  'GF-9':{source:'pos',channel:'grabfood',status:'Completed',platformRef:'GF-123',total:200,timestamp:now,service:{state:'queued',queuedAt:now}},
  'OD-1':{source:'online',channel:'online',status:'Confirmed',posCaptured:true,shiftId:'S1',name:'Web',total:90,timestamp:now,lineItems:[{name:'Americano',size:'M',qty:1}]},
  'POS-B2':{source:'pos',channel:'instore',status:'Completed',service:{state:'served'}}})});
ctx.__posHandler('pos');
const html=els.posServeQueue.innerHTML;
assert.equal((html.match(/class="sq-card /g)||[]).length,3,'queued walk-in, Grab and accepted website order are listed; served order is not');
assert.ok(html.indexOf('Ana')<html.indexOf('GF-123'),'oldest first');
assert.match(html,/age-late/,'an order waiting over 10 minutes is red');
assert.equal((html.match(/>PREPARE<\/button>/g)||[]).length,3,'every queued order has one PREPARE button');
assert.doesNotMatch(html,/data-sq-serve|Served now|Picked up now/,'the queue does not offer service completion before PREPARE');
assert.match(html,/Americano \(M\)/,'website order sizes are shown');
assert.equal(String(els.posActiveCount.textContent),'3','Shift Orders badge counts orders waiting to be served');
assert.equal(typeof ctx.__serveQueueCloseReview,'function','close review is exposed to the register module');
console.log('PASS: the built POS bundle loads, opens the POS tab and renders the serving queue from live orders.');
