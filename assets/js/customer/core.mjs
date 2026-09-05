import{initializeApp}from"https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import{getDatabase,ref,get,set,push,update,remove,onValue,query,orderByChild,limitToLast}from"https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import{getMessaging,getToken,onMessage,isSupported}from"https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js";
import{getAuth,signInAnonymously,signOut,onAuthStateChanged}from"https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import{getFunctions,httpsCallable}from"https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js";
import{initializeAppCheck,ReCaptchaEnterpriseProvider}from"https://www.gstatic.com/firebasejs/10.12.0/firebase-app-check.js";

const firebaseConfig={apiKey:"AIzaSyAsh6j1T0tC-v2avj1J2mfCDdFG88FcpUM",authDomain:"accaza-sartoga.firebaseapp.com",databaseURL:"https://accaza-sartoga-default-rtdb.asia-southeast1.firebasedatabase.app",projectId:"accaza-sartoga",storageBucket:"accaza-sartoga.firebasestorage.app",messagingSenderId:"315522485228",appId:"1:315522485228:web:64ed3b7facef5a39148ec9"};
const app=initializeApp(firebaseConfig);
const APP_CHECK_SITE_KEY='6LdQ6HstAAAAAGvaa0exDw5aAHxNsrPKCtdlCeis'; // Public reCAPTCHA Enterprise site key registered for the production domain.
if(APP_CHECK_SITE_KEY){try{initializeAppCheck(app,{provider:new ReCaptchaEnterpriseProvider(APP_CHECK_SITE_KEY),isTokenAutoRefreshEnabled:true});}catch(e){console.warn('App Check init failed',e);}}
const db=getDatabase(app);
const auth=getAuth(app);
const functions=getFunctions(app,'asia-southeast1');
const createOnlineOrderCall=httpsCallable(functions,'createOnlineOrder');
const confirmOrderReceivedCall=httpsCallable(functions,'confirmOrderReceived');
const CUSTOMER_LIVE_ORDER_LIMIT=20,CUSTOMER_LIVE_RESERVATION_LIMIT=12;
var myOrdersMap={},_myOrdersSub={},customerUid=null,_customerIndexUnsub=null;
var customerAuthProblem=null,customerAuthRetryTimer=null,customerAuthFailures=0;
var myResMap={},_myResSub={};
let publicOrdersOpen=null,customerLiveConnected=null;
function recentOwnedIds(ids,limit){var seen={},out=[];(ids||[]).forEach(function(id){id=String(id||'');if(!id||seen[id])return;seen[id]=true;out.push(id);});return out.slice(-limit);}
function subscribeMyOrders(){try{var wanted=recentOwnedIds(myOrderIds,CUSTOMER_LIVE_ORDER_LIMIT),keep={};wanted.forEach(function(id){keep[id]=true;});Object.keys(_myOrdersSub).forEach(function(id){if(keep[id])return;try{_myOrdersSub[id]();}catch(e){}delete _myOrdersSub[id];delete myOrdersMap[id];});wanted.forEach(function(id){if(_myOrdersSub[id])return;_myOrdersSub[id]=onValue(ref(db,'orders/'+id),function(s){if(s.exists())myOrdersMap[id]=s.val();else delete myOrdersMap[id];if(typeof renderCustomerOrders==='function')renderCustomerOrders();if(typeof checkMyReadyOrders==='function')checkMyReadyOrders();},function(){});});}catch(e){}}
function subscribeCustomerOrderIndex(uid){try{if(_customerIndexUnsub)_customerIndexUnsub();var ownedQuery=query(ref(db,'customerOrders/'+uid),orderByChild('createdAt'),limitToLast(CUSTOMER_LIVE_ORDER_LIMIT));_customerIndexUnsub=onValue(ownedQuery,function(s){var ids=[];s.forEach(function(child){ids.push(child.key);});myOrderIds=recentOwnedIds(recentOwnedIds(myOrderIds,CUSTOMER_LIVE_ORDER_LIMIT).concat(ids),CUSTOMER_LIVE_ORDER_LIMIT);try{localStorage.setItem('accaza_my_orders',JSON.stringify(myOrderIds));}catch(e){}subscribeMyOrders();});}catch(e){}}
async function ensureCustomerAuth(forceRefresh){
  var user=auth.currentUser;
  if(!user){
    user=await new Promise(function(resolve,reject){
      var done=false;
      var off=onAuthStateChanged(auth,function(u){if(done||!u)return;done=true;off();resolve(u);});
      signInAnonymously(auth).then(function(result){if(!done&&result&&result.user){done=true;off();resolve(result.user);}}).catch(function(e){if(!done){done=true;off();reject(e);}});
      setTimeout(function(){if(!done){done=true;off();reject(new Error('Customer session timed out.'));}},10000);
    });
  }
  var token=await user.getIdToken(forceRefresh===true);
  if(!token)throw new Error('Customer authentication token was not created.');
  return user;
}
window.__subscribeMyOrders=subscribeMyOrders;
function subscribeMyReservations(){try{var wanted=recentOwnedIds(myReservationIds,CUSTOMER_LIVE_RESERVATION_LIMIT),keep={};wanted.forEach(function(id){keep[id]=true;});Object.keys(_myResSub).forEach(function(id){if(keep[id])return;try{_myResSub[id]();}catch(e){}delete _myResSub[id];delete myResMap[id];});wanted.forEach(function(id){if(_myResSub[id])return;_myResSub[id]=onValue(ref(db,'reservations/'+id),function(s){if(s.exists())myResMap[id]=s.val();else delete myResMap[id];if(typeof renderMyReservations==='function')renderMyReservations();},function(){});});}catch(e){}}
window.__subscribeMyReservations=subscribeMyReservations;
function scheduleCustomerAuthRetry(){
  if(customerAuthRetryTimer||!navigator.onLine)return;
  var delay=Math.min(30000,2000*Math.pow(2,Math.min(customerAuthFailures,4)));
  customerAuthRetryTimer=setTimeout(function(){customerAuthRetryTimer=null;attemptCustomerAuth().catch(function(){});},delay);
}
async function attemptCustomerAuth(){
  if(auth.currentUser)return auth.currentUser;
  try{
    var result=await signInAnonymously(auth);
    customerAuthProblem=null;customerAuthFailures=0;
    return result&&result.user;
  }catch(e){
    customerAuthProblem=e||new Error('Firebase sign-in failed.');customerAuthFailures++;
    if(typeof renderPublicOrderStatus==='function')renderPublicOrderStatus();
    scheduleCustomerAuthRetry();
    throw e;
  }
}
window.retryCustomerConnection=function(){
  if(customerAuthRetryTimer){clearTimeout(customerAuthRetryTimer);customerAuthRetryTimer=null;}
  customerAuthProblem=null;
  if(typeof renderPublicOrderStatus==='function')renderPublicOrderStatus();
  return attemptCustomerAuth().catch(function(){(window.accazaToast||window.alert)('We still cannot connect. Please check your internet and try again.');});
};
window.addEventListener('online',function(){attemptCustomerAuth().catch(function(){});});
onAuthStateChanged(auth,function(u){
  if(!u){customerUid=null;attemptCustomerAuth().catch(function(){});return;}
  customerAuthProblem=null;customerAuthFailures=0;
  if(customerAuthRetryTimer){clearTimeout(customerAuthRetryTimer);customerAuthRetryTimer=null;}
  customerUid=u.uid;subscribeCustomerOrderIndex(u.uid);subscribeMyOrders();subscribeMyReservations();
  if(typeof renderPublicOrderStatus==='function')renderPublicOrderStatus();
});

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
    if(token){var u=getAppUser();var au=auth.currentUser;if(u&&au){try{await update(ref(db,'appCustomers/'+au.uid),{pushToken:token,pushTokenAt:Date.now()});if(!window.__pushToasted){window.__pushToasted=true;(window.accazaToast||function(){})('🔔 Notifications on for this device','ok');}}catch(e){}}}
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
const reservationsRef=ref(db,'reservations'),feedbacksRef=ref(db,'feedbacks'),reviewsRef=ref(db,'reviews'),availRef=ref(db,'availability'),paymentRef=ref(db,'payment'),calBlocksRef=ref(db,'calBlocks'),menuRef=ref(db,'menuItems'),categoriesRef=ref(db,'categories'),optionGroupsRef=ref(db,'optionGroups'),publicOrderStatusRef=ref(db,'publicOrderStatus');
window.__custPkgs=[];
window.__accazaC={db:db,ref:ref,set:set,get:get,onValue:onValue,get menuItemsMap(){return menuItemsMap;},get optionGroupsMap(){return optionGroupsMap;},getMenuItems:getMenuItems,getCats:getCats,getCatLabel:getCatLabel,getItemOptionGroups:getItemOptionGroups};
window.__custAddPackage=function(components,meta){(components||[]).forEach(function(c){var key=Date.now()+'_'+Math.random().toString(36).substr(2,5)+Math.floor(Math.random()*99);cart[key]={name:c.name,details:c.details||('pkg: '+meta.name),qty:c.qty,unitTotal:c.unitTotal,cat:c.cat||'',itemKey:c.itemKey,size:c.size||null,optLabels:c.optLabels||[],stream:(meta.type==='promo'?'promo':'events'),pkgId:meta.id,packageRole:c.packageRole||null};});window.__custPkgs.push(meta);updateCartDisplay();renderOrderSection();};

const CAFE_PHONE='639276924831',CAFE_EMAIL='admin@accazacoffee.com',MAX_GUESTS=30;
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
let categoriesMap={},menuItemsMap={},adminResMap={},reviewsMap={},availability={},cart={},categoriesListCache=null,menuItemsListCache=null,catalogRenderPending=false;
function onlineOrderingAvailable(){return publicOrdersOpen&&customerLiveConnected&&!!auth.currentUser&&!customerAuthProblem;}
function syncPlaceOrderButton(){
  var button=document.querySelector('.btn-place-order');if(!button||window._placingOrder)return;
  var open=onlineOrderingAvailable();
  button.disabled=!open;button.style.opacity='';button.setAttribute('aria-disabled',open?'false':'true');
  button.textContent=open?'Place Order':(customerAuthProblem?'Connection unavailable':(publicOrdersOpen===null||customerLiveConnected!==true||!auth.currentUser?'Checking order availability…':'Online Orders Closed'));
}
function renderPublicOrderStatus(){
  var root=document.getElementById('orderServiceStatus'),headline=document.getElementById('orderServiceHeadline'),note=document.getElementById('orderServiceNote');
  if(!root||!headline||!note)return;
  var open=onlineOrderingAvailable();
  var checking=!customerAuthProblem&&(publicOrdersOpen===null||customerLiveConnected!==true||!auth.currentUser);
  var retry=document.getElementById('orderConnectionRetry');
  root.classList.toggle('is-open',open);
  root.classList.toggle('is-closed',!open&&!checking);
  headline.textContent=open?'OPEN FOR ONLINE ORDERS':(customerAuthProblem?'CONNECTION NEEDS ATTENTION':(checking?'CHECKING ORDER AVAILABILITY':'ONLINE ORDERS CLOSED'));
  note.textContent=open?'Order now — we’re ready!':(customerAuthProblem?'We could not connect securely. Check your internet, then retry.':(checking?(navigator.onLine?'Connecting to the shop…':'Your phone is offline. Reconnect to check availability.'):'We’re not accepting orders right now.'));
  if(retry)retry.style.display=customerAuthProblem?'block':'none';
  root.setAttribute('aria-label',headline.textContent+'. '+note.textContent);
  syncPlaceOrderButton();
}
onValue(publicOrderStatusRef,function(snap){publicOrdersOpen=!!(snap.val()&&snap.val().acceptingOrders===true);renderPublicOrderStatus();},function(){publicOrdersOpen=false;renderPublicOrderStatus();});
onValue(ref(db,'.info/connected'),function(snap){
  customerLiveConnected=snap.val()===true;
  var badge=document.getElementById('fbSync');
  if(badge){badge.classList.toggle('online',customerLiveConnected);badge.textContent=customerLiveConnected?'Firebase connected':'Connecting to Firebase…';badge.style.display='block';}
  renderPublicOrderStatus();
},function(){customerLiveConnected=false;var badge=document.getElementById('fbSync');if(badge){badge.classList.remove('online');badge.textContent='Firebase connection unavailable';badge.style.display='block';}renderPublicOrderStatus();});
let optionGroupsMap={},optSeedStarted=false,itemOptMigrated=false;
let knownOrderIds=null,unseenOrders=0,orderChimeTimer=null,audioCtx=null;
let orderType='pickup',paymentType='gcash',contactMethod='whatsapp',resContactMethod='whatsapp';
function storedIdList(key,limit){try{var value=JSON.parse(localStorage.getItem(key)||'[]'),trimmed=recentOwnedIds(Array.isArray(value)?value:[],limit);if(!Array.isArray(value)||value.length!==trimmed.length)localStorage.setItem(key,JSON.stringify(trimmed));return trimmed;}catch(e){try{localStorage.removeItem(key);}catch(_e){}return[];}}
let myOrderIds=storedIdList('accaza_my_orders',CUSTOMER_LIVE_ORDER_LIMIT);
let myReservationIds=storedIdList('accaza_my_reservations',CUSTOMER_LIVE_RESERVATION_LIMIT);
let calBlocks={};
let calYear,calMonth,selectedDate=null,selectedTime=null;
let adminCalYear,adminCalMonth,adminSelectedDate=null;
let chatOpen=false,chatStarted=false;
let custItem=null,custSize=null,custSel={},custQty=1;
let menuFilter='coffee',orderFilter=null;

const now=new Date();
calYear=now.getFullYear();calMonth=now.getMonth();
adminCalYear=now.getFullYear();adminCalMonth=now.getMonth();

// Helpers
function getCats(){if(!categoriesListCache)categoriesListCache=Object.values(categoriesMap).sort((a,b)=>(a.order||0)-(b.order||0));return categoriesListCache;}
function getCatLabel(id){const c=categoriesMap[id];return c?c.icon+' '+c.label:id;}
function getCatIcon(id){const c=categoriesMap[id];return c?c.icon:'☕';}
function getMenuItems(){if(!menuItemsListCache)menuItemsListCache=Object.entries(menuItemsMap).map(([k,v])=>({...v,key:k}));return menuItemsListCache;}
function isAvail(name){return availability[name]!==false;}
function isDrink(cat){return DRINK_CATS.includes(cat);}
function formatPrice(item){if(item.priceM&&item.priceL)return'S ₱'+item.priceS+' · M ₱'+item.priceM+' · L ₱'+item.priceL;return'₱'+item.priceS;}
function scheduleCatalogRender(){if(catalogRenderPending)return;catalogRenderPending=true;var run=function(){catalogRenderPending=false;renderMenuSection();renderOrderSection();};if(typeof requestAnimationFrame==='function')requestAnimationFrame(run);else setTimeout(run,0);}

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
onValue(categoriesRef,snap=>{
  const saved=snap.val();
  if(saved){categoriesMap=saved;}
  else{const seed={};DEFAULT_CATS.forEach(c=>{seed[c.id]=c;});set(categoriesRef,seed);categoriesMap=seed;}
  categoriesListCache=null;
  rebuildTabs();
  scheduleCatalogRender();
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
onValue(optionGroupsRef,snap=>{
  if(snap.exists()){optionGroupsMap=snap.val();}
  else if(!optSeedStarted){
    optSeedStarted=true;
    optionGroupsMap=DEFAULT_OPTION_GROUPS;
    set(optionGroupsRef,DEFAULT_OPTION_GROUPS).catch(function(){});
  }
  migrateItemOptions();
});

onValue(menuRef,snap=>{
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
  menuItemsListCache=null;
  migrateItemOptions();
  scheduleCatalogRender();
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
  _readyStop=setTimeout(function(){if(window.dismissReadyAlert)window.dismissReadyAlert();},45000);
}
function checkMyReadyOrders(){
  try{
    myOrderIds.forEach(function(id){
      var o=myOrdersMap[id];if(!o)return;
      if(o.status==='Ready'){
        if(!_ordersSeeded){_readyAlerted.add(id);}
        else if(!_readyAlerted.has(id)){_readyAlerted.add(id);_saveReadyAlerted();triggerReadyAlert(o);}
      }else if(_readyAlerted.has(id)){_readyAlerted.delete(id);_saveReadyAlerted();if(window.dismissReadyAlert)window.dismissReadyAlert();}
    });
    if(!_ordersSeeded){_ordersSeeded=true;_saveReadyAlerted();}
  }catch(e){}
}
(function(){var un=function(){try{if(!audioCtx)audioCtx=new(window.AudioContext||window.webkitAudioContext)();if(audioCtx.state==='suspended')audioCtx.resume();}catch(e){}document.removeEventListener('touchstart',un);document.removeEventListener('click',un);};document.addEventListener('touchstart',un,{passive:true});document.addEventListener('click',un);})();
onValue(reviewsRef,snap=>{
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
});
onValue(availRef,snap=>{const s=snap.val();if(s)Object.keys(s).forEach(k=>availability[k]=s[k]);scheduleCatalogRender();});
onValue(paymentRef,snap=>{
  const p=snap.val();if(!p)return;
  if(p.gcashNum)document.getElementById('gcashNum').textContent=p.gcashNum;
  if(p.gcashName)document.getElementById('gcashName').textContent=p.gcashName;
  if(p.bdoNum)document.getElementById('bankNum').textContent=p.bdoNum;
  if(p.ubNum)document.getElementById('bankNum2').textContent=p.ubNum;
  var editGcashNum=document.getElementById('editGcashNum');if(p.gcashNum&&editGcashNum)editGcashNum.value=p.gcashNum;
  var editGcashName=document.getElementById('editGcashName');if(p.gcashName&&editGcashName)editGcashName.value=p.gcashName;
  var editBdoNum=document.getElementById('editBdoNum');if(p.bdoNum&&editBdoNum)editBdoNum.value=p.bdoNum;
  var editUbNum=document.getElementById('editUbNum');if(p.ubNum&&editUbNum)editUbNum.value=p.ubNum;
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
onValue(calBlocksRef,snap=>{calBlocks=snap.val()||{};renderCustomerCalendar();});

// ── WIRE BUTTONS VIA addEventListener (avoids ES module scope issues) ──
const btnAddCat=document.getElementById('btnAddCat');
if(btnAddCat)btnAddCat.addEventListener('click',async function(){
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

const btnAddItem=document.getElementById('btnAddItem');
if(btnAddItem)btnAddItem.addEventListener('click',async function(){
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

const btnAddToCart=document.getElementById('btnAddToCart');
if(btnAddToCart)btnAddToCart.addEventListener('click',function(){addCustomizedToCart();});

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
    const imgHtml=i.img?'<img src="'+i.img+'" alt="" class="menu-card-img" style="'+(ok?'':'opacity:0.5;')+'" onerror="this.style.display=\'none\'"/>'
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
    const imgHtml=i.img?'<img src="'+i.img+'" alt="" class="item-row-img" onerror="this.style.display=\'none\'"/>'
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
  imgWrap.innerHTML=custItem.img?'<img src="'+custItem.img+'" alt="" style="width:100%;height:160px;object-fit:cover;" onerror="this.style.display=\'none\'"/>'
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
  var _optLabels=[];itemGroups.forEach(function(gg){var v=custSel[gg.id];if(!v)return;if(Array.isArray(v)){v.forEach(function(c){_optLabels.push(c.label);});}else{_optLabels.push(v.label);}});
  const cartKey=Date.now()+'_'+Math.random().toString(36).substr(2,5);
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
      +(item.pkgId?'<span style="font-size:0.8rem;color:var(--tl);">Qty '+item.qty+'</span><button data-removepkg="'+item.pkgId+'" title="Remove package" style="border:1px solid #c0392b;background:#fff;color:#c0392b;border-radius:6px;padding:0.2rem 0.4rem;cursor:pointer;">Remove</button>':'<button data-cartkey="'+k+'" data-delta="-1" style="width:24px;height:24px;border-radius:50%;border:1px solid var(--cd);background:var(--cr);font-size:0.9rem;cursor:pointer;color:var(--bd);">−</button><span style="font-size:0.85rem;font-weight:500;min-width:18px;text-align:center;">'+item.qty+'</span><button data-cartkey="'+k+'" data-delta="1" style="width:24px;height:24px;border-radius:50%;border:1px solid var(--cd);background:var(--cr);font-size:0.9rem;cursor:pointer;color:var(--bd);">+</button>')
      +'<span style="font-size:0.85rem;font-weight:500;color:var(--bl);min-width:50px;text-align:right;">₱'+line.toLocaleString()+'</span>'
      +'</div></div></div>';
  }).join('');
  var pkgExtra=(window.__custPkgs||[]).reduce(function(s,p){return s+(Number(p.extraCost)||0);},0);if(pkgExtra){total+=pkgExtra;box.innerHTML+='<div style="display:flex;justify-content:space-between;padding:0.55rem 0;color:var(--bd);font-size:0.82rem;"><span>Package extra charges</span><strong>₱'+pkgExtra.toLocaleString()+'</strong></div>';}
  // Wire cart qty buttons
  box.querySelectorAll('button[data-cartkey]').forEach(function(btn){
    btn.addEventListener('click',function(e){if(e&&e.stopPropagation)e.stopPropagation();
      const k=this.dataset.cartkey,d=parseInt(this.dataset.delta);
      if(!cart[k])return;cart[k].qty=Math.max(0,cart[k].qty+d);
      if(cart[k].qty===0)delete cart[k];
      updateCartDisplay();renderOrderSection();
    });
  });
  box.querySelectorAll('button[data-removepkg]').forEach(function(btn){btn.addEventListener('click',function(e){if(e&&e.stopPropagation)e.stopPropagation();var id=this.dataset.removepkg;Object.keys(cart).forEach(function(k){if(cart[k]&&cart[k].pkgId===id)delete cart[k];});window.__custPkgs=(window.__custPkgs||[]).filter(function(p){return p.id!==id;});updateCartDisplay();renderOrderSection();});});
  document.getElementById('totalAmt').textContent='₱'+total.toLocaleString();
  tot.style.display='flex';
  var _cb1=document.getElementById('cartCheckoutBtn');if(_cb1)_cb1.style.display='block';
}

window.goToCheckout=function(e){if(e&&e.stopPropagation)e.stopPropagation();if(!Object.keys(cart).length)return;var f=document.querySelector('.form-box');if(f)f.scrollIntoView({behavior:'smooth',block:'start'});};
window.setType=function(t){orderType=t;document.getElementById('btnPickup').classList.toggle('active',t==='pickup');document.getElementById('btnDelivery').classList.toggle('active',t==='delivery');document.getElementById('deliveryField').style.display=t==='delivery'?'block':'none';};
window.showProof=function(src){var m=document.getElementById('proofModal');var im=document.getElementById('proofModalImg');if(im)im.src=src;if(m)m.style.display='flex';};
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
var paymentProofData='',paymentProofBusy=false;
function compressPaymentProof(file){
  return new Promise(function(resolve,reject){
    if(!file||!/^image\//i.test(file.type||'')){reject(new Error('Please choose an image file.'));return;}
    if(file.size>15*1024*1024){reject(new Error('The original image is over 15 MB. Take a screenshot or choose a smaller image.'));return;}
    var url=URL.createObjectURL(file),img=new Image();
    img.onload=function(){
      try{
        var maxDim=1600,scale=Math.min(1,maxDim/Math.max(img.naturalWidth||1,img.naturalHeight||1));
        var canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
        var ctx=canvas.getContext('2d',{alpha:false});ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);
        var q=0.84,data=canvas.toDataURL('image/jpeg',q);while(data.length>1750000&&q>0.46){q-=0.08;data=canvas.toDataURL('image/jpeg',q);}
        URL.revokeObjectURL(url);if(data.length>1750000){reject(new Error('The receipt is still too large after compression. Please crop it and try again.'));return;}resolve(data);
      }catch(e){URL.revokeObjectURL(url);reject(e);}
    };
    img.onerror=function(){URL.revokeObjectURL(url);reject(new Error('This image format cannot be processed. Please use a JPG, PNG, or screenshot.'));};img.src=url;
  });
}
window.previewProof=async function(input){
  if(!input.files||!input.files[0])return;paymentProofBusy=true;paymentProofData='';
  var file=input.files[0],nm=document.getElementById('proofFileName');document.getElementById('uploadPlaceholder').style.display='none';document.getElementById('uploadPreview').style.display='block';nm.textContent='Optimizing receipt…';
  try{paymentProofData=await compressPaymentProof(file);document.getElementById('proofImg').src=paymentProofData;nm.textContent=file.name+' · optimized to '+Math.round(paymentProofData.length*0.75/1024)+' KB';document.getElementById('uploadBox').style.borderColor='#2d9e5f';}
  catch(e){window.removeProof({stopPropagation:function(){}});alert((e&&e.message)||'Could not process this receipt image.');}
  finally{paymentProofBusy=false;}
};
window.removeProof=function(e){if(e&&e.stopPropagation)e.stopPropagation();paymentProofData='';paymentProofBusy=false;document.getElementById('paymentProof').value='';document.getElementById('proofImg').src='';document.getElementById('uploadPlaceholder').style.display='block';document.getElementById('uploadPreview').style.display='none';document.getElementById('uploadBox').style.borderColor='var(--cd)';};

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
  try{var au=await ensureCustomerAuth();await update(ref(db,'appCustomers/'+au.uid),{name:n,phone:p,lastSeen:Date.now()});}catch(e){}
  var ov=document.getElementById('appLoginOverlay');if(ov)ov.style.display='none';
  prefillAppUser();
  setupPush();
};
window.appLogout=async function(){try{localStorage.removeItem('accaza_app_user');localStorage.removeItem('accaza_my_orders');}catch(e){}try{if(auth.currentUser)await remove(ref(db,'appCustomers/'+auth.currentUser.uid+'/pushToken'));}catch(e){}try{await signOut(auth);}catch(e){}location.reload();};
function appLoginInit(){if(!isAppMode())return;var ov=document.getElementById('appLoginOverlay');var u=getAppUser();if(!u){if(ov)ov.style.display='flex';}else{prefillAppUser();setupPush();refreshNotifyPrompt();}}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',appLoginInit);else appLoginInit();
function _hashSig(s){var h=0,i;for(i=0;i<s.length;i++){h=((h<<5)-h+s.charCodeAt(i))|0;}return (h>>>0).toString(36);}
window.placeOrder=async function(){
  if(window._placingOrder)return;
  if(!onlineOrderingAvailable()){syncPlaceOrderButton();alert('Online orders are closed right now. Please wait until the green OPEN FOR ONLINE ORDERS light appears.');return;}
  const name=document.getElementById('custName').value.trim(),phone=document.getElementById('custPhone').value.trim();
  if(!Object.keys(cart).length){alert('Please add at least one item.');return;}
  if(!name||!phone){alert('Please enter your name and phone number.');return;}
  if(orderType==='delivery'&&!document.getElementById('deliveryAddr').value.trim()){alert('Please enter your delivery address.');return;}
  if(!document.getElementById('paymentProof').files[0]){alert('Please attach your proof of payment.');return;}
  if(paymentProofBusy){alert('Please wait while the receipt is being optimized.');return;}
  if(!paymentProofData){alert('Please remove and attach the payment proof again.');return;}
  const proofSrc=paymentProofData;
  const total=Object.values(cart).reduce((s,c)=>s+c.qty*c.unitTotal,0)+(window.__custPkgs||[]).reduce((s,p)=>s+(Number(p.extraCost)||0),0);
  const itemsArr=Object.values(cart).map(c=>c.name+(c.details?' ('+c.details+')':'')+' x'+c.qty);
  const lineItemsArr=Object.values(cart).map(c=>({itemKey:c.itemKey||null,size:c.size||null,optLabels:c.optLabels||[],qty:c.qty,stream:c.stream||null,pkg:c.pkgId||null,packageRole:c.packageRole||null}));
  const _sig=phone+'|'+itemsArr.join('~')+'|'+total;
  var _persist=(function(){try{var v=localStorage.getItem('accaza_lastsig');if(!v)return null;var ix=v.lastIndexOf('@@');return {sig:v.slice(0,ix),t:parseInt(v.slice(ix+2))||0};}catch(e){return null;}})();
  if((window._lastOrderSig===_sig&&Date.now()-(window._lastOrderTime||0)<30000)||(_persist&&_persist.sig===_sig&&Date.now()-_persist.t<30000)){alert('Looks like you just placed this exact order — please try again after 30 seconds.');return;}
  window._placingOrder=true;
  const _btn=document.querySelector('.btn-place-order');_btn.disabled=true;_btn.style.opacity='0.5';_btn.textContent='⏳ Placing order…';
  try{
    await ensureCustomerAuth(true);
    var orderPayload={name:name,phone:phone,type:orderType==='delivery'?'Delivery':'Pick-up',address:orderType==='delivery'?document.getElementById('deliveryAddr').value.trim():'',payment:paymentType==='gcash'?'GCash':paymentType==='maya'?'PayMaya':'Bank Transfer',contact:document.getElementById('custContact').value.trim(),contactMethod:contactMethod,notes:document.getElementById('custNotes').value.trim(),proof:proofSrc,lineItems:lineItemsArr,expectedTotal:total};
    var placed;
    try{placed=await createOnlineOrderCall(orderPayload);}catch(firstError){
      if(String(firstError&&firstError.code).indexOf('unauthenticated')<0)throw firstError;
      await ensureCustomerAuth(true);
      placed=await createOnlineOrderCall(orderPayload);
    }
    var orderId=placed&&placed.data&&placed.data.orderId;if(!orderId)throw new Error('Server did not return an order number.');
    window._lastOrderSig=_sig;window._lastOrderTime=Date.now();window._placingOrder=false;_btn.textContent='✅ Order Placed!';try{localStorage.setItem('accaza_lastsig',_sig+'@@'+Date.now());}catch(e){}
    if(myOrderIds.indexOf(orderId)<0)myOrderIds.push(orderId);localStorage.setItem('accaza_my_orders',JSON.stringify(myOrderIds));if(window.__subscribeMyOrders)window.__subscribeMyOrders();
    document.getElementById('displayOrderId').textContent=orderId;document.getElementById('orderConfirm').style.display='block';
    document.querySelector('.btn-place-order').disabled=true;document.querySelector('.btn-place-order').style.opacity='0.5';
    cart={};window.__custPkgs=[];updateCartDisplay();renderOrderSection();renderCustomerOrders();
    document.getElementById('custName').value='';document.getElementById('custPhone').value='';document.getElementById('custNotes').value='';
    removeProof({stopPropagation:function(){}});
    setTimeout(function(){syncPlaceOrderButton();document.getElementById('orderConfirm').style.display='none';},5000);
  }catch(e){window._placingOrder=false;_btn.style.opacity='1';syncPlaceOrderButton();var msg=(e&&e.message)||'Unknown error';if(String(e&&e.code).indexOf('already-exists')>-1)msg='This exact order was already submitted. Please wait one minute before trying again.';alert('Could not place order: '+msg);}
};
window.resetOrder=function(){if(!Object.keys(cart).length&&!document.getElementById('custName').value){alert('Your order is already empty!');return;}if(confirm('Reset your order?')){cart={};updateCartDisplay();renderOrderSection();document.getElementById('custName').value='';document.getElementById('custPhone').value='';document.getElementById('custNotes').value='';setType('pickup');(function(){var gBtn=document.getElementById('btnGcash');var mBtn=document.getElementById('btnMaya');var bBtn=document.getElementById('btnBank');var first=gBtn&&gBtn.style.display!=='none'?'gcash':mBtn&&mBtn.style.display!=='none'?'maya':'bank';setPayment(first);})();document.getElementById('orderConfirm').style.display='none';syncPlaceOrderButton();}};

// ── ORDER TRACKER ──
const statusConfig={Pending:{icon:'🟡',color:'#856404',bg:'#fef3cd',msg:'Your order has been received and is awaiting confirmation from our staff.'},Confirmed:{icon:'🔵',color:'#0c5460',bg:'#d1ecf1',msg:'Your order has been confirmed. We will start preparing it soon!'},Preparing:{icon:'🟠',color:'#664d03',bg:'#fff3cd',msg:'Your order is currently being prepared. ☕'},Ready:{icon:'🟢',color:'#155724',bg:'#d4edda',msg:'Your order is now ready!'},Completed:{icon:'✅',color:'#155724',bg:'#d4edda',msg:'Your order is complete — thank you! ☕'},Received:{icon:'✅',color:'#1b5e20',bg:'#c8e6c9',msg:'You have confirmed receipt. Thank you! ☕🐻'},Rejected:{icon:'🔴',color:'#721c24',bg:'#f8d7da',msg:'Unfortunately, we could not verify your payment in our account, so this order has been rejected. If you believe this is a mistake, please contact us at 0927 692 4831 with your payment reference.'}};
function renderCustomerOrders(){
  const myOrders=myOrderIds.map(id=>myOrdersMap[id]).filter(Boolean);
  const active=myOrders.filter(o=>o.status!=='Completed'&&o.status!=='Received'&&!o.receivedByCustomer);
  const el=document.getElementById('activeOrdersList');
  if(!active.length){el.innerHTML='<div style="text-align:center;padding:3rem;color:var(--tl);"><p style="font-size:2.5rem;margin-bottom:0.75rem;">☕</p><p style="font-size:0.95rem;font-weight:500;color:var(--bd);margin-bottom:0.3rem;">No active orders yet</p><p style="font-size:0.85rem;">Place an order above and it will appear here!</p></div>';return;}
  el.innerHTML=active.map(function(o){const s=statusConfig[o.status]||statusConfig.Pending;const isDelivery=o.type==='Delivery';
    var _msg=(o.status==='Ready')?(isDelivery?'Your order is now ready for delivery! 🎉':'Your order is now ready for pick-up! Please proceed to the counter. 🎉'):s.msg;
    return'<div style="background:#fff;border:2px solid #a8d5b5;border-radius:12px;overflow:hidden;margin-bottom:1.25rem;">'
      +'<div style="background:var(--bd);padding:1rem 1.25rem;text-align:center;">'
      +'<p style="font-size:0.72rem;color:rgba(224,212,198,0.6);text-transform:uppercase;letter-spacing:0.15em;margin-bottom:0.25rem;">Order ID</p>'
      +'<p style="font-family:\'Playfair Display\',serif;font-size:1.8rem;color:#fff;font-weight:600;">'+escHtml(o.id)+'</p>'
      +'<p style="font-size:0.72rem;color:rgba(224,212,198,0.5);margin-top:0.25rem;">🛒 '+escHtml(o.items)+'</p>'
      +'<p style="font-size:0.75rem;color:#c9a36a;">💰 ₱'+(Number(o.total)||0).toLocaleString()+' · '+escHtml(o.payment)+'</p>'
      +'<p style="font-size:0.75rem;margin-top:0.3rem;padding:0.25rem 0.75rem;display:inline-block;border-radius:999px;background:'+(isDelivery?'rgba(13,110,253,0.2)':'rgba(45,158,95,0.2)')+';color:'+(isDelivery?'#90caf9':'#a5d6a7')+';">'+(isDelivery?'🛵 For Delivery':'🏠 For Pick-up')+'</p></div>'
      +'<div style="padding:1rem 1.25rem;background:'+s.bg+';"><p style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.15em;color:'+s.color+';margin-bottom:0.4rem;font-weight:600;">Order Status</p>'
      +'<div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.4rem;"><span style="font-size:1.3rem;">'+s.icon+'</span><span style="font-size:1rem;font-weight:700;color:'+s.color+';">'+escHtml(o.status)+'</span></div>'
      +'<p style="font-size:0.82rem;color:'+s.color+';line-height:1.5;">'+_msg+'</p></div>'
      +'<div style="padding:1rem 1.25rem;background:#ece4d8;text-align:center;">'
      +(o.status==='Ready'?'<p style="font-size:0.95rem;font-weight:700;color:#155724;margin-bottom:.55rem;">'+(isDelivery?'🛵 Your delivery is on the way!':'🏠 Your order is ready — for pick-up!')+'</p><button data-orderid="'+escHtml(o.id)+'" class="confirm-recv-btn" style="background:#2d9e5f;color:#fff;border:none;border-radius:8px;padding:0.65rem 1.5rem;font-size:0.88rem;cursor:pointer;width:100%;">✅ Yes, I Received My Order</button>'
        :'<p style="font-size:0.82rem;color:var(--tl);">This button will be enabled once your order is marked <strong>Completed</strong>.</p><button disabled style="background:#ccc;color:#fff;border:none;border-radius:8px;padding:0.65rem 1.5rem;font-size:0.88rem;cursor:not-allowed;width:100%;margin-top:0.5rem;opacity:0.6;">Waiting for Completion...</button>')
      +'</div></div>';
  }).join('')+'<p style="font-size:0.72rem;color:var(--tl);text-align:center;margin-top:0.25rem;">🔥 Your order status updates automatically — no refresh needed!</p>';
  el.querySelectorAll('.confirm-recv-btn').forEach(function(btn){
    btn.addEventListener('click',function(){
      const oid=this.dataset.orderid;var b=this;
      if(!confirm('Confirm that you have received your order?'))return;
      b.disabled=true;b.textContent='Confirming…';b.style.opacity='0.6';b.style.cursor='default';
      (async function(){try{await ensureCustomerAuth();await confirmOrderReceivedCall({orderId:oid});if(window.dismissReadyAlert)window.dismissReadyAlert();/* order flips to Received -> renderCustomerOrders drops the card */}catch(e){b.disabled=false;b.textContent='✅ Yes, I Received My Order';b.style.opacity='1';b.style.cursor='pointer';alert('Could not confirm receipt: '+((e&&e.message)||e));}})();
    });
  });
}

// ── RESERVATIONS ──
const resStatusConfig={Pending:{icon:'🟡',color:'#856404',bg:'#fef3cd',msg:'Your reservation request has been received and is awaiting confirmation from our staff.'},Accepted:{icon:'🟢',color:'#155724',bg:'#d4edda',msg:'Your reservation is confirmed! Our staff will reach out with the final details. See you soon! ☕'},Confirmed:{icon:'🟢',color:'#155724',bg:'#d4edda',msg:'Your reservation is confirmed! Our staff will reach out with the final details. See you soon! ☕'},Declined:{icon:'🔴',color:'#721c24',bg:'#f8d7da',msg:'Unfortunately we could not accommodate this reservation. Please contact us at 0927 692 4831 to discuss options.'},Completed:{icon:'✅',color:'#155724',bg:'#d4edda',msg:'Thank you for visiting Accaza Coffee House! We hope to see you again. ☕🐻'}};
function renderMyReservations(){
  var el=document.getElementById('myReservationsList');if(!el)return;
  var mine=myReservationIds.map(function(id){return myResMap[id];}).filter(function(r){return r&&r.status!=='Archived';}).sort(function(a,b){return(b.timestamp||0)-(a.timestamp||0);});
  if(!mine.length){el.innerHTML='';return;}
  el.innerHTML='<h3 style="font-family:\'Playfair Display\',serif;color:var(--cr);font-size:1.15rem;margin-bottom:0.85rem;text-align:center;">Your Reservation'+(mine.length>1?'s':'')+'</h3>'+mine.map(function(r){
    var st=(r.status==='Confirmed')?'Accepted':(r.status||'Pending');var s=resStatusConfig[st]||resStatusConfig.Pending;var guests=Math.max(1,Math.min(50,parseInt(r.guests)||1));
    return '<div style="background:#fff;border:2px solid #a8d5b5;border-radius:12px;overflow:hidden;margin-bottom:1rem;">'
      +'<div style="background:var(--bd);padding:0.85rem 1.1rem;text-align:center;"><p style="font-size:0.7rem;color:rgba(224,212,198,0.6);text-transform:uppercase;letter-spacing:0.15em;">Reservation</p><p style="font-family:\'Playfair Display\',serif;font-size:1.3rem;color:#fff;font-weight:600;">#'+escHtml(r.id)+'</p><p style="font-size:0.75rem;color:#c9a36a;margin-top:0.2rem;">📅 '+escHtml(r.date)+' · '+escHtml(r.time)+' · '+guests+' guest'+(guests>1?'s':'')+'</p></div>'
      +'<div style="padding:0.9rem 1.1rem;background:'+s.bg+';"><p style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.15em;color:'+s.color+';margin-bottom:0.4rem;font-weight:600;">Reservation Status</p><div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.35rem;"><span style="font-size:1.2rem;">'+s.icon+'</span><span style="font-size:0.98rem;font-weight:700;color:'+s.color+';">'+escHtml(st)+'</span></div><p style="font-size:0.82rem;color:'+s.color+';line-height:1.5;">'+s.msg+'</p></div></div>';
  }).join('')+'<p style="font-size:0.72rem;color:rgba(224,212,198,0.6);text-align:center;">🔥 Status updates automatically — no refresh needed!</p>';
}
window.renderMyReservations=renderMyReservations;
function getConfirmedGuestsForDate(k){return Object.values(adminResMap).filter(r=>r.date===k&&(r.status==='Accepted'||r.status==='Confirmed')).reduce((s,r)=>s+(parseInt(r.guests)||0),0);}
function getConfirmedSlotsForDate(k){const s=new Set();Object.values(adminResMap).filter(r=>r.date===k&&(r.status==='Accepted'||r.status==='Confirmed')).forEach(r=>s.add(r.time));return s;}
function dateKey(y,m,d){return y+'-'+String(m+1).padStart(2,'0')+'-'+String(d).padStart(2,'0');}
function getDateStatus(y,m,d){const k=dateKey(y,m,d);const bl=calBlocks[k];if(bl&&bl.blocked)return'blocked';const g=getConfirmedGuestsForDate(k);if(g>=MAX_GUESTS)return'blocked';if(g>0)return'partial';if(bl&&bl.slots&&Object.values(bl.slots).some(v=>v===false))return'partial';return'open';}
function isSlotBlocked(k,slot){const b=calBlocks[k];if(b&&b.blocked)return true;if(b&&b.slots&&b.slots[slot]===false)return true;return false;}
function renderCustomerCalendar(){
  if(!document.getElementById('calGrid'))return;
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
    return'<button type="button" class="'+cls+'" '+(blocked?'disabled aria-disabled="true"':'data-slot="'+slot+'"')+'>'+slot+(confirmed&&!blocked?'<br/><span style="font-size:0.62rem;opacity:0.7;">booked</span>':'')+'</button>';
  }).join('');
  grid.querySelectorAll('.time-slot[data-slot]').forEach(function(el){el.addEventListener('click',function(){window.selectTimeSlot(this.dataset.slot);});});
}
const fullDaySlotButton=document.getElementById('fullDaySlot');if(fullDaySlotButton)fullDaySlotButton.addEventListener('click',function(){window.selectTimeSlot('Full Day Booking');});
window.selectTimeSlot=function(slot){
  selectedTime=slot;renderTimeSlots();
  const fw=document.getElementById('resFormWrap');fw.style.display='block';
  const label=new Date(selectedDate+'T00:00:00').toLocaleDateString('en-PH',{weekday:'short',month:'short',day:'numeric',year:'numeric'});
  document.getElementById('resSummaryDateTime').textContent=label+' · '+slot;
  window.updateBookingType();fw.scrollIntoView({behavior:'smooth',block:'nearest'});
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
  const id='RES-'+(Date.now()%2176782336).toString(36).toUpperCase().padStart(6,'0');
  window._placingRes=true;
  const _rbtn=document.querySelector('.btn-reserve');_rbtn.disabled=true;_rbtn.style.opacity='0.5';_rbtn.textContent='⏳ Submitting…';
  try{
    var _resAu=await ensureCustomerAuth();
    await set(ref(db,'reservations/'+id),{id,name,phone,date:selectedDate,time:selectedTime,guests:document.getElementById('resGuests').value,occasion:document.getElementById('resOccasion').value,notes:document.getElementById('resNotes').value.trim(),contact:document.getElementById('resContact').value.trim(),contactMethod:resContactMethod,status:'Pending',ownerUid:_resAu.uid,timestamp:Date.now()});
    if(myReservationIds.indexOf(id)<0)myReservationIds.push(id);try{localStorage.setItem('accaza_my_reservations',JSON.stringify(myReservationIds));}catch(e){}subscribeMyReservations();renderMyReservations();
    window._placingRes=false;_rbtn.textContent='✅ Request Sent!';
    document.getElementById('resConfirm').style.display='block';
    setTimeout(function(){document.getElementById('resConfirm').style.display='none';var rb=document.querySelector('.btn-reserve');rb.disabled=false;rb.style.opacity='1';rb.textContent='Submit Reservation Request';document.getElementById('resName').value='';document.getElementById('resPhone').value='';document.getElementById('resNotes').value='';document.getElementById('resContact').value='';selectedDate=null;selectedTime=null;document.getElementById('resFormWrap').style.display='none';document.getElementById('timeSlotsWrap').style.display='none';renderCustomerCalendar();},5000);
  }catch(e){window._placingRes=false;_rbtn.disabled=false;_rbtn.style.opacity='1';_rbtn.textContent='Submit Reservation Request';alert('Could not submit: '+e.message);}
};

// ── FEEDBACK ──
window.submitContact=async function(){
  const name=document.getElementById('conName').value.trim(),contact=document.getElementById('conContact').value.trim(),subject=document.getElementById('conSubject').value.trim(),message=document.getElementById('conMessage').value.trim();
  if(!name||!message){alert('Please fill in name and message.');return;}
  const body=(subject?('['+subject+'] '):'')+message;
  if(body.length>800){alert('Message is too long (max 800 characters). Please shorten it.');return;}
  const btn=document.querySelector("button[onclick='submitContact()']");if(btn)btn.disabled=true;
  try{await push(feedbacksRef,{name,contact,type:'Contact',message:body,status:'Unread',date:new Date().toLocaleDateString('en-PH',{year:'numeric',month:'long',day:'numeric'}),timestamp:Date.now()});
    document.getElementById('conName').value='';document.getElementById('conContact').value='';document.getElementById('conSubject').value='';document.getElementById('conMessage').value='';
    document.getElementById('conConfirm').style.display='block';setTimeout(function(){document.getElementById('conConfirm').style.display='none';},6000);
  }catch(e){alert('Could not send your message: '+((e&&e.message)||e)+' Please try again or email us directly.');}
  finally{if(btn)btn.disabled=false;}
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

function escHtml(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
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
document.addEventListener('click',function(event){
  var button=event.target&&event.target.closest&&event.target.closest('[data-payment-qr]');if(!button)return;
  var src=button.getAttribute('data-payment-qr'),alt=button.getAttribute('data-payment-qr-alt')||'Payment QR code',style=button.getAttribute('data-payment-qr-style')||'';
  if(!src||button.disabled)return;
  button.disabled=true;button.textContent='Loading QR code…';
  var image=new Image();image.alt=alt;image.decoding='async';image.style.cssText=style;
  image.onload=function(){button.replaceWith(image);};
  image.onerror=function(){button.disabled=false;button.textContent='Click for QR code';(window.accazaToast||function(){})('QR code could not be loaded. Check your connection and try again.','error');};
  image.src=src;
});
const nm=new Date();
const archFrom=document.getElementById('archiveFrom'),archTo=document.getElementById('archiveTo');
if(archFrom)archFrom.value=new Date(nm.getFullYear(),nm.getMonth(),1).toISOString().slice(0,10);
if(archTo)archTo.value=nm.toISOString().slice(0,10);
// Trigger initial menu render after short delay for Firebase
setTimeout(function(){if(Object.keys(menuItemsMap).length)renderMenuSection();},1000);
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
