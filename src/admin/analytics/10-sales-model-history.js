
/* ---------- sales model ---------- */
function isSale(o){return window.AccazaSales.qualifies(o);}
function allOrders(){var out={};[ordersMap,archMap].forEach(function(m){Object.keys(m).forEach(function(k){var o=m[k];if(o)out[String(o.id||k)]=o;});});return Object.values(out);}
function itemCost(li){var rec=recMap[li.itemKey];if(!rec)return null;var mult=(rec.sizeMult&&rec.sizeMult[li.size]!=null)?rec.sizeMult[li.size]:1,labels=li.optLabels||[],_it=((A()&&A().menuItemsMap)||{})[li.itemKey]||{key:li.itemKey},groups=(A()&&A().optionGroupsMap)||{},c=0;(rec.base||[]).forEach(function(b){var ing=invMap[b.ing];if(!ing||!window.AccazaCosting.rowMatchesSelections(_it,b,labels,groups))return;var per=b['qty'+(li.size||'M')],q=(per!=null&&per!=='')?(Number(per)||0):(Number(b.qty)||0)*mult;c+=q*(Number(ing.cost)||0);});var getChoiceIngs=window.__accazaChoiceIngs;labels.forEach(function(lb){(getChoiceIngs?getChoiceIngs(_it,rec,lb,li.size):[]).forEach(function(r){var ing=invMap[r.ing];if(ing)c+=(Number(r.qty)||0)*(Number(ing.cost)||0);});});return c*(Number(li.qty)||1);}
function orderCOGS(o){var corrected=o.correctedCogsSnapshot!=null,_x=Number(corrected?o.correctedExtraCost:o.extraCost)||0,lines=o.correctedLineItems||o.lineItems;
  if(corrected||o.cogsSnapshot!=null)return{cost:(Number(corrected?o.correctedCogsSnapshot:o.cogsSnapshot)||0)+_x,covered:o.cogsCovered!==false};
  if(!lines)return{cost:_x,covered:false};var cost=0,any=false,all=true;lines.forEach(function(li){var c=itemCost(li);if(c==null)all=false;else{cost+=c;any=true;}});return{cost:cost+_x,covered:any&&all};}
function saleFields(o){var v=window.AccazaSales.amounts(o);return{ts:window.AccazaSales.stamp(o),gross:v.gross,discount:v.discount,refund:v.refund,net:v.net,payment:o.payment||'—',type:o.type||'—',lineItems:o.correctedLineItems||o.lineItems||null,phone:(o.phone||'').replace(/[^0-9]/g,''),name:o.name||'Walk-in',o:o};}
function salesBetween(from,to){return allOrders().filter(isSale).map(saleFields).filter(function(s){return s.ts>=from&&s.ts<to;});}
function dayStart(d){d=new Date(d);d.setHours(0,0,0,0);return d.getTime();}
function addDays(ts,n){var d=new Date(ts);d.setDate(d.getDate()+n);return d.getTime();}
function localDateValue(v){var p=String(v||'').split('-');if(p.length!==3)return NaN;return new Date(Number(p[0]),Number(p[1])-1,Number(p[2])).getTime();}
function rangeBounds(){
  if(azFrom!=null&&azTo!=null)return[azFrom,azTo+1];
  var now=Date.now(),today=dayStart(now),end=addDays(today,1);if(azRange==='today')return[today,end];if(azRange==='7d')return[addDays(today,-6),end];if(azRange==='30d')return[addDays(today,-29),end];if(azRange==='month'){var d=new Date();return[new Date(d.getFullYear(),d.getMonth(),1).getTime(),end];}return[new Date(new Date().getFullYear(),new Date().getMonth(),1).getTime(),end];
}
function businessDate(ts){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(Number(ts)||0));}
function dateKeys(from,to){var out=[],d=new Date(Date.parse(businessDate(from)+'T00:00:00Z')),last=businessDate(to-1);while(d.toISOString().slice(0,10)<=last){out.push(d.toISOString().slice(0,10));d.setUTCDate(d.getUTCDate()+1);}return out;}
function fmtD(value){var key=/^\d{4}-\d{2}-\d{2}$/.test(String(value||''))?String(value):businessDate(value);return new Date(key+'T12:00:00+08:00').toLocaleDateString('en-PH',{month:'short',day:'numeric'});}
function azRangeLabel(from,to){var nm={today:'Today','7d':'Last 7 days','30d':'Last 30 days',month:'This month',all:'All time',custom:'Custom range'};return (nm[azRange]||azRange)+' · '+fmtD(from)+' – '+fmtD(to-86400000);}
function sharedPeriod(v){
  v=v||(window.AccazaAdminPeriods&&window.AccazaAdminPeriods.get&&window.AccazaAdminPeriods.get('sales'));if(!v)return;
  azRange='custom';
  azFrom=Number(v.startAt)||null;
  azTo=Number(v.endAt)||null;
}
async function ensureAnalyticsHistory(){
  // The hub loads the selected period plus the equally sized comparison period.
  // No creation-date pagination or full-history scan is needed here.
  var hub=A()&&A().hub;
  analyticsHistoryLoading=!!(hub&&['orders','archivedOrders'].some(function(path){var status=hub.historyStatus(path);return status.loading||status.error;}));
}

function currentAnalyticsMonth(){return businessDate(Date.now()).slice(0,7);}
function previousAnalyticsMonth(month){var y=Number(month.slice(0,4)),m=Number(month.slice(5,7))-1;if(m===0){y--;m=12;}return y+'-'+String(m).padStart(2,'0');}
function ensureAnalyticsRollup(){
  var month=currentAnalyticsMonth(),from=month.slice(0,4)+'-01',to=previousAnalyticsMonth(month),key=from+':'+to;
  if(analyticsRollup.key===key||analyticsRollup.loading)return;
  analyticsRollup={key:key,loading:false,ready:false,months:{},error:''};
  if(from>to){analyticsRollup.ready=true;return;}
  if(!A()||typeof A().readHistoricalSalesRollup!=='function'){analyticsRollup.error='Cashier and YTD hour/day totals are unavailable. Refresh the Admin portal.';return;}
  analyticsRollup.loading=true;
  A().readHistoricalSalesRollup({from:from,to:to}).then(function(result){
    if(analyticsRollup.key!==key)return;
    analyticsRollup={key:key,loading:false,ready:result&&result.ready===true&&result.analyticsReady===true,months:(result&&result.months)||{},error:result&&result.analyticsReady===false?'Historical YTD summary is being prepared. Run Historical Reporting maintenance before relying on YTD totals.':''};
    if(isTab('analytics'))renderAnalytics();
  }).catch(function(error){
    if(analyticsRollup.key!==key)return;
    analyticsRollup.loading=false;analyticsRollup.error='Could not load the compact YTD summary. '+String((error&&error.message)||error);
    if(isTab('analytics'))renderAnalytics();
  });
}

function rollupMetric(metric){var out={};Object.keys(analyticsRollup.months||{}).forEach(function(month){var rows=(analyticsRollup.months[month]||{})[metric]||{};Object.keys(rows).forEach(function(key){var row=rows[key]||{};out[key]=(out[key]||0)+(Number(row.netCents)||0)/100;});});return out;}
function cashierName(order){var name=String(order&&(order.staff||order.cashier||order.completedByName)||'').replace(/\s+/g,' ').trim();return name||'Unassigned';}
function cashierKey(order){return cashierName(order).toLocaleLowerCase('en-US');}
function cashierTotals(rows){var out={};rows.forEach(function(x){var key=cashierKey(x.o),name=cashierName(x.o),row=out[key]||(out[key]={name:name,net:0});row.net+=x.net;});return out;}
function rollupCashiers(){var out={};Object.keys(analyticsRollup.months||{}).forEach(function(month){var rows=(analyticsRollup.months[month]||{}).cashiers||{};Object.keys(rows).forEach(function(key){var source=rows[key]||{},row=out[key]||(out[key]={name:source.name||'Unassigned',net:0});row.net+=(Number(source.netCents)||0)/100;});});return out;}
function isCurrentMonthToDate(from,to){var today=businessDate(Date.now()),month=currentAnalyticsMonth();return businessDate(from)===month+'-01'&&businessDate(to-1)===today;}
function joinCashierTotals(monthRows,ytdRows){var keys={};Object.keys(monthRows).forEach(function(k){keys[k]=1;});Object.keys(ytdRows).forEach(function(k){keys[k]=1;});return Object.keys(keys).map(function(k){var m=monthRows[k]||{},y=ytdRows[k]||{};return{name:m.name||y.name||'Unassigned',month:Number(m.net)||0,ytd:(Number(m.net)||0)+(Number(y.net)||0)};}).sort(function(a,b){return b.ytd-a.ytd||a.name.localeCompare(b.name);});}
function weeklySales(rows){var out={};rows.forEach(function(x){var d=new Date(Date.parse(businessDate(x.ts)+'T00:00:00Z')),day=d.getUTCDay(),offset=(day+6)%7;d.setUTCDate(d.getUTCDate()-offset);var key=d.toISOString().slice(0,10);out[key]=(out[key]||0)+x.net;});return Object.keys(out).sort().map(function(k){return{key:k,value:out[k]};});}
function weeklyBars(rows){var values=weeklySales(rows),max=Math.max.apply(null,values.map(function(x){return x.value;}).concat([1])),colors=['az-week-0','az-week-1','az-week-2','az-week-3','az-week-4','az-week-5','az-week-6','az-week-7'];return values.length?'<div class="az-weekly-bars">'+values.map(function(x,i){var h=Math.max(3,Math.round(x.value/max*100));return '<div class="az-weekly-col"><div class="az-weekly-value">'+peso0(x.value)+'</div><div class="az-weekly-track"><div class="az-weekly-fill '+colors[i%colors.length]+'" style="height:'+h+'%;"></div></div><div class="az-weekly-label">'+esc(fmtD(x.key))+'</div></div>';}).join('')+'</div>':'<p class="az-note">No completed sales in this period.</p>';}
function cashierComparison(rows,ytdReady){var maxMonth=Math.max.apply(null,rows.map(function(x){return x.month;}).concat([1])),maxYtd=Math.max.apply(null,rows.map(function(x){return x.ytd;}).concat([1]));return rows.length?'<div class="az-cashier-chart">'+rows.map(function(x){var mw=Math.max(2,Math.round(x.month/maxMonth*100)),yw=Math.max(2,Math.round(x.ytd/maxYtd*100));return '<div class="az-cashier-row"><div class="az-cashier-name">'+esc(x.name)+'</div><div class="az-cashier-bars"><div class="az-cashier-line"><span class="az-cashier-mtd" style="width:'+mw+'%;"></span></div><div class="az-cashier-line"><span class="az-cashier-ytd" style="width:'+yw+'%;"></span></div></div><div class="az-cashier-values"><span>MTD '+peso0(x.month)+'</span><span>'+(ytdReady?'YTD '+peso0(x.ytd):'YTD preparing')+'</span></div></div>';}).join('')+'</div>':'<p class="az-note">No completed cashier-attributed sales this month.</p>';}

function bar(label,val,max,disp,fillClass){var w=max>0?Math.max(2,Math.round(val/max*100)):0;return '<div class="az-bar-row"><div class="az-bar-lbl">'+esc(label)+'</div><div class="az-bar-track"><div class="az-bar-fill '+(fillClass||'')+'" style="width:'+w+'%;"></div></div><div class="az-bar-val">'+(disp!=null?disp:val)+'</div></div>';}
function kpi(label,val,delta){var d='';if(delta!=null&&isFinite(delta))d='<div class="d '+(delta>0?'az-up':delta<0?'az-down':'az-flat')+'">'+pct(delta)+' vs prev</div>';return '<div class="az-kpi"><div class="v">'+val+'</div><div class="l">'+esc(label)+'</div>'+d+'</div>';}
