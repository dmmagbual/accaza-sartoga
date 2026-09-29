import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync('assets/js/admin/pos-tab-guard.js','utf8');
const loader=fs.readFileSync('assets/js/admin/module-loader.js','utf8');
const checkout=fs.readFileSync('src/admin/pos/50e-cart-checkout.js','utf8');
const persistence=fs.readFileSync('src/admin/pos/50f-sale-persistence.js','utf8');
const hub=fs.readFileSync('assets/js/admin/realtime-hub.mjs','utf8');
for(const marker of ['LEASE_MS=15000','STANDBY_MS=30*60000','beforeunload','visibilitychange','touchstart','POS standby · touch anywhere to wake','Use this tab instead','Use this device instead','updateDeviceAuthority','global.__online===false||devicePrimary!==false','crew&&!crew.leftAt','available=false'])assert.ok(source.includes(marker),`POS tab guard missing ${marker}`);
assert.ok(loader.includes("postabguard:'pos-tab-guard.js'")&&loader.includes("load('postabguard')"),'POS loader must install tab coordination before POS');
assert.ok(checkout.includes('AccazaPosTabGuard.canCharge()')&&persistence.includes('AccazaPosTabGuard.canCharge()'),'both checkout and persistence must reject a secondary tab before recording payment');
for(const marker of ["pageVisible&&!posStandby&&c.scopes.indexOf(activeScope)>-1","2*60000","if(!pageVisible||posStandby){resetEntry(entry);return;}","accaza-pos-standby"])assert.ok(hub.includes(marker),`hidden/standby listener suspension missing ${marker}`);

const shared=new Map();
function local(){return{getItem:k=>shared.has(k)?shared.get(k):null,setItem:(k,v)=>shared.set(k,String(v)),removeItem:k=>shared.delete(k)};}
function make(options={}){
  let now=1_000_000,timerFn=null;
  const FakeDate=class extends Date{static now(){return now;}};
  let appended=0;
  const body={appendChild(){appended++;}},document={visibilityState:'visible',body,getElementById:()=>null,addEventListener(){},createElement:()=>({style:{},setAttribute(){},querySelector:()=>({onclick:null}),remove(){},innerHTML:''})};
  const context={window:null,document,localStorage:local(),setInterval:fn=>(timerFn=fn,1),clearInterval(){},confirm:()=>true,alert(){},CustomEvent:function(type,init){this.type=type;this.detail=init&&init.detail;},Date:FakeDate,Math,JSON};
  context.window=context;context.__posShift={id:'SH-1',accountUid:options.accountUid||'cashier',crew:options.crew||{}};context.__accazaAuthz={uid:options.uid||'cashier'};context.addEventListener=()=>{};context.dispatchEvent=()=>{};
  context.__advance=ms=>{now+=ms;timerFn();};
  context.__appended=()=>appended;
  vm.createContext(context);vm.runInContext(source,context);return context;
}
const viewer=make({uid:'manager',accountUid:'cashier'});
assert.equal(viewer.AccazaPosTabGuard.participates(),false,'a manager who has not joined the active shift is not a guarded till');
assert.equal(viewer.AccazaPosTabGuard.canCharge(),true,'the device guard defers a non-participant to the existing Join shift control');
viewer.AccazaPosTabGuard.updateDeviceAuthority({primaryDevice:false},'SH-1');
assert.equal(viewer.__appended(),0,'a non-participant never sees a tab or device takeover warning');
const crew=make({uid:'manager',accountUid:'cashier',crew:{manager:{staff:'Manager',leftAt:null}}});
assert.equal(crew.AccazaPosTabGuard.participates(),true,'joined crew receive the same primary-device protection as the shift owner');
crew.AccazaPosTabGuard.stop();
const first=make(),second=make();
assert.equal(first.AccazaPosTabGuard.canCharge(),true,'first tab becomes primary');
assert.equal(second.AccazaPosTabGuard.canCharge(),false,'second tab is passive');
assert.notEqual(first.AccazaPosTabGuard.tabId(),second.AccazaPosTabGuard.tabId(),'each document gets a unique identity even when a browser duplicates a tab');
assert.equal(second.AccazaPosTabGuard.takeControl(),true,'cashier can deliberately move control to another tab');
assert.equal(first.AccazaPosTabGuard.canCharge(),false,'old tab becomes passive after takeover');
second.AccazaPosTabGuard.stop();
assert.equal(first.AccazaPosTabGuard.canCharge(),true,'remaining tab regains primary after the primary closes');
first.__advance(30*60*1000);
assert.equal(first.AccazaPosTabGuard.isStandby(),true,'the primary POS enters standby after 30 minutes without input');
assert.equal(first.AccazaPosTabGuard.canCharge(),true,'a touch or checkout attempt wakes standby without losing primary control');
assert.equal(first.AccazaPosTabGuard.isStandby(),false,'waking standby restores the POS immediately');
first.__online=true;first.AccazaPosTabGuard.updateDeviceAuthority({primaryDevice:false},'SH-1');
assert.equal(first.AccazaPosTabGuard.canCharge(),false,'a server-confirmed second browser stays passive while online');
first.__online=false;
assert.equal(first.AccazaPosTabGuard.canCharge(),true,'loss of connectivity never locks the cashier out of offline cash sales');

console.log('PASS: one browser tab owns checkout, takeover is explicit, closure releases control, and hidden tabs shed noncritical listeners without touching POS safety feeds.');
