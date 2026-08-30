import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';

const root=process.cwd();
const require=createRequire(import.meta.url);
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
const financialSource=fs.readFileSync(path.join(root,'functions','lib','financial.js'),'utf8');

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
  const inboxSource=fs.readFileSync(path.join(root,'assets','js','admin','staff-inbox.js'),'utf8');
  for(const marker of ["window.__accazaRegisterModule('inbox'","a.subscribe('staffMessages'","a.subscribe('staffMessageReceipts'","action:'send'","action:'read'","action:'acknowledge'","Require acknowledgment","staffInboxBadge"])if(!inboxSource.includes(marker)&&!adminHtml.includes(marker))fail(`POS Staff Inbox marker missing: ${marker}`);
  for(const marker of ['"staffMessages"','"staffMessageReceipts"','".write": false'])if(!rulesRaw.includes(marker))fail(`Staff Inbox database protection missing: ${marker}`);
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
  for(const marker of ['exports.manageStaffMessage = onCall','Please wait 15 seconds','senderUid:actor.uid','staffMessageReceipts','notifyStaff(db,priority','staffMessages'])if(!functionsSource.includes(marker))fail(`Server Staff Inbox control missing: ${marker}`);
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
  for(const marker of ['Financial.platformPayoutPosting','platform_payout_movement_rebuilt','payout_order_missing','platformAr','platform_ar_control_mismatch','void_balance_correction','voided_platform_order_balance_corrected'])if(!functionsSource.includes(marker))fail(`Platform AR reconciliation marker missing: ${marker}`);
  for(const marker of ['destinationAccountId','payout_deposit_${payoutId}','platform_payout_auto_deposit','depositMovementId:payoutRecord.depositMovementId'])if(!functionsSource.includes(marker))fail(`Direct platform payout deposit marker missing: ${marker}`);
  for(const marker of ['Deposited directly to','select receiving account','payoutCashAccounts','Bank transaction / payout reference','platformStatementReference:v.platformStatementReference','depositReference:v.depositReference'])if(!adminSource.includes(marker))fail(`Selectable payout destination or reference marker missing: ${marker}`);
  for(const marker of ['if(actual>0&&!depositReference)','The bank transaction or payout reference is required.','reference=depositReference','platformStatementReference:platformStatementReference||null'])if(!functionsSource.includes(marker))fail(`Settlement-time payout reference safeguard missing: ${marker}`);
  if(!functionsSource.includes('["1021","FoodPanda GCash Wallet"')||!fs.readFileSync(path.join(root,'books.html'),'utf8').includes('["1021","FoodPanda GCash Wallet"'))fail('Dedicated FoodPanda GCash chart account is missing');
  if(!booksBridgeSource.includes('asset:platform_clearing:')||!booksBridgeSource.includes('code: "1050"'))fail('Platform payout clearing is not separated from account 1100');
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
  const offlineQueueSource=fs.readFileSync(path.join(root,'assets','js','admin','offline-queue.js'),'utf8');
  const offlineServerSource=fs.readFileSync(path.join(root,'functions','lib','offline-sync.js'),'utf8');
  const posSource=fs.readFileSync(path.join(root,'assets','js','admin','pos.js'),'utf8');
  for(const unit of ['pack','box','ream','roll','set'])if(!posSource.includes("'"+unit+"'"))fail(`Purchases new-item unit list is missing discrete packaging unit ${unit}`);
  for(const marker of ['promptPurchaseItemMapping','Save mapping & continue','newInventoryAccount','newCostAccount','inventoryAccount:g.inventoryAccount','costAccount:g.costAccount'])if(!posSource.includes(marker))fail(`Purchases inline new-item accounting workflow is missing: ${marker}`);
  for(const marker of ["type==='operating_supply'","type==='office_supply'",'Operating / Cleaning Supply','Office / Administrative Supply','recipeItem:isSupplyType(type)?false'])if(!posSource.includes(marker))fail(`Non-recipe inventory supply classification is missing: ${marker}`);
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
  const undepositedSource=fs.readFileSync(path.join(root,'assets','js','admin','undeposited.js'),'utf8');
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
  if(!analyticsSource.includes('function settledPayoutOrderIds()')||!analyticsSource.includes("&&!paid[id]"))fail('Payout queue does not cross-check authoritative settled payout order IDs');
  const payoutQueueCheck=spawnSync(process.execPath,[path.join(root,'tests','payout-queue-check.mjs')],{encoding:'utf8',cwd:root});
  if(payoutQueueCheck.status!==0)fail(`Payout queue regression check failed:\n${payoutQueueCheck.stderr||payoutQueueCheck.stdout}`);
  const grabPosDeductionsCheck=spawnSync(process.execPath,[path.join(root,'tests','grab-pos-deductions-check.mjs')],{encoding:'utf8',cwd:root});
  if(grabPosDeductionsCheck.status!==0)fail(`Grab POS deduction regression check failed:\n${grabPosDeductionsCheck.stderr||grabPosDeductionsCheck.stdout}`);
  const platformReferenceCheck=spawnSync(process.execPath,[path.join(root,'tests','platform-reference-check.mjs')],{encoding:'utf8',cwd:root});
  if(platformReferenceCheck.status!==0)fail(`Platform reference duplicate check failed:\n${platformReferenceCheck.stderr||platformReferenceCheck.stdout}`);
  for(const marker of ['exports.correctPlatformPresettlement = onCall','correct_platform_presettlement','platform_presettlement_correction','Pre-settlement correction','id="poCorrect"','data-pocorrect','type:\'select\'','Merchant-funded promo (₱)','Delivery-fee discount (₱)','Marketing / advertisements (₱)','Marketing fee (₱)','platformAdsMarketing:adsMarketing','platformMarketingFee:marketingFee'])if(!functionsSource.includes(marker)&&!analyticsSource.includes(marker))fail(`Platform pre-settlement correction control missing: ${marker}`);
  for(const marker of ['Marketing / adverts','id="poAdsMarketingSum"','id="poMarketingFeeSum"','e.o.platformAdsMarketing','e.o.platformMarketingFee'])if(!analyticsSource.includes(marker))fail(`Payout review column missing: ${marker}`);
  for(const marker of ['Allocate remaining payout-level variance','Already captured on selected orders:','Enter only an additional payout-level amount.'])if(!analyticsSource.includes(marker))fail(`Payout-level double-entry warning missing: ${marker}`);
  for(const marker of ['expense:platform_variance:va_ads','expense:platform_variance:va_marketing_success','gross - commission - discount - wht - vat - adsMarketing - marketingFee'])if(!financialSource.includes(marker))fail(`Order-level Grab marketing posting missing: ${marker}`);
  for(const marker of ['va_refund_recovery','allocationRefs','automaticPayoutSource','sourceKind:suppliedSourceRef ? "entered_reference" : (payoutSourced ? "payout" : "none")'])if(!functionsSource.includes(marker)&&!analyticsSource.includes(marker))fail(`Grab refund payout-source control missing: ${marker}`);
  if(analyticsSource.includes('data-allocref=')||analyticsSource.includes('Original Grab order or statement reference required when used'))fail('Grab refund payout UI still requires a separate reference box');
  if(!analyticsSource.includes('Source is recorded automatically from this payout'))fail('Grab refund payout-source explanation is missing');
  for(const marker of ['Edit payout information','data-poedit','platformStatementReference','depositReference'])if(!analyticsSource.includes(marker))fail(`Platform payout metadata editor missing: ${marker}`);
  for(const marker of ['update_platform_payout_metadata','edit_payout_reference','financialEffect: "none"'])if(!functionsSource.includes(marker))fail(`Platform payout metadata safeguard missing: ${marker}`);
  if(!fs.readFileSync(path.join(root,'books.html'),'utf8').includes("target==='edit_payout_reference'"))fail('Financial control audit cannot open the exact payout metadata editor');
  for(const marker of ['function businessReference(issue)','sourceLabel: label','Never expose an internal key as the business-facing reference'])if(!functionsSource.includes(marker))fail(`Financial control business-reference safeguard missing: ${marker}`);
  for(const marker of ['createShiftReference','Shift reference:','shiftReference:shiftRef','ensureShiftReference','shiftReferenceIndex','durableShiftReference'])if(!adminSource.includes(marker)&&!functionsSource.includes(marker))fail(`Durable shift-reference safeguard missing: ${marker}`);
  if(/\bF\(\)\.run\(/.test(analyticsSource))fail('Platform payout correction must use the available form dialog service.');
  for(const marker of ['newPlatformRef','previousPlatformRef','platformRefIndex/${channel}/${newRefKey}','financialEffect:movement?"posting_difference":"none"'])if(!functionsSource.includes(marker)&&!analyticsSource.includes(marker))fail(`Platform reference correction propagation missing: ${marker}`);
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
  for(const marker of ['inventoryMovementEvidence','inventory_marker_gap','Order-specific inventory movements already exist','{ref: "/orders/{orderId}"','movementId: `sale_${orderId}_${ing}`'])if(!exceptionSource.includes(marker)&&!functionsSource.includes(marker))fail(`Order inventory marker recovery safeguard missing: ${marker}`);
  for(const marker of ['exports.repairOrderInventoryMarker = onCall','Inventory evidence does not match the expected order usage','no stock or Finance movement posted','Math.abs(quantity)>.000001'])if(!functionsSource.includes(marker))fail(`Controlled inventory confirmation repair missing: ${marker}`);
  for(const marker of ['repairOrderInventoryMarker','Restore confirmation','Open Undeposited Collection',"target=isCustody?'undeposited'"])if(!operationsSource.includes(marker)&&!adminSource.includes(marker))fail(`Operations exception action missing: ${marker}`);
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
  for(const marker of ['function computeZ(shift,sourceOrders)','var z=computeZ(shift,saleList)','Only managers may archive orders.','Orders cannot be archived while their shift is open.','canArchiveOrder:function(o)'])if(!shiftRegisterSource.includes(marker)&&!functionsSource.includes(marker)&&!adminCoreItem.source.includes(marker))fail(`Shift-close/archive safeguard missing: ${marker}`);
  if(!adminCoreItem.source.includes('var verifiedRole=window.__accazaAuthz&&window.__accazaAuthz.role')||section(adminCoreItem.source,'canArchiveOrder:function(o)','escHtml:escHtml').includes('currentLoginRole'))fail('Order archive eligibility must use the verified server role so restored admin sessions can archive closed-shift orders.');
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
  if(!posSource.includes("ln.ing?'<button type=\"button\" class=\"purchase-add-sku\"")||!posSource.includes('Add an approved brand'))fail('Purchase lines must always offer to add or manage an approved brand');
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
  for(const marker of ["value=\"expense\"","expenseDescription","expenseAccount:'6075'","lineType:'expense'","no inventory created","Stock, expense, and fixed-asset treatments were linked to the same Finance Books entry"])if(!posSource.includes(marker))fail(`One-time purchase expense control missing: ${marker}`);
  for(const marker of ['line.lineType==="expense"','["6070","6075"].includes(expenseCode)','A one-time purchase expense has an invalid Finance Books account'])if(!functionsSource.includes(marker))fail(`One-time purchase expense posting safeguard missing: ${marker}`);
  for(const marker of ['value="asset"','assetLifeMonths','assetSalvage','assetInServiceDate','assetLocation','assetCustodian',"lineType:'fixed_asset'","action:'register_purchase'"])if(!posSource.includes(marker))fail(`Purchasing fixed-asset card control missing: ${marker}`);
  for(const marker of ['action==="register_purchase"','fixedAssetIds','fundingType:"purchase_invoice"','A linked fixed-asset card is missing','New fixed assets must be acquired through Purchasing','line.lineType==="fixed_asset"'])if(!functionsSource.includes(marker))fail(`Purchase-linked fixed-asset safeguard missing: ${marker}`);
  const fixedAssetBooksHtml=fs.readFileSync(path.join(root,'books.html'),'utf8');if(!fixedAssetBooksHtml.includes('Acquire through Purchasing')||fixedAssetBooksHtml.includes('onclick="App.faAcquire()">+ Acquire asset'))fail('Standalone fixed-asset acquisition is not disabled in favor of Purchasing');
  for(const marker of ['Invoice pending — provisional obligation','purchaseHistoryHtml','data-purchase-details','data-purchase-finalize','data-purchase-link'])if(!posSource.includes(marker))fail(`Purchase review/GRNI UI marker missing: ${marker}`);
  for(const marker of ['inventory_pending_invoice','grni_created','purchase_grni_finalize_','liability:grni:'])if(!functionsSource.includes(marker))fail(`Purchase GRNI authority missing: ${marker}`);
  if(!functionsSource.includes('Finalize the supplier invoice before paying this provisional obligation')||!financeSource.includes('Finalize invoice first'))fail('Provisional purchase obligations can still be paid before invoice finalization');
  for(const marker of ['data-purchase-link','data-purchase-repair','data-purchase-duplicate','Purchase ID:'])if(!posSource.includes(marker))fail(`Purchase record repair control missing: ${marker}`);
  for(const marker of ['linkPayableId','link_existing_purchase_payable','Another purchase already claims this payable','orphanAccount'])if(!functionsSource.includes(marker))fail(`Server purchase-link/duplicate guard missing: ${marker}`);
  for(const marker of ['keepInvoiceId','duplicateCleanup','reverse_duplicate_purchase','purchase_ap_repair'])if(!functionsSource.includes(marker))fail(`Shared-payable duplicate recovery missing: ${marker}`);
  if(!posSource.includes('keepInvoiceId:keepId,duplicate:true')||!posSource.includes('If its shared payable had already been reversed'))fail('Duplicate-pair reversal does not preserve the selected surviving purchase');
  if(!posSource.includes('showReversedPurchases||!p.reversed')||!posSource.includes('data-purchase-toggle-reversed'))fail('Reversed purchases are not hidden by default with an audit-history toggle');
  for(const marker of ['Correct purchase details','Reverse &amp; re-enter',"managerApproval('reverse_purchase'",'correctedPurchaseDraft(inv)'])if(!posSource.includes(marker))fail(`Purchase correction interface missing: ${marker}`);
  for(const marker of ['data-purchase-edit','Edit purchase details','periodWarning','changing the purchase date changes the accounting period','draft.date=v.date','description:(P.description||\'\').trim()'])if(!posSource.includes(marker))fail(`Purchase history metadata/date correction marker missing: ${marker}`);
  for(const marker of ['description:financeText(invoice.description,240)','purchaseInvoices/${invoiceId}/supplier','payables/${invoice.payableId}/party','correct_purchase_details'])if(!functionsSource.includes(marker))fail(`Purchase metadata correction authority missing: ${marker}`);
  if(!posSource.includes("recipeItem:true")||!posSource.includes('Used in recipes')||!posSource.includes("seededFrom:'purchase'"))fail('Release 7H new recipe-item SKU creation is incomplete');
  for(const marker of ['Set up stock item / opening balance','Use this only for an item missing from the system','invOpeningConfirmed','Confirm stock-item setup','Opening inventory value:','Maker: ','has not already been received or counted elsewhere','Future deliveries must go through Purchases'])if(!posSource.includes(marker))fail(`Stock-item opening-balance safeguard missing: ${marker}`);
  if(!posSource.includes('<details class="pz-card"')||!posSource.includes('<summary class="pz-btn sec"'))fail('Stock-item opening-balance setup is not collapsed behind its action button');
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
  for(const marker of ['o.platformAdsMarketing','o.platformMarketingFee'])if(!analyticsSource.includes(marker)||!financeSource.includes(marker)||!cashflowBooksHtml.includes(marker)||!functionsSource.includes(marker))fail(`Platform deduction fallback is not aligned across Admin, settlement, and Finance Books: ${marker}`);
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
  const financialCloseCheck=spawnSync(process.execPath,[path.join(root,'tests','financial-close-check.cjs')],{encoding:'utf8',cwd:root});
  if(financialCloseCheck.status!==0)fail(`Financial close checks failed:\n${financialCloseCheck.stderr||financialCloseCheck.stdout}`);
  const financialCloseUi=fs.readFileSync(path.join(root,'books.html'),'utf8');for(const marker of ["x.measurement==='status'","Matched open balance","GL '+peso(c.glBalance)","non-monetary controls are never displayed as pesos","<th class=\"num\">Result</th>"])if(!financialCloseUi.includes(marker))fail(`Typed Financial Close presentation safeguard missing: ${marker}`);

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
  const salesHistoryAutoloadCheck=spawnSync(process.execPath,[path.join(root,'tests','sales-history-autoload-check.mjs')],{encoding:'utf8',cwd:root});
  if(salesHistoryAutoloadCheck.status!==0)fail(`Sales History automatic completeness check failed:\n${salesHistoryAutoloadCheck.stderr||salesHistoryAutoloadCheck.stdout}`);
  const overviewHistoryAutoloadCheck=spawnSync(process.execPath,[path.join(root,'tests','overview-history-autoload-check.mjs')],{encoding:'utf8',cwd:root});
  if(overviewHistoryAutoloadCheck.status!==0)fail(`Overview automatic completeness check failed:\n${overviewHistoryAutoloadCheck.stderr||overviewHistoryAutoloadCheck.stdout}`);
  const overviewColdLoadCheck=spawnSync(process.execPath,[path.join(root,'tests','overview-cold-load-check.mjs')],{encoding:'utf8',cwd:root});
  if(overviewColdLoadCheck.status!==0)fail(`Overview cold-load check failed:\n${overviewColdLoadCheck.stderr||overviewColdLoadCheck.stdout}`);
  const overviewSelfHealCheck=spawnSync(process.execPath,[path.join(root,'tests','overview-selfheal-reconciliation-check.mjs')],{encoding:'utf8',cwd:root});
  if(overviewSelfHealCheck.status!==0)fail('Overview self-heal reconciliation check failed:\n'+(overviewSelfHealCheck.stderr||overviewSelfHealCheck.stdout));
  const overviewAuthRetryCheck=spawnSync(process.execPath,[path.join(root,'tests','overview-auth-retry-check.mjs')],{encoding:'utf8',cwd:root});
  if(overviewAuthRetryCheck.status!==0)fail('Overview authenticated-retry check failed:\n'+(overviewAuthRetryCheck.stderr||overviewAuthRetryCheck.stdout));
  const archiveOrderSortCheck=spawnSync(process.execPath,[path.join(root,'tests','archive-order-sort-check.mjs')],{encoding:'utf8',cwd:root});
  if(archiveOrderSortCheck.status!==0)fail(`Archived-order sorting checks failed:\n${archiveOrderSortCheck.stderr||archiveOrderSortCheck.stdout}`);
  const inventoryBooksReconciliationCheck=spawnSync(process.execPath,[path.join(root,'tests','inventory-books-reconciliation-check.mjs')],{encoding:'utf8',cwd:root});
  if(inventoryBooksReconciliationCheck.status!==0)fail(`Inventory-to-Books reconciliation checks failed:\n${inventoryBooksReconciliationCheck.stderr||inventoryBooksReconciliationCheck.stdout}`);
  const booksStatementReconciliationCheck=spawnSync(process.execPath,[path.join(root,'tests','books-statement-reconciliation-check.mjs')],{encoding:'utf8',cwd:root});
  if(booksStatementReconciliationCheck.status!==0)fail(`Books statement-to-ledger reconciliation checks failed:\n${booksStatementReconciliationCheck.stderr||booksStatementReconciliationCheck.stdout}`);
  const booksHtml=fs.readFileSync(path.join(root,'books.html'),'utf8');
  const salesAuthoritySource=fs.readFileSync(path.join(root,'assets','js','shared','sales-authority.js'),'utf8');
  const salesHistorySource=fs.readFileSync(path.join(root,'assets','js','admin','sales-history.js'),'utf8');
  const realtimeHubSource=fs.readFileSync(path.join(root,'assets','js','admin','realtime-hub.mjs'),'utf8');
  const overviewInsightsSource=fs.readFileSync(path.join(root,'assets','js','admin','overview-insights.mjs'),'utf8');
  for(const marker of ['assets/js/shared/report-period.js','reportPeriodFrom','reportPeriodTo','reportPeriodApply','reportPeriodAll',"mode:'30d'","mode==='all'"])if(!(salesHistorySource+adminHtml+fs.readFileSync(path.join(root,'assets','js','shared','report-period.js'),'utf8')).includes(marker))fail(`Shared reporting marker missing: ${marker}`);
  if(!salesHistorySource.includes('Number(shared.startAt)')||!salesHistorySource.includes('Number(shared.endAt)')||!analyticsSource.includes('azFrom=Number(v.startAt)||null')||!analyticsSource.includes('azTo=Number(v.endAt)||null'))fail('Sales History and Analytics must use the shared reporting date range');
  if(!overviewInsightsSource.includes('function reportPeriod()')||!overviewInsightsSource.includes("mode:'30d'"))fail('Overview must default to the last 30 days');
  if(!overviewInsightsSource.includes('function stamp(o){return window.AccazaSales.stamp(o);'))fail('Overview must use the same completed/received sale date authority as Sales History');
  for(const marker of ['function reportPeriod()','Every completed paid order in the selected dates is loaded, including archived orders.','function ensureHistory(){}'])if(!overviewInsightsSource.includes(marker))fail(`Overview reporting guard missing: ${marker}`);
  for(const marker of ['REPORT_PERIOD_KEY = "accaza-report-period"','function periodButtons()','window.__booksLiveLoading = true','Refreshing Finance Books'])if(!booksHtml.includes(marker))fail(`Books period/refresh marker missing: ${marker}`);
  for(const marker of ['const ACCOUNT_GROUPS = [','name:"Cash and Cash Equivalents"','name:"Inventories"','name:"Recoverable Taxes"','name:"Receivables"','name:"Property, Plant and Equipment"','name:"Payables and Related Obligations"','name:"Tax Liabilities"','name:"Owner\'s Equity"','name:"Sales Revenue"','name:"Cost of Sales"','name:"Operating Expenses"','const accountMatchesGroup =','function groupBalance(group, entries)','Main accounts are read-only totals','Main accounts are calculated rollups'])if(!booksHtml.includes(marker))fail(`Books protected account hierarchy marker missing: ${marker}`);
  for(const marker of ['Beginning cash balance','Plus: Receipts','Less: Deductions','Calculated ending cash','Ending cash balances','ACCOUNT_GROUPS.filter(g=>g.type===type)'])if(!booksHtml.includes(marker))fail(`Books rolled-statement presentation marker missing: ${marker}`);
  for(const marker of ['function adminSalesAr()','function receivablesPage()','Admin Sales platform AR · unsettled orders','Platform AR control ledger · 1100','Account 1100 agrees with Admin Sales AR','Other open receivables · 1110','Other receivables subledger agrees with account 1110','onValue(ref(db,"/orders")','onValue(ref(db,"/archivedOrders")'])if(!booksHtml.includes(marker))fail(`Books AR control-to-subledger reconciliation marker missing: ${marker}`);
  for(const marker of ['function billPaymentSourceOptions()','Register Cash Float · protected imprest','Undeposited Collection','Revolving Fund','owner paid from own pocket','App._paySourceToggle','paymentSource:source'])if(!booksHtml.includes(marker))fail(`Books bill-payment source marker missing: ${marker}`);
  for(const marker of ['payable_paid_owner_capital','Register Cash Float is protected and cannot be used to pay bills.','asset="asset:register_cash"','asset="asset:cash_awaiting_deposit"','asset="asset:petty_cash"','asset="equity:capital_in"','paidPersonallyBy','Bill payment exceeds available Undeposited Collection'])if(!functionsSource.includes(marker))fail(`Server bill-payment source control missing: ${marker}`);
  if(booksHtml.includes('if(e.reversed) return'))fail('Finance statements exclude posted reversal lines and can disagree with the General Ledger');
  for(const marker of ['function postedAccountNet(code, entries)','function accountBalance(code, uptoPeriodOnly)','function accountNet(code, periodEntries)','running += DEBIT_NORMAL[a.type]?(dr-crd):(crd-dr)'])if(!booksHtml.includes(marker))fail(`Books statement-to-ledger reconciliation marker missing: ${marker}`);
  for(const marker of ['ordersLoaded=false','movementsLoaded=false','Preparing the shared-period report'])if(!salesHistorySource.includes(marker))fail(`Sales History refresh guard missing: ${marker}`);
  for(const marker of ['meta[name="accaza-admin-build"]','encodeURIComponent(build)'])if(!moduleLoaderSource.includes(marker)&&!adminHtml.includes(marker))fail(`Admin module cache-bust marker missing: ${marker}`);
  const adminBuild=(adminHtml.match(/<meta name="accaza-admin-build" content="(\d+)"\/>/)||[])[1],loaderBuild=(adminHtml.match(/module-loader\.js\?v=(\d+)/)||[])[1];
  if(!adminBuild||loaderBuild!==adminBuild)fail('Admin module loader version must match the visible Admin build');
  for(const marker of ["saleshistory:['orders','archivedOrders','financialMovements']","cfAccounts:['purchases','cashflow','receivables','payables','payouts','undeposited']","'books/journal':['stockvalue']","financialMovements:['purchases','cashflow','receivables','payables','payouts','saleshistory','undeposited','discrepancy']"])if(!realtimeHubSource.includes(marker))fail(`Finance subscription scope missing: ${marker}`);
  for(const marker of ["function currentCashBalance(id)","function refreshCashBalances(forceAfterCurrent)","if(tab==='purchases')refreshCashBalances()","name:'Cash on Hand (available above float)'","name:'Register Cash Float (protected)'","registerFloatAmount","Math.max(0,b-registerFloatAmount)","id:'undeposited',name:'Undeposited Collection'","disabled:true","a.get(a.ref(a.db,'financialMovements'))","a.get(a.ref(a.db,'posSettings/fixedFloat'))","accaza:cash-balances-updated"])if(!financeSource.includes(marker)&&!adminSource.includes(marker))fail(`Purchase Balance Sheet cash-account marker missing: ${marker}`);
  for(const marker of ["requestedAccount === \"register\" || requestedAccount === \"cash_float\"","savedAccount !== requestedAccount","paymentMovementId","paymentAccountId","fromUndeposited","poolCustodyOutflow(db, value)","custodyAllocations","Purchase exceeds available Undeposited Collection","availableCashOnHandAboveFloat(db)","The protected Register Cash Float","lastPaymentReversalMovementId"])if(!functionsSource.includes(marker))fail(`Purchase cash disbursement safeguard missing: ${marker}`);
  for(const marker of ["Cash on Hand excludes the protected Register Cash Float","Undeposited Collection posts a controlled disbursement","Cash Float is view-only","x.disabled?' disabled'","availableAccounts","purchasePaymentAccountLabel","The protected cash float cannot cover the difference","Paid · "])if(!posSource.includes(marker))fail(`Purchase cash-account selector marker missing: ${marker}`);
  if(financeSource.includes("id:'register',name:'Register cash'"))fail('Retired Register cash still appears in the Purchases account source');
  if(!adminHtml.includes('href="books.html" target="_blank" rel="noopener"'))fail('Finance navigation must preserve the live Admin cashier tab');
  for(const marker of ['paymentStatus!==\'pending\'','Completed','Received','amounts','qualifies'])if(!salesAuthoritySource.includes(marker))fail(`Shared Admin sales-authority marker missing: ${marker}`);
  for(const marker of ['window.AccazaSales.qualifies','window.AccazaSales.amounts','window.AccazaSales.stamp'])if(!adminSource.includes(marker)||!salesHistorySource.includes(marker))fail(`Admin sales views do not share authority marker: ${marker}`);
  for(const marker of ['Admin is the operational authority','Finance Books must be generated from Admin sales','Admin and Finance net sales reconcile',"A().subscribe('financialMovements'"])if(!salesHistorySource.includes(marker))fail(`Sales reconciliation procedure missing: ${marker}`);
  if(!salesHistorySource.includes("'revenue:platform_discount'")||salesHistorySource.includes("'expense:platform_merchant_funded_promo','expense:platform_delivery_fee_discount'"))fail('Sales reconciliation must use posted contra-revenue and must not silently infer discounts from legacy expense accounts');
  for(const marker of ['tot.mismatched===0','financeNet-tot.net','Admin '+"'+money(v.net)+'"+' · Finance '])if(!salesHistorySource.includes(marker))fail(`Sales amount-level reconciliation safeguard missing: ${marker}`);
  for(const marker of ['sale_amount_mismatch','Financial.orderNetSales(o)','Financial.sourceNetSales(saleMovementRows,id)','sales_discount_reclass_','platform_sales_discount_reclassified'])if(!functionsSource.includes(marker))fail(`Server sales amount reconciliation safeguard missing: ${marker}`);
  for(const marker of ['a.unpostedNet+=v.net','difference=Math.round((financeNet-tot.net)*100)/100','tot.unposted===0&&tot.mismatched===0&&Math.abs(orphanNet)<.005&&Math.abs(difference)<.005'])if(!salesHistorySource.includes(marker))fail(`Sales reconciliation must compare source-linked missing, amount-mismatched, and orphan postings: ${marker}`);
  for(const marker of ["ties?'✓ Admin and Finance net sales reconcile':'⚠ Admin and Finance sales do not reconcile'","isComplete&&(!comparable||ties)?'ok':'warn'",'Difference '+"'+money(difference)+'",'tot.mismatched+\' mismatched'])if(!salesHistorySource.includes(marker))fail(`Sales History fail-closed reconciliation status missing: ${marker}`);
  for(const marker of ['order.netSalesPlatform!=null','order.platformDiscount','platform&&order.grossPlatform!=null'])if(!salesAuthoritySource.includes(marker)||!financialSource.includes(marker))fail(`Canonical platform net-sales definition missing: ${marker}`);
  for(const marker of ['function initialFeedsLoaded()',"verified={orders:false,archivedOrders:false,financialMovements:false}","verified[path]&&!h.historyStatus(path).hasOlder","period&&period.mode==='all'","return query(base,orderByChild(spec.field),startAt(Number(period.startAt)),endAt(Number(period.endAt)))"])if(!(salesHistorySource+realtimeHubSource).includes(marker))fail(`Sales history must load the complete selected history before reconciliation: ${marker}`);
  for(const marker of ['{id:"settings",label:"Settings"}','PAGES.settings','App.changeAccountingPeriod','App.runLegacyCutover','legacyOwnerCapitalReset','₱120 shortage dated 30 August 2026'])if(!booksHtml.includes(marker))fail(`Finance Settings and legacy-close control missing: ${marker}`);
  for(const marker of ['cutoffDate','legacy_owner_capital_reset_v5_${cutoffDate}','protectedDate="2026-08-30"','protectedShortage=120','"4990":"credit","6110":"debit","1190":"debit","2100":"credit"','crossPeriodReversals={"6100":0,"6110":0}','if(net>=-0.005)return','Close remaining negative August legacy expense activity','duplicate:existingSnap.exists()'])if(!functionsSource.includes(marker))fail(`Legacy close and protected discrepancy safeguard missing: ${marker}`);
  for(const marker of ['function entriesThroughPeriodEnd()','function isBalanceSheetType(type)','function accountReportEntries(code)','accountNet(a.code, entriesInPeriod())','const ents = entriesThroughPeriodEnd()','period activity only; prior periods are not carried forward'])if(!booksHtml.includes(marker))fail(`Balance-sheet carry-forward and nominal-period safeguard missing: ${marker}`);
  if(!booksHtml.includes('query(ref(db,"/books/journal"),orderByChild("date"),endAt(p.to))'))fail('Books journal feed must load all posted history through the report end date for cumulative balances');
  if(booksHtml.includes('query(ref(db,"/books/journal"),orderByChild("date"),startAt(p.from),endAt(p.to))'))fail('Books journal feed incorrectly discards prior-period entries required by balance-sheet and ledger balances');
  for(const marker of ['orphan_order_reversal','orphanReversed','Financial.netMovementCorrection','posted_order_auto_preserved'])if(!functionsSource.includes(marker))fail(`Orphan-sale control marker missing: ${marker}`);
  for(const marker of ['fullOrderVoidMovement','Fully reverse voided order','BooksBridge.fullyVoidedSourceIds','BooksBridge.includeInAuthoritativeBooks'])if(!functionsSource.includes(marker))fail(`Full-void exclusion control missing: ${marker}`);
  if(!functionsSource.includes('const effectiveStatus = order && order.status === "Archived" ? order.prevStatus : order && order.status;'))fail('Finance posting must use the completed pre-archive order status');
  for(const marker of ['const salesCodes = new Set(["4000","4010","4020","4030","4900","4910"])','Completed sales less refunds and voids','ensureBooksJournal','net sales: ','expense:customer_discount'])if(!booksHtml.includes(marker)&&!salesHistorySource.includes(marker)&&!functionsSource.includes(marker))fail(`Books sales reconciliation marker missing: ${marker}`);
  for(const marker of ['SAMPLE_ENTRY_IDS','_sample_backup','entries: []','const used = ENTRIES()','onclick="App.drill(\'${a.code}\')"','["2020","Due to Platforms","Liability","Negative Grab/FoodPanda settlements owed to the platform"]'])if(!booksHtml.includes(marker))fail(`Accaza Books cutover marker missing: ${marker}`);
  if((booksHtml.match(/\["2020","Due to Platforms","Liability"/g)||[]).length<2)fail('Due to Platforms must exist in both the default chart and existing-browser migration');
  for(const marker of ['["1290","Inventory Receiving Clearing"','["2090","Unrecorded Payables Clearing"','["5090","Unposted COGS Clearing"','Sync all Finance transactions','ensureBooksJournal'])if(!booksHtml.includes(marker)&&!functionsSource.includes(marker))fail(`Books historical sync marker missing: ${marker}`);
  for(const marker of ['window.__booksSync=function(){var ensureLedger=httpsCallable(fns,"ensureFinancialLedger"),ensureJournal=httpsCallable(fns,"ensureBooksJournal")','includeInAuthoritativeBooks','sales_authority_','authoritative net sales: '])if(!booksHtml.includes(marker)&&!functionsSource.includes(marker)&&!booksBridgeSource.includes(marker))fail(`Authoritative sales reconciliation marker missing: ${marker}`);
  for(const marker of ['authoritativeEntries=ents.filter(e=>e&&e.source==="pos")','manualEntries=ents.filter(e=>!e||e.source!=="pos")','Unverified manual sales — excluded from net sales','Admin-authorized bridge entries only'])if(!booksHtml.includes(marker))fail(`Books net-sales source boundary missing: ${marker}`);
  const platformBridgeSource=fs.readFileSync(path.join(root,'functions','lib','books-bridge.js'),'utf8');
  for(const marker of ['"expense:platform_variance:va_refund": "6085"','"revenue:platform_variance:va_refund_recovery": "4990"'])if(!platformBridgeSource.includes(marker))fail(`Platform refund classification guard missing: ${marker}`);
  if(booksHtml.includes("['purchases','Purchases']"))fail('Manual Bills still allow inventory purchases to bypass the linked Purchases workflow');
  const itemAccountBridgeSource=fs.readFileSync(path.join(root,'functions','lib','books-bridge.js'),'utf8');
  for(const marker of ['["inventory","inventory_pending_invoice","purchases"].includes(documentType)','legacy_purchase_rebuild','expense:platform_variance:va_penalty','["6085","Platform Penalties & Adjustments"'])if(!functionsSource.includes(marker)&&!itemAccountBridgeSource.includes(marker)&&!booksHtml.includes(marker))fail(`Miscellaneous-routing prevention marker missing: ${marker}`);
  for(const marker of ['Inventory Reconciliation Gain / (Loss)','legacyGainConsolidation','legacyGainConsolidated','postingAccount:"5905"','Financial.line("coa:5905",0,difference,`${label} gain`)','booksChart/4995/consolidatedInto'])if(!functionsSource.includes(marker)&&!booksHtml.includes(marker))fail(`Single inventory reconciliation gain/loss account marker missing: ${marker}`);
  for(const marker of ['["6078","Product R&D & Testing","Expense"','function internalUsageAccount(type,movement)','requested==="5905"','type==="usage_reversal"','ensureHistoricalInternalUsageFinance','legacyAccountMigratedFrom:"4995"'])if(!functionsSource.includes(marker)&&!booksHtml.includes(marker))fail(`Internal-usage Finance safeguard missing: ${marker}`);
  for(const marker of ["expenseAccount:'6077'","expenseAccount:'6078'",'data-utaccount','movementByItem','usageAccount:usageAccount'])if(!posSource.includes(marker))fail(`Internal-usage account mapping UI missing: ${marker}`);
  for(const marker of ['inventoryAccount','costAccount','itemAccounts','cogsAccountSnapshot','purchaseInventoryLines','action === "purchase_paid"','Inventory – Operating & Cleaning Supplies','Office & Administrative Supplies'])if(!adminSource.includes(marker)&&!functionsSource.includes(marker)&&!itemAccountBridgeSource.includes(marker)&&!booksHtml.includes(marker))fail(`Item-level inventory account-assignment marker missing: ${marker}`);
  for(const marker of ['purchase_cash_advance','asset:purchase_cash_advance:','Purchase cash advance was not found','purchaseInvoiceId'])if(!functionsSource.includes(marker))fail(`Purchase cash advance Finance Books marker missing: ${marker}`);
  for(const marker of ['Supplier payments now come from Undeposited Collection','Expected cash to hand over','awaiting allocation'])if(!adminSource.includes(marker))fail(`Register purchase cash workflow marker missing: ${marker}`);
  for(const marker of ['Allocate from payment pending inventory allocation','advanceId:P.advanceId','purchaseAdvanceRegisterHtml','remaining of','allocations'])if(!posSource.includes(marker))fail(`Purchase advance linking marker missing: ${marker}`);
  for(const marker of ['revolving_fund_purchase_advance','transactionType==="purchase_advance"','asset:purchase_cash_advance:','An allocated or returned supplier payment cannot be voided','purchase_advance_allocation_reversed','Restore supplier payment for allocation','revolving_fund_supplier_payment_return','return_supplier_payment'])if(!functionsSource.includes(marker))fail(`Revolving Fund Finance Books marker missing: ${marker}`);
  for(const marker of ['Cash Payments','Payment to supplier — allocate to inventories','Payments awaiting inventory allocation','rfCustodian'])if(!adminSource.includes(marker))fail(`Cash Payments workspace marker missing: ${marker}`);
  for(const marker of ['owner_withdrawal','Owner withdrawal — not an expense','operating_supplies','office_supplies','bank_fees'])if(!adminSource.includes(marker))fail(`Revolving Fund category marker missing: ${marker}`);
  for(const marker of ['Record a cash payment','function syncPettyCategory()','Purchases — pending inventory allocation',"Owner\\'s Drawings (3100) — not an expense"])if(!adminSource.includes(marker))fail(`Revolving Fund paired-field marker missing: ${marker}`);
  for(const marker of ['Manager explanation','Attach a receipt or enter a clear explanation','only an approved voucher is posted to cash and Finance Books'])if(!adminSource.includes(marker))fail(`Cash-payment explanation approval marker missing: ${marker}`);
  for(const marker of ['manager_reviewed_explanation','A supplier receipt is required before approval.','A receipt or clear explanation is required before approval.'])if(!functionsSource.includes(marker))fail(`Server cash-payment evidence control missing: ${marker}`);
  for(const marker of ['data-pved','function editVoucher(id)','correct_petty_voucher','petty_cash_payment_correction','correctionMovementIds','correct_approved_petty_voucher'])if(!functionsSource.includes(marker)&&!adminSource.includes(marker))fail(`Cash-payment correction control missing: ${marker}`);
  for(const marker of ['function revolvingFundPosting(row)','equity:owner_draw','revolving_fund_owner_withdrawal','expense:office_supplies'])if(!functionsSource.includes(marker))fail(`Revolving Fund account-routing marker missing: ${marker}`);
  for(const marker of ['retainedFromClosedYears','Current-year net','Completed calendar-year profit or loss closes to Retained Earnings at December 31'])if(!booksHtml.includes(marker))fail(`Calendar year-end equity roll-forward missing: ${marker}`);
  if(!platformBridgeSource.includes('"equity:owner_capital": "3000", "equity:opening_balance": "3000", "equity:cash_float_source": "3000"'))fail('Opening equity and historical cash-float sources must rebuild into Owner\'s Capital');
  for(const marker of ['function resolveRegisterFloat(settings, activeShift)','activeShift.retainedFloat != null ? activeShift.retainedFloat : activeShift.openingFloat','function registerFloatControlEntry(amount, at, control)','books/journal/register_float_control','exports.syncActiveRegisterCashFloat = onValueWritten','register_float_changed','register_float_synced','total cash unchanged'])if(!functionsSource.includes(marker))fail(`Register cash-float Finance control missing: ${marker}`);
  for(const marker of ['function firebaseSafeSourceKey(value, fallback)','firebaseSafeSourceKey(sourceRef, "register_float")','firebaseSafeSourceKey(sourceRef, "historical_suspense")','sourceRef, sources'])if(!functionsSource.includes(marker))fail(`Finance migration Firebase-safe source key missing: ${marker}`);
  for(const marker of ['function historicalSuspenseCapitalEntry()','books/journal/historical_suspense_capital_20260826','EQUITY-RECLASS-20260826','historical_pos_suspense_through_2026_08_26','{code: "1900", debit: 995, credit: 0}', '{code: "3000", debit: 0, credit: 995}'])if(!functionsSource.includes(marker))fail(`One-time historical Suspense-to-capital control missing: ${marker}`);
  for(const marker of ['ensureHistoricalSecurityBankDrawings(db, actor)','books_manual_draw25_','manual_books_owner_draw','reference: "DRAW-25"','originalJournalDate: "2026-08-25"'])if(!functionsSource.includes(marker))fail(`Historical Security Bank owner-drawing migration missing: ${marker}`);
  for(const marker of ['Browser entries are retained only as a recovery backup','function ENTRIES(){ return (window.__posEntries||[]).slice(); }','"manual_journal"','"reverse_manual_journal"'])if(!booksHtml.includes(marker))fail(`Shared server-authoritative manual Books journal missing: ${marker}`);
  for(const marker of ['action:this._edit?"correct_manual_journal":"manual_journal"','void_manual_journal','Linked bill / payable','linkedPayableId','Edit / correct</button>','View posting history','Void</button>','App.correctPayable'])if(!booksHtml.includes(marker))fail(`Manual journal correction/void/payable-link interface missing: ${marker}`);
  for(const marker of ['close_customer_payable_to_capital','customer_change_payable_closed_to_capital','capital_closed','Close customer payable to Owner\\\'s Capital','No cash is paid or moved.'])if(!functionsSource.includes(marker)&&!booksHtml.includes(marker))fail(`Customer payable-to-capital correction workflow missing: ${marker}`);
  for(const marker of ['function linkedCustomerPayableId(entry)','p.movementId===entry.id','Close linked payable','Open customer payable'])if(!booksHtml.includes(marker))fail(`Journal-to-customer-payable navigation missing: ${marker}`);
  for(const marker of ['class="journal-table"','class="journal-date"','class="journal-entry"','class="journal-actions"','.journal-table{table-layout:fixed','overflow-wrap:anywhere'])if(!booksHtml.includes(marker))fail(`Responsive Journal table safeguard missing: ${marker}`);
  for(const marker of ['originalDate=BooksBridge.businessDate(original.occurredAt||original.postedAt||now)','date=isVoid?financeDate(BooksBridge.businessDate(original.occurredAt||original.postedAt||now)):financeDate(data.date)','Opening-balance corrections require a supporting reference and reason.'])if(!functionsSource.includes(marker))fail(`Period-correct journal/opening-balance authority missing: ${marker}`);
  for(const marker of ["opening=/^opening_balance/","opening&&d===CF_FROM","cashOpeningPreview","Resulting cash"])if(!booksHtml.includes(marker))fail(`Cash-flow opening correction/reconciliation preview missing: ${marker}`);
  for(const marker of ['cfIsCorrection','Plus / less: Balance corrections','not receipts or payments','s.totBegin+s.totAdd-s.totDed+s.corrections'])if(!booksHtml.includes(marker))fail(`Books cash-flow correction classification missing: ${marker}`);
  for(const marker of ['isCashCorrection','Balance corrections — not receipts or payments','totBegin+totAdd-totDed+s.corrections'])if(!adminSource.includes(marker))fail(`Admin cash-flow correction classification missing: ${marker}`);
  for(const marker of ['prepareManualBooksJournal','action==="correct_manual_journal"','action==="reverse_manual_journal"||action==="void_manual_journal"','correctionReplacementId','The selected payable is no longer open','Create supplier liabilities with New bill or Purchases'])if(!functionsSource.includes(marker))fail(`Manual journal correction/void/payable-link authority missing: ${marker}`);
  for(const marker of ['caseVersion:2','cashDifferenceCase','business_expense','supplier_purchase','staff_receivable','customer_refund','unrecorded_sale','capital_contribution','unexplained_overage','offset_prior_overage','offset_prior_shortage','salaries are never affected'])if(!adminSource.includes(marker))fail(`Unified Admin cash-difference treatment missing: ${marker}`);
  for(const marker of ['cash_difference_case_resolution','cashDifferenceCases','partially_resolved','cashDifferencePurchaseAdvances','purchasePayouts.push','financialControlLinks/correctionMovements','This variance correction has already been deposited or settled','Opposite cash variance ID','Cash Overage Under Review','normalizeAtomicUpdatePaths','assertNoOverlappingUpdatePaths'])if(!functionsSource.includes(marker))fail(`End-to-end cash-difference server safeguard missing: ${marker}`);
  for(const forbidden of ['writes[`cashDifferenceCases/${id}/allocations/${key}/resolutionMovementId`]=','writes[`discrepancies/${id}/resolutionAllocations/${key}/resolutionMovementId`]='])if(functionsSource.includes(forbidden))fail(`Cash-difference resolution must not send a parent record and one of its child fields in the same atomic update: ${forbidden}`);
  for(const marker of ['cashFinanceDateMismatches','automaticallyRepairFinanceDates','exports.autoRepairFinanceDateOnCashLedgerCreate','financialControlResolution','automatic_cash_date_alignment','systemDateMaintenance'])if(!functionsSource.includes(marker))fail(`Automatic finance-date maintenance or control-resolution safeguard missing: ${marker}`);
  for(const marker of ['Resolution guide','App.openControlResolution','System maintenance aligned','How to resolve it'])if(!booksHtml.includes(marker))fail(`Finance Books control-resolution guidance is missing: ${marker}`);
  for(const marker of ['Correct an Admin cash variance','linkedDiscrepancyId','Admin variance ·','Select the exact Admin cash shortage or overage'])if(!booksHtml.includes(marker))fail(`Finance-to-Admin variance link missing: ${marker}`);
  for(const marker of ['usesVarianceControl','Inventory control accounts must be corrected from Purchases','Receivable control accounts must be corrected from Receivables','Cash Overage Under Review','["2120","Accrued Salaries"'])if(!functionsSource.includes(marker)&&!booksHtml.includes(marker))fail(`Manual-journal subledger safeguard missing: ${marker}`);
  for(const marker of ['function fullyReversedCashIds(to)','originals.length!==1||voids.length!==1','fullyReversed[m.id]'])if(!adminSource.includes(marker))fail(`Cash-flow fully reversed-pair suppression missing: ${marker}`);
  for(const marker of ['function cfFullyReversedIds(to)','cfCashDelta(a)+cfCashDelta(b)','const fullyReversed=cfFullyReversedIds(CF_TO)','if(fullyReversed[m.id])return'])if(!booksHtml.includes(marker))fail(`Books cash-flow fully reversed-pair suppression missing: ${marker}`);
  for(const marker of ["function cfJournalBalance(code,cutoff,inclusive)","cfJournalBalance('1005',CF_FROM,false)","cfJournalBalance('1005',CF_TO,true)","begin.register=r2((begin.register||0)-floatBegin)","k==='register'?'Cash on Hand':k==='float'?'Register Cash Float'","reclassification does not change total cash"])if(!booksHtml.includes(marker))fail(`Books cash-flow register/float account split missing: ${marker}`);
  for(const marker of ['["1005","Register Cash Float","Asset"','Fixed imprest tied to POS Settings'])if(!booksHtml.includes(marker))fail(`Register cash-float asset missing: ${marker}`);
  for(const marker of ['PAID PERSONALLY BY OWNER/PARTNER','value="owner_funded"','action:\'purchase_owner_funded\'','ownerTreatment','reimburse later'])if(!adminSource.includes(marker)&&!booksHtml.includes(marker))fail(`Owner/partner-funded UI marker missing: ${marker}`);
  for(const marker of ['action === "purchase_owner_funded"','invoice.payMode !== "owner_funded"','ownerTreatment==="reimburse"','purchase_owner_funded_reversed','ownerOffset','fundingReversalMovementId'])if(!functionsSource.includes(marker))fail(`Owner/partner-funded purchase Finance Books marker missing: ${marker}`);
  for(const marker of ['personal_business_cost','liability:due_to_owner:','owner reimbursement','liabilityAccount','ownerReimbursementId'])if(!functionsSource.includes(marker)&&!booksHtml.includes(marker))fail(`Shared owner/partner funding marker missing: ${marker}`);
  if(!itemAccountBridgeSource.includes('office_supplies: "6075"'))fail('Revolving Fund office supplies must map to Books account 6075');
  for(const marker of ['transportation: "6076"','staff_meals: "6077"'])if(!itemAccountBridgeSource.includes(marker))fail(`Dedicated cash-payment account mapping missing: ${marker}`);
  for(const marker of ['repairPettyExpenseClassifications','petty_category_reclass_v1_','cashChanged:false','custodyChanged:false'])if(!functionsSource.includes(marker))fail(`Historical cash-payment classification repair missing: ${marker}`);
  for(const marker of ['App.repairPettyClassifications','Preview and repair mismatched cash payments','__repairPettyClassifications'])if(!booksHtml.includes(marker))fail(`Cash-payment classification repair UI missing: ${marker}`);
  if(!booksHtml.includes('["1040","Revolving Fund","Asset"]'))fail('Finance Books account 1040 is not visibly named Revolving Fund');
  for(const marker of ['function cashPaymentOccurredAt(row)','voucherNo:financeText(after.voucherNo','category:financeText(after.category','Record cash payment','data-ucvoucher','Net operating expenses in range'])if(!functionsSource.includes(marker)&&!undepositedSource.includes(marker))fail(`Undeposited cash-expense control missing: ${marker}`);
  for(const marker of ['block_cash_payment_without_custody','cashCustodyStatus','cashCustodyShortfall','cash_payment_missing_custody','Cash custody available for deposit','Approved cash payments and previous deposits reduce this balance immediately.'])if(!functionsSource.includes(marker)&&!undepositedSource.includes(marker))fail(`Cash-payment and deposit custody safeguard missing: ${marker}`);
  for(const marker of ['setUndepositedOpeningBalance','set_undeposited_opening_balance','undeposited_opening_balance','equity:opening_balance','Set beginning balance','Awaiting approval — not yet deducted from cash'])if(!functionsSource.includes(marker)&&!undepositedSource.includes(marker)&&!adminCoreItem.source.includes(marker))fail(`Undeposited beginning-balance or pending-payment marker missing: ${marker}`);
  for(const marker of ["'setUndepositedOpeningBalance'","'repairPettyVoucherFinancial'","'retireRevolvingFund'",'exports.repairPettyVoucherFinancial = onCall','missing from the ledger','Repair missing payments','financialRepairedAt','retireRevolvingFund:function(command)'])if(!functionsSource.includes(marker)&&!undepositedSource.includes(marker)&&!adminSource.includes(marker))fail(`Undeposited callable or missing-payment repair marker missing: ${marker}`);
  for(const marker of ['exports.getUndepositedControlSnapshot = onCall','authority:"server_all_time"','getUndepositedControlSnapshot:function()','Not affected by the report-date filter','missingApprovedVoucherIds'])if(!functionsSource.includes(marker)&&!undepositedSource.includes(marker)&&!adminCoreItem.source.includes(marker))fail(`Undeposited all-time control authority missing: ${marker}`);
  for(const marker of ['var d=(r&&r.data)||r||{},bal=Number(d.balance)||0','var d=(res&&res.data)||res||{};','if(d.retired)'])if(!undepositedSource.includes(marker))fail(`Undeposited callable response handling missing: ${marker}`);
  for(const marker of ['exports.repairClosedShiftTurnover = onCall','repair_closed_shift_turnover','savedShiftCashSales','Repair closed-shift turnover','shift_custody_${shiftId}'])if(!functionsSource.includes(marker)&&!undepositedSource.includes(marker))fail(`Closed-shift turnover repair missing: ${marker}`);
  for(const marker of ['exports.reconcileUndepositedCustody = onCall','reconcile_undeposited_custody','historical_finance_journal_custody_reconciliation','newFinancialMovement:false','Link existing Finance journal','Finance Books was unchanged'])if(!functionsSource.includes(marker)&&!undepositedSource.includes(marker))fail(`Ledger-to-custody reconciliation missing: ${marker}`);
  for(const marker of ['exports.repairReversedPayoutDeposit = onCall','repair_reversed_payout_deposit_${payoutId}','reversed_payout_deposit_repair','Only a reversed payout with an unreversed deposit can be repaired','depositReversalMovementId','Repair deposit'])if(!functionsSource.includes(marker)&&!adminSource.includes(marker))fail(`Reversed payout deposit repair missing: ${marker}`);
  for(const marker of ['Financial control exceptions','orphanedPayoutDeposits','App.repairPayoutDeposit=function','window.__booksRepairPayout','repairReversedPayoutDeposit'])if(!fs.readFileSync(path.join(root,'books.html'),'utf8').includes(marker))fail(`Books payout repair interface missing: ${marker}`);
  for(const marker of ['Journal period exceptions','App.repairLateJournalCorrection=function','repair_late_manual_journal_correction','manualJournalPeriodRepairs','Only a balanced cash-to-cash correction can use this controlled repair','manual_books_journal_period_repair_backdate','manual_books_journal_period_repair_current'])if(!(booksHtml.includes(marker)||functionsSource.includes(marker)))fail(`Late manual-journal correction repair control missing: ${marker}`);
  if(!functionsSource.includes('if (payout.reversed) throw new HttpsError("failed-precondition","A reversed payout cannot be deposited.")'))fail('Future deposits are not blocked after payout reversal');
  for(const marker of ['Deposit / move funds','function depositFunds(accountRows,available)',"action:'cash_deposit'",'Deposit slip / transfer reference','This is not income and does not change sales.','depositReference'])if(!undepositedSource.includes(marker)&&!functionsSource.includes(marker))fail(`Undeposited deposit workflow missing: ${marker}`);
  for(const marker of ['cashDepositReferences','referenceKey=crypto.createHash("sha256")','occurredAt: accountingTimestamp(depositDate,now)','This deposit reference is already being processed','total cash and income unchanged'])if(!functionsSource.includes(marker))fail(`Undeposited deposit date or duplicate-reference safeguard missing: ${marker}`);
  if(adminSource.includes('id="opsPurchaseAdvance"')||adminSource.includes('No authorized register disbursements.'))fail('Register Operations still exposes retired drawer disbursement controls.');
  if(!realtimeHubSource.includes("pettyCashVouchers:['petty','purchases','undeposited']"))fail('Purchases or Undeposited Collection cannot load Revolving Fund vouchers');
  for(const marker of ["pettyCashVouchers:['petty','purchases','undeposited']","cfAccounts:['purchases','cashflow','receivables','payables','payouts','undeposited']","financialMovements:['purchases','cashflow','receivables','payables','payouts','saleshistory','undeposited','discrepancy']","cashCustody:['cashflow','undeposited']"])if(!realtimeHubSource.includes(marker))fail(`Undeposited realtime scope missing: ${marker}`);
  if(booksHtml.includes('function seedEntries()'))fail('Accaza Books still seeds browser-only sample transactions');

  // Kitchen-ticket print-path XSS regression: extract the shipped window.printOrder from core.mjs by
  // brace matching (string/comment aware), execute it in a sandbox with the real shared-ui escHtml,
  // and require the poisoned ticket DOM to match a clean order ticket DOM with no injected markup.
  const printOrderHeader=(adminCoreItem.source.match(/window\.printOrder\s*=\s*function/)||[])[0];
  if(!printOrderHeader)fail('Admin core.mjs no longer ships window.printOrder');
  const printOrderStart=adminCoreItem.source.indexOf(printOrderHeader);
  let printOrderCursor=adminCoreItem.source.indexOf('{',printOrderStart+printOrderHeader.length);
  if(printOrderCursor<0)fail('window.printOrder function body is missing');
  let printOrderDepth=0,printOrderEnd=-1;
  while(printOrderCursor<adminCoreItem.source.length){
    const ch=adminCoreItem.source[printOrderCursor];
    if(ch==="'"||ch==='"'||ch==='`'){
      const quote=ch;printOrderCursor++;
      while(printOrderCursor<adminCoreItem.source.length&&adminCoreItem.source[printOrderCursor]!==quote){
        if(adminCoreItem.source[printOrderCursor]==='\\')printOrderCursor++;
        printOrderCursor++;
      }
    }else if(ch==='/'&&adminCoreItem.source[printOrderCursor+1]==='/'){
      while(printOrderCursor<adminCoreItem.source.length&&adminCoreItem.source[printOrderCursor]!=='\n')printOrderCursor++;
    }else if(ch==='/'&&adminCoreItem.source[printOrderCursor+1]==='*'){
      printOrderCursor+=2;
      while(printOrderCursor<adminCoreItem.source.length&&!(adminCoreItem.source[printOrderCursor]==='*'&&adminCoreItem.source[printOrderCursor+1]==='/'))printOrderCursor++;
      printOrderCursor++;
    }else if(ch==='{')printOrderDepth++;
    else if(ch==='}'){printOrderDepth--;if(printOrderDepth===0){printOrderEnd=printOrderCursor;break;}}
    printOrderCursor++;
  }
  if(printOrderEnd<0)fail('window.printOrder braces are unbalanced');
  const printOrderSource=adminCoreItem.source.slice(printOrderStart,printOrderEnd+1);
  const sharedUiSource=adminScripts.find(item=>item.name==='shared-ui.mjs');
  const escHtmlLine=sharedUiSource&&sharedUiSource.source.split(/\r?\n/).find(line=>line.startsWith('function escHtml('));
  if(!escHtmlLine)fail('shared-ui.mjs escHtml helper missing');
  const ticketPayload='img src=x onerror="window.__ticketPwn(1)"';
  const kitchenOrders={
    poisoned:{id:'PWN-1',type:'Delivery',total:2,items:'Espresso <'+ticketPayload+'>, Mocha <'+ticketPayload+'>',address:'12 Oz Lane <'+ticketPayload+'>',date:'<'+ticketPayload+'>',time:'<'+ticketPayload+'>',notes:'Ring the bell <'+ticketPayload+'>',name:'Mallory <'+ticketPayload+'>',phone:'0917 <'+ticketPayload+'>',contact:'<'+ticketPayload+'>',onDuty:'Duty <'+ticketPayload+'>',payment:'GCash <'+ticketPayload+'>'},
    clean:{id:'PWN-1',type:'Delivery',total:2,items:'Espresso, Mocha',address:'12 Oz Lane',date:'Aug 29',time:'2:30 PM',notes:'Ring the bell',name:'Mallory',phone:'0917 000 0000',contact:'0906 000 0000',onDuty:'Duty',payment:'GCash'}
  };
  const kitchenTickets=[];
  const kitchenSandbox={
    adminOrdersMap:kitchenOrders,
    window:{open:function(){return{document:{write:function(html){kitchenTickets.push(String(html));},close:function(){}},focus:function(){},print:function(){}};}},
    setTimeout:function(){}
  };
  try{
    vm.runInNewContext(escHtmlLine+'\n'+printOrderSource+'\nwindow.printOrder("poisoned");window.printOrder("clean");',kitchenSandbox);
  }catch(error){fail('kitchen-ticket printOrder threw while rendering: '+error.message);}
  if(kitchenTickets.length!==2)fail('kitchen-ticket regression could not render both tickets');
  const decodeTicketText=text=>text.replace(/&(amp|lt|gt|quot|#39);/g,(match,entity)=>({amp:'&',lt:'<',gt:'>',quot:'"','#39':"'"}[entity]));
  function ticketEvents(html){
    const events=[];let index=0;
    while(index<html.length){
      const next=html.indexOf('<',index);
      if(next<0){events.push({type:'text',text:decodeTicketText(html.slice(index))});break;}
      if(next>index)events.push({type:'text',text:decodeTicketText(html.slice(index,next))});
      if(html.startsWith('<!--',next)){
        const end=html.indexOf('-->',next);
        if(end<0)fail('kitchen ticket has an unterminated comment');
        index=end+3;continue;
      }
      if(html[next+1]==='!'){const end=html.indexOf('>',next);index=end+1;continue;}
      const close=html.indexOf('>',next);
      if(close<0)fail('kitchen ticket has an unterminated tag');
      let raw=html.slice(next+1,close).trim();
      const selfClose=raw.endsWith('/');
      if(selfClose)raw=raw.slice(0,-1).trim();
      if(raw.startsWith('/'))events.push({type:'close',tag:raw.slice(1).trim().toLowerCase()});
      else{
        const tag=(raw.match(/^[^\s/]+/)||[''])[0].toLowerCase();
        const attrs={};const attrPattern=/([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;let attrMatch;
        while((attrMatch=attrPattern.exec(raw)))attrs[attrMatch[1].toLowerCase()]=attrMatch[2]??attrMatch[3]??attrMatch[4]??'';
        events.push({type:'open',tag,attrs});
      }
      index=close+1;
    }
    return events;
  }
  const poisonedEvents=ticketEvents(kitchenTickets[0]),cleanEvents=ticketEvents(kitchenTickets[1]);
  for(const event of poisonedEvents){
    if(event.type!=='open')continue;
    if(event.tag==='img')fail('kitchen-ticket print path injected a raw <img> element from order data');
    if('onerror' in event.attrs)fail('kitchen-ticket print path injected an onerror attribute from order data');
    for(const attribute of Object.keys(event.attrs))if(/^on/i.test(attribute))fail(`kitchen-ticket print path injected a ${attribute} handler attribute from order data`);
  }
  const ticketShape=events=>events.filter(event=>event.type!=='text').map(event=>event.type==='open'?{type:'open',tag:event.tag,attrs:Object.keys(event.attrs).sort().map(key=>key+'='+event.attrs[key]).join('&')}:event);
  if(JSON.stringify(ticketShape(poisonedEvents))!==JSON.stringify(ticketShape(cleanEvents)))fail('poisoned kitchen-ticket DOM structure differs from a clean order ticket DOM');
  const poisonedText=poisonedEvents.filter(event=>event.type==='text').map(event=>event.text).join('\n');
  if(!poisonedText.includes(ticketPayload))fail('kitchen-ticket print path dropped order data instead of escaping it');

  const reconciliation=require(path.join(root,'functions','lib','reconciliation-controls.js'));
  const rules=reconciliation.DEFAULT_ACCOUNT_RULES,legacyJournal={old_a:{date:'2026-08-29',lines:[{code:'1900',debit:0,credit:100}]},old_b:{date:'2026-08-30',lines:[{code:'1900',debit:25,credit:0}]},new_a:{date:'2026-08-31',lines:[{code:'1900',debit:10,credit:0}]}},before=JSON.stringify(legacyJournal);
  const controlIssues=reconciliation.controlAccountIssues(legacyJournal,rules);
  if(controlIssues.length!==1||controlIssues[0].code!=='1900'||controlIssues[0].balance!==10||controlIssues[0].count!==1)fail('Control audit did not isolate post-cutover clearing activity');
  if(JSON.stringify(legacyJournal)!==before)fail('Read-only reconciliation audit changed journal history or balances');
  if(reconciliation.controlAccountIssues({cash:{date:'2026-08-31',lines:[{code:'1000',debit:500,credit:0}]}},rules).length)fail('Normal balance-sheet accounts were incorrectly treated as zero-balance clearing accounts');
  if(reconciliation.operationalDiscrepancy({kind:'cash',status:'open',date:'2026-08-29',variance:-50}))fail('Closed legacy discrepancy resurfaced in the server audit');
  if(!reconciliation.operationalDiscrepancy({kind:'cash',status:'open',date:'2026-08-30',variance:-120})||!reconciliation.operationalDiscrepancy({kind:'cash',status:'open',date:'2026-08-31',variance:25}))fail('Protected or post-cutover discrepancy was hidden from the server audit');

  console.log(`PASS: ${checked} executable HTML and external scripts parsed successfully.`);
  console.log('PASS: shared reconciliation controls isolate legacy history, retain new exceptions, and remain rebuild-safe.');
  console.log('PASS: customer-field rendering containment checks passed.');
  console.log('PASS: database rule structure and Release 1A limits are present.');
  console.log('PASS: Release 1B authentication and role-enforcement guards are present.');
  console.log('PASS: Release 1C server-pricing and customer-ownership guards are present.');
  console.log('PASS: kitchen-ticket print path escapes every customer-supplied field; a poisoned ticket DOM matches a clean order.');
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
  process.stdout.write(salesHistoryAutoloadCheck.stdout);
  process.stdout.write(archiveOrderSortCheck.stdout);
  process.stdout.write(inventoryBooksReconciliationCheck.stdout);
  process.stdout.write(operationalExceptionsCheck.stdout);
  process.stdout.write(managerApprovalCheck.stdout);
  process.stdout.write(financialCloseCheck.stdout);
  console.log('PASS: functions/index.js syntax is valid.');
}finally{
  fs.rmSync(temp,{recursive:true,force:true});
}
