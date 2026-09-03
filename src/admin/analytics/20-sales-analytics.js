
/* ══════════ ANALYTICS ══════════ */
function renderAnalytics(){
  var root=document.getElementById('analyticsRoot'); if(!root)return;
  if(window.AccazaAdminPeriods)window.AccazaAdminPeriods.bind({scope:'sales',fromId:'analyticsPeriodFrom',toId:'analyticsPeriodTo',monthId:'analyticsPeriodMonth',applyId:'analyticsPeriodApply',labelId:'analyticsPeriodLabel'});
  sharedPeriod();
  try{ ensureAnalyticsHistory();if(analyticsHistoryLoading){root.innerHTML='<div class="az-note">Loading the selected sales period and comparison period… If loading fails, press Apply to retry.</div>';return;}renderAnalyticsBody(); }
  catch(err){ console.error('renderAnalytics error',err);
    root.innerHTML='<div class="pz-h">📊 Analytics</div><div style="background:#fde8e8;border:1px solid #f5b5b5;border-radius:8px;padding:1rem;color:#a11;font-size:0.85rem;">Analytics couldn’t finish building the shared-period report: <b>'+esc(String((err&&err.message)||err))+'</b>.</div>'; }
}
window.addEventListener('accaza-admin-period',function(e){if(!e.detail||e.detail.scope!=='sales')return;var root=document.getElementById('analyticsRoot');if(root&&root.offsetParent!==null)renderAnalytics();});
function renderAnalyticsBody(){
  var root=document.getElementById('analyticsRoot');if(!root)return;
  var b=rangeBounds(),from=b[0],to=b[1];var span=to-from;
  var cur=salesBetween(from,to), prev=salesBetween(from-span,from);
  var net=cur.reduce(function(s,x){return s+x.net;},0), gross=cur.reduce(function(s,x){return s+x.gross;},0);
  var pnet=prev.reduce(function(s,x){return s+x.net;},0);
  var tx=cur.length, days=Math.max(1,Math.round(span/86400000));
  var aov=tx?net/tx:0;
  var cogsAll=cur.reduce(function(s,x){return s+(x.lineItems?orderCOGS(x.o).cost:0);},0);
  var margin=net>0?(net-cogsAll)/net*100:0;
  var trend=pnet>0?(net-pnet)/pnet*100:(net>0?100:0);
  // daily series
  var byDay={};cur.forEach(function(x){var k=businessDate(x.ts);byDay[k]=(byDay[k]||0)+x.net;});
  // All-time reporting lists only days that actually had sales. Rendering every
  // empty calendar day would create a long misleading zero-sales report.
  var dayKeys=azRange==='all'?Object.keys(byDay).sort():dateKeys(from,to);
  var maxDay=Math.max.apply(null,dayKeys.map(function(k){return byDay[k]||0;}).concat([1]));
  var hi=null,lo=null;dayKeys.forEach(function(k){var v=byDay[k]||0;if(hi===null||v>byDay[hi])hi=k;if(lo===null||v<byDay[lo])lo=k;});
  // hour
  var byHour={};cur.forEach(function(x){var h=new Date(x.ts+8*3600000).getUTCHours();byHour[h]=(byHour[h]||0)+x.net;});
  var maxHour=Math.max.apply(null,Object.keys(byHour).map(function(h){return byHour[h];}).concat([1]));
  // dow
  var dowN=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'],byDow={};cur.forEach(function(x){var d=new Date(x.ts+8*3600000).getUTCDay();byDow[d]=(byDow[d]||0)+x.net;});
  var maxDow=Math.max.apply(null,Object.keys(byDow).map(function(d){return byDow[d];}).concat([1]));
  // category / payment / type / items
  var byCat={},byPay={},byType={},items={};var totItems=0;
  cur.forEach(function(x){
    byPay[x.payment]=(byPay[x.payment]||0)+x.net;
    byType[x.type]=(byType[x.type]||0)+x.net;
    var itemFactor=x.gross>0?Math.max(0,x.net/x.gross):0;(x.lineItems||[]).forEach(function(li){
      var mi=A().menuItemsMap[li.itemKey];var cat=mi?(A().getCatLabel?A().getCatLabel(mi.cat):mi.cat):'Other';
      byCat[cat]=(byCat[cat]||0)+li.qty*li.unitTotal;
      totItems+=li.qty;
      var _ct=(window.__posSettings&&window.__posSettings.catType)||{}; if(!window.AccazaSales.isDrinkLine(li,{menuItems:A().menuItemsMap,catType:_ct}))return; /* Top items = drinks only, using the same shared test Home Overview uses. Add-ons are options (optLabels), never line items, so already excluded. */
      var key=window.AccazaSales.drinkKey(li);if(!key)return;items[key]=items[key]||{key:key,name:window.AccazaSales.drinkLabel(li,A().menuItemsMap)||li.name||key,units:0,rev:0,cost:0};
      items[key].units+=li.qty;items[key].rev+=li.qty*li.unitTotal*itemFactor;var c=itemCost(li);if(c!=null)items[key].cost+=c;
    });
  });
  // prev-period item units for trend
  var pItems={};prev.forEach(function(x){(x.lineItems||[]).forEach(function(li){var ct=(window.__posSettings&&window.__posSettings.catType)||{};if(!window.AccazaSales.isDrinkLine(li,{menuItems:A().menuItemsMap,catType:ct}))return;var pk=window.AccazaSales.drinkKey(li);if(!pk)return;pItems[pk]=(pItems[pk]||0)+li.qty;});});
  var itemArr=Object.values(items);
  var topByRev=itemArr.slice().sort(function(a,b){return b.rev-a.rev;});
  var topByProfit=itemArr.slice().filter(function(i){return i.cost>0;}).map(function(i){return Object.assign({profit:i.rev-i.cost,margin:i.rev>0?(i.rev-i.cost)/i.rev*100:0},i);}).sort(function(a,b){return b.profit-a.profit;});
  var maxRev=Math.max.apply(null,topByRev.map(function(i){return i.rev;}).concat([1]));
  // customers
  var custIn={};cur.forEach(function(x){if(x.phone)custIn[x.phone]=(custIn[x.phone]||0)+x.net;});
  var pCustIn={};prev.forEach(function(x){if(x.phone)pCustIn[x.phone]=1;});
  var custCount=Object.keys(custIn).length;
  var newC=0;Object.keys(custIn).forEach(function(ph){var c=custMap[ph];if(c&&c.firstSeen&&c.firstSeen>=from)newC++;else if(!c)newC++;});
  var repeatC=custCount-newC;
  var custGrowth=Object.keys(pCustIn).length>0?(custCount-Object.keys(pCustIn).length)/Object.keys(pCustIn).length*100:(custCount>0?100:0);
  var repeatRev=0;cur.forEach(function(x){if(x.phone){var c=custMap[x.phone];if(c&&(c.orders||0)>1)repeatRev+=x.net;}});
  var topCust=Object.keys(custIn).map(function(ph){return{name:(custMap[ph]&&custMap[ph].name)||ph,spend:custIn[ph]};}).sort(function(a,b){return b.spend-a.spend;}).slice(0,5);
  // ratings
  var rlist=Object.values(reviewsMap).map(function(r){return{rating:Number(r.rating||r.stars||0),ts:r.timestamp||r.ts||0};}).filter(function(r){return r.rating>0;});
  var rIn=rlist.filter(function(r){return r.ts>=from&&r.ts<to;});
  var avgAll=rlist.length?rlist.reduce(function(s,r){return s+r.rating;},0)/rlist.length:0;
  // ops
  var ordersInRange=allOrders().filter(function(o){var ts=window.AccazaSales.stamp(o);return ts>=from&&ts<to;});
  var cancelled=ordersInRange.filter(function(o){return['Declined','Cancelled','Canceled','Voided'].indexOf(o.status)>-1||o.voided||(o.status==='Archived'&&['Declined','Cancelled'].indexOf(o.prevStatus)>-1);}).length;
  var cancelRate=ordersInRange.length?cancelled/ordersInRange.length*100:0;
  var prepList=cur.filter(function(x){return x.o.completedAt&&x.ts&&x.o.source!=='pos';}).map(function(x){return(Number(x.o.completedAt)-Number(x.o.timestamp))/60000;}).filter(function(m){return m>0&&m<600;});
  var avgPrep=prepList.length?prepList.reduce(function(s,m){return s+m;},0)/prepList.length:null;
  var target=15;var onTime=prepList.length?prepList.filter(function(m){return m<=target;}).length/prepList.length*100:null;
  var html='<div class="pz-h">📊 Analytics</div><p class="pz-sub">Every figure here traces to your own orders, recipes, and reviews.</p>';
  var _azF=tsToDate(from), _azT=tsToDate(to-86400000); // local date parts (not UTC) so date inputs match the range in UTC+10
  html+='<div class="az-note" id="azActive" style="margin:0 0 0.25rem;font-weight:600;color:var(--bd);">📅 Sales period: '+azRangeLabel(from,to)+'</div>'
    +'<div class="az-note" id="azHistoryNote" style="margin:0 0 0.7rem;">'+(analyticsHistoryLoading?'Loading complete sales history…':'Selected sales period and equal-length previous period loaded.')+'</div>';
  // KPIs
  html+='<div class="az-kpis">'
    +kpi('Net sales',peso(net),trend)
    +kpi('Gross sales',peso(gross))
    +kpi('Transactions',tx)
    +kpi('Avg order value',peso(aov))
    +kpi('Avg daily net',peso0(net/days))
    +kpi('Gross margin',(Math.round(margin*10)/10)+'%')
    +'</div>';
  html+='<div class="az-note">Highest day: '+(hi!==null?fmtD(hi)+' ('+peso0(byDay[hi]||0)+')':'—')+' · Lowest: '+(lo!==null?fmtD(lo)+' ('+peso0(byDay[lo]||0)+')':'—')+'</div>';
  // daily trend
  html+='<div class="az-sec">Daily net sales</div><div class="pz-card">'+dayKeys.map(function(k){return bar(fmtD(k),byDay[k]||0,maxDay,peso0(byDay[k]||0));}).join('')+'</div>';
  // two-col: hours + dow
  html+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;" class="pz-posgrid">';
  html+='<div><div class="az-sec">Peak hours</div><div class="pz-card">'+Object.keys(byHour).sort(function(a,b){return a-b;}).map(function(h){return bar((h%12||12)+(h<12?'am':'pm'),byHour[h],maxHour,peso0(byHour[h]));}).join('')+'</div></div>';
  html+='<div><div class="az-sec">By day of week</div><div class="pz-card">'+[0,1,2,3,4,5,6].map(function(d){return bar(dowN[d],byDow[d]||0,maxDow,peso0(byDow[d]||0));}).join('')+'</div></div>';
  html+='</div>';
  // category / payment / type
  html+='<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:1rem;" class="pz-posgrid">';
  html+='<div><div class="az-sec">By category</div><div class="pz-card">'+chartObj(byCat)+'</div></div>';
  html+='<div><div class="az-sec">Payment mix</div><div class="pz-card">'+chartObj(byPay)+'</div></div>';
  html+='<div><div class="az-sec">Order type</div><div class="pz-card">'+chartObj(byType)+'</div></div>';
  html+='</div>';
  var walkInRev=0,onlineRev=0,eventRev=0,promoRev=0;
  cur.forEach(function(x){var lis=x.lineItems||[];if(!lis.length){if((x.o&&x.o.source==='pos')||x.type==='Walk-in')walkInRev+=x.net;else onlineRev+=x.net;return;}lis.forEach(function(li){var rev=(Number(li.qty)||0)*(Number(li.unitTotal)||0);if(li.stream==='events')eventRev+=rev;else if(li.stream==='promo')promoRev+=rev;else if((x.o&&x.o.source==='pos')||x.type==='Walk-in')walkInRev+=rev;else onlineRev+=rev;});});
  var chTot=walkInRev+onlineRev+eventRev+promoRev||1;
  html+='<div class="az-sec">Sales channel</div><div class="pz-card"><div class="az-kpis" style="margin:0;">'+kpi('Walk-in (counter)',peso0(walkInRev)+' · '+Math.round(walkInRev/chTot*100)+'%')+kpi('Online',peso0(onlineRev)+' · '+Math.round(onlineRev/chTot*100)+'%')+kpi('Events',peso0(eventRev)+' · '+Math.round(eventRev/chTot*100)+'%')+kpi('Promos',peso0(promoRev)+' · '+Math.round(promoRev/chTot*100)+'%')+'</div><div class="az-note">Revenue share by channel — walk-in, online, event packages, promos.</div></div>';
  // items
  html+='<div class="az-sec">Top drinks by net revenue</div><div class="pz-card"><table class="pz-tbl"><thead><tr><th>Drink</th><th>Units</th><th>Net revenue</th><th>Unit trend</th></tr></thead><tbody>'
    +topByRev.slice(0,10).map(function(i){var pv=pItems[i.key]||0;var tr=pv>0?(i.units-pv)/pv*100:(i.units>0?100:0);return '<tr><td>'+esc(i.name)+'</td><td>'+i.units+'</td><td>'+peso0(i.rev)+'</td><td class="'+(tr>0?'az-up':tr<0?'az-down':'az-flat')+'">'+(pv>0||i.units>0?pct(tr):'—')+'</td></tr>';}).join('')
    +'</tbody></table></div>';
  html+='<div class="az-sec">Most profitable items <span class="az-note">(revenue − recipe cost)</span></div><div class="pz-card">'
    +(topByProfit.length?'<table class="pz-tbl"><thead><tr><th>Item</th><th>Units</th><th>Profit</th><th>Margin</th></tr></thead><tbody>'
      +topByProfit.slice(0,10).map(function(i){return '<tr><td>'+esc(i.name)+'</td><td>'+i.units+'</td><td>'+peso0(i.profit)+'</td><td>'+(Math.round(i.margin)||0)+'%</td></tr>';}).join('')+'</tbody></table>'
      :'<p class="az-note">Add recipes with ingredient costs to see per-item profit.</p>')
    +'</div>';
  // customers
  html+='<div class="az-sec">Customers</div><div class="az-kpis">'
    +kpi('Customers',custCount,custGrowth)
    +kpi('New',custCount?Math.round(newC/custCount*100)+'%':'0%')
    +kpi('Repeat',custCount?Math.round(repeatC/custCount*100)+'%':'0%')
    +kpi('Repeat sales share',net>0?Math.round(repeatRev/net*100)+'%':'0%')
    +'</div><div class="az-note">Walk-in POS sales have no phone and aren\'t counted as identified customers.</div>';
  if(topCust.length)html+='<div class="pz-card" style="margin-top:0.5rem;"><b style="font-size:0.82rem;color:var(--bd);">Top customers</b>'+topCust.map(function(c){return '<div style="display:flex;justify-content:space-between;font-size:0.82rem;padding:0.25rem 0;"><span>'+esc(c.name)+'</span><span>'+peso0(c.spend)+'</span></div>';}).join('')+'</div>';
  // ops scorecard
  html+='<div class="az-sec">Operations scorecard</div><div class="az-kpis">'
    +kpi('Avg prep time',avgPrep!=null?Math.round(avgPrep)+' min':'—')
    +kpi('On-time (≤'+target+'m)',onTime!=null?Math.round(onTime)+'%':'—')
    +kpi('Cancel rate',(Math.round(cancelRate*10)/10)+'%')
    +kpi('Ratings avg',avgAll?avgAll.toFixed(2):'—')
    +'</div><div class="az-note">Prep time from online orders (place → complete). '+rIn.length+' new rating(s) this period.</div>';
  // ---- channel mix (in-store vs platforms) ----
  (function(){
    var chData={instore:{lbl:'In-store',gross:0,comm:0,cogs:0,tx:0},online:{lbl:'Online Orders',gross:0,comm:0,cogs:0,tx:0},grabfood:{lbl:'GrabFood',gross:0,comm:0,cogs:0,tx:0},foodpanda:{lbl:'FoodPanda',gross:0,comm:0,cogs:0,tx:0}};
    cur.forEach(function(x){var o=x.o;var c=(o&&o.channel&&chData[o.channel])?o.channel:'instore';var d=chData[c],direct=c==='instore'||c==='online';d.gross+=(direct?x.net:poGross(o));d.comm+=(direct?0:(Number(o.commission)||0));d.cogs+=(x.lineItems?orderCOGS(o).cost:0);d.tx++;});
    var order=['instore','online','grabfood','foodpanda'];
    var rows=order.map(function(k){var d=chData[k];if(!d.tx&&k!=='instore')return '';var netAfter=d.gross-d.comm-d.cogs;var mgn=d.gross>0?netAfter/d.gross*100:0;return '<tr><td>'+esc(d.lbl)+'</td><td class="r">'+d.tx+'</td><td class="r">'+peso(d.gross)+'</td><td class="r">'+(d.comm?('-'+peso(d.comm)):'—')+'</td><td class="r">'+peso(d.cogs)+'</td><td class="r">'+peso(netAfter)+'</td><td class="r '+(mgn>=0?'az-up':'az-down')+'">'+(Math.round(mgn*10)/10)+'%</td></tr>';}).join('');
    html+='<div class="az-sec">Channel mix</div><div class="pz-card"><table class="pnl-tbl"><thead><tr><th>Channel</th><th class="r">Tx</th><th class="r">Gross</th><th class="r">Commission</th><th class="r">COGS</th><th class="r">Net after comm.+COGS</th><th class="r">Margin</th></tr></thead><tbody>'+rows+'</tbody></table><div class="az-note">Online Orders are tracked separately from in-store sales and use their verified payment method. Platform gross is booked as revenue; commission is trued up in Platform Payouts.</div></div>';
  })();
  root.innerHTML=html;
  /* Date controls are handled by the single delegated listener installed in renderAnalytics().
     Keeping them there means a report-data error cannot make the controls unclickable. */
}
function chartObj(obj){var keys=Object.keys(obj).sort(function(a,b){return obj[b]-obj[a];});var max=Math.max.apply(null,keys.map(function(k){return obj[k];}).concat([1]));return keys.length?keys.map(function(k){return bar(k,obj[k],max,peso0(obj[k]));}).join(''):'<p class="az-note">No data.</p>';}
function pad(n){return(n<10?'0':'')+n;}

/* ══════════ P&L ══════════ */
function monthKey(ts){var d=new Date(ts);return d.getFullYear()+'-'+pad(d.getMonth()+1);}
function monthLabel(mk){var p=mk.split('-');return new Date(p[0],p[1]-1,1).toLocaleDateString('en-PH',{month:'long',year:'numeric'});}
function prevMonthKey(mk){var p=mk.split('-');var d=new Date(p[0],p[1]-1,1);d.setMonth(d.getMonth()-1);return d.getFullYear()+'-'+pad(d.getMonth()+1);}
function usageNameFor(id){ if(id==='staff')return 'Staff consumption'; if(id==='rnd')return 'R&D / Testing'; var nm=null; Object.keys(usageMap).some(function(k){var u=usageMap[k];if(u&&u.kind===id&&u.kindName){nm=u.kindName;return true;}return false;}); return nm||id; }
var PNL_OPEX_LINES=[
  {id:'salaries',label:'Salaries and wages',re:/salary|salaries|wage|payroll/i},
  {id:'rent',label:'Rent',re:/rent|rental|lease/i},
  {id:'electricity',label:'Electricity',re:/electric/i},
  {id:'waterUtilities',label:'Water and other utilities',re:/water|utilit|internet|telephone|gas/i},
  {id:'transportation',label:'Transportation',re:/transport|travel|fuel|fare/i},
  {id:'repairs',label:'Repairs and maintenance',re:/repair|maintenance/i},
  {id:'officeAdmin',label:'Office and administrative expenses',re:/office|admin|supplies|pcf|petty cash/i},
  {id:'permits',label:'Permits and licenses',re:/permit|licen[cs]e|registration/i},
  {id:'depreciation',label:'Depreciation',re:/depreciation/i}
];
function pnlExpenseGroups(byItem){var out={operating:{},other:{interest:0,bank:0,other:0},tax:0};PNL_OPEX_LINES.forEach(function(x){out.operating[x.id]=0;});out.operating.other=0;Object.keys(byItem||{}).forEach(function(id){var x=byItem[id]||{},n=String(x.name||'');var a=Number(x.amount)||0;if(/income.?tax|tax expense/i.test(n)){out.tax+=a;return;}if(/interest/i.test(n)){out.other.interest+=a;return;}if(/bank charge|bank fee/i.test(n)){out.other.bank+=a;return;}if(/loan|debt repayment|principal/i.test(n)){out.other.other+=a;return;}var hit=PNL_OPEX_LINES.filter(function(d){return d.re.test(n);})[0];if(hit)out.operating[hit.id]+=a;else out.operating.other+=a;});return out;}
function emptyCogsCategories(){return{food:0,beverage:0,packaging:0,directLabor:0,unallocated:0};}
function cogsBucketForIngredient(id){var item=invMap[id]||{},cat=((posSettingsMap.invCategories||{})[item.category])||{};var label=String(cat.name||item.category||'').toLowerCase();if(/packag|cup|lid|straw|napkin|container/.test(label))return'packaging';if(/beverage|drink|coffee|tea|milk|syrup|powder/.test(label))return'beverage';if(/food|ingredient|bakery|kitchen|pastry|meal/.test(label))return'food';return'unallocated';}
function orderCogsCategories(o){var out=emptyCogsCategories(),snap=o&&o.cogsCategorySnapshot;if(snap){Object.keys(out).forEach(function(k){out[k]=Number(snap[k])||0;});return out;}var lines=o&&o.cogsDetail&&o.cogsDetail.lines;if(Array.isArray(lines)&&lines.length){lines.forEach(function(line){var b=cogsBucketForIngredient(line.ingredientId);out[b]+=Number(line.totalCost)||0;});return out;}out.unallocated=Number(o&&o.cogsSnapshot)||0;return out;}
