/* ══════════ POS REGISTER ══════════ */
function buildPOS(){
  var _t=performance.now();
  var root=document.getElementById('posRoot'); if(!root)return;
  var cats=A().getCats?A().getCats():[];
  var chips='<button type="button" class="pz-chip '+(posCat==='ALL'?'on':'')+'" data-cat="ALL">All</button>'+cats.map(function(c){return '<button type="button" class="pz-chip '+(posCat===c.id?'on':'')+'" data-cat="'+esc(c.id)+'">'+esc(c.icon||'')+' '+esc(c.label)+'</button>';}).join('');
  var incoming=onlineOrderRows().filter(function(o){return !o.shiftId&&o.status!=='Rejected';}).length;
  var activeCount=shiftOrderRows().length;
  root.innerHTML='<div class="pos-channel-switch" role="tablist" aria-label="POS sales channels"><button type="button" class="pz-btn '+(posView==='counter'?'ok':'sec')+'" data-pos-view="counter" role="tab" aria-selected="'+(posView==='counter')+'">🏪 In-store</button><button type="button" class="pz-btn '+(posView==='online'?'ok':'sec')+'" data-pos-view="online" role="tab" aria-selected="'+(posView==='online')+'">🌐 Online Orders <span id="posOnlineCount" class="pos-online-count"'+(incoming?'':' hidden')+'>'+incoming+'</span></button><button type="button" class="pz-btn '+(posView==='active'?'ok':'sec')+'" data-pos-view="active" role="tab" aria-selected="'+(posView==='active')+'">🧾 Shift Orders <span id="posActiveCount" class="pos-active-count"'+(activeCount?'':' hidden')+'>'+activeCount+'</span></button></div>'
    +(posView==='online'?'<div id="posOnlineOrdersPanel"></div>':posView==='active'?'<div id="posActiveOrdersPanel"></div>':(
    '<div class="pos-counter-head"><div><div class="pz-h" style="margin:0;">Counter service</div><p class="pz-sub" style="margin:.2rem 0 0;">Find an item, check the ticket, then take payment.</p></div></div>'
    +'<div class="pz-posgrid" style="display:grid;grid-template-columns:1.7fr 1fr;gap:1rem;align-items:start;">'
      +'<div class="pos-menu-deck"><label class="pos-menu-search"><span>Find an item</span><input class="pz-in" id="posMenuSearch" type="search" autocomplete="off" placeholder="Search coffee, pastry, package…" value="'+esc(posSearch)+'"/></label><div id="posChips" class="pos-category-rail">'+chips+'</div><div id="posItems" class="pos-item-grid"></div></div>'
      +'<div class="pz-card" id="posCartPanel" style="position:sticky;top:1rem;"></div>'
    +'</div>'));
  root.querySelectorAll('[data-pos-view]').forEach(function(button){button.onclick=function(){posView=button.getAttribute('data-pos-view');buildPOS();};});
  if(posView==='online'){renderOnlineOrders();posBuilt=true;return;}
  if(posView==='active'){renderActiveOrders();posBuilt=true;return;}
  root.querySelectorAll('[data-cat]').forEach(function(ch){ch.onclick=function(){posCat=ch.getAttribute('data-cat');buildPOS();};});
  var search=document.getElementById('posMenuSearch');if(search){search.oninput=function(){posSearch=this.value||'';drawPosItems();};}
  drawPosItems(); renderPosCart(); posBuilt=true;telemetry().metric('pos_build',performance.now()-_t,true);
}
function onlineOrderRows(){return Object.keys(onlineOrdersMap).map(function(id){return Object.assign({id:id},onlineOrdersMap[id]||{});}).filter(function(o){return o.source==='online'||o.channel==='online';}).filter(function(o){return o.status!=='Received'&&!o.voided;}).sort(function(a,b){return(Number(b.timestamp)||0)-(Number(a.timestamp)||0);});}
function updateOnlineOrderCount(){var badge=document.getElementById('posOnlineCount');if(!badge)return;var count=onlineOrderRows().filter(function(o){return !o.shiftId&&o.status!=='Rejected';}).length;badge.textContent=count;badge.hidden=!count;}
function shiftOrderRows(){var shift=window.__posShift||null;return Object.keys(onlineOrdersMap).map(function(id){return Object.assign({id:id},onlineOrdersMap[id]||{});}).filter(function(o){return o.shiftId&&shift&&o.shiftId===shift.id;}).sort(function(a,b){return(Number(b.timestamp)||0)-(Number(a.timestamp)||0);});}
function activeOrderRows(){return shiftOrderRows().filter(function(o){return o.channel==='online'&&!o.voided&&['Pending','Confirmed','Preparing','Ready'].indexOf(o.status)>=0;}).sort(function(a,b){var rank={Ready:0,Preparing:1,Confirmed:2,Pending:3};return(rank[a.status]-rank[b.status])||((Number(a.timestamp)||0)-(Number(b.timestamp)||0));});}
function updateActiveOrderCount(){var badge=document.getElementById('posActiveCount');if(!badge)return;var count=shiftOrderRows().length;badge.textContent=count;badge.hidden=!count;}
function updatePosOrderCounts(){updateOnlineOrderCount();updateActiveOrderCount();}
function activeChannelLabel(o){return o.channel==='online'?'Online':o.channel==='grabfood'?'GrabFood':o.channel==='foodpanda'?'FoodPanda':'In-store';}
function paymentVerificationSignature(payments,total){
  var cart=Object.keys(posCart).sort().map(function(k){var c=posCart[k]||{};return[k,Number(c.qty)||0,Number(c.unitTotal)||0];});
  var direct=directPaymentRows(payments).map(function(p){return[String(p.method||''),Math.round((Number(p.amount)||0)*100)/100,String(p.ref||'').trim()];});
  return JSON.stringify({cart:cart,total:Math.round((Number(total)||0)*100)/100,direct:direct});
}
function cashierVerificationGate(payments,total,context){
  var direct=directPaymentRows(payments),existing=direct.map(function(p){return p.ref||'';}).filter(Boolean).join(', ');
  if(!direct.length)return Promise.resolve({required:false});
  return F().run({title:'Cashier payment verification',subtitle:context+' · '+peso(total)+' · '+direct.map(function(p){return p.method;}).join(' + '),submitLabel:'Verify payment',busyLabel:'Recording verification…',fields:[{name:'reference',label:'Transaction reference',value:existing,required:true,maxLength:120,placeholder:'Enter the successful transaction reference',help:'Match this against the actual read-only GCash, Maya, or bank transaction history.'},{name:'confirmed',label:'I found this successful payment in the actual receiving account',type:'checkbox',required:true,help:'A customer screenshot by itself is not sufficient.'}]},function(v){if(direct.length===1)direct[0].ref=v.reference;return{required:true,reference:v.reference};});
}
function verifyOnlinePayment(oid,button){
  var o=onlineOrdersMap[oid],a=A();if(!o){alert('Order not found. Refresh the POS and try again.');return;}if(o.paymentStatus!=='pending'){alert('This payment is no longer awaiting cashier verification.');return;}if(!a||!a.processOrderAdjustment){alert('Payment verification is unavailable. Refresh the POS and try again.');return;}
  if(paymentVerificationPolicy((o.payments&&o.payments.length)?o.payments:[{method:o.payment,amount:o.total}])==='manager_only'){managerVerifyOnlinePayment(oid,button);return;}
  var payments=(o.payments&&o.payments.length)?o.payments:[{method:o.payment,amount:o.total,ref:''}],old=button&&button.textContent;
  cashierVerificationGate(payments,Number(o.total)||0,'Online order #'+oid).then(function(v){if(button){button.disabled=true;button.textContent='Verifying…';}return a.processOrderAdjustment({action:'cashier_verify_payment',orderId:oid,reference:v.reference});}).then(function(){if(window.__posLog)window.__posLog('cashier-verify-payment',oid,peso(o.total)+' · '+(o.payment||''));(window.accazaToast||function(){})('Payment verified · order confirmed','ok');}).catch(function(e){if(String((e&&e.code)||e).indexOf('cancelled')<0&&String((e&&e.message)||e).indexOf('cancelled')<0)alert('Payment confirmation failed: '+((e&&e.message)||e));}).finally(function(){if(button&&document.body.contains(button)){button.disabled=false;button.textContent=old;}});
}
function managerVerifyOnlinePayment(oid,button){var o=onlineOrdersMap[oid],a=A(),old=button&&button.textContent;if(!o||o.paymentStatus!=='pending'){alert('This payment is no longer awaiting manager verification.');return;}if(!a||!a.processOrderAdjustment||!a.managerApproval){alert('Manager verification is unavailable. Refresh the POS and try again.');return;}if(button){button.disabled=true;button.textContent='Approving…';}a.managerApproval('validate_payment',oid,Number(o.total)||0,'Manager-only payment verification').then(function(ap){return a.processOrderAdjustment({action:'manager_validate_payment',orderId:oid,approvalId:ap.approvalId});}).then(function(){if(window.__posLog)window.__posLog('manager-validate-payment',oid,peso(o.total));(window.accazaToast||function(){})('Payment manager validated · order confirmed','ok');}).catch(function(e){if(String((e&&e.code)||e).indexOf('cancelled')<0&&String((e&&e.message)||e).indexOf('cancelled')<0)alert('Manager verification failed: '+((e&&e.message)||e));}).finally(function(){if(button&&document.body.contains(button)){button.disabled=false;button.textContent=old;}});}
function posLegacyItemLines(text){var out=[],buf='',depth=0;String(text||'').split('').forEach(function(ch){if(ch==='(')depth++;if(ch===')'&&depth>0)depth--;if(ch===','&&depth===0){if(buf.trim())out.push(buf.trim());buf='';}else buf+=ch;});if(buf.trim())out.push(buf.trim());return out;}
function posOrderItemsHtml(o){
  var isOnline=(o.source==='online'||o.channel==='online');function sizeTag(li){if(!li.size)return '';var n=String(li.name||'').toLowerCase(),sz=String(li.size).toLowerCase();if(n.indexOf('('+sz+')')>=0)return '';if(!isOnline)return '';return ' <em>('+esc(li.size)+')</em>';}
  var lines=Array.isArray(o.lineItems)&&o.lineItems.length?o.lineItems.map(function(li){return{name:li.name||li.itemKey||'Item',size:li.size||'',options:Array.isArray(li.optLabels)?li.optLabels:[],qty:Math.max(1,Number(li.qty)||1)};}):posLegacyItemLines(o.items).map(function(text){var qm=text.match(/\s+x(\d+)\s*$/i);return{name:qm?text.slice(0,qm.index).trim():text,size:'',options:[],qty:qm?Math.max(1,Number(qm[1])||1):1};});
  if(!lines.length)return '<div class="pos-order-items-empty">No item details recorded</div>';
  return '<div class="pos-order-items" aria-label="Order items"><div class="pos-order-items-heading"><span>🛒 Order items</span><b>'+lines.length+' line'+(lines.length===1?'':'s')+'</b></div><ul>'+lines.map(function(li){return '<li><span class="pos-order-item-qty">'+esc(li.qty)+'×</span><span class="pos-order-item-detail"><strong>'+esc(li.name)+sizeTag(li)+'</strong>'+(li.options.length?'<small>'+li.options.map(esc).join(' · ')+'</small>':'')+'</span></li>';}).join('')+'</ul></div>';
}
function renderActiveOrders(){
  var root=document.getElementById('posActiveOrdersPanel');if(!root)return;var rows=shiftOrderRows(),shift=window.__posShift||null,needs=activeOrderRows(),completed=rows.filter(function(o){return !o.voided&&['Completed','Received'].indexOf(o.status)>=0;}),exceptions=rows.filter(function(o){return o.voided||o.status==='Rejected';}),stages=['Confirmed','Preparing','Ready'],salesTotal=completed.reduce(function(sum,o){return sum+(Number(o.total)||0)-(Number(o.refundAmount)||0);},0);
  function actionCard(o){var stage=o.status==='Pending'?'Confirmed':o.status,idx=stages.indexOf(stage),next=o.status==='Pending'?'Confirmed':o.status==='Confirmed'?'Preparing':o.status==='Preparing'?'Ready':o.status==='Ready'?'Completed':'',channel=activeChannelLabel(o);
    var rail='<div class="pos-stage-rail" aria-label="Order progress">'+stages.map(function(s,i){return '<span class="'+(i<idx?'done':i===idx?'now':'')+'">'+(i<idx?'✓ ':i===idx?'● ':'')+s+'</span>';}).join('')+'</div>';
    var action=next?'<button class="pz-btn ok pos-active-primary" data-active-status="'+esc(o.id)+'" data-next="'+next+'">'+(next==='Confirmed'?'Confirm order':next==='Preparing'?'Start preparing':next==='Ready'?'Mark ready':'Complete order')+'</button>':'';
    return '<article class="pos-active-card channel-'+esc(o.channel||'instore')+'"><div class="pos-active-head"><div><span class="pos-channel-tag">'+esc(channel)+'</span><b>#'+esc(o.id)+'</b><small>'+esc(o.name||o.staff||'Walk-in customer')+'</small></div><strong>'+peso(o.total)+'</strong></div>'+rail+posOrderItemsHtml(o)+'<div class="pos-active-foot"><span>'+esc(o.type||'Counter')+' · '+esc(o.payment||'Payment recorded')+'</span>'+action+'</div></article>';}
  function completedCard(o){var channel=activeChannelLabel(o);return '<article class="pos-shift-sale channel-'+esc(o.channel||'instore')+'"><div class="pos-shift-sale-head"><div><span class="pos-channel-tag">'+esc(channel)+'</span><b>#'+esc(o.id)+'</b><small>'+esc(o.name||o.staff||'Walk-in customer')+'</small></div><div><strong>'+peso((Number(o.total)||0)-(Number(o.refundAmount)||0))+'</strong><span>✓ '+esc(o.status)+'</span></div></div>'+posOrderItemsHtml(o)+'<div class="pos-active-foot"><span>'+esc(o.payment||'Payment recorded')+(Number(o.refundAmount)>0?' · Refunded '+peso(o.refundAmount):'')+'</span></div></article>';}
  function exceptionCard(o){return '<article class="pos-shift-exception"><div><b>#'+esc(o.id)+'</b><span>'+esc(activeChannelLabel(o))+' · '+esc(o.voided?'Voided':o.status)+'</span></div><strong>'+peso(o.total)+'</strong></article>';}
  root.innerHTML='<div class="pos-counter-head"><div><div class="pz-h" style="margin:0;">Shift Orders</div><p class="pz-sub" style="margin:.2rem 0 0;">Every order assigned to the current shift, with online work separated from completed sales.</p></div><span class="pos-online-shift '+(shift?'open':'closed')+'">'+(shift?'Shift open · '+esc(shift.staff||'Cashier'):'No open shift')+'</span></div>'+(shift?'<div class="pos-shift-summary"><div><span>Orders in shift</span><b>'+rows.length+'</b></div><div><span>Needs action</span><b>'+needs.length+'</b></div><div><span>Completed sales</span><b>'+completed.length+'</b></div><div class="total"><span>Sales total</span><b>'+peso(salesTotal)+'</b></div></div>':'')+(needs.length?'<div class="az-sec pos-needs-title">Online orders needing action ('+needs.length+')</div><div class="pos-active-grid">'+needs.map(actionCard).join('')+'</div>':'<div class="pos-shift-clear">✓ No online orders need action</div>')+(completed.length?'<div class="az-sec pos-completed-title">Completed sales this shift ('+completed.length+')</div><div class="pos-shift-sales-grid">'+completed.map(completedCard).join('')+'</div>':(shift?'<div class="pos-menu-empty"><b>No completed sales yet</b><span>In-store, online, GrabFood, and FoodPanda sales will remain here until the shift closes.</span></div>':''))+(exceptions.length?'<div class="az-sec pos-exception-title">Not included in sales ('+exceptions.length+')</div><div class="pos-shift-exceptions">'+exceptions.map(exceptionCard).join('')+'</div>':'');
  root.querySelectorAll('[data-active-status]').forEach(function(b){b.onclick=function(){var id=b.getAttribute('data-active-status'),next=b.getAttribute('data-next'),o=onlineOrdersMap[id]||{};b.disabled=true;b.textContent='Updating…';A().updateOrderStatus({orderId:id,status:next,expectedStatus:o.status||'',requestId:'pos_active_'+Date.now()+'_'+Math.random().toString(36).slice(2)}).then(function(){(window.accazaToast||function(){})('Order moved to '+next,'ok');}).catch(function(e){alert('Could not update order: '+((e&&e.message)||e));b.disabled=false;renderActiveOrders();});};});
}
function onlineStatusAction(o){if(!o.shiftId)return'';var next=o.status==='Confirmed'?'Preparing':o.status==='Preparing'?'Ready':o.status==='Ready'?'Completed':'';if(!next)return'';return '<button class="pz-btn ok" data-online-status="'+esc(o.id)+'" data-next="'+next+'">'+(next==='Preparing'?'Start preparing':next==='Ready'?'Mark ready':'Complete order')+'</button>';}
function renderOnlineOrders(){
  var root=document.getElementById('posOnlineOrdersPanel');if(!root)return;var rows=onlineOrderRows(),shift=window.__posShift||null;
  var active=rows.filter(function(o){return o.shiftId&&shift&&o.shiftId===shift.id;}),incoming=rows.filter(function(o){return !o.shiftId;});
  function card(o){var verified=['cashier_verified','manager_validated','confirmed'].indexOf(o.paymentStatus)>=0,captured=!!o.shiftId,proof=o.proofPath?'<button class="pz-btn sec" data-online-proof="'+esc(o.id)+'">View payment proof</button>':'',action='';
    if(o.status==='Rejected')action='<span class="pos-online-state rejected">Rejected</span>';
    else if(!verified){var managerOnly=paymentVerificationPolicy((o.payments&&o.payments.length)?o.payments:[{method:o.payment,amount:o.total}])==='manager_only';action='<button class="pz-btn ok" data-online-verify="'+esc(o.id)+'">'+(managerOnly?'Manager verify':'Cashier verify')+'</button><button class="pz-btn warn" data-online-reject="'+esc(o.id)+'">Reject</button>';}
    else if(!captured)action='<button class="pz-btn ok" data-online-accept="'+esc(o.id)+'"'+(shift?'':' disabled')+'>'+(shift?'Accept into shift':'Open a shift first')+'</button><button class="pz-btn warn" data-online-reject="'+esc(o.id)+'">Reject</button>';
    else action='<span class="pos-online-state captured">'+(o.paymentStatus==='cashier_verified'?'Cashier verified · manager review pending':'Payment validated')+' · '+esc(o.status)+'</span>'+onlineStatusAction(o);
    return '<article class="pos-online-card"><div class="pos-online-card-head"><div><b>'+esc(o.name||'Customer')+'</b><span>#'+esc(o.id)+'</span></div><strong>'+peso(o.total)+'</strong></div><div class="pos-online-meta">'+esc(o.type||'Pick-up')+' · '+esc(o.payment||'Online payment')+' · '+esc(o.time||'')+'</div>'+posOrderItemsHtml(o)+(o.address?'<div class="pos-online-meta">📍 '+esc(o.address)+'</div>':'')+'<div class="pos-online-actions">'+proof+action+'</div></article>';}
  root.innerHTML='<div class="pos-counter-head"><div><div class="pz-h" style="margin:0;">Online Orders</div><p class="pz-sub" style="margin:.2rem 0 0;">Verify payment, accept into the open shift, then move the order through preparation.</p></div><span class="pos-online-shift '+(shift?'open':'closed')+'">'+(shift?'Shift open · '+esc(shift.staff||'Cashier'):'No open shift')+'</span></div>'
    +(incoming.length?'<div class="az-sec">Incoming ('+incoming.length+')</div><div class="pos-online-grid">'+incoming.map(card).join('')+'</div>':'<div class="pos-menu-empty"><b>No incoming online orders</b><span>New website orders will appear here automatically.</span></div>')
    +(active.length?'<div class="az-sec" style="margin-top:1rem;">Captured in this shift ('+active.length+')</div><div class="pos-online-grid">'+active.map(card).join('')+'</div>':'');
  root.querySelectorAll('[data-online-proof]').forEach(function(b){b.onclick=function(){if(window.showStoredProof)window.showStoredProof(b.getAttribute('data-online-proof'),b);};});
  root.querySelectorAll('[data-online-verify]').forEach(function(b){b.onclick=function(){verifyOnlinePayment(b.getAttribute('data-online-verify'),b);};});
  root.querySelectorAll('[data-online-accept]').forEach(function(b){b.onclick=function(){var id=b.getAttribute('data-online-accept');b.disabled=true;b.textContent='Accepting…';A().acceptOnlineOrder({orderId:id}).then(function(){(window.accazaToast||function(){})('Online order captured in POS','ok');}).catch(function(e){alert('Could not accept order: '+((e&&e.message)||e));b.disabled=false;b.textContent='Accept into shift';});};});
  root.querySelectorAll('[data-online-reject]').forEach(function(b){b.onclick=function(){var id=b.getAttribute('data-online-reject'),o=onlineOrdersMap[id]||{};if(!confirm('Reject online order '+id+'?'))return;A().updateOrderStatus({orderId:id,status:'Rejected',expectedStatus:o.status||'Pending',requestId:'online_reject_'+Date.now()+'_'+Math.random().toString(36).slice(2)}).catch(function(e){alert('Could not reject order: '+((e&&e.message)||e));});};});
  root.querySelectorAll('[data-online-status]').forEach(function(b){b.onclick=function(){var id=b.getAttribute('data-online-status'),next=b.getAttribute('data-next'),o=onlineOrdersMap[id]||{};b.disabled=true;A().updateOrderStatus({orderId:id,status:next,expectedStatus:o.status||'',requestId:'online_status_'+Date.now()+'_'+Math.random().toString(36).slice(2)}).catch(function(e){alert('Could not update order: '+((e&&e.message)||e));b.disabled=false;});};});
}
window.__openPosOnlineOrders=function(){posView='online';var button=document.getElementById('tabBtnPos');if(button)button.click();else buildPOS();};
function drawPosItems(){
  var wrap=document.getElementById('posItems'); if(!wrap)return;
  var q=String(posSearch||'').trim().toLowerCase();
  var items=menuList().filter(function(it){return (posCat==='ALL'||it.cat===posCat)&&(!q||String(it.name||'').toLowerCase().indexOf(q)>-1);});
  if(!items.length){wrap.innerHTML='<div class="pos-menu-empty"><b>No matching items</b><span>Try another name or choose All.</span></div>';return;}
  var plat=posIsPlatform();
  var tileBg=posChannel==='grabfood'?'#e8f5ec':posChannel==='foodpanda'?'#fde8e8':'';
  var tileBd=posChannel==='grabfood'?'#b8dfc4':posChannel==='foodpanda'?'#f5c6c6':'';
  var st=tileBg?(' style="background:'+tileBg+';border-color:'+tileBd+';"'):'';
  wrap.innerHTML=items.map(function(it){
    var pr;
    if(plat){ var s=channelPriceOf(posChannel,it.key,'S'),m=channelPriceOf(posChannel,it.key,'M'),l=channelPriceOf(posChannel,it.key,'L'); pr=(it.priceM||it.priceL)?('S '+(s||'–')+' · M '+(m||'–')+' · L '+(l||'–')):(s?('₱'+s):'no price'); }
    else { pr=it.priceM?('S '+it.priceS+' · M '+it.priceM+' · L '+it.priceL):('₱'+(it.priceS||0)); }
    var cat=(A().getCatLabel?A().getCatLabel(it.cat):'')||it.cat||'Menu';
    if(!posIsAvail(it.name)){ return '<button class="pz-item" disabled style="opacity:0.45;cursor:not-allowed;'+(tileBg?'background:'+tileBg+';border-color:'+tileBd+';':'')+'"><span class="pos-item-cat">'+esc(cat)+'</span><div class="n">'+esc(it.name)+'</div><div class="p" style="color:#c0392b;">Unavailable</div></button>'; }
    return '<button class="pz-item"'+st+' data-item="'+esc(it.key)+'"><span class="pos-item-cat">'+esc(cat)+'</span><div class="n">'+esc(it.name)+'</div><div class="p">'+esc(pr)+'</div><span class="pos-item-add" aria-hidden="true">＋</span></button>';}).join('');
  wrap.querySelectorAll('[data-item]').forEach(function(b){b.onclick=function(){openPosItem(b.getAttribute('data-item'));};});
}
// ---- item customize modal ----
var mSel={};
function openPosItem(key){
  var _raw=A().menuItemsMap[key]; if(!_raw)return;
  var item=Object.assign({key:key},_raw);
  if(!posIsAvail(item.name)){alert(item.name+' is marked unavailable — it can’t be sold. Toggle it back on in Availability first.');return;}
  var body=document.getElementById('pzItemBody'); var titleEl=document.getElementById('pzItemTitle');
  titleEl.textContent=item.name;
  var plat=posIsPlatform();
  mSel={item:Object.assign({key:key},item), size:null, price:posBasePrice(item,'S'), opts:{}, qty:1};
  var html='';
  if(plat)html+='<div style="font-size:0.72rem;color:var(--tl);margin-bottom:0.4rem;">'+esc(channelLabel(posChannel))+' pricing — item &amp; add-on prices from Channel Pricing.</div>';
  var hasM=item.priceM&&item.priceL, hasAB=item.labelS&&item.labelL&&item.priceL;
  if(hasAB){ html+=sizeBlock([['S',item.labelS||'Option 1',posBasePrice(item,'S')],['L',item.labelL||'Option 2',posBasePrice(item,'L')]]); }
  else if(hasM){ html+=sizeBlock([['S','Small',posBasePrice(item,'S')],['M','Medium',posBasePrice(item,'M')],['L','Large',posBasePrice(item,'L')]]); }
  else { mSel.size='S'; mSel.price=posBasePrice(item,'S'); }
  var groups=(A().getItemOptionGroups?A().getItemOptionGroups(item):[]);
  groups.forEach(function(g){
    html+='<div style="margin-top:0.8rem;"><span class="pz-lbl">'+esc(g.name)+(g.type!=='multi'&&g.required!==false?' (required)':'')+'</span>';
    html+=(g.choices||[]).map(function(c,ci){var pp=optChoicePrice(g.id,c.label,c.price);return '<div class="pz-opt" data-g="'+esc(g.id)+'" data-multi="'+(g.type==='multi'?1:0)+'" data-label="'+esc(c.label)+'" data-price="'+pp+'"><span>'+esc(c.label)+'</span><span>'+(pp>0?'+₱'+pp:'Free')+'</span></div>';}).join('');
    html+='</div>';
  });
  html+='<div style="margin-top:0.9rem;display:flex;align-items:center;gap:0.8rem;"><span class="pz-lbl" style="margin:0;">Qty</span><button class="pz-btn sec" id="pzQtyM" style="padding:0.2rem 0.7rem;">−</button><span id="pzQtyN" style="font-weight:600;">1</span><button class="pz-btn sec" id="pzQtyP" style="padding:0.2rem 0.7rem;">+</button></div>';
  body.innerHTML=html;
  body.querySelectorAll('.pz-opt').forEach(function(o){o.onclick=function(){toggleOpt(o);};});
  document.getElementById('pzQtyM').onclick=function(){mSel.qty=Math.max(1,mSel.qty-1);document.getElementById('pzQtyN').textContent=mSel.qty;updatePzTotal();};
  document.getElementById('pzQtyP').onclick=function(){mSel.qty++;document.getElementById('pzQtyN').textContent=mSel.qty;updatePzTotal();};
  updatePzTotal();
  var _pzm=document.getElementById('pzItemMask'); _pzm.classList.remove('ch-grabfood','ch-foodpanda'); if(posChannel==='grabfood')_pzm.classList.add('ch-grabfood'); else if(posChannel==='foodpanda')_pzm.classList.add('ch-foodpanda'); _pzm.classList.add('show');
}
function sizeBlock(arr){ return '<div><span class="pz-lbl">Serving size (required)</span>'+arr.map(function(a){return '<div class="pz-opt" data-size="'+a[0]+'" data-price="'+a[2]+'"><span>'+esc(a[1])+'</span><span>₱'+a[2]+'</span></div>';}).join('')+'</div>'; }
function toggleOpt(el){
  if(el.hasAttribute('data-size')){ document.querySelectorAll('#pzItemBody .pz-opt[data-size]').forEach(function(o){o.classList.remove('on');}); el.classList.add('on'); mSel.size=el.getAttribute('data-size'); mSel.price=Number(el.getAttribute('data-price'))||0; updatePzTotal(); return; }
  var g=el.getAttribute('data-g'), multi=el.getAttribute('data-multi')==='1', label=el.getAttribute('data-label'), price=Number(el.getAttribute('data-price'))||0;
  mSel.opts[g]=mSel.opts[g]||[];
  if(multi){ var ix=mSel.opts[g].findIndex(function(x){return x.label===label;}); if(ix>-1){mSel.opts[g].splice(ix,1);el.classList.remove('on');} else {mSel.opts[g].push({label:label,price:price});el.classList.add('on');} }
  else { document.querySelectorAll('#pzItemBody .pz-opt[data-g="'+g+'"]').forEach(function(o){o.classList.remove('on');}); el.classList.add('on'); mSel.opts[g]=[{label:label,price:price}]; }
  updatePzTotal();
}
function pzUnit(){ var t=mSel.price||0; Object.keys(mSel.opts).forEach(function(g){(mSel.opts[g]||[]).forEach(function(c){t+=c.price||0;});}); return t; }
function updatePzTotal(){ document.getElementById('pzItemTotal').textContent=peso(pzUnit()*mSel.qty); }
function pzAddToCart(){
  var item=mSel.item; var plat=posIsPlatform();
  var hasM=item.priceM&&item.priceL, hasAB=item.labelS&&item.labelL&&item.priceL;
  if((hasM||hasAB)&&!mSel.size){alert('Please select a size.');return;}
  if(plat&&!(posBasePrice(item,mSel.size||'S')>0)){alert('No '+channelLabel(posChannel)+' price set for this item/size — set it in Channel Pricing first.');return;}
  var groups=(A().getItemOptionGroups?A().getItemOptionGroups(item):[]);
  for(var i=0;i<groups.length;i++){var g=groups[i];if(g.type!=='multi'&&g.required!==false&&!(mSel.opts[g.id]&&mSel.opts[g.id].length)){alert('Please select: '+g.name);return;}}
  var optLabels=[],details=[]; Object.keys(mSel.opts).forEach(function(g){(mSel.opts[g]||[]).forEach(function(c){optLabels.push(c.label);details.push(c.label);});});
  var key=uid('pc_');
  posCart[key]={itemKey:item.key,name:item.name+(mSel.size&&(hasM||hasAB)?' ('+mSel.size+')':''),size:mSel.size||'S',optLabels:optLabels,details:details.join(', '),qty:mSel.qty,unitTotal:pzUnit()};
  document.getElementById('pzItemMask').classList.remove('show');
  renderPosCart();
}
/* ---------- cash denomination tracking (checkout) ---------- */
var POS_DENOMS=[
  {k:'b1000',v:1000,lbl:'₱1000'},{k:'b500',v:500,lbl:'₱500'},{k:'b200',v:200,lbl:'₱200'},{k:'b100',v:100,lbl:'₱100'},{k:'b50',v:50,lbl:'₱50'},{k:'p20',v:20,lbl:'₱20'},
  {k:'c10',v:10,lbl:'₱10'},{k:'c5',v:5,lbl:'₱5'},{k:'c1',v:1,lbl:'₱1'},{k:'c25',v:0.25,lbl:'25¢'},{k:'c10s',v:0.10,lbl:'10¢'},{k:'c5s',v:0.05,lbl:'5¢'}
];
function denomTrackingOn(){return !!(window.__posSettings&&window.__posSettings.denomTracking);}
function shiftDrawer(){var sh=window.__posShift;return (sh&&sh.drawer)?Object.assign({},sh.drawer):{};}
function posRcvRead(){var counts={},total=0;document.querySelectorAll('[data-prd]').forEach(function(inp){var q=Number(inp.value)||0;if(q>0){counts[inp.getAttribute('data-prd')]=q;total+=q*(Number(inp.getAttribute('data-prv'))||0);}});return {counts:counts,total:Math.round(total*100)/100};}
function mergeDenoms(a,b){var o=Object.assign({},a||{});Object.keys(b||{}).forEach(function(k){o[k]=(Number(o[k])||0)+(Number(b[k])||0);});return o;}
function posKeepTip(change){var k=document.getElementById('posKeep');if(!k||!k.checked)return 0;change=Math.round((Number(change)||0)*100)/100;var amt=Number((document.getElementById('posKeepAmt')||{}).value);if(!(amt>0))amt=change;return Math.min(Math.max(0,Math.round(amt*100)/100),change);}
function makeChange(amount,avail){var rem=Math.round(amount*100);var give={};POS_DENOMS.forEach(function(d){if(rem<=0)return;var cents=Math.round(d.v*100);var have=Number(avail[d.k])||0;var use=Math.min(Math.floor(rem/cents),have);if(use>0){give[d.k]=use;rem-=use*cents;}});return {denoms:give,ok:rem<=0,short:rem/100};}
function changeStr(denoms){var m={};POS_DENOMS.forEach(function(d){m[d.k]=d.lbl;});return Object.keys(denoms||{}).map(function(k){return denoms[k]+'×'+m[k];}).join(', ')||'—';}
function changeRows(denoms){return POS_DENOMS.filter(function(d){return denoms&&denoms[d.k];}).map(function(d){return '<div style="color:#155724;">'+denoms[d.k]+' × '+d.lbl+'</div>';}).join('');}
function posDenomPadHtml(){
  return '<span class="pz-lbl">Cash received — enter note/coin counts</span>'
    +'<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(78px,1fr));gap:0.3rem;margin-top:0.3rem;">'
    +POS_DENOMS.map(function(d){return '<label style="font-size:0.68rem;color:var(--tm);display:flex;flex-direction:column;gap:0.1rem;">'+d.lbl+'<input class="pz-in" type="number" min="0" step="1" data-prd="'+d.k+'" data-prv="'+d.v+'" placeholder="0" style="padding:0.2rem 0.3rem;"/></label>';}).join('')
    +'</div><div id="posDenomInfo" style="font-size:0.8rem;font-weight:600;margin-top:0.45rem;"></div>';
}
/* ---------- scoped line-item discounts (Feature A) ---------- */
function lineCat(key){var c=posCart[key];if(!c)return '';var it=(A().menuItemsMap||{})[c.itemKey];return it?catType(it.cat):'';}
function discountedUnits(key){return posScopedDisc.filter(function(d){return d.key===key;}).length;}
function scopedDiscTotal(){return posScopedDisc.reduce(function(s,d){return s+(Number(d.value)||0);},0);}
function idSlotUsed(idNum,cat){return posScopedDisc.some(function(d){return d.type!=='promo5'&&d.idNumber===idNum&&d.cat===cat;});}
function applyScoped(key,type,idNum,name){
  var c=posCart[key]; if(!c){return false;}
  var cat=lineCat(key);
  if(discountedUnits(key)>=c.qty){alert('Every unit of this line is already discounted (no stacking).');return false;}
  if(type==='promo5'){
    if(cat!=='drink'){alert('The 5% promo applies to a drink only.');return false;}
  } else {
    if(!idNum){alert('Enter the ID number for a Senior/PWD/Athlete discount.');return false;}
    if(cat!=='drink'&&cat!=='food'){alert('Tag this item’s category as drink or food first (Recipe → Consumables tab).');return false;}
    if(idSlotUsed(idNum,cat)){alert('ID '+idNum+' already used its '+cat+' discount (max 1 drink + 1 food per ID).');return false;}
  }
  var rate=(DISC_TYPES[type]||{}).rate||0;
  var value=Math.round(c.unitTotal*rate*100)/100;
  posScopedDisc.push({type:type,rate:rate,idNumber:idNum||'',holderName:name||'',key:key,itemKey:c.itemKey,name:c.name,size:c.size||'',cat:cat,unitPrice:c.unitTotal,value:value});
  return true;
}
function openDiscountModal(){
  if(!Object.keys(posCart).length){alert('Add items to the cart first.');return;}
  var mask=document.createElement('div'); mask.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;';
  function draw(){
    var type=(mask.querySelector('#dscType')||{}).value||'senior';
    var idNum=(mask.querySelector('#dscId')||{}).value||'';
    var nm=(mask.querySelector('#dscName')||{}).value||'';
    var isPromo=type==='promo5';
    var rows=Object.keys(posCart).map(function(k){var c=posCart[k];var cat=lineCat(k);var left=c.qty-discountedUnits(k);
      var eligible = left>0 && (isPromo?cat==='drink':(cat==='drink'||cat==='food'));
      return '<tr><td>'+esc(c.name)+(c.size?' ('+esc(c.size)+')':'')+'<div style="font-size:0.7rem;color:var(--tl);">'+(cat||'untagged')+' · '+peso(c.unitTotal)+'/unit · '+left+' of '+c.qty+' left</div></td><td style="text-align:right;">'+(eligible?'<button class="pz-btn ok" data-dscapply="'+k+'" style="padding:0.2rem 0.55rem;">Discount 1</button>':'<span style="font-size:0.72rem;color:var(--tl);">—</span>')+'</td></tr>';
    }).join('');
    var applied=posScopedDisc.length?posScopedDisc.map(function(d,ix){return '<tr><td>'+esc((DISC_TYPES[d.type]||{}).label||d.type)+' · '+esc(d.name)+(d.idNumber?' · ID '+esc(d.idNumber):'')+'</td><td style="text-align:right;">−'+peso(d.value)+' <button class="pz-btn warn" data-dscrm="'+ix+'" style="padding:0.1rem 0.4rem;">✕</button></td></tr>';}).join(''):'<tr><td colspan="2" style="color:var(--tl);padding:0.4rem;">None applied yet.</td></tr>';
    mask.innerHTML='<div style="background:#fff;border-radius:10px;max-width:520px;width:100%;max-height:90vh;overflow:auto;padding:1.2rem;">'
      +'<div style="font-weight:700;color:var(--bd);margin-bottom:0.2rem;">Scoped discount</div>'
      +'<p class="pz-sub" style="margin-top:0.2rem;">Statutory Senior/PWD/Athlete = 20% on the eligible person’s own items (max 1 drink + 1 food per ID). 5% promo = 1 drink. No stacking on the same unit.</p>'
      +'<div style="display:flex;gap:0.5rem;flex-wrap:wrap;align-items:end;margin-bottom:0.6rem;"><div><span class="pz-lbl">Type</span><select class="pz-in" id="dscType">'+Object.keys(DISC_TYPES).map(function(t){return '<option value="'+t+'"'+(t===type?' selected':'')+'>'+esc(DISC_TYPES[t].label)+' ('+Math.round(DISC_TYPES[t].rate*100)+'%)</option>';}).join('')+'</select></div>'
      +(isPromo?'':'<div><span class="pz-lbl">ID number</span><input class="pz-in" id="dscId" value="'+esc(idNum)+'" placeholder="OSCA/PWD/athlete ID"/></div><div><span class="pz-lbl">Holder name</span><input class="pz-in" id="dscName" value="'+esc(nm)+'"/></div>')+'</div>'
      +'<table class="pz-tbl"><thead><tr><th>Cart item</th><th></th></tr></thead><tbody>'+rows+'</tbody></table>'
      +'<div style="font-weight:600;color:var(--bd);margin-top:0.8rem;margin-bottom:0.3rem;">Applied</div><table class="pz-tbl"><tbody>'+applied+'</tbody></table>'
      +'<div style="display:flex;justify-content:space-between;align-items:center;margin-top:0.8rem;"><span style="font-weight:700;">Total discount: '+peso(scopedDiscTotal())+'</span><button class="pz-btn ok" id="dscDone">Done</button></div>'
      +'</div>';
    var ts=mask.querySelector('#dscType'); if(ts)ts.onchange=draw;
    mask.querySelectorAll('[data-dscapply]').forEach(function(b){b.onclick=function(){ var liveId=((mask.querySelector('#dscId')||{}).value||'').trim(); var liveNm=((mask.querySelector('#dscName')||{}).value||'').trim(); if(applyScoped(b.getAttribute('data-dscapply'),type,liveId,liveNm))draw(); };});
    mask.querySelectorAll('[data-dscrm]').forEach(function(b){b.onclick=function(){posScopedDisc.splice(+b.getAttribute('data-dscrm'),1);draw();};});
    mask.querySelector('#dscDone').onclick=function(){document.body.removeChild(mask);renderPosCart();};
  }
  document.body.appendChild(mask); draw();
}
function renderPosCart(options){
  var p=document.getElementById('posCartPanel'); if(!p)return;
  var _rt=performance.now();if(!(options&&options.fresh))capturePosDraft(p);
  var shift=window.__posShift||null;
  var keys=Object.keys(posCart);
  posScopedDisc=posScopedDisc.filter(function(d){return posCart[d.key];});
  (function(){var seen={};posScopedDisc=posScopedDisc.filter(function(d){seen[d.key]=(seen[d.key]||0)+1;return seen[d.key]<=(Number(posCart[d.key].qty)||0);});})();
  var sub=keys.reduce(function(s,k){return s+posCart[k].qty*posCart[k].unitTotal;},0);
  var lines=keys.map(function(k){var c=posCart[k];return '<div style="display:flex;justify-content:space-between;gap:0.5rem;padding:0.4rem 0;border-bottom:1px solid var(--cd);font-size:0.82rem;">'
      +'<div style="flex:1;"><b>'+esc(c.name)+'</b> ×'+c.qty+(c.details?'<div style="font-size:0.7rem;color:var(--tl);">'+esc(c.details)+'</div>':'')+'</div>'
      +'<div style="text-align:right;white-space:nowrap;">'+peso(c.qty*c.unitTotal)+'<br><button class="pz-btn warn" style="padding:0.1rem 0.4rem;font-size:0.7rem;" data-rm="'+k+'">remove</button></div></div>';}).join('');
  var shiftBar=shift
    ? '<div style="background:#e8f5ec;border:1px solid #b8dfc4;border-radius:6px;padding:0.4rem 0.6rem;font-size:0.76rem;color:#155724;">🟢 Shift open · Cashier <b>'+esc(shift.staff)+'</b></div>'
    : '<div style="background:#fde8e8;border:1px solid #f5c6c6;border-radius:6px;padding:0.4rem 0.6rem;font-size:0.76rem;color:#721c24;">🔴 No open shift — open one in <b>Register Ops</b> to start selling.</div>';
  var isPlat=posIsPlatform();
  var _ccfg=channelsCfg();
  var chanOpts=[{k:'instore',lbl:'🏪 In-store'}].concat(POS_CHANNELS.filter(function(d){return _ccfg[d.k].active!==false;}).map(function(d){return {k:d.k,lbl:(d.k==='grabfood'?'🟢 ':'🩷 ')+_ccfg[d.k].label};}));
  var chLabel=isPlat?channelLabel(posChannel):'';
  var grabDiscountRows='<div style="margin-top:0.55rem;padding:0.55rem;background:#f7f3ec;border:1px solid var(--cd);border-radius:7px;"><div class="pz-lbl" style="margin-bottom:0.35rem;">GrabFood discounts</div>'
    +[['posPlatDiscType1','posPlatDiscPct1','Delivery / Pickup','Percentage discount 1','%'],['posPlatDiscType2','posPlatDiscPct2','','Percentage discount 2','%'],['posPlatDiscType3','posPlatDiscAmt1','','Amount discount 1','₱'],['posPlatDiscType4','posPlatDiscAmt2','','Amount discount 2','₱']].map(function(r){return '<div style="display:grid;grid-template-columns:minmax(0,1fr) 112px;gap:0.45rem;align-items:end;margin-top:0.35rem;"><label><span class="pz-lbl">Discount type</span><input class="pz-in" data-plat-discount id="'+r[0]+'" placeholder="'+r[3]+'" value="'+r[2]+'"/></label><label><span class="pz-lbl">Discount '+r[4]+'</span><input class="pz-in" data-plat-discount id="'+r[1]+'" type="number" min="0" step="any" placeholder="0" style="text-align:right;"/></label></div>';}).join('')
    +'<div style="font-size:0.7rem;color:var(--tl);margin-top:0.45rem;">Enter the deduction labels shown by Grab. Delivery-labelled rows and merchant-funded promos are mapped separately in Finance Books.</div></div>';
  var chanSel='<div style="margin-bottom:0.6rem;"><span class="pz-lbl">Channel</span><select class="pz-in" id="posChannelSel">'+chanOpts.map(function(o){return '<option value="'+o.k+'"'+(posChannel===o.k?' selected':'')+'>'+o.lbl+'</option>';}).join('')+'</select>'+(isPlat?'<div style="font-size:0.72rem;color:#8a5a00;background:#fff6e5;border:1px solid #f0dcae;border-radius:5px;padding:0.3rem 0.45rem;margin-top:0.25rem;">'+esc(chLabel)+' — platform prices apply, sale is a <b>receivable</b> (not cash drawer), commission trued up at weekly payout.</div>':'')+'</div>';
  p.innerHTML=
    chanSel
    +'<div style="margin-bottom:0.6rem;"><span class="pz-lbl">Customer\'s name</span><input class="pz-in" id="posCust" placeholder="Walk-in"/></div>'
    +(shift&&!isPlat?'<button class="pz-btn sec" id="posPkgBtn" style="width:100%;margin-bottom:0.6rem;">🎁 Add Package / Promo</button>':'')+'<div style="font-weight:600;color:var(--bd);margin-bottom:0.5rem;">🛒 Current sale</div>'
    +(keys.length?lines:'<p class="pz-sub" style="margin:0.5rem 0;">Tap items to add them.</p>')
    +'<div style="margin-top:0.6rem;">'
      +'<div style="display:flex;justify-content:space-between;font-size:0.82rem;margin-bottom:0.3rem;"><span>Subtotal</span><span>'+peso(sub)+'</span></div>'
      +(isPlat?'':'<div style="display:flex;justify-content:space-between;align-items:center;font-size:0.82rem;margin-bottom:0.3rem;"><span>Discount ₱</span><input class="pz-in" id="posDisc" type="number" step="any" style="width:100px;text-align:right;" value="0"/></div>'
      +'<button class="pz-btn sec" id="posDiscBtn" style="width:100%;margin-bottom:0.4rem;font-size:0.8rem;">🧾 PWD / Senior / Athlete / Promo</button>'
      +(posScopedDisc.length?('<div style="font-size:0.76rem;margin-bottom:0.4rem;">'+posScopedDisc.map(function(d,ix){return '<div style="display:flex;justify-content:space-between;align-items:center;color:#155724;margin-bottom:0.15rem;"><span>'+esc((DISC_TYPES[d.type]||{}).label||d.type)+' · '+esc(d.name)+(d.idNumber?' ('+esc(d.idNumber)+')':'')+'</span><span style="white-space:nowrap;">−'+peso(d.value)+' <button class="pz-btn warn" data-sdrm="'+ix+'" style="padding:0 0.35rem;">✕</button></span></div>';}).join('')+'</div>'):'')
      +(posMeta.cashRounding?'<div style="display:flex;justify-content:space-between;font-size:0.75rem;color:var(--tl);margin-bottom:0.3rem;"><span>Cash rounding</span><span id="posRound">₱0.00</span></div>':''))
      +'<div style="display:flex;justify-content:space-between;font-weight:700;color:var(--bd);font-size:1rem;border-top:1px solid var(--cd);padding-top:0.4rem;"><span>'+(isPlat?'Gross':'Total')+'</span><span id="posTotal">'+peso(sub)+'</span></div>'
    +'</div>'
    +(isPlat
      ? '<div style="margin-top:0.7rem;border-top:1px solid var(--cd);padding-top:0.6rem;"><span class="pz-lbl">'+(posChannel==='grabfood'?'GrabFood order # (GF- is added automatically)':'FoodPanda order code (FP- is added automatically)')+'</span>'+(posChannel==='grabfood'?'<div style="display:flex;align-items:center;gap:0.3rem;"><span style="font-weight:700;color:var(--bd);">GF-</span><input class="pz-in" id="posPlatRef" placeholder="e.g. 123456" style="flex:1;"/></div>'+grabDiscountRows:'<div style="display:flex;align-items:center;gap:0.3rem;"><span style="font-weight:700;color:var(--bd);">FP-</span><input class="pz-in" id="posPlatRef" placeholder="e.g. o7km-49a7" style="flex:1;"/></div><div style="margin-top:0.5rem;"><span class="pz-lbl">Discount off (Delivery / Pickup) %</span><input class="pz-in" data-plat-discount id="posPlatDisc" type="number" min="0" step="any" placeholder="0" style="width:110px;text-align:right;"/></div>')+'<div id="posPlatCalc" style="font-size:0.82rem;margin-top:0.5rem;"></div></div>'
      : '<div style="margin-top:0.7rem;display:flex;justify-content:space-between;align-items:center;"><span class="pz-lbl" style="margin:0;">Payment</span><label style="font-size:0.74rem;color:var(--tl);cursor:pointer;"><input type="checkbox" id="posSplitChk"/> Split</label></div>'
        +'<div id="posPaySingle"><select class="pz-in" id="posPay" style="margin-top:0.3rem;">'+posActiveMethods().map(function(m){return '<option value="'+m.name+'">'+m.name+'</option>';}).join('')+'</select>'
          +'<div id="posCashWrap" style="margin-top:0.5rem;">'+(denomTrackingOn()?posDenomPadHtml():'<span class="pz-lbl">Cash tendered ₱</span><input class="pz-in" id="posTender" type="number" step="any" placeholder="0"/><div id="posChange" style="font-size:0.82rem;color:var(--bd);font-weight:600;margin-top:0.3rem;"></div>')+'</div>'
          +'<div id="posKeepWrap" style="display:none;margin-top:0.4rem;padding:0.4rem 0.55rem;background:#fff6e5;border:1px solid #f0dcae;border-radius:6px;"><label style="font-size:0.8rem;display:flex;align-items:center;gap:0.4rem;cursor:pointer;"><input type="checkbox" id="posKeep"/> Customer kept the change (tip / no small change)</label><div id="posKeepAmtWrap" style="display:none;margin-top:0.3rem;font-size:0.8rem;">Amount kept ₱ <input class="pz-in" id="posKeepAmt" type="number" step="any" style="width:90px;text-align:right;"/> <span style="color:var(--tl);">→ Other Income (Tips)</span></div></div>'
          +'<div id="posRefWrap" style="display:none;margin-top:0.5rem;"><span class="pz-lbl">Ref no. (GCash / bank) — required</span><input class="pz-in" id="posPayRef" placeholder="e.g. GCash ref / bank txn ref"/><div style="font-size:0.72rem;color:var(--tl);margin-top:0.2rem;">The cashier must find this payment in the actual receiving account before completing the sale.</div></div></div>'
        +'<div id="posPaySplit" style="display:none;margin-top:0.4rem;"><div id="posSplitRows"></div><button class="pz-btn sec" id="posAddPay" style="padding:0.25rem 0.6rem;">+ payment</button><div id="posSplitInfo" style="font-size:0.76rem;color:var(--tl);margin-top:0.3rem;"></div></div>')
    +'<div id="posVerifyState" style="display:none;margin-top:0.7rem;padding:0.45rem 0.6rem;border-radius:6px;font-size:0.76rem;"></div>'
    +'<button class="pz-btn ok" id="posCharge" style="width:100%;margin-top:0.8rem;padding:0.7rem;font-size:0.95rem;"'+((keys.length&&shift)?'':' disabled')+'>'+(isPlat?'Record '+esc(chLabel)+' sale':'Charge &amp; Complete')+'</button>'
    +'<div style="display:flex;gap:0.4rem;margin-top:0.4rem;">'
      +(isPlat?'':'<button class="pz-btn sec" id="posHold" style="flex:1;"'+(keys.length?'':' disabled')+'>Hold</button>')
      +'<button class="pz-btn sec" id="posClear" style="flex:1;"'+(keys.length?'':' disabled')+'>Clear</button>'
    +'</div>';
  restorePosDraft(p);telemetry().metric('cart_render',performance.now()-_rt,true);if(window.__refreshWorkspaceStatus)window.__refreshWorkspaceStatus();
  var _chsel=document.getElementById('posChannelSel'); if(_chsel)_chsel.onchange=function(){ var v=this.value; if(v===posChannel)return; if(Object.keys(posCart).length&&!confirm('Switching channel clears the current sale — prices differ between in-store and platform. Continue?')){ this.value=posChannel; return; } posChannel=v; posCart={}; window.__posPkgs=[]; posScopedDisc=[]; setTimeout(buildPOS,0); };
  p.querySelectorAll('[data-rm]').forEach(function(b){b.onclick=function(){delete posCart[b.getAttribute('data-rm')];renderPosCart();};});
  var disc=document.getElementById('posDisc');
  var splitRows=[];
  var pay=null, splitChk=null;
  function grandTotal(){ var d=isPlat?0:((Number(disc&&disc.value)||0)+scopedDiscTotal()); var tot=Math.max(0,sub-d); if(!isPlat&&posMeta.cashRounding){var r=Math.round(tot); var pr=document.getElementById('posRound'); if(pr)pr.textContent=peso(r-tot); tot=r;} var tEl=document.getElementById('posTotal'); if(tEl)tEl.textContent=peso(tot); return tot; }
  function draftElectronicPayments(){
    if(isPlat)return[];
    var tot=grandTotal();
    if(splitChk&&splitChk.checked)return splitRows.filter(function(r){return !isCashMethod(r.method);}).map(function(r){return{method:r.method,amount:Number(r.amount)||0,ref:String(r.ref||'').trim()};});
    var method=pay?pay.value:'Cash';return isCashMethod(method)?[]:[{method:method,amount:tot,ref:String((document.getElementById('posPayRef')||{}).value||'').trim()}];
  }
  function refreshChargeAction(){
    var button=document.getElementById('posCharge'),state=document.getElementById('posVerifyState');if(!button)return;
    var direct=draftElectronicPayments(),policy=paymentVerificationPolicy(direct),signature=paymentVerificationSignature(direct,grandTotal()),verified=policy==='cashier_manager'&&direct.length&&posPaymentVerification&&posPaymentVerification.signature===signature;
    if(isPlat){button.textContent='Record '+chLabel+' sale';button.style.background='';}
    else if(direct.length&&policy==='manager_only'){button.textContent='Record Sale · Manager Verification Required';button.style.background='#8a6d1b';}
    else if(direct.length&&!verified){button.textContent='Cashier Verify Payment';button.style.background='#2f80ed';}
    else{button.textContent='Charge & Complete';button.style.background='';}
    if(state){if(verified){var refs=direct.map(function(r){return r.ref;}).filter(Boolean).join(', ');state.style.display='block';state.style.background='#e8f5ec';state.style.border='1px solid #b8dfc4';state.style.color='#155724';state.innerHTML='✓ Cashier verified'+(refs?' · Ref: '+esc(refs):'')+' · Complete the sale below.';}else{state.style.display='none';state.innerHTML='';}}
    button.disabled=posChargeBusy||!keys.length||!shift;
  }
  function invalidatePaymentVerification(){posPaymentVerification=null;refreshChargeAction();}
  function platformDiscountData(gross){
    function val(id){return Math.max(0,Number((document.getElementById(id)||{}).value)||0);}
    function typ(id,fallback){return String((document.getElementById(id)||{}).value||'').trim()||fallback;}
    if(posChannel!=='grabfood'){var pct=val('posPlatDisc'),amt=Math.round(gross*pct)/100;return {pct:pct,amount:amt,lines:pct?[{type:'Delivery / Pickup',mode:'percent',value:pct,amount:amt}]:[]};}
    var defs=[['posPlatDiscType1','posPlatDiscPct1','Percentage discount 1','percent'],['posPlatDiscType2','posPlatDiscPct2','Percentage discount 2','percent'],['posPlatDiscType3','posPlatDiscAmt1','Amount discount 1','amount'],['posPlatDiscType4','posPlatDiscAmt2','Amount discount 2','amount']];
    var lines=defs.map(function(d){var v=val(d[1]),label=typ(d[0],d[2]),amt=d[3]==='percent'?Math.round(gross*v)/100:Math.round(v*100)/100,category=/delivery/i.test(label)?'delivery_fee_discount':'merchant_funded_promo';return {category:category,type:label,mode:d[3],value:v,amount:amt};}).filter(function(d){return d.value>0;});
    var merchantPromo=Math.round(lines.filter(function(d){return d.category==='merchant_funded_promo';}).reduce(function(s,d){return s+d.amount;},0)*100)/100;
    var deliveryFeeDiscount=Math.round(lines.filter(function(d){return d.category==='delivery_fee_discount';}).reduce(function(s,d){return s+d.amount;},0)*100)/100;
    return {pct:lines.filter(function(d){return d.category==='merchant_funded_promo'&&d.mode==='percent';}).reduce(function(s,d){return s+d.value;},0),merchantPromo:merchantPromo,deliveryFeeDiscount:deliveryFeeDiscount,amount:Math.round(lines.reduce(function(s,d){return s+d.amount;},0)*100)/100,lines:lines};
  }
  function refreshPlat(){ var el=document.getElementById('posPlatCalc'); if(!el)return; function r2(n){return Math.round((Number(n)||0)*100)/100;}
    var gross=grandTotal(); var rate=channelRate(posChannel); var whtR=channelWht(posChannel); var vatR=channelVat(posChannel);
    var discounts=platformDiscountData(gross),dPct=discounts.pct,dAmt=discounts.amount;
    var commBase=(posChannel==='grabfood')?r2(gross-(Number(discounts.merchantPromo)||0)):gross;
    commBase=Math.max(0,commBase);var comm=r2(commBase*rate); var wht=r2(gross*whtR); var vat=r2(gross*vatR);
    var net=r2(gross-comm-dAmt-wht-vat);
    function ln(l,v,c){return '<div style="display:flex;justify-content:space-between;'+(c?'color:'+c+';':'')+'"><span>'+l+'</span><span>'+(v<0?'-'+peso(-v):peso(v))+'</span></div>';}
    el.innerHTML=ln('Gross',gross)
      +discounts.lines.map(function(d){return ln(esc(d.type)+' ('+(d.mode==='percent'?d.value+'%':'amount')+')',-d.amount,'#c0392b');}).join('')
      +ln('Commission ('+(Math.round(rate*1000)/10)+'%'+((posChannel==='grabfood'&&dAmt)?' after discounts':'')+')',-comm,'#c0392b')
      +(whtR?ln('Withholding tax ('+(Math.round(whtR*10000)/100)+'%)',-wht,'#c0392b'):'')
      +(vatR?ln('VAT on services ('+(Math.round(vatR*1000)/10)+'%)',-vat,'#c0392b'):'')
      +'<div style="display:flex;justify-content:space-between;font-weight:700;border-top:1px solid var(--cd);padding-top:0.2rem;margin-top:0.2rem;"><span>Net receivable</span><span>'+peso(net)+'</span></div>'
      +'<div style="font-size:0.72rem;color:var(--tl);margin-top:0.25rem;">'+((posChannel==='grabfood'&&dAmt)?'Commission is on gross less merchant-funded promo; delivery fee discount is separate; WHT/VAT are on gross. ':'All deducted from gross. ')+'Estimate — trued up at the weekly payout reconciliation.</div>';
  }
  if(isPlat){ var _plr=document.getElementById('posPlatRef'); if(_plr)_plr.oninput=refreshPlat; p.querySelectorAll('[data-plat-discount]').forEach(function(inp){inp.oninput=refreshPlat;}); refreshPlat(); }
  else {
  var curChange=0;
  function updateKeep(){ var w=document.getElementById('posKeepWrap'); if(!w)return; var isc=isCashMethod(pay?pay.value:'Cash'); var show=isc&&curChange>0.001; w.style.display=show?'block':'none'; var k=document.getElementById('posKeep'); var kw=document.getElementById('posKeepAmtWrap'); var amt=document.getElementById('posKeepAmt'); if(!show){ if(k)k.checked=false; if(kw)kw.style.display='none'; return; } if(amt){amt.max=curChange;amt.placeholder=String(curChange);} if(k&&k.checked){ if(kw)kw.style.display='block'; if(amt&&!amt.value)amt.value=curChange; } }
  function refreshSingle(){ var tot=grandTotal(); var tender=document.getElementById('posTender'); var t=Number(tender&&tender.value)||0; curChange=t?Math.max(0,Math.round((t-tot)*100)/100):0; var ch=document.getElementById('posChange'); if(ch)ch.textContent=t?('Change: '+peso(curChange)):''; updateKeep(); }
  pay=document.getElementById('posPay');
  pay.onchange=function(){var isc=isCashMethod(pay.value);document.getElementById('posCashWrap').style.display=isc?'block':'none';var rw=document.getElementById('posRefWrap');if(rw)rw.style.display=isc?'none':'block';updateKeep();invalidatePaymentVerification();};
  pay.onchange();
  var tender0=document.getElementById('posTender'); if(tender0)tender0.oninput=refreshSingle;
  var pk=document.getElementById('posKeep'); if(pk)pk.onchange=function(){var kw=document.getElementById('posKeepAmtWrap'); if(kw)kw.style.display=this.checked?'block':'none'; var amt=document.getElementById('posKeepAmt'); if(this.checked&&amt&&!amt.value)amt.value=curChange;};
  function refreshDenom(){ var tot=grandTotal(); var r=posRcvRead(); var el=document.getElementById('posDenomInfo'); if(!el)return;
    function ln(l,v,bold){return '<div style="display:flex;justify-content:space-between;'+(bold?'font-weight:700;':'')+'"><span>'+l+'</span><span>'+v+'</span></div>';}
    if(r.total<tot-0.001){ el.innerHTML=ln('Amount tendered',peso(r.total))+'<div style="color:var(--tl);margin-top:0.15rem;">'+peso(tot-r.total)+' more needed for the '+peso(tot)+' sale.</div>'; window.__posChange=null; curChange=0; updateKeep(); return; }
    var change=Math.round((r.total-tot)*100)/100; curChange=change; updateKeep();
    var html=ln('Amount tendered',peso(r.total)); var balanced=true;
    if(change<=0.001){ html+=ln('Change','—'); window.__posChange={amount:0,denoms:{},short:0}; }
    else{
      var mc=makeChange(change, mergeDenoms(shiftDrawer(), r.counts));
      html+='<div style="margin-top:0.15rem;">Change:</div>'
        +POS_DENOMS.filter(function(d){return mc.denoms[d.k];}).map(function(d){return '<div style="display:flex;justify-content:space-between;padding-left:0.9rem;"><span>'+mc.denoms[d.k]+' × '+d.lbl+'</span><span>'+peso(mc.denoms[d.k]*d.v)+'</span></div>';}).join('')
        +ln('Change total',peso(change-mc.short));
      window.__posChange={amount:change,denoms:mc.denoms,short:mc.short};
      if(!mc.ok){ balanced=false; html+='<div style="color:#c0392b;font-weight:600;margin-top:0.15rem;">⚠ No exact change — short '+peso(mc.short)+'. Ask for the exact amount &amp; edit the counts.</div>'; }
    }
    html+='<div style="border-top:1px solid var(--cd);margin-top:0.3rem;padding-top:0.2rem;">'+ln('Current sale',peso(tot),true)+'</div>'
      +'<div style="text-align:right;font-size:0.75rem;font-weight:600;margin-top:0.15rem;color:'+(balanced?'#155724':'#c0392b')+';">'+(balanced?'✓ balanced':'⚠ not balanced')+'</div>';
    el.innerHTML=html;
  }
  if(denomTrackingOn()){ document.querySelectorAll('[data-prd]').forEach(function(inp){inp.oninput=refreshDenom;}); refreshDenom(); }
  splitChk=document.getElementById('posSplitChk');
  function renderSplit(){
    var tot=grandTotal(); if(!splitRows.length)splitRows=[{method:'Cash',amount:tot}];
    var cont=document.getElementById('posSplitRows');
    cont.innerHTML=splitRows.map(function(r,i){var opts=posActiveMethods().map(function(m){return '<option'+(r.method===m.name?' selected':'')+'>'+m.name+'</option>';}).join('');var row='<div style="display:flex;gap:0.3rem;margin-bottom:0.3rem;"><select class="pz-in" data-pm="'+i+'" style="flex:1;">'+opts+'</select><input class="pz-in" data-pa="'+i+'" type="number" step="any" style="width:100px;" value="'+r.amount+'"/>'+(splitRows.length>1?'<button class="pz-btn warn" data-pd="'+i+'" style="padding:0.2rem 0.45rem;">✕</button>':'')+'</div>';
      if(!isCashMethod(r.method)){row+='<input class="pz-in" data-pr="'+i+'" placeholder="Ref no. for '+r.method+' — required" value="'+(r.ref||'')+'" style="margin-bottom:0.5rem;font-size:0.78rem;"/>';}
      else if(denomTrackingOn()){row+='<div style="margin:0 0 0.5rem 0;padding:0.35rem 0.45rem;background:#f7f3ec;border-radius:6px;"><div style="font-size:0.7rem;color:var(--tl);margin-bottom:0.2rem;">Cash received for this portion — enter notes/coins</div><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(60px,1fr));gap:0.25rem;">'+POS_DENOMS.map(function(d){return '<label style="font-size:0.6rem;color:var(--tm);display:flex;flex-direction:column;">'+d.lbl+'<input class="pz-in" type="number" min="0" step="1" data-sdrow="'+i+'" data-sdk="'+d.k+'" data-sdv="'+d.v+'" placeholder="0" style="padding:0.08rem 0.2rem;"/></label>';}).join('')+'</div><div data-sdinfo="'+i+'" style="font-size:0.72rem;font-weight:600;margin-top:0.2rem;"></div></div>';}
      return row;}).join('');
    var assigned=splitRows.reduce(function(s,r){return s+(Number(r.amount)||0);},0);
    document.getElementById('posSplitInfo').innerHTML='Assigned '+peso(assigned)+' / Total '+peso(tot)+' · '+(Math.abs(assigned-tot)<0.01?'<span style="color:#2a9d5c;">balanced</span>':'<span style="color:#e63946;">off by '+peso(tot-assigned)+'</span>');
    function sdRecalc(i){var received=0;cont.querySelectorAll('[data-sdrow="'+i+'"]').forEach(function(inp){received+=(Number(inp.value)||0)*(Number(inp.getAttribute('data-sdv'))||0);});received=Math.round(received*100)/100;var amt=Number(splitRows[i].amount)||0;var info=cont.querySelector('[data-sdinfo="'+i+'"]');if(!info)return;if(received<amt-0.001){info.innerHTML='<span style="color:#c0392b;">Received '+peso(received)+' · short '+peso(amt-received)+'</span>';}else{info.innerHTML='Received '+peso(received)+' · change '+peso(Math.round((received-amt)*100)/100);}}
    cont.querySelectorAll('[data-pm]').forEach(function(s){s.onchange=function(){splitRows[+s.getAttribute('data-pm')].method=s.value;posPaymentVerification=null;renderSplit();refreshChargeAction();};});
    cont.querySelectorAll('[data-pa]').forEach(function(inp){inp.oninput=function(){splitRows[+inp.getAttribute('data-pa')].amount=Number(inp.value)||0;posPaymentVerification=null;renderSplit();refreshChargeAction();};});
    cont.querySelectorAll('[data-pr]').forEach(function(inp){inp.oninput=function(){splitRows[+inp.getAttribute('data-pr')].ref=inp.value;invalidatePaymentVerification();};});
    cont.querySelectorAll('[data-sdrow]').forEach(function(inp){inp.oninput=function(){sdRecalc(+inp.getAttribute('data-sdrow'));};});
    cont.querySelectorAll('[data-pd]').forEach(function(b){b.onclick=function(){splitRows.splice(+b.getAttribute('data-pd'),1);posPaymentVerification=null;renderSplit();refreshChargeAction();};});
  }
  if(disc)disc.oninput=function(){ posPaymentVerification=null;if(splitChk.checked)renderSplit(); else refreshSingle();refreshChargeAction(); };
  splitChk.onchange=function(){ posPaymentVerification=null;document.getElementById('posPaySingle').style.display=this.checked?'none':'block'; document.getElementById('posPaySplit').style.display=this.checked?'block':'none'; if(this.checked){splitRows=[];renderSplit();} else refreshSingle();refreshChargeAction(); };
  document.getElementById('posAddPay').onclick=function(){posPaymentVerification=null;splitRows.push({method:'GCash',amount:0});renderSplit();refreshChargeAction();};
  refreshSingle();
  var payRef=document.getElementById('posPayRef');if(payRef)payRef.oninput=invalidatePaymentVerification;
  }
  refreshChargeAction();
  updateOfflineUI();
  var _sb=document.getElementById('posShiftBar'); if(_sb)_sb.innerHTML=shiftBar;
  var _db=document.getElementById('posDiscBtn'); if(_db)_db.onclick=openDiscountModal;
  p.querySelectorAll('[data-sdrm]').forEach(function(b){b.onclick=function(){posScopedDisc.splice(+b.getAttribute('data-sdrm'),1);renderPosCart();};});
  var _pb=document.getElementById('posPkgBtn');if(_pb)_pb.onclick=function(){ if(window.__openPackagePicker)window.__openPackagePicker(); else alert('Packages module still loading \u2014 try again.'); };
  document.getElementById('posClear').onclick=function(){if(Object.keys(posCart).length&&confirm('Clear this sale?')){posCart={};posDraft={};posPaymentVerification=null;window.__posPkgs=[];posScopedDisc=[];renderPosCart({fresh:true});}};
  var _hold=document.getElementById('posHold'); if(_hold)_hold.onclick=function(){ if(!Object.keys(posCart).length)return; var a=A(); a.set(a.ref(a.db,'heldOrders/'+uid('hold_')),{cart:posCart,ts:Date.now(),staff:(window.__posShift&&window.__posShift.staff)||'—',note:(document.getElementById('posCust').value||'').trim()}); posCart={};posDraft={};posPaymentVerification=null;window.__posPkgs=[]; renderPosCart({fresh:true}); alert('Order held. Recall it from Register Ops.'); };
  document.getElementById('posCharge').onclick=async function(){
    var chargeButton=this;if(posChargeBusy)return;posChargeBusy=true;chargeButton.disabled=true;chargeButton.textContent='Processing…';
    try{return await (async function(){
    if(!window.__posShift){alert('Open a shift first (Register Ops tab).');return;}
    var tot=grandTotal();
    if(isPlat){
      if(tot<=0){alert('Add items to the sale first.');return;}
      var pref=(document.getElementById('posPlatRef').value||'').trim();
      if(!pref){alert(chLabel+' order # is required — key in the platform order number.');return;}
      if(posChannel==='grabfood'&&!/^gf-/i.test(pref)){pref='GF-'+pref;}
      if(posChannel==='foodpanda'&&!/^fp-/i.test(pref)){pref='FP-'+pref;}
      try{
        var _idxSnap=await A().get(A().ref(A().db,'platformRefIndex/'+posChannel+'/'+platformRefKey(pref)));
        if(_idxSnap&&_idxSnap.exists()){
          var _dupOrder=(_idxSnap.val()||{}).orderId||'';
          alert('⛔ '+chLabel+' order number '+pref+' has already been used'+(_dupOrder?(' — recorded as order '+_dupOrder):'')+'.\n\nA Grab/FoodPanda reference can only be used once. If that order needs correcting, void it first — do not re-enter the same number.');
          return;
        }
      }catch(_e){/* index lookup unavailable (offline) — allow; the server still flags any duplicate */}
      var _r2=function(n){return Math.round((Number(n)||0)*100)/100;};
      var prate=channelRate(posChannel),pwhtR=channelWht(posChannel),pvatR=channelVat(posChannel);
      var pdiscounts=platformDiscountData(tot),pdPct=pdiscounts.pct,pdAmt=pdiscounts.amount;
      if(pdAmt>tot){alert('Total platform discounts cannot be greater than the gross sale.');return;}
      var pcommBase=(posChannel==='grabfood')?_r2(tot-(Number(pdiscounts.merchantPromo)||0)):tot;
      var pcomm=_r2(pcommBase*prate), pwht=_r2(tot*pwhtR), pvat=_r2(tot*pvatR);
      var pNetSales=_r2(tot-pdAmt); var pnet=_r2(tot-pcomm-pdAmt-pwht-pvat);
      await chargeSale(sub,pNetSales,null,{channel:posChannel,platformRef:pref,gross:tot,discountPct:pdPct,discountAmt:pdAmt,discountLines:pdiscounts.lines,merchantPromo:Number(pdiscounts.merchantPromo)||0,deliveryFeeDiscount:Number(pdiscounts.deliveryFeeDiscount)||0,netSales:pNetSales,commission:pcomm,commissionRate:prate,wht:pwht,whtRate:pwhtR,vat:pvat,vatRate:pvatR,net:pnet});
      return;
    }
    var d=Number(disc&&disc.value)||0,discountApproval=null;
    var payments;
    if(splitChk.checked){ var assigned=splitRows.reduce(function(s,r){return s+(Number(r.amount)||0);},0); if(Math.abs(assigned-tot)>0.01){alert('Split payments must add up to the total.');return;} if(splitRows.some(function(r){return !isCashMethod(r.method)&&!String(r.ref||'').trim();})){alert('Enter a reference number for every GCash/bank payment before charging.');return;}
      var _splitBad=false;
      payments=splitRows.map(function(r,i){
        if(isCashMethod(r.method)){ var amt=Number(r.amount)||0;
          if(denomTrackingOn()){ var rc={},rt=0; document.querySelectorAll('[data-sdrow="'+i+'"]').forEach(function(inp){var q=Number(inp.value)||0;if(q>0){rc[inp.getAttribute('data-sdk')]=(rc[inp.getAttribute('data-sdk')]||0)+q;rt+=q*(Number(inp.getAttribute('data-sdv'))||0);}}); rt=Math.round(rt*100)/100; if(rt<amt-0.001)_splitBad=true; var chg=Math.round((rt-amt)*100)/100; var mc=makeChange(chg, mergeDenoms(shiftDrawer(),rc)); return {method:r.method,amount:amt,tendered:rt,change:chg,ref:'',cashReceived:rc,cashChange:mc.denoms,changeShort:mc.ok?0:mc.short}; }
          return {method:r.method,amount:amt,tendered:0,change:0,ref:''};
        }
        return {method:r.method,amount:Number(r.amount)||0,ref:String(r.ref||'').trim()};
      });
      if(_splitBad){alert('The cash received for a cash portion is less than that portion — enter the notes/coins received.');return;}
    }
    else { var m=pay.value; var isc=isCashMethod(m);
      if(!isc){ var ref1=(document.getElementById('posPayRef').value||'').trim(); if(!ref1){alert('Enter the '+m+' reference number before charging.');return;} payments=[{method:m,amount:tot,tendered:0,change:0,ref:ref1}]; }
      else if(denomTrackingOn()){ var r=posRcvRead(); if(r.total<tot-0.001){alert('Cash received ('+peso(r.total)+') is less than the total ('+peso(tot)+').');return;} var chg=Math.round((r.total-tot)*100)/100; var tip=posKeepTip(chg); var giveChg=Math.round((chg-tip)*100)/100; var mc=makeChange(giveChg, mergeDenoms(shiftDrawer(),r.counts)); payments=[{method:m,amount:tot,tendered:r.total,change:giveChg,ref:'',cashReceived:r.counts,cashChange:mc.denoms,changeShort:mc.ok?0:mc.short,tipRounding:tip}]; }
      else { var tv=Number((document.getElementById('posTender')||{}).value)||0; if(tv&&tv<tot){alert('Cash tendered is less than the total.');return;} var chg2=tv?Math.max(0,Math.round((tv-tot)*100)/100):0; var tip2=posKeepTip(chg2); payments=[{method:m,amount:tot,tendered:tv,change:Math.round((chg2-tip2)*100)/100,ref:'',tipRounding:tip2}]; }
    }
    var verificationSignature=paymentVerificationSignature(payments,tot),direct=directPaymentRows(payments),verificationPolicy=paymentVerificationPolicy(payments),cashierVerification=null;
    if(direct.length&&verificationPolicy==='cashier_manager'&&(!posPaymentVerification||posPaymentVerification.signature!==verificationSignature)){
      try{cashierVerification=await cashierVerificationGate(payments,tot,'In-store sale');}catch(e){return;}
      posPaymentVerification={required:true,reference:cashierVerification.reference||'',signature:paymentVerificationSignature(payments,tot)};
      (window.accazaToast||function(){})('Payment verified · complete the sale when ready','ok');return;
    }
    cashierVerification=direct.length&&verificationPolicy==='cashier_manager'?posPaymentVerification:{required:false};
    if(d>0){var a0=A();if(!a0.managerApproval||!a0.consumeManagerApproval){alert('Privileged discount approval is unavailable. Refresh the portal.');return;}var discountSource='manual_discount_'+shift.id+'_'+Date.now();try{var dap=await a0.managerApproval('manual_discount',discountSource,d,'Approve manual POS discount');var dcr=await a0.consumeManagerApproval({action:'manual_discount',sourceId:discountSource,amount:d,operationKey:discountSource,approvalId:dap.approvalId}),dcd=(dcr&&dcr.data)||dcr||{};discountApproval={approvalId:dap.approvalId,approvedBy:dcd.approvedBy||'',approvedByUid:dcd.approvedByUid||'',approvedRole:dcd.approvedRole||'',sourceId:discountSource};}catch(e){if(String((e&&e.message)||e).indexOf('cancelled')<0)alert('Discount approval failed: '+((e&&e.message)||e));return;} }
    await chargeSale(sub,tot,payments,null,discountApproval,cashierVerification);
    })();}finally{posChargeBusy=false;if(document.body.contains(chargeButton))refreshChargeAction();}
  };
}
function chargeSale(sub,total,payments,platform,discountApproval,cashierVerification){
  var keys=Object.keys(posCart); if(!keys.length)return;
  var shift=window.__posShift; if(!shift){alert('Open a shift first.');return;}
  var isPlat=!!platform;
  var cust=(document.getElementById('posCust').value||'').trim()||'Walk-in';
  var _scoped=isPlat?[]:posScopedDisc.slice();
  var _discEl=document.getElementById('posDisc');
  var disc=isPlat?(Number(platform.discountAmt)||0):((Number(_discEl&&_discEl.value)||0)+_scoped.reduce(function(s,d){return s+(Number(d.value)||0);},0));
  var staff=shift.staff||'Staff';
  var txnId='pos_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,10);
  var oid=_orderRefPrefix(isPlat,platform)+'-'+_shortRef();
  var lineItems=keys.map(function(k){var c=posCart[k];return {itemKey:c.itemKey,name:c.name,size:c.size,optLabels:c.optLabels,qty:c.qty,unitTotal:c.unitTotal,stream:c.stream||null,pkg:c.pkgId||null};});
  var _pkgs=isPlat?[]:(window.__posPkgs||[]);var _extra=_pkgs.reduce(function(s,pp){return s+(Number(pp.extraCost)||0);},0);
  var itemsStr=keys.map(function(k){var c=posCart[k];return c.name+(c.details?' ('+c.details+')':'')+' x'+c.qty;}).join(', ');
  if(isPlat){ payments=[{method:channelLabel(platform.channel),amount:total,tendered:0,change:0,ref:platform.platformRef}]; }
  var cash=(payments||[]).filter(function(x){return x.method==='Cash';});
  var tendered=cash.reduce(function(s,x){return s+(Number(x.tendered)||0);},0);
  var change=cash.reduce(function(s,x){return s+(Number(x.change)||0);},0);
  var tipTotal=(payments||[]).reduce(function(s,x){return s+(Number(x.tipRounding)||0);},0);
  var payLabel=isPlat?channelLabel(platform.channel):(payments.length>1?'Split':payments[0].method);
  var _pendingPay=(!isPlat)&&directPaymentRows(payments).length>0,_verificationPolicy=_pendingPay?paymentVerificationPolicy(payments):null;
  var now=new Date();
  var order={id:oid,clientTxnId:txnId,schemaVersion:2,syncState:'pending',name:cust,phone:'',type:(isPlat?channelLabel(platform.channel):'Walk-in'),address:'',payment:payLabel,payments:payments,contact:'',contactMethod:'',items:itemsStr,lineItems:lineItems,subtotal:sub,discount:disc,discountLines:_scoped,total:total,tendered:tendered,change:change,notes:'',status:'Completed',source:'pos',channel:(isPlat?platform.channel:'instore'),staff:staff,shiftId:shift.id,packages:_pkgs,extraCost:_extra,paymentStatus:(_pendingPay?(_verificationPolicy==='manager_only'?'pending':'cashier_verified'):'confirmed'),paymentVerificationPolicy:_verificationPolicy,cashierVerificationIntent:!!(_pendingPay&&_verificationPolicy==='cashier_manager'&&cashierVerification&&cashierVerification.required),receivedByCustomer:true,tipRounding:tipTotal,time:now.toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'}),date:now.toLocaleDateString('en-PH',{year:'numeric',month:'long',day:'numeric'}),timestamp:Date.now()};
  if(discountApproval){order.discountApprovalId=discountApproval.approvalId;order.discountApprovedBy=discountApproval.approvedBy;order.discountApprovedByUid=discountApproval.approvedByUid;order.discountApprovedRole=discountApproval.approvedRole;order.discountApprovalSource=discountApproval.sourceId;}
  if(isPlat){ order.platformRef=platform.platformRef; order.grossPlatform=platform.gross; order.platformDiscountPct=Number(platform.discountPct)||0; order.platformDiscount=Number(platform.discountAmt)||0; order.platformDiscountLines=platform.discountLines||[]; order.platformMerchantPromo=Number(platform.merchantPromo)||0; order.platformDeliveryFeeDiscount=Number(platform.deliveryFeeDiscount)||0; order.netSalesPlatform=Number(platform.netSales!=null?platform.netSales:total)||0; order.commission=platform.commission; order.commissionRate=platform.commissionRate; order.platformWht=Number(platform.wht)||0; order.platformWhtRate=Number(platform.whtRate)||0; order.platformVat=Number(platform.vat)||0; order.platformVatRate=Number(platform.vatRate)||0; order.netPlatform=platform.net; order.settlementStatus='unsettled'; order.payoutId=''; }
  var _cps=(payments||[]).filter(function(p){return p.cashReceived;});
  if(_cps.length){ var rcv={},chgD={},shrt=0; _cps.forEach(function(p){ rcv=mergeDenoms(rcv,p.cashReceived); chgD=mergeDenoms(chgD,p.cashChange||{}); shrt+=Number(p.changeShort)||0; });
    order.cashReceived=rcv; order.cashChange=chgD; order.changeShort=shrt;
    var _sh=window.__posShift;
    if(_sh){ var nd=mergeDenoms(shiftDrawer(), rcv); Object.keys(chgD).forEach(function(k){ nd[k]=(Number(nd[k])||0)-(Number(chgD[k])||0); }); _sh.drawer=nd; }
  }
  if(!isPlat && window.__online===false && (payments||[]).some(function(pp){return pp.method!=='Cash';})){
    alert("You're offline. Only CASH sales can be rung until the Wi-Fi/connection returns. Take this as cash, or wait to reconnect for G-Cash/bank.");
    return;
  }
  order.offlineRung=(window.__online===false);
  var _chargeStarted=performance.now();return persistPosSale(order).then(function(saved){
    telemetry().metric('charge_to_durable',performance.now()-_chargeStarted,saved.mode!=='server');
    if(window.__posLog)window.__posLog(saved.mode==='server'?'sale-server-recovered':'sale-queued',oid,'₱'+total+' · '+payLabel+(order.offlineRung?' · OFFLINE':'')+' · '+txnId);
    var receipt=Object.assign({},order); posCart={};posDraft={};posPaymentVerification=null; window.__posPkgs=[]; posScopedDisc=[]; renderPosCart({fresh:true}); showReceipt(receipt); if(saved.mode==='server'){(window.accazaToast||function(){})('Sale saved to the server. Browser storage was recovered safely.','ok');checkPosStorageHealth();}else flushOfflineQueue();
  }).catch(function(error){telemetry().metric('charge_to_durable',performance.now()-_chargeStarted,false);alert('Sale was NOT saved. Durable storage failed: '+String(error&&error.message||error));return {failed:true};});
}
window.__pos={render:function(){if(document.getElementById('posCartPanel'))renderPosCart();},loadCart:function(c){posCart=c||{};if(window.switchTab)window.switchTab('pos',document.querySelector('.admin-tab'));buildPOS();},hasItems:function(){return Object.keys(posCart).length>0;},addPackage:function(components,meta){(components||[]).forEach(function(c){var key=uid('pc_');posCart[key]={itemKey:c.itemKey,name:c.name,size:c.size||null,optLabels:c.optLabels||[],details:c.details||('pkg: '+meta.name),qty:c.qty,unitTotal:c.unitTotal,stream:(meta.type==='promo'?'promo':'events'),pkgId:meta.id};});window.__posPkgs=window.__posPkgs||[];window.__posPkgs.push(meta);renderPosCart();}};

/* ══════════ DEDUCTION ENGINE ══════════ */
function computeUsage(lineItems){
  var result=Costing().costOrder(costingContext({lineItems:lineItems||[]}));
  if(!result.ok)throw new Error(costingIssues(result.errors));
  window.__lastCostingResult=result;
  return result.usage;
}
/* ══════════ MODALS / RECEIPT ══════════ */
function ensureModals(){
  if(document.getElementById('pzItemMask'))return;
  var m=document.createElement('div'); m.className='pz-mask'; m.id='pzItemMask';
  m.innerHTML='<div class="pz-modal"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;"><div class="pz-h" id="pzItemTitle" style="margin:0;"></div><button class="pz-btn sec" id="pzItemClose" style="padding:0.2rem 0.6rem;">✕</button></div><div id="pzItemBody"></div><div style="display:flex;justify-content:space-between;align-items:center;margin-top:1rem;border-top:1px solid var(--cd);padding-top:0.7rem;"><span style="font-weight:700;font-size:1.05rem;" id="pzItemTotal">₱0.00</span><button class="pz-btn ok" id="pzItemAdd" style="padding:0.55rem 1.4rem;">Add to sale</button></div></div>';
  document.body.appendChild(m);
  document.getElementById('pzItemClose').onclick=function(){m.classList.remove('show');};
  document.getElementById('pzItemAdd').onclick=pzAddToCart;
  m.onclick=function(e){if(e.target===m)m.classList.remove('show');};
}
function showReceipt(o){
  var addr='Saratoga Ave, La Mediterranea Subd., Governor\'s Drive, Dasmariñas';
  var dispRef=o.platformRef||o.id;
  var rows=(o.lineItems||[]).map(function(li){return '<tr><td>'+esc(li.name)+' ×'+li.qty+'</td><td style="text-align:right;">'+peso(li.qty*li.unitTotal)+'</td></tr>'+(li.optLabels&&li.optLabels.length?'<tr><td colspan="2" style="font-size:0.7rem;color:#777;padding-top:0;">'+esc(li.optLabels.join(', '))+'</td></tr>':'');}).join('');
  var w=window.open('','_blank','width=360,height=640');
  if(!w){alert('Allow pop-ups to print the receipt. Sale was saved.');return;}
  w.document.write('<html><head><title>Receipt '+esc(dispRef)+'</title><style>*{font-family:monospace;font-size:12px;color:#000;}body{padding:10px;}h2{text-align:center;margin:0 0 2px;}table{width:100%;border-collapse:collapse;}td{padding:2px 0;}hr{border:none;border-top:1px dashed #000;}@media print{button{display:none;}}</style></head><body>'
    +'<h2>Accaza Coffee House</h2><div style="text-align:center;">'+esc(addr)+'</div><hr>'
    +'<div>Order: '+esc(dispRef)+'</div><div>'+esc(o.date)+' '+esc(o.time)+'</div><div>On Duty: '+esc(o.onDuty||o.staff||'-')+'</div><div>Customer: '+esc(o.name||'Walk-in')+'</div>'
    +'<hr>'
    +'<table>'+rows+'</table><hr>'
    +'<table><tr><td>Subtotal</td><td style="text-align:right;">'+peso(o.subtotal||o.total)+'</td></tr>'
    +((o.discountLines&&o.discountLines.length)?o.discountLines.map(function(d){var lbl={senior:'Senior 20%',pwd:'PWD 20%',athlete:'Athlete 20%',promo5:'Promo 5%'}[d.type]||d.type;return '<tr><td>'+esc(lbl)+(d.idNumber?' · '+esc(d.idNumber):'')+'</td><td style="text-align:right;">-'+peso(d.value)+'</td></tr>';}).join(''):'')
    +(function(){var sc=(o.discountLines||[]).reduce(function(s,d){return s+(Number(d.value)||0);},0);var man=(Number(o.discount)||0)-sc;return man>0.005?'<tr><td>Discount</td><td style="text-align:right;">-'+peso(man)+'</td></tr>':'';})()
    +'<tr><td><b>TOTAL</b></td><td style="text-align:right;"><b>'+peso(o.total)+'</b></td></tr>'
    +'<tr><td>Payment</td><td style="text-align:right;">'+esc(o.payment)+'</td></tr>'
    +(o.platformRef?'<tr><td>Net (after comm.)</td><td style="text-align:right;">'+peso(o.netPlatform||0)+'</td></tr>':'')
    +(o.tendered?'<tr><td>Cash</td><td style="text-align:right;">'+peso(o.tendered)+'</td></tr><tr><td>Change</td><td style="text-align:right;">'+peso(o.change)+'</td></tr>':'')
    +(o.tipRounding?'<tr><td>Tip / kept change</td><td style="text-align:right;">'+peso(o.tipRounding)+'</td></tr>':'')
    +'</table><hr><div style="text-align:center;">Salamat! Please come again.</div>'
    +'<div style="text-align:center;font-size:9px;margin-top:4px;">This is not an official BIR receipt.</div>'
    +'<div style="text-align:center;margin-top:8px;"><button onclick="window.print()">Print</button></div>'
    +'</body></html>');
  w.document.close();
}
})();
