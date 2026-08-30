
// State
let categoriesMap={},menuItemsMap={},adminOrdersMap={},archivedOrdersMap={},archivedResMap={},adminResMap={},feedbacksMap={},reviewsMap={},availability={},cart={};
let publicOrdersOpen=null,customerLiveConnected=null;
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
let myOrderIds=JSON.parse(localStorage.getItem('accaza_my_orders')||'[]');
let myReservationIds=JSON.parse(localStorage.getItem('accaza_my_reservations')||'[]');
let adminLoggedIn=false,calBlocks={};
let calYear,calMonth,selectedDate=null,selectedTime=null;
let adminCalYear,adminCalMonth,adminSelectedDate=null;
let chatOpen=false,chatStarted=false;
let custItem=null,custSize=null,custSel={},custQty=1;
let menuFilter='coffee',orderFilter=null;

const now=new Date();
calYear=now.getFullYear();calMonth=now.getMonth();
adminCalYear=now.getFullYear();adminCalMonth=now.getMonth();

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
