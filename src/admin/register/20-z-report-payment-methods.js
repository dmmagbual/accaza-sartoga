
/* ---------- Z-report computation ---------- */
function computeZ(shift,sourceOrders){
  var sales=[],voids=[],z={tx:0,gross:0,discounts:0,refunds:0,cashRefunds:0,net:0,byMethod:{},byMethodAccount:{},byChannel:{instore:0,online:0,grabfood:0,foodpanda:0},cashSales:0,voidCount:0,voidAmt:0,pending:0,pendingCount:0,managerPending:0,managerPendingCount:0,tips:0};
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
    paysOf(o).forEach(function(p){var m=window.AccazaSales.paymentKey(p),acct=window.AccazaSales.paymentAccount(p,cashAccountsMap),amt=Number(p.amount)||0;z.byMethod[m]=(z.byMethod[m]||0)+amt;z.byMethodAccount[m]=z.byMethodAccount[m]||{};z.byMethodAccount[m][acct||'']=(z.byMethodAccount[m][acct||'']||0)+amt;});
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
function configuredPaymentAccountIds(method){var explicit=Array.isArray(method.accountIds)?method.accountIds:null,key=String(method.name||'').toLowerCase(),ids=[];if(explicit)return explicit.filter(function(id){return cashAccountsMap[id];});Object.keys(cashAccountsMap).forEach(function(id){var a=cashAccountsMap[id]||{},name=String(a.name||'').toLowerCase(),feeds=Array.isArray(a.feedMethods)?a.feedMethods:[];if(feeds.some(function(x){return String(x).toLowerCase()===key;}))ids.push(id);else if(key==='bank transfer'&&(name==='bdo'||name==='union bank'))ids.push(id);else if(key==='gcash'&&(name==='g-cash'||name==='gcash'))ids.push(id);else if(key==='paymaya'&&/paymaya|maya/.test(name))ids.push(id);});return ids;}
function paymentAccountTypeAllowed(method,account){var key=String(method&&method.name||'').trim().toLowerCase(),type=String(account&&account.type||'').toLowerCase();if(key==='bank transfer')return type==='bank';if(/gcash|maya|wallet/.test(key))return type==='ewallet';return type==='bank'||type==='ewallet';}
function paymentAccountControls(method,index){if(method.cash)return'';var selected=configuredPaymentAccountIds(method),ids=Object.keys(cashAccountsMap).filter(function(id){return cashAccountsMap[id]&&cashAccountsMap[id].active!==false&&paymentAccountTypeAllowed(method,cashAccountsMap[id]);}).sort(function(a,b){return String(cashAccountsMap[a].name||a).localeCompare(String(cashAccountsMap[b].name||b));}),available=ids.filter(function(id){return selected.indexOf(id)<0;}),assigned=selected.map(function(id){return '<span style="display:inline-flex;align-items:center;gap:.3rem;background:#eef5ef;border:1px solid #bdd4c1;border-radius:999px;padding:.2rem .35rem .2rem .55rem;font-size:.74rem;"><b>'+esc(cashAccountsMap[id].name||id)+'</b><button type="button" data-pmacct-remove="'+index+'" data-account="'+esc(id)+'" aria-label="Remove '+esc(cashAccountsMap[id].name||id)+'" style="border:0;background:transparent;color:#9b2c2c;cursor:pointer;font-weight:700;">×</button></span>';}).join('');return '<div style="flex-basis:100%;padding:.3rem 0 .15rem 1.25rem;"><span class="pz-lbl">Allowed receiving accounts</span>'+(ids.length?'<div style="display:flex;gap:.4rem;align-items:center;flex-wrap:wrap;margin-top:.25rem;"><select class="pz-in" data-pmacct-select="'+index+'" style="min-width:220px;"><option value="">— Select an existing Finance account —</option>'+available.map(function(id){return '<option value="'+esc(id)+'">'+esc(cashAccountsMap[id].name||id)+' · '+esc(cashAccountsMap[id].type||'bank')+'</option>';}).join('')+'</select><button type="button" class="pz-btn sec" data-pmacct-add="'+index+'"'+(available.length?'':' disabled')+'>Assign account</button></div><div style="display:flex;gap:.4rem;flex-wrap:wrap;margin-top:.4rem;">'+(assigned||'<span style="font-size:.72rem;color:#9b2c2c;">No account assigned. Existing POS routing remains unchanged until you assign one.</span>')+'</div>':'<span style="display:block;font-size:.72rem;color:#c0392b;margin-top:.25rem;">No compatible '+(String(method.name).toLowerCase()==='bank transfer'?'bank':'e-wallet')+' account is visible. Check the Finance account type and your POS Settings permission.</span>')+'</div>';}
/* A method total is the headline; the receiving account underneath says which wallet or bank took it. */
function zMethodRows(z,cell){
  return Object.keys(z.byMethod||{}).sort().map(function(m){
    var sub=(z.byMethodAccount||{})[m]||{},names=Object.keys(sub).filter(function(n){return n&&Math.abs(sub[n])>0.009;}).sort(),
        row='<tr><td>'+esc(m)+'</td><td '+cell+'>'+peso(z.byMethod[m])+'</td></tr>';
    var plain=function(v){return String(v||'').toLowerCase().replace(/[^a-z0-9]/g,'');};
    if(!names.length||(names.length===1&&plain(names[0])===plain(m)))return row;
    return row+names.map(function(n){return '<tr><td style="padding-left:1.3rem;color:var(--tl);">'+esc(n)+'</td><td '+cell+' style="color:var(--tl);">'+peso(sub[n])+'</td></tr>';}).join('');
  }).join('');
}
function renderPayMethods(){
  var box=document.getElementById('payMethodsBox');if(!box)return;var a=A();
  a.get(a.ref(a.db,'posSettings')).then(function(s){
    var v=s.val()||{};var pm=v.payMethods;
    if(!pm||!pm.length)pm=[{name:'Cash',active:true,cash:true},{name:'Bank Transfer',active:true,cash:false,verificationPolicy:'cashier_manager'},{name:'GCash',active:true,cash:false,verificationPolicy:'cashier_manager'},{name:'PayMaya',active:true,cash:false,verificationPolicy:'cashier_manager'}];
    function save(pm2){return a.update(a.ref(a.db,'posSettings'),{payMethods:pm2}).then(renderPayMethods);}
    box.innerHTML='<div class="payment-authority-note"><b>Verification authority</b><span>Choose who can confirm funds in the actual receiving account. Platform payouts stay separate.</span></div>'+pm.map(function(m,i){var policy=(m.verificationPolicy==='cashier_manager'||m.verificationPolicy==='manager_only')?m.verificationPolicy:defaultVerificationPolicy(m.name);return '<div class="payment-method-control" style="flex-wrap:wrap;"><label class="payment-method-toggle"><input type="checkbox" data-pmact="'+i+'"'+(m.active!==false?' checked':'')+'/> <span><b>'+esc(m.name)+'</b><small>'+(m.cash?'Cash · no reference required':'Reference and receiving account required')+'</small></span></label>'+(m.cash?'':'<label class="payment-policy-field"><span>Who verifies</span><select class="pz-in" data-pmpolicy="'+i+'"><option value="cashier_manager"'+(policy==='cashier_manager'?' selected':'')+'>Cashier + manager review</option><option value="manager_only"'+(policy==='manager_only'?' selected':'')+'>Manager only</option></select></label><button class="pz-btn sec" data-pmrename="'+i+'">Rename</button><button class="pz-btn warn" data-pmdel="'+i+'" aria-label="Remove '+esc(m.name)+'">✕</button>')+'<div style="flex-basis:100%;margin-top:.35rem;"><span class="pz-lbl">Also counts as this method (old names, comma separated)</span><input class="pz-in" data-pmalias="'+i+'" value="'+esc((Array.isArray(m.aliases)?m.aliases:[]).join(', '))+'" placeholder="e.g. GCash, PayMaya"/><div style="font-size:0.7rem;color:var(--tl);margin-top:.2rem;">Sales already posted under an old name keep reporting here, so history stays in one line.</div></div>'+paymentAccountControls(m,i)+'</div>';}).join('')
      +'<div style="display:flex;gap:0.4rem;margin-top:0.5rem;"><input class="pz-in" id="pmNew" placeholder="Add method (e.g. Maya)" aria-describedby="pmAddStatus" style="flex:1;"/><button type="button" class="pz-btn sec" id="pmAdd">+ add</button></div><div id="pmAddStatus" role="status" aria-live="polite" style="min-height:1rem;font-size:0.72rem;color:var(--tl);margin-top:0.2rem;"></div>'
      +'<div style="margin-top:.45rem;"><button type="button" class="pz-btn sec" id="pmAddAccount">Create a new Finance account</button></div><div style="font-size:0.72rem;color:var(--tl);margin-top:0.35rem;">Select existing accounts from the dropdown above. Only create a new account when the real bank or wallet does not already exist. Cashier + manager review records the cashier check first, then requires independent manager review. GrabFood and FoodPanda are not controlled here.</div>';
    box.querySelectorAll('[data-pmact]').forEach(function(c){c.onchange=function(){pm[+c.getAttribute('data-pmact')].active=c.checked;save(pm);};});
    box.querySelectorAll('[data-pmrename]').forEach(function(b){b.onclick=function(){
      /* The method name is the key in posted orders, refundPayments and every account's feedMethods.
         A rename that only changed the label would orphan all three, so it also records the old name
         as an alias and teaches the linked accounts to accept the new one. */
      var i=+b.getAttribute('data-pmrename'),old=String(pm[i].name||'');
      F().run({title:'Rename payment method',subtitle:'Sales already posted as \u201c'+old+'\u201d keep reporting under the new name, and its receiving accounts will accept both.',submitLabel:'Rename',busyLabel:'Renaming\u2026',fields:[{name:'name',label:'New name',required:true,value:old,maxLength:60}]},function(v){
        var nm=String(v.name||'').trim();
        if(!nm||nm===old)return Promise.resolve();
        if(pm.some(function(x,j){return j!==i&&String(x.name||'').toLowerCase()===nm.toLowerCase();}))return Promise.reject(new Error('Another payment method already uses that name.'));
        var aliases=(Array.isArray(pm[i].aliases)?pm[i].aliases:[]).slice(),lower=aliases.map(function(x){return String(x).toLowerCase();});
        if(lower.indexOf(old.toLowerCase())<0)aliases.push(old);
        pm[i].name=nm;pm[i].aliases=aliases;
        var writes=[];
        Object.keys(cashAccountsMap||{}).forEach(function(id){
          var acc=cashAccountsMap[id]||{},list=Array.isArray(acc.feedMethods)?acc.feedMethods:[];
          if(!list.some(function(x){return String(x).toLowerCase()===old.toLowerCase();}))return;
          if(list.some(function(x){return String(x).toLowerCase()===nm.toLowerCase();}))return;
          writes.push(a.update(a.ref(a.db,'cfAccounts/'+id),{feedMethods:list.concat([nm])}));
        });
        return Promise.all(writes).then(function(){return save(pm);});
      }).catch(function(e){if(String((e&&e.code)||e).indexOf('cancelled')<0)alert('Rename failed: '+((e&&e.message)||e));});
    };});
    box.querySelectorAll('[data-pmalias]').forEach(function(c){c.onchange=function(){var i=+c.getAttribute('data-pmalias'),list=(c.value||'').split(',').map(function(x){return x.trim();}).filter(function(x){return x&&x.toLowerCase()!==String(pm[i].name||'').toLowerCase();}),taken=pm.filter(function(x,j){return j!==i;}).map(function(x){return String(x.name||'').toLowerCase();});if(list.some(function(x){return taken.indexOf(x.toLowerCase())>-1;})){alert('An old name cannot match another active payment method. Remove that method first, or use a different name.');return renderPayMethods();}pm[i].aliases=list;save(pm);};});
    box.querySelectorAll('[data-pmpolicy]').forEach(function(c){c.onchange=function(){pm[+c.getAttribute('data-pmpolicy')].verificationPolicy=c.value==='cashier_manager'?'cashier_manager':'manager_only';save(pm);};});
    box.querySelectorAll('[data-pmacct-add]').forEach(function(b){b.onclick=function(){var i=+b.getAttribute('data-pmacct-add'),select=box.querySelector('[data-pmacct-select="'+i+'"]'),id=select&&select.value;if(!id)return;var selected=configuredPaymentAccountIds(pm[i]);if(selected.indexOf(id)<0)selected.push(id);pm[i].accountIds=selected;save(pm);};});
    box.querySelectorAll('[data-pmacct-remove]').forEach(function(b){b.onclick=function(){var i=+b.getAttribute('data-pmacct-remove'),id=b.getAttribute('data-account'),remaining=configuredPaymentAccountIds(pm[i]).filter(function(x){return x!==id;});if(pm[i].active!==false&&!remaining.length){alert('An active non-cash payment method must keep at least one receiving account. Deactivate the payment method first if it should no longer be offered at checkout.');return;}pm[i].accountIds=remaining;save(pm);};});
    box.querySelectorAll('[data-pmdel]').forEach(function(b){b.onclick=function(){if(confirm('Remove this payment method?')){pm.splice(+b.getAttribute('data-pmdel'),1);save(pm);}};});
    var add=document.getElementById('pmAdd'),input=document.getElementById('pmNew'),status=document.getElementById('pmAddStatus');
    function addMethod(){var nm=(input.value||'').trim();status.textContent='';if(!nm){status.textContent='Enter a payment method name first.';input.focus();return;}if(pm.some(function(x){return String(x.name).toLowerCase()===nm.toLowerCase();})){status.textContent='That payment method already exists.';input.focus();input.select();return;}var next=pm.concat([{name:nm,active:true,cash:false,verificationPolicy:defaultVerificationPolicy(nm)}]);add.disabled=true;input.disabled=true;add.textContent='Saving…';status.textContent='Saving '+nm+'…';save(next).catch(function(e){add.disabled=false;input.disabled=false;add.textContent='+ add';status.textContent='Could not add the payment method: '+((e&&e.message)||e||'Please check your connection and access.');input.focus();});}
    if(add)add.onclick=addMethod;
    if(input)input.onkeydown=function(e){if(e.key==='Enter'){e.preventDefault();addMethod();}};
    var addAccount=document.getElementById('pmAddAccount');if(addAccount)addAccount.onclick=function(){if(!a.manageCashAccount){alert('Cash-account service is unavailable. Refresh the portal.');return;}F().run({title:'Add receiving account',subtitle:'Create a zero-opening bank or wallet for POS routing. Existing balances must be entered later through the controlled opening-balance correction in Finance Books.',submitLabel:'Create account',busyLabel:'Creating…',fields:[{name:'name',label:'Account name',required:true,maxLength:100,placeholder:'e.g. Kina Bank'},{name:'type',label:'Account type',type:'select',required:true,options:[{value:'bank',label:'Bank'},{value:'ewallet',label:'E-wallet'}]}]},function(v){var d={},parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());parts.forEach(function(p){d[p.type]=p.value;});return a.manageCashAccount({action:'upsert',commandId:'posacct_'+Date.now(),accountId:uid('acc_'),name:v.name,type:v.type,opening:0,openingDate:d.year+'-'+d.month+'-'+d.day,feedMethods:[]});}).then(function(){(window.accazaToast||function(){})('Receiving account created. Select it under the payment method.','ok');}).catch(function(e){if(String((e&&e.code)||e).indexOf('cancelled')<0&&String((e&&e.message)||e).indexOf('cancelled')<0)alert('Could not create receiving account: '+((e&&e.message)||e));});};
  });
}
