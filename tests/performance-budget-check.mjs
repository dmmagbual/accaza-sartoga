import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const size=file=>fs.statSync(path.join(root,file)).size;
const fail=message=>{throw new Error(message);};

const budgets={
  'assets/js/customer/core.mjs':115000,
  'assets/js/admin/core.mjs':135000,
  // Build 491 adds stock-item archiving: a retire path for ledger items that cannot be deleted,
  // with the guards, pickers and filter that go with it.
  // Per-item pastry packaging overrides (Customize/Edit/Revert) add ~11.6 KB: private
  // packagingRules/item_<key> drafts, their editor, and Menu applicability wiring.
  // Build 498 adds completed-sale item correction before preparation: corrected-cart
  // checkout, server repricing, cash-refund controls, immutable inventory replacement,
  // linked receipt/audit evidence and explicit cashier feedback.
  // Keep the ceiling narrowly above the reviewed generated bundle.
  'assets/js/admin/pos.js':520000,
  // Build 497 adds the visible cash-refund tag and preserved refund detail to shift reports.
  'assets/js/admin/register.js':175500,
  'assets/js/admin/analytics.js':150000,
  'assets/js/admin/finance.js':75000,
  // Build 106 adds consistent interactive feedback to Finance Books buttons.
  // Build 110 adds only the AP-page hooks; its 6 KB form remains isolated below.
  // Retain a narrow ceiling so future Finance Books growth requires review.
  'assets/js/books/app.js':191200,
  // Build 110 isolates the owner-only supplier AP cutover form from the core Books bundle.
  'src/books/opening-payables.js':7500
};
for(const [file,maximum] of Object.entries(budgets))if(size(file)>maximum)fail(`${file} exceeds its Phase 11 byte budget: ${size(file)} > ${maximum}`);

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
if(manifest.builds.admin!==503||manifest.builds.customer!==71||manifest.builds.books!==113||manifest.builds.serviceWorkerCache!==478)fail('Current build/cache versions are not synchronized');

console.log('PASS: Phase 11 enforces bounded customer listeners, coalesced catalog rendering, measured admin readiness, and bundle budgets.');
