(function(){
'use strict';
var staffList={},activeShift=null,shiftsMap={},activityMap={},heldMap={},ordersMap={},discMap={},booksChartMap={},cashAccountsMap={},financialMovementsMap={},toleranceCfg={cashPeso:20,invPct:5},fixedFloatCfg=null,logCollapsed=true,cardShiftId=null,shiftReferenceRequests={};
var pettyVouchers={},pettyRepl={},pettySettings={};
function A(){return window.__accaza;}
function F(){if(!window.AccazaFormDialog)throw new Error('Form service unavailable. Refresh the portal.');return window.AccazaFormDialog;}
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
function peso(n){n=Number(n)||0;return '₱'+n.toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});}
function uid(p){return p+Date.now().toString(36)+Math.random().toString(36).slice(2,5);}
function shiftReference(value,fallback){return String(value||fallback||'Legacy shift').trim();}
function createShiftReference(openedAt,staff){var parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(openedAt)),date={};parts.forEach(function(p){date[p.type]=p.value;});var initials=String(staff||'Register').split(/\s+/).map(function(x){return x.slice(0,1);}).join('').replace(/[^A-Za-z0-9]/g,'').toUpperCase().slice(0,4)||'REG',token=Math.random().toString(36).slice(2,6).toUpperCase();return 'SHIFT-'+date.year+date.month+date.day+'-'+initials+'-'+token;}
function isTab(n){var el=document.getElementById('tab-'+n);return el&&el.style.display!=='none';}
function paysOf(o){return(o.payments&&o.payments.length)?o.payments:[{method:o.payment||'—',amount:Number(o.total)||0}];}
function channelLabel(o){var c=o&&o.channel||'instore';return c==='online'?'Online Orders':c==='grabfood'?'GrabFood':c==='foodpanda'?'FoodPanda':'In-store';}
function directRows(o){return paysOf(o).filter(function(p){var m=String(p&&p.method||'').trim().toLowerCase();return m&&m!=='cash'&&m!=='grabfood'&&m!=='foodpanda';});}
function defaultVerificationPolicy(method){return /gcash|maya/i.test(String(method||''))?'cashier_manager':'manager_only';}
function verificationPolicyForOrder(o){var pm=(window.__posSettings&&window.__posSettings.payMethods)||[],direct=directRows(o);if(!direct.length)return null;return direct.some(function(p){var row=pm.find(function(m){return String(m&&m.name||'').trim().toLowerCase()===String(p.method||'').trim().toLowerCase();}),policy=row&&row.verificationPolicy;return (policy==='cashier_manager'||policy==='manager_only'?policy:defaultVerificationPolicy(p.method))==='manager_only';})?'manager_only':'cashier_manager';}

var tries=0,iv=setInterval(function(){if(window.__accaza){clearInterval(iv);init();}else if(++tries>150)clearInterval(iv);},100);
function init(){
  var a=A();
  a.subscribe('posStaff',function(s){staffList=s.val()||{};if(isTab('ops'))renderOps();if(isTab('possettings'))renderPosSettings();});
  a.subscribe('posActiveShift',function(s){activeShift=s.val()||null;window.__posShift=activeShift;if(window.__refreshWorkspaceStatus)window.__refreshWorkspaceStatus();if(window.__refreshOverviewCommand)window.__refreshOverviewCommand();if(window.__pos)window.__pos.render();if(isTab('ops'))renderOps();});
  a.subscribe('shifts',function(s){shiftsMap=s.val()||{};if(isTab('ops'))renderOps();});
  a.subscribe('activityLog',function(s){activityMap=s.val()||{};if(isTab('ops'))renderOps();});
  a.subscribe('heldOrders',function(s){heldMap=s.val()||{};if(isTab('ops'))renderOps();});
  a.subscribe('activeOrders',function(s){ordersMap=s.val()||{};if(isTab('ops'))renderOps();});
  a.subscribe('discrepancies',function(s){discMap=s.val()||{};updateDiscBadge();if(isTab('discrepancy'))renderDiscrepancies();});
  a.subscribe('booksChart',function(s){booksChartMap=s.val()||{};});
  a.subscribe('cfAccounts',function(s){cashAccountsMap=s.val()||{};});
  a.subscribe('financialMovements',function(s){financialMovementsMap=s.val()||{};});
  a.subscribe('pettyCashVouchers',function(s){pettyVouchers=s.val()||{};if(isTab('petty'))renderPetty();});
  a.subscribe('pettyCashReplenishments',function(s){pettyRepl=s.val()||{};if(isTab('petty'))renderPetty();});
  a.subscribe('pettyCashSettings',function(s){pettySettings=s.val()||{};if(isTab('petty'))renderPetty();});
  a.subscribe('posSettings',function(s){var v=s.val()||{};if(v.tolerances)toleranceCfg=Object.assign({cashPeso:20,invPct:5},v.tolerances);fixedFloatCfg=(v.fixedFloat!=null?(Number(v.fixedFloat)||0):null);if(isTab('ops'))renderOps();});
}
// shared hooks used by the POS script
window.__posLog=function(action,ref,detail){var a=A();var id=uid('log_');a.set(a.ref(a.db,'activityLog/'+id),{ts:Date.now(),action:action,ref:ref||'',detail:detail||'',staff:(activeShift&&activeShift.staff)||'—'});};
window.__posVoid=function(oid){voidSale(oid);};window.__posRefund=function(oid){refundSale(oid);};
function verifyPayment(oid){
  var o=ordersMap[oid];if(!o){alert('Order not found in the active list. If it was archived, restore it first to verify.');return;}
  if(o.paymentStatus!=='pending'){alert('This sale is not pending cashier verification.');return;}
  if(verificationPolicyForOrder(o)==='manager_only'){validatePayment(oid);return;}
  var rows=directRows(o),existing=rows.map(function(p){return p.ref||'';}).filter(Boolean).join(', '),a=A();if(!a.processOrderAdjustment){alert('Payment verification service is not available. Refresh the portal.');return;}
  F().run({title:'Cashier payment verification',subtitle:oid+' · '+peso(o.total)+' · '+(o.payment||''),submitLabel:'Verify payment',busyLabel:'Recording verification…',fields:[{name:'reference',label:'Transaction reference',value:existing,required:true,maxLength:120,help:'Match this against the actual read-only GCash, Maya, or bank transaction history.'},{name:'confirmed',label:'I found this successful payment in the actual receiving account',type:'checkbox',required:true,help:'A customer screenshot by itself is not sufficient.'}]},function(v){return a.processOrderAdjustment({action:'cashier_verify_payment',orderId:oid,reference:v.reference});}).then(function(){if(window.__posLog)window.__posLog('cashier-verify-payment',oid,peso(o.total)+' · '+(o.payment||''));}).catch(function(e){if(String((e&&e.code)||e).indexOf('cancelled')<0&&String((e&&e.message)||e).indexOf('cancelled')<0)alert('Payment confirmation failed: '+((e&&e.message)||e));});
}
function validatePayment(oid){var o=ordersMap[oid],managerOnly=o&&verificationPolicyForOrder(o)==='manager_only';if(!o||(managerOnly?o.paymentStatus!=='pending':['cashier_verified'].indexOf(o.paymentStatus)<0)){alert('This payment is not awaiting manager validation.');return;}var a=A();if(!a.processOrderAdjustment||!a.managerApproval){alert('Manager validation service is unavailable. Refresh the portal.');return;}a.managerApproval('validate_payment',oid,Number(o.total)||0,managerOnly?'Manager-only payment verification':'Revalidate cashier-confirmed payment').then(function(ap){return a.processOrderAdjustment({action:'manager_validate_payment',orderId:oid,approvalId:ap.approvalId});}).then(function(){if(window.__posLog)window.__posLog('manager-validate-payment',oid,peso(o.total));(window.accazaToast||function(){})('Payment manager validated','ok');}).catch(function(e){if(String((e&&e.message)||e).indexOf('cancelled')<0)alert('Manager validation failed: '+((e&&e.message)||e));});}
window.__posVerify=function(oid){verifyPayment(oid);};
window.__accazaRegisterModule('register',function(name){ if(name==='ops')renderOps(); if(name==='possettings')renderPosSettings(); if(name==='discrepancy')renderDiscrepancies(); if(name==='petty')renderPetty(); });

function staffArr(){return Object.keys(staffList).map(function(k){return Object.assign({id:k},staffList[k]);}).sort(function(a,b){return(a.name||'').localeCompare(b.name||'');});}
