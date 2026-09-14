import fs from 'node:fs';
import {createSubscriptionHub} from '../assets/js/admin/realtime-hub.mjs';

const html=fs.readFileSync(new URL('../admin.html',import.meta.url),'utf8');
const core=fs.readFileSync(new URL('../assets/js/admin/core.mjs',import.meta.url),'utf8');
const catalogAdmin=fs.readFileSync(new URL('../assets/js/admin/catalog-admin.mjs',import.meta.url),'utf8');
const adminOrders=fs.readFileSync(new URL('../assets/js/admin/admin-orders.mjs',import.meta.url),'utf8');
const navigationCss=fs.readFileSync(new URL('../assets/css/admin/navigation.css',import.meta.url),'utf8');
const moduleLoader=fs.readFileSync(new URL('../assets/js/admin/module-loader.js',import.meta.url),'utf8');
function assert(ok,message){if(!ok)throw new Error(message);}

const navigation=(html.match(/<div class="admin-tabs"[\s\S]*?<div id="adminWorkspaceHeader"/)||[])[0]||'';
const groups=[...navigation.matchAll(/class="admin-group[^\"]*" data-grp="([^"]+)"/g)].map((match)=>match[1]);
assert(groups.join('|')==='pos|overview|orders|reports|stock|finance|customers|settings','Admin work areas are missing or out of order');

const expected={
  pos:['pos','ops','inbox'],
  overview:['dashboard','liveoperations','operations'],
  orders:['orders','reservations','calendar','availSection'],
  reports:['saleshistory','analytics','dailyreport'],
  stock:['inventory','stockvalue','purchases','recipes','usage','packages'],
  finance:['petty','undeposited','payouts','discrepancy'],
  customers:['appcustomers','reviews','commentsSection'],
  settings:['possettings','accountingperiods','channelpricing','dedupe','payment','staffaccounts','staffaccess','adminaccounts','changepw']
};
for(const [group,tabs] of Object.entries(expected)){
  const row=(navigation.match(new RegExp(`<div class="tabgrp" data-grp="${group}"[\\s\\S]*?</div>`))||[])[0]||'';
  const actual=[...row.matchAll(/onclick="(?:posSwitchTab|switchTab|showAdminSection)\('([^']+)'/g)].map((match)=>match[1]);
  assert(actual.join('|')===tabs.join('|'),`${group} tabs are incomplete or out of order: ${actual.join(', ')}`);
}

const allTabs=Object.values(expected).flat();
assert(allTabs.length===35&&new Set(allTabs).size===35,'Every Admin destination must appear exactly once');
for(const tab of allTabs.filter((name)=>!['availSection','commentsSection'].includes(name)))assert(html.includes(`id="tab-${tab}"`),`Admin panel is missing for ${tab}`);
assert(core.includes("\"'availSection'\":'availability'")&&core.includes("\"'commentsSection'\":'comments'"),'Moved Availability and Comments must retain staff permission checks');
assert(core.includes("if(id==='availSection')")&&core.includes("subscriptionHub.activate('availability')"),'Menu Availability must activate its lazy catalog and option-group data scope');
assert(core.includes("subscriptionHub.activate('availability');buildAvail();renderOptionManager()"),'Opening Menu Availability must refresh its items and option groups after activating their data scope');
assert(core.includes('ogLoaded=true')&&catalogAdmin.includes('optionsReady()')&&catalogAdmin.includes('Loading options…'),'Menu Availability must distinguish an option-group load in progress from a confirmed empty database node');
assert(core.includes('var d=snap.val()||{}')&&core.includes('Object.keys(d).length'),'Cached option-group snapshots must not require Firebase-only snapshot methods');
assert(core.includes('if(adminLoggedIn){renderOptionManager();buildAvail();}'),'Loaded option groups must rebuild Menu Availability item checklists on every manager device');
const alertSource=(adminOrders.match(/function shouldAlertOrder\(o\)\{[^}]+\}/)||[])[0];
assert(alertSource&&core.includes('.filter(shouldAlertOrder)'),'New-order ringing must use one tested actionable-order policy');
const shouldAlertOrder=Function(alertSource+';return shouldAlertOrder')();
assert(shouldAlertOrder({source:'online',status:'Pending'})&&shouldAlertOrder({source:'online',status:'Ready'}),'Actionable online orders must still ring');
for(const order of [{source:'online',status:'Completed'},{source:'online',status:'Received'},{source:'online',status:'Rejected'},{source:'pos',status:'Pending'}])assert(!shouldAlertOrder(order),'Completed, received, rejected, and POS hydration must never ring');
const priorStorage=globalThis.localStorage,priorError=console.error,storage={accaza_admin_master_v2:JSON.stringify({version:'old',optionGroups:{temperature:{name:'Temperature'}}})};
globalThis.localStorage={getItem:k=>storage[k]||null,setItem:(k,v)=>{storage[k]=v;}};
console.error=()=>{};
let recovered=null;
const noop=()=>()=>{},hub=createSubscriptionHub({}, {ref:(_db,path)=>path,onValue:(path,cb)=>{if(path==='publicCatalogVersion')queueMicrotask(()=>cb({val:()=>({version:'new'})}));return()=>{};},onChildAdded:noop,onChildChanged:noop,onChildRemoved:noop,query:x=>x,orderByChild:x=>x,limitToLast:x=>x,startAt:x=>x,endAt:x=>x,endBefore:x=>x,get:async()=>({val:()=>({}),exists:()=>false})});
hub.subscribe('optionGroups',snap=>{recovered=snap.val();});hub.authorize();hub.activate('pos');await new Promise(resolve=>setTimeout(resolve,0));
assert(recovered&&recovered.temperature&&JSON.parse(storage.accaza_admin_master_v2).optionGroups.temperature,'An empty live option-group read must retain and serve the last known safe catalog');
globalThis.localStorage=priorStorage;console.error=priorError;
assert(core.includes("panel.classList.add('admin-tab-content','admin-integrated-panel')"),'Availability and Comments must remain real Admin workspace panels');
assert(navigationCss.includes('#adminGroups{display:flex;flex-wrap:wrap')&&navigationCss.includes('grid-template-columns:repeat(2,minmax(0,1fr))'),'Every Admin work area must remain visible without horizontal scrolling');
const lazyTabs=[...navigation.matchAll(/posSwitchTab\('([^']+)'/g)].map((match)=>match[1]);
for(const tab of new Set(lazyTabs))assert(new RegExp(`(?:^|[,\\s])${tab}:\\[`).test(moduleLoader),`Lazy Admin destination ${tab} has no module route`);

console.log('PASS: all 35 Admin destinations are present once, grouped correctly, and retain their panels and permissions.');
