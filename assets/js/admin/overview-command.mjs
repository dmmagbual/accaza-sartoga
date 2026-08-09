const ALLOWED_TABS=new Set(['orders','ops','reservations','inventory','recipes','payouts','cashflow','receivables','payables','discrepancy','operations']);
let exceptionData=null,exceptionAt=0,exceptionLoading=false,refreshTimer=null;

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

function actionCard(item){
  const severity=item.severity==='critical'?'critical':'warning',tab=ALLOWED_TABS.has(item.tab)?item.tab:'operations';
  return '<article class="occ-action '+severity+'"><div><span>'+esc(severity)+' · '+esc(String(item.category||'operations').replace(/_/g,' '))+'</span><h4>'+esc(item.title||'Operational review')+'</h4><p>'+esc(item.detail||'Open the controlled workflow to review this item.')+'</p></div><button type="button" data-occ-route="'+esc(tab)+'">Open '+esc(tab)+'</button></article>';
}

function signal(label,value,note,route,tone='neutral'){
  return '<button type="button" class="occ-signal '+tone+'" data-occ-route="'+route+'"><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong><small>'+esc(note)+'</small></button>';
}

async function render(){
  const root=document.getElementById('overviewCommandCenter');if(!root)return;
  const orders=activeOrders(),pending=orders.filter(order=>order.status==='Pending'),pendingPay=orders.filter(order=>order.paymentStatus==='pending'),pendingValue=pendingPay.reduce((sum,order)=>sum+(Number(order.total)||0),0);
  const queue=await queueSummary(),queued=Number(queue.pending||0)+Number(queue.syncing||0),failed=Number(queue.failed||0),shift=window.__posShift||null;
  const exceptions=exceptionData&&Array.isArray(exceptionData.exceptions)?exceptionData.exceptions:[],counts=exceptionData&&exceptionData.counts||{};
  const now=new Date(),hour=now.getHours(),period=hour<12?'Morning':hour<18?'Afternoon':'Evening';
  const managementUnavailable=!exceptionLoading&&!exceptionData;
  let actions=exceptions.slice(0,5);
  const hasOrderException=exceptions.some(item=>item.category==='stuck_order'),hasOfflineException=exceptions.some(item=>item.category==='offline_sync');
  if(pending.length&&!hasOrderException)actions.unshift({severity:'warning',category:'orders',title:pending.length+' new order'+(pending.length===1?' is':'s are')+' waiting',detail:'Confirm the order and move it into preparation.',tab:'orders'});
  if(failed&&!hasOfflineException)actions.unshift({severity:'critical',category:'offline_sync',title:failed+' offline sale'+(failed===1?' failed':'s failed')+' to sync',detail:'Open register operations and retry the durable queue.',tab:'ops'});
  actions=actions.slice(0,5);
  const attention=exceptions.length+(pending.length&&!hasOrderException?1:0)+(failed&&!hasOfflineException?1:0);
  const headline=attention?attention+' item'+(attention===1?'':'s')+' need attention':'Service is clear';
  const intro=attention?'Work the urgent queue first, then review today’s service and money.':'No urgent exception is currently visible. Keep an eye on live service signals.';
  const actionHtml=actions.length?actions.map(actionCard).join(''):'<div class="occ-clear"><span>✓</span><div><b>No immediate action</b><p>'+(managementUnavailable?'Management exception details are unavailable for this account. Live store signals remain visible below.':'The bounded operational scan has no current exception to resolve.')+'</p></div></div>';
  root.innerHTML='<section class="occ-brief '+(attention?'attention':'clear')+'"><div><span class="occ-kicker">'+period+' service · '+now.toLocaleDateString('en-PH',{weekday:'long',month:'short',day:'numeric'})+'</span><h3>'+headline+'</h3><p>'+intro+'</p></div><div class="occ-brief-meta"><span>Updated</span><strong>'+now.toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'})+'</strong></div></section>'
    +'<section class="occ-section"><div class="occ-section-head"><div><span>Immediate attention</span><h3>Work queue</h3></div><button type="button" data-occ-route="operations">Open full health check</button></div><div class="occ-actions">'+actionHtml+'</div></section>'
    +'<section class="occ-section"><div class="occ-section-head"><div><span>Service now</span><h3>Live floor</h3></div></div><div class="occ-signal-grid">'
      +signal('Active orders',String(orders.length),pending.length?pending.length+' still pending':'No new order waiting','orders',pending.length?'warning':'good')
      +signal('Reservations',String(num('statReservations')),'Current reservation list','reservations')
      +signal('Register',shift?'Open':'Closed',shift?'Cashier · '+String(shift.staff||'On duty'):'Open a shift before selling','ops',shift?'good':'warning')
      +signal('Offline queue',failed?failed+' failed':queued?queued+' waiting':'Clear',failed?'Retry required':queued?'Will sync when online':'No sale waiting to sync','ops',failed?'critical':queued?'warning':'good')
    +'</div></section>'
    +'<div class="occ-lower"><section class="occ-section"><div class="occ-section-head"><div><span>Money</span><h3>Today’s position</h3></div><button type="button" data-occ-route="cashflow">Open Financials</button></div><div class="occ-money"><div><span>Net sales shown</span><strong>'+esc(text('dashToday','₱0'))+'</strong><small>'+esc(text('dashTodayCount','0 orders'))+'</small></div><div class="'+(pendingPay.length?'warning':'')+'"><span>Payment verification</span><strong>'+pendingPay.length+'</strong><small>'+(pendingPay.length?esc('₱'+pendingValue.toLocaleString()+' awaiting confirmation'):'No payment waiting')+'</small></div></div></section>'
    +'<section class="occ-section"><div class="occ-section-head"><div><span>Stock & system</span><h3>Control signals</h3></div></div><div class="occ-control-list"><button type="button" data-occ-route="inventory"><span>Inventory exceptions</span><b>'+exceptions.filter(item=>item.category==='inventory_gap').length+'</b></button><button type="button" data-occ-route="operations"><span>Critical health findings</span><b class="'+(Number(counts.critical||0)?'bad':'')+'">'+Number(counts.critical||0)+'</b></button><button type="button" data-occ-route="operations"><span>Health warnings</span><b class="'+(Number(counts.warning||0)?'warn':'')+'">'+Number(counts.warning||0)+'</b></button></div></section></div>';
  root.querySelectorAll('[data-occ-route]').forEach(button=>button.onclick=()=>openTab(button.getAttribute('data-occ-route')));
}

async function loadExceptions(force=false){
  if(exceptionLoading||(!force&&exceptionData&&Date.now()-exceptionAt<60000))return;
  const api=window.__accaza;if(!api||!api.getOperationalExceptions)return;
  exceptionLoading=true;
  try{const response=await api.getOperationalExceptions();exceptionData=response&&response.data||response;exceptionAt=Date.now();}catch(_error){exceptionData=null;exceptionAt=Date.now();}finally{exceptionLoading=false;render();}
}

function refresh(){render();loadExceptions();}
window.__refreshOverviewCommand=refresh;

const watched=['statOrders','statPending','statReservations','dashToday','dashTodayCount'];
const observer=new MutationObserver(schedule);
watched.forEach(id=>{const node=document.getElementById(id);if(node)observer.observe(node,{childList:true,subtree:true,characterData:true});});
window.addEventListener('online',schedule);window.addEventListener('offline',schedule);
setTimeout(refresh,500);setInterval(()=>loadExceptions(true),60000);

export{refresh};
