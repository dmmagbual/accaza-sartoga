import fs from 'node:fs';
import path from 'node:path';
import {budgetState,usableBudget,BUNDLE_BUDGETS as budgets,BUNDLE_HARD_RESERVES as hardReserves} from './bundle-budgets.mjs';

const root=process.cwd();
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const size=file=>fs.statSync(path.join(root,file)).size;
const fail=message=>{throw new Error(message);};
const warn=(file,message)=>{console.warn('BUDGET WARNING: '+message);if(process.env.GITHUB_ACTIONS)console.log(`::warning file=${file}::${message}`);};
if(budgetState(976,1000)!=='warn'||budgetState(974,1000)!=='ok'||budgetState(1001,1000)!=='fail'||budgetState(1000,1000)!=='warn')fail('Bundle budget warning policy is miscalibrated');
if(usableBudget(1000,50)!==950||budgetState(950,1000,50)!=='warn'||budgetState(951,1000,50)!=='fail')fail('Hard-reserve policy is miscalibrated');
for(const [file,reserve] of Object.entries(hardReserves))if(!Object.hasOwn(budgets,file)||!Number.isInteger(reserve)||reserve<=0||reserve>=budgets[file])fail(`${file} has an invalid hard-reserve configuration`);
const posFile='assets/js/admin/pos.js',posReserve=hardReserves[posFile];
if(posReserve!==50000||budgets[posFile]!==650000)fail('POS lifeline must retain its reviewed 50 KB hard reserve inside the 650 KB envelope');
for(const [file,maximum] of Object.entries(budgets)){
  const bytes=size(file),reserve=hardReserves[file]||0,usable=usableBudget(maximum,reserve),state=budgetState(bytes,maximum,reserve);
  if(state==='fail')fail(`${file} exceeds its usable byte budget: ${bytes} > ${usable}. ${reserve?`${reserve} protected bytes remain reserved for emergency POS recovery and cannot be consumed by ordinary feature growth. `:''}Split code out of the bundle, or explicitly review both the growth and reserve before changing the policy.`);
  if(state==='warn')warn(file,`${file} has ${usable-bytes} usable bytes left before its ${usable}-byte release limit (${(100*bytes/usable).toFixed(1)}% used).${reserve?` Its ${reserve}-byte emergency reserve remains protected.`:''} Split code out or re-review the ceiling before the next feature.`);
}

const customer=read('assets/js/customer/core.mjs'),rules=read('database.rules.json'),moduleLoader=read('assets/js/admin/module-loader.js'),hub=read('assets/js/admin/realtime-hub.mjs'),telemetry=read('assets/js/admin/telemetry.js'),functions=read('functions/index.js'),register=read('assets/js/admin/register.js'),salesPeriod=read('assets/js/admin/sales-period-data.mjs');
for(const marker of ['CUSTOMER_LIVE_ORDER_LIMIT=20','CUSTOMER_LIVE_RESERVATION_LIMIT=12',"query(ref(db,'customerOrders/'+uid),orderByChild('createdAt'),limitToLast(CUSTOMER_LIVE_ORDER_LIMIT))",'_myOrdersSub[id]=onValue','_myOrdersSub[id]()','_myResSub[id]=onValue','_myResSub[id]()'])if(!customer.includes(marker))fail(`Bounded customer listener safeguard missing: ${marker}`);
if(!rules.includes('"$uid": { ".indexOn": "createdAt"'))fail('Customer order index lacks the createdAt database index required by its bounded query');
for(const marker of ['categoriesListCache','menuItemsListCache','scheduleCatalogRender()','requestAnimationFrame(run)'])if(!customer.includes(marker))fail(`Catalog render-efficiency safeguard missing: ${marker}`);
if((customer.match(/onValue\(ref\(db,'orders\/'\+id\)/g)||[]).length!==1)fail('Customer runtime has more than one owned-order listener implementation');
if(customer.includes('onValue(ordersRef'))fail('Customer runtime must never subscribe to the complete orders node');
for(const marker of ["orderByChild('shiftId')","equalTo(id)"])if(!register.includes(marker))fail(`Shift review restored a whole-order-history download: ${marker}`);
if(!rules.includes('"archivedAt", "timestamp", "completedAt", "receivedAt", "shiftId"'))fail('Archived shift query lacks its shiftId index');
if(salesPeriod.includes("ops.startAt(String")||salesPeriod.includes("orderByChild('archivedAt')")||salesPeriod.includes("ops.endAt(0)"))fail('Sales reports restored legacy queries that duplicate archived-order downloads');

for(const source of [moduleLoader,hub,telemetry,functions])for(const marker of source===moduleLoader?['module_load','performance.now']:source===hub?['live_ready','liveStartedAt']:['module_load','live_ready'])if(!source.includes(marker))fail(`Measured performance telemetry missing: ${marker}`);

const manifest=JSON.parse(read('release-manifest.json'));
if(manifest.builds.admin!==637||manifest.builds.customer!==89||manifest.builds.books!==140||manifest.builds.serviceWorkerCache!==624)fail('Current build/cache versions are not synchronized');

console.log('PASS: Phase 11 enforces bounded customer listeners, coalesced catalog rendering, measured admin readiness, and bundle budgets.');
