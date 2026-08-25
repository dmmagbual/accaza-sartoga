function createOverviewInsights(deps){
  var saved={};try{saved=JSON.parse(localStorage.getItem('accaza-report-period')||'{}')||{};}catch(_e){}
  var allowed=['7','30','month','all'],state={period:allowed.indexOf(saved.period)>-1?saved.period:'month',from:'',to:'',metric:'units',latest:null,bound:false,loading:false};
  window.AccazaReportPeriod={get:function(){return{period:state.period};},set:function(v){v=v||{};state.period=allowed.indexOf(v.period)>-1?v.period:'month';try{localStorage.setItem('accaza-report-period',JSON.stringify(window.AccazaReportPeriod.get()));}catch(_e){}select();ensureHistory();paint();window.dispatchEvent(new CustomEvent('accaza-report-period',{detail:window.AccazaReportPeriod.get()}));}};
  function stamp(o){return Number(o&&o.timestamp)||Date.parse(o&&o.date)||Number(o&&o.archivedAt)||0;}
  function dayStart(d){var x=new Date(d);x.setHours(0,0,0,0);return x.getTime();}
  function range(){
    var now=new Date(),end=Date.now(),start=0,label='All time';
    if(state.period==='7'){start=dayStart(now)-6*86400000;label='Last 7 days';}
    else if(state.period==='30'){start=dayStart(now)-29*86400000;label='Last 30 days';}
    else if(state.period==='month'){start=new Date(now.getFullYear(),now.getMonth(),1).getTime();label='This month';}
    return{start:start,end:end,label:label};
  }
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
    document.querySelectorAll('[data-report-period]').forEach(function(btn){btn.addEventListener('click',function(){window.AccazaReportPeriod.set({period:this.dataset.reportPeriod});});});
    document.querySelectorAll('[data-overview-metric]').forEach(function(btn){btn.addEventListener('click',function(){state.metric=this.dataset.overviewMetric;select();paint();});});
    select();
  }
  function select(){document.querySelectorAll('[data-report-period]').forEach(function(btn){var on=btn.dataset.reportPeriod===state.period;btn.classList.toggle('active',on);btn.setAttribute('aria-pressed',on?'true':'false');});document.querySelectorAll('[data-overview-metric]').forEach(function(btn){var on=btn.dataset.overviewMetric===state.metric;btn.classList.toggle('active',on);btn.setAttribute('aria-pressed',on?'true':'false');});}
  async function ensureHistory(){
    if(state.loading||!state.latest)return;var r=range(),needStart=r.start,notice=document.getElementById('overviewDataNote');state.loading=true;if(notice)notice.textContent='Loading the required order history…';
    try{
      var feeds=[{path:'orders',rows:function(){return state.latest.active||[];},field:'timestamp'},{path:'archivedOrders',rows:function(){return state.latest.archived||[];},field:'archivedAt'}];
      for(var f=0;f<feeds.length;f++){
        var cfg=feeds[f],loops=0,status=deps.historyStatus(cfg.path);if(status.hasOlder&&!status.loaded)return;
        while(status.hasOlder&&loops<100){var oldest=cfg.rows().reduce(function(m,o){var t=Number(o&&o[cfg.field])||0;return t&&(!m||t<m)?t:m;},0);if(state.period!=='all'&&oldest&&oldest<=needStart)break;await deps.loadOlder(cfg.path);status=deps.historyStatus(cfg.path);loops++;}
      }
    }catch(e){if(notice)notice.textContent='Some older orders could not be loaded. Refresh and try again.';}
    finally{state.loading=false;paint();}
  }
  function money(v){return'₱'+Math.round(Number(v)||0).toLocaleString();}
  function renderPayments(rows){
    var mix={};rows.forEach(function(o){var pays=Array.isArray(o.payments)&&o.payments.length?o.payments:[{method:o.payment||'Other',amount:o.total||0}],refunds=o.refundPayments||{};pays.forEach(function(p){var method=p.method||'Other',net=Math.max(0,(Number(p.amount)||0)-(Number(refunds[method])||0));mix[method]=(mix[method]||0)+net;});});
    var keys=Object.keys(mix).filter(function(k){return mix[k]>.009;}).sort(function(a,b){return mix[b]-mix[a];}),total=keys.reduce(function(s,k){return s+mix[k];},0)||1,colors={'Cash':'#2a9d5c','GCash':'#b08d57','Bank Transfer':'#3b8fd4','PayMaya':'#7360f2','Split':'#e67e00'},el=document.getElementById('payMixList');
    if(el)el.innerHTML=keys.length?keys.map(function(k){return'<div class="overview-payment-row"><span class="overview-payment-dot" style="background:'+(colors[k]||'#999')+'"></span><span>'+deps.esc(k)+'</span><strong>'+money(mix[k])+' <small>'+Math.round(mix[k]/total*100)+'%</small></strong></div>';}).join(''):'<p class="overview-empty">No completed sales in this period.</p>';
  }
  function renderTop(rows,data){
    var items={},menu=data.menuItems||{},types=data.catType||{};function drink(li){var mi=menu[li&&li.itemKey];return!mi||types[mi.cat]!=='food';}
    rows.forEach(function(o){var gross=Number(o.subtotal!=null?o.subtotal:o.total)||0,net=Math.max(0,gross-(Number(o.discount)||0)-(Number(o.refundAmount)||0)),factor=gross>0?net/gross:0;if(net<=0||!Array.isArray(o.lineItems))return;o.lineItems.forEach(function(li){if(!li||!drink(li))return;var name=li.name||(menu[li.itemKey]&&menu[li.itemKey].name)||li.itemKey,qty=Number(li.qty)||0;if(!name)return;var row=items[name]||(items[name]={name:name,units:0,revenue:0});row.units+=qty;row.revenue+=qty*(Number(li.unitTotal)||0)*factor;});});
    var metric=state.metric,top=Object.values(items).sort(function(a,b){return b[metric]-a[metric];}).slice(0,10),medals=['🥇','🥈','🥉','4','5','6','7','8','9','10'],el=document.getElementById('topItemsList'),title=document.getElementById('overviewTopTitle');if(title)title.textContent='Top 10 Best Sellers - By '+(metric==='units'?'Quantity':'Revenue');if(el)el.innerHTML=top.length?top.map(function(x,i){return'<div class="overview-rank-row"><span>'+medals[i]+'</span><span>'+deps.esc(x.name)+'</span><strong>'+(metric==='units'?x.units+' sold':money(x.revenue))+'</strong></div>';}).join(''):'<p class="overview-empty">No structured drink sales in this period.</p>';
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
    bind();if(!state.latest)return;var data=state.latest,r=range(),periodSales=(data.sales||[]).filter(function(o){return inRange(o,r);}),periodOrders=(data.active||[]).concat(data.archived||[]).filter(function(o){return inRange(o,r);}),label=document.getElementById('overviewRangeLabel');if(label)label.textContent=r.label;
    var gross=0,net=0;periodSales.forEach(function(o){var v=window.AccazaSales.amounts(o);gross+=v.gross;net+=v.net;});function set(id,value){var el=document.getElementById(id);if(el)el.textContent=value;}set('overviewNetSales',money(net));set('overviewGrossSales',money(gross));set('overviewTransactions',String(periodSales.length));set('overviewAverageSale',money(periodSales.length?net/periodSales.length:0));
    renderPayments(periodSales);renderTop(periodSales,data);renderOutcomes(periodOrders,data.active||[]);chart(periodSales,r);
    var incomplete=['orders','archivedOrders'].some(function(path){return deps.historyStatus(path).hasOlder;}),note=document.getElementById('overviewDataNote');if(note&&!state.loading)note.textContent=incomplete?'Loading the required order history…':'Complete available order history loaded.';
  }
  return{render:function(data){state.latest=data;paint();ensureHistory();},ensureHistory:ensureHistory};
}

export{createOverviewInsights};
