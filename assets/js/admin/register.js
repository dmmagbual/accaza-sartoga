(function(){
'use strict';
var staffList={},activeShift=null,shiftsMap={},activityMap={},heldMap={},ordersMap={},discMap={},toleranceCfg={cashPeso:20,invPct:5},fixedFloatCfg=null,logCollapsed=true,cardShiftId=null;
var pettyVouchers={},pettyRepl={},pettySettings={};
function A(){return window.__accaza;}
function F(){if(!window.AccazaFormDialog)throw new Error('Form service unavailable. Refresh the portal.');return window.AccazaFormDialog;}
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
function peso(n){n=Number(n)||0;return '₱'+n.toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});}
function uid(p){return p+Date.now().toString(36)+Math.random().toString(36).slice(2,5);}
function isTab(n){var el=document.getElementById('tab-'+n);return el&&el.style.display!=='none';}
function paysOf(o){return(o.payments&&o.payments.length)?o.payments:[{method:o.payment||'—',amount:Number(o.total)||0}];}
function channelLabel(o){var c=o&&o.channel||'instore';return c==='online'?'Online Orders':c==='grabfood'?'GrabFood':c==='foodpanda'?'FoodPanda':'In-store';}

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
  var rows=paysOf(o).filter(function(p){return /gcash|maya|bank|transfer/i.test(String(p.method||''));}),existing=rows.map(function(p){return p.ref||'';}).filter(Boolean).join(', '),a=A();if(!a.processOrderAdjustment){alert('Payment verification service is not available. Refresh the portal.');return;}
  F().run({title:'Cashier payment verification',subtitle:oid+' · '+peso(o.total)+' · '+(o.payment||''),submitLabel:'Verify payment',busyLabel:'Recording verification…',fields:[{name:'reference',label:'Transaction reference',value:existing,required:true,maxLength:120,help:'Match this against the actual read-only GCash, Maya, or bank transaction history.'},{name:'confirmed',label:'I found this successful payment in the actual receiving account',type:'checkbox',required:true,help:'A customer screenshot by itself is not sufficient.'}]},function(v){return a.processOrderAdjustment({action:'cashier_verify_payment',orderId:oid,reference:v.reference});}).then(function(){if(window.__posLog)window.__posLog('cashier-verify-payment',oid,peso(o.total)+' · '+(o.payment||''));}).catch(function(e){if(String((e&&e.code)||e).indexOf('cancelled')<0&&String((e&&e.message)||e).indexOf('cancelled')<0)alert('Payment confirmation failed: '+((e&&e.message)||e));});
}
function validatePayment(oid){var o=ordersMap[oid];if(!o||o.paymentStatus!=='cashier_verified'){alert('This payment is not awaiting manager validation.');return;}var a=A();if(!a.processOrderAdjustment||!a.managerApproval){alert('Manager validation service is unavailable. Refresh the portal.');return;}a.managerApproval('validate_payment',oid,Number(o.total)||0,'Revalidate cashier-confirmed payment').then(function(ap){return a.processOrderAdjustment({action:'manager_validate_payment',orderId:oid,approvalId:ap.approvalId});}).then(function(){if(window.__posLog)window.__posLog('manager-validate-payment',oid,peso(o.total));(window.accazaToast||function(){})('Payment manager validated','ok');}).catch(function(e){if(String((e&&e.message)||e).indexOf('cancelled')<0)alert('Manager validation failed: '+((e&&e.message)||e));});}
window.__posVerify=function(oid){verifyPayment(oid);};
window.__accazaRegisterModule('register',function(name){ if(name==='ops')renderOps(); if(name==='possettings')renderPosSettings(); if(name==='discrepancy')renderDiscrepancies(); if(name==='petty')renderPetty(); });

function staffArr(){return Object.keys(staffList).map(function(k){return Object.assign({id:k},staffList[k]);}).sort(function(a,b){return(a.name||'').localeCompare(b.name||'');});}

/* ---------- denomination cash counting ---------- */
var DENOMS=[
  {k:'b1000',v:1000,lbl:'₱1000'},{k:'b500',v:500,lbl:'₱500'},{k:'b200',v:200,lbl:'₱200'},{k:'b100',v:100,lbl:'₱100'},{k:'b50',v:50,lbl:'₱50'},{k:'p20',v:20,lbl:'₱20'},
  {k:'c10',v:10,lbl:'₱10'},{k:'c5',v:5,lbl:'₱5'},{k:'c1',v:1,lbl:'₱1'},{k:'c25',v:0.25,lbl:'25¢'},{k:'c10s',v:0.10,lbl:'10¢'},{k:'c5s',v:0.05,lbl:'5¢'}
];
function denomGridHtml(prefix){
  return '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:0.4rem;">'
    +DENOMS.map(function(d){return '<label style="font-size:0.75rem;color:var(--tm);display:flex;flex-direction:column;gap:0.15rem;">'+d.lbl+'<input class="pz-in" type="number" min="0" step="1" data-dp="'+prefix+'" data-dv="'+d.v+'" data-dk="'+d.k+'" placeholder="0"/></label>';}).join('')
    +'</div><div style="text-align:right;font-weight:700;margin-top:0.5rem;">Counted total: <span id="'+prefix+'_total">₱0.00</span></div>';
}
function wireDenom(prefix){
  function recalc(){var t=0;document.querySelectorAll('[data-dp="'+prefix+'"]').forEach(function(inp){t+=(Number(inp.value)||0)*(Number(inp.getAttribute('data-dv'))||0);});var el=document.getElementById(prefix+'_total');if(el)el.textContent=peso(t);}
  document.querySelectorAll('[data-dp="'+prefix+'"]').forEach(function(inp){inp.oninput=recalc;});
  recalc();
}
function denomRead(prefix){
  var counts={},total=0;
  document.querySelectorAll('[data-dp="'+prefix+'"]').forEach(function(inp){var q=Number(inp.value)||0;if(q){counts[inp.getAttribute('data-dk')]=q;total+=q*(Number(inp.getAttribute('data-dv'))||0);}});
  return {counts:counts,total:total};
}
function denomBreakdownRows(counts){
  if(!counts)return '';
  return DENOMS.filter(function(d){return counts[d.k];}).map(function(d){return '<tr><td>'+d.lbl+' × '+counts[d.k]+'</td><td style="text-align:right;">'+peso(d.v*counts[d.k])+'</td></tr>';}).join('');
}
function denomTrackingOnR(){return !!(window.__posSettings&&window.__posSettings.denomTracking);}
function reconcileTotalOnlyR(){return !!(window.__posSettings&&window.__posSettings.reconcileTotalOnly);}
function drawerNow(){return (activeShift&&activeShift.drawer)?Object.assign({},activeShift.drawer):{};}
function mergeD(a,b){var o=Object.assign({},a||{});Object.keys(b||{}).forEach(function(k){o[k]=(Number(o[k])||0)+(Number(b[k])||0);});return o;}
function subD(a,b){var o=Object.assign({},a||{});Object.keys(b||{}).forEach(function(k){o[k]=(Number(o[k])||0)-(Number(b[k])||0);});return o;}
function makeChangeD(amount,avail){var rem=Math.round(amount*100);var give={};DENOMS.forEach(function(d){if(rem<=0)return;var cents=Math.round(d.v*100);var have=Number(avail[d.k])||0;var use=Math.min(Math.floor(rem/cents),have);if(use>0){give[d.k]=use;rem-=use*cents;}});return {denoms:give,ok:rem<=0,short:rem/100};}
function saveDrawer(nd){if(!activeShift)return;var a=A();a.update(a.ref(a.db,'shifts/'+activeShift.id),{drawer:nd});a.update(a.ref(a.db,'posActiveShift'),{drawer:nd});}
function cashSwap(){
  if(!activeShift)return;
  var mask=document.createElement('div'); mask.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;';
  document.body.appendChild(mask);
  function close(){document.body.removeChild(mask);}
  mask.innerHTML='<div style="background:#fff;border-radius:10px;max-width:560px;width:100%;max-height:90vh;overflow:auto;padding:1.2rem;">'
    +'<div style="font-weight:700;color:var(--bd);margin-bottom:0.2rem;">🔁 Break a bill / cash swap</div>'
    +'<p class="pz-sub" style="margin-top:0.2rem;">A net-zero exchange — the total taken OUT must equal the total put IN. This only changes the mix of notes/coins in the drawer, not the total.</p>'
    +'<div style="font-weight:600;color:var(--bd);margin:0.4rem 0 0.3rem;">Take OUT of drawer</div>'+denomGridHtml('swOut')
    +'<div style="font-weight:600;color:var(--bd);margin:0.8rem 0 0.3rem;">Put IN to drawer</div>'+denomGridHtml('swIn')
    +'<div id="swBal" style="font-weight:700;margin-top:0.6rem;"></div>'
    +'<div style="display:flex;gap:0.5rem;margin-top:1rem;"><button class="pz-btn ok" id="swOk">Confirm swap</button><button class="pz-btn sec" id="swC">Cancel</button></div></div>';
  function recalcBal(){var o=denomRead('swOut'),i=denomRead('swIn');var bal=Math.round((i.total-o.total)*100)/100;var el=document.getElementById('swBal');if(!el)return;el.innerHTML='Out '+peso(o.total)+' · In '+peso(i.total)+' — '+(Math.abs(bal)<0.001?(o.total>0?'<span style="color:#155724;">✓ balanced</span>':'<span style="color:var(--tl);">enter the swap</span>'):'<span style="color:#c0392b;">off by '+peso(bal)+'</span>');}
  wireDenom('swOut'); wireDenom('swIn');
  mask.querySelectorAll('[data-dp="swOut"],[data-dp="swIn"]').forEach(function(inp){inp.addEventListener('input',recalcBal);});
  recalcBal();
  mask.querySelector('#swC').onclick=close;
  mask.querySelector('#swOk').onclick=function(){var o=denomRead('swOut'),i=denomRead('swIn');if(o.total<=0){alert('Enter what you took out of the drawer.');return;}if(Math.abs(i.total-o.total)>0.001){alert('The swap must be net-zero — total OUT must equal total IN.');return;}
    var nd=mergeD(subD(drawerNow(),o.counts),i.counts); saveDrawer(nd);
    var a=A();var swaps=(activeShift.cashSwaps||[]).slice();swaps.push({out:o.counts,in:i.counts,amount:o.total,ts:Date.now(),by:activeShift.staff||''});a.update(a.ref(a.db,'shifts/'+activeShift.id),{cashSwaps:swaps});
    if(window.__posLog)window.__posLog('cash-swap',activeShift.id,peso(o.total)+' broken');
    close(); alert('Swap recorded — drawer mix updated, total unchanged.');
  };
}
/* ---------- Z-report computation ---------- */
function computeZ(shift){
  var sales=[],voids=[],z={tx:0,gross:0,discounts:0,refunds:0,cashRefunds:0,net:0,byMethod:{},byChannel:{instore:0,online:0,grabfood:0,foodpanda:0},cashSales:0,voidCount:0,voidAmt:0,pending:0,pendingCount:0,managerPending:0,managerPendingCount:0,tips:0};
  Object.keys(ordersMap).forEach(function(id){var o=ordersMap[id];if(!o||o.shiftId!==shift.id)return;
    if(o.voided){z.voidCount++;z.voidAmt+=Number(o.total)||0;return;}
    if(['Completed','Received'].indexOf(o.status)<0)return;
    var gross=(o.subtotal!=null?Number(o.subtotal):Number(o.total))||0;var disc=Number(o.discount)||0;var ref=Number(o.refundAmount)||0;
    z.tx++;z.gross+=gross;z.discounts+=disc;z.refunds+=ref;z.cashRefunds+=Number((o.refundPayments||{}).Cash)||(ref&&(!o.refundPayments)&&(o.payment==='Cash'||paysOf(o).some(function(p){return p.method==='Cash';}))?ref:0);z.net+=gross-disc-ref;
    z.tips+=Number(o.tipRounding)||0;
    var _ch=(o.channel&&z.byChannel[o.channel]!=null)?o.channel:'instore';z.byChannel[_ch]+=Number(o.total)||0;
    if(o.paymentStatus==='pending'){z.pending+=(Number(o.total)||0);z.pendingCount++;}
    if(o.paymentStatus==='cashier_verified'){z.managerPending+=(Number(o.total)||0);z.managerPendingCount++;}
    paysOf(o).forEach(function(p){z.byMethod[p.method]=(z.byMethod[p.method]||0)+(Number(p.amount)||0);});
  });
  z.cashSales=z.byMethod['Cash']||0;
  z.payIns=(shift.payIns||[]).reduce(function(s,x){return s+(Number(x.amount)||0);},0);
  z.payOuts=(shift.payOuts||[]).reduce(function(s,x){return s+(Number(x.amount)||0);},0);
  z.expectedCash=(Number(shift.openingFloat)||0)+z.cashSales+z.tips-z.cashRefunds+z.payIns-z.payOuts;
  // Imprest: cashier retains the fixed float, remits the rest. Grab/Panda + non-cash tenders never entered cashSales, so they're already out of the cash line.
  z.retainedFloat=(fixedFloatCfg!=null?fixedFloatCfg:(Number(shift.openingFloat)||0));
  z.cashToSettle=Math.round((z.expectedCash-z.retainedFloat)*100)/100;
  z.floatMismatch=(fixedFloatCfg!=null&&fixedFloatCfg>0&&Math.abs((Number(shift.openingFloat)||0)-fixedFloatCfg)>0.001);
  return z;
}

/* ---------- render ---------- */
function renderPayMethods(){
  var box=document.getElementById('payMethodsBox');if(!box)return;var a=A();
  a.get(a.ref(a.db,'posSettings')).then(function(s){
    var v=s.val()||{};var pm=v.payMethods;
    if(!pm||!pm.length)pm=[{name:'Cash',active:true,cash:true},{name:'GCash',active:true,cash:false},{name:'Bank Transfer',active:true,cash:false},{name:'Card / EFTPOS',active:false,cash:false}];
    function save(pm2){a.update(a.ref(a.db,'posSettings'),{payMethods:pm2}).then(renderPayMethods);}
    box.innerHTML=pm.map(function(m,i){return '<div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.35rem;"><label style="flex:1;font-size:0.85rem;cursor:pointer;"><input type="checkbox" data-pmact="'+i+'"'+(m.active!==false?' checked':'')+'/> '+esc(m.name)+(m.cash?' <span style="color:var(--tl);font-size:0.72rem;">(cash · no ref)</span>':' <span style="color:var(--tl);font-size:0.72rem;">(needs ref · posts pending)</span>')+'</label>'+(m.cash?'':'<button class="pz-btn warn" data-pmdel="'+i+'" style="padding:0.15rem 0.45rem;">✕</button>')+'</div>';}).join('')
      +'<div style="display:flex;gap:0.4rem;margin-top:0.5rem;"><input class="pz-in" id="pmNew" placeholder="Add method (e.g. Maya)" style="flex:1;"/><button class="pz-btn sec" id="pmAdd">+ add</button></div>'
      +'<div style="font-size:0.72rem;color:var(--tl);margin-top:0.35rem;">Toggle a method on/off. Non-cash methods require a reference number and post as <b>pending</b> until a manager verifies. Turn on “Card / EFTPOS” when your terminal arrives.</div>';
    box.querySelectorAll('[data-pmact]').forEach(function(c){c.onchange=function(){pm[+c.getAttribute('data-pmact')].active=c.checked;save(pm);};});
    box.querySelectorAll('[data-pmdel]').forEach(function(b){b.onclick=function(){if(confirm('Remove this payment method?')){pm.splice(+b.getAttribute('data-pmdel'),1);save(pm);}};});
    var add=document.getElementById('pmAdd');if(add)add.onclick=function(){var nm=(document.getElementById('pmNew').value||'').trim();if(!nm)return;if(pm.some(function(x){return String(x.name).toLowerCase()===nm.toLowerCase();})){alert('That method already exists.');return;}pm.push({name:nm,active:true,cash:false});save(pm);};
  });
}
/* ---------- Discrepancy Log (Feature D) ---------- */
function dnum(n){n=Number(n)||0;return (Math.round(n*1000)/1000).toLocaleString('en-PH');}
function discList(openOnly){var arr=Object.keys(discMap).map(function(k){return Object.assign({id:k},discMap[k]);});if(openOnly)arr=arr.filter(function(d){return d.status!=='reviewed';});return arr.sort(function(a,b){return (b.ts||0)-(a.ts||0);});}
function updateDiscBadge(){var n=discList(true).length;var b=document.getElementById('discBadge');if(b){b.textContent=n;b.style.display=n?'inline-block':'none';}}
function renderDiscrepancies(){
  var root=document.getElementById('discrepancyRoot'); if(!root)return;
  var all=discList(false); var openN=discList(true).length;
  var rows=all.length?all.map(function(d){
    var when=new Date(d.ts).toLocaleString('en-PH',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
    var what=d.kind==='cash'?'Cash drawer':esc(d.item||'');
    var exp=d.kind==='cash'?peso(d.expected):dnum(d.expectedQty);
    var act=d.kind==='cash'?peso(d.actual):dnum(d.actualQty);
    var vr=d.kind==='cash'?peso(d.variance):dnum(d.variance);
    var badge=d.type==='shortage'?'<span style="color:#c0392b;font-weight:600;">shortage</span>':(d.type==='overage'?'<span style="color:#8a6d1b;font-weight:600;">overage</span>':esc(d.type||''));
    return '<tr'+(d.status==='reviewed'?' style="opacity:0.55;"':'')+'><td>'+when+'</td><td>'+(d.kind==='cash'?'💵 Cash':'📦 Inventory')+'</td><td>'+what+'</td><td style="text-align:right;">'+exp+'</td><td style="text-align:right;">'+act+'</td><td style="text-align:right;font-weight:600;">'+vr+'</td><td>'+badge+'</td><td>'+esc(d.staff||'')+'</td><td>'+(d.status==='reviewed'?('<span style="font-size:0.72rem;color:var(--tl);">✓ '+esc(d.reviewedBy||'')+(d.note?' — '+esc(d.note):'')+'</span>'):'<button class="pz-btn ok" data-drev="'+esc(d.id)+'" style="padding:0.2rem 0.55rem;">Review</button>')+'</td></tr>';
  }).join(''):'<tr><td colspan="9" style="color:var(--tl);padding:0.6rem;">No discrepancies logged. 👍</td></tr>';
  root.innerHTML='<div class="pz-h">🚩 Discrepancy Log</div>'
    +'<p class="pz-sub">Permanent audit trail of cash &amp; inventory variances. Cash auto-logs at shift close beyond tolerance; inventory auto-logs from stock adjustments beyond tolerance. Entries are never deleted — only reviewed with a root-cause note. <b>'+openN+' open.</b></p>'
    +'<div class="pz-card" style="margin-bottom:1rem;"><div style="font-weight:600;color:var(--bd);margin-bottom:0.5rem;">Tolerances (minimal variance ignored)</div><div style="display:flex;gap:0.6rem;flex-wrap:wrap;align-items:end;"><div><span class="pz-lbl">Cash ± ₱</span><input class="pz-in" id="tolCash" type="number" step="any" value="'+(Number(toleranceCfg.cashPeso)||0)+'" style="width:110px;"/></div><div><span class="pz-lbl">Inventory ± %</span><input class="pz-in" id="tolInv" type="number" step="any" value="'+(Number(toleranceCfg.invPct)||0)+'" style="width:110px;"/></div><button class="pz-btn sec" id="tolSave">Save</button></div></div>'
    +'<div class="pz-card"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;"><div style="font-weight:600;color:var(--bd);">All discrepancies</div><button class="pz-btn sec" id="discExport" style="padding:0.25rem 0.7rem;">⬇ Export Excel</button></div>'
    +'<div style="overflow-x:auto;"><table class="pz-tbl"><thead><tr><th>When</th><th>Kind</th><th>Affected</th><th style="text-align:right;">Expected</th><th style="text-align:right;">Actual</th><th style="text-align:right;">Variance</th><th>Type</th><th>Staff</th><th></th></tr></thead><tbody>'+rows+'</tbody></table></div></div>';
  root.querySelectorAll('[data-drev]').forEach(function(b){b.onclick=function(){reviewDiscrepancy(b.getAttribute('data-drev'));};});
  var tsv=document.getElementById('tolSave'); if(tsv)tsv.onclick=function(){var a=A();a.update(a.ref(a.db,'posSettings'),{tolerances:{cashPeso:Number(document.getElementById('tolCash').value)||0,invPct:Number(document.getElementById('tolInv').value)||0}}).then(function(){alert('Tolerances saved.');});};
  var de=document.getElementById('discExport'); if(de)de.onclick=exportDiscrepancies;
}
function reviewDiscrepancy(id){
  var d=discMap[id]; if(!d||d.status==='reviewed')return;
  var a=A();if(!a.reviewDiscrepancy||!a.managerApproval){alert('3E discrepancy service is not available. Refresh the portal.');return;}
  F().run({title:'Review discrepancy',subtitle:'Record the root cause before privileged approval. Owner, Superadmin, Admin, and Manager accounts may approve. This note becomes part of the permanent audit trail.',submitLabel:'Approve review',busyLabel:'Processing…',fields:[{name:'note',label:'Root-cause explanation',type:'textarea',required:true,maxLength:300,placeholder:'Shortage, overage, encoding error, or other explanation'}]},function(v){return a.managerApproval('review_discrepancy',id,null,v.note).then(function(ap){return a.reviewDiscrepancy({discrepancyId:id,note:v.note,approvalId:ap.approvalId});}).then(function(){window.__posLog('discrepancy-review',id,v.note);});}).then(function(){alert('Discrepancy reviewed and locked.');}).catch(function(){});
}
function exportDiscrepancies(){
  if(!window.XLSX){alert('Excel library still loading — try again.');return;}
  var aoa=[['when','kind','affected','expected','actual','variance','type','staff','status','note']];
  discList(false).forEach(function(d){aoa.push([new Date(d.ts).toLocaleString('en-PH'),d.kind,d.kind==='cash'?'Cash drawer':(d.item||''),d.kind==='cash'?d.expected:d.expectedQty,d.kind==='cash'?d.actual:d.actualQty,d.variance,d.type||'',d.staff||'',d.status||'',d.note||'']);});
  var wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(aoa),'Discrepancies');
  XLSX.writeFile(wb,'accaza-discrepancies-'+new Date().toISOString().slice(0,10)+'.xlsx');
}
/* ---------- Petty Cash (Feature B) ---------- */
var PETTY_CATS=['Supplies','Transport','Repairs & maintenance','Utilities','Staff meals','Miscellaneous'];
function fv(id){var el=document.getElementById(id);return el?el.value:'';}
function pettyBalance(){
  var open=Number((pettySettings&&pettySettings.openingBalance)||0);
  var rep=Object.keys(pettyRepl).reduce(function(s,k){return s+(Number(pettyRepl[k].amount)||0);},0);
  var dis=Object.keys(pettyVouchers).reduce(function(s,k){var v=pettyVouchers[k];return s+((v.status==='approved'&&!v.voided)?(Number(v.amount)||0):0);},0);
  return {opening:open,replen:rep,disb:dis,remaining:open+rep-dis};
}
function compressImage(file,cb){
  if(!file){cb('');return;}
  var rd=new FileReader();
  rd.onload=function(e){var img=new Image();img.onload=function(){var max=900,w=img.width,h=img.height,sc=Math.min(1,max/Math.max(w,h));w=Math.round(w*sc);h=Math.round(h*sc);var c=document.createElement('canvas');c.width=w;c.height=h;c.getContext('2d').drawImage(img,0,0,w,h);try{cb(c.toDataURL('image/jpeg',0.6));}catch(err){cb('');}};img.onerror=function(){cb('');};img.src=e.target.result;};
  rd.onerror=function(){cb('');};
  rd.readAsDataURL(file);
}
function nextVoucherNo(cb){
  var d=new Date();var key=d.getFullYear()+String(d.getMonth()+1).padStart(2,'0');var a=A();
  a.runTransaction(a.ref(a.db,'pettyCashCounter/'+key),function(cur){return (Number(cur)||0)+1;}).then(function(res){var n=(res.snapshot&&res.snapshot.val())||1;cb('PV-'+key+'-'+String(n).padStart(4,'0'));}).catch(function(){cb('PV-'+key+'-'+Date.now().toString().slice(-4));});
}
function renderPetty(){
  var root=document.getElementById('pettyRoot'); if(!root)return;
  var bal=pettyBalance();
  var vs=Object.keys(pettyVouchers).map(function(k){return Object.assign({id:k},pettyVouchers[k]);}).sort(function(a,b){return (b.createdAt||0)-(a.createdAt||0);});
  var pend=vs.filter(function(v){return v.status==='pending';});
  var catOpts=PETTY_CATS.map(function(c){return '<option>'+esc(c)+'</option>';}).join('');
  var today=new Date().toISOString().slice(0,10);
  function vrowHtml(v){
    var st=v.voided?'<span style="color:#c0392b;">VOID</span>':(v.status==='approved'?'<span style="color:#155724;">approved</span>':(v.status==='rejected'?'<span style="color:#c0392b;">rejected</span>':'<span style="color:#8a6d1b;">pending</span>'));
    var act=v.status==='pending'?('<button class="pz-btn ok" data-pvap="'+esc(v.id)+'" style="padding:0.2rem 0.5rem;">Approve</button> <button class="pz-btn warn" data-pvrj="'+esc(v.id)+'" style="padding:0.2rem 0.5rem;">Reject</button>'):('<button class="pz-btn sec" data-pvpr="'+esc(v.id)+'" style="padding:0.2rem 0.5rem;">Print</button>'+((v.status==='approved'&&!v.voided)?' <button class="pz-btn warn" data-pvvd="'+esc(v.id)+'" style="padding:0.2rem 0.5rem;">Void</button>':''));
    var rc=v.receiptImg?'<a href="'+v.receiptImg+'" target="_blank" style="color:var(--bd);">view</a>':'<span style="color:#c0392b;">none</span>';
    return '<tr'+(v.voided?' style="opacity:0.55;"':'')+'><td>'+esc(v.voucherNo||'')+'</td><td>'+esc(v.date||'')+'</td><td style="text-align:right;">'+peso(v.amount)+'</td><td>'+esc(v.category||'')+'</td><td>'+esc(v.requesterName||'')+'</td><td>'+esc(v.approvedBy||v.approverName||'')+'</td><td>'+rc+'</td><td>'+st+'</td><td style="white-space:nowrap;">'+act+'</td></tr>';
  }
  var repl=Object.keys(pettyRepl).map(function(k){return pettyRepl[k];}).sort(function(a,b){return (b.ts||0)-(a.ts||0);});
  root.innerHTML='<div class="pz-h">💷 Petty Cash</div>'
    +'<p class="pz-sub">Digital vouchers so no one takes cash from the sales drawer for expenses. Every disbursement needs a receipt and privileged approval; the fund is a running imprest balance.</p>'
    +'<div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-bottom:1rem;">'
      +'<div class="pz-card" style="flex:1;min-width:130px;"><div style="font-size:0.75rem;color:var(--tl);">Opening</div><div style="font-weight:700;">'+peso(bal.opening)+'</div></div>'
      +'<div class="pz-card" style="flex:1;min-width:130px;"><div style="font-size:0.75rem;color:var(--tl);">+ Replenishments</div><div style="font-weight:700;">'+peso(bal.replen)+'</div></div>'
      +'<div class="pz-card" style="flex:1;min-width:130px;"><div style="font-size:0.75rem;color:var(--tl);">− Disbursements</div><div style="font-weight:700;">'+peso(bal.disb)+'</div></div>'
      +'<div class="pz-card" style="flex:1;min-width:130px;background:#f5faf6;"><div style="font-size:0.75rem;color:var(--tl);">= Remaining</div><div style="font-weight:700;font-size:1.15rem;color:var(--bd);">'+peso(bal.remaining)+'</div></div>'
    +'</div>'
    +'<div style="display:flex;gap:1rem;flex-wrap:wrap;margin-bottom:1rem;">'
      +'<div class="pz-card" style="flex:2;min-width:280px;"><div style="font-weight:600;color:var(--bd);margin-bottom:0.5rem;">New voucher</div>'
        +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;">'
          +'<div><span class="pz-lbl">Date</span><input class="pz-in" id="pvDate" type="date" value="'+today+'"/></div>'
          +'<div><span class="pz-lbl">Amount ₱</span><input class="pz-in" id="pvAmount" type="number" step="any"/></div>'
          +'<div><span class="pz-lbl">Category</span><select class="pz-in" id="pvCat">'+catOpts+'</select></div>'
          +'<div><span class="pz-lbl">Requester</span><input class="pz-in" id="pvRequester"/></div>'
          +'<div><span class="pz-lbl">Approver (intended)</span><input class="pz-in" id="pvApprover"/></div>'
          +'<div><span class="pz-lbl">Receipt photo</span><input class="pz-in" id="pvReceipt" type="file" accept="image/*"/></div>'
        +'</div><div style="margin-top:0.7rem;"><button class="pz-btn ok" id="pvCreate">Create voucher</button></div></div>'
      +'<div class="pz-card" style="flex:1;min-width:220px;"><div style="font-weight:600;color:var(--bd);margin-bottom:0.5rem;">Replenish fund</div>'
        +'<div><span class="pz-lbl">Amount ₱</span><input class="pz-in" id="prAmount" type="number" step="any"/></div>'
        +'<div style="margin-top:0.4rem;"><span class="pz-lbl">Source</span><select class="pz-in" id="prSource"><option value="owner">Owner top-up</option><option value="register">From sales register</option></select></div>'
        +'<div style="margin-top:0.4rem;"><span class="pz-lbl">Note</span><input class="pz-in" id="prNote"/></div>'
        +'<div style="margin-top:0.4rem;font-size:0.72rem;color:var(--tl);">“From register” posts a drawer pay-out on the open shift.</div>'
        +'<div style="margin-top:0.7rem;"><button class="pz-btn sec" id="prAdd">Add replenishment</button></div>'
        +'<div style="margin-top:0.8rem;border-top:1px solid #eee;padding-top:0.5rem;"><span class="pz-lbl">Opening balance</span><div style="display:flex;gap:0.4rem;"><input class="pz-in" id="pvOpening" type="number" step="any" value="'+(Number(bal.opening)||0)+'" style="flex:1;"/><button class="pz-btn sec" id="pvOpenSave">Save</button></div></div>'
      +'</div>'
    +'</div>'
    +(pend.length?('<div class="pz-card" style="margin-bottom:1rem;border:1px solid #ffe0a3;background:#fffdf5;"><div style="font-weight:700;color:#8a6d1b;margin-bottom:0.5rem;">⏳ Pending approval ('+pend.length+')</div><div style="overflow-x:auto;"><table class="pz-tbl"><thead><tr><th>Voucher</th><th>Date</th><th style="text-align:right;">Amount</th><th>Category</th><th>Requester</th><th>Approver</th><th>Receipt</th><th>Status</th><th></th></tr></thead><tbody>'+pend.map(vrowHtml).join('')+'</tbody></table></div></div>'):'')
    +'<div class="pz-card" style="margin-bottom:1rem;"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;"><div style="font-weight:600;color:var(--bd);">Voucher register</div><button class="pz-btn sec" id="pettyExport" style="padding:0.25rem 0.7rem;">⬇ Export Excel</button></div><div style="overflow-x:auto;"><table class="pz-tbl"><thead><tr><th>Voucher</th><th>Date</th><th style="text-align:right;">Amount</th><th>Category</th><th>Requester</th><th>Approver</th><th>Receipt</th><th>Status</th><th></th></tr></thead><tbody>'+(vs.length?vs.map(vrowHtml).join(''):'<tr><td colspan="9" style="color:var(--tl);padding:0.6rem;">No vouchers yet.</td></tr>')+'</tbody></table></div></div>'
    +'<div class="pz-card"><div style="font-weight:600;color:var(--bd);margin-bottom:0.5rem;">Replenishments</div><table class="pz-tbl"><thead><tr><th>Date</th><th style="text-align:right;">Amount</th><th>Source</th><th>By</th><th>Note</th></tr></thead><tbody>'+(repl.length?repl.map(function(r){return '<tr><td>'+esc(r.date||new Date(r.ts).toLocaleDateString('en-PH'))+'</td><td style="text-align:right;">'+peso(r.amount)+'</td><td>'+esc(r.source||'')+'</td><td>'+esc(r.by||'')+'</td><td>'+esc(r.note||'')+'</td></tr>';}).join(''):'<tr><td colspan="5" style="color:var(--tl);padding:0.6rem;">No replenishments yet.</td></tr>')+'</tbody></table></div>';
  var c=document.getElementById('pvCreate'); if(c)c.onclick=createVoucher;
  var ra=document.getElementById('prAdd'); if(ra)ra.onclick=addReplenishment;
  var os=document.getElementById('pvOpenSave'); if(os)os.onclick=function(){var a=A();a.update(a.ref(a.db,'pettyCashSettings'),{openingBalance:Number(fv('pvOpening'))||0}).then(function(){alert('Opening balance saved.');});};
  var ex=document.getElementById('pettyExport'); if(ex)ex.onclick=exportPetty;
  root.querySelectorAll('[data-pvap]').forEach(function(b){b.onclick=function(){approveVoucher(b.getAttribute('data-pvap'));};});
  root.querySelectorAll('[data-pvrj]').forEach(function(b){b.onclick=function(){rejectVoucher(b.getAttribute('data-pvrj'));};});
  root.querySelectorAll('[data-pvvd]').forEach(function(b){b.onclick=function(){voidVoucher(b.getAttribute('data-pvvd'));};});
  root.querySelectorAll('[data-pvpr]').forEach(function(b){b.onclick=function(){printVoucher(b.getAttribute('data-pvpr'));};});
}
function createVoucher(){
  var amount=Number(fv('pvAmount'))||0; if(!amount){alert('Enter an amount.');return;}
  var requester=(fv('pvRequester')||'').trim(); if(!requester){alert('Enter the requester name.');return;}
  var date=fv('pvDate')||new Date().toISOString().slice(0,10); var category=fv('pvCat'); var approver=(fv('pvApprover')||'').trim();
  var fileEl=document.getElementById('pvReceipt'); var file=fileEl&&fileEl.files&&fileEl.files[0];
  var btn=document.getElementById('pvCreate'); if(btn)btn.disabled=true;
  compressImage(file,function(img){
    nextVoucherNo(function(no){
      var a=A();var id=uid('pv_');
      a.set(a.ref(a.db,'pettyCashVouchers/'+id),{voucherNo:no,date:date,amount:amount,category:category,requesterName:requester,approverName:approver,receiptImg:img||'',status:'pending',createdBy:(activeShift&&activeShift.staff)||'Admin',createdAt:Date.now()}).then(function(){window.__posLog('petty-create',no,peso(amount));renderPetty();}).catch(function(e){alert('Could not save voucher: '+e);if(btn)btn.disabled=false;});
    });
  });
}
function approveVoucher(id){
  var v=pettyVouchers[id]; if(!v||v.status!=='pending')return;
  if(!v.receiptImg){alert('No receipt attached — cannot approve. No audit trail = no approval.');return;}
  var a=A();if(!a.managePettyVoucher||!a.managerApproval){alert('3E petty-cash service is not available. Refresh the portal.');return;}
  a.managerApproval('approve_petty_voucher',id,Number(v.amount)||0,'Approve '+v.voucherNo).then(function(ap){return a.managePettyVoucher({action:'approve',voucherId:id,approvalId:ap.approvalId});}).then(function(){window.__posLog('petty-approve',v.voucherNo,peso(v.amount));alert('Voucher approved.');}).catch(function(e){if(String((e&&e.message)||e).indexOf('cancelled')<0)alert('Approval failed: '+((e&&e.message)||e));});
}
function rejectVoucher(id){
  var v=pettyVouchers[id]; if(!v||v.status!=='pending')return;
  var a=A();if(!a.managePettyVoucher||!a.managerApproval){alert('3E petty-cash service is not available. Refresh the portal.');return;}
  F().run({title:'Reject petty-cash voucher',subtitle:v.voucherNo+' · '+peso(v.amount),submitLabel:'Request rejection approval',busyLabel:'Processing…',fields:[{name:'reason',label:'Rejection reason',type:'textarea',required:true,maxLength:300,placeholder:'Explain why this voucher is being rejected'}]},function(x){return a.managerApproval('reject_petty_voucher',id,Number(v.amount)||0,x.reason).then(function(ap){return a.managePettyVoucher({action:'reject',voucherId:id,reason:x.reason,approvalId:ap.approvalId});}).then(function(){window.__posLog('petty-reject',v.voucherNo,x.reason);});}).then(function(){alert('Voucher rejected.');}).catch(function(){});
}
function voidVoucher(id){
  var v=pettyVouchers[id]; if(!v||v.status!=='approved'||v.voided)return;
  var a=A();if(!a.managePettyVoucher||!a.managerApproval){alert('3E petty-cash service is not available. Refresh the portal.');return;}
  F().run({title:'Void petty-cash voucher',subtitle:v.voucherNo+' · '+peso(v.amount),submitLabel:'Request void approval',busyLabel:'Processing…',fields:[{name:'reason',label:'Void reason',type:'textarea',required:true,maxLength:300,placeholder:'Explain why this approved voucher must be voided'}]},function(x){return a.managerApproval('void_petty_voucher',id,Number(v.amount)||0,x.reason).then(function(ap){return a.managePettyVoucher({action:'void',voucherId:id,reason:x.reason,approvalId:ap.approvalId});}).then(function(){window.__posLog('petty-void',v.voucherNo,x.reason);});}).then(function(){alert('Voucher voided and petty cash restored.');}).catch(function(){});
}
function addReplenishment(){
  var amt=Number(fv('prAmount'))||0; if(!amt){alert('Enter an amount.');return;}
  var source=fv('prSource'); var note=(fv('prNote')||'').trim(); var a=A();
  a.set(a.ref(a.db,'pettyCashReplenishments/'+uid('pr_')),{amount:amt,source:source,note:note,by:(activeShift&&activeShift.staff)||'Admin',ts:Date.now(),date:new Date().toISOString().slice(0,10)});
  if(source==='register'){
    if(!activeShift){alert('Recorded to petty cash. Note: no shift is open, so no drawer pay-out was posted — open a shift if you need the Z-report to reflect it.');}
    else{ var po=(activeShift.payOuts||[]).slice(); var poEntry={amount:amt,reason:'Petty cash replenish',ts:Date.now()};
      if(denomTrackingOnR()){ var mc=makeChangeD(amt,drawerNow()); poEntry.denoms=mc.denoms; saveDrawer(subD(drawerNow(),mc.denoms)); if(!mc.ok)alert('Note: the drawer can’t provide exactly '+peso(amt)+' (short '+peso(mc.short)+'). Recorded the closest notes removed — reconcile at count.'); }
      po.push(poEntry); a.update(a.ref(a.db,'shifts/'+activeShift.id),{payOuts:po}); a.update(a.ref(a.db,'posActiveShift'),{payOuts:po}); }
  }
  window.__posLog('petty-replenish',source,peso(amt));
}
function printVoucher(id){
  var v=pettyVouchers[id]; if(!v)return;
  var w=window.open('','_blank','width=420,height=640'); if(!w){alert('Allow pop-ups to print the voucher.');return;}
  w.document.write('<html><head><title>'+esc(v.voucherNo)+'</title><style>*{font-family:Arial,sans-serif;color:#000;}body{padding:18px;}h2{text-align:center;margin:2px 0;}table{width:100%;border-collapse:collapse;margin-top:8px;}td{padding:4px 2px;vertical-align:top;}hr{border:none;border-top:1px dashed #000;}img{max-width:100%;margin-top:8px;border:1px solid #ccc;}.sig{margin-top:34px;display:flex;justify-content:space-between;}.sig div{width:45%;border-top:1px solid #000;text-align:center;font-size:11px;padding-top:3px;}@media print{button{display:none;}}</style></head><body>'
    +'<h2>Accaza Coffee House</h2><div style="text-align:center;font-weight:bold;">PETTY CASH VOUCHER</div><hr>'
    +'<table><tr><td>Voucher No.</td><td style="text-align:right;font-weight:bold;">'+esc(v.voucherNo)+'</td></tr>'
    +'<tr><td>Date</td><td style="text-align:right;">'+esc(v.date||'')+'</td></tr>'
    +'<tr><td>Amount</td><td style="text-align:right;font-weight:bold;">'+peso(v.amount)+'</td></tr>'
    +'<tr><td>Category</td><td style="text-align:right;">'+esc(v.category||'')+'</td></tr>'
    +'<tr><td>Requested by</td><td style="text-align:right;">'+esc(v.requesterName||'')+'</td></tr>'
    +'<tr><td>Approved by</td><td style="text-align:right;">'+esc(v.approvedBy||v.approverName||'')+'</td></tr>'
    +'<tr><td>Status</td><td style="text-align:right;">'+(v.voided?'VOID':esc(v.status||''))+'</td></tr></table>'
    +(v.receiptImg?'<div style="font-size:11px;margin-top:8px;">Receipt:</div><img src="'+v.receiptImg+'"/>':'')
    +'<div class="sig"><div>Received by</div><div>Approved by</div></div>'
    +'<div style="text-align:center;margin-top:16px;"><button onclick="window.print()">Print</button></div>'
    +'</body></html>'); w.document.close();
}
function exportPetty(){
  if(!window.XLSX){alert('Excel library still loading — try again.');return;}
  var bal=pettyBalance();
  var aoa=[['voucherNo','date','amount','category','requester','approvedBy','status','voided','createdBy']];
  Object.keys(pettyVouchers).map(function(k){return pettyVouchers[k];}).sort(function(a,b){return (a.createdAt||0)-(b.createdAt||0);}).forEach(function(v){aoa.push([v.voucherNo||'',v.date||'',Number(v.amount)||0,v.category||'',v.requesterName||'',v.approvedBy||v.approverName||'',v.status||'',v.voided?'yes':'',v.createdBy||'']);});
  aoa.push([]);aoa.push(['Opening',bal.opening]);aoa.push(['Replenishments',bal.replen]);aoa.push(['Disbursements',bal.disb]);aoa.push(['Remaining',bal.remaining]);
  var wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(aoa),'PettyCash');
  XLSX.writeFile(wb,'accaza-petty-cash-'+new Date().toISOString().slice(0,10)+'.xlsx');
}
function archiveOldActivity(){
  if(!confirm('Move activity-log entries older than 60 days to the server-owned archive? Up to 500 entries are processed per click.'))return;
  var a=A();if(!a.archiveActivityLog){alert('3E retention service is not available. Refresh the portal.');return;}
  a.archiveActivityLog().then(function(res){var d=(res&&res.data)||res||{};alert(d.archived?('Archived '+d.archived+' entries.'+(d.hasMore?' Click again to archive the next batch.':'')):'No activity-log entries older than 60 days.');}).catch(function(e){alert('Could not archive activity log: '+((e&&e.message)||e));});
}
function cashMove(dir){
  if(!activeShift){alert('Open a shift first.');return;}
  var shiftId=activeShift.id;
  var mask=document.createElement('div'); mask.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;';
  var denom=denomTrackingOnR();
  mask.innerHTML='<div style="background:#fff;border-radius:10px;max-width:'+(denom?'520':'400')+'px;width:100%;max-height:90vh;overflow:auto;padding:1.2rem;">'
    +'<div style="font-weight:700;color:var(--bd);margin-bottom:0.5rem;">Cash in — add to drawer</div>'
    +(denom?('<span class="pz-lbl">Notes/coins added</span>'+denomGridHtml('cmDenom')):'<div><span class="pz-lbl">Amount ₱</span><input class="pz-in" id="cmAmt" type="number" step="any"/></div>')
    +'<div style="margin-top:0.5rem;"><span class="pz-lbl">Reason</span><select class="pz-in" id="cmReason"><option>Owner top-up</option><option>Change float</option><option>Return</option><option>Other</option></select></div>'
    +'<div style="margin-top:0.5rem;padding:0.45rem 0.55rem;background:#f4efe7;border-radius:6px;font-size:0.76rem;color:var(--tl);">Owner, Superadmin, Admin, or Manager approval is recorded when you submit.</div>'
    +'<div style="display:flex;gap:0.5rem;margin-top:1rem;"><button class="pz-btn ok" id="cmSubmit">Add to drawer</button><button class="pz-btn sec" id="cmCancel">Cancel</button></div></div>';
  document.body.appendChild(mask);
  if(denom)wireDenom('cmDenom');
  mask.querySelector('#cmCancel').onclick=function(){document.body.removeChild(mask);};
  mask.querySelector('#cmSubmit').onclick=async function(){
    var amt, counts=null;
    if(denom){var rd=denomRead('cmDenom'); amt=rd.total; counts=rd.counts;} else { amt=Number(mask.querySelector('#cmAmt').value)||0; }
    if(!amt||amt<0){alert('Enter a valid amount / notes.');return;}
    var reason=mask.querySelector('#cmReason').value||'Other',a=A(),btn=this;if(!a.managerApproval||!a.consumeManagerApproval){alert('Privileged cash-in approval is unavailable. Refresh the portal.');return;}if(!activeShift||activeShift.id!==shiftId){alert('The active shift changed. Close this window and try again.');return;}btn.disabled=true;btn.textContent='Approving…';var sourceId='cash_in_'+shiftId+'_'+Date.now();
    try{var ap=await a.managerApproval('cash_in',sourceId,amt,reason);if(!activeShift||activeShift.id!==shiftId)throw new Error('The active shift changed before the cash-in was recorded.');var cr=await a.consumeManagerApproval({action:'cash_in',sourceId:sourceId,amount:amt,operationKey:sourceId,approvalId:ap.approvalId}),cd=(cr&&cr.data)||cr||{},approver=cd.approvedBy||'Privileged account';if(!activeShift||activeShift.id!==shiftId)throw new Error('The active shift changed before the cash-in was recorded.');var arr=(activeShift.payIns||[]).slice();arr.push({amount:amt,reason:reason,by:approver,approvedByUid:cd.approvedByUid||'',approvedRole:cd.approvedRole||'',ts:Date.now(),denoms:counts||null,approvalId:ap.approvalId});await Promise.all([a.update(a.ref(a.db,'shifts/'+shiftId),{payIns:arr}),a.update(a.ref(a.db,'posActiveShift'),{payIns:arr})]);if(denom&&counts)saveDrawer(mergeD(drawerNow(),counts));window.__posLog('cash-in',reason,peso(amt)+' by '+approver+' · '+ap.approvalId);document.body.removeChild(mask);alert('Recorded. Expected drawer increased by '+peso(amt)+'.');}catch(e){btn.disabled=false;btn.textContent='Add to drawer';if(String((e&&e.message)||e).indexOf('cancelled')<0)alert('Cash-in approval failed: '+((e&&e.message)||e));}
  };
}
function pendingPanel(){
  var all=Object.keys(ordersMap).map(function(k){return Object.assign({id:k},ordersMap[k]);}).filter(function(o){return !o.voided&&['grabfood','foodpanda'].indexOf(o.channel)<0;}).sort(function(a,b){return (a.timestamp||0)-(b.timestamp||0);}),list=all.filter(function(o){return o.paymentStatus==='pending';}),review=all.filter(function(o){return o.paymentStatus==='cashier_verified';});
  var tot=list.reduce(function(s,o){return s+(Number(o.total)||0);},0);
  var h='<div class="pz-card" style="margin-bottom:1rem;border:1px solid #ffe0a3;background:#fffdf5;">';
  h+='<div style="display:flex;justify-content:space-between;align-items:center;"><span style="font-weight:700;color:#8a6d1b;">⏳ Payments to verify</span><span style="font-weight:700;color:#8a6d1b;">'+peso(tot)+' · '+list.length+'</span></div>';
  if(!list.length){h+='<p class="pz-sub" style="margin:0.4rem 0 0;">Nothing awaiting cashier verification.</p>';}else{
  h+='<p class="pz-sub" style="margin:0.3rem 0 0.6rem;">Cashier checks the actual receiving account and reference before releasing the sale.</p>';
  h+='<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:0.8rem;"><thead><tr style="text-align:left;color:var(--tl);"><th style="padding:0.3rem;">Sale</th><th style="padding:0.3rem;">Amount</th><th style="padding:0.3rem;">Method</th><th style="padding:0.3rem;">Ref no.</th><th style="padding:0.3rem;">Time</th><th></th></tr></thead><tbody>';
  h+=list.map(function(o){var refs=(o.payments||[]).filter(function(p){return p.ref;}).map(function(p){return esc(p.ref);}).join(', ')||'—';var meth=(o.payments&&o.payments.length>1)?'Split':esc(o.payment||'');return '<tr style="border-top:1px solid #eee;"><td style="padding:0.3rem;font-weight:600;">'+esc(o.id)+'</td><td style="padding:0.3rem;">'+peso(o.total)+'</td><td style="padding:0.3rem;">'+meth+'</td><td style="padding:0.3rem;">'+refs+'</td><td style="padding:0.3rem;color:var(--tl);">'+esc(o.time||'')+'</td><td style="padding:0.3rem;"><button class="pz-btn ok" data-verify="'+esc(o.id)+'" style="padding:0.25rem 0.6rem;">✅ Verify</button></td></tr>';}).join('');
  h+='</tbody></table></div>';}
  h+='<div style="border-top:1px solid #eadfca;margin-top:.8rem;padding-top:.8rem;display:flex;justify-content:space-between;"><b style="color:#0c5460;">Manager revalidation</b><b>'+review.length+'</b></div>';
  if(!review.length)h+='<p class="pz-sub" style="margin:.35rem 0 0;">No cashier-verified payments awaiting review.</p>';else h+='<div style="overflow-x:auto;margin-top:.45rem;"><table style="width:100%;border-collapse:collapse;font-size:.8rem;"><tbody>'+review.map(function(o){var refs=paysOf(o).filter(function(p){return p.ref;}).map(function(p){return esc(p.ref);}).join(', ')||'—';return'<tr style="border-top:1px solid #eee;"><td style="padding:.35rem;font-weight:600;">'+esc(o.id)+'</td><td style="padding:.35rem;">'+peso(o.total)+'</td><td style="padding:.35rem;">'+esc(o.payment||'')+'</td><td style="padding:.35rem;">'+refs+'</td><td style="padding:.35rem;"><button class="pz-btn ok" data-validate="'+esc(o.id)+'" style="padding:.25rem .6rem;">Manager validate</button></td></tr>';}).join('')+'</tbody></table></div>';
  h+='</div>';
  return h;
}
function renderOps(){
  var root=document.getElementById('opsRoot');if(!root)return;
  var html='<div class="pz-h">🧾 Register Ops</div><p class="pz-sub">Shift control, cash reconciliation, voids &amp; refunds — all logged. Owner, Superadmin, Admin, or Manager accounts approve controlled actions.</p>';
  html+=pendingPanel();
  // SHIFT
  html+='<div class="pz-card" style="margin-bottom:1rem;">';
  if(activeShift){
    var z=computeZ(activeShift);
    html+='<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem;"><div><span style="color:#2a9d5c;font-weight:700;">🟢 Shift open</span> · Cashier <b>'+esc(activeShift.staff)+'</b> · since '+new Date(activeShift.openAt).toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'})+'</div><button class="pz-btn warn" id="opsClose">Close shift &amp; Z-report</button></div>';
    html+='<div style="display:flex;gap:0.5rem;margin-top:0.6rem;flex-wrap:wrap;align-items:center;"><button class="pz-btn ok" id="opsReview">📋 Shift review</button><button class="pz-btn sec" id="opsCashIn">➕ Cash in</button>'+(denomTrackingOnR()?'<button class="pz-btn sec" id="opsSwap">🔁 Break a bill</button>':'')+'<span style="font-size:0.72rem;color:var(--tl);">For expenses, top up <b>Petty Cash</b> (Replenish → from register) and disburse with a voucher — no direct cash-out from the drawer.</span></div>';
    html+='<div class="az-kpis" style="margin-top:0.8rem;">'+kpi('Sales',z.tx)+kpi('Net',peso(z.net))+kpi('Cash in',peso(z.cashSales))+kpi('Tips',peso(z.tips))+kpi('Expected drawer',peso(z.expectedCash))+kpi('Cash to settle',peso(z.cashToSettle))+kpi('Voids',z.voidCount)+kpi('Refunds',peso(z.refunds))+kpi('⏳ Cashier check',peso(z.pending)+(z.pendingCount?' ('+z.pendingCount+')':''))+kpi('🔎 Manager review',peso(z.managerPending)+(z.managerPendingCount?' ('+z.managerPendingCount+')':''))+'</div>';
  } else {
    var opts=staffArr().map(function(s){return '<option value="'+s.id+'">'+esc(s.name)+' ('+esc(s.role||'cashier')+')</option>';}).join('');
    html+='<div style="font-weight:600;color:var(--bd);margin-bottom:0.5rem;">Open a shift</div>'
      +(staffArr().length?('<div style="display:flex;gap:0.5rem;align-items:end;flex-wrap:wrap;margin-bottom:0.6rem;"><div><span class="pz-lbl">Cashier</span><select class="pz-in" id="opsStaff" style="min-width:160px;">'+opts+'</select></div><button class="pz-btn ok" id="opsOpen">Open shift</button></div>'
          +'<span class="pz-lbl">Opening cash float — count denominations</span>'+denomGridHtml('opsOpenDenom'))
        :'<p class="az-note">Add at least one staff member with a PIN below first.</p>');
  }
  html+='</div>';
  html+=shiftCardHtml();
  // HELD ORDERS
  var held=Object.keys(heldMap).map(function(k){return Object.assign({id:k},heldMap[k]);}).sort(function(a,b){return(b.ts||0)-(a.ts||0);});
  if(held.length){
    html+='<div class="az-sec">Held orders ('+held.length+')</div><div class="pz-card">'+held.map(function(h){var n=Object.keys(h.cart||{}).length;return '<div style="display:flex;justify-content:space-between;align-items:center;padding:0.35rem 0;border-bottom:1px solid var(--cd);font-size:0.83rem;"><span>'+n+' item(s)'+(h.note?' · '+esc(h.note):'')+' · '+new Date(h.ts).toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'})+'</span><span><button class="pz-btn ok" style="padding:0.2rem 0.6rem;" data-recall="'+h.id+'">Recall</button> <button class="pz-btn warn" style="padding:0.2rem 0.5rem;" data-hdisc="'+h.id+'">✕</button></span></div>';}).join('')+'</div>';
  }
  // VOID / REFUND recent sales
  var recent=activeShift?Object.keys(ordersMap).map(function(k){return ordersMap[k];}).filter(function(o){return o&&o.shiftId===activeShift.id&&(o.status==='Completed'||o.status==='Received');}).sort(function(a,b){return(b.timestamp||0)-(a.timestamp||0);}).slice(0,60):[];
  var recentOriginal=recent.reduce(function(s,o){return s+(Number(o.total)||0);},0),recentVoids=recent.reduce(function(s,o){return s+(o.voided?(Number(o.total)||0):0);},0),recentRefunds=recent.reduce(function(s,o){return s+(o.voided?0:(Number(o.refundAmount)||0));},0),recentNet=recentOriginal-recentVoids-recentRefunds;
  html+='<div class="az-sec">Recent sales — void / refund</div><div class="pz-card"><table class="pz-tbl"><thead><tr><th>Order</th><th>Time</th><th>Total</th><th>Status</th><th></th></tr></thead><tbody>'
    +(recent.length?recent.map(function(o){var st=o.voided?'<span style="color:#e63946;">VOID</span>':(Number(o.refundAmount)>0?'<span style="color:#e67e00;">Refunded '+peso(o.refundAmount)+'</span>':'OK');return '<tr><td>'+esc(o.id)+'<div style="font-size:0.7rem;color:var(--tl);">'+esc((o.staff||''))+'</div></td><td>'+esc(o.time||'')+'</td><td>'+peso(o.total)+'</td><td>'+st+'</td><td style="white-space:nowrap;">'+(o.voided?'':'<button class="pz-btn sec" style="padding:0.2rem 0.5rem;" data-refund="'+o.id+'">Refund</button> <button class="pz-btn warn" style="padding:0.2rem 0.5rem;" data-void="'+o.id+'">Void</button>')+'</td></tr>';}).join(''):'<tr><td colspan="5" class="az-note" style="padding:0.8rem;">'+(activeShift?'No sales in this shift yet.':'No open shift — a shift’s sales show here while it’s open and clear when it closes.')+'</td></tr>')
    +'<tr class="register-total"><td colspan="2">Total net ('+recent.length+' sales)</td><td>'+peso(recentNet)+'</td><td colspan="2">Original '+peso(recentOriginal)+' · Voids −'+peso(recentVoids)+' · Refunds −'+peso(recentRefunds)+'</td></tr></tbody></table></div>';
  // (Staff & PINs, POS Settings, and Payment methods moved to the Settings ▸ POS Settings tab — see renderPosSettings)
  var acts=Object.keys(activityMap).map(function(k){return activityMap[k];}).sort(function(a,b){return(b.ts||0)-(a.ts||0);}).slice(0,20);
  html+='<div class="az-sec" style="display:flex;justify-content:space-between;align-items:center;"><span id="opsLogToggle" style="cursor:pointer;user-select:none;">'+(logCollapsed?'▸':'▾')+' Activity log <span style="font-weight:400;color:var(--tl);font-size:0.78rem;">('+acts.length+')</span></span> <button class="pz-btn sec" id="opsArchiveLog" style="padding:0.2rem 0.6rem;font-size:0.72rem;font-weight:400;">Archive entries &gt; 60 days</button></div><div class="pz-card" id="opsLogBody"'+(logCollapsed?' style="display:none;"':'')+'><table class="pz-tbl"><tbody>'
    +(acts.length?acts.map(function(x){return '<tr><td style="white-space:nowrap;color:var(--tl);font-size:0.75rem;">'+new Date(x.ts).toLocaleString('en-PH',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})+'</td><td><b>'+esc(x.action)+'</b> '+esc(x.ref||'')+'</td><td>'+esc(x.detail||'')+'</td><td style="color:var(--tl);">'+esc(x.staff||'')+'</td></tr>';}).join(''):'<tr><td class="az-note" style="padding:0.5rem;">No activity yet.</td></tr>')
    +'</tbody></table></div>';
  root.innerHTML=html;
  // wire
  root.querySelectorAll('[data-verify]').forEach(function(b){b.onclick=function(){window.__posVerify(b.getAttribute('data-verify'));};});
  root.querySelectorAll('[data-validate]').forEach(function(b){b.onclick=function(){validatePayment(b.getAttribute('data-validate'));};});
  var _al=document.getElementById('opsArchiveLog'); if(_al)_al.onclick=archiveOldActivity;
  var _lt=document.getElementById('opsLogToggle'); if(_lt)_lt.onclick=function(){logCollapsed=!logCollapsed;var b=document.getElementById('opsLogBody');if(b)b.style.display=logCollapsed?'none':'';_lt.innerHTML=(logCollapsed?'▸':'▾')+' Activity log <span style="font-weight:400;color:var(--tl);font-size:0.78rem;">('+acts.length+')</span>';};
  var _cs=document.getElementById('opsCardShift'); if(_cs){_cs.onchange=function(){cardShiftId=this.value;renderShiftCard();};renderShiftCard();}
  var oOpen=document.getElementById('opsOpen');if(oOpen)oOpen.onclick=openShift;
  if(document.getElementById('opsOpenDenom_total'))wireDenom('opsOpenDenom');
  var oClose=document.getElementById('opsClose');if(oClose)oClose.onclick=closeShift;
  var oCin=document.getElementById('opsCashIn');if(oCin)oCin.onclick=function(){cashMove('in');};
  var oRev=document.getElementById('opsReview');if(oRev)oRev.onclick=openShiftReview;
  var oSwap=document.getElementById('opsSwap');if(oSwap)oSwap.onclick=cashSwap;
  root.querySelectorAll('[data-void]').forEach(function(b){b.onclick=function(){voidSale(b.getAttribute('data-void'));};});
  root.querySelectorAll('[data-refund]').forEach(function(b){b.onclick=function(){refundSale(b.getAttribute('data-refund'));};});
  root.querySelectorAll('[data-recall]').forEach(function(b){b.onclick=function(){var h=heldMap[b.getAttribute('data-recall')];if(h&&window.__pos){window.__pos.loadCart(h.cart);var a=A();a.remove(a.ref(a.db,'heldOrders/'+b.getAttribute('data-recall')));}};});
  root.querySelectorAll('[data-hdisc]').forEach(function(b){b.onclick=function(){if(confirm('Discard this held order?')){var a=A();a.remove(a.ref(a.db,'heldOrders/'+b.getAttribute('data-hdisc')));}};});
}
function shiftOptions(){
  var opts='';
  if(activeShift)opts+='<option value="'+esc(activeShift.id)+'">🟢 Open — '+esc(activeShift.staff||'')+' · '+new Date(activeShift.openAt).toLocaleString('en-PH',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})+'</option>';
  Object.keys(shiftsMap).map(function(k){return Object.assign({id:k},shiftsMap[k]);}).filter(function(s){return s.status==='closed';}).sort(function(a,b){return (b.openAt||0)-(a.openAt||0);}).slice(0,80).forEach(function(s){opts+='<option value="'+esc(s.id)+'">'+esc(s.staff||'')+' · '+new Date(s.openAt).toLocaleString('en-PH',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})+(s.closeAt?('–'+new Date(s.closeAt).toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'})):'')+'</option>';});
  return opts;
}
function shiftCardHtml(){
  var opts=shiftOptions(); if(!opts)return '';
  return '<div class="az-sec">📇 Shift summary</div><div class="pz-card" style="margin-bottom:1rem;"><div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.6rem;"><span style="font-size:0.85rem;color:var(--bd);font-weight:600;">Shift</span><select class="pz-in" id="opsCardShift" style="min-width:250px;">'+opts+'</select></div><div id="opsCardBody"></div></div>';
}
function shiftSummaryObj(shift,isOpen){
  if(isOpen){var z=computeZ(shift);return {tx:z.tx,net:z.net,gross:z.gross,cashSales:z.cashSales,byMethod:z.byMethod,byChannel:z.byChannel,expectedCash:z.expectedCash,countedCash:null,retainedFloat:z.retainedFloat,cashToSettle:z.cashToSettle,variance:null,openingFloat:Number(shift.openingFloat)||0,openAt:shift.openAt,closeAt:null,open:true};}
  var rf=(shift.retainedFloat!=null?Number(shift.retainedFloat):(fixedFloatCfg!=null?fixedFloatCfg:(Number(shift.openingFloat)||0)));
  var counted=(shift.countedCash!=null?Number(shift.countedCash):null);
  var cts=(shift.cashToSettle!=null?Number(shift.cashToSettle):Math.round(((counted!=null?counted:(Number(shift.expectedCash)||0))-rf)*100)/100);
  return {tx:Number(shift.tx)||0,net:Number(shift.net)||0,gross:Number(shift.gross)||0,cashSales:(shift.byMethod&&shift.byMethod.Cash)||0,byMethod:shift.byMethod||{},byChannel:shift.byChannel||null,expectedCash:Number(shift.expectedCash)||0,countedCash:counted,retainedFloat:rf,cashToSettle:cts,variance:(shift.variance!=null?Number(shift.variance):null),openingFloat:Number(shift.openingFloat)||0,openAt:shift.openAt,closeAt:shift.closeAt||null,open:false};
}
function loadShiftTransactions(id){var a=A();return Promise.all([a.get(a.ref(a.db,'orders')),a.get(a.ref(a.db,'archivedOrders'))]).then(function(snaps){var merged=Object.assign({},snaps[1].val()||{},snaps[0].val()||{});return Object.keys(merged).map(function(k){return Object.assign({id:k},merged[k]);}).filter(function(o){return isShiftTransaction(o,id);}).sort(function(x,y){return (x.timestamp||0)-(y.timestamp||0);});});}
function reviewShiftCash(shift,isOpen){
  if(isOpen){openShiftReview();return;}
  var reportWindow=window.open('','_blank','width=380,height=680');if(!reportWindow){alert('Allow pop-ups to view the Z-report.');return;}reportWindow.document.write('<html><body style="font-family:monospace;padding:12px;">Loading complete shift report…</body></html>');reportWindow.document.close();
  var r=shift.zReport||null,z=r?Object.assign({},r,{saleList:r.sales||[],reportClosedAt:r.capturedAt,closeCount:r.closeCount||{},expectedDrawer:r.expectedDrawer||{},reconcileTotalOnly:!!r.reconcileTotalOnly}):{tx:Number(shift.tx)||0,gross:Number(shift.gross)||0,discounts:Number(shift.discounts)||0,refunds:Number(shift.refunds)||0,cashRefunds:Number(shift.cashRefunds)||0,net:Number(shift.net)||0,byMethod:shift.byMethod||{},byChannel:shift.byChannel||{},cashSales:Number((shift.byMethod||{}).Cash)||0,tips:Number(shift.tips)||0,payIns:Number(shift.payIns)||0,payOuts:Number(shift.payOuts)||0,expectedCash:Number(shift.expectedCash)||0,countedCash:Number(shift.countedCash)||0,variance:Number(shift.variance)||0,retainedFloat:Number(shift.retainedFloat)||0,cashToSettle:Number(shift.cashToSettle)||0,voidCount:Number(shift.voidCount)||0,voidAmt:Number(shift.voidAmt)||0,pending:Number(shift.pending)||0,pendingCount:Number(shift.pendingCount)||0,closeCount:shift.closeCount||{},expectedDrawer:shift.drawerExpected||{},reportClosedAt:shift.closeAt,legacyReport:true};
  loadShiftTransactions(shift.id).then(function(sales){z.saleList=sales;showZ(shift,z,reportWindow);}).catch(function(){showZ(shift,z,reportWindow);});
}
function shiftTxTable(list,expected){
  if(!list.length)return '<div class="az-note" style="padding:0.4rem;">No transaction lines available'+(expected?(' (summary shows '+expected+' — older lines may be archived)'):'')+'.</div>';
  var note=(expected&&list.length<expected)?'<div class="az-note" style="padding:0.3rem 0;">Showing '+list.length+' of '+expected+' — older lines archived.</div>':'';
  var total=list.reduce(function(s,o){return s+(Number(o.total)||0)-(Number(o.refundAmount)||0);},0);
  return note+'<div style="overflow-x:auto;"><table class="pz-tbl"><thead><tr><th>Time</th><th>Order</th><th>Channel</th><th>Method</th><th class="r">Amount</th></tr></thead><tbody>'+list.map(function(o){var ch=channelLabel(o);var tag=Number(o.refundAmount)>0?' · R '+peso(o.refundAmount):'';return '<tr><td>'+esc(o.time||'')+'</td><td>'+esc(o.id)+'</td><td>'+esc(ch)+'</td><td>'+esc(shiftTxnMethod(o))+'</td><td class="r">'+peso(o.total)+esc(tag)+'</td></tr>';}).join('')+'<tr class="register-total"><td colspan="4">Total ('+list.length+' transactions)</td><td class="r">'+peso(total)+'</td></tr></tbody></table></div>';
}
function isShiftTransaction(o,id){
  if(!o||o.shiftId!==id||o.voided)return false;
  return o.status==='Completed'||o.status==='Received'||(o.status==='Archived'&&(o.prevStatus==='Completed'||o.prevStatus==='Received'));
}
function renderShiftCard(){
  var sel=document.getElementById('opsCardShift'),body=document.getElementById('opsCardBody'); if(!sel||!body)return;
  if(cardShiftId){var has=false;Array.prototype.forEach.call(sel.options,function(o){if(o.value===cardShiftId)has=true;});if(!has)cardShiftId=null;}
  if(!cardShiftId)cardShiftId=sel.value; sel.value=cardShiftId;
  var id=cardShiftId, isOpen=!!(activeShift&&activeShift.id===id);
  var shift=isOpen?activeShift:(shiftsMap[id]?Object.assign({id:id},shiftsMap[id]):null);
  if(!shift){body.innerHTML='<p class="az-note">Shift not found.</p>';return;}
  var S=shiftSummaryObj(shift,isOpen);
  var chRows=S.byChannel?([['instore','In-store'],['online','Online Orders'],['grabfood','GrabFood'],['foodpanda','FoodPanda']].map(function(c){var v=(S.byChannel&&S.byChannel[c[0]])||0;if(!v&&c[0]!=='instore')return '';return '<tr><td>'+c[1]+'</td><td class="r">'+peso(v)+'</td></tr>';}).join('')):'<tr><td colspan="2" class="az-note">Channel split not stored for this shift.</td></tr>';
  var mRows=Object.keys(S.byMethod).sort().map(function(m){return '<tr><td>'+esc(m)+'</td><td class="r">'+peso(S.byMethod[m])+'</td></tr>';}).join('')||'<tr><td colspan="2" class="az-note">—</td></tr>';
  var hdr='<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.4rem;margin-bottom:0.5rem;"><div><b>'+esc(shift.staff||'')+'</b> · '+new Date(S.openAt).toLocaleString('en-PH',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})+(S.closeAt?('–'+new Date(S.closeAt).toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'})):'')+'</div><span style="font-weight:700;color:'+(S.open?'#2a9d5c':'var(--tl)')+';">'+(S.open?'🟢 Open':'Closed')+'</span></div>';
  var kpis='<div class="az-kpis" style="margin:0 0 0.7rem;">'+kpi('Transactions',S.tx)+kpi('Net sales',peso(S.net))+kpi('Cash sales',peso(S.cashSales))+kpi('Cash to settle',peso(S.cashToSettle))+'</div>';
  var recon='<div class="az-sec">Cash</div><div class="pz-card" style="margin-bottom:0.6rem;"><table class="pz-tbl"><tbody>'
    +'<tr><td>Opening float</td><td class="r">'+peso(S.openingFloat)+'</td></tr>'
    +'<tr><td>Expected drawer</td><td class="r">'+peso(S.expectedCash)+'</td></tr>'
    +(S.countedCash!=null?'<tr><td>Counted cash</td><td class="r">'+peso(S.countedCash)+'</td></tr>':'')
    +(S.variance!=null?'<tr><td>Variance</td><td class="r" style="color:'+(Math.abs(S.variance)<=(Number(toleranceCfg.cashPeso)||0)?'#155724':'#c0392b')+';">'+peso(S.variance)+'</td></tr>':'')
    +'<tr><td>Less float retained</td><td class="r">−'+peso(S.retainedFloat)+'</td></tr>'
    +'<tr style="border-top:2px solid var(--bd);"><td><b>► Cash to settle</b></td><td class="r"><b>'+peso(S.cashToSettle)+'</b></td></tr>'
    +'</tbody></table><div style="display:flex;justify-content:flex-end;margin-top:0.6rem;"><button class="pz-btn sec" id="opsCashReview">'+(S.open?'📋 Review live cash':'🧾 View final Z-report')+'</button></div></div>';
  var methodTotal=Object.keys(S.byMethod).reduce(function(sum,m){return sum+(Number(S.byMethod[m])||0);},0);
  var chBlk='<div class="az-sec">Sales by channel</div><div class="pz-card" style="margin-bottom:0.6rem;"><table class="pz-tbl"><tbody>'+chRows+'<tr class="register-total"><td>Total net sales</td><td class="r">'+peso(S.net)+'</td></tr></tbody></table><div class="az-note">Online Orders are verified non-cash sales captured in the shift. GrabFood/FoodPanda remain platform receivables. None of these increases physical drawer cash.</div></div>';
  var mBlk='<div class="az-sec">By payment method</div><div class="pz-card" style="margin-bottom:0.6rem;"><table class="pz-tbl"><tbody>'+mRows+'<tr class="register-total"><td>Total</td><td class="r">'+peso(methodTotal)+'</td></tr></tbody></table></div>';
  body.innerHTML=hdr+kpis+recon+chBlk+mBlk+'<div class="az-sec">Transactions</div><div class="pz-card" id="opsCardTx"><p class="az-note">Loading…</p></div>';
  var cashReview=document.getElementById('opsCashReview');if(cashReview)cashReview.onclick=function(){reviewShiftCash(shift,isOpen);};
  var txEl=document.getElementById('opsCardTx');
  if(isOpen){ if(txEl)txEl.innerHTML=shiftTxTable(shiftSales(shift)); }
  else { loadShiftTransactions(id).then(function(arr){var el=document.getElementById('opsCardTx');if(el)el.innerHTML=shiftTxTable(arr,S.tx);}).catch(function(){var el=document.getElementById('opsCardTx');if(el)el.innerHTML='<div class="az-note" style="padding:0.4rem;">Could not load transaction lines.</div>';}); }
}
// POS Settings tab (Settings ▸ POS Settings): Staff & PINs, cash/reconciliation
// settings, and payment methods — moved out of Register Operations.
function renderPosSettings(){
  var root=document.getElementById('posSettingsRoot');if(!root)return;
  var html='';
  html+='<div class="az-sec">Staff &amp; PINs</div><div class="pz-card" style="margin-bottom:1rem;"><div style="display:grid;grid-template-columns:1.5fr 1fr 1fr auto;gap:0.5rem;align-items:end;">'
    +'<div><span class="pz-lbl">Name</span><input class="pz-in" id="stName" placeholder="e.g. Maria"/></div>'
    +'<div><span class="pz-lbl">4-digit PIN</span><input class="pz-in" id="stPin" inputmode="numeric" maxlength="6" placeholder="1234"/></div>'
    +'<div><span class="pz-lbl">Role</span><select class="pz-in" id="stRole"><option value="cashier">Cashier</option><option value="manager">Manager</option></select></div>'
    +'<button class="pz-btn" id="stAdd">Add</button></div>'
    +'<table class="pz-tbl" style="margin-top:0.6rem;"><tbody>'+(staffArr().length?staffArr().map(function(s){return '<tr><td>'+esc(s.name)+'</td><td>'+esc(s.role||'cashier')+'</td><td style="color:var(--tl);">PIN ••••</td><td style="white-space:nowrap;"><button class="pz-btn sec" style="padding:0.2rem 0.5rem;" data-stpin="'+s.id+'">Change PIN</button> <button class="pz-btn warn" style="padding:0.2rem 0.5rem;" data-stdel="'+s.id+'">✕</button></td></tr>';}).join(''):'<tr><td class="az-note" style="padding:0.5rem;">No staff yet.</td></tr>')+'</tbody></table></div>';
  html+='<div class="az-sec">Settings</div><div class="pz-card" style="margin-bottom:1rem;"><label style="font-size:0.85rem;cursor:pointer;display:block;"><input type="checkbox" id="opsRound"/> Round cash totals to the nearest peso</label><label style="font-size:0.85rem;cursor:pointer;display:block;margin-top:0.5rem;"><input type="checkbox" id="opsDenom"/> Track cash by denomination at checkout (running drawer + per-denomination shift reconciliation)</label><label style="font-size:0.85rem;cursor:pointer;display:block;margin-top:0.5rem;"><input type="checkbox" id="opsTotalOnly"/> Reconcile on total only at close (still count denominations to reach the total, but skip the per-denomination variance)</label><div style="display:flex;align-items:center;gap:0.5rem;margin-top:0.6rem;"><span style="font-size:0.85rem;">Cash variance tolerance ₱</span><input class="pz-in" id="opsTolerance" type="number" step="any" style="width:90px;"/><span style="font-size:0.75rem;color:var(--tl);">a discrepancy is only logged when the total is off by more than this</span></div><div style="display:flex;align-items:center;gap:0.5rem;margin-top:0.6rem;"><span style="font-size:0.85rem;">Fixed cash float (imprest) ₱</span><input class="pz-in" id="opsFloat" type="number" step="any" placeholder="opening float" style="width:110px;"/><span style="font-size:0.75rem;color:var(--tl);">Optional. Blank = cashier keeps her opening float and remits the takings. Set a number for a fixed imprest float (0 = remit the whole drawer).</span></div></div>';
  html+='<div class="pz-card" style="margin-bottom:1rem;"><div style="font-weight:600;color:var(--bd);margin-bottom:0.5rem;">💳 Payment methods</div><div id="payMethodsBox"></div></div>';
  root.innerHTML=html;
  var sa=document.getElementById('stAdd');if(sa)sa.onclick=addStaff;
  root.querySelectorAll('[data-stpin]').forEach(function(b){b.onclick=function(){changeStaffPin(b.getAttribute('data-stpin'));};});
  root.querySelectorAll('[data-stdel]').forEach(function(b){b.onclick=function(){if(confirm('Remove this staff?')){var a=A();a.remove(a.ref(a.db,'posStaff/'+b.getAttribute('data-stdel')));}};});
  var rc=document.getElementById('opsRound');if(rc){var a=A();a.get(a.ref(a.db,'posSettings')).then(function(s){var v=s.val()||{};rc.checked=!!v.cashRounding;});rc.onchange=function(){var a=A();a.update(a.ref(a.db,'posSettings'),{cashRounding:rc.checked});};}
  var dt=document.getElementById('opsDenom');if(dt){var a2=A();a2.get(a2.ref(a2.db,'posSettings')).then(function(s){var v=s.val()||{};dt.checked=!!v.denomTracking;});dt.onchange=function(){var a=A();a.update(a.ref(a.db,'posSettings'),{denomTracking:dt.checked});};}
  var to=document.getElementById('opsTotalOnly');if(to){var a3=A();a3.get(a3.ref(a3.db,'posSettings')).then(function(s){var v=s.val()||{};to.checked=!!v.reconcileTotalOnly;});to.onchange=function(){var a=A();a.update(a.ref(a.db,'posSettings'),{reconcileTotalOnly:to.checked});};}
  var tol=document.getElementById('opsTolerance');if(tol){var a4=A();a4.get(a4.ref(a4.db,'posSettings')).then(function(s){var v=s.val()||{};tol.value=((v.tolerances&&v.tolerances.cashPeso!=null)?v.tolerances.cashPeso:20);});tol.onchange=function(){var a=A();a.update(a.ref(a.db,'posSettings/tolerances'),{cashPeso:Number(tol.value)||0});};}
  var ff=document.getElementById('opsFloat');if(ff){var a5=A();a5.get(a5.ref(a5.db,'posSettings')).then(function(s){var v=s.val()||{};ff.value=(v.fixedFloat!=null?v.fixedFloat:'');});ff.onchange=function(){var a=A();var raw=String(ff.value).trim();a.update(a.ref(a.db,'posSettings'),{fixedFloat:raw===''?null:(Number(raw)||0)});};}
  renderPayMethods();
}
function kpi(l,v){return '<div class="az-kpi"><div class="v">'+v+'</div><div class="l">'+esc(l)+'</div></div>';}

function addStaff(){var name=(document.getElementById('stName').value||'').trim();var pin=(document.getElementById('stPin').value||'').trim();var role=document.getElementById('stRole').value;if(!name||!pin){alert('Enter name and PIN.');return;}if(!/^[0-9]{4,6}$/.test(pin)){alert('PIN must be 4-6 digits.');return;}var a=A();a.set(a.ref(a.db,'posStaff/'+uid('st_')),{name:name,pin:pin,role:role,ts:Date.now()});document.getElementById('stName').value='';document.getElementById('stPin').value='';}
function changeStaffPin(id){
  var s=staffList[id]; if(!s)return;
  var mask=document.createElement('div'); mask.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;';
  mask.innerHTML='<div style="background:#fff;border-radius:10px;max-width:380px;width:100%;padding:1.2rem;">'
    +'<div style="font-weight:700;color:var(--bd);margin-bottom:0.5rem;">Change PIN — '+esc(s.name)+'</div>'
    +'<div><span class="pz-lbl">Current PIN</span><input class="pz-in" id="cpCur" type="password" inputmode="numeric"/></div>'
    +'<div style="margin-top:0.5rem;"><span class="pz-lbl">New PIN (4–6 digits)</span><input class="pz-in" id="cpN1" type="password" inputmode="numeric"/></div>'
    +'<div style="margin-top:0.5rem;"><span class="pz-lbl">Confirm new PIN</span><input class="pz-in" id="cpN2" type="password" inputmode="numeric"/></div>'
    +'<div style="display:flex;gap:0.5rem;margin-top:1rem;"><button class="pz-btn ok" id="cpSubmit">Update PIN</button><button class="pz-btn sec" id="cpCancel">Cancel</button></div></div>';
  document.body.appendChild(mask);
  mask.querySelector('#cpCancel').onclick=function(){document.body.removeChild(mask);};
  mask.querySelector('#cpSubmit').onclick=function(){
    var cur=String(mask.querySelector('#cpCur').value||'').trim();
    if(cur!==String(s.pin)){alert('Current PIN is incorrect.');return;}
    var n1=String(mask.querySelector('#cpN1').value||'').trim();
    if(!/^[0-9]{4,6}$/.test(n1)){alert('New PIN must be 4–6 digits.');return;}
    var n2=String(mask.querySelector('#cpN2').value||'').trim();
    if(n1!==n2){alert('The two PINs do not match.');return;}
    if(Object.keys(staffList).some(function(k){return k!==id&&String(staffList[k].pin)===n1;})){alert('That PIN is already used by another staff — choose a different one.');return;}
    var a=A();a.update(a.ref(a.db,'posStaff/'+id),{pin:n1});
    if(window.__posLog)window.__posLog('pin-change',s.name,'');
    document.body.removeChild(mask);
    alert('PIN updated for '+s.name+'.');
  };
}

function openShift(){
  var sid=document.getElementById('opsStaff').value;var s=staffList[sid];if(!s){alert('Pick a cashier.');return;}
  var od=denomRead('opsOpenDenom'); var float=od.total;
  var id='SH-'+Date.now().toString().slice(-6);var a=A();
  var openedAt=Date.now(),fixedMode=fixedFloatCfg!=null,mismatch=fixedMode&&Math.abs(float-fixedFloatCfg)>.009;
  var rec={id:id,staff:s.name,staffId:sid,openingFloat:float,openCount:od.counts,drawer:Object.assign({},od.counts),openAt:openedAt,status:'open',floatMode:fixedMode?'fixed':'opening-count',configuredFloat:fixedMode?fixedFloatCfg:null};
  var active={id:id,staff:s.name,staffId:sid,openingFloat:float,drawer:Object.assign({},od.counts),openAt:openedAt,floatMode:rec.floatMode,configuredFloat:rec.configuredFloat};
  F().run({title:'Open shift',subtitle:s.name+' · opening float '+peso(float)+(fixedMode?' · required '+peso(fixedFloatCfg):' · flexible opening float'),submitLabel:mismatch?'Request exception & open':'Open shift',busyLabel:'Opening…',fields:[{name:'pin',label:s.name+"'s PIN",type:'password',required:true,maxLength:6,placeholder:'4–6 digits',validate:function(v){return /^[0-9]{4,6}$/.test(v)?'':'Enter a 4–6 digit PIN.';}}].concat(mismatch?[{name:'reason',label:'Reason opening float differs from fixed amount',type:'textarea',required:true,maxLength:300,placeholder:'Explain the shortage, overage, or temporary float arrangement'}]:[])},async function(v){
    if(String(s.pin)!==String(v.pin))throw new Error('Cashier PIN is incorrect.');
    if(mismatch){if(!a.managerApproval||!a.consumeManagerApproval)throw new Error('Manager approval is required for a fixed-float exception.');var source='fixed_float_'+id,ap=await a.managerApproval('fixed_float_exception',source,Math.abs(float-fixedFloatCfg),v.reason),cr=await a.consumeManagerApproval({action:'fixed_float_exception',sourceId:source,amount:Math.abs(float-fixedFloatCfg),operationKey:source,approvalId:ap.approvalId}),cd=(cr&&cr.data)||cr||{};rec.floatException={required:fixedFloatCfg,actual:float,variance:Math.round((float-fixedFloatCfg)*100)/100,reason:v.reason,approvalId:ap.approvalId,approvedBy:cd.approvedBy||'Privileged account',approvedByUid:cd.approvedByUid||'',approvedRole:cd.approvedRole||'',at:Date.now()};active.floatException=rec.floatException;}
    var writes={};writes['shifts/'+id]=rec;writes.posActiveShift=active;await a.update(a.ref(a.db),writes);window.__posLog('shift-open',id,'float '+peso(float)+(mismatch?' · fixed-float exception approved':''));
  }).catch(function(){});
}
function closeShift(){
  if(!activeShift)return;var shift=activeShift;
  var recon=denomTrackingOnR()&&shift.drawer;
  var mask=document.createElement('div'); mask.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;';
  document.body.appendChild(mask);
  function close(){document.body.removeChild(mask);}
  function box(inner){return '<div style="background:#fff;border-radius:10px;max-width:560px;width:100%;max-height:90vh;overflow:auto;padding:1.2rem;">'+inner+'</div>';}
  if(!recon){
    mask.innerHTML=box('<div style="font-weight:700;color:var(--bd);margin-bottom:0.2rem;">Close shift — count the drawer</div><p class="pz-sub" style="margin-top:0.2rem;">Enter the quantity of each bill and coin. The expected figure is hidden until you submit (blind count).</p>'+denomGridHtml('opsCloseDenom')+'<div style="display:flex;gap:0.5rem;margin-top:1rem;"><button class="pz-btn ok" id="cS">Submit count &amp; Z-report</button><button class="pz-btn sec" id="cC">Cancel</button></div>');
    wireDenom('opsCloseDenom');
    mask.querySelector('#cC').onclick=close;
    mask.querySelector('#cS').onclick=function(){var r=denomRead('opsCloseDenom');close();finalizeClose(shift,r.total,r.counts);};
    return;
  }
  var drawer=shift.drawer||{}; var exCash=computeZ(shift).expectedCash;
  function renderBlind(){
    mask.innerHTML=box('<div style="font-weight:700;color:var(--bd);margin-bottom:0.2rem;">Close shift — count the drawer</div>'
      +'<p class="pz-sub" style="margin-top:0.2rem;">Count the drawer and enter each denomination. Expected stays hidden until you reveal (blind count).</p>'
      +'<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:0.82rem;"><thead><tr><th style="text-align:left;padding:0.2rem;">Denom</th><th style="text-align:right;padding:0.2rem;">Actual count</th></tr></thead><tbody>'
      +DENOMS.map(function(d){return '<tr><td style="padding:0.15rem 0.2rem;">'+d.lbl+'</td><td style="text-align:right;padding:0.15rem 0.2rem;"><input type="number" min="0" step="1" data-cc="'+d.k+'" data-cv="'+d.v+'" placeholder="0" style="width:72px;text-align:right;border:1px solid #ccc;border-radius:4px;padding:0.1rem 0.3rem;"/></td></tr>';}).join('')
      +'</tbody></table></div>'
      +'<div style="text-align:right;font-weight:700;margin-top:0.5rem;">Counted: <span id="ccTotal">₱0.00</span></div>'
      +'<div style="display:flex;gap:0.5rem;margin-top:1rem;"><button class="pz-btn ok" id="cR">Confirm cash count</button><button class="pz-btn sec" id="cC">Cancel</button></div>');
    function tot(){var t=0;mask.querySelectorAll('[data-cc]').forEach(function(i){t+=(Number(i.value)||0)*(Number(i.getAttribute('data-cv'))||0);});var el=mask.querySelector('#ccTotal');if(el)el.textContent=peso(t);}
    mask.querySelectorAll('[data-cc]').forEach(function(i){i.oninput=tot;}); tot();
    mask.querySelector('#cC').onclick=close;
    mask.querySelector('#cR').onclick=function(){var counts={},total=0;mask.querySelectorAll('[data-cc]').forEach(function(i){var q=Number(i.value)||0;if(q>0){counts[i.getAttribute('data-cc')]=q;total+=q*(Number(i.getAttribute('data-cv'))||0);}});renderReveal(counts,Math.round(total*100)/100);};
  }
  function renderReveal(counts,total){
    var totalOnly=reconcileTotalOnlyR();
    var vary=Math.round((total-exCash)*100)/100; var tolv=Number(toleranceCfg.cashPeso)||0; var withinTol=Math.abs(vary)<=tolv;
    var denomTbl=totalOnly?'' : ('<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:0.82rem;"><thead><tr><th style="text-align:left;padding:0.2rem;">Denom</th><th style="text-align:right;padding:0.2rem;">Actual</th><th style="text-align:right;padding:0.2rem;">Expected</th><th style="text-align:right;padding:0.2rem;">Var</th></tr></thead><tbody>'
      +DENOMS.map(function(d){var act=Number(counts[d.k])||0;var exp=Number(drawer[d.k])||0;if(!act&&!exp)return '';var dv=act-exp;var col=dv?(dv<0?'#c0392b':'#8a6d1b'):'#155724';return '<tr><td style="padding:0.15rem 0.2rem;">'+d.lbl+'</td><td style="text-align:right;padding:0.15rem 0.2rem;">'+act+'</td><td style="text-align:right;padding:0.15rem 0.2rem;color:#555;">'+exp+'</td><td style="text-align:right;padding:0.15rem 0.2rem;font-weight:600;color:'+col+';">'+(dv>0?'+':'')+dv+'</td></tr>';}).join('')
      +'</tbody></table><div style="font-size:0.72rem;color:var(--tl);margin-top:0.2rem;">Per-denomination differences are normal (change-making, breaking bills, tips kept). Only the total below decides the shift.</div></div>');
    mask.innerHTML=box('<div style="font-weight:700;color:var(--bd);margin-bottom:0.2rem;">Close shift — reconciliation</div>'
      +'<p class="pz-sub" style="margin-top:0.2rem;">Count confirmed &amp; locked. Review, then close. Privileged approval is needed to reopen and recount.</p>'
      +denomTbl
      +'<div style="margin-top:0.6rem;font-weight:700;"><div style="display:flex;justify-content:space-between;"><span>Counted</span><span>'+peso(total)+'</span></div><div style="display:flex;justify-content:space-between;"><span>Expected</span><span>'+peso(exCash)+'</span></div><div style="display:flex;justify-content:space-between;color:'+(withinTol?'#155724':'#c0392b')+';"><span>Variance</span><span>'+peso(vary)+'</span></div></div>'
      +'<div style="font-size:0.78rem;margin-top:0.3rem;color:'+(withinTol?'#155724':'#c0392b')+';">'+(withinTol?('✓ Within tolerance (±'+peso(tolv)+') — no discrepancy will be logged.'):('⚠ Over tolerance (±'+peso(tolv)+') — a discrepancy will be logged.'))+'</div>'
      +'<div style="display:flex;gap:0.5rem;margin-top:1rem;"><button class="pz-btn ok" id="cF">Close shift &amp; Z-report</button><button class="pz-btn sec" id="cB">🔒 Reopen count (manager)</button></div>');
    mask.querySelector('#cB').onclick=function(){var a=A();if(!a.managerApproval||!a.consumeManagerApproval){alert('3D approval service is not available. Refresh the portal.');return;}a.managerApproval('reopen_cash_count',shift.id,null,'Reopen confirmed cash count').then(function(ap){return a.consumeManagerApproval({action:'reopen_cash_count',sourceId:shift.id,operationKey:'reopen_'+shift.id+'_'+Date.now(),approvalId:ap.approvalId});}).then(function(){renderBlind();}).catch(function(e){if(String((e&&e.message)||e).indexOf('cancelled')<0)alert('Could not reopen count: '+((e&&e.message)||e));});};
    mask.querySelector('#cF').onclick=function(){close();finalizeClose(shift,total,counts);};
  }
  renderBlind();
}
async function finalizeClose(shift,counted,counts){
  var z=computeZ(shift),closedAt=Date.now();z.countedCash=counted;z.variance=Math.round((counted-z.expectedCash)*100)/100;z.closeCount=counts;z.expectedDrawer=shift.drawer||null;z.cashToSettle=Math.max(0,Math.round((counted-z.retainedFloat)*100)/100);
  var saleList;try{saleList=await loadShiftTransactions(shift.id);}catch(_e){saleList=shiftSales(shift);}
  var snapshot={schemaVersion:2,capturedAt:closedAt,calculation:'float + cash sales + tips - cash refunds + pay-ins - pay-outs',floatMode:shift.floatMode||(fixedFloatCfg!=null?'fixed':'opening-count'),configuredFloat:shift.configuredFloat!=null?Number(shift.configuredFloat):(fixedFloatCfg!=null?fixedFloatCfg:null),openingFloat:Number(shift.openingFloat)||0,retainedFloat:z.retainedFloat,tolerance:Number(toleranceCfg.cashPeso)||0,reconcileTotalOnly:reconcileTotalOnlyR(),tx:z.tx,gross:z.gross,discounts:z.discounts,refunds:z.refunds,cashRefunds:z.cashRefunds,net:z.net,cashSales:z.cashSales,tips:z.tips,payIns:z.payIns,payOuts:z.payOuts,expectedCash:z.expectedCash,countedCash:counted,variance:z.variance,cashToSettle:z.cashToSettle,byMethod:z.byMethod,byChannel:z.byChannel,voidCount:z.voidCount,voidAmt:z.voidAmt,pending:z.pending,pendingCount:z.pendingCount,openCount:shift.openCount||{},closeCount:counts||{},expectedDrawer:shift.drawer||{},payInEntries:(shift.payIns||[]),payOutEntries:(shift.payOuts||[]),floatException:shift.floatException||null,sales:saleList.map(function(o){return{id:o.id||'',time:o.time||'',timestamp:Number(o.timestamp)||0,total:Number(o.total)||0,channel:o.channel||'instore',payment:o.payment||'',payments:o.payments||null,refundAmount:Number(o.refundAmount)||0,refundPayments:o.refundPayments||null,refundHistory:o.refundHistory||null};})};
  var closed={status:'closed',closeAt:closedAt,openingFloat:shift.openingFloat,openCount:shift.openCount||null,closeCount:counts,drawerExpected:shift.drawer||null,tx:z.tx,gross:z.gross,discounts:z.discounts,refunds:z.refunds,cashRefunds:z.cashRefunds,tips:z.tips,net:z.net,byMethod:z.byMethod,voidCount:z.voidCount,voidAmt:z.voidAmt,payIns:z.payIns,payOuts:z.payOuts,expectedCash:z.expectedCash,countedCash:counted,variance:z.variance,byChannel:z.byChannel,retainedFloat:z.retainedFloat,cashToSettle:z.cashToSettle,pending:z.pending,pendingCount:z.pendingCount,floatMode:snapshot.floatMode,configuredFloat:snapshot.configuredFloat,zReport:snapshot};
  var a=A(),writes={};writes['shifts/'+shift.id]=Object.assign({},shift,closed);writes.posActiveShift=null;
  if(Math.abs(z.variance)>snapshot.tolerance){var did=uid('disc_');writes['discrepancies/'+did]={kind:'cash',expected:z.expectedCash,actual:counted,variance:z.variance,value:z.variance,type:z.variance<0?'shortage':'overage',shiftId:shift.id,staff:shift.staff||'',status:'open',ts:closedAt};}
  a.update(a.ref(a.db),writes).then(function(){window.__posLog('shift-close',shift.id,'counted '+peso(counted)+' · variance '+peso(z.variance));showZ(Object.assign({},shift,closed),Object.assign({},z,{saleList:snapshot.sales,reportClosedAt:closedAt,reconcileTotalOnly:snapshot.reconcileTotalOnly}));}).catch(function(e){alert('Shift was not closed because the final report could not be saved. Please try again. '+((e&&e.message)||e));});
}
function showZ(shift,z,existingWindow){
  var w=existingWindow||window.open('','_blank','width=380,height=680');if(!w){alert('Shift closed. Allow pop-ups to print the Z-report.');return;}
  var methods=Object.keys(z.byMethod).map(function(m){return '<tr><td>'+esc(m)+'</td><td style="text-align:right;">'+peso(z.byMethod[m])+'</td></tr>';}).join('');
  var methodTotal=Object.keys(z.byMethod||{}).reduce(function(s,m){return s+(Number(z.byMethod[m])||0);},0),channelTotal=Object.keys(z.byChannel||{}).reduce(function(s,c){return s+(Number(z.byChannel[c])||0);},0);
  var cashMoves=(z.payInEntries||[]).map(function(x){return{kind:'Cash in',sign:'+',amount:x.amount,reason:x.reason,by:x.by,ts:x.ts};}).concat((z.payOutEntries||[]).map(function(x){return{kind:'Cash out',sign:'−',amount:x.amount,reason:x.reason,by:x.by,ts:x.ts};})).sort(function(a,b){return(Number(a.ts)||0)-(Number(b.ts)||0);});
  var cashMoveRows=cashMoves.map(function(x){return '<tr><td>'+esc(x.ts?new Date(x.ts).toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'}):'')+' '+esc(x.kind)+'<div style="font-size:9px;">'+esc(x.reason||'')+(x.by?' · '+esc(x.by):'')+'</div></td><td style="text-align:right;">'+x.sign+peso(x.amount)+'</td></tr>';}).join('');
  var saleList=(z.saleList||Object.keys(ordersMap).map(function(k){return ordersMap[k];}).filter(function(o){return o&&o.shiftId===shift.id&&(o.status==='Completed'||o.status==='Received');})).slice().sort(function(a,b){return(a.timestamp||0)-(b.timestamp||0);});
  var salesTotal=saleList.reduce(function(s,o){return s+(Number(o.total)||0)-(Number(o.refundAmount)||0);},0),countedDenomTotal=DENOMS.reduce(function(s,d){return s+(Number((z.closeCount||{})[d.k])||0)*d.v;},0),expectedDenomTotal=DENOMS.reduce(function(s,d){return s+(Number((z.expectedDrawer||{})[d.k])||0)*d.v;},0);
  var saleRows=saleList.map(function(o){var tag=o.voided?' [VOID]':(Number(o.refundAmount)>0?' [R '+peso(o.refundAmount)+']':'');var ch=(o.channel&&o.channel!=='instore')?(' '+esc(o.channel==='grabfood'?'GF':'FP')):'';return '<tr><td>'+esc(o.id)+' '+esc(o.time||'')+ch+'</td><td style="text-align:right;">'+peso(o.total)+esc(tag)+'</td></tr>';}).join('');
  w.document.write('<html><head><title>Z-Report '+esc(shift.id)+'</title><style>*{font-family:monospace;font-size:12px;color:#000;}body{padding:10px;}h2,h3{text-align:center;margin:2px 0;}table{width:100%;border-collapse:collapse;}td{padding:2px 0;}hr{border:none;border-top:1px dashed #000;}@media print{button{display:none;}}</style></head><body>'
    +'<h2>Accaza Coffee House</h2><h3>SHIFT Z-REPORT</h3><hr>'
    +'<div>Shift: '+esc(shift.id)+'</div><div>Cashier: '+esc(shift.staff)+'</div><div>Open: '+new Date(shift.openAt).toLocaleString('en-PH')+'</div><div>Close: '+new Date(z.reportClosedAt||shift.closeAt||Date.now()).toLocaleString('en-PH')+'</div><div>Float policy: '+esc(shift.floatMode==='fixed'?'Fixed':'Opening count')+(shift.configuredFloat!=null?' '+peso(shift.configuredFloat):'')+'</div><hr>'
    +(z.legacyReport?'<div style="border:1px solid #8a6d1b;padding:5px;margin:5px 0;"><b>Historical summary:</b> some supporting details were not captured by the system version used at closure.</div><hr>':'')
    +'<table><tr><td>Transactions</td><td style="text-align:right;">'+z.tx+'</td></tr>'
    +'<tr><td>Gross sales</td><td style="text-align:right;">'+peso(z.gross)+'</td></tr>'
    +'<tr><td>Discounts</td><td style="text-align:right;">-'+peso(z.discounts)+'</td></tr>'
    +'<tr><td>Cash refunds</td><td style="text-align:right;">-'+peso(z.cashRefunds)+'</td></tr>'
    +'<tr><td><b>Net sales</b></td><td style="text-align:right;"><b>'+peso(z.net)+'</b></td></tr></table><hr>'
    +'<div><b>Sales by channel</b></div><table>'+([['instore','In-store'],['online','Online Orders'],['grabfood','GrabFood'],['foodpanda','FoodPanda']].map(function(c){var v=(z.byChannel&&z.byChannel[c[0]])||0;if(!v&&c[0]!=='instore')return '';return '<tr><td>'+c[1]+'</td><td style="text-align:right;">'+peso(v)+'</td></tr>';}).join(''))+'<tr style="border-top:1px solid #000;"><td><b>Total by channel</b></td><td style="text-align:right;"><b>'+peso(channelTotal)+'</b></td></tr></table><div style="font-size:9px;">Online Orders are verified non-cash sales. GrabFood/FoodPanda are platform receivables. None increases drawer cash.</div><hr>'
    +'<div><b>By payment method</b></div><table>'+methods+'<tr style="border-top:1px solid #000;"><td><b>Total by payment method</b></td><td style="text-align:right;"><b>'+peso(methodTotal)+'</b></td></tr></table><hr>'
    +'<div><b>Sales this shift ('+saleList.length+')</b></div><table>'+(saleRows||'<tr><td colspan="2">None</td></tr>')+'<tr style="border-top:1px solid #000;"><td><b>Total sales this shift</b></td><td style="text-align:right;"><b>'+peso(salesTotal)+'</b></td></tr></table><hr>'
    +(z.pendingCount?'<div style="color:#8a6d1b;"><b>⏳ Awaiting cashier verification: '+peso(z.pending)+' ('+z.pendingCount+')</b></div><div style="font-size:9px;">Not yet confirmed in the actual receiving account.</div><hr>':'')
    +(z.managerPendingCount?'<div style="color:#0c5460;"><b>🔎 Awaiting manager revalidation: '+peso(z.managerPending)+' ('+z.managerPendingCount+')</b></div><div style="font-size:9px;">Cashier verified; independent manager review remains open.</div><hr>':'')
    +(cashMoveRows?'<div><b>Cash movements</b></div><table>'+cashMoveRows+'<tr style="border-top:1px solid #000;"><td><b>Net cash movements</b></td><td style="text-align:right;"><b>'+peso((Number(z.payIns)||0)-(Number(z.payOuts)||0))+'</b></td></tr></table><hr>':'')
    +'<table><tr><td>Voids</td><td style="text-align:right;">'+z.voidCount+' ('+peso(z.voidAmt)+')</td></tr>'
    +'<tr><td>Opening float</td><td style="text-align:right;">'+peso(shift.openingFloat)+'</td></tr>'
    +'<tr><td>Cash sales</td><td style="text-align:right;">'+peso(z.cashSales)+'</td></tr>'
    +(z.tips?'<tr><td>Tips / rounding kept</td><td style="text-align:right;">+'+peso(z.tips)+'</td></tr>':'')
    +(z.payIns?'<tr><td>Cash pay-ins</td><td style="text-align:right;">+'+peso(z.payIns)+'</td></tr>':'')
    +(z.payOuts?'<tr><td>Cash pay-outs</td><td style="text-align:right;">-'+peso(z.payOuts)+'</td></tr>':'')
    +'<tr><td>Expected drawer</td><td style="text-align:right;">'+peso(z.expectedCash)+'</td></tr>'
    +'<tr><td>Counted cash</td><td style="text-align:right;">'+peso(z.countedCash)+'</td></tr>'
    +'<tr><td><b>Variance</b></td><td style="text-align:right;"><b>'+peso(z.variance)+'</b></td></tr></table><hr>'
    +'<div><b>Cash to settle (imprest)</b></div><table>'
      +'<tr><td>Counted cash</td><td style="text-align:right;">'+peso(z.countedCash)+'</td></tr>'
      +'<tr><td>Less: float retained</td><td style="text-align:right;">-'+peso(z.retainedFloat)+'</td></tr>'
      +'<tr><td><b>► CASH TO SETTLE (remit)</b></td><td style="text-align:right;"><b>'+peso(Math.round(((Number(z.countedCash)||0)-z.retainedFloat)*100)/100)+'</b></td></tr></table>'
      +(z.floatMismatch?'<div style="font-size:9px;color:#c0392b;">⚠ Opened with '+peso(shift.openingFloat)+' but standard float is '+peso(fixedFloatCfg)+' — reconcile the float.</div>':'')
      +'<hr>'
    +(z.closeCount&&denomBreakdownRows(z.closeCount)?('<div><b>Cash counted by denomination</b></div><table>'+denomBreakdownRows(z.closeCount)+'<tr style="border-top:1px solid #000;"><td><b>Total cash counted</b></td><td style="text-align:right;"><b>'+peso(countedDenomTotal)+'</b></td></tr></table><hr>'):'')
    +((!(z.reconcileTotalOnly!=null?z.reconcileTotalOnly:reconcileTotalOnlyR())&&z.expectedDrawer)?('<div><b>Denomination check (expected → counted)</b></div><table>'+DENOMS.map(function(d){var exp=Number(z.expectedDrawer[d.k])||0;var act=Number((z.closeCount||{})[d.k])||0;if(!act&&!exp)return '';var dv=act-exp;return '<tr><td>'+d.lbl+'</td><td style="text-align:right;">'+exp+' → '+act+(dv?'  ('+(dv>0?'+':'')+dv+')':'  ✓')+'</td></tr>';}).join('')+'<tr style="border-top:1px solid #000;"><td><b>Total</b></td><td style="text-align:right;"><b>'+peso(expectedDenomTotal)+' → '+peso(countedDenomTotal)+' ('+peso(countedDenomTotal-expectedDenomTotal)+')</b></td></tr></table><hr>'):'')
    +'<div style="font-size:9px;text-align:center;">Expected drawer = float + cash sales + tips − cash refunds + pay-ins − pay-outs. Cash to settle = counted cash − float retained (the opening float, unless a fixed imprest float is set in POS Settings); the float stays in the drawer. Management report, not a BIR document.</div>'
    +'<div style="text-align:center;margin-top:8px;"><button onclick="window.print()">Print</button></div></body></html>');
  w.document.close();
}
/* ══════════ SHIFT REVIEW (live liquidation for the open shift) ══════════ */
function shiftSales(shift){return Object.keys(ordersMap).map(function(k){return ordersMap[k];}).filter(function(o){return o&&o.shiftId===shift.id&&!o.voided&&(o.status==='Completed'||o.status==='Received');}).sort(function(a,b){return (a.timestamp||0)-(b.timestamp||0);});}
function shiftItemsSummary(shift){var m={};shiftSales(shift).forEach(function(o){(o.lineItems||[]).forEach(function(li){var k=li.itemKey||li.name||'?';if(!m[k])m[k]={name:li.name||k,qty:0,sales:0};m[k].qty+=Number(li.qty)||0;m[k].sales+=(Number(li.qty)||0)*(Number(li.unitTotal)||0);});});return Object.keys(m).map(function(k){return m[k];}).sort(function(a,b){return b.sales-a.sales;});}
function shiftTxnMethod(o){return paysOf(o).map(function(p){return p.method;}).join('+');}
function openShiftReview(){
  if(!activeShift){alert('No open shift to review.');return;}
  var shift=activeShift,z=computeZ(shift),sales=shiftSales(shift),items=shiftItemsSummary(shift);
  var reviewMethodTotal=Object.keys(z.byMethod).reduce(function(s,m){return s+(Number(z.byMethod[m])||0);},0),reviewTxnTotal=sales.reduce(function(s,o){return s+(Number(o.total)||0)-(Number(o.refundAmount)||0);},0);
  var methodRows=Object.keys(z.byMethod).map(function(m){return '<tr><td>'+esc(m)+'</td><td class="r">'+peso(z.byMethod[m])+'</td></tr>';}).join('')||'<tr><td colspan="2" style="color:var(--tl);">No sales yet.</td></tr>';
  var txnRows=sales.map(function(o){var ch=channelLabel(o);var tag=Number(o.refundAmount)>0?' · R '+peso(o.refundAmount):'';return '<tr><td>'+esc(o.time||'')+'</td><td>'+esc(o.id)+'</td><td>'+esc(ch)+'</td><td>'+esc(shiftTxnMethod(o))+'</td><td class="r">'+peso(o.total)+esc(tag)+'</td></tr>';}).join('')||'<tr><td colspan="5" style="color:var(--tl);">No sales yet.</td></tr>';
  var itemRows=items.map(function(x){return '<tr><td>'+esc(x.name)+'</td><td class="r">'+num(x.qty)+'</td><td class="r">'+peso(x.sales)+'</td></tr>';}).join('')||'<tr><td colspan="3" style="color:var(--tl);">No items yet.</td></tr>';
  var mask=document.createElement('div');mask.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;';
  mask.innerHTML='<div style="background:#fff;border-radius:10px;max-width:700px;width:100%;max-height:92vh;overflow:auto;padding:1.2rem;">'
    +'<div style="display:flex;justify-content:space-between;align-items:center;"><div style="font-weight:700;color:var(--bd);">📋 Shift review — '+esc(shift.staff)+'</div><button class="pz-btn sec" id="srClose" style="padding:0.2rem 0.6rem;">✕</button></div>'
    +'<p class="pz-sub" style="margin:0.3rem 0 0.6rem;">Live liquidation for the open shift since '+new Date(shift.openAt).toLocaleString('en-PH')+'.</p>'
    +'<div class="pz-card" style="margin-bottom:0.8rem;"><div style="font-weight:600;color:var(--bd);margin-bottom:0.3rem;">💵 Cash on hand</div><table class="pz-tbl"><tbody>'
      +'<tr><td>Opening float</td><td class="r">'+peso(shift.openingFloat)+'</td></tr>'
      +'<tr><td>Cash sales</td><td class="r">+'+peso(z.cashSales)+'</td></tr>'
      +(z.tips?'<tr><td>Tips / rounding kept</td><td class="r">+'+peso(z.tips)+'</td></tr>':'')
      +(z.payIns?'<tr><td>Cash pay-ins</td><td class="r">+'+peso(z.payIns)+'</td></tr>':'')
      +(z.cashRefunds?'<tr><td>Cash refunds</td><td class="r">−'+peso(z.cashRefunds)+'</td></tr>':'')
      +(z.payOuts?'<tr><td>Pay-outs (register expenses)</td><td class="r">−'+peso(z.payOuts)+'</td></tr>':'')
      +'<tr style="border-top:2px solid var(--bd);"><td><b>Expected cash on hand</b></td><td class="r"><b>'+peso(z.expectedCash)+'</b></td></tr>'
      +'<tr><td>Less: float retained</td><td class="r">−'+peso(z.retainedFloat)+'</td></tr>'
      +'<tr style="border-top:1px solid var(--cd);"><td><b>► Cash to settle (remit)</b></td><td class="r"><b>'+peso(z.cashToSettle)+'</b></td></tr>'
      +'</tbody></table>'+(z.floatMismatch?'<div class="az-note" style="color:#c0392b;">⚠ Opened with '+peso(shift.openingFloat)+' but standard float is '+peso(fixedFloatCfg)+'.</div>':'')+'</div>'
    +'<div class="pz-card" style="margin-bottom:0.8rem;"><div style="font-weight:600;color:var(--bd);margin-bottom:0.3rem;">🧾 Sales by channel</div><table class="pz-tbl"><tbody>'
      +([['instore','In-store'],['online','Online Orders'],['grabfood','GrabFood'],['foodpanda','FoodPanda']].map(function(c){var v=(z.byChannel&&z.byChannel[c[0]])||0;if(!v&&c[0]!=='instore')return '';return '<tr><td>'+c[1]+'</td><td class="r">'+peso(v)+'</td></tr>';}).join(''))
      +'<tr class="register-total"><td>Total net sales</td><td class="r">'+peso(z.net)+'</td></tr></tbody></table><div class="az-note">Online Orders are verified non-cash sales. GrabFood/FoodPanda are platform receivables. None increases drawer cash.</div></div>'
    +'<div style="display:flex;gap:0.7rem;flex-wrap:wrap;margin-bottom:0.8rem;">'
      +'<div class="pz-card" style="flex:1;min-width:130px;"><div style="font-size:0.72rem;color:var(--tl);">Transactions</div><div style="font-weight:700;font-size:1.1rem;color:var(--bd);">'+z.tx+'</div></div>'
      +'<div class="pz-card" style="flex:1;min-width:130px;"><div style="font-size:0.72rem;color:var(--tl);">Net sales</div><div style="font-weight:700;font-size:1.1rem;color:var(--bd);">'+peso(z.net)+'</div></div>'
      +'<div class="pz-card" style="flex:1;min-width:130px;"><div style="font-size:0.72rem;color:var(--tl);">Non-cash pending</div><div style="font-weight:700;font-size:1.1rem;color:'+(z.pending?'#8a5a00':'var(--bd)')+';">'+peso(z.pending)+'</div></div>'
    +'</div>'
    +'<div class="az-sec">Sales by payment method</div><div class="pz-card" style="margin-bottom:0.7rem;"><table class="pz-tbl"><tbody>'+methodRows+'<tr class="register-total"><td>Total</td><td class="r">'+peso(reviewMethodTotal)+'</td></tr></tbody></table></div>'
    +'<div class="az-sec">Transactions ('+sales.length+')</div><div class="pz-card" style="margin-bottom:0.7rem;"><div style="overflow-x:auto;"><table class="pz-tbl"><thead><tr><th>Time</th><th>Order</th><th>Channel</th><th>Method</th><th class="r">Amount</th></tr></thead><tbody>'+txnRows+'<tr class="register-total"><td colspan="4">Total ('+sales.length+' transactions)</td><td class="r">'+peso(reviewTxnTotal)+'</td></tr></tbody></table></div></div>'
    +'<div class="az-sec">Items sold</div><div class="pz-card"><div style="overflow-x:auto;"><table class="pz-tbl"><thead><tr><th>Item</th><th class="r">Qty</th><th class="r">Sales</th></tr></thead><tbody>'+itemRows+'</tbody></table></div></div>'
    +'<div style="display:flex;gap:0.5rem;margin-top:1rem;"><button class="pz-btn ok" id="srPrint">🖨 Print</button><button class="pz-btn sec" id="srExcel">⬇ Excel</button><button class="pz-btn sec" id="srClose2">Close</button></div></div>';
  document.body.appendChild(mask);
  function close(){document.body.removeChild(mask);}
  mask.querySelector('#srClose').onclick=close;mask.querySelector('#srClose2').onclick=close;
  mask.querySelector('#srPrint').onclick=function(){printShiftReview(shift,z,sales,items);};
  mask.querySelector('#srExcel').onclick=function(){exportShiftReviewXlsx(shift,z,sales,items);};
}
function printShiftReview(shift,z,sales,items){
  var w=window.open('','_blank','width=420,height=720');if(!w){alert('Allow pop-ups to print the review.');return;}
  var methods=Object.keys(z.byMethod).map(function(m){return '<tr><td>'+esc(m)+'</td><td style="text-align:right;">'+peso(z.byMethod[m])+'</td></tr>';}).join('');
  var txn=sales.map(function(o){var ch=(o.channel&&o.channel!=='instore')?(o.channel==='grabfood'?' GF':' FP'):'';return '<tr><td>'+esc(o.time||'')+' '+esc(o.id)+ch+'</td><td style="text-align:right;">'+peso(o.total)+'</td></tr>';}).join('');
  var it=items.map(function(x){return '<tr><td>'+esc(x.name)+' ×'+num(x.qty)+'</td><td style="text-align:right;">'+peso(x.sales)+'</td></tr>';}).join('');
  w.document.write('<html><head><title>Shift Review '+esc(shift.id)+'</title><style>*{font-family:monospace;font-size:12px;color:#000;}body{padding:10px;}h2,h3{text-align:center;margin:2px 0;}table{width:100%;border-collapse:collapse;}td{padding:2px 0;}hr{border:none;border-top:1px dashed #000;}@media print{button{display:none;}}</style></head><body>'
    +'<h2>Accaza Coffee House</h2><h3>SHIFT REVIEW (liquidation)</h3><hr>'
    +'<div>Shift: '+esc(shift.id)+'</div><div>Cashier: '+esc(shift.staff)+'</div><div>Open: '+new Date(shift.openAt).toLocaleString('en-PH')+'</div><div>Printed: '+new Date().toLocaleString('en-PH')+'</div><hr>'
    +'<table><tr><td>Opening float</td><td style="text-align:right;">'+peso(shift.openingFloat)+'</td></tr>'
    +'<tr><td>Cash sales</td><td style="text-align:right;">+'+peso(z.cashSales)+'</td></tr>'
    +(z.tips?'<tr><td>Tips kept</td><td style="text-align:right;">+'+peso(z.tips)+'</td></tr>':'')
    +(z.payIns?'<tr><td>Pay-ins</td><td style="text-align:right;">+'+peso(z.payIns)+'</td></tr>':'')
    +(z.cashRefunds?'<tr><td>Cash refunds</td><td style="text-align:right;">-'+peso(z.cashRefunds)+'</td></tr>':'')
    +(z.payOuts?'<tr><td>Pay-outs</td><td style="text-align:right;">-'+peso(z.payOuts)+'</td></tr>':'')
    +'<tr><td><b>Cash on hand</b></td><td style="text-align:right;"><b>'+peso(z.expectedCash)+'</b></td></tr>'
    +'<tr><td>Less float retained</td><td style="text-align:right;">-'+peso(z.retainedFloat)+'</td></tr>'
    +'<tr><td><b>Cash to settle</b></td><td style="text-align:right;"><b>'+peso(z.cashToSettle)+'</b></td></tr></table><hr>'
    +'<div><b>By payment method</b></div><table>'+(methods||'<tr><td>None</td></tr>')+'</table><hr>'
    +'<div><b>Transactions ('+sales.length+')</b></div><table>'+(txn||'<tr><td>None</td></tr>')+'</table><hr>'
    +'<div><b>Items sold</b></div><table>'+(it||'<tr><td>None</td></tr>')+'</table><hr>'
    +'<div style="font-size:9px;text-align:center;">Cash on hand = float + cash sales + tips + pay-ins − cash refunds − pay-outs. Management report.</div>'
    +'<div style="text-align:center;margin-top:8px;"><button onclick="window.print()">Print</button></div></body></html>');
  w.document.close();
}
function exportShiftReviewXlsx(shift,z,sales,items){
  if(!window.XLSX){alert('Excel library still loading — try again.');return;}
  var sum=[['Shift',shift.id],['Cashier',shift.staff],['Open',new Date(shift.openAt).toLocaleString('en-PH')],[],['Opening float',Number(shift.openingFloat)||0],['Cash sales',z.cashSales],['Tips',z.tips],['Pay-ins',z.payIns],['Cash refunds',-z.cashRefunds],['Pay-outs',-z.payOuts],['Cash on hand',z.expectedCash],['Fixed float retained',-z.retainedFloat],['Cash to settle',z.cashToSettle],[],['In-store sales',z.byChannel.instore],['Online Orders sales',z.byChannel.online],['GrabFood sales',z.byChannel.grabfood],['FoodPanda sales',z.byChannel.foodpanda],[],['Transactions',z.tx],['Net sales',z.net]];
  var tx=[['Time','Order','Channel','Method','Amount','Refund']];sales.forEach(function(o){tx.push([o.time||'',o.id,(o.channel&&o.channel!=='instore')?o.channel:'instore',shiftTxnMethod(o),Number(o.total)||0,Number(o.refundAmount)||0]);});
  var it=[['Item','Qty','Sales']];items.forEach(function(x){it.push([x.name,x.qty,x.sales]);});
  var wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(sum),'Summary');XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(tx),'Transactions');XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(it),'Items');XLSX.writeFile(wb,'shift-review-'+shift.id+'.xlsx');
}
function refundTenderModal(o,amount,cb){
  if((o.channel||'instore')!=='instore'){cb([]);return;}var paid={};paysOf(o).forEach(function(p){paid[p.method]=(paid[p.method]||0)+(Number(p.amount)||0);});var prior=o.refundPayments||{},methods=Object.keys(paid),left=amount,defaults={};methods.forEach(function(m){var avail=Math.max(0,paid[m]-(Number(prior[m])||0)),use=Math.min(left,avail);defaults[m]=use;left=Math.round((left-use)*100)/100;});
  var mask=document.createElement('div');mask.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:11000;display:flex;align-items:center;justify-content:center;padding:1rem;';mask.innerHTML='<div style="background:#fff;border-radius:10px;max-width:460px;width:100%;padding:1.2rem;"><div style="font-weight:700;color:var(--bd);">Refund payment method</div><p class="pz-sub">Record exactly how '+peso(amount)+' will be returned. This controls the cash drawer and accounting reversal.</p>'+methods.map(function(m){var avail=Math.max(0,paid[m]-(Number(prior[m])||0));return '<div style="display:flex;gap:.5rem;align-items:center;margin:.4rem 0;"><div style="flex:1;"><b>'+esc(m)+'</b><div style="font-size:.68rem;color:var(--tl);">remaining refundable '+peso(avail)+'</div></div><input class="pz-in" type="number" min="0" max="'+avail+'" step=".01" data-rt="'+esc(m)+'" value="'+(defaults[m]||'')+'" style="width:130px;"/></div>';}).join('')+'<div id="rtBal" style="font-weight:700;text-align:right;margin-top:.5rem;"></div><div style="display:flex;gap:.5rem;margin-top:1rem;"><button class="pz-btn ok" id="rtOk">Continue</button><button class="pz-btn sec" id="rtCancel">Cancel</button></div></div>';document.body.appendChild(mask);function read(){var rows=[],sum=0;mask.querySelectorAll('[data-rt]').forEach(function(inp){var v=Math.round((Number(inp.value)||0)*100)/100;if(v>0){rows.push({method:inp.getAttribute('data-rt'),amount:v});sum+=v;}});return{rows:rows,sum:Math.round(sum*100)/100};}function recalc(){var r=read(),diff=Math.round((amount-r.sum)*100)/100,el=mask.querySelector('#rtBal');el.innerHTML=Math.abs(diff)<.001?'<span style="color:#155724;">✓ Exact '+peso(amount)+'</span>':'<span style="color:#c0392b;">Still allocate '+peso(diff)+'</span>';}mask.querySelectorAll('[data-rt]').forEach(function(i){i.oninput=recalc;});recalc();mask.querySelector('#rtCancel').onclick=function(){document.body.removeChild(mask);};mask.querySelector('#rtOk').onclick=function(){var r=read();if(Math.abs(r.sum-amount)>.009){alert('Refund payment methods must total exactly '+peso(amount)+'.');return;}document.body.removeChild(mask);cb(r.rows);};
  mask.querySelector('#rtCancel').onclick=function(){document.body.removeChild(mask);cb(null);};
}
function voidSale(oid){
  if(document.getElementById('accazaFormDialog'))return;
  var o=ordersMap[oid];if(!o)return;
  var a=A(),amount=Math.max(0,(Number(o.total)||0)-(Number(o.refundAmount)||0));if(!a.processOrderAdjustment||!a.managerApproval){alert('3D adjustment service is not available. Refresh the portal.');return;}
  var fields=[{name:'reason',label:'Void reason',type:'textarea',required:true,maxLength:300,placeholder:'Explain why this completed sale must be voided'}];
  if(o.inventoryUsage&&!o.inventoryReversed)fields.push({name:'restock',label:'Return deducted ingredients to inventory',type:'checkbox',help:'Leave unchecked when the ingredients were consumed or wasted.'});
  F().run({title:'Void completed sale',subtitle:oid+' · reversible amount '+peso(amount),submitLabel:'Request void approval',busyLabel:'Posting reversal…',danger:true,fields:fields},function(v){return a.managerApproval('void',oid,amount,v.reason).then(function(ap){return a.processOrderAdjustment({action:'void',orderId:oid,reason:v.reason,restock:!!v.restock,approvalId:ap.approvalId});}).then(function(){window.__posLog('void',oid,v.reason);});}).then(function(){alert('Order voided and financial reversal posted.');}).catch(function(){});
}
function refundSale(oid){
  if(document.getElementById('accazaFormDialog'))return;
  var o=ordersMap[oid];if(!o)return;
  var max=Number(o.total)||0;var already=Number(o.refundAmount)||0;
  var remaining=Math.round((max-already)*100)/100;if(remaining<=0){alert('This order has no refundable balance.');return;}
  var a=A();if(!a.processOrderAdjustment||!a.managerApproval){alert('3D adjustment service is not available. Refresh the portal.');return;}
  var fields=[{name:'amount',label:'Refund amount',type:'number',required:true,min:0.01,max:remaining,step:'0.01',value:remaining,validate:function(v){var n=Number(v);return n>0&&n<=remaining+.001?'':'Enter an amount from '+peso(.01)+' to '+peso(remaining)+'.';}},{name:'reason',label:'Refund reason',type:'textarea',required:true,maxLength:300,placeholder:'Explain why this refund is being issued'}];
  if(o.inventoryUsage&&!o.inventoryReversed)fields.push({name:'restock',label:'Return ingredients on a full refund',type:'checkbox',help:'Inventory is restored only when this completes the full order reversal.'});
  F().run({title:'Refund completed sale',subtitle:oid+' · remaining refundable '+peso(remaining),submitLabel:'Continue to refund method',busyLabel:'Posting refund…',fields:fields},function(v){var amt=Math.round(Number(v.amount)*100)/100,full=(already+amt)>=max-.01,restock=full&&!!v.restock;return new Promise(function(resolve,reject){refundTenderModal(o,amt,function(refundPayments){if(refundPayments===null){reject(new Error('Refund payment allocation was cancelled.'));return;}a.managerApproval('refund',oid,amt,v.reason).then(function(ap){return a.processOrderAdjustment({action:'refund',orderId:oid,amount:amt,refundPayments:refundPayments,reason:v.reason,restock:restock,approvalId:ap.approvalId});}).then(function(){if(denomTrackingOnR()&&activeShift){var cash=refundPayments.reduce(function(s,p){return s+(p.method==='Cash'?(Number(p.amount)||0):0);},0);if(cash>0){var mc=makeChangeD(cash,drawerNow());saveDrawer(subD(drawerNow(),mc.denoms));if(!mc.ok)alert('Note: the drawer can’t provide exactly '+peso(cash)+' cash (short '+peso(mc.short)+'). Reconcile at count.');}}window.__posLog('refund',oid,peso(amt)+' · '+refundPayments.map(function(p){return p.method+' '+peso(p.amount);}).join(', ')+' · '+v.reason);resolve();}).catch(reject);});});}).then(function(){alert('Refund and financial reversal posted.');}).catch(function(){});
}
})();
