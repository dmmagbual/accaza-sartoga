
/* ---------- Z-report computation ---------- */
function computeZ(shift,sourceOrders){
  var sales=[],voids=[],z={tx:0,gross:0,discounts:0,refunds:0,cashRefunds:0,net:0,byMethod:{},byChannel:{instore:0,online:0,grabfood:0,foodpanda:0},cashSales:0,voidCount:0,voidAmt:0,pending:0,pendingCount:0,managerPending:0,managerPendingCount:0,tips:0};
  var source=sourceOrders||Object.keys(ordersMap).map(function(id){return Object.assign({id:id},ordersMap[id]);});
  source.forEach(function(o){if(!o||o.shiftId!==shift.id)return;
    if(o.voided){z.voidCount++;z.voidAmt+=Number(o.total)||0;return;}
    if(['Completed','Received'].indexOf(o.status)<0)return;
    var gross=(o.subtotal!=null?Number(o.subtotal):Number(o.total))||0;var disc=Number(o.discount)||0;var ref=Number(o.refundAmount)||0;
    z.tx++;z.gross+=gross;z.discounts+=disc;z.refunds+=ref;z.cashRefunds+=Number((o.refundPayments||{}).Cash)||(ref&&(!o.refundPayments)&&(o.payment==='Cash'||paysOf(o).some(function(p){return p.method==='Cash';}))?ref:0);z.net+=gross-disc-ref;
    z.tips+=Number(o.tipRounding)||0;
    var _ch=(o.channel&&z.byChannel[o.channel]!=null)?o.channel:'instore';z.byChannel[_ch]+=Number(o.total)||0;
    if(o.paymentStatus==='pending'){z.pending+=(Number(o.total)||0);z.pendingCount++;}
    if(o.paymentStatus==='cashier_verified'){z.managerPending+=(Number(o.total)||0);z.managerPendingCount++;}
    paysOf(o).forEach(function(p){z.byMethod[p.method]=(z.byMethod[p.method]||0)+(Number(p.amount)||0);});
  });
  z.cashSales=z.byMethod['Cash']||0;
  z.payIns=(shift.payIns||[]).reduce(function(s,x){return s+(Number(x.amount)||0);},0);
  z.payOuts=(shift.payOuts||[]).reduce(function(s,x){return s+(Number(x.amount)||0);},0);
  z.expectedCash=(Number(shift.openingFloat)||0)+z.cashSales+z.tips-z.cashRefunds+z.payIns-z.payOuts;
  // Imprest: cashier retains the fixed float, remits the rest. Grab/Panda + non-cash tenders never entered cashSales, so they're already out of the cash line.
  z.retainedFloat=(fixedFloatCfg!=null?fixedFloatCfg:(Number(shift.openingFloat)||0));
  z.availableForHandover=Math.round((z.expectedCash+z.payOuts-z.retainedFloat)*100)/100;
  z.cashToSettle=Math.round((z.expectedCash-z.retainedFloat)*100)/100;
  z.floatMismatch=(fixedFloatCfg!=null&&fixedFloatCfg>0&&Math.abs((Number(shift.openingFloat)||0)-fixedFloatCfg)>0.001);
  return z;
}

/* ---------- render ---------- */
function renderPayMethods(){
  var box=document.getElementById('payMethodsBox');if(!box)return;var a=A();
  a.get(a.ref(a.db,'posSettings')).then(function(s){
    var v=s.val()||{};var pm=v.payMethods;
    if(!pm||!pm.length)pm=[{name:'Cash',active:true,cash:true},{name:'GCash',active:true,cash:false,verificationPolicy:'cashier_manager'},{name:'Bank Transfer',active:true,cash:false,verificationPolicy:'manager_only'},{name:'Card / EFTPOS',active:false,cash:false,verificationPolicy:'manager_only'}];
    function save(pm2){return a.update(a.ref(a.db,'posSettings'),{payMethods:pm2}).then(renderPayMethods);}
    box.innerHTML='<div class="payment-authority-note"><b>Verification authority</b><span>Choose who can confirm funds in the actual receiving account. Platform payouts stay separate.</span></div>'+pm.map(function(m,i){var policy=(m.verificationPolicy==='cashier_manager'||m.verificationPolicy==='manager_only')?m.verificationPolicy:defaultVerificationPolicy(m.name);return '<div class="payment-method-control"><label class="payment-method-toggle"><input type="checkbox" data-pmact="'+i+'"'+(m.active!==false?' checked':'')+'/> <span><b>'+esc(m.name)+'</b><small>'+(m.cash?'Cash · no reference required':'Reference required')+'</small></span></label>'+(m.cash?'':'<label class="payment-policy-field"><span>Who verifies</span><select class="pz-in" data-pmpolicy="'+i+'"><option value="cashier_manager"'+(policy==='cashier_manager'?' selected':'')+'>Cashier + manager review</option><option value="manager_only"'+(policy==='manager_only'?' selected':'')+'>Manager only</option></select></label><button class="pz-btn warn" data-pmdel="'+i+'" aria-label="Remove '+esc(m.name)+'">✕</button>')+'</div>';}).join('')
      +'<div style="display:flex;gap:0.4rem;margin-top:0.5rem;"><input class="pz-in" id="pmNew" placeholder="Add method (e.g. Maya)" aria-describedby="pmAddStatus" style="flex:1;"/><button type="button" class="pz-btn sec" id="pmAdd">+ add</button></div><div id="pmAddStatus" role="status" aria-live="polite" style="min-height:1rem;font-size:0.72rem;color:var(--tl);margin-top:0.2rem;"></div>'
      +'<div style="font-size:0.72rem;color:var(--tl);margin-top:0.35rem;">Cashier + manager review records the cashier check first, then requires independent manager review. Manager only prevents cashier verification. GrabFood and FoodPanda are not controlled here.</div>';
    box.querySelectorAll('[data-pmact]').forEach(function(c){c.onchange=function(){pm[+c.getAttribute('data-pmact')].active=c.checked;save(pm);};});
    box.querySelectorAll('[data-pmpolicy]').forEach(function(c){c.onchange=function(){pm[+c.getAttribute('data-pmpolicy')].verificationPolicy=c.value==='cashier_manager'?'cashier_manager':'manager_only';save(pm);};});
    box.querySelectorAll('[data-pmdel]').forEach(function(b){b.onclick=function(){if(confirm('Remove this payment method?')){pm.splice(+b.getAttribute('data-pmdel'),1);save(pm);}};});
    var add=document.getElementById('pmAdd'),input=document.getElementById('pmNew'),status=document.getElementById('pmAddStatus');
    function addMethod(){var nm=(input.value||'').trim();status.textContent='';if(!nm){status.textContent='Enter a payment method name first.';input.focus();return;}if(pm.some(function(x){return String(x.name).toLowerCase()===nm.toLowerCase();})){status.textContent='That payment method already exists.';input.focus();input.select();return;}var next=pm.concat([{name:nm,active:true,cash:false,verificationPolicy:defaultVerificationPolicy(nm)}]);add.disabled=true;input.disabled=true;add.textContent='Saving…';status.textContent='Saving '+nm+'…';save(next).catch(function(e){add.disabled=false;input.disabled=false;add.textContent='+ add';status.textContent='Could not add the payment method: '+((e&&e.message)||e||'Please check your connection and access.');input.focus();});}
    if(add)add.onclick=addMethod;
    if(input)input.onkeydown=function(e){if(e.key==='Enter'){e.preventDefault();addMethod();}};
  });
}
