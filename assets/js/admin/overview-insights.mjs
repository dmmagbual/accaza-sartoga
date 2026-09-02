function mergeOverviewOrders(active,orders,archived){
  var combined={};
  [active||[],orders||[],archived||[]].forEach(function(rows){rows.forEach(function(o,i){if(!o)return;var id=String(o.id||o.orderId||o.key||o._overviewKey||('overview-'+i));combined[id]=o;});});
  return Object.values(combined);
}

function createOverviewHistoryLoader(deps){
  var state={loading:false,queued:false,retryTimer:0,attempts:0,loadedAt:0,orders:null,archived:null};
  var defer=deps.defer||function(fn,ms){return setTimeout(fn,ms);},cancel=deps.cancel||function(id){clearTimeout(id);},now=deps.now||Date.now;
  function scheduleRetry(){if(state.retryTimer||state.attempts>=5)return;var delay=Math.min(4000,250*Math.pow(2,Math.max(0,state.attempts-1)));state.retryTimer=defer(function(){state.retryTimer=0;load(true);},delay);}
  async function load(force){
    if(state.loading){state.queued=true;return false;}
    if(!force&&state.orders&&now()-state.loadedAt<45000)return true;
    state.loading=true;
    try{
      var data=await deps.read();state.orders=data.orders||{};state.archived=data.archived||{};state.loadedAt=now();state.attempts=0;
      if(state.retryTimer){cancel(state.retryTimer);state.retryTimer=0;}deps.onData({orders:state.orders,archived:state.archived});return true;
    }catch(e){state.attempts++;if(deps.onError)deps.onError(e);scheduleRetry();return false;}
    finally{state.loading=false;if(state.queued){state.queued=false;defer(function(){load(true);},0);}}
  }
  return{load:load,snapshot:function(){return{orders:state.orders,archived:state.archived,complete:!!(state.orders&&state.archived),loading:state.loading};}};
}

function overviewDateKey(){return window.AccazaDate&&window.AccazaDate.key?window.AccazaDate.key():new Date().toISOString().slice(0,10);}
function overviewDayRange(date){var key=/^\d{4}-\d{2}-\d{2}$/.test(date||'')?date:overviewDateKey();return{date:key,start:Date.parse(key+'T00:00:00+08:00'),end:Date.parse(key+'T23:59:59.999+08:00')};}
function overviewDateLabel(date){var p=String(date||'').split('-'),d=new Date(Date.UTC(Number(p[0]),Number(p[1])-1,Number(p[2]),12));return d.toLocaleDateString('en-PH',{timeZone:'Asia/Manila',year:'numeric',month:'long',day:'numeric'});}
function overviewDrinkLine(li,data){
  var menu=(data&&data.menuItems)||{},types=(data&&data.catType)||{},mi=menu[li&&li.itemKey],cat=(mi&&mi.cat)||(li&&li.categoryId)||'',type=types[cat];
  if(type)return type==='drink';
  if(((data&&data.drinkCategories)||[]).indexOf(cat)>-1)return true;
  return !/(?:food|pastr|bakery|meal)/i.test([cat,li&&li.categoryName].filter(Boolean).join(' '));
}
function buildDrinkRanking(rows,data,dateRange){
  var items={},totalUnits=0,orderIds={},r=dateRange||null;
  (rows||[]).forEach(function(o,index){
    if(!o||(window.AccazaSales.qualifies&&!window.AccazaSales.qualifies(o)))return;
    var ts=window.AccazaSales.stamp(o);if(r&&(ts<r.start||ts>r.end))return;
    var amounts=window.AccazaSales.amounts(o),factor=amounts.gross>0?Math.max(0,amounts.net/amounts.gross):0,hasDrink=false;
    (Array.isArray(o.lineItems)?o.lineItems:[]).forEach(function(li){
      if(!li||!overviewDrinkLine(li,data))return;
      var qty=Math.max(0,Number(li.qty)||0),menu=(data&&data.menuItems)||{},mi=menu[li.itemKey],name=li.name||(mi&&mi.name)||li.itemKey;if(!name||qty<=0)return;
      var key=String(li.itemKey||name).toLowerCase(),item=items[key]||(items[key]={key:key,name:name,units:0,revenue:0});
      item.units+=qty;item.revenue+=qty*(Number(li.unitTotal)||0)*factor;totalUnits+=qty;hasDrink=true;
    });
    if(hasDrink)orderIds[String(o.id||o.orderId||o.key||o._overviewKey||('sale-'+index))]=true;
  });
  return{items:Object.values(items),totalUnits:totalUnits,orderCount:Object.keys(orderIds).length};
}

function createOverviewInsights(deps){
  var state={metric:'units',latest:null,bound:false,rankingDate:'',rankingOpen:false,lastFocus:null};
  function reportPeriod(){return window.AccazaReportPeriod&&window.AccazaReportPeriod.get?window.AccazaReportPeriod.get():{mode:'30d',count:1,from:'',to:'',label:'Last 30 days'};}
  function stamp(o){return window.AccazaSales.stamp(o);}
  function dayStart(d){var x=new Date(d);x.setHours(0,0,0,0);return x.getTime();}
  function range(){var p=reportPeriod(),start=Number(p.startAt)||dayStart(new Date()),end=Number(p.endAt)||Date.now();return{start:start,end:end,label:p.label||'Last 30 days'};}
  function inRange(o,r){var t=stamp(o);return t>=r.start&&t<=r.end;}
  function outcome(o){
    var total=Number(o&&o.total)||0,refund=Number(o&&o.refundAmount)||0,s=String((o&&o.status)==='Archived'?(o.prevStatus||'Completed'):(o&&o.status)||'');
    if(o&&o.voided)return'Voided';
    if(refund>0&&total>0&&refund>=total-.009)return'Refunded';
    if(refund>0)return'Partially refunded';
    if(['Rejected','Cancelled','Canceled','Declined'].indexOf(s)>-1)return'Cancelled / Rejected';
    if(s==='Completed'||s==='Received')return s;
    return'';
  }
  function bind(){
    if(state.bound)return;state.bound=true;
    var from=document.getElementById('reportPeriodFrom'),to=document.getElementById('reportPeriodTo'),apply=document.getElementById('reportPeriodApply'),all=document.getElementById('reportPeriodAll'),open=document.getElementById('openDrinkRankingBtn'),modal=document.getElementById('drinkRankingModal'),close=document.getElementById('closeDrinkRankingBtn'),date=document.getElementById('drinkRankingDate'),today=document.getElementById('drinkRankingToday'),print=document.getElementById('printDrinkRankingBtn');
    function renderPeriodControls(){var p=reportPeriod();if(from)from.value=p.from||p.customFrom||'';if(to)to.value=p.to||p.customTo||'';}
    if(apply)apply.addEventListener('click',function(){if(!from||!to||!from.value||!to.value)return;if(from.value>to.value){alert('The start date must be on or before the end date.');return;}window.AccazaReportPeriod.set({mode:'custom',customFrom:from.value,customTo:to.value});});
    if(all)all.addEventListener('click',function(){window.AccazaReportPeriod.set({mode:'all'});});
    if(window.addEventListener)window.addEventListener('accaza-report-period',function(){renderPeriodControls();paint();});renderPeriodControls();
    document.querySelectorAll('[data-overview-metric]').forEach(function(btn){btn.addEventListener('click',function(){state.metric=this.dataset.overviewMetric;select();paint();});});
    function closeRanking(){if(!modal||modal.hidden)return;modal.hidden=true;state.rankingOpen=false;document.body.classList.remove('overview-ranking-open');if(state.lastFocus&&state.lastFocus.focus)state.lastFocus.focus();}
    function openRanking(){if(!modal)return;state.rankingDate=state.rankingDate||overviewDateKey();state.lastFocus=document.activeElement;state.rankingOpen=true;modal.hidden=false;document.body.classList.add('overview-ranking-open');if(date){date.value=state.rankingDate;date.max=overviewDateKey();}renderFullRanking();var panel=modal.querySelector('.overview-ranking-panel');if(panel&&panel.focus)panel.focus();}
    if(open)open.addEventListener('click',openRanking);
    if(close)close.addEventListener('click',closeRanking);
    if(modal)modal.addEventListener('click',function(event){if(event.target===modal)closeRanking();});
    if(date)date.addEventListener('change',function(){if(!this.value)return;state.rankingDate=this.value;renderFullRanking();});
    if(today)today.addEventListener('click',function(){state.rankingDate=overviewDateKey();if(date)date.value=state.rankingDate;renderFullRanking();});
    if(print)print.addEventListener('click',function(){if(!state.latest||state.latest.historyComplete!==true){alert('The complete Sales History data is still loading. Try printing again in a moment.');return;}var oldTitle=document.title,cleaned=false;function cleanup(){if(cleaned)return;cleaned=true;document.body.classList.remove('overview-ranking-print');document.title=oldTitle;}document.title='Accaza Drink Ranking - '+(state.rankingDate||overviewDateKey());document.body.classList.add('overview-ranking-print');if(window.addEventListener)window.addEventListener('afterprint',cleanup,{once:true});window.print();setTimeout(cleanup,1000);});
    if(document.addEventListener)document.addEventListener('keydown',function(event){if(event.key==='Escape'&&state.rankingOpen)closeRanking();});
    select();
  }
  function select(){document.querySelectorAll('[data-overview-metric]').forEach(function(btn){var on=btn.dataset.overviewMetric===state.metric;btn.classList.toggle('active',on);btn.setAttribute('aria-pressed',on?'true':'false');});}
  function ensureHistory(){}
  function money(v){return'₱'+Math.round(Number(v)||0).toLocaleString();}
  function renderPayments(rows){
    var mix={};rows.forEach(function(o){var pays=Array.isArray(o.payments)&&o.payments.length?o.payments:[{method:o.payment||'Other',amount:o.total||0}],refunds=o.refundPayments||{};pays.forEach(function(p){var method=p.method||'Other',net=Math.max(0,(Number(p.amount)||0)-(Number(refunds[method])||0));mix[method]=(mix[method]||0)+net;});});
    var keys=Object.keys(mix).filter(function(k){return mix[k]>.009;}).sort(function(a,b){return mix[b]-mix[a];}),total=keys.reduce(function(s,k){return s+mix[k];},0)||1,colors={'Cash':'#2a9d5c','GCash':'#b08d57','Bank Transfer':'#3b8fd4','PayMaya':'#7360f2','Split':'#e67e00'},el=document.getElementById('payMixList');
    if(el)el.innerHTML=keys.length?keys.map(function(k){return'<div class="overview-payment-row"><span class="overview-payment-dot" style="background:'+(colors[k]||'#999')+'"></span><span>'+deps.esc(k)+'</span><strong>'+money(mix[k])+' <small>'+Math.round(mix[k]/total*100)+'%</small></strong></div>';}).join(''):'<p class="overview-empty">No completed sales in this period.</p>';
  }
  function renderTop(rows,data){
    var metric=state.metric,result=buildDrinkRanking(rows,data),top=result.items.slice().sort(function(a,b){return(b[metric]-a[metric])||(b[metric==='units'?'revenue':'units']-a[metric==='units'?'revenue':'units'])||a.name.localeCompare(b.name);}).slice(0,10),medals=['🥇','🥈','🥉','4','5','6','7','8','9','10'],el=document.getElementById('topItemsList'),title=document.getElementById('overviewTopTitle'),open=document.getElementById('openDrinkRankingBtn');if(title)title.textContent='Top 10 Best Sellers - By '+(metric==='units'?'Quantity':'Revenue');if(el)el.innerHTML=top.length?top.map(function(x,i){return'<div class="overview-rank-row"><span>'+medals[i]+'</span><span>'+deps.esc(x.name)+'</span><strong>'+(metric==='units'?formatUnits(x.units)+' sold':money(x.revenue))+'</strong></div>';}).join(''):'<p class="overview-empty">No completed drink sales in this period.</p>';if(open)open.textContent='View full ranking';
  }
  function formatUnits(value){return Number(value||0).toLocaleString('en-PH',{maximumFractionDigits:2});}
  function renderFullRanking(){
    if(!state.rankingOpen||!state.latest)return;var data=state.latest,body=document.getElementById('drinkRankingBody'),total=document.getElementById('drinkRankingTotal'),count=document.getElementById('drinkRankingCount'),orders=document.getElementById('drinkRankingOrders'),status=document.getElementById('drinkRankingStatus'),title=document.getElementById('drinkRankingMetricTitle'),dateLabel=document.getElementById('drinkRankingDateLabel'),print=document.getElementById('printDrinkRankingBtn');if(!body)return;if(dateLabel)dateLabel.textContent=overviewDateLabel(state.rankingDate||overviewDateKey());
    if(data.historyComplete!==true){body.innerHTML='<tr><td colspan="4" class="overview-ranking-empty">Loading complete Sales History data…</td></tr>';if(total)total.textContent='—';if(count)count.textContent='—';if(orders)orders.textContent='—';if(status)status.textContent='Loading all completed and archived sales before calculating the total.';if(print)print.disabled=true;return;}
    var r=overviewDayRange(state.rankingDate||overviewDateKey()),result=buildDrinkRanking(data.sales||[],data,r),metric=state.metric,ranked=result.items.slice().sort(function(a,b){return(b[metric]-a[metric])||(b[metric==='units'?'revenue':'units']-a[metric==='units'?'revenue':'units'])||a.name.localeCompare(b.name);});
    if(total)total.textContent=formatUnits(result.totalUnits);if(count)count.textContent=String(ranked.length);if(orders)orders.textContent=String(result.orderCount);if(title)title.textContent=metric==='units'?'Ranked by quantity':'Ranked by net revenue';if(status)status.textContent='Sales History basis: Completed or Received, payment confirmed, not voided. Refunds reduce revenue; units remain unchanged because refunds are not item-specific.';if(print)print.disabled=false;
    body.innerHTML=ranked.length?ranked.map(function(item,index){return'<tr><td class="overview-ranking-position">'+(index+1)+'</td><td><strong>'+deps.esc(item.name)+'</strong></td><td class="overview-ranking-number">'+formatUnits(item.units)+'</td><td class="overview-ranking-number">'+money(item.revenue)+'</td></tr>';}).join(''):'<tr><td colspan="4" class="overview-ranking-empty">No completed drink sales were recorded on this date.</td></tr>';
  }
  function renderOutcomes(all,active){
    var names=['Completed','Received','Cancelled / Rejected','Voided','Refunded','Partially refunded'],colors={'Completed':['#d4edda','#155724'],'Received':['#c8e6c9','#1b5e20'],'Cancelled / Rejected':['#f8d7da','#721c24'],'Voided':['#f5d0d0','#7f1d1d'],'Refunded':['#fff3cd','#856404'],'Partially refunded':['#fff1d6','#8a510b']},counts={},total=0;names.forEach(function(n){counts[n]=0;});all.forEach(function(o){var x=outcome(o);if(x){counts[x]++;total++;}});
    var live=['Pending','Confirmed','Preparing','Ready'],liveHtml=live.map(function(s){var n=active.filter(function(o){return o.status===s;}).length;return'<span><b>'+n+'</b>'+s+'</span>';}).join(''),verify=active.filter(function(o){return o.paymentStatus==='pending';}).length,review=active.filter(function(o){return o.paymentStatus==='cashier_verified';}).length,el=document.getElementById('statusBreakdown');
    if(el)el.innerHTML='<div class="overview-live-head"><span>Live queue</span><small>Current, not date-filtered</small></div><div class="overview-live-grid">'+liveHtml+'<span><b>'+verify+'</b>Cashier checks</span><span><b>'+review+'</b>Manager reviews</span></div><div class="overview-outcome-head"><span>Outcomes</span><small>'+total+' order'+(total===1?'':'s')+'</small></div>'+names.map(function(n){var c=colors[n],pct=total?Math.round(counts[n]/total*100):0;return'<div class="overview-outcome-row" style="--row-bg:'+c[0]+';--row-fg:'+c[1]+'"><span>'+n+'</span><strong>'+counts[n]+' <small>'+pct+'%</small></strong></div>';}).join('');
  }
  function chart(rows,r){
    var canvas=document.getElementById('revenueChart');if(!canvas)return;var W=canvas.offsetWidth||500,H=180;canvas.width=W;canvas.height=H;var ctx=canvas.getContext('2d');ctx.clearRect(0,0,W,H);
    var start=r.start||Math.min.apply(null,rows.map(stamp).filter(Boolean).concat([dayStart(new Date())])),span=Math.max(86400000,r.end-start),monthly=span>62*86400000,buckets={},labels=[];
    function key(t){var d=new Date(t),ym=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');return monthly?ym:ym+'-'+String(d.getDate()).padStart(2,'0');}
    var cursor=new Date(start);cursor.setHours(0,0,0,0);if(monthly)cursor.setDate(1);while(cursor.getTime()<=r.end&&labels.length<120){var k=key(cursor.getTime());labels.push(k);buckets[k]={rev:0,count:0};if(monthly)cursor.setMonth(cursor.getMonth()+1);else cursor.setDate(cursor.getDate()+1);}
    rows.forEach(function(o){var b=buckets[key(stamp(o))];if(b){b.rev+=Math.max(0,(Number(o.total)||0)-(Number(o.refundAmount)||0));b.count++;}});var rev=labels.map(function(k){return buckets[k].rev;}),cnt=labels.map(function(k){return buckets[k].count;}),maxR=Math.max.apply(null,rev.concat([1])),maxC=Math.max.apply(null,cnt.concat([1])),pad={l:42,r:10,t:10,b:30},cw=W-pad.l-pad.r,ch=H-pad.t-pad.b,gap=cw/Math.max(labels.length,1),bw=Math.max(2,gap*.58);
    ctx.strokeStyle='rgba(0,0,0,.07)';ctx.lineWidth=1;[0,.25,.5,.75,1].forEach(function(p){var y=pad.t+ch*(1-p);ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(W-pad.r,y);ctx.stroke();ctx.fillStyle='#79806f';ctx.font='10px Inter,sans-serif';ctx.textAlign='right';ctx.fillText(money(maxR*p),pad.l-4,y+3);});rev.forEach(function(v,i){var x=pad.l+i*gap+gap*.2,bh=v/maxR*ch;ctx.fillStyle='rgba(176,141,87,.75)';ctx.fillRect(x,pad.t+ch-bh,bw,bh);});ctx.strokeStyle='#3b8fd4';ctx.lineWidth=2;ctx.beginPath();cnt.forEach(function(v,i){var x=pad.l+i*gap+gap*.5,y=pad.t+ch*(1-v/maxC);i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.stroke();ctx.fillStyle='#3b8fd4';cnt.forEach(function(v,i){var x=pad.l+i*gap+gap*.5,y=pad.t+ch*(1-v/maxC);ctx.beginPath();ctx.arc(x,y,2.5,0,Math.PI*2);ctx.fill();});ctx.fillStyle='#79806f';ctx.font='9px Inter,sans-serif';ctx.textAlign='center';var every=Math.max(1,Math.ceil(labels.length/6));labels.forEach(function(k,i){if(i%every===0||i===labels.length-1)ctx.fillText(monthly?k:k.slice(5),pad.l+i*gap+gap*.5,H-8);});
  }
  function paint(){
    bind();if(!state.latest)return;var data=state.latest,r=range(),complete=true,label=document.getElementById('overviewRangeLabel');if(label)label.textContent=r.label;
    if(!complete){['overviewNetSales','overviewGrossSales','overviewTransactions','overviewAverageSale'].forEach(function(id){var el=document.getElementById(id);if(el)el.textContent='—';});var pending=document.getElementById('overviewDataNote');if(pending)pending.textContent='Verifying complete order history…';return;}
    var periodSales=(data.sales||[]).filter(function(o){return inRange(o,r);}),periodOrders=(data.outcomes||[]).filter(function(o){return inRange(o,r);});
    var gross=0,net=0;periodSales.forEach(function(o){var v=window.AccazaSales.amounts(o);gross+=v.gross;net+=v.net;});function set(id,value){var el=document.getElementById(id);if(el)el.textContent=value;}set('overviewNetSales',money(net));set('overviewGrossSales',money(gross));set('overviewTransactions',String(periodSales.length));set('overviewAverageSale',money(periodSales.length?net/periodSales.length:0));
    renderPayments(periodSales);renderTop(periodSales,data);renderOutcomes(periodOrders,data.active||[]);chart(periodSales,r);renderFullRanking();
    var note=document.getElementById('overviewDataNote');if(note)note.textContent='Every completed paid order in the selected dates is loaded, including archived orders.';
  }
  return{render:function(data){state.latest=data;paint();},ensureHistory:ensureHistory};
}

export{buildDrinkRanking,createOverviewHistoryLoader,createOverviewInsights,mergeOverviewOrders,overviewDayRange};
