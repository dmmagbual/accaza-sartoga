import fs from 'node:fs';

const html=fs.readFileSync(new URL('../admin.html',import.meta.url),'utf8');
const sourceHtml=fs.readFileSync(new URL('../src/html/admin/50-admin-workspace.html',import.meta.url),'utf8');
const loader=fs.readFileSync(new URL('../assets/js/admin/module-loader.js',import.meta.url),'utf8');
const moduleCode=fs.readFileSync(new URL('../assets/js/admin/live-operations.js',import.meta.url),'utf8');
const core=fs.readFileSync(new URL('../assets/js/admin/core.mjs',import.meta.url),'utf8');
const sw=fs.readFileSync(new URL('../sw.js',import.meta.url),'utf8');
function assert(ok,message){if(!ok)throw new Error(message);}

for(const document of [html,sourceHtml]){
  assert(document.includes('id="tabBtnLiveOperations"'),'Live Operations navigation is missing');
  assert(document.includes("posSwitchTab('liveoperations'"),'Live Operations navigation is not routed');
  assert(document.includes('id="liveOperationsRoot"'),'Live Operations panel root is missing');
}
assert(loader.includes("liveoperations:'live-operations.js'"),'Live Operations module file is not lazy-loadable');
assert(loader.includes("liveoperations:['liveoperations']"),'Live Operations module route is missing');
assert(loader.includes("liveoperations:'liveOperationsRoot'"),'Live Operations root mapping is missing');
assert(moduleCode.includes("a.subscribe('posActiveShift'")&&moduleCode.includes("a.subscribe('activeOrders'"),'Owner view must use the existing shared realtime feeds');
assert(moduleCode.includes('Read-only owner view')&&moduleCode.includes('LIVE · no till controls')&&moduleCode.includes('Cashier-device boundary:'),'Read-only and offline-device disclosures are incomplete');
for(const forbidden of ['.set(','.update(','.remove(','syncOfflinePosSale','processOrderAdjustment','closeShift','saveDrawer','managerApproval'])assert(!moduleCode.includes(forbidden),`Owner view contains forbidden mutation capability: ${forbidden}`);
assert(core.includes('"\'liveoperations\'"'),'Staff permission enforcement must hide the owner view');
assert(sw.includes("'/assets/js/admin/live-operations.js'"),'Live Operations module is missing from the Admin service-worker assets');

console.log('PASS: Live Operations is shared-feed, read-only, permission-hidden from staff, and discloses the cashier-device boundary.');
