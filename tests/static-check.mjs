import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';

const root=process.cwd();
const htmlFiles=['admin.html','index.html'];
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'accaza-static-check-'));
let checked=0;

function fail(message){throw new Error(message);}
function section(source,start,end){
  const a=source.indexOf(start);
  if(a<0)fail(`Missing section: ${start}`);
  const b=source.indexOf(end,a+start.length);
  if(b<0)fail(`Missing section end: ${end}`);
  return source.slice(a,b);
}
function localScripts(folder){
  const dir=path.join(root,folder);
  return fs.readdirSync(dir).filter(name=>/\.(?:js|mjs)$/i.test(name)).sort().map(name=>({
    name,
    source:fs.readFileSync(path.join(dir,name),'utf8'),
    target:path.join(dir,name)
  }));
}
const adminScripts=localScripts(path.join('assets','js','admin'));
const customerScripts=localScripts(path.join('assets','js','customer'));
const adminHtml=fs.readFileSync(path.join(root,'admin.html'),'utf8');
const customerHtml=fs.readFileSync(path.join(root,'index.html'),'utf8');
const adminSource=adminHtml+'\n'+adminScripts.map(item=>item.source).join('\n');
const customerSource=customerHtml+'\n'+customerScripts.map(item=>item.source).join('\n');

try{
  for(const file of htmlFiles){
    const source=fs.readFileSync(path.join(root,file),'utf8');
    const appSource=file==='admin.html'?adminSource:customerSource;
    const scriptPattern=/<script(?<attrs>[^>]*)>(?<body>[\s\S]*?)<\/script>/gi;
    let match,index=0;
    while((match=scriptPattern.exec(source))){
      index++;
      const attrs=match.groups.attrs||'';
      const body=match.groups.body||'';
      if(/\bsrc\s*=/.test(attrs)||/application\/ld\+json/i.test(attrs)||!body.trim())continue;
      const isModule=/type\s*=\s*["']module["']/i.test(attrs);
      const target=path.join(temp,`${path.basename(file,'.html')}-${index}.${isModule?'mjs':'js'}`);
      fs.writeFileSync(target,body,'utf8');
      const result=spawnSync(process.execPath,['--check',target],{encoding:'utf8'});
      if(result.status!==0)fail(`${file} script ${index} failed syntax check:\n${result.stderr||result.stdout}`);
      checked++;
    }

    const helperLine=appSource.split(/\r?\n/).find(line=>line.startsWith('function escHtml('));
    if(!helperLine)fail(`${file}: escHtml helper missing`);
    const sandbox={payload:'<img src=x onerror="bad"> \'test\' &'};
    vm.runInNewContext(`${helperLine}; result=escHtml(payload);`,sandbox);
    if(/[<>]/.test(sandbox.result)||sandbox.result.includes('"')||sandbox.result.includes("'"))fail(`${file}: escHtml did not neutralize the test payload`);

    const comments=section(appSource,'function renderComments()','function renderAdminReviews()');
    if(/\+f\.(?:name|contact|date|message|status)\+/.test(comments))fail(`${file}: feedback field still enters HTML directly`);
    if(file==='admin.html'&&appSource.includes('function renderOrders()')){
      const orders=section(appSource,'function renderOrders()','return {renderOrders');
      if(/\+o\.(?:name|phone|contact|items|address|notes|proof|payment|status|id)\+/.test(orders))fail(`${file}: order field still enters HTML directly`);
    }
    if(file==='admin.html'&&appSource.includes('function renderReservations()')){
      const reservations=section(appSource,'function renderReservations()','window.openResContactPopup');
      if(/\+r\.(?:name|phone|contact|notes|occasion|date|time|status|id)\+/.test(reservations))fail(`${file}: reservation field still enters HTML directly`);
    }
  }

  for(const item of [...adminScripts,...customerScripts]){
    const result=spawnSync(process.execPath,['--check',item.target],{encoding:'utf8'});
    if(result.status!==0)fail(`${item.target} failed syntax check:\n${result.stderr||result.stdout}`);
    checked++;
  }

  const rulesRaw=fs.readFileSync(path.join(root,'database.rules.json'),'utf8');
  JSON.parse(rulesRaw.replace(/^\s*\/\/.*$/gm,''));
  if(!rulesRaw.includes('feedbacks'))fail('feedback rules missing');
  if(!rulesRaw.includes('auth != null && (!data.exists() || ('))fail('create-only customer write gate missing');
  if(!rulesRaw.includes("newData.child('message').val().length <= 800"))fail('feedback message limit missing');
  if(!rulesRaw.includes("newData.child('notes').val().length <= 500"))fail('reservation note limit missing');

  const loginBlock=section(adminSource,'function portalRole(raw)','window.logoutAdmin=function()');
  if(!loginBlock.includes('onAuthStateChanged(auth'))fail('Firebase-auth portal gate missing');
  if(!loginBlock.includes("get(ref(db,'admins/'+user.uid))"))fail('server-backed role lookup missing');
  if(/sessionStorage\.getItem\([^)]*accaza_admin_session/.test(loginBlock))fail('browser session still restores portal authority');
  if(/crypto\.subtle|passwordHash/.test(loginBlock))fail('legacy browser-side password authentication remains in login path');
  if(!loginBlock.includes('await authorizePortalUser(cred.user)'))fail('portal login does not await the shared authorization gate');
  if(!loginBlock.includes('setPersistence(auth,browserLocalPersistence)'))fail('portal authentication does not persist reliably across refresh');
  if(loginBlock.includes('location.reload()'))fail('portal login still forces a full-page reload');
  if(!adminSource.includes('function createSubscriptionHub('))fail('Release 2B shared subscription hub missing');
  if(!adminSource.includes("subscriptionHub.subscribe('archivedOrders'"))fail('large archive data is not routed through the lazy subscription hub');
  if(!adminSource.includes('subscriptionHub.activate(tab)'))fail('tab changes do not activate scoped live data');
  if(!adminSource.includes('subscriptionHub.authorize()'))fail('live data is not started by the authorization gate');
  if(adminSource.includes("a.onValue(a.ref(a.db,"))fail('isolated modules still create duplicate raw database listeners');
  if((adminSource.match(/entry\.unsub=onValue\(/g)||[]).length!==1)fail('subscription hub must own exactly one physical listener attachment point');
  if(!adminSource.includes("subscriptionHub.subscribe('activeOrders'"))fail('Release 2C active-order projection is not the live admin source');
  if(!adminSource.includes("a.subscribe('orders',function(s){ordersMap=s.val()"))fail('analytics does not use bounded authoritative order history');
  if(!adminSource.includes('const HISTORY_BOUNDS='))fail('bounded history query configuration missing');
  if(!adminSource.includes('loadOlder:async function(path)'))fail('history pagination loader missing');
  if(adminSource.includes('function tryDeduct('))fail('retired browser inventory deduction still exists');
  if(adminHtml.includes('xlsx.full.min.js'))fail('Release 2D still downloads SheetJS during admin startup');
  if(!adminHtml.includes('assets/js/admin/module-loader.js'))fail('Release 2D admin lazy-module loader missing');
  if(!adminHtml.includes('assets/js/admin/core.mjs'))fail('admin core was not extracted from the HTML monolith');
  if(!adminSource.includes('window.__accazaLoadExcel=function()'))fail('on-demand Excel loader missing');
  for(const name of ['pos','analytics','register','staff','packages','finance']){
    if(!adminSource.includes(`window.__accazaRegisterModule('${name}'`))fail(`lazy admin module registration missing: ${name}`);
  }
  if((adminSource.match(/window\.posSwitchTab=function/g)||[]).length!==1)fail('lazy module loader must be the sole POS tab router');
  if(!rulesRaw.includes("root.child('adminPerms').child(auth.uid).child('inventory').val() === true"))fail('inventory permission enforcement missing');
  if(!rulesRaw.includes("newData.child('refundAmount').val() === data.child('refundAmount').val()"))fail('cashier refund-field protection missing');
  if(!rulesRaw.includes('auth.uid === $uid'))fail('signed-in user cannot read their own role record');
  if(!rulesRaw.includes('"activeOrders"'))fail('activeOrders security rules missing');
  if(!rulesRaw.includes('"timestamp", "shiftId", "status", "paymentStatus", "settlementStatus"'))fail('order projection indexes missing');

  const placeOrderBlock=section(customerSource,'window.placeOrder=async function()','window.resetOrder=function()');
  const trackerBlock=section(customerSource,'function renderCustomerOrders()','// ── RESERVATIONS');
  if(!placeOrderBlock.includes('createOnlineOrderCall('))fail('customer checkout does not call server-priced order creation');
  if(/set\(ref\(db,'orders\/|runTransaction\(ref\(db,'orderLocks\//.test(placeOrderBlock))fail('customer checkout still writes orders or duplicate locks directly');
  if(!trackerBlock.includes('confirmOrderReceivedCall('))fail('receipt confirmation is not server-owned');
  if(!customerSource.includes('compressPaymentProof(file)'))fail('customer payment proof compression missing');
  if(customerHtml.includes('id="adminDash"')||customerHtml.includes('id="loginOverlay"')||customerHtml.includes('id="availSection"'))fail('retired embedded admin portal remains in the customer HTML');
  if(!customerHtml.includes('assets/js/customer/core.mjs'))fail('customer core was not extracted from the HTML monolith');
  if(customerSource.includes('onValue(ordersRef,snap=>'))fail('customer startup still requests the whole authoritative orders node');
  if(customerSource.includes('onValue(appCustomersRef'))fail('customer startup still requests the whole customer registry');
  if(!placeOrderBlock.includes('const proofSrc=paymentProofData'))fail('checkout does not submit the optimized payment proof');
  if(!rulesRaw.includes('data.child(\'ownerUid\').val() === auth.uid'))fail('customer order ownership read rule missing');
  if(!rulesRaw.includes('"orderLocks": { ".read": false, ".write": false }'))fail('order locks are not private');
  if(!rulesRaw.includes('"customerOrders"'))fail('customer order index rules missing');
  if(!rulesRaw.includes('"$uid": {')||!rulesRaw.includes('auth.uid === $uid'))fail('UID-owned customer profile rules missing');

  const functionsSource=fs.readFileSync(path.join(root,'functions','index.js'),'utf8');
if(!functionsSource.includes('exports.createOnlineOrder = onCall'))fail('createOnlineOrder callable missing');
if(functionsSource.includes('defineBoolean("ENFORCE_APP_CHECK"'))fail('App Check enforcement must be passed to CallableOptions as a real Boolean, not a truthy parameter object');
if(!functionsSource.includes('process.env.ENFORCE_APP_CHECK'))fail('App Check enforcement environment Boolean guard missing');
  if(!functionsSource.includes('pricingVersion: "server-v1"'))fail('server pricing stamp missing');
  if(!functionsSource.includes('ownerUid: uid'))fail('server order owner stamp missing');
  if(!functionsSource.includes('exports.confirmOrderReceived = onCall'))fail('confirmOrderReceived callable missing');
  if(!functionsSource.includes('const {getStorage} = require("firebase-admin/storage")'))fail('server Storage integration missing');
  if(!functionsSource.includes('exports.getPaymentProof = onCall'))fail('authorized on-demand proof retrieval callable missing');
  if(!functionsSource.includes('order.proofPath = proofPath'))fail('orders do not store the compact proof path');
  const createOrderFn=section(functionsSource,'exports.createOnlineOrder = onCall','exports.getPaymentProof = onCall');
  if(/source:\s*"online",\s*proof\b/.test(createOrderFn))fail('raw payment proof is still stored in the order record');
  if(!adminSource.includes("'getPaymentProof'")||!adminSource.includes('getPaymentProof:getPaymentProofCall')||!adminSource.includes('data-prooforder'))fail('admin proof viewing is not lazy-loaded through the authorized callable');
  if(!functionsSource.includes('enforceOrderRateLimit'))fail('online order rate limit missing');
  if(!functionsSource.includes('exports.ensureActiveOrders = onCall'))fail('active-order migration callable missing');
  if(!functionsSource.includes('exports.syncActiveOrderProjection = onValueWritten'))fail('active-order synchronization trigger missing');
  if(!functionsSource.includes('exports.pruneClosedShiftOrders = onValueWritten'))fail('closed-shift projection cleanup trigger missing');
  if(!functionsSource.includes('[`activeOrders/${orderId}`]: activeOrderProjection(order)'))fail('online orders do not enter the live projection atomically');
  if(!functionsSource.includes('Costing.costOrder({'))fail('Release 3B server-authoritative costing engine is not used at finalization');
  if(!functionsSource.includes('exports.validateRecipeDefinition = onCall'))fail('Release 3B server recipe validator missing');
  if(!functionsSource.includes('cogsDetail: {'))fail('Release 3B traceable COGS snapshot missing');
  if(!adminSource.includes("'validateRecipeDefinition'")||!adminSource.includes('validateRecipeDefinition:validateRecipeDefinitionCall'))fail('admin recipe save is not connected to the server validator');
  if(!adminSource.includes('Costing().normalizeRecipe(raw,inventoryMap)'))fail('admin recipe save does not run shared normalization');
  for(const marker of ['exports.postFinancialCommand = onCall','exports.settlePlatformPayout = onCall','exports.processOrderAdjustment = onCall','exports.ensureFinancialLedger = onCall','exports.onOrderFinancialPosting = onValueWritten'])if(!functionsSource.includes(marker))fail(`Release 3C server marker missing: ${marker}`);
  if(adminSource.includes('function reconcileAuto()'))fail('retired browser-authored financial reconciliation still exists');
  if(!adminSource.includes("'postFinancialCommand'")||!adminSource.includes("'settlePlatformPayout'")||!adminSource.includes('postFinancialCommand:postFinancialCommandCall'))fail('Release 3C callable bridge missing');
  for(const node of ['financialMovements','cfLedger','receivables','payables','platformPayouts'])if(!rulesRaw.includes(`"${node}"`))fail(`Release 3C rules missing ${node}`);
  if(!rulesRaw.includes('"financialMovements": { ".indexOn": "occurredAt"')||!rulesRaw.includes('"cfLedger":')||!rulesRaw.includes('"platformPayouts":'))fail('Release 3C financial projections are not declared');
  for(const marker of ['exports.createManagerApproval = onCall','exports.consumeManagerApproval = onCall','exports.manageChartAccount = onCall','exports.auditFinancialControls = onCall','exports.onShiftOpenFinancial = onValueWritten'])if(!functionsSource.includes(marker))fail(`Release 3D server marker missing: ${marker}`);
  for(const node of ['financialApprovals','chartOfAccounts','cashCustody'])if(!rulesRaw.includes(`"${node}"`))fail(`Release 3D rules missing ${node}`);
  if(!adminSource.includes("'createManagerApproval'")||!adminSource.includes('callables.createManagerApproval')||!adminSource.includes('inMemoryPersistence'))fail('Release 3D independent Firebase manager approval is missing');
  if(!adminSource.includes('authz&&authz.isPrivileged&&current')||!adminSource.includes("['owner','superadmin','admin','manager'].indexOf(effectiveRole)>-1"))fail('Release 7G privileged Admin payment approval path is missing');
  if(!adminSource.includes("a.managerApproval('refund'")||!adminSource.includes('refundPayments:refundPayments'))fail('Release 3D actual refund-tender approval flow is missing');
  if(!adminSource.includes("financeCommand('cash_deposit'")||!adminSource.includes('auditFinancialControls'))fail('Release 3D custody deposit or controls audit UI is missing');
  for(const marker of ['exports.manageOrderArchive = onCall','exports.reviewDiscrepancy = onCall','exports.managePettyVoucher = onCall','exports.archiveActivityLog = onCall'])if(!functionsSource.includes(marker))fail(`Release 3E server marker missing: ${marker}`);
  if(!functionsSource.includes('REJECTED_ORDER_RETENTION_MS')||!functionsSource.includes('deletionAudit/orders/'))fail('Release 3E rejected-order retention control missing');
  for(const marker of ["'manageOrderArchive'","'reviewDiscrepancy'","'managePettyVoucher'","'archiveActivityLog'"])if(!adminSource.includes(marker))fail(`Release 3E browser bridge missing: ${marker}`);
  for(const boundary of ['from"./firebase-client.mjs"','from"./realtime-hub.mjs"','from"./history-pager.mjs"','from"./manager-approval.mjs"','from"./portal-auth.mjs"','from"./admin-orders.mjs"','from"./customer-registry.mjs"','from"./reservations.mjs"','from"./catalog-admin.mjs"','from"./app-customer-session.mjs"','from"./customer-order-tracker.mjs"','from"./shared-ui.mjs"'])if(!adminSource.includes(boundary))fail(`Phase 4 explicit module boundary missing: ${boundary}`);
  if((adminSource.match(/window\.renderAppCustomers=/g)||[]).length!==1)fail('Phase 4 customer registry must have one renderer owner');
  if((adminSource.match(/function renderReservations\(\)/g)||[]).length!==1)fail('Phase 4B reservations must have one renderer owner');
  if((adminSource.match(/function buildAvail\(\)/g)||[]).length!==1)fail('Phase 4B availability administration must have one renderer owner');
  if((adminSource.match(/function renderChannelPricing\(\)/g)||[]).length!==1)fail('Phase 4B channel pricing must have one renderer owner');
  if(!adminSource.includes("channelpricing:['pos','channelpricing']")||!adminSource.includes("channelpricing:'channel-pricing.js'"))fail('Phase 4B channel pricing is not independently lazy-loaded');
  if(adminSource.includes('printOrder:printOrder')||!adminSource.includes('printOrder:function(id){if(window.printOrder)'))fail('Phase 4B login startup can be blocked by an eager receipt callback');
  if((adminSource.match(/window\.appLoginSubmit=/g)||[]).length!==1)fail('Phase 4C app-customer session must have one login owner');
  if((adminSource.match(/function renderCustomerOrders\(\)/g)||[]).length!==1)fail('Phase 4C customer tracker must have one render bridge');
  const phase4cCore=adminScripts.find(item=>item.name==='core.mjs');
  if(phase4cCore&&(/function isAppMode\(\)|\bmyOrderIds\b|const statusConfig=/.test(phase4cCore.source)))fail('Phase 4C customer session or tracker state leaked back into admin core');
  if(!adminSource.includes('const callableNames=')||!adminSource.includes('function createSubscriptionHub(database,ops)'))fail('Phase 4 service registry or subscription engine missing');
  const adminCoreItem=adminScripts.find(item=>item.name==='core.mjs');
  if(!adminCoreItem||Buffer.byteLength(adminCoreItem.source,'utf8')>125000)fail('Phase 4C core module has regrown beyond the 125 KB guard');
  const firebaseImportOwners=adminScripts.filter(item=>item.source.includes('gstatic.com/firebasejs')).map(item=>item.name);
  if(firebaseImportOwners.length!==1||firebaseImportOwners[0]!=='firebase-client.mjs')fail('Firebase SDK imports must be centralized in firebase-client.mjs');
  for(const item of adminScripts){for(const match of item.source.matchAll(/from["']\.\/([^"']+)["']/g)){if(!fs.existsSync(path.join(root,'assets','js','admin',match[1])))fail(`${item.name} imports missing local module ${match[1]}`);}}
  if(adminSource.includes("remove(ref(db,'archivedOrders/'")||adminSource.includes("a.update(a.ref(a.db,'discrepancies/'+id)"))fail('Release 3E retired browser authority remains');
  if(!rulesRaw.includes('"archivedOrders":')||!rulesRaw.includes('"operationalAudit":')||!rulesRaw.includes('"deletionAudit":'))fail('Release 3E controlled archive/audit rules missing');

  const storageRules=fs.readFileSync(path.join(root,'storage.rules'),'utf8');
  if(!storageRules.includes('allow read, write: if false'))fail('Storage is not locked to server-only access');
  const firebaseConfig=JSON.parse(fs.readFileSync(path.join(root,'firebase.json'),'utf8'));
  if(!firebaseConfig.storage||firebaseConfig.storage.rules!=='storage.rules')fail('Storage rules are not wired into Firebase deployment');

  const swSource=fs.readFileSync(path.join(root,'sw.js'),'utf8');
  const assetMatch=swSource.match(/const ASSETS=(\[[^;]+\])/);
  if(!assetMatch)fail('service-worker precache manifest missing');
  const precache=vm.runInNewContext(assetMatch[1]);
  for(const url of precache){
    if(url==='/')continue;
    const local=path.join(root,String(url).replace(/^\//,''));
    if(!fs.existsSync(local))fail(`service-worker precache file does not exist: ${url}`);
  }
  for(const manifestName of ['manifest.json','manifest-admin.json']){
    const manifest=JSON.parse(fs.readFileSync(path.join(root,manifestName),'utf8'));
    if(!manifest.id||!manifest.start_url||manifest.display!=='standalone')fail(`Phase 5A invalid PWA manifest: ${manifestName}`);
    if(!Array.isArray(manifest.icons)||!manifest.icons.some(icon=>icon.sizes==='192x192')||!manifest.icons.some(icon=>icon.sizes==='512x512'))fail(`Phase 5A required PWA icons missing: ${manifestName}`);
    for(const icon of manifest.icons){if(!fs.existsSync(path.join(root,icon.src.replace(/^\//,''))))fail(`Phase 5A manifest icon file missing: ${icon.src}`);}
  }
  const pwaRegister=fs.readFileSync(path.join(root,'assets','js','pwa-register.js'),'utf8');
  if(!adminHtml.includes('/manifest-admin.json')||!customerHtml.includes('/manifest.json'))fail('Phase 5A customer/admin manifests are not separated');
  if(!adminHtml.includes('assets/js/pwa-register.js')||!customerHtml.includes('assets/js/pwa-register.js'))fail('Phase 5A service worker is not registered by both entry pages');
  if(!pwaRegister.includes("serviceWorker.register('/sw.js'"))fail('Phase 5A shared service-worker registration missing');
  if(fs.readFileSync(path.join(root,'assets','js','customer','navigation.js'),'utf8').includes('serviceWorker.register'))fail('Phase 5A duplicate customer service-worker registration remains');
  if((pwaRegister.match(/beforeinstallprompt/g)||[]).length!==1||!pwaRegister.includes('window.accazaInstallApp=function'))fail('Phase 5C shared install controller missing or duplicated');
  if(!adminHtml.includes('data-accaza-install')||!adminHtml.includes('Install Accaza POS App'))fail('Phase 5C visible POS install controls missing');
  if(fs.readFileSync(path.join(root,'assets','js','customer','navigation.js'),'utf8').includes('beforeinstallprompt'))fail('Phase 5C legacy customer install owner remains');
  if(!pwaRegister.includes("window.addEventListener('appinstalled'")||!pwaRegister.includes('accazaUpdateReady'))fail('Phase 5C install completion or update-ready UX missing');
  for(const shellAsset of ['/admin.html','/assets/js/admin/core.mjs','/assets/js/admin/pos.js','/assets/js/admin/register.js'])if(!precache.includes(shellAsset))fail(`Phase 5A POS shell asset missing from cache: ${shellAsset}`);
  if(!swSource.includes("url.pathname.indexOf('/admin')===0?'/admin.html':'/index.html'"))fail('Phase 5A navigation fallback can redirect admin/POS to the customer shell');
  if(!swSource.includes("new Response('Offline asset unavailable',{status:503"))fail('Phase 5A missing offline asset failure response');
  const offlineQueueSource=fs.readFileSync(path.join(root,'assets','js','admin','offline-queue.js'),'utf8');
  const offlineServerSource=fs.readFileSync(path.join(root,'functions','lib','offline-sync.js'),'utf8');
  const posSource=fs.readFileSync(path.join(root,'assets','js','admin','pos.js'),'utf8');
  if(!offlineQueueSource.includes("indexedDB.open(DB_NAME,DB_VERSION)")||!offlineQueueSource.includes("keyPath:'id'")||!offlineQueueSource.includes("status:'pending'"))fail('Phase 5B durable IndexedDB transaction queue missing');
  for(const state of ["'pending'","'syncing'","'failed'","'synced'"])if(!offlineQueueSource.includes(state))fail(`Phase 5B queue state missing: ${state}`);
  if(posSource.includes("localStorage.getItem('accaza_offline_orders')")||posSource.includes("writes['orders/'+o.id]"))fail('Phase 5B retired localStorage/direct-write queue remains in POS');
  if(!posSource.includes("clientTxnId:txnId")||!posSource.includes('PENDING SYNC — Firebase confirmation not yet received'))fail('Phase 5B POS does not stamp or disclose pending synchronization');
  if(!adminSource.includes("syncOfflinePosSale:function(command)")||!adminSource.includes("'syncOfflinePosSale'"))fail('Phase 5B callable bridge missing');
  if(!functionsSource.includes('exports.syncOfflinePosSale = onCall')||!functionsSource.includes('OfflineSync.syncOfflinePosSaleCommand')||!offlineServerSource.includes('offlineSyncApplied')||!offlineServerSource.includes('raw.clientTxnId !== transactionId'))fail('Phase 5B server idempotency or drawer guard missing');
  if(!rulesRaw.includes('"offlinePosSync": {')||!rulesRaw.includes('".indexOn": "updatedAt", ".read": false, ".write": false'))fail('Phase 5B server-only sync audit node missing');
  if(!precache.includes('/assets/js/admin/offline-queue.js'))fail('Phase 5B durable queue module is not precached');

  const formDialogSource=fs.readFileSync(path.join(root,'assets','js','admin','form-dialog.js'),'utf8');
  const registerSource=fs.readFileSync(path.join(root,'assets','js','admin','register.js'),'utf8');
  if(adminHtml.indexOf('assets/js/admin/form-dialog.js')<0||adminHtml.indexOf('assets/js/admin/form-dialog.js')>adminHtml.indexOf('assets/js/admin/core.mjs'))fail('Phase 5D form dialog must load before admin core');
  if(!formDialogSource.includes('global.AccazaFormDialog=')||!formDialogSource.includes("setAttribute('role','dialog')")||!formDialogSource.includes("setAttribute('aria-modal','true')")||!formDialogSource.includes('data-afd-error'))fail('Phase 5D accessible validated form service is incomplete');
  if(/\bprompt\s*\(/.test(adminSource))fail('Phase 5D browser prompt remains in active admin source');
  for(const marker of ['Void completed sale','Refund completed sale','Void reason','Refund amount','Refund reason'])if(!registerSource.includes(marker))fail(`Phase 5D financial form marker missing: ${marker}`);
  if(!precache.includes('/assets/js/admin/form-dialog.js'))fail('Phase 5D form dialog is not precached');

  const telemetrySource=fs.readFileSync(path.join(root,'assets','js','admin','telemetry.js'),'utf8');
  if(!posSource.includes('capturePosDraft(p)')||!posSource.includes('restorePosDraft(p)')||!posSource.includes('posChargeBusy')||!posSource.includes("textContent='Processing…'"))fail('Phase 5E draft preservation or single-flight Charge guard missing');
  if(!adminHtml.includes('accaza-touch-5e')||!adminHtml.includes('min-height:44px'))fail('Phase 5E touch-target controls missing');
  if(!telemetrySource.includes('AccazaTelemetry=')||!telemetrySource.includes('charge_to_durable')||!telemetrySource.includes('offline_flush')||!telemetrySource.includes('realtime_order_arrival'))fail('Phase 6A client timing instrumentation incomplete');
  if(/customer|paymentref|platformref|pin|orderitems/i.test(telemetrySource))fail('Phase 6A telemetry source may collect sensitive business/customer fields');
  if(!functionsSource.includes('exports.recordClientTelemetry = onCall')||!functionsSource.includes('CLIENT_METRICS')||!functionsSource.includes('/clientTelemetryDaily/'))fail('Phase 6A server telemetry aggregation missing');
  if(!rulesRaw.includes('"clientTelemetryDaily"')||!rulesRaw.includes('".write": false'))fail('Phase 6A telemetry node is not server-write-only');
  if(!precache.includes('/assets/js/admin/telemetry.js'))fail('Phase 6A telemetry module is not precached');
  const operationsSource=fs.readFileSync(path.join(root,'assets','js','admin','operations-dashboard.js'),'utf8');
  if(!adminHtml.includes("posSwitchTab('operations',this)")||!adminHtml.includes('id="operationsRoot"'))fail('Phase 6C System Health tab is missing');
  if(!operationsSource.includes("clientTelemetryDaily/'+day")||!operationsSource.includes('Last 30 days')||!operationsSource.includes('not percentile measurements'))fail('Phase 6C bounded telemetry dashboard or honest metric disclosure is incomplete');
  for(const marker of ['pos_boot','cart_render','charge_to_durable','offline_flush','realtime_order_arrival'])if(!operationsSource.includes(marker))fail(`Phase 6C performance threshold missing: ${marker}`);
  if(!precache.includes('/assets/js/admin/operations-dashboard.js')||!swSource.includes("const CACHE='accaza-v65'"))fail('Phase 6C/7G dashboard is not in the coordinated offline cache');

  const orderAdminSource=fs.readFileSync(path.join(root,'assets','js','admin','admin-orders.mjs'),'utf8');
  const orderStatusSource=fs.readFileSync(path.join(root,'functions','lib','order-status.js'),'utf8');
  if(!functionsSource.includes('exports.updateOrderStatus = onCall')||!functionsSource.includes('OrderStatus.updateOrderStatusCommand'))fail('Phase 7A server order-status command missing');
  if(!functionsSource.includes('"cashier", "kitchen", "finance"'))fail('Phase 7A kitchen portal role is not recognized server-side');
  if(!orderAdminSource.includes('callables.updateOrderStatus')||/update\(ref\(db,'orders\/'/.test(orderAdminSource))fail('Phase 7A admin status mutations are not server-routed');
  const catalogAdminSource=fs.readFileSync(path.join(root,'assets','js','admin','catalog-admin.mjs'),'utf8');
  if(!catalogAdminSource.includes('Only owner, admin, or manager accounts can change menu prices')||!catalogAdminSource.includes('deploy the current Firebase Database rules'))fail('Release 7G catalog permission recovery guidance missing');
  for(const marker of ['order-payment-summary','order-payment-state','order-card-actions','Payment proof is missing'])if(!orderAdminSource.includes(marker))fail(`Release 7G order-card structure missing: ${marker}`);
  if(!rulesRaw.includes('"orderStatusCommands": { ".read": false, ".write": false }')||!rulesRaw.includes('"status": { ".validate": "!data.exists() || newData.val() === data.val()" }'))fail('Phase 7A direct status-write lock missing');
  if(!orderStatusSource.includes('statusHistory')||!orderStatusSource.includes('operationalAudit')||!orderStatusSource.includes('expectedStatus'))fail('Phase 7A status trace/stale-state evidence incomplete');
  const exceptionSource=fs.readFileSync(path.join(root,'functions','lib','operational-exceptions.js'),'utf8');
  if(!functionsSource.includes('exports.getOperationalExceptions = onCall')||!functionsSource.includes('OperationalExceptions.buildOperationalExceptions'))fail('Phase 7B manager exception callable missing');
  for(const marker of ['offline_sync','stuck_order','inventory_gap','financial_gap','cash_custody','proof_access'])if(!exceptionSource.includes(marker)&&!functionsSource.includes(marker))fail(`Phase 7B exception category missing: ${marker}`);
  if(!operationsSource.includes('Operational Exceptions')||!operationsSource.includes('getOperationalExceptions')||!operationsSource.includes('Read-only manager scan'))fail('Phase 7B Operations Center UI incomplete');
  if(!rulesRaw.includes('"offlinePosSync": { ".indexOn": "updatedAt"')||!rulesRaw.includes('"cashCustody": { ".indexOn": "closedAt"'))fail('Phase 7B bounded exception query indexes missing');
  if(!adminHtml.includes('id="accaza-admin-nav-7c"')||!adminHtml.includes('class="admin-group pos-primary"')||!adminHtml.includes('data-grp="finance" data-label="Financials"'))fail('Phase 7C primary admin navigation shell missing');
  if(!adminHtml.includes('Orders &amp; Operations')||!adminHtml.includes('Settings &amp; maintenance')||!adminHtml.includes('Menu Maintenance'))fail('Phase 7C information architecture incomplete');
  if(!adminSource.includes("cashier:'pos',kitchen:'orders',finance:'finance'")||!adminSource.includes('landRoleHome()'))fail('Phase 7C role-aware landing behavior missing');
  const workspaceShellSource=fs.readFileSync(path.join(root,'assets','js','admin','workspace-shell.mjs'),'utf8');
  if(!adminHtml.includes('id="adminWorkspaceHeader"')||!adminHtml.includes('id="adminServiceStrip"'))fail('Phase 7D contextual workspace header or live service strip missing');
  if(!adminHtml.includes('body.admin-pos-workspace')||!adminHtml.includes('#posCartPanel'))fail('Phase 7D focused POS workspace missing');
  if(!workspaceShellSource.includes('installWorkspaceShell')||!workspaceShellSource.includes('__refreshWorkspaceStatus')||!adminSource.includes('workspaceShell.update(tab)'))fail('Phase 7D workspace shell integration incomplete');
  if(!precache.includes('/assets/js/admin/workspace-shell.mjs'))fail('Phase 7D workspace shell is not precached');
  if(!adminHtml.includes('id="accaza-pos-workflow-7e"')||!adminHtml.includes('.pos-menu-search')||!adminHtml.includes('.pos-item-grid'))fail('Phase 7E POS menu workflow styling missing');
  if(!adminHtml.includes('.pos-category-rail{display:flex;flex-wrap:wrap')||!adminHtml.includes('.pos-category-rail .pz-chip{flex:0 1 auto'))fail('Release 7G fully visible wrapping POS categories missing');
  if(/\.pos-category-rail\{[^}]*overflow-x\s*:\s*auto/.test(adminHtml))fail('Release 7G POS categories must not require horizontal scrolling');
  if(!posSource.includes("id=\"posMenuSearch\"")||!posSource.includes("type=\"button\" class=\"pz-chip"))fail('Phase 7E search or accessible categories missing');
  if(!posSource.includes('No matching items'))fail('Phase 7E directed menu-search empty state missing');
  if(!posSource.includes('Tap items to add them.')||!posSource.includes('>remove</button>')||!posSource.includes('repeat(auto-fill,minmax(78px,1fr))'))fail('Release 7G original register card is incomplete');
  for(const rejectedMarker of ['pos-ticket-head','pos-order-rail','pos-line-stepper','pos-cart-empty','pos-denom-grid'])if(posSource.includes(rejectedMarker))fail(`Rejected register redesign marker remains: ${rejectedMarker}`);
  const backofficeCss=fs.readFileSync(path.join(root,'assets','css','admin-backoffice.css'),'utf8');
  if(!adminHtml.includes('/assets/css/admin-backoffice.css')||!precache.includes('/assets/css/admin-backoffice.css'))fail('Phase 7F back-office visual system is not linked and precached');
  for(const marker of ['--bo-walnut','#adminWorkspaceHeader:before','.pz-tbl th','.badge-pending','prefers-reduced-motion'])if(!backofficeCss.includes(marker))fail(`Phase 7F visual-system marker missing: ${marker}`);
  for(const marker of ['.order-card-actions','.order-payment-summary','.order-payment-state.pending'])if(!backofficeCss.includes(marker))fail(`Release 7G order-card containment marker missing: ${marker}`);
  if(!workspaceShellSource.includes('dataset.adminWorkspace')||!workspaceShellSource.includes('dataset.adminArea')||!workspaceShellSource.includes('operations:System health'))fail('Phase 7F domain ledger rail or System Health shortcut missing');
  const overviewCommandSource=fs.readFileSync(path.join(root,'assets','js','admin','overview-command.mjs'),'utf8');
  const moduleLoaderSource=fs.readFileSync(path.join(root,'assets','js','admin','module-loader.js'),'utf8');
  if(!adminHtml.includes('id="overviewCommandCenter"')||!adminHtml.includes('assets/js/admin/overview-command.mjs'))fail('Phase 7G Overview Command Center is not mounted');
  for(const marker of ['getOperationalExceptions','AccazaOfflineQueue.summary','__accazaLoadAdminModule','Service is clear','data-occ-route','MutationObserver'])if(!overviewCommandSource.includes(marker))fail(`Phase 7G command-center marker missing: ${marker}`);
  if(!moduleLoaderSource.includes('window.__accazaLoadAdminModule=load'))fail('Phase 7G offline-queue on-demand loader is missing');
  for(const marker of ['.occ-brief','.occ-signal-grid','.occ-control-list'])if(!backofficeCss.includes(marker))fail(`Phase 7G command-center visual marker missing: ${marker}`);
  if(!precache.includes('/assets/js/admin/overview-command.mjs'))fail('Phase 7G Overview Command Center is not precached');

  const fn=spawnSync(process.execPath,['--check',path.join(root,'functions','index.js')],{encoding:'utf8'});
  if(fn.status!==0)fail(`functions/index.js failed syntax check:\n${fn.stderr||fn.stdout}`);
  const orderStatusCheck=spawnSync(process.execPath,[path.join(root,'tests','order-status-command-check.mjs')],{encoding:'utf8',cwd:root});
  if(orderStatusCheck.status!==0)fail(`Phase 7A order-status command checks failed:\n${orderStatusCheck.stderr||orderStatusCheck.stdout}`);
  const operationalExceptionsCheck=spawnSync(process.execPath,[path.join(root,'tests','operational-exceptions-check.mjs')],{encoding:'utf8',cwd:root});
  if(operationalExceptionsCheck.status!==0)fail(`Phase 7B operational exception checks failed:\n${operationalExceptionsCheck.stderr||operationalExceptionsCheck.stdout}`);
  const managerApprovalCheck=spawnSync(process.execPath,[path.join(root,'tests','manager-approval-claim-check.mjs')],{encoding:'utf8',cwd:root});
  if(managerApprovalCheck.status!==0)fail(`Privileged approval claim checks failed:\n${managerApprovalCheck.stderr||managerApprovalCheck.stdout}`);

  const pricing=spawnSync(process.execPath,[path.join(root,'tests','order-pricing-check.mjs')],{encoding:'utf8',cwd:root});
  if(pricing.status!==0)fail(`server pricing checks failed:\n${pricing.stderr||pricing.stdout}`);
  const proofCheck=spawnSync(process.execPath,[path.join(root,'tests','payment-proof-check.mjs')],{encoding:'utf8',cwd:root});
  if(proofCheck.status!==0)fail(`payment-proof checks failed:\n${proofCheck.stderr||proofCheck.stdout}`);
  const activeOrdersCheck=spawnSync(process.execPath,[path.join(root,'tests','active-orders-check.mjs')],{encoding:'utf8',cwd:root});
  if(activeOrdersCheck.status!==0)fail(`active-order checks failed:\n${activeOrdersCheck.stderr||activeOrdersCheck.stdout}`);
  const moduleLoaderCheck=spawnSync(process.execPath,[path.join(root,'tests','module-loader-check.mjs')],{encoding:'utf8',cwd:root});
  if(moduleLoaderCheck.status!==0)fail(`Release 2D module-loader checks failed:\n${moduleLoaderCheck.stderr||moduleLoaderCheck.stdout}`);
  const inventoryLedgerCheck=spawnSync(process.execPath,[path.join(root,'tests','inventory-ledger-check.mjs')],{encoding:'utf8',cwd:root});
  if(inventoryLedgerCheck.status!==0)fail(`Release 3A inventory-ledger checks failed:\n${inventoryLedgerCheck.stderr||inventoryLedgerCheck.stdout}`);
  const costingEngineCheck=spawnSync(process.execPath,[path.join(root,'tests','costing-engine-check.mjs')],{encoding:'utf8',cwd:root});
  if(costingEngineCheck.status!==0)fail(`Release 3B costing-engine checks failed:\n${costingEngineCheck.stderr||costingEngineCheck.stdout}`);
  const financialLedgerCheck=spawnSync(process.execPath,[path.join(root,'tests','financial-ledger-check.mjs')],{encoding:'utf8',cwd:root});
  if(financialLedgerCheck.status!==0)fail(`Release 3C financial-ledger checks failed:\n${financialLedgerCheck.stderr||financialLedgerCheck.stdout}`);
  const checkoutWorkflowCheck=spawnSync(process.execPath,[path.join(root,'tests','checkout-workflows-check.mjs')],{encoding:'utf8',cwd:root});
  if(checkoutWorkflowCheck.status!==0)fail(`Release 6B checkout workflow checks failed:\n${checkoutWorkflowCheck.stderr||checkoutWorkflowCheck.stdout}`);
  const offlineRecoveryCheck=spawnSync(process.execPath,[path.join(root,'tests','offline-sync-recovery-check.mjs')],{encoding:'utf8',cwd:root});
  if(offlineRecoveryCheck.status!==0)fail(`Release 6B offline recovery checks failed:\n${offlineRecoveryCheck.stderr||offlineRecoveryCheck.stdout}`);

  console.log(`PASS: ${checked} executable HTML and external scripts parsed successfully.`);
  console.log('PASS: customer-field rendering containment checks passed.');
  console.log('PASS: database rule structure and Release 1A limits are present.');
  console.log('PASS: Release 1B authentication and role-enforcement guards are present.');
  console.log('PASS: Release 1C server-pricing and customer-ownership guards are present.');
  process.stdout.write(pricing.stdout);
  process.stdout.write(proofCheck.stdout);
  process.stdout.write(activeOrdersCheck.stdout);
  process.stdout.write(moduleLoaderCheck.stdout);
  process.stdout.write(inventoryLedgerCheck.stdout);
  process.stdout.write(costingEngineCheck.stdout);
  process.stdout.write(financialLedgerCheck.stdout);
  process.stdout.write(checkoutWorkflowCheck.stdout);
  process.stdout.write(offlineRecoveryCheck.stdout);
  process.stdout.write(operationalExceptionsCheck.stdout);
  process.stdout.write(managerApprovalCheck.stdout);
  console.log('PASS: functions/index.js syntax is valid.');
}finally{
  fs.rmSync(temp,{recursive:true,force:true});
}
