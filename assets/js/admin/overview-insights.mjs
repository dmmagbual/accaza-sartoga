function mergeOverviewOrders(active,orders,archived){
  var combined={};
  [active||[],orders||[],archived||[]].forEach(function(rows){rows.forEach(function(o,i){if(!o)return;var id=String(o.id||o.orderId||o.key||o._overviewKey||('overview-'+i));combined[id]=o;});});
  return Object.values(combined);
}

function createOverviewHistoryLoader(deps){
  var entries=new Map(),defer=deps.defer||setTimeout,cancel=deps.cancel||clearTimeout,now=deps.now||Date.now;
  function key(){return deps.key?deps.key():'all';}
  function entry(k){if(!entries.has(k)){entries.set(k,{orders:null,archived:null,loadedAt:0,pending:null,retryTimer:0,attempts:0});if(entries.size>4){var oldest=entries.keys().next().value;if(oldest!==k)entries.delete(oldest);}}return entries.get(k);}
  function load(force){
    var k=key(),state=entry(k);if(state.pending){state.retryRequested=true;return state.pending;}
    if(!force&&state.orders&&now()-state.loadedAt<45000)return Promise.resolve(true);
    state.pending=Promise.resolve().then(function(){return deps.read(k);}).then(function(data){
      state.orders=data.orders||{};state.archived=data.archived||{};state.loadedAt=now();state.attempts=0;state.retryRequested=false;
      if(state.retryTimer){cancel(state.retryTimer);state.retryTimer=0;}
      state.pending=null;if(k===key())deps.onData({orders:state.orders,archived:state.archived});return true;
    }).catch(function(error){state.attempts++;if(deps.onError)deps.onError(error);if(k===key()&&!state.retryTimer&&state.attempts<5)state.retryTimer=defer(function(){state.retryTimer=0;if(k===key())load(true);},state.retryRequested?0:Math.min(4000,250*Math.pow(2,state.attempts-1)));return false;}).finally(function(){state.pending=null;});
    return state.pending;
  }
  return{load:load,snapshot:function(){var state=entry(key());return{orders:state.orders,archived:state.archived,complete:!!(state.orders&&state.archived),loading:!!state.pending};}};
}

function overviewDateKey(){return window.AccazaDate&&window.AccazaDate.key?window.AccazaDate.key():new Date().toISOString().slice(0,10);}
function overviewDayRange(date){var key=/^\d{4}-\d{2}-\d{2}$/.test(date||'')?date:overviewDateKey();return{date:key,start:Date.parse(key+'T00:00:00+08:00'),end:Date.parse(key+'T23:59:59.999+08:00')};}
function overviewDateLabel(date){var p=String(date||'').split('-'),d=new Date(Date.UTC(Number(p[0]),Number(p[1])-1,Number(p[2]),12));return d.toLocaleDateString('en-PH',{timeZone:'Asia/Manila',year:'numeric',month:'long',day:'numeric'});}
function overviewRankingRange(from,to){var today=overviewDateKey(),start=/^\d{4}-\d{2}-\d{2}$/.test(from||'')?from:today,end=/^\d{4}-\d{2}-\d{2}$/.test(to||'')?to:start;if(start>end){var swap=start;start=end;end=swap;}return{from:start,to:end,start:Date.parse(start+'T00:00:00+08:00'),end:Date.parse(end+'T23:59:59.999+08:00'),label:start===end?overviewDateLabel(start):overviewDateLabel(start)+' to '+overviewDateLabel(end)};}
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
  var state={metric:'units',latest:null,bound:false,rankingFrom:'',rankingTo:'',rankingOpen:false,lastFocus:null,rankingSales:null,rankingKey:'',rankingRequest:0,rankingError:''};
  function reportPeriod(){if(window.AccazaAdminPeriods&&window.AccazaAdminPeriods.get)return window.AccazaAdminPeriods.get('sales');var end=overviewDateKey();return{from:end.slice(0,7)+'-01',to:end,label:end.slice(0,7)+'-01 to '+end,startAt:Date.parse(end.slice(0,7)+'-01T00:00:00+08:00'),endAt:Date.parse(end+'T23:59:59.999+08:00')};}
  function stamp(o){return window.AccazaSales.stamp(o);}
  function dayStart(d){var x=new Date(d);x.setHours(0,0,0,0);return x.getTime();}
  function range(){var p=reportPeriod(),start=Number(p.startAt)||dayStart(new Date()),end=Number(p.endAt)||Date.now();return{start:start,end:end,label:p.label||'Current month'};}
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
    var open=document.getElementById('openDrinkRankingBtn'),modal=document.getElementById('drinkRankingModal'),close=document.getElementById('closeDrinkRankingBtn'),rankingFrom=document.getElementById('drinkRankingFrom'),rankingTo=document.getElementById('drinkRankingTo'),rankingMonth=document.getElementById('drinkRankingMonth'),rankingApply=document.getElementById('drinkRankingApply'),today=document.getElementById('drinkRankingToday'),print=document.getElementById('printDrinkRankingBtn');
    if(window.AccazaAdminPeriods)window.AccazaAdminPeriods.bind({scope:'sales',fromId:'overviewPeriodFrom',toId:'overviewPeriodTo',monthId:'overviewPeriodMonth',applyId:'overviewPeriodApply',labelId:'overviewRangeLabel',onApply:function(){return deps.refreshHistory?deps.refreshHistory():null;}});
    if(window.addEventListener)window.addEventListener('accaza-admin-period',function(e){if(e.detail&&e.detail.scope==='sales'){if(state.latest)state.latest.historyComplete=false;paint();if(deps.refreshHistory)deps.refreshHistory();}});
    document.querySelectorAll('[data-overview-metric]').forEach(function(btn){btn.addEventListener('click',function(){state.metric=this.dataset.overviewMetric;select();paint();});});
    function closeRanking(){if(!modal||modal.hidden)return;modal.hidden=true;state.rankingOpen=false;document.body.classList.remove('overview-ranking-open');if(state.lastFocus&&state.lastFocus.focus)state.lastFocus.focus();}
    function syncRankingControls(){var todayKey=overviewDateKey();if(rankingFrom){rankingFrom.value=state.rankingFrom;rankingFrom.max=todayKey;}if(rankingTo){rankingTo.value=state.rankingTo;rankingTo.max=todayKey;}if(rankingMonth){rankingMonth.max=todayKey.slice(0,7);var ym=state.rankingFrom.slice(0,7),parts=ym.split('-'),last=new Date(Date.UTC(Number(parts[0]),Number(parts[1]),0)).getUTCDate(),end=ym+'-'+String(last).padStart(2,'0');rankingMonth.value=state.rankingFrom===ym+'-01'&&state.rankingTo===(end>todayKey?todayKey:end)?ym:'';}}
    async function applyRankingRange(start,end){if(window.AccazaAdminPeriods)window.AccazaAdminPeriods.validate(start,end);else if(!start||!end||start>end)throw new Error('Choose a valid ranking period.');state.rankingFrom=start;state.rankingTo=end;syncRankingControls();return loadRanking();}
    function changeRanking(start,end){var press=window.AccazaAdminPeriods&&window.AccazaAdminPeriods.press;Promise.resolve(press?press(rankingApply,function(){return applyRankingRange(start,end);}):applyRankingRange(start,end)).catch(function(e){alert(e.message||e);});}
    function openRanking(){if(!modal)return;state.rankingFrom=state.rankingFrom||overviewDateKey();state.rankingTo=state.rankingTo||state.rankingFrom;state.lastFocus=document.activeElement;state.rankingOpen=true;modal.hidden=false;document.body.classList.add('overview-ranking-open');syncRankingControls();loadRanking().catch(function(){});var panel=modal.querySelector('.overview-ranking-panel');if(panel&&panel.focus)panel.focus();}
    if(open)open.addEventListener('click',openRanking);
    if(close)close.addEventListener('click',closeRanking);
    if(modal)modal.addEventListener('click',function(event){if(event.target===modal)closeRanking();});
    if(rankingApply)rankingApply.addEventListener('click',function(){changeRanking(rankingFrom&&rankingFrom.value,rankingTo&&rankingTo.value);});
    if(rankingMonth)rankingMonth.addEventListener('change',function(){if(!/^\d{4}-\d{2}$/.test(this.value))return;var parts=this.value.split('-'),last=new Date(Date.UTC(Number(parts[0]),Number(parts[1]),0)).getUTCDate(),start=this.value+'-01',end=this.value+'-'+String(last).padStart(2,'0'),todayKey=overviewDateKey();changeRanking(start,end>todayKey?todayKey:end);});
    if(today)today.addEventListener('click',function(){var key=overviewDateKey();if(rankingMonth)rankingMonth.value=key.slice(0,7);changeRanking(key,key);});
    if(print)print.addEventListener('click',function(){if(!state.latest||(deps.readRanking?!state.rankingSales:state.latest.historyComplete!==true)){alert('The complete Sales History data is still loading. Try printing again in a moment.');return;}var oldTitle=document.title,cleaned=false,r=overviewRankingRange(state.rankingFrom,state.rankingTo);function cleanup(){if(cleaned)return;cleaned=true;document.body.classList.remove('overview-ranking-print');document.title=oldTitle;}document.title='Accaza Drink Ranking - '+r.from+(r.from===r.to?'':' to '+r.to);document.body.classList.add('overview-ranking-print');if(window.addEventListener)window.addEventListener('afterprint',cleanup,{once:true});window.print();setTimeout(cleanup,1000);});
    if(document.addEventListener)document.addEventListener('keydown',function(event){if(event.key==='Escape'&&state.rankingOpen)closeRanking();});
    select();
  }
  function select(){document.querySelectorAll('[data-overview-metric]').forEach(function(btn){var on=btn.dataset.overviewMetric===state.metric;btn.classList.toggle('active',on);btn.setAttribute('aria-pressed',on?'true':'false');});}
  function ensureHistory(){}
  function money(v){return'₱'+(Number(v)||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});}
  function renderPayments(rows){
    var mix={};rows.forEach(function(o){var pays=Array.isArray(o.payments)&&o.payments.length?o.payments:[{method:o.payment||'Other',amount:o.total||0}],refunds=o.refundPayments||{};pays.forEach(function(p){var method=p.method||'Other',net=Math.max(0,(Number(p.amount)||0)-(Number(refunds[method])||0));mix[method]=(mix[method]||0)+net;});});
    var keys=Object.keys(mix).filter(function(k){return mix[k]>.009;}).sort(function(a,b){return mix[b]-mix[a];}),total=keys.reduce(function(s,k){return s+mix[k];},0)||1,colors={'Cash':'#2a9d5c','GCash':'#b08d57','Bank Transfer':'#3b8fd4','PayMaya':'#7360f2','Split':'#e67e00'},el=document.getElementById('payMixList');
    if(el)el.innerHTML=keys.length?keys.map(function(k){return'<div class="overview-payment-row"><span class="overview-payment-dot" style="background:'+(colors[k]||'#999')+'"></span><span>'+deps.esc(k)+'</span><strong>'+money(mix[k])+' <small>'+Math.round(mix[k]/total*100)+'%</small></strong></div>';}).join(''):'<p class="overview-empty">No completed sales in this period.</p>';
  }
  function renderTop(rows,data){
    var metric=state.metric,result=buildDrinkRanking(rows,data),top=result.items.slice().sort(function(a,b){return(b[metric]-a[metric])||(b[metric==='units'?'revenue':'units']-a[metric==='units'?'revenue':'units'])||a.name.localeCompare(b.name);}).slice(0,10),medals=['🥇','🥈','🥉','4','5','6','7','8','9','10'],el=document.getElementById('topItemsList'),title=document.getElementById('overviewTopTitle'),open=document.getElementById('openDrinkRankingBtn');if(title)title.textContent='Top 10 Best Sellers - By '+(metric==='units'?'Quantity':'Revenue');if(el)el.innerHTML=top.length?top.map(function(x,i){return'<div class="overview-rank-row"><span>'+medals[i]+'</span><span>'+deps.esc(x.name)+'</span><strong>'+(metric==='units'?formatUnits(x.units)+' sold':money(x.revenue))+'</strong></div>';}).join(''):'<p class="overview-empty">No completed drink sales in this period.</p>';if(open)open.textContent='View full ranking';
  }
  function formatUnits(value){return Number(value||0).toLocaleString('en-PH',{maximumFractionDigits:2});}
  async function loadRanking(){
    if(!deps.readRanking){renderFullRanking();return true;}
    var request=++state.rankingRequest,r=overviewRankingRange(state.rankingFrom,state.rankingTo);state.rankingSales=null;state.rankingError='';renderFullRanking();
    try{var data=await deps.readRanking(r);if(request!==state.rankingRequest)return false;state.rankingSales=data;state.rankingKey=r.from+':'+r.to;renderFullRanking();return true;}
    catch(error){if(request===state.rankingRequest){state.rankingError='Ranking could not load. Check your connection and press Apply to retry.';renderFullRanking();}throw error;}
  }
  function renderFullRanking(){
    if(!state.rankingOpen||!state.latest)return;var data=state.latest,body=document.getElementById('drinkRankingBody'),total=document.getElementById('drinkRankingTotal'),count=document.getElementById('drinkRankingCount'),orders=document.getElementById('drinkRankingOrders'),status=document.getElementById('drinkRankingStatus'),title=document.getElementById('drinkRankingMetricTitle'),dateLabel=document.getElementById('drinkRankingDateLabel'),print=document.getElementById('printDrinkRankingBtn'),r=overviewRankingRange(state.rankingFrom,state.rankingTo);if(!body)return;if(dateLabel)dateLabel.textContent=r.label;
    if(deps.readRanking?!state.rankingSales:data.historyComplete!==true){body.innerHTML='<tr><td colspan="4" class="overview-ranking-empty">Loading complete Sales History data…</td></tr>';if(total)total.textContent='—';if(count)count.textContent='—';if(orders)orders.textContent='—';if(status)status.textContent=state.rankingError||'Loading completed and archived sales in the ranking period before calculating the total.';if(print)print.disabled=true;return;}
    var result=buildDrinkRanking(deps.readRanking?(state.rankingSales||[]):(data.sales||[]),data,r),metric=state.metric,ranked=result.items.slice().sort(function(a,b){return(b[metric]-a[metric])||(b[metric==='units'?'revenue':'units']-a[metric==='units'?'revenue':'units'])||a.name.localeCompare(b.name);});
    if(total)total.textContent=formatUnits(result.totalUnits);if(count)count.textContent=String(ranked.length);if(orders)orders.textContent=String(result.orderCount);if(title)title.textContent=metric==='units'?'Ranked by quantity':'Ranked by net revenue';if(status)status.textContent='Sales History basis: Completed or Received, payment confirmed, not voided. Refunds reduce revenue; units remain unchanged because refunds are not item-specific.';if(print)print.disabled=false;
    body.innerHTML=ranked.length?ranked.map(function(item,index){return'<tr><td class="overview-ranking-position">'+(index+1)+'</td><td><strong>'+deps.esc(item.name)+'</strong></td><td class="overview-ranking-number">'+formatUnits(item.units)+'</td><td class="overview-ranking-number">'+money(item.revenue)+'</td></tr>';}).join(''):'<tr><td colspan="4" class="overview-ranking-empty">No completed drink sales were recorded in this period.</td></tr>';
  }
  function renderOutcomes(all,active){
    var names=['Completed','Received','Cancelled / Rejected','Voided','Refunded','Partially refunded'],colors={'Completed':['#d4edda','#155724'],'Received':['#c8e6c9','#1b5e20'],'Cancelled / Rejected':['#f8d7da','#721c24'],'Voided':['#f5d0d0','#7f1d1d'],'Refunded':['#fff3cd','#856404'],'Partially refunded':['#fff1d6','#8a510b']},counts={},total=0;names.forEach(function(n){counts[n]=0;});all.forEach(function(o){var x=outcome(o);if(x){counts[x]++;total++;}});
    var live=['Pending','Confirmed','Preparing','Ready'],liveHtml=live.map(function(s){var n=active.filter(function(o){return o.status===s;}).length;return'<span><b>'+n+'</b>'+s+'</span>';}).join(''),verify=active.filter(function(o){return o.paymentStatus==='pending';}).length,review=active.filter(function(o){return o.paymentStatus==='cashier_verified';}).length,el=document.getElementById('statusBreakdown');
    if(el)el.innerHTML='<div class="overview-live-head"><span>Live queue</span><small>Current, not date-filtered</small></div><div class="overview-live-grid">'+liveHtml+'<span><b>'+verify+'</b>Cashier checks</span><span><b>'+review+'</b>Manager reviews</span></div><div class="overview-outcome-head"><span>Outcomes</span><small>'+total+' order'+(total===1?'':'s')+'</small></div>'+names.map(function(n){var c=colors[n],pct=total?Math.round(counts[n]/total*100):0;return'<div class="overview-outcome-row" style="--row-bg:'+c[0]+';--row-fg:'+c[1]+'"><span>'+n+'</span><strong>'+counts[n]+' <small>'+pct+'%</small></strong></div>';}).join('');
  }
  function chart(rows,r){
    var canvas=document.getElementById('revenueChart');if(!canvas)return;var W=canvas.offsetWidth||500,H=180;canvas.width=W;canvas.height=H;var ctx=canvas.getContext('2d');ctx.clearRect(0,0,W,H);
    var start=r.start||Math.min.apply(null,rows.map(stamp).filter(Boolean).concat([dayStart(new Date())])),span=Math.max(86400000,r.end-start),monthly=span>62*86400000,buckets={},labels=[];
    function key(t){var d=new Date(t+8*3600000),ym=d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0');return monthly?ym:ym+'-'+String(d.getUTCDate()).padStart(2,'0');}
    var cursor=new Date(start+8*3600000);cursor.setUTCHours(0,0,0,0);if(monthly)cursor.setUTCDate(1);while(cursor.getTime()-8*3600000<=r.end&&labels.length<370){var k=key(cursor.getTime()-8*3600000);labels.push(k);buckets[k]={rev:0,count:0};if(monthly)cursor.setUTCMonth(cursor.getUTCMonth()+1);else cursor.setUTCDate(cursor.getUTCDate()+1);}
    rows.forEach(function(o){var b=buckets[key(stamp(o))];if(b){b.rev+=window.AccazaSales.amounts(o).net;b.count++;}});var rev=labels.map(function(k){return buckets[k].rev;}),cnt=labels.map(function(k){return buckets[k].count;}),maxR=Math.max.apply(null,rev.concat([1])),maxC=Math.max.apply(null,cnt.concat([1])),pad={l:42,r:10,t:10,b:30},cw=W-pad.l-pad.r,ch=H-pad.t-pad.b,gap=cw/Math.max(labels.length,1),bw=Math.max(2,gap*.58);
    ctx.strokeStyle='rgba(0,0,0,.07)';ctx.lineWidth=1;[0,.25,.5,.75,1].forEach(function(p){var y=pad.t+ch*(1-p);ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(W-pad.r,y);ctx.stroke();ctx.fillStyle='#79806f';ctx.font='10px Inter,sans-serif';ctx.textAlign='right';ctx.fillText(money(maxR*p),pad.l-4,y+3);});rev.forEach(function(v,i){var x=pad.l+i*gap+gap*.2,bh=v/maxR*ch;ctx.fillStyle='rgba(176,141,87,.75)';ctx.fillRect(x,pad.t+ch-bh,bw,bh);});ctx.strokeStyle='#3b8fd4';ctx.lineWidth=2;ctx.beginPath();cnt.forEach(function(v,i){var x=pad.l+i*gap+gap*.5,y=pad.t+ch*(1-v/maxC);i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.stroke();ctx.fillStyle='#3b8fd4';cnt.forEach(function(v,i){var x=pad.l+i*gap+gap*.5,y=pad.t+ch*(1-v/maxC);ctx.beginPath();ctx.arc(x,y,2.5,0,Math.PI*2);ctx.fill();});ctx.fillStyle='#79806f';ctx.font='9px Inter,sans-serif';ctx.textAlign='center';var every=Math.max(1,Math.ceil(labels.length/6));labels.forEach(function(k,i){if(i%every===0||i===labels.length-1)ctx.fillText(monthly?k:k.slice(5),pad.l+i*gap+gap*.5,H-8);});
  }
  function paint(){
    bind();if(!state.latest)return;var data=state.latest,r=range(),complete=data.historyComplete===true,label=document.getElementById('overviewRangeLabel');if(label)label.textContent=r.label;
    if(!complete){renderFullRanking();['overviewNetSales','overviewGrossSales','overviewTransactions','overviewAverageSale'].forEach(function(id){var el=document.getElementById(id);if(el)el.textContent='—';});var pending=document.getElementById('overviewDataNote');if(pending)pending.textContent='Loading the selected sales period…';['topItemsList','payMixList','statusBreakdown'].forEach(function(id){var el=document.getElementById(id);if(el)el.textContent='Loading…';});var canvas=document.getElementById('revenueChart');if(canvas)canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);return;}
    var periodSales=(data.sales||[]).filter(function(o){return inRange(o,r);}),periodOrders=(data.outcomes||[]).filter(function(o){return inRange(o,r);});
    var gross=0,net=0;periodSales.forEach(function(o){var v=window.AccazaSales.amounts(o);gross+=v.gross;net+=v.net;});function set(id,value){var el=document.getElementById(id);if(el)el.textContent=value;}set('overviewNetSales',money(net));set('overviewGrossSales',money(gross));set('overviewTransactions',String(periodSales.length));set('overviewAverageSale',money(periodSales.length?net/periodSales.length:0));
    renderPayments(periodSales);renderTop(periodSales,data);renderOutcomes(periodOrders,data.active||[]);chart(periodSales,r);renderFullRanking();
    var note=document.getElementById('overviewDataNote');if(note)note.textContent='Every completed paid order in the selected dates is loaded, including archived orders.';
  }
  return{render:function(data){state.latest=data;paint();},ensureHistory:ensureHistory};
}

export{buildDrinkRanking,createOverviewHistoryLoader,createOverviewInsights,mergeOverviewOrders,overviewDayRange,overviewRankingRange};
