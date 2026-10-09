import{app,db,auth,callables,ref,set,get,push,update,remove,onValue,onChildAdded,onChildChanged,onChildRemoved,runTransaction,query,orderByChild,equalTo,limitToLast,startAt,endAt,endBefore,getMessaging,getToken,onMessage,isSupported,sendPasswordResetEmail,updatePassword,reauthenticateWithCredential,EmailAuthProvider}from"./firebase-client.mjs";
import{createSubscriptionHub}from"./realtime-hub.mjs?v=616";
import{createHistoryPager}from"./history-pager.mjs";
import{requestManagerApproval}from"./manager-approval.mjs";
import{installPortalAuth}from"./portal-auth.mjs";
import{createOrderAdmin,archiveOutcome,shouldAlertOrder}from"./admin-orders.mjs";
import{createOverviewInsights,mergeOverviewOrders}from"./overview-insights.mjs?v=666";
import{summarizeHistoricalSales,addLiveSales,reconcileCashierSales}from"./historical-sales-summary.mjs?v=616";
import{createCustomerRegistry}from"./customer-registry.mjs";
import{createReservationManager}from"./reservations.mjs";
import{createCatalogAdmin}from"./catalog-admin.mjs";
import{createAppCustomerSession}from"./app-customer-session.mjs";
import{createCustomerOrderTracker}from"./customer-order-tracker.mjs";
import{escHtml,safeImageSrc}from"./shared-ui.mjs";
import{installWorkspaceShell}from"./workspace-shell.mjs";
import{sortArchivedOrders,summarizeArchivedOrders}from"./archive-order-sort.mjs";
import{createOrderArchivePanel}from"./order-archive-panel.mjs";

const {getPaymentProof:getPaymentProofCall,getCurrentCashBalances:getCurrentCashBalancesCall,ensureActiveOrders:ensureActiveOrdersCall,updateOrderStatus:updateOrderStatusCall,postInventoryMovements:postInventoryMovementsCall,ensureInventoryLedger:ensureInventoryLedgerCall,validateRecipeDefinition:validateRecipeDefinitionCall,postFinancialCommand:postFinancialCommandCall,reconcilePurchasePayable:reconcilePurchasePayableCall,managePurchaseCorrection:managePurchaseCorrectionCall,manageFixedAsset:manageFixedAssetCall,settlePlatformPayout:settlePlatformPayoutCall,processOrderAdjustment:processOrderAdjustmentCall,ensureFinancialLedger:ensureFinancialLedgerCall,manageCashAccount:manageCashAccountCall,manageAccountingPeriod:manageAccountingPeriodCall,consumeManagerApproval:consumeManagerApprovalCall,manageChartAccount:manageChartAccountCall,auditFinancialControls:auditFinancialControlsCall,manageOrderArchive:manageOrderArchiveCall,reviewDiscrepancy:reviewDiscrepancyCall,reopenDiscrepancy:reopenDiscrepancyCall,managePettyVoucher:managePettyVoucherCall,setUndepositedOpeningBalance:setUndepositedOpeningBalanceCall,repairPettyVoucherFinancial:repairPettyVoucherFinancialCall,retireRevolvingFund:retireRevolvingFundCall,repairClosedShiftTurnover:repairClosedShiftTurnoverCall,repairShiftDeclaredTips:repairShiftDeclaredTipsCall,repairReversedPayoutDeposit:repairReversedPayoutDepositCall,reconcileUndepositedCustody:reconcileUndepositedCustodyCall,runFinancialClose:runFinancialCloseCall,archiveActivityLog:archiveActivityLogCall}=callables;
window.__accazaAuth=auth;
const readHistoricalOrders=function(payload){return callables.readHistoricalOrders(payload).then(function(result){return result.data||{};});};
const readHistoricalSalesRollup=function(payload){return callables.readHistoricalSalesRollup(payload).then(function(result){return result.data||{};});};
const subscriptionHub=createSubscriptionHub(db,{ref,onValue,onChildAdded,onChildChanged,onChildRemoved,query,orderByChild,limitToLast,startAt,endAt,endBefore,get,readHistoricalOrders,cacheScope:function(){return auth&&auth.currentUser&&auth.currentUser.uid||'';}});
window.__accazaLiveStats=function(){return subscriptionHub.stats();};
const renderHistoryPager=createHistoryPager(subscriptionHub);
window.__fbForgot=function(){var current=(document.getElementById('adminUser').value||'').trim();if(!window.AccazaFormDialog){alert('Form service unavailable. Refresh and try again.');return;}window.AccazaFormDialog.run({title:'Reset portal password',subtitle:'Firebase will send the reset link to this account.',submitLabel:'Send reset link',busyLabel:'Sending…',fields:[{name:'email',label:'Firebase account email',type:'email',required:true,value:current,validate:function(v){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)?'':'Enter a valid email address.';}}]},function(v){return sendPasswordResetEmail(auth,v.email).then(function(){return v;});}).then(function(v){alert('Password reset link sent to '+v.email+'. Check inbox and spam.');}).catch(function(e){if(e&&e.code!=='cancelled')alert('Could not send reset: '+((e&&e.code)||e));});};
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
    if(token){var u=appCustomerSession.getUser();var au=auth.currentUser;if(u&&au){try{await update(ref(db,'appCustomers/'+au.uid),{pushToken:token,pushTokenAt:Date.now()});if(!window.__pushToasted){window.__pushToasted=true;(window.accazaToast||function(){})('🔔 Notifications on for this device','ok');}}catch(e){}}}
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
  b.textContent=(Notification.permission==='denied')?'🔔 Notifications blocked — tap for help':'🔔 Enable order-ready notifications';
}
window.enableNotifications=async function(){
  if(!('Notification' in window))return;
  if(Notification.permission==='denied'){(window.accazaToast||window.alert)('Notifications are turned off for Accaza. Please enable them in your browser/app settings (Site settings → Notifications), then reopen the app.');return;}
  await setupPush();
  refreshNotifyPrompt();
};
window.__setupPush=setupPush;

const feedbacksRef=ref(db,'feedbacks'),reviewsRef=ref(db,'reviews'),availRef=ref(db,'availability'),paymentRef=ref(db,'payment'),menuRef=ref(db,'menuItems'),categoriesRef=ref(db,'categories'),optionGroupsRef=ref(db,'optionGroups');
window.__accaza={
  db,ref,set,get,update,remove,onValue,runTransaction,query,orderByChild,equalTo,startAt,endAt,callables,sendPasswordResetEmail:function(email){return sendPasswordResetEmail(auth,email);},hub:subscriptionHub,readHistoricalOrders,readHistoricalSalesRollup,summarizeHistoricalSales,addLiveSales,reconcileCashierSales,
  subscribe:function(path,callback,opts){return subscriptionHub.subscribe(path,callback,opts);},
  postInventoryMovements:function(movements){return postInventoryMovementsCall({movements:movements});},
  ensureInventoryLedger:function(){return ensureInventoryLedgerCall({});},
  validateRecipeDefinition:function(recipe){return validateRecipeDefinitionCall({recipe:recipe});},
  saveSharedChoiceIngredients:function(optionCosts){return callables.saveSharedChoiceIngredients({optionCosts:optionCosts});},
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
  manageQrOrderTicket:c=>callables.manageQrOrderTicket(c),
  reviewDiscrepancy:function(command){return reviewDiscrepancyCall(command);},
  reopenDiscrepancy:function(command){return reopenDiscrepancyCall(command);},
  managePettyVoucher:function(command){return managePettyVoucherCall(command);},
  manageSupplier:function(command){return callables.manageSupplier(command);},
  setUndepositedOpeningBalance:function(command){return setUndepositedOpeningBalanceCall(command);},
  repairPettyVoucherFinancial:function(command){return repairPettyVoucherFinancialCall(command);},
  retireRevolvingFund:function(command){return retireRevolvingFundCall(command);},
  getUndepositedControlSnapshot:function(){return callables.getUndepositedControlSnapshot({});},
  getCurrentCashBalances:function(){return getCurrentCashBalancesCall({});},
  repairClosedShiftTurnover:function(command){return repairClosedShiftTurnoverCall(command);},
  repairShiftDeclaredTips:function(command){return repairShiftDeclaredTipsCall(command);},
  repairReversedPayoutDeposit:function(command){return repairReversedPayoutDepositCall(command);},
  reconcileUndepositedCustody:function(command){return reconcileUndepositedCustodyCall(command);},
  runFinancialClose:function(command){return runFinancialCloseCall(command);},
  archiveActivityLog:function(){return archiveActivityLogCall({});},
  syncOfflinePosSale:function(command){return callables.syncOfflinePosSale(command);},
  managePosStaffIdentity:function(command){return callables.managePosStaffIdentity(command);},
  openLinkedPosShift:function(command){return callables.openLinkedPosShift(command);},
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
  getOperationalExceptions:function(force){return callables.getOperationalExceptions({force:force===true,cached:true});},
  askAccazaAI:function(command){return callables.askAccazaAI(typeof command==='string'?{question:command}:command);},
  manageAccazaAiKnowledge:function(command){return callables.manageAccazaAiKnowledge(command);},
  manageAccazaAiIssue:function(command){return callables.manageAccazaAiIssue(command);},
  repairOrderInventoryMarker:function(orderId){return callables.repairOrderInventoryMarker({orderId:orderId});},
  resolveBackgroundFailure:function(id,note){return callables.resolveBackgroundFailure({deadLetterId:id,note:note});},
  runDatabaseBackupNow:function(){return callables.runDatabaseBackupNow({});},
  manageHistoricalOrderArchive:function(command){return callables.manageHistoricalOrderArchive(command);},
  readBooksJournalRange:function(from,to){return get(query(ref(db,'books/journal'),orderByChild('date'),startAt(String(from)),endAt(String(to)))).then(function(s){return s.val()||{};});},
  get menuItemsMap(){return menuItemsMap;},
  get optionGroupsMap(){return optionGroupsMap;},
  get categoriesMap(){return categoriesMap;},
  get adminOrdersMap(){return adminOrdersMap;},
  get currentUser(){return (typeof currentUser!=='undefined')?currentUser:null;},
  getMenuItems, getCats, getCatLabel, getCatIcon, getItemOptionGroups, formatPrice
};

let staffLoggedIn=false,superAdminLoggedIn=false,currentUser=null,currentLoginRole=null;
const CAFE_PHONE='639276924831',CAFE_EMAIL='admin@accazacoffee.com';

const DEFAULT_CATS=[
  {id:'coffee',label:'Coffee Based',icon:'☕',order:0},
  {id:'noncaf',label:'Non-Coffee Based',icon:'🌿',order:1},
  {id:'frappe',label:'Iced Blended Coffee',icon:'🥤',order:2},
  {id:'nonfrappe',label:'Iced Blended Non-Coffee',icon:'🧊',order:3},
  {id:'soda',label:'Soda-Based Refreshers',icon:'🍋',order:4},
  {id:'pastry',label:'Pastries',icon:'🍞',order:5}
];

const DRINK_CATS=['coffee','noncaf','frappe','nonfrappe','soda'];
const TEMP_CATS=['coffee','noncaf'];
const MILK_CATS=['coffee','noncaf','frappe','nonfrappe'];
const SHOT_CATS=['coffee','frappe'];
const SYRUP_CATS=['coffee','noncaf','frappe','nonfrappe'];
const TOPPING_CATS=['coffee','noncaf','frappe','nonfrappe','soda'];

const DEFAULT_OPTION_GROUPS={
  og_temp:{name:'Temperature',type:'single',required:true,order:0,choices:[{label:'Hot',price:0},{label:'Iced',price:0}]},
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

let overviewCashAccounts={},categoriesMap={},menuItemsMap={},adminOrdersMap={},overviewOrdersMap={},archivedOrdersMap={},feedbacksMap={},reviewsMap={},availability={},cart={},overviewOrdersLoaded=false,archivedOrdersLoaded=false,overviewCatType={};
let optionGroupsMap={},ogLoaded=false,optSeedStarted=false,itemOptMigrated=false;
let knownOrderIds=null,unseenOrders=0,orderChimeTimer=null,audioCtx=null;
let orderType='pickup',paymentType='gcash',contactMethod='whatsapp';
let adminLoggedIn=false;
let chatOpen=false,chatStarted=false;
let custItem=null,custSize=null,custSel={},custQty=1;
let menuFilter='coffee',orderFilter=null;

const overviewInsights=createOverviewInsights({esc:escHtml,historyStatus:function(path){return subscriptionHub.historyStatus(path);},loadOlder:function(path){return subscriptionHub.loadOlder(path);},readMonthlyRollup:function(r){return readHistoricalSalesRollup({from:r.from.slice(0,7),to:r.to.slice(0,7)});},readPeriodSummary:function(r){return readHistoricalSalesRollup({from:overviewMonth(r.start),to:overviewMonth(r.end)});},readRankingSummary:function(r){return readHistoricalSalesRollup({from:overviewMonth(r.start),to:overviewMonth(r.end)});}});
window.addEventListener('accaza-historical-sales-change',function(){overviewInsights.invalidateSummaries();if(subscriptionHub.stats().activeScope==='dashboard')renderDashboard();});
function overviewMonth(stamp){var d=new Date(Number(stamp)+8*3600000);return d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0');}

const appCustomerSession=createAppCustomerSession({setupPush:setupPush,refreshNotifyPrompt:refreshNotifyPrompt});
const customerOrderTracker=createCustomerOrderTracker({getOrders:function(){return adminOrdersMap;},escHtml:escHtml});

const reservationManager=createReservationManager({subscriptionHub:subscriptionHub,isPortalActive:function(){return adminLoggedIn||staffLoggedIn;},onReservationsChanged:updateStats,playChime:playChime,showDeletePopup:showDeletePopup});
const renderReservations=reservationManager.renderReservations,renderCustomerCalendar=reservationManager.renderCustomerCalendar,renderAdminCalendar=reservationManager.renderAdminCalendar;
const catalogAdmin=createCatalogAdmin({getCategoriesMap:()=>categoriesMap,getMenuItemsMap:()=>menuItemsMap,getOptionGroupsMap:()=>optionGroupsMap,optionsReady:()=>ogLoaded,getAvailability:()=>availability,getCats,getMenuItems,getEffectiveOptionIds,isAvail,isStaffLoggedIn:()=>staffLoggedIn,showDeletePopup,renderMenuSection,renderOrderSection,invalidateCatalogCache:()=>subscriptionHub.invalidateMasterCache()});
const renderCategoryManager=catalogAdmin.renderCategoryManager,renderOptionManager=catalogAdmin.renderOptionManager,renderNewItemOptionChecklist=catalogAdmin.renderNewItemOptionChecklist,renderStaffMenu=catalogAdmin.renderStaffMenu,buildAvail=catalogAdmin.buildAvail;

document.getElementById('fbSync').classList.add('online');
setTimeout(()=>document.getElementById('fbSync').style.display='none',4000);

function getCats(){return Object.values(categoriesMap).sort((a,b)=>(a.order||0)-(b.order||0));}
function getCatLabel(id){const c=categoriesMap[id];return c?c.icon+' '+c.label:id;}
function getCatIcon(id){const c=categoriesMap[id];return c?c.icon:'☕';}
function getMenuItems(){return Object.entries(menuItemsMap).map(([k,v])=>({...v,key:k}));}
function isAvail(name){return availability[name]!==false;}
function isDrink(cat){return DRINK_CATS.includes(cat);}
function formatPrice(item){if(item.priceM&&item.priceL)return'S ₱'+item.priceS+' · M ₱'+item.priceM+' · L ₱'+item.priceL;return'₱'+item.priceS;}

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
  ogLoaded=true;
  var d=snap.val()||{};
  if(Object.keys(d).length){optionGroupsMap=d;}
  else if(!optSeedStarted){
    optSeedStarted=true;
    optionGroupsMap=DEFAULT_OPTION_GROUPS;
    set(optionGroupsRef,DEFAULT_OPTION_GROUPS).catch(function(){});
  }
  migrateItemOptions();
  if(adminLoggedIn){renderOptionManager();buildAvail();}
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
  document.getElementById('orderToastSub').textContent=(last&&last.total?'₱'+last.total.toLocaleString()+' · ':'')+'Tap to view orders';
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
    var fresh=ids.filter(function(id){return prevIds.indexOf(id)===-1;}).map(function(id){return adminOrdersMap[id];}).filter(shouldAlertOrder);
    if(fresh.length){notifyNewOrders(fresh);if(window.AccazaTelemetry)fresh.forEach(function(o){var age=Date.now()-Number(o.timestamp||Date.now());window.AccazaTelemetry.metric('realtime_order_arrival',Math.max(0,age),true);});}
  }
  knownOrderIds=ids;
  if(adminLoggedIn||staffLoggedIn){var ot=document.getElementById('tab-orders'),dt=document.getElementById('tab-dashboard'),ct=document.getElementById('tab-appcustomers');if(ot&&ot.style.display!=='none')patchOrderCards(previousOrders,adminOrdersMap);if(dt&&dt.style.display!=='none')renderDashboard();if(ct&&ct.style.display!=='none')renderAppCustomers();}
  updateStats();renderCustomerOrders();checkMyReadyOrders();
});
subscriptionHub.subscribe('orders',snap=>{overviewOrdersMap=snap.val()||{};overviewOrdersLoaded=true;if(dashboardAllowed()){var dt=document.getElementById('tab-dashboard');if(dt&&dt.style.display!=='none')renderDashboard();}});
subscriptionHub.subscribe('archivedOrders',snap=>{archivedOrdersMap=snap.val()||{};archivedOrdersLoaded=true;if(dashboardAllowed())renderDashboard();if(adminLoggedIn||staffLoggedIn)renderAppCustomers();var _ap=document.getElementById('archivePanel');if(_ap&&_ap.style.display!=='none'){try{renderArchive();}catch(e){}}});
subscriptionHub.subscribe('feedbacks',snap=>{feedbacksMap=snap.val()||{};if(adminLoggedIn||staffLoggedIn)renderComments();});
subscriptionHub.subscribe('reviews',snap=>{
  const saved=snap.val();
  if(saved){reviewsMap=saved;}
  else{
    const seed={
      'rev_001':{name:'Maria Theresa & Quinn Isabella Margaux',stars:5,date:'June 2, 2026',text:'Accaza Coffee House is a hidden gem right along the roadside near SM Dasmariñas — easy to find whether you\'re commuting or driving. Inside, it\'s surprisingly spacious with a calm, serene atmosphere that\'s rare among today\'s cramped cafés.\n\nThe coffee is outstanding, with well-crafted flavors from bold to smooth. But what truly sets Accaza apart is how perfectly it serves both students and professionals — it\'s a productive sanctuary where you can focus, study, or work in peace.\n\nHighly recommended for anyone looking for great coffee and a place to get things done. ☕✨'},
      'rev_002':{name:'Molina Page',stars:5,date:'June 2026',text:'The coffee was absolutely delightful — perfectly brewed, rich in flavor, and made with genuine care. Every sip spoke to your passion and quality.\n\nBeyond the coffee, your staff made the visit truly special. From the warm greeting to the attentive service, everyone made me feel genuinely valued. It\'s rare to find a team so professional yet so kind and approachable.'},
      'rev_003':{name:'Camilla Andrea',stars:5,date:'April 6, 2026 · via Facebook',text:'Nasa may highway ang coffee shop, ngunit nakakubli ang ganda nitong hindi mo mamamalas kung hindi sasadyain. Mukha siyang maliit sa labas, subalit malaki ang espasyo pagpasok, na tila napunta ka na sa ibang lugar.\n\nGusto ko mang ipagdamot ang lugar para patuloy akong makatambay nang matiwasay, subalit tingin ko\'y kasalanan ito sa mga mahilig sa kape (at sa may-ari rin) kung hindi ito maibabahagi sa iba.'},
      'rev_004':{name:'Cess Borja',stars:5,date:'July 2025',text:'"10/10 would recommend!! we will surely come back 🤌"'}
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
    const imgHtml=i.img?'<img loading="lazy" decoding="async" src="'+i.img+'" class="menu-card-img" style="'+(ok?'':'opacity:0.5;')+'" onerror="this.style.display=\'none\'"/>'
      :'<div class="menu-card-img-placeholder">'+getCatIcon(i.cat)+'</div>';
    const priceHtml=i.priceM&&i.priceL
      ?'<span class="price-badge">S ₱'+i.priceS+'</span><span class="price-badge">M ₱'+i.priceM+'</span><span class="price-badge">L ₱'+i.priceL+'</span>'
      :i.priceL&&i.labelS&&i.labelL
      ?'<span class="price-badge">'+(i.labelS||'Opt 1')+' ₱'+i.priceS+'</span><span class="price-badge">'+(i.labelL||'Opt 2')+' ₱'+i.priceL+'</span>'
      :'<span class="price-single">₱'+i.priceS+'</span>';
    return'<div class="menu-card'+(ok?' clickable':'')+'"'+(ok?' data-goorder="'+i.key+'" data-gocat="'+i.cat+'"':'')+'>'+imgHtml+'<div class="menu-card-body"><span class="cat-tag">'+getCatLabel(i.cat)+'</span><h4 style="'+(ok?'':'text-decoration:line-through;opacity:0.6;')+'">'+i.name+'</h4><p class="desc">'+(i.desc||'')+'</p><div class="price-row">'+priceHtml+'</div><span class="avail-badge '+(ok?'avail-yes':'avail-no')+'">'+(ok?'✅ Available':'❌ Unavailable')+'</span>'+(ok?'<span class="tap-hint">🛒 Tap to order</span>':'')+'</div></div>';
  }).join('');
  el.querySelectorAll('.menu-card[data-goorder]').forEach(function(card){card.addEventListener('click',function(){goToOrderItem(this.dataset.gocat,this.dataset.goorder);});});
}

function renderOrderSection(){
  const el=document.getElementById('orderItemList');if(!el)return;
  if(!orderFilter){el.innerHTML='<div class="order-empty-state"><span class="big-icon">☕</span><h3>What are you craving today?</h3><p>Choose a category above to explore our handcrafted drinks and pastries.</p></div>';return;}
  const items=getMenuItems().filter(i=>i.cat===orderFilter).sort((a,b)=>(a.order||0)-(b.order||0));
  if(!items.length){el.innerHTML='<div class="order-empty-state"><span class="big-icon">'+getCatIcon(orderFilter)+'</span><h3>No items yet.</h3></div>';return;}
  el.innerHTML=items.map(function(i){
    const ok=isAvail(i.name);
    const cartQty=Object.values(cart).filter(c=>c.name===i.name||c.name.startsWith(i.name+' (')).reduce((s,c)=>s+c.qty,0);
    const imgHtml=i.img?'<img loading="lazy" decoding="async" src="'+i.img+'" class="item-row-img" onerror="this.style.display=\'none\'"/>'
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
      +'<label class="cust-option" data-action="size" data-val="S" data-price="'+custItem.priceS+'"><input type="radio" name="custSize"/><span class="cust-option-label">'+(custItem.labelS||'Option 1')+'</span><span class="cust-option-price">₱'+custItem.priceS+'</span></label>'
      +'<label class="cust-option" data-action="size" data-val="L" data-price="'+custItem.priceL+'"><input type="radio" name="custSize"/><span class="cust-option-label">'+(custItem.labelL||'Option 2')+'</span><span class="cust-option-price">₱'+custItem.priceL+'</span></label>'
      +'</div></div>';
  } else if(custItem.priceM&&custItem.priceL){
    html+='<div class="cust-section"><div class="cust-section-title">Serving Size <span class="cust-badge cust-badge-required">Required</span></div><div class="cust-options">'
      +'<label class="cust-option" data-action="size" data-val="S" data-price="'+custItem.priceS+'"><input type="radio" name="custSize"/><span class="cust-option-label">Small</span><span class="cust-option-price">₱'+custItem.priceS+'</span></label>'
      +'<label class="cust-option" data-action="size" data-val="M" data-price="'+custItem.priceM+'"><input type="radio" name="custSize"/><span class="cust-option-label">Medium</span><span class="cust-option-price">₱'+custItem.priceM+'</span></label>'
      +'<label class="cust-option" data-action="size" data-val="L" data-price="'+custItem.priceL+'"><input type="radio" name="custSize"/><span class="cust-option-label">Large</span><span class="cust-option-price">₱'+custItem.priceL+'</span></label>'
      +'</div></div>';
  }
  var itemGroups=getItemOptionGroups(custItem);
  itemGroups.forEach(function(g){
    var isMulti=g.type==='multi';
    var req=!isMulti&&g.required!==false;
    html+='<div class="cust-section"><div class="cust-section-title">'+escHtml(g.name)+' <span class="cust-badge '+(req?'cust-badge-required':'cust-badge-optional')+'">'+(req?'Required':'Optional')+'</span></div><div class="cust-options">'
      +(g.choices||[]).map(function(c,ci){
        var pp=parseInt(c.price)||0;
        return '<label class="cust-option" data-action="'+(isMulti?'optcheck':'optradio')+'" data-group="'+g.id+'" data-idx="'+ci+'"><input type="'+(isMulti?'checkbox':'radio')+'" name="og_'+g.id+'"/><span class="cust-option-label">'+escHtml(c.label)+'</span><span class="cust-option-price">'+(pp>0?'+₱'+pp:'Free')+'</span></label>';
      }).join('')
      +'</div></div>';
  });
  html+='<div class="cust-section"><div class="cust-section-title">Quantity</div><div class="cust-qty"><button class="cust-qty-btn" id="custQtyMinus">−</button><span class="cust-qty-num" id="custQtyNum">1</span><button class="cust-qty-btn" id="custQtyPlus">+</button></div></div>';
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
function updateCustTotal(){document.getElementById('custTotalDisplay').textContent='₱'+(calcCustUnitTotal()*custQty).toLocaleString();}

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
      +'<div style="font-size:0.75rem;color:var(--tl);">₱'+item.unitTotal.toLocaleString()+' each</div></div>'
      +'<div style="display:flex;align-items:center;gap:0.4rem;margin-left:0.5rem;">'
      +'<button data-cartkey="'+k+'" data-delta="-1" style="width:24px;height:24px;border-radius:50%;border:1px solid var(--cd);background:var(--cr);font-size:0.9rem;cursor:pointer;color:var(--bd);">−</button>'
      +'<span style="font-size:0.85rem;font-weight:500;min-width:18px;text-align:center;">'+item.qty+'</span>'
      +'<button data-cartkey="'+k+'" data-delta="1" style="width:24px;height:24px;border-radius:50%;border:1px solid var(--cd);background:var(--cr);font-size:0.9rem;cursor:pointer;color:var(--bd);">+</button>'
      +'<span style="font-size:0.85rem;font-weight:500;color:var(--bl);min-width:50px;text-align:right;">₱'+line.toLocaleString()+'</span>'
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
  document.getElementById('totalAmt').textContent='₱'+total.toLocaleString();
  tot.style.display='flex';
  var _cb1=document.getElementById('cartCheckoutBtn');if(_cb1)_cb1.style.display='block';
}

window.goToCheckout=function(e){if(e&&e.stopPropagation)e.stopPropagation();if(!Object.keys(cart).length)return;var f=document.querySelector('.form-box');if(f)f.scrollIntoView({behavior:'smooth',block:'start'});};
window.setType=function(t){orderType=t;document.getElementById('btnPickup').classList.toggle('active',t==='pickup');document.getElementById('btnDelivery').classList.toggle('active',t==='delivery');document.getElementById('deliveryField').style.display=t==='delivery'?'block':'none';};
window.showProof=function(src){var m=document.getElementById('proofModal');var im=document.getElementById('proofModalImg');if(im)im.src=src;if(m)m.style.display='flex';};
window.showStoredProof=async function(orderId,button){
  var old=button?button.textContent:'';if(button){button.disabled=true;button.textContent='Loading proof…';}
  try{var result=await getPaymentProofCall({orderId:orderId});var data=result&&result.data&&result.data.dataUrl;if(!data)throw new Error('The server returned no image.');window.showProof(data);}
  catch(e){try{if(window.AccazaTelemetry)window.AccazaTelemetry.error('proof_access');}catch(_e){}alert('Could not load payment proof: '+((e&&e.message)||e));}
  finally{if(button){button.disabled=false;button.textContent=old||'📎 View payment proof';}}
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
  if((window._lastOrderSig===_sig&&Date.now()-(window._lastOrderTime||0)<30000)||(_persist&&_persist.sig===_sig&&Date.now()-_persist.t<30000)){alert('Looks like you just placed this exact order — please try again after 30 seconds.');return;}
  window._placingOrder=true;
  const _btn=document.querySelector('.btn-place-order');_btn.disabled=true;_btn.style.opacity='0.5';_btn.textContent='⏳ Placing order…';
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
    window._lastOrderSig=_sig;window._lastOrderTime=Date.now();window._placingOrder=false;_btn.textContent='✅ Order Placed!';try{localStorage.setItem('accaza_lastsig',_sig+'@@'+Date.now());}catch(e){}
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
  const msgs={Complaint:'🙏 Thank you for letting us know. We sincerely apologize and will look into this right away.',Suggestion:'💡 Thank you for your suggestion!',Compliment:"❤️ Oh, this made our day! Thank you so much. ☕🐻",Other:'💛 Thank you for reaching out!'};
  document.getElementById('fbConfirmMsg').textContent=msgs[type]||msgs.Other;document.getElementById('fbConfirm').style.display='block';setTimeout(function(){document.getElementById('fbConfirm').style.display='none';},6000);}catch(e){alert('Error: '+e.message);}
};

function updateStats(){const orders=Object.values(adminOrdersMap),active=orders.filter(o=>o.status!=='Received');document.getElementById('statOrders').textContent=active.length;document.getElementById('statPending').textContent=active.filter(o=>o.status==='Pending').length;document.getElementById('statReservations').textContent=Object.keys(reservationManager.getReservations()).length;document.getElementById('statRevenue').textContent='₱'+active.filter(o=>o.status!=='Rejected').reduce((s,o)=>s+(o.total||0),0).toLocaleString();}

const orderAdmin=createOrderAdmin({getOrders:function(){return adminOrdersMap;},canArchiveOrder:function(o){var verifiedRole=window.__accazaAuthz&&window.__accazaAuthz.role,manager=['owner','superadmin','admin','manager'].indexOf(String(verifiedRole||'').toLowerCase())>=0,shift=window.__posShift;return manager&&(!o.shiftId||!shift||shift.id!==o.shiftId||shift.status==='closed');},escHtml:escHtml,safeImageSrc:safeImageSrc,showDeletePopup:showDeletePopup,printOrder:function(id){if(window.printOrder)return window.printOrder(id);},notifyCustomer:function(id){if(window.notifyCustomer)return window.notifyCustomer(id);}});
const renderOrders=orderAdmin.renderOrders,patchOrderCards=orderAdmin.patchOrderCards;

window.togglePwVis=function(inputId,btn){var inp=document.getElementById(inputId);if(!inp)return;var show=inp.type==='password';inp.type=show?'text':'password';btn.textContent=show?'🙈':'👁️';};
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


function renderPublicReviews(){
  var el=document.getElementById('publicReviewsContainer');if(!el)return;
  var entries=Object.entries(reviewsMap);
  if(!entries.length){el.innerHTML='<p style="text-align:center;color:var(--tl);padding:2rem;">No reviews yet.</p>';return;}
  function stars(n){return'⭐'.repeat(Math.max(1,Math.min(5,parseInt(n)||5)));}
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


if(window.AccazaAdminPeriods)window.AccazaAdminPeriods.setWaiter(function(){var scope=subscriptionHub.stats().activeScope,paths=scope==='saleshistory'?['orders','archivedOrders','financialMovements']:['orders'];return subscriptionHub.whenReady(paths);});
function renderDashboard(){
  if(!dashboardAllowed()||subscriptionHub.stats().activeScope!=='dashboard'){overviewInsights.stop();return;}
  function _rows(map){return Object.entries(map||{}).map(function(pair){var o=pair[1];return o&&o.id?o:Object.assign({_overviewKey:pair[0]},o||{});});}
  function _mergedMap(snapshot,live){return Object.assign({},snapshot||{},live||{});}
  const active=_rows(adminOrdersMap);
  const historyOrders=_rows(overviewOrdersMap);
  const archived=_rows(archivedOrdersMap);
  function _isSale(o){return window.AccazaSales.qualifies(o);}
  function _tsOf(o){return window.AccazaSales.stamp(o);}
  const outcomes=mergeOverviewOrders(active,historyOrders,archived);
  const reconciledSales=mergeOverviewOrders([],historyOrders,archived);
  const sales=reconciledSales.filter(_isSale);
  // Today / week (from Sunday) / month start at Manila midnight, whatever the device's time zone.
  const todayKey=new Date(Date.now()+28800000).toISOString().slice(0,10),startToday=Date.parse(todayKey+'T00:00:00+08:00');
  const startWeek=startToday-new Date(todayKey+'T12:00:00Z').getUTCDay()*86400000;
  const startMonth=Date.parse(todayKey.slice(0,7)+'-01T00:00:00+08:00');
  function sumOrders(arr){return{rev:arr.reduce((s,o)=>s+window.AccazaSales.amounts(o).net,0),cnt:arr.length};}
  const t=sumOrders(sales.filter(o=>_tsOf(o)>=startToday)),w=sumOrders(sales.filter(o=>_tsOf(o)>=startWeek)),m=sumOrders(sales.filter(o=>_tsOf(o)>=startMonth)),a=sumOrders(sales);
  function setCard(id,rev,cnt){const el=document.getElementById(id);if(el)el.textContent='₱'+rev.toLocaleString();const cel=document.getElementById(id+'Count');if(cel)cel.textContent=cnt+' order'+(cnt!==1?'s':'');}
  setCard('dashToday',t.rev,t.cnt);setCard('dashWeek',w.rev,w.cnt);setCard('dashMonth',m.rev,m.cnt);setCard('dashAllTime',a.rev,a.cnt);
  overviewInsights.render({active:active,orders:historyOrders,archived:archived,outcomes:outcomes,sales:sales,historyComplete:subscriptionHub.historyStatus('orders').ready&&subscriptionHub.historyStatus('archivedOrders').ready,menuItems:menuItemsMap||{},catType:overviewCatType,drinkCategories:DRINK_CATS,cashAccounts:overviewCashAccounts||{}});
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
  ctx.fillStyle='rgba(224,212,198,0.7)';ctx.font='14px Inter,sans-serif';ctx.fillText('Saratoga Ave, La Mediterranea, Dasmariñas, Cavite',pageW/2,82);
  ctx.fillStyle='#fff';ctx.font='bold 18px Georgia,serif';ctx.fillText('Order Archive Report',pageW/2,118);
  const dateRange=fromVal&&toVal?fromVal+' to '+toVal:fromVal?'From '+fromVal:toVal?'Up to '+toVal:'All Time';
  ctx.fillStyle='rgba(224,212,198,0.6)';ctx.font='12px Inter,sans-serif';ctx.fillText(dateRange,pageW/2,140);
  ctx.fillStyle='rgba(255,255,255,0.1)';ctx.fillRect(40,156,pageW-80,48);
  ctx.fillStyle='#c9a36a';ctx.font='bold 14px Inter,sans-serif';ctx.textAlign='left';ctx.fillText('Total Orders: '+orders.length,60,178);
  ctx.textAlign='center';ctx.fillText('Completed: '+archiveTotals.completedCount+' · Revenue: ₱'+totalRev.toLocaleString(),pageW/2,174);
  ctx.textAlign='right';ctx.fillText('Refunded: '+archiveTotals.refundedCount+' · ₱'+archiveTotals.refundedAmount.toLocaleString(),pageW-60,174);
  ctx.textAlign='left';ctx.fillText('Voided: '+archiveTotals.voidedCount+' · ₱'+archiveTotals.voidedAmount.toLocaleString(),60,194);
  ctx.textAlign='right';ctx.fillText('Rejected / other: '+rejCnt+' · GCash: '+gcashCnt+' · Bank: '+bankCnt,pageW-60,194);
  ctx.fillStyle='rgba(224,212,198,0.4)';ctx.font='11px Inter,sans-serif';ctx.textAlign='center';ctx.fillText('Generated: '+new Date().toLocaleDateString('en-PH',{year:'numeric',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'}),pageW/2,220);
  let y=headerH+16;
  ctx.fillStyle='#19241b';ctx.font='bold 11px Inter,sans-serif';ctx.textAlign='left';
  ['Order ID','Customer','Items','Total','Payment','Type','Date'].forEach(function(h,i){ctx.fillText(h,[40,120,240,530,610,680,730][i],y);});
  ctx.strokeStyle='#cdbda7';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(40,y+8);ctx.lineTo(pageW-40,y+8);ctx.stroke();
  y+=rowH*0.6;
  orders.forEach(function(o,idx){
    if(idx%2===0){ctx.fillStyle='rgba(176,141,87,0.06)';ctx.fillRect(40,y-14,pageW-80,rowH);}
    ctx.fillStyle='#1c2420';ctx.font='11px Inter,sans-serif';ctx.textAlign='left';
    ctx.fillText((o.id||'—'),40,y+4);
    ctx.fillText((o.name||'—').slice(0,14),120,y+4);
    ctx.fillText(((o.items||'').length>35?o.items.slice(0,35)+'…':o.items||'—'),240,y+4);
    ctx.fillStyle=o.prevStatus==='Rejected'?'#c0392b':'#b08d57';ctx.font='bold 11px Inter,sans-serif';ctx.fillText((o.prevStatus==='Rejected'?'✗ ':'')+'₱'+(o.total||0).toLocaleString(),530,y+4);
    ctx.fillStyle='#1c2420';ctx.font='11px Inter,sans-serif';
    ctx.fillText(o.payment==='GCash'?'GCash':'Bank',610,y+4);ctx.fillText(o.type||'—',680,y+4);ctx.fillText(o.archivedDate||'—',730,y+4);
    ctx.strokeStyle='#cdbda7';ctx.lineWidth=0.5;ctx.beginPath();ctx.moveTo(40,y+rowH-14);ctx.lineTo(pageW-40,y+rowH-14);ctx.stroke();
    y+=rowH;
  });
  ctx.fillStyle='#19241b';ctx.fillRect(0,totalH-40,pageW,40);
  ctx.fillStyle='rgba(224,212,198,0.5)';ctx.font='11px Inter,sans-serif';ctx.textAlign='center';ctx.fillText('Accaza Coffee House · Confidential · For internal use only',pageW/2,totalH-14);
  const link=document.createElement('a');link.download='Accaza_Archive_'+new Date().toISOString().slice(0,10)+'.png';link.href=canvas.toDataURL('image/png');link.click();
};

function renderComments(){
  const types=['Contact','Complaint','Suggestion','Compliment','Other'];
  const empty={Contact:'No website messages yet.',Complaint:'No complaints yet. 🎉',Suggestion:'No suggestions yet.',Compliment:'No compliments yet.',Other:'No other feedback yet.'};
  const color={Contact:'#2f6f8f',Complaint:'#c0392b',Suggestion:'#f39c12',Compliment:'#2d9e5f',Other:'#888'};
  types.forEach(function(type){
    const el=document.getElementById('fbList'+type);if(!el)return;
    const items=Object.entries(feedbacksMap).filter(function(e){return e[1].type===type;});
    if(!items.length){el.innerHTML='<p style="color:var(--tl);padding:1rem;background:#fff;border-radius:8px;text-align:center;font-size:0.85rem;">'+empty[type]+'</p>';return;}
    el.innerHTML=items.map(function(e){const f=e[1]||{},key=escHtml(e[0]),status=f.status==='Resolved'?'Resolved':'Unread',name=escHtml(f.name),contact=escHtml(f.contact),date=escHtml(f.date),message=escHtml(f.message);return'<div style="background:#fff;border:1px solid #cdbda7;border-left:4px solid '+color[type]+';border-radius:8px;padding:1rem;margin-bottom:0.75rem;"><div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:0.5rem;"><div><div style="font-weight:500;font-size:0.9rem;color:#19241b;">'+name+'</div><div style="font-size:0.75rem;color:#79806f;">'+(contact?contact+' · ':'')+date+'</div></div><span style="font-size:0.72rem;padding:0.2rem 0.6rem;border-radius:999px;font-weight:500;background:'+(status==='Resolved'?'#d4edda':'#fef3cd')+';color:'+(status==='Resolved'?'#155724':'#856404')+';">'+status+'</span></div><p style="font-size:0.85rem;color:#44523f;font-style:italic;margin:0.4rem 0;">"'+message+'"</p><div class="staff-hide" style="display:flex;justify-content:flex-end;gap:0.5rem;margin-top:0.75rem;">'+(status==='Unread'?'<button data-markfb="'+key+'" style="background:#f0faf4;border:1px solid #a8d5b5;border-radius:6px;padding:0.35rem 0.85rem;font-size:0.78rem;color:#2d6a4f;cursor:pointer;">✅ Mark Resolved</button>':'')+(status==='Resolved'?'<button data-delfb="'+key+'" data-delfbname="'+name+'" style="background:#fff0f0;border:1px solid #e0b0b0;border-radius:6px;padding:0.35rem 0.85rem;font-size:0.78rem;color:#c0392b;cursor:pointer;">🗑️ Delete</button>':'')+'</div></div>';}).join('');
    el.querySelectorAll('button[data-markfb]').forEach(function(btn){btn.addEventListener('click',function(){update(ref(db,'feedbacks/'+this.dataset.markfb),{status:'Resolved'});});});
    el.querySelectorAll('button[data-delfb]').forEach(function(btn){btn.addEventListener('click',function(){showDeletePopup(this.dataset.delfbname,async function(){await remove(ref(db,'feedbacks/'+btn.dataset.delfb));});});});
  });
}

function renderAdminReviews(){
  const el=document.getElementById('adminReviewsList'),entries=Object.entries(reviewsMap);
  if(!entries.length){el.innerHTML='<div class="empty-state">No reviews added yet.</div>';return;}
  el.innerHTML=entries.map(function(e){const key=escHtml(e[0]),r=e[1]||{},name=escHtml(r.name),date=escHtml(r.date),review=escHtml(r.text),stars=Math.max(0,Math.min(5,parseInt(r.stars)||0));return'<div class="order-admin-card" style="display:flex;justify-content:space-between;align-items:flex-start;">'+'<div><div class="order-admin-name">'+name+' '+'⭐'.repeat(stars)+'</div>'+'<div class="order-admin-meta">'+date+'</div>'+'<div class="order-admin-items">"'+review+'"</div></div>'+(staffLoggedIn?'':'<button data-delrev="'+key+'" data-delrevname="'+name+'" style="background:none;border:1px solid #e0b0b0;border-radius:4px;padding:0.3rem 0.6rem;font-size:0.75rem;color:#c0392b;cursor:pointer;margin-left:1rem;flex-shrink:0;">Remove</button>')+'</div>';}).join('');
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
window.toggleArchivePanel=function(){archivePanelOpen=!archivePanelOpen;document.getElementById('archivePanel').style.display=archivePanelOpen?'block':'none';var ordersList=document.getElementById('ordersList');if(ordersList){if(archivePanelOpen)ordersList.style.display='none';else ordersList.style.removeProperty('display');}var btn=document.getElementById('archiveToggleBtn');var hdg=document.getElementById('ordersHeading');if(btn){btn.textContent=archivePanelOpen?'← Back to Orders':'📦 View Archive';}if(hdg){hdg.textContent=archivePanelOpen?'Order Archive':'Active Orders';}subscriptionHub.activate(archivePanelOpen?'archive':'orders');if(archivePanelOpen)renderArchive();};
const orderArchivePanel=createOrderArchivePanel({getArchivedOrders:()=>archivedOrdersMap,archiveOutcome,hub:subscriptionHub,isAdmin:()=>adminLoggedIn,showDeletePopup:(label,fn)=>showDeletePopup(label,fn),requestManagerApproval,manageOrderArchive:command=>manageOrderArchiveCall(command)});
function renderArchive(){orderArchivePanel.render();}

function showDeletePopup(label,onConfirm){
  document.getElementById('deleteLabel').textContent=label;
  const isArchive=String(label).toLowerCase().includes('archive');
  document.getElementById('deleteConfirmBtn').textContent=isArchive?'Yes, Archive':'Yes, Delete';
  document.getElementById('deleteConfirmBtn').style.background=isArchive?'#41464b':'#c0392b';
  document.getElementById('deleteConfirmBtn').onclick=function(){onConfirm();document.getElementById('deletePopup').classList.remove('show');};
  document.getElementById('deletePopup').classList.add('show');
}

window.openAdmin=function(){document.getElementById('loginOverlay').classList.add('show');setTimeout(function(){document.getElementById('adminUser').focus();},150);};
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

// Staff-level module access. Keys must match PORTAL_PERMISSION_KEYS in src/functions/20b-portal-accounts.js.
var DEFAULT_STAFF_PERMS={dashboard:false,liveoperations:false,orders:true,reservations:true,pos:true,inventory:true,purchases:false,recipes:true,usage:true,registerOps:true,availability:true,comments:true,reviews:true,appcustomers:true,analytics:false,saleshistory:true,dailyreport:false,discrepancy:false,petty:true,undeposited:false,channelpricing:false,cashflow:false,stockvalue:false},roleLandingDone=false,currentStaffPerms=null,staffPermissionsReady=false;
// Tabs every staff account could see before they had their own key; an unsaved record keeps that.
var LEGACY_STAFF_PERMS={saleshistory:['orders'],undeposited:['petty','cashflow']};
// Admin roles always see the Dashboard; staff-level roles only with the Dashboard tick.
var staffDashboardAllowed=false;
function dashboardAllowed(){return adminLoggedIn||(staffLoggedIn&&staffDashboardAllowed);}
function staffPermsFrom(stored){var perms=Object.assign({},DEFAULT_STAFF_PERMS,stored||{});if(stored)Object.keys(LEGACY_STAFF_PERMS).forEach(function(key){if(stored[key]===undefined)perms[key]=LEGACY_STAFF_PERMS[key].some(function(from){return stored[from]===true;});});return perms;}
var _permTabMap={"'dashboard'":'dashboard',"'liveoperations'":'liveoperations',"'orders'":'orders',"'reservations'":'reservations',"'calendar'":'reservations',"'availSection'":'availability',"'commentsSection'":'comments',"'reviews'":'reviews',"'appcustomers'":'appcustomers',"'pos'":'pos',"'inventory'":'inventory',"'purchases'":'purchases',"'recipes'":'recipes',"'usage'":'usage',"'discrepancy'":'discrepancy',"'petty'":'petty',"'channelpricing'":'channelpricing',"'stockvalue'":'stockvalue',"'dailyreport'":'dailyreport',"'analytics'":'analytics',"'saleshistory'":'saleshistory',"'undeposited'":'undeposited',"'ops'":'registerOps'};
// Settings is locked for staff-level roles except Channel Pricing (ticked per account) and Change Password.
var _permAlwaysHide=["'payment'","'staffaccounts'","'packages'","'operations'","'possettings'","'accountingperiods'","'dedupe'","'payouts'","'rewards'","'companyinfo'","'taxcompliance'","'payables'"];
var ADMIN_ALWAYS_ROUTES={inbox:1,changepw:1},ADMIN_MANAGEMENT_ROUTES={payables:1};
function canOpenAdminRoute(tab){
  if(adminLoggedIn)return true;
  if(!staffLoggedIn||!staffPermissionsReady||ADMIN_MANAGEMENT_ROUTES[tab])return false;
  var key=_permTabMap["'"+tab+"'"];
  return key?!!(currentStaffPerms&&currentStaffPerms[key]===true):ADMIN_ALWAYS_ROUTES[tab]===1;
}
window.canOpenAdminRoute=canOpenAdminRoute;
function mountLegacyAdminPanels(){
  var wrap=document.querySelector('#adminDash .admin-wrap');if(!wrap)return;
  ['availSection','commentsSection'].forEach(function(id){var panel=document.getElementById(id);if(!panel)return;panel.classList.add('admin-tab-content','admin-integrated-panel');wrap.appendChild(panel);});
}
mountLegacyAdminPanels();
window.showAdminSection=function(id,btn){
  if(!canOpenAdminRoute(id)){alert('This account does not have access to this section.');return false;}
  var av=document.getElementById('availSection'),cm=document.getElementById('commentsSection');
  if(id==='availSection'){document.querySelectorAll('.admin-tab').forEach(function(b){b.classList.remove('active');});document.querySelectorAll('.admin-tab-content').forEach(function(t){t.style.display='none';});if(btn)btn.classList.add('active');if(av)av.style.display='block';subscriptionHub.activate('availability');buildAvail();renderOptionManager();workspaceShell.update('availability');window.scrollTo({top:document.getElementById('adminDash').offsetTop,behavior:'smooth'});}
  else if(id==='commentsSection'){ document.querySelectorAll('.admin-tab').forEach(function(b){b.classList.remove('active');});document.querySelectorAll('.admin-tab-content').forEach(function(t){t.style.display='none';});if(btn)btn.classList.add('active');if(cm)cm.style.display='block';subscriptionHub.activate('comments');if(typeof renderComments==='function')renderComments();workspaceShell.update('comments');window.scrollTo({top:document.getElementById('adminDash').offsetTop,behavior:'smooth'}); }
  else { if(av)av.style.display='none'; if(cm)cm.style.display='none'; window.scrollTo({top:0,behavior:'smooth'}); }
  return true;
};
function applyStaffPerms(perms,ready){
  staffPermissionsReady=ready!==false;
  currentStaffPerms=staffPermissionsReady?perms:null;
  staffDashboardAllowed=perms.dashboard===true;
  document.querySelectorAll('.admin-tab').forEach(function(btn){
    var oc=btn.getAttribute('onclick')||'';
    if(_permAlwaysHide.some(t=>oc.includes(t))){btn.style.display='none';return;}
    for(var k in _permTabMap){ if(oc.indexOf(k)!==-1){ btn.style.display=perms[_permTabMap[k]]?'':'none'; return; } }
  });
  var na=document.getElementById('navAvail'); if(na)na.style.display='none';
  var nc=document.getElementById('navComments'); if(nc)nc.style.display='none';
  document.querySelectorAll('.admin-group').forEach(function(gb){var g=gb.getAttribute('data-grp');var row=document.querySelector('.tabgrp[data-grp="'+g+'"]');var vis=false;if(row)row.querySelectorAll('.admin-tab').forEach(function(b){if(b.style.display!=='none')vis=true;});gb.style.display=vis?'':'none';});
  if(!staffPermissionsReady)return;
  var curG=document.querySelector('.admin-group.active');
  if(!curG||curG.style.display==='none'){var fg=null;document.querySelectorAll('.admin-group').forEach(function(gb){if(!fg&&gb.style.display!=='none')fg=gb;});if(fg)window.showTabGroup(fg.getAttribute('data-grp'),fg);}
  landRoleHome();
  // Saved ticks load after sign-in; draw the Dashboard once it becomes allowed and visible.
  if(dashboardAllowed()){var dashTab=document.getElementById('tab-dashboard');if(dashTab&&dashTab.style.display!=='none')renderDashboard();}
}
function roleLandingGroups(role){return {cashier:['pos'],kitchen:['orders'],finance:['purchasing','finance'],staff:['pos']}[String(role||'').toLowerCase()]||[];}
function landRoleHome(){
  if(roleLandingDone||!currentUser||!window.showTabGroup)return;
  // Staff and Cashier start on POS even when the Dashboard is ticked.
  var targets=roleLandingGroups(currentUser.serverRole);
  for(var i=0;i<targets.length;i++){var target=targets[i],group=document.querySelector('.admin-group[data-grp="'+target+'"]'),row=document.querySelector('.tabgrp[data-grp="'+target+'"]');if(!group||group.style.display==='none'||!row)continue;var first=null;row.querySelectorAll('.admin-tab').forEach(function(button){if(!first&&button.style.display!=='none')first=button;});if(first){roleLandingDone=true;window.showTabGroup(target,group);return;}}
}
async function loginSuccess(role,username,uid,serverRole,profile){
  roleLandingDone=false;
  currentUser={role,serverRole:serverRole||role,username,uid,title:profile&&profile.title||''};
  var effectiveRole=String(serverRole||role).toLowerCase();
  window.__accazaAuthz={uid,role:effectiveRole,isPrivileged:['owner','superadmin','admin','manager'].indexOf(effectiveRole)>-1};
  subscriptionHub.activate(role==='admin'?'dashboard':'auth-pending');subscriptionHub.authorize();
  ensureActiveOrdersCall({}).catch(function(e){console.warn('Active-order projection sweep deferred',e&&e.code);});
  try{sessionStorage.setItem('accaza_admin_session',JSON.stringify({username:username,uid:uid||null}));}catch(e){}
  try{if(!audioCtx)audioCtx=new(window.AudioContext||window.webkitAudioContext)();if(audioCtx.state==='suspended')audioCtx.resume();}catch(e){}
  document.getElementById('adminUser').value='';
  document.getElementById('adminPass').value='';
  closeAdmin();
  document.body.classList.remove('staff-mode');
  document.querySelectorAll('.admin-tab').forEach(function(t){t.style.removeProperty('display');});
  var accountAccessTab=document.getElementById('tabBtnAccountAccess');
  if(accountAccessTab)accountAccessTab.style.display='none';

  if(role==='admin'){
    currentStaffPerms=null;staffPermissionsReady=false;
    adminLoggedIn=true;superAdminLoggedIn=(effectiveRole==='superadmin');staffLoggedIn=false;
    document.getElementById('adminDash').style.display='block';
    document.getElementById('navAdminPanel').style.display='block';
    document.getElementById('navAvail').style.display='none';
    document.getElementById('navComments').style.display='none';
    document.getElementById('navAdminPanelLink').textContent='Admin panel';
    if(superAdminLoggedIn&&accountAccessTab)accountAccessTab.style.removeProperty('display');
    var hdr=document.querySelector('#adminDash .admin-header p');
    if(hdr)hdr.textContent=superAdminLoggedIn?((currentUser.title||'Systems Administrator')+': '+username+' · Super Admin'):(effectiveRole.charAt(0).toUpperCase()+effectiveRole.slice(1)+': '+username);
    setTimeout(function(){
      buildAvail();renderCategoryManager();renderOptionManager();renderNewItemOptionChecklist();renderComments();renderOrders();renderReservations();
      renderAdminReviews();renderAdminCalendar();renderDashboard();
    },300);
  }else{
    staffLoggedIn=true;adminLoggedIn=false;superAdminLoggedIn=false;staffPermissionsReady=false;currentStaffPerms=null;
    document.body.classList.add('staff-mode');
    document.getElementById('adminDash').style.display='block';
    document.getElementById('navAdminPanel').style.display='block';
    document.getElementById('navComments').style.display='none';
    document.getElementById('navAdminPanelLink').textContent='Staff panel';
    (function(){applyStaffPerms({},false);get(ref(db,'adminPerms/'+uid)).then(function(sn){applyStaffPerms(staffPermsFrom(sn.val()),true);}).catch(function(){applyStaffPerms({},false);});})();
    var hdr=document.querySelector('#adminDash .admin-header p');
    if(hdr)hdr.textContent='Staff: '+username;
    setTimeout(function(){
      renderOrders();renderReservations();renderAdminCalendar();renderDashboard();
      renderAdminReviews();renderComments();renderStaffMenu();
    },300);
  }
  window.scrollTo(0,0);
  if(role==='admin')workspaceShell.update('dashboard');
}

installPortalAuth({subscriptionHub:subscriptionHub,onAuthorized:loginSuccess,openLogin:window.openAdmin,onSignedOut:function(){adminLoggedIn=false;superAdminLoggedIn=false;staffLoggedIn=false;staffDashboardAllowed=false;currentStaffPerms=null;staffPermissionsReady=false;currentUser=null;currentLoginRole=null;window.__posShift=null;if(window.__refreshWorkspaceStatus)window.__refreshWorkspaceStatus();}});
const workspaceShell=installWorkspaceShell({currentUser:function(){return currentUser;},subscriptionHub:subscriptionHub});
// Admin screens that moved to Finance Books. Opening one here would hide every Admin tab and
// leave a blank page, so they open the matching Books page instead.
window.AccazaFinanceBooksPages=Object.freeze({cashflow:'cashflow',receivables:'receivables',payables:'payables',pnl:'pl'});
// Every open Books tab keeps its own live listeners, so repeated clicks reuse one named tab and
// switch its page in place (App.go) instead of opening or reloading Books again.
function openFinanceBooks(page){
  var url='books.html?tab='+page,books=window.open('','accazaFinanceBooks');
  if(!books){alert('Allow pop-ups for this site to open Finance Books.');return;}
  try{if(/books\.html$/.test(books.location.pathname)&&books.App&&typeof books.App.go==='function'){books.App.go(page);books.focus();return;}}catch(e){}
  books.location.href=url;books.focus();
}
window.switchTab=function(tab,btn){
  if(!canOpenAdminRoute(tab)){alert('This account does not have access to '+(tab==='payables'?'Supplier Bills & Payables':'this section')+'.');return false;}
  var booksPage=window.AccazaFinanceBooksPages[tab];
  if(booksPage){openFinanceBooks(booksPage);return true;}
  if(!document.getElementById('tab-'+tab)){console.warn('Admin has no screen for tab',tab);return false;}
  if(tab==='staffaccounts'&&!superAdminLoggedIn){alert('Super Admin access is required.');return false;}
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
  if(tab==='dashboard')renderDashboard();else overviewInsights.stop();
  if(tab==='appcustomers')renderAppCustomers();
  workspaceShell.update(tab);
  setTimeout(function(){renderHistoryPager(tab);},0);
  try{var _ab=document.querySelector('.admin-tab.active'); if(_ab){var _g=_ab.closest('.tabgrp'); if(_g){var _gn=_g.getAttribute('data-grp'); document.querySelectorAll('.tabgrp').forEach(function(r){r.style.display=(r===_g)?'flex':'none';}); document.querySelectorAll('.admin-group').forEach(function(x){x.classList.toggle('active', x.getAttribute('data-grp')===_gn);}); }}}catch(e){}
  return true;
};
window.showTabGroup=function(g,btn){
  document.querySelectorAll('.admin-group').forEach(function(b){b.classList.remove('active');});
  if(btn)btn.classList.add('active'); else {var gb=document.querySelector('.admin-group[data-grp="'+g+'"]'); if(gb)gb.classList.add('active');}
  document.querySelectorAll('.tabgrp').forEach(function(r){r.style.display=(r.getAttribute('data-grp')===g)?'flex':'none';});
  var row=document.querySelector('.tabgrp[data-grp="'+g+'"]'); if(!row)return;
  if(!row.querySelector('.admin-tab.active')){ var first=null; row.querySelectorAll('.admin-tab').forEach(function(b){ if(!first && b.style.display!=='none') first=b; }); if(first)first.click(); }
};

const botReplies=[
  {keys:['hour','open','close','time','schedule'],reply:'🕐 We are open every day — <strong>Monday to Sunday, 6:00 AM to 12:00 Midnight</strong>. ☕'},
  {keys:['location','address','where','find'],reply:"📍 <strong>Saratoga Avenue, La Mediterranea Subdivision, Governor's Drive, Dasmariñas, Cavite</strong>. Near SM Dasmariñas! 😊"},
  {keys:['gcash','pay','payment','bank','bdo'],reply:'💳 We accept <strong>GCash, BDO, and UnionBank</strong>. GCash: <strong>0927 692 4831</strong> (ACCAZA).'},
  {keys:['delivery','deliver'],reply:'🛵 We deliver within <strong>Dasmariñas, Cavite</strong> only. Outside? Try <strong>🟠 foodpanda</strong> or <strong>🟢 GrabFood</strong>.'},
  {keys:['menu','food','drink','coffee','frappe','pastry'],reply:'🍽️ We serve <strong>Coffee, Non-Coffee, Iced Blended, Soda Refreshers, and Pastries</strong>. Check our menu above! ☕'},
  {keys:['reserve','reservation','book','table'],reply:'📅 Use our <strong>Reservations section</strong> — pick a date, time slot, and fill in your details. Our staff will confirm! 😊'},
  {keys:['wifi','internet'],reply:'📶 Yes, we have free WiFi! Ask our staff for the password. 😊'},
  {keys:['price','cost','how much'],reply:'💰 Prices start from <strong>₱95 for pastries</strong> and <strong>₱155 for coffee</strong>. Check our menu! ☕'},
  {keys:['parking','park'],reply:'🚗 Yes, we have free parking! 😊'},
  {keys:['fresco','outdoor'],reply:'🌿 Yes, we have al fresco seating! 😊'},
  {keys:['hello','hi','hey','kumusta'],reply:'Hello! 👋 Welcome to <strong>Accaza Coffee House</strong>! How can I help you today? ☕'},
  {keys:['thank','thanks','salamat'],reply:"You're very welcome! 😊 See you at Accaza! ☕🐻"},
  {keys:['sms','text'],reply:'📩 You can reach us via SMS at <strong>0927 692 4831</strong>. 😊'},
];
function getBotReply(msg){const l=msg.toLowerCase();for(const r of botReplies){if(r.keys.some(k=>l.includes(k)))return r.reply;}return null;}
function addBotMsg(text){const m=document.getElementById('chatMessages'),d=document.createElement('div');d.className='chat-msg bot';d.innerHTML=text;m.appendChild(d);m.scrollTop=m.scrollHeight;}
function addUserMsg(text){const m=document.getElementById('chatMessages'),d=document.createElement('div');d.className='chat-msg user';d.textContent=text;m.appendChild(d);m.scrollTop=m.scrollHeight;}
function showContactOptions(msg){
  const encoded=encodeURIComponent('Hi Accaza Coffee! I have a question: '+msg);
  const d=document.createElement('div');d.className='chat-msg bot';
  d.innerHTML='<p style="margin-bottom:0.6rem;">🤔 Sorry, I\'m not sure about that! Reach us directly:</p>'
    +'<div style="display:flex;flex-direction:column;gap:0.4rem;margin-bottom:0.75rem;">'
    +'<a href="https://wa.me/'+CAFE_PHONE+'?text='+encoded+'" target="_blank" rel="noopener noreferrer" style="background:#25D366;color:#fff;border:none;border-radius:6px;padding:0.5rem 0.75rem;font-size:0.78rem;text-decoration:none;display:block;">💬 WhatsApp</a>'
    +'<a href="viber://chat?number=%2B'+CAFE_PHONE+'&text='+encoded+'" style="background:#7360f2;color:#fff;border:none;border-radius:6px;padding:0.5rem 0.75rem;font-size:0.78rem;text-decoration:none;display:block;">📱 Viber</a>'
    +'<a href="sms:+'+CAFE_PHONE+'?body='+encoded+'" style="background:#44523f;color:#fff;border:none;border-radius:6px;padding:0.5rem 0.75rem;font-size:0.78rem;text-decoration:none;display:block;">📩 SMS</a>'
    +'<a href="mailto:'+CAFE_EMAIL+'?subject=Customer Inquiry&body='+encoded+'" style="background:#b08d57;color:#fff;border:none;border-radius:6px;padding:0.5rem 0.75rem;font-size:0.78rem;text-decoration:none;display:block;">📧 Email</a>'
    +'</div><p style="font-size:0.72rem;color:#79806f;border-top:1px solid #cdbda7;padding-top:0.5rem;">📱 WhatsApp, Viber & SMS work best on mobile. On desktop? Use Email.</p>';
  document.getElementById('chatMessages').appendChild(d);document.getElementById('chatMessages').scrollTop=document.getElementById('chatMessages').scrollHeight;
}
window.toggleChat=function(){chatOpen=!chatOpen;document.getElementById('chatWindow').classList.toggle('open',chatOpen);document.getElementById('chatNotif').style.display='none';if(chatOpen&&!chatStarted){chatStarted=true;setTimeout(function(){addBotMsg("👋 Hi! Welcome to <strong>Accaza Coffee House</strong>! Ask me about our hours, menu, delivery, reservations, and more! ☕");},400);}};
window.sendChat=function(){const input=document.getElementById('chatInput'),msg=input.value.trim();if(!msg)return;input.value='';addUserMsg(msg);const typing=document.createElement('div');typing.className='chat-msg bot';typing.id='typing';typing.innerHTML='<span style="letter-spacing:2px;">•••</span>';document.getElementById('chatMessages').appendChild(typing);document.getElementById('chatMessages').scrollTop=document.getElementById('chatMessages').scrollHeight;setTimeout(function(){const t=document.getElementById('typing');if(t)t.remove();const reply=getBotReply(msg);if(reply)addBotMsg(reply);else showContactOptions(msg);},900);};
window.quickMsg=function(msg){document.getElementById('chatInput').value=msg;sendChat();};
setTimeout(function(){if(!chatOpen)document.getElementById('chatNotif').style.display='block';},3000);

renderCustomerCalendar();
renderCustomerOrders();
const nmKey=new Date(Date.now()+28800000).toISOString().slice(0,10);
const archFrom=document.getElementById('archiveFrom'),archTo=document.getElementById('archiveTo');
if(archFrom)archFrom.value=nmKey.slice(0,7)+'-01';
if(archTo)archTo.value=nmKey;
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
  var GALLERY = ["assets/img/gallery/gallery-01.webp", "assets/img/gallery/gallery-02.webp", "assets/img/gallery/gallery-03.webp", "assets/img/gallery/gallery-04.webp", "assets/img/gallery/gallery-05.webp", "assets/img/gallery/gallery-06.webp", "assets/img/gallery/gallery-07.webp", "assets/img/gallery/gallery-08.webp", "assets/img/gallery/gallery-09.webp", "assets/img/gallery/gallery-10.webp", "assets/img/gallery/gallery-11.webp"];
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
  var o = orderId&&typeof orderId==='object' ? orderId : adminOrdersMap[orderId];
  if (!o) return;
  var addr='Saratoga Ave, La Mediterranea Subd., Governor\'s Drive, Dasmariñas';
  var dispRef=o.platformRef||o.id;
  function receiptPeso(n){n=Number(n)||0;return'&#8369;'+n.toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});}
  function legacyItemLines(text) {
    var out=[],buf='',depth=0;
    String(text||'').split('').forEach(function(ch){
      if(ch==='(') depth++;
      if(ch===')'&&depth>0) depth--;
      if(ch===','&&depth===0){ if(buf.trim()) out.push(buf.trim()); buf=''; }
      else buf+=ch;
    });
    if(buf.trim()) out.push(buf.trim());
    return out;
  }
  var sourceLines = Array.isArray(o.correctedLineItems)&&o.correctedLineItems.length ? o.correctedLineItems : o.lineItems;
  var soldLines = Array.isArray(sourceLines)&&sourceLines.length ? sourceLines.map(function(li){
    var name=String(li.name||li.itemKey||'Item'),size=String(li.size||''),qty=Math.max(1,Number(li.qty)||1),unitTotal=Number(li.unitTotal);
    if(size&&name.toLowerCase().indexOf('('+size.toLowerCase()+')')<0) name+=' ('+size+')';
    return {name:name,qty:qty,total:Number.isFinite(unitTotal)?qty*unitTotal:null};
  }) : legacyItemLines(o.correctedItems||o.items).map(function(text){
    var match=text.match(/\s+x(\d+)\s*$/i);
    return {name:match?text.slice(0,match.index).trim():text,qty:match?Math.max(1,Number(match[1])||1):1,total:null};
  });
  var rows=soldLines.length?soldLines.map(function(line){return'<tr><td>'+escHtml(line.name)+' &times;'+escHtml(line.qty)+'</td><td style="text-align:right;">'+(line.total==null?'':receiptPeso(line.total))+'</td></tr>';}).join(''):'<tr><td colspan="2">No item details recorded</td></tr>';
  /* Tax rendering mirrors Financial.taxSplit on the server: VAT = base - base/(1+rate/100) either way; percentage = base*rate/100 inclusive, base*rate/(100+rate) exclusive (the add-on inflated the charged amount). Tax base matches orderTaxBase (platform gross vs in-store total). Orders charged before a tax regime existed have no o.tax and render exactly as before. */
  var tax=(o.tax&&(o.tax.mode==='vat'||o.tax.mode==='percentage'))?o.tax:null;
  var taxRate=tax?(Number(tax.rate)||0):0,taxBase=0,taxAmount=0,taxExclusive=tax?tax.inclusive===false:false,exemptSales=0;
  if(tax){
    var tch=String(o.channel||'').toLowerCase(),tplat=(tch==='grabfood'||tch==='foodpanda');
    taxBase=Number(tplat?(o.grossPlatform!=null?o.grossPlatform:(o.subtotal!=null?o.subtotal:o.total)):o.total)||0;
    if(tax.mode==='vat'){
      /* Mirrors server orderExemptSales/orderOutputVat exactly (RMC 72-2014): the exempt charged portion carries no output VAT; VAT is extracted only from the taxable remainder, less VAT reversed on refunds. */
      exemptSales=Math.max(0,Math.min(Number(o.vatExemptSales)||0,taxBase));
      if(!(exemptSales>0)&&Array.isArray(o.discountLines)){exemptSales=(o.discountLines||[]).reduce(function(c,d){var ty=String((d&&d.type)||'').toLowerCase();return (ty==='senior'||ty==='pwd'||ty==='athlete')?c+((Number(d.basis)||0)*(1-(Number(d.rate)||0))):c;},0);exemptSales=Math.max(0,Math.min(Math.round(exemptSales*100)/100,taxBase));}
      var vBase=Math.max(0,taxBase-exemptSales),saleVat=Math.round((vBase-vBase/(1+taxRate/100))*100)/100,refundAmt=Math.max(0,Number(o.refundAmount)||0),refundVat=0;
      if(refundAmt>0){var exPart=(exemptSales>0&&taxBase>0)?Math.min(refundAmt,Math.round(refundAmt*exemptSales/taxBase*100)/100):0,rBase=Math.round(Math.max(0,refundAmt-exPart)*100)/100;refundVat=Math.round((rBase-rBase/(1+taxRate/100))*100)/100;}
      taxAmount=Math.max(0,Math.round((saleVat-refundVat)*100)/100);
    } else {
      taxAmount=Math.round((taxExclusive?taxBase*taxRate/(100+taxRate):taxBase*taxRate/100)*100)/100;
    }
  }
  var receiptHtml='<!doctype html><html><head><meta charset="UTF-8"/><title>Receipt '+escHtml(dispRef)+'</title><style>*{font-family:monospace;font-size:12px;color:#000;}body{padding:10px;}h2{text-align:center;margin:0 0 2px;}table{width:100%;border-collapse:collapse;}td{padding:2px 0;}hr{border:none;border-top:1px dashed #000;}@media print{button{display:none;}}</style></head><body>'
    +'<h2>Accaza Coffee House</h2><div style="text-align:center;">'+escHtml(addr)+'</div>'
    +(tax&&tax.tin?'<div style="text-align:center;">TIN: '+escHtml(tax.tin)+(tax.branchCode&&tax.branchCode!=='00000'?' / Branch '+escHtml(tax.branchCode):'')+'</div>':'')
    +(tax&&tax.ptu?'<div style="text-align:center;">PTU No.: '+escHtml(tax.ptu)+'</div>':'')
    +(tax?'<div style="text-align:center;font-weight:700;">'+(tax.mode==='vat'?'VAT':'NON-VAT')+'</div>':'')
    +'<hr>'
    +'<div>Order: '+escHtml(dispRef)+'</div>'+(o.invoiceNumber?'<div>Invoice No.: '+escHtml(o.invoiceNumber)+'</div>':'')+(o.completedOrderCorrection?'<div>Corrects original order: '+escHtml(o.originalOrderId)+'</div>':'')+'<div>'+escHtml(o.date||'')+' '+escHtml(o.time||'')+'</div><div>On Duty: '+escHtml(o.onDuty||o.staff||'-')+'</div><div>Customer: '+escHtml(o.name||'Walk-in')+'</div>'
    +'<hr><table>'+rows+'</table><hr>'
    +'<table><tr><td>Subtotal</td><td style="text-align:right;">'+receiptPeso(o.subtotal!=null?o.subtotal:o.total)+'</td></tr>'
    +((o.discountLines&&o.discountLines.length)?o.discountLines.map(function(d){var lbl={senior:'Senior 20%',pwd:'PWD 20%',athlete:'Athlete 20%',promo5:'Promo 5%'}[d.type]||d.type;return'<tr><td>'+escHtml(lbl)+(d.idNumber?' · '+escHtml(d.idNumber):'')+'</td><td style="text-align:right;">-'+receiptPeso(d.value)+'</td></tr>';}).join(''):'')
    +(function(){var sc=(o.discountLines||[]).reduce(function(s,d){return s+(Number(d.value)||0);},0);var man=(Number(o.discount)||0)-sc;return man>0.005?'<tr><td>Discount</td><td style="text-align:right;">-'+receiptPeso(man)+'</td></tr>':'';})()
    +(Number(o.loyaltyDiscount)>0?'<tr><td>Loyalty reward'+(o.loyaltyRewardName?' · '+escHtml(o.loyaltyRewardName):'')+'</td><td style="text-align:right;">-'+receiptPeso(o.loyaltyDiscount)+'</td></tr>':'')
    +(tax&&tax.mode==='vat'?(exemptSales>0?'<tr><td>VAT-EXEMPT (senior/PWD)</td><td style="text-align:right;">'+receiptPeso(exemptSales)+'</td></tr>':'')+'<tr><td>Net of VAT</td><td style="text-align:right;">'+receiptPeso(Math.round((taxBase-exemptSales-taxAmount)*100)/100)+'</td></tr><tr><td>VAT ('+taxRate+'%) '+(taxExclusive?'added':'included')+'</td><td style="text-align:right;">'+receiptPeso(taxAmount)+'</td></tr>':'')
    +(tax&&tax.mode==='percentage'?'<tr><td>Pct. tax ('+taxRate+'%) '+(taxExclusive?'added':'included')+'</td><td style="text-align:right;">'+receiptPeso(taxAmount)+'</td></tr>':'')
    +(tax&&Number(o.total)>=1000?'<tr><td>Buyer TIN (&#8369;1,000+)</td><td style="text-align:right;">________</td></tr>':'')
    +'<tr><td><b>TOTAL</b></td><td style="text-align:right;"><b>'+receiptPeso(o.total)+'</b></td></tr>'
    +'<tr><td>Payment</td><td style="text-align:right;">'+escHtml(o.payment||'-')+'</td></tr>'
    +(o.completedOrderCorrection?'<tr><td>Original electronic payment</td><td style="text-align:right;">'+receiptPeso(o.originalPaidTotal)+'</td></tr>'+(Number(o.refundAmount)>0?'<tr><td>Cash refund</td><td style="text-align:right;">-'+receiptPeso(o.refundAmount)+'</td></tr>':''):'')
    +(o.preCompletionCashRefund?'<tr><td>Electronic amount received</td><td style="text-align:right;">'+receiptPeso(o.preCompletionCashRefund.paidAmount)+'</td></tr><tr><td>Cash refund</td><td style="text-align:right;">-'+receiptPeso(o.preCompletionCashRefund.amount)+'</td></tr>':'')
    +(o.platformRef?'<tr><td>Net (after comm.)</td><td style="text-align:right;">'+receiptPeso(o.netPlatform||0)+'</td></tr>':'')
    +(o.tendered?'<tr><td>Cash</td><td style="text-align:right;">'+receiptPeso(o.tendered)+'</td></tr><tr><td>Change</td><td style="text-align:right;">'+receiptPeso(o.change)+'</td></tr>':'')
    +(o.tipRounding?'<tr><td>Tip / kept change</td><td style="text-align:right;">'+receiptPeso(o.tipRounding)+'</td></tr>':'')
    +'</table><hr><div style="text-align:center;">Salamat! Please come again.</div>'
    +(tax?'<div style="text-align:center;font-size:9px;margin-top:4px;">'+(tax.mode==='vat'?(taxExclusive?'All prices are exclusive of VAT; VAT is added on top.':'All prices are VAT-inclusive.'):(taxExclusive?'All prices are exclusive of '+taxRate+'% percentage tax (NON-VAT); tax is added on top.':'All prices are inclusive of '+taxRate+'% percentage tax (NON-VAT).'))+'</div>':'<div style="text-align:center;font-size:9px;margin-top:4px;">This is not an official BIR receipt.</div>')
    +(tax?(tax.ptu?'<div style="text-align:center;font-size:9px;margin-top:2px;">This serves as your official invoice under BIR permit-to-use '+escHtml(tax.ptu)+'.</div>':'<div style="text-align:center;font-size:9px;margin-top:2px;">BIR permit-to-use number not yet set; this is not yet an official invoice.</div>'):'')
    +'<div style="text-align:center;margin-top:8px;"><button id="receiptPrint" type="button">Print</button></div></body></html>';
  var win = window.open('', '_blank', 'width=360,height=640');
  if(!win){alert('Allow pop-ups to print the receipt.');return;}
  win.document.write(receiptHtml);
  win.document.close();
  var printButton=win.document.getElementById&&win.document.getElementById('receiptPrint');
  if(printButton)printButton.addEventListener('click',function(){win.print();});
};
