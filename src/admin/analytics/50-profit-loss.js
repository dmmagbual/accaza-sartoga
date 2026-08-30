
function renderPnl(){
  var root=document.getElementById('pnlRoot');if(!root)return;
  if(!pnlMonth)pnlMonth=monthKey(Date.now());
  var cur=pnlFor(pnlMonth), pmk=prevMonthKey(pnlMonth), prev=pnlFor(pmk);
  var locked=cur.locked, ids=itemIdsSorted();
  function vrow(label,c,p,bold){var dv=c-p;var dp=p!==0?dv/Math.abs(p)*100:(c!==0?100:0);return '<tr'+(bold?' class="tot"':'')+'><td>'+esc(label)+'</td><td class="r">'+peso(c)+'</td><td class="r">'+peso(p)+'</td><td class="r '+(dv>0?'az-up':dv<0?'az-down':'az-flat')+'">'+(p!==0||c!==0?pct(dp):'\u2014')+'</td></tr>';}
  function reconClass(x,kind){var t=0;varAccounts().forEach(function(ac){if(ac.type==='revenue')return;var isKind=kind==='ads'?/advert|marketing|promo/i.test(ac.name||''):kind==='delivery'?/deliver|logistic|rider/i.test(ac.name||''):(!/advert|marketing|promo|deliver|logistic|rider/i.test(ac.name||''));if(isKind)t+=Number((x.reconBy||{})[ac.id])||0;});return t;}
  function opexRows(c,p){var out='';PNL_OPEX_LINES.forEach(function(x){out+=vrow(x.label,-(c.expenseGroups.operating[x.id]||0),-(p.expenseGroups.operating[x.id]||0));});var co=(c.expenseGroups.operating.other||0)+c.totalUsage,po=(p.expenseGroups.operating.other||0)+p.totalUsage;out+=vrow('Other identified operating expenses',-co,-po);return out;}
  var html='<div class="pz-h">\ud83d\udcb0 Profit &amp; Loss</div><p class="pz-sub">Management P&amp;L. Revenue = net sales \u00b7 COGS from recipe costs \u00b7 platform selling costs shown separately from operating overhead. Netsuite/Xero remain the books of record.</p>';
  html+='<div style="margin-bottom:1rem;display:flex;align-items:center;gap:0.6rem;flex-wrap:wrap;"><span class="pz-lbl" style="margin:0;">Month</span><input type="month" class="pz-in" id="pnlMonth" value="'+pnlMonth+'" style="width:auto;"/>'+(locked?'<span style="font-size:0.75rem;color:#2a9d5c;font-weight:600;">\ud83d\udd12 Saved</span>':'<span style="font-size:0.75rem;color:#e67e00;font-weight:600;">\u270f\ufe0f Draft \u2014 not saved</span>')+'<button class="pz-btn sec" id="pnlExport" style="padding:0.35rem 0.8rem;margin-left:auto;">\u2b07 Export CSV</button></div>';
  html+='<div class="pz-card" style="margin-bottom:1.2rem;"><table class="pnl-tbl"><thead><tr><th>'+esc(monthLabel(pnlMonth))+'</th><th>This month</th><th>'+esc(monthLabel(pmk))+'</th><th>Var</th></tr></thead><tbody>'
    +'<tr class="head"><td>Revenue</td><td></td><td></td><td></td></tr>'
    +vrow('In-store sales',cur.revenueByChannel.instore,prev.revenueByChannel.instore)
    +vrow('Online orders — Grab',cur.revenueByChannel.grabfood,prev.revenueByChannel.grabfood)
    +vrow('Online orders — Foodpanda',cur.revenueByChannel.foodpanda,prev.revenueByChannel.foodpanda)
    +vrow('Other online orders',cur.revenueByChannel.online,prev.revenueByChannel.online)
    +vrow('Less: Restaurant-funded customer discounts',-cur.customerDiscounts,-prev.customerDiscounts)
    +vrow('Total net revenue',cur.revenue,prev.revenue,true)
    +'<tr class="head"><td>Cost of sales</td><td></td><td></td><td></td></tr>'
    +vrow('Food ingredients',-cur.cogsByCategory.food,-prev.cogsByCategory.food)
    +vrow('Beverage ingredients',-cur.cogsByCategory.beverage,-prev.cogsByCategory.beverage)
    +vrow('Packaging',-cur.cogsByCategory.packaging,-prev.cogsByCategory.packaging)
    +vrow('Direct kitchen labor, if applicable',-cur.cogsByCategory.directLabor,-prev.cogsByCategory.directLabor)
    +vrow('Unallocated recipe costs',-cur.cogsByCategory.unallocated,-prev.cogsByCategory.unallocated)
    +'<tr><td>Consumption variance <button class="pz-btn sec" id="pnlVarBtn" style="padding:0.05rem 0.5rem;font-size:0.72rem;margin-left:0.4rem;">details</button></td><td class="r">'+peso(-cur.variance)+'</td><td class="r">'+peso(-prev.variance)+'</td><td class="r">'+((cur.variance!==0||prev.variance!==0)?pct(prev.variance!==0?((cur.variance-prev.variance)/Math.abs(prev.variance)*100):(cur.variance!==0?100:0)):'—')+'</td></tr>'
    +'<tr id="pnlVarDetail" style="display:none;"><td colspan="4" style="padding:0;">'+varianceDetailHtml(pnlMonth)+'</td></tr>'
    +vrow('Total cost of sales',-cur.totalCogs,-prev.totalCogs,true)
    +vrow('Gross profit',cur.gp,prev.gp,true)
    +'<tr><td style="color:var(--tl);font-size:0.78rem;">Gross margin</td><td class="r" style="color:var(--tl);">'+(Math.round(cur.margin*10)/10)+'%</td><td class="r" style="color:var(--tl);">'+(Math.round(prev.margin*10)/10)+'%</td><td></td></tr>'
    +'<tr class="head"><td>Selling and platform expenses</td><td></td><td></td><td></td></tr>'
    +vrow('Grab commission, including non-recoverable VAT',-cur.platformByChannel.grabfood,-prev.platformByChannel.grabfood)
    +vrow('Foodpanda commission, including non-recoverable VAT',-cur.platformByChannel.foodpanda,-prev.platformByChannel.foodpanda)
    +vrow('Platform advertising and promotions',-reconClass(cur,'ads'),-reconClass(prev,'ads'))
    +vrow('Delivery charges absorbed by the restaurant',-reconClass(cur,'delivery'),-reconClass(prev,'delivery'))
    +((reconClass(cur,'other')||reconClass(prev,'other'))?vrow('Other platform expenses',-reconClass(cur,'other'),-reconClass(prev,'other')):'')
    +vrow('Total selling and platform expenses',-cur.platformCosts,-prev.platformCosts,true)
    +'<tr class="head"><td>Operating expenses</td><td></td><td></td><td></td></tr>'
    +opexRows(cur,prev)
    +vrow('Total operating expenses',-cur.operatingExpenseTotal,-prev.operatingExpenseTotal,true)
    +vrow('Operating profit',cur.operatingProfit,prev.operatingProfit,true)
    +'<tr class="head"><td>Other income / expenses</td><td></td><td></td><td></td></tr>'
    +vrow('Interest expense',-cur.expenseGroups.other.interest,-prev.expenseGroups.other.interest)
    +vrow('Bank charges',-cur.expenseGroups.other.bank,-prev.expenseGroups.other.bank)
    +vrow('Other income',cur.otherIncome,prev.otherIncome)
    +((cur.expenseGroups.other.other||prev.expenseGroups.other.other)?vrow('Other expenses',-cur.expenseGroups.other.other,-prev.expenseGroups.other.other):'')
    +vrow('Total other income / expenses',cur.otherNet,prev.otherNet,true)
    +vrow('Profit before tax',cur.profitBeforeTax,prev.profitBeforeTax,true)
    +vrow('Income-tax expense',-cur.expenseGroups.tax,-prev.expenseGroups.tax)
    +vrow('Net profit',cur.net,prev.net,true)
    +((cur.platformWht||prev.platformWht)?vrow('Memo: creditable withholding tax (not an expense)',cur.platformWht,prev.platformWht):'')
    +'</tbody></table>'
    +((cur.platformGross||0)>0?'<p class="az-note" style="margin-top:0.5rem;">Revenue includes '+peso(cur.platformGross)+' platform gross (Grab/Panda). Commission and platform-service VAT are shown as selling expenses. Creditable withholding tax is excluded from profit and shown as a memo tax credit; confirm recoverability from the platform statement/BIR Form 2307. If the business claims input VAT, reclassify qualifying platform VAT to input VAT in the books of record.</p>':'')
    +(cur.uncovered>0?'<p class="az-note" style="margin-top:0.5rem;">\u26a0\ufe0f '+cur.uncovered+' sale(s) this month have items without a costed recipe \u2014 COGS is understated for those.</p>':'')
    +'</div>';
  html+='<div class="az-sec">Overhead expenses \u2014 '+esc(monthLabel(pnlMonth))+(locked?' <span style="color:#2a9d5c;font-size:0.8rem;">(saved)</span>':'')+'</div>';
  html+='<div class="pz-card"><table class="pz-tbl"><thead><tr><th>Expense item</th><th style="width:170px;">Amount \u20b1</th><th></th></tr></thead><tbody>'
    +(ids.length?ids.map(function(id){var amt=(cur.byItem[id]&&cur.byItem[id].amount)||0;return '<tr><td>'+esc(expItems[id].name)+'</td><td><input class="pz-in" type="number" step="any" data-amt="'+id+'" value="'+(amt||'')+'"'+(locked?' disabled':'')+' style="text-align:right;"/></td><td><button class="pz-btn warn" style="padding:0.2rem 0.5rem;" data-itemdel="'+id+'"'+(locked?' disabled':'')+'>\u2715</button></td></tr>';}).join(''):'<tr><td colspan="3" class="az-note" style="padding:0.8rem;">No expense items yet. Add your overhead items below (e.g. Rent, Electricity, Salaries).</td></tr>')
    +'<tr class="tot"><td>Total overhead</td><td class="r" id="ovTotal">'+peso(cur.opex)+'</td><td></td></tr>'
    +'</tbody></table>'
    +'<div style="margin-top:0.7rem;display:flex;gap:0.5rem;align-items:end;flex-wrap:wrap;">'
    +'<div><span class="pz-lbl">Add expense item</span><input class="pz-in" id="pnlExpName" placeholder="e.g. Electricity" style="width:200px;"/></div><button class="pz-btn sec" id="addItemBtn">+ Add item</button>'
    +'<div style="margin-left:auto;">'+(locked?'<button class="pz-btn" id="reopenBtn">\ud83d\udd13 Re-open to amend</button>':'<button class="pz-btn ok" id="saveBtn">\ud83d\udcbe Save month</button>')+'</div>'
    +'</div></div>';
  root.innerHTML=html;
  var _vb=document.getElementById('pnlVarBtn'); if(_vb)_vb.onclick=function(){var d=document.getElementById('pnlVarDetail'); if(d)d.style.display=(d.style.display==='none'?'table-row':'none');};
  document.getElementById('pnlMonth').onchange=function(){pnlMonth=this.value;renderPnl();};
  document.getElementById('pnlExport').onclick=function(){exportPnl(cur,prev,pmk,ids);};
  function recalcTotal(){var t=0;root.querySelectorAll('[data-amt]').forEach(function(i){t+=Number(i.value)||0;});var el=document.getElementById('ovTotal');if(el)el.textContent=peso(t);}
  root.querySelectorAll('[data-amt]').forEach(function(i){i.oninput=recalcTotal;});
  var addB=document.getElementById('addItemBtn');if(addB)addB.onclick=function(){var nm=(document.getElementById('pnlExpName').value||'').trim();if(!nm){alert('Type an item name first.');return;}var a=A();a.set(a.ref(a.db,'expenseItems/'+uid('ei_')),{name:nm,order:Object.keys(expItems).length,ts:Date.now()}).then(function(){document.getElementById('pnlExpName').value='';}).catch(function(e){alert('Could not add item: '+((e&&e.code)||e)+'. If PERMISSION_DENIED: re-publish the database rules and log in with your EMAIL, not the old username.');});};
  var saveB=document.getElementById('saveBtn');if(saveB)saveB.onclick=function(){var amounts={};root.querySelectorAll('[data-amt]').forEach(function(i){amounts[i.getAttribute('data-amt')]=Number(i.value)||0;});var a=A();a.set(a.ref(a.db,'monthlyExpenses/'+pnlMonth),{locked:true,amounts:amounts,savedAt:Date.now()}).then(function(){renderPnl();}).catch(function(e){alert('Could not save: '+((e&&e.code)||e)+'. If PERMISSION_DENIED: re-publish the database rules and log in with your EMAIL.');});};
  var reB=document.getElementById('reopenBtn');if(reB)reB.onclick=function(){if(!confirm('Re-open '+monthLabel(pnlMonth)+' to amend the figures?'))return;var a=A();a.update(a.ref(a.db,'monthlyExpenses/'+pnlMonth),{locked:false}).then(function(){renderPnl();});};
  root.querySelectorAll('[data-itemdel]').forEach(function(b){b.onclick=function(){var id=b.getAttribute('data-itemdel');if(!confirm('Remove "'+(expItems[id]?expItems[id].name:'')+'" from the item list? It is removed from every month.'))return;var a=A();a.remove(a.ref(a.db,'expenseItems/'+id));};});
}
function exportPnl(cur,prev,pmk,ids){
  var rows=[['Accaza Profit & Loss',monthLabel(pnlMonth)],[''],['Line','This month','Last month ('+monthLabel(pmk)+')']];
  function er(label,c,p){rows.push([label,(Number(c)||0).toFixed(2),(Number(p)||0).toFixed(2)]);}
  function rc(x,kind){var t=0;varAccounts().forEach(function(ac){if(ac.type==='revenue')return;var hit=kind==='ads'?/advert|marketing|promo/i.test(ac.name||''):kind==='delivery'?/deliver|logistic|rider/i.test(ac.name||''):(!/advert|marketing|promo|deliver|logistic|rider/i.test(ac.name||''));if(hit)t+=Number((x.reconBy||{})[ac.id])||0;});return t;}
  rows.push(['REVENUE','','']);er('  In-store sales',cur.revenueByChannel.instore,prev.revenueByChannel.instore);er('  Online orders – Grab',cur.revenueByChannel.grabfood,prev.revenueByChannel.grabfood);er('  Online orders – Foodpanda',cur.revenueByChannel.foodpanda,prev.revenueByChannel.foodpanda);er('  Other online orders',cur.revenueByChannel.online,prev.revenueByChannel.online);er('  Less: Restaurant-funded customer discounts',-cur.customerDiscounts,-prev.customerDiscounts);er('TOTAL NET REVENUE',cur.revenue,prev.revenue);
  rows.push(['COST OF SALES','','']);er('  Food ingredients',-cur.cogsByCategory.food,-prev.cogsByCategory.food);er('  Beverage ingredients',-cur.cogsByCategory.beverage,-prev.cogsByCategory.beverage);er('  Packaging',-cur.cogsByCategory.packaging,-prev.cogsByCategory.packaging);er('  Direct kitchen labor, if applicable',-cur.cogsByCategory.directLabor,-prev.cogsByCategory.directLabor);er('  Unallocated recipe costs',-cur.cogsByCategory.unallocated,-prev.cogsByCategory.unallocated);er('  Consumption variance',-cur.variance,-prev.variance);er('TOTAL COST OF SALES',-cur.totalCogs,-prev.totalCogs);er('GROSS PROFIT',cur.gp,prev.gp);
  rows.push(['SELLING AND PLATFORM EXPENSES','','']);er('  Grab commission, including non-recoverable VAT',-cur.platformByChannel.grabfood,-prev.platformByChannel.grabfood);er('  Foodpanda commission, including non-recoverable VAT',-cur.platformByChannel.foodpanda,-prev.platformByChannel.foodpanda);er('  Platform advertising and promotions',-rc(cur,'ads'),-rc(prev,'ads'));er('  Delivery charges absorbed by the restaurant',-rc(cur,'delivery'),-rc(prev,'delivery'));if(rc(cur,'other')||rc(prev,'other'))er('  Other platform expenses',-rc(cur,'other'),-rc(prev,'other'));er('TOTAL SELLING AND PLATFORM EXPENSES',-cur.platformCosts,-prev.platformCosts);
  rows.push(['OPERATING EXPENSES','','']);PNL_OPEX_LINES.forEach(function(x){er('  '+x.label,-cur.expenseGroups.operating[x.id],-prev.expenseGroups.operating[x.id]);});er('  Other identified operating expenses',-(cur.expenseGroups.operating.other+cur.totalUsage),-(prev.expenseGroups.operating.other+prev.totalUsage));er('TOTAL OPERATING EXPENSES',-cur.operatingExpenseTotal,-prev.operatingExpenseTotal);er('OPERATING PROFIT',cur.operatingProfit,prev.operatingProfit);
  rows.push(['OTHER INCOME / EXPENSES','','']);er('  Interest expense',-cur.expenseGroups.other.interest,-prev.expenseGroups.other.interest);er('  Bank charges',-cur.expenseGroups.other.bank,-prev.expenseGroups.other.bank);er('  Other income',cur.otherIncome,prev.otherIncome);if(cur.expenseGroups.other.other||prev.expenseGroups.other.other)er('  Other expenses',-cur.expenseGroups.other.other,-prev.expenseGroups.other.other);er('TOTAL OTHER INCOME / EXPENSES',cur.otherNet,prev.otherNet);er('PROFIT BEFORE TAX',cur.profitBeforeTax,prev.profitBeforeTax);er('  Income-tax expense',-cur.expenseGroups.tax,-prev.expenseGroups.tax);
  rows.push(['Net profit',cur.net.toFixed(2),prev.net.toFixed(2)]);
  rows.push(['Memo: creditable withholding tax (not an expense)',cur.platformWht.toFixed(2),prev.platformWht.toFixed(2)]);
  var csv=rows.map(function(r){return r.map(function(c){return '"'+String(c).replace(/"/g,'""')+'"';}).join(',');}).join('\n');
  var blob=new Blob([csv],{type:'text/csv'});var url=URL.createObjectURL(blob);var a=document.createElement('a');a.href=url;a.download='accaza-pnl-'+pnlMonth+'.csv';a.click();URL.revokeObjectURL(url);
}