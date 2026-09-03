
/* ══════════ SHIFT REVIEW (live liquidation for the open shift) ══════════ */
function shiftSales(shift){return Object.keys(ordersMap).map(function(k){return ordersMap[k];}).filter(function(o){return o&&o.shiftId===shift.id&&!o.voided&&(o.status==='Completed'||o.status==='Received');}).sort(function(a,b){return (a.timestamp||0)-(b.timestamp||0);});}
function shiftItemsSummary(shift){var m={};shiftSales(shift).forEach(function(o){(o.lineItems||[]).forEach(function(li){var k=li.itemKey||li.name||'?';if(!m[k])m[k]={name:li.name||k,qty:0,sales:0};m[k].qty+=Number(li.qty)||0;m[k].sales+=(Number(li.qty)||0)*(Number(li.unitTotal)||0);});});return Object.keys(m).map(function(k){return m[k];}).sort(function(a,b){return b.sales-a.sales;});}
function shiftTxnMethod(o){return paysOf(o).map(function(p){return p.method;}).join('+');}
function openShiftReview(){
  if(!activeShift){alert('No open shift to review.');return;}
  var shift=activeShift,z=computeZ(shift),sales=shiftSales(shift),items=shiftItemsSummary(shift);
  var reviewMethodTotal=Object.keys(z.byMethod).reduce(function(s,m){return s+(Number(z.byMethod[m])||0);},0),reviewTxnTotal=sales.reduce(function(s,o){return s+(Number(o.total)||0)-(Number(o.refundAmount)||0);},0);
  var methodRows=zMethodRows(z,'class="r"')||'<tr><td colspan="2" style="color:var(--tl);">No sales yet.</td></tr>';
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
      +'<tr><td>Less: float retained</td><td class="r">−'+peso(z.retainedFloat)+'</td></tr>'
      +'<tr style="border-top:2px solid var(--bd);"><td><b>Available for handover</b></td><td class="r"><b>'+peso(z.availableForHandover)+'</b></td></tr>'
      +(shift.payOuts||[]).map(function(x){return '<tr><td>'+esc((x.type==='purchase_advance'?'Purchase cash — '+(x.recipient||x.purpose||'')+' · '+peso(x.remainingAmount!=null?x.remainingAmount:x.amount)+' awaiting allocation':(x.reason||'Authorized cash-out')) )+'</td><td class="r">−'+peso(x.amount)+'</td></tr>';}).join('')
      +'<tr style="border-top:1px solid var(--cd);"><td><b>► Expected cash to hand over</b></td><td class="r"><b>'+peso(z.cashToSettle)+'</b></td></tr>'
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