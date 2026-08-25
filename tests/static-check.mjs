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
  if(!adminSource.includes("purchaseInvoices:{field:'ts',limit:250,page:250}")||!adminSource.includes("purchases:['purchaseInvoices','stockReceipts','inventoryMovements']")||!adminSource.includes("purchaseInvoices:['purchases']"))fail('Purchase invoices are not attached and paginated in the Purchases workspace');
  if(!fs.readFileSync(path.join(root,'database.rules.json'),'utf8').includes('"purchaseInvoices":     { ".indexOn": "ts"'))fail('Purchase invoice history query index is missing');
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
  if(rulesRaw.includes("data.child('ownerUid').val() === auth.uid || !data.hasChild('ownerUid')"))fail('legacy ownerless orders are still readable by arbitrary signed-in customers');
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
  if(!functionsSource.includes('exports.autoCompleteReadyOnlineOrders = onSchedule')||!functionsSource.includes('READY_AUTO_COMPLETE_MS = 2 * 60 * 60 * 1000')||!functionsSource.includes('completionReason: "ready_timeout"'))fail('Two-hour Ready-order fallback is incomplete');
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
  if(!functionsSource.includes('exports.syncPublicOrderStatus = onValueWritten')||!functionsSource.includes('ref("/publicOrderStatus").set({acceptingOrders'))fail('public order availability projection missing');
  if(!customerSource.includes("ref(db,'publicOrderStatus')")||!customerSource.includes("OPEN FOR ONLINE ORDERS")||!customerHtml.includes('id="orderServiceStatus"'))fail('customer online-order status banner missing');
  if(!customerHtml.includes('orderStatusGreenBlink 1.15s step-end infinite')||!customerHtml.includes('orderStatusRedBlink 1.15s step-end infinite'))fail('customer order status dots are not configured to blink');
  if(!customerSource.includes("'Checking order availability…':'Online Orders Closed'")||!customerHtml.includes('disabled aria-disabled="true">Checking order availability'))fail('Place Order is not safely disabled while online ordering is closed or unknown');
  if(!customerSource.includes("publicOrdersOpen=null,customerLiveConnected=null")||!customerSource.includes("'CHECKING ORDER AVAILABILITY'")||!customerHtml.includes('id="orderServiceHeadline">CHECKING ORDER AVAILABILITY'))fail('Customer startup can still misreport an unknown live status as closed');
  if(!functionsSource.includes('if (!shift || shift.status === "closed") throw new HttpsError("failed-precondition", "Online orders are closed right now.'))fail('server does not reject online orders without an open shift');
  if(!rulesRaw.includes('"publicOrderStatus": { ".read": true, ".write": false }'))fail('public order status rules missing');
  if(!functionsSource.includes('[`activeOrders/${orderId}`]: activeOrderProjection(order)'))fail('online orders do not enter the live projection atomically');
  if(!functionsSource.includes('Costing.costOrder({'))fail('Release 3B server-authoritative costing engine is not used at finalization');
  if(!functionsSource.includes('exports.validateRecipeDefinition = onCall'))fail('Release 3B server recipe validator missing');
  if(!functionsSource.includes('cogsDetail: {'))fail('Release 3B traceable COGS snapshot missing');
  if(!adminSource.includes("'validateRecipeDefinition'")||!adminSource.includes('validateRecipeDefinition:validateRecipeDefinitionCall'))fail('admin recipe save is not connected to the server validator');
  if(!adminSource.includes('Costing().normalizeRecipe(raw,inventoryMap)'))fail('admin recipe save does not run shared normalization');
  for(const marker of ['exports.postFinancialCommand = onCall','exports.settlePlatformPayout = onCall','exports.processOrderAdjustment = onCall','exports.ensureFinancialLedger = onCall','exports.ensureBooksJournal = onCall','exports.onOrderFinancialPosting = onValueWritten','exports.preservePostedOrderOnDelete = onValueDeleted'])if(!functionsSource.includes(marker))fail(`Release 3C server marker missing: ${marker}`);
  for(const marker of ['action === "inventory_opening_balance"','inventoryReconciliations/openingBalance','expectedDifference','movementId="inventory_opening_balance"'])if(!functionsSource.includes(marker))fail(`Inventory opening-balance control missing: ${marker}`);
  if(adminSource.includes('function reconcileAuto()'))fail('retired browser-authored financial reconciliation still exists');
  if(!adminSource.includes("'postFinancialCommand'")||!adminSource.includes("'settlePlatformPayout'")||!adminSource.includes('postFinancialCommand:postFinancialCommandCall'))fail('Release 3C callable bridge missing');
  for(const node of ['financialMovements','cfLedger','receivables','payables','platformPayouts'])if(!rulesRaw.includes(`"${node}"`))fail(`Release 3C rules missing ${node}`);
  if(!rulesRaw.includes('"financialMovements": { ".indexOn": "occurredAt"')||!rulesRaw.includes('"cfLedger":')||!rulesRaw.includes('"platformPayouts":'))fail('Release 3C financial projections are not declared');
  for(const marker of ['exports.createManagerApproval = onCall','exports.consumeManagerApproval = onCall','exports.manageChartAccount = onCall','exports.auditFinancialControls = onCall','exports.onShiftOpenFinancial = onValueWritten'])if(!functionsSource.includes(marker))fail(`Release 3D server marker missing: ${marker}`);
  for(const marker of ['resolvedPaymentMappings=new Set()','m.type==="payment_account_reclassification"','if(!resolved)issues.push'])if(!functionsSource.includes(marker))fail(`Resolved payment-mapping audit marker missing: ${marker}`);
  for(const node of ['financialApprovals','chartOfAccounts','cashCustody'])if(!rulesRaw.includes(`"${node}"`))fail(`Release 3D rules missing ${node}`);
  if(!adminSource.includes("'createManagerApproval'")||!adminSource.includes('callables.createManagerApproval')||!adminSource.includes('inMemoryPersistence'))fail('Release 3D independent Firebase manager approval is missing');
  if(!adminSource.includes('authz&&authz.isPrivileged&&current')||!adminSource.includes("['owner','superadmin','admin','manager'].indexOf(effectiveRole)>-1"))fail('Release 7G privileged Admin approval path is missing');
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
  if(!adminCoreItem||Buffer.byteLength(adminCoreItem.source,'utf8')>126000)fail('Phase 4C core module has regrown beyond the 126 KB guard');
  const firebaseImportOwners=adminScripts.filter(item=>item.source.includes('gstatic.com/firebasejs')).map(item=>item.name);
  if(firebaseImportOwners.length!==1||firebaseImportOwners[0]!=='firebase-client.mjs')fail('Firebase SDK imports must be centralized in firebase-client.mjs');
  for(const item of adminScripts){for(const match of item.source.matchAll(/from["']\.\/([^"']+)["']/g)){if(!fs.existsSync(path.join(root,'assets','js','admin',match[1])))fail(`${item.name} imports missing local module ${match[1]}`);}}
  if(adminSource.includes("remove(ref(db,'archivedOrders/'")||adminSource.includes("a.update(a.ref(a.db,'discrepancies/'+id)"))fail('Release 3E retired browser authority remains');
  if(!rulesRaw.includes('"archivedOrders":')||!rulesRaw.includes('"operationalAudit":')||!rulesRaw.includes('"deletionAudit":'))fail('Release 3E controlled archive/audit rules missing');

  const storageRules=fs.readFileSync(path.join(root,'storage.rules'),'utf8');
  if(!storageRules.includes('allow read, write: if false'))fail('Storage is not locked to server-only access');
  const firebaseConfig=JSON.parse(fs.readFileSync(path.join(root,'firebase.json'),'utf8'));
  if(!firebaseConfig.storage||firebaseConfig.storage.rules!=='storage.rules')fail('Storage rules are not wired into Firebase deployment');
  if(firebaseConfig.hosting)fail('Firebase Hosting must not be configured while production is published by GitHub Pages');

  const pagesConfig=fs.readFileSync(path.join(root,'_config.yml'),'utf8');
  for(const privatePath of ['functions','database.rules.json','storage.rules','firebase.json','release-manifest.json']){
    if(!pagesConfig.includes(`- ${privatePath}`))fail(`GitHub Pages exclusion missing: ${privatePath}`);
  }
  const deployWorkflow=fs.readFileSync(path.join(root,'.github','workflows','deploy-functions.yml'),'utf8');
  if(!deployWorkflow.includes('branches: [main]'))fail('production Firebase deployment is not restricted to main');
  const forcedDeployLines=deployWorkflow.split(/\r?\n/).filter(line=>line.includes('firebase deploy')&&line.includes('--force'));
  if(forcedDeployLines.length!==1||!forcedDeployLines[0].includes('--only functions:preservePostedOrderOnDelete '))fail('production Firebase deployment may silently delete functions');
  if(!deployWorkflow.includes('concurrency:')||!deployWorkflow.includes('environment: production'))fail('production Firebase deployment safeguards are incomplete');
  if(/actions\/(?:checkout|setup-node|setup-java)@v4/.test(deployWorkflow))fail('Firebase deployment workflow still uses deprecated Node 20-based actions');
  const qualityWorkflow=fs.readFileSync(path.join(root,'.github','workflows','quality-gate.yml'),'utf8');
  if(/actions\/(?:checkout|setup-node|setup-java)@v4/.test(qualityWorkflow))fail('quality workflow still uses deprecated Node 20-based actions');
  if(adminHtml.includes("document.querySelector('.admin-tab:nth-child(3)')"))fail('reservation navigation still depends on fragile DOM position');
  if(!adminHtml.includes("openAdminWorkspaceTab('reservations')"))fail('reservation banner is not routed through the named workspace navigator');

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
  const editItemSource=(posSource.match(/function editIngredient\(id\)\{[\s\S]*?\/\* Brand breakdown/)||[])[0]||'';
  for(const marker of ['Stock item master','Item details','Inventory control','Actual cost · weighted average','Planning cost','Consumption rule','Adjust stock','Save changes'])if(!editItemSource.includes(marker))fail(`Stock Items professional edit-card marker missing: ${marker}`);
  if(editItemSource.includes('id="eiStock"')||editItemSource.includes('id="eiCost"')||editItemSource.includes('postMovements(['))fail('Stock Items edit card can still override ledger-controlled stock or actual WAC');
  if(!offlineQueueSource.includes("indexedDB.open(DB_NAME,DB_VERSION)")||!offlineQueueSource.includes("keyPath:'id'")||!offlineQueueSource.includes("status:'pending'"))fail('Phase 5B durable IndexedDB transaction queue missing');
  if(!posSource.includes("if(!pending){alert('Nothing to sync.');return;}")||posSource.includes("'Nothing to sync'),__dis"))fail('Empty transaction sync queue action is not clickable with clear feedback');
  for(const state of ["'pending'","'syncing'","'failed'","'synced'"])if(!offlineQueueSource.includes(state))fail(`Phase 5B queue state missing: ${state}`);
  if(!offlineQueueSource.includes('function compactSynced()')||!offlineQueueSource.includes('function isQuotaError(error)')||!offlineQueueSource.includes('function storageHealth()'))fail('POS durable storage quota recovery or health check is missing');
  if(!posSource.includes('function persistPosSale(o)')||!posSource.includes("saved.mode==='server'?'sale-server-recovered':'sale-queued'")||!posSource.includes('transactionId:o.clientTxnId'))fail('POS quota failure does not have an idempotent online server recovery path');
  if(posSource.includes("localStorage.getItem('accaza_offline_orders')")||posSource.includes("writes['orders/'+o.id]"))fail('Phase 5B retired localStorage/direct-write queue remains in POS');
  if(!posSource.includes("clientTxnId:txnId")||posSource.includes('PENDING SYNC — Firebase confirmation not yet received')||posSource.includes('receipt._syncPending'))fail('POS receipt exposes internal synchronization status to the customer');
  if(!offlineQueueSource.includes("removeIds([row.id]).catch(function(){return patch(row.id,{status:'synced'")||!offlineQueueSource.includes('return chain.then(function(){return compactSynced()'))fail('Firebase-confirmed or legacy synced POS transactions are not removed automatically from the device queue');
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
  if(!operationsSource.includes('View system health')||!operationsSource.includes('operationsSystemHealth')||!operationsSource.includes("scrollIntoView({behavior:'smooth'"))fail('Operations self-route does not move to System Health');
  if(!operationsSource.includes('Database backup:')||!operationsSource.includes('systemHealth/backups/latest')||!functionsSource.includes('/systemHealth/backups/latest'))fail('Backup freshness is not published and displayed in System Health');
  const firebaseDeployWorkflow=fs.readFileSync(path.join(root,'.github','workflows','deploy-functions.yml'),'utf8');
  if(!firebaseDeployWorkflow.includes('playwright install --with-deps chromium')||firebaseDeployWorkflow.indexOf('playwright install --with-deps chromium')>firebaseDeployWorkflow.indexOf('npm run test:ci'))fail('Firebase deployment workflow must install Chromium before the browser quality gate');
  if(!operationsSource.includes('Operations service is restarting after the billing update')||!operationsSource.includes('opsRetryNow')||!operationsSource.includes('functions/unavailable'))fail('Operations Center transient service recovery is not handled');
  for(const marker of ['pos_boot','cart_render','charge_to_durable','offline_flush','realtime_order_arrival'])if(!operationsSource.includes(marker))fail(`Phase 6C performance threshold missing: ${marker}`);
  const swCacheVersion=JSON.parse(fs.readFileSync(path.join(root,'release-manifest.json'),'utf8')).builds.serviceWorkerCache;
  if(!precache.includes('/assets/js/admin/operations-dashboard.js')||!swSource.includes(`const CACHE='accaza-v${swCacheVersion}'`))fail('Phase 6C/7H dashboard is not in the coordinated offline cache');
  const analyticsSource=fs.readFileSync(path.join(root,'assets','js','admin','analytics.js'),'utf8');
  if(!analyticsSource.includes('build(payouts,shiftRows,chan,byMethod,items,txns,refundsTot,netTot,sales)')||!analyticsSource.includes('function build(payouts,shiftRows,chan,byMethod,items,txns,refundsTot,netTot,sales)'))fail('Daily Report renderer is missing calculated report inputs');
  if(!analyticsSource.includes('class="dr-summary"')||!analyticsSource.includes('data-dr-target="drChannels"')||!analyticsSource.includes("scrollIntoView({behavior:'smooth',block:'center'})"))fail('Daily Report summary navigation is incomplete');

  const orderAdminSource=fs.readFileSync(path.join(root,'assets','js','admin','admin-orders.mjs'),'utf8');
  const orderStatusSource=fs.readFileSync(path.join(root,'functions','lib','order-status.js'),'utf8');
  if(!functionsSource.includes('exports.updateOrderStatus = onCall')||!functionsSource.includes('OrderStatus.updateOrderStatusCommand'))fail('Phase 7A server order-status command missing');
  if(!functionsSource.includes('"cashier", "kitchen", "finance"'))fail('Phase 7A kitchen portal role is not recognized server-side');
  if(!orderAdminSource.includes('callables.updateOrderStatus')||/update\(ref\(db,'orders\/'/.test(orderAdminSource))fail('Phase 7A admin status mutations are not server-routed');
  if(!orderAdminSource.includes('Object.entries(deps.getOrders())')||!orderAdminSource.includes('orderCardHtml(entry[1],entry[0])')||!orderAdminSource.includes('orderStatusCtl(o,orderKey)'))fail('Admin order actions do not preserve the authoritative database order key');
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
  if(!workspaceShellSource.includes("subscriptionHub.subscribe('posActiveShift'")||!workspaceShellSource.includes('window.__posShift=snapshot')||!adminSource.includes('subscriptionHub:subscriptionHub'))fail('Workspace status does not own an always-live shift subscription');
  const shiftRegisterSource=fs.readFileSync(path.join(root,'assets','js','admin','register.js'),'utf8');
  if(!shiftRegisterSource.includes('window.__refreshWorkspaceStatus()')||!shiftRegisterSource.includes('window.__refreshOverviewCommand()'))fail('Register shift updates do not refresh shared status consumers');
  if(!shiftRegisterSource.includes("a.get(a.ref(a.db,'archivedOrders'))")||!shiftRegisterSource.includes("o.status==='Archived'")||!shiftRegisterSource.includes("o.prevStatus==='Completed'"))fail('Closed-shift transaction details do not include archived completed sales');
  for(const marker of ["fixed_float_exception","floatMode:fixedMode?'fixed':'opening-count'",'zReport:snapshot','Review live cash','View final Z-report','writes.posActiveShift=null','legacyReport'])if(!shiftRegisterSource.includes(marker))fail(`Adaptive fixed-float/Z-report control missing: ${marker}`);
  for(const marker of ['loadShiftTransactions(shift.id)','Total by channel','Total by payment method','Total sales this shift','Total cash counted'])if(!shiftRegisterSource.includes(marker))fail(`Z-report completeness control missing: ${marker}`);
  if(!functionsSource.includes('Math.max(0,Number(shift.cashToSettle)||0)')||!functionsSource.includes('retainedFloat:Financial.money(shift.retainedFloat)'))fail('Shift custody does not preserve retained float and remit only cash to settle');
  if(!precache.includes('/assets/js/admin/workspace-shell.mjs'))fail('Phase 7D workspace shell is not precached');
  if(!adminHtml.includes('id="accaza-pos-workflow-7e"')||!adminHtml.includes('.pos-menu-search')||!adminHtml.includes('.pos-item-grid'))fail('Phase 7E POS menu workflow styling missing');
  if(!adminHtml.includes('.pos-category-rail{display:flex;flex-wrap:wrap')||!adminHtml.includes('.pos-category-rail .pz-chip{flex:0 1 auto'))fail('Release 7G fully visible wrapping POS categories missing');
  if(/\.pos-category-rail\{[^}]*overflow-x\s*:\s*auto/.test(adminHtml))fail('Release 7G POS categories must not require horizontal scrolling');
  if(!posSource.includes("id=\"posMenuSearch\"")||!posSource.includes("type=\"button\" class=\"pz-chip"))fail('Phase 7E search or accessible categories missing');
  if(!posSource.includes('No matching items'))fail('Phase 7E directed menu-search empty state missing');
  for(const marker of ['Online Orders','onlineOrderRows()','data-online-accept','acceptOnlineOrder({orderId:id})','New website orders will appear here automatically.'])if(!posSource.includes(marker))fail(`Online Orders POS channel marker missing: ${marker}`);
  for(const marker of ['🧾 Shift Orders','shiftOrderRows()','renderActiveOrders()','data-active-status','pos-stage-rail','Completed sales this shift'])if(!posSource.includes(marker)&&!adminHtml.includes(marker))fail(`Shift Orders POS workflow marker missing: ${marker}`);
  for(const marker of ['posOrderItemsHtml(o)','pos-order-items-heading','pos-order-item-qty','li.options.map(esc).join'])if(!posSource.includes(marker)&&!adminHtml.includes(marker))fail(`POS itemized order-card marker missing: ${marker}`);
  if(!posSource.includes("function verifyOnlinePayment(oid,button)")||!posSource.includes("action:'cashier_verify_payment'")||!posSource.includes("verifyOnlinePayment(b.getAttribute('data-online-verify'),b)"))fail('POS cashier payment verification is not self-contained');
  if(!posSource.includes("function renderPosCart(options)")||!posSource.includes("if(!(options&&options.fresh))capturePosDraft(p)")||!posSource.includes("posScopedDisc=[]; renderPosCart({fresh:true}); showReceipt(receipt)"))fail('Completed POS sales can restore stale customer, platform reference, or discount fields');
  if(functionsSource.includes('statusUpdatedAt: nextStatus !== o.status ? now : o.statusUpdatedAt')||!functionsSource.includes('if (nextStatus !== o.status) { validated.statusUpdatedAt = now; validated.statusUpdatedBy = actor.uid; }'))fail('Payment validation can send undefined legacy status metadata to Firebase');
  for(const marker of ['posPaymentVerification=null','paymentVerificationSignature(payments,total)',"button.textContent='Cashier Verify Payment'",'posPaymentVerification.signature===signature','Payment verified · complete the sale when ready',"policy==='manager_only'"])if(!posSource.includes(marker))fail(`Configurable direct-payment verification marker missing: ${marker}`);
  if(posSource.includes("if(window.__posVerify)window.__posVerify(b.getAttribute('data-online-verify'))"))fail('POS Verify payment can still silently no-op when the register module is unloaded');
  if(!posSource.includes("o.channel==='online'&&!o.voided&&['Pending','Confirmed','Preparing','Ready'].indexOf(o.status)>=0")||!posSource.includes("posView==='active'"))fail('Shift Orders action queue is not restricted to actionable online orders');
  if(!posSource.includes("['Completed','Received'].indexOf(o.status)>=0")||!posSource.includes('salesTotal=completed.reduce')||!posSource.includes('Not included in sales'))fail('Shift Orders does not retain completed sales or exclude voided/rejected totals');
  if(!functionsSource.includes('exports.acceptOnlineOrder = onCall')||!functionsSource.includes('accept_online_order')||!functionsSource.includes('posCaptured: true'))fail('Online order shift-acceptance authority is incomplete');
  if(!shiftRegisterSource.includes('online:0')||!shiftRegisterSource.includes("['online','Online Orders']")||!shiftRegisterSource.includes("['Completed','Received'].indexOf(o.status)<0"))fail('Online Orders are not separated or finalized correctly in shift reporting');
  if(!posSource.includes('Tap items to add them.')||!posSource.includes('>remove</button>')||!posSource.includes('repeat(auto-fill,minmax(78px,1fr))'))fail('Release 7G original register card is incomplete');
  for(const rejectedMarker of ['pos-ticket-head','pos-order-rail','pos-line-stepper','pos-cart-empty','pos-denom-grid'])if(posSource.includes(rejectedMarker))fail(`Rejected register redesign marker remains: ${rejectedMarker}`);
  const backofficeCss=fs.readFileSync(path.join(root,'assets','css','admin-backoffice.css'),'utf8');
  const adminOrdersSource=fs.readFileSync(path.join(root,'assets','js','admin','admin-orders.mjs'),'utf8');
  const paymentVerificationSource=fs.readFileSync(path.join(root,'functions','lib','payment-verification.js'),'utf8');
  if(!adminOrdersSource.includes("Use POS → Online Orders to accept into shift")||!orderStatusSource.includes('Cashier verification and POS shift acceptance are required'))fail('Uncaptured website orders can bypass cashier verification or POS shift capture');
  const packagesSource=fs.readFileSync(path.join(root,'assets','js','admin','packages.js'),'utf8');
  if(!adminHtml.includes('/assets/css/admin-backoffice.css')||!precache.includes('/assets/css/admin-backoffice.css'))fail('Phase 7F back-office visual system is not linked and precached');
  for(const marker of ['--bo-walnut','#adminWorkspaceHeader:before','.pz-tbl th','.badge-pending','prefers-reduced-motion'])if(!backofficeCss.includes(marker))fail(`Phase 7F visual-system marker missing: ${marker}`);
  for(const marker of ['.order-card-actions','.order-payment-summary','.order-payment-state.pending'])if(!backofficeCss.includes(marker))fail(`Release 7G order-card containment marker missing: ${marker}`);
  if(!adminSource.includes("ordersList.style.removeProperty('display')")||adminSource.includes("ordersList').style.display=archivePanelOpen?'none':'block'"))fail('Returning from the order archive must restore the responsive active-order grid');
  for(const marker of ['function orderItemsHtml(o)','order-item-list','order-item-qty','order-item-detail'])if(!adminOrdersSource.includes(marker)&&!backofficeCss.includes(marker))fail(`Active-order item-list marker missing: ${marker}`);
  for(const marker of ['cashier_manager','manager_only','paymentVerificationPolicy'])if(!adminSource.includes(marker)||!(functionsSource+'\n'+paymentVerificationSource).includes(marker))fail(`Payment verification policy marker missing: ${marker}`);
  for(const marker of ['CASHIER_MANAGER','MANAGER_ONLY','directPaymentRows','paymentPolicy'])if(!paymentVerificationSource.includes(marker))fail(`Server payment verification authority marker missing: ${marker}`);
  if(adminSource.includes('Cashier Final Verification')||adminSource.includes('cashier_final'))fail('Unsafe cashier-final verification option must not be exposed');
  if(!packagesSource.includes('class="pkg-recipe-list"')||!backofficeCss.includes('.pkg-recipe-list{display:flex;flex-wrap:wrap')||packagesSource.includes('max-height:120px;overflow:auto'))fail('Package recipe selector must show every recipe without a nested scrollbar');
  for(const marker of ["subscribe('inventorySku'",'recipeUsesInventory','Recipe items without approved brand','purchase-sku-cell','Select an active approved brand','skuId:skuId','lines:invoiceLines'])if(!posSource.includes(marker))fail(`Release 7H SKU/brand integrity marker missing: ${marker}`);
  for(const marker of ['function openSkuManager(id,onUse)','data-skuse','Use this brand','data-pmanage-line','selected for this purchase'])if(!posSource.includes(marker))fail(`Purchase approved-brand handoff marker missing: ${marker}`);
  if(!posSource.includes("ln.ing&&!skus.length?'<button")||!posSource.includes('>Add an approved brand</button>'))fail('Brandless purchase lines cannot add an approved brand directly');
  if(!posSource.includes("uNorm(sk.brand)===uNorm(brand)"))fail('Approved-brand manager does not prevent duplicate brand names');
  for(const marker of ['reconcilePurchasePayable','Repair missing payable',"rid='rcpt_'+invoiceId+'_'+lineIndex","bid='bat_'+invoiceId+'_'+lineIndex","P.pay==='account'||P.pay==='pending'"])if(!posSource.includes(marker)&&!functionsSource.includes(marker))fail(`Purchase/payable reconciliation marker missing: ${marker}`);
  const financeSource=fs.readFileSync(path.join(root,'assets','js','admin','finance.js'),'utf8');
  for(const marker of ['function openPayableDetail(id)','data-apdetail','<th>Reference</th>','data-apreverse','Inventory liabilities are created only from Purchases'])if(!financeSource.includes(marker))fail(`Payables control/detail marker missing: ${marker}`);
  if(!financeSource.includes('>Details</button>')||financeSource.includes('<tr data-apdetail=')||financeSource.includes('Click a row for details'))fail('Payable details must use a dedicated button instead of a clickable row');
  if(financeSource.includes('background:var(--pw)'))fail('Payable details panel still uses an undefined transparent background token');
  if(financeSource.includes('<option>inventory</option>'))fail('Manual Payables entry still offers inventory as a type');
  if(!financeSource.includes("filter(function(x){return !x.status||x.status==='open';})"))fail('Reversed payables can still appear in Open Payables');
  if(!functionsSource.includes('Inventory payables must be created from Purchases'))fail('Server does not block manually created inventory payables');
  for(const marker of ['exports.managePurchaseCorrection = onCall','purchase_reversal','reverse_purchase','Not enough remaining stock to reverse'])if(!functionsSource.includes(marker))fail(`Purchase correction authority missing: ${marker}`);
  for(const marker of ['Invoice pending — provisional obligation','purchaseHistoryHtml','data-purchase-details','data-purchase-finalize','data-purchase-link'])if(!posSource.includes(marker))fail(`Purchase review/GRNI UI marker missing: ${marker}`);
  for(const marker of ['inventory_pending_invoice','grni_created','purchase_grni_finalize_','liability:grni:'])if(!functionsSource.includes(marker))fail(`Purchase GRNI authority missing: ${marker}`);
  if(!functionsSource.includes('Finalize the supplier invoice before paying this provisional obligation')||!financeSource.includes('Finalize invoice first'))fail('Provisional purchase obligations can still be paid before invoice finalization');
  for(const marker of ['data-purchase-link','data-purchase-repair','data-purchase-duplicate','Purchase ID:'])if(!posSource.includes(marker))fail(`Purchase record repair control missing: ${marker}`);
  for(const marker of ['linkPayableId','link_existing_purchase_payable','Another purchase already claims this payable','orphanAccount'])if(!functionsSource.includes(marker))fail(`Server purchase-link/duplicate guard missing: ${marker}`);
  for(const marker of ['keepInvoiceId','duplicateCleanup','reverse_duplicate_purchase','purchase_ap_repair'])if(!functionsSource.includes(marker))fail(`Shared-payable duplicate recovery missing: ${marker}`);
  if(!posSource.includes('keepInvoiceId:keepId,duplicate:true')||!posSource.includes('If its shared payable had already been reversed'))fail('Duplicate-pair reversal does not preserve the selected surviving purchase');
  if(!posSource.includes('showReversedPurchases||!p.reversed')||!posSource.includes('data-purchase-toggle-reversed'))fail('Reversed purchases are not hidden by default with an audit-history toggle');
  for(const marker of ['Correct purchase details','Reverse &amp; re-enter',"managerApproval('reverse_purchase'",'correctedPurchaseDraft(inv)'])if(!posSource.includes(marker))fail(`Purchase correction interface missing: ${marker}`);
  if(!posSource.includes("recipeItem:true")||!posSource.includes('Used in recipes')||!posSource.includes("seededFrom:'purchase'"))fail('Release 7H new recipe-item SKU creation is incomplete');
  if(!backofficeCss.includes('.inv-sku-link.linked')||!backofficeCss.includes('.purchase-sku-cell.required'))fail('Release 7H SKU linkage states are not visibly distinguished');
  for(const marker of ['SKU / stock item','✓ Recipe · SKU ready','Add brand','Brands ('])if(!posSource.includes(marker))fail(`Inventory SKU/brand language is incomplete: ${marker}`);
  if(posSource.includes('Recipe · no SKU')||posSource.includes('Recipe items without SKU'))fail('Inventory still incorrectly describes its common stock items as missing SKUs');
  const inventoryRenderBlock=section(posSource,'function renderInventory()','/* ══════════ INVENTORY ARCHITECTURE v2');
  if(inventoryRenderBlock.includes('data-inv-receive')||inventoryRenderBlock.includes('data-inv-brands')||inventoryRenderBlock.includes('>+ Stock</button>')||inventoryRenderBlock.includes('>History</button>'))fail('Inventory rows still expose retired Stock or History actions');
  if(!posSource.includes('class="inventory-actions-cell"><div class="inventory-actions">')||!backofficeCss.includes('grid-template-columns:112px 72px 58px 42px'))fail('Inventory actions do not use the compact fixed alignment grid');
  var skuRule=rulesRaw.slice(rulesRaw.indexOf('"inventorySku"'),rulesRaw.indexOf('"inventoryBatch"')),batchRule=rulesRaw.slice(rulesRaw.indexOf('"inventoryBatch"'),rulesRaw.indexOf('"purchaseInvoices"'));
  if((skuRule.match(/child\('purchases'\)/g)||[]).length<2||(batchRule.match(/child\('purchases'\)/g)||[]).length<2)fail('Release 7H purchasing permission is missing from inventorySku or inventoryBatch');
  if(!workspaceShellSource.includes('dataset.adminWorkspace')||!workspaceShellSource.includes('dataset.adminArea')||!workspaceShellSource.includes('operations:System health'))fail('Phase 7F domain ledger rail or System Health shortcut missing');
  const overviewCommandSource=fs.readFileSync(path.join(root,'assets','js','admin','overview-command.mjs'),'utf8');
  const moduleLoaderSource=fs.readFileSync(path.join(root,'assets','js','admin','module-loader.js'),'utf8');
  if(!moduleLoaderSource.includes("purchases:['finance','pos']"))fail('Purchases does not preload the finance module before accepting payment terms');
  if(!adminHtml.includes('id="overviewCommandCenter"')||!adminHtml.includes('assets/js/admin/overview-command.mjs'))fail('Phase 7G Overview Command Center is not mounted');
  for(const marker of ['getOperationalExceptions','AccazaOfflineQueue.summary','__accazaLoadAdminModule','Service now','data-occ-route','MutationObserver'])if(!overviewCommandSource.includes(marker))fail(`Phase 7G command-center marker missing: ${marker}`);
  for(const duplicate of ['Morning service','Immediate attention','Work queue','Open full health check'])if(overviewCommandSource.includes(duplicate))fail(`Overview duplicates Operations Center content: ${duplicate}`);
  if(!moduleLoaderSource.includes('window.__accazaLoadAdminModule=load'))fail('Phase 7G offline-queue on-demand loader is missing');
  for(const marker of ['.occ-brief','.occ-signal-grid','.occ-control-list'])if(!backofficeCss.includes(marker))fail(`Phase 7G command-center visual marker missing: ${marker}`);
  if(!precache.includes('/assets/js/admin/overview-command.mjs'))fail('Phase 7G Overview Command Center is not precached');
  if(adminHtml.includes('id="adminServiceUser"')||workspaceShellSource.includes("user.textContent='Role"))fail('Admin status strip still exposes the signed-in role');
  for(const marker of ['adminServiceConnectionLabel','adminServiceCashier','adminServiceQueueNote','admin-status-dot'])if(!adminHtml.includes(marker))fail(`Compact admin status line is missing: ${marker}`);
  if((adminHtml.match(/id="adminServiceStrip"/g)||[]).length!==1||!adminHtml.includes('class="awh-copy"'))fail('Admin status must appear once inside the workspace header');
  if(!workspaceShellSource.includes("' · Cashier '")||!workspaceShellSource.includes("' · Push to sync '")||!workspaceShellSource.includes("' · Push to retry '"))fail('Compact admin status lacks cashier identity or actionable offline-queue guidance');
  if(/\.admin-service-strip\{[^}]*grid-template-columns/.test(adminHtml)||/body\.admin-workspace-focused[^\n]*\.admin-service-strip\{[^}]*display:grid/.test(backofficeCss))fail('Retired full-width status-card banner styling remains');
  const customerReservationSource=fs.readFileSync(path.join(root,'assets','js','customer','core.mjs'),'utf8');
  const adminReservationSource=fs.readFileSync(path.join(root,'assets','js','admin','reservations.mjs'),'utf8');
  for(const id of ['btnAddCat','btnAddItem','btnAddToCart']){
    if(customerReservationSource.includes(`document.getElementById('${id}').addEventListener`))fail(`Customer startup unsafely assumes #${id} exists on every page`);
  }
  for(const id of ['editGcashNum','editGcashName','editBdoNum','editUbNum']){
    if(customerReservationSource.includes(`document.getElementById('${id}').value=`))fail(`Customer payment sync unsafely assumes admin-only #${id} exists`);
  }
  for(const [name,source] of [['customer',customerReservationSource],['admin',adminReservationSource]]){
    if(!source.includes("<button type=\"button\" class=\"'+cls+'\"")||!source.includes('window.selectTimeSlot(this.dataset.slot)'))fail(`${name} reservation slots are not native buttons with an explicit selection handler`);
    if(!source.includes("fw.style.display='block'")||!source.includes("scrollIntoView({behavior:'smooth'"))fail(`${name} reservation selection does not reveal and focus the booking form`);
  }
  if(!customerReservationSource.includes('window.updateBookingType()')||/function\(\)\{selectTimeSlot\(/.test(customerReservationSource))fail('Customer reservation still relies on a fragile implicit module global');
  for(const [name,html] of [['customer',customerHtml],['admin',adminHtml]])if(!html.includes('<button type="button" class="time-slot available" id="fullDaySlot"'))fail(`${name} full-day reservation control is not a native button`);

  if(!financeSource.includes('!p.reversed&&!p.depositMovementId&&Number(p.actualPayout)>0'))fail('Cash Flow must hide reversed, deposited, zero, and negative platform payouts from the deposit queue');
  if(financeSource.includes("e.source==='payout'&&e.linkId===p.id"))fail('Cash Flow still relies on the obsolete payout ledger-source check');
  for(const marker of ["var value=r2(x.opening),d=x.openingDate||from","if(d<=from)beginBank[x.id]","type:'opening_balance',id:'opening_'+x.id"]){if(!financeSource.includes(marker))fail(`Cash Flow statement opening-balance projection is missing: ${marker}`);}
  const cashflowBooksHtml=fs.readFileSync(path.join(root,'books.html'),'utf8');
  for(const marker of ['{id:"cashflow",label:"Cash Flow"}','Authoritative cash statement · moved from Admin','function cfStatement()','openingSources','manageCashAccount','Deposits to record','payout_deposit','cash_deposit'])if(!cashflowBooksHtml.includes(marker)&&!functionsSource.includes(marker)&&!adminHtml.includes(marker))fail(`Books Cash Flow cutover marker missing: ${marker}`);
  for(const marker of ["posSwitchTab('cashflow',this)",'href="books.html?tab=cashflow"','id="tab-cashflow"','id="cashflowRoot"'])if(adminHtml.includes(marker))fail(`Retired Admin Cash Flow UI is still present: ${marker}`);
  for(const marker of ["posSwitchTab('pnl',this)",'id="tab-pnl"','id="pnlRoot"'])if(adminHtml.includes(marker))fail(`Retired Admin P&L UI is still present: ${marker}`);
  for(const marker of ["posSwitchTab('receivables',this)",'id="tab-receivables"','id="receivablesRoot"',"posSwitchTab('payables',this)",'id="tab-payables"','id="payablesRoot"'])if(adminHtml.includes(marker))fail(`Retired Admin AR/AP UI is still present: ${marker}`);

  const fn=spawnSync(process.execPath,['--check',path.join(root,'functions','index.js')],{encoding:'utf8'});
  if(fn.status!==0)fail(`functions/index.js failed syntax check:\n${fn.stderr||fn.stdout}`);
  const orderStatusCheck=spawnSync(process.execPath,[path.join(root,'tests','order-status-command-check.mjs')],{encoding:'utf8',cwd:root});
  if(orderStatusCheck.status!==0)fail(`Phase 7A order-status command checks failed:\n${orderStatusCheck.stderr||orderStatusCheck.stdout}`);
  const operationalExceptionsCheck=spawnSync(process.execPath,[path.join(root,'tests','operational-exceptions-check.mjs')],{encoding:'utf8',cwd:root});
  if(operationalExceptionsCheck.status!==0)fail(`Phase 7B operational exception checks failed:\n${operationalExceptionsCheck.stderr||operationalExceptionsCheck.stdout}`);
  const managerApprovalCheck=spawnSync(process.execPath,[path.join(root,'tests','manager-approval-claim-check.mjs')],{encoding:'utf8',cwd:root});
  if(managerApprovalCheck.status!==0)fail(`Privileged approval claim checks failed:\n${managerApprovalCheck.stderr||managerApprovalCheck.stdout}`);
  const approvalMatrixCheck=spawnSync(process.execPath,[path.join(root,'tests','approval-matrix-check.mjs')],{encoding:'utf8',cwd:root});
  if(approvalMatrixCheck.status!==0)fail(`Privileged approval matrix checks failed:\n${approvalMatrixCheck.stderr||approvalMatrixCheck.stdout}`);

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
  const booksBridgeCheck=spawnSync(process.execPath,[path.join(root,'tests','books-bridge-check.mjs')],{encoding:'utf8',cwd:root});
  if(booksBridgeCheck.status!==0)fail(`Accaza Books POS bridge checks failed:\n${booksBridgeCheck.stderr||booksBridgeCheck.stdout}`);
  const salesAuthorityCheck=spawnSync(process.execPath,[path.join(root,'tests','sales-authority-check.mjs')],{encoding:'utf8',cwd:root});
  if(salesAuthorityCheck.status!==0)fail(`Shared Admin sales-authority checks failed:\n${salesAuthorityCheck.stderr||salesAuthorityCheck.stdout}`);
  const archiveOrderSortCheck=spawnSync(process.execPath,[path.join(root,'tests','archive-order-sort-check.mjs')],{encoding:'utf8',cwd:root});
  if(archiveOrderSortCheck.status!==0)fail(`Archived-order sorting checks failed:\n${archiveOrderSortCheck.stderr||archiveOrderSortCheck.stdout}`);
  const inventoryBooksReconciliationCheck=spawnSync(process.execPath,[path.join(root,'tests','inventory-books-reconciliation-check.mjs')],{encoding:'utf8',cwd:root});
  if(inventoryBooksReconciliationCheck.status!==0)fail(`Inventory-to-Books reconciliation checks failed:\n${inventoryBooksReconciliationCheck.stderr||inventoryBooksReconciliationCheck.stdout}`);
  const booksHtml=fs.readFileSync(path.join(root,'books.html'),'utf8');
  const salesAuthoritySource=fs.readFileSync(path.join(root,'assets','js','shared','sales-authority.js'),'utf8');
  const salesHistorySource=fs.readFileSync(path.join(root,'assets','js','admin','sales-history.js'),'utf8');
  const realtimeHubSource=fs.readFileSync(path.join(root,'assets','js','admin','realtime-hub.mjs'),'utf8');
  const overviewInsightsSource=fs.readFileSync(path.join(root,'assets','js','admin','overview-insights.mjs'),'utf8');
  for(const marker of ["period:'month'","data-report-period=\"7\"","data-report-period=\"30\"","data-report-period=\"month\"","data-report-period=\"all\""])if(!(salesHistorySource+adminHtml).includes(marker))fail(`Sales History shared-period marker missing: ${marker}`);
  if(!overviewInsightsSource.includes("saved.period:'month'")||!analyticsSource.includes("var azRange='month'"))fail('Overview and Analytics must initially use This month');
  for(const marker of ['REPORT_PERIOD_KEY = "accaza-report-period"','function periodButtons()','window.__booksLiveLoading = true','Refreshing Finance Books'])if(!booksHtml.includes(marker))fail(`Books period/refresh marker missing: ${marker}`);
  for(const marker of ['ordersLoaded=false','movementsLoaded=false','Preparing the shared-period report'])if(!salesHistorySource.includes(marker))fail(`Sales History refresh guard missing: ${marker}`);
  for(const marker of ['meta[name="accaza-admin-build"]','encodeURIComponent(build)','module-loader.js?v=284'])if(!moduleLoaderSource.includes(marker)&&!adminHtml.includes(marker))fail(`Admin module cache-bust marker missing: ${marker}`);
  for(const marker of ["saleshistory:['orders','archivedOrders','financialMovements']","'books/journal':['stockvalue']","financialMovements:['cashflow','receivables','payables','payouts','saleshistory']"])if(!realtimeHubSource.includes(marker))fail(`Finance subscription scope missing: ${marker}`);
  if(!adminHtml.includes('href="books.html" target="_blank" rel="noopener"'))fail('Finance navigation must preserve the live Admin cashier tab');
  for(const marker of ['paymentStatus!==\'pending\'','Completed','Received','amounts','qualifies'])if(!salesAuthoritySource.includes(marker))fail(`Shared Admin sales-authority marker missing: ${marker}`);
  for(const marker of ['window.AccazaSales.qualifies','window.AccazaSales.amounts','window.AccazaSales.stamp'])if(!adminSource.includes(marker)||!salesHistorySource.includes(marker))fail(`Admin sales views do not share authority marker: ${marker}`);
  for(const marker of ['Admin is the operational authority','Finance Books must be generated from Admin sales','Admin Sales History reconciles to Finance Books',"A().subscribe('financialMovements'"])if(!salesHistorySource.includes(marker))fail(`Sales reconciliation procedure missing: ${marker}`);
  for(const marker of ['orphan_order_reversal','orphanReversed','Financial.netMovementCorrection','posted_order_auto_preserved'])if(!functionsSource.includes(marker))fail(`Orphan-sale control marker missing: ${marker}`);
  if(!functionsSource.includes('const effectiveStatus = order && order.status === "Archived" ? order.prevStatus : order && order.status;'))fail('Finance posting must use the completed pre-archive order status');
  for(const marker of ['const salesCodes = new Set(["4000","4010","4020","4030","4900","4910"])','Completed sales less refunds and voids','ensureFinancialLedger','net sales: ','expense:customer_discount'])if(!booksHtml.includes(marker)&&!salesHistorySource.includes(marker))fail(`Books sales reconciliation marker missing: ${marker}`);
  for(const marker of ['SAMPLE_ENTRY_IDS','_sample_backup','entries: []','const used = ENTRIES()','onclick="App.drill(\'${a.code}\')"','["2020","Due to Platforms","Liability","Negative Grab/FoodPanda settlements owed to the platform"]'])if(!booksHtml.includes(marker))fail(`Accaza Books cutover marker missing: ${marker}`);
  if((booksHtml.match(/\["2020","Due to Platforms","Liability"/g)||[]).length<2)fail('Due to Platforms must exist in both the default chart and existing-browser migration');
  for(const marker of ['["1290","Inventory Receiving Clearing"','["2090","Unrecorded Payables Clearing"','["5090","Unposted COGS Clearing"','Sync all Finance transactions','ensureBooksJournal'])if(!booksHtml.includes(marker)&&!functionsSource.includes(marker))fail(`Books historical sync marker missing: ${marker}`);
  const itemAccountBridgeSource=fs.readFileSync(path.join(root,'functions','lib','books-bridge.js'),'utf8');
  for(const marker of ['inventoryAccount','costAccount','itemAccounts','cogsAccountSnapshot','purchaseInventoryLines','action === "purchase_paid"','Inventory – Operating & Cleaning Supplies','Office & Administrative Supplies'])if(!adminSource.includes(marker)&&!functionsSource.includes(marker)&&!itemAccountBridgeSource.includes(marker)&&!booksHtml.includes(marker))fail(`Item-level inventory account-assignment marker missing: ${marker}`);
  if(booksHtml.includes('function seedEntries()'))fail('Accaza Books still seeds browser-only sample transactions');

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
  process.stdout.write(booksBridgeCheck.stdout);
  process.stdout.write(salesAuthorityCheck.stdout);
  process.stdout.write(archiveOrderSortCheck.stdout);
  process.stdout.write(inventoryBooksReconciliationCheck.stdout);
  process.stdout.write(operationalExceptionsCheck.stdout);
  process.stdout.write(managerApprovalCheck.stdout);
  console.log('PASS: functions/index.js syntax is valid.');
}finally{
  fs.rmSync(temp,{recursive:true,force:true});
}
