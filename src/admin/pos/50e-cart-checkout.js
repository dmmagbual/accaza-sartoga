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
