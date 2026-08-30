// Database rules, portal access, and customer ownership boundaries.
export function run(context){
const {fs,path,vm,spawnSync,root,require,htmlFiles,temp,state,fail,section,adminScripts,customerScripts,booksScripts,adminStyles,customerStyles,adminHtml,customerHtml,booksPageHtml,adminSource,customerSource,booksSource,financialSource}=context;
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

context.rulesRaw=rulesRaw;
}
