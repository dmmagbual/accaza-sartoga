
function renderPosSettings(){
  var root=document.getElementById('posSettingsRoot');if(!root)return;
  var html='';
  html+='<div class="az-sec">Staff &amp; PINs</div><div class="pz-card" style="margin-bottom:1rem;"><div style="display:grid;grid-template-columns:1.5fr 1fr 1fr auto;gap:0.5rem;align-items:end;">'
    +'<div><span class="pz-lbl">Name</span><input class="pz-in" id="stName" placeholder="e.g. Maria"/></div>'
    +'<div><span class="pz-lbl">4-digit PIN</span><input class="pz-in" id="stPin" inputmode="numeric" maxlength="6" placeholder="1234"/></div>'
    +'<div><span class="pz-lbl">Role</span><select class="pz-in" id="stRole"><option value="cashier">Cashier</option><option value="manager">Manager</option></select></div>'
    +'<button class="pz-btn" id="stAdd">Add</button></div>'
    +'<p class="az-note" style="margin:.6rem 0 0;">Each cashier must be linked once to their Firebase login. After linking, POS shifts and sales can only use that signed-in staff member.</p><table class="pz-tbl" style="margin-top:0.6rem;"><tbody>'+(staffArr().length?staffArr().map(function(s){return '<tr><td>'+esc(s.name)+'</td><td>'+esc(s.role||'cashier')+'</td><td style="color:var(--tl);">'+(s.accountUid?'Linked login':'Not linked')+'</td><td style="white-space:nowrap;"><button class="pz-btn sec" style="padding:0.2rem 0.5rem;" data-stlink="'+s.id+'">'+(s.accountUid?'Relink login / PIN':'Link login / PIN')+'</button> <button class="pz-btn warn" style="padding:0.2rem 0.5rem;" data-stdel="'+s.id+'">✕</button></td></tr>';}).join(''):'<tr><td class="az-note" style="padding:0.5rem;">No staff yet.</td></tr>')+'</tbody></table></div>';
  html+='<div class="az-sec">Settings</div><div class="pz-card" style="margin-bottom:1rem;"><label style="font-size:0.85rem;cursor:pointer;display:block;"><input type="checkbox" id="opsRound"/> Round cash totals to the nearest peso</label><label style="font-size:0.85rem;cursor:pointer;display:block;margin-top:0.5rem;"><input type="checkbox" id="opsDenom"/> Track cash by denomination at checkout (running drawer + per-denomination shift reconciliation)</label><label style="font-size:0.85rem;cursor:pointer;display:block;margin-top:0.5rem;"><input type="checkbox" id="opsTotalOnly"/> Reconcile on total only at close (still count denominations to reach the total, but skip the per-denomination variance)</label><div style="display:flex;align-items:center;gap:0.5rem;margin-top:0.6rem;"><span style="font-size:0.85rem;">Cash variance tolerance ₱</span><input class="pz-in" id="opsTolerance" type="number" step="any" style="width:90px;"/><span style="font-size:0.75rem;color:var(--tl);">a discrepancy is only logged when the total is off by more than this</span></div><div style="display:flex;align-items:center;gap:0.5rem;margin-top:0.6rem;"><span style="font-size:0.85rem;">Fixed cash float (imprest) ₱</span><input class="pz-in" id="opsFloat" type="number" step="any" placeholder="opening float" style="width:110px;"/><span style="font-size:0.75rem;color:var(--tl);">Optional. Blank = cashier keeps her opening float and remits the takings. Set a number for a fixed imprest float (0 = remit the whole drawer).</span></div></div>';
  html+='<div id="taxCardBox"></div>';
  html+='<div class="pz-card payment-methods-shell" style="margin-bottom:1rem;"><div id="payMethodsBox"></div></div>';
  html+='<div class="az-sec">Data backup &amp; off-site copy</div><div class="pz-card" style="margin-bottom:1rem;"><div style="font-size:0.85rem;color:var(--tm);margin-bottom:0.5rem;">Your data is backed up automatically every day. For extra safety, also keep a copy <b>off this computer</b> once a week &mdash; a USB stick, another drive, or your own cloud.</div><div id="bkStatus" style="font-size:0.85rem;margin:0.4rem 0 0.7rem;">&hellip;</div><button class="pz-btn" id="bkDownload">&#11015; Download a backup copy</button><div style="font-size:0.75rem;color:var(--tl);margin-top:0.5rem;">Saves a copy of your current books, sales and inventory data as a file. After it downloads, move it somewhere off this computer.</div></div>';
  root.innerHTML=html;
  var sa=document.getElementById('stAdd');if(sa)sa.onclick=addStaff;
  root.querySelectorAll('[data-stlink]').forEach(function(b){b.onclick=function(){linkStaffIdentity(b.getAttribute('data-stlink'));};});
  root.querySelectorAll('[data-stdel]').forEach(function(b){b.onclick=function(){if(confirm('Remove this staff?')){var a=A();a.remove(a.ref(a.db,'posStaff/'+b.getAttribute('data-stdel')));}};});
  var rc=document.getElementById('opsRound');if(rc){var a=A();a.get(a.ref(a.db,'posSettings/cashRounding')).then(function(s){rc.checked=!!s.val();});rc.onchange=function(){var a=A();a.update(a.ref(a.db,'posSettings'),{cashRounding:rc.checked});};}
  var dt=document.getElementById('opsDenom');if(dt){var a2=A();a2.get(a2.ref(a2.db,'posSettings')).then(function(s){var v=s.val()||{};dt.checked=!!v.denomTracking;});dt.onchange=function(){var a=A();a.update(a.ref(a.db,'posSettings'),{denomTracking:dt.checked});};}
  var to=document.getElementById('opsTotalOnly');if(to){var a3=A();a3.get(a3.ref(a3.db,'posSettings')).then(function(s){var v=s.val()||{};to.checked=!!v.reconcileTotalOnly;});to.onchange=function(){var a=A();a.update(a.ref(a.db,'posSettings'),{reconcileTotalOnly:to.checked});};}
  var tol=document.getElementById('opsTolerance');if(tol){var a4=A();a4.get(a4.ref(a4.db,'posSettings')).then(function(s){var v=s.val()||{};tol.value=((v.tolerances&&v.tolerances.cashPeso!=null)?v.tolerances.cashPeso:20);});tol.onchange=function(){var a=A();a.update(a.ref(a.db,'posSettings/tolerances'),{cashPeso:Number(tol.value)||0});};}
  var ff=document.getElementById('opsFloat');if(ff){var a5=A();a5.get(a5.ref(a5.db,'posSettings')).then(function(s){var v=s.val()||{};ff.value=(v.fixedFloat!=null?v.fixedFloat:'');});ff.onchange=function(){var a=A();var raw=String(ff.value).trim();a.update(a.ref(a.db,'posSettings'),{fixedFloat:raw===''?null:(Number(raw)||0)});};}
  var bk=document.getElementById('bkDownload');
  if(bk){var a6=A();a6.get(a6.ref(a6.db,'posSettings/offsiteBackup')).then(function(s){renderBackupStatus((s.val()||{}).lastAt);}).catch(function(){renderBackupStatus(0);});bk.onclick=exportDataBackup;}
  wireTaxCard();
  renderPayMethods();
}
function kpi(l,v){return '<div class="az-kpi"><div class="v">'+v+'</div><div class="l">'+esc(l)+'</div></div>';}

function renderBackupStatus(lastAt){
  var el=document.getElementById('bkStatus'); if(!el)return;
  var now=Date.now(), ms=Number(lastAt)||0, due=!ms||(now-ms)>=7*86400000, when=ms?new Date(ms).toLocaleDateString():'never';
  var days=ms?Math.floor((now-ms)/86400000):null;
  el.innerHTML = due
    ? '<span style="color:#c0392b;font-weight:600;">\u26A0 Off-site copy is due</span> <span style="color:var(--tl);">(last: '+esc(when)+')</span>'
    : '<span style="color:#1C6B54;font-weight:600;">\u2713 Up to date</span> <span style="color:var(--tl);">(last copy: '+esc(when)+(days!=null?', '+days+' day'+(days===1?'':'s')+' ago':'')+')</span>';
}
function exportDataBackup(){
  var btn=document.getElementById('bkDownload'); if(btn){btn.disabled=true;btn.textContent='Preparing\u2026';}
  var a=A();
  var nodes=['books','financialMovements','orders','archivedOrders','inventory','inventoryBalances','inventoryMovements','recipes','optionRecipes','purchaseInvoices','payables','receivables','platformPayouts','cashCustody','booksChart','chartOfAccounts','fixedAssets','personalFundings','expenses','monthlyExpenses','expenseCategories','expenseItems','shifts','posStaff','posSettings','channelPrices','inventorySku','inventoryBatch','stockReceipts','internalUsage','packages','menuItems','categories','optionGroups','reservations','appCustomers','discrepancies','pettyCashVouchers'];
  Promise.all(nodes.map(function(n){return a.get(a.ref(a.db,n)).then(function(s){return [n,s.val()];}).catch(function(){return [n,null];});})).then(function(pairs){
    var data={}, included=[];
    pairs.forEach(function(p){ if(p[1]!=null){ data[p[0]]=p[1]; included.push(p[0]); } });
    var excluded=nodes.filter(function(n){return included.indexOf(n)<0;}).sort();
    function _stable(v){ if(Array.isArray(v))return v.map(_stable); if(!v||typeof v!=='object')return v; return Object.keys(v).sort().reduce(function(o,k){o[k]=_stable(v[k]);return o;},{}); }
    return crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(_stable(data)))).then(function(buf){
      var hash=Array.prototype.map.call(new Uint8Array(buf),function(b){return ('0'+b.toString(16)).slice(-2);}).join('');
      var takenAt=Date.now();
      var envelope={version:'backup-v2',takenAt:takenAt,excluded:excluded,integrity:{algorithm:'sha256',canonical:'sorted-json-v1',dataSha256:hash},kind:'accaza-admin-data-export',note:'Off-site data copy from the Admin app, sealed with a SHA-256 integrity fingerprint (verify with tools/verify-backup.mjs). Keep it somewhere safe off this computer.',includedNodes:included,exportedAtISO:new Date(takenAt).toISOString(),data:data};
      var blob=new Blob([JSON.stringify(envelope)],{type:'application/json'}), url=URL.createObjectURL(blob);
      var stamp=new Date(takenAt).toISOString().slice(0,19).replace(/[:T]/g,'-');
      var lnk=document.createElement('a'); lnk.href=url; lnk.download='accaza-data-'+stamp+'.json'; document.body.appendChild(lnk); lnk.click(); document.body.removeChild(lnk);
      setTimeout(function(){URL.revokeObjectURL(url);},4000);
      a.update(a.ref(a.db,'posSettings/offsiteBackup'),{lastAt:takenAt,nodes:included.length}).catch(function(){});
      renderBackupStatus(takenAt);
      if(btn){btn.disabled=false;btn.textContent='\u2B07 Download a backup copy';}
      alert('Backup copy downloaded ('+included.length+' data sets, sealed). Now move that file somewhere off this computer \u2014 a USB stick, another drive, or your own cloud.');
    });
  }).catch(function(e){
    if(btn){btn.disabled=false;btn.textContent='\u2B07 Download a backup copy';}
    alert('Could not build the backup copy: '+((e&&e.message)||e));
  });
}
function addStaff(){var name=(document.getElementById('stName').value||'').trim();var pin=(document.getElementById('stPin').value||'').trim();var role=document.getElementById('stRole').value;if(!name||!pin){alert('Enter name and PIN.');return;}if(!/^[0-9]{4,6}$/.test(pin)){alert('PIN must be 4-6 digits.');return;}var a=A();a.set(a.ref(a.db,'posStaff/'+uid('st_')),{name:name,pin:pin,role:role,ts:Date.now()});document.getElementById('stName').value='';document.getElementById('stPin').value='';}
function linkStaffIdentity(id){var s=staffList[id];if(!s)return;F().run({title:'Link '+s.name+' to Firebase login',subtitle:'Enter the email used for this person’s Firebase sign-in and set their own POS PIN.',submitLabel:'Link staff login',busyLabel:'Linking…',fields:[{name:'email',label:'Firebase account email',type:'email',required:true,maxLength:320},{name:'pin',label:'New POS PIN (4–6 digits)',type:'password',required:true,maxLength:6,validate:function(v){return /^[0-9]{4,6}$/.test(v)?'':'Enter a 4–6 digit PIN.';}}]},function(v){return A().managePosStaffIdentity({staffId:id,email:v.email,pin:v.pin});}).then(function(){alert('Staff login linked. This person can now only open and use their own POS shift.');}).catch(function(e){if(String((e&&e.code)||e).indexOf('cancelled')<0)alert('Could not link staff login: '+((e&&e.message)||e));});}
function changeStaffPin(id){
  var s=staffList[id]; if(!s)return;
  var mask=document.createElement('div'); mask.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;';
  mask.innerHTML='<div style="background:#fff;border-radius:10px;max-width:380px;width:100%;padding:1.2rem;">'
    +'<div style="font-weight:700;color:var(--bd);margin-bottom:0.5rem;">Change PIN \u2014 '+esc(s.name)+'</div>'
    +'<div><span class="pz-lbl">Current PIN</span><input class="pz-in" id="cpCur" type="password" inputmode="numeric"/></div>'
    +'<div style="margin-top:0.5rem;"><span class="pz-lbl">New PIN (4–6 digits)</span><input class="pz-in" id="cpN1" type="password" inputmode="numeric"/></div>'
    +'<div style="margin-top:0.5rem;"><span class="pz-lbl">Confirm new PIN</span><input class="pz-in" id="cpN2" type="password" inputmode="numeric"/></div>'
    +'<div style="display:flex;gap:0.5rem;margin-top:1rem;"><button class="pz-btn ok" id="cpSubmit">Update PIN</button><button class="pz-btn sec" id="cpCancel">Cancel</button></div></div>';
  document.body.appendChild(mask);
  mask.querySelector('#cpCancel').onclick=function(){document.body.removeChild(mask);};
  mask.querySelector('#cpSubmit').onclick=function(){
    var cur=String(mask.querySelector('#cpCur').value||'').trim();
    if(cur!==String(s.pin)){alert('Current PIN is incorrect.');return;}
    var n1=String(mask.querySelector('#cpN1').value||'').trim();
    if(!/^[0-9]{4,6}$/.test(n1)){alert('New PIN must be 4–6 digits.');return;}
    var n2=String(mask.querySelector('#cpN2').value||'').trim();
    if(n1!==n2){alert('The two PINs do not match.');return;}
    if(Object.keys(staffList).some(function(k){return k!==id&&String(staffList[k].pin)===n1;})){alert('That PIN is already used by another staff \u2014 choose a different one.');return;}
    var a=A();a.update(a.ref(a.db,'posStaff/'+id),{pin:n1});
    if(window.__posLog)window.__posLog('pin-change',s.name,'');
    document.body.removeChild(mask);
    alert('PIN updated for '+s.name+'.');
  };
}

/* ══════════ BIR TAX CARD (VAT / Percentage tax) ══════════ */
/* Labels mirror the server-side canonical checklist in src/functions/20c-tax-settings.js —
   activation is blocked client-side with the same message, and the server re-checks every id. */
var TAX_REQ_META={
  cas_1905_filed:{label:'BIR Form 1905 filed to register this POS system with your RDO',help:'RR 7-2024: the POS itself must be registered before Accaza receipts can serve as official invoices.'},
  pos_reports_audit:{label:'This POS can produce sales and audit reports on demand',help:'BIR officers may require daily and periodic sales reports from the register at any time.'},
  pos_data_retention:{label:'Sales records and books are kept for at least 10 years',help:'BIR requires accounting records, including POS data, to be retained for 10 years.'},
  cor_2303:{label:'Certificate of Registration (BIR Form 2303) issued and displayed',help:'Your COR must show the tax type (VAT or Non-VAT) and be posted at the place of business.'},
  tin_branch:{label:'TIN and branch code obtained from BIR',help:'The 9-digit TIN (and 5-digit branch code, 00000 for head office) printed on every receipt.'},
  books_registered:{label:'Books of accounts registered with BIR',help:'Manual books must be stamped by the RDO; computerized books need BIR-accredited accounting.'},
  vat_invoices:{label:'VAT official invoices / receipts printed under BIR authority',help:'VAT-registered businesses must issue BIR-registered VAT invoices and receipts.'},
  nonvat_invoices:{label:'NON-VAT official receipts printed under BIR authority',help:'Non-VAT businesses must still issue BIR-registered receipts marked NON-VAT.'},
  sequential_numbering:{label:'Receipt numbering is sequential with no gaps',help:'BIR-registered invoices run in an unbroken series; skipped numbers are flagged in audits.'},
  form_2550q:{label:'Ready to file BIR Form 2550Q (quarterly VAT return)',help:'Quarterly VAT return, due the 25th day after each quarter ends.'},
  form_2551q:{label:'Ready to file BIR Form 2551Q (quarterly percentage tax)',help:'Quarterly percentage tax return, due the 25th day after each quarter ends.'}
};
var TAX_REQ_ORDER={
  vat:['cas_1905_filed','pos_reports_audit','pos_data_retention','cor_2303','tin_branch','books_registered','vat_invoices','sequential_numbering','form_2550q'],
  percentage:['cas_1905_filed','pos_reports_audit','pos_data_retention','cor_2303','tin_branch','books_registered','nonvat_invoices','sequential_numbering','form_2551q']
};
var TAX_INFO={
  vat:{title:'Value Added Tax (VAT)',rateLabel:'VAT rate (%)',defaultRate:12,desc:'Each receipt splits out the VAT portion, Finance Books credits net sales and books output VAT to account 2210, and the Senior/PWD 20% is computed on the VAT-exempt price. Choose below whether your prices already contain the VAT or VAT is added on top.'},
  percentage:{title:'Percentage Tax (Non-VAT)',rateLabel:'Percentage tax rate (%)',defaultRate:3,desc:'A flat percentage of gross sales booked to liability 2220 / expense 6086, and the Senior/PWD 20% stays on the full price. Choose below whether the tax sits inside your prices or is added on top.'}
};
var TAX_STRUCTURES={sole:'Sole Proprietorship',opc:'One Person Corporation',corporation:'Corporation'};
function wireTaxCard(){
  var box=document.getElementById('taxCardBox');if(!box)return;
  var canEdit=['owner','superadmin'].indexOf(String((window.__accazaAuthz||{}).role))>=0;
  var state={mode:'none',inclusive:null,ticks:{vat:{},percentage:{}},dateEdited:false};
  function draw(){
    var live=window.__taxSettings||{},mode=state.mode,info=TAX_INFO[mode];
    var liveMode=live.mode==='vat'||live.mode==='percentage'?live.mode:'none';
    var h='<div class="az-sec">BIR Tax &mdash; VAT / Percentage tax</div><div class="pz-card" style="margin-bottom:1rem;">';
    h+='<div style="display:flex;align-items:center;gap:0.6rem;flex-wrap:wrap;">'
      +'<span style="display:inline-block;padding:0.15rem 0.6rem;border-radius:99px;font-size:0.75rem;font-weight:700;'
      +(liveMode==='none'?'background:rgba(0,0,0,.08);color:var(--tm);':'background:rgba(28,107,84,.12);color:#1C6B54;')+'">'
      +(liveMode==='none'?'NO TAX ACTIVE':(liveMode==='vat'?'VAT ACTIVE':'PERCENTAGE TAX ACTIVE'))+'</span>';
    if(liveMode!=='none'){var lm=TAX_INFO[liveMode];h+='<span style="font-size:0.8rem;color:var(--tm);">'+esc(lm.title)+' at '+(liveMode==='vat'?(live.vatRate||12):(live.percentageRate||3))+'% '+(live.inclusive===false?'(tax added on top)':'(tax inside prices)')+' &middot; effective '+esc(new Date(Number(live.effectiveAt)||Date.now()).toLocaleDateString('en-PH'))+(live.tin?' &middot; TIN '+esc(live.tin):'')+'</span>';}
    else h+='<span style="font-size:0.8rem;color:var(--tm);">Receipts print without tax lines. Pick a category below when you are ready.</span>';
    h+='</div>';
    if(!canEdit){h+='<p class="az-note" style="margin:0.7rem 0 0;">Only the owner account can change tax settings.</p></div>';box.innerHTML=h;return;}
    h+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:0.6rem;margin-top:0.8rem;">';
    ['vat','percentage'].forEach(function(m){
      var mi=TAX_INFO[m],sel=(mode===m);
      h+='<button type="button" data-taxmode="'+m+'" style="text-align:left;padding:0.75rem 0.9rem;border-radius:10px;cursor:pointer;border:'+(sel?'2px solid #1C6B54;box-shadow:0 2px 8px rgba(28,107,84,.18);':'2px solid var(--cd);')+'background:'+(sel?'rgba(28,107,84,.06)':'transparent')+';font-family:inherit;">'
        +'<div style="font-weight:700;color:var(--bd);">'+esc(mi.title)+'</div>'
        +'<div style="font-size:0.75rem;color:var(--tl);margin-top:0.2rem;">'+(m==='vat'?'12% default, editable. Splits VAT out of your prices.':'3% default, editable. Carved from gross sales.')+(liveMode===m?' &middot; CURRENTLY ON':'')+'</div></button>';
    });
    h+='</div>';
    if(mode!=='none'){
      var rateVal=(live[mode==='vat'?'vatRate':'percentageRate']!=null?live[mode==='vat'?'vatRate':'percentageRate']:info.defaultRate);
      var done=TAX_REQ_ORDER[mode].filter(function(id){return !!state.ticks[mode][id];}).length;
      h+='<div style="border-top:1px solid var(--cd);margin-top:0.9rem;padding-top:0.8rem;">'
        +'<div style="font-weight:700;font-size:0.9rem;color:var(--bd);">BIR requirements ('+done+'/'+TAX_REQ_ORDER[mode].length+' confirmed)</div>'
        +'<p class="az-note" style="margin:0.3rem 0 0.2rem;">Tick each item only when it is truly done. Tax cannot be activated until every requirement is confirmed.</p>';
      TAX_REQ_ORDER[mode].forEach(function(id){
        var meta=TAX_REQ_META[id];
        h+='<label style="display:flex;gap:0.55rem;align-items:flex-start;cursor:pointer;font-size:0.85rem;margin-top:0.5rem;"><input type="checkbox" data-taxreq="'+id+'"'+(state.ticks[mode][id]?' checked':'')+' style="margin-top:0.2rem;"/>'
          +'<span><b>'+esc(meta.label)+'</b><br><span style="font-size:0.75rem;color:var(--tl);">'+esc(meta.help)+'</span></span></label>';
      });
      var inc=state.inclusive!=null?state.inclusive:(live.inclusive!==false);
      function taxPill(v,sel,title,sub){return '<button type="button" data-taxinc="'+v+'" style="text-align:left;padding:0.6rem 0.9rem;border-radius:10px;cursor:pointer;border:'+(sel?'2px solid #1C6B54;box-shadow:0 2px 8px rgba(28,107,84,.18);':'2px solid var(--cd);')+'background:'+(sel?'rgba(28,107,84,.06)':'transparent')+';font-family:inherit;"><div style="font-weight:700;color:var(--bd);">'+title+'</div><div style="font-size:0.75rem;color:var(--tl);margin-top:0.2rem;">'+sub+'</div></button>';}
      h+='<div style="margin-top:0.9rem;"><span class="pz-lbl">Price display &mdash; is the tax inside your prices or added on top?</span><div style="display:grid;grid-template-columns:1fr 1fr;gap:0.6rem;margin-top:0.35rem;">'
        +taxPill('inclusive',inc,'Tax inside prices (inclusive)','Your listed prices already contain the tax. Customers pay exactly the shelf price.')
        +taxPill('exclusive',!inc,'Tax added on top (exclusive)','Listed prices exclude the tax. POS and the online ordering site add it on top at checkout, so customers pay more than the shelf price.')
        +'</div></div>';
      h+='<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.5rem;align-items:end;margin-top:0.9rem;">'
        +'<div><span class="pz-lbl">'+esc(info.rateLabel)+'</span><input class="pz-in" id="taxRate" type="number" step="0.01" min="0.01" max="100" value="'+rateVal+'"/></div>'
        +'<div><span class="pz-lbl">Effective date</span><input class="pz-in" id="taxEffective" type="date" min="'+window.AccazaDate.key()+'" value="'+(liveMode==='none'?window.AccazaDate.key():window.AccazaDate.key(live.effectiveAt))+'"/></div>'
        +'<div style="font-size:0.75rem;color:var(--tl);padding-bottom:0.35rem;">Sales completed before this date keep their original treatment.</div></div>';
      h+='<div style="background:rgba(28,107,84,.06);border:1px solid rgba(28,107,84,.25);border-radius:10px;padding:0.75rem 0.9rem;margin-top:0.9rem;font-size:0.8rem;color:var(--tm);">'
        +'<b style="color:var(--bd);">'+esc(info.title)+'</b> &mdash; '+esc(info.desc)
        +'<br><b style="color:var(--bd);">When to file:</b> BIR Form '+(mode==='vat'?'2550Q':'2551Q')+' quarterly &mdash; due 25 April, 25 July, 25 October, 25 January through eBIRForms or eFPS.'
        +'<br><b style="color:var(--bd);">Penalties:</b> late filing means a 25% surcharge on the tax due, 12% annual interest, plus compromise penalties.'
        +'<br><b style="color:var(--bd);">Forms and guides:</b> <a href="https://www.bir.gov.ph" target="_blank" rel="noopener">www.bir.gov.ph</a></div>';
    }
    var liveTin=(live.tin||''),liveBranch=(live.branchCode!=null?live.branchCode:'00000'),liveStruct=(live.structure&&TAX_STRUCTURES[live.structure]?live.structure:'sole');
    h+='<div style="display:grid;grid-template-columns:1.1fr 0.7fr 1.2fr;gap:0.5rem;align-items:end;margin-top:0.9rem;border-top:1px solid var(--cd);padding-top:0.8rem;">'
      +'<div><span class="pz-lbl">BIR TIN</span><input class="pz-in" id="taxTin" placeholder="123-456-789" value="'+esc(liveTin)+'"/></div>'
      +'<div><span class="pz-lbl">Branch code</span><input class="pz-in" id="taxBranch" placeholder="00000" value="'+esc(liveBranch)+'"/></div>'
      +'<div><span class="pz-lbl">Business structure</span><select class="pz-in" id="taxStructure">'
      +Object.keys(TAX_STRUCTURES).map(function(k){return '<option value="'+k+'"'+(k===liveStruct?' selected':'')+'>'+TAX_STRUCTURES[k]+'</option>';}).join('')
      +'</select></div></div>'
      +'<p class="az-note" style="margin:0.5rem 0 0;">Structure is stored for the annual return: sole proprietorship files Form 1701, OPC/corporation files Form 1702 (both due 15 April).</p>';
    h+='<div style="display:flex;gap:0.6rem;align-items:center;margin-top:0.9rem;">'
      +(mode!=='none'?'<button class="pz-btn ok" id="taxSave" style="padding:0.55rem 1.3rem;">'+(liveMode===mode?'Save changes':'Activate '+esc(info.title))+'</button>':'')
      +(liveMode!=='none'?'<button class="pz-btn sec" id="taxOff" style="padding:0.55rem 1rem;">Turn tax OFF</button>':'')
      +'<span id="taxStatus" style="font-size:0.8rem;color:var(--tl);"></span></div></div>';
    box.innerHTML=h;
    box.querySelectorAll('[data-taxmode]').forEach(function(b){b.onclick=function(){state.mode=(state.mode===b.getAttribute('data-taxmode'))?'none':b.getAttribute('data-taxmode');draw();};});
    box.querySelectorAll('[data-taxreq]').forEach(function(c){c.onchange=function(){state.ticks[state.mode][c.getAttribute('data-taxreq')]=c.checked;if(!c.checked)delete state.ticks[state.mode][c.getAttribute('data-taxreq')];draw();};});
    box.querySelectorAll('[data-taxinc]').forEach(function(b){b.onclick=function(){state.inclusive=(b.getAttribute('data-taxinc')==='inclusive');draw();};});
    var eff=document.getElementById('taxEffective');if(eff)eff.onchange=function(){state.dateEdited=true;};
    var off=document.getElementById('taxOff');if(off)off.onclick=function(){
      if(!confirm('Turn OFF tax? New sales will print without tax lines and post without tax. Completed sales keep their original treatment.'))return;
      var a=A();if(!a||!a.callables||!a.callables.setTaxSettings){alert('Tax service unavailable. Refresh and try again.');return;}
      a.callables.setTaxSettings({mode:'none'}).then(function(){if(window.accazaToast)window.accazaToast('Tax turned off. New sales print without tax.','ok');}).catch(function(e){alert('Could not turn tax off: '+((e&&e.message)||e));});
    };
    var save=document.getElementById('taxSave');if(save)save.onclick=function(){saveTaxSettings(state);};
  }
  var a=A();
  if(a&&a.get){a.get(a.ref(a.db,'taxSettings')).then(function(s){if(s.val())window.__taxSettings=s.val();draw();}).catch(function(){});}
  draw();
}
function saveTaxSettings(state){
  var live=window.__taxSettings||{},mode=state.mode;
  if(mode!=='vat'&&mode!=='percentage')return;
  var missing=TAX_REQ_ORDER[mode].filter(function(id){return !state.ticks[mode][id];});
  if(missing.length){alert('Complete first the BIR requirement before tax is activated.\n\nStill to confirm:\n- '+missing.map(function(id){return TAX_REQ_META[id].label;}).join('\n- '));return;}
  var tin=(document.getElementById('taxTin').value||'').trim();
  var branch=(document.getElementById('taxBranch').value||'').trim()||'00000';
  var structure=(document.getElementById('taxStructure')||{}).value||'sole';
  var inc=state.inclusive!=null?state.inclusive:((window.__taxSettings||{}).inclusive!==false);
  if(inc===false&&(window.__taxSettings||{}).inclusive!==false){
    if(!confirm('Tax-EXCLUSIVE pricing: POS and the online ordering site will ADD the tax on top of your listed prices, so customers pay more than the shelf price.\n\nContinue with tax added on top?'))return;
  }
  var payload={mode:mode,inclusive:inc,structure:structure,branchCode:branch,requirements:state.ticks};
  if(tin)payload.tin=tin;
  var rateEl=document.getElementById('taxRate');
  if(rateEl&&rateEl.value!==''){var rate=Number(rateEl.value);if(!(rate>0&&rate<=100)){alert('Enter a rate between 0.01 and 100.');return;}payload[mode==='vat'?'vatRate':'percentageRate']=rate;}
  var effEl=document.getElementById('taxEffective');
  if(effEl&&effEl.value&&state.dateEdited){var when=Date.parse(effEl.value+'T00:00:00+08:00');if(!Number.isFinite(when)||when<Date.now()-86400000){alert('Effective date must be today or later.');return;}payload.effectiveAt=when;}
  var btn=document.getElementById('taxSave'),status=document.getElementById('taxStatus');
  if(btn)btn.disabled=true;if(status)status.textContent='Saving…';
  var a=A();
  if(!a||!a.callables||!a.callables.setTaxSettings){if(btn)btn.disabled=false;alert('Tax service unavailable. Refresh and try again.');return;}
  a.callables.setTaxSettings(payload).then(function(resp){
    var tax=(resp&&resp.data&&resp.data.tax)||null;if(tax)window.__taxSettings=tax;
    if(window.accazaToast)window.accazaToast('Tax settings saved.','ok');
    wireTaxCard();
  }).catch(function(e){
    if(btn)btn.disabled=false;if(status)status.textContent='';
    alert(((e&&e.message)||e)+'\n\nTax settings were NOT changed.');
  });
}
