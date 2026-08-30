
function openShift(){
  var sid=document.getElementById('opsStaff').value;var s=staffList[sid];if(!s){alert('Pick a cashier.');return;}
  var od=denomRead('opsOpenDenom'); var float=od.total;
  var id='SH-'+Date.now().toString().slice(-6);var a=A();
  var openedAt=Date.now(),shiftRef=createShiftReference(openedAt,s.name),fixedMode=fixedFloatCfg!=null,mismatch=fixedMode&&Math.abs(float-fixedFloatCfg)>.009;
  var rec={id:id,shiftReference:shiftRef,staff:s.name,staffId:sid,openingFloat:float,openCount:od.counts,drawer:Object.assign({},od.counts),openAt:openedAt,status:'open',floatMode:fixedMode?'fixed':'opening-count',configuredFloat:fixedMode?fixedFloatCfg:null};
  var active={id:id,shiftReference:shiftRef,staff:s.name,staffId:sid,openingFloat:float,drawer:Object.assign({},od.counts),openAt:openedAt,floatMode:rec.floatMode,configuredFloat:rec.configuredFloat};
  F().run({title:'Open shift',subtitle:s.name+' · opening float '+peso(float)+(fixedMode?' · required '+peso(fixedFloatCfg):' · flexible opening float'),submitLabel:mismatch?'Request exception & open':'Open shift',busyLabel:'Opening…',fields:[{name:'pin',label:s.name+"'s PIN",type:'password',required:true,maxLength:6,placeholder:'4–6 digits',validate:function(v){return /^[0-9]{4,6}$/.test(v)?'':'Enter a 4–6 digit PIN.';}}].concat(mismatch?[{name:'reason',label:'Reason opening float differs from fixed amount',type:'textarea',required:true,maxLength:300,placeholder:'Explain the shortage, overage, or temporary float arrangement'}]:[])},async function(v){
    if(String(s.pin)!==String(v.pin))throw new Error('Cashier PIN is incorrect.');
    if(mismatch){if(!a.managerApproval||!a.consumeManagerApproval)throw new Error('Manager approval is required for a fixed-float exception.');var source='fixed_float_'+id,ap=await a.managerApproval('fixed_float_exception',source,Math.abs(float-fixedFloatCfg),v.reason),cr=await a.consumeManagerApproval({action:'fixed_float_exception',sourceId:source,amount:Math.abs(float-fixedFloatCfg),operationKey:source,approvalId:ap.approvalId}),cd=(cr&&cr.data)||cr||{};rec.floatException={required:fixedFloatCfg,actual:float,variance:Math.round((float-fixedFloatCfg)*100)/100,reason:v.reason,approvalId:ap.approvalId,approvedBy:cd.approvedBy||'Privileged account',approvedByUid:cd.approvedByUid||'',approvedRole:cd.approvedRole||'',at:Date.now()};active.floatException=rec.floatException;}
    var writes={};writes['shifts/'+id]=rec;writes.posActiveShift=active;await a.update(a.ref(a.db),writes);window.__posLog('shift-open',id,'float '+peso(float)+(mismatch?' · fixed-float exception approved':''));
  }).catch(function(){});
}
async function continuityReadyForClose(){
  if(window.__online===false)throw new Error('The shift cannot close while offline. Keep the shift open until the connection returns and every sale is synchronized.');
  if(!window.AccazaOfflineQueue||!window.AccazaOfflineQueue.summary)throw new Error('The durable transaction queue is unavailable. Refresh the POS before closing the shift.');
  if(window.__flushOfflineQueue)await window.__flushOfflineQueue();
  var state=await window.AccazaOfflineQueue.summary(),outstanding=Number(state.pending||0)+Number(state.syncing||0)+Number(state.failed||0);
  if(outstanding)throw new Error('The shift cannot close: '+outstanding+' sale(s) still require synchronization. Open the sync queue and retry them first.');
  if(window.__online===false)throw new Error('The connection was lost during the close check. The shift remains open.');
  return state;
}
async function closeShift(){
  if(!activeShift)return;var shift=activeShift;
  try{await continuityReadyForClose();}catch(error){alert(String(error&&error.message||error));if(window.__showOfflineQueue)window.__showOfflineQueue('Shift close is blocked until all sales are safely synchronized.');return;}
  var recon=denomTrackingOnR()&&shift.drawer;
  var mask=document.createElement('div'); mask.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;';
  document.body.appendChild(mask);
  function close(){document.body.removeChild(mask);}
  function box(inner){return '<div style="background:#fff;border-radius:10px;max-width:560px;width:100%;max-height:90vh;overflow:auto;padding:1.2rem;">'+inner+'</div>';}
  function closeWithCount(counts,total){close();finalizeClose(shift,total,counts);}
  if(!recon){
    mask.innerHTML=box('<div style="font-weight:700;color:var(--bd);margin-bottom:0.2rem;">Close shift — count the drawer</div><p class="pz-sub" style="margin-top:0.2rem;">Enter the quantity of each bill and coin. The expected figure is hidden until you submit (blind count).</p>'+denomGridHtml('opsCloseDenom')+'<div style="display:flex;gap:0.5rem;margin-top:1rem;"><button class="pz-btn ok" id="cS">Submit count &amp; Z-report</button><button class="pz-btn sec" id="cC">Cancel</button></div>');
    wireDenom('opsCloseDenom');
    mask.querySelector('#cC').onclick=close;
    mask.querySelector('#cS').onclick=function(){var r=denomRead('opsCloseDenom');closeWithCount(r.counts,r.total);};
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
      +'<div style="font-size:0.78rem;margin-top:0.3rem;color:'+(withinTol?'#155724':'#c0392b')+';">'+(withinTol?('✓ Within tolerance (±'+peso(tolv)+').'):('⚠ Over tolerance (±'+peso(tolv)+') — a discrepancy audit record will be logged.'))+'</div>'
      +(Math.abs(vary)>=.005?'<div style="margin-top:.65rem;padding:.65rem;border:1px solid #b7791f;background:#fffaf0;color:#7b4d0b;border-radius:6px;"><b>Manager reconciliation required after close</b><div style="font-size:.76rem;margin-top:.2rem;">Closing is allowed so operations can continue. The '+(vary>0?'overage':'shortage')+' will remain pending in Finance Books until a manager revalidates and resolves it in Discrepancies.</div></div>':'')
      +'<div style="display:flex;gap:0.5rem;margin-top:1rem;"><button class="pz-btn ok" id="cF">Close shift & Z-report</button><button class="pz-btn sec" id="cB">🔒 Reopen count (manager)</button></div>');
    mask.querySelector('#cB').onclick=function(){var a=A();if(!a.managerApproval||!a.consumeManagerApproval){alert('3D approval service is not available. Refresh the portal.');return;}a.managerApproval('reopen_cash_count',shift.id,null,'Reopen confirmed cash count').then(function(ap){return a.consumeManagerApproval({action:'reopen_cash_count',sourceId:shift.id,operationKey:'reopen_'+shift.id+'_'+Date.now(),approvalId:ap.approvalId});}).then(function(){renderBlind();}).catch(function(e){if(String((e&&e.message)||e).indexOf('cancelled')<0)alert('Could not reopen count: '+((e&&e.message)||e));});};
    mask.querySelector('#cF').onclick=function(){closeWithCount(counts,total);};
  }
  renderBlind();
}
async function finalizeClose(shift,counted,counts){
  try{await continuityReadyForClose();}catch(error){alert(String(error&&error.message||error)+' Your cash count was not submitted; the shift remains open.');return;}
  var saleList;try{saleList=await loadShiftTransactions(shift.id);}catch(_e){saleList=shiftSales(shift);}
  var z=computeZ(shift,saleList),closedAt=Date.now();z.countedCash=counted;z.variance=Math.round((counted-z.expectedCash)*100)/100;z.closeCount=counts;z.expectedDrawer=shift.drawer||null;z.cashToSettle=Math.max(0,Math.round((counted-z.retainedFloat)*100)/100);
  z.actualFloatRetained=Math.max(0,Math.min(counted,z.retainedFloat));z.floatShortfall=Math.max(0,Math.round((z.retainedFloat-z.actualFloatRetained)*100)/100);
  var shiftRef=shiftReference(shift.shiftReference,shift.id),snapshot={schemaVersion:4,shiftReference:shiftRef,capturedAt:closedAt,calculation:'float + cash sales + tips - cash refunds + pay-ins - pay-outs',floatMode:shift.floatMode||(fixedFloatCfg!=null?'fixed':'opening-count'),configuredFloat:shift.configuredFloat!=null?Number(shift.configuredFloat):(fixedFloatCfg!=null?fixedFloatCfg:null),openingFloat:Number(shift.openingFloat)||0,retainedFloat:z.retainedFloat,actualFloatRetained:z.actualFloatRetained,floatShortfall:z.floatShortfall,tolerance:Number(toleranceCfg.cashPeso)||0,reconcileTotalOnly:reconcileTotalOnlyR(),tx:z.tx,gross:z.gross,discounts:z.discounts,refunds:z.refunds,cashRefunds:z.cashRefunds,net:z.net,cashSales:z.cashSales,tips:z.tips,payIns:z.payIns,payOuts:z.payOuts,expectedCash:z.expectedCash,countedCash:counted,variance:z.variance,varianceStatus:Math.abs(z.variance)>=.005?'pending_manager_reconciliation':'reconciled',cashToSettle:z.cashToSettle,byMethod:z.byMethod,byChannel:z.byChannel,voidCount:z.voidCount,voidAmt:z.voidAmt,pending:z.pending,pendingCount:z.pendingCount,openCount:shift.openCount||{},closeCount:counts||{},expectedDrawer:shift.drawer||{},payInEntries:(shift.payIns||[]),payOutEntries:(shift.payOuts||[]),floatException:shift.floatException||null,sales:saleList.map(function(o){return{id:o.id||'',time:o.time||'',timestamp:Number(o.timestamp)||0,total:Number(o.total)||0,channel:o.channel||'instore',payment:o.payment||'',payments:o.payments||null,refundAmount:Number(o.refundAmount)||0,refundPayments:o.refundPayments||null,refundHistory:o.refundHistory||null};})};
  var closed={status:'closed',shiftReference:shiftRef,closeAt:closedAt,openingFloat:shift.openingFloat,openCount:shift.openCount||null,closeCount:counts,drawerExpected:shift.drawer||null,tx:z.tx,gross:z.gross,discounts:z.discounts,refunds:z.refunds,cashRefunds:z.cashRefunds,tips:z.tips,net:z.net,byMethod:z.byMethod,voidCount:z.voidCount,voidAmt:z.voidAmt,payIns:z.payIns,payOuts:z.payOuts,expectedCash:z.expectedCash,countedCash:counted,variance:z.variance,varianceStatus:snapshot.varianceStatus,byChannel:z.byChannel,retainedFloat:z.retainedFloat,actualFloatRetained:z.actualFloatRetained,floatShortfall:z.floatShortfall,cashToSettle:z.cashToSettle,pending:z.pending,pendingCount:z.pendingCount,floatMode:snapshot.floatMode,configuredFloat:snapshot.configuredFloat,zReport:snapshot};
  var a=A(),writes={};writes['shifts/'+shift.id]=Object.assign({},shift,closed);writes.posActiveShift=null;
  if(Math.abs(z.variance)>=.005){var did=uid('disc_');writes['discrepancies/'+did]={kind:'cash',expected:z.expectedCash,actual:counted,variance:z.variance,value:z.variance,type:z.variance<0?'shortage':'overage',overTolerance:Math.abs(z.variance)>snapshot.tolerance,shiftId:shift.id,shiftReference:shiftRef,staff:shift.staff||'',status:'open',financialStatus:'pending_manager_reconciliation',pendingMovementId:'shift_variance_'+shift.id,ts:closedAt};}
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
  w.document.write('<html><head><title>Z-Report '+esc(shiftReference(shift.shiftReference,shift.id))+'</title><style>*{font-family:monospace;font-size:12px;color:#000;}body{padding:10px;}h2,h3{text-align:center;margin:2px 0;}table{width:100%;border-collapse:collapse;}td{padding:2px 0;}hr{border:none;border-top:1px dashed #000;}@media print{button{display:none;}}</style></head><body>'
    +'<h2>Accaza Coffee House</h2><h3>SHIFT Z-REPORT</h3><hr>'
    +'<div>Shift reference: '+esc(shiftReference(shift.shiftReference,shift.id))+'</div><div>Cashier: '+esc(shift.staff)+'</div><div>Open: '+new Date(shift.openAt).toLocaleString('en-PH')+'</div><div>Close: '+new Date(z.reportClosedAt||shift.closeAt||Date.now()).toLocaleString('en-PH')+'</div><div>Float policy: '+esc(shift.floatMode==='fixed'?'Fixed':'Opening count')+(shift.configuredFloat!=null?' '+peso(shift.configuredFloat):'')+'</div><hr>'
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
    +'<tr><td>Opening cash float</td><td style="text-align:right;">'+peso(shift.openingFloat)+'</td></tr>'
    +'<tr><td style="padding-left:18px;">Add: Cash sales</td><td style="text-align:right;">+'+peso(z.cashSales)+'</td></tr>'
    +(z.tips?'<tr><td style="padding-left:18px;">Add: Cash tips / rounding</td><td style="text-align:right;">+'+peso(z.tips)+'</td></tr>':'')
    +(z.payIns?'<tr><td style="padding-left:18px;">Add: Cash pay-ins</td><td style="text-align:right;">+'+peso(z.payIns)+'</td></tr>':'')
    +(z.cashRefunds?'<tr><td style="padding-left:18px;">Less: Cash refunds</td><td style="text-align:right;">-'+peso(z.cashRefunds)+'</td></tr>':'')
    +(z.payOuts?'<tr><td style="padding-left:18px;">Less: Authorized cash pay-outs</td><td style="text-align:right;">-'+peso(z.payOuts)+'</td></tr>':'')
    +'<tr style="border-top:1px solid #000;"><td><b>Total cash to be accounted for</b></td><td style="text-align:right;"><b>'+peso(z.expectedCash)+'</b></td></tr>'
    +'<tr><td>Cash counted</td><td style="text-align:right;">'+peso(z.countedCash)+'</td></tr>'
    +'<tr><td><b>Variance — '+(z.variance>0?'overage':z.variance<0?'shortage':'reconciled')+'</b></td><td style="text-align:right;"><b>'+(z.variance>0?'+':'')+peso(z.variance)+'</b></td></tr></table>'
    +(Math.abs(Number(z.variance)||0)>=.005?'<div style="border:1px solid #b7791f;padding:5px;margin:5px 0;"><b>MANAGER REVALIDATION REQUIRED</b><div>Variance is pending resolution in Discrepancies. Shift closure is allowed so operations can continue.</div></div>':'')+'<hr>'
    +'<div><b>Cash to settle (imprest)</b></div><table>'
      +'<tr><td>Counted cash</td><td style="text-align:right;">'+peso(z.countedCash)+'</td></tr>'
      +'<tr><td>Target cash float</td><td style="text-align:right;">'+peso(z.retainedFloat)+'</td></tr>'
      +'<tr><td>Less: actual cash retained as float</td><td style="text-align:right;">-'+peso(z.actualFloatRetained!=null?z.actualFloatRetained:Math.min(Number(z.countedCash)||0,z.retainedFloat))+'</td></tr>'
      +((Number(z.floatShortfall)||0)>0?'<tr><td><b>Cash float shortfall</b></td><td style="text-align:right;"><b>'+peso(z.floatShortfall)+'</b></td></tr>':'')
      +'<tr><td><b>► CASH TO SETTLE (remit)</b></td><td style="text-align:right;"><b>'+peso(Math.max(0,Math.round(((Number(z.countedCash)||0)-z.retainedFloat)*100)/100))+'</b></td></tr></table>'
      +(z.floatMismatch?'<div style="font-size:9px;color:#c0392b;">⚠ Opened with '+peso(shift.openingFloat)+' but standard float is '+peso(fixedFloatCfg)+' — reconcile the float.</div>':'')
      +'<hr>'
    +(z.closeCount&&denomBreakdownRows(z.closeCount)?('<div><b>Cash counted by denomination</b></div><table>'+denomBreakdownRows(z.closeCount)+'<tr style="border-top:1px solid #000;"><td><b>Total cash counted</b></td><td style="text-align:right;"><b>'+peso(countedDenomTotal)+'</b></td></tr></table><hr>'):'')
    +((!(z.reconcileTotalOnly!=null?z.reconcileTotalOnly:reconcileTotalOnlyR())&&z.expectedDrawer)?('<div><b>Denomination check (expected → counted)</b></div><table>'+DENOMS.map(function(d){var exp=Number(z.expectedDrawer[d.k])||0;var act=Number((z.closeCount||{})[d.k])||0;if(!act&&!exp)return '';var dv=act-exp;return '<tr><td>'+d.lbl+'</td><td style="text-align:right;">'+exp+' → '+act+(dv?'  ('+(dv>0?'+':'')+dv+')':'  ✓')+'</td></tr>';}).join('')+'<tr style="border-top:1px solid #000;"><td><b>Total</b></td><td style="text-align:right;"><b>'+peso(expectedDenomTotal)+' → '+peso(countedDenomTotal)+' ('+peso(countedDenomTotal-expectedDenomTotal)+')</b></td></tr></table><hr>'):'')
    +'<div style="font-size:9px;text-align:center;">Total cash to be accounted for = opening float + cash sales + tips + pay-ins − cash refunds − authorized pay-outs. Variance = cash counted − total cash to be accounted for. Target and actual retained float are shown separately. Management report, not a BIR document.</div>'
    +'<div style="text-align:center;margin-top:8px;"><button onclick="window.print()">Print</button></div></body></html>');
  w.document.close();
}
