import{reconcileInventoryBooks}from'./inventory-books-reconciliation.mjs';
(function(){
'use strict';
var ordersMap={},archMap={},reviewsMap={},feedbacksMap={},custMap={},invMap={},recMap={},expMap={},expCatMap={},expItems={},monthlyExp={},adjMap={},usageMap={},payoutsMap={},varAcctMap={},receiptsMap={},posSettingsMap={},inventoryBooksJournal={},payoutCashAccounts={};
var inventoryBooksLoaded=false;
var financialCloseState={},financialCloseLoading={};
var svFrom=null,svTo=null,svExpand=null;
var azRange='month', azFrom=null, azTo=null, pnlMonth=null, analyticsHistoryLoading=false;
var poChannel='grabfood', poFrom=null, poTo=null;
var PO_CHANNELS=[{k:'grabfood',lbl:'GrabFood'},{k:'foodpanda',lbl:'FoodPanda'}];
var DEFAULT_VAR_ACCOUNTS=[
  {id:'va_ads',name:'Platform ads / marketing',type:'expense',order:1},
  {id:'va_marketing_success',name:'Grab marketing success fee',type:'expense',order:2},
  {id:'va_promo',name:'Other promo co-funding',type:'expense',order:3},
  {id:'va_fees',name:'Payment / processing fees',type:'expense',order:4},
  {id:'va_penalty',name:'Penalties / adjustments',type:'expense',order:5},
  {id:'va_refund',name:'Grab refund / cancellation deduction',type:'expense',order:6},
  {id:'va_refund_recovery',name:'Grab refund recovery / reversal',type:'revenue',order:7},
  {id:'va_incentive',name:'Incentives / rebates',type:'revenue',order:8}
];
function varAccounts(){var keys=Object.keys(varAcctMap);var list=keys.length?keys.map(function(k){return Object.assign({id:k},varAcctMap[k]);}):DEFAULT_VAR_ACCOUNTS.slice();return list.sort(function(a,b){return (a.order||0)-(b.order||0);});}
function A(){return window.__accaza;}
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
function peso(n){n=Number(n)||0;return '₱'+n.toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});}
function peso0(n){n=Number(n)||0;return '₱'+Math.round(n).toLocaleString('en-PH');}
function pct(n){return (n>=0?'+':'')+(Math.round(n*10)/10)+'%';}
function uid(p){return p+Date.now().toString(36)+Math.random().toString(36).slice(2,6);}
function isTab(n){var el=document.getElementById('tab-'+n);return el&&el.style.display!=='none';}

var tries=0,iv=setInterval(function(){if(window.__accaza){clearInterval(iv);init();}else if(++tries>150)clearInterval(iv);},100);
/* Orders + archivedOrders feed every finance tab below — re-render whichever is
   open so loading older history (or live sales) refreshes the visible figures,
   not just Analytics. Fixes the Payout receivable staying stale after "Load older". */
function rerenderOrderTabs(){
  if(isTab('analytics'))renderAnalytics();
  if(isTab('payouts'))renderPayouts();
  if(isTab('stockvalue'))renderStockValue();
  if(isTab('dailyreport'))renderDailyReport();
}
function init(){
  var a=A();
  a.subscribe('orders',function(s){ordersMap=s.val()||{};captureCompletedAt(ordersMap);rerenderOrderTabs();});
  a.subscribe('archivedOrders',function(s){archMap=s.val()||{};rerenderOrderTabs();});
  a.subscribe('reviews',function(s){reviewsMap=s.val()||{};if(isTab('analytics'))renderAnalytics();});
  a.subscribe('feedbacks',function(s){feedbacksMap=s.val()||{};});
  a.subscribe('appCustomers',function(s){custMap=s.val()||{};if(isTab('analytics'))renderAnalytics();});
  a.subscribe('recipes',function(s){recMap=s.val()||{};});
  a.subscribe('expenseItems',function(s){expItems=s.val()||{};if(isTab('pnl'))renderPnl();});
  a.subscribe('monthlyExpenses',function(s){monthlyExp=s.val()||{};if(isTab('pnl'))renderPnl();});
  a.subscribe('inventoryAdjustments',function(s){adjMap=s.val()||{};if(isTab('pnl'))renderPnl();if(isTab('stockvalue'))renderStockValue();});
  a.subscribe('internalUsage',function(s){usageMap=s.val()||{};if(isTab('pnl'))renderPnl();if(isTab('stockvalue'))renderStockValue();});
  a.subscribe('stockReceipts',function(s){receiptsMap=s.val()||{};if(isTab('stockvalue'))renderStockValue();});
  a.subscribe('inventory',function(s){invMap=s.val()||{};if(isTab('stockvalue'))renderStockValue();});
  a.subscribe('books/journal',function(s){inventoryBooksJournal=s.val()||{};inventoryBooksLoaded=true;if(isTab('stockvalue'))renderStockValue();});
  a.subscribe('posSettings',function(s){posSettingsMap=s.val()||{};if(isTab('pnl'))renderPnl();});
  a.subscribe('platformPayouts',function(s){payoutsMap=s.val()||{};if(isTab('payouts'))renderPayouts();if(isTab('pnl'))renderPnl();if(isTab('analytics'))renderAnalytics();});
  a.subscribe('cfAccounts',function(s){payoutCashAccounts=s.val()||{};if(isTab('payouts'))renderPayouts();});
  a.subscribe('platformVarAccounts',function(s){varAcctMap=s.val()||{};if(isTab('payouts'))renderPayouts();if(isTab('pnl'))renderPnl();});
}
// extend the POS tab switcher to also render our tabs
window.__accazaRegisterModule('analytics',function(name){ if(name==='analytics')renderAnalytics(); if(name==='payouts')renderPayouts(); if(name==='stockvalue')renderStockValue(); if(name==='dailyreport')renderDailyReport(); });

// capture completedAt for ops metrics (idempotent, additive)
function captureCompletedAt(all){var a=A();Object.keys(all).forEach(function(id){var o=all[id];if(o&&o.status==='Completed'&&!o.completedAt){a.update(a.ref(a.db,'orders/'+id),{completedAt:Date.now()});}});}

/* ---------- sales model ---------- */
function isSale(o){return window.AccazaSales.qualifies(o);}
function allOrders(){var out=[];[ordersMap,archMap].forEach(function(m){Object.keys(m).forEach(function(k){out.push(m[k]);});});return out;}
function itemCost(li){var rec=recMap[li.itemKey];if(!rec)return null;var mult=(rec.sizeMult&&rec.sizeMult[li.size]!=null)?rec.sizeMult[li.size]:1;var c=0;(rec.base||[]).forEach(function(b){var ing=invMap[b.ing];if(!ing)return;var per=b['qty'+(li.size||'M')];var q=(per!=null&&per!=='')?(Number(per)||0):(Number(b.qty)||0)*mult;c+=q*(Number(ing.cost)||0);});var labels=li.optLabels||[];var _it=((A()&&A().menuItemsMap)||{})[li.itemKey]||{key:li.itemKey};var getChoiceIngs=window.__accazaChoiceIngs;labels.forEach(function(lb){(getChoiceIngs?getChoiceIngs(_it,rec,lb,li.size):[]).forEach(function(r){var ing=invMap[r.ing];if(ing)c+=(Number(r.qty)||0)*(Number(ing.cost)||0);});});return c*(Number(li.qty)||1);}
function orderCOGS(o){var _x=Number(o.extraCost)||0;
  if(o.cogsSnapshot!=null)return{cost:(Number(o.cogsSnapshot)||0)+_x,covered:o.cogsCovered!==false};
  if(!o.lineItems)return{cost:_x,covered:false};var cost=0,any=false,all=true;o.lineItems.forEach(function(li){var c=itemCost(li);if(c==null)all=false;else{cost+=c;any=true;}});return{cost:cost+_x,covered:any&&all};}
function saleFields(o){var v=window.AccazaSales.amounts(o);return{ts:window.AccazaSales.stamp(o),gross:v.gross,discount:v.discount,refund:v.refund,net:v.net,payment:o.payment||'—',type:o.type||'—',lineItems:o.lineItems||null,phone:(o.phone||'').replace(/[^0-9]/g,''),name:o.name||'Walk-in',o:o};}
function salesBetween(from,to){return allOrders().filter(isSale).map(saleFields).filter(function(s){return s.ts>=from&&s.ts<to;});}
function dayStart(d){d=new Date(d);d.setHours(0,0,0,0);return d.getTime();}
function addDays(ts,n){var d=new Date(ts);d.setDate(d.getDate()+n);return d.getTime();}
function localDateValue(v){var p=String(v||'').split('-');if(p.length!==3)return NaN;return new Date(Number(p[0]),Number(p[1])-1,Number(p[2])).getTime();}
function rangeBounds(){var now=Date.now(),today=dayStart(now),end=addDays(today,1);if(azRange==='today')return[today,end];if(azRange==='7d')return[addDays(today,-6),end];if(azRange==='30d')return[addDays(today,-29),end];if(azRange==='month'){var d=new Date();return[new Date(d.getFullYear(),d.getMonth(),1).getTime(),end];}if(azRange==='all'){var ts=allOrders().map(function(o){return o.timestamp||Date.parse(o.date)||0;}).filter(Boolean);return[ts.length?dayStart(Math.min.apply(null,ts)):today,end];}if(azRange==='custom'&&azFrom!=null&&azTo!=null)return[dayStart(azFrom),addDays(dayStart(azTo),1)];return[addDays(today,-29),end];}
function fmtD(ts){return new Date(ts).toLocaleDateString('en-PH',{month:'short',day:'numeric'});}
function azRangeLabel(from,to){var nm={today:'Today','7d':'Last 7 days','30d':'Last 30 days',month:'This month',all:'All time',custom:'Custom range'};return (nm[azRange]||azRange)+' · '+fmtD(from)+' – '+fmtD(to-86400000);}
function sharedPeriod(v){v=v||(window.AccazaReportPeriod&&window.AccazaReportPeriod.get&&window.AccazaReportPeriod.get());if(!v)return;azRange=v.period==='7'?'7d':v.period==='30'?'30d':v.period||'month';azFrom=null;azTo=null;}
async function ensureAnalyticsHistory(){
  var a=A(),hub=a&&a.hub;if(analyticsHistoryLoading||!hub)return;
  var from=rangeBounds()[0],paths=[{path:'orders',map:function(){return ordersMap;},field:'timestamp'},{path:'archivedOrders',map:function(){return archMap;},field:'archivedAt'}];
  function oldest(cfg){return Object.values(cfg.map()).reduce(function(min,o){var ts=Number(o&&o[cfg.field])||0;return ts&&(!min||ts<min)?ts:min;},0);}
  function needsOlder(cfg){var status=hub.historyStatus(cfg.path),old=oldest(cfg);return status.hasOlder&&(azRange==='all'||!old||old>from);}
  if(!paths.some(needsOlder))return;
  analyticsHistoryLoading=true;var note=document.getElementById('azHistoryNote');if(note)note.textContent='Loading complete sales history…';
  try{
    for(var p=0;p<paths.length;p++){
      var cfg=paths[p],status=hub.historyStatus(cfg.path),loops=0;
      while(status.hasOlder&&loops<100){
        var oldestTs=oldest(cfg);
        if(azRange!=='all'&&oldestTs&&oldestTs<=from)break;
        await hub.loadOlder(cfg.path);status=hub.historyStatus(cfg.path);loops++;
      }
    }
  }catch(e){console.error('analytics history load error',e);}
  finally{analyticsHistoryLoading=false;renderAnalytics();}
}

function bar(label,val,max,disp){var w=max>0?Math.max(2,Math.round(val/max*100)):0;return '<div class="az-bar-row"><div class="az-bar-lbl">'+esc(label)+'</div><div class="az-bar-track"><div class="az-bar-fill" style="width:'+w+'%;"></div></div><div class="az-bar-val">'+(disp!=null?disp:val)+'</div></div>';}
function kpi(label,val,delta){var d='';if(delta!=null&&isFinite(delta))d='<div class="d '+(delta>0?'az-up':delta<0?'az-down':'az-flat')+'">'+pct(delta)+' vs prev</div>';return '<div class="az-kpi"><div class="v">'+val+'</div><div class="l">'+esc(label)+'</div>'+d+'</div>';}

/* ══════════ ANALYTICS ══════════ */
function renderAnalytics(){
  var root=document.getElementById('analyticsRoot'); if(!root)return;
  sharedPeriod();
  try{ renderAnalyticsBody();ensureAnalyticsHistory(); }
  catch(err){ console.error('renderAnalytics error',err);
    root.innerHTML='<div class="pz-h">📊 Analytics</div><div style="background:#fde8e8;border:1px solid #f5b5b5;border-radius:8px;padding:1rem;color:#a11;font-size:0.85rem;">Analytics couldn’t finish building the shared-period report: <b>'+esc(String((err&&err.message)||err))+'</b>.</div>'; }
}
window.addEventListener('accaza-report-period',function(){var root=document.getElementById('analyticsRoot');if(root&&root.offsetParent!==null)renderAnalytics();});
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
  var byDay={};cur.forEach(function(x){var k=dayStart(x.ts);byDay[k]=(byDay[k]||0)+x.net;});
  var dayKeys=[];for(var t=from;t<to;t+=86400000)dayKeys.push(t);
  var maxDay=Math.max.apply(null,dayKeys.map(function(k){return byDay[k]||0;}).concat([1]));
  var hi=null,lo=null;dayKeys.forEach(function(k){var v=byDay[k]||0;if(hi===null||v>byDay[hi])hi=k;if(lo===null||v<byDay[lo])lo=k;});
  // hour
  var byHour={};cur.forEach(function(x){var h=new Date(x.ts).getHours();byHour[h]=(byHour[h]||0)+x.net;});
  var maxHour=Math.max.apply(null,Object.keys(byHour).map(function(h){return byHour[h];}).concat([1]));
  // dow
  var dowN=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'],byDow={};cur.forEach(function(x){var d=new Date(x.ts).getDay();byDow[d]=(byDow[d]||0)+x.net;});
  var maxDow=Math.max.apply(null,Object.keys(byDow).map(function(d){return byDow[d];}).concat([1]));
  // category / payment / type / items
  var byCat={},byPay={},byType={},items={};var totItems=0;
  cur.forEach(function(x){
    byPay[x.payment]=(byPay[x.payment]||0)+x.net;
    byType[x.type]=(byType[x.type]||0)+x.net;
    var itemFactor=x.gross>0?Math.max(0,x.net/x.gross):0;if(itemFactor<=0)return;(x.lineItems||[]).forEach(function(li){
      var mi=A().menuItemsMap[li.itemKey];var cat=mi?(A().getCatLabel?A().getCatLabel(mi.cat):mi.cat):'Other';
      byCat[cat]=(byCat[cat]||0)+li.qty*li.unitTotal;
      totItems+=li.qty;
      var _ct=(window.__posSettings&&window.__posSettings.catType)||{}; if(mi&&_ct[mi.cat]==='food')return; /* Top items = drinks only: exclude food/pastry categories. Add-ons are options (optLabels), never line items, so already excluded. */
      var key=li.name;items[key]=items[key]||{name:li.name,units:0,rev:0,cost:0};
      items[key].units+=li.qty;items[key].rev+=li.qty*li.unitTotal*itemFactor;var c=itemCost(li);if(c!=null)items[key].cost+=c;
    });
  });
  // prev-period item units for trend
  var pItems={};prev.forEach(function(x){if(x.net<=0)return;(x.lineItems||[]).forEach(function(li){var mi=A().menuItemsMap[li.itemKey],ct=(window.__posSettings&&window.__posSettings.catType)||{};if(mi&&ct[mi.cat]==='food')return;pItems[li.name]=(pItems[li.name]||0)+li.qty;});});
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
  var ordersInRange=allOrders().filter(function(o){var ts=o.timestamp||Date.parse(o.date)||0;return ts>=from&&ts<to;});
  var cancelled=ordersInRange.filter(function(o){return['Declined','Cancelled','Canceled','Voided'].indexOf(o.status)>-1||o.voided||(o.status==='Archived'&&['Declined','Cancelled'].indexOf(o.prevStatus)>-1);}).length;
  var cancelRate=ordersInRange.length?cancelled/ordersInRange.length*100:0;
  var prepList=cur.filter(function(x){return x.o.completedAt&&x.ts&&x.o.source!=='pos';}).map(function(x){return(x.o.completedAt-x.ts)/60000;}).filter(function(m){return m>0&&m<600;});
  var avgPrep=prepList.length?prepList.reduce(function(s,m){return s+m;},0)/prepList.length:null;
  var target=15;var onTime=prepList.length?prepList.filter(function(m){return m<=target;}).length/prepList.length*100:null;
  var html='<div class="pz-h">📊 Analytics</div><p class="pz-sub">Every figure here traces to your own orders, recipes, and reviews.</p>';
  var _azF=tsToDate(from), _azT=tsToDate(to-86400000); // local date parts (not UTC) so date inputs match the range in UTC+10
  html+='<div class="az-note" id="azActive" style="margin:0 0 0.25rem;font-weight:600;color:var(--bd);">📅 Shared sales period: '+azRangeLabel(from,to)+'</div>'
    +'<div class="az-note" id="azHistoryNote" style="margin:0 0 0.7rem;">'+(analyticsHistoryLoading?'Loading complete sales history…':'Complete available sales history loaded.')+'</div>';
  // KPIs
  html+='<div class="az-kpis">'
    +kpi('Net sales',peso0(net),trend)
    +kpi('Gross sales',peso0(gross))
    +kpi('Transactions',tx)
    +kpi('Avg order value',peso0(aov))
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
    +topByRev.slice(0,10).map(function(i){var pv=pItems[i.name]||0;var tr=pv>0?(i.units-pv)/pv*100:(i.units>0?100:0);return '<tr><td>'+esc(i.name)+'</td><td>'+i.units+'</td><td>'+peso0(i.rev)+'</td><td class="'+(tr>0?'az-up':tr<0?'az-down':'az-flat')+'">'+(pv>0||i.units>0?pct(tr):'—')+'</td></tr>';}).join('')
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
/* ══════════ DAILY REPORT (all channels + register expenses) ══════════ */
function drNum(n){return (Math.round((Number(n)||0)*1000)/1000).toLocaleString('en-PH');}
function dailyBounds(dstr){var s=new Date(dstr+'T00:00:00').getTime();return [s,s+86400000];}
function closeStatusLabel(status){return String(status||'NOT RUN').replace(/_/g,' ');}
function closeControlHtml(d,shiftRows){
  var row=financialCloseState['daily_'+d],loading=financialCloseLoading['daily_'+d],status=row&&row.status||'NOT_RUN',tone=status==='CERTIFIED'||status==='RECONCILED'?'#eaf7ee':status==='RECONCILED_WITH_TIMING_ITEMS'?'#fff9e8':'#fff0ef',exceptions=row&&row.exceptions||[],timing=row&&row.timingItems||[],tot=row&&row.controlTotals||{},closed=(shiftRows||[]).filter(function(s){return !s.open;});
  var issueRows=exceptions.slice(0,20).map(function(x){return '<tr><td>'+esc(x.control)+'</td><td>'+esc(x.sourceId||'—')+'</td><td>'+esc(x.category)+'</td><td class="r">'+peso(Math.abs(Number(x.difference)||0))+'</td><td>'+esc(x.message||'')+'</td></tr>';}).join('');
  return '<section class="pz-card" style="margin-bottom:1rem;background:'+tone+';border:1px solid #d7c8b2;"><div style="display:flex;justify-content:space-between;gap:.7rem;align-items:center;flex-wrap:wrap;"><div><div class="pz-lbl">Shared Admin ↔ Finance control</div><div class="pz-h" style="font-size:1.05rem;">Daily Financial Close · '+esc(closeStatusLabel(status))+'</div><div class="pz-sub">'+(row?('Revision '+row.revision+' · '+row.transactionCount+' orders · '+exceptions.length+' exception(s) · '+timing.length+' timing item(s)'):'Run the server-authoritative close to compare transaction sources, control accounts and subledgers.')+'</div></div><div style="display:flex;gap:.4rem;flex-wrap:wrap;"><button class="pz-btn ok" id="drRunClose"'+(loading?' disabled':'')+'>'+(loading?'Running…':'Run daily reconciliation')+'</button>'+(row&&['RECONCILED','RECONCILED_WITH_TIMING_ITEMS'].indexOf(status)>-1?'<button class="pz-btn ok" id="drCertifyClose">Manager certify</button>':'')+'</div></div>'
    +(row?'<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:.45rem;margin-top:.65rem;"><div><span class="pz-lbl">Admin net sales</span><b>'+peso(row.admin&&row.admin.netSales)+'</b></div><div><span class="pz-lbl">Finance net revenue</span><b>'+peso(row.finance&&row.finance.netRevenue)+'</b></div><div><span class="pz-lbl">Sales difference</span><b>'+peso(tot.salesDifference)+'</b></div><div><span class="pz-lbl">Undeposited vs custody</span><b>'+peso(tot.cashCustodyDifference)+'</b></div><div><span class="pz-lbl">AR difference</span><b>'+peso(tot.receivablesDifference)+'</b></div><div><span class="pz-lbl">AP difference</span><b>'+peso(tot.payablesDifference)+'</b></div></div>':'')
    +(issueRows?'<details style="margin-top:.65rem;"><summary><b>Open exceptions</b></summary><div style="overflow:auto;"><table class="pz-tbl"><thead><tr><th>Control</th><th>Source</th><th>Category</th><th class="r">Difference</th><th>Required action</th></tr></thead><tbody>'+issueRows+'</tbody></table></div></details>':'')
    +'<div style="margin-top:.65rem;display:flex;gap:.4rem;align-items:end;flex-wrap:wrap;"><div><span class="pz-lbl">Optional shift close</span><select class="pz-in" id="drCloseShift"><option value="">Select a closed shift</option>'+closed.map(function(s){return '<option value="'+esc(s.id)+'">'+esc(s.staff||s.id)+' · '+esc(s.id)+'</option>';}).join('')+'</select></div><button class="pz-btn sec" id="drRunShiftClose">Run shift reconciliation</button></div></section>';
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
      else{var g=Number(o.grossPlatform||o.subtotal||o.total)||0;nt=Number(o.netPlatform!=null?o.netPlatform:g)||0;ch.gross+=g;ch.comm+=Number(o.commission)||0;ch.net+=nt;netTot+=nt;}
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
/* ══════════ PLATFORM PAYOUT RECONCILIATION ══════════ */
function poGross(o){return Number(o.grossPlatform||o.subtotal||o.total)||0;}
function poNet(o){return (o.netPlatform!=null)?(Number(o.netPlatform)||0):(poGross(o)-(Number(o.commission)||0));}
function poGrabDeductions(o){
  o=o||{};var mapped=o.platformMerchantPromo!=null||o.platformDeliveryFeeDiscount!=null,promo=mapped?(Number(o.platformMerchantPromo)||0):0,delivery=mapped?(Number(o.platformDeliveryFeeDiscount)||0):0;
  if(!mapped){(o.platformDiscountLines||[]).forEach(function(d){var amount=Number(d.amount)||0,category=String(d.category||'').toLowerCase(),label=String(d.type||'').toLowerCase();if(category==='delivery_fee_discount'||label.indexOf('delivery fee')>-1)delivery+=amount;else promo+=amount;});if(!(o.platformDiscountLines||[]).length)promo=Number(o.platformDiscount)||0;}
  return{merchantPromo:Math.round(promo*100)/100,deliveryFeeDiscount:Math.round(delivery*100)/100};
}
function refNorm(s){return String(s||'').toUpperCase().replace(/[^A-Z0-9]/g,'');}
function refEq(a,b){var x=refNorm(a),y=refNorm(b);if(!x||!y)return false;if(x===y)return true;var lo=x.length<y.length?x:y,hi=x.length<y.length?y:x;return lo.length>=5&&hi.slice(-lo.length)===lo;}
function settledPayoutOrderIds(){var ids={};Object.keys(payoutsMap).forEach(function(k){var p=payoutsMap[k]||{};if(p.reversed)return;(p.orderIds||[]).forEach(function(id){if(id)ids[id]=k;});});return ids;}
function platEntries(){var out=[];Object.keys(ordersMap).forEach(function(k){var o=ordersMap[k];if(o&&o.source==='pos'&&o.channel&&o.channel!=='instore'&&!o.voided)out.push({key:k,node:'orders',o:o});});Object.keys(archMap).forEach(function(k){var o=archMap[k];if(o&&o.source==='pos'&&o.channel&&o.channel!=='instore'&&!o.voided)out.push({key:k,node:'archivedOrders',o:o});});return out;}
function poUnsettled(ch){var paid=settledPayoutOrderIds();return platEntries().filter(function(e){var id=e.o.id||e.key;return e.o.channel===ch&&(e.o.settlementStatus||'unsettled')!=='settled'&&!paid[id];});}
function reKeyMissedOrder(ch,chLbl){
  if(!window.AccazaFormDialog){alert('Form service unavailable. Refresh the portal.');return;}
  var a=A();
  if(!a||!a.recordPlatformCatchup||!a.managerApproval){alert('Re-key service unavailable. Refresh the portal.');return;}
  var rate=(typeof channelRate==='function')?(Number(channelRate(ch))||0):0;
  window.AccazaFormDialog.run({
    title:'Re-key a missed '+chLbl+' order',
    subtitle:'Records a '+chLbl+' order that was never entered in the POS. Books revenue, commission and the receivable on the order date. Stock is NOT deducted — reconcile small differences in inventory.',
    submitLabel:'Record missed order',
    busyLabel:'Recording…',
    fields:[
      {name:'ref',label:chLbl+' order number',type:'text',required:true,maxLength:60,placeholder:(ch==='grabfood'?'GF-123456':'FP-123456')},
      {name:'date',label:'Order date',type:'date',required:true},
      {name:'gross',label:'Gross amount (₱)',type:'number',required:true,min:0.01},
      {name:'commission',label:'Commission (₱)'+(rate?(' — about '+(rate*100).toFixed(1)+'% of gross'):''),type:'number',required:true,min:0,validate:function(v,vals){if(Number(v)>Number(vals.gross||0)+0.009)return 'Commission cannot exceed the gross amount.';}},
      {name:'reference',label:'Reference / reason (audit trail)',type:'text',required:true,maxLength:200,value:'Missed '+chLbl+' order — late entry'}
    ]
  },function(v){
    return a.managerApproval('rekey_platform_order',v.ref,Number(v.gross),v.reference).then(function(ap){
      return a.recordPlatformCatchup({channel:ch,platformRef:v.ref,date:v.date,gross:Number(v.gross),commission:Number(v.commission),commissionRate:rate,reference:v.reference,approvalId:ap.approvalId});
    }).then(function(r){return (r&&r.data)||r||{};});
  }).then(function(d){
    if(!d)return;
    renderPayouts();
    alert('Recorded missed '+chLbl+' order '+(d.platformRef||'')+'. Net receivable '+peso(d.net||0)+' posted and now appears as unsettled.');
  }).catch(function(e){var m=String((e&&e.message)||(e&&e.code)||e);if(m.indexOf('cancelled')<0)alert('Could not record the missed order: '+m);});
}
function voidPayoutOrder(orderId,gross){
  if(!window.AccazaFormDialog){alert('Form service unavailable. Refresh the portal.');return;}
  var a=A();
  if(!a||!a.processOrderAdjustment||!a.managerApproval){alert('Void service unavailable. Refresh the portal.');return;}
  window.AccazaFormDialog.run({
    title:'Void order '+orderId,
    subtitle:'Reverses this order’s revenue and platform receivable and removes it from the open list. Use for duplicates or mistaken entries. The voided record is kept for audit.',
    submitLabel:'Request approval & void',
    busyLabel:'Voiding…',
    fields:[{name:'reason',label:'Void reason',type:'textarea',required:true,maxLength:300,placeholder:'e.g. Duplicate of GF-855'},{name:'confirmed',label:'I confirm this order should be voided',type:'checkbox',required:true}]
  },function(v){
    return a.managerApproval('void',orderId,Number(gross)||0,v.reason).then(function(ap){
      return a.processOrderAdjustment({action:'void',orderId:orderId,reason:v.reason,approvalId:ap.approvalId});
    });
  }).then(function(){if(ordersMap[orderId])ordersMap[orderId].voided=true;if(archMap[orderId])archMap[orderId].voided=true;renderPayouts();alert('Order '+orderId+' voided. It no longer appears in the open payout list.');}).catch(function(e){var m=String((e&&e.message)||(e&&e.code)||e);if(m.indexOf('cancelled')<0)alert('Could not void the order: '+m);});
}
function reversePayout(payoutId,chLbl){
  if(!window.AccazaFormDialog){alert('Form service unavailable. Refresh the portal.');return;}
  var a=A();
  if(!a||!a.reversePlatformPayout||!a.managerApproval){alert('Reverse service unavailable. Refresh the portal.');return;}
  window.AccazaFormDialog.run({
    title:'Reverse settled '+chLbl+' payout',
    subtitle:'Unwinds this settlement: its orders go back to unsettled and the ledger posting is reversed, so you can re-settle correctly. The payout record is kept and marked reversed.',
    submitLabel:'Request approval & reverse',
    busyLabel:'Reversing…',
    fields:[{name:'reason',label:'Reversal reason',type:'textarea',required:true,maxLength:300,placeholder:'e.g. Wrong actual amount / orders included by mistake'},{name:'confirmed',label:'I understand the orders return to unsettled and the posting is reversed',type:'checkbox',required:true}]
  },function(v){
    return a.managerApproval('reverse_platform_payout',payoutId,null,v.reason).then(function(ap){
      return a.reversePlatformPayout({payoutId:payoutId,reason:v.reason,approvalId:ap.approvalId});
    }).then(function(r){return (r&&r.data)||r||{};});
  }).then(function(d){renderPayouts();alert('Payout reversed. '+((d&&d.orderCount)||0)+' order(s) returned to unsettled and can be re-settled.');}).catch(function(e){var m=String((e&&e.message)||(e&&e.code)||e);if(m.indexOf('cancelled')<0)alert('Could not reverse the payout: '+m);});
}
function correctPlatformPresettlement(ch,chLbl,platformRef,entries){
  var a=A();if(!a||!a.correctPlatformPresettlement||!a.managerApproval){alert('Pre-settlement correction service unavailable. Refresh the portal.');return;}
  if(!window.AccazaFormDialog){alert('Form service unavailable. Refresh the portal.');return;}
  var choose=platformRef?Promise.resolve({platformRef:platformRef}):window.AccazaFormDialog.open({title:'Pre-settlement correction',subtitle:'Choose an unsettled '+chLbl+' order from the current list.',submitLabel:'Continue',fields:[{name:'platformRef',label:chLbl+' unsettled order',type:'select',required:true,options:(entries||[]).map(function(e){var o=e.o||{};return{value:o.platformRef||o.id||e.key,label:(o.platformRef||o.id||e.key)+' — '+peso(poGross(o))+' — '+(o.date||'date unavailable')};})}]});
  choose.then(function(v){return a.correctPlatformPresettlement({action:'lookup',channel:ch,platformRef:v.platformRef}).then(function(r){return(r&&r.data)||r||{};});})
  .then(function(found){
    if((found.settlementStatus||'unsettled')==='settled')throw new Error('This order is already settled. Reverse the payout before correcting it.');
    return window.AccazaFormDialog.run({title:'Correct '+found.platformRef+' before settlement',subtitle:'Current gross '+peso(found.gross)+'. Correct the platform reference and verified statement figures. Amount changes update Finance Books; reference-only changes are audit-only. Items, COGS, and inventory do not change.',submitLabel:'Approve & correct',busyLabel:'Posting correction…',fields:[
      {name:'newPlatformRef',label:'Correct '+chLbl+' order reference',type:'text',required:true,maxLength:60,value:found.platformRef},
      {name:'gross',label:'Verified gross order value (₱)',type:'number',required:true,min:0.01,value:found.gross},
      {name:'commission',label:'Verified commission (₱)',type:'number',required:true,min:0,value:found.commission,validate:function(v,vals){return Number(v)>Number(vals.gross||0)+0.009?'Commission cannot exceed verified gross.':'';}},
      {name:'reason',label:'Correction reason',type:'textarea',required:true,maxLength:300,value:'Correct cashier entry to '+chLbl+' payout statement'},
      {name:'confirmed',label:'Items and quantities are correct; inventory must remain unchanged',type:'checkbox',required:true}
    ]},function(v){
      var difference=Math.round(Math.abs(Number(found.gross)-Number(v.gross))*100)/100;
      return a.managerApproval('correct_platform_presettlement',found.orderId,difference,v.reason).then(function(ap){return a.correctPlatformPresettlement({action:'correct',channel:ch,platformRef:found.platformRef,newPlatformRef:v.newPlatformRef,gross:Number(v.gross),commission:Number(v.commission),reason:v.reason,approvalId:ap.approvalId});}).then(function(r){return(r&&r.data)||r||{};});
    });
  }).then(function(d){renderPayouts();alert('Corrected '+d.previousPlatformRef+' to '+d.platformRef+' with gross '+peso(d.gross)+'. Net receivable is now '+peso(d.net)+'. '+(d.financialPosted?'Finance Books received the balanced amount correction. ':'The reference-only change required no journal entry. ')+'Sales History and the audit trail were updated; inventory was unchanged.');})
  .catch(function(e){var m=String((e&&e.message)||(e&&e.code)||e);if(m.indexOf('cancelled')<0)alert('Could not apply pre-settlement correction: '+m);});
}
function editPayoutMetadata(payoutId){
  var payout=payoutsMap[payoutId]||{},a=A();
  if(!payoutId||!payout.id&&!payoutsMap[payoutId]){alert('This platform payout is no longer available. Refresh the portal and try again.');return;}
  if(!a||!a.setPlatformPayoutDate||!window.AccazaFormDialog){alert('Payout editing is not ready. Refresh the portal and try again.');return;}
  window.AccazaFormDialog.run({title:'Edit payout information',subtitle:'Update supporting references and notes only. The payout amount, linked orders, receiving account, and Finance Books posting will not change.',submitLabel:'Save information',busyLabel:'Saving…',fields:[
    {name:'payoutDate',label:'Actual payout date',type:'date',value:payout.payoutDate||''},
    {name:'platformStatementReference',label:'Platform statement / settlement ID',type:'text',maxLength:120,value:payout.platformStatementReference||'',placeholder:'e.g. Grab settlement ID'},
    {name:'depositReference',label:'Bank transaction / deposit reference',type:'text',maxLength:120,value:payout.depositReference||'',placeholder:'Required when the payout was deposited'},
    {name:'notes',label:'Notes',type:'textarea',maxLength:500,value:payout.notes||'',placeholder:'Optional explanation or supporting detail'}
  ]},function(v){return a.setPlatformPayoutDate({payoutId:payoutId,payoutDate:v.payoutDate||'',platformStatementReference:v.platformStatementReference||'',depositReference:v.depositReference||'',notes:v.notes||''}).then(function(r){return(r&&r.data)||r||{};});}).then(function(){(window.accazaToast||function(){})('Payout information saved. Finance Books was not changed.','ok');}).catch(function(e){var m=String((e&&e.message)||(e&&e.code)||e);if(m.indexOf('cancelled')<0)alert('Could not save payout information: '+m);});
}
function renderPayouts(){
  var root=document.getElementById('payoutsRoot');if(!root)return;
  var a=A();
  if(a){var seed={};DEFAULT_VAR_ACCOUNTS.forEach(function(d){if(!varAcctMap[d.id])seed[d.id]={name:d.name,type:d.type,order:d.order};});if(Object.keys(seed).length)a.update(a.ref(a.db,'platformVarAccounts'),seed).catch(function(){});}
  var ch=poChannel;var chLbl=(PO_CHANNELS.filter(function(d){return d.k===ch;})[0]||{lbl:ch}).lbl;
  var accs=varAccounts();
  var unset=poUnsettled(ch);
  var owingOutstandingCh=Math.round(Object.keys(payoutsMap).reduce(function(sum,k){var p=payoutsMap[k]||{};return (p.channel===ch&&!p.reversed&&(Number(p.owingOutstanding)||0)>0.009)?sum+(Number(p.owingOutstanding)||0):sum;},0)*100)/100;
  var inRange=unset.filter(function(e){var t=e.o.timestamp||0;return (!poFrom||t>=dayStart(poFrom))&&(!poTo||t<dayStart(poTo)+86400000);});
  var expected=inRange.reduce(function(s,e){return s+poNet(e.o);},0);
  var grossSum=inRange.reduce(function(s,e){return s+poGross(e.o);},0);
  var commSum=inRange.reduce(function(s,e){return s+(Number(e.o.commission)||0);},0);
  var promoSum=inRange.reduce(function(s,e){return s+poGrabDeductions(e.o).merchantPromo;},0);
  var deliveryDiscSum=inRange.reduce(function(s,e){return s+poGrabDeductions(e.o).deliveryFeeDiscount;},0);
  // receivables (all unsettled, ignoring range)
  var recvCards=PO_CHANNELS.map(function(d){var u=poUnsettled(d.k);var net=u.reduce(function(s,e){return s+poNet(e.o);},0);return '<div style="flex:1;min-width:170px;background:var(--cr);border:1px solid var(--cd);border-radius:8px;padding:0.7rem 0.9rem;"><div style="font-size:0.72rem;color:var(--tl);text-transform:uppercase;letter-spacing:0.05em;">'+esc(d.lbl)+' receivable</div><div style="font-size:1.2rem;font-weight:700;color:var(--bd);">'+peso(net)+'</div><div style="font-size:0.72rem;color:var(--tl);">'+u.length+' unsettled order(s)</div></div>';}).join('');
  inRange.sort(function(x,y){return (x.o.timestamp||0)-(y.o.timestamp||0);});
  var ordRows=inRange.length?inRange.map(function(e,i){var o=e.o,pr=o.platformRef||o.id||e.key,d=poGrabDeductions(o);return '<tr><td style="text-align:center;"><input type="checkbox" data-poinc="'+i+'" checked/></td><td>'+esc(o.date||'')+'</td><td><button type="button" data-pocorrect="'+esc(pr)+'" class="pz-btn sec" style="padding:0.18rem 0.48rem;font-size:0.75rem;border-color:#b07a2b;color:#80520f;" title="Correct this unsettled order before settlement">'+esc(pr)+'</button></td><td class="r">'+peso(poGross(o))+'</td><td class="r">'+peso(d.merchantPromo)+'</td><td class="r">'+peso(Number(o.commission)||0)+'</td><td class="r">'+peso(d.deliveryFeeDiscount)+'</td><td class="r">'+peso(poNet(o))+'</td><td class="r"><button class="pz-btn warn" data-povoid="'+esc(o.id||e.key)+'" data-povg="'+(poGross(o))+'" style="padding:0.15rem 0.5rem;font-size:0.72rem;" title="Void this order (e.g. a duplicate)">Void</button></td></tr>';}).join(''):'<tr><td colspan="9" class="az-note" style="padding:0.7rem;">No unsettled '+esc(chLbl)+' orders in this range.</td></tr>';
  var allocRows=accs.map(function(ac){var payoutSourced=ac.id==='va_refund'||ac.id==='va_refund_recovery';return '<tr><td>'+esc(ac.name)+' <span style="font-size:0.7rem;color:var(--tl);">('+ac.type+')</span>'+(payoutSourced?'<div style="font-size:0.68rem;color:var(--tl);margin-top:0.15rem;">Source is recorded automatically from this payout</div>':'')+'</td><td style="width:220px;"><div style="display:flex;gap:0.3rem;align-items:center;"><input class="pz-in" type="number" min="0" step="any" data-alloc="'+esc(ac.id)+'" data-atype="'+ac.type+'" value="" placeholder="0" style="text-align:right;"/><button class="pz-btn sec" data-allocfill="'+esc(ac.id)+'" title="Put the remaining unallocated amount here to balance" style="padding:0.15rem 0.4rem;font-size:0.72rem;white-space:nowrap;">⚖ Fill</button></div></td></tr>';}).join('');
  var hist=Object.keys(payoutsMap).map(function(k){return Object.assign({id:k},payoutsMap[k]);}).filter(function(p){return p.channel===ch;}).sort(function(a,b){return (b.settledAt||0)-(a.settledAt||0);});
  var histRows=hist.length?hist.map(function(p){var reference=p.depositReference||p.platformStatementReference||'—',edit='<button class="pz-btn sec" data-poedit="'+esc(p.id)+'" style="padding:0.15rem 0.5rem;font-size:0.72rem;" title="Edit statement, bank reference and notes">Edit info</button>';return '<tr'+(p.reversed?' style="opacity:0.6;"':'')+'><td>'+esc(new Date(p.settledAt||0).toLocaleDateString('en-PH',{year:'numeric',month:'short',day:'numeric'}))+'</td><td>'+(p.reversed?(p.payoutDate?esc(p.payoutDate):'—'):'<input type="date" class="pz-in" data-podate="'+esc(p.id)+'" value="'+esc(p.payoutDate||'')+'" style="padding:0.15rem 0.35rem;font-size:0.74rem;width:140px;" title="Actual payout date from the platform statement"/>')+'</td><td>'+esc(reference)+'</td><td class="r">'+peso(p.expectedNet)+'</td><td class="r">'+peso(p.actualPayout)+'</td><td class="r '+((Number(p.variance)||0)<0?'az-down':(Number(p.variance)||0)>0?'az-up':'')+'">'+peso(p.variance)+'</td><td class="r">'+((p.orderIds||[]).length)+'</td><td class="r">'+edit+' '+(p.reversed?'<span style="color:var(--tl);font-size:0.72rem;">reversed</span>':'<button class="pz-btn sec" data-porev="'+esc(p.id)+'" style="padding:0.15rem 0.5rem;font-size:0.72rem;border-color:#b46a3a;color:#8a4a1a;" title="Reverse this settlement — orders return to unsettled">Reverse</button>')+'</td></tr>';}).join(''):'<tr><td colspan="8" class="az-note" style="padding:0.6rem;">No payouts settled yet for '+esc(chLbl)+'.</td></tr>';

  var html='<div class="pz-h">💱 Platform Payout Reconciliation</div>'
    +'<p class="pz-sub">Weekly truth-up per platform. POS gross is booked as revenue and the flat commission as expense; here you enter the <b>actual payout</b> from Grab/Panda and allocate the difference to named accounts. Every peso is explained.</p>'
    +'<div style="display:flex;gap:0.7rem;flex-wrap:wrap;margin-bottom:1rem;">'+recvCards+'</div>'
    +'<div class="pz-card" style="margin-bottom:1rem;">'
      +'<div style="display:flex;gap:0.8rem;flex-wrap:wrap;align-items:end;margin-bottom:0.8rem;">'
        +'<div><span class="pz-lbl">Platform</span><select class="pz-in" id="poCh">'+PO_CHANNELS.map(function(d){return '<option value="'+d.k+'"'+(d.k===ch?' selected':'')+'>'+d.lbl+'</option>';}).join('')+'</select></div>'
        +'<div><span class="pz-lbl">From</span><input type="date" class="pz-in" id="poFrom" value="'+(poFrom||'')+'"/></div>'
        +'<div><span class="pz-lbl">To</span><input type="date" class="pz-in" id="poTo" value="'+(poTo||'')+'"/></div>'
        +'<div style="font-size:0.74rem;color:var(--tl);">Leave dates blank to reconcile <b>all</b> unsettled '+esc(chLbl)+' orders.</div>'
        +'<div style="margin-left:auto;display:flex;gap:0.4rem;flex-wrap:wrap;"><button class="pz-btn sec" id="poCorrect" style="border-color:#b07a2b;color:#80520f;">✎ Pre-settlement correction</button><button class="pz-btn sec" id="poReKey" style="border-color:#3a8a6a;color:#256b52;">➕ Re-key missed order</button></div>'
      +'</div>'
      +'<details style="margin-bottom:0.6rem;"><summary style="cursor:pointer;font-weight:600;color:var(--bd);font-size:0.85rem;">📄 Match to payout statement (optional)</summary>'
        +'<div style="margin-top:0.4rem;"><span class="pz-lbl">Paste the order numbers from the '+esc(chLbl)+' payout report (one per line or comma-separated)</span><textarea class="pz-in" id="poStmt" rows="3" placeholder="'+(ch==='grabfood'?'GF-123456, GF-123457, GF-123460':'FP-123456, FP-123457')+'" style="width:100%;font-size:0.8rem;"></textarea><button class="pz-btn sec" id="poMatch" style="margin-top:0.4rem;">Match &amp; tick</button><div id="poMatchInfo" style="font-size:0.78rem;margin-top:0.4rem;"></div></div></details>'
      +'<p class="pz-sub" style="margin-top:0;">Tick only the orders that appear on <b>this</b> payout statement. Untick any that aren’t paid this cycle — they stay unsettled and roll to the next payout automatically.</p>'
      +'<table class="pnl-tbl"><thead><tr><th style="text-align:center;"><input type="checkbox" id="poAll" checked title="Select all"/></th><th>Date</th><th>Order #</th><th class="r">Gross</th><th class="r">Merchant promo</th><th class="r">Commission</th><th class="r">Delivery discount</th><th class="r">Expected net</th><th></th></tr></thead><tbody>'+ordRows
        +'<tr class="tot"><td></td><td colspan="2">Expected net (<span id="poCount">'+inRange.length+'</span> ticked)</td><td class="r" id="poGrossSum">'+peso(grossSum)+'</td><td class="r" id="poPromoSum">'+peso(promoSum)+'</td><td class="r" id="poCommSum">'+peso(commSum)+'</td><td class="r" id="poDeliveryDiscSum">'+peso(deliveryDiscSum)+'</td><td class="r" id="poExpected">'+peso(expected)+'</td><td></td></tr>'
      +'</tbody></table>'
      +(owingOutstandingCh>0?('<div style="margin-top:0.7rem;padding:0.55rem 0.75rem;border:1px solid #e6c07a;background:#fff8e8;border-radius:8px;font-size:0.8rem;color:#8a5a00;">⚠ Outstanding owing to '+esc(chLbl)+': <b>'+peso(owingOutstandingCh)+'</b> — this will be auto-netted from this payout.</div>'):'')
      +'<p class="pz-sub" style="margin:0.6rem 0 0;">Enter the <b>actual amount received</b>. Merchant promo, commission, and delivery fee discount above already reduce expected net and must not be entered again. Enter Grab <b>marketing success fee</b> and <b>advertisements</b> in the settlement allocations below. If penalties made the payout negative, the shortfall is recorded as owing and recovered from the next payout.</p>'
      +'<div style="display:flex;gap:0.8rem;flex-wrap:wrap;align-items:end;margin-top:0.9rem;">'
        +'<div><span class="pz-lbl">Actual payout received</span><input class="pz-in" type="number" step="any" id="poActual" placeholder="0" style="text-align:right;width:180px;"/></div>'
        +'<div style="align-self:center;"><span class="pz-lbl">Variance (actual − expected)</span><div id="poVariance" style="font-weight:700;font-size:1.05rem;">'+peso(0-expected)+'</div></div>'
      +'</div>'
      +'<div class="az-sec" style="margin-top:0.9rem;">Allocate the variance</div>'
      +'<p class="pz-sub" style="margin-top:0.2rem;">Enter positive amounts. Expense accounts reduce the payout; revenue accounts add. The allocations must equal the variance before you can settle.</p>'
      +'<table class="pz-tbl"><thead><tr><th>Account</th><th>Amount ₱</th></tr></thead><tbody>'+allocRows+'</tbody></table>'
      +'<div id="poBalance" style="margin-top:0.6rem;font-weight:600;"></div>'
      +'<button class="pz-btn ok" id="poSettle" style="margin-top:0.7rem;padding:0.6rem 1.2rem;">Save &amp; settle '+esc(chLbl)+' payout</button>'
    +'</div>'
    +'<details style="margin-bottom:1rem;"><summary style="cursor:pointer;font-weight:600;color:var(--bd);">⚙️ Manage variance accounts</summary>'
      +'<div class="pz-card" style="margin-top:0.5rem;"><table class="pz-tbl"><tbody>'
        +accs.map(function(ac){return '<tr><td><input class="pz-in" data-acname="'+esc(ac.id)+'" value="'+esc(ac.name)+'"/></td><td style="width:130px;"><select class="pz-in" data-actype="'+esc(ac.id)+'"><option value="expense"'+(ac.type==='expense'?' selected':'')+'>expense</option><option value="revenue"'+(ac.type==='revenue'?' selected':'')+'>revenue</option></select></td><td style="width:60px;"><button class="pz-btn warn" data-acdel="'+esc(ac.id)+'" style="padding:0.2rem 0.5rem;">✕</button></td></tr>';}).join('')
        +'</tbody></table>'
        +'<div style="display:flex;gap:0.5rem;align-items:end;margin-top:0.6rem;flex-wrap:wrap;"><div><span class="pz-lbl">New account</span><input class="pz-in" id="poNewName" placeholder="e.g. FX adjustment" style="width:200px;"/></div><div><span class="pz-lbl">Type</span><select class="pz-in" id="poNewType"><option value="expense">expense</option><option value="revenue">revenue</option></select></div><button class="pz-btn sec" id="poAddAcc">+ Add</button><button class="pz-btn sec" id="poSaveAcc" style="margin-left:auto;">💾 Save account edits</button></div>'
      +'</div></details>'
    +'<div class="az-sec">Settled payouts — '+esc(chLbl)+'</div>'
    +'<div class="pz-card"><table class="pnl-tbl"><thead><tr><th>Settled</th><th>Payout date</th><th>Reference</th><th class="r">Expected</th><th class="r">Actual</th><th class="r">Variance</th><th class="r">Orders</th><th></th></tr></thead><tbody>'+histRows+'</tbody></table></div>';
  root.innerHTML=html;

  document.getElementById('poCh').onchange=function(){poChannel=this.value;renderPayouts();};
  document.getElementById('poFrom').onchange=function(){poFrom=this.value||null;renderPayouts();};
  document.getElementById('poTo').onchange=function(){poTo=this.value||null;renderPayouts();};
  var _rk=document.getElementById('poReKey'); if(_rk)_rk.onclick=function(){reKeyMissedOrder(ch,chLbl);};
  var _pc=document.getElementById('poCorrect'); if(_pc){_pc.disabled=!inRange.length;_pc.title=inRange.length?'Choose an unsettled order to correct':'No unsettled orders in the current list';_pc.onclick=function(){correctPlatformPresettlement(ch,chLbl,null,inRange);};}
  root.querySelectorAll('[data-pocorrect]').forEach(function(b){b.onclick=function(){correctPlatformPresettlement(ch,chLbl,b.getAttribute('data-pocorrect'));};});
  root.querySelectorAll('[data-povoid]').forEach(function(b){b.onclick=function(){voidPayoutOrder(b.getAttribute('data-povoid'),Number(b.getAttribute('data-povg'))||0);};});
  root.querySelectorAll('[data-porev]').forEach(function(b){b.onclick=function(){reversePayout(b.getAttribute('data-porev'),chLbl);};});
  root.querySelectorAll('[data-poedit]').forEach(function(b){b.onclick=function(){editPayoutMetadata(b.getAttribute('data-poedit'));};});
  root.querySelectorAll('[data-podate]').forEach(function(inp){inp.onchange=function(){var pid=inp.getAttribute('data-podate'),val=inp.value||'';var a=A();if(!a||!a.setPlatformPayoutDate){alert('Service unavailable. Refresh the portal.');return;}inp.disabled=true;a.setPlatformPayoutDate({payoutId:pid,payoutDate:val}).then(function(){if(payoutsMap[pid])payoutsMap[pid].payoutDate=val;(window.accazaToast||function(){})('Payout date saved.','ok');}).catch(function(e){alert('Could not save payout date: '+((e&&e.message)||e));}).finally(function(){inp.disabled=false;});};});
  var pendingPayoutId='';try{pendingPayoutId=sessionStorage.getItem('accazaOpenPayoutMetadata')||'';if(pendingPayoutId)sessionStorage.removeItem('accazaOpenPayoutMetadata');}catch(e){}if(pendingPayoutId)setTimeout(function(){editPayoutMetadata(pendingPayoutId);},0);
  function allocSum(){var rev=0,exp=0;root.querySelectorAll('[data-alloc]').forEach(function(i){var v=Number(i.value)||0;if(i.getAttribute('data-atype')==='revenue')rev+=v;else exp+=v;});return rev-exp;}
  function recompute(){var actual=Number((document.getElementById('poActual')||{}).value)||0;var variance=Math.round((actual-expected)*100)/100;var owingApply=(actual>=0)?owingOutstandingCh:0;var target=Math.round((variance+owingApply)*100)/100;var vEl=document.getElementById('poVariance');if(vEl){vEl.textContent=peso(variance);vEl.style.color=variance<0?'#c0392b':variance>0?'#2a9d5c':'var(--td)';}var alloc=Math.round(allocSum()*100)/100;var diff=Math.round((target-alloc)*100)/100;var bEl=document.getElementById('poBalance');var ok=Math.abs(diff)<0.01;if(bEl){bEl.innerHTML=(owingApply>0?('Prior owing '+peso(owingApply)+' auto-netted. '):'')+(actual<0?('Negative payout — '+peso(-actual)+' recorded as owing to '+esc(chLbl)+'. '):'')+'Allocate '+peso(target)+' (adjustments/penalties) — allocated '+peso(alloc)+' '+(ok?'<span style="color:#2a9d5c;">✓ balanced</span>':'<span style="color:#c0392b;">off by '+peso(diff)+' — click ⚖ Fill on your adjustment account</span>');}return ok;}
  var _pa=document.getElementById('poActual');if(_pa)_pa.oninput=recompute;
  root.querySelectorAll('[data-alloc]').forEach(function(i){i.oninput=recompute;});
  function allocTarget(){var actual=Number((document.getElementById('poActual')||{}).value)||0;var variance=Math.round((actual-expected)*100)/100;var owingApply=(actual>=0)?owingOutstandingCh:0;return Math.round((variance+owingApply)*100)/100;}
  function fillAlloc(id){var inp=root.querySelector('[data-alloc="'+id+'"]');if(!inp)return;var atype=inp.getAttribute('data-atype');var gap=Math.round((allocTarget()-Math.round(allocSum()*100)/100)*100)/100;var cur=Number(inp.value)||0;var nv=Math.round(((atype==='revenue')?(cur+gap):(cur-gap))*100)/100;if(nv<-0.005){alert('The remaining balance goes the other way — a '+atype+' account can’t hold it. Use a '+(atype==='expense'?'revenue':'expense')+' account (or check the actual payout you entered).');return;}inp.value=nv?nv:'';recompute();}
  root.querySelectorAll('[data-allocfill]').forEach(function(b){b.onclick=function(){fillAlloc(b.getAttribute('data-allocfill'));};});
  function selectedEntries(){return inRange.filter(function(e,i){var cb=root.querySelector('[data-poinc="'+i+'"]');return cb&&cb.checked;});}
  function recomputeSel(){var g=0,p=0,c=0,d=0,n=0,cnt=0;inRange.forEach(function(e,i){var cb=root.querySelector('[data-poinc="'+i+'"]');if(cb&&cb.checked){var parts=poGrabDeductions(e.o);g+=poGross(e.o);p+=parts.merchantPromo;c+=(Number(e.o.commission)||0);d+=parts.deliveryFeeDiscount;n+=poNet(e.o);cnt++;}});expected=Math.round(n*100)/100;grossSum=g;promoSum=p;commSum=c;deliveryDiscSum=d;var gEl=document.getElementById('poGrossSum');if(gEl)gEl.textContent=peso(g);var pEl=document.getElementById('poPromoSum');if(pEl)pEl.textContent=peso(p);var cEl=document.getElementById('poCommSum');if(cEl)cEl.textContent=peso(c);var dEl=document.getElementById('poDeliveryDiscSum');if(dEl)dEl.textContent=peso(d);var eEl=document.getElementById('poExpected');if(eEl)eEl.textContent=peso(expected);var ctEl=document.getElementById('poCount');if(ctEl)ctEl.textContent=cnt;recompute();}
  root.querySelectorAll('[data-poinc]').forEach(function(cb){cb.onchange=recomputeSel;});
  var poAll=document.getElementById('poAll');if(poAll)poAll.onchange=function(){var ck=this.checked;root.querySelectorAll('[data-poinc]').forEach(function(cb){cb.checked=ck;});recomputeSel();};
  var pmB=document.getElementById('poMatch');if(pmB)pmB.onclick=function(){
    var raw=(document.getElementById('poStmt').value||'');
    var refs=raw.split(/[\n,;\t ]+/).map(function(s){return s.trim();}).filter(Boolean);
    if(!refs.length){alert('Paste the payout order numbers first.');return;}
    var stmtMatched={}, matchedInRange=0;
    inRange.forEach(function(e,i){var cb=root.querySelector('[data-poinc="'+i+'"]');if(!cb)return;var hit=false;refs.forEach(function(r,ri){if(refEq(r,e.o.platformRef)||refEq(r,e.o.id)){hit=true;stmtMatched[ri]=1;}});cb.checked=hit;if(hit)matchedInRange++;});
    recomputeSel();
    var allE=platEntries().filter(function(e){return e.o.channel===ch;});
    var unmatched=refs.filter(function(r,ri){return !stmtMatched[ri];});
    var rows=unmatched.map(function(r){var e=allE.filter(function(en){return refEq(r,en.o.platformRef)||refEq(r,en.o.id);})[0];var reason;if(!e)reason='<span style="color:#c0392b;">not in POS — possible missed re-key</span>';else if((e.o.settlementStatus||'unsettled')==='settled')reason='<span style="color:var(--tl);">already settled</span>';else reason='<span style="color:#8a6d1b;">unsettled but outside the current dates — widen the range, then re-match</span>';return '<div>• '+esc(r)+' — '+reason+'</div>';}).join('');
    var info=document.getElementById('poMatchInfo');if(info)info.innerHTML='<b>'+matchedInRange+'</b> of '+refs.length+' statement order(s) matched &amp; ticked here.'+(unmatched.length?('<div style="margin-top:0.3rem;font-weight:600;">'+unmatched.length+' not matched in the list above:</div>'+rows):' <span style="color:#2a9d5c;">all matched ✓</span>');
  };
  recomputeSel();
  document.getElementById('poSettle').onclick=function(){
    var selected=selectedEntries();
    if(!selected.length){alert('Tick at least one order that appears on this payout statement.');return;}
    var actual=Number((document.getElementById('poActual').value)||0);
    if(!recompute()){alert('Allocations must equal the variance before you can settle.');return;}
    if(!window.AccazaFormDialog){alert('Form service unavailable. Refresh the portal.');return;}
    var allocs={};root.querySelectorAll('[data-alloc]').forEach(function(i){var id=i.getAttribute('data-alloc'),v=Number(i.value)||0;if(v)allocs[id]=v;});
    var pid=uid('po_');
    var left=inRange.length-selected.length;
    var a2=A();if(!a2.settlePlatformPayout||!a2.managerApproval){alert('3D payout approval service is not available. Refresh the portal.');return;}
    var destinations=Object.keys(payoutCashAccounts).map(function(id){return Object.assign({id:id},payoutCashAccounts[id]||{});}).filter(function(x){return x.active!==false;}).sort(function(a,b){return (a.order||0)-(b.order||0)||String(a.name||'').localeCompare(String(b.name||''));});
    if(actual>0&&!destinations.length){alert('Add the receiving bank or GCash account in Finance / Books → Cash Flow before settling this payout.');return;}
    var defaultDestination='';if(ch==='grabfood'){var union=destinations.find(function(x){return /union\s*bank/i.test(String(x.name||''));});defaultDestination=union?union.id:'';}else{var panda=destinations.find(function(x){return /food\s*panda/i.test(String(x.name||''));});defaultDestination=panda?panda.id:'';}
    window.AccazaFormDialog.run({
      title:'Settle '+chLbl+' payout',
      subtitle:'Enter the payout date and select the account that actually received the money. Settlement and bank deposit post together. '+selected.length+' order(s), actual '+peso(actual)+'.',
      submitLabel:'Save & settle',
      busyLabel:'Settling…',
      fields:[{name:'payoutDate',label:'Payout date',type:'date',required:true}].concat(actual>0?[{name:'destinationAccountId',label:'Deposited directly to',type:'select',required:true,value:defaultDestination,options:[{value:'',label:'— select receiving account —'}].concat(destinations.map(function(x){return{value:x.id,label:(x.name||x.id)+' · '+(x.type||'cash account')};})),help:ch==='grabfood'?'Select Union Bank unless the Grab statement shows a different receiving account.':'Select the dedicated FoodPanda GCash account.'}]:[])
    },function(v){
      return a2.managerApproval('settle_platform_payout',pid,actual,'Settle '+chLbl+' payout').then(function(ap){
        return a2.settlePlatformPayout({payoutId:pid,channel:ch,periodStart:(poFrom||''),periodEnd:(poTo||''),actualPayout:actual,allocations:allocs,orderIds:selected.map(function(e){return e.o.id||e.key;}),payoutDate:v.payoutDate,destinationAccountId:v.destinationAccountId||'',approvalId:ap.approvalId});
      }).then(function(r){return (r&&r.data)||r||{};});
    }).then(function(d){
      selected.forEach(function(e){var mp=(e.node==='archivedOrders')?archMap:ordersMap;var k=(e.o&&e.o.id)||e.key;if(mp[k])mp[k].settlementStatus='settled';});
      renderPayouts();
      alert('Settled '+(d.orderCount||0)+' '+chLbl+' order(s).'+(d.depositMovementId?' The actual payout was posted directly to the selected receiving account.':'')+(left>0?(' '+left+' left unticked stay unsettled and carry to the next payout.'):'')+((Number(d.owingCreated)||0)>0?(' '+peso(d.owingCreated)+' recorded as owing to '+chLbl+' (recovered next payout).'):'')+((Number(d.owingApplied)||0)>0?(' Prior owing '+peso(d.owingApplied)+' auto-netted.'):'')+' Server variance '+peso(d.variance)+' posted to the audit ledger.');
    }).catch(function(err){var m=String((err&&err.message)||(err&&err.code)||err);if(m.indexOf('cancelled')<0)alert('Could not settle payout: '+m+'. Nothing was settled.');});
  };
  var _add=document.getElementById('poAddAcc');if(_add)_add.onclick=function(){var nm=(document.getElementById('poNewName').value||'').trim();if(!nm){alert('Type an account name.');return;}var t=document.getElementById('poNewType').value;var a3=A();a3.set(a3.ref(a3.db,'platformVarAccounts/'+uid('va_')),{name:nm,type:t,order:accs.length+1}).then(function(){});};
  var _sav=document.getElementById('poSaveAcc');if(_sav)_sav.onclick=function(){var a4=A();var ups={};root.querySelectorAll('[data-acname]').forEach(function(i){var id=i.getAttribute('data-acname');var nm=(i.value||'').trim();var tp=(root.querySelector('[data-actype="'+id+'"]')||{}).value||'expense';if(nm)ups[id]={name:nm,type:tp,order:(varAcctMap[id]&&varAcctMap[id].order)||0};});a4.update(a4.ref(a4.db,'platformVarAccounts'),ups).then(function(){alert('Account edits saved.');});};
  root.querySelectorAll('[data-acdel]').forEach(function(b){b.onclick=function(){var id=b.getAttribute('data-acdel');if(!confirm('Remove this variance account? Past settled payouts keep their figures.'))return;var a5=A();a5.remove(a5.ref(a5.db,'platformVarAccounts/'+id));};});
}
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
/* ══════════ STOCK VALUE / STOCK CARD ══════════ */
function svRange(){var f=svFrom,t=svTo;if(!f&&!t){var d=new Date();f=new Date(d.getFullYear(),d.getMonth(),1);f=f.getFullYear()+'-'+pad(f.getMonth()+1)+'-'+pad(f.getDate());t=new Date();t=t.getFullYear()+'-'+pad(t.getMonth()+1)+'-'+pad(t.getDate());}return {f:f||'',t:t||''};}
function fq(n){n=Number(n)||0;return (Math.round(n*1000)/1000).toLocaleString('en-PH');}
function invItems(){return Object.keys(invMap).map(function(k){return Object.assign({id:k},invMap[k]);}).sort(function(a,b){return (a.name||'').localeCompare(b.name||'');});}
function tsToDate(ts){var d=new Date(ts||0);return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());}
function inRng(d,rng){return (!rng.f||d>=rng.f)&&(!rng.t||d<=rng.t);}
function itemPeriod(id,cost,rng){var pQ=0,pV=0,uQ=0;
  Object.keys(receiptsMap).forEach(function(k){var r=receiptsMap[k];if(!r||r.ing!==id)return;var d=r.date||tsToDate(r.ts);if(inRng(d,rng)){pQ+=Number(r.qty)||0;pV+=Number(r.total)||0;}});
  [ordersMap,archMap].forEach(function(m){Object.keys(m).forEach(function(k){var o=m[k];if(!isSale(o)||!o.inventoryUsage||!o.inventoryUsage[id])return;var d=tsToDate(o.timestamp||Date.parse(o.date)||0);if(inRng(d,rng))uQ+=Number(o.inventoryUsage[id])||0;});});
  Object.keys(usageMap).forEach(function(k){var u=usageMap[k];if(!u||u.reversed||!u.usage||!u.usage[id])return;var d=tsToDate(u.ts);if(inRng(d,rng))uQ+=Number(u.usage[id])||0;});
  return {pQ:pQ,pV:pV,uQ:uQ,uV:uQ*(Number(cost)||0)};
}
function itemMovements(id){
  var cost=Number((invMap[id]||{}).cost)||0;var out=[];
  Object.keys(receiptsMap).forEach(function(k){var r=receiptsMap[k];if(!r||r.ing!==id)return;out.push({ts:r.ts||Date.parse(r.date)||0,date:r.date||tsToDate(r.ts),type:'Purchase'+(r.supplier?' · '+r.supplier:'')+(r.brand?' · '+r.brand:''),in:Number(r.qty)||0,out:0});});
  Object.keys(adjMap).forEach(function(k){var x=adjMap[k];if(!x||x.ing!==id)return;var dl=Number(x.delta)||0;out.push({ts:x.ts||0,date:tsToDate(x.ts),type:'Adjust · '+(x.reason||''),in:dl>0?dl:0,out:dl<0?-dl:0});});
  Object.keys(usageMap).forEach(function(k){var u=usageMap[k];if(!u||u.reversed||!u.usage||!u.usage[id])return;out.push({ts:u.ts||0,date:tsToDate(u.ts),type:'Usage · '+(u.kindName||u.kind||''),in:0,out:Number(u.usage[id])||0});});
  var byDay={};[ordersMap,archMap].forEach(function(m){Object.keys(m).forEach(function(k){var o=m[k];if(!isSale(o)||!o.inventoryUsage||!o.inventoryUsage[id])return;var day=tsToDate(o.timestamp||Date.parse(o.date)||0);byDay[day]=(byDay[day]||0)+(Number(o.inventoryUsage[id])||0);});});
  Object.keys(byDay).forEach(function(day){out.push({ts:new Date(day+'T12:00:00').getTime(),date:day,type:'Sales usage',in:0,out:byDay[day]});});
  out.sort(function(a,b){return (a.ts||0)-(b.ts||0);});return out;
}
function roundQty(n){return Math.round((Number(n)||0)*1000)/1000;}
function isWasteMovement(m){return /waste|wastage|spoil|expired|damage|variance|shrink|adjust/i.test(String(m.type||''));}
function itemReconciliation(id,rng){
  var movements=itemMovements(id);var current=Number((invMap[id]||{}).stock)||0;
  var fromTs=rng.f?localDateValue(rng.f):-Infinity;var toTs=rng.t?addDays(localDateValue(rng.t),1):Infinity;
  var ending=current;
  movements.forEach(function(m){if((Number(m.ts)||0)>=toTs)ending-=((Number(m.in)||0)-(Number(m.out)||0));});
  var received=0,issued=0,adjustment=0;
  movements.forEach(function(m){var ts=Number(m.ts)||0;if(ts<fromTs||ts>=toTs)return;
    if(/^Purchase/i.test(m.type||''))received+=Number(m.in)||0;
    else if(isWasteMovement(m))adjustment+=(Number(m.in)||0)-(Number(m.out)||0);
    else issued+=Number(m.out)||0;
  });
  ending=roundQty(ending);received=roundQty(received);issued=roundQty(issued);adjustment=roundQty(adjustment);
  return {beginning:roundQty(ending-received+issued-adjustment),received:received,issued:issued,adjustment:adjustment,ending:ending};
}
function signedQty(n){n=roundQty(n);return n?(n>0?'+':'')+fq(n):'—';}
function inventoryBooksReconciliation(summaries,rng){
  var itemRows=summaries.map(function(x){return{id:x.item.id,name:x.item.name,inventoryAccount:x.item.inventoryAccount,quantity:x.flow.ending,unitCost:Number(x.item.cost)||0};});
  var journal=Object.keys(inventoryBooksJournal).map(function(k){return Object.assign({id:k},inventoryBooksJournal[k]||{});});
  return reconcileInventoryBooks(itemRows,journal,rng.t||'9999-12-31');
}
function inventoryReconciliationHtml(recon,ready,history){
  if(!ready)return '<div class="pz-card" style="margin-bottom:0.8rem;border-left:4px solid #b08d57;"><b>Inventory-to-Books reconciliation</b><div class="az-note" style="margin-top:0.35rem;">Preparing the authoritative Finance Books journal… No partial balance is presented as final.</div></div>';
  var roundingOnly=recon.balanced&&Math.abs(recon.totals.difference)>=0.005,status=recon.balanced?'<span style="color:#267354;">✓ Reconciled'+(roundingOnly?' · within ₱0.01 rounding tolerance':'')+'</span>':'<span style="color:#b44336;">⚠ Not reconciled</span>';
  var rows=recon.rows.map(function(r){var diff=r.difference,within=r.withinTolerance===true,meaning=Math.abs(diff)<0.005?'Balanced':(within?'Within rounding tolerance':(diff>0?'Stock valuation is higher':'Books balance is higher'));return '<tr><td><b>'+esc(r.code)+'</b> · '+esc(r.name)+'</td><td class="r">'+r.itemCount+'</td><td class="r">'+peso(r.stockValue)+'</td><td class="r">'+peso(r.booksValue)+'</td><td class="r" style="font-weight:700;color:'+(within?'#267354':'#b44336')+';">'+peso(diff)+'</td><td>'+meaning+'</td></tr>';}).join('');
  var action=!recon.balanced&&recon.unmappedCount===0?'<div style="margin-top:.75rem;"><button class="pz-btn" id="inventoryOpeningBalanceBtn">Post / re-post opening inventory balance</button><div class="az-note" style="margin-top:.35rem;">Server recalculates every amount and records the actor. If an opening balance was already posted, this reverses it and posts a clean one so Books match physical stock.</div></div>':'';
  return '<div class="pz-card" style="margin-bottom:0.8rem;"><div style="display:flex;justify-content:space-between;gap:0.6rem;flex-wrap:wrap;"><div><b>Inventory-to-Books reconciliation</b><div class="az-note">As of the selected To date · Difference = stock-item valuation − Finance Books balance.</div></div><div style="font-weight:700;">'+status+'</div></div><div style="overflow-x:auto;margin-top:0.7rem;"><table class="pz-tbl"><thead><tr><th>Inventory account</th><th class="r">Items</th><th class="r">Stock valuation</th><th class="r">Books balance</th><th class="r">Difference</th><th>Meaning</th></tr></thead><tbody>'+rows+'<tr style="font-weight:700;"><td>TOTAL</td><td></td><td class="r">'+peso(recon.totals.stockValue)+'</td><td class="r">'+peso(recon.totals.booksValue)+'</td><td class="r">'+peso(recon.totals.difference)+'</td><td>'+(recon.balanced?'Balanced':'Requires reconciliation')+'</td></tr></tbody></table></div><div class="az-note" style="margin-top:0.65rem;">Positive difference means stock valuation exceeds Books and needs an inventory debit or source repair. Negative difference means Books exceeds physical stock. Unmapped items: '+recon.unmappedCount+' · Receiving clearing 1290: '+peso(recon.clearingBalance)+'.</div>'+action+'</div>';
}
function postInventoryOpeningBalance(rng,btn){
  if(rng.t!==tsToDate(Date.now())){alert('Set the To date to today before posting the current opening inventory balance.');return;}
  var commandId=uid('invopen_');btn.disabled=true;btn.textContent='Preparing server preview\u2026';
  A().postFinancialCommand({action:'inventory_opening_balance',commandId:commandId,preview:true,date:rng.t}).then(function(r){r=r&&r.data?r.data:r||{};
    var reposting=!!r.alreadyPosted;
    var active=(r.rows||[]).filter(function(x){return Math.abs(Number(x.difference)||0)>=.005;}),
        detail=active.map(function(x){return x.code+' '+(x.difference>0?'Debit ':'Credit ')+peso(Math.abs(x.difference));}).join('\n'),
        offset=(r.totalDifference>=0?'Credit ':'Debit ')+peso(Math.abs(r.totalDifference));
    var message=(reposting?'RE-POST opening inventory balance? This reverses the prior opening and posts a clean one so Books match physical stock.':'Post the ONE-TIME opening inventory balance?')
      +'\n\nStock value: '+peso(r.totalStock)+'\nBooks before: '+peso(r.totalBooks)+'\nNet adjustment: '+peso(r.totalDifference)+'\n\n'+detail+'\n3900/Opening equity '+offset;
    if(!confirm(message)){btn.disabled=false;btn.textContent='Post / re-post opening inventory balance';return null;}
    btn.textContent=reposting?'Re-posting\u2026':'Posting\u2026';
    var payload=reposting?{action:'inventory_opening_balance_repost',commandId:commandId,date:rng.t}:{action:'inventory_opening_balance',commandId:commandId,date:rng.t,expectedDifference:r.totalDifference};
    return A().postFinancialCommand(payload);
  }).then(function(r){if(!r)return;r=r&&r.data?r.data:r||{};alert('Opening inventory balance '+(r.reposted?'re-posted':'posted')+'.\nAdjustment: '+peso(r.adjustment)+'\nMovement: '+r.movementId+'\n\nFinance Books will refresh automatically.');}).catch(function(e){alert('Opening inventory balance was not posted: '+((e&&e.message)||(e&&e.code)||e));btn.disabled=false;btn.textContent='Post / re-post opening inventory balance';});
}
function renderStockValue(){
  var root=document.getElementById('stockValueRoot');if(!root)return;
  var rng=svRange();var items=invItems();
  var summaries=items.map(function(i){return {item:i,flow:itemReconciliation(i.id,rng)};});
  var history={loaded:Object.keys(inventoryBooksJournal).length,hasOlder:false};
  var reconReady=inventoryBooksLoaded;
  var recon=reconReady?inventoryBooksReconciliation(summaries,rng):null;
  var totalValue=summaries.reduce(function(s,x){return s+x.flow.ending*(Number(x.item.cost)||0);},0);
  var periodPurch=0;Object.keys(receiptsMap).forEach(function(k){var r=receiptsMap[k];if(!r)return;var d=r.date||tsToDate(r.ts);if(inRng(d,rng))periodPurch+=Number(r.total)||0;});
  var periodUse=0;[ordersMap,archMap].forEach(function(m){Object.keys(m).forEach(function(k){var o=m[k];if(!isSale(o))return;var d=tsToDate(o.timestamp||Date.parse(o.date)||0);if(inRng(d,rng))periodUse+=Number(o.cogsSnapshot)||0;});});
  Object.keys(usageMap).forEach(function(k){var u=usageMap[k];if(!u||u.reversed)return;var d=tsToDate(u.ts);if(inRng(d,rng))periodUse+=Number(u.cost)||0;});
  var rows=summaries.map(function(x){var i=x.item,f=x.flow,cost=Number(i.cost)||0,val=f.ending*cost,unit=esc(i.unit||'');
    return '<tr><td><b>'+esc(i.name)+'</b><div class="az-note">'+unit+'</div></td><td class="r">'+fq(f.beginning)+'</td><td class="r" style="color:#267354;font-weight:600;">'+(f.received?fq(f.received):'—')+'</td><td class="r" style="color:#b44336;font-weight:600;">'+(f.issued?fq(f.issued):'—')+'</td><td class="r" style="color:#9a6700;font-weight:600;">'+signedQty(f.adjustment)+'</td><td class="r" style="font-weight:700;">'+fq(f.ending)+'</td><td class="r">'+peso(val)+'</td><td class="r">'+peso(cost)+'</td><td class="r"><button class="pz-btn sec" data-svcard="'+esc(i.id)+'" style="padding:0.2rem 0.55rem;white-space:nowrap;">Stock card</button></td></tr>';
  }).join('');
  var html='<div class="pz-h">📊 Inventory</div><p class="pz-sub">Financial inventory reconciliation for the selected period. Beginning balance + stock received − stock issued or consumed ± adjustment and wastage = ending balance. Ending value uses the current cost per unit.</p>'
    +'<div style="display:flex;gap:0.7rem;flex-wrap:wrap;margin-bottom:0.8rem;">'
      +'<div class="pz-card" style="flex:1;min-width:170px;"><div style="font-size:0.72rem;color:var(--tl);">Ending inventory value</div><div style="font-size:1.25rem;font-weight:700;color:var(--bd);">'+peso(totalValue)+'</div></div>'
      +'<div class="pz-card" style="flex:1;min-width:170px;"><div style="font-size:0.72rem;color:var(--tl);">Purchases (period)</div><div style="font-size:1.25rem;font-weight:700;color:#2a9d5c;">'+peso(periodPurch)+'</div></div>'
      +'<div class="pz-card" style="flex:1;min-width:170px;"><div style="font-size:0.72rem;color:var(--tl);">Usage / COGS (period)</div><div style="font-size:1.25rem;font-weight:700;color:#c0392b;">'+peso(periodUse)+'</div></div>'
    +'</div>'+inventoryReconciliationHtml(recon,reconReady,history)
    +'<div style="display:flex;gap:0.5rem;align-items:end;flex-wrap:wrap;margin-bottom:0.8rem;"><div><span class="pz-lbl">From</span><input class="pz-in" id="svFrom" type="date" value="'+rng.f+'"/></div><div><span class="pz-lbl">To</span><input class="pz-in" id="svTo" type="date" value="'+rng.t+'"/></div><button class="pz-btn sec" id="svExport" style="padding:0.3rem 0.7rem;">⬇ Excel</button></div>'
    +'<div class="pz-card"><div style="overflow-x:auto;"><table class="pz-tbl"><thead><tr><th>Item</th><th class="r" title="Balance immediately before the selected period">Beginning balance</th><th class="r">Stock received</th><th class="r">Stock issued or consumed</th><th class="r">Adjustment and wastage</th><th class="r">Ending balance</th><th class="r">Ending value</th><th class="r">Cost per unit</th><th class="r">Stock cards</th></tr></thead><tbody>'+(rows||'<tr><td colspan="9" class="az-note" style="padding:0.6rem;">No inventory items.</td></tr>')+'</tbody></table></div></div>';
  root.innerHTML=html;
  var ff=document.getElementById('svFrom');if(ff)ff.onchange=function(){svFrom=this.value||null;renderStockValue();};
  var ft=document.getElementById('svTo');if(ft)ft.onchange=function(){svTo=this.value||null;renderStockValue();};
  var ex=document.getElementById('svExport');if(ex)ex.onclick=exportStockValue;
  var openingBtn=document.getElementById('inventoryOpeningBalanceBtn');if(openingBtn)openingBtn.onclick=function(){postInventoryOpeningBalance(rng,openingBtn);};
  root.querySelectorAll('[data-svcard]').forEach(function(b){b.onclick=function(){openStockCard(b.getAttribute('data-svcard'));};});
}
function openStockCard(id){
  var inv=invMap[id]||{};var cost=Number(inv.cost)||0;var cur=Number(inv.stock)||0;
  var mv=itemMovements(id);var net=mv.reduce(function(s,m){return s+(Number(m.in)||0)-(Number(m.out)||0);},0);var opening=Math.round((cur-net)*1000)/1000;var run=opening;
  var rows=mv.map(function(m){run=Math.round((run+(Number(m.in)||0)-(Number(m.out)||0))*1000)/1000;return '<tr><td>'+esc(m.date)+'</td><td>'+esc(m.type)+'</td><td class="r" style="color:#2a9d5c;">'+(m.in?fq(m.in):'')+'</td><td class="r" style="color:#c0392b;">'+(m.out?fq(m.out):'')+'</td><td class="r">'+fq(run)+'</td><td class="r">'+peso(run*cost)+'</td></tr>';}).join('');
  var mask=document.createElement('div');mask.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;';
  mask.innerHTML='<div style="background:#fff;border-radius:10px;max-width:660px;width:100%;max-height:90vh;overflow:auto;padding:1.2rem;">'
    +'<div style="display:flex;justify-content:space-between;align-items:center;"><div style="font-weight:700;color:var(--bd);">Stock card — '+esc(inv.name)+'</div><button class="pz-btn sec" id="scClose" style="padding:0.2rem 0.6rem;">✕</button></div>'
    +'<p class="pz-sub" style="margin:0.3rem 0 0.6rem;">Cost/unit '+peso(cost)+' · current stock '+fq(cur)+' '+esc(inv.unit||'')+' · value '+peso(cur*cost)+'</p>'
    +'<table class="pz-tbl"><thead><tr><th>Date</th><th>Movement</th><th class="r">In</th><th class="r">Out</th><th class="r">Balance</th><th class="r">Value</th></tr></thead><tbody>'
    +'<tr style="font-style:italic;color:var(--tl);"><td>—</td><td>Implied opening (before tracked movements)</td><td></td><td></td><td class="r">'+fq(opening)+'</td><td class="r">'+peso(opening*cost)+'</td></tr>'
    +(rows||'<tr><td colspan="6" class="az-note" style="padding:0.5rem;">No tracked movements yet.</td></tr>')
    +'</tbody></table></div>';
  document.body.appendChild(mask);
  mask.querySelector('#scClose').onclick=function(){document.body.removeChild(mask);};
  mask.onclick=function(e){if(e.target===mask)document.body.removeChild(mask);};
}
function exportStockValue(){
  if(!window.XLSX){alert('Excel library still loading — try again.');return;}
  var rng=svRange();var aoa=[['Item','Unit','Beginning balance','Stock received','Stock issued or consumed','Adjustment and wastage','Ending balance','Ending value','Cost per unit']];
  invItems().forEach(function(i){var cost=Number(i.cost)||0;var f=itemReconciliation(i.id,rng);aoa.push([i.name,i.unit||'',f.beginning,f.received,f.issued,f.adjustment,f.ending,f.ending*cost,cost]);});
  var wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(aoa),'Inventory');XLSX.writeFile(wb,'accaza-inventory-'+new Date().toISOString().slice(0,10)+'.xlsx');
}
})();
