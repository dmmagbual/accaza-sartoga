
function renderPosSettings(){
  var root=document.getElementById('posSettingsRoot');if(!root)return;
  var html='';
  html+='<div class="az-sec">Staff &amp; PINs</div><div class="pz-card" style="margin-bottom:1rem;"><div style="display:grid;grid-template-columns:1.5fr 1fr 1fr auto;gap:0.5rem;align-items:end;">'
    +'<div><span class="pz-lbl">Name</span><input class="pz-in" id="stName" placeholder="e.g. Maria"/></div>'
    +'<div><span class="pz-lbl">4-digit PIN</span><input class="pz-in" id="stPin" inputmode="numeric" maxlength="6" placeholder="1234"/></div>'
    +'<div><span class="pz-lbl">Role</span><select class="pz-in" id="stRole"><option value="cashier">Cashier</option><option value="manager">Manager</option></select></div>'
    +'<button class="pz-btn" id="stAdd">Add</button></div>'
    +'<table class="pz-tbl" style="margin-top:0.6rem;"><tbody>'+(staffArr().length?staffArr().map(function(s){return '<tr><td>'+esc(s.name)+'</td><td>'+esc(s.role||'cashier')+'</td><td style="color:var(--tl);">PIN ••••</td><td style="white-space:nowrap;"><button class="pz-btn sec" style="padding:0.2rem 0.5rem;" data-stpin="'+s.id+'">Change PIN</button> <button class="pz-btn warn" style="padding:0.2rem 0.5rem;" data-stdel="'+s.id+'">✕</button></td></tr>';}).join(''):'<tr><td class="az-note" style="padding:0.5rem;">No staff yet.</td></tr>')+'</tbody></table></div>';
  html+='<div class="az-sec">Settings</div><div class="pz-card" style="margin-bottom:1rem;"><label style="font-size:0.85rem;cursor:pointer;display:block;"><input type="checkbox" id="opsRound"/> Round cash totals to the nearest peso</label><label style="font-size:0.85rem;cursor:pointer;display:block;margin-top:0.5rem;"><input type="checkbox" id="opsDenom"/> Track cash by denomination at checkout (running drawer + per-denomination shift reconciliation)</label><label style="font-size:0.85rem;cursor:pointer;display:block;margin-top:0.5rem;"><input type="checkbox" id="opsTotalOnly"/> Reconcile on total only at close (still count denominations to reach the total, but skip the per-denomination variance)</label><div style="display:flex;align-items:center;gap:0.5rem;margin-top:0.6rem;"><span style="font-size:0.85rem;">Cash variance tolerance ₱</span><input class="pz-in" id="opsTolerance" type="number" step="any" style="width:90px;"/><span style="font-size:0.75rem;color:var(--tl);">a discrepancy is only logged when the total is off by more than this</span></div><div style="display:flex;align-items:center;gap:0.5rem;margin-top:0.6rem;"><span style="font-size:0.85rem;">Fixed cash float (imprest) ₱</span><input class="pz-in" id="opsFloat" type="number" step="any" placeholder="opening float" style="width:110px;"/><span style="font-size:0.75rem;color:var(--tl);">Optional. Blank = cashier keeps her opening float and remits the takings. Set a number for a fixed imprest float (0 = remit the whole drawer).</span></div></div>';
  html+='<div class="pz-card" style="margin-bottom:1rem;"><div style="font-weight:600;color:var(--bd);margin-bottom:0.5rem;">💳 Payment methods</div><div id="payMethodsBox"></div></div>';
  html+='<div class="az-sec">Data backup &amp; off-site copy</div><div class="pz-card" style="margin-bottom:1rem;"><div style="font-size:0.85rem;color:var(--tm);margin-bottom:0.5rem;">Your data is backed up automatically every day. For extra safety, also keep a copy <b>off this computer</b> once a week &mdash; a USB stick, another drive, or your own cloud.</div><div id="bkStatus" style="font-size:0.85rem;margin:0.4rem 0 0.7rem;">&hellip;</div><button class="pz-btn" id="bkDownload">&#11015; Download a backup copy</button><div style="font-size:0.75rem;color:var(--tl);margin-top:0.5rem;">Saves a copy of your current books, sales and inventory data as a file. After it downloads, move it somewhere off this computer.</div></div>';
  root.innerHTML=html;
  var sa=document.getElementById('stAdd');if(sa)sa.onclick=addStaff;
  root.querySelectorAll('[data-stpin]').forEach(function(b){b.onclick=function(){changeStaffPin(b.getAttribute('data-stpin'));};});
  root.querySelectorAll('[data-stdel]').forEach(function(b){b.onclick=function(){if(confirm('Remove this staff?')){var a=A();a.remove(a.ref(a.db,'posStaff/'+b.getAttribute('data-stdel')));}};});
  var rc=document.getElementById('opsRound');if(rc){var a=A();a.get(a.ref(a.db,'posSettings')).then(function(s){var v=s.val()||{};rc.checked=!!v.cashRounding;});rc.onchange=function(){var a=A();a.update(a.ref(a.db,'posSettings'),{cashRounding:rc.checked});};}
  var dt=document.getElementById('opsDenom');if(dt){var a2=A();a2.get(a2.ref(a2.db,'posSettings')).then(function(s){var v=s.val()||{};dt.checked=!!v.denomTracking;});dt.onchange=function(){var a=A();a.update(a.ref(a.db,'posSettings'),{denomTracking:dt.checked});};}
  var to=document.getElementById('opsTotalOnly');if(to){var a3=A();a3.get(a3.ref(a3.db,'posSettings')).then(function(s){var v=s.val()||{};to.checked=!!v.reconcileTotalOnly;});to.onchange=function(){var a=A();a.update(a.ref(a.db,'posSettings'),{reconcileTotalOnly:to.checked});};}
  var tol=document.getElementById('opsTolerance');if(tol){var a4=A();a4.get(a4.ref(a4.db,'posSettings')).then(function(s){var v=s.val()||{};tol.value=((v.tolerances&&v.tolerances.cashPeso!=null)?v.tolerances.cashPeso:20);});tol.onchange=function(){var a=A();a.update(a.ref(a.db,'posSettings/tolerances'),{cashPeso:Number(tol.value)||0});};}
  var ff=document.getElementById('opsFloat');if(ff){var a5=A();a5.get(a5.ref(a5.db,'posSettings')).then(function(s){var v=s.val()||{};ff.value=(v.fixedFloat!=null?v.fixedFloat:'');});ff.onchange=function(){var a=A();var raw=String(ff.value).trim();a.update(a.ref(a.db,'posSettings'),{fixedFloat:raw===''?null:(Number(raw)||0)});};}
  var bk=document.getElementById('bkDownload');
  if(bk){var a6=A();a6.get(a6.ref(a6.db,'posSettings/offsiteBackup')).then(function(s){renderBackupStatus((s.val()||{}).lastAt);}).catch(function(){renderBackupStatus(0);});bk.onclick=exportDataBackup;}
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
