
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
  root.innerHTML=html;
  var sa=document.getElementById('stAdd');if(sa)sa.onclick=addStaff;
  root.querySelectorAll('[data-stpin]').forEach(function(b){b.onclick=function(){changeStaffPin(b.getAttribute('data-stpin'));};});
  root.querySelectorAll('[data-stdel]').forEach(function(b){b.onclick=function(){if(confirm('Remove this staff?')){var a=A();a.remove(a.ref(a.db,'posStaff/'+b.getAttribute('data-stdel')));}};});
  var rc=document.getElementById('opsRound');if(rc){var a=A();a.get(a.ref(a.db,'posSettings')).then(function(s){var v=s.val()||{};rc.checked=!!v.cashRounding;});rc.onchange=function(){var a=A();a.update(a.ref(a.db,'posSettings'),{cashRounding:rc.checked});};}
  var dt=document.getElementById('opsDenom');if(dt){var a2=A();a2.get(a2.ref(a2.db,'posSettings')).then(function(s){var v=s.val()||{};dt.checked=!!v.denomTracking;});dt.onchange=function(){var a=A();a.update(a.ref(a.db,'posSettings'),{denomTracking:dt.checked});};}
  var to=document.getElementById('opsTotalOnly');if(to){var a3=A();a3.get(a3.ref(a3.db,'posSettings')).then(function(s){var v=s.val()||{};to.checked=!!v.reconcileTotalOnly;});to.onchange=function(){var a=A();a.update(a.ref(a.db,'posSettings'),{reconcileTotalOnly:to.checked});};}
  var tol=document.getElementById('opsTolerance');if(tol){var a4=A();a4.get(a4.ref(a4.db,'posSettings')).then(function(s){var v=s.val()||{};tol.value=((v.tolerances&&v.tolerances.cashPeso!=null)?v.tolerances.cashPeso:20);});tol.onchange=function(){var a=A();a.update(a.ref(a.db,'posSettings/tolerances'),{cashPeso:Number(tol.value)||0});};}
  var ff=document.getElementById('opsFloat');if(ff){var a5=A();a5.get(a5.ref(a5.db,'posSettings')).then(function(s){var v=s.val()||{};ff.value=(v.fixedFloat!=null?v.fixedFloat:'');});ff.onchange=function(){var a=A();var raw=String(ff.value).trim();a.update(a.ref(a.db,'posSettings'),{fixedFloat:raw===''?null:(Number(raw)||0)});};}
  renderPayMethods();
}
function kpi(l,v){return '<div class="az-kpi"><div class="v">'+v+'</div><div class="l">'+esc(l)+'</div></div>';}

function addStaff(){var name=(document.getElementById('stName').value||'').trim();var pin=(document.getElementById('stPin').value||'').trim();var role=document.getElementById('stRole').value;if(!name||!pin){alert('Enter name and PIN.');return;}if(!/^[0-9]{4,6}$/.test(pin)){alert('PIN must be 4-6 digits.');return;}var a=A();a.set(a.ref(a.db,'posStaff/'+uid('st_')),{name:name,pin:pin,role:role,ts:Date.now()});document.getElementById('stName').value='';document.getElementById('stPin').value='';}
function changeStaffPin(id){
  var s=staffList[id]; if(!s)return;
  var mask=document.createElement('div'); mask.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;';
  mask.innerHTML='<div style="background:#fff;border-radius:10px;max-width:380px;width:100%;padding:1.2rem;">'
    +'<div style="font-weight:700;color:var(--bd);margin-bottom:0.5rem;">Change PIN — '+esc(s.name)+'</div>'
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
    if(Object.keys(staffList).some(function(k){return k!==id&&String(staffList[k].pin)===n1;})){alert('That PIN is already used by another staff — choose a different one.');return;}
    var a=A();a.update(a.ref(a.db,'posStaff/'+id),{pin:n1});
    if(window.__posLog)window.__posLog('pin-change',s.name,'');
    document.body.removeChild(mask);
    alert('PIN updated for '+s.name+'.');
  };
}
