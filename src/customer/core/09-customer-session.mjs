
// ===================== APP CUSTOMER LOGIN + TRACKING =====================
let appCustomersMap={};
function isAppMode(){return document.documentElement.classList.contains('app-mode')||window.matchMedia('(display-mode: standalone)').matches||window.navigator.standalone===true;}
function getAppUser(){try{return JSON.parse(localStorage.getItem('accaza_app_user')||'null');}catch(e){return null;}}
function prefillAppUser(){var u=getAppUser();if(!u)return;var n=document.getElementById('custName'),p=document.getElementById('custPhone');if(n&&!n.value)n.value=u.name;if(p&&!p.value)p.value=u.phone;var ind=document.getElementById('appUserIndicator');if(ind){var nm=document.getElementById('appUserName');if(nm)nm.textContent=u.name;ind.style.display='block';}}
window.appLoginSubmit=async function(){
  var n=(document.getElementById('appLoginName').value||'').trim();
  var p=(document.getElementById('appLoginPhone').value||'').trim();
  var err=document.getElementById('appLoginErr');
  if(n.length<2){err.textContent='Please enter your full name.';err.style.display='block';return;}
  var digits=p.replace(/[^0-9]/g,'');
  if(digits.length<10){err.textContent='Please enter a valid phone number.';err.style.display='block';return;}
  err.style.display='none';
  var user={name:n,phone:p,since:Date.now()};
  try{localStorage.setItem('accaza_app_user',JSON.stringify(user));}catch(e){}
  try{var au=await ensureCustomerAuth();await update(ref(db,'appCustomers/'+au.uid),{name:n,phone:p,lastSeen:Date.now()});}catch(e){}
  var ov=document.getElementById('appLoginOverlay');if(ov)ov.style.display='none';
  prefillAppUser();
  setupPush();
};
window.appLogout=async function(){try{localStorage.removeItem('accaza_app_user');localStorage.removeItem('accaza_my_orders');}catch(e){}try{if(auth.currentUser)await remove(ref(db,'appCustomers/'+auth.currentUser.uid+'/pushToken'));}catch(e){}try{await signOut(auth);}catch(e){}location.reload();};
function appLoginInit(){if(!isAppMode())return;var ov=document.getElementById('appLoginOverlay');var u=getAppUser();if(!u){if(ov)ov.style.display='flex';}else{prefillAppUser();setupPush();refreshNotifyPrompt();}}
window.renderAppCustomers=function(){
  var body=document.getElementById('appCustBody');if(!body)return;
  var arr=Object.keys(appCustomersMap).map(function(k){var v=appCustomersMap[k]||{};return {name:v.name||'\u2014',phone:v.phone||k,orders:v.orders||0,firstSeen:v.firstSeen,lastOrder:v.lastOrder};});
  arr.sort(function(a,b){return (b.orders-a.orders)||((b.lastOrder||0)-(a.lastOrder||0));});
  var sum=document.getElementById('appCustSummary');var total=arr.reduce(function(s,c){return s+c.orders;},0);
  if(sum)sum.textContent=arr.length+' customers \u00b7 '+total+' app orders';
  function d(ts){if(!ts)return '\u2014';try{return new Date(ts).toLocaleDateString('en-PH',{year:'numeric',month:'short',day:'numeric'});}catch(e){return '\u2014';}}
  if(!arr.length){body.innerHTML='<tr><td colspan="6" style="padding:1rem;color:var(--tl);text-align:center;">No app customers yet.</td></tr>';return;}
  body.innerHTML=arr.map(function(c,i){return '<tr style="border-bottom:1px solid var(--cr);"><td style="padding:0.55rem;color:var(--tl);">'+(i+1)+'</td><td style="padding:0.55rem;font-weight:500;">'+escHtml(c.name)+'</td><td style="padding:0.55rem;">'+escHtml(c.phone)+'</td><td style="padding:0.55rem;text-align:center;font-weight:700;color:var(--bd);">'+c.orders+'</td><td style="padding:0.55rem;color:var(--tm);">'+d(c.firstSeen)+'</td><td style="padding:0.55rem;color:var(--tm);">'+d(c.lastOrder)+'</td></tr>';}).join('');
};
window.exportAppCustomers=function(){
  var arr=Object.keys(appCustomersMap).map(function(k){return appCustomersMap[k]||{};});
  arr.sort(function(a,b){return (b.orders||0)-(a.orders||0);});
  function d(ts){if(!ts)return '';try{return new Date(ts).toLocaleDateString('en-PH');}catch(e){return '';}}
  var rows=[['Name','Phone','App Orders','First Seen','Last Order']];
  arr.forEach(function(c){rows.push([c.name||'',c.phone||'',c.orders||0,d(c.firstSeen),d(c.lastOrder)]);});
  var csv=rows.map(function(r){return r.map(function(x){return '"'+String(x).replace(/"/g,'""')+'"';}).join(',');}).join(String.fromCharCode(10));
  var blob=new Blob([csv],{type:'text/csv'});var url=URL.createObjectURL(blob);var a=document.createElement('a');a.href=url;a.download='accaza-app-customers.csv';document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
};
var APP_PROMO_THRESHOLD=10;
function getPromoTarget(){var el=document.getElementById('appPromoTarget');var v=el?parseInt(el.value,10):NaN;if(!(v>=1)){try{v=parseInt(localStorage.getItem('accaza_promo_target'),10);}catch(e){}}if(!(v>=1))v=10;return v;}
window.savePromoTarget=function(){var v=getPromoTarget();try{localStorage.setItem('accaza_promo_target',String(v));}catch(e){}var el=document.getElementById('appPromoTarget');if(el)el.value=v;renderAppCustomers();};
function _acDigits(p){return String(p||'').replace(/[^0-9]/g,'');}
function _acRange(){var f=document.getElementById('appCustFrom'),t=document.getElementById('appCustTo'),fromTs=null,toTs=null;if(f&&f.value){var a=new Date(f.value+'T00:00:00');if(!isNaN(a.getTime()))fromTs=a.getTime();}if(t&&t.value){var b=new Date(t.value+'T23:59:59.999');if(!isNaN(b.getTime()))toTs=b.getTime();}return {fromTs:fromTs,toTs:toTs};}
function _acCounts(){var r=_acRange();var all={};try{Object.assign(all,archivedOrdersMap||{},adminOrdersMap||{});}catch(e){all=adminOrdersMap||{};}var counts={};Object.keys(all).forEach(function(id){var o=all[id];if(!o||!o.phone||o.status==='Rejected')return;var ts=o.timestamp||o.archivedAt||0;if(r.fromTs&&ts<r.fromTs)return;if(r.toTs&&ts>r.toTs)return;var k=_acDigits(o.phone);if(!k)return;if(!counts[k])counts[k]={count:0,last:0,name:o.name||''};counts[k].count++;if(ts>counts[k].last){counts[k].last=ts;counts[k].name=o.name||counts[k].name;}});return counts;}
window.clearAppCustFilter=function(){var f=document.getElementById('appCustFrom'),t=document.getElementById('appCustTo');if(f)f.value='';if(t)t.value='';renderAppCustomers();};
window.renderAppCustomers=function(){
  var body=document.getElementById('appCustBody');if(!body)return;
  APP_PROMO_THRESHOLD=getPromoTarget();var _pt=document.getElementById('appPromoTarget');if(_pt&&!_pt.value)_pt.value=APP_PROMO_THRESHOLD;
  var counts=_acCounts();
  var arr=Object.keys(appCustomersMap).map(function(k){var v=appCustomersMap[k]||{};var c=counts[k]||{count:0,last:0,name:''};return {name:(v.name||c.name||'—'),phone:v.phone||k,orders:c.count,last:c.last||v.lastOrder,firstSeen:v.firstSeen};});
  arr.sort(function(a,b){return (b.orders-a.orders)||((b.last||0)-(a.last||0));});
  var elig=arr.filter(function(c){return c.orders>=APP_PROMO_THRESHOLD;}).length;
  var total=arr.reduce(function(s,c){return s+c.orders;},0);
  var sum=document.getElementById('appCustSummary');
  if(sum)sum.textContent=arr.length+' customers · '+total+' orders · '+elig+' eligible (≥'+APP_PROMO_THRESHOLD+')';
  function d(ts){if(!ts)return '—';try{return new Date(ts).toLocaleDateString('en-PH',{year:'numeric',month:'short',day:'numeric'});}catch(e){return '—';}}
  if(!arr.length){body.innerHTML='<tr><td colspan="6" style="padding:1rem;color:var(--tl);text-align:center;">No app customers yet.</td></tr>';return;}
  body.innerHTML=arr.map(function(c,i){var e=c.orders>=APP_PROMO_THRESHOLD;return '<tr style="border-bottom:1px solid var(--cr);'+(e?'background:rgba(45,158,95,0.08);':'')+'"><td style="padding:0.55rem;color:var(--tl);">'+(i+1)+'</td><td style="padding:0.55rem;font-weight:500;">'+escHtml(c.name)+(e?' <span style="background:#2d9e5f;color:#fff;border-radius:999px;font-size:0.62rem;padding:0.1rem 0.45rem;white-space:nowrap;">🎁 Free coffee</span>':'')+'</td><td style="padding:0.55rem;">'+escHtml(c.phone)+'</td><td style="padding:0.55rem;text-align:center;font-weight:700;color:'+(e?'#2d9e5f':'var(--bd)')+';">'+c.orders+'</td><td style="padding:0.55rem;color:var(--tm);">'+d(c.firstSeen)+'</td><td style="padding:0.55rem;color:var(--tm);">'+d(c.last)+'</td></tr>';}).join('');
};
window.exportAppCustomers=function(){
  var counts=_acCounts();
  var arr=Object.keys(appCustomersMap).map(function(k){var v=appCustomersMap[k]||{};var c=counts[k]||{count:0,last:0};return {name:v.name||'',phone:v.phone||k,orders:c.count,firstSeen:v.firstSeen,last:c.last||v.lastOrder,eligible:(c.count>=APP_PROMO_THRESHOLD)?'YES':''};});
  arr.sort(function(a,b){return (b.orders||0)-(a.orders||0);});
  function d(ts){if(!ts)return '';try{return new Date(ts).toLocaleDateString('en-PH');}catch(e){return '';}}
  var rows=[['Name','Phone','Orders (in range)','Eligible (>='+APP_PROMO_THRESHOLD+')','First Seen','Last Order']];
  arr.forEach(function(c){rows.push([c.name,c.phone,c.orders,c.eligible,d(c.firstSeen),d(c.last)]);});
  var csv=rows.map(function(r){return r.map(function(x){return '"'+String(x).replace(/"/g,'""')+'"';}).join(',');}).join(String.fromCharCode(10));
  var blob=new Blob([csv],{type:'text/csv'});var url=URL.createObjectURL(blob);var a=document.createElement('a');a.href=url;a.download='accaza-app-customers.csv';document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',appLoginInit);else appLoginInit();
window.notifyCustomer=function(oid){
  var o=adminOrdersMap[oid]; if(!o)return;
  var first=((o.name||'').trim().split(' ')[0])||'there';
  var isDel=o.type==='Delivery';
  var msg=isDel
    ?'Hi '+first+'! \u2615 Your Accaza order #'+oid+' is ready for delivery. Kindly let us know once you\u2019ve booked your preferred delivery/courier service so we can hand it over. Maraming salamat! \u2014 Accaza Coffee House'
    :'Hi '+first+'! \u2615 Your Accaza order #'+oid+' is now ready for pick-up. See you soon at Saratoga Ave, La Mediterranea Subd., Governor\u2019s Drive, Dasmari\u00f1as. \u2014 Accaza Coffee House';
  var raw=((o.contact||o.phone||'')+'').replace(/[^0-9]/g,'');
  var intl=raw; if(intl.indexOf('0')===0){intl='63'+intl.slice(1);} else if(intl.indexOf('63')!==0&&intl.length===10&&intl.charAt(0)==='9'){intl='63'+intl;}
  var method=((o.contactMethod||'')+'').toLowerCase();
  try{if(navigator.clipboard)navigator.clipboard.writeText(msg);}catch(e){}
  function go(url,blank){var a=document.createElement('a');a.href=url;if(blank){a.target='_blank';a.rel='noopener';}document.body.appendChild(a);a.click();a.remove();}
  var enc=encodeURIComponent(msg);
  var t=window.accazaToast||function(){};
  if(method==='whatsapp'&&intl){go('https://wa.me/'+intl+'?text='+enc,true);t('Opening WhatsApp\u2026','ok');}
  else if(method==='sms'&&raw){go('sms:'+raw+'?&body='+enc,false);t('Opening Messages\u2026','ok');}
  else if(method==='viber'&&intl){go('viber://chat?number=%2B'+intl,false);t('Viber opened \u2014 message copied, just paste & send','ok');}
  else if(method==='email'&&o.contact){go('mailto:'+encodeURIComponent(o.contact)+'?subject='+encodeURIComponent('Your Accaza Order #'+oid)+'&body='+enc,false);t('Opening email\u2026','ok');}
  else if(intl){go('https://wa.me/'+intl+'?text='+enc,true);t('Opening WhatsApp \u2014 message copied','ok');}
  else{t('Message copied to clipboard','ok');}
};
function _hashSig(s){var h=0,i;for(i=0;i<s.length;i++){h=((h<<5)-h+s.charCodeAt(i))|0;}return (h>>>0).toString(36);}
window.placeOrder=async function(){
  if(window._placingOrder)return;
  if(!onlineOrderingAvailable()){syncPlaceOrderButton();alert('Online orders are closed right now. Please wait until the green OPEN FOR ONLINE ORDERS light appears.');return;}
  const name=document.getElementById('custName').value.trim(),phone=document.getElementById('custPhone').value.trim();
  if(!Object.keys(cart).length){alert('Please add at least one item.');return;}
  if(!name||!phone){alert('Please enter your name and phone number.');return;}
  if(orderType==='delivery'&&!document.getElementById('deliveryAddr').value.trim()){alert('Please enter your delivery address.');return;}
  if(!document.getElementById('paymentProof').files[0]){alert('Please attach your proof of payment.');return;}
  if(paymentProofBusy){alert('Please wait while the receipt is being optimized.');return;}
  if(!paymentProofData){alert('Please remove and attach the payment proof again.');return;}
  const proofSrc=paymentProofData;
  const total=Object.values(cart).reduce((s,c)=>s+c.qty*c.unitTotal,0)+(window.__custPkgs||[]).reduce((s,p)=>s+(Number(p.extraCost)||0),0);
  const itemsArr=Object.values(cart).map(c=>c.name+(c.details?' ('+c.details+')':'')+' x'+c.qty);
  const lineItemsArr=Object.values(cart).map(c=>({itemKey:c.itemKey||null,size:c.size||null,optLabels:c.optLabels||[],qty:c.qty,stream:c.stream||null,pkg:c.pkgId||null,packageRole:c.packageRole||null}));
  const _sig=phone+'|'+itemsArr.join('~')+'|'+total;
  var _persist=(function(){try{var v=localStorage.getItem('accaza_lastsig');if(!v)return null;var ix=v.lastIndexOf('@@');return {sig:v.slice(0,ix),t:parseInt(v.slice(ix+2))||0};}catch(e){return null;}})();
  if((window._lastOrderSig===_sig&&Date.now()-(window._lastOrderTime||0)<30000)||(_persist&&_persist.sig===_sig&&Date.now()-_persist.t<30000)){alert('Looks like you just placed this exact order — please try again after 30 seconds.');return;}
  window._placingOrder=true;
  const _btn=document.querySelector('.btn-place-order');_btn.disabled=true;_btn.style.opacity='0.5';_btn.textContent='⏳ Placing order…';
  try{
    await ensureCustomerAuth(true);
    var orderPayload={name:name,phone:phone,type:orderType==='delivery'?'Delivery':'Pick-up',address:orderType==='delivery'?document.getElementById('deliveryAddr').value.trim():'',payment:paymentType==='gcash'?'GCash':paymentType==='maya'?'PayMaya':'Bank Transfer',contact:document.getElementById('custContact').value.trim(),contactMethod:contactMethod,notes:document.getElementById('custNotes').value.trim(),proof:proofSrc,lineItems:lineItemsArr,expectedTotal:total};
    var placed;
    try{placed=await createOnlineOrderCall(orderPayload);}catch(firstError){
      if(String(firstError&&firstError.code).indexOf('unauthenticated')<0)throw firstError;
      await ensureCustomerAuth(true);
      placed=await createOnlineOrderCall(orderPayload);
    }
    var orderId=placed&&placed.data&&placed.data.orderId;if(!orderId)throw new Error('Server did not return an order number.');
    window._lastOrderSig=_sig;window._lastOrderTime=Date.now();window._placingOrder=false;_btn.textContent='✅ Order Placed!';try{localStorage.setItem('accaza_lastsig',_sig+'@@'+Date.now());}catch(e){}
    if(myOrderIds.indexOf(orderId)<0)myOrderIds.push(orderId);localStorage.setItem('accaza_my_orders',JSON.stringify(myOrderIds));if(window.__subscribeMyOrders)window.__subscribeMyOrders();
    document.getElementById('displayOrderId').textContent=orderId;document.getElementById('orderConfirm').style.display='block';
    document.querySelector('.btn-place-order').disabled=true;document.querySelector('.btn-place-order').style.opacity='0.5';
    cart={};window.__custPkgs=[];updateCartDisplay();renderOrderSection();renderCustomerOrders();
    document.getElementById('custName').value='';document.getElementById('custPhone').value='';document.getElementById('custNotes').value='';
    removeProof({stopPropagation:function(){}});
    setTimeout(function(){syncPlaceOrderButton();document.getElementById('orderConfirm').style.display='none';},5000);
  }catch(e){window._placingOrder=false;_btn.style.opacity='1';syncPlaceOrderButton();var msg=(e&&e.message)||'Unknown error';if(String(e&&e.code).indexOf('already-exists')>-1)msg='This exact order was already submitted. Please wait one minute before trying again.';alert('Could not place order: '+msg);}
};
window.resetOrder=function(){if(!Object.keys(cart).length&&!document.getElementById('custName').value){alert('Your order is already empty!');return;}if(confirm('Reset your order?')){cart={};updateCartDisplay();renderOrderSection();document.getElementById('custName').value='';document.getElementById('custPhone').value='';document.getElementById('custNotes').value='';setType('pickup');(function(){var gBtn=document.getElementById('btnGcash');var mBtn=document.getElementById('btnMaya');var bBtn=document.getElementById('btnBank');var first=gBtn&&gBtn.style.display!=='none'?'gcash':mBtn&&mBtn.style.display!=='none'?'maya':'bank';setPayment(first);})();document.getElementById('orderConfirm').style.display='none';syncPlaceOrderButton();}};
