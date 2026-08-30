
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
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',appLoginInit);else appLoginInit();
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
