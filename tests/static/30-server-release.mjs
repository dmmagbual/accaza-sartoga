// Server authority, deployment, cache, and release wiring.
export function run(context){
const {fs,path,vm,spawnSync,root,require,htmlFiles,temp,state,fail,section,adminScripts,customerScripts,booksScripts,adminStyles,customerStyles,adminHtml,customerHtml,booksPageHtml,adminSource,customerSource,booksSource,financialSource}=context;
const {rulesRaw}=context;
const functionsSource=fs.readFileSync(path.join(root,'functions','index.js'),'utf8');
for(const marker of ['exports.manageStaffMessage = onCall','Please wait 15 seconds','senderUid:actor.uid','staffMessageReceipts','notifyStaff(db,priority','staffMessages'])if(!functionsSource.includes(marker))fail(`Server Staff Inbox control missing: ${marker}`);
for(const marker of ['exports.manageIncident = onCall','incidentCommandClaims','resolutionEvidence','different management reviewer','Incident evidence only; no order, stock, subledger, Finance movement, or Books journal changed.'])if(!functionsSource.includes(marker))fail(`Phase 14 incident-response control missing: ${marker}`);
const booksBridgeSource=fs.readFileSync(path.join(root,'functions','lib','books-bridge.js'),'utf8');
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
if(!customerSource.includes('orderStatusGreenBlink 1.15s step-end infinite')||!customerSource.includes('orderStatusRedBlink 1.15s step-end infinite'))fail('customer order status dots are not configured to blink');
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
for(const marker of ['Financial.platformPayoutPosting','platform_payout_movement_rebuilt','payout_order_missing','platformAr','platform_ar_control_mismatch','void_balance_correction','voided_platform_order_balance_corrected'])if(!functionsSource.includes(marker))fail(`Platform AR reconciliation marker missing: ${marker}`);
for(const marker of ['destinationAccountId','payout_deposit_${payoutId}','platform_payout_auto_deposit','depositMovementId:payoutRecord.depositMovementId'])if(!functionsSource.includes(marker))fail(`Direct platform payout deposit marker missing: ${marker}`);
for(const marker of ['Deposited directly to','select receiving account','payoutCashAccounts','Bank transaction / payout reference','platformStatementReference:v.platformStatementReference','depositReference:v.depositReference'])if(!adminSource.includes(marker))fail(`Selectable payout destination or reference marker missing: ${marker}`);
for(const marker of ['if(actual>0&&!depositReference)','The bank transaction or payout reference is required.','reference=depositReference','platformStatementReference:platformStatementReference||null'])if(!functionsSource.includes(marker))fail(`Settlement-time payout reference safeguard missing: ${marker}`);
for(const marker of ['accountingOccurredAt:accountingTimestamp(payoutDate,settledAt)','platformPayoutDateEditLocks','platformPayoutDateRevisions','linked_dates_updated','Linked Finance Books journal','bank-reconciled','assertAccountingPeriodOpen(db,oldDate','safeFinancialUpdate(db,writes,"platform payout date edit")'])if(!functionsSource.includes(marker))fail(`Synchronized platform payout-date control missing: ${marker}`);
for(const marker of ['<th>Record Date</th>','All linked Finance Books dates were updated','Payout date and all linked Finance Books records updated.'])if(!adminSource.includes(marker))fail(`Platform payout-date Admin control missing: ${marker}`);
if(!functionsSource.includes('["1021","FoodPanda GCash Wallet"')||!booksSource.includes('["1021","FoodPanda GCash Wallet"'))fail('Dedicated FoodPanda GCash chart account is missing');
if(!booksBridgeSource.includes('asset:platform_clearing:')||!booksBridgeSource.includes('code: "1050"'))fail('Platform payout clearing is not separated from account 1100');
for(const marker of ['action === "inventory_opening_balance"','inventoryReconciliations/openingBalance','expectedDifference','movementId="inventory_opening_balance"'])if(!functionsSource.includes(marker))fail(`Inventory opening-balance control missing: ${marker}`);
if(adminSource.includes('function reconcileAuto()'))fail('retired browser-authored financial reconciliation still exists');
if(!adminSource.includes("'postFinancialCommand'")||!adminSource.includes("'settlePlatformPayout'")||!adminSource.includes('postFinancialCommand:postFinancialCommandCall'))fail('Release 3C callable bridge missing');
for(const node of ['financialMovements','cfLedger','receivables','payables','platformPayouts'])if(!rulesRaw.includes(`"${node}"`))fail(`Release 3C rules missing ${node}`);
if(!rulesRaw.includes('"financialMovements": { ".indexOn": ["occurredAt", "sourceId"]')||!rulesRaw.includes('"cfLedger":')||!rulesRaw.includes('"platformPayouts":'))fail('Financial projections require posting-date and source-reference indexes');
for(const marker of ['exports.createManagerApproval = onCall','exports.consumeManagerApproval = onCall','exports.manageChartAccount = onCall','exports.auditFinancialControls = onCall','exports.onShiftOpenFinancial = onValueWritten'])if(!functionsSource.includes(marker))fail(`Release 3D server marker missing: ${marker}`);
for(const marker of ['resolvedPaymentMappings=new Set()','m.type==="payment_account_reclassification"','if(!resolved)issues.push'])if(!functionsSource.includes(marker))fail(`Resolved payment-mapping audit marker missing: ${marker}`);
for(const node of ['financialApprovals','chartOfAccounts','cashCustody'])if(!rulesRaw.includes(`"${node}"`))fail(`Release 3D rules missing ${node}`);
if(!adminSource.includes("'createManagerApproval'")||!adminSource.includes('callables.createManagerApproval')||!adminSource.includes('inMemoryPersistence'))fail('Release 3D independent Firebase manager approval is missing');
if(!adminSource.includes('authz&&authz.isPrivileged&&current')||!adminSource.includes("['owner','superadmin','admin','manager'].indexOf(effectiveRole)>-1"))fail('Release 7G privileged Admin approval path is missing');
if(!adminSource.includes("a.managerApproval('refund'")||!adminSource.includes('refundPayments:refundPayments'))fail('Release 3D actual refund-tender approval flow is missing');
if(!adminSource.includes("financeCommand('cash_deposit'")||!adminSource.includes('auditFinancialControls'))fail('Release 3D custody deposit or controls audit UI is missing');
for(const marker of ['exports.manageOrderArchive = onCall','exports.reviewDiscrepancy = onCall','exports.managePettyVoucher = onCall','exports.archiveActivityLog = onCall'])if(!functionsSource.includes(marker))fail(`Release 3E server marker missing: ${marker}`);
for(const marker of ['cash_recovered_to_undeposited','recover_shift_shortage_to_undeposited','undeposited_subledger_mismatch','financialControlLinks/correctionMovements','shortage_recovery_${id}','source:"cash_shortage_recovery"','newFinancialMovement:false'])if(!functionsSource.includes(marker))fail(`Undeposited Collection recovery control missing: ${marker}`);
for(const marker of ["value:'cash_recovered'",'Return / acknowledgement reference','creates the matching cash-custody source automatically','Finish incomplete resolution','No linked Finance outcome was recorded.'])if(!adminSource.includes(marker))fail(`End-to-end recovered-cash workflow missing from Admin: ${marker}`);
for(const marker of ['Recovered cash requires a return','source:"cash_shortage_recovery"','record.details={destination,date:financeDate','reference,discrepancyId:id'])if(!functionsSource.includes(marker))fail(`End-to-end recovered-cash authority missing: ${marker}`);
if(adminSource.includes('Correct reviewed record'))fail('Reviewed discrepancies must show their outcome or a specific incomplete-resolution action, not a generic correction button');
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
for(const item of adminScripts){for(const match of item.source.matchAll(/from["']\.\/([^"']+)["']/g)){var importedFile=match[1].split('?')[0];if(!fs.existsSync(path.join(root,'assets','js','admin',importedFile)))fail(`${item.name} imports missing local module ${match[1]}`);}}
const visibleAdminBuild=(adminHtml.match(/<meta name="accaza-admin-build" content="(\d+)"\/>/)||[])[1];
if(!visibleAdminBuild||!adminHtml.includes(`assets/js/admin/core.mjs?v=${visibleAdminBuild}`)||!adminCoreItem.source.includes(`from"./overview-insights.mjs?v=${visibleAdminBuild}"`))fail('Admin Overview module graph is not tied to the visible Admin build');
if(!adminCoreItem.source.includes('mergeOverviewOrders(active,historyOrders,archived)'))fail('Overview does not preserve authoritative order-history precedence over active projections');
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
Object.assign(context,{functionsSource,booksBridgeSource,adminCoreItem,precache,swSource});
}
