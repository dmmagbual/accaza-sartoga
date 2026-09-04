import{app,db,auth,callables,ref,set,get,push,update,remove,onValue,runTransaction,query,orderByChild,limitToLast,startAt,endAt,endBefore,getMessaging,getToken,onMessage,isSupported,sendPasswordResetEmail,updatePassword,reauthenticateWithCredential,EmailAuthProvider}from"./firebase-client.mjs";
import{createSubscriptionHub}from"./realtime-hub.mjs?v=445";
import{readSalesPeriod,periodKey}from'./sales-period-data.mjs?v=445';
import{createHistoryPager}from"./history-pager.mjs";
import{requestManagerApproval}from"./manager-approval.mjs";
import{installPortalAuth}from"./portal-auth.mjs";
import{createOrderAdmin,archiveOutcome}from"./admin-orders.mjs";
import{createOverviewHistoryLoader,createOverviewInsights,mergeOverviewOrders}from"./overview-insights.mjs?v=445";
import{createCustomerRegistry}from"./customer-registry.mjs";
import{createReservationManager}from"./reservations.mjs";
import{createCatalogAdmin}from"./catalog-admin.mjs";
import{createAppCustomerSession}from"./app-customer-session.mjs";
import{createCustomerOrderTracker}from"./customer-order-tracker.mjs";
import{escHtml,safeImageSrc}from"./shared-ui.mjs";
import{installWorkspaceShell}from"./workspace-shell.mjs";
import{sortArchivedOrders,summarizeArchivedOrders}from"./archive-order-sort.mjs";

const {getPaymentProof:getPaymentProofCall,ensureActiveOrders:ensureActiveOrdersCall,updateOrderStatus:updateOrderStatusCall,postInventoryMovements:postInventoryMovementsCall,ensureInventoryLedger:ensureInventoryLedgerCall,validateRecipeDefinition:validateRecipeDefinitionCall,postFinancialCommand:postFinancialCommandCall,reconcilePurchasePayable:reconcilePurchasePayableCall,managePurchaseCorrection:managePurchaseCorrectionCall,manageFixedAsset:manageFixedAssetCall,settlePlatformPayout:settlePlatformPayoutCall,processOrderAdjustment:processOrderAdjustmentCall,ensureFinancialLedger:ensureFinancialLedgerCall,manageCashAccount:manageCashAccountCall,manageAccountingPeriod:manageAccountingPeriodCall,consumeManagerApproval:consumeManagerApprovalCall,manageChartAccount:manageChartAccountCall,auditFinancialControls:auditFinancialControlsCall,manageOrderArchive:manageOrderArchiveCall,reviewDiscrepancy:reviewDiscrepancyCall,reopenDiscrepancy:reopenDiscrepancyCall,managePettyVoucher:managePettyVoucherCall,setUndepositedOpeningBalance:setUndepositedOpeningBalanceCall,repairPettyVoucherFinancial:repairPettyVoucherFinancialCall,retireRevolvingFund:retireRevolvingFundCall,repairClosedShiftTurnover:repairClosedShiftTurnoverCall,repairReversedPayoutDeposit:repairReversedPayoutDepositCall,reconcileUndepositedCustody:reconcileUndepositedCustodyCall,runFinancialClose:runFinancialCloseCall,archiveActivityLog:archiveActivityLogCall}=callables;
window.__accazaAuth=auth;
const subscriptionHub=createSubscriptionHub(db,{ref,onValue,query,orderByChild,limitToLast,startAt,endAt,endBefore,get});
window.__accazaLiveStats=function(){return subscriptionHub.stats();};
const renderHistoryPager=createHistoryPager(subscriptionHub);
window.__fbForgot=function(){var current=(document.getElementById('adminUser').value||'').trim();if(!window.AccazaFormDialog){alert('Form service unavailable. Refresh and try again.');return;}window.AccazaFormDialog.run({title:'Reset portal password',subtitle:'Firebase will send the reset link to this account.',submitLabel:'Send reset link',busyLabel:'Sendingâ€¦',fields:[{name:'email',label:'Firebase account email',type:'email',required:true,value:current,validate:function(v){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)?'':'Enter a valid email address.';}}]},function(v){return sendPasswordResetEmail(auth,v.email).then(function(){return v;});}).then(function(v){alert('Password reset link sent to '+v.email+'. Check inbox and spam.');}).catch(function(e){if(e&&e.code!=='cancelled')alert('Could not send reset: '+((e&&e.code)||e));});};
const VAPID_KEY="BIIVf-1RYIQger0yqeYlyV6-tQpH8YfytIgQK6-7IJg87HVITcNkYv4RYcKjyCmJBJKR1EXjJqRuiHzkFJjSvlE";
function _pushToastWire(messaging){onMessage(messaging,function(payload){var d=(payload&&(payload.data||payload.notification))||{};try{if(navigator.vibrate)navigator.vibrate([400,150,400,150,400,150,400]);}catch(e){}try{customerOrderTracker.playChime();}catch(e){}try{navigator.serviceWorker.ready.then(function(reg){reg.showNotification(d.title||'Accaza Coffee House',{body:d.body||'',icon:'/favicon_192x192.png',badge:'/favicon_192x192.png',vibrate:[400,150,400,150,400,150,400],requireInteraction:true,renotify:true,tag:'accaza-order',data:{link:(d.link||'/')}});});}catch(e){}try{(window.accazaToast||function(){})((d.title?d.title+': ':'')+(d.body||'New notification'),'ok');}catch(e){}});}
async function registerPushToken(){
  try{
    if(!VAPID_KEY||VAPID_KEY.indexOf('PASTE_')===0)return;
    if(!('serviceWorker' in navigator)||!('Notification' in window))return;
    if(Notification.permission!=='granted')return;
    if(!(await isSupported()))return;
    var reg=await navigator.serviceWorker.ready;
    var messaging=getMessaging(app);
    var token=await getToken(messaging,{vapidKey:VAPID_KEY,serviceWorkerRegistration:reg});
    if(token){var u=appCustomerSession.getUser();var au=auth.currentUser;if(u&&au){try{await update(ref(db,'appCustomers/'+au.uid),{pushToken:token,pushTokenAt:Date.now()});if(!window.__pushToasted){window.__pushToasted=true;(window.accazaToast||function(){})('ðŸ”” Notifications on for this device','ok');}}catch(e){}}}
    _pushToastWire(messaging);
  }catch(e){}
}
async function setupPush(){
  try{
    if(!('Notification' in window))return;
    if(Notification.permission==='default'){try{await Notification.requestPermission();}catch(e){}}
    if(Notification.permission==='granted'){await registerPushToken();}
  }catch(e){}
  refreshNotifyPrompt();
}
function refreshNotifyPrompt(){
  var b=document.getElementById('enableNotifyBtn');if(!b)return;
  if(!appCustomerSession.isAppMode()||!('Notification' in window)){b.style.display='none';return;}
  if(Notification.permission==='granted'){b.style.display='none';return;}
  b.style.display='block';
  b.textContent=(Notification.permission==='denied')?'ðŸ”” Notifications blocked â€” tap for help':'ðŸ”” Enable order-ready notifications';
}
window.enableNotifications=async function(){
  if(!('Notification' in window))return;
  if(Notification.permission==='denied'){(window.accazaToast||window.alert)('Notifications are turned off for Accaza. Please enable them in your browser/app settings (Site settings â†’ Notifications), then reopen the app.');return;}
  await setupPush();
  refreshNotifyPrompt();
};
window.__setupPush=setupPush;

const feedbacksRef=ref(db,'feedbacks'),reviewsRef=ref(db,'reviews'),availRef=ref(db,'availability'),paymentRef=ref(db,'payment'),menuRef=ref(db,'menuItems'),categoriesRef=ref(db,'categories'),optionGroupsRef=ref(db,'optionGroups');
window.__accaza={
  db, ref, set, get, update, remove, onValue, runTransaction, hub:subscriptionHub,
  subscribe:function(path,callback,opts){return subscriptionHub.subscribe(path,callback,opts);},
  postInventoryMovements:function(movements){return postInventoryMovementsCall({movements:movements});},
  ensureInventoryLedger:function(){return ensureInventoryLedgerCall({});},
  validateRecipeDefinition:function(recipe){return validateRecipeDefinitionCall({recipe:recipe});},
  postFinancialCommand:function(command){return postFinancialCommandCall(command);},
  reconcilePurchasePayable:function(command){return reconcilePurchasePayableCall(command);},
  managePurchaseCorrection:function(command){return managePurchaseCorrectionCall(command);},
  manageFixedAsset:function(command){return manageFixedAssetCall(command);},
  settlePlatformPayout:function(command){return settlePlatformPayoutCall(command);},
  processOrderAdjustment:function(command){return processOrderAdjustmentCall(command);},
  ensureFinancialLedger:function(){return ensureFinancialLedgerCall({});},
  manageCashAccount:function(command){return manageCashAccountCall(command);},
  manageAccountingPeriod:function(command){return manageAccountingPeriodCall(command);},
  managerApproval:requestManagerApproval,
  consumeManagerApproval:function(command){return consumeManagerApprovalCall(command);},
  manageChartAccount:function(command){return manageChartAccountCall(command);},
  auditFinancialControls:function(){return auditFinancialControlsCall({});},
  manageOrderArchive:function(command){return manageOrderArchiveCall(command);},
  updateOrderStatus:function(command){return updateOrderStatusCall(command);},
  acceptOnlineOrder:c=>callables.acceptOnlineOrder(c),
  reviewDiscrepancy:function(command){return reviewDiscrepancyCall(command);},
  reopenDiscrepancy:function(command){return reopenDiscrepancyCall(command);},
  managePettyVoucher:function(command){return managePettyVoucherCall(command);},
  manageSupplier:function(command){return callables.manageSupplier(command);},
  setUndepositedOpeningBalance:function(command){return setUndepositedOpeningBalanceCall(command);},
  repairPettyVoucherFinancial:function(command){return repairPettyVoucherFinancialCall(command);},
  retireRevolvingFund:function(command){return retireRevolvingFundCall(command);},
  getUndepositedControlSnapshot:function(){return callables.getUndepositedControlSnapshot({});},
  repairClosedShiftTurnover:function(command){return repairClosedShiftTurnoverCall(command);},
  repairReversedPayoutDeposit:function(command){return repairReversedPayoutDepositCall(command);},
  reconcileUndepositedCustody:function(command){return reconcileUndepositedCustodyCall(command);},
  runFinancialClose:function(command){return runFinancialCloseCall(command);},
  archiveActivityLog:function(){return archiveActivityLogCall({});},
  syncOfflinePosSale:function(command){return callables.syncOfflinePosSale(command);},
  recordPlatformCatchup:function(command){return callables.recordPlatformCatchup(command);},
  correctPlatformPresettlement:function(command){return callables.correctPlatformPresettlement(command);},
  reversePlatformPayout:function(command){return callables.reversePlatformPayout(command);},
  setPlatformPayoutDate:function(command){return callables.setPlatformPayoutDate(command);},
  ensureShiftReference:function(command){return callables.ensureShiftReference(command);},
  manageStaffMessage:function(command){return callables.manageStaffMessage(command);},
  manageIncident:function(command){return callables.manageIncident(command);},
  getProductionCertification:function(){return callables.getProductionCertification({});},
  getProductionValidation:function(){return callables.getProductionValidation({});},
  recordClientTelemetry:function(command){return callables.recordClientTelemetry(command);},
  getOperationalExceptions:function(){return callables.getOperationalExceptions({});},
  repairOrderInventoryMarker:function(orderId){return callables.repairOrderInventoryMarker({orderId:orderId});},
  get menuItemsMap(){return menuItemsMap;},
  get optionGroupsMap(){return optionGroupsMap;},
  get categoriesMap(){return categoriesMap;},
  get adminOrdersMap(){return adminOrdersMap;},
  get currentUser(){return (typeof currentUser!=='undefined')?currentUser:null;},
  getMenuItems, getCats, getCatLabel, getCatIcon, getItemOptionGroups, formatPrice
};

let staffAccountsMap={},adminAccountsMap={},staffLoggedIn=false,superAdminLoggedIn=false,currentUser=null,currentLoginRole=null;
const SUPER_ADMIN_USERNAME='superadmin',CAFE_PHONE='639276924831',CAFE_EMAIL='admin@accazacoffee.com';

const DEFAULT_CATS=[
  {id:'coffee',label:'Coffee Based',icon:'â˜•',order:0},
  {id:'noncaf',label:'Non-Coffee Based',icon:'ðŸŒ¿',order:1},
  {id:'frappe',label:'Iced Blended Coffee',icon:'ðŸ¥¤',order:2},
  {id:'nonfrappe',label:'Iced Blended Non-Coffee',icon:'ðŸ§Š',order:3},
  {id:'soda',label:'Soda-Based Refreshers',icon:'ðŸ‹',order:4},
  {id:'pastry',label:'Pastries',icon:'ðŸž',order:5}
];

const DRINK_CATS=['coffee','noncaf','frappe','nonfrappe','soda'];
const TEMP_CATS=['coffee','noncaf'];
const MILK_CATS=['coffee','noncaf','frappe','nonfrappe'];
const SHOT_CATS=['coffee','frappe'];
const SYRUP_CATS=['coffee','noncaf','frappe','nonfrappe'];
const TOPPING_CATS=['coffee','noncaf','frappe','nonfrappe','soda'];

const DEFAULT_OPTION_GROUPS={
  og_temp:{name:'Temperature',type:'single',required:true,order:0,choices:[{label:'Hot',price:0},{label:'Cold (Chilled, no ice)',price:0},{label:'Iced (with ice)',price:0}]},
  og_sweet:{name:'Sweetness',type:'single',required:true,order:1,choices:[{label:'Not Sweet',price:0},{label:'Less Sweet',price:0},{label:'Regular',price:0}]},
  og_milk:{name:'Choice of Milk',type:'single',required:true,order:2,choices:[{label:'Whole Milk',price:0},{label:'Goodmate Sub Oat',price:65}]},
  og_shot:{name:'Add Espresso Shot',type:'multi',required:false,order:3,choices:[{label:'Add 1 Shot',price:55}]},
  og_syrup:{name:'Add Syrup',type:'multi',required:false,order:4,choices:[{label:'Sugar Syrup',price:25},{label:'Sea Salt Caramel Syrup',price:40},{label:'White Chocolate Syrup',price:40},{label:'Toffee Nut Syrup',price:40},{label:'Hazelnut Syrup',price:40}]},
  og_top:{name:'Toppings',type:'multi',required:false,order:5,choices:[{label:'Sea Salt Cold Foam',price:35},{label:'Whipped Cream',price:35},{label:'Chocolate Chip',price:35}]}
};
function legacyOptionIdsFor(cat){
  var ids=[];
  if(TEMP_CATS.includes(cat))ids.push('og_temp');
  if(DRINK_CATS.includes(cat))ids.push('og_sweet');
  if(MILK_CATS.includes(cat))ids.push('og_milk');
  if(SHOT_CATS.includes(cat))ids.push('og_shot');
  if(SYRUP_CATS.includes(cat))ids.push('og_syrup');
  if(TOPPING_CATS.includes(cat))ids.push('og_top');
  return ids;
}
function getEffectiveOptionIds(item){return item.options?item.options:(item.optionsSet?[]:legacyOptionIdsFor(item.cat));}
function getItemOptionGroups(item){
  return getEffectiveOptionIds(item).map(function(id){var g=optionGroupsMap[id];return g?Object.assign({},g,{id:id}):null;}).filter(Boolean).sort(function(a,b){return(a.order||0)-(b.order||0);});
}

let overviewCashAccounts={},categoriesMap={},menuItemsMap={},adminOrdersMap={},overviewOrdersMap={},archivedOrdersMap={},feedbacksMap={},reviewsMap={},availability={},cart={},overviewOrdersLoaded=false,archivedOrdersLoaded=false,overviewFinancialMovementsLoaded=false,overviewCatType={};
let optionGroupsMap={},optSeedStarted=false,itemOptMigrated=false;
let knownOrderIds=null,unseenOrders=0,orderChimeTimer=null,audioCtx=null;
let orderType='pickup',paymentType='gcash',contactMethod='whatsapp';
let adminLoggedIn=false;
let chatOpen=false,chatStarted=false;
let custItem=null,custSize=null,custSel={},custQty=1;
let menuFilter='coffee',orderFilter=null;

const overviewInsights=createOverviewInsights({esc:escHtml,historyStatus:function(path){return subscriptionHub.historyStatus(path);},loadOlder:function(path){return subscriptionHub.loadOlder(path);},readRanking:async function(r){var p={startAt:r.start,endAt:r.end},maps=await Promise.all(['orders','archivedOrders'].map(function(path){return readSalesPeriod(db,{ref,get,query,orderByChild,startAt,endAt},path,p);}));return mergeOverviewOrders([],Object.entries(maps[0]).map(function(x){return Object.assign({_overviewKey:x[0]},x[1]);}),Object.entries(maps[1]).map(function(x){return Object.assign({_overviewKey:x[0]},x[1]);}));},refreshHistory:function(){return ensureOverviewFullHistory(true);}});

const appCustomerSession=createAppCustomerSession({setupPush:setupPush,refreshNotifyPrompt:refreshNotifyPrompt});
const customerOrderTracker=createCustomerOrderTracker({getOrders:function(){return adminOrdersMap;},escHtml:escHtml});

const reservationManager=createReservationManager({subscriptionHub:subscriptionHub,isPortalActive:function(){return adminLoggedIn||staffLoggedIn;},onReservationsChanged:updateStats,playChime:playChime,showDeletePopup:showDeletePopup});
const renderReservations=reservationManager.renderReservations,renderCustomerCalendar=reservationManager.renderCustomerCalendar,renderAdminCalendar=reservationManager.renderAdminCalendar;
const catalogAdmin=createCatalogAdmin({getCategoriesMap:function(){return categoriesMap;},getMenuItemsMap:function(){return menuItemsMap;},getOptionGroupsMap:function(){return optionGroupsMap;},getAvailability:function(){return availability;},getCats:getCats,getMenuItems:getMenuItems,getEffectiveOptionIds:getEffectiveOptionIds,isAvail:isAvail,isStaffLoggedIn:function(){return staffLoggedIn;},showDeletePopup:showDeletePopup,renderMenuSection:renderMenuSection,renderOrderSection:renderOrderSection});
const renderCategoryManager=catalogAdmin.renderCategoryManager,renderOptionManager=catalogAdmin.renderOptionManager,renderNewItemOptionChecklist=catalogAdmin.renderNewItemOptionChecklist,renderStaffMenu=catalogAdmin.renderStaffMenu,buildAvail=catalogAdmin.buildAvail;

document.getElementById('fbSync').classList.add('online');
setTimeout(()=>document.getElementById('fbSync').style.display='none',4000);

function getCats(){return Object.values(categoriesMap).sort((a,b)=>(a.order||0)-(b.order||0));}
function getCatLabel(id){const c=categoriesMap[id];return c?c.icon+' '+c.label:id;}
function getCatIcon(id){const c=categoriesMap[id];return c?c.icon:'â˜•';}
function getMenuItems(){return Object.entries(menuItemsMap).map(([k,v])=>({...v,key:k}));}
function isAvail(name){return availability[name]!==false;}
function isDrink(cat){return DRINK_CATS.includes(cat);}
function formatPrice(item){if(item.priceM&&item.priceL)return'S â‚±'+item.priceS+' Â· M â‚±'+item.priceM+' Â· L â‚±'+item.priceL;return'â‚±'+item.priceS;}

function seedTabsFromDefaults(){
  const cats=DEFAULT_CATS;
  const mrow=document.getElementById('menuTabsRow');
  const orow=document.getElementById('orderTabsRow');
  const sel=document.getElementById('newItemCat');
  if(mrow)mrow.innerHTML=cats.map(c=>'<button class="tab-btn'+(c.id==='coffee'?' active':'')+'" data-cat="'+c.id+'">'+c.icon+' '+c.label+'</button>').join('');
  if(orow)orow.innerHTML=cats.map(c=>'<button class="otab" data-cat="'+c.id+'">'+c.icon+' '+c.label+'</button>').join('');
  if(sel)sel.innerHTML=cats.map(c=>'<option value="'+c.id+'">'+c.icon+' '+c.label+'</option>').join('');
  attachTabListeners();
}
seedTabsFromDefaults();

function attachTabListeners(){
  document.querySelectorAll('#menuTabsRow .tab-btn').forEach(btn=>{
    btn.onclick=function(){filterMenu(this.dataset.cat,this);};
  });
  document.querySelectorAll('#orderTabsRow .otab').forEach(btn=>{
    btn.onclick=function(){filterOrder(this.dataset.cat,this);};
  });
}

function rebuildTabs(){
  const cats=getCats();
  const mrow=document.getElementById('menuTabsRow');
  const orow=document.getElementById('orderTabsRow');
  const sel=document.getElementById('newItemCat');
  if(mrow){mrow.innerHTML=cats.map(c=>'<button class="tab-btn'+(menuFilter===c.id?' active':'')+'" data-cat="'+c.id+'">'+c.icon+' '+c.label+'</button>').join('');}
  if(orow){orow.innerHTML=cats.map(c=>'<button class="otab'+(orderFilter===c.id?' active':'')+'" data-cat="'+c.id+'">'+c.icon+' '+c.label+'</button>').join('');}
  if(sel){const prev=sel.value;sel.innerHTML=cats.map(c=>'<option value="'+c.id+'">'+c.icon+' '+c.label+'</option>').join('');if(prev&&cats.find(c=>c.id===prev))sel.value=prev;}
  attachTabListeners();
}

subscriptionHub.subscribe('categories',snap=>{
  const saved=snap.val();
  if(saved){categoriesMap=saved;}
  else{const seed={};DEFAULT_CATS.forEach(c=>{seed[c.id]=c;});set(categoriesRef,seed);categoriesMap=seed;}
  rebuildTabs();
  renderMenuSection();
  renderOrderSection();
  if(adminLoggedIn){buildAvail();renderCategoryManager();}
});

subscriptionHub.subscribe('staffAccounts',snap=>{
  staffAccountsMap=snap.val()||{};
  if(adminLoggedIn||superAdminLoggedIn) renderStaffAccounts();
});

subscriptionHub.subscribe('adminAccounts',snap=>{
  adminAccountsMap=snap.val()||{};
  if(superAdminLoggedIn) renderAdminAccounts();
});

function migrateItemOptions(){
  if(itemOptMigrated)return;
  if(!Object.keys(menuItemsMap).length||!Object.keys(optionGroupsMap).length)return;
  var updates={};
  Object.keys(menuItemsMap).forEach(function(k){
    var it=menuItemsMap[k];
    if(it&&!it.optionsSet){
      var ids=legacyOptionIdsFor(it.cat);
      updates['menuItems/'+k+'/optionsSet']=true;
      if(ids.length)updates['menuItems/'+k+'/options']=ids;
    }
  });
  itemOptMigrated=true;
  if(Object.keys(updates).length)update(ref(db),updates).catch(function(){});
}
subscriptionHub.subscribe('optionGroups',snap=>{
  if(snap.exists()){optionGroupsMap=snap.val();}
  else if(!optSeedStarted){
    optSeedStarted=true;
    optionGroupsMap=DEFAULT_OPTION_GROUPS;
    set(optionGroupsRef,DEFAULT_OPTION_GROUPS).catch(function(){});
  }
  migrateItemOptions();
  if(adminLoggedIn)renderOptionManager();
  renderNewItemOptionChecklist();
});

subscriptionHub.subscribe('cfAccounts',snap=>{
  overviewCashAccounts=snap.val()||{};
  if(adminLoggedIn||staffLoggedIn){var ct=document.getElementById('tab-dashboard');if(ct&&ct.style.display!=='none')renderDashboard();}
});

subscriptionHub.subscribe('posSettings',snap=>{
  overviewCatType=((snap.val()||{}).catType)||{};
  if(adminLoggedIn||staffLoggedIn){var dt=document.getElementById('tab-dashboard');if(dt&&dt.style.display!=='none')renderDashboard();}
});

subscriptionHub.subscribe('menuItems',snap=>{
  const saved=snap.val();
  if(saved){menuItemsMap=saved;}
  else{
    const seed={};
    const defaultMenu=[
      {cat:'coffee',name:'Espresso Tonic',desc:'Bright espresso over tonic water with a citrus kick.',priceS:205,priceM:215,priceL:225},
      {cat:'coffee',name:'Americano',desc:'Bold espresso rounded out with water.',priceS:155,priceM:165,priceL:175},
      {cat:'coffee',name:'Cafe Latte',desc:'Smooth espresso paired with milk for a creamy, balanced finish.',priceS:175,priceM:185,priceL:195},
      {cat:'coffee',name:'Cappuccino',desc:'Espresso with milk and light, creamy cold foam.',priceS:185,priceM:195,priceL:205},
      {cat:'coffee',name:'French Vanilla',desc:'Espresso with french vanilla flavor, milk, and condensed milk.',priceS:205,priceM:215,priceL:225},
      {cat:'coffee',name:'Caramel Macchiato',desc:'Layers of espresso, vanilla, and caramel.',priceS:205,priceM:215,priceL:225},
      {cat:'coffee',name:'Spanish Latte',desc:'Rich and creamy blend of espresso, milk and sweet condensed milk.',priceS:195,priceM:205,priceL:215},
      {cat:'coffee',name:'Sea Salt Caramel Latte',desc:'Sweet and salty caramel espresso.',priceS:205,priceM:215,priceL:225},
      {cat:'coffee',name:'Sea Salt Latte',desc:'Rich, velvety coffee with bold, creamy and subtly salty notes.',priceS:205,priceM:215,priceL:225},
      {cat:'coffee',name:'Nougat',desc:'Espresso with coconut and toffee nut notes.',priceS:205,priceM:215,priceL:225},
      {cat:'coffee',name:'White Chocolate Mocha',desc:'Smooth espresso with sweet white chocolate and milk.',priceS:205,priceM:215,priceL:225},
      {cat:'coffee',name:'Mocha',desc:'Classic dark chocolate and espresso with milk.',priceS:205,priceM:215,priceL:225},
      {cat:'coffee',name:'Banana Oat Latte',desc:'Creamy oat milk latte with espresso and banana sweetness.',priceS:205,priceM:215,priceL:225},
      {cat:'coffee',name:'Raspberry Oat Latte',desc:'Oat milk latte with espresso and fresh raspberry notes.',priceS:205,priceM:215,priceL:225},
      {cat:'coffee',name:'Cinnamon Oat Latte',desc:'Cinnamon spice blended with espresso and oat milk.',priceS:205,priceM:215,priceL:225},
      {cat:'noncaf',name:'White Chocolate',desc:'White chocolate with milk and condensed milk.',priceS:205,priceM:215,priceL:225},
      {cat:'noncaf',name:'Dark Chocolate',desc:'Rich dark chocolate with milk and condensed milk.',priceS:205,priceM:215,priceL:225},
      {cat:'noncaf',name:'Banana Oat',desc:'Oat milk and banana flavor, sweetened with condensed milk.',priceS:205,priceM:215,priceL:225},
      {cat:'noncaf',name:'Raspberry Oat',desc:'Oat milk with raspberry flavor, sweetened with condensed milk.',priceS:205,priceM:215,priceL:225},
      {cat:'noncaf',name:'Cinnamon Oat',desc:'Oat milk infused with cinnamon and condensed milk.',priceS:205,priceM:215,priceL:225},
      {cat:'noncaf',name:'Matcha Latte',desc:'Matcha with milk, sweetened with condensed milk.',priceS:205,priceM:215,priceL:225},
      {cat:'frappe',name:'Caramel Frappe',desc:'Espresso blended with caramel, topped with whipped cream.',priceS:205,priceM:215,priceL:225},
      {cat:'frappe',name:'Java Chip',desc:'Espresso and dark chocolate blended with chocolate chips.',priceS:205,priceM:215,priceL:225},
      {cat:'frappe',name:'Toffee Nut Frappe',desc:'Espresso infused with toffee nut, blended smooth.',priceS:195,priceM:205,priceL:215},
      {cat:'frappe',name:'Caramel Cream Frappe',desc:'Espresso blended with caramel and vanilla.',priceS:205,priceM:215,priceL:225},
      {cat:'frappe',name:'White Mocha Frappe',desc:'Espresso blended with creamy white chocolate.',priceS:205,priceM:215,priceL:225},
      {cat:'frappe',name:'Dark Mocha Frappe',desc:'Espresso blended with rich dark chocolate.',priceS:205,priceM:215,priceL:225},
      {cat:'frappe',name:'Butterscotch Frappe',desc:'Espresso blended with butterscotch.',priceS:195,priceM:205,priceL:215},
      {cat:'frappe',name:'Cappuccino Frappe',desc:'Espresso and milk blended to a smooth icy finish.',priceS:195,priceM:205,priceL:215},
      {cat:'nonfrappe',name:'Vanilla Frappe',desc:'Ice blended vanilla and milk, topped with whipped cream.',priceS:175,priceM:185,priceL:195},
      {cat:'nonfrappe',name:'Matcha Cream Frappe',desc:'Ice blended matcha with milk, topped with whipped cream.',priceS:205,priceM:215,priceL:225},
      {cat:'nonfrappe',name:'Nougat Frappe',desc:'Ice blended coconut and toffee nut, topped with whipped cream.',priceS:205,priceM:215,priceL:225},
      {cat:'nonfrappe',name:'Dark Chocolate Frappe',desc:'Ice blended rich dark chocolate, topped with whipped cream.',priceS:205,priceM:215,priceL:225},
      {cat:'nonfrappe',name:'Strawberry Cream Frappe',desc:'Ice blended strawberry with cream, topped with whipped cream.',priceS:205,priceM:215,priceL:225},
      {cat:'nonfrappe',name:'Strawberry Frappe',desc:'Ice blended strawberry, topped with whipped cream.',priceS:205,priceM:215,priceL:225},
      {cat:'soda',name:'Tahitian Lime',desc:'Tahitian Lime soda-based refresher topped with dried lemon.',priceS:195,priceM:205,priceL:215},
      {cat:'soda',name:'Pink Guava',desc:'Guava soda-based refresher topped with dried lemon.',priceS:205,priceM:215,priceL:225},
      {cat:'soda',name:'Peach Black Tea',desc:'Peach & Black Tea soda-based refresher.',priceS:205,priceM:215,priceL:225},
      {cat:'soda',name:'Lychee',desc:'Lychee soda-based refresher topped with dried lemon.',priceS:205,priceM:215,priceL:225},
      {cat:'soda',name:'Raspberry Soda',desc:'Raspberry soda-based refresher topped with dried lemon.',priceS:205,priceM:215,priceL:225},
      {cat:'soda',name:'Passionfruit',desc:'Passionfruit soda-based refresher topped with dried lemon.',priceS:205,priceM:215,priceL:225},
      {cat:'pastry',name:'Buttered Croissant',desc:'Classic buttered croissant.',priceS:95},
      {cat:'pastry',name:'Croffle',desc:'Buttery croissant pressed in a waffle.',priceS:135},
      {cat:'pastry',name:'Matcha Croffle',desc:'Croissant waffle topped with whipped cream and matcha.',priceS:195},
      {cat:'pastry',name:'Biscoff Croffle',desc:'Croissant waffle topped with Biscoff spread.',priceS:195},
      {cat:'pastry',name:'Dark Chocolate Croffle',desc:'Croissant waffle topped with dark chocolate.',priceS:195},
      {cat:'pastry',name:'White Chocolate Croffle',desc:'Croissant waffle topped with white chocolate.',priceS:195},
      {cat:'pastry',name:'Pain Au Chocolat',desc:'Croissant filled with chocolate.',priceS:105},
      {cat:'pastry',name:'Cinnamon Roll',desc:'Flaky cinnamon roll topped with cinnamon cream cheese sauce.',priceS:155}
    ];
    defaultMenu.forEach((item,i)=>{seed['item_'+String(i).padStart(3,'0')]=item;});
    set(menuRef,seed);menuItemsMap=seed;
  }
  migrateItemOptions();
  renderMenuSection();
  renderOrderSection();
  if(adminLoggedIn){buildAvail();renderOptionManager();}
  if(staffLoggedIn)renderStaffMenu();
});

function playChime(){
  try{
    if(!audioCtx)audioCtx=new(window.AudioContext||window.webkitAudioContext)();
    if(audioCtx.state==='suspended')audioCtx.resume();
    var t=audioCtx.currentTime;
    for(var i=0;i<6;i++){
      var o=audioCtx.createOscillator(),gn=audioCtx.createGain();
      o.type='triangle';
      o.frequency.value=(i%2===0)?988:740;
      var st=t+i*0.3;
      gn.gain.setValueAtTime(0.0001,st);
      gn.gain.exponentialRampToValueAtTime(0.55,st+0.02);
      gn.gain.setValueAtTime(0.55,st+0.22);
      gn.gain.exponentialRampToValueAtTime(0.0001,st+0.3);
      o.connect(gn);gn.connect(audioCtx.destination);
      o.start(st);o.stop(st+0.32);
    }
  }catch(e){}
}
function clearOrderAlert(){
  unseenOrders=0;
  if(orderChimeTimer){clearInterval(orderChimeTimer);orderChimeTimer=null;}
  var t=document.getElementById('orderToast');if(t)t.style.display='none';
  var b=document.getElementById('ordersBadge');if(b)b.style.display='none';
}
function notifyNewOrders(fresh){
  unseenOrders+=fresh.length;
  var last=fresh[fresh.length-1];
  document.getElementById('orderToastTitle').textContent=unseenOrders>1?unseenOrders+' new orders received!':'New order from '+(last&&last.name?last.name:'a customer')+'!';
  document.getElementById('orderToastSub').textContent=(last&&last.total?'â‚±'+last.total.toLocaleString()+' Â· ':'')+'Tap to view orders';
  document.getElementById('orderToast').style.display='flex';
  var b=document.getElementById('ordersBadge');
  if(b){b.textContent=unseenOrders;b.style.display='inline-block';}
  playChime();
  if(orderChimeTimer)clearInterval(orderChimeTimer);
  orderChimeTimer=setInterval(playChime,3800);
}
window.ackNewOrders=function(){
  clearOrderAlert();
  if(window.__openPosOnlineOrders){window.__openPosOnlineOrders();return;}
  var ob=document.getElementById('tabBtnOrders');if(ob)ob.click();
  var ad=document.getElementById('adminDash');if(ad)ad.scrollIntoView({behavior:'smooth'});
};
function checkMyReadyOrders(){return customerOrderTracker.checkReady();}
(function(){var un=function(){try{if(!audioCtx)audioCtx=new(window.AudioContext||window.webkitAudioContext)();if(audioCtx.state==='suspended')audioCtx.resume();}catch(e){}document.removeEventListener('touchstart',un);document.removeEventListener('click',un);};document.addEventListener('touchstart',un,{passive:true});document.addEventListener('click',un);})();
subscriptionHub.subscribe('activeOrders',snap=>{
  var prevIds=knownOrderIds;
  var previousOrders=adminOrdersMap;
  adminOrdersMap=snap.val()||{};
  var ids=Object.keys(adminOrdersMap);
  if(prevIds&&(adminLoggedIn||staffLoggedIn)){
    var fresh=ids.filter(function(id){return prevIds.indexOf(id)===-1;}).map(function(id){return adminOrdersMap[id];}).filter(function(o){return o&&o.source!=='pos';});
    if(fresh.length){notifyNewOrders(fresh);if(window.AccazaTelemetry)fresh.forEach(function(o){var age=Date.now()-Number(o.timestamp||Date.now());window.AccazaTelemetry.metric('realtime_order_arrival',Math.max(0,age),true);});}
  }
  knownOrderIds=ids;
  if(adminLoggedIn||staffLoggedIn){var ot=document.getElementById('tab-orders'),dt=document.getElementById('tab-dashboard'),ct=document.getElementById('tab-appcustomers');if(ot&&ot.style.display!=='none')patchOrderCards(previousOrders,adminOrdersMap);if(dt&&dt.style.display!=='none')renderDashboard();if(ct&&ct.style.display!=='none')renderAppCustomers();}
  updateStats();renderCustomerOrders();checkMyReadyOrders();
});
subscriptionHub.subscribe('orders',snap=>{overviewOrdersMap=snap.val()||{};overviewOrdersLoaded=true;if(adminLoggedIn){var dt=document.getElementById('tab-dashboard');if(dt&&dt.style.display!=='none')renderDashboard();}});
subscriptionHub.subscribe('archivedOrders',snap=>{archivedOrdersMap=snap.val()||{};archivedOrdersLoaded=true;if(adminLoggedIn)renderDashboard();if(adminLoggedIn||staffLoggedIn)renderAppCustomers();var _ap=document.getElementById('archivePanel');if(_ap&&_ap.style.display!=='none'){try{renderArchive();}catch(e){}}});
subscriptionHub.subscribe('financialMovements',snap=>{overviewFinancialMovementsLoaded=true;if(adminLoggedIn){var dt=document.getElementById('tab-dashboard');if(dt&&dt.style.display!=='none')renderDashboard();}},{scopes:['dashboard']});
subscriptionHub.subscribe('feedbacks',snap=>{feedbacksMap=snap.val()||{};if(adminLoggedIn||staffLoggedIn)renderComments();});
subscriptionHub.subscribe('reviews',snap=>{
  const saved=snap.val();
  if(saved){reviewsMap=saved;}
  else{
    const seed={
      'rev_001':{name:'Maria Theresa & Quinn Isabella Margaux',stars:5,date:'June 2, 2026',text:'Accaza Coffee House is a hidden gem right along the roadside near SM DasmariÃ±as â€” easy to find whether you\'re commuting or driving. Inside, it\'s surprisingly spacious with a calm, serene atmosphere that\'s rare among today\'s cramped cafÃ©s.\n\nThe coffee is outstanding, with well-crafted flavors from bold to smooth. But what truly sets Accaza apart is how perfectly it serves both students and professionals â€” it\'s a productive sanctuary where you can focus, study, or work in peace.\n\nHighly recommended for anyone looking for great coffee and a place to get things done. â˜•âœ¨'},
      'rev_002':{name:'Molina Page',stars:5,date:'June 2026',text:'The coffee was absolutely delightful â€” perfectly brewed, rich in flavor, and made with genuine care. Every sip spoke to your passion and quality.\n\nBeyond the coffee, your staff made the visit truly special. From the warm greeting to the attentive service, everyone made me feel genuinely valued. It\'s rare to find a team so professional yet so kind and approachable.'},
      'rev_003':{name:'Camilla Andrea',stars:5,date:'April 6, 2026 Â· via Facebook',text:'Nasa may highway ang coffee shop, ngunit nakakubli ang ganda nitong hindi mo mamamalas kung hindi sasadyain. Mukha siyang maliit sa labas, subalit malaki ang espasyo pagpasok, na tila napunta ka na sa ibang lugar.\n\nGusto ko mang ipagdamot ang lugar para patuloy akong makatambay nang matiwasay, subalit tingin ko\'y kasalanan ito sa mga mahilig sa kape (at sa may-ari rin) kung hindi ito maibabahagi sa iba.'},
      'rev_004':{name:'Cess Borja',stars:5,date:'July 2025',text:'"10/10 would recommend!! we will surely come back ðŸ¤Œ"'}
    };
    set(reviewsRef,seed);reviewsMap=seed;
  }
  renderPublicReviews();
  if(adminLoggedIn||staffLoggedIn)renderAdminReviews();
});
subscriptionHub.subscribe('availability',snap=>{const s=snap.val();if(s)Object.keys(s).forEach(k=>availability[k]=s[k]);renderMenuSection();renderOrderSection();if(adminLoggedIn)buildAvail();});
subscriptionHub.subscribe('payment',snap=>{
  const p=snap.val();if(!p)return;
  if(p.gcashNum)document.getElementById('gcashNum').textContent=p.gcashNum;
  if(p.gcashName)document.getElementById('gcashName').textContent=p.gcashName;
  if(p.bdoNum)document.getElementById('bankNum').textContent=p.bdoNum;
  if(p.ubNum)document.getElementById('bankNum2').textContent=p.ubNum;
  if(p.gcashNum)document.getElementById('editGcashNum').value=p.gcashNum;
  if(p.gcashName)document.getElementById('editGcashName').value=p.gcashName;
  if(p.bdoNum)document.getElementById('editBdoNum').value=p.bdoNum;
  if(p.ubNum)document.getElementById('editUbNum').value=p.ubNum;
  function setChk(id,val){var el=document.getElementById(id);if(el){el.checked=(val!==false);}}
  setChk('chkGcash',p.gcashEnabled!==false);
  setChk('chkBdo',p.bdoEnabled!==false);
  setChk('chkUb',p.ubEnabled!==false);
  setChk('chkMaya',p.mayaEnabled!==false);
  setChk('chkBank3',p.bank3Enabled!==false);
  setChk('chkBank4',p.bank4Enabled!==false);
  var bdoRow=document.getElementById('bdoRow');
  var ubRow=document.getElementById('ubRow');
  if(bdoRow)bdoRow.style.display=p.bdoEnabled!==false?'block':'none';
  if(ubRow)ubRow.style.display=p.ubEnabled!==false?'block':'none';
  var qrGcash=document.getElementById('qrGcash');
  var qrBdo=document.getElementById('qrBdo');
  var qrSection=document.getElementById('qrSection');
  if(qrGcash)qrGcash.style.display=p.gcashEnabled!==false?'block':'none';
  if(qrBdo)qrBdo.style.display=p.bdoEnabled!==false?'block':'none';
  if(qrSection)qrSection.style.display=(p.gcashEnabled!==false||p.bdoEnabled!==false)?'block':'none';
  ['Gcash','Bdo','Ub','Maya','Bank3','Bank4'].forEach(function(k){
    var note=document.getElementById('chk'+k+'Note');
    var chk=document.getElementById('chk'+k);
    if(note&&chk)note.style.display=chk.checked?'none':'block';
  });
  var gcashBtn=document.getElementById('btnGcash');
  if(gcashBtn)gcashBtn.style.display=p.gcashEnabled!==false?'':'none';
  var bankBtn=document.getElementById('btnBank');
  if(bankBtn)bankBtn.style.display=(p.bdoEnabled!==false||p.ubEnabled!==false||p.bank3Enabled!==false||p.bank4Enabled!==false)?'':'none';
  (function(){
    var gcashOk=p.gcashEnabled!==false;
    var mayaOk=!!(p.mayaNum&&p.mayaEnabled!==false);
    var bankOk=(p.bdoEnabled!==false||p.ubEnabled!==false||p.bank3Enabled!==false||p.bank4Enabled!==false);
    var needSwitch=(paymentType==='gcash'&&!gcashOk)||(paymentType==='maya'&&!mayaOk)||(paymentType==='bank'&&!bankOk);
    if(needSwitch){
      var first=gcashOk?'gcash':mayaOk?'maya':bankOk?'bank':null;
      if(first)setPayment(first);
    }
  })();
  var mayaBtn=document.getElementById('btnMaya');
  if(p.mayaNum){document.getElementById('mayaNum').textContent=p.mayaNum;
    if(p.mayaName)document.getElementById('mayaName').textContent=p.mayaName;
    if(document.getElementById('editMayaNum'))document.getElementById('editMayaNum').value=p.mayaNum;
    if(document.getElementById('editMayaName'))document.getElementById('editMayaName').value=p.mayaName||'';
    if(mayaBtn)mayaBtn.style.display=(p.mayaEnabled!==false)?'':'';
  }else{if(mayaBtn)mayaBtn.style.display='none';}
  if(mayaBtn&&p.mayaNum)mayaBtn.style.display=(p.mayaEnabled!==false)?'':'none';
  var b3row=document.getElementById('bank3Row');
  if(p.bank3Num){
    document.getElementById('bank3Num').textContent=p.bank3Num;
    document.getElementById('bank3AccName').textContent=p.bank3Name||'ACCAZA';
    if(p.bank3Label){document.getElementById('bank3LabelDisp').textContent=p.bank3Label+' Account';}
    if(document.getElementById('editBank3Label'))document.getElementById('editBank3Label').value=p.bank3Label||'';
    if(document.getElementById('editBank3Num'))document.getElementById('editBank3Num').value=p.bank3Num;
    if(document.getElementById('editBank3Name'))document.getElementById('editBank3Name').value=p.bank3Name||'';
    if(b3row)b3row.style.display=p.bank3Enabled!==false?'block':'none';
  }else{if(b3row)b3row.style.display='none';}
  var b4row=document.getElementById('bank4Row');
  if(p.bank4Num){
    document.getElementById('bank4Num').textContent=p.bank4Num;
    document.getElementById('bank4AccName').textContent=p.bank4Name||'ACCAZA';
    if(p.bank4Label){document.getElementById('bank4LabelDisp').textContent=p.bank4Label+' Account';}
    if(document.getElementById('editBank4Label'))document.getElementById('editBank4Label').value=p.bank4Label||'';
    if(document.getElementById('editBank4Num'))document.getElementById('editBank4Num').value=p.bank4Num;
    if(document.getElementById('editBank4Name'))document.getElementById('editBank4Name').value=p.bank4Name||'';
    if(b4row)b4row.style.display=p.bank4Enabled!==false?'block':'none';
  }else{if(b4row)b4row.style.display='none';}
});

document.getElementById('btnAddToCart').addEventListener('click',function(){addCustomizedToCart();});

window.filterMenu=function(cat,btn){
  menuFilter=cat;
  document.querySelectorAll('#menuTabsRow .tab-btn').forEach(b=>b.classList.remove('active'));
  if(btn)btn.classList.add('active');
  renderMenuSection();
};
window.filterOrder=function(cat,btn){
  orderFilter=cat;
  document.querySelectorAll('#orderTabsRow .otab').forEach(b=>b.classList.remove('active'));
  if(btn)btn.classList.add('active');
  renderOrderSection();
};

window.goToOrderItem=function(cat,key){
  const btn=document.querySelector('#orderTabsRow .otab[data-cat="'+cat+'"]');
  filterOrder(cat,btn);
  const row=document.querySelector('#orderItemList .item-row[data-itemkey="'+key+'"]');
  if(row){row.scrollIntoView({behavior:'smooth',block:'center'});row.classList.add('item-glow');setTimeout(function(){row.classList.remove('item-glow');},2400);}
  else{const sec=document.getElementById('order');if(sec)sec.scrollIntoView({behavior:'smooth'});}
};

function renderMenuSection(){
  const el=document.getElementById('menuGrid');if(!el)return;
  if(!menuFilter){el.innerHTML='';return;}
  const items=getMenuItems().filter(i=>i.cat===menuFilter).sort((a,b)=>(a.order||0)-(b.order||0));
  if(!items.length){el.innerHTML='<div style="grid-column:1/-1;text-align:center;padding:3rem;color:rgba(224,212,198,0.5);"><p style="font-size:2rem;">'+getCatIcon(menuFilter)+'</p><p style="margin-top:0.5rem;">No items yet.</p></div>';return;}
  el.innerHTML=items.map(function(i){
    const ok=isAvail(i.name);
    const imgHtml=i.img?'<img src="'+i.img+'" class="menu-card-img" style="'+(ok?'':'opacity:0.5;')+'" onerror="this.style.display=\'none\'"/>'
      :'<div class="menu-card-img-placeholder">'+getCatIcon(i.cat)+'</div>';
    const priceHtml=i.priceM&&i.priceL
      ?'<span class="price-badge">S â‚±'+i.priceS+'</span><span class="price-badge">M â‚±'+i.priceM+'</span><span class="price-badge">L â‚±'+i.priceL+'</span>'
      :i.priceL&&i.labelS&&i.labelL
      ?'<span class="price-badge">'+(i.labelS||'Opt 1')+' â‚±'+i.priceS+'</span><span class="price-badge">'+(i.labelL||'Opt 2')+' â‚±'+i.priceL+'</span>'
      :'<span class="price-single">â‚±'+i.priceS+'</span>';
    return'<div class="menu-card'+(ok?' clickable':'')+'"'+(ok?' data-goorder="'+i.key+'" data-gocat="'+i.cat+'"':'')+'>'+imgHtml+'<div class="menu-card-body"><span class="cat-tag">'+getCatLabel(i.cat)+'</span><h4 style="'+(ok?'':'text-decoration:line-through;opacity:0.6;')+'">'+i.name+'</h4><p class="desc">'+(i.desc||'')+'</p><div class="price-row">'+priceHtml+'</div><span class="avail-badge '+(ok?'avail-yes':'avail-no')+'">'+(ok?'âœ… Available':'âŒ Unavailable')+'</span>'+(ok?'<span class="tap-hint">ðŸ›’ Tap to order</span>':'')+'</div></div>';
  }).join('');
  el.querySelectorAll('.menu-card[data-goorder]').forEach(function(card){card.addEventListener('click',function(){goToOrderItem(this.dataset.gocat,this.dataset.goorder);});});
}

function renderOrderSection(){
  const el=document.getElementById('orderItemList');if(!el)return;
  if(!orderFilter){el.innerHTML='<div class="order-empty-state"><span class="big-icon">â˜•</span><h3>What are you craving today?</h3><p>Choose a category above to explore our handcrafted drinks and pastries.</p></div>';return;}
  const items=getMenuItems().filter(i=>i.cat===orderFilter).sort((a,b)=>(a.order||0)-(b.order||0));
  if(!items.length){el.innerHTML='<div class="order-empty-state"><span class="big-icon">'+getCatIcon(orderFilter)+'</span><h3>No items yet.</h3></div>';return;}
  el.innerHTML=items.map(function(i){
    const ok=isAvail(i.name);
    const cartQty=Object.values(cart).filter(c=>c.name===i.name||c.name.startsWith(i.name+' (')).reduce((s,c)=>s+c.qty,0);
    const imgHtml=i.img?'<img src="'+i.img+'" class="item-row-img" onerror="this.style.display=\'none\'"/>'
      :'<div class="item-row-img-placeholder">'+getCatIcon(i.cat)+'</div>';
    return'<div class="item-row" data-itemkey="'+i.key+'" style="'+(ok?'':'opacity:0.45;pointer-events:none;')+'">'
      +imgHtml
      +'<div class="item-row-info"><h5 style="'+(ok?'':'text-decoration:line-through;')+'">'+i.name+'</h5>'
      +'<span class="item-cat">'+(ok?getCatLabel(i.cat):'Not Available')+'</span>'
      +'<span class="item-prices">'+formatPrice(i)+'</span></div>'
      +'<div class="item-row-right">'
      +(cartQty>0?'<span style="font-size:0.78rem;font-weight:600;color:var(--bl);background:rgba(176,141,87,0.1);padding:0.2rem 0.5rem;border-radius:999px;">'+cartQty+' in cart</span>':'')
      +'<button class="qty-btn" style="background:var(--bd);color:#fff;border-color:var(--bd);" data-key="'+i.key+'">+</button>'
      +'</div></div>';
  }).join('');
  el.querySelectorAll('.qty-btn[data-key]').forEach(function(btn){
    btn.addEventListener('click',function(){openCustomize(this.dataset.key);});
  });
}

window.openCustomize=function(itemKey){
  const itemData=menuItemsMap[itemKey];if(!itemData)return;
  custItem={...itemData,key:itemKey};
  custSize=null;custSel={};custQty=1;
  document.getElementById('custItemName').textContent=custItem.name;
  const imgWrap=document.getElementById('custItemImgWrap');
  imgWrap.innerHTML=custItem.img?'<img src="'+custItem.img+'" style="width:100%;height:160px;object-fit:cover;" onerror="this.style.display=\'none\'"/>'
    :'<div class="customize-img-placeholder">'+getCatIcon(custItem.cat)+'</div>';
  let html='';
  if(custItem.labelS&&custItem.labelL&&custItem.priceL){
    html+='<div class="cust-section"><div class="cust-section-title">Serving Size <span class="cust-badge cust-badge-required">Required</span></div><div class="cust-options">'
      +'<label class="cust-option" data-action="size" data-val="S" data-price="'+custItem.priceS+'"><input type="radio" name="custSize"/><span class="cust-option-label">'+(custItem.labelS||'Option 1')+'</span><span class="cust-option-price">â‚±'+custItem.priceS+'</span></label>'
      +'<label class="cust-option" data-action="size" data-val="L" data-price="'+custItem.priceL+'"><input type="radio" name="custSize"/><span class="cust-option-label">'+(custItem.labelL||'Option 2')+'</span><span class="cust-option-price">â‚±'+custItem.priceL+'</span></label>'
      +'</div></div>';
  } else if(custItem.priceM&&custItem.priceL){
    html+='<div class="cust-section"><div class="cust-section-title">Serving Size <span class="cust-badge cust-badge-required">Required</span></div><div class="cust-options">'
      +'<label class="cust-option" data-action="size" data-val="S" data-price="'+custItem.priceS+'"><input type="radio" name="custSize"/><span class="cust-option-label">Small</span><span class="cust-option-price">â‚±'+custItem.priceS+'</span></label>'
      +'<label class="cust-option" data-action="size" data-val="M" data-price="'+custItem.priceM+'"><input type="radio" name="custSize"/><span class="cust-option-label">Medium</span><span class="cust-option-price">â‚±'+custItem.priceM+'</span></label>'
      +'<label class="cust-option" data-action="size" data-val="L" data-price="'+custItem.priceL+'"><input type="radio" name="custSize"/><span class="cust-option-label">Large</span><span class="cust-option-price">â‚±'+custItem.priceL+'</span></label>'
      +'</div></div>';
  }
  var itemGroups=getItemOptionGroups(custItem);
  itemGroups.forEach(function(g){
    var isMulti=g.type==='multi';
    var req=!isMulti&&g.required!==false;
    html+='<div class="cust-section"><div class="cust-section-title">'+escHtml(g.name)+' <span class="cust-badge '+(req?'cust-badge-required':'cust-badge-optional')+'">'+(req?'Required':'Optional')+'</span></div><div class="cust-options">'
      +(g.choices||[]).map(function(c,ci){
        var pp=parseInt(c.price)||0;
        return '<label class="cust-option" data-action="'+(isMulti?'optcheck':'optradio')+'" data-group="'+g.id+'" data-idx="'+ci+'"><input type="'+(isMulti?'checkbox':'radio')+'" name="og_'+g.id+'"/><span class="cust-option-label">'+escHtml(c.label)+'</span><span class="cust-option-price">'+(pp>0?'+â‚±'+pp:'Free')+'</span></label>';
      }).join('')
      +'</div></div>';
  });
  html+='<div class="cust-section"><div class="cust-section-title">Quantity</div><div class="cust-qty"><button class="cust-qty-btn" id="custQtyMinus">âˆ’</button><span class="cust-qty-num" id="custQtyNum">1</span><button class="cust-qty-btn" id="custQtyPlus">+</button></div></div>';
  const body=document.getElementById('custBody');
  body.innerHTML=html;
  body.onclick=function(e){
    const opt=e.target.closest('.cust-option');if(!opt)return;
    const action=opt.dataset.action;
    if(action==='size'){custSize=opt.dataset.val;custItem._selectedPrice=parseInt(opt.dataset.price);opt.closest('.cust-options').querySelectorAll('.cust-option').forEach(o=>o.classList.remove('selected'));opt.classList.add('selected');opt.querySelector('input').checked=true;}
    else if(action==='optradio'){
      var g=optionGroupsMap[opt.dataset.group];if(!g)return;
      var c=(g.choices||[])[parseInt(opt.dataset.idx)];if(!c)return;
      custSel[opt.dataset.group]={label:c.label,price:parseInt(c.price)||0};
      opt.closest('.cust-options').querySelectorAll('.cust-option').forEach(o=>o.classList.remove('selected'));
      opt.classList.add('selected');opt.querySelector('input').checked=true;
    }
    else if(action==='optcheck'){
      var g2=optionGroupsMap[opt.dataset.group];if(!g2)return;
      var c2=(g2.choices||[])[parseInt(opt.dataset.idx)];if(!c2)return;
      var chk=opt.querySelector('input');
      var arr=custSel[opt.dataset.group]||[];
      var ix=arr.findIndex(function(x){return x.label===c2.label;});
      if(chk.checked){if(ix===-1)arr.push({label:c2.label,price:parseInt(c2.price)||0});}
      else{if(ix>-1)arr.splice(ix,1);}
      custSel[opt.dataset.group]=arr;
      opt.classList.toggle('selected',chk.checked);
    }
    updateCustTotal();
  };
    document.getElementById('custQtyMinus').addEventListener('click',function(){custQty=Math.max(1,custQty-1);document.getElementById('custQtyNum').textContent=custQty;updateCustTotal();});
  document.getElementById('custQtyPlus').addEventListener('click',function(){custQty++;document.getElementById('custQtyNum').textContent=custQty;updateCustTotal();});
  updateCustTotal();
  document.getElementById('customizePopup').classList.add('show');
};

function calcCustUnitTotal(){
  var t=custItem._selectedPrice||custItem.priceS||0;
  Object.keys(custSel).forEach(function(gid){
    var v=custSel[gid];if(!v)return;
    if(Array.isArray(v)){v.forEach(function(c){t+=c.price||0;});}
    else{t+=v.price||0;}
  });
  return t;
}
function updateCustTotal(){document.getElementById('custTotalDisplay').textContent='â‚±'+(calcCustUnitTotal()*custQty).toLocaleString();}

function addCustomizedToCart(){
  const item=custItem;if(!item)return;
  if(item.priceM&&item.priceL&&!custSize){alert('Please select a size.');return;}
  if(item.labelS&&item.labelL&&item.priceL&&!custSize){alert('Please select a serving option.');return;}
  var itemGroups=getItemOptionGroups(item);
  for(var gi=0;gi<itemGroups.length;gi++){
    var gg=itemGroups[gi];
    if(gg.type!=='multi'&&gg.required!==false&&!custSel[gg.id]){alert('Please select: '+gg.name);return;}
  }
  const unit=calcCustUnitTotal();
  const sizeLabel=custSize?' ('+custSize+')':'';
  const details=[];
  itemGroups.forEach(function(gg){
    var v=custSel[gg.id];if(!v)return;
    if(Array.isArray(v)){v.forEach(function(c){details.push('+'+c.label);});}
    else{details.push(v.label);}
  });
  const cartKey=Date.now()+'_'+Math.random().toString(36).substr(2,5);
  var _optLabels=[];itemGroups.forEach(function(gg){var v=custSel[gg.id];if(!v)return;if(Array.isArray(v)){v.forEach(function(c){_optLabels.push(c.label);});}else{_optLabels.push(v.label);}});
  cart[cartKey]={name:item.name+sizeLabel,details:details.join(', '),qty:custQty,unitTotal:unit,cat:item.cat,itemKey:item.key,size:custSize||null,optLabels:_optLabels};
  closeCustomize();updateCartDisplay();renderOrderSection();
  setTimeout(function(){const cb=document.querySelector('.cart-box');if(cb){cb.style.transition='box-shadow 0.3s';cb.style.boxShadow='0 0 0 3px rgba(176,141,87,0.5)';setTimeout(()=>cb.style.boxShadow='none',1000);}},400);
}
window.closeCustomize=function(){document.getElementById('customizePopup').classList.remove('show');custItem=null;};

function updateCartDisplay(){
  const box=document.getElementById('cartItems'),tot=document.getElementById('cartTotal');
  const keys=Object.keys(cart);
  if(!keys.length){box.innerHTML='<p style="color:var(--tl);font-size:0.85rem;">No items added yet.</p>';tot.style.display='none';var _cb0=document.getElementById('cartCheckoutBtn');if(_cb0)_cb0.style.display='none';return;}
  let total=0;
  box.innerHTML=keys.map(function(k){
    const item=cart[k],line=item.qty*item.unitTotal;total+=line;
    return'<div style="border-bottom:1px solid var(--cd);padding:0.5rem 0;">'
      +'<div style="display:flex;justify-content:space-between;align-items:flex-start;">'
      +'<div style="flex:1;"><div style="font-size:0.85rem;color:var(--bd);font-weight:500;">'+item.name+'</div>'
      +(item.details?'<div style="font-size:0.72rem;color:var(--tl);">'+item.details+'</div>':'')
      +'<div style="font-size:0.75rem;color:var(--tl);">â‚±'+item.unitTotal.toLocaleString()+' each</div></div>'
      +'<div style="display:flex;align-items:center;gap:0.4rem;margin-left:0.5rem;">'
      +'<button data-cartkey="'+k+'" data-delta="-1" style="width:24px;height:24px;border-radius:50%;border:1px solid var(--cd);background:var(--cr);font-size:0.9rem;cursor:pointer;color:var(--bd);">âˆ’</button>'
      +'<span style="font-size:0.85rem;font-weight:500;min-width:18px;text-align:center;">'+item.qty+'</span>'
      +'<button data-cartkey="'+k+'" data-delta="1" style="width:24px;height:24px;border-radius:50%;border:1px solid var(--cd);background:var(--cr);font-size:0.9rem;cursor:pointer;color:var(--bd);">+</button>'
      +'<span style="font-size:0.85rem;font-weight:500;color:var(--bl);min-width:50px;text-align:right;">â‚±'+line.toLocaleString()+'</span>'
      +'</div></div></div>';
  }).join('');
  box.querySelectorAll('button[data-cartkey]').forEach(function(btn){
    btn.addEventListener('click',function(e){if(e&&e.stopPropagation)e.stopPropagation();
      const k=this.dataset.cartkey,d=parseInt(this.dataset.delta);
      if(!cart[k])return;cart[k].qty=Math.max(0,cart[k].qty+d);
      if(cart[k].qty===0)delete cart[k];
      updateCartDisplay();renderOrderSection();
    });
  });
  document.getElementById('totalAmt').textContent='â‚±'+total.toLocaleString();
  tot.style.display='flex';
  var _cb1=document.getElementById('cartCheckoutBtn');if(_cb1)_cb1.style.display='block';
}

window.goToCheckout=function(e){if(e&&e.stopPropagation)e.stopPropagation();if(!Object.keys(cart).length)return;var f=document.querySelector('.form-box');if(f)f.scrollIntoView({behavior:'smooth',block:'start'});};
window.setType=function(t){orderType=t;document.getElementById('btnPickup').classList.toggle('active',t==='pickup');document.getElementById('btnDelivery').classList.toggle('active',t==='delivery');document.getElementById('deliveryField').style.display=t==='delivery'?'block':'none';};
window.showProof=function(src){var m=document.getElementById('proofModal');var im=document.getElementById('proofModalImg');if(im)im.src=src;if(m)m.style.display='flex';};
window.showStoredProof=async function(orderId,button){
  var old=button?button.textContent:'';if(button){button.disabled=true;button.textContent='Loading proofâ€¦';}
  try{var result=await getPaymentProofCall({orderId:orderId});var data=result&&result.data&&result.data.dataUrl;if(!data)throw new Error('The server returned no image.');window.showProof(data);}
  catch(e){try{if(window.AccazaTelemetry)window.AccazaTelemetry.error('proof_access');}catch(_e){}alert('Could not load payment proof: '+((e&&e.message)||e));}
  finally{if(button){button.disabled=false;button.textContent=old||'ðŸ“Ž View payment proof';}}
};
window.setPayment=function(p){paymentType=p;
  document.getElementById('btnGcash').classList.toggle('active',p==='gcash');
  document.getElementById('btnBank').classList.toggle('active',p==='bank');
  var mayaBtn=document.getElementById('btnMaya');
  if(mayaBtn)mayaBtn.classList.toggle('active',p==='maya');
  document.getElementById('gcashInfo').style.display=p==='gcash'?'block':'none';
  document.getElementById('mayaInfo').style.display=p==='maya'?'block':'none';
  document.getElementById('bankInfo').style.display=p==='bank'?'block':'none';
};
window.setContact=function(type){contactMethod=type;['Whatsapp','Viber','Sms','Call','Email'].forEach(function(t){const el=document.getElementById('btn'+t);if(el)el.classList.toggle('active',t.toLowerCase()===type);});const ph={whatsapp:'Enter your WhatsApp number',viber:'Enter your Viber number',sms:'Enter your phone number for SMS',call:'Enter your phone number',email:'Enter your email address'};document.getElementById('custContact').placeholder=ph[type]||'Enter your contact';};
window.previewProof=function(input){if(!input.files||!input.files[0])return;const r=new FileReader();r.onload=function(e){document.getElementById('proofImg').src=e.target.result;document.getElementById('proofFileName').textContent=input.files[0].name;document.getElementById('uploadPlaceholder').style.display='none';document.getElementById('uploadPreview').style.display='block';document.getElementById('uploadBox').style.borderColor='#2d9e5f';};r.readAsDataURL(input.files[0]);};
window.removeProof=function(e){e.stopPropagation();document.getElementById('paymentProof').value='';document.getElementById('proofImg').src='';document.getElementById('uploadPlaceholder').style.display='block';document.getElementById('uploadPreview').style.display='none';document.getElementById('uploadBox').style.borderColor='var(--cd)';};

const customerRegistry=createCustomerRegistry({subscriptionHub:subscriptionHub,getOrders:function(){return adminOrdersMap;},getArchivedOrders:function(){return archivedOrdersMap;},escape:escHtml,isPortalActive:function(){return adminLoggedIn||staffLoggedIn;}});
const renderAppCustomers=customerRegistry.renderAppCustomers;
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',appCustomerSession.init);else appCustomerSession.init();
window.notifyCustomer=function(oid){
  var o=adminOrdersMap[oid]; if(!o)return;
  var first=((o.name||'').trim().split(' ')[0])||'there';
  var isDel=o.type==='Delivery';
  var msg=isDel
    ?'Hi '+first+'! \u2615 Your Accaza order #'+oid+' is ready for delivery. Kindly let us know once you\u2019ve booked your preferred delivery/courier service so we can hand it over. Maraming salamat! \u2014 Accaza Coffee House'
    :'Hi '+first+'! \u2615 Your Accaza order #'+oid+' is now ready for pick-up. See you soon at Saratoga Ave, La Mediterranea Subd., Governor\u2019s Drive, Dasmari\u00f1as. \u2014 Accaza Coffee House';
  var raw=((o.contact||o.phone||'')+'').replace(/[^0-9]/g,'');
  var intl=raw; if(intl.indexOf('0')===0){intl='63'+intl.slice(1);} else if(intl.indexOf('63')!==0&&intl.length===10&&intl.charAt(0)==='9'){intl='63'+intl;}
  var method=((o.contactMethod||'')+'').toLowerCase();
  try{if(navigator.clipboard)navigator.clipboard.writeText(msg);}catch(e){}
  function go(url,blank){var a=document.createElement('a');a.href=url;if(blank){a.target='_blank';a.rel='noopener';}document.body.appendChild(a);a.click();a.remove();}
  var enc=encodeURIComponent(msg);
  var t=window.accazaToast||function(){};
  if(method==='whatsapp'&&intl){go('https://wa.me/'+intl+'?text='+enc,true);t('Opening WhatsApp\u2026','ok');}
  else if(method==='sms'&&raw){go('sms:'+raw+'?&body='+enc,false);t('Opening Messages\u2026','ok');}
  else if(method==='viber'&&intl){go('viber://chat?number=%2B'+intl,false);t('Viber opened \u2014 message copied, just paste & send','ok');}
  else if(method==='email'&&o.contact){go('mailto:'+encodeURIComponent(o.contact)+'?subject='+encodeURIComponent('Your Accaza Order #'+oid)+'&body='+enc,false);t('Opening email\u2026','ok');}
  else if(intl){go('https://wa.me/'+intl+'?text='+enc,true);t('Opening WhatsApp \u2014 message copied','ok');}
  else{t('Message copied to clipboard','ok');}
};
function _hashSig(s){var h=0,i;for(i=0;i<s.length;i++){h=((h<<5)-h+s.charCodeAt(i))|0;}return (h>>>0).toString(36);}
window.placeOrder=async function(){
  if(window._placingOrder)return;
  const name=document.getElementById('custName').value.trim(),phone=document.getElementById('custPhone').value.trim();
  if(!Object.keys(cart).length){alert('Please add at least one item.');return;}
  if(!name||!phone){alert('Please enter your name and phone number.');return;}
  if(orderType==='delivery'&&!document.getElementById('deliveryAddr').value.trim()){alert('Please enter your delivery address.');return;}
  if(!document.getElementById('paymentProof').files[0]){alert('Please attach your proof of payment.');return;}
  const proofSrc=document.getElementById('proofImg').src;
  const total=Object.values(cart).reduce((s,c)=>s+c.qty*c.unitTotal,0);
  const itemsArr=Object.values(cart).map(c=>c.name+(c.details?' ('+c.details+')':'')+' x'+c.qty);
  const lineItemsArr=Object.values(cart).map(c=>({itemKey:c.itemKey||null,name:c.name,size:c.size||null,optLabels:c.optLabels||[],qty:c.qty,unitTotal:c.unitTotal}));
  const _sig=phone+'|'+itemsArr.join('~')+'|'+total;
  var _persist=(function(){try{var v=localStorage.getItem('accaza_lastsig');if(!v)return null;var ix=v.lastIndexOf('@@');return {sig:v.slice(0,ix),t:parseInt(v.slice(ix+2))||0};}catch(e){return null;}})();
  if((window._lastOrderSig===_sig&&Date.now()-(window._lastOrderTime||0)<30000)||(_persist&&_persist.sig===_sig&&Date.now()-_persist.t<30000)){alert('Looks like you just placed this exact order â€” please try again after 30 seconds.');return;}
  window._placingOrder=true;
  const _btn=document.querySelector('.btn-place-order');_btn.disabled=true;_btn.style.opacity='0.5';_btn.textContent='â³ Placing orderâ€¦';
  try{
    var _sigKey=phone.replace(/[^0-9]/g,'')+'_'+_hashSig(_sig);
    var _lock=await runTransaction(ref(db,'orderLocks/'+_sigKey),function(cur){var now=Date.now();if(cur&&(now-(cur.t||0)<90000))return;return {t:Date.now(),id:'pending'};});
    if(_lock&&_lock.committed===false){window._placingOrder=false;_btn.disabled=false;_btn.style.opacity='1';_btn.textContent='Place Order';alert('This looks like a duplicate of an order you just placed. If it is intentional, please wait a minute and try again.');return;}
  }catch(_le){/* offline or transaction error: allow order to proceed */}
  const orderId='ORD-'+Date.now().toString().slice(-6);
  const newOrder={id:orderId,name,phone,type:orderType==='delivery'?'Delivery':'Pick-up',address:orderType==='delivery'?document.getElementById('deliveryAddr').value.trim():'',payment:paymentType==='gcash'?'GCash':paymentType==='maya'?'PayMaya':'Bank Transfer',contact:document.getElementById('custContact').value.trim(),contactMethod,items:itemsArr.join(', '),total,notes:document.getElementById('custNotes').value.trim(),status:'Pending',receivedByCustomer:false,time:new Date().toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'}),date:new Date().toLocaleDateString('en-PH',{year:'numeric',month:'long',day:'numeric'}),timestamp:Date.now(),proof:proofSrc,lineItems:lineItemsArr,source:'online'};
  try{
    await set(ref(db,'orders/'+orderId),newOrder);
    try{ if(isAppMode()){ var _u=getAppUser(); var _ph=(_u&&_u.phone)||phone; var _k=_ph.replace(/[^0-9]/g,''); if(_k){ var _snap=await get(ref(db,'appCustomers/'+_k)); var _c=_snap.val()||{}; await update(ref(db,'appCustomers/'+_k),{name:(_u&&_u.name)||name,phone:_ph,orders:(_c.orders||0)+1,firstSeen:_c.firstSeen||Date.now(),lastOrder:Date.now(),lastOrderId:orderId}); } } }catch(_e){}
    window._lastOrderSig=_sig;window._lastOrderTime=Date.now();window._placingOrder=false;_btn.textContent='âœ… Order Placed!';try{localStorage.setItem('accaza_lastsig',_sig+'@@'+Date.now());}catch(e){}
    customerOrderTracker.addOrderId(orderId);
    document.getElementById('displayOrderId').textContent=orderId;document.getElementById('orderConfirm').style.display='block';
    document.querySelector('.btn-place-order').disabled=true;document.querySelector('.btn-place-order').style.opacity='0.5';
    cart={};updateCartDisplay();renderOrderSection();renderCustomerOrders();
    document.getElementById('custName').value='';document.getElementById('custPhone').value='';document.getElementById('custNotes').value='';
    removeProof({stopPropagation:function(){}});
    setTimeout(function(){var b=document.querySelector('.btn-place-order');b.disabled=false;b.style.opacity='1';b.textContent='Place Order';document.getElementById('orderConfirm').style.display='none';},5000);
  }catch(e){window._placingOrder=false;_btn.disabled=false;_btn.style.opacity='1';_btn.textContent='Place Order';alert('Could not place order: '+e.message);}
};
window.resetOrder=function(){if(!Object.keys(cart).length&&!document.getElementById('custName').value){alert('Your order is already empty!');return;}if(confirm('Reset your order?')){cart={};updateCartDisplay();renderOrderSection();document.getElementById('custName').value='';document.getElementById('custPhone').value='';document.getElementById('custNotes').value='';setType('pickup');(function(){var gBtn=document.getElementById('btnGcash');var mBtn=document.getElementById('btnMaya');var bBtn=document.getElementById('btnBank');var first=gBtn&&gBtn.style.display!=='none'?'gcash':mBtn&&mBtn.style.display!=='none'?'maya':'bank';setPayment(first);})();document.getElementById('orderConfirm').style.display='none';document.querySelector('.btn-place-order').disabled=false;document.querySelector('.btn-place-order').style.opacity='1';}};

function renderCustomerOrders(){return customerOrderTracker.render();}

window.submitContact=async function(){
  const name=document.getElementById('conName').value.trim(),contact=document.getElementById('conContact').value.trim(),subject=document.getElementById('conSubject').value.trim(),message=document.getElementById('conMessage').value.trim();
  if(!name||!message){alert('Please fill in name and message.');return;}
  const body=(subject?('['+subject+'] '):'')+message;
  if(body.length>800){alert('Message is too long (max 800 characters). Please shorten it.');return;}
  try{await push(feedbacksRef,{name,contact,type:'Contact',message:body,status:'Unread',date:new Date().toLocaleDateString('en-PH',{year:'numeric',month:'long',day:'numeric'}),timestamp:Date.now()});
    document.getElementById('conName').value='';document.getElementById('conContact').value='';document.getElementById('conSubject').value='';document.getElementById('conMessage').value='';
    document.getElementById('conConfirm').style.display='block';setTimeout(function(){document.getElementById('conConfirm').style.display='none';},6000);
  }catch(e){alert('Could not send your message: '+((e&&e.message)||e));}
};
window.updateFbCounter=function(){const len=document.getElementById('fbMessage').value.length;const c=document.getElementById('fbCounter');c.textContent=len+' / 800';c.style.color=len>=720?'#ff8080':len>=560?'#f39c12':'rgba(224,212,198,0.5)';};
window.submitFeedback=async function(){
  const name=document.getElementById('fbName').value.trim(),message=document.getElementById('fbMessage').value.trim(),type=document.getElementById('fbType').value;
  if(!name||!message){alert('Please enter your name and message.');return;}
  try{await push(feedbacksRef,{name,contact:document.getElementById('fbContact').value.trim(),type,message,status:'Unread',date:new Date().toLocaleDateString('en-PH',{year:'numeric',month:'long',day:'numeric'}),timestamp:Date.now()});
  document.getElementById('fbName').value='';document.getElementById('fbContact').value='';document.getElementById('fbMessage').value='';document.getElementById('fbCounter').textContent='0 / 800';
  const msgs={Complaint:'ðŸ™ Thank you for letting us know. We sincerely apologize and will look into this right away.',Suggestion:'ðŸ’¡ Thank you for your suggestion!',Compliment:"â¤ï¸ Oh, this made our day! Thank you so much. â˜•ðŸ»",Other:'ðŸ’› Thank you for reaching out!'};
  document.getElementById('fbConfirmMsg').textContent=msgs[type]||msgs.Other;document.getElementById('fbConfirm').style.display='block';setTimeout(function(){document.getElementById('fbConfirm').style.display='none';},6000);}catch(e){alert('Error: '+e.message);}
};

function updateStats(){const orders=Object.values(adminOrdersMap),active=orders.filter(o=>o.status!=='Received');document.getElementById('statOrders').textContent=active.length;document.getElementById('statPending').textContent=active.filter(o=>o.status==='Pending').length;document.getElementById('statReservations').textContent=Object.keys(reservationManager.getReservations()).length;document.getElementById('statRevenue').textContent='â‚±'+active.filter(o=>o.status!=='Rejected').reduce((s,o)=>s+(o.total||0),0).toLocaleString();}

const orderAdmin=createOrderAdmin({getOrders:function(){return adminOrdersMap;},canArchiveOrder:function(o){var verifiedRole=window.__accazaAuthz&&window.__accazaAuthz.role,manager=['owner','superadmin','admin','manager'].indexOf(String(verifiedRole||'').toLowerCase())>=0,shift=window.__posShift;return manager&&(!o.shiftId||!shift||shift.id!==o.shiftId||shift.status==='closed');},escHtml:escHtml,safeImageSrc:safeImageSrc,showDeletePopup:showDeletePopup,printOrder:function(id){if(window.printOrder)return window.printOrder(id);},notifyCustomer:function(id){if(window.notifyCustomer)return window.notifyCustomer(id);}});
const renderOrders=orderAdmin.renderOrders,patchOrderCards=orderAdmin.patchOrderCards;

window.togglePwVis=function(inputId,btn){var inp=document.getElementById(inputId);if(!inp)return;var show=inp.type==='password';inp.type=show?'text':'password';btn.textContent=show?'ðŸ™ˆ':'ðŸ‘ï¸';};
window.changeAdminPassword=async function(){
  var cur=document.getElementById('cpCurrent').value;
  var nw=document.getElementById('cpNew').value;
  var conf=document.getElementById('cpConfirm').value;
  var msg=document.getElementById('cpMsg');
  function showMsg(text,ok){
    msg.textContent=text;
    msg.style.display='block';
    msg.style.background=ok?'rgba(45,158,95,0.12)':'rgba(192,57,57,0.1)';
    msg.style.color=ok?'#1a7a45':'#c0392b';
    msg.style.border='1px solid '+(ok?'rgba(45,158,95,0.3)':'rgba(192,57,57,0.3)');
  }
  if(!auth.currentUser||!auth.currentUser.email){showMsg('Your Firebase session has expired. Log in again.',false);return;}
  if(!cur||!nw||!conf){showMsg('Please fill in all fields.',false);return;}
  if(nw!==conf){showMsg('New passwords do not match.',false);return;}
  if(nw.length<6){showMsg('New password must be at least 6 characters.',false);return;}
  try{var credential=EmailAuthProvider.credential(auth.currentUser.email,cur);await reauthenticateWithCredential(auth.currentUser,credential);await updatePassword(auth.currentUser,nw);['cpCurrent','cpNew','cpConfirm'].forEach(function(id){document.getElementById(id).value='';});showMsg('\u2705 Password updated successfully!',true);}
  catch(e){var bad=e&&(e.code==='auth/invalid-credential'||e.code==='auth/wrong-password');showMsg(bad?'Current password is incorrect.':'Password could not be updated. Please try again.',false);}
};


function renderStaffAccounts(){
  var el=document.getElementById('staffList');if(!el)return;
  var keys=Object.keys(staffAccountsMap);
  if(!keys.length){el.innerHTML='<p style="font-size:0.85rem;color:var(--tl);">No staff accounts yet.</p>';return;}
  el.innerHTML=keys.map(function(uid){
    var acc=staffAccountsMap[uid];
    return'<div style="display:flex;align-items:center;justify-content:space-between;background:#fff;border:1px solid var(--cd);border-radius:8px;padding:0.7rem 1rem;margin-bottom:0.5rem;">'
      +'<div><span style="font-size:0.9rem;font-weight:500;color:var(--bd);">ðŸ‘¤ '+escHtml(acc.username)+'</span>'
      +'<span style="font-size:0.72rem;color:var(--tl);display:block;margin-top:0.1rem;">Staff Â· Password protected</span></div>'
      +'<button data-delstaff="'+uid+'" style="background:#fff0f0;border:1px solid #e0b0b0;border-radius:6px;padding:0.3rem 0.7rem;font-size:0.75rem;color:#c0392b;cursor:pointer;">ðŸ—‘ï¸ Remove</button>'
      +'</div>';
  }).join('');
  el.querySelectorAll('[data-delstaff]').forEach(function(btn){
    btn.addEventListener('click',function(){
      var uid=this.dataset.delstaff;
      var name=staffAccountsMap[uid]?staffAccountsMap[uid].username:'this account';
      showDeletePopup('staff account for '+name,async function(){
        await remove(ref(db,'staffAccounts/'+uid));
      });
    });
  });
}
window.addStaffAccount=async function(){
  var username=(document.getElementById('staffUsername').value||'').trim().toLowerCase();
  var password=document.getElementById('staffPassword').value;
  var msg=document.getElementById('staffAddMsg');
  function showMsg(text,ok){
    msg.textContent=text;msg.style.display='block';
    msg.style.background=ok?'rgba(45,158,95,0.12)':'rgba(192,57,57,0.1)';
    msg.style.color=ok?'#1a7a45':'#c0392b';
    msg.style.border='1px solid '+(ok?'rgba(45,158,95,0.3)':'rgba(192,57,57,0.3)');
  }
  if(!username){showMsg('Username is required.',false);return;}
  if(!password||password.length<4){showMsg('Password must be at least 4 characters.',false);return;}
  var taken=Object.values(staffAccountsMap).some(function(a){return a.username===username;});
  if(taken){showMsg('Username "'+username+'" is already taken.',false);return;}
  var buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(password));
  var hashHex=Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
  var uid='staff_'+Date.now();
  try{
    await set(ref(db,'staffAccounts/'+uid),{username,passwordHash:hashHex});
    document.getElementById('staffUsername').value='';
    document.getElementById('staffPassword').value='';
    showMsg('âœ… Staff account "'+username+'" created.',true);
  }catch(e){showMsg('Error: '+e.message,false);}
};


function renderAdminAccounts(){
  var el=document.getElementById('adminAccList');if(!el)return;
  var keys=Object.keys(adminAccountsMap);
  if(!keys.length){el.innerHTML='<p style="font-size:0.85rem;color:var(--tl);">No admin accounts yet.</p>';return;}
  el.innerHTML=keys.map(function(uid){
    var acc=adminAccountsMap[uid];
    var noPay=acc.access==='nopay';
    return'<div style="display:flex;align-items:center;justify-content:space-between;gap:0.75rem;flex-wrap:wrap;background:#fff;border:1px solid var(--cd);border-radius:8px;padding:0.7rem 1rem;margin-bottom:0.5rem;">'
      +'<div><span style="font-size:0.9rem;font-weight:500;color:var(--bd);">ðŸ”‘ '+escHtml(acc.username)+'</span>'
      +'<span style="font-size:0.72rem;color:'+(noPay?'#b07a2a':'var(--tl)')+';display:block;margin-top:0.1rem;">'+(noPay?'Admin Â· All except Payment Details':'Admin Â· Full access')+'</span></div>'
      +'<div style="display:flex;align-items:center;gap:0.5rem;">'
      +'<select data-accessuid="'+uid+'" title="Access level" style="background:var(--cr);border:1px solid var(--cd);border-radius:6px;padding:0.3rem 0.5rem;font-size:0.75rem;font-family:\'Inter\',sans-serif;color:var(--td);cursor:pointer;">'
      +'<option value="full"'+(noPay?'':' selected')+'>âœ… Full access</option>'
      +'<option value="nopay"'+(noPay?' selected':'')+'>ðŸ”’ No Payment Details</option>'
      +'</select>'
      +'<button data-deladmin="'+uid+'" style="background:#fff0f0;border:1px solid #e0b0b0;border-radius:6px;padding:0.3rem 0.7rem;font-size:0.75rem;color:#c0392b;cursor:pointer;">ðŸ—‘ï¸ Remove</button>'
      +'</div></div>';
  }).join('');
  el.querySelectorAll('[data-deladmin]').forEach(function(btn){
    btn.addEventListener('click',function(){
      var uid=this.dataset.deladmin;
      var name=adminAccountsMap[uid]?adminAccountsMap[uid].username:'this account';
      showDeletePopup('admin account for '+name,async function(){
        await remove(ref(db,'adminAccounts/'+uid));
      });
    });
  });
  el.querySelectorAll('[data-accessuid]').forEach(function(sel){
    sel.addEventListener('change',async function(){
      await update(ref(db,'adminAccounts/'+this.dataset.accessuid),{access:this.value});
    });
  });
}
window.addAdminAccount=async function(){
  var username=(document.getElementById('adminAccUsername').value||'').trim().toLowerCase();
  var password=document.getElementById('adminAccPassword').value;
  var msg=document.getElementById('adminAccMsg');
  function showMsg(text,ok){
    msg.textContent=text;msg.style.display='block';
    msg.style.background=ok?'rgba(45,158,95,0.12)':'rgba(192,57,57,0.1)';
    msg.style.color=ok?'#1a7a45':'#c0392b';
    msg.style.border='1px solid '+(ok?'rgba(45,158,95,0.3)':'rgba(192,57,57,0.3)');
  }
  if(!username){showMsg('Username is required.',false);return;}
  if(username===SUPER_ADMIN_USERNAME){showMsg('"'+username+'" is reserved.',false);return;}
  if(!password||password.length<4){showMsg('Password must be at least 4 characters.',false);return;}
  var taken=Object.values(adminAccountsMap).some(function(a){return a.username===username;});
  if(taken){showMsg('Username "'+username+'" already taken.',false);return;}
  var buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(password));
  var hashHex=Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
  try{
    var access=(document.getElementById('adminAccAccess')||{}).value||'full';
    await set(ref(db,'adminAccounts/'+('admin_'+Date.now())),{username,passwordHash:hashHex,access});
    document.getElementById('adminAccUsername').value='';
    document.getElementById('adminAccPassword').value='';
    var accSel=document.getElementById('adminAccAccess');if(accSel)accSel.value='full';
    showMsg('âœ… Admin account "'+username+'" created.',true);
  }catch(e){showMsg('Error: '+e.message,false);}
};

function renderPublicReviews(){
  var el=document.getElementById('publicReviewsContainer');if(!el)return;
  var entries=Object.entries(reviewsMap);
  if(!entries.length){el.innerHTML='<p style="text-align:center;color:var(--tl);padding:2rem;">No reviews yet.</p>';return;}
  function stars(n){return'â­'.repeat(Math.max(1,Math.min(5,parseInt(n)||5)));}
  function card(r,featured){
    var initials=escHtml((r.name||'?').split(' ').map(function(w){return w[0];}).join('').substring(0,2).toUpperCase());
    return'<div class="review-card"'+(featured?' style="margin-bottom:1.25rem;"':'')+'>'+
      '<div class="review-stars">'+stars(r.stars)+'</div>'+
      (r.title?'<p style="font-weight:600;color:var(--bd);margin-bottom:0.75rem;font-size:0.95rem;">'+escHtml(r.title)+'</p>':'')+
      '<p class="review-text">'+escHtml(r.text).replace(/\n/g,'<br>')+'</p>'+
      '<div class="review-author"><div class="review-avatar">'+initials+'</div>'+
      '<div><div class="review-name">'+escHtml(r.name)+'</div>'+
      '<div class="review-date">'+escHtml(r.date)+'</div></div></div></div>';
  }
  var html2='';
  if(entries.length===1){
    html2=card(entries[0][1],true);
  }else{
    html2=card(entries[0][1],true);
    html2+='<div class="reviews-grid">';
    for(var i=1;i<entries.length;i++)html2+=card(entries[i][1],false);
    html2+='</div>';
  }
  el.innerHTML=html2;
}


const overviewHistoryLoader=createOverviewHistoryLoader({
  key:function(){return periodKey(window.AccazaAdminPeriods.get('sales'));},
  read:async function(key){var parts=key.split(':'),p={startAt:Number(parts[0]),endAt:Number(parts[1])},res=await Promise.all(['orders','archivedOrders'].map(function(path){return readSalesPeriod(db,{ref,get,query,orderByChild,startAt,endAt},path,p);}));return{orders:res[0],archived:res[1]};},
  onData:function(){var dt=document.getElementById('tab-dashboard');if(adminLoggedIn&&dt&&dt.style.display!=='none')renderDashboard();},
  onError:function(e){console.error('Overview full history load failed; retry scheduled',e);}
});
function ensureOverviewFullHistory(force){return overviewHistoryLoader.load(force);}
if(window.AccazaAdminPeriods)window.AccazaAdminPeriods.setWaiter(function(){var scope=subscriptionHub.stats().activeScope,paths=scope==='saleshistory'?['orders','archivedOrders','financialMovements']:['orders','archivedOrders'];return subscriptionHub.whenReady(paths);});
function renderDashboard(){
  function _rows(map){return Object.entries(map||{}).map(function(pair){var o=pair[1];return o&&o.id?o:Object.assign({_overviewKey:pair[0]},o||{});});}
  function _mergedMap(snapshot,live){return Object.assign({},snapshot||{},live||{});}
  ensureOverviewFullHistory();
  const fullHistory=overviewHistoryLoader.snapshot();
  const active=_rows(adminOrdersMap);
  const historyOrders=_rows(subscriptionHub.historyStatus('orders').periodKey&&subscriptionHub.historyStatus('orders').ready?overviewOrdersMap:fullHistory.orders);
  const archived=_rows(subscriptionHub.historyStatus('archivedOrders').periodKey&&subscriptionHub.historyStatus('archivedOrders').ready?archivedOrdersMap:fullHistory.archived);
  function _isSale(o){return window.AccazaSales.qualifies(o);}
  function _tsOf(o){return window.AccazaSales.stamp(o);}
  const outcomes=mergeOverviewOrders(active,historyOrders,archived);
  const reconciledSales=mergeOverviewOrders([],historyOrders,archived);
  const sales=reconciledSales.filter(_isSale);
  const now2=new Date();
  const startToday=new Date(now2.getFullYear(),now2.getMonth(),now2.getDate()).getTime();
  const _sow=new Date(now2);_sow.setDate(now2.getDate()-now2.getDay());_sow.setHours(0,0,0,0);const startWeek=_sow.getTime();
  const startMonth=new Date(now2.getFullYear(),now2.getMonth(),1).getTime();
  function sumOrders(arr){return{rev:arr.reduce((s,o)=>s+window.AccazaSales.amounts(o).net,0),cnt:arr.length};}
  const t=sumOrders(sales.filter(o=>_tsOf(o)>=startToday)),w=sumOrders(sales.filter(o=>_tsOf(o)>=startWeek)),m=sumOrders(sales.filter(o=>_tsOf(o)>=startMonth)),a=sumOrders(sales);
  function setCard(id,rev,cnt){const el=document.getElementById(id);if(el)el.textContent='â‚±'+rev.toLocaleString();const cel=document.getElementById(id+'Count');if(cel)cel.textContent=cnt+' order'+(cnt!==1?'s':'');}
  setCard('dashToday',t.rev,t.cnt);setCard('dashWeek',w.rev,w.cnt);setCard('dashMonth',m.rev,m.cnt);setCard('dashAllTime',a.rev,a.cnt);
  overviewInsights.render({active:active,orders:historyOrders,archived:archived,outcomes:outcomes,sales:sales,feedReady:{orders:overviewOrdersLoaded,archivedOrders:archivedOrdersLoaded,financialMovements:overviewFinancialMovementsLoaded},historyComplete:fullHistory.complete&&subscriptionHub.historyStatus('orders').ready&&subscriptionHub.historyStatus('archivedOrders').ready,menuItems:menuItemsMap||{},catType:overviewCatType,drinkCategories:DRINK_CATS,cashAccounts:overviewCashAccounts||{}});
}

function drawPaymentPie(gcashR,bankR){
  const canvas=document.getElementById('paymentChart');if(!canvas)return;
  const size=160;canvas.width=size;canvas.height=size;
  const ctx=canvas.getContext('2d'),cx=size/2,cy=size/2,r=size*0.42;
  ctx.clearRect(0,0,size,size);
  if(gcashR+bankR===0){ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.fillStyle='#cdbda7';ctx.fill();return;}
  const start=-Math.PI/2;
  [[gcashR,'#b08d57'],[bankR,'#3b8fd4']].forEach(function(pair,i){
    const s=i===0?start:start+gcashR*Math.PI*2,e=i===0?start+gcashR*Math.PI*2:start+Math.PI*2;
    ctx.beginPath();ctx.moveTo(cx,cy);ctx.arc(cx,cy,r,s,e);ctx.closePath();ctx.fillStyle=pair[1];ctx.fill();
  });
}

window.downloadArchivePDF=function(){
  const fromVal=document.getElementById('archiveFrom').value,toVal=document.getElementById('archiveTo').value;
  let orders=sortArchivedOrders(Object.values(archivedOrdersMap));
  if(fromVal)orders=orders.filter(o=>new Date(o.archivedAt||0)>=new Date(fromVal));
  if(toVal)orders=orders.filter(o=>new Date(o.archivedAt||0)<=new Date(toVal+'T23:59:59'));
  if(!orders.length){alert('No archived orders found for the selected date range.');return;}
  const archiveTotals=summarizeArchivedOrders(orders);const rejCnt=archiveTotals.excludedCount,totalRev=archiveTotals.completedRevenue;
  const gcashCnt=orders.filter(o=>o.payment==='GCash').length,bankCnt=orders.filter(o=>o.payment==='Bank Transfer').length;
  const rowH=52,headerH=238,pageW=800,totalH=headerH+orders.length*rowH+80;
  const canvas=document.createElement('canvas');canvas.width=pageW;canvas.height=totalH;
  const ctx=canvas.getContext('2d');
  ctx.fillStyle='#e0d4c6';ctx.fillRect(0,0,pageW,totalH);
  ctx.fillStyle='#19241b';ctx.fillRect(0,0,pageW,headerH);
  ctx.fillStyle='#c9a36a';ctx.font='bold 28px Georgia,serif';ctx.textAlign='center';ctx.fillText('Accaza Coffee House',pageW/2,55);
  ctx.fillStyle='rgba(224,212,198,0.7)';ctx.font='14px Inter,sans-serif';ctx.fillText('Saratoga Ave, La Mediterranea, DasmariÃ±as, Cavite',pageW/2,82);
  ctx.fillStyle='#fff';ctx.font='bold 18px Georgia,serif';ctx.fillText('Order Archive Report',pageW/2,118);
  const dateRange=fromVal&&toVal?fromVal+' to '+toVal:fromVal?'From '+fromVal:toVal?'Up to '+toVal:'All Time';
  ctx.fillStyle='rgba(224,212,198,0.6)';ctx.font='12px Inter,sans-serif';ctx.fillText(dateRange,pageW/2,140);
  ctx.fillStyle='rgba(255,255,255,0.1)';ctx.fillRect(40,156,pageW-80,48);
  ctx.fillStyle='#c9a36a';ctx.font='bold 14px Inter,sans-serif';ctx.textAlign='left';ctx.fillText('Total Orders: '+orders.length,60,178);
  ctx.textAlign='center';ctx.fillText('Completed: '+archiveTotals.completedCount+' Â· Revenue: â‚±'+totalRev.toLocaleString(),pageW/2,174);
  ctx.textAlign='right';ctx.fillText('Refunded: '+archiveTotals.refundedCount+' Â· â‚±'+archiveTotals.refundedAmount.toLocaleString(),pageW-60,174);
  ctx.textAlign='left';ctx.fillText('Voided: '+archiveTotals.voidedCount+' Â· â‚±'+archiveTotals.voidedAmount.toLocaleString(),60,194);
  ctx.textAlign='right';ctx.fillText('Rejected / other: '+rejCnt+' Â· GCash: '+gcashCnt+' Â· Bank: '+bankCnt,pageW-60,194);
  ctx.fillStyle='rgba(224,212,198,0.4)';ctx.font='11px Inter,sans-serif';ctx.textAlign='center';ctx.fillText('Generated: '+new Date().toLocaleDateString('en-PH',{year:'numeric',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'}),pageW/2,220);
  let y=headerH+16;
  ctx.fillStyle='#19241b';ctx.font='bold 11px Inter,sans-serif';ctx.textAlign='left';
  ['Order ID','Customer','Items','Total','Payment','Type','Date'].forEach(function(h,i){ctx.fillText(h,[40,120,240,530,610,680,730][i],y);});
  ctx.strokeStyle='#cdbda7';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(40,y+8);ctx.lineTo(pageW-40,y+8);ctx.stroke();
  y+=rowH*0.6;
  orders.forEach(function(o,idx){
    if(idx%2===0){ctx.fillStyle='rgba(176,141,87,0.06)';ctx.fillRect(40,y-14,pageW-80,rowH);}
    ctx.fillStyle='#1c2420';ctx.font='11px Inter,sans-serif';ctx.textAlign='left';
    ctx.fillText((o.id||'â€”'),40,y+4);
    ctx.fillText((o.name||'â€”').slice(0,14),120,y+4);
    ctx.fillText(((o.items||'').length>35?o.items.slice(0,35)+'â€¦':o.items||'â€”'),240,y+4);
    ctx.fillStyle=o.prevStatus==='Rejected'?'#c0392b':'#b08d57';ctx.font='bold 11px Inter,sans-serif';ctx.fillText((o.prevStatus==='Rejected'?'âœ— ':'')+'â‚±'+(o.total||0).toLocaleString(),530,y+4);
    ctx.fillStyle='#1c2420';ctx.font='11px Inter,sans-serif';
    ctx.fillText(o.payment==='GCash'?'GCash':'Bank',610,y+4);ctx.fillText(o.type||'â€”',680,y+4);ctx.fillText(o.archivedDate||'â€”',730,y+4);
    ctx.strokeStyle='#cdbda7';ctx.lineWidth=0.5;ctx.beginPath();ctx.moveTo(40,y+rowH-14);ctx.lineTo(pageW-40,y+rowH-14);ctx.stroke();
    y+=rowH;
  });
  ctx.fillStyle='#19241b';ctx.fillRect(0,totalH-40,pageW,40);
  ctx.fillStyle='rgba(224,212,198,0.5)';ctx.font='11px Inter,sans-serif';ctx.textAlign='center';ctx.fillText('Accaza Coffee House Â· Confidential Â· For internal use only',pageW/2,totalH-14);
  const link=document.createElement('a');link.download='Accaza_Archive_'+new Date().toISOString().slice(0,10)+'.png';link.href=canvas.toDataURL('image/png');link.click();
};

function renderComments(){
  const types=['Contact','Complaint','Suggestion','Compliment','Other'];
  const empty={Contact:'No website messages yet.',Complaint:'No complaints yet. ðŸŽ‰',Suggestion:'No suggestions yet.',Compliment:'No compliments yet.',Other:'No other feedback yet.'};
  const color={Contact:'#2f6f8f',Complaint:'#c0392b',Suggestion:'#f39c12',Compliment:'#2d9e5f',Other:'#888'};
  types.forEach(function(type){
    const el=document.getElementById('fbList'+type);if(!el)return;
    const items=Object.entries(feedbacksMap).filter(function(e){return e[1].type===type;});
    if(!items.length){el.innerHTML='<p style="color:var(--tl);padding:1rem;background:#fff;border-radius:8px;text-align:center;font-size:0.85rem;">'+empty[type]+'</p>';return;}
    el.innerHTML=items.map(function(e){const f=e[1]||{},key=escHtml(e[0]),status=f.status==='Resolved'?'Resolved':'Unread',name=escHtml(f.name),contact=escHtml(f.contact),date=escHtml(f.date),message=escHtml(f.message);return'<div style="background:#fff;border:1px solid #cdbda7;border-left:4px solid '+color[type]+';border-radius:8px;padding:1rem;margin-bottom:0.75rem;"><div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:0.5rem;"><div><div style="font-weight:500;font-size:0.9rem;color:#19241b;">'+name+'</div><div style="font-size:0.75rem;color:#79806f;">'+(contact?contact+' Â· ':'')+date+'</div></div><span style="font-size:0.72rem;padding:0.2rem 0.6rem;border-radius:999px;font-weight:500;background:'+(status==='Resolved'?'#d4edda':'#fef3cd')+';color:'+(status==='Resolved'?'#155724':'#856404')+';">'+status+'</span></div><p style="font-size:0.85rem;color:#44523f;font-style:italic;margin:0.4rem 0;">"'+message+'"</p><div class="staff-hide" style="display:flex;justify-content:flex-end;gap:0.5rem;margin-top:0.75rem;">'+(status==='Unread'?'<button data-markfb="'+key+'" style="background:#f0faf4;border:1px solid #a8d5b5;border-radius:6px;padding:0.35rem 0.85rem;font-size:0.78rem;color:#2d6a4f;cursor:pointer;">âœ… Mark Resolved</button>':'')+(status==='Resolved'?'<button data-delfb="'+key+'" data-delfbname="'+name+'" style="background:#fff0f0;border:1px solid #e0b0b0;border-radius:6px;padding:0.35rem 0.85rem;font-size:0.78rem;color:#c0392b;cursor:pointer;">ðŸ—‘ï¸ Delete</button>':'')+'</div></div>';}).join('');
    el.querySelectorAll('button[data-markfb]').forEach(function(btn){btn.addEventListener('click',function(){update(ref(db,'feedbacks/'+this.dataset.markfb),{status:'Resolved'});});});
    el.querySelectorAll('button[data-delfb]').forEach(function(btn){btn.addEventListener('click',function(){showDeletePopup(this.dataset.delfbname,async function(){await remove(ref(db,'feedbacks/'+btn.dataset.delfb));});});});
  });
}

function renderAdminReviews(){
  const el=document.getElementById('adminReviewsList'),entries=Object.entries(reviewsMap);
  if(!entries.length){el.innerHTML='<div class="empty-state">No reviews added yet.</div>';return;}
  el.innerHTML=entries.map(function(e){const key=escHtml(e[0]),r=e[1]||{},name=escHtml(r.name),date=escHtml(r.date),review=escHtml(r.text),stars=Math.max(0,Math.min(5,parseInt(r.stars)||0));return'<div class="order-admin-card" style="display:flex;justify-content:space-between;align-items:flex-start;">'+'<div><div class="order-admin-name">'+name+' '+'â­'.repeat(stars)+'</div>'+'<div class="order-admin-meta">'+date+'</div>'+'<div class="order-admin-items">"'+review+'"</div></div>'+(staffLoggedIn?'':'<button data-delrev="'+key+'" data-delrevname="'+name+'" style="background:none;border:1px solid #e0b0b0;border-radius:4px;padding:0.3rem 0.6rem;font-size:0.75rem;color:#c0392b;cursor:pointer;margin-left:1rem;flex-shrink:0;">Remove</button>')+'</div>';}).join('');
  el.querySelectorAll('button[data-delrev]').forEach(function(btn){btn.addEventListener('click',function(){showDeletePopup(this.dataset.delrevname,async function(){await remove(ref(db,'reviews/'+btn.dataset.delrev));});});});
}

window.addReview=async function(){
  const name=document.getElementById('newReviewName').value.trim(),stars=parseInt(document.getElementById('newReviewStars').value),text=document.getElementById('newReviewText').value.trim();
  if(!name||!text){alert('Please enter name and review.');return;}
  var dateVal=document.getElementById('newReviewDate').value.trim()||new Date().toLocaleDateString('en-PH',{year:'numeric',month:'long',day:'numeric'});
  await push(reviewsRef,{name,stars,text,date:dateVal});
  document.getElementById('newReviewName').value='';document.getElementById('newReviewDate').value='';document.getElementById('newReviewText').value='';
  document.getElementById('reviewAddConfirm').style.display='block';setTimeout(function(){document.getElementById('reviewAddConfirm').style.display='none';},2500);
};

window.savePayment=async function(){
  function getChk(id){var el=document.getElementById(id);return el?el.checked:true;}
  ['Gcash','Bdo','Ub','Maya','Bank3','Bank4'].forEach(function(k){
    var note=document.getElementById('chk'+k+'Note');
    if(note)note.style.display=getChk('chk'+k)?'none':'block';
  });
  const data={gcashNum:document.getElementById('editGcashNum').value,gcashName:document.getElementById('editGcashName').value,bdoNum:document.getElementById('editBdoNum').value,bdoName:document.getElementById('editBdoName')?document.getElementById('editBdoName').value:'',ubNum:document.getElementById('editUbNum').value,ubName:document.getElementById('editUbName')?document.getElementById('editUbName').value:'',mayaNum:document.getElementById('editMayaNum').value,mayaName:document.getElementById('editMayaName').value,bank3Label:document.getElementById('editBank3Label').value,bank3Num:document.getElementById('editBank3Num').value,bank3Name:document.getElementById('editBank3Name').value,bank4Label:document.getElementById('editBank4Label').value,bank4Num:document.getElementById('editBank4Num').value,bank4Name:document.getElementById('editBank4Name').value,gcashEnabled:getChk('chkGcash'),bdoEnabled:getChk('chkBdo'),ubEnabled:getChk('chkUb'),mayaEnabled:getChk('chkMaya'),bank3Enabled:getChk('chkBank3'),bank4Enabled:getChk('chkBank4')};
  await set(paymentRef,data);document.getElementById('saveConfirm').style.display='block';setTimeout(function(){document.getElementById('saveConfirm').style.display='none';},3000);
};

let archivePanelOpen=false;
window.toggleArchivePanel=function(){archivePanelOpen=!archivePanelOpen;document.getElementById('archivePanel').style.display=archivePanelOpen?'block':'none';var ordersList=document.getElementById('ordersList');if(ordersList){if(archivePanelOpen)ordersList.style.display='none';else ordersList.style.removeProperty('display');}var btn=document.getElementById('archiveToggleBtn');var hdg=document.getElementById('ordersHeading');if(btn){btn.textContent=archivePanelOpen?'â† Back to Orders':'ðŸ“¦ View Archive';}if(hdg){hdg.textContent=archivePanelOpen?'Order Archive':'Active Orders';}subscriptionHub.activate(archivePanelOpen?'archive':'orders');if(archivePanelOpen)renderArchive();};
function renderArchive(){_paintArchive();}
function _paintArchive(){
  const el=document.getElementById('archiveList'),sumEl=document.getElementById('archiveSummary');if(!el)return;
  const fromVal=document.getElementById('archiveFrom').value,toVal=document.getElementById('archiveTo').value;
  let orders=sortArchivedOrders(Object.values(archivedOrdersMap));
  if(fromVal)orders=orders.filter(o=>new Date(o.archivedAt||0)>=new Date(fromVal));
  if(toVal)orders=orders.filter(o=>new Date(o.archivedAt||0)<=new Date(toVal+'T23:59:59'));
  const archiveTotals=summarizeArchivedOrders(orders),totalRev=archiveTotals.completedRevenue;
  var hs=subscriptionHub.historyStatus('archivedOrders');
  sumEl.innerHTML='<div style="width:100%;font-size:0.72rem;color:var(--tl);">Loaded '+hs.loaded+' most recent archived order(s), sorted by order date and time (newest first). Revenue includes completed orders only; refunds, voids, and rejected/cancelled orders are excluded.</div><div><span class="archive-sum-num">'+archiveTotals.totalCount+'</span><span class="archive-sum-lbl">All archived orders</span></div><div><span class="archive-sum-num">'+archiveTotals.completedCount+' Â· â‚±'+totalRev.toLocaleString()+'</span><span class="archive-sum-lbl">Completed Â· Revenue</span></div><div><span class="archive-sum-num">'+archiveTotals.refundedCount+' Â· â‚±'+archiveTotals.refundedAmount.toLocaleString()+'</span><span class="archive-sum-lbl">Refunded Â· Amount refunded</span></div><div><span class="archive-sum-num">'+archiveTotals.voidedCount+' Â· â‚±'+archiveTotals.voidedAmount.toLocaleString()+'</span><span class="archive-sum-lbl">Voided Â· Excluded value</span></div><div><span class="archive-sum-num">'+archiveTotals.excludedCount+' Â· â‚±'+archiveTotals.excludedAmount.toLocaleString()+'</span><span class="archive-sum-lbl">Rejected / Cancelled Â· Excluded</span></div>';
  var cards=orders.length?orders.map(function(o){var oid=escHtml(o.id),age=Date.now()-Number(o.archivedAt||0),canDelete=o.prevStatus==='Rejected'&&age>=90*24*60*60*1000,outcome=archiveOutcome(o);return'<div class="archive-card"><div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:0.4rem;"><div><div style="font-weight:500;font-size:0.88rem;color:var(--bd);">'+escHtml(o.name)+' <span style="font-size:0.72rem;color:var(--tl);">#'+oid+'</span></div><div style="font-size:0.75rem;color:var(--tl);">'+escHtml(o.date)+' Â· '+escHtml(o.time)+'</div></div><span class="badge" style="'+outcome.style+'">'+outcome.icon+' '+escHtml(outcome.label)+'</span></div><div style="font-size:0.8rem;color:var(--tm);margin:0.3rem 0;">ðŸ›’ '+escHtml(o.items)+'</div><div style="font-size:0.78rem;color:var(--tl);">â‚±'+(Number(o.total)||0).toLocaleString()+' Â· '+escHtml(o.payment)+' Â· '+escHtml(o.type)+'</div><div style="font-size:0.72rem;color:var(--tl);margin-top:0.3rem;">Archived: '+escHtml(o.archivedDate||'â€”')+'</div>'+(adminLoggedIn?'<div style="margin-top:0.5rem;text-align:right;">'+(canDelete?'<button data-delarch="'+oid+'" style="background:#fdecea;border:1px solid #f5c6c6;color:#c0392b;border-radius:4px;padding:0.3rem 0.7rem;font-size:0.74rem;cursor:pointer;font-weight:600;">ðŸ—‘ Delete rejected order</button>':'<span style="font-size:0.7rem;color:var(--tl);">ðŸ”’ Retained audit record</span>')+'</div>':'')+'</div>';}).join(''):'<p style="color:var(--tl);text-align:center;padding:1.5rem;font-size:0.88rem;">No archived orders in the loaded pages for this range.</p>';
  el.innerHTML=cards+'<div style="text-align:center;padding:0.8rem;"><button id="archiveLoadOlder" class="pz-btn sec"'+(hs.hasOlder?'':' disabled')+'>'+(hs.hasOlder?'Load 100 older orders':'All loaded orders reached')+'</button></div>';
  var more=document.getElementById('archiveLoadOlder');if(more&&hs.hasOlder)more.onclick=async function(){more.disabled=true;more.textContent='Loading older ordersâ€¦';try{await subscriptionHub.loadOlder('archivedOrders');}catch(e){more.textContent='Could not load older orders';more.disabled=false;}};
  el.querySelectorAll('button[data-delarch]').forEach(function(btn){btn.addEventListener('click',function(){var oid=this.getAttribute('data-delarch'),o=archivedOrdersMap[oid];showDeletePopup('PERMANENTLY delete eligible rejected order #'+oid+(o&&o.name?' ('+o.name+')':'')+'. Owner, Superadmin, Admin, or Manager approval is required.',async function(){try{var ap=await requestManagerApproval('delete_archived_order',oid,Number(o&&o.total)||0,'Delete rejected order after retention period');await manageOrderArchiveCall({action:'delete',orderId:oid,approvalId:ap.approvalId});delete archivedOrdersMap[oid];renderArchive();}catch(e){if(String((e&&e.message)||e).indexOf('cancelled')<0)alert('Could not delete order: '+((e&&e.message)||e));}});});});
}

function showDeletePopup(label,onConfirm){
  document.getElementById('deleteLabel').textContent=label;
  const isArchive=String(label).toLowerCase().includes('archive');
  document.getElementById('deleteConfirmBtn').textContent=isArchive?'Yes, Archive':'Yes, Delete';
  document.getElementById('deleteConfirmBtn').style.background=isArchive?'#41464b':'#c0392b';
  document.getElementById('deleteConfirmBtn').onclick=function(){onConfirm();document.getElementById('deletePopup').classList.remove('show');};
  document.getElementById('deletePopup').classList.add('show');
}

window.openAdmin=function(){document.getElementById('loginOverlay').classList.add('show');setTimeout(function(){document.getElementById('adminPass').focus();},150);};
window.closeAdmin=function(){document.getElementById('loginOverlay').classList.remove('show');document.getElementById('loginErr').style.display='none';document.getElementById('adminPass').value='';};

window.selectLoginRole=function(role){
  currentLoginRole=role;
  document.getElementById('loginForm').style.display='block';
  var aBtn=document.getElementById('roleAdminBtn'),sBtn=document.getElementById('roleStaffBtn');
  aBtn.style.background=role==='admin'?'var(--bd)':'#fff';
  aBtn.style.color=role==='admin'?'#fff':'var(--td)';
  aBtn.style.borderColor=role==='admin'?'var(--bd)':'var(--cd)';
  sBtn.style.background=role==='staff'?'var(--bl)':'#fff';
  sBtn.style.color=role==='staff'?'#fff':'var(--td)';
  sBtn.style.borderColor=role==='staff'?'var(--bl)':'var(--cd)';
  var fBtn=document.getElementById('forgotPwBtn');if(fBtn)fBtn.style.display='inline';
  document.getElementById('loginErr').style.display='none';
  setTimeout(function(){document.getElementById('adminUser').focus();},100);
};

var DEFAULT_STAFF_PERMS={orders:true,reservations:true,pos:true,inventory:true,purchases:false,recipes:true,usage:true,registerOps:true,availability:true,comments:true,reviews:true,appcustomers:true,analytics:false,pnl:false,dailyreport:false,discrepancy:false,petty:true,channelpricing:false,dedupe:false,cashflow:false,receivables:false,payables:false,stockvalue:false},roleLandingDone=false;
var _permTabMap={"'orders'":'orders',"'reservations'":'reservations',"'calendar'":'reservations',"'availSection'":'availability',"'commentsSection'":'comments',"'reviews'":'reviews',"'appcustomers'":'appcustomers',"'pos'":'pos',"'inventory'":'inventory',"'purchases'":'purchases',"'recipes'":'recipes',"'usage'":'usage',"'discrepancy'":'discrepancy',"'petty'":'petty',"'channelpricing'":'channelpricing',"'dedupe'":'dedupe',"'cashflow'":'cashflow',"'receivables'":'receivables',"'payables'":'payables',"'stockvalue'":'stockvalue',"'dailyreport'":'dailyreport',"'analytics'":'analytics',"'pnl'":'pnl',"'ops'":'registerOps',"'possettings'":'possettings'};
var _permAlwaysHide=["'payment'","'staffaccounts'","'adminaccounts'","'staffaccess'","'packages'","'operations'"];
function mountLegacyAdminPanels(){
  var wrap=document.querySelector('#adminDash .admin-wrap');if(!wrap)return;
  ['availSection','commentsSection'].forEach(function(id){var panel=document.getElementById(id);if(!panel)return;panel.classList.add('admin-tab-content','admin-integrated-panel');wrap.appendChild(panel);});
}
mountLegacyAdminPanels();
window.showAdminSection=function(id,btn){
  var av=document.getElementById('availSection'),cm=document.getElementById('commentsSection');
  if(id==='availSection'){ document.querySelectorAll('.admin-tab').forEach(function(b){b.classList.remove('active');});document.querySelectorAll('.admin-tab-content').forEach(function(t){t.style.display='none';});if(btn)btn.classList.add('active');if(av)av.style.display='block';if(typeof buildAvail==='function')buildAvail();workspaceShell.update('availability');window.scrollTo({top:document.getElementById('adminDash').offsetTop,behavior:'smooth'}); }
  else if(id==='commentsSection'){ document.querySelectorAll('.admin-tab').forEach(function(b){b.classList.remove('active');});document.querySelectorAll('.admin-tab-content').forEach(function(t){t.style.display='none';});if(btn)btn.classList.add('active');if(cm)cm.style.display='block';subscriptionHub.activate('comments');if(typeof renderComments==='function')renderComments();workspaceShell.update('comments');window.scrollTo({top:document.getElementById('adminDash').offsetTop,behavior:'smooth'}); }
  else { if(av)av.style.display='none'; if(cm)cm.style.display='none'; window.scrollTo({top:0,behavior:'smooth'}); }
};
function applyStaffPerms(perms){
  document.querySelectorAll('.admin-tab').forEach(function(btn){
    var oc=btn.getAttribute('onclick')||'';
    if(_permAlwaysHide.some(function(t){return oc.indexOf(t)!==-1;})){btn.style.display='none';return;}
    for(var k in _permTabMap){ if(oc.indexOf(k)!==-1){ btn.style.display=perms[_permTabMap[k]]?'':'none'; return; } }
  });
  var na=document.getElementById('navAvail'); if(na)na.style.display='none';
  var nc=document.getElementById('navComments'); if(nc)nc.style.display='none';
  document.querySelectorAll('.admin-group').forEach(function(gb){var g=gb.getAttribute('data-grp');var row=document.querySelector('.tabgrp[data-grp="'+g+'"]');var vis=false;if(row)row.querySelectorAll('.admin-tab').forEach(function(b){if(b.style.display!=='none')vis=true;});gb.style.display=vis?'':'none';});
  var curG=document.querySelector('.admin-group.active');
  if(!curG||curG.style.display==='none'){var fg=null;document.querySelectorAll('.admin-group').forEach(function(gb){if(!fg&&gb.style.display!=='none')fg=gb;});if(fg)window.showTabGroup(fg.getAttribute('data-grp'),fg);}
  landRoleHome();
}
function landRoleHome(){
  if(roleLandingDone||!currentUser||!window.showTabGroup)return;
  var target={cashier:'pos',kitchen:'orders',finance:'finance'}[String(currentUser.serverRole||'').toLowerCase()];
  if(!target)return;
  var group=document.querySelector('.admin-group[data-grp="'+target+'"]'),row=document.querySelector('.tabgrp[data-grp="'+target+'"]');
  if(!group||group.style.display==='none'||!row)return;
  var first=null;row.querySelectorAll('.admin-tab').forEach(function(button){if(!first&&button.style.display!=='none')first=button;});
  if(!first)return;roleLandingDone=true;window.showTabGroup(target,group);
}
async function loginSuccess(role,username,uid,serverRole){
  roleLandingDone=false;
  currentUser={role:role,serverRole:serverRole||role,username:username,uid:uid};
  var effectiveRole=String(serverRole||role||'').toLowerCase();
  window.__accazaAuthz={uid:uid,role:effectiveRole,isPrivileged:['owner','superadmin','admin','manager'].indexOf(effectiveRole)>-1};
  subscriptionHub.authorize();
  subscriptionHub.activate('dashboard');
  ensureActiveOrdersCall({}).catch(function(e){console.warn('Active-order projection sweep deferred',e&&e.code);});
  try{sessionStorage.setItem('accaza_admin_session',JSON.stringify({username:username,uid:uid||null}));}catch(e){}
  try{if(!audioCtx)audioCtx=new(window.AudioContext||window.webkitAudioContext)();if(audioCtx.state==='suspended')audioCtx.resume();}catch(e){}
  document.getElementById('adminUser').value='';
  document.getElementById('adminPass').value='';
  closeAdmin();
  document.body.classList.remove('staff-mode');
  document.querySelectorAll('.admin-tab').forEach(function(t){t.style.removeProperty('display');});
  var aaccTab=document.getElementById('tabBtnAdminAccounts');
  if(aaccTab)aaccTab.style.display='none';

  if(role==='superadmin'||role==='admin'){
    adminLoggedIn=true;superAdminLoggedIn=(role==='superadmin');staffLoggedIn=false;
    document.getElementById('adminDash').style.display='block';
    document.getElementById('navAdminPanel').style.display='block';
    document.getElementById('navAvail').style.display='none';
    document.getElementById('navComments').style.display='none';
    document.getElementById('navAdminPanelLink').textContent='Admin panel';
    if(superAdminLoggedIn&&aaccTab)aaccTab.style.removeProperty('display');
    var hdr=document.querySelector('#adminDash .admin-header p');
    if(hdr)hdr.textContent=(superAdminLoggedIn?'Super admin':'Admin')+': '+username;
    if(role==='admin'&&uid&&adminAccountsMap[uid]&&adminAccountsMap[uid].access==='nopay'){
      document.querySelectorAll('.admin-tab').forEach(function(btn){
        var oc=btn.getAttribute('onclick')||'';
        if(oc.indexOf("'payment'")!==-1)btn.style.display='none';
      });
      var tpay=document.getElementById('tab-payment');if(tpay)tpay.style.display='none';
      if(hdr)hdr.textContent='Admin: '+username+' · Limited access';
    }
    setTimeout(function(){
      buildAvail();renderCategoryManager();renderOptionManager();renderNewItemOptionChecklist();renderComments();renderOrders();renderReservations();
      renderAdminReviews();renderAdminCalendar();renderDashboard();renderStaffAccounts();
      if(superAdminLoggedIn)renderAdminAccounts();
    },300);
  }else{
    staffLoggedIn=true;adminLoggedIn=false;superAdminLoggedIn=false;
    document.body.classList.add('staff-mode');
    document.getElementById('adminDash').style.display='block';
    document.getElementById('navAdminPanel').style.display='block';
    document.getElementById('navComments').style.display='none';
    document.getElementById('navAdminPanelLink').textContent='Staff panel';
    (function(){ applyStaffPerms(Object.assign({},DEFAULT_STAFF_PERMS)); get(ref(db,'adminPerms/'+uid)).then(function(sn){ var v=sn.val(); if(v)applyStaffPerms(Object.assign({},DEFAULT_STAFF_PERMS,v)); }).catch(function(){}); })();
    var hdr=document.querySelector('#adminDash .admin-header p');
    if(hdr)hdr.textContent='Staff: '+username;
    setTimeout(function(){
      renderOrders();renderReservations();renderAdminCalendar();renderDashboard();
      renderAdminReviews();renderComments();renderStaffMenu();
    },300);
  }
  window.scrollTo(0,0);
  workspaceShell.update('dashboard');
}

installPortalAuth({subscriptionHub:subscriptionHub,onAuthorized:loginSuccess,openLogin:window.openAdmin,onSignedOut:function(){adminLoggedIn=false;superAdminLoggedIn=false;staffLoggedIn=false;currentUser=null;currentLoginRole=null;window.__posShift=null;if(window.__refreshWorkspaceStatus)window.__refreshWorkspaceStatus();}});
const workspaceShell=installWorkspaceShell({currentUser:function(){return currentUser;},subscriptionHub:subscriptionHub});
window.switchTab=function(tab,btn){
  if(tab==='payment'&&currentUser&&currentUser.role==='admin'&&currentUser.uid&&adminAccountsMap[currentUser.uid]&&adminAccountsMap[currentUser.uid].access==='nopay'){alert('â›” You do not have access to Payment Details.');return;}
  subscriptionHub.activate(tab);
  var legacyAvailability=document.getElementById('availSection'),legacyComments=document.getElementById('commentsSection');
  if(legacyAvailability)legacyAvailability.style.display='none';if(legacyComments)legacyComments.style.display='none';
  document.querySelectorAll('.admin-tab').forEach(function(b){b.classList.remove('active');});
  if(btn)btn.classList.add('active');
  document.querySelectorAll('.admin-tab-content').forEach(function(t){t.style.display='none';});
  document.getElementById('tab-'+tab).style.display='block';
  if(tab==='orders')clearOrderAlert();
  if(tab==='orders')renderOrders();
  if(tab==='reviews')renderAdminReviews();
  if(tab==='calendar')renderAdminCalendar();
  if(tab==='dashboard'){ensureOverviewFullHistory();renderDashboard();}
  if(tab==='appcustomers')renderAppCustomers();
  workspaceShell.update(tab);
  setTimeout(function(){renderHistoryPager(tab);},0);
  try{var _ab=document.querySelector('.admin-tab.active'); if(_ab){var _g=_ab.closest('.tabgrp'); if(_g){var _gn=_g.getAttribute('data-grp'); document.querySelectorAll('.tabgrp').forEach(function(r){r.style.display=(r===_g)?'flex':'none';}); document.querySelectorAll('.admin-group').forEach(function(x){x.classList.toggle('active', x.getAttribute('data-grp')===_gn);}); }}}catch(e){}
};
window.showTabGroup=function(g,btn){
  document.querySelectorAll('.admin-group').forEach(function(b){b.classList.remove('active');});
  if(btn)btn.classList.add('active'); else {var gb=document.querySelector('.admin-group[data-grp="'+g+'"]'); if(gb)gb.classList.add('active');}
  document.querySelectorAll('.tabgrp').forEach(function(r){r.style.display=(r.getAttribute('data-grp')===g)?'flex':'none';});
  var row=document.querySelector('.tabgrp[data-grp="'+g+'"]'); if(!row)return;
  if(!row.querySelector('.admin-tab.active')){ var first=null; row.querySelectorAll('.admin-tab').forEach(function(b){ if(!first && b.style.display!=='none') first=b; }); if(first)first.click(); }
};

const botReplies=[
  {keys:['hour','open','close','time','schedule'],reply:'ðŸ• We are open every day â€” <strong>Monday to Sunday, 3:00 PM to 12:00 Midnight</strong>. â˜•'},
  {keys:['location','address','where','find'],reply:"ðŸ“ <strong>Saratoga Avenue, La Mediterranea Subdivision, Governor's Drive, DasmariÃ±as, Cavite</strong>. Near SM DasmariÃ±as! ðŸ˜Š"},
  {keys:['gcash','pay','payment','bank','bdo'],reply:'ðŸ’³ We accept <strong>GCash, BDO, and UnionBank</strong>. GCash: <strong>0927 692 4831</strong> (ACCAZA).'},
  {keys:['delivery','deliver'],reply:'ðŸ›µ We deliver within <strong>DasmariÃ±as, Cavite</strong> only. Outside? Try <strong>ðŸŸ  foodpanda</strong> or <strong>ðŸŸ¢ GrabFood</strong>.'},
  {keys:['menu','food','drink','coffee','frappe','pastry'],reply:'ðŸ½ï¸ We serve <strong>Coffee, Non-Coffee, Iced Blended, Soda Refreshers, and Pastries</strong>. Check our menu above! â˜•'},
  {keys:['reserve','reservation','book','table'],reply:'ðŸ“… Use our <strong>Reservations section</strong> â€” pick a date, time slot, and fill in your details. Our staff will confirm! ðŸ˜Š'},
  {keys:['wifi','internet'],reply:'ðŸ“¶ Yes, we have free WiFi! Ask our staff for the password. ðŸ˜Š'},
  {keys:['price','cost','how much'],reply:'ðŸ’° Prices start from <strong>â‚±95 for pastries</strong> and <strong>â‚±155 for coffee</strong>. Check our menu! â˜•'},
  {keys:['parking','park'],reply:'ðŸš— Yes, we have parking available! ðŸ˜Š'},
  {keys:['hello','hi','hey','kumusta'],reply:'Hello! ðŸ‘‹ Welcome to <strong>Accaza Coffee House</strong>! How can I help you today? â˜•'},
  {keys:['thank','thanks','salamat'],reply:"You're very welcome! ðŸ˜Š See you at Accaza! â˜•ðŸ»"},
  {keys:['sms','text'],reply:'ðŸ“© You can reach us via SMS at <strong>0927 692 4831</strong>. ðŸ˜Š'},
];
function getBotReply(msg){const l=msg.toLowerCase();for(const r of botReplies){if(r.keys.some(k=>l.includes(k)))return r.reply;}return null;}
function addBotMsg(text){const m=document.getElementById('chatMessages'),d=document.createElement('div');d.className='chat-msg bot';d.innerHTML=text;m.appendChild(d);m.scrollTop=m.scrollHeight;}
function addUserMsg(text){const m=document.getElementById('chatMessages'),d=document.createElement('div');d.className='chat-msg user';d.textContent=text;m.appendChild(d);m.scrollTop=m.scrollHeight;}
function showContactOptions(msg){
  const encoded=encodeURIComponent('Hi Accaza Coffee! I have a question: '+msg);
  const d=document.createElement('div');d.className='chat-msg bot';
  d.innerHTML='<p style="margin-bottom:0.6rem;">ðŸ¤” Sorry, I\'m not sure about that! Reach us directly:</p>'
    +'<div style="display:flex;flex-direction:column;gap:0.4rem;margin-bottom:0.75rem;">'
    +'<a href="https://wa.me/'+CAFE_PHONE+'?text='+encoded+'" target="_blank" rel="noopener noreferrer" style="background:#25D366;color:#fff;border:none;border-radius:6px;padding:0.5rem 0.75rem;font-size:0.78rem;text-decoration:none;display:block;">ðŸ’¬ WhatsApp</a>'
    +'<a href="viber://chat?number=%2B'+CAFE_PHONE+'&text='+encoded+'" style="background:#7360f2;color:#fff;border:none;border-radius:6px;padding:0.5rem 0.75rem;font-size:0.78rem;text-decoration:none;display:block;">ðŸ“± Viber</a>'
    +'<a href="sms:+'+CAFE_PHONE+'?body='+encoded+'" style="background:#44523f;color:#fff;border:none;border-radius:6px;padding:0.5rem 0.75rem;font-size:0.78rem;text-decoration:none;display:block;">ðŸ“© SMS</a>'
    +'<a href="mailto:'+CAFE_EMAIL+'?subject=Customer Inquiry&body='+encoded+'" style="background:#b08d57;color:#fff;border:none;border-radius:6px;padding:0.5rem 0.75rem;font-size:0.78rem;text-decoration:none;display:block;">ðŸ“§ Email</a>'
    +'</div><p style="font-size:0.72rem;color:#79806f;border-top:1px solid #cdbda7;padding-top:0.5rem;">ðŸ“± WhatsApp, Viber & SMS work best on mobile. On desktop? Use Email.</p>';
  document.getElementById('chatMessages').appendChild(d);document.getElementById('chatMessages').scrollTop=document.getElementById('chatMessages').scrollHeight;
}
window.toggleChat=function(){chatOpen=!chatOpen;document.getElementById('chatWindow').classList.toggle('open',chatOpen);document.getElementById('chatNotif').style.display='none';if(chatOpen&&!chatStarted){chatStarted=true;setTimeout(function(){addBotMsg("ðŸ‘‹ Hi! Welcome to <strong>Accaza Coffee House</strong>! Ask me about our hours, menu, delivery, reservations, and more! â˜•");},400);}};
window.sendChat=function(){const input=document.getElementById('chatInput'),msg=input.value.trim();if(!msg)return;input.value='';addUserMsg(msg);const typing=document.createElement('div');typing.className='chat-msg bot';typing.id='typing';typing.innerHTML='<span style="letter-spacing:2px;">â€¢â€¢â€¢</span>';document.getElementById('chatMessages').appendChild(typing);document.getElementById('chatMessages').scrollTop=document.getElementById('chatMessages').scrollHeight;setTimeout(function(){const t=document.getElementById('typing');if(t)t.remove();const reply=getBotReply(msg);if(reply)addBotMsg(reply);else showContactOptions(msg);},900);};
window.quickMsg=function(msg){document.getElementById('chatInput').value=msg;sendChat();};
setTimeout(function(){if(!chatOpen)document.getElementById('chatNotif').style.display='block';},3000);

renderCustomerCalendar();
renderCustomerOrders();
const nm=new Date();
const archFrom=document.getElementById('archiveFrom'),archTo=document.getElementById('archiveTo');
if(archFrom)archFrom.value=new Date(nm.getFullYear(),nm.getMonth(),1).toISOString().slice(0,10);
if(archTo)archTo.value=nm.toISOString().slice(0,10);
setTimeout(function(){if(Object.keys(menuItemsMap).length)renderMenuSection();},1000);
window.setPricingType = function(type) {
  var sized = document.getElementById('priceSizedFields');
  var two   = document.getElementById('priceTwoFields');
  var flat  = document.getElementById('priceFlatField');
  sized.style.display = 'none';
  two.style.display   = 'none';
  flat.style.display  = 'none';
  ['newItemPriceS','newItemPriceM','newItemPriceL'].forEach(function(id){ var el=document.getElementById(id); if(el) el.value=''; });
  ['newItemPriceTwoS','newItemPriceTwoL','newItemLabelS','newItemLabelL'].forEach(function(id){ var el=document.getElementById(id); if(el) el.value=''; });
  var flatEl = document.getElementById('newItemPriceFlat'); if(flatEl) flatEl.value='';
  if (type === 'two')  { two.style.display  = 'grid'; }
  else if (type === 'flat') { flat.style.display = 'block'; }
  else { sized.style.display = 'grid'; }
};
(function(){
  var GALLERY = ["https://i.postimg.cc/g0qrJsnX/6.jpg", "https://i.postimg.cc/TwtsR8Gd/image.png", "https://i.postimg.cc/5yPsM8BH/image.png", "https://i.postimg.cc/wMbQrgz3/image.png", "https://i.postimg.cc/BvGckmr5/image.png", "https://i.postimg.cc/sXJJz5YV/image.png", "https://i.postimg.cc/B6mT84jW/image.png", "https://i.postimg.cc/yxJZk9qq/image.png", "https://i.postimg.cc/CxpqxzcB/image.png", "https://i.postimg.cc/Pq2pyKTr/image.png", "https://i.postimg.cc/sxZMVrSZ/image.png"];
  var current = 0;
  function show(idx) {
    current = (idx + GALLERY.length) % GALLERY.length;
    var img = document.getElementById('lightbox-img');
    img.src = GALLERY[current];
    document.getElementById('lightbox-counter').textContent = (current + 1) + ' / ' + GALLERY.length;
  }
  window.openLightbox = function(idx) {
    show(idx);
    var lb = document.getElementById('lightbox');
    lb.classList.add('open');
    document.body.style.overflow = 'hidden';
  };
  window.closeLightbox = function() {
    document.getElementById('lightbox').classList.remove('open');
    document.body.style.overflow = '';
  };
  window.shiftLightbox = function(dir) { show(current + dir); };
  document.addEventListener('keydown', function(e) {
    var lb = document.getElementById('lightbox');
    if (!lb || !lb.classList.contains('open')) return;
    if (e.key === 'Escape')     closeLightbox();
    if (e.key === 'ArrowLeft')  shiftLightbox(-1);
    if (e.key === 'ArrowRight') shiftLightbox(1);
  });
})();
window.toggleNav = function() {
  var nl = document.querySelector('.nav-links');
  var hb = document.getElementById('hamburgerBtn');
  if (nl) { nl.classList.toggle('nav-open'); }
  if (hb) { hb.classList.toggle('open'); var open = nl && nl.classList.contains('nav-open'); hb.setAttribute('aria-expanded', open); }
};
document.addEventListener('DOMContentLoaded', function() {
  document.querySelectorAll('.nav-links a').forEach(function(a) {
    a.addEventListener('click', function() {
      var nl = document.querySelector('.nav-links');
      var hb = document.getElementById('hamburgerBtn');
      if (nl) nl.classList.remove('nav-open');
      if (hb) { hb.classList.remove('open'); hb.setAttribute('aria-expanded','false'); }
    });
  });
});
window.printOrder = function(orderId) {
  var o = adminOrdersMap[orderId];
  if (!o) return;
  var isDelivery = o.type === 'Delivery';
  var now = new Date();
  var printTime = now.toLocaleString('en-PH', { month:'short', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit', hour12:true });
  var itemsHtml = (o.items || '').split(',').map(function(s){ return '<div>' + escHtml(s.trim()) + '</div>'; }).join('');
  var addrRow = (isDelivery && o.address) ? '<div class="row"><span class="lbl">Address</span><span>' + escHtml(o.address) + '</span></div>' : '';
  var schedRow = (o.date || o.time) ? '<div class="row"><span class="lbl">Schedule</span><span>' + escHtml(o.date||'') + ' ' + escHtml(o.time||'') + '</span></div>' : '';
  var notesRow = o.notes ? '<div class="row"><span class="lbl">Notes</span><span>' + escHtml(o.notes) + '</span></div><hr/>' : '';
  var ticketHtml = '<!DOCTYPE html><html><head><meta charset="UTF-8"/><title>Order #' + escHtml(o.id) + ' â€” Kitchen Ticket</title>'
    + '<style>'
    + '* { box-sizing:border-box; margin:0; padding:0; }'
    + 'body { font-family:"Courier New",Courier,monospace; font-size:13px; color:#000; background:#fff; padding:12px 16px; max-width:380px; }'
    + '.logo { font-size:18px; font-weight:bold; text-align:center; letter-spacing:2px; margin-bottom:2px; }'
    + '.sub  { text-align:center; font-size:10px; margin-bottom:10px; color:#555; }'
    + 'hr    { border:none; border-top:1px dashed #000; margin:8px 0; }'
    + '.row  { display:flex; justify-content:space-between; margin:3px 0; font-size:12px; }'
    + '.lbl  { font-weight:bold; }'
    + '.items { margin:4px 0; line-height:1.6; font-size:12px; }'
    + '.total { font-size:16px; font-weight:bold; text-align:right; margin-top:6px; }'
    + '.badge { display:inline-block; padding:2px 8px; border:1px solid #000; border-radius:3px; font-weight:bold; font-size:12px; margin-bottom:4px; }'
    + '.footer { text-align:center; font-size:10px; margin-top:14px; color:#555; }'
    + '@media print { body { max-width:none; } @page { margin:6mm; } }'
    + '</style></head><body>'
    + '<div class="logo">â˜• ACCAZA</div>'
    + '<div class="sub">Coffee House â€” Kitchen Ticket</div>'
    + '<hr/>'
    + '<div class="row"><span class="lbl">Order #</span><span>' + escHtml(o.id) + '</span></div>'
    + '<div class="row"><span class="lbl">Printed</span><span>' + printTime + '</span></div>'
    + '<hr/>'
    + '<div class="row"><span class="lbl">Customer</span><span>' + escHtml(o.name||'â€”') + '</span></div>'
    + '<div class="row"><span class="lbl">Contact</span><span>' + escHtml(o.phone||'â€”') + (o.contact?' / '+escHtml(o.contact):'') + '</span></div>'
    + '<div class="badge">' + (isDelivery ? 'ðŸ›µ DELIVERY' : 'ðŸ  PICK-UP') + '</div>'
    + addrRow + schedRow
    + '<hr/>'
    + '<div class="lbl">Items:</div>'
    + '<div class="items">' + itemsHtml + '</div>'
    + '<hr/>'
    + notesRow
    + '<div class="row"><span class="lbl">On Duty</span><span>' + escHtml(o.onDuty||o.staff||'â€”') + '</span></div>'
    + '<div class="row"><span class="lbl">Payment</span><span>' + escHtml(o.payment||'â€”') + '</span></div>'
    + '<div class="total">TOTAL: â‚±' + (o.total||0).toLocaleString() + '</div>'
    + '<hr/>'
    + '<div class="footer">â€” Thank you! Pass this to the kitchen. â€”</div>'
    + '</body></html>';
  var win = window.open('', '_blank', 'width=440,height=640');
  win.document.write(ticketHtml);
  win.document.close();
  win.focus();
  setTimeout(function() { win.print(); }, 400);
};
