(function(){
'use strict';
var pkgMap={};
function A(){return window.__accaza;}
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
function peso(n){n=Number(n)||0;return '₱'+n.toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});}
function uid(p){return p+Date.now().toString(36)+Math.random().toString(36).slice(2,5);}
function isTab(n){var el=document.getElementById('tab-'+n);return el&&el.style.display!=='none';}
function cats(){return A().getCats?A().getCats():[];}
function catLabel(id){return A().getCatLabel?A().getCatLabel(id):id;}
function menuItems(){return A().getMenuItems?A().getMenuItems():[];}
function eligibleItems(catId){return menuItems().filter(function(it){return it.cat===catId;});}
function pkgEligible(pk){var out={};menuItems().forEach(function(it){if(pk.eligibleCat&&it.cat===pk.eligibleCat)out[it.key]=it;if((pk.eligibleItems||[]).indexOf(it.key)>-1)out[it.key]=it;});return Object.keys(out).map(function(k){return out[k];});}
function hasSizes(it){return it.priceM&&it.priceL;}
function itemPrice(it,size){if(size==='L'&&it.priceL)return Number(it.priceL)||0;if(size==='M'&&it.priceM)return Number(it.priceM)||0;if(size==='S')return Number(it.priceS)||0;return Number(it.priceM||it.priceS)||0;}

var tries=0,iv=setInterval(function(){if(window.__accaza){clearInterval(iv);init();}else if(++tries>150)clearInterval(iv);},100);
function init(){var a=A();a.subscribe('packages',function(s){pkgMap=s.val()||{};if(isTab('packages'))renderPackages();});ensurePickerModal();}
window.__accazaRegisterModule('packages',function(name){ if(name==='packages')renderPackages(); });

/* ---------- management ---------- */
var editingId=null;
function renderPackages(){
  var root=document.getElementById('packagesRoot');if(!root)return;
  var list=Object.keys(pkgMap).map(function(k){return Object.assign({id:k},pkgMap[k]);}).sort(function(a,b){return(a.name||'').localeCompare(b.name||'');});
  var catOpts='<option value="">— none (use specific items) —</option>'+cats().map(function(c){return '<option value="'+esc(c.id)+'">'+esc((c.icon||'')+' '+c.label)+'</option>';}).join('');
  var itemChecks=menuItems().slice().sort(function(a,b){return (a.cat||'').localeCompare(b.cat||'')||(a.name||'').localeCompare(b.name||'');}).map(function(it){return '<label style="display:inline-flex;align-items:center;gap:0.3rem;font-size:0.78rem;background:var(--cr);border:1px solid var(--cd);border-radius:6px;padding:0.2rem 0.45rem;cursor:pointer;"><input type="checkbox" data-pkgitem="'+esc(it.key)+'"/> '+esc(it.name)+'</label>';}).join(' ');
  var html='<div class="pz-h">🎁 Packages &amp; Promos</div><p class="pz-sub">Define event packages and promos. At the register, tap <b>Add Package / Promo</b>, pick the customer\'s items from the eligible category, and the system prices each item, applies the deal, and costs it from recipes. Revenue lands in the Events/Promo stream.</p>';
  html+='<div class="pz-card" style="margin-bottom:1rem;"><div style="font-weight:600;color:var(--bd);margin-bottom:0.6rem;">'+(editingId?'✏️ Edit':'➕ Add')+' package / promo</div>'
    +'<div style="display:grid;grid-template-columns:1.4fr 1fr 1.3fr;gap:0.6rem;">'
    +'<div><span class="pz-lbl">Name</span><input class="pz-in" id="pkName" placeholder="e.g. Event Package A"/></div>'
    +'<div><span class="pz-lbl">Type</span><select class="pz-in" id="pkType"><option value="package">Package (fixed set)</option><option value="promo">Promo (buy X + free)</option></select></div>'
    +'<div><span class="pz-lbl">Eligible category</span><select class="pz-in" id="pkCat">'+catOpts+'</select></div>'
    +'</div>'
    +'<div style="margin-top:0.6rem;"><span class="pz-lbl">Or pick specific items (optional — combined with the category)</span><div class="pkg-recipe-list">'+(itemChecks||'<span class="az-note">No menu items yet.</span>')+'</div></div>'
    +'<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr 1fr;gap:0.6rem;margin-top:0.6rem;">'
    +'<div><span class="pz-lbl" id="pkQtyLbl">Items (qty)</span><input class="pz-in" id="pkQty" type="number" min="1" value="10"/></div>'
    +'<div><span class="pz-lbl">Free items <span id="pkFreeHint" style="color:var(--tl);">(promo)</span></span><input class="pz-in" id="pkFree" type="number" min="0" value="0"/></div>'
    +'<div><span class="pz-lbl">Discount</span><select class="pz-in" id="pkDiscT"><option value="none">None</option><option value="fixed">₱ off</option><option value="percent">% off</option></select></div>'
    +'<div><span class="pz-lbl">Discount value</span><input class="pz-in" id="pkDiscV" type="number" step="any" value="0"/></div>'
    +'<div><span class="pz-lbl">Extra flat cost ₱</span><input class="pz-in" id="pkExtra" type="number" step="any" value="0"/></div>'
    +'</div>'
    +'<div style="margin-top:0.7rem;display:flex;gap:0.5rem;"><button class="pz-btn ok" id="pkSave">'+(editingId?'Save changes':'Add')+'</button>'+(editingId?'<button class="pz-btn sec" id="pkCancel">Cancel</button>':'')+'</div>'
    +'</div>';
  html+='<div class="pz-card"><table class="pz-tbl"><thead><tr><th>Name</th><th>Type</th><th>Eligible</th><th>Deal</th><th>Extra cost</th><th></th></tr></thead><tbody>'
    +(list.length?list.map(function(pk){
        var deal=pk.type==='promo'?('Buy '+pk.qty+' + '+(pk.freeQty||0)+' free'):(pk.qty+' items'+(pk.discType==='fixed'?' · ₱'+pk.discValue+' off':pk.discType==='percent'?' · '+pk.discValue+'% off':''));
        return '<tr><td>'+esc(pk.name)+'</td><td>'+esc(pk.type)+'</td><td>'+esc((pk.eligibleCat?catLabel(pk.eligibleCat):'')+((pk.eligibleItems&&pk.eligibleItems.length)?((pk.eligibleCat?' + ':'')+pk.eligibleItems.length+' item(s)'):''))+'</td><td>'+esc(deal)+'</td><td>'+(pk.extraCost?peso(pk.extraCost):'—')+'</td><td style="white-space:nowrap;"><button class="pz-btn sec" style="padding:0.2rem 0.5rem;" data-pkedit="'+pk.id+'">Edit</button> <button class="pz-btn warn" style="padding:0.2rem 0.5rem;" data-pkdel="'+pk.id+'">✕</button></td></tr>';
      }).join(''):'<tr><td colspan="6" class="az-note" style="padding:0.8rem;">No packages yet. Add one above.</td></tr>')
    +'</tbody></table></div>';
  root.innerHTML=html;
  if(editingId&&pkgMap[editingId]){var e=pkgMap[editingId];document.getElementById('pkName').value=e.name||'';document.getElementById('pkType').value=e.type||'package';document.getElementById('pkCat').value=e.eligibleCat||'';document.getElementById('pkQty').value=e.qty||10;document.getElementById('pkFree').value=e.freeQty||0;document.getElementById('pkDiscT').value=e.discType||'none';document.getElementById('pkDiscV').value=e.discValue||0;document.getElementById('pkExtra').value=e.extraCost||0;(e.eligibleItems||[]).forEach(function(k){var cb=document.querySelector('[data-pkgitem="'+k+'"]');if(cb)cb.checked=true;});}
  document.getElementById('pkSave').onclick=savePkg;
  var cc=document.getElementById('pkCancel');if(cc)cc.onclick=function(){editingId=null;renderPackages();};
  root.querySelectorAll('[data-pkedit]').forEach(function(b){b.onclick=function(){editingId=b.getAttribute('data-pkedit');renderPackages();};});
  root.querySelectorAll('[data-pkdel]').forEach(function(b){b.onclick=function(){if(confirm('Delete this package/promo?')){var a=A();a.remove(a.ref(a.db,'packages/'+b.getAttribute('data-pkdel')));}};});
}
function savePkg(){
  var name=(document.getElementById('pkName').value||'').trim();if(!name){alert('Enter a name.');return;}
  var _ei=[];document.querySelectorAll('[data-pkgitem]:checked').forEach(function(c){_ei.push(c.getAttribute('data-pkgitem'));});
  var obj={name:name,type:document.getElementById('pkType').value,eligibleCat:document.getElementById('pkCat').value,eligibleItems:_ei,qty:Math.max(1,parseInt(document.getElementById('pkQty').value)||1),freeQty:Math.max(0,parseInt(document.getElementById('pkFree').value)||0),discType:document.getElementById('pkDiscT').value,discValue:Number(document.getElementById('pkDiscV').value)||0,extraCost:Number(document.getElementById('pkExtra').value)||0,ts:Date.now()};
  if(!obj.eligibleCat&&!_ei.length){alert('Pick a category or at least one specific item.');return;}
  var a=A();a.set(a.ref(a.db,'packages/'+(editingId||uid('pkg_'))),obj).then(function(){editingId=null;renderPackages();});
}

/* ---------- sell-time picker ---------- */
var pickState=null;
function ensurePickerModal(){
  if(document.getElementById('pkgMask'))return;
  var m=document.createElement('div');m.className='pz-mask';m.id='pkgMask';
  m.innerHTML='<div class="pz-modal" style="max-width:520px;"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;"><div class="pz-h" id="pkgTitle" style="margin:0;">Package</div><button class="pz-btn sec" id="pkgClose" style="padding:0.2rem 0.6rem;">✕</button></div><div id="pkgBody"></div></div>';
  document.body.appendChild(m);
  document.getElementById('pkgClose').onclick=function(){m.classList.remove('show');};
  m.onclick=function(e){if(e.target===m)m.classList.remove('show');};
}
window.__openPackagePicker=function(){
  ensurePickerModal();
  var active=Object.keys(pkgMap).map(function(k){return Object.assign({id:k},pkgMap[k]);});
  var body=document.getElementById('pkgBody');
  document.getElementById('pkgTitle').textContent='Choose a package / promo';
  if(!active.length){body.innerHTML='<p class="az-note">No packages set up yet. Add them in the Packages tab.</p>';document.getElementById('pkgMask').classList.add('show');return;}
  body.innerHTML=active.map(function(pk){var deal=pk.type==='promo'?('Buy '+pk.qty+' + '+(pk.freeQty||0)+' free'):(pk.qty+' items'+(pk.discType==='fixed'?' · ₱'+pk.discValue+' off':pk.discType==='percent'?' · '+pk.discValue+'% off':''));return '<button class="pz-item" style="width:100%;margin-bottom:0.5rem;" data-pk="'+esc(pk.id)+'"><div class="n">'+esc(pk.name)+'</div><div class="p">'+esc(deal)+' · from '+esc(catLabel(pk.eligibleCat))+'</div></button>';}).join('');
  body.querySelectorAll('[data-pk]').forEach(function(b){b.onclick=function(){openPicker(b.getAttribute('data-pk'));};});
  document.getElementById('pkgMask').classList.add('show');
};
function openPicker(pkId){
  var pk=pkgMap[pkId];if(!pk)return;
  var items=pkgEligible(pk);
  var anySize=items.some(hasSizes);
  pickState={pk:Object.assign({id:pkId},pk),size:anySize?'M':'S',paid:{},free:{}};
  drawPicker();
}
function drawPicker(){
  var pk=pickState.pk;var items=pkgEligible(pk);var anySize=items.some(hasSizes);
  document.getElementById('pkgTitle').textContent=pk.name;
  var isPromo=pk.type==='promo';
  function counts(m){return Object.keys(m).reduce(function(s,k){return s+(m[k]||0);},0);}
  var paidN=counts(pickState.paid),freeN=counts(pickState.free);
  function rows(mapName,target){
    return items.map(function(it){
      var q=pickState[mapName][it.key]||0;var pr=itemPrice(it,pickState.size);
      return '<div style="display:flex;align-items:center;gap:0.5rem;padding:0.3rem 0;border-bottom:1px solid var(--cd);font-size:0.83rem;"><span style="flex:1;">'+esc(it.name)+' <span style="color:var(--tl);">'+peso(pr)+'</span></span>'
        +'<button class="pz-btn sec" style="padding:0.1rem 0.5rem;" data-dec="'+mapName+'|'+esc(it.key)+'">−</button><span style="min-width:20px;text-align:center;">'+q+'</span><button class="pz-btn sec" style="padding:0.1rem 0.5rem;" data-inc="'+mapName+'|'+esc(it.key)+'">+</button></div>';
    }).join('');
  }
  var gross=0;Object.keys(pickState.paid).forEach(function(k){var it=A().menuItemsMap[k];if(it)gross+=itemPrice(it,pickState.size)*pickState.paid[k];});
  var freeVal=0;Object.keys(pickState.free).forEach(function(k){var it=A().menuItemsMap[k];if(it)freeVal+=itemPrice(it,pickState.size)*pickState.free[k];});
  var disc=0;if(!isPromo){disc=pk.discType==='percent'?gross*(Number(pk.discValue)||0)/100:pk.discType==='fixed'?(Number(pk.discValue)||0):0;}
  var net=isPromo?gross:Math.max(0,gross-disc);
  var body=document.getElementById('pkgBody');
  var sizeSel=anySize?'<div style="margin-bottom:0.6rem;"><span class="pz-lbl">Size (all items)</span><select class="pz-in" id="pkgSize" style="width:auto;"><option value="S"'+(pickState.size==='S'?' selected':'')+'>Small</option><option value="M"'+(pickState.size==='M'?' selected':'')+'>Medium</option><option value="L"'+(pickState.size==='L'?' selected':'')+'>Large</option></select></div>':'';
  var html=sizeSel
    +'<div class="pz-lbl">'+(isPromo?'Paid items':'Items')+' — pick '+pk.qty+' <span style="color:'+(paidN===pk.qty?'#2a9d5c':'#e63946')+';">('+paidN+'/'+pk.qty+')</span></div>'
    +'<div class="pz-card" style="margin-bottom:0.6rem;max-height:190px;overflow:auto;">'+rows('paid',pk.qty)+'</div>';
  if(isPromo&&pk.freeQty>0){
    html+='<div class="pz-lbl">Free items — pick '+pk.freeQty+' <span style="color:'+(freeN===pk.freeQty?'#2a9d5c':'#e63946')+';">('+freeN+'/'+pk.freeQty+')</span></div>'
      +'<div class="pz-card" style="margin-bottom:0.6rem;max-height:150px;overflow:auto;">'+rows('free',pk.freeQty)+'</div>';
  }
  html+='<div style="font-size:0.85rem;border-top:1px solid var(--cd);padding-top:0.5rem;">'
    +'<div style="display:flex;justify-content:space-between;"><span>Items value</span><span>'+peso(gross+ (isPromo?freeVal:0))+'</span></div>'
    +(isPromo?('<div style="display:flex;justify-content:space-between;color:#e67e00;"><span>Free items</span><span>-'+peso(freeVal)+'</span></div>'):(disc?'<div style="display:flex;justify-content:space-between;color:#e67e00;"><span>Discount</span><span>-'+peso(disc)+'</span></div>':''))
    +(pk.extraCost?'<div style="display:flex;justify-content:space-between;color:var(--tl);font-size:0.78rem;"><span>Extra cost (labour/rental, not charged)</span><span>'+peso(pk.extraCost)+'</span></div>':'')
    +'<div style="display:flex;justify-content:space-between;font-weight:700;color:var(--bd);"><span>Customer pays</span><span>'+peso(net)+'</span></div></div>'
    +'<button class="pz-btn ok" id="pkgConfirm" style="width:100%;margin-top:0.7rem;"'+((paidN===pk.qty&&(!isPromo||!pk.freeQty||freeN===pk.freeQty))?'':' disabled')+'>Add to sale</button>';
  body.innerHTML=html;
  var ss=document.getElementById('pkgSize');if(ss)ss.onchange=function(){pickState.size=this.value;drawPicker();};
  body.querySelectorAll('[data-inc]').forEach(function(b){b.onclick=function(){var pr=b.getAttribute('data-inc').split('|');var mn=pr[0],ik=pr[1];var tgt=mn==='paid'?pk.qty:pk.freeQty;if(counts(pickState[mn])>=tgt){return;}pickState[mn][ik]=(pickState[mn][ik]||0)+1;drawPicker();};});
  body.querySelectorAll('[data-dec]').forEach(function(b){b.onclick=function(){var pr=b.getAttribute('data-dec').split('|');var mn=pr[0],ik=pr[1];pickState[mn][ik]=Math.max(0,(pickState[mn][ik]||0)-1);if(!pickState[mn][ik])delete pickState[mn][ik];drawPicker();};});
  var cf=document.getElementById('pkgConfirm');if(cf)cf.onclick=confirmPicker;
}
function confirmPicker(){
  var pk=pickState.pk;var size=pickState.size;
  var gross=0;Object.keys(pickState.paid).forEach(function(k){var it=A().menuItemsMap[k];if(it)gross+=itemPrice(it,size)*pickState.paid[k];});
  var isPromo=pk.type==='promo';
  var disc=0;if(!isPromo){disc=pk.discType==='percent'?gross*(Number(pk.discValue)||0)/100:pk.discType==='fixed'?(Number(pk.discValue)||0):0;}
  var net=isPromo?gross:Math.max(0,gross-disc);
  var factor=(!isPromo&&gross>0)?net/gross:1;
  var comps=[];
  Object.keys(pickState.paid).forEach(function(k){var it=A().menuItemsMap[k];if(!it)return;var pr=itemPrice(it,size);comps.push({itemKey:k,name:it.name+(size&&hasSizes(it)?' ('+size+')':''),size:(hasSizes(it)?size:null),qty:pickState.paid[k],unitTotal:Math.round(pr*factor*100)/100,details:pk.name});});
  if(isPromo){Object.keys(pickState.free).forEach(function(k){var it=A().menuItemsMap[k];if(!it)return;comps.push({itemKey:k,name:it.name+(size&&hasSizes(it)?' ('+size+')':'')+' (FREE)',size:(hasSizes(it)?size:null),qty:pickState.free[k],unitTotal:0,details:pk.name+' free'});});}
  var freeVal=0;if(isPromo)Object.keys(pickState.free).forEach(function(k){var it=A().menuItemsMap[k];if(it)freeVal+=itemPrice(it,size)*pickState.free[k];});
  var meta={id:pk.id,name:pk.name,type:pk.type,gross:isPromo?(gross+freeVal):gross,discount:isPromo?freeVal:disc,extraCost:Number(pk.extraCost)||0};
  if(window.__pos&&window.__pos.addPackage){window.__pos.addPackage(comps,meta);document.getElementById('pkgMask').classList.remove('show');pickState=null;}
  else{alert('POS not ready.');}
}
})();
