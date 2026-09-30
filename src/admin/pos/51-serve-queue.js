/* ══════════ POS ORDER FLOW ══════════
   A paid order is not a handed-over order. Every accepted POS sale enters the Order queue and
   moves bottom-to-top through Now preparing, Ready to serve, then Served/Picked up.
   The same compact rail stays visible beside the selling screen; it is never a second listener.
   Serving is operational only: revenue, tender, stock, COGS and Finance Books already posted
   at payment and are never touched here. Website orders complete through their status flow. */
var SQ_WARN_MS=5*60000,SQ_LATE_MS=10*60000,SQ_RETRY_CODES=['unavailable','deadline-exceeded','internal','unknown','resource-exhausted','aborted'];
var sqState={recent:{},memPending:{},sending:{},confirmed:{},tick:null,folded:false,bar:false,loaded:false};
function sqPref(k,v){try{if(arguments.length<2){var x=localStorage.getItem('accazaServeQueue_'+k);return x==null?null:JSON.parse(x);}localStorage.setItem('accazaServeQueue_'+k,JSON.stringify(v));}catch(_e){}return null;}
function sqLoadPrefs(){if(sqState.loaded)return;sqState.loaded=true;sqState.folded=sqPref('folded')===true;sqState.bar=sqPref('bar')===true;var p=sqPref('pending');if(p&&typeof p==='object')sqState.memPending=p;}
// A stage action remains on this device until the server confirms it (or the sale syncs).
function sqPending(){sqLoadPrefs();return sqState.memPending;}
function sqSavePending(){sqPref('pending',sqState.memPending);}
function sqReqId(prefix){return prefix+'_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,10);}
function sqIsOnline(o){return !!o&&(o.source==='online'||o.channel==='online');}
function sqIsPlatform(o){var c=String(o&&o.channel||'').toLowerCase();return c==='grabfood'||c==='foodpanda';}
// Mirrors needsService() in functions/lib/order-service.js (tests keep them equal).
function sqNeedsService(o){
  if(!o||o.voided===true)return false;
  var total=Math.round((Number(o.total)||0)*100)/100,refund=Math.round((Number(o.refundAmount)||0)*100)/100;if(refund>0&&refund>=total-.009)return false;
  var st=String(o.service&&o.service.state||'');
  if(sqIsOnline(o))return st!=='not_collected'&&o.posCaptured===true&&!!o.shiftId&&['Confirmed','Preparing','Ready'].indexOf(String(o.status||''))>=0;
  return o.source==='pos'&&['instore','grabfood','foodpanda'].indexOf(String(o.channel||'instore').toLowerCase())>=0&&['queued','preparing','ready'].indexOf(st)>=0;
}
function sqStage(o){if(sqIsOnline(o)){var status=String(o.status||'');return status==='Ready'?'ready':status==='Preparing'?'preparing':'queued';}return String(o&&o.service&&o.service.state||'queued');}
function sqQueuedAt(o){return Number(o&&o.service&&o.service.queuedAt)||Number(o&&o.timestamp)||0;}
function sqUnsyncedRows(){var out=[],now=Date.now();((_offState&&_offState.rows)||[]).forEach(function(r){var o=r&&r.order;if(!o||!o.id||o.voided||o.source!=='pos')return;
  // A just-synced sale may reach this device's live feed a moment later; keep it visible meanwhile.
  if(r.status==='synced'&&now-Number(r.syncedAt||0)>120000)return;out.push(Object.assign({},o,{unsynced:r.status!=='synced',service:{state:'queued',queuedAt:Number(o.timestamp)||now}}));});return out;}
function sqRows(){
  var rows=[],seen={},pend=sqPending();
  Object.keys(onlineOrdersMap||{}).forEach(function(id){var source=onlineOrdersMap[id]||{},confirmed=sqState.confirmed[id],liveState=String(source.service&&source.service.state||'');if(confirmed&&liveState===confirmed){delete sqState.confirmed[id];confirmed='';}var o=Object.assign({},source,{id:id});if(confirmed)o.service=Object.assign({},source.service||{},{state:confirmed});seen[id]=1;delete sqState.recent[id];if(sqNeedsService(o))rows.push(o);});
  sqUnsyncedRows().forEach(function(o){if(!seen[o.id]){seen[o.id]=1;rows.push(o);}});
  Object.keys(sqState.recent).forEach(function(id){var o=sqState.recent[id];if(!o||Date.now()-sqQueuedAt(o)>120000){delete sqState.recent[id];return;}if(!seen[id])rows.push(o);});
  return rows.filter(function(o){return !pend[o.id];}).sort(function(a,b){return sqQueuedAt(a)-sqQueuedAt(b);});
}
function sqAgeClass(ms){return ms>=SQ_LATE_MS?'late':ms>=SQ_WARN_MS?'warn':'ok';}
function sqAgeText(ms){var m=Math.max(0,Math.floor(ms/60000));return m<1?'now':m<60?m+'m':Math.floor(m/60)+'h '+(m%60)+'m';}
function sqLabel(o){var n=String(o&&o.name||'').trim(),ref=String(o&&(o.platformRef||o.id)||'');return n&&!/^walk-?in( customer)?$/i.test(n)?n:'#'+ref.slice(-4).toUpperCase();}
function sqChannel(o){var c=sqIsOnline(o)?'online':String(o&&o.channel||'instore').toLowerCase();return({instore:['🏪','Walk-in'],online:['🌐','Online'],grabfood:['GF','GrabFood'],foodpanda:['FP','FoodPanda']})[c]||['🏪','Walk-in'];}
function sqServeWord(o){return sqIsPlatform(o)?'Picked up':'Served';}
function sqItemsHtml(o){var lines=o.correctedLineItems||o.lineItems||[];if(!lines.length)return o.items?'<li>'+esc(o.items)+'</li>':'';return lines.map(function(li){var name=String(li.name||''),size=li.size&&sqIsOnline(o)&&name.indexOf('('+li.size+')')<0?' ('+li.size+')':'',opts=(li.optLabels||[]).filter(Boolean);return '<li><b>'+(Number(li.qty)||1)+'×</b> '+esc(name+size)+(opts.length?'<small>'+esc(opts.join(', '))+'</small>':'')+'</li>';}).join('');}
function sqStageAction(o){var stage=sqStage(o);if(stage==='queued')return {action:'start_preparing',label:'Start prep'};if(stage==='preparing')return {action:'mark_ready',label:'Mark ready'};return {action:'serve',label:sqServeWord(o)};}
function sqCardHtml(o,now){var age=now-sqQueuedAt(o),ch=sqChannel(o),next=sqStageAction(o);
  return '<li class="sq-card age-'+sqAgeClass(age)+'" data-sq-id="'+esc(o.id)+'"><div class="sq-card-head"><span class="sq-ch" title="'+esc(ch[1])+'">'+esc(ch[0])+'</span><b class="sq-name">'+esc(sqLabel(o))+'</b><span class="sq-age">'+sqAgeText(age)+'</span></div>'
    +'<div class="sq-ref">'+esc(o.platformRef||o.id)+' · '+esc(ch[1])+(o.unsynced?' · <span class="sq-unsynced">not synced yet</span>':'')+'</div><ul class="sq-items">'+sqItemsHtml(o)+'</ul>'
    +'<div class="sq-actions"><button type="button" class="pz-btn sq-stage-btn stage-'+esc(sqStage(o))+'" data-sq-stage="'+esc(o.id)+'"'+(o.unsynced?' disabled title="Wait for this sale to sync"':'')+'>'+esc(next.label)+'</button>'+(!o.unsynced&&sqStage(o)==='ready'?'<button type="button" class="sq-link" data-sq-nc="'+esc(o.id)+'">Not collected</button>':'')+'</div></li>';}
function sqFind(id){if(!id)return null;if(onlineOrdersMap&&onlineOrdersMap[id])return Object.assign({},onlineOrdersMap[id],{id:id});return sqUnsyncedRows().filter(function(o){return o.id===id;})[0]||sqState.recent[id]||null;}
function renderServeQueue(){
  sqLoadPrefs();var host=document.getElementById('posServeQueue');if(document.body)document.body.classList.toggle('pos-bar-view',!!sqState.bar&&!!host);updateActiveOrderCount();if(!host)return;
  var rows=sqRows(),now=Date.now(),waiting=Object.keys(sqPending()).length,folded=sqState.folded&&!sqState.bar,oldest=rows.length?now-sqQueuedAt(rows[0]):0;
  host.classList.toggle('is-folded',folded);var shell=host.parentNode;if(shell&&shell.classList)shell.classList.toggle('sq-folded',folded);
  var sections=[{stage:'ready',title:'Ready to serve'},{stage:'preparing',title:'Now preparing'},{stage:'queued',title:'Order queue'}];
  if(folded)host.innerHTML='<button type="button" class="sq-folded-bar age-'+(rows.length?sqAgeClass(oldest):'ok')+'" data-sq-fold aria-expanded="false" aria-label="Open order flow, '+rows.length+' active"><span class="sq-count">'+rows.length+'</span><span class="sq-folded-age">'+(rows.length?sqAgeText(oldest):'✓')+'</span><span aria-hidden="true">»</span></button>';
  else host.innerHTML='<div class="sq-head"><div><b>Order flow</b> <span class="sq-count">'+rows.length+'</span></div><div class="sq-tools"><button type="button" class="sq-tool" data-sq-bar>'+(sqState.bar?'Exit bar view':'Bar view')+'</button>'+(sqState.bar?'':'<button type="button" class="sq-tool" data-sq-fold aria-expanded="true" aria-label="Fold order flow">«</button>')+'</div></div>'
    +(waiting?'<div class="sq-note">'+waiting+' served · sending'+(window.__online===false?' when back online':'')+'…</div>':'')
    +(rows.length?sections.map(function(section){var list=rows.filter(function(o){return sqStage(o)===section.stage;});return '<section class="sq-stage-section sq-stage-'+section.stage+'"><div class="sq-stage-head"><b>'+section.title+'</b><span>'+list.length+'</span></div>'+(list.length?'<ol class="sq-list">'+list.map(function(o){return sqCardHtml(o,now);}).join('')+'</ol>':'<div class="sq-stage-empty">None</div>')+'</section>';}).join(''):'<div class="sq-empty">✓ No active orders</div>');
  if(!sqState.tick)sqState.tick=setInterval(function(){if(document.getElementById('posServeQueue'))renderServeQueue();sqFlush();},20000);
}
function sqOnOrdersChanged(){renderServeQueue();sqFlush();}
function sqAdvance(o){if(!o||!o.id||sqPending()[o.id]||o.unsynced)return;var next=sqStageAction(o);sqPending()[o.id]={requestId:sqReqId(next.action),at:Date.now(),online:sqIsOnline(o),action:next.action,name:String(o.name||'').slice(0,60)};sqSavePending();renderServeQueue();sqFlush();}
function sqDropPending(id){delete sqPending()[id];sqSavePending();}
function sqRememberConfirmed(id,state){sqState.confirmed[id]=state;var ids=Object.keys(sqState.confirmed);while(ids.length>200)delete sqState.confirmed[ids.shift()];}
function sqFlush(){
  var p=sqPending(),ids=Object.keys(p),a=A();if(!ids.length||window.__online===false||!a)return;
  ids.forEach(function(id){if(sqState.sending[id])return;var e=p[id],live=onlineOrdersMap&&onlineOrdersMap[id];
    // Not in the live feed: the sale is still syncing (wait), or it was closed elsewhere long ago.
    if(!live){if(!sqUnsyncedRows().some(function(o){return o.id===id;})&&Date.now()-Number(e.at||0)>10*60000)sqDropPending(id);return;}
    var o=Object.assign({},live,{id:id});if(!sqNeedsService(o)){sqDropPending(id);return;} // already served, voided or refunded
    var onlineStatus={start_preparing:'Preparing',mark_ready:'Ready',serve:'Completed'}[e.action];
    var call=sqIsOnline(o)?(a.updateOrderStatus&&a.updateOrderStatus({orderId:id,status:onlineStatus,expectedStatus:o.status||'',requestId:e.requestId})):(a.callables&&a.callables.manageOrderService&&a.callables.manageOrderService({action:e.action,orderId:id,requestId:e.requestId}));
    if(!call)return;sqState.sending[id]=1;
    Promise.resolve(call).then(function(result){var payload=(result&&result.data)||result||{},confirmed=String(payload.state||'');if(!sqIsOnline(o)&&confirmed)sqRememberConfirmed(id,confirmed);sqDropPending(id);}).catch(function(err){var code=String(err&&err.code||'').replace(/^functions\//,'');if(SQ_RETRY_CODES.indexOf(code)<0){sqDropPending(id);(window.accazaToast||function(){})('Could not mark '+sqLabel(o)+' served: '+((err&&err.message)||err),'err');}}).then(function(){delete sqState.sending[id];renderServeQueue();});
  });
}
window.addEventListener('online',function(){setTimeout(sqFlush,1500);});
// A confirmed sale is already server-queued. Keep a short local copy so it appears immediately
// while the active-order subscription catches up; live server data replaces it automatically.
function sqAfterCharge(o){if(!o||!o.id)return;sqState.recent[o.id]=Object.assign({},o,{service:{state:'queued',queuedAt:Number(o.timestamp)||Date.now()}});renderServeQueue();}
// ── Not collected, manager review, return to queue ──
function sqServiceCall(command){var a=A();if(!a||!a.callables||!a.callables.manageOrderService)return Promise.reject(new Error('Refresh the portal to load the serving queue service.'));return a.callables.manageOrderService(command);}
function sqCancelled(e){return String((e&&e.message)||e).toLowerCase().indexOf('cancel')>=0;}
function sqForm(config,command,okText,failText){try{F();}catch(e){alert(e.message);return;}F().run(config,function(v){return sqServiceCall(command(v));}).then(function(){(window.accazaToast||function(){})(okText,'ok');}).catch(function(e){if(!sqCancelled(e))alert(failText+((e&&e.message)||e));});}
function sqNotCollected(o){if(!o)return;sqForm({title:'Order not collected',subtitle:sqLabel(o)+' · '+(o.platformRef||o.id)+' · '+peso(o.total),submitLabel:'Record not collected',busyLabel:'Recording…',fields:[{name:'reason',label:'What happened?',type:'textarea',required:true,maxLength:300,placeholder:'Example: customer left before the drink was ready'}]},function(v){return{action:'not_collected',orderId:o.id,requestId:sqReqId('nc'),reason:v.reason};},sqLabel(o)+' recorded as not collected · manager review','Could not record: ');}
function sqServiceTag(o){var s=o&&o.service;if(!s||sqIsOnline(o))return '';if(s.state==='queued')return '<span class="sq-tag wait">Order queue</span>';if(s.state==='preparing')return '<span class="sq-tag prep">Now preparing</span>';if(s.state==='ready')return '<span class="sq-tag ready">Ready to serve</span>';if(s.state==='served')return '<span class="sq-tag done">'+esc(sqServeWord(o))+(s.servedAt?' '+esc(new Date(s.servedAt).toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'})):'')+(s.servedByName?' · '+esc(s.servedByName):'')+'</span>';if(s.state==='not_collected')return '<span class="sq-tag nc">Not collected</span>';return '';}
function sqCompletedActions(o){var s=o&&o.service;return s&&s.state==='served'&&!sqIsOnline(o)?'<button class="pz-btn sec" data-sq-return="'+esc(o.id)+'">Return to queue</button>':'';}
function sqNotCollectedRows(){return Object.keys(onlineOrdersMap||{}).map(function(id){return Object.assign({},onlineOrdersMap[id]||{},{id:id});}).filter(function(o){return o.service&&o.service.state==='not_collected'&&!o.service.reviewedAt&&!o.voided;}).sort(function(a,b){return Number(a.service.notCollectedAt||0)-Number(b.service.notCollectedAt||0);});}
function sqNotCollectedHtml(){var rows=sqNotCollectedRows();if(!rows.length)return '';var mgr=!!(window.__accazaAuthz&&window.__accazaAuthz.isPrivileged);
  return '<div class="az-sec">Not collected · manager review ('+rows.length+')</div><div class="sq-nc-list">'+rows.map(function(o){var s=o.service;return '<article class="sq-nc"><div><b>'+esc(sqLabel(o))+'</b> <small>'+esc(o.platformRef||o.id)+' · '+esc(sqChannel(o)[1])+' · '+peso(o.total)+'</small><div class="sq-nc-reason">'+esc(s.notCollectedReason||'')+(s.notCollectedByName?' — '+esc(s.notCollectedByName):'')+'</div></div>'+(mgr?'<button class="pz-btn ok" data-sq-review="'+esc(o.id)+'">Mark reviewed</button>':'<span class="sq-tag wait">Manager review pending</span>')+'</article>';}).join('')+'</div><p class="pz-sub">The sale stands until a manager decides. Refunds go through the existing refund process; record the decision here.</p>';}
function sqWireShiftOrders(root){
  root.querySelectorAll('[data-sq-return]').forEach(function(b){b.onclick=function(){var id=b.getAttribute('data-sq-return'),o=sqFind(id);if(!o)return;sqForm({title:'Return to serving queue',subtitle:sqLabel(o)+' · '+(o.platformRef||o.id),submitLabel:'Return to queue',busyLabel:'Returning…',fields:[{name:'reason',label:'Why?',required:true,maxLength:300,placeholder:'Example: marked served by mistake'}]},function(v){return{action:'return_to_queue',orderId:id,requestId:sqReqId('rq'),reason:v.reason};},sqLabel(o)+' is back in the serving queue','Could not return the order: ');};});
  root.querySelectorAll('[data-sq-review]').forEach(function(b){b.onclick=function(){var id=b.getAttribute('data-sq-review'),o=sqFind(id);if(!o)return;sqForm({title:'Review order not collected',subtitle:sqLabel(o)+' · '+(o.platformRef||o.id)+' · '+peso(o.total),submitLabel:'Mark reviewed',busyLabel:'Saving…',fields:[{name:'note',label:'Decision',type:'textarea',required:true,maxLength:300,placeholder:'Example: refunded through Voids & Refunds / remade / kept as waste'}]},function(v){return{action:'review_not_collected',orderId:id,requestId:sqReqId('rv'),note:v.note};},'Review recorded','Could not record the review: ');};});
}
// ── Order-flow rail events (delegated) ──
document.addEventListener('click',function(ev){var t=ev.target&&ev.target.closest?ev.target.closest('[data-sq-stage],[data-sq-nc],[data-sq-fold],[data-sq-bar]'):null;if(!t||!t.closest('#posServeQueue'))return;
  if(t.hasAttribute('data-sq-fold')){sqState.folded=!sqState.folded;sqPref('folded',sqState.folded);renderServeQueue();return;}
  if(t.hasAttribute('data-sq-bar')){sqState.bar=!sqState.bar;sqPref('bar',sqState.bar);renderServeQueue();return;}
  var o=sqFind(t.getAttribute('data-sq-stage')||t.getAttribute('data-sq-nc'));if(!o)return;
  if(t.hasAttribute('data-sq-stage'))sqAdvance(o);else sqNotCollected(o);});
// ── Close-of-shift review: every unserved order gets an outcome; it never blocks the Z report ──
function sqReviewCounts(items){return{served:items.filter(function(x){return x.outcome==='served';}).length,handover:items.filter(function(x){return x.outcome==='handover';}).length,notCollected:items.filter(function(x){return x.outcome==='not_collected';}).length};}
function sqCloseReview(shift){
  var rows=sqRows();if(!rows.length)return Promise.resolve(null);
  return new Promise(function(resolve){
    var mask=document.createElement('div'),now=Date.now(),done=false;mask.className='sq-review-mask';document.body.appendChild(mask);
    function finish(result){if(done)return;done=true;if(mask.parentNode)mask.remove();resolve(result);}
    mask.innerHTML='<div class="sq-review" role="dialog" aria-modal="true" aria-labelledby="sqReviewTitle"><h3 id="sqReviewTitle">Before closing: '+rows.length+' order'+(rows.length===1?' is':'s are')+' not marked served</h3><p class="pz-sub">Choose what happened to each one. It is recorded on the Z report. The shift still closes; orders handed over stay in the queue for the next shift.</p>'
      +rows.map(function(o,i){var ch=sqChannel(o);return '<fieldset class="sq-review-row"><legend><b>'+esc(sqLabel(o))+'</b> <small>'+esc(o.platformRef||o.id)+' · '+esc(ch[1])+' · waiting '+sqAgeText(now-sqQueuedAt(o))+(o.unsynced?' · not synced yet':'')+'</small></legend><ul class="sq-items">'+sqItemsHtml(o)+'</ul>'
        +'<label><input type="radio" name="sqr'+i+'" value="served"/> '+esc(sqServeWord(o))+' (handed over, not tapped)</label><label><input type="radio" name="sqr'+i+'" value="handover"/> Hand over to next shift</label><label'+(o.unsynced?' class="is-disabled" title="Sync this sale first"':'')+'><input type="radio" name="sqr'+i+'" value="not_collected"'+(o.unsynced?' disabled':'')+'/> Customer didn&#39;t collect</label><input class="pz-in sq-review-reason" data-reason="'+i+'" maxlength="300" placeholder="Why wasn&#39;t it collected?" hidden/></fieldset>';}).join('')
      +'<div class="sq-review-error" role="alert"></div><div class="sq-review-actions"><button type="button" class="pz-btn ok" data-sq-review-ok>Record and continue to cash count</button><button type="button" class="pz-btn sec" data-sq-review-back>Back</button></div></div>';
    function choice(i){var x=mask.querySelector('input[name="sqr'+i+'"]:checked');return x?x.value:'';}
    mask.querySelectorAll('input[type=radio]').forEach(function(r){r.onchange=function(){var i=r.name.slice(3),box=mask.querySelector('[data-reason="'+i+'"]');if(box){box.hidden=choice(i)!=='not_collected';if(!box.hidden)box.focus();}};});
    mask.querySelector('[data-sq-review-back]').onclick=function(){finish({cancelled:true});};
    mask.querySelector('[data-sq-review-ok]').onclick=function(){
      var err=mask.querySelector('.sq-review-error'),items=[],ok=this;
      for(var i=0;i<rows.length;i++){var o=rows[i],c=choice(i),reason=((mask.querySelector('[data-reason="'+i+'"]')||{}).value||'').trim();if(!c){err.textContent='Choose what happened to '+sqLabel(o)+'.';return;}if(c==='not_collected'&&reason.length<3){err.textContent='Say why '+sqLabel(o)+' was not collected.';return;}
        items.push({orderId:o.id,outcome:c,reason:c==='not_collected'?reason:'',name:sqLabel(o),channel:sqIsOnline(o)?'online':String(o.channel||'instore'),queuedAt:sqQueuedAt(o),unsynced:!!o.unsynced,online:sqIsOnline(o)});}
      ok.disabled=true;ok.textContent='Recording…';err.textContent='';
      // Served website orders complete through their status; served unsynced sales apply after sync.
      items.forEach(function(x){if(x.outcome==='served'&&(x.unsynced||x.online))sqPending()[x.orderId]={requestId:sqReqId('serve'),at:Date.now(),online:x.online,action:'serve',name:x.name};});sqSavePending();sqFlush();
      var local={recorded:false,at:Date.now(),byName:(window.__posShift&&window.__posShift.staff)||'',counts:sqReviewCounts(items),items:items.map(function(x){return{orderId:x.orderId,outcome:x.outcome,reason:x.reason,name:x.name,channel:x.channel,queuedAt:x.queuedAt,applied:false,error:''};})};
      var a=A(),call=a&&a.callables&&a.callables.manageOrderService&&window.__online!==false?a.callables.manageOrderService({action:'close_review',shiftId:shift&&shift.id,requestId:sqReqId('review'),items:items.map(function(x){return{orderId:x.orderId,outcome:x.outcome,reason:x.reason,name:x.name,channel:x.channel,queuedAt:x.queuedAt,unsynced:x.unsynced};})}):null;
      if(!call){local.error='Offline: recorded on this till only.';finish(local);return;}
      Promise.race([call,new Promise(function(_r,rej){setTimeout(function(){rej(new Error('The server did not answer within 20 seconds.'));},20000);})]).then(function(res){finish(Object.assign({},(res&&res.data)||res||{},{recorded:true}));}).catch(function(e){local.error=String((e&&e.message)||e).slice(0,200);finish(local);});
    };
  });
}
window.__serveQueueCloseReview=sqCloseReview;
