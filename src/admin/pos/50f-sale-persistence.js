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
