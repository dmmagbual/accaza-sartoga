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
  // Build 542 adds controlled cash-payment account selection while preserving split-payment routing.
  // Build 580 refreshes IndexedDB immediately before a forced shift-close health report,
  // preventing a stale browser count from blocking a cashier after all sales have synced.
  // Build 582 adds the shift crew till lock (join prompt, seller stamp on each sale).
  'assets/js/admin/pos.js':526500,
  // Build 497 adds the visible cash-refund tag and preserved refund detail to shift reports.
  // +1.4 KB (Sep 2026): receipt images load on demand from pettyCashReceipts instead of riding
  // on every voucher in the Petty/Purchases listeners.
  // Build 540 adds the Cash Payments funding-account loading guard and in-place refresh.
  // Build 542 adds six server-validated cash-payment treatments and their audit fields.
  // Build 580 adds cashier handover and the bounded management recovery dialog.
  // Build 582 adds the shift crew panel, refused-sale recovery screen and per-seller Z lines.
  'assets/js/admin/register.js':210000,
  // Build 527 secures completed-sale corrections while retaining the sales reconciliation bridge;
  // retain a narrow ceiling above the reviewed generated bundle.
  // Build 533 replaces Stock Value's whole-journal listener with monthly totals plus the
  // current month (about 0.4 KB of loader code in exchange for ~0.5 MB per tab open).
  // Build 547 decouples the opening-balance and gain/loss reconciliation buttons so each
  // gates on its own server precondition instead of a shared check that silently re-hid
  // the opening-balance repost whenever 1290 carried a balance (regression of PR #171).
  // Build 566 keeps compact, validated monthly summaries before reporting.
  // summaries and a bounded live-order merge. The extra renderer code prevents an
  // unbounded historical download and stays under this reviewed narrow ceiling.
  // Build 569 adds weekly, peak-hour, and menu-level drink views from the same
  // compact summaries, replacing the obsolete renderer without raw-order reads.
  // Build 574 adds MTD/YTD cashier, weekday and peak-hour rendering on the
  // bounded monthly summary. The module remains lazy-loaded under Analytics.
  // Build 580 adds source-coverage gating plus the compact Top drinks panel and
  // in-cell comparison bars; it does not add any historical-order download.
  // Reviewed generated size: 178,177 bytes.
  'assets/js/admin/analytics.js':178500,
  'assets/js/admin/finance.js':75000,
  // Build 106 adds consistent interactive feedback to Finance Books buttons.
  // Build 110 adds only the AP-page hooks; its 6 KB form remains isolated below.
  // Build 115 adds supplier-advance details for account 1115.
  // Build 115 generated bundle is 205,505 bytes after the account-1115 drilldown;
  // retain a narrow ceiling so future Finance Books growth requires review.
  // Build 119 adds supplier-level AP balances, invoice payment history and bounded
  // partial-payment controls without adding another Firebase listener.
  // Books 124 adds the read-only original-journal viewer to every subsidiary
  // ledger row, exposing both entry legs without any additional Firebase read.
  'assets/js/books/app.js':224200,
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
if(manifest.builds.admin!==582||manifest.builds.customer!==75||manifest.builds.books!==129||manifest.builds.serviceWorkerCache!==563)fail('Current build/cache versions are not synchronized');

console.log('PASS: Phase 11 enforces bounded customer listeners, coalesced catalog rendering, measured admin readiness, and bundle budgets.');
