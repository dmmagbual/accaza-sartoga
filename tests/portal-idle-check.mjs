import assert from 'node:assert/strict';
import {PORTAL_IDLE_MS, activeShiftMember, startPortalIdle} from '../assets/js/shared/portal-idle.mjs';

class FakeTarget {
  constructor(){this.listeners={};this.hidden=false;}
  addEventListener(name,fn){(this.listeners[name]||(this.listeners[name]=new Set())).add(fn);}
  removeEventListener(name,fn){if(this.listeners[name])this.listeners[name].delete(fn);}
  fire(name,event={isTrusted:true}){for(const fn of this.listeners[name]||[])fn(event);}
}
const memory=new Map(),storage={getItem:key=>memory.has(key)?memory.get(key):null,setItem:(key,value)=>memory.set(key,String(value))};
const ownerShift={id:'SH1',status:'open',accountUid:'owner',crew:{crew:{joinedAt:1}}};
assert.equal(activeShiftMember(ownerShift,'owner'),true);
assert.equal(activeShiftMember(ownerShift,'crew'),true);
assert.equal(activeShiftMember({...ownerShift,status:'closed'},'owner'),false);

function harness({uid='staff',shift=null}={}){
  let at=1000000,timedOut=0,interval=null;const document=new FakeTarget(),window=new FakeTarget();
  window.localStorage=storage;window.setInterval=fn=>{interval=fn;return 1;};window.clearInterval=()=>{interval=null;};
  const controller=startPortalIdle({window,document,storage,uid,now:()=>at,getShift:()=>shift,onTimeout:()=>{timedOut++;}});
  return {controller,document,advance(ms){at+=ms;controller.checkNow();},setShift(value){shift=value;controller.checkNow();},timedOut:()=>timedOut,interval:()=>interval};
}

const ordinary=harness();
ordinary.advance(PORTAL_IDLE_MS-1);assert.equal(ordinary.timedOut(),0);
ordinary.advance(1);await new Promise(resolve=>setTimeout(resolve,0));assert.equal(ordinary.timedOut(),1,'ordinary users sign out after 30 minutes');

const cashier=harness({uid:'owner',shift:ownerShift});
cashier.advance(PORTAL_IDLE_MS*4);assert.equal(cashier.timedOut(),0,'the active shift owner stays signed in silently');
cashier.setShift(null);cashier.advance(PORTAL_IDLE_MS-1);assert.equal(cashier.timedOut(),0,'a fresh period starts when the shift exemption ends');
cashier.advance(1);await new Promise(resolve=>setTimeout(resolve,0));assert.equal(cashier.timedOut(),1);

const crew=harness({uid:'crew',shift:ownerShift});
crew.advance(PORTAL_IDLE_MS*4);assert.equal(crew.timedOut(),0,'joined crew stay signed in silently');
crew.controller.stop();
const otherStorageMap=new Map(),otherStorage={getItem:key=>otherStorageMap.get(key)||null,setItem:(key,value)=>otherStorageMap.set(key,String(value))};
let at=2000000,timedOut=0;const document=new FakeTarget(),window=new FakeTarget();window.localStorage=otherStorage;window.setInterval=()=>1;window.clearInterval=()=>{};
const other=startPortalIdle({window,document,storage:otherStorage,uid:'crew',now:()=>at,getShift:()=>ownerShift,onTimeout:()=>{timedOut++;}});
at+=PORTAL_IDLE_MS;other.checkNow();assert.equal(timedOut,0,'active crew are not disturbed in another browser');

console.log('PASS: inactive non-shift users sign out after 30 minutes; the active shift owner and joined crew remain undisturbed.');
