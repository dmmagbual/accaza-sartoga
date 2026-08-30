
/* ══════════ DAILY REPORT (all channels + register expenses) ══════════ */
function drNum(n){return (Math.round((Number(n)||0)*1000)/1000).toLocaleString('en-PH');}
function dailyBounds(dstr){var s=new Date(dstr+'T00:00:00').getTime();return [s,s+86400000];}
function closeStatusLabel(status){return String(status||'NOT RUN').replace(/_/g,' ');}
function closeControlHtml(d,shiftRows){
  var row=financialCloseState['daily_'+d],loading=financialCloseLoading['daily_'+d],status=row&&row.status||'NOT_RUN',tone=status==='CERTIFIED'||status==='RECONCILED'?'#eaf7ee':status==='RECONCILED_WITH_TIMING_ITEMS'?'#fff9e8':'#fff0ef',exceptions=row&&row.exceptions||[],timing=row&&row.timingItems||[],tot=row&&row.controlTotals||{},closed=(shiftRows||[]).filter(function(s){return !s.open;});
  var issueRows=exceptions.slice(0,20).map(function(x){return '<tr><td>'+esc(x.control)+'</td><td>'+esc(x.sourceId||'—')+'</td><td>'+esc(x.category)+'</td><td class="r">'+peso(Math.abs(Number(x.difference)||0))+'</td><td>'+esc(x.message||'')+'</td></tr>';}).join('');
  return '<section class="pz-card" style="margin-bottom:1rem;background:'+tone+';border:1px solid #d7c8b2;"><div style="display:flex;justify-content:space-between;gap:.7rem;align-items:center;flex-wrap:wrap;"><div><div class="pz-lbl">Shared Admin ↔ Finance control</div><div class="pz-h" style="font-size:1.05rem;">Daily Financial Close · '+esc(closeStatusLabel(status))+'</div><div class="pz-sub">'+(row?('Revision '+row.revision+' · '+row.transactionCount+' orders · '+exceptions.length+' exception(s) · '+timing.length+' timing item(s)'):'Run the server-authoritative close to compare transaction sources, control accounts and subledgers.')+'</div></div><div style="display:flex;gap:.4rem;flex-wrap:wrap;"><button class="pz-btn ok" id="drRunClose"'+(loading?' disabled':'')+'>'+(loading?'Running…':'Run daily reconciliation')+'</button>'+(row&&['RECONCILED','RECONCILED_WITH_TIMING_ITEMS'].indexOf(status)>-1?'<button class="pz-btn ok" id="drCertifyClose">Manager certify</button>':'')+'</div></div>'
    +(row?'<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:.45rem;margin-top:.65rem;"><div><span class="pz-lbl">Admin net sales</span><b>'+peso(row.admin&&row.admin.netSales)+'</b></div><div><span class="pz-lbl">Finance net revenue</span><b>'+peso(row.finance&&row.finance.netRevenue)+'</b></div><div><span class="pz-lbl">Sales difference</span><b>'+peso(tot.salesDifference)+'</b></div><div><span class="pz-lbl">Undeposited vs custody</span><b>'+peso(tot.cashCustodyDifference)+'</b></div><div><span class="pz-lbl">AR difference</span><b>'+peso(tot.receivablesDifference)+'</b></div><div><span class="pz-lbl">Supplier AP difference</span><b>'+peso(tot.payablesDifference)+'</b></div><div><span class="pz-lbl">Customer refunds payable</span><b>'+peso(row.subledgers&&row.subledgers.customerChangePayables)+'</b><small style="display:block;">difference '+peso(tot.customerChangePayablesDifference)+'</small></div></div>':'')
    +(issueRows?'<details style="margin-top:.65rem;"><summary><b>Open exceptions</b></summary><div style="overflow:auto;"><table class="pz-tbl"><thead><tr><th>Control</th><th>Source</th><th>Category</th><th class="r">Difference</th><th>Required action</th></tr></thead><tbody>'+issueRows+'</tbody></table></div></details>':'')
    +'<div style="margin-top:.65rem;display:flex;gap:.4rem;align-items:end;flex-wrap:wrap;"><div><span class="pz-lbl">Optional shift close</span><select class="pz-in" id="drCloseShift"><option value="">Select a closed shift</option>'+closed.map(function(s){return '<option value="'+esc(s.id)+'">'+esc(s.shiftReference||s.id)+' · '+esc(s.staff||'Register')+'</option>';}).join('')+'</select></div><button class="pz-btn sec" id="drRunShiftClose">Run shift reconciliation</button></div></section>';
}
function loadFinancialClose(d){var key='daily_'+d;if(financialCloseLoading[key]||Object.prototype.hasOwnProperty.call(financialCloseState,key))return;financialCloseLoading[key]=true;A().runFinancialClose({action:'get',closeType:'DAILY_CLOSE',businessDate:d}).then(function(r){var x=(r&&r.data)||r||{};financialCloseState[key]=x.current||null;}).catch(function(){financialCloseState[key]=null;}).finally(function(){financialCloseLoading[key]=false;if(isTab('dailyreport'))renderDailyReport();});}
function wireFinancialClose(d){var a=A(),run=document.getElementById('drRunClose'),cert=document.getElementById('drCertifyClose'),shift=document.getElementById('drRunShiftClose');if(run)run.onclick=function(){financialCloseLoading['daily_'+d]=true;renderDailyReport();a.runFinancialClose({closeType:'DAILY_CLOSE',businessDate:d}).then(function(r){var x=(r&&r.data)||r||{};financialCloseState['daily_'+d]=x;alert(x.status==='EXCEPTIONS_OPEN'?'Close completed with '+(x.exceptions||[]).length+' exception(s). Certification remains blocked.':'Daily close reconciled. Review timing items, then certify.');}).catch(function(e){alert('Could not run close: '+((e&&e.message)||e));}).finally(function(){financialCloseLoading['daily_'+d]=false;renderDailyReport();});};if(cert)cert.onclick=function(){var row=financialCloseState['daily_'+d];window.AccazaFormDialog.run({title:'Certify Daily Financial Close',subtitle:d+' · revision '+row.revision+'. Certification locks this snapshot; later Finance activity reopens it for a new revision.',submitLabel:'Approve & certify',busyLabel:'Certifying…',fields:[{name:'reason',label:'Certification note',type:'textarea',required:true,maxLength:500},{name:'confirmed',label:'I reviewed the Admin, Finance, cash custody, inventory, AP/AR and timing-item controls',type:'checkbox',required:true}]},function(v){return a.managerApproval('certify_financial_close','daily_'+d,null,v.reason).then(function(ap){return a.runFinancialClose({action:'certify',closeType:'DAILY_CLOSE',businessDate:d,reason:v.reason,approvalId:ap.approvalId});});}).then(function(r){var x=(r&&r.data)||r||{};financialCloseState['daily_'+d]=Object.assign({},row,{status:'CERTIFIED',certification:x.certification});alert('Daily close certified.');renderDailyReport();}).catch(function(){});};if(shift)shift.onclick=function(){var id=(document.getElementById('drCloseShift')||{}).value;if(!id)return alert('Select a closed shift.');a.runFinancialClose({closeType:'SHIFT_CLOSE',businessDate:d,shiftId:id}).then(function(r){var x=(r&&r.data)||r||{};alert('Shift close '+closeStatusLabel(x.status)+' · '+(x.exceptions||[]).length+' exception(s).');}).catch(function(e){alert('Could not run shift close: '+((e&&e.message)||e));});};}
// Channel of a sale for the Daily Report. Platform tags win; POS-keyed = in-store; anything else (website orders, no shiftId) = online.
function drChannel(o){if(o.channel==='grabfood'||o.channel==='foodpanda')return o.channel;if(o.source==='pos'||o.channel==='instore')return 'instore';return 'online';}
function renderDailyReport(){
  var root=document.getElementById('dailyReportRoot'); if(!root)return;
  var d=window.__dailyDate||tsToDate(Date.now()); window.__dailyDate=d;
  loadFinancialClose(d);
  var a=A();
  a.get(a.ref(a.db,'shifts')).then(function(sn){buildDay(sn.val()||{});}).catch(function(){buildDay({});});
  function buildDay(sh){
    // Trading-day attribution: a POS sale belongs to the day its SHIFT OPENED (business day runs past midnight);
    // online orders (no shift) fall on their own calendar date.
    var shiftDay={}; Object.keys(sh).forEach(function(k){var s=sh[k];if(s&&s.openAt)shiftDay[k]=tsToDate(s.openAt);});
    function tradingDay(o){return (o.shiftId&&shiftDay[o.shiftId])?shiftDay[o.shiftId]:tsToDate(o.timestamp||Date.parse(o.date)||0);}
    var sales=allOrders().filter(isSale).map(saleFields).filter(function(s){return tradingDay(s.o)===d;});
    var chan={instore:{lbl:'In-store',tx:0,gross:0,disc:0,net:0,comm:0},grabfood:{lbl:'GrabFood',tx:0,gross:0,disc:0,net:0,comm:0},foodpanda:{lbl:'FoodPanda',tx:0,gross:0,disc:0,net:0,comm:0},online:{lbl:'Online Orders',tx:0,gross:0,disc:0,net:0,comm:0}};
    var byMethod={},itemsM={},txns=[],refundsTot=0,netTot=0,byShift={};
    sales.forEach(function(s){var o=s.o;var c=drChannel(o);var ch=chan[c];ch.tx++;var nt;
      if(c==='instore'||c==='online'){ch.gross+=s.gross;ch.disc+=s.discount;ch.net+=s.net;nt=s.net;netTot+=s.net;}
      else{var g=s.gross;nt=s.net;ch.gross+=g;ch.disc+=s.discount;ch.comm+=Number(o.commission)||0;ch.net+=nt;netTot+=nt;}
      refundsTot+=s.refund;
      var pays=(o.payments&&o.payments.length)?o.payments:[{method:o.channel==='grabfood'?'GrabFood':o.channel==='foodpanda'?'FoodPanda':(o.payment||'—'),amount:Number(o.total)||0}];
      pays.forEach(function(p){byMethod[p.method]=(byMethod[p.method]||0)+(Number(p.amount)||0);});
      if(o.shiftId){var g2=byShift[o.shiftId]||(byShift[o.shiftId]={tx:0,net:0,cash:0});g2.tx++;g2.net+=nt;pays.forEach(function(p){if(p.method==='Cash')g2.cash+=Number(p.amount)||0;});}
      (o.lineItems||[]).forEach(function(li){var k=li.itemKey||li.name||'?';if(!itemsM[k])itemsM[k]={name:li.name||k,qty:0,sales:0};itemsM[k].qty+=Number(li.qty)||0;itemsM[k].sales+=(Number(li.qty)||0)*(Number(li.unitTotal)||0);});
      txns.push({time:o.time||new Date(s.ts).toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'}),id:o.id,channel:chan[c].lbl,method:pays.map(function(p){return p.method;}).join('+'),amount:Number(o.total)||0,refund:s.refund});
    });
    var items=Object.keys(itemsM).map(function(k){return itemsM[k];}).sort(function(a,b){return b.sales-a.sales;});
    var payouts=[];Object.keys(sh).forEach(function(k){var s=sh[k];(s.payOuts||[]).forEach(function(p){var pd=shiftDay[k]||tsToDate(Number(p.ts)||0);if(pd===d)payouts.push({time:new Date(Number(p.ts)||0).toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'}),reason:p.reason||'pay-out',amount:Number(p.amount)||0});});});
    // shifts whose trading day == d, with per-shift rollup
    var shiftRows=Object.keys(sh).map(function(k){return Object.assign({id:k},sh[k]);}).filter(function(s){return shiftDay[s.id]===d;}).sort(function(a,b){return (a.openAt||0)-(b.openAt||0);}).map(function(s){var g=byShift[s.id]||{tx:0,net:0,cash:0};var open=s.status!=='closed';return {id:s.id,staff:s.staff||'',openAt:s.openAt,closeAt:s.closeAt||null,open:open,tx:g.tx,net:g.net,cash:g.cash,cashToSettle:(open?null:(s.cashToSettle!=null?Number(s.cashToSettle):null))};});
    build(payouts,shiftRows,chan,byMethod,items,txns,refundsTot,netTot,sales);
  }
  function build(payouts,shiftRows,chan,byMethod,items,txns,refundsTot,netTot,sales){
    var payoutTot=payouts.reduce(function(s,p){return s+p.amount;},0);
    var cashReceived=Object.keys(byMethod).reduce(function(sum,method){return /cash/i.test(method)?sum+(Number(byMethod[method])||0):sum;},0);
    var nonCashReceived=Object.keys(byMethod).reduce(function(sum,method){return /cash/i.test(method)?sum:sum+(Number(byMethod[method])||0);},0);
    var itemsSold=items.reduce(function(sum,item){return sum+(Number(item.qty)||0);},0);
    var paymentTotal=cashReceived+nonCashReceived;
    var itemSalesTotal=items.reduce(function(sum,item){return sum+(Number(item.sales)||0);},0);
    var transactionTotal=txns.reduce(function(sum,t){return sum+(Number(t.amount)||0);},0);
    var shiftTxTotal=shiftRows.reduce(function(sum,s){return sum+(Number(s.tx)||0);},0),shiftNetTotal=shiftRows.reduce(function(sum,s){return sum+(Number(s.net)||0);},0),shiftSettleTotal=shiftRows.reduce(function(sum,s){return sum+(Number(s.cashToSettle)||0);},0);
    var channelTxTotal=0,channelGrossTotal=0,channelDeductionTotal=0;Object.keys(chan).forEach(function(k){var x=chan[k];channelTxTotal+=Number(x.tx)||0;channelGrossTotal+=Number(x.gross)||0;channelDeductionTotal+=(Number(x.disc)||0)+(Number(x.comm)||0);});
    var chRows=['instore','grabfood','foodpanda','online'].map(function(c){var x=chan[c];if(!x.tx)return '';return '<tr><td>'+x.lbl+'</td><td class="r">'+x.tx+'</td><td class="r">'+peso(x.gross)+'</td><td class="r">'+(x.disc?('−'+peso(x.disc)):(x.comm?('comm −'+peso(x.comm)):'—'))+'</td><td class="r">'+peso(x.net)+'</td></tr>';}).join('');
    var methodRows=Object.keys(byMethod).sort().map(function(m){return '<tr><td>'+esc(m)+'</td><td class="r">'+peso(byMethod[m])+'</td></tr>';}).join('')||'<tr><td colspan="2" style="color:var(--tl);">—</td></tr>';
    var itemRows=items.map(function(x){return '<tr><td>'+esc(x.name)+'</td><td class="r">'+drNum(x.qty)+'</td><td class="r">'+peso(x.sales)+'</td></tr>';}).join('')||'<tr><td colspan="3" style="color:var(--tl);">No sales this day.</td></tr>';
    var txnRows=txns.map(function(t){return '<tr><td>'+esc(t.time)+'</td><td>'+esc(t.id)+'</td><td>'+esc(t.channel)+'</td><td>'+esc(t.method)+'</td><td class="r">'+peso(t.amount)+(t.refund?(' · R '+peso(t.refund)):'')+'</td></tr>';}).join('')||'<tr><td colspan="5" style="color:var(--tl);">No sales this day.</td></tr>';
    var expRows=payouts.map(function(p){return '<tr><td>'+esc(p.time)+'</td><td>'+esc(p.reason)+'</td><td class="r">'+peso(p.amount)+'</td></tr>';}).join('')+(refundsTot?('<tr><td>—</td><td>Refunds</td><td class="r">'+peso(refundsTot)+'</td></tr>'):'');
    var shiftTbl=shiftRows.map(function(s){return '<tr><td>'+esc(s.staff)+(s.open?' <span style="color:#2a9d5c;">● open</span>':'')+'</td><td>'+(s.openAt?new Date(s.openAt).toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'}):'—')+(s.closeAt?('–'+new Date(s.closeAt).toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'})):(s.open?'–open':''))+'</td><td class="r">'+s.tx+'</td><td class="r">'+peso(s.net)+'</td><td class="r">'+(s.cashToSettle!=null?peso(s.cashToSettle):'—')+'</td></tr>';}).join('')||'<tr><td colspan="5" style="color:var(--tl);">No shifts opened this trading day.</td></tr>';
    var html='<div class="pz-h">📆 Daily Report</div>'
      +'<div style="display:flex;gap:0.5rem;align-items:end;flex-wrap:wrap;margin-bottom:0.4rem;"><div><span class="pz-lbl">Trading day</span><input class="pz-in" id="drDate" type="date" value="'+d+'"/></div><button class="pz-btn ok" id="drPrint" style="padding:0.4rem 0.9rem;">🖨 Print</button><button class="pz-btn sec" id="drExcel" style="padding:0.4rem 0.9rem;">⬇ Excel</button></div>'
      +'<div class="az-note" style="margin:0 0 0.7rem;">Trading day = the day a shift opened; a shift stays whole even if it runs past midnight. Online orders count on their own date.</div>'
      +closeControlHtml(d,shiftRows)
      +'<section class="dr-summary" aria-labelledby="drSummaryTitle"><div class="dr-summary-head"><div><span>Close-of-day snapshot</span><h3 id="drSummaryTitle">Daily summary</h3></div><small>Choose an amount to view its detail</small></div><div class="dr-summary-grid">'
        +'<button class="dr-summary-item primary" data-dr-target="drChannels"><span>Net sales</span><strong>'+peso(netTot)+'</strong><small>All sales channels →</small></button>'
        +'<button class="dr-summary-item" data-dr-target="drTransactions"><span>Transactions</span><strong>'+sales.length+'</strong><small>View every order →</small></button>'
        +'<button class="dr-summary-item" data-dr-target="drMethods"><span>Cash received</span><strong>'+peso(cashReceived)+'</strong><small>Payment breakdown →</small></button>'
        +'<button class="dr-summary-item" data-dr-target="drMethods"><span>Non-cash received</span><strong>'+peso(nonCashReceived)+'</strong><small>Payment breakdown →</small></button>'
        +'<button class="dr-summary-item out" data-dr-target="drExpenses"><span>Register cash out</span><strong>'+peso(payoutTot+refundsTot)+'</strong><small>Expenses and refunds →</small></button>'
        +'<button class="dr-summary-item" data-dr-target="drItems"><span>Items sold</span><strong>'+drNum(itemsSold)+'</strong><small>Item detail →</small></button>'
        +'<button class="dr-summary-item" data-dr-target="drShifts"><span>Shifts</span><strong>'+shiftRows.length+'</strong><small>Cashier detail →</small></button>'
      +'</div></section>'
      +'<div class="az-sec">Shifts this day ('+shiftRows.length+')</div><div class="pz-card dr-detail-card" id="drShifts" style="margin-bottom:0.7rem;"><div style="overflow-x:auto;"><table class="pz-tbl"><thead><tr><th>Cashier</th><th>Open–Close</th><th class="r">Tx</th><th class="r">Net</th><th class="r">Cash to settle</th></tr></thead><tbody>'+shiftTbl+'<tr class="tot"><td colspan="2">Total</td><td class="r">'+shiftTxTotal+'</td><td class="r">'+peso(shiftNetTotal)+'</td><td class="r">'+peso(shiftSettleTotal)+'</td></tr></tbody></table></div><div class="az-note">Each shift settles its own drawer. Cash to settle shows for closed shifts. Online orders aren’t tied to a shift.</div></div>'
      +'<div class="az-sec">Sales by channel</div><div class="pz-card dr-detail-card" id="drChannels" style="margin-bottom:0.7rem;"><div style="overflow-x:auto;"><table class="pz-tbl"><thead><tr><th>Channel</th><th class="r">Tx</th><th class="r">Gross</th><th class="r">Disc / Comm</th><th class="r">Net</th></tr></thead><tbody>'+(chRows||'<tr><td colspan="5" style="color:var(--tl);">No sales this day.</td></tr>')+'<tr class="tot"><td>Total</td><td class="r">'+channelTxTotal+'</td><td class="r">'+peso(channelGrossTotal)+'</td><td class="r">−'+peso(channelDeductionTotal)+'</td><td class="r">'+peso(netTot)+'</td></tr></tbody></table></div></div>'
      +'<div class="az-sec">Sales by payment method</div><div class="pz-card dr-detail-card" id="drMethods" style="margin-bottom:0.7rem;"><table class="pz-tbl"><tbody>'+methodRows+'<tr class="tot"><td>Total received</td><td class="r">'+peso(paymentTotal)+'</td></tr></tbody></table></div>'
      +'<div class="az-sec">Register expenses (cash out)</div><div class="pz-card dr-detail-card" id="drExpenses" style="margin-bottom:0.7rem;"><table class="pz-tbl"><thead><tr><th>Time</th><th>Reason</th><th class="r">Amount</th></tr></thead><tbody>'+(expRows||'<tr><td colspan="3" style="color:var(--tl);">None.</td></tr>')+'<tr class="tot"><td colspan="2">Total cash out</td><td class="r">'+peso(payoutTot+refundsTot)+'</td></tr></tbody></table></div>'
      +'<div class="az-sec">Items sold</div><div class="pz-card dr-detail-card" id="drItems" style="margin-bottom:0.7rem;"><div style="overflow-x:auto;"><table class="pz-tbl"><thead><tr><th>Item</th><th class="r">Qty</th><th class="r">Sales</th></tr></thead><tbody>'+itemRows+'<tr class="tot"><td>Total</td><td class="r">'+drNum(itemsSold)+'</td><td class="r">'+peso(itemSalesTotal)+'</td></tr></tbody></table></div></div>'
      +'<div class="az-sec">All transactions ('+txns.length+')</div><div class="pz-card dr-detail-card" id="drTransactions"><div style="overflow-x:auto;"><table class="pz-tbl"><thead><tr><th>Time</th><th>Order</th><th>Channel</th><th>Method</th><th class="r">Amount</th></tr></thead><tbody>'+txnRows+'<tr class="tot"><td colspan="4">Total ('+txns.length+' transactions)</td><td class="r">'+peso(transactionTotal)+'</td></tr></tbody></table></div></div>';
    root.innerHTML=html;
    wireFinancialClose(d);
    var X={chan:chan,byMethod:byMethod,items:items,txns:txns,payouts:payouts,refundsTot:refundsTot,netTot:netTot,payoutTot:payoutTot,shiftRows:shiftRows};
    var di=document.getElementById('drDate'); if(di)di.onchange=function(){window.__dailyDate=this.value||d;renderDailyReport();};
    var pr=document.getElementById('drPrint'); if(pr)pr.onclick=function(){printDailyReport(d,X);};
    var ex=document.getElementById('drExcel'); if(ex)ex.onclick=function(){exportDailyXlsx(d,X);};
    root.querySelectorAll('[data-dr-target]').forEach(function(button){button.onclick=function(){var target=document.getElementById(this.getAttribute('data-dr-target'));if(!target)return;root.querySelectorAll('.dr-detail-card.focused').forEach(function(card){card.classList.remove('focused');});target.classList.add('focused');target.scrollIntoView({behavior:'smooth',block:'center'});setTimeout(function(){target.classList.remove('focused');},1800);};});
  }
}
function printDailyReport(d,X){
  var w=window.open('','_blank','width=440,height=760');if(!w){alert('Allow pop-ups to print the report.');return;}
  var ch=['instore','grabfood','foodpanda','online'].map(function(c){var x=X.chan[c];if(!x.tx)return '';return '<tr><td>'+x.lbl+' ('+x.tx+')</td><td style="text-align:right;">'+peso(x.net)+'</td></tr>';}).join('');
  var me=Object.keys(X.byMethod).sort().map(function(m){return '<tr><td>'+esc(m)+'</td><td style="text-align:right;">'+peso(X.byMethod[m])+'</td></tr>';}).join('');
  var ex=X.payouts.map(function(p){return '<tr><td>'+esc(p.time)+' '+esc(p.reason)+'</td><td style="text-align:right;">'+peso(p.amount)+'</td></tr>';}).join('')+(X.refundsTot?'<tr><td>Refunds</td><td style="text-align:right;">'+peso(X.refundsTot)+'</td></tr>':'');
  var it=X.items.map(function(x){return '<tr><td>'+esc(x.name)+' ×'+drNum(x.qty)+'</td><td style="text-align:right;">'+peso(x.sales)+'</td></tr>';}).join('');
  var shf=(X.shiftRows||[]).map(function(s){return '<tr><td>'+esc(s.staff)+(s.open?' (open)':'')+' ×'+s.tx+'</td><td style="text-align:right;">'+peso(s.net)+(s.cashToSettle!=null?(' · settle '+peso(s.cashToSettle)):'')+'</td></tr>';}).join('');
  var methodTotal=Object.keys(X.byMethod).reduce(function(sum,k){return sum+(Number(X.byMethod[k])||0);},0),itemQty=X.items.reduce(function(sum,x){return sum+(Number(x.qty)||0);},0),itemSales=X.items.reduce(function(sum,x){return sum+(Number(x.sales)||0);},0),shiftNet=(X.shiftRows||[]).reduce(function(sum,x){return sum+(Number(x.net)||0);},0),txnTotal=X.txns.reduce(function(sum,x){return sum+(Number(x.amount)||0);},0);
  w.document.write('<html><head><title>Daily Report '+esc(d)+'</title><style>*{font-family:monospace;font-size:12px;color:#000;}body{padding:10px;}h2,h3{text-align:center;margin:2px 0;}table{width:100%;border-collapse:collapse;}td{padding:2px 0;}hr{border:none;border-top:1px dashed #000;}@media print{button{display:none;}}</style></head><body>'
    +'<h2>Accaza Coffee House</h2><h3>DAILY REPORT</h3><div style="text-align:center;">Trading day '+esc(d)+'</div><hr>'
    +'<div><b>Shifts this day</b></div><table>'+(shf||'<tr><td>None</td></tr>')+'<tr><td><b>Total shift net</b></td><td style="text-align:right;"><b>'+peso(shiftNet)+'</b></td></tr></table><hr>'
    +'<div><b>Net sales by channel</b></div><table>'+(ch||'<tr><td>None</td></tr>')+'<tr><td><b>Total net</b></td><td style="text-align:right;"><b>'+peso(X.netTot)+'</b></td></tr></table><hr>'
    +'<div><b>By payment method</b></div><table>'+(me||'<tr><td>None</td></tr>')+'<tr><td><b>Total received</b></td><td style="text-align:right;"><b>'+peso(methodTotal)+'</b></td></tr></table><hr>'
    +'<div><b>Register expenses (cash out)</b></div><table>'+(ex||'<tr><td>None</td></tr>')+'<tr><td><b>Total out</b></td><td style="text-align:right;"><b>'+peso(X.payoutTot+X.refundsTot)+'</b></td></tr></table><hr>'
    +'<div><b>Items sold</b></div><table>'+(it||'<tr><td>None</td></tr>')+'<tr><td><b>Total items ×'+drNum(itemQty)+'</b></td><td style="text-align:right;"><b>'+peso(itemSales)+'</b></td></tr></table><hr>'
    +'<div><b>All transactions</b></div><table><tr><td><b>Total ('+X.txns.length+')</b></td><td style="text-align:right;"><b>'+peso(txnTotal)+'</b></td></tr></table><hr>'
    +'<div style="font-size:9px;text-align:center;">Management report — includes in-store &amp; platform channels; register cash-out = drawer pay-outs + refunds.</div>'
    +'<div style="text-align:center;margin-top:8px;"><button onclick="window.print()">Print</button></div></body></html>');
  w.document.close();
}
function exportDailyXlsx(d,X){
  if(!window.XLSX){alert('Excel library still loading — try again.');return;}
  var ch=[['Channel','Tx','Gross','Discount','Commission','Net']];['instore','grabfood','foodpanda','online'].forEach(function(c){var x=X.chan[c];ch.push([x.lbl,x.tx,x.gross,x.disc,x.comm,x.net]);});
  var me=[['Method','Amount']];Object.keys(X.byMethod).sort().forEach(function(m){me.push([m,X.byMethod[m]]);});
  var it=[['Item','Qty','Sales']];X.items.forEach(function(x){it.push([x.name,x.qty,x.sales]);});
  var tx=[['Time','Order','Channel','Method','Amount','Refund']];X.txns.forEach(function(t){tx.push([t.time,t.id,t.channel,t.method,t.amount,t.refund]);});
  var ex=[['Time','Reason','Amount']];X.payouts.forEach(function(p){ex.push([p.time,p.reason,p.amount]);});if(X.refundsTot)ex.push(['','Refunds',X.refundsTot]);
  var sf=[['Cashier','Open','Close','Status','Tx','Net','Cash sales','Cash to settle']];(X.shiftRows||[]).forEach(function(s){sf.push([s.staff,s.openAt?new Date(s.openAt).toLocaleString('en-PH'):'',s.closeAt?new Date(s.closeAt).toLocaleString('en-PH'):'',s.open?'open':'closed',s.tx,s.net,s.cash,(s.cashToSettle!=null?s.cashToSettle:'')]);});
  ch.push(['TOTAL',ch.slice(1).reduce(function(s,r){return s+(Number(r[1])||0);},0),ch.slice(1).reduce(function(s,r){return s+(Number(r[2])||0);},0),ch.slice(1).reduce(function(s,r){return s+(Number(r[3])||0);},0),ch.slice(1).reduce(function(s,r){return s+(Number(r[4])||0);},0),X.netTot]);
  me.push(['TOTAL',Object.keys(X.byMethod).reduce(function(s,k){return s+(Number(X.byMethod[k])||0);},0)]);it.push(['TOTAL',X.items.reduce(function(s,x){return s+(Number(x.qty)||0);},0),X.items.reduce(function(s,x){return s+(Number(x.sales)||0);},0)]);tx.push(['TOTAL','','','',X.txns.reduce(function(s,x){return s+(Number(x.amount)||0);},0),X.refundsTot]);ex.push(['TOTAL','',X.payoutTot+X.refundsTot]);sf.push(['TOTAL','','','',sf.slice(1).reduce(function(s,r){return s+(Number(r[4])||0);},0),sf.slice(1).reduce(function(s,r){return s+(Number(r[5])||0);},0),sf.slice(1).reduce(function(s,r){return s+(Number(r[6])||0);},0),sf.slice(1).reduce(function(s,r){return s+(Number(r[7])||0);},0)]);
  var wb=XLSX.utils.book_new();[['Shifts',sf],['Channels',ch],['Methods',me],['Items',it],['Transactions',tx],['Expenses',ex]].forEach(function(p){XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(p[1]),p[0]);});XLSX.writeFile(wb,'daily-report-'+d+'.xlsx');
}
function pnlFor(mk){
  var sales=allOrders().filter(isSale).map(saleFields).filter(function(s){return monthKey(s.ts)===mk;});
  var revenue=sales.reduce(function(s,x){return s+x.net;},0);
  var revenueByChannel={instore:0,grabfood:0,foodpanda:0,online:0},customerDiscounts=0;
  sales.forEach(function(x){var ch=drChannel(x.o);revenueByChannel[ch]+=(x.gross-x.refund);customerDiscounts+=x.discount;});
  var cogs=0,uncovered=0,cogsByCategory=emptyCogsCategories();sales.forEach(function(x){if(x.lineItems){var r=orderCOGS(x.o);cogs+=r.cost;if(!r.covered)uncovered++;var cg=orderCogsCategories(x.o);Object.keys(cogsByCategory).forEach(function(k){cogsByCategory[k]+=Number(cg[k])||0;});}else uncovered++;});
  var categorizedCogs=Object.keys(cogsByCategory).reduce(function(sum,k){return sum+cogsByCategory[k];},0);var cogsCategoryGap=Math.round((cogs-categorizedCogs)*100)/100;if(cogsCategoryGap)cogsByCategory.unallocated+=cogsCategoryGap;
  var variance=0;Object.keys(adjMap).forEach(function(k){var adj=adjMap[k];if(adj&&monthKey(adj.ts)===mk)variance+=Number(adj.varianceValue)||0;});
  var usageByType={},totalUsage=0;Object.keys(usageMap).forEach(function(k){var u=usageMap[k];if(!u||u.reversed||monthKey(u.ts)!==mk)return;var t=u.kind||'staff';var c=Number(u.cost)||0;usageByType[t]=(usageByType[t]||0)+c;totalUsage+=c;});
  var totalCogs=cogs+variance;
  var gp=revenue-totalCogs;
  var m=monthlyExp[mk]||{};var amounts=m.amounts||{};
  var byItem={},opex=0;
  Object.keys(expItems).forEach(function(id){var amt=Number(amounts[id])||0;byItem[id]={name:expItems[id].name,amount:amt};opex+=amt;});
  var expenseGroups=pnlExpenseGroups(byItem);
  // platform economics
  var platformCommission=0,platformGross=0,platformWht=0,platformVat=0,platformByChannel={grabfood:0,foodpanda:0};
  sales.forEach(function(x){var o=x.o;if(o&&o.channel&&o.channel!=='instore'){var charge=(Number(o.commission)||0)+(Number(o.platformVat)||0);platformCommission+=Number(o.commission)||0;platformGross+=Number(o.grossPlatform||o.subtotal||o.total)||0;platformWht+=Number(o.platformWht)||0;platformVat+=Number(o.platformVat)||0;if(platformByChannel[o.channel]!=null)platformByChannel[o.channel]+=charge;}});
  var reconExp=0,reconRev=0,reconBy={};
  Object.keys(payoutsMap).forEach(function(k){var p=payoutsMap[k];if(!p)return;if(monthKey(p.settledAt||p.periodEnd||0)!==mk)return;var allocs=p.allocations||{};Object.keys(allocs).forEach(function(aid){var amt=Number(allocs[aid])||0;if(!amt)return;var acct=varAcctMap[aid]||(DEFAULT_VAR_ACCOUNTS.filter(function(d){return d.id===aid;})[0])||{};reconBy[aid]=(reconBy[aid]||0)+amt;if(acct.type==='revenue')reconRev+=amt;else reconExp+=amt;});});
  var tips=0;sales.forEach(function(x){tips+=Number(x.o&&x.o.tipRounding)||0;});
  // CWT withheld by a platform is a tax credit/receivable, not a P&L expense.
  // Platform VAT remains with selling costs here unless it is reclassified to recoverable input VAT in the books of record.
  var platformCosts=platformCommission+platformVat+reconExp;
  var otherExpenseTotal=expenseGroups.other.interest+expenseGroups.other.bank+expenseGroups.other.other;
  var operatingExpenseTotal=opex-otherExpenseTotal-expenseGroups.tax+totalUsage;
  var operatingProfit=gp-platformCosts-operatingExpenseTotal;
  var otherIncome=tips+reconRev,otherNet=otherIncome-otherExpenseTotal;
  var profitBeforeTax=operatingProfit+otherNet;
  var net=profitBeforeTax-expenseGroups.tax;
  return{revenue:revenue,revenueByChannel:revenueByChannel,customerDiscounts:customerDiscounts,cogs:cogs,cogsByCategory:cogsByCategory,variance:variance,totalCogs:totalCogs,gp:gp,margin:revenue>0?gp/revenue*100:0,byItem:byItem,expenseGroups:expenseGroups,opex:opex,usageByType:usageByType,totalUsage:totalUsage,platformCommission:platformCommission,platformByChannel:platformByChannel,platformGross:platformGross,platformWht:platformWht,platformVat:platformVat,platformCosts:platformCosts,operatingExpenseTotal:operatingExpenseTotal,operatingProfit:operatingProfit,otherIncome:otherIncome,otherExpenseTotal:otherExpenseTotal,otherNet:otherNet,profitBeforeTax:profitBeforeTax,reconExp:reconExp,reconRev:reconRev,reconBy:reconBy,tips:tips,net:net,uncovered:uncovered,tx:sales.length,locked:!!m.locked};
}
function itemIdsSorted(){return Object.keys(expItems).sort(function(a,b){return((expItems[a].order||0)-(expItems[b].order||0))||(expItems[a].name||'').localeCompare(expItems[b].name||'');});}
function varianceDetailHtml(mk){
  function fq(n){n=Number(n)||0;return (Math.round(n*1000)/1000).toLocaleString('en-PH');}
  var list=Object.keys(adjMap).map(function(k){return adjMap[k];}).filter(function(x){return x&&monthKey(x.ts)===mk;}).sort(function(a,b){return (b.ts||0)-(a.ts||0);});
  if(!list.length)return '<div style="padding:0.6rem 0.9rem;color:var(--tl);font-size:0.8rem;">No stock adjustments recorded this month.</div>';
  var rows=list.map(function(x){var d=new Date(x.ts);var dl=d.toLocaleDateString('en-PH',{month:'short',day:'numeric'});return '<tr><td style="padding:0.25rem 0.5rem;">'+dl+'</td><td style="padding:0.25rem 0.5rem;">'+esc(x.name||'')+'</td><td style="padding:0.25rem 0.5rem;text-align:right;">'+((Number(x.delta)||0)>0?'+':'')+fq(x.delta)+' '+esc(x.unit||'')+'</td><td style="padding:0.25rem 0.5rem;">'+esc(x.reason||'')+'</td><td style="padding:0.25rem 0.5rem;text-align:right;font-weight:600;">'+peso(x.varianceValue)+'</td></tr>';}).join('');
  return '<div style="background:#faf7f2;padding:0.4rem 0.6rem;"><table style="width:100%;border-collapse:collapse;font-size:0.76rem;"><thead><tr style="color:var(--tl);text-align:left;"><th style="padding:0.25rem 0.5rem;">Date</th><th style="padding:0.25rem 0.5rem;">Item</th><th style="padding:0.25rem 0.5rem;text-align:right;">Qty Δ</th><th style="padding:0.25rem 0.5rem;">Reason</th><th style="padding:0.25rem 0.5rem;text-align:right;">COGS impact</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
}