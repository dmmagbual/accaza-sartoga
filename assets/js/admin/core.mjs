import{initializeApp}from"https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import{getDatabase,ref,set,get,push,update,remove,onValue,runTransaction,query,orderByChild,limitToLast,endBefore}from"https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import{getMessaging,getToken,onMessage,isSupported}from"https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js";
import{getAuth,signInWithEmailAndPassword,signOut,onAuthStateChanged,sendPasswordResetEmail,updatePassword,reauthenticateWithCredential,EmailAuthProvider,setPersistence,browserLocalPersistence}from"https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import{getFunctions,httpsCallable}from"https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js";

const firebaseConfig={apiKey:"AIzaSyAsh6j1T0tC-v2avj1J2mfCDdFG88FcpUM",authDomain:"accaza-sartoga.firebaseapp.com",databaseURL:"https://accaza-sartoga-default-rtdb.asia-southeast1.firebasedatabase.app",projectId:"accaza-sartoga",storageBucket:"accaza-sartoga.firebasestorage.app",messagingSenderId:"315522485228",appId:"1:315522485228:web:64ed3b7facef5a39148ec9"};
const app=initializeApp(firebaseConfig);
const db=getDatabase(app);const auth=getAuth(app);const functions=getFunctions(app,'asia-southeast1');const getPaymentProofCall=httpsCallable(functions,'getPaymentProof');const ensureActiveOrdersCall=httpsCallable(functions,'ensureActiveOrders');const postInventoryMovementsCall=httpsCallable(functions,'postInventoryMovements');const ensureInventoryLedgerCall=httpsCallable(functions,'ensureInventoryLedger');const validateRecipeDefinitionCall=httpsCallable(functions,'validateRecipeDefinition');window.__accazaAuth=auth;
// Release 2B: one physical Realtime Database listener per path. POS-critical
// paths stay live; large back-office paths are connected only for the open tab.
const HISTORY_BOUNDS={
  orders:{field:'timestamp',limit:250,page:250},archivedOrders:{field:'archivedAt',limit:100,page:100},archivedReservations:{field:'archivedAt',limit:100,page:100},
  shifts:{field:'openAt',limit:100,page:100},activityLog:{field:'ts',limit:200,page:200},discrepancies:{field:'ts',limit:200,page:200},
  stockReceipts:{field:'ts',limit:250,page:250},inventoryAdjustments:{field:'ts',limit:250,page:250},internalUsage:{field:'ts',limit:250,page:250},
  cfLedger:{field:'ts',limit:300,page:300},platformPayouts:{field:'settledAt',limit:100,page:100},inventoryMovements:{field:'occurredAt',limit:300,page:300}
};
function liveTarget(database,path){var base=ref(database,path),spec=HISTORY_BOUNDS[path];return spec?query(base,orderByChild(spec.field),limitToLast(spec.limit)):base;}
function createSubscriptionHub(database,makeRef,listen,targetFor){
  var entries={},authorized=false,activeScope='dashboard',nextId=1;
  var critical={categories:1,settings:1,posSettings:1,activeOrders:1,optionGroups:1,menuItems:1,availability:1,channelPrices:1,posStaff:1,posActiveShift:1,packages:1,'.info/connected':1};
  var scopes={
    orders:['analytics','pnl','payouts','stockvalue','dailyreport','cashflow','receivables'],
    staffAccounts:['staffaccounts'],adminAccounts:['adminaccounts'],admins:['staffaccess'],adminPerms:['staffaccess'],
    archivedOrders:['dashboard','archive','appcustomers','analytics','pnl','stockvalue','cashflow','receivables','dailyreport'],
    archivedReservations:['reservations','calendar'],reservations:['dashboard','reservations','calendar'],
    feedbacks:['comments','analytics'],reviews:['dashboard','reviews','analytics'],payment:['payment'],calBlocks:['reservations','calendar'],
    appCustomers:['appcustomers','analytics'],inventory:['inventory','purchases','recipes','usage','stockvalue'],inventoryMovements:['inventory','purchases','usage','stockvalue'],
    recipes:['recipes','usage','analytics','pnl'],optionRecipes:['recipes','usage'],internalUsage:['usage','pnl','stockvalue'],usageTypes:['usage'],
    expenseItems:['pnl'],monthlyExpenses:['pnl'],inventoryAdjustments:['pnl','stockvalue'],stockReceipts:['purchases','stockvalue'],
    analyticsFunnel:['analytics'],platformPayouts:['payouts','pnl','analytics','cashflow','receivables'],platformVarAccounts:['payouts','pnl'],
    shifts:['ops'],activityLog:['ops'],heldOrders:['pos','ops'],discrepancies:['discrepancy'],
    pettyCashVouchers:['petty'],pettyCashReplenishments:['petty'],pettyCashSettings:['petty'],
    cfAccounts:['cashflow','receivables','payables'],cfLedger:['cashflow'],receivables:['receivables'],payables:['payables']
  };
  function policy(path,opts){opts=opts||{};return {critical:opts.critical===true||critical[path]===1,scopes:opts.scopes||scopes[path]||[]};}
  function consumerActive(c){return authorized&&(c.critical||c.scopes.indexOf(activeScope)>-1);}
  function reportError(path,error){console.error('ACCAZA LIVE DATA ERROR ['+path+']',error);try{(window.accazaToast||function(){})('Live data failed for '+path+'. Check connection or access.','err');}catch(_e){}}
  function facade(entry){var merged=Object.assign({},entry.older||{},entry.live||{});return {val:function(){return merged;},exists:function(){return Object.keys(merged).length>0;}};}
  function dispatch(entry,snapshot){
    entry.last=snapshot;
    Object.keys(entry.consumers).forEach(function(id){var c=entry.consumers[id];if(consumerActive(c)){try{c.callback(snapshot);}catch(e){console.error('ACCAZA RENDER ERROR ['+entry.path+']',e);}}});
  }
  function attach(entry){
    entry.unsub=listen((targetFor||function(db,path){return makeRef(db,path);})(database,entry.path),function(snapshot){
      if(HISTORY_BOUNDS[entry.path]){entry.live=snapshot.val()||{};entry.hasOlder=Object.keys(entry.live).length>=HISTORY_BOUNDS[entry.path].limit;dispatch(entry,facade(entry));}else dispatch(entry,snapshot);
    },function(error){entry.unsub=null;reportError(entry.path,error);});
  }
  function reconcileEntry(entry){
    var ids=Object.keys(entry.consumers),needed=ids.some(function(id){return consumerActive(entry.consumers[id]);}),wasAttached=!!entry.unsub;
    if(needed&&!entry.unsub)attach(entry);
    if(!needed&&entry.unsub){entry.unsub();entry.unsub=null;entry.last=null;}
    ids.forEach(function(id){
      var c=entry.consumers[id],now=consumerActive(c),becameActive=now&&!c.wasActive;
      c.wasActive=now;
      if(becameActive&&wasAttached&&entry.last){try{c.callback(entry.last);}catch(e){console.error('ACCAZA RENDER ERROR ['+entry.path+']',e);}}
    });
  }
  function reconcile(){Object.keys(entries).forEach(function(path){reconcileEntry(entries[path]);});}
  return {
    subscribe:function(path,callback,opts){
      var p=policy(path,opts),entry=entries[path]||(entries[path]={path:path,consumers:{},unsub:null,last:null,live:{},older:{},hasOlder:true}),id=String(nextId++);
      entry.consumers[id]={callback:callback,critical:p.critical,scopes:p.scopes,wasActive:false};reconcileEntry(entry);
      return function(){delete entry.consumers[id];reconcileEntry(entry);};
    },
    authorize:function(){authorized=true;try{performance.mark('accaza-live-start');}catch(_e){}reconcile();},
    deauthorize:function(){authorized=false;reconcile();},
    activate:function(scope){activeScope=scope||'dashboard';reconcile();},
    loadOlder:async function(path){
      var spec=HISTORY_BOUNDS[path],entry=entries[path];if(!spec||!entry)throw new Error('No paginated subscription for '+path);
      var merged=Object.assign({},entry.older||{},entry.live||{}),keys=Object.keys(merged),oldest=null;
      keys.forEach(function(k){var v=merged[k]||{},sv=Number(v[spec.field])||0;if(!oldest||sv<oldest.value||(sv===oldest.value&&k<oldest.key))oldest={value:sv,key:k};});
      if(!oldest){entry.hasOlder=false;return {loaded:0,hasOlder:false};}
      var snap=await get(query(ref(database,path),orderByChild(spec.field),endBefore(oldest.value,oldest.key),limitToLast(spec.page+1))),rows=[];
      snap.forEach(function(ch){rows.push({key:ch.key,value:ch.val()||{}});});var hasOlder=rows.length>spec.page;if(hasOlder)rows.shift();
      rows.forEach(function(r){entry.older[r.key]=r.value;});entry.hasOlder=hasOlder;dispatch(entry,facade(entry));return {loaded:rows.length,hasOlder:hasOlder};
    },
    historyStatus:function(path){var e=entries[path],s=HISTORY_BOUNDS[path];return {bounded:!!s,loaded:e?Object.keys(Object.assign({},e.older||{},e.live||{})).length:0,hasOlder:e?e.hasOlder:false};},
    stats:function(){var attached=Object.keys(entries).filter(function(k){return !!entries[k].unsub;});return {authorized:authorized,activeScope:activeScope,attached:attached,attachedCount:attached.length,registeredPaths:Object.keys(entries).length};}
  };
}
const subscriptionHub=createSubscriptionHub(db,ref,onValue,liveTarget);
window.__accazaLiveStats=function(){return subscriptionHub.stats();};
const HISTORY_TAB_PATHS={analytics:['orders','archivedOrders'],pnl:['orders','archivedOrders','internalUsage','inventoryAdjustments','platformPayouts'],payouts:['orders','archivedOrders','platformPayouts'],stockvalue:['orders','archivedOrders','stockReceipts','inventoryAdjustments','internalUsage','inventoryMovements'],dailyreport:['orders','archivedOrders'],cashflow:['orders','archivedOrders','cfLedger','platformPayouts'],receivables:['orders','archivedOrders'],purchases:['stockReceipts','inventoryMovements'],usage:['internalUsage','inventoryMovements'],inventory:['inventoryMovements'],ops:['shifts','activityLog'],discrepancy:['discrepancies'],reservations:['archivedReservations']};
function renderHistoryPager(tab){
  var paths=HISTORY_TAB_PATHS[tab],host=document.getElementById('tab-'+tab);if(!paths||!host)return;
  var old=host.querySelector('.accaza-history-pager');if(old)old.remove();
  var box=document.createElement('div');box.className='accaza-history-pager';box.style.cssText='margin:1rem 0;padding:0.65rem;border:1px solid #e1d5c5;border-radius:7px;background:#fffaf3;font-size:0.74rem;color:var(--tl);';
  box.innerHTML='<div style="margin-bottom:0.4rem;"><b>Bounded history:</b> reports use the recent loaded pages. Load older pages when reviewing an older period.</div><div style="display:flex;gap:0.35rem;flex-wrap:wrap;">'+paths.map(function(path){return '<button class="pz-btn sec" data-history-more="'+path+'" style="padding:0.22rem 0.55rem;">Load older '+path+'</button>';}).join('')+'</div>';
  host.appendChild(box);
  box.querySelectorAll('[data-history-more]').forEach(function(btn){btn.onclick=async function(){var path=btn.getAttribute('data-history-more');btn.disabled=true;btn.textContent='Loading '+path+'…';try{var r=await subscriptionHub.loadOlder(path);btn.textContent=r.loaded?(r.loaded+' older '+path+' loaded'):'All '+path+' history reached';if(r.hasOlder){setTimeout(function(){btn.disabled=false;btn.textContent='Load older '+path;},900);}}catch(e){btn.disabled=false;btn.textContent='Retry older '+path;}};});
}
window.__fbForgot=async function(){var em=(document.getElementById('adminUser').value||'').trim();if(!em||em.indexOf('@')<0){em=(prompt('Enter your account email for a reset link:')||'').trim();}if(!em||em.indexOf('@')<0){alert('Please enter a valid email.');return;}try{await sendPasswordResetEmail(auth,em);alert('Password reset link sent to '+em+'. Check inbox and spam.');}catch(e){alert('Could not send reset: '+((e&&e.code)||e));}};
// ===================== WEB PUSH (FCM) =====================
// Paste your Web Push certificate key here (Firebase Console > Project settings > Cloud Messaging > Web Push certificates).
const VAPID_KEY="BIIVf-1RYIQger0yqeYlyV6-tQpH8YfytIgQK6-7IJg87HVITcNkYv4RYcKjyCmJBJKR1EXjJqRuiHzkFJjSvlE";
function _pushToastWire(messaging){onMessage(messaging,function(payload){var d=(payload&&(payload.data||payload.notification))||{};try{if(navigator.vibrate)navigator.vibrate([400,150,400,150,400,150,400]);}catch(e){}try{playReadyChime();}catch(e){}try{navigator.serviceWorker.ready.then(function(reg){reg.showNotification(d.title||'Accaza Coffee House',{body:d.body||'',icon:'/favicon_192x192.png',badge:'/favicon_192x192.png',vibrate:[400,150,400,150,400,150,400],requireInteraction:true,renotify:true,tag:'accaza-order',data:{link:(d.link||'/')}});});}catch(e){}try{(window.accazaToast||function(){})((d.title?d.title+': ':'')+(d.body||'New notification'),'ok');}catch(e){}});}
async function registerPushToken(){
  try{
    if(!VAPID_KEY||VAPID_KEY.indexOf('PASTE_')===0)return;
    if(!('serviceWorker' in navigator)||!('Notification' in window))return;
    if(Notification.permission!=='granted')return;
    if(!(await isSupported()))return;
    var reg=await navigator.serviceWorker.ready;
    var messaging=getMessaging(app);
    var token=await getToken(messaging,{vapidKey:VAPID_KEY,serviceWorkerRegistration:reg});
    if(token){var u=getAppUser();if(u&&u.phone){var k=u.phone.replace(/[^0-9]/g,'');if(k){try{await update(ref(db,'appCustomers/'+k),{pushToken:token,pushTokenAt:Date.now()});if(!window.__pushToasted){window.__pushToasted=true;(window.accazaToast||function(){})('🔔 Notifications on for this device','ok');}}catch(e){}}}}
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
  if(!isAppMode()||!('Notification' in window)){b.style.display='none';return;}
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

// DB refs
const settingsRef=ref(db,'settings'),staffAccountsRef=ref(db,'staffAccounts'),adminAccountsRef=ref(db,'adminAccounts'),ordersRef=ref(db,'orders'),archivedRef=ref(db,'archivedOrders'),archivedResRef=ref(db,'archivedReservations'),reservationsRef=ref(db,'reservations'),feedbacksRef=ref(db,'feedbacks'),reviewsRef=ref(db,'reviews'),availRef=ref(db,'availability'),paymentRef=ref(db,'payment'),calBlocksRef=ref(db,'calBlocks'),menuRef=ref(db,'menuItems'),categoriesRef=ref(db,'categories'),optionGroupsRef=ref(db,'optionGroups'),appCustomersRef=ref(db,'appCustomers');
// ── POS / INVENTORY BRIDGE ── exposes DB + live maps to the isolated POS module (see #accaza-pos script). Additive; does not change existing behaviour.
window.__accaza={
  db, ref, set, get, update, remove, onValue, runTransaction, hub:subscriptionHub,
  subscribe:function(path,callback,opts){return subscriptionHub.subscribe(path,callback,opts);},
  postInventoryMovements:function(movements){return postInventoryMovementsCall({movements:movements});},
  ensureInventoryLedger:function(){return ensureInventoryLedgerCall({});},
  validateRecipeDefinition:function(recipe){return validateRecipeDefinitionCall({recipe:recipe});},
  get menuItemsMap(){return menuItemsMap;},
  get optionGroupsMap(){return optionGroupsMap;},
  get categoriesMap(){return categoriesMap;},
  get adminOrdersMap(){return adminOrdersMap;},
  get currentUser(){return (typeof currentUser!=='undefined')?currentUser:null;},
  getMenuItems, getCats, getCatLabel, getCatIcon, getItemOptionGroups, formatPrice
};

let currentAdminHash=null,staffAccountsMap={},adminAccountsMap={},staffLoggedIn=false,superAdminLoggedIn=false,currentUser=null,currentLoginRole=null;
const SUPER_ADMIN_USERNAME='superadmin',CAFE_PHONE='639276924831',CAFE_EMAIL='mariadaniela@gmail.com',MAX_GUESTS=30;
const TIME_SLOTS=['3:00 PM','4:00 PM','5:00 PM','6:00 PM','7:00 PM','8:00 PM','9:00 PM','10:00 PM','11:00 PM','12:00 Midnight'];

const DEFAULT_CATS=[
  {id:'coffee',label:'Coffee Based',icon:'☕',order:0},
  {id:'noncaf',label:'Non-Coffee Based',icon:'🌿',order:1},
  {id:'frappe',label:'Iced Blended Coffee',icon:'🥤',order:2},
  {id:'nonfrappe',label:'Iced Blended Non-Coffee',icon:'🧊',order:3},
  {id:'soda',label:'Soda-Based Refreshers',icon:'🍋',order:4},
  {id:'pastry',label:'Pastries',icon:'🍞',order:5}
];

// Customize cats
const DRINK_CATS=['coffee','noncaf','frappe','nonfrappe','soda'];
const TEMP_CATS=['coffee','noncaf'];
const MILK_CATS=['coffee','noncaf','frappe','nonfrappe'];
const SHOT_CATS=['coffee','frappe'];
const SYRUP_CATS=['coffee','noncaf','frappe','nonfrappe'];
const TOPPING_CATS=['coffee','noncaf','frappe','nonfrappe','soda'];

// ── OPTION GROUPS (data-driven item variations) ─────────────
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

// State
let categoriesMap={},menuItemsMap={},adminOrdersMap={},archivedOrdersMap={},archivedResMap={},adminResMap={},feedbacksMap={},reviewsMap={},availability={},cart={};
let optionGroupsMap={},optSeedStarted=false,itemOptMigrated=false;
let knownOrderIds=null,unseenOrders=0,orderChimeTimer=null,audioCtx=null;
let orderType='pickup',paymentType='gcash',contactMethod='whatsapp',resContactMethod='whatsapp';
let myOrderIds=JSON.parse(localStorage.getItem('accaza_my_orders')||'[]');
let adminLoggedIn=false,calBlocks={};
let calYear,calMonth,selectedDate=null,selectedTime=null;
let adminCalYear,adminCalMonth,adminSelectedDate=null;
let chatOpen=false,chatStarted=false;
let custItem=null,custSize=null,custSel={},custQty=1;
let menuFilter='coffee',orderFilter=null;

const now=new Date();
calYear=now.getFullYear();calMonth=now.getMonth();
adminCalYear=now.getFullYear();adminCalMonth=now.getMonth();

// Sync badge
document.getElementById('fbSync').classList.add('online');
setTimeout(()=>document.getElementById('fbSync').style.display='none',4000);

// Helpers
function getCats(){return Object.values(categoriesMap).sort((a,b)=>(a.order||0)-(b.order||0));}
function getCatLabel(id){const c=categoriesMap[id];return c?c.icon+' '+c.label:id;}
function getCatIcon(id){const c=categoriesMap[id];return c?c.icon:'☕';}
function getMenuItems(){return Object.entries(menuItemsMap).map(([k,v])=>({...v,key:k}));}
function isAvail(name){return availability[name]!==false;}
function isDrink(cat){return DRINK_CATS.includes(cat);}
function formatPrice(item){if(item.priceM&&item.priceL)return'S ₱'+item.priceS+' · M ₱'+item.priceM+' · L ₱'+item.priceL;return'₱'+item.priceS;}

// ── SEED TABS FROM DEFAULTS IMMEDIATELY ──
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

// ── FIREBASE LISTENERS ──
subscriptionHub.subscribe('categories',snap=>{
  const saved=snap.val();
  if(saved){categoriesMap=saved;}
  else{const seed={};DEFAULT_CATS.forEach(c=>{seed[c.id]=c;});set(categoriesRef,seed);categoriesMap=seed;}
  rebuildTabs();
  renderMenuSection();
  renderOrderSection();
  if(adminLoggedIn){buildAvail();renderCategoryManager();}
});

subscriptionHub.subscribe('settings',snap=>{
  const s=snap.val()||{};
  if(s.adminPasswordHash) currentAdminHash=s.adminPasswordHash;
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

// ── NEW ORDER ALERTS (admin/staff) ──────────────────────────
function playChime(){
  try{
    if(!audioCtx)audioCtx=new(window.AudioContext||window.webkitAudioContext)();
    if(audioCtx.state==='suspended')audioCtx.resume();
    var t=audioCtx.currentTime;
    // Urgent two-tone alert: 6 alternating pulses, ~1.8s total
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
  var ob=document.getElementById('tabBtnOrders');if(ob)ob.click();
  var ad=document.getElementById('adminDash');if(ad)ad.scrollIntoView({behavior:'smooth'});
};
// ===== CUSTOMER 'ORDER READY' IN-APP ALERT (free; works while the app is open) =====
var _readyAlerted;try{_readyAlerted=new Set(JSON.parse(localStorage.getItem('accaza_ready_alerted')||'[]'));}catch(e){_readyAlerted=new Set();}
var _ordersSeeded=false,_readyTimer=null,_readyStop=null;
function _saveReadyAlerted(){try{localStorage.setItem('accaza_ready_alerted',JSON.stringify(Array.from(_readyAlerted)));}catch(e){}}
function stopReadyAlert(){if(_readyTimer){clearInterval(_readyTimer);_readyTimer=null;}if(_readyStop){clearTimeout(_readyStop);_readyStop=null;}}
window.dismissReadyAlert=function(){stopReadyAlert();var el=document.getElementById('orderReadyAlert');if(el)el.style.display='none';};
function playReadyChime(){
  try{
    if(!audioCtx)audioCtx=new(window.AudioContext||window.webkitAudioContext)();
    if(audioCtx.state==='suspended')audioCtx.resume();
    var t=audioCtx.currentTime;
    var notes=[523.25,659.25,783.99,1046.5]; // C5 E5 G5 C6 — cheerful ascending arpeggio
    notes.forEach(function(f,i){
      var o=audioCtx.createOscillator(),gn=audioCtx.createGain();
      o.type='triangle';o.frequency.value=f;
      var st=t+i*0.17;
      gn.gain.setValueAtTime(0.0001,st);
      gn.gain.exponentialRampToValueAtTime(0.6,st+0.02);
      gn.gain.setValueAtTime(0.6,st+0.13);
      gn.gain.exponentialRampToValueAtTime(0.0001,st+0.33);
      o.connect(gn);gn.connect(audioCtx.destination);
      o.start(st);o.stop(st+0.36);
    });
  }catch(e){}
}
function triggerReadyAlert(o){
  var el=document.getElementById('orderReadyAlert');if(!el)return;
  var sub=document.getElementById('orderReadySub');
  if(sub)sub.textContent='Order #'+(o.id||'')+' \u2014 '+((o.type==='Delivery')?'ready for delivery':'ready for pick-up');
  el.style.display='flex';
  try{playReadyChime();}catch(e){}
  stopReadyAlert();
  _readyTimer=setInterval(function(){try{playReadyChime();}catch(e){}try{if(navigator.vibrate)navigator.vibrate([500,200,500]);}catch(e){}},3800);
  try{if(navigator.vibrate)navigator.vibrate([500,200,500,200,500]);}catch(e){}
  _readyStop=setTimeout(stopReadyAlert,45000);
}
function checkMyReadyOrders(){
  try{
    myOrderIds.forEach(function(id){
      var o=adminOrdersMap[id];if(!o)return;
      if(o.status==='Completed'){
        if(!_ordersSeeded){_readyAlerted.add(id);}
        else if(!_readyAlerted.has(id)){_readyAlerted.add(id);_saveReadyAlerted();triggerReadyAlert(o);}
      }else if(_readyAlerted.has(id)){_readyAlerted.delete(id);_saveReadyAlerted();}
    });
    if(!_ordersSeeded){_ordersSeeded=true;_saveReadyAlerted();}
  }catch(e){}
}
(function(){var un=function(){try{if(!audioCtx)audioCtx=new(window.AudioContext||window.webkitAudioContext)();if(audioCtx.state==='suspended')audioCtx.resume();}catch(e){}document.removeEventListener('touchstart',un);document.removeEventListener('click',un);};document.addEventListener('touchstart',un,{passive:true});document.addEventListener('click',un);})();
subscriptionHub.subscribe('activeOrders',snap=>{
  var prevIds=knownOrderIds;
  var previousOrders=adminOrdersMap;
  adminOrdersMap=snap.val()||{};
  var ids=Object.keys(adminOrdersMap);
  if(prevIds&&(adminLoggedIn||staffLoggedIn)){
    var fresh=ids.filter(function(id){return prevIds.indexOf(id)===-1;}).map(function(id){return adminOrdersMap[id];}).filter(function(o){return o&&o.source!=='pos';});
    if(fresh.length)notifyNewOrders(fresh);
  }
  knownOrderIds=ids;
  if(adminLoggedIn||staffLoggedIn){var ot=document.getElementById('tab-orders'),dt=document.getElementById('tab-dashboard'),ct=document.getElementById('tab-appcustomers');if(ot&&ot.style.display!=='none')patchOrderCards(previousOrders,adminOrdersMap);if(dt&&dt.style.display!=='none')renderDashboard();if(ct&&ct.style.display!=='none')renderAppCustomers();}
  updateStats();renderCustomerOrders();checkMyReadyOrders();
});
subscriptionHub.subscribe('archivedOrders',snap=>{archivedOrdersMap=snap.val()||{};if(adminLoggedIn)renderDashboard();if(adminLoggedIn||staffLoggedIn)renderAppCustomers();var _ap=document.getElementById('archivePanel');if(_ap&&_ap.style.display!=='none'){try{renderArchive();}catch(e){}}});
subscriptionHub.subscribe('archivedReservations',snap=>{archivedResMap=snap.val()||{};if((adminLoggedIn||staffLoggedIn)&&resArchiveOpen)renderResArchive();});
subscriptionHub.subscribe('reservations',snap=>{adminResMap=snap.val()||{};if(adminLoggedIn||staffLoggedIn)renderReservations();updateStats();renderCustomerCalendar();if(adminLoggedIn||staffLoggedIn)renderAdminCalendar();});
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
  // Enabled flags → update admin toggles
  function setChk(id,val){var el=document.getElementById(id);if(el){el.checked=(val!==false);}}
  setChk('chkGcash',p.gcashEnabled!==false);
  setChk('chkBdo',p.bdoEnabled!==false);
  setChk('chkUb',p.ubEnabled!==false);
  setChk('chkMaya',p.mayaEnabled!==false);
  setChk('chkBank3',p.bank3Enabled!==false);
  setChk('chkBank4',p.bank4Enabled!==false);
  // Show/hide individual bank rows in customer panel
  var bdoRow=document.getElementById('bdoRow');
  var ubRow=document.getElementById('ubRow');
  if(bdoRow)bdoRow.style.display=p.bdoEnabled!==false?'block':'none';
  if(ubRow)ubRow.style.display=p.ubEnabled!==false?'block':'none';
  // QR codes
  var qrGcash=document.getElementById('qrGcash');
  var qrBdo=document.getElementById('qrBdo');
  var qrSection=document.getElementById('qrSection');
  if(qrGcash)qrGcash.style.display=p.gcashEnabled!==false?'block':'none';
  if(qrBdo)qrBdo.style.display=p.bdoEnabled!==false?'block':'none';
  // Hide whole QR box if both GCash and BDO are off
  if(qrSection)qrSection.style.display=(p.gcashEnabled!==false||p.bdoEnabled!==false)?'block':'none';
  ['Gcash','Bdo','Ub','Maya','Bank3','Bank4'].forEach(function(k){
    var note=document.getElementById('chk'+k+'Note');
    var chk=document.getElementById('chk'+k);
    if(note&&chk)note.style.display=chk.checked?'none':'block';
  });
  // GCash customer button
  var gcashBtn=document.getElementById('btnGcash');
  if(gcashBtn)gcashBtn.style.display=p.gcashEnabled!==false?'':'none';
  // Bank Transfer button (show if any bank enabled)
  var bankBtn=document.getElementById('btnBank');
  if(bankBtn)bankBtn.style.display=(p.bdoEnabled!==false||p.ubEnabled!==false||p.bank3Enabled!==false||p.bank4Enabled!==false)?'':'none';
  // Auto-select first visible payment method
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
  // PayMaya
  var mayaBtn=document.getElementById('btnMaya');
  if(p.mayaNum){document.getElementById('mayaNum').textContent=p.mayaNum;
    if(p.mayaName)document.getElementById('mayaName').textContent=p.mayaName;
    if(document.getElementById('editMayaNum'))document.getElementById('editMayaNum').value=p.mayaNum;
    if(document.getElementById('editMayaName'))document.getElementById('editMayaName').value=p.mayaName||'';
    if(mayaBtn)mayaBtn.style.display=(p.mayaEnabled!==false)?'':'';
  }else{if(mayaBtn)mayaBtn.style.display='none';}
  if(mayaBtn&&p.mayaNum)mayaBtn.style.display=(p.mayaEnabled!==false)?'':'none';
  // Extra Bank
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
  // Extra Bank 2
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
subscriptionHub.subscribe('calBlocks',snap=>{calBlocks=snap.val()||{};renderCustomerCalendar();if(adminLoggedIn)renderAdminCalendar();});

// ── WIRE BUTTONS VIA addEventListener (avoids ES module scope issues) ──
document.getElementById('btnAddCat').addEventListener('click',async function(){
  const iconEl=document.getElementById('newCatIcon');
  const labelEl=document.getElementById('newCatLabel');
  const icon=(iconEl.value||'').trim()||'🍽️';
  const label=(labelEl.value||'').trim();
  if(!label){alert('Please enter a category name.');return;}
  const id='cat_'+Date.now();
  try{
    await set(ref(db,'categories/'+id),{id,label,icon,order:Object.keys(categoriesMap).length});
    iconEl.value='';labelEl.value='';
    const c=document.getElementById('catAddConfirm');c.style.display='block';setTimeout(()=>c.style.display='none',2000);
  }catch(e){alert('Error: '+e.message);}
});

document.getElementById('btnAddItem').addEventListener('click',async function(){
  const name=document.getElementById('newItemName').value.trim();
  const cat=document.getElementById('newItemCat').value;
  const desc=document.getElementById('newItemDesc').value.trim();
  const img=document.getElementById('newItemImg').value.trim();
  const isFlat=document.getElementById('pricingTypeFlat')&&document.getElementById('pricingTypeFlat').checked;
  const isTwo=document.getElementById('pricingTypeTwo')&&document.getElementById('pricingTypeTwo').checked;
  const priceFlat=parseInt(document.getElementById('newItemPriceFlat').value)||0;
  const labelS=(document.getElementById('newItemLabelS').value||'').trim();
  const labelL=(document.getElementById('newItemLabelL').value||'').trim();
  const priceTwoS=parseInt(document.getElementById('newItemPriceTwoS').value)||0;
  const priceTwoL=parseInt(document.getElementById('newItemPriceTwoL').value)||0;
  const priceS=isFlat?priceFlat:isTwo?priceTwoS:(parseInt(document.getElementById('newItemPriceS').value)||0);
  const priceM=isTwo?0:isFlat?0:(parseInt(document.getElementById('newItemPriceM').value)||0);
  const priceL=isTwo?priceTwoL:isFlat?0:(parseInt(document.getElementById('newItemPriceL').value)||0);
  if(isTwo&&(!labelS||!labelL)){alert('Please enter both option labels.');return;}
  if(isTwo&&(!priceTwoS||!priceTwoL)){alert('Please enter both option prices.');return;}
  if(!name||!priceS){alert('Please enter item name and price.');return;}
  const catItems=getMenuItems().filter(i=>i.cat===cat);
  const newItem={cat,name,desc,priceS,order:catItems.length,optionsSet:true};
  var selOgs=[];document.querySelectorAll('#newItemOptions input[data-ogid]:checked').forEach(function(c){selOgs.push(c.dataset.ogid);});
  if(selOgs.length)newItem.options=selOgs;
  if(priceM)newItem.priceM=priceM;
  if(priceL)newItem.priceL=priceL;
  if(isTwo&&labelS)newItem.labelS=labelS;
  if(isTwo&&labelL)newItem.labelL=labelL;
  if(img)newItem.img=img;
  try{
    await set(ref(db,'menuItems/item_'+Date.now()),newItem);
    document.getElementById('newItemName').value='';document.getElementById('newItemDesc').value='';
    document.getElementById('newItemImg').value='';document.getElementById('newItemPriceS').value='';
    document.getElementById('newItemPriceM').value='';document.getElementById('newItemPriceL').value='';
    document.getElementById('newItemPriceFlat').value='';
    ['newItemPriceTwoS','newItemPriceTwoL','newItemLabelS','newItemLabelL'].forEach(function(id){var el=document.getElementById(id);if(el)el.value='';});
    document.querySelectorAll('#newItemOptions input[data-ogid]').forEach(function(c){c.checked=false;c.parentElement.style.background='#fff';});
    document.getElementById('pricingTypeSized').checked=true;setPricingType('sized');
    const c=document.getElementById('addItemConfirm');c.style.display='block';setTimeout(()=>c.style.display='none',2500);
  }catch(e){alert('Error: '+e.message);}
});

document.getElementById('btnAddToCart').addEventListener('click',function(){addCustomizedToCart();});

// ── MENU & ORDER RENDERING ──
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
  // Wire + buttons via event listeners
  el.querySelectorAll('.qty-btn[data-key]').forEach(function(btn){
    btn.addEventListener('click',function(){openCustomize(this.dataset.key);});
  });
}

// ── CUSTOMIZE POPUP ──
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
  // Wire option clicks via event delegation (onclick = no stacked listeners)
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

// ── CART ──
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
  // Wire cart qty buttons
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
  catch(e){alert('Could not load payment proof: '+((e&&e.message)||e));}
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

// ===================== APP CUSTOMER LOGIN + TRACKING =====================
let appCustomersMap={};
function isAppMode(){return document.documentElement.classList.contains('app-mode')||window.matchMedia('(display-mode: standalone)').matches||window.navigator.standalone===true;}
function getAppUser(){try{return JSON.parse(localStorage.getItem('accaza_app_user')||'null');}catch(e){return null;}}
function prefillAppUser(){var u=getAppUser();if(!u)return;var n=document.getElementById('custName'),p=document.getElementById('custPhone');if(n&&!n.value)n.value=u.name;if(p&&!p.value)p.value=u.phone;var ind=document.getElementById('appUserIndicator');if(ind){var nm=document.getElementById('appUserName');if(nm)nm.textContent=u.name;ind.style.display='block';}}
window.appLoginSubmit=async function(){
  var n=(document.getElementById('appLoginName').value||'').trim();
  var p=(document.getElementById('appLoginPhone').value||'').trim();
  var err=document.getElementById('appLoginErr');
  if(n.length<2){err.textContent='Please enter your full name.';err.style.display='block';return;}
  var digits=p.replace(/[^0-9]/g,'');
  if(digits.length<10){err.textContent='Please enter a valid phone number.';err.style.display='block';return;}
  err.style.display='none';
  var user={name:n,phone:p,since:Date.now()};
  try{localStorage.setItem('accaza_app_user',JSON.stringify(user));}catch(e){}
  try{var k=digits;var snap=await get(ref(db,'appCustomers/'+k));var cur=snap.val()||{};await update(ref(db,'appCustomers/'+k),{name:n,phone:p,orders:cur.orders||0,firstSeen:cur.firstSeen||Date.now(),lastSeen:Date.now()});}catch(e){}
  var ov=document.getElementById('appLoginOverlay');if(ov)ov.style.display='none';
  prefillAppUser();
  setupPush();
};
window.appLogout=function(){try{localStorage.removeItem('accaza_app_user');}catch(e){}location.reload();};
function appLoginInit(){if(!isAppMode())return;var ov=document.getElementById('appLoginOverlay');var u=getAppUser();if(!u){if(ov)ov.style.display='flex';}else{prefillAppUser();setupPush();refreshNotifyPrompt();}}
window.renderAppCustomers=function(){
  var body=document.getElementById('appCustBody');if(!body)return;
  var arr=Object.keys(appCustomersMap).map(function(k){var v=appCustomersMap[k]||{};return {name:v.name||'\u2014',phone:v.phone||k,orders:v.orders||0,firstSeen:v.firstSeen,lastOrder:v.lastOrder};});
  arr.sort(function(a,b){return (b.orders-a.orders)||((b.lastOrder||0)-(a.lastOrder||0));});
  var sum=document.getElementById('appCustSummary');var total=arr.reduce(function(s,c){return s+c.orders;},0);
  if(sum)sum.textContent=arr.length+' customers \u00b7 '+total+' app orders';
  function d(ts){if(!ts)return '\u2014';try{return new Date(ts).toLocaleDateString('en-PH',{year:'numeric',month:'short',day:'numeric'});}catch(e){return '\u2014';}}
  if(!arr.length){body.innerHTML='<tr><td colspan="6" style="padding:1rem;color:var(--tl);text-align:center;">No app customers yet.</td></tr>';return;}
  body.innerHTML=arr.map(function(c,i){return '<tr style="border-bottom:1px solid var(--cr);"><td style="padding:0.55rem;color:var(--tl);">'+(i+1)+'</td><td style="padding:0.55rem;font-weight:500;">'+escHtml(c.name)+'</td><td style="padding:0.55rem;">'+escHtml(c.phone)+'</td><td style="padding:0.55rem;text-align:center;font-weight:700;color:var(--bd);">'+c.orders+'</td><td style="padding:0.55rem;color:var(--tm);">'+d(c.firstSeen)+'</td><td style="padding:0.55rem;color:var(--tm);">'+d(c.lastOrder)+'</td></tr>';}).join('');
};
window.exportAppCustomers=function(){
  var arr=Object.keys(appCustomersMap).map(function(k){return appCustomersMap[k]||{};});
  arr.sort(function(a,b){return (b.orders||0)-(a.orders||0);});
  function d(ts){if(!ts)return '';try{return new Date(ts).toLocaleDateString('en-PH');}catch(e){return '';}}
  var rows=[['Name','Phone','App Orders','First Seen','Last Order']];
  arr.forEach(function(c){rows.push([c.name||'',c.phone||'',c.orders||0,d(c.firstSeen),d(c.lastOrder)]);});
  var csv=rows.map(function(r){return r.map(function(x){return '"'+String(x).replace(/"/g,'""')+'"';}).join(',');}).join(String.fromCharCode(10));
  var blob=new Blob([csv],{type:'text/csv'});var url=URL.createObjectURL(blob);var a=document.createElement('a');a.href=url;a.download='accaza-app-customers.csv';document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
};
var APP_PROMO_THRESHOLD=10;
function getPromoTarget(){var el=document.getElementById('appPromoTarget');var v=el?parseInt(el.value,10):NaN;if(!(v>=1)){try{v=parseInt(localStorage.getItem('accaza_promo_target'),10);}catch(e){}}if(!(v>=1))v=10;return v;}
window.savePromoTarget=function(){var v=getPromoTarget();try{localStorage.setItem('accaza_promo_target',String(v));}catch(e){}var el=document.getElementById('appPromoTarget');if(el)el.value=v;renderAppCustomers();};
function _acDigits(p){return String(p||'').replace(/[^0-9]/g,'');}
function _acRange(){var f=document.getElementById('appCustFrom'),t=document.getElementById('appCustTo'),fromTs=null,toTs=null;if(f&&f.value){var a=new Date(f.value+'T00:00:00');if(!isNaN(a.getTime()))fromTs=a.getTime();}if(t&&t.value){var b=new Date(t.value+'T23:59:59.999');if(!isNaN(b.getTime()))toTs=b.getTime();}return {fromTs:fromTs,toTs:toTs};}
function _acCounts(){var r=_acRange();var all={};try{Object.assign(all,archivedOrdersMap||{},adminOrdersMap||{});}catch(e){all=adminOrdersMap||{};}var counts={};Object.keys(all).forEach(function(id){var o=all[id];if(!o||!o.phone||o.status==='Rejected')return;var ts=o.timestamp||o.archivedAt||0;if(r.fromTs&&ts<r.fromTs)return;if(r.toTs&&ts>r.toTs)return;var k=_acDigits(o.phone);if(!k)return;if(!counts[k])counts[k]={count:0,last:0,name:o.name||''};counts[k].count++;if(ts>counts[k].last){counts[k].last=ts;counts[k].name=o.name||counts[k].name;}});return counts;}
window.clearAppCustFilter=function(){var f=document.getElementById('appCustFrom'),t=document.getElementById('appCustTo');if(f)f.value='';if(t)t.value='';renderAppCustomers();};
window.renderAppCustomers=function(){
  var body=document.getElementById('appCustBody');if(!body)return;
  APP_PROMO_THRESHOLD=getPromoTarget();var _pt=document.getElementById('appPromoTarget');if(_pt&&!_pt.value)_pt.value=APP_PROMO_THRESHOLD;
  var counts=_acCounts();
  var arr=Object.keys(appCustomersMap).map(function(k){var v=appCustomersMap[k]||{};var c=counts[k]||{count:0,last:0,name:''};return {name:(v.name||c.name||'—'),phone:v.phone||k,orders:c.count,last:c.last||v.lastOrder,firstSeen:v.firstSeen};});
  arr.sort(function(a,b){return (b.orders-a.orders)||((b.last||0)-(a.last||0));});
  var elig=arr.filter(function(c){return c.orders>=APP_PROMO_THRESHOLD;}).length;
  var total=arr.reduce(function(s,c){return s+c.orders;},0);
  var sum=document.getElementById('appCustSummary');
  if(sum)sum.textContent=arr.length+' customers · '+total+' orders · '+elig+' eligible (≥'+APP_PROMO_THRESHOLD+')';
  function d(ts){if(!ts)return '—';try{return new Date(ts).toLocaleDateString('en-PH',{year:'numeric',month:'short',day:'numeric'});}catch(e){return '—';}}
  if(!arr.length){body.innerHTML='<tr><td colspan="6" style="padding:1rem;color:var(--tl);text-align:center;">No app customers yet.</td></tr>';return;}
  body.innerHTML=arr.map(function(c,i){var e=c.orders>=APP_PROMO_THRESHOLD;return '<tr style="border-bottom:1px solid var(--cr);'+(e?'background:rgba(45,158,95,0.08);':'')+'"><td style="padding:0.55rem;color:var(--tl);">'+(i+1)+'</td><td style="padding:0.55rem;font-weight:500;">'+escHtml(c.name)+(e?' <span style="background:#2d9e5f;color:#fff;border-radius:999px;font-size:0.62rem;padding:0.1rem 0.45rem;white-space:nowrap;">🎁 Free coffee</span>':'')+'</td><td style="padding:0.55rem;">'+escHtml(c.phone)+'</td><td style="padding:0.55rem;text-align:center;font-weight:700;color:'+(e?'#2d9e5f':'var(--bd)')+';">'+c.orders+'</td><td style="padding:0.55rem;color:var(--tm);">'+d(c.firstSeen)+'</td><td style="padding:0.55rem;color:var(--tm);">'+d(c.last)+'</td></tr>';}).join('');
};
window.exportAppCustomers=function(){
  var counts=_acCounts();
  var arr=Object.keys(appCustomersMap).map(function(k){var v=appCustomersMap[k]||{};var c=counts[k]||{count:0,last:0};return {name:v.name||'',phone:v.phone||k,orders:c.count,firstSeen:v.firstSeen,last:c.last||v.lastOrder,eligible:(c.count>=APP_PROMO_THRESHOLD)?'YES':''};});
  arr.sort(function(a,b){return (b.orders||0)-(a.orders||0);});
  function d(ts){if(!ts)return '';try{return new Date(ts).toLocaleDateString('en-PH');}catch(e){return '';}}
  var rows=[['Name','Phone','Orders (in range)','Eligible (>='+APP_PROMO_THRESHOLD+')','First Seen','Last Order']];
  arr.forEach(function(c){rows.push([c.name,c.phone,c.orders,c.eligible,d(c.firstSeen),d(c.last)]);});
  var csv=rows.map(function(r){return r.map(function(x){return '"'+String(x).replace(/"/g,'""')+'"';}).join(',');}).join(String.fromCharCode(10));
  var blob=new Blob([csv],{type:'text/csv'});var url=URL.createObjectURL(blob);var a=document.createElement('a');a.href=url;a.download='accaza-app-customers.csv';document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
};
subscriptionHub.subscribe('appCustomers',function(snap){appCustomersMap=snap.val()||{};if(adminLoggedIn||staffLoggedIn)renderAppCustomers();});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',appLoginInit);else appLoginInit();
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
    myOrderIds.push(orderId);localStorage.setItem('accaza_my_orders',JSON.stringify(myOrderIds));
    document.getElementById('displayOrderId').textContent=orderId;document.getElementById('orderConfirm').style.display='block';
    document.querySelector('.btn-place-order').disabled=true;document.querySelector('.btn-place-order').style.opacity='0.5';
    cart={};updateCartDisplay();renderOrderSection();renderCustomerOrders();
    document.getElementById('custName').value='';document.getElementById('custPhone').value='';document.getElementById('custNotes').value='';
    removeProof({stopPropagation:function(){}});
    setTimeout(function(){var b=document.querySelector('.btn-place-order');b.disabled=false;b.style.opacity='1';b.textContent='Place Order';document.getElementById('orderConfirm').style.display='none';},5000);
  }catch(e){window._placingOrder=false;_btn.disabled=false;_btn.style.opacity='1';_btn.textContent='Place Order';alert('Could not place order: '+e.message);}
};
window.resetOrder=function(){if(!Object.keys(cart).length&&!document.getElementById('custName').value){alert('Your order is already empty!');return;}if(confirm('Reset your order?')){cart={};updateCartDisplay();renderOrderSection();document.getElementById('custName').value='';document.getElementById('custPhone').value='';document.getElementById('custNotes').value='';setType('pickup');(function(){var gBtn=document.getElementById('btnGcash');var mBtn=document.getElementById('btnMaya');var bBtn=document.getElementById('btnBank');var first=gBtn&&gBtn.style.display!=='none'?'gcash':mBtn&&mBtn.style.display!=='none'?'maya':'bank';setPayment(first);})();document.getElementById('orderConfirm').style.display='none';document.querySelector('.btn-place-order').disabled=false;document.querySelector('.btn-place-order').style.opacity='1';}};

// ── ORDER TRACKER ──
const statusConfig={Pending:{icon:'🟡',color:'#856404',bg:'#fef3cd',msg:'Your order has been received and is awaiting confirmation from our staff.'},Confirmed:{icon:'🔵',color:'#0c5460',bg:'#d1ecf1',msg:'Your order has been confirmed. We will start preparing it soon!'},Preparing:{icon:'🟠',color:'#664d03',bg:'#fff3cd',msg:'Your order is currently being prepared. ☕'},Completed:{icon:'🟢',color:'#155724',bg:'#d4edda',msg:'Your order is ready! Please confirm once you have received it below.'},Received:{icon:'✅',color:'#1b5e20',bg:'#c8e6c9',msg:'You have confirmed receipt. Thank you! ☕🐻'},Rejected:{icon:'🔴',color:'#721c24',bg:'#f8d7da',msg:'Unfortunately, we could not verify your payment in our account, so this order has been rejected. If you believe this is a mistake, please contact us at 0927 692 4831 with your payment reference.'}};
function renderCustomerOrders(){
  const myOrders=myOrderIds.map(id=>adminOrdersMap[id]).filter(Boolean);
  const active=myOrders.filter(o=>o.status!=='Received'&&!o.receivedByCustomer);
  const el=document.getElementById('activeOrdersList');
  if(!active.length){el.innerHTML='<div style="text-align:center;padding:3rem;color:var(--tl);"><p style="font-size:2.5rem;margin-bottom:0.75rem;">☕</p><p style="font-size:0.95rem;font-weight:500;color:var(--bd);margin-bottom:0.3rem;">No active orders yet</p><p style="font-size:0.85rem;">Place an order above and it will appear here!</p></div>';return;}
  el.innerHTML=active.map(function(o){const s=statusConfig[o.status]||statusConfig.Pending;const isDelivery=o.type==='Delivery';
    return'<div style="background:#fff;border:2px solid #a8d5b5;border-radius:12px;overflow:hidden;margin-bottom:1.25rem;">'
      +'<div style="background:var(--bd);padding:1rem 1.25rem;text-align:center;">'
      +'<p style="font-size:0.72rem;color:rgba(224,212,198,0.6);text-transform:uppercase;letter-spacing:0.15em;margin-bottom:0.25rem;">Order ID</p>'
      +'<p style="font-family:\'Playfair Display\',serif;font-size:1.8rem;color:#fff;font-weight:600;">'+escHtml(o.id)+'</p>'
      +'<p style="font-size:0.72rem;color:rgba(224,212,198,0.5);margin-top:0.25rem;">🛒 '+escHtml(o.items)+'</p>'
      +'<p style="font-size:0.75rem;color:#c9a36a;">💰 ₱'+(Number(o.total)||0).toLocaleString()+' · '+escHtml(o.payment)+'</p>'
      +'<p style="font-size:0.75rem;margin-top:0.3rem;padding:0.25rem 0.75rem;display:inline-block;border-radius:999px;background:'+(isDelivery?'rgba(13,110,253,0.2)':'rgba(45,158,95,0.2)')+';color:'+(isDelivery?'#90caf9':'#a5d6a7')+';">'+(isDelivery?'🛵 For Delivery':'🏠 For Pick-up')+'</p></div>'
      +'<div style="padding:1rem 1.25rem;background:'+s.bg+';"><p style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.15em;color:'+s.color+';margin-bottom:0.4rem;font-weight:600;">Order Status</p>'
      +'<div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.4rem;"><span style="font-size:1.3rem;">'+s.icon+'</span><span style="font-size:1rem;font-weight:700;color:'+s.color+';">'+escHtml(o.status)+'</span></div>'
      +'<p style="font-size:0.82rem;color:'+s.color+';line-height:1.5;">'+s.msg+'</p></div>'
      +'<div style="padding:1rem 1.25rem;background:#ece4d8;text-align:center;">'
      +(o.status==='Completed'?'<button data-orderid="'+escHtml(o.id)+'" class="confirm-recv-btn" style="background:#2d9e5f;color:#fff;border:none;border-radius:8px;padding:0.65rem 1.5rem;font-size:0.88rem;cursor:pointer;width:100%;">✅ Yes, I Received My Order</button>'
        :'<p style="font-size:0.82rem;color:var(--tl);">This button will be enabled once your order is marked <strong>Completed</strong>.</p><button disabled style="background:#ccc;color:#fff;border:none;border-radius:8px;padding:0.65rem 1.5rem;font-size:0.88rem;cursor:not-allowed;width:100%;margin-top:0.5rem;opacity:0.6;">Waiting for Completion...</button>')
      +'</div></div>';
  }).join('')+'<p style="font-size:0.72rem;color:var(--tl);text-align:center;margin-top:0.25rem;">🔥 Your order status updates automatically — no refresh needed!</p>';
  el.querySelectorAll('.confirm-recv-btn').forEach(function(btn){
    btn.addEventListener('click',function(){
      const oid=this.dataset.orderid;
      document.getElementById('receivedOrderId').textContent=oid;
      document.getElementById('confirmReceivedPopup').classList.add('show');
      document.getElementById('confirmReceivedBtn').onclick=function(){update(ref(db,'orders/'+oid),{receivedByCustomer:true,status:'Received'});document.getElementById('confirmReceivedPopup').classList.remove('show');};
    });
  });
}

// ── RESERVATIONS ──
function getConfirmedGuestsForDate(k){return Object.values(adminResMap).filter(r=>r.date===k&&(r.status==='Accepted'||r.status==='Confirmed')).reduce((s,r)=>s+(parseInt(r.guests)||0),0);}
function getConfirmedSlotsForDate(k){const s=new Set();Object.values(adminResMap).filter(r=>r.date===k&&(r.status==='Accepted'||r.status==='Confirmed')).forEach(r=>s.add(r.time));return s;}
function dateKey(y,m,d){return y+'-'+String(m+1).padStart(2,'0')+'-'+String(d).padStart(2,'0');}
function getDateStatus(y,m,d){const k=dateKey(y,m,d);const bl=calBlocks[k];if(bl&&bl.blocked)return'blocked';const g=getConfirmedGuestsForDate(k);if(g>=MAX_GUESTS)return'blocked';if(g>0)return'partial';if(bl&&bl.slots&&Object.values(bl.slots).some(v=>v===false))return'partial';return'open';}
function isSlotBlocked(k,slot){const b=calBlocks[k];if(b&&b.blocked)return true;if(b&&b.slots&&b.slots[slot]===false)return true;return false;}
function renderCustomerCalendar(){
  const title=new Date(calYear,calMonth).toLocaleDateString('en-PH',{month:'long',year:'numeric'});
  document.getElementById('calTitle').textContent=title;
  const today=new Date();today.setHours(0,0,0,0);
  const maxDate=new Date(today);maxDate.setMonth(maxDate.getMonth()+5);
  document.getElementById('calPrev').disabled=new Date(calYear,calMonth,1)<=new Date(today.getFullYear(),today.getMonth(),1);
  document.getElementById('calNext').disabled=new Date(calYear,calMonth,1)>=new Date(maxDate.getFullYear(),maxDate.getMonth(),1);
  const firstDay=new Date(calYear,calMonth,1).getDay(),daysInMonth=new Date(calYear,calMonth+1,0).getDate();
  let html=['Su','Mo','Tu','We','Th','Fr','Sa'].map(d=>'<div class="cal-day-label">'+d+'</div>').join('');
  for(let i=0;i<firstDay;i++)html+='<div class="cal-day empty"></div>';
  for(let d=1;d<=daysInMonth;d++){
    const date=new Date(calYear,calMonth,d);date.setHours(0,0,0,0);
    const isPast=date<today,isToday=date.getTime()===today.getTime();
    const status=getDateStatus(calYear,calMonth,d),k=dateKey(calYear,calMonth,d);
    let cls='cal-day';if(isPast)cls+=' past';else if(status==='blocked')cls+=' blocked';else if(status==='partial')cls+=' partial';else cls+=' open';
    if(isToday)cls+=' today';if(selectedDate===k)cls+=' selected';
    const clickable=!isPast&&status!=='blocked';
    html+='<div class="'+cls+'" '+(clickable?'data-y="'+calYear+'" data-m="'+calMonth+'" data-d="'+d+'"':'')+'>'+d+'</div>';
  }
  const grid=document.getElementById('calGrid');
  grid.innerHTML=html;
  grid.querySelectorAll('.cal-day[data-y]').forEach(function(el){
    el.addEventListener('click',function(){selectCalDate(parseInt(this.dataset.y),parseInt(this.dataset.m),parseInt(this.dataset.d));});
  });
}
window.calNavigate=function(dir){calMonth+=dir;if(calMonth>11){calMonth=0;calYear++;}if(calMonth<0){calMonth=11;calYear--;}renderCustomerCalendar();};
function selectCalDate(y,m,d){
  selectedDate=dateKey(y,m,d);selectedTime=null;renderCustomerCalendar();
  document.getElementById('timeSlotsWrap').style.display='block';
  document.getElementById('selectedDateLabel').textContent=new Date(y,m,d).toLocaleDateString('en-PH',{weekday:'long',month:'long',day:'numeric',year:'numeric'});
  renderTimeSlots();document.getElementById('resFormWrap').style.display='none';
  document.getElementById('timeSlotsWrap').scrollIntoView({behavior:'smooth',block:'nearest'});
}
function renderTimeSlots(){
  const confirmedSlots=getConfirmedSlotsForDate(selectedDate),dayFull=getConfirmedGuestsForDate(selectedDate)>=MAX_GUESTS;
  const fdBtn=document.getElementById('fullDaySlot');
  if(fdBtn){const fdSel=selectedTime==='Full Day Booking';fdBtn.style.background=fdSel?'rgba(45,158,95,0.5)':'rgba(45,158,95,0.15)';fdBtn.style.color=fdSel?'#fff':'#a5d6a7';fdBtn.style.borderColor=fdSel?'rgba(45,158,95,0.8)':'rgba(45,158,95,0.3)';}
  const grid=document.getElementById('timeSlotsGrid');
  grid.innerHTML=TIME_SLOTS.map(function(slot){
    const blocked=isSlotBlocked(selectedDate,slot)||dayFull,confirmed=confirmedSlots.has(slot),sel=selectedTime===slot;
    const cls='time-slot '+(sel?'selected':blocked?'blocked':'available');
    return'<div class="'+cls+'" '+(blocked?'':'data-slot="'+slot+'"')+'>'+slot+(confirmed&&!blocked?'<br/><span style="font-size:0.62rem;opacity:0.7;">booked</span>':'')+'</div>';
  }).join('');
  grid.querySelectorAll('.time-slot[data-slot]').forEach(function(el){el.addEventListener('click',function(){selectTimeSlot(this.dataset.slot);});});
}
document.getElementById('fullDaySlot').addEventListener('click',function(){selectTimeSlot('Full Day Booking');});
window.selectTimeSlot=function(slot){
  selectedTime=slot;renderTimeSlots();
  const fw=document.getElementById('resFormWrap');fw.style.display='block';
  const label=new Date(selectedDate+'T00:00:00').toLocaleDateString('en-PH',{weekday:'short',month:'short',day:'numeric',year:'numeric'});
  document.getElementById('resSummaryDateTime').textContent=label+' · '+slot;
  updateBookingType();fw.scrollIntoView({behavior:'smooth',block:'nearest'});
};
window.resetResSelection=function(){selectedTime=null;document.getElementById('resFormWrap').style.display='none';};
window.updateBookingType=function(){
  const guests=parseInt(document.getElementById('resGuests').value)||1,infoEl=document.getElementById('bookingTypeInfo');
  let type,color,bg,icon,msg,reqAdvance=false;
  if(guests<=2){type='Individual / Couple';icon='💑';color='#155724';bg='#d4edda';msg='Same-day booking accepted. Our staff will contact you to confirm.';}
  else if(guests<=5){type='Small Group';icon='👨‍👩‍👧';color='#664d03';bg='#fff3cd';msg='Same-day booking. Deposit details will be discussed upon staff confirmation.';}
  else if(guests<=20){type='Medium Group';icon='👥';color='#0c5460';bg='#d1ecf1';msg='At least 7 days advance booking required.';reqAdvance=true;}
  else{type='Large Group';icon='🎉';color='#721c24';bg='#fde8e8';msg='At least 7 days advance booking required. Admin callback required.';reqAdvance=true;}
  infoEl.innerHTML='<div style="background:'+bg+';border-radius:8px;padding:0.75rem 1rem;display:flex;align-items:flex-start;gap:0.6rem;"><span style="font-size:1.2rem;">'+icon+'</span><div><p style="font-size:0.82rem;font-weight:600;color:'+color+';">'+type+'</p><p style="font-size:0.78rem;color:'+color+';line-height:1.5;margin-top:0.2rem;">'+msg+'</p></div></div>';
  if(reqAdvance&&selectedDate){const today=new Date();today.setHours(0,0,0,0);const bd=new Date(selectedDate+'T00:00:00');if(Math.ceil((bd-today)/(1000*60*60*24))<7)infoEl.innerHTML+='<div style="background:#fde8e8;border:1px solid #f5c6c6;border-radius:6px;padding:0.75rem;margin-top:0.5rem;"><p style="font-size:0.78rem;color:#721c24;line-height:1.6;">⚠️ This booking requires at least 7 days advance notice. Please select a later date, or call us at <strong>0927 692 4831</strong>.</p></div>';}
};
window.setResContact=function(type){resContactMethod=type;['Wa','Vb','Sms','Call','Email'].forEach(function(_,i){const ids=['resBtnWa','resBtnVb','resBtnSms','resBtnCall','resBtnEmail'],types=['whatsapp','viber','sms','call','email'];const el=document.getElementById(ids[i]);if(el)el.classList.toggle('active',types[i]===type);});const ph={whatsapp:'Enter your WhatsApp number',viber:'Enter your Viber number',sms:'Enter your phone number for SMS',call:'Enter your phone number',email:'Enter your email address'};document.getElementById('resContact').placeholder=ph[type]||'Enter your contact';};
window.submitReservation=async function(){
  if(window._placingRes)return;
  const name=document.getElementById('resName').value.trim(),phone=document.getElementById('resPhone').value.trim();
  if(!selectedDate||!selectedTime){alert('Please select a date and time.');return;}
  if(!name||!phone){alert('Please enter your name and phone number.');return;}
  const guests=parseInt(document.getElementById('resGuests').value)||1;
  if(guests>=6){const today=new Date();today.setHours(0,0,0,0);const diff=Math.ceil((new Date(selectedDate+'T00:00:00')-today)/(1000*60*60*24));if(diff<7&&!confirm('This booking typically requires 7 days advance notice. Proceed anyway?'))return;}
  const id='RES-'+String(Object.keys(adminResMap).length+1).padStart(3,'0');
  window._placingRes=true;
  const _rbtn=document.querySelector('.btn-reserve');_rbtn.disabled=true;_rbtn.style.opacity='0.5';_rbtn.textContent='⏳ Submitting…';
  try{
    await set(ref(db,'reservations/'+id),{id,name,phone,date:selectedDate,time:selectedTime,guests:document.getElementById('resGuests').value,occasion:document.getElementById('resOccasion').value,notes:document.getElementById('resNotes').value.trim(),contact:document.getElementById('resContact').value.trim(),contactMethod:resContactMethod,status:'Pending',timestamp:Date.now()});
    window._placingRes=false;_rbtn.textContent='✅ Request Sent!';
    document.getElementById('resConfirm').style.display='block';
    setTimeout(function(){document.getElementById('resConfirm').style.display='none';var rb=document.querySelector('.btn-reserve');rb.disabled=false;rb.style.opacity='1';rb.textContent='Submit Reservation Request';document.getElementById('resName').value='';document.getElementById('resPhone').value='';document.getElementById('resNotes').value='';document.getElementById('resContact').value='';selectedDate=null;selectedTime=null;document.getElementById('resFormWrap').style.display='none';document.getElementById('timeSlotsWrap').style.display='none';renderCustomerCalendar();},5000);
  }catch(e){window._placingRes=false;_rbtn.disabled=false;_rbtn.style.opacity='1';_rbtn.textContent='Submit Reservation Request';alert('Could not submit: '+e.message);}
};

// ── ADMIN CALENDAR ──
function renderAdminCalendar(){
  const title=new Date(adminCalYear,adminCalMonth).toLocaleDateString('en-PH',{month:'long',year:'numeric'});
  document.getElementById('adminCalTitle').textContent=title;
  const today=new Date();today.setHours(0,0,0,0);
  const firstDay=new Date(adminCalYear,adminCalMonth,1).getDay(),daysInMonth=new Date(adminCalYear,adminCalMonth+1,0).getDate();
  let html=['Su','Mo','Tu','We','Th','Fr','Sa'].map(d=>'<div style="text-align:center;font-size:0.68rem;color:var(--tl);padding:0.3rem 0;text-transform:uppercase;">'+d+'</div>').join('');
  for(let i=0;i<firstDay;i++)html+='<div class="admin-cal-day empty"></div>';
  for(let d=1;d<=daysInMonth;d++){
    const date=new Date(adminCalYear,adminCalMonth,d);date.setHours(0,0,0,0);
    const isPast=date<today,isToday=date.getTime()===today.getTime();
    const k=dateKey(adminCalYear,adminCalMonth,d),status=getDateStatus(adminCalYear,adminCalMonth,d);
    let cls='admin-cal-day';if(isPast)cls+=' past';else if(status==='blocked')cls+=' blocked';else if(status==='partial')cls+=' partial';else cls+=' open';
    if(isToday)cls+=' today';if(adminSelectedDate===k)cls+=' selected';
    html+='<div class="'+cls+'" data-k="'+k+'">'+d+'</div>';
  }
  const grid=document.getElementById('adminCalGrid');grid.innerHTML=html;
  grid.querySelectorAll('.admin-cal-day[data-k]').forEach(function(el){el.addEventListener('click',function(){adminSelectDate(this.dataset.k);});});
}
window.adminCalNavigate=function(dir){adminCalMonth+=dir;if(adminCalMonth>11){adminCalMonth=0;adminCalYear++;}if(adminCalMonth<0){adminCalMonth=11;adminCalYear--;}renderAdminCalendar();};
function adminSelectDate(k){
  adminSelectedDate=k;renderAdminCalendar();
  document.getElementById('adminSlotManager').style.display='block';
  const parts=k.split('-');
  document.getElementById('adminSlotTitle').textContent=new Date(parseInt(parts[0]),parseInt(parts[1])-1,parseInt(parts[2])).toLocaleDateString('en-PH',{weekday:'short',month:'short',day:'numeric',year:'numeric'});
  renderAdminSlots(k);
}
function renderAdminSlots(k){
  const grid=document.getElementById('adminSlotGrid');const confirmedSlots=getConfirmedSlotsForDate(k);
  grid.innerHTML=TIME_SLOTS.map(function(slot){
    if(confirmedSlots.has(slot))return'<div class="slot-item booked">📅 '+slot+'</div>';
    if(isSlotBlocked(k,slot)&&!confirmedSlots.has(slot))return'<div class="slot-item blocked" data-k="'+k+'" data-slot="'+slot+'" data-blocked="1">❌ '+slot+'</div>';
    return'<div class="slot-item open" data-k="'+k+'" data-slot="'+slot+'" data-blocked="0">✅ '+slot+'</div>';
  }).join('');
  grid.querySelectorAll('.slot-item[data-slot]').forEach(function(el){
    el.addEventListener('click',async function(){
      const dk=this.dataset.k,slot=this.dataset.slot,isBlocked=this.dataset.blocked==='1';
      if(isBlocked){const snap=await get(ref(db,'calBlocks/'+dk+'/slots/'+slot));if(snap.exists())await remove(ref(db,'calBlocks/'+dk+'/slots/'+slot));const all=await get(ref(db,'calBlocks/'+dk+'/slots'));if(!all.exists())await remove(ref(db,'calBlocks/'+dk));}
      else{await update(ref(db,'calBlocks/'+dk+'/slots'),{[slot]:false});}
      setTimeout(function(){renderAdminSlots(dk);},400);
    });
  });
}
window.blockAllSlots=async function(){if(!adminSelectedDate)return;await set(ref(db,'calBlocks/'+adminSelectedDate),{blocked:true});setTimeout(function(){renderAdminSlots(adminSelectedDate);},400);};
window.openAllSlots=async function(){if(!adminSelectedDate)return;await remove(ref(db,'calBlocks/'+adminSelectedDate));setTimeout(function(){renderAdminSlots(adminSelectedDate);},400);};

// ── FEEDBACK ──
window.submitContact=function(){if(!document.getElementById('conName').value.trim()||!document.getElementById('conMessage').value.trim()){alert('Please fill in name and message.');return;}document.getElementById('conConfirm').style.display='block';};
window.updateFbCounter=function(){const len=document.getElementById('fbMessage').value.length;const c=document.getElementById('fbCounter');c.textContent=len+' / 800';c.style.color=len>=720?'#ff8080':len>=560?'#f39c12':'rgba(224,212,198,0.5)';};
window.submitFeedback=async function(){
  const name=document.getElementById('fbName').value.trim(),message=document.getElementById('fbMessage').value.trim(),type=document.getElementById('fbType').value;
  if(!name||!message){alert('Please enter your name and message.');return;}
  try{await push(feedbacksRef,{name,contact:document.getElementById('fbContact').value.trim(),type,message,status:'Unread',date:new Date().toLocaleDateString('en-PH',{year:'numeric',month:'long',day:'numeric'}),timestamp:Date.now()});
  document.getElementById('fbName').value='';document.getElementById('fbContact').value='';document.getElementById('fbMessage').value='';document.getElementById('fbCounter').textContent='0 / 800';
  const msgs={Complaint:'🙏 Thank you for letting us know. We sincerely apologize and will look into this right away.',Suggestion:'💡 Thank you for your suggestion!',Compliment:"❤️ Oh, this made our day! Thank you so much. ☕🐻",Other:'💛 Thank you for reaching out!'};
  document.getElementById('fbConfirmMsg').textContent=msgs[type]||msgs.Other;document.getElementById('fbConfirm').style.display='block';setTimeout(function(){document.getElementById('fbConfirm').style.display='none';},6000);}catch(e){alert('Error: '+e.message);}
};

// ── ADMIN FUNCTIONS ──
function updateStats(){const orders=Object.values(adminOrdersMap),active=orders.filter(o=>o.status!=='Received');document.getElementById('statOrders').textContent=active.length;document.getElementById('statPending').textContent=active.filter(o=>o.status==='Pending').length;document.getElementById('statReservations').textContent=Object.keys(adminResMap).length;document.getElementById('statRevenue').textContent='₱'+active.filter(o=>o.status!=='Rejected').reduce((s,o)=>s+(o.total||0),0).toLocaleString();}

window.__markOrderCompleted=function(oid){update(ref(db,'orders/'+oid),{status:'Completed'});};
function orderStatusCtl(o){
  var oid=escHtml(o.id);
  if(o.voided)return '<span style="font-size:0.8rem;color:#c0392b;font-weight:600;">\uD83D\uDEAB Voided</span>';
  if(o.status==='Completed'||o.status==='Received'){
    var lbl=(o.status==='Received'?'\u2705 Received':'\u2705 Completed')+(Number(o.refundAmount)>0?' \u00b7 \u21a9 \u20b1'+(Number(o.refundAmount)||0).toLocaleString()+' refunded':'')+' \uD83D\uDD12';
    var _nonCash=(o.payments&&o.payments.length)?o.payments.some(function(p){return p.method&&p.method!=='Cash';}):(o.payment&&o.payment!=='Cash'&&o.payment!=='Split');
    var _payv='';
    if(o.paymentStatus==='pending'){ _payv='<button data-verify="'+oid+'" style="background:#fff8e1;border:1px solid #ffe0a3;border-radius:4px;padding:0.3rem 0.7rem;font-size:0.75rem;color:#8a6d1b;cursor:pointer;font-weight:600;">\u23F3 Verify payment</button>'; }
    else if(o.paymentStatus==='confirmed'&&_nonCash){ _payv='<span style="font-size:0.75rem;color:#155724;font-weight:600;">\u2705 Payment verified</span>'; }
    return '<span style="font-size:0.8rem;color:#155724;font-weight:600;">'+lbl+'</span>'+_payv
      +'<button data-refund="'+oid+'" style="background:#fff3e0;border:1px solid #ffcc80;border-radius:4px;padding:0.3rem 0.7rem;font-size:0.75rem;color:#e65100;cursor:pointer;font-weight:600;">\u21a9 Refund</button>'
      +'<button data-void="'+oid+'" style="background:#fdecea;border:1px solid #f5c6c6;border-radius:4px;padding:0.3rem 0.7rem;font-size:0.75rem;color:#c0392b;cursor:pointer;font-weight:600;">\uD83D\uDEAB Void</button>';
  }
  return '<select class="status-select" data-orderid="'+oid+'"><option'+(o.status==='Pending'?' selected':'')+'>Pending</option><option'+(o.status==='Confirmed'?' selected':'')+'>Confirmed</option><option'+(o.status==='Preparing'?' selected':'')+'>Preparing</option><option value="Ready"'+(o.status==='Ready'?' selected':'')+'>'+(o.type==='Delivery'?'Ready for Delivery':'Ready for Pickup')+'</option><option'+(o.status==='Rejected'?' selected':'')+' style="color:#c0392b;">Rejected</option></select>'+'<button data-complete="'+oid+'" style="background:#d4edda;border:1px solid #a8d5b5;border-radius:4px;padding:0.3rem 0.7rem;font-size:0.75rem;color:#155724;cursor:pointer;font-weight:600;">\u2705 Mark Completed</button>';
}
function orderCardHtml(o){
    const isDelivery=o.type==='Delivery',isReceived=o.status==='Received',canArchive=o.status==='Completed'||o.status==='Received'||o.status==='Rejected';
    const modeBadge=isDelivery?'<span class="badge" style="background:#d1ecf1;color:#0c5460;">🛵 Delivery</span>':'<span class="badge" style="background:#d4edda;color:#155724;">🏠 Pick-up</span>';
    const oid=escHtml(o.id),status=escHtml(o.status||'Pending'),statusClass=String(o.status||'pending').toLowerCase().replace(/[^a-z0-9_-]/g,'-'),proof=safeImageSrc(o.proof),storedProof=typeof o.proofPath==='string'&&o.proofPath.indexOf('payment-proofs/')===0;
    return'<div class="order-admin-card" data-order-card="'+oid+'" style="'+(isReceived?'opacity:0.75;':'')+'"><div class="order-admin-top"><div><div class="order-admin-name">'+escHtml(o.name)+' <span style="font-size:0.75rem;color:var(--tl);">#'+oid+'</span></div><div class="order-admin-meta">'+escHtml(o.phone)+(o.contact?' · '+escHtml(o.contact):'')+' · '+escHtml(o.date)+' '+escHtml(o.time)+((o.onDuty||o.staff)?' · On Duty: '+escHtml(o.onDuty||o.staff):'')+'</div></div><div style="display:flex;flex-direction:column;align-items:flex-end;gap:0.4rem;"><span class="badge badge-'+statusClass+'">'+status+'</span>'+modeBadge+(o.receivedByCustomer?'<span class="badge" style="background:#c8e6c9;color:#1b5e20;">✅ Customer Confirmed</span>':'')+'</div></div>'
      +'<div class="order-admin-items">🛒 '+escHtml(o.items)+'</div>'
      +(o.address?'<div style="font-size:0.78rem;color:var(--tl);margin:0.2rem 0;">📍 '+escHtml(o.address)+'</div>':'')
      +(o.notes?'<div style="font-size:0.78rem;color:var(--tl);margin:0.2rem 0;">📝 '+escHtml(o.notes)+'</div>':'')
      +(proof?'<div style="margin:0.5rem 0;"><p style="font-size:0.75rem;color:var(--tl);margin-bottom:0.3rem;">📎 Proof:</p><img src="'+proof+'" style="max-width:200px;max-height:120px;border-radius:6px;border:1px solid var(--cd);cursor:pointer;" onclick="showProof(this.src)"/></div>':storedProof?'<div style="margin:0.5rem 0;"><button data-prooforder="'+oid+'" style="background:#eef7f1;border:1px solid #9ac8aa;border-radius:6px;padding:0.42rem 0.8rem;color:#23623a;cursor:pointer;font-size:0.76rem;font-weight:600;">📎 View payment proof</button> <span style="font-size:0.7rem;color:var(--tl);">Loads only when opened</span></div>':'<p style="font-size:0.75rem;color:#c0392b;margin:0.3rem 0;">⚠️ No valid proof of payment</p>')
      +'<div class="order-admin-footer"><span class="order-total-tag">₱'+(Number(o.total)||0).toLocaleString()+' · '+escHtml(o.payment)+'</span><div style="display:flex;align-items:center;gap:0.5rem;">'
      +orderStatusCtl(o)
      +(canArchive?'<button data-archive="'+oid+'" style="background:#e2e3e5;border:1px solid #bbb;border-radius:4px;padding:0.3rem 0.7rem;font-size:0.75rem;color:#41464b;cursor:pointer;">📦 Archive</button>':'')+(o.status!=='Received'?'<button data-notify="'+oid+'" style="background:#e7f5ec;border:1px solid #8fd0a8;border-radius:4px;padding:0.3rem 0.7rem;font-size:0.75rem;color:#1b7a43;cursor:pointer;font-weight:600;">🔔 Notify</button>':'')+'<button data-printorder="'+oid+'" style="background:#fff3e0;border:1px solid #ffcc80;border-radius:4px;padding:0.3rem 0.7rem;font-size:0.75rem;color:#e65100;cursor:pointer;font-weight:600;">🖨️ Print</button>'
      +'</div></div></div>';
}
function wireOrderActions(el){
  el.querySelectorAll('.status-select[data-orderid]').forEach(function(sel){sel.addEventListener('change',function(){update(ref(db,'orders/'+this.dataset.orderid),{status:this.value});});});
  el.querySelectorAll('button[data-complete]').forEach(function(b){b.addEventListener('click',function(){if(confirm('Mark this order COMPLETED? This finalizes the sale, deducts stock, and locks the order.'))window.__markOrderCompleted(this.dataset.complete);});});
  el.querySelectorAll('button[data-verify]').forEach(function(b){b.addEventListener('click',function(){if(window.__posVerify)window.__posVerify(this.dataset.verify);});});
  el.querySelectorAll('button[data-refund]').forEach(function(b){b.addEventListener('click',function(){if(window.__posRefund)window.__posRefund(this.dataset.refund);});});
  el.querySelectorAll('button[data-void]').forEach(function(b){b.addEventListener('click',function(){if(window.__posVoid)window.__posVoid(this.dataset.void);});});
  el.querySelectorAll('button[data-printorder]').forEach(function(b){b.addEventListener('click',function(){printOrder(this.dataset.printorder);});});
  el.querySelectorAll('button[data-prooforder]').forEach(function(b){b.addEventListener('click',function(){window.showStoredProof(this.dataset.prooforder,this);});});
  el.querySelectorAll('button[data-notify]').forEach(function(b){b.addEventListener('click',function(){notifyCustomer(this.dataset.notify);});});
  el.querySelectorAll('button[data-archive]').forEach(function(btn){btn.addEventListener('click',function(){const oid=this.dataset.archive,o=adminOrdersMap[oid];if(!o)return;showDeletePopup('Archive order from '+o.name,async function(){var writes={};writes['archivedOrders/'+oid]={...o,status:'Archived',prevStatus:o.status,archivedAt:Date.now(),archivedDate:new Date().toLocaleDateString('en-PH',{year:'numeric',month:'long',day:'numeric'})};writes['orders/'+oid]=null;writes['activeOrders/'+oid]=null;await update(ref(db),writes);});});});
}
function renderOrders(){
  const el=document.getElementById('ordersList'),orders=Object.values(adminOrdersMap).sort((a,b)=>(b.timestamp||0)-(a.timestamp||0));
  if(!orders.length){el.innerHTML='<div class="empty-state">No active orders yet.</div>';return;}
  el.innerHTML=orders.map(orderCardHtml).join('');wireOrderActions(el);
}
function patchOrderCards(previous,current){
  var el=document.getElementById('ordersList');if(!el)return;
  var before=previous||{},after=current||{},ids=Array.from(new Set(Object.keys(before).concat(Object.keys(after)))),changed=ids.filter(function(id){return JSON.stringify(before[id]||null)!==JSON.stringify(after[id]||null);});
  if(changed.length!==1||!before[changed[0]]||!after[changed[0]]){renderOrders();return;}
  var id=changed[0],old=null;el.querySelectorAll('[data-order-card]').forEach(function(card){if(card.getAttribute('data-order-card')===id)old=card;});if(!old){renderOrders();return;}
  var holder=document.createElement('div');holder.innerHTML=orderCardHtml(after[id]);var fresh=holder.firstElementChild;if(!fresh){renderOrders();return;}old.replaceWith(fresh);wireOrderActions(fresh);
}

function renderReservations(){
  const el=document.getElementById('resList'),reservations=Object.values(adminResMap).sort((a,b)=>(b.timestamp||0)-(a.timestamp||0));
  const todayStr=new Date().toISOString().slice(0,10);
  const todayRes=reservations.filter(r=>r.date===todayStr&&r.status!=='Declined'&&r.status!=='Completed');
  const banner=document.getElementById('todayResBanner');
  if(banner){if(todayRes.length>0){banner.style.display='flex';document.getElementById('todayResText').textContent='⚠️ '+todayRes.length+' reservation'+(todayRes.length>1?'s':'')+' today!';}else{banner.style.display='none';}}
  if(!reservations.length){el.innerHTML='<div class="empty-state">No reservations yet.</div>';return;}
  el.innerHTML=reservations.map(function(r){
    const guests=Math.max(1,Math.min(50,parseInt(r.guests)||1)),bookType=guests<=2?'💑 Individual':guests<=5?'👨‍👩‍👧 Small':guests<=20?'👥 Medium':'🎉 Large';
    const isFullDay=r.time==='Full Day Booking';
    const rawStatus=r.status==='Confirmed'?'Accepted':r.status,st=['Pending','Accepted','Declined','Completed'].indexOf(rawStatus)>=0?rawStatus:'Pending',rid=escHtml(r.id);
    return'<div class="order-admin-card"><div class="order-admin-top"><div><div class="order-admin-name">'+escHtml(r.name)+' <span style="font-size:0.75rem;color:var(--tl);">#'+rid+'</span>'+(isFullDay?'<span class="badge" style="background:#fff3cd;color:#664d03;margin-left:0.4rem;">📅 Full Day</span>':'')+'</div><div class="order-admin-meta">'+escHtml(r.phone)+' · '+escHtml(r.date)+' · '+escHtml(r.time)+' · '+guests+' guests'+(r.occasion?' · '+escHtml(r.occasion):'')+'</div></div><div style="display:flex;flex-direction:column;align-items:flex-end;gap:0.4rem;"><span class="badge badge-'+st.toLowerCase()+'">'+st+'</span><span style="font-size:0.7rem;color:var(--tl);">'+bookType+'</span></div></div>'
      +(r.notes?'<div class="order-admin-items">📝 '+escHtml(r.notes)+'</div>':'')
      +(r.contact?'<div style="font-size:0.78rem;color:var(--tl);margin:0.2rem 0;">📱 '+escHtml(r.contact)+' · prefers <strong>'+escHtml(r.contactMethod||'phone')+'</strong></div>':'')
      +(st==='Accepted'?'<div style="margin:0.6rem 0;padding:0.6rem 0.75rem;background:#f0faf4;border:1px solid #a8d5b5;border-radius:8px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem;"><p style="font-size:0.75rem;font-weight:600;color:#2d6a4f;">📨 Contact the customer to confirm booking details</p><button data-contactres="'+rid+'" style="background:#2d9e5f;color:#fff;border:none;border-radius:6px;padding:0.35rem 0.85rem;font-size:0.75rem;cursor:pointer;">📨 Contact Options</button></div>':'')
      +'<div class="order-admin-footer"><span></span><div style="display:flex;gap:0.5rem;"><select class="status-select" data-resid="'+rid+'"><option'+(st==='Pending'?' selected':'')+'>Pending</option><option'+(st==='Accepted'?' selected':'')+'>Accepted</option><option'+(st==='Declined'?' selected':'')+'>Declined</option><option'+(st==='Completed'?' selected':'')+'>Completed</option></select>'+(st==='Completed'||st==='Declined'?'<button data-resid="'+rid+'" class="arch-res-btn" style="background:#e2e3e5;border:1px solid #bbb;border-radius:4px;padding:0.3rem 0.7rem;font-size:0.75rem;color:#41464b;cursor:pointer;">📦 Archive</button>':'')+'</div></div></div>';
  }).join('');
  el.querySelectorAll('.status-select[data-resid]').forEach(function(sel){
    sel.addEventListener('change',async function(){
      const id=this.dataset.resid,val=this.value;
      await update(ref(db,'reservations/'+id),{status:val});
      const r=adminResMap[id];
      if(r&&r.date&&r.time==='Full Day Booking'){
        if(val==='Accepted'){const slots={};TIME_SLOTS.forEach(s=>slots[s]=false);await update(ref(db,'calBlocks/'+r.date),{slots,fullDayReservationId:id});}
        if(val==='Completed'||val==='Declined'){const snap=await get(ref(db,'calBlocks/'+r.date));const data=snap.val();if(data&&data.fullDayReservationId===id)await remove(ref(db,'calBlocks/'+r.date));}
      }
      if(val==='Accepted')openResContactPopup(id);
    });
  });
  el.querySelectorAll('button[data-contactres]').forEach(function(btn){btn.addEventListener('click',function(){openResContactPopup(this.dataset.contactres);});});
  el.querySelectorAll('.arch-res-btn').forEach(function(btn){btn.addEventListener('click',function(){const id=this.dataset.resid,r=adminResMap[id];if(!r)return;showDeletePopup('Archive reservation for '+r.name,async function(){const pst=r.status==='Confirmed'?'Accepted':r.status;await set(ref(db,'archivedReservations/'+id),{...r,status:'Archived',prevStatus:pst,archivedAt:Date.now(),archivedDate:new Date().toLocaleDateString('en-PH',{year:'numeric',month:'long',day:'numeric'})});await remove(ref(db,'reservations/'+id));});});});
}

// ── AVAILABILITY & CATEGORY MANAGER ──
function renderCategoryManager(){
  const el=document.getElementById('categoryList');if(!el)return;
  const cats=getCats();
  if(!cats.length){el.innerHTML='<p style="color:var(--tl);font-size:0.85rem;">No categories yet.</p>';return;}
  el.innerHTML=cats.map(function(c){
    return'<div style="display:flex;align-items:center;gap:0.6rem;background:var(--cr);border:1px solid var(--cd);border-radius:8px;padding:0.6rem 0.85rem;" draggable="true" data-catid="'+c.id+'">'
      +'<span style="cursor:grab;color:var(--tl);font-size:1rem;user-select:none;">⠿</span>'
      +'<input type="text" id="catIcon_'+c.id+'" value="'+(c.icon||'☕')+'" style="width:50px;font-size:0.9rem;text-align:center;padding:0.3rem;border:1px solid var(--cd);border-radius:4px;background:#fff;font-family:\'Inter\',sans-serif;"/>'
      +'<input type="text" id="catLabel_'+c.id+'" value="'+(c.label||'')+'" style="flex:1;font-size:0.85rem;padding:0.3rem 0.5rem;border:1px solid var(--cd);border-radius:4px;background:#fff;font-family:\'Inter\',sans-serif;"/>'
      +'<button data-savecatid="'+c.id+'" style="background:#d4edda;border:1px solid #a8d5b5;border-radius:4px;padding:0.25rem 0.6rem;font-size:0.72rem;color:#155724;cursor:pointer;font-family:\'Inter\',sans-serif;white-space:nowrap;">💾 Save</button>'
      +'<button data-delcatid="'+c.id+'" style="background:#fde8e8;border:1px solid #f5c6c6;border-radius:4px;padding:0.25rem 0.6rem;font-size:0.72rem;color:#721c24;cursor:pointer;font-family:\'Inter\',sans-serif;">🗑️</button>'
      +'</div>';
  }).join('');
  // Wire save/delete
  el.querySelectorAll('button[data-savecatid]').forEach(function(btn){
    btn.addEventListener('click',async function(){
      const id=this.dataset.savecatid;
      const icon=document.getElementById('catIcon_'+id).value.trim()||'☕';
      const label=document.getElementById('catLabel_'+id).value.trim();
      if(!label)return;
      await update(ref(db,'categories/'+id),{icon,label});
    });
  });
  el.querySelectorAll('button[data-delcatid]').forEach(function(btn){
    btn.addEventListener('click',function(){
      const id=this.dataset.delcatid;
      const items=getMenuItems().filter(i=>i.cat===id);
      if(items.length>0){alert('Cannot delete — this category has '+items.length+' item(s). Remove the items first.');return;}
      showDeletePopup(categoriesMap[id]?.label||id,async function(){await remove(ref(db,'categories/'+id));});
    });
  });
  // Drag reorder
  let dragId=null;
  el.querySelectorAll('[data-catid]').forEach(function(row){
    row.addEventListener('dragstart',function(){dragId=this.dataset.catid;});
    row.addEventListener('dragover',function(e){e.preventDefault();});
    row.addEventListener('drop',async function(e){
      e.preventDefault();if(!dragId||dragId===this.dataset.catid)return;
      const cats2=getCats();const from=cats2.findIndex(c=>c.id===dragId),to=cats2.findIndex(c=>c.id===this.dataset.catid);
      const reordered=[...cats2];reordered.splice(to,0,reordered.splice(from,1)[0]);
      const updates={};reordered.forEach((c,i)=>{updates[c.id+'/order']=i;});
      await update(categoriesRef,updates);dragId=null;
    });
  });
}

// ── CHANGE PASSWORD ────────────────────────────────────────
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
  if(!auth.currentUser){showMsg('Your Firebase session has expired. Log in again.',false);return;}
  if(!nw||!conf){showMsg('Please fill in the new password fields.',false);return;}
  if(nw!==conf){showMsg('New passwords do not match.',false);return;}
  if(nw.length<6){showMsg('New password must be at least 6 characters.',false);return;}
  try{await updatePassword(auth.currentUser,nw);showMsg('\u2705 Password updated.',true);document.getElementById('cpCurrent').value='';document.getElementById('cpNew').value='';document.getElementById('cpConfirm').value='';}
  catch(e){if(e&&e.code==='auth/requires-recent-login'){try{if(!cur){showMsg('Enter your CURRENT password to confirm the change.',false);return;}var _c=EmailAuthProvider.credential(auth.currentUser.email,cur);await reauthenticateWithCredential(auth.currentUser,_c);await updatePassword(auth.currentUser,nw);showMsg('\u2705 Password updated.',true);}catch(e2){showMsg('Current password is incorrect.',false);}}else{showMsg('Error: '+((e&&e.code)||e),false);}}
};


// ── FORGOT PASSWORD ────────────────────────────────────────
window.toggleForgotPw=function(){
  var p=document.getElementById('forgotPwPanel');
  if(!p)return;
  p.style.display=(p.style.display==='none'||!p.style.display)?'block':'none';
  if(p.style.display==='block'){
    document.getElementById('recoveryPass').focus();
    document.getElementById('recoveryMsg').style.display='none';
  }
};
window.resetAdminPassword=async function(){
  var pass=document.getElementById('recoveryPass').value;
  var msg=document.getElementById('recoveryMsg');
  if(!pass){msg.textContent='Please enter your recovery password.';msg.style.color='#c0392b';msg.style.display='block';return;}
  var buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(pass));
  var hex=Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
  if(!currentAdminHash||hex!==currentAdminHash){
    msg.textContent='❌ Incorrect recovery password.';msg.style.color='#c0392b';msg.style.display='block';
    document.getElementById('recoveryPass').value='';return;
  }
  try{
    await update(settingsRef,{adminPasswordHash:null});
    currentAdminHash=null;
    document.getElementById('recoveryPass').value='';
    msg.textContent='✅ Password reset! You can now log in with your original password.';
    msg.style.color='#1a7a45';msg.style.display='block';
    setTimeout(function(){window.toggleForgotPw();msg.style.display='none';},3000);
  }catch(e){msg.textContent='Error: '+e.message;msg.style.color='#c0392b';msg.style.display='block';}
};

// ── STAFF ACCOUNTS ─────────────────────────────────────────
function renderStaffAccounts(){
  var el=document.getElementById('staffList');if(!el)return;
  var keys=Object.keys(staffAccountsMap);
  if(!keys.length){el.innerHTML='<p style="font-size:0.85rem;color:var(--tl);">No staff accounts yet.</p>';return;}
  el.innerHTML=keys.map(function(uid){
    var acc=staffAccountsMap[uid];
    return'<div style="display:flex;align-items:center;justify-content:space-between;background:#fff;border:1px solid var(--cd);border-radius:8px;padding:0.7rem 1rem;margin-bottom:0.5rem;">'
      +'<div><span style="font-size:0.9rem;font-weight:500;color:var(--bd);">👤 '+escHtml(acc.username)+'</span>'
      +'<span style="font-size:0.72rem;color:var(--tl);display:block;margin-top:0.1rem;">Staff · Password protected</span></div>'
      +'<button data-delstaff="'+uid+'" style="background:#fff0f0;border:1px solid #e0b0b0;border-radius:6px;padding:0.3rem 0.7rem;font-size:0.75rem;color:#c0392b;cursor:pointer;">🗑️ Remove</button>'
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
  // Check username not already taken
  var taken=Object.values(staffAccountsMap).some(function(a){return a.username===username;});
  if(taken){showMsg('Username "'+username+'" is already taken.',false);return;}
  var buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(password));
  var hashHex=Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
  var uid='staff_'+Date.now();
  try{
    await set(ref(db,'staffAccounts/'+uid),{username,passwordHash:hashHex});
    document.getElementById('staffUsername').value='';
    document.getElementById('staffPassword').value='';
    showMsg('✅ Staff account "'+username+'" created.',true);
  }catch(e){showMsg('Error: '+e.message,false);}
};


// ── ADMIN ACCOUNTS ─────────────────────────────────────────
function renderAdminAccounts(){
  var el=document.getElementById('adminAccList');if(!el)return;
  var keys=Object.keys(adminAccountsMap);
  if(!keys.length){el.innerHTML='<p style="font-size:0.85rem;color:var(--tl);">No admin accounts yet.</p>';return;}
  el.innerHTML=keys.map(function(uid){
    var acc=adminAccountsMap[uid];
    var noPay=acc.access==='nopay';
    return'<div style="display:flex;align-items:center;justify-content:space-between;gap:0.75rem;flex-wrap:wrap;background:#fff;border:1px solid var(--cd);border-radius:8px;padding:0.7rem 1rem;margin-bottom:0.5rem;">'
      +'<div><span style="font-size:0.9rem;font-weight:500;color:var(--bd);">🔑 '+escHtml(acc.username)+'</span>'
      +'<span style="font-size:0.72rem;color:'+(noPay?'#b07a2a':'var(--tl)')+';display:block;margin-top:0.1rem;">'+(noPay?'Admin · All except Payment Details':'Admin · Full access')+'</span></div>'
      +'<div style="display:flex;align-items:center;gap:0.5rem;">'
      +'<select data-accessuid="'+uid+'" title="Access level" style="background:var(--cr);border:1px solid var(--cd);border-radius:6px;padding:0.3rem 0.5rem;font-size:0.75rem;font-family:\'Inter\',sans-serif;color:var(--td);cursor:pointer;">'
      +'<option value="full"'+(noPay?'':' selected')+'>✅ Full access</option>'
      +'<option value="nopay"'+(noPay?' selected':'')+'>🔒 No Payment Details</option>'
      +'</select>'
      +'<button data-deladmin="'+uid+'" style="background:#fff0f0;border:1px solid #e0b0b0;border-radius:6px;padding:0.3rem 0.7rem;font-size:0.75rem;color:#c0392b;cursor:pointer;">🗑️ Remove</button>'
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
    showMsg('✅ Admin account "'+username+'" created.',true);
  }catch(e){showMsg('Error: '+e.message,false);}
};

// ── OPTION GROUPS MANAGER (admin) ───────────────────────────
function buildOptionChecklistHtml(selectedIds){
  var ids=Object.keys(optionGroupsMap);
  if(!ids.length)return '<span style="font-size:0.78rem;color:var(--tl);">No option groups yet — create them in the 🧩 Item Options panel.</span>';
  return ids.sort(function(a,b){return(optionGroupsMap[a].order||0)-(optionGroupsMap[b].order||0);}).map(function(id){
    var g=optionGroupsMap[id];
    var on=selectedIds.indexOf(id)!==-1;
    return '<label style="display:inline-flex;align-items:center;gap:0.35rem;background:'+(on?'#f5ead9':'#fff')+';border:1px solid var(--cd);border-radius:999px;padding:0.3rem 0.8rem;font-size:0.78rem;color:var(--td);cursor:pointer;text-transform:none;letter-spacing:0;font-weight:400;"><input type="checkbox" data-ogid="'+id+'"'+(on?' checked':'')+' style="width:auto;accent-color:var(--bl);margin:0;" onchange="this.parentElement.style.background=this.checked?\'#f5ead9\':\'#fff\'"/>'+escHtml(g.name)+'</label>';
  }).join('');
}
function renderNewItemOptionChecklist(){
  var el=document.getElementById('newItemOptions');if(!el)return;
  var checked=[];el.querySelectorAll('input[data-ogid]:checked').forEach(function(c){checked.push(c.dataset.ogid);});
  el.innerHTML=buildOptionChecklistHtml(checked);
}
var OG_INP='background:#fff;border:1px solid var(--cd);border-radius:6px;padding:0.35rem 0.55rem;font-size:0.8rem;color:var(--td);font-family:\'Inter\',sans-serif;';
function ogChoiceRowHtml(label,price){
  return '<div style="display:flex;gap:0.4rem;align-items:center;margin-bottom:0.35rem;" data-ogchoicerow>'
    +'<input type="text" value="'+escHtml(label)+'" data-choicelabel placeholder="Choice label (e.g. Hot, 1 Sugar)" style="flex:1;min-width:0;'+OG_INP+'"/>'
    +'<span style="font-size:0.78rem;color:var(--tl);">₱</span>'
    +'<input type="number" value="'+(parseInt(price)||0)+'" data-choiceprice min="0" title="Extra price — 0 shows as Free" style="width:84px;'+OG_INP+'"/>'
    +'<button data-removechoice title="Remove choice" style="background:#fff0f0;border:1px solid #e0b0b0;border-radius:6px;padding:0.3rem 0.55rem;font-size:0.75rem;color:#c0392b;cursor:pointer;">✖</button>'
    +'</div>';
}
function wireOgChoiceRow(row){
  row.querySelector('[data-removechoice]').addEventListener('click',function(){row.remove();});
}
function renderOptionManager(){
  var el=document.getElementById('optGroupList');if(!el)return;
  var ids=Object.keys(optionGroupsMap).sort(function(a,b){return(optionGroupsMap[a].order||0)-(optionGroupsMap[b].order||0);});
  if(!ids.length){el.innerHTML='<p style="font-size:0.85rem;color:var(--tl);">No option groups yet. Add your first one below.</p>';return;}
  var items=getMenuItems();
  el.innerHTML=ids.map(function(id){
    var g=optionGroupsMap[id];
    var used=items.filter(function(i){return getEffectiveOptionIds(i).indexOf(id)!==-1;}).length;
    var choiceRows=(g.choices||[]).map(function(c){return ogChoiceRowHtml(c.label,c.price);}).join('');
    return '<div data-ogcard="'+id+'" style="background:var(--cr);border:1px solid var(--cd);border-radius:8px;padding:1rem;margin-bottom:0.75rem;">'
      +'<div style="display:flex;gap:0.6rem;flex-wrap:wrap;align-items:flex-end;margin-bottom:0.6rem;">'
      +'<div style="flex:1;min-width:150px;"><label style="font-size:0.7rem;color:var(--tl);display:block;margin-bottom:0.2rem;text-transform:uppercase;letter-spacing:0.05em;">Option Name</label>'
      +'<input type="text" value="'+escHtml(g.name)+'" data-ogname style="width:100%;'+OG_INP+'"/></div>'
      +'<div><label style="font-size:0.7rem;color:var(--tl);display:block;margin-bottom:0.2rem;text-transform:uppercase;letter-spacing:0.05em;">Selection</label>'
      +'<select data-ogtype style="'+OG_INP+'">'
      +'<option value="single"'+(g.type!=='multi'?' selected':'')+'>Choose one</option>'
      +'<option value="multi"'+(g.type==='multi'?' selected':'')+'>Choose many</option>'
      +'</select></div>'
      +'<label style="display:flex;align-items:center;gap:0.3rem;font-size:0.78rem;color:var(--td);cursor:pointer;padding-bottom:0.45rem;text-transform:none;letter-spacing:0;font-weight:400;"><input type="checkbox" data-ogreq'+(g.required!==false?' checked':'')+' style="width:auto;accent-color:var(--bl);"/> Required</label>'
      +'</div>'
      +'<div style="font-size:0.7rem;color:var(--tl);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:0.35rem;">Choices — price 0 = Free</div>'
      +'<div data-ogchoices>'+choiceRows+'</div>'
      +'<button data-addchoice style="background:#fff;border:1px dashed var(--cd);border-radius:6px;padding:0.35rem 0.8rem;font-size:0.78rem;color:var(--tm);cursor:pointer;margin-top:0.2rem;">➕ Add Choice</button>'
      +'<div style="display:flex;justify-content:space-between;align-items:center;margin-top:0.75rem;flex-wrap:wrap;gap:0.5rem;">'
      +'<span style="font-size:0.72rem;color:var(--tl);">Used by '+used+' item'+(used===1?'':'s')+'</span>'
      +'<div style="display:flex;gap:0.5rem;">'
      +'<button data-delog="'+id+'" style="background:#fff0f0;border:1px solid #e0b0b0;border-radius:6px;padding:0.35rem 0.8rem;font-size:0.78rem;color:#c0392b;cursor:pointer;">🗑️ Delete</button>'
      +'<button data-saveog="'+id+'" style="background:var(--bd);color:#fff;border:none;border-radius:6px;padding:0.35rem 1rem;font-size:0.78rem;cursor:pointer;font-weight:500;">💾 Save</button>'
      +'</div></div></div>';
  }).join('');
  el.querySelectorAll('[data-ogchoicerow]').forEach(wireOgChoiceRow);
  el.querySelectorAll('[data-addchoice]').forEach(function(btn){
    btn.addEventListener('click',function(){
      var wrap=this.closest('[data-ogcard]').querySelector('[data-ogchoices]');
      var tmp=document.createElement('div');
      tmp.innerHTML=ogChoiceRowHtml('',0);
      var row=tmp.firstChild;
      wrap.appendChild(row);
      wireOgChoiceRow(row);
      row.querySelector('[data-choicelabel]').focus();
    });
  });
  el.querySelectorAll('[data-saveog]').forEach(function(btn){
    btn.addEventListener('click',async function(){
      var id=this.dataset.saveog,card=el.querySelector('[data-ogcard="'+id+'"]'),self=this;
      var name=(card.querySelector('[data-ogname]').value||'').trim();
      if(!name){alert('Please enter the option name.');return;}
      var type=card.querySelector('[data-ogtype]').value;
      var required=card.querySelector('[data-ogreq]').checked;
      var choices=[];
      card.querySelectorAll('[data-ogchoicerow]').forEach(function(r){
        var lbl=(r.querySelector('[data-choicelabel]').value||'').trim();
        var pr=parseInt(r.querySelector('[data-choiceprice]').value)||0;
        if(lbl)choices.push({label:lbl,price:pr});
      });
      if(!choices.length){alert('Please add at least one choice.');return;}
      try{
        await update(ref(db,'optionGroups/'+id),{name:name,type:type,required:required,choices:choices});
        self.textContent='✅ Saved';setTimeout(function(){self.textContent='💾 Save';},1500);
      }catch(e){alert('Error: '+e.message);}
    });
  });
  el.querySelectorAll('[data-delog]').forEach(function(btn){
    btn.addEventListener('click',function(){
      var id=this.dataset.delog;
      var g=optionGroupsMap[id];if(!g)return;
      var used=getMenuItems().filter(function(i){return getEffectiveOptionIds(i).indexOf(id)!==-1;}).length;
      showDeletePopup('option "'+g.name+'"'+(used?' (used by '+used+' item'+(used===1?'':'s')+')':''),async function(){
        await remove(ref(db,'optionGroups/'+id));
      });
    });
  });
}
window.addOptionGroup=async function(){
  var name=(document.getElementById('newOgName').value||'').trim();
  if(!name){alert('Please enter an option name (e.g. Temperature).');return;}
  var type=document.getElementById('newOgType').value;
  var required=document.getElementById('newOgReq').checked;
  var id='og_'+Date.now();
  try{
    await set(ref(db,'optionGroups/'+id),{name:name,type:type,required:required,order:Object.keys(optionGroupsMap).length,choices:[{label:'Option 1',price:0}]});
    document.getElementById('newOgName').value='';
    var c=document.getElementById('ogAddConfirm');c.style.display='block';setTimeout(function(){c.style.display='none';},2500);
  }catch(e){alert('Error: '+e.message);}
};

// ── STAFF MENU (read-only view) ─────────────────────────────
function renderStaffMenu(){
  var el=document.getElementById('staffMenuContainer');if(!el)return;
  var cats=getCats();var items=getMenuItems();
  if(!cats.length){el.innerHTML='<p style="color:var(--tl);">No menu items yet.</p>';return;}
  el.innerHTML=cats.map(function(cat){
    var catItems=items.filter(function(i){return i.cat===cat.id;}).sort(function(a,b){return(a.order||0)-(b.order||0);});
    if(!catItems.length)return'';
    return'<div style="margin-bottom:1.5rem;">'
      +'<div style="font-family:\'Playfair Display\',serif;font-size:1rem;color:var(--bd);margin-bottom:0.6rem;padding-bottom:0.3rem;border-bottom:1px solid var(--cd);">'+cat.icon+' '+cat.label+'</div>'
      +catItems.map(function(item){
        var priceStr=item.priceM&&item.priceL?'S ₱'+item.priceS+' · M ₱'+item.priceM+' · L ₱'+item.priceL
          :item.priceL&&item.labelS&&item.labelL?item.labelS+' ₱'+item.priceS+' · '+item.labelL+' ₱'+item.priceL
          :'₱'+item.priceS;
        return'<div style="display:flex;align-items:center;gap:0.75rem;padding:0.55rem 0;border-bottom:1px solid rgba(0,0,0,0.04);">'
          +(item.img?'<img src="'+item.img+'" style="width:38px;height:38px;border-radius:6px;object-fit:cover;flex-shrink:0;" onerror="this.style.display=\'none\'"/>'
            :'<div style="width:38px;height:38px;border-radius:6px;background:linear-gradient(135deg,var(--cd),var(--bl));display:flex;align-items:center;justify-content:center;font-size:1rem;flex-shrink:0;">'+cat.icon+'</div>')
          +'<div style="flex:1;min-width:0;"><div style="font-size:0.88rem;font-weight:500;color:var(--bd);">'+item.name+'</div>'
          +(item.desc?'<div style="font-size:0.75rem;color:var(--tl);margin-top:0.1rem;">'+item.desc+'</div>':'')
          +'<div style="font-size:0.78rem;color:#c9a36a;margin-top:0.15rem;">'+priceStr+'</div></div>'
          +'<span style="font-size:0.7rem;padding:0.15rem 0.5rem;border-radius:999px;flex-shrink:0;background:'+(isAvail(item.name)?'rgba(45,158,95,0.12)':'rgba(192,57,57,0.1)')+';color:'+(isAvail(item.name)?'#2d9e5f':'#c0392b')+';">'+(isAvail(item.name)?'✅':'❌')+'</span>'
          +'</div>';
      }).join('')
      +'</div>';
  }).join('');
}

// ── PUBLIC REVIEWS (dynamic) ────────────────────────────────
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


// ── EDIT ITEM HELPERS ──────────────────────────────────────
function escHtml(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function safeImageSrc(s){s=String(s||'');if(/^data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=\s]+$/i.test(s)||/^https:\/\//i.test(s))return escHtml(s);return '';}
window.toggleEditPanel=function(key){
  var p=document.getElementById('ep_'+key);if(!p)return;
  p.style.display=(p.style.display==='none'||p.style.display==='')?'block':'none';
};
window.setEditPricingType=function(key,type){
  var s=document.getElementById('ep_'+key+'_sized');
  var t=document.getElementById('ep_'+key+'_two');
  var f=document.getElementById('ep_'+key+'_flat');
  if(s)s.style.display=(type==='sized')?'grid':'none';
  if(t)t.style.display=(type==='two')?'grid':'none';
  if(f)f.style.display=(type==='flat')?'block':'none';
};
window.saveEditItem=async function(key){
  var item=menuItemsMap[key];if(!item){alert('Item not found.');return;}
  var catEl=document.getElementById('ep_'+key+'_cat');
  var nameEl=document.getElementById('ep_'+key+'_name');
  var descEl=document.getElementById('ep_'+key+'_desc');
  var imgEl=document.getElementById('ep_'+key+'_img');
  var ptRadio=document.querySelector('input[name="ep_pt_'+key+'"]:checked');
  if(!catEl||!nameEl||!ptRadio){alert('Could not read form fields.');return;}
  var newCat=catEl.value;
  var newName=nameEl.value.trim();
  var newDesc=descEl?descEl.value.trim():'';
  var newImg=imgEl?(imgEl.value.trim()||null):null;
  var pType=ptRadio.value;
  if(!newName){alert('Name is required.');return;}
  var updates={cat:newCat,name:newName,desc:newDesc||null,img:newImg,optionsSet:true};
  var selOg=[];var epnl=document.getElementById('ep_'+key);
  if(epnl)epnl.querySelectorAll('input[data-ogid]:checked').forEach(function(c){selOg.push(c.dataset.ogid);});
  updates.options=selOg.length?selOg:null;
  if(pType==='sized'){
    var pS=parseInt(document.getElementById('ep_'+key+'_priceS').value)||0;
    var pM=parseInt(document.getElementById('ep_'+key+'_priceM').value)||0;
    var pL=parseInt(document.getElementById('ep_'+key+'_priceL').value)||0;
    if(!pS||!pM||!pL){alert('Please fill in Small, Medium, and Large prices.');return;}
    updates.priceS=pS;updates.priceM=pM;updates.priceL=pL;
    updates.labelS=null;updates.labelL=null;
  } else if(pType==='two'){
    var lS=(document.getElementById('ep_'+key+'_labelS').value||'').trim();
    var lL=(document.getElementById('ep_'+key+'_labelL').value||'').trim();
    var tS=parseInt(document.getElementById('ep_'+key+'_priceTwoS').value)||0;
    var tL=parseInt(document.getElementById('ep_'+key+'_priceTwoL').value)||0;
    if(!lS||!lL){alert('Please enter both option labels.');return;}
    if(!tS||!tL){alert('Please enter both option prices.');return;}
    updates.priceS=tS;updates.priceM=null;updates.priceL=tL;
    updates.labelS=lS;updates.labelL=lL;
  } else {
    var pF=parseInt(document.getElementById('ep_'+key+'_priceFlat').value)||0;
    if(!pF){alert('Please enter a price.');return;}
    updates.priceS=pF;updates.priceM=null;updates.priceL=null;
    updates.labelS=null;updates.labelL=null;
  }
  var oldName=item.name;
  try{
    await update(ref(db,'menuItems/'+key),updates);
    if(newName!==oldName&&availability[oldName]!==undefined){
      var wasAvail=availability[oldName];
      await update(availRef,{[newName]:wasAvail,[oldName]:null});
    }
    window.toggleEditPanel(key);
    buildAvail();renderMenuSection();renderOrderSection();
  }catch(e){alert('Error saving: '+e.message);}
};


function buildAvail(){
  const el=document.getElementById('availList');if(!el)return;
  const items=getMenuItems();
  if(!Object.keys(menuItemsMap).length){el.innerHTML='<p style="color:var(--tl);text-align:center;padding:2rem;">Loading...</p>';return;}
  const cats=getCats();let html='';
  cats.forEach(function(cat){
    const catItems=items.filter(i=>i.cat===cat.id).sort((a,b)=>(a.order||0)-(b.order||0));
    html+='<div style="font-family:\'Playfair Display\',serif;font-size:1.1rem;color:var(--bd);margin:1.5rem 0 0.75rem;padding-bottom:0.4rem;border-bottom:2px solid var(--cd);">'+cat.icon+' '+cat.label+'</div>';
    if(!catItems.length){html+='<p style="font-size:0.82rem;color:var(--tl);padding:0.5rem 0 1rem;">No items in this category yet.</p>';return;}
    catItems.forEach(function(item){
      const ok=isAvail(item.name),sid='av_'+item.key;
      const priceStr=item.priceM&&item.priceL?'S ₱'+item.priceS+' · M ₱'+item.priceM+' · L ₱'+item.priceL:item.priceL&&item.labelS&&item.labelL?''+item.labelS+' ₱'+item.priceS+' · '+item.labelL+' ₱'+item.priceL:'₱'+item.priceS;
      const imgSrc=item.img||'';
      const imgBlock=imgSrc?'<img src="'+imgSrc+'" style="width:44px;height:44px;border-radius:6px;object-fit:cover;flex-shrink:0;" onerror="this.style.display=\'none\'"/>'
        :'<div style="width:44px;height:44px;border-radius:6px;background:linear-gradient(135deg,var(--cd),var(--bl));display:flex;align-items:center;justify-content:center;font-size:1.2rem;flex-shrink:0;">'+cat.icon+'</div>';
      html+='<div style="background:#fff;border:1px solid var(--cd);border-radius:8px;padding:0.85rem 1rem;margin-bottom:0.6rem;" draggable="true" data-itemkey="'+item.key+'" data-itemcat="'+cat.id+'">'
        +'<div style="display:flex;align-items:center;gap:0.75rem;">'
        +'<span style="cursor:grab;color:var(--tl);font-size:1.1rem;flex-shrink:0;user-select:none;">⠿</span>'
        +imgBlock
        +'<div style="flex:1;min-width:0;"><div style="font-size:0.9rem;font-weight:500;color:var(--bd);'+(ok?'':'text-decoration:line-through;opacity:0.5;')+'" id="'+sid+'_n">'+item.name+'</div><div style="font-size:0.75rem;color:var(--tl);">'+priceStr+'</div></div>'
        +'<div style="display:flex;align-items:center;gap:0.6rem;flex-shrink:0;">'
        +'<span id="'+sid+'_l" style="font-size:0.75rem;font-weight:600;padding:0.2rem 0.65rem;border-radius:999px;background:'+(ok?'#d4edda':'#fde8e8')+';color:'+(ok?'#155724':'#721c24')+';white-space:nowrap;">'+(ok?'✅ Available':'❌ Unavailable')+'</span>'
        +'<input type="checkbox" class="avail-toggle" '+(ok?'checked':'')+' data-name="'+item.name+'" data-sid="'+sid+'"/>'
        +'<button onclick="toggleEditPanel(\''+item.key+'\')" style="background:#fff8e1;border:1px solid #f0d080;border-radius:6px;padding:0.3rem 0.6rem;font-size:0.75rem;color:#7a5c00;cursor:pointer;">✏️</button>'
        +'<button data-delitem="'+item.key+'" data-delname="'+item.name+'" style="background:#fff0f0;border:1px solid #e0b0b0;border-radius:6px;padding:0.3rem 0.6rem;font-size:0.75rem;color:#c0392b;cursor:pointer;">🗑️</button>'
        +'</div></div>'
        +'<div style="margin-top:0.6rem;display:flex;align-items:center;gap:0.5rem;background:#ece4d8;border:1px solid var(--cd);border-radius:6px;padding:0.45rem 0.7rem;">'
        +'<span style="font-size:0.72rem;color:var(--tl);white-space:nowrap;flex-shrink:0;">🖼️ Image URL:</span>'
        +'<input type="text" id="'+sid+'_img" value="'+imgSrc+'" placeholder="https://i.postimg.cc/..." style="flex:1;font-size:0.75rem;padding:0.25rem 0.5rem;border:1px solid var(--cd);border-radius:4px;background:#fff;color:var(--td);font-family:\'Inter\',sans-serif;"/>'
        +'<button data-saveimg="'+item.key+'" data-sid="'+sid+'" style="background:var(--bd);color:#fff;border:none;border-radius:4px;padding:0.28rem 0.7rem;font-size:0.72rem;cursor:pointer;font-family:\'Inter\',sans-serif;white-space:nowrap;flex-shrink:0;">💾 Save</button>'
        +'</div></div>';
    });
  });
  el.innerHTML=html||'<p style="color:var(--tl);text-align:center;padding:2rem;">No menu items yet. Add one above!</p>';

  // ── Inject edit panels ──
  el.querySelectorAll('[data-itemkey]').forEach(function(row){
    var key=row.dataset.itemkey;
    var item=menuItemsMap[key];if(!item)return;
    var cats=getCats();
    var pType=(item.priceM&&item.priceL)?'sized':(item.priceL&&item.labelS&&item.labelL)?'two':'flat';
    var panel=document.createElement('div');
    panel.id='ep_'+key;
    panel.style.cssText='display:none;margin-top:0.75rem;padding:0.9rem;background:#f5f0ea;border:1px solid var(--cd);border-radius:8px;';
    var catOpts=cats.map(function(c){return'<option value="'+c.id+'"'+(item.cat===c.id?' selected':'')+'>'+c.icon+' '+c.label+'</option>';}).join('');
    panel.innerHTML=
      '<div style="font-size:0.78rem;font-weight:600;color:var(--bd);margin-bottom:0.6rem;text-transform:uppercase;letter-spacing:0.07em;">✏️ Edit Item</div>'
      +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;margin-bottom:0.5rem;">'
      +'<div><label style="font-size:0.72rem;color:var(--tl);display:block;margin-bottom:0.2rem;text-transform:uppercase;letter-spacing:0.05em;">Category</label>'
      +'<select id="ep_'+key+'_cat" style="width:100%;background:#fff;border:1px solid var(--cd);border-radius:6px;padding:0.42rem 0.55rem;font-size:0.8rem;color:var(--td);font-family:\'Inter\',sans-serif;">'+catOpts+'</select></div>'
      +'<div><label style="font-size:0.72rem;color:var(--tl);display:block;margin-bottom:0.2rem;text-transform:uppercase;letter-spacing:0.05em;">Name</label>'
      +'<input type="text" id="ep_'+key+'_name" value="'+escHtml(item.name)+'" style="width:100%;background:#fff;border:1px solid var(--cd);border-radius:6px;padding:0.42rem 0.55rem;font-size:0.8rem;color:var(--td);font-family:\'Inter\',sans-serif;"/></div>'
      +'</div>'
      +'<div style="margin-bottom:0.5rem;"><label style="font-size:0.72rem;color:var(--tl);display:block;margin-bottom:0.2rem;text-transform:uppercase;letter-spacing:0.05em;">Description</label>'
      +'<input type="text" id="ep_'+key+'_desc" value="'+escHtml(item.desc||'')+'" placeholder="Optional description" style="width:100%;background:#fff;border:1px solid var(--cd);border-radius:6px;padding:0.42rem 0.55rem;font-size:0.8rem;color:var(--td);font-family:\'Inter\',sans-serif;"/></div>'
      +'<div style="margin-bottom:0.45rem;"><label style="font-size:0.72rem;color:var(--tl);display:block;margin-bottom:0.25rem;text-transform:uppercase;letter-spacing:0.05em;">Pricing Type</label>'
      +'<div style="display:flex;gap:0.75rem;flex-wrap:wrap;">'
      +'<label style="font-size:0.8rem;color:var(--td);display:flex;align-items:center;gap:0.3rem;cursor:pointer;text-transform:none;letter-spacing:0;font-weight:400;">'
      +'<input type="radio" name="ep_pt_'+key+'" value="sized"'+(pType==='sized'?' checked':'')+' onchange="setEditPricingType(\''+key+'\',\'sized\')" style="width:auto;accent-color:var(--bl);"/> Sized (S/M/L)</label>'
      +'<label style="font-size:0.8rem;color:var(--td);display:flex;align-items:center;gap:0.3rem;cursor:pointer;text-transform:none;letter-spacing:0;font-weight:400;">'
      +'<input type="radio" name="ep_pt_'+key+'" value="two"'+(pType==='two'?' checked':'')+' onchange="setEditPricingType(\''+key+'\',\'two\')" style="width:auto;accent-color:var(--bl);"/> Two Options</label>'
      +'<label style="font-size:0.8rem;color:var(--td);display:flex;align-items:center;gap:0.3rem;cursor:pointer;text-transform:none;letter-spacing:0;font-weight:400;">'
      +'<input type="radio" name="ep_pt_'+key+'" value="flat"'+(pType==='flat'?' checked':'')+' onchange="setEditPricingType(\''+key+'\',\'flat\')" style="width:auto;accent-color:var(--bl);"/> Flat Price</label>'
      +'</div></div>'
      // Sized fields
      +'<div id="ep_'+key+'_sized" style="display:'+(pType==='sized'?'grid':'none')+';grid-template-columns:1fr 1fr 1fr;gap:0.5rem;margin-bottom:0.5rem;">'
      +'<div><label style="font-size:0.72rem;color:var(--tl);display:block;margin-bottom:0.2rem;text-transform:uppercase;letter-spacing:0.05em;">Small (₱)</label>'
      +'<input type="number" id="ep_'+key+'_priceS" value="'+(pType==='sized'?(item.priceS||''):'')+'" style="width:100%;background:#fff;border:1px solid var(--cd);border-radius:6px;padding:0.42rem 0.55rem;font-size:0.8rem;color:var(--td);font-family:\'Inter\',sans-serif;"/></div>'
      +'<div><label style="font-size:0.72rem;color:var(--tl);display:block;margin-bottom:0.2rem;text-transform:uppercase;letter-spacing:0.05em;">Medium (₱)</label>'
      +'<input type="number" id="ep_'+key+'_priceM" value="'+(pType==='sized'?(item.priceM||''):'')+'" style="width:100%;background:#fff;border:1px solid var(--cd);border-radius:6px;padding:0.42rem 0.55rem;font-size:0.8rem;color:var(--td);font-family:\'Inter\',sans-serif;"/></div>'
      +'<div><label style="font-size:0.72rem;color:var(--tl);display:block;margin-bottom:0.2rem;text-transform:uppercase;letter-spacing:0.05em;">Large (₱)</label>'
      +'<input type="number" id="ep_'+key+'_priceL" value="'+(pType==='sized'?(item.priceL||''):'')+'" style="width:100%;background:#fff;border:1px solid var(--cd);border-radius:6px;padding:0.42rem 0.55rem;font-size:0.8rem;color:var(--td);font-family:\'Inter\',sans-serif;"/></div>'
      +'</div>'
      // Two options fields
      +'<div id="ep_'+key+'_two" style="display:'+(pType==='two'?'grid':'none')+';grid-template-columns:1fr 1fr;gap:0.5rem;margin-bottom:0.5rem;">'
      +'<div><label style="font-size:0.72rem;color:var(--tl);display:block;margin-bottom:0.2rem;text-transform:uppercase;letter-spacing:0.05em;">Option 1 Label</label>'
      +'<input type="text" id="ep_'+key+'_labelS" value="'+escHtml(item.labelS||'')+'" placeholder="e.g. Small" style="width:100%;background:#fff;border:1px solid var(--cd);border-radius:6px;padding:0.42rem 0.55rem;font-size:0.8rem;color:var(--td);font-family:\'Inter\',sans-serif;"/></div>'
      +'<div><label style="font-size:0.72rem;color:var(--tl);display:block;margin-bottom:0.2rem;text-transform:uppercase;letter-spacing:0.05em;">Option 1 Price (₱)</label>'
      +'<input type="number" id="ep_'+key+'_priceTwoS" value="'+(pType==='two'?(item.priceS||''):'')+'" style="width:100%;background:#fff;border:1px solid var(--cd);border-radius:6px;padding:0.42rem 0.55rem;font-size:0.8rem;color:var(--td);font-family:\'Inter\',sans-serif;"/></div>'
      +'<div><label style="font-size:0.72rem;color:var(--tl);display:block;margin-bottom:0.2rem;text-transform:uppercase;letter-spacing:0.05em;">Option 2 Label</label>'
      +'<input type="text" id="ep_'+key+'_labelL" value="'+escHtml(item.labelL||'')+'" placeholder="e.g. Large" style="width:100%;background:#fff;border:1px solid var(--cd);border-radius:6px;padding:0.42rem 0.55rem;font-size:0.8rem;color:var(--td);font-family:\'Inter\',sans-serif;"/></div>'
      +'<div><label style="font-size:0.72rem;color:var(--tl);display:block;margin-bottom:0.2rem;text-transform:uppercase;letter-spacing:0.05em;">Option 2 Price (₱)</label>'
      +'<input type="number" id="ep_'+key+'_priceTwoL" value="'+(pType==='two'?(item.priceL||''):'')+'" style="width:100%;background:#fff;border:1px solid var(--cd);border-radius:6px;padding:0.42rem 0.55rem;font-size:0.8rem;color:var(--td);font-family:\'Inter\',sans-serif;"/></div>'
      +'</div>'
      // Flat field
      +'<div id="ep_'+key+'_flat" style="display:'+(pType==='flat'?'block':'none')+';margin-bottom:0.5rem;">'
      +'<label style="font-size:0.72rem;color:var(--tl);display:block;margin-bottom:0.2rem;text-transform:uppercase;letter-spacing:0.05em;">Price (₱)</label>'
      +'<input type="number" id="ep_'+key+'_priceFlat" value="'+(pType==='flat'?(item.priceS||''):'')+'" placeholder="e.g. 195" style="width:100%;background:#fff;border:1px solid var(--cd);border-radius:6px;padding:0.42rem 0.55rem;font-size:0.8rem;color:var(--td);font-family:\'Inter\',sans-serif;"/>'
      +'</div>'
      // Item options
      +'<div style="margin-bottom:0.7rem;"><label style="font-size:0.72rem;color:var(--tl);display:block;margin-bottom:0.3rem;text-transform:uppercase;letter-spacing:0.05em;">Item Options — tick everything this item should offer</label>'
      +'<div style="display:flex;flex-wrap:wrap;gap:0.4rem;">'+buildOptionChecklistHtml(getEffectiveOptionIds(item))+'</div></div>'
      // Image URL
      +'<div style="margin-bottom:0.7rem;"><label style="font-size:0.72rem;color:var(--tl);display:block;margin-bottom:0.2rem;text-transform:uppercase;letter-spacing:0.05em;">Image URL</label>'
      +'<input type="text" id="ep_'+key+'_img" value="'+escHtml(item.img||'')+'" placeholder="https://i.postimg.cc/..." style="width:100%;background:#fff;border:1px solid var(--cd);border-radius:6px;padding:0.42rem 0.55rem;font-size:0.8rem;color:var(--td);font-family:\'Inter\',sans-serif;"/></div>'
      // Buttons
      +'<div style="display:flex;gap:0.5rem;justify-content:flex-end;">'
      +'<button onclick="toggleEditPanel(\''+key+'\')" style="background:#fff;border:1px solid var(--cd);border-radius:6px;padding:0.38rem 0.9rem;font-size:0.8rem;color:var(--tl);cursor:pointer;font-family:\'Inter\',sans-serif;">Cancel</button>'
      +'<button onclick="saveEditItem(\''+key+'\')" style="background:var(--bd);color:#fff;border:none;border-radius:6px;padding:0.38rem 0.9rem;font-size:0.8rem;cursor:pointer;font-family:\'Inter\',sans-serif;font-weight:500;">💾 Save Changes</button>'
      +'</div>';
    row.appendChild(panel);
  });
 
  // Staff mode: hide edit/delete/drag/toggle/imageURL controls
  if(staffLoggedIn){
    el.querySelectorAll('.avail-toggle').forEach(function(t){t.style.display='none';});
    el.querySelectorAll('[data-delitem]').forEach(function(b){b.style.display='none';});
    el.querySelectorAll('button[onclick*="toggleEditPanel"]').forEach(function(b){b.style.display='none';});
    el.querySelectorAll('[draggable]').forEach(function(r){r.removeAttribute('draggable');});
    el.querySelectorAll('[style*="cursor:grab"]').forEach(function(s){s.style.display='none';});
    el.querySelectorAll('[data-saveimg]').forEach(function(b){b.closest('div').style.display='none';});
  }
  // Wire toggles
  el.querySelectorAll('.avail-toggle').forEach(function(chk){
    chk.addEventListener('change',async function(){
      const name=this.dataset.name,sid=this.dataset.sid,ok=this.checked;
      availability[name]=ok;
      const n=document.getElementById(sid+'_n'),l=document.getElementById(sid+'_l');
      if(n){n.style.textDecoration=ok?'none':'line-through';n.style.opacity=ok?'1':'0.5';}
      if(l){l.textContent=ok?'✅ Available':'❌ Unavailable';l.style.background=ok?'#d4edda':'#fde8e8';l.style.color=ok?'#155724':'#721c24';}
      renderMenuSection();renderOrderSection();
      await update(availRef,{[name]:ok});
    });
  });
  // Wire save image
  el.querySelectorAll('button[data-saveimg]').forEach(function(btn){
    btn.addEventListener('click',async function(){
      const key=this.dataset.saveimg,sid=this.dataset.sid;
      const input=document.getElementById(sid+'_img');if(!input)return;
      const imgUrl=input.value.trim()||null;
      await update(ref(db,'menuItems/'+key),{img:imgUrl});
      input.style.borderColor='#2d9e5f';input.style.background='#f0faf4';
      setTimeout(function(){input.style.borderColor='var(--cd)';input.style.background='#fff';},1500);
      renderMenuSection();
    });
  });
  // Wire delete item
  el.querySelectorAll('button[data-delitem]').forEach(function(btn){
    btn.addEventListener('click',function(){showDeletePopup(this.dataset.delname,async function(){await remove(ref(db,'menuItems/'+btn.dataset.delitem));});});
  });
  // Wire drag reorder
  let dragItemKey=null;
  el.querySelectorAll('[data-itemkey]').forEach(function(row){
    row.addEventListener('dragstart',function(){dragItemKey=this.dataset.itemkey;});
    row.addEventListener('dragover',function(e){e.preventDefault();});
    row.addEventListener('drop',async function(e){
      e.preventDefault();if(!dragItemKey||dragItemKey===this.dataset.itemkey)return;
      const cat2=this.dataset.itemcat;
      const catItems=getMenuItems().filter(i=>i.cat===cat2).sort((a,b)=>(a.order||0)-(b.order||0));
      const from=catItems.findIndex(i=>i.key===dragItemKey),to=catItems.findIndex(i=>i.key===this.dataset.itemkey);
      if(from<0||to<0)return;
      const reordered=[...catItems];reordered.splice(to,0,reordered.splice(from,1)[0]);
      const updates={};reordered.forEach((item,i)=>{updates[item.key+'/order']=i;});
      await update(menuRef,updates);dragItemKey=null;
    });
  });
}

// ── DASHBOARD ──
function renderDashboard(){
  const archived=Object.values(archivedOrdersMap);
  function _isSale(o){if(!o||o.voided)return false;if(o.source==='pos')return true;var r=['Completed','Received'];if(r.indexOf(o.status)>-1)return true;if(o.status==='Archived'&&r.indexOf(o.prevStatus)>-1)return true;return false;}
  function _tsOf(o){return o.timestamp||Date.parse(o.date)||o.archivedAt||0;}
  const sales=Object.values(adminOrdersMap).concat(archived).filter(_isSale);
  const now2=new Date();
  const startToday=new Date(now2.getFullYear(),now2.getMonth(),now2.getDate()).getTime();
  const _sow=new Date(now2);_sow.setDate(now2.getDate()-now2.getDay());_sow.setHours(0,0,0,0);const startWeek=_sow.getTime();
  const startMonth=new Date(now2.getFullYear(),now2.getMonth(),1).getTime();
  function sumOrders(arr){return{rev:arr.reduce((s,o)=>s+(o.total||0),0),cnt:arr.length};}
  const t=sumOrders(sales.filter(o=>_tsOf(o)>=startToday)),w=sumOrders(sales.filter(o=>_tsOf(o)>=startWeek)),m=sumOrders(sales.filter(o=>_tsOf(o)>=startMonth)),a=sumOrders(sales);
  function setCard(id,rev,cnt){const el=document.getElementById(id);if(el)el.textContent='₱'+rev.toLocaleString();const cel=document.getElementById(id+'Count');if(cel)cel.textContent=cnt+' order'+(cnt!==1?'s':'');}
  setCard('dashToday',t.rev,t.cnt);setCard('dashWeek',w.rev,w.cnt);setCard('dashMonth',m.rev,m.cnt);setCard('dashAllTime',a.rev,a.cnt);
  var payMix={};sales.forEach(function(o){var pays=(o.payments&&o.payments.length)?o.payments:[{method:o.payment||'Other',amount:o.total||0}];pays.forEach(function(pp){var mm=pp.method||'Other';payMix[mm]=(payMix[mm]||0)+(Number(pp.amount)||0);});});
  var _pmk=Object.keys(payMix).sort(function(a,b){return payMix[b]-payMix[a];});var _pmt=_pmk.reduce(function(x,k){return x+payMix[k];},0)||1;var _pmc={'Cash':'#2a9d5c','GCash':'#b08d57','Bank Transfer':'#3b8fd4','PayMaya':'#7360f2','Split':'#e67e00'};
  var _pend=sales.filter(function(o){return o.paymentStatus==='pending';});var _pendTot=_pend.reduce(function(x,o){return x+(Number(o.total)||0);},0);
  var _pendEl=document.getElementById('payPendBanner');if(_pendEl)_pendEl.innerHTML=_pend.length?'<div style="background:#fff8e1;border:1px solid #ffe0a3;border-radius:6px;padding:0.4rem 0.6rem;font-size:0.78rem;color:#8a6d1b;font-weight:600;margin-bottom:0.5rem;">⏳ Pending verification: ₱'+_pendTot.toLocaleString()+' ('+_pend.length+') — non-cash not yet confirmed in the account</div>':'';
  var _pml=document.getElementById('payMixList');if(_pml)_pml.innerHTML=_pmk.length?_pmk.map(function(k){var pv=Math.round(payMix[k]/_pmt*100);return '<div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.45rem;font-size:0.82rem;"><span style="width:12px;height:12px;border-radius:50%;background:'+(_pmc[k]||'#999')+';flex-shrink:0;"></span><span style="flex:1;color:var(--tm);">'+k+'</span><span style="font-weight:600;color:var(--bd);">₱'+payMix[k].toLocaleString()+' ('+pv+'%)</span></div>';}).join(''):'<p style="font-size:0.8rem;color:var(--tl);text-align:center;padding:0.5rem;">No sales yet.</p>';
  drawRevenueChart(sales);
  // Top 10 best sellers — ranked by menu product (drinks) units. Uses structured lineItems so
  // optional ingredients (add-ons/syrups/shots) are NOT counted; food-tagged categories excluded.
  const itemCount={};
  const _mim=menuItemsMap||{}; const _ctype=(window.__posSettings&&window.__posSettings.catType)||{};
  function _isDrink(li){ var mi=_mim[li&&li.itemKey]; if(!mi)return true; /* unknown/legacy → keep */ return _ctype[mi.cat]!=='food'; }
  sales.forEach(function(o){
    if(o.lineItems&&o.lineItems.length){
      o.lineItems.forEach(function(li){ if(!li)return; if(!_isDrink(li))return; var nm=li.name||(_mim[li.itemKey]&&_mim[li.itemKey].name)||li.itemKey; if(!nm)return; itemCount[nm]=(itemCount[nm]||0)+(Number(li.qty)||0); });
    } else if(o.items){ /* legacy orders without lineItems — parse the summary string, strip (options) and xN */
      o.items.split(',').forEach(function(s){const name=s.trim().replace(/\s*\(.*?\)\s*/g,'').replace(/\s*x\d+\s*$/,'').trim();const qty=parseInt((s.match(/x(\d+)/)||[])[1]||1);if(name)itemCount[name]=(itemCount[name]||0)+qty;});
    }
  });
  const top10=Object.entries(itemCount).sort((a,b)=>b[1]-a[1]).slice(0,10);
  const topEl=document.getElementById('topItemsList');
  if(topEl)topEl.innerHTML=top10.length?top10.map(function(entry,i){const medals=['🥇','🥈','🥉','4','5','6','7','8','9','10'];return'<div style="display:flex;align-items:center;gap:0.75rem;padding:0.5rem 0;border-bottom:1px solid var(--cd);"><span style="font-size:1rem;min-width:20px;text-align:center;">'+medals[i]+'</span><span style="flex:1;font-size:0.83rem;color:var(--bd);">'+entry[0]+'</span><span style="font-size:0.8rem;font-weight:600;color:var(--bl);">'+entry[1]+' sold</span></div>';}).join(''):'<p style="color:var(--tl);font-size:0.83rem;text-align:center;padding:1rem;">No sales yet.</p>';
  // Status breakdown
  const allActive=Object.values(adminOrdersMap);
  const statuses=['Pending','Confirmed','Preparing','Completed','Received','Rejected'];
  const statusColors={Pending:'#856404',Confirmed:'#0c5460',Preparing:'#664d03',Completed:'#155724',Received:'#1b5e20',Rejected:'#721c24'};
  const statusBg={Pending:'#fef3cd',Confirmed:'#d1ecf1',Preparing:'#fff3cd',Completed:'#d4edda',Received:'#c8e6c9',Rejected:'#f8d7da'};
  const stEl=document.getElementById('statusBreakdown');
  if(stEl)stEl.innerHTML=statuses.map(function(s){const cnt=allActive.filter(o=>o.status===s).length;return'<div style="display:flex;align-items:center;justify-content:space-between;padding:0.45rem 0.75rem;background:'+statusBg[s]+';border-radius:6px;margin-bottom:0.4rem;"><span style="font-size:0.82rem;font-weight:500;color:'+statusColors[s]+';">'+s+'</span><span style="font-size:0.9rem;font-weight:700;color:'+statusColors[s]+';">'+cnt+'</span></div>';}).join('')+'<div style="margin-top:0.5rem;padding:0.45rem 0.75rem;background:#e2e3e5;border-radius:6px;display:flex;justify-content:space-between;"><span style="font-size:0.82rem;font-weight:500;color:#41464b;">Archived</span><span style="font-size:0.9rem;font-weight:700;color:#41464b;">'+Object.keys(archivedOrdersMap).length+'</span></div>';
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

function drawRevenueChart(archived){
  const canvas=document.getElementById('revenueChart');if(!canvas)return;
  const W=canvas.offsetWidth||500,H=180;canvas.width=W;canvas.height=H;
  const ctx=canvas.getContext('2d');ctx.clearRect(0,0,W,H);
  const days=[],today2=new Date();
  for(let i=29;i>=0;i--){const d=new Date(today2);d.setDate(today2.getDate()-i);days.push(d.toISOString().slice(0,10));}
  const revByDay={},cntByDay={};days.forEach(d=>{revByDay[d]=0;cntByDay[d]=0;});
  archived.filter(o=>o&&!o.voided&&o.prevStatus!=='Rejected'&&o.status!=='Rejected').forEach(function(o){const _t=o.timestamp||Date.parse(o.date)||o.archivedAt||0;const d=new Date(_t).toISOString().slice(0,10);if(revByDay[d]!==undefined){revByDay[d]+=(o.total||0);cntByDay[d]++;}});
  const revVals=days.map(d=>revByDay[d]),cntVals=days.map(d=>cntByDay[d]);
  const maxRev=Math.max(...revVals,1),maxCnt=Math.max(...cntVals,1);
  const pad={l:40,r:10,t:10,b:30},chartW=W-pad.l-pad.r,chartH=H-pad.t-pad.b,gap=chartW/days.length,barW=gap*0.6;
  ctx.strokeStyle='rgba(0,0,0,0.07)';ctx.lineWidth=1;
  [0,0.25,0.5,0.75,1].forEach(function(pct){const y=pad.t+chartH*(1-pct);ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(W-pad.r,y);ctx.stroke();ctx.fillStyle='#79806f';ctx.font='10px Inter,sans-serif';ctx.textAlign='right';ctx.fillText('₱'+(maxRev*pct/1000).toFixed(0)+'k',pad.l-4,y+3);});
  revVals.forEach(function(val,i){const x=pad.l+i*gap+gap*0.2,bh=val/maxRev*chartH;ctx.fillStyle='rgba(176,141,87,0.75)';ctx.fillRect(x,pad.t+chartH-bh,barW,bh);});
  ctx.strokeStyle='#3b8fd4';ctx.lineWidth=2;ctx.beginPath();
  cntVals.forEach(function(val,i){const x=pad.l+i*gap+gap*0.5,y=pad.t+chartH*(1-val/maxCnt);i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);});ctx.stroke();
  ctx.fillStyle='#3b8fd4';cntVals.forEach(function(val,i){const x=pad.l+i*gap+gap*0.5,y=pad.t+chartH*(1-val/maxCnt);ctx.beginPath();ctx.arc(x,y,3,0,Math.PI*2);ctx.fill();});
  ctx.fillStyle='#79806f';ctx.font='9px Inter,sans-serif';ctx.textAlign='center';
  days.forEach(function(d,i){if(i%5===0||i===29)ctx.fillText(d.slice(5),pad.l+i*gap+gap*0.5,H-8);});
}

// ── ARCHIVE PDF ──
window.downloadArchivePDF=function(){
  const fromVal=document.getElementById('archiveFrom').value,toVal=document.getElementById('archiveTo').value;
  let orders=Object.values(archivedOrdersMap).sort((a,b)=>(b.archivedAt||0)-(a.archivedAt||0));
  if(fromVal)orders=orders.filter(o=>new Date(o.archivedAt||0)>=new Date(fromVal));
  if(toVal)orders=orders.filter(o=>new Date(o.archivedAt||0)<=new Date(toVal+'T23:59:59'));
  if(!orders.length){alert('No archived orders found for the selected date range.');return;}
  const rejCnt=orders.filter(o=>o.prevStatus==='Rejected').length;const totalRev=orders.filter(o=>o.prevStatus!=='Rejected').reduce((s,o)=>s+(o.total||0),0);
  const gcashCnt=orders.filter(o=>o.payment==='GCash').length,bankCnt=orders.filter(o=>o.payment==='Bank Transfer').length;
  const rowH=52,headerH=220,pageW=800,totalH=headerH+orders.length*rowH+80;
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
  ctx.textAlign='center';ctx.fillText('Total Revenue: ₱'+totalRev.toLocaleString(),pageW/2,178);
  ctx.textAlign='right';ctx.fillText('GCash: '+gcashCnt+' · Bank: '+bankCnt+(rejCnt?' · Rejected: '+rejCnt:''),pageW-60,178);
  ctx.fillStyle='rgba(224,212,198,0.4)';ctx.font='11px Inter,sans-serif';ctx.textAlign='center';ctx.fillText('Generated: '+new Date().toLocaleDateString('en-PH',{year:'numeric',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'}),pageW/2,198);
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

// ── MISC ADMIN ──
function renderComments(){
  const types=['Complaint','Suggestion','Compliment','Other'];
  const empty={Complaint:'No complaints yet. 🎉',Suggestion:'No suggestions yet.',Compliment:'No compliments yet.',Other:'No other feedback yet.'};
  const color={Complaint:'#c0392b',Suggestion:'#f39c12',Compliment:'#2d9e5f',Other:'#888'};
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
  // Update disabled notes
  ['Gcash','Bdo','Ub','Maya','Bank3','Bank4'].forEach(function(k){
    var note=document.getElementById('chk'+k+'Note');
    if(note)note.style.display=getChk('chk'+k)?'none':'block';
  });
  const data={gcashNum:document.getElementById('editGcashNum').value,gcashName:document.getElementById('editGcashName').value,bdoNum:document.getElementById('editBdoNum').value,bdoName:document.getElementById('editBdoName')?document.getElementById('editBdoName').value:'',ubNum:document.getElementById('editUbNum').value,ubName:document.getElementById('editUbName')?document.getElementById('editUbName').value:'',mayaNum:document.getElementById('editMayaNum').value,mayaName:document.getElementById('editMayaName').value,bank3Label:document.getElementById('editBank3Label').value,bank3Num:document.getElementById('editBank3Num').value,bank3Name:document.getElementById('editBank3Name').value,bank4Label:document.getElementById('editBank4Label').value,bank4Num:document.getElementById('editBank4Num').value,bank4Name:document.getElementById('editBank4Name').value,gcashEnabled:getChk('chkGcash'),bdoEnabled:getChk('chkBdo'),ubEnabled:getChk('chkUb'),mayaEnabled:getChk('chkMaya'),bank3Enabled:getChk('chkBank3'),bank4Enabled:getChk('chkBank4')};
  await set(paymentRef,data);document.getElementById('saveConfirm').style.display='block';setTimeout(function(){document.getElementById('saveConfirm').style.display='none';},3000);
};

let archivePanelOpen=false;
window.toggleArchivePanel=function(){archivePanelOpen=!archivePanelOpen;document.getElementById('archivePanel').style.display=archivePanelOpen?'block':'none';document.getElementById('ordersList').style.display=archivePanelOpen?'none':'block';var btn=document.getElementById('archiveToggleBtn');var hdg=document.getElementById('ordersHeading');if(btn){btn.textContent=archivePanelOpen?'← Back to Orders':'📦 View Archive';}if(hdg){hdg.textContent=archivePanelOpen?'Order Archive':'Active Orders';}subscriptionHub.activate(archivePanelOpen?'archive':'orders');if(archivePanelOpen)renderArchive();};
function renderArchive(){_paintArchive();}
function _paintArchive(){
  const el=document.getElementById('archiveList'),sumEl=document.getElementById('archiveSummary');if(!el)return;
  const fromVal=document.getElementById('archiveFrom').value,toVal=document.getElementById('archiveTo').value;
  let orders=Object.values(archivedOrdersMap).sort((a,b)=>(b.archivedAt||0)-(a.archivedAt||0));
  if(fromVal)orders=orders.filter(o=>new Date(o.archivedAt||0)>=new Date(fromVal));
  if(toVal)orders=orders.filter(o=>new Date(o.archivedAt||0)<=new Date(toVal+'T23:59:59'));
  const rejCnt=orders.filter(o=>o.prevStatus==='Rejected').length;const totalRev=orders.filter(o=>o.prevStatus!=='Rejected').reduce((s,o)=>s+(o.total||0),0),gcashCnt=orders.filter(o=>o.payment==='GCash').length,bankCnt=orders.filter(o=>o.payment==='Bank Transfer').length;
  var hs=subscriptionHub.historyStatus('archivedOrders');
  sumEl.innerHTML='<div style="width:100%;font-size:0.72rem;color:var(--tl);">Loaded '+hs.loaded+' most recent archived order(s). Date filters apply to loaded pages.</div><div><span class="archive-sum-num">'+orders.length+(rejCnt?' <span style="font-size:0.7rem;color:#721c24;">('+rejCnt+' ✗)</span>':'')+'</span><span class="archive-sum-lbl">Orders</span></div><div><span class="archive-sum-num">₱'+totalRev.toLocaleString()+'</span><span class="archive-sum-lbl">Revenue</span></div><div><span class="archive-sum-num">'+gcashCnt+'G / '+bankCnt+'B</span><span class="archive-sum-lbl">GCash / Bank</span></div>';
  var cards=orders.length?orders.map(function(o){var oid=escHtml(o.id);return'<div class="archive-card"><div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:0.4rem;"><div><div style="font-weight:500;font-size:0.88rem;color:var(--bd);">'+escHtml(o.name)+' <span style="font-size:0.72rem;color:var(--tl);">#'+oid+'</span></div><div style="font-size:0.75rem;color:var(--tl);">'+escHtml(o.date)+' · '+escHtml(o.time)+'</div></div>'+(o.prevStatus==='Rejected'?'<span class="badge badge-rejected">🔴 Rejected</span>':'<span class="badge badge-archived">📦 Archived</span>')+'</div><div style="font-size:0.8rem;color:var(--tm);margin:0.3rem 0;">🛒 '+escHtml(o.items)+'</div><div style="font-size:0.78rem;color:var(--tl);">₱'+(Number(o.total)||0).toLocaleString()+' · '+escHtml(o.payment)+' · '+escHtml(o.type)+'</div><div style="font-size:0.72rem;color:var(--tl);margin-top:0.3rem;">Archived: '+escHtml(o.archivedDate||'—')+'</div>'+(adminLoggedIn?'<div style="margin-top:0.5rem;text-align:right;"><button data-delarch="'+oid+'" style="background:#fdecea;border:1px solid #f5c6c6;color:#c0392b;border-radius:4px;padding:0.3rem 0.7rem;font-size:0.74rem;cursor:pointer;font-weight:600;">🗑 Delete permanently</button></div>':'')+'</div>';}).join(''):'<p style="color:var(--tl);text-align:center;padding:1.5rem;font-size:0.88rem;">No archived orders in the loaded pages for this range.</p>';
  el.innerHTML=cards+'<div style="text-align:center;padding:0.8rem;"><button id="archiveLoadOlder" class="pz-btn sec"'+(hs.hasOlder?'':' disabled')+'>'+(hs.hasOlder?'Load 100 older orders':'All loaded orders reached')+'</button></div>';
  var more=document.getElementById('archiveLoadOlder');if(more&&hs.hasOlder)more.onclick=async function(){more.disabled=true;more.textContent='Loading older orders…';try{await subscriptionHub.loadOlder('archivedOrders');}catch(e){more.textContent='Could not load older orders';more.disabled=false;}};
  el.querySelectorAll('button[data-delarch]').forEach(function(btn){btn.addEventListener('click',function(){var oid=this.getAttribute('data-delarch');var o=archivedOrdersMap[oid];showDeletePopup('PERMANENTLY delete order #'+oid+(o&&o.name?' ('+o.name+')':'')+'. This removes it from all records and reports and cannot be undone.',async function(){await remove(ref(db,'archivedOrders/'+oid));delete archivedOrdersMap[oid];renderArchive();});});});
}

window.openResContactPopup=function(id){
  const r=adminResMap[id];if(!r)return;
  const pref=(r.contactMethod||'call').toLowerCase();
  const prefLabels={whatsapp:'💬 WhatsApp',viber:'📱 Viber',sms:'📩 SMS',call:'📞 Phone Call',email:'📧 Email'};
  const contactRaw=r.contact||r.phone||'';
  const email=/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactRaw)?contactRaw:'';
  const phone=(contactRaw.includes('@')?(r.phone||''):contactRaw).replace(/\D/g,'').replace(/^0/,'');
  const msg=encodeURIComponent('Hi '+r.name+'! 😊 Your reservation at Accaza Coffee House has been accepted!\n\n📅 Date: '+r.date+'\n🕐 Time: '+r.time+'\n👥 Guests: '+r.guests+(r.occasion?' · '+r.occasion:'')+'\n📍 Saratoga Ave, La Mediterranea, Dasmariñas, Cavite\n\nWe look forward to seeing you! ☕🐻\n— Accaza Coffee House');
  document.getElementById('resContactInfo').innerHTML='<p><strong>'+escHtml(r.name)+'</strong> · '+Math.max(1,Math.min(50,parseInt(r.guests)||1))+' guests · '+escHtml(r.date)+' · '+escHtml(r.time)+'</p><p>📱 '+escHtml(contactRaw||r.phone)+'</p><p style="color:#2d6a4f;font-weight:600;">⭐ Preferred contact: '+(prefLabels[pref]||'📞 Phone')+'</p>';
  const hl=function(m){return pref===m?'box-shadow:0 0 0 3px rgba(45,158,95,0.55);':'opacity:0.85;';};
  let btns='';
  btns+='<a href="https://wa.me/63'+phone+'?text='+msg+'" target="_blank" rel="noopener noreferrer" style="'+hl('whatsapp')+'background:#25D366;color:#fff;border-radius:6px;padding:0.5rem 0.9rem;font-size:0.8rem;text-decoration:none;">💬 WhatsApp'+(pref==='whatsapp'?' ⭐':'')+'</a>';
  btns+='<a href="viber://chat?number=%2B63'+phone+'&text='+msg+'" style="'+hl('viber')+'background:#7360f2;color:#fff;border-radius:6px;padding:0.5rem 0.9rem;font-size:0.8rem;text-decoration:none;">📱 Viber'+(pref==='viber'?' ⭐':'')+'</a>';
  btns+='<a href="sms:+63'+phone+'?body='+msg+'" style="'+hl('sms')+'background:#44523f;color:#fff;border-radius:6px;padding:0.5rem 0.9rem;font-size:0.8rem;text-decoration:none;">📩 SMS'+(pref==='sms'?' ⭐':'')+'</a>';
  btns+='<a href="tel:+63'+phone+'" style="'+hl('call')+'background:#0c5460;color:#fff;border-radius:6px;padding:0.5rem 0.9rem;font-size:0.8rem;text-decoration:none;">📞 Call'+(pref==='call'?' ⭐':'')+'</a>';
  if(email)btns+='<a href="mailto:'+encodeURIComponent(email)+'?subject=Your%20Accaza%20Reservation&body='+msg+'" style="'+hl('email')+'background:#856404;color:#fff;border-radius:6px;padding:0.5rem 0.9rem;font-size:0.8rem;text-decoration:none;">📧 Email'+(pref==='email'?' ⭐':'')+'</a>';
  document.getElementById('resContactBtns').innerHTML=btns;
  document.getElementById('resContactPopup').classList.add('show');
};

let resArchiveOpen=false;
window.toggleResArchivePanel=function(){resArchiveOpen=!resArchiveOpen;document.getElementById('resArchivePanel').style.display=resArchiveOpen?'block':'none';document.getElementById('resList').style.display=resArchiveOpen?'none':'block';var btn=document.getElementById('resArchiveToggleBtn'),hdg=document.getElementById('resHeading');if(btn)btn.textContent=resArchiveOpen?'← Back to Reservations':'📦 View Archive';if(hdg)hdg.textContent=resArchiveOpen?'Reservation Archive':'Reservations';if(resArchiveOpen)renderResArchive();};

function filteredResArchive(){
  const fromVal=document.getElementById('resArchiveFrom').value,toVal=document.getElementById('resArchiveTo').value;
  let list=Object.values(archivedResMap).sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  if(fromVal)list=list.filter(r=>(r.date||'')>=fromVal);
  if(toVal)list=list.filter(r=>(r.date||'')<=toVal);
  return list;
}
window.renderResArchive=function(){
  const el=document.getElementById('resArchiveList'),sumEl=document.getElementById('resArchiveSummary');
  const list=filteredResArchive();
  const totalGuests=list.filter(r=>r.prevStatus!=='Declined').reduce((s,r)=>s+(parseInt(r.guests)||0),0);
  const declinedCnt=list.filter(r=>r.prevStatus==='Declined').length;
  sumEl.innerHTML='<div><span class="archive-sum-num">'+list.length+'</span><span class="archive-sum-lbl">Reservations</span></div><div><span class="archive-sum-num">'+totalGuests+'</span><span class="archive-sum-lbl">Guests Served</span></div><div><span class="archive-sum-num">'+declinedCnt+'</span><span class="archive-sum-lbl">Declined</span></div>';
  if(!list.length){el.innerHTML='<p style="color:var(--tl);text-align:center;padding:1.5rem;font-size:0.88rem;">No archived reservations for selected range.</p>';return;}
  el.innerHTML=list.map(function(r){var guests=Math.max(1,Math.min(50,parseInt(r.guests)||1));return'<div class="archive-card"><div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:0.4rem;"><div><div style="font-weight:500;font-size:0.88rem;color:var(--bd);">'+escHtml(r.name)+' <span style="font-size:0.72rem;color:var(--tl);">#'+escHtml(r.id)+'</span></div><div style="font-size:0.75rem;color:var(--tl);">'+escHtml(r.date)+' · '+escHtml(r.time)+' · '+guests+' guests'+(r.occasion?' · '+escHtml(r.occasion):'')+'</div></div>'+(r.prevStatus==='Declined'?'<span class="badge badge-declined">Declined</span>':'<span class="badge badge-archived">📦 Archived</span>')+'</div>'+(r.notes?'<div style="font-size:0.8rem;color:var(--tm);margin:0.3rem 0;">📝 '+escHtml(r.notes)+'</div>':'')+'<div style="font-size:0.72rem;color:var(--tl);margin-top:0.3rem;">Archived: '+escHtml(r.archivedDate||'—')+'</div></div>';}).join('');
};
window.printResArchive=function(){
  const fromVal=document.getElementById('resArchiveFrom').value,toVal=document.getElementById('resArchiveTo').value;
  const list=filteredResArchive().slice().sort((a,b)=>(a.date||'').localeCompare(b.date||''));
  if(!list.length){alert('No archived reservations found for the selected date range.');return;}
  const totalGuests=list.filter(r=>r.prevStatus!=='Declined').reduce((s,r)=>s+(parseInt(r.guests)||0),0);
  const declinedCnt=list.filter(r=>r.prevStatus==='Declined').length;
  const rowH=44,headerH=220,pageW=800,totalH=headerH+list.length*rowH+80;
  const canvas=document.createElement('canvas');canvas.width=pageW;canvas.height=totalH;
  const ctx=canvas.getContext('2d');
  ctx.fillStyle='#e0d4c6';ctx.fillRect(0,0,pageW,totalH);
  ctx.fillStyle='#19241b';ctx.fillRect(0,0,pageW,headerH);
  ctx.fillStyle='#c9a36a';ctx.font='bold 28px Georgia,serif';ctx.textAlign='center';ctx.fillText('Accaza Coffee House',pageW/2,55);
  ctx.fillStyle='rgba(224,212,198,0.7)';ctx.font='14px Inter,sans-serif';ctx.fillText('Saratoga Ave, La Mediterranea, Dasmariñas, Cavite',pageW/2,82);
  ctx.fillStyle='#fff';ctx.font='bold 18px Georgia,serif';ctx.fillText('Reservation Archive Report',pageW/2,118);
  const dateRange=fromVal&&toVal?fromVal+' to '+toVal:fromVal?'From '+fromVal:toVal?'Up to '+toVal:'All Time';
  ctx.fillStyle='rgba(224,212,198,0.6)';ctx.font='12px Inter,sans-serif';ctx.fillText(dateRange,pageW/2,140);
  ctx.fillStyle='rgba(255,255,255,0.1)';ctx.fillRect(40,156,pageW-80,48);
  ctx.fillStyle='#c9a36a';ctx.font='bold 14px Inter,sans-serif';ctx.textAlign='left';ctx.fillText('Total Reservations: '+list.length,60,178);
  ctx.textAlign='center';ctx.fillText('Guests Served: '+totalGuests,pageW/2,178);
  ctx.textAlign='right';ctx.fillText('Declined: '+declinedCnt,pageW-60,178);
  ctx.fillStyle='rgba(224,212,198,0.4)';ctx.font='11px Inter,sans-serif';ctx.textAlign='center';ctx.fillText('Generated: '+new Date().toLocaleDateString('en-PH',{year:'numeric',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'}),pageW/2,198);
  let y=headerH+16;
  ctx.fillStyle='#19241b';ctx.font='bold 11px Inter,sans-serif';ctx.textAlign='left';
  ['Res ID','Name','Date','Time','Guests','Occasion','Status'].forEach(function(h,i){ctx.fillText(h,[40,140,300,400,500,560,690][i],y);});
  ctx.strokeStyle='#cdbda7';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(40,y+8);ctx.lineTo(pageW-40,y+8);ctx.stroke();
  y+=rowH*0.6;
  list.forEach(function(r,idx){
    if(idx%2===0){ctx.fillStyle='rgba(176,141,87,0.06)';ctx.fillRect(40,y-14,pageW-80,rowH);}
    ctx.fillStyle='#1c2420';ctx.font='11px Inter,sans-serif';ctx.textAlign='left';
    ctx.fillText((r.id||'—'),40,y+4);
    ctx.fillText((r.name||'—').slice(0,18),140,y+4);
    ctx.fillText((r.date||'—'),300,y+4);
    ctx.fillText((r.time||'—').slice(0,14),400,y+4);
    ctx.fillText(String(r.guests||'—'),500,y+4);
    ctx.fillText((r.occasion||'—').slice(0,16),560,y+4);
    ctx.fillStyle=r.prevStatus==='Declined'?'#c0392b':'#155724';ctx.font='bold 11px Inter,sans-serif';
    ctx.fillText(r.prevStatus||'Completed',690,y+4);
    ctx.strokeStyle='#cdbda7';ctx.lineWidth=0.5;ctx.beginPath();ctx.moveTo(40,y+rowH-14);ctx.lineTo(pageW-40,y+rowH-14);ctx.stroke();
    y+=rowH;
  });
  ctx.fillStyle='#19241b';ctx.fillRect(0,totalH-40,pageW,40);
  ctx.fillStyle='rgba(224,212,198,0.5)';ctx.font='11px Inter,sans-serif';ctx.textAlign='center';ctx.fillText('Accaza Coffee House · Confidential · For internal use only',pageW/2,totalH-14);
  const w=window.open('','_blank');
  if(!w){const link=document.createElement('a');link.download='Accaza_Reservations_'+new Date().toISOString().slice(0,10)+'.png';link.href=canvas.toDataURL('image/png');link.click();return;}
  w.document.write('<html><head><title>Reservation Archive — Accaza Coffee House</title></head><body style="margin:0;"><img src="'+canvas.toDataURL('image/png')+'" style="width:100%;" onload="setTimeout(function(){window.print();},400);"/></body></html>');
  w.document.close();
};

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

// ── ROLE SELECTOR (visual choice; actual role comes from /admins/{Firebase UID}) ──
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

// ── LOGIN SUCCESS ───────────────────────────────────────────
var DEFAULT_STAFF_PERMS={orders:true,reservations:true,pos:true,inventory:true,purchases:false,recipes:true,usage:true,registerOps:true,availability:true,comments:true,reviews:true,appcustomers:true,analytics:false,pnl:false,dailyreport:false,discrepancy:false,petty:true,channelpricing:false,dedupe:false,cashflow:false,receivables:false,payables:false,stockvalue:false};
var _permTabMap={"'orders'":'orders',"'reservations'":'reservations',"'calendar'":'reservations',"'reviews'":'reviews',"'appcustomers'":'appcustomers',"'pos'":'pos',"'inventory'":'inventory',"'purchases'":'purchases',"'recipes'":'recipes',"'usage'":'usage',"'discrepancy'":'discrepancy',"'petty'":'petty',"'channelpricing'":'channelpricing',"'dedupe'":'dedupe',"'cashflow'":'cashflow',"'receivables'":'receivables',"'payables'":'payables',"'stockvalue'":'stockvalue',"'dailyreport'":'dailyreport',"'analytics'":'analytics',"'pnl'":'pnl',"'ops'":'registerOps'};
var _permAlwaysHide=["'payment'","'staffaccounts'","'adminaccounts'","'staffaccess'","'packages'"];
window.showAdminSection=function(id){
  var av=document.getElementById('availSection'),cm=document.getElementById('commentsSection');
  if(id==='availSection'){ if(cm)cm.style.display='none'; if(av)av.style.display='block'; if(typeof buildAvail==='function')buildAvail(); if(av)av.scrollIntoView({behavior:'smooth'}); }
  else if(id==='commentsSection'){ if(av)av.style.display='none'; if(cm)cm.style.display='block'; if(typeof renderComments==='function')renderComments(); if(cm)cm.scrollIntoView({behavior:'smooth'}); }
  else { if(av)av.style.display='none'; if(cm)cm.style.display='none'; window.scrollTo({top:0,behavior:'smooth'}); }
};
function applyStaffPerms(perms){
  document.querySelectorAll('.admin-tab').forEach(function(btn){
    var oc=btn.getAttribute('onclick')||'';
    if(_permAlwaysHide.some(function(t){return oc.indexOf(t)!==-1;})){btn.style.display='none';return;}
    for(var k in _permTabMap){ if(oc.indexOf(k)!==-1){ btn.style.display=perms[_permTabMap[k]]?'':'none'; return; } }
  });
  var na=document.getElementById('navAvail'); if(na)na.style.display=perms.availability?'block':'none';
  var nc=document.getElementById('navComments'); if(nc)nc.style.display=perms.comments?'block':'none';
  // hide any group whose tabs are all hidden, then land on the first visible group
  document.querySelectorAll('.admin-group').forEach(function(gb){var g=gb.getAttribute('data-grp');var row=document.querySelector('.tabgrp[data-grp="'+g+'"]');var vis=false;if(row)row.querySelectorAll('.admin-tab').forEach(function(b){if(b.style.display!=='none')vis=true;});gb.style.display=vis?'':'none';});
  var curG=document.querySelector('.admin-group.active');
  if(!curG||curG.style.display==='none'){var fg=null;document.querySelectorAll('.admin-group').forEach(function(gb){if(!fg&&gb.style.display!=='none')fg=gb;});if(fg)window.showTabGroup(fg.getAttribute('data-grp'),fg);}
}
async function loginSuccess(role,username,uid,serverRole){
  currentUser={role:role,serverRole:serverRole||role,username:username,uid:uid};
  window.__accazaAuthz={uid:uid,role:serverRole||role,isPrivileged:role==='admin'||role==='superadmin'};
  subscriptionHub.authorize();
  subscriptionHub.activate('dashboard');
  ensureActiveOrdersCall({}).catch(function(e){console.warn('Active-order projection sweep deferred',e&&e.code);});
  try{sessionStorage.setItem('accaza_admin_session',JSON.stringify({username:username,uid:uid||null}));}catch(e){}
  try{if(!audioCtx)audioCtx=new(window.AudioContext||window.webkitAudioContext)();if(audioCtx.state==='suspended')audioCtx.resume();}catch(e){}
  document.getElementById('adminUser').value='';
  document.getElementById('adminPass').value='';
  closeAdmin();
  document.body.classList.remove('staff-mode');
  // Reset tab visibility
  document.querySelectorAll('.admin-tab').forEach(function(t){t.style.removeProperty('display');});
  var aaccTab=document.getElementById('tabBtnAdminAccounts');
  if(aaccTab)aaccTab.style.display='none';

  if(role==='superadmin'||role==='admin'){
    adminLoggedIn=true;superAdminLoggedIn=(role==='superadmin');staffLoggedIn=false;
    document.getElementById('adminDash').style.display='block';
    ['navAvail','navComments','navAdminPanel'].forEach(function(id){document.getElementById(id).style.display='block';});
    document.getElementById('navAdminPanelLink').textContent='🔐 Admin Panel';
    if(superAdminLoggedIn&&aaccTab)aaccTab.style.removeProperty('display');
    var hdr=document.querySelector('#adminDash .admin-header p');
    if(hdr)hdr.textContent=(superAdminLoggedIn?'👑 Super Admin':'🔑 Admin')+': '+username;
    // Restrict Payment Details for limited admins
    if(role==='admin'&&uid&&adminAccountsMap[uid]&&adminAccountsMap[uid].access==='nopay'){
      document.querySelectorAll('.admin-tab').forEach(function(btn){
        var oc=btn.getAttribute('onclick')||'';
        if(oc.indexOf("'payment'")!==-1)btn.style.display='none';
      });
      var tpay=document.getElementById('tab-payment');if(tpay)tpay.style.display='none';
      if(hdr)hdr.textContent='🔑 Admin: '+username+' · Limited access';
    }
    setTimeout(function(){
      buildAvail();renderCategoryManager();renderOptionManager();renderNewItemOptionChecklist();renderComments();renderOrders();renderReservations();
      renderAdminReviews();renderAdminCalendar();renderDashboard();renderStaffAccounts();
      if(superAdminLoggedIn)renderAdminAccounts();
    },300);
  }else{
    // Staff
    staffLoggedIn=true;adminLoggedIn=false;superAdminLoggedIn=false;
    document.body.classList.add('staff-mode');
    document.getElementById('adminDash').style.display='block';
    document.getElementById('navAdminPanel').style.display='block';
    document.getElementById('navComments').style.display='block';
    document.getElementById('navAdminPanelLink').textContent='🔐 Staff Panel';
    (function(){ applyStaffPerms(Object.assign({},DEFAULT_STAFF_PERMS)); get(ref(db,'adminPerms/'+uid)).then(function(sn){ var v=sn.val(); if(v)applyStaffPerms(Object.assign({},DEFAULT_STAFF_PERMS,v)); }).catch(function(){}); })();
    var hdr=document.querySelector('#adminDash .admin-header p');
    if(hdr)hdr.textContent='👤 Staff: '+username;
    setTimeout(function(){
      renderOrders();renderReservations();renderAdminCalendar();renderDashboard();
      renderAdminReviews();renderComments();renderStaffMenu();
    },300);
  }
  window.scrollTo(0,0);
}

// ── CHECK LOGIN ─────────────────────────────────────────────
function portalRole(raw){
  var r=raw===true?'owner':(typeof raw==='string'?raw:((raw&&raw.role)||''));
  r=String(r||'').toLowerCase();
  if(['owner','superadmin','admin','manager'].indexOf(r)>-1)return {ui:'admin',server:r};
  if(['staff','cashier','kitchen','finance'].indexOf(r)>-1)return {ui:'staff',server:r};
  return null;
}
var authGateResolved=false,portalAuthPromise=null,portalAuthUid=null;
window.__accazaAuthGateReady=function(){return authGateResolved;};
async function authorizePortalUser(user){
  if(portalAuthUid===user.uid&&window.__accazaAuthz)return;
  if(portalAuthPromise)return portalAuthPromise;
  portalAuthPromise=(async function(){
    var results=await Promise.all([get(ref(db,'admins/'+user.uid)),get(ref(db,'adminPerms/'+user.uid+'/name')).catch(function(){return null;})]);
    var roleSnap=results[0],nameSnap=results[1];
    var mapped=roleSnap.exists()?portalRole(roleSnap.val()):null;
    if(!mapped)throw new Error('This Firebase account is not authorized for the Accaza portal.');
    var display=(user.displayName||user.email||user.uid);
    if(nameSnap&&nameSnap.exists()&&nameSnap.val())display=nameSnap.val();
    await loginSuccess(mapped.ui,display,user.uid,mapped.server);
    portalAuthUid=user.uid;
    authGateResolved=true;
    if(location.hash)setTimeout(function(){var t=document.getElementById(location.hash.slice(1));if(t)t.scrollIntoView();},450);
  })();
  try{return await portalAuthPromise;}finally{portalAuthPromise=null;}
}
onAuthStateChanged(auth,async function(user){
  if(!user){authGateResolved=true;portalAuthUid=null;currentUser=null;window.__accazaAuthz=null;subscriptionHub.deauthorize();return;}
  try{
    await authorizePortalUser(user);
  }catch(e){
    authGateResolved=true;console.error('ACCAZA AUTHORIZATION ERROR',e);try{await signOut(auth);}catch(_so){}
    try{sessionStorage.removeItem('accaza_admin_session');}catch(_ss){}
    var le=document.getElementById('loginErr');if(le){le.textContent=(e&&e.message)||'This account is not authorized.';le.style.display='block';le.style.whiteSpace='normal';}
    openAdmin();
  }
});
window.checkLogin=async function(){
  var username=(document.getElementById('adminUser').value||'').trim().toLowerCase();
  var pass=document.getElementById('adminPass').value;
  var _le=document.getElementById('loginErr');
  var _btn=document.getElementById('adminLoginBtn');
  if(!username||username.indexOf('@')<1||!pass){_le.textContent='Enter your Firebase account email and password.';_le.style.display='block';return;}
  _le.style.display='none';
  if(_btn){_btn.disabled=true;_btn.textContent='Signing in…';}
  try{try{await setPersistence(auth,browserLocalPersistence);}catch(_p){}var cred=await signInWithEmailAndPassword(auth,username,pass);await authorizePortalUser(cred.user);}
  catch(_e){console.error('ACCAZA AUTH ERROR',_e);_le.textContent=(_e&&_e.message&&_e.message.indexOf('not authorized')>-1)?_e.message:'Login failed. Check the email and password.';_le.style.display='block';document.getElementById('adminPass').value='';}
  finally{if(_btn){_btn.disabled=false;_btn.textContent='Log In';}}
};

window.logoutAdmin=function(){
  try{sessionStorage.removeItem('accaza_admin_session');}catch(e){}
  adminLoggedIn=false;superAdminLoggedIn=false;staffLoggedIn=false;currentUser=null;currentLoginRole=null;window.__accazaAuthz=null;
  subscriptionHub.deauthorize();
  var _go=function(){window.location.href='index.html';};
  try{ signOut(auth).then(_go).catch(_go); }catch(e){ _go(); }
};
window.switchTab=function(tab,btn){
  if(tab==='payment'&&currentUser&&currentUser.role==='admin'&&currentUser.uid&&adminAccountsMap[currentUser.uid]&&adminAccountsMap[currentUser.uid].access==='nopay'){alert('⛔ You do not have access to Payment Details.');return;}
  subscriptionHub.activate(tab);
  document.querySelectorAll('.admin-tab').forEach(function(b){b.classList.remove('active');});
  if(btn)btn.classList.add('active');
  document.querySelectorAll('.admin-tab-content').forEach(function(t){t.style.display='none';});
  document.getElementById('tab-'+tab).style.display='block';
  if(tab==='orders')clearOrderAlert();
  if(tab==='orders')renderOrders();
  if(tab==='reviews')renderAdminReviews();
  if(tab==='calendar')renderAdminCalendar();
  if(tab==='dashboard')renderDashboard();
  if(tab==='appcustomers')renderAppCustomers();
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

// ── CHATBOT ──
const botReplies=[
  {keys:['hour','open','close','time','schedule'],reply:'🕐 We are open every day — <strong>Monday to Sunday, 3:00 PM to 12:00 Midnight</strong>. ☕'},
  {keys:['location','address','where','find'],reply:"📍 <strong>Saratoga Avenue, La Mediterranea Subdivision, Governor's Drive, Dasmariñas, Cavite</strong>. Near SM Dasmariñas! 😊"},
  {keys:['gcash','pay','payment','bank','bdo'],reply:'💳 We accept <strong>GCash, BDO, and UnionBank</strong>. GCash: <strong>0927 692 4831</strong> (ACCAZA).'},
  {keys:['delivery','deliver'],reply:'🛵 We deliver within <strong>Dasmariñas, Cavite</strong> only. Outside? Try <strong>🟠 foodpanda</strong> or <strong>🟢 GrabFood</strong>.'},
  {keys:['menu','food','drink','coffee','frappe','pastry'],reply:'🍽️ We serve <strong>Coffee, Non-Coffee, Iced Blended, Soda Refreshers, and Pastries</strong>. Check our menu above! ☕'},
  {keys:['reserve','reservation','book','table'],reply:'📅 Use our <strong>Reservations section</strong> — pick a date, time slot, and fill in your details. Our staff will confirm! 😊'},
  {keys:['wifi','internet'],reply:'📶 Yes, we have free WiFi! Ask our staff for the password. 😊'},
  {keys:['price','cost','how much'],reply:'💰 Prices start from <strong>₱95 for pastries</strong> and <strong>₱155 for coffee</strong>. Check our menu! ☕'},
  {keys:['parking','park'],reply:'🚗 Yes, we have parking available! 😊'},
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

// ── INIT ──
renderCustomerCalendar();
renderCustomerOrders();
const nm=new Date();
const archFrom=document.getElementById('archiveFrom'),archTo=document.getElementById('archiveTo');
if(archFrom)archFrom.value=new Date(nm.getFullYear(),nm.getMonth(),1).toISOString().slice(0,10);
if(archTo)archTo.value=nm.toISOString().slice(0,10);
// Trigger initial menu render after short delay for Firebase
setTimeout(function(){if(Object.keys(menuItemsMap).length)renderMenuSection();},1000);
// ── Pricing Type Toggle ─────────────────────────────────────────────────────
window.setPricingType = function(type) {
  var sized = document.getElementById('priceSizedFields');
  var two   = document.getElementById('priceTwoFields');
  var flat  = document.getElementById('priceFlatField');
  // hide all first
  sized.style.display = 'none';
  two.style.display   = 'none';
  flat.style.display  = 'none';
  // clear all fields
  ['newItemPriceS','newItemPriceM','newItemPriceL'].forEach(function(id){ var el=document.getElementById(id); if(el) el.value=''; });
  ['newItemPriceTwoS','newItemPriceTwoL','newItemLabelS','newItemLabelL'].forEach(function(id){ var el=document.getElementById(id); if(el) el.value=''; });
  var flatEl = document.getElementById('newItemPriceFlat'); if(flatEl) flatEl.value='';
  // show correct section
  if (type === 'two')  { two.style.display  = 'grid'; }
  else if (type === 'flat') { flat.style.display = 'block'; }
  else { sized.style.display = 'grid'; }
};
// ── Gallery Lightbox ────────────────────────────────────────────────────────
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
// ── Hamburger menu ──────────────────────────────────────────────────────────
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
// ── Print Order as Kitchen Ticket ──────────────────────────────────────────
window.printOrder = function(orderId) {
  var o = adminOrdersMap[orderId];
  if (!o) return;
  var isDelivery = o.type === 'Delivery';
  var now = new Date();
  var printTime = now.toLocaleString('en-PH', { month:'short', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit', hour12:true });
  var itemsHtml = (o.items || '').split(',').map(function(s){ return '<div>' + s.trim() + '</div>'; }).join('');
  var addrRow = (isDelivery && o.address) ? '<div class="row"><span class="lbl">Address</span><span>' + o.address + '</span></div>' : '';
  var schedRow = (o.date || o.time) ? '<div class="row"><span class="lbl">Schedule</span><span>' + (o.date||'') + ' ' + (o.time||'') + '</span></div>' : '';
  var notesRow = o.notes ? '<div class="row"><span class="lbl">Notes</span><span>' + o.notes + '</span></div><hr/>' : '';
  var ticketHtml = '<!DOCTYPE html><html><head><meta charset="UTF-8"/><title>Order #' + o.id + ' — Kitchen Ticket</title>'
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
    + '<div class="logo">☕ ACCAZA</div>'
    + '<div class="sub">Coffee House — Kitchen Ticket</div>'
    + '<hr/>'
    + '<div class="row"><span class="lbl">Order #</span><span>' + o.id + '</span></div>'
    + '<div class="row"><span class="lbl">Printed</span><span>' + printTime + '</span></div>'
    + '<hr/>'
    + '<div class="row"><span class="lbl">Customer</span><span>' + (o.name||'—') + '</span></div>'
    + '<div class="row"><span class="lbl">Contact</span><span>' + (o.phone||'—') + (o.contact?' / '+o.contact:'') + '</span></div>'
    + '<div class="badge">' + (isDelivery ? '🛵 DELIVERY' : '🏠 PICK-UP') + '</div>'
    + addrRow + schedRow
    + '<hr/>'
    + '<div class="lbl">Items:</div>'
    + '<div class="items">' + itemsHtml + '</div>'
    + '<hr/>'
    + notesRow
    + '<div class="row"><span class="lbl">On Duty</span><span>' + (o.onDuty||o.staff||'—') + '</span></div>'
    + '<div class="row"><span class="lbl">Payment</span><span>' + (o.payment||'—') + '</span></div>'
    + '<div class="total">TOTAL: ₱' + (o.total||0).toLocaleString() + '</div>'
    + '<hr/>'
    + '<div class="footer">— Thank you! Pass this to the kitchen. —</div>'
    + '</body></html>';
  var win = window.open('', '_blank', 'width=440,height=640');
  win.document.write(ticketHtml);
  win.document.close();
  win.focus();
  setTimeout(function() { win.print(); }, 400);
};
