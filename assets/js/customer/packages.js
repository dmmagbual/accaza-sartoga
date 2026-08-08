(function(){
'use strict';
var pkgMap={};
function A(){return window.__accazaC;}
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
function peso(n){n=Number(n)||0;return '₱'+n.toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});}
function menuItems(){return A().getMenuItems?A().getMenuItems():[];}
function catLabel(id){return A().getCatLabel?A().getCatLabel(id):id;}
function hasSizes(it){return it.priceM&&it.priceL;}
function itemPrice(it,size){if(size==='L'&&it.priceL)return Number(it.priceL)||0;if(size==='M'&&it.priceM)return Number(it.priceM)||0;if(size==='S')return Number(it.priceS)||0;return Number(it.priceM||it.priceS)||0;}
function pkgEligible(pk){var out={};menuItems().forEach(function(it){if(pk.eligibleCat&&it.cat===pk.eligibleCat)out[it.key]=it;if((pk.eligibleItems||[]).indexOf(it.key)>-1)out[it.key]=it;});return Object.keys(out).map(function(k){return out[k];});}
var tries=0,iv=setInterval(function(){if(window.__accazaC){clearInterval(iv);init();}else if(++tries>150)clearInterval(iv);},100);
function init(){var a=A();a.onValue(a.ref(a.db,'packages'),function(s){pkgMap=s.val()||{};renderCards();});ensureModal();}
function dealText(pk){return pk.type==='promo'?('Buy '+pk.qty+' + '+(pk.freeQty||0)+' free'):(pk.qty+' items'+(pk.discType==='fixed'?' · ₱'+pk.discValue+' off':pk.discType==='percent'?' · '+pk.discValue+'% off':''));}
function renderCards(){
  var wrap=document.getElementById('custPkgWrap');if(!wrap)return;
  var list=Object.keys(pkgMap).map(function(k){return Object.assign({id:k},pkgMap[k]);});
  if(!list.length){wrap.style.display='none';wrap.innerHTML='';return;}
  wrap.style.display='block';
  wrap.innerHTML='<div class="cpk-h">🎁 Packages &amp; Promos</div><div class="cpk-cards">'+list.map(function(pk){return '<button class="cpk-card" data-pk="'+esc(pk.id)+'"><div class="n">'+esc(pk.name)+'</div><div class="d">Build your own from '+esc(pk.eligibleCat?catLabel(pk.eligibleCat):'selected items')+'</div><div class="b">'+esc(dealText(pk))+'</div></button>';}).join('')+'</div>';
  wrap.querySelectorAll('[data-pk]').forEach(function(b){b.onclick=function(){openPicker(b.getAttribute('data-pk'));};});
}
var pickState=null;
function ensureModal(){
  if(document.getElementById('cpkMask'))return;
  var m=document.createElement('div');m.className='cpk-mask';m.id='cpkMask';
  m.innerHTML='<div class="cpk-modal"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;"><div id="cpkTitle" class="cpk-title"></div><button class="cpk-btn sec" id="cpkClose" style="padding:0.2rem 0.6rem;">✕</button></div><div id="cpkBody"></div></div>';
  document.body.appendChild(m);
  document.getElementById('cpkClose').onclick=function(){m.classList.remove('show');};
  m.onclick=function(e){if(e.target===m)m.classList.remove('show');};
}
function openPicker(pkId){var pk=pkgMap[pkId];if(!pk)return;pk=Object.assign({id:pkId},pk);var items=pkgEligible(pk);var anySize=items.some(hasSizes);pickState={pk:pk,size:anySize?'M':'S',paid:{},free:{}};draw();document.getElementById('cpkMask').classList.add('show');}
function draw(){
  var pk=pickState.pk;var items=pkgEligible(pk);var anySize=items.some(hasSizes);var isPromo=pk.type==='promo';
  document.getElementById('cpkTitle').textContent=pk.name;
  function counts(m){return Object.keys(m).reduce(function(s,k){return s+(m[k]||0);},0);}
  var paidN=counts(pickState.paid),freeN=counts(pickState.free);
  function rows(mn){return items.map(function(it){var q=pickState[mn][it.key]||0;var pr=itemPrice(it,pickState.size);return '<div class="cpk-row"><span style="flex:1;">'+esc(it.name)+' <span style="color:#999;">'+peso(pr)+'</span></span><button class="cpk-step" data-dec="'+mn+'|'+esc(it.key)+'">−</button><span style="min-width:20px;text-align:center;">'+q+'</span><button class="cpk-step" data-inc="'+mn+'|'+esc(it.key)+'">+</button></div>';}).join('');}
  var gross=0;Object.keys(pickState.paid).forEach(function(k){var it=A().menuItemsMap[k];if(it)gross+=itemPrice(it,pickState.size)*pickState.paid[k];});
  var freeVal=0;Object.keys(pickState.free).forEach(function(k){var it=A().menuItemsMap[k];if(it)freeVal+=itemPrice(it,pickState.size)*pickState.free[k];});
  var disc=0;if(!isPromo){disc=pk.discType==='percent'?gross*(Number(pk.discValue)||0)/100:pk.discType==='fixed'?(Number(pk.discValue)||0):0;}
  var net=isPromo?gross:Math.max(0,gross-disc);
  var sizeSel=anySize?'<div style="margin-bottom:0.6rem;"><label style="font-size:0.75rem;color:#777;">Size (all items)</label><select class="cpk-in" id="cpkSize"><option value="S"'+(pickState.size==='S'?' selected':'')+'>Small</option><option value="M"'+(pickState.size==='M'?' selected':'')+'>Medium</option><option value="L"'+(pickState.size==='L'?' selected':'')+'>Large</option></select></div>':'';
  var html=sizeSel+'<div style="font-size:0.8rem;color:#555;margin-bottom:0.3rem;">'+(isPromo?'Paid items':'Choose your items')+' — pick '+pk.qty+' <b style="color:'+(paidN===pk.qty?'#2a9d5c':'#c0392b')+';">('+paidN+'/'+pk.qty+')</b></div><div style="max-height:180px;overflow:auto;border:1px solid #eee;border-radius:8px;padding:0.3rem 0.6rem;margin-bottom:0.6rem;">'+rows('paid')+'</div>';
  if(isPromo&&pk.freeQty>0)html+='<div style="font-size:0.8rem;color:#555;margin-bottom:0.3rem;">Free items — pick '+pk.freeQty+' <b style="color:'+(freeN===pk.freeQty?'#2a9d5c':'#c0392b')+';">('+freeN+'/'+pk.freeQty+')</b></div><div style="max-height:150px;overflow:auto;border:1px solid #eee;border-radius:8px;padding:0.3rem 0.6rem;margin-bottom:0.6rem;">'+rows('free')+'</div>';
  html+='<div style="border-top:1px solid #eee;padding-top:0.5rem;font-size:0.9rem;"><div style="display:flex;justify-content:space-between;"><span>Items value</span><span>'+peso(gross+(isPromo?freeVal:0))+'</span></div>'+(isPromo?('<div style="display:flex;justify-content:space-between;color:#e67e00;"><span>Free</span><span>-'+peso(freeVal)+'</span></div>'):(disc?'<div style="display:flex;justify-content:space-between;color:#e67e00;"><span>Discount</span><span>-'+peso(disc)+'</span></div>':''))+'<div style="display:flex;justify-content:space-between;font-weight:700;color:#19241b;font-size:1.05rem;"><span>You pay</span><span>'+peso(net)+'</span></div></div><button class="cpk-btn" id="cpkAdd" style="width:100%;margin-top:0.7rem;"'+((paidN===pk.qty&&(!isPromo||!pk.freeQty||freeN===pk.freeQty))?'':' disabled')+'>Add to my order</button>';
  var body=document.getElementById('cpkBody');body.innerHTML=html;
  var ss=document.getElementById('cpkSize');if(ss)ss.onchange=function(){pickState.size=this.value;draw();};
  body.querySelectorAll('[data-inc]').forEach(function(b){b.onclick=function(){var pr=b.getAttribute('data-inc').split('|');var mn=pr[0],ik=pr[1];var tgt=mn==='paid'?pk.qty:pk.freeQty;if(counts(pickState[mn])>=tgt)return;pickState[mn][ik]=(pickState[mn][ik]||0)+1;draw();};});
  body.querySelectorAll('[data-dec]').forEach(function(b){b.onclick=function(){var pr=b.getAttribute('data-dec').split('|');var mn=pr[0],ik=pr[1];pickState[mn][ik]=Math.max(0,(pickState[mn][ik]||0)-1);if(!pickState[mn][ik])delete pickState[mn][ik];draw();};});
  var cf=document.getElementById('cpkAdd');if(cf)cf.onclick=confirmPick;
}
function confirmPick(){
  var pk=pickState.pk;var size=pickState.size;var isPromo=pk.type==='promo';
  var gross=0;Object.keys(pickState.paid).forEach(function(k){var it=A().menuItemsMap[k];if(it)gross+=itemPrice(it,size)*pickState.paid[k];});
  var disc=0;if(!isPromo){disc=pk.discType==='percent'?gross*(Number(pk.discValue)||0)/100:pk.discType==='fixed'?(Number(pk.discValue)||0):0;}
  var net=isPromo?gross:Math.max(0,gross-disc);var factor=(!isPromo&&gross>0)?net/gross:1;
  var comps=[];
  Object.keys(pickState.paid).forEach(function(k){var it=A().menuItemsMap[k];if(!it)return;var pr=itemPrice(it,size);comps.push({itemKey:k,name:it.name+(size&&hasSizes(it)?' ('+size+')':''),size:(hasSizes(it)?size:null),qty:pickState.paid[k],unitTotal:Math.round(pr*factor*100)/100,cat:it.cat,details:pk.name,packageRole:'paid'});});
  if(isPromo)Object.keys(pickState.free).forEach(function(k){var it=A().menuItemsMap[k];if(!it)return;comps.push({itemKey:k,name:it.name+(size&&hasSizes(it)?' ('+size+')':'')+' (FREE)',size:(hasSizes(it)?size:null),qty:pickState.free[k],unitTotal:0,cat:it.cat,details:pk.name+' free',packageRole:'free'});});
  var freeVal=0;if(isPromo)Object.keys(pickState.free).forEach(function(k){var it=A().menuItemsMap[k];if(it)freeVal+=itemPrice(it,size)*pickState.free[k];});
  var meta={id:pk.id,name:pk.name,type:pk.type,gross:isPromo?(gross+freeVal):gross,discount:isPromo?freeVal:disc,extraCost:Number(pk.extraCost)||0};
  if(window.__custAddPackage){window.__custAddPackage(comps,meta);document.getElementById('cpkMask').classList.remove('show');pickState=null;(window.accazaToast||function(){})('Package added to your order','ok');}
  else alert('Please try again in a moment.');
}
})();
