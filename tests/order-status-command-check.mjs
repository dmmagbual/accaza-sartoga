import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const Status=require('../functions/lib/order-status.js');

function parts(path){return String(path||'').split('/').filter(Boolean);}
function valueAt(root,path){return parts(path).reduce((v,k)=>v&&v[k],root);}
function put(root,path,value){const p=parts(path);if(!p.length){Object.keys(root).forEach(k=>delete root[k]);Object.assign(root,value||{});return;}let cur=root;for(let i=0;i<p.length-1;i++)cur=cur[p[i]]||(cur[p[i]]={});if(value===null)delete cur[p.at(-1)];else cur[p.at(-1)]=value;}
function snapshot(value){return{val(){return value==null?null:structuredClone(value);},exists(){return value!=null;}};}
class FakeRef{
  constructor(db,path){this.db=db;this.path=path||'/';}
  async get(){return snapshot(valueAt(this.db.data,this.path));}
  async set(value){put(this.db.data,this.path,structuredClone(value));}
  async update(writes){if(this.path!=='/'&&this.path!==''){Object.entries(writes).forEach(([key,value])=>put(this.db.data,this.path+'/'+key,structuredClone(value)));return;}if(this.db.failRootUpdateOnce){this.db.failRootUpdateOnce=false;throw Object.assign(new Error('injected projection failure'),{code:'unavailable'});}Object.entries(writes).forEach(([key,value])=>put(this.db.data,key,structuredClone(value)));}
  async transaction(fn){const current=valueAt(this.db.data,this.path),next=fn(current==null?null:structuredClone(current));if(next===undefined)return{committed:false,snapshot:snapshot(current)};put(this.db.data,this.path,structuredClone(next));return{committed:true,snapshot:snapshot(next)};}
}
class FakeDb{constructor(data){this.data=structuredClone(data);this.failRootUpdateOnce=false;}ref(path='/'){return new FakeRef(this,path);}}
const actor={uid:'cashier-1',role:'cashier'};
const project=o=>({...o,projectionVersion:1});
const keep=()=>true;
const run=(db,data)=>Status.updateOrderStatusCommand({db,actor,data,activeOrderProjection:project,shouldProjectOrder:keep});

assert.equal(Status.canTransition('Pending','Ready'),true);
assert.equal(Status.canTransition('Completed','Preparing'),false);
assert.equal(Status.normalizeStatus('Forged'),'');

const db=new FakeDb({orders:{one:{id:'one',ownerUid:'customer-1',status:'Pending',source:'online',channel:'online',shiftId:'shift-1',posCaptured:true,paymentStatus:'confirmed',timestamp:1}},activeOrders:{one:{id:'one',status:'Pending'}},posActiveShift:{id:'shift-1'}});
const first=await run(db,{orderId:'one',status:'Ready',expectedStatus:'Pending',requestId:'req_one'});
assert.equal(first.duplicate,false);assert.equal(db.data.orders.one.status,'Ready');assert.equal(db.data.activeOrders.one.status,'Ready');assert.equal(db.data.customerOrders['customer-1'].one.status,'Ready');
assert.equal(Object.keys(db.data.orders.one.statusHistory).length,1);assert.equal(Object.keys(db.data.operationalAudit).length,1);
const duplicate=await run(db,{orderId:'one',status:'Ready',expectedStatus:'Pending',requestId:'req_one'});
assert.equal(duplicate.duplicate,true);assert.equal(Object.keys(db.data.orders.one.statusHistory).length,1);assert.equal(Object.keys(db.data.operationalAudit).length,1);
await run(db,{orderId:'one',status:'Rejected',expectedStatus:'Ready',requestId:'req_one_next'});
const delayedReplay=await run(db,{orderId:'one',status:'Ready',requestId:'req_one'});
assert.equal(delayedReplay.duplicate,true);assert.equal(db.data.orders.one.status,'Rejected');

db.data.orders.two={id:'two',status:'Pending',source:'online',timestamp:2};db.failRootUpdateOnce=true;
await assert.rejects(run(db,{orderId:'two',status:'Confirmed',expectedStatus:'Pending',requestId:'req_two'}),/injected projection failure/);
// Atomic multi-path write: a failed commit applies nothing, so the order stays Pending.
assert.equal(db.data.orders.two.status,'Pending');assert.equal(db.data.orderStatusCommands.req_two.status,'failed');
const recovered=await run(db,{orderId:'two',status:'Confirmed',expectedStatus:'Pending',requestId:'req_two'});
assert.equal(recovered.duplicate,false);assert.equal(db.data.orders.two.status,'Confirmed');assert.equal(db.data.orderStatusCommands.req_two.status,'applied');
await assert.rejects(run(db,{orderId:'two',status:'Ready',expectedStatus:'Confirmed',requestId:'req_two_ready'}),/Cashier verification and POS shift acceptance are required/);
assert.equal(db.data.orders.two.status,'Confirmed');

db.data.orders.three={id:'three',status:'Completed',source:'online',timestamp:3};
await assert.rejects(run(db,{orderId:'three',status:'Preparing',expectedStatus:'Completed',requestId:'req_three'}),/cannot move/);
db.data.orders.four={id:'four',status:'Preparing',source:'online',timestamp:4};
await assert.rejects(run(db,{orderId:'four',status:'Ready',expectedStatus:'Confirmed',requestId:'req_four'}),/changed from Confirmed to Preparing/);
await assert.rejects(run(db,{orderId:'one',status:'Confirmed',expectedStatus:'Ready',requestId:'req_one'}),/already used/);

// Regression: Firebase Admin SDK can invoke a transaction with null on its
// first pass even when the order exists (cold/uncached instance). The command
// must confirm existence with get() first and still apply the change, instead
// of false-negativing as "Order not found". ColdRef simulates that cold pass:
// transaction() sees null until get() has primed the path.
class ColdRef extends FakeRef{
  async get(){this.db.primed.add(this.path);return snapshot(valueAt(this.db.data,this.path));}
  async transaction(fn){
    if(!this.db.primed.has(this.path)){const cold=fn(null);if(cold===undefined)return{committed:false,snapshot:snapshot(null)};}
    return super.transaction(fn);
  }
}
class ColdDb extends FakeDb{constructor(data){super(data);this.primed=new Set();}ref(path='/'){return new ColdRef(this,path);}}
const cold=new ColdDb({orders:{cc:{id:'cc',ownerUid:'customer-9',status:'Pending',source:'online',channel:'online',shiftId:'shift-cold',posCaptured:true,paymentStatus:'confirmed',timestamp:9}},activeOrders:{cc:{id:'cc',status:'Pending'}},posActiveShift:{id:'shift-cold'}});
const coldRun=(data)=>Status.updateOrderStatusCommand({db:cold,actor,data,activeOrderProjection:project,shouldProjectOrder:keep});
const coldResult=await coldRun({orderId:'cc',status:'Ready',expectedStatus:'Pending',requestId:'req_cold'});
assert.equal(coldResult.duplicate,false);assert.equal(cold.data.orders.cc.status,'Ready');assert.equal(cold.data.activeOrders.cc.status,'Ready');
// A genuinely missing order must still raise not-found.
await assert.rejects(coldRun({orderId:'ghost',status:'Ready',expectedStatus:'Pending',requestId:'req_ghost'}),/Order not found/);

console.log('PASS: order-status command validates transitions and stale state, records one audit, resumes partial failure, survives cold-cache reads, and is idempotent.');
