
function renderOps(){
  var root=document.getElementById('opsRoot');if(!root)return;
  var html='<div class="pz-h">🧾 Register Ops</div><p class="pz-sub">Shift control, cash reconciliation, voids &amp; refunds — all logged. Owner, Superadmin, Admin, or Manager accounts approve controlled actions.</p>';
  html+=pendingPanel();
  // SHIFT
  html+='<div class="pz-card" style="margin-bottom:1rem;">';
  if(activeShift){
    var z=computeZ(activeShift);
    html+='<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem;"><div><span style="color:#2a9d5c;font-weight:700;">🟢 Shift open</span> · Cashier <b>'+esc(activeShift.staff)+'</b> · since '+new Date(activeShift.openAt).toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'})+'</div><button class="pz-btn warn" id="opsClose">Close shift &amp; Z-report</button></div>';
    html+='<div style="display:flex;gap:0.5rem;margin-top:0.6rem;flex-wrap:wrap;align-items:center;"><button class="pz-btn ok" id="opsReview">📋 Shift review</button><button class="pz-btn sec" id="opsCashIn">➕ Cash in</button>'+(denomTrackingOnR()?'<button class="pz-btn sec" id="opsSwap">🔁 Break a bill</button>':'')+'<span style="font-size:0.72rem;color:var(--tl);">The register drawer is for sales intake. Expenses and supplier payments use Financials → Cash Payments.</span></div>';
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
  if(activeShift)opts+='<option value="'+esc(activeShift.id)+'">🟢 '+esc(shiftReference(activeShift.shiftReference,activeShift.id))+' · '+esc(activeShift.staff||'')+' · '+new Date(activeShift.openAt).toLocaleString('en-PH',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})+'</option>';
  Object.keys(shiftsMap).map(function(k){return Object.assign({id:k},shiftsMap[k]);}).filter(function(s){return s.status==='closed';}).sort(function(a,b){return (b.openAt||0)-(a.openAt||0);}).slice(0,80).forEach(function(s){opts+='<option value="'+esc(s.id)+'">'+esc(shiftReference(s.shiftReference,s.id))+' · '+esc(s.staff||'')+' · '+new Date(s.openAt).toLocaleString('en-PH',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})+(s.closeAt?('–'+new Date(s.closeAt).toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'})):'')+'</option>';});
  return opts;
}
function shiftCardHtml(){
  var opts=shiftOptions(); if(!opts)return '';
  return '<div class="az-sec">📇 Shift summary</div><div class="pz-card" style="margin-bottom:1rem;"><div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.6rem;"><span style="font-size:0.85rem;color:var(--bd);font-weight:600;">Shift</span><select class="pz-in" id="opsCardShift" style="min-width:250px;">'+opts+'</select></div><div id="opsCardBody"></div></div>';
}
function shiftSummaryObj(shift,isOpen){
  if(isOpen){var z=computeZ(shift);return {tx:z.tx,net:z.net,gross:z.gross,cashSales:z.cashSales,tips:z.tips,payIns:z.payIns,payOuts:z.payOuts,cashRefunds:z.cashRefunds,byMethod:z.byMethod,byChannel:z.byChannel,expectedCash:z.expectedCash,countedCash:null,retainedFloat:z.retainedFloat,availableForHandover:z.availableForHandover,cashToSettle:z.cashToSettle,variance:null,openingFloat:Number(shift.openingFloat)||0,openAt:shift.openAt,closeAt:null,open:true,payOutEntries:shift.payOuts||[]};}
  var rf=(shift.retainedFloat!=null?Number(shift.retainedFloat):(fixedFloatCfg!=null?fixedFloatCfg:(Number(shift.openingFloat)||0)));
  var counted=(shift.countedCash!=null?Number(shift.countedCash):null);
  var cts=(shift.cashToSettle!=null?Number(shift.cashToSettle):Math.round(((counted!=null?counted:(Number(shift.expectedCash)||0))-rf)*100)/100);
  var payOutEntries=(shift.zReport&&shift.zReport.payOutEntries)||shift.payOuts||[],payOutTotal=payOutEntries.reduce(function(sum,x){return sum+(Number(x.amount)||0);},0);
  return {tx:Number(shift.tx)||0,net:Number(shift.net)||0,gross:Number(shift.gross)||0,cashSales:(shift.byMethod&&shift.byMethod.Cash)||0,tips:Number(shift.tips)||0,payIns:Number(shift.payIns)||0,payOuts:Number(shift.payOuts)||0,cashRefunds:Number(shift.cashRefunds)||0,byMethod:shift.byMethod||{},byChannel:shift.byChannel||null,expectedCash:Number(shift.expectedCash)||0,countedCash:counted,retainedFloat:rf,actualFloatRetained:shift.actualFloatRetained!=null?Number(shift.actualFloatRetained):Math.min(counted==null?rf:counted,rf),floatShortfall:Number(shift.floatShortfall)||0,availableForHandover:Math.round((cts+payOutTotal)*100)/100,cashToSettle:cts,variance:(shift.variance!=null?Number(shift.variance):null),varianceStatus:shift.varianceStatus||'',openingFloat:Number(shift.openingFloat)||0,openAt:shift.openAt,closeAt:shift.closeAt||null,open:false,payOutEntries:payOutEntries};
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
  if(!isOpen&&!shift.shiftReference&&!shiftReferenceRequests[id]){var api=A();if(api&&api.ensureShiftReference){shiftReferenceRequests[id]=true;api.ensureShiftReference({shiftId:id}).then(function(r){var result=(r&&r.data)||r||{};if(shiftsMap[id])shiftsMap[id].shiftReference=result.shiftReference||'';}).catch(function(){}).finally(function(){delete shiftReferenceRequests[id];if(isTab('ops'))renderOps();});}}
  var S=shiftSummaryObj(shift,isOpen);
  var expectedHandover=Math.max(0,Math.round((S.expectedCash-S.retainedFloat)*100)/100),actualHandover=S.countedCash!=null?Math.max(0,Math.round((S.countedCash-S.retainedFloat)*100)/100):null;
  var chRows=S.byChannel?([['instore','In-store'],['online','Online Orders'],['grabfood','GrabFood'],['foodpanda','FoodPanda']].map(function(c){var v=(S.byChannel&&S.byChannel[c[0]])||0;if(!v&&c[0]!=='instore')return '';return '<tr><td>'+c[1]+'</td><td class="r">'+peso(v)+'</td></tr>';}).join('')):'<tr><td colspan="2" class="az-note">Channel split not stored for this shift.</td></tr>';
  var mRows=zMethodRows(S,'class="r"')||'<tr><td colspan="2" class="az-note">—</td></tr>';
  var hdr='<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.4rem;margin-bottom:0.5rem;"><div><b>Shift reference: '+esc(shiftReference(shift.shiftReference,shift.id))+'</b><div class="az-note">'+esc(shift.staff||'')+' · '+new Date(S.openAt).toLocaleString('en-PH',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})+(S.closeAt?('–'+new Date(S.closeAt).toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'})):'')+'</div></div><span style="font-weight:700;color:'+(S.open?'#2a9d5c':'var(--tl)')+';">'+(S.open?'🟢 Open':'Closed')+'</span></div>';
  var kpis='<div class="az-kpis" style="margin:0 0 0.7rem;">'+kpi('Transactions',S.tx)+kpi('Net sales',peso(S.net))+kpi('Cash sales',peso(S.cashSales))+kpi('Expected cash to hand over',peso(expectedHandover))+'</div>';
  var recon='<div class="az-sec">Cash</div><div class="pz-card" style="margin-bottom:0.6rem;"><table class="pz-tbl"><tbody>'
    +'<tr><td>Opening cash float</td><td class="r">'+peso(S.openingFloat)+'</td></tr>'
    +'<tr><td style="padding-left:1.5rem;">Add: Cash sales</td><td class="r">+'+peso(S.cashSales)+'</td></tr>'
    +(S.tips?'<tr><td style="padding-left:1.5rem;">Add: Cash tips / rounding</td><td class="r">+'+peso(S.tips)+'</td></tr>':'')
    +(S.payIns?'<tr><td style="padding-left:1.5rem;">Add: Cash pay-ins</td><td class="r">+'+peso(S.payIns)+'</td></tr>':'')
    +(S.cashRefunds?'<tr><td style="padding-left:1.5rem;">Less: Cash refunds</td><td class="r">−'+peso(S.cashRefunds)+'</td></tr>':'')
    +(S.payOuts?'<tr><td style="padding-left:1.5rem;">Less: Authorized cash pay-outs</td><td class="r">−'+peso(S.payOuts)+'</td></tr>':'')
    +'<tr style="border-top:2px solid var(--bd);"><td><b>Total cash to be accounted for</b></td><td class="r"><b>'+peso(S.expectedCash)+'</b></td></tr>'
    +(S.countedCash!=null?'<tr><td>Cash counted</td><td class="r">'+peso(S.countedCash)+'</td></tr>':'')
    +(S.variance!=null?'<tr><td><b>Variance — '+(S.variance>0?'overage':S.variance<0?'shortage':'reconciled')+'</b></td><td class="r" style="color:'+(Math.abs(S.variance)<=(Number(toleranceCfg.cashPeso)||0)?'#155724':'#c0392b')+';"><b>'+(S.variance>0?'+':'')+peso(S.variance)+'</b></td></tr>':'')
    +'<tr><td>Target cash float</td><td class="r">'+peso(S.retainedFloat)+'</td></tr>'
    +'<tr><td style="padding-left:1.5rem;">Less: Actual cash retained as float</td><td class="r">−'+peso(S.actualFloatRetained!=null?S.actualFloatRetained:S.retainedFloat)+'</td></tr>'
    +(S.floatShortfall?'<tr><td><b>Cash float shortfall</b></td><td class="r" style="color:#c0392b;"><b>'+peso(S.floatShortfall)+'</b></td></tr>':'')
    +(actualHandover!=null?'<tr style="border-top:2px solid var(--bd);"><td><b>Actual cash to hand over</b></td><td class="r"><b>'+peso(actualHandover)+'</b></td></tr>':'')
    +'<tr style="border-top:1px solid var(--cd);"><td><b>Expected cash to hand over</b></td><td class="r"><b>'+peso(expectedHandover)+'</b></td></tr>'
    +(S.varianceStatus==='pending_manager_reconciliation'?'<tr><td colspan="2" style="color:#8a5a00;padding-top:.55rem;"><b>Manager revalidation required:</b> variance is pending resolution in Discrepancies.</td></tr>':'')
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