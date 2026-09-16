const ALLOWED_TABS=new Set(['orders','ops','reservations','inventory','recipes','payouts','cashflow','receivables','payables','discrepancy','operations']);
let exceptionData=null,exceptionAt=0,exceptionLoading=false,exceptionPromise=null,refreshTimer=null;

function esc(value){return String(value==null?'':value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));}
function num(id){const el=document.getElementById(id);return Number(String(el&&el.textContent||'0').replace(/[^0-9.-]/g,''))||0;}
function text(id,fallback='—'){const el=document.getElementById(id),value=String(el&&el.textContent||'').trim();return value||fallback;}
function openTab(tab){if(ALLOWED_TABS.has(tab)&&window.openAdminWorkspaceTab)window.openAdminWorkspaceTab(tab);}
function schedule(){clearTimeout(refreshTimer);refreshTimer=setTimeout(refresh,40);}

async function queueSummary(){
  try{
    if(!window.AccazaOfflineQueue&&window.__accazaLoadAdminModule)await window.__accazaLoadAdminModule('offlinequeue');
    return window.AccazaOfflineQueue&&window.AccazaOfflineQueue.summary?await window.AccazaOfflineQueue.summary():{};
  }catch(_error){return{};}
}

function activeOrders(){
  const source=window.__accaza&&window.__accaza.adminOrdersMap||{};
  return Object.values(source).filter(order=>order&&order.status!=='Received'&&order.status!=='Rejected');
}

function signal(label,value,note,route,tone='neutral'){
  return '<button type="button" class="occ-signal '+tone+'" data-occ-route="'+route+'"><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong><small>'+esc(note)+'</small></button>';
}

async function render(){
  const root=document.getElementById('overviewCommandCenter');if(!root)return;
  const orders=activeOrders(),pending=orders.filter(order=>order.status==='Pending'),pendingPay=orders.filter(order=>order.paymentStatus==='pending'),managerReview=orders.filter(order=>order.paymentStatus==='cashier_verified'),pendingValue=pendingPay.reduce((sum,order)=>sum+(Number(order.total)||0),0),reviewValue=managerReview.reduce((sum,order)=>sum+(Number(order.total)||0),0);
  const queue=await queueSummary(),queued=Number(queue.pending||0)+Number(queue.syncing||0),failed=Number(queue.failed||0),shift=window.__posShift||null;
  const exceptions=exceptionData&&Array.isArray(exceptionData.exceptions)?exceptionData.exceptions:[],counts=exceptionData&&exceptionData.counts||{};
  root.innerHTML='<section class="occ-section"><div class="occ-section-head"><div><span>Service now</span><h3>Live floor</h3></div></div><div class="occ-signal-grid">'
      +signal('Active orders',String(orders.length),pending.length?pending.length+' still pending':'No new order waiting','orders',pending.length?'warning':'good')
      +signal('Reservations',String(num('statReservations')),'Current reservation list','reservations')
      +signal('Register',shift?'Open':'Closed',shift?'Cashier · '+String(shift.staff||'On duty'):'Open a shift before selling','ops',shift?'good':'warning')
      +signal('Offline queue',failed?failed+' failed':queued?queued+' waiting':'Clear',failed?'Retry required':queued?'Will sync when online':'No sale waiting to sync','ops',failed?'critical':queued?'warning':'good')
    +'</div></section>'
    +'<div class="occ-lower"><section class="occ-section"><div class="occ-section-head"><div><span>Money</span><h3>Today’s position</h3></div><button type="button" data-occ-route="cashflow">Open Financials</button></div><div class="occ-money"><div><span>Net sales shown</span><strong>'+esc(text('dashToday','₱0'))+'</strong><small>'+esc(text('dashTodayCount','0 orders'))+'</small></div><div class="'+(pendingPay.length||managerReview.length?'warning':'')+'"><span>Payment controls</span><strong>'+pendingPay.length+' / '+managerReview.length+'</strong><small>'+esc((pendingPay.length?'₱'+pendingValue.toLocaleString()+' cashier check':'No cashier check')+' · '+(managerReview.length?'₱'+reviewValue.toLocaleString()+' manager review':'no manager review'))+'</small></div></div></section>'
    +'<section class="occ-section"><div class="occ-section-head"><div><span>Stock & system</span><h3>Control signals</h3></div></div><div class="occ-control-list"><button type="button" data-occ-route="inventory"><span>Inventory exceptions</span><b>'+exceptions.filter(item=>item.category==='inventory_gap').length+'</b></button><button type="button" data-occ-route="operations"><span>Critical health findings</span><b class="'+(Number(counts.critical||0)?'bad':'')+'">'+Number(counts.critical||0)+'</b></button><button type="button" data-occ-route="operations"><span>Health warnings</span><b class="'+(Number(counts.warning||0)?'warn':'')+'">'+Number(counts.warning||0)+'</b></button></div></section></div>';
  root.querySelectorAll('[data-occ-route]').forEach(button=>button.onclick=()=>openTab(button.getAttribute('data-occ-route')));
}

// System Health is management-only on the server. Non-management sessions (the
// POS till) must never call it, and a failed call must not be retried on every
// live-counter change: that loop produced ~2,000 rejected calls a day.
const SYSTEM_HEALTH_FAILURE_BACKOFF_MS=10*60*1000;
let exceptionFailedAt=0;
function systemHealthAllowed(){const authz=window.__accazaAuthz;return !!(authz&&authz.isPrivileged);}

async function loadExceptions(force=false){
  if(exceptionPromise)return exceptionPromise;
  if(!systemHealthAllowed())return exceptionData;
  if(!force&&exceptionData)return exceptionData;
  if(!force&&exceptionFailedAt&&Date.now()-exceptionFailedAt<SYSTEM_HEALTH_FAILURE_BACKOFF_MS)return exceptionData;
  const api=window.__accaza;if(!api||!api.getOperationalExceptions)return exceptionData;
  exceptionLoading=true;
  exceptionPromise=(async()=>{
    try{
      const response=await api.getOperationalExceptions(force);
      exceptionData=response&&response.data||response;exceptionAt=Number(exceptionData&&exceptionData.generatedAt)||0;exceptionFailedAt=0;
      return exceptionData;
    }catch(_error){exceptionData=null;exceptionFailedAt=Date.now();return null;}
    finally{exceptionLoading=false;exceptionPromise=null;render();}
  })();
  return exceptionPromise;
}

function refresh(){render();loadExceptions();}
window.__refreshOverviewCommand=refresh;
window.__accazaSystemHealth={
  get:function(){return exceptionData;},
  getCheckedAt:function(){return exceptionAt;},
  getCached:function(){return loadExceptions(false);},
  run:function(){return loadExceptions(true);}
};

const watched=['statOrders','statPending','statReservations','dashToday','dashTodayCount'];
const observer=new MutationObserver(schedule);
watched.forEach(id=>{const node=document.getElementById(id);if(node)observer.observe(node,{childList:true,subtree:true,characterData:true});});
window.addEventListener('online',schedule);window.addEventListener('offline',schedule);
setTimeout(refresh,500);

export{refresh};
