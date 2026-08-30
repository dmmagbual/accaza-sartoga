// ---- item customize modal ----
var mSel={};
function openPosItem(key){
  var _raw=A().menuItemsMap[key]; if(!_raw)return;
  var item=Object.assign({key:key},_raw);
  if(!posIsAvail(item.name)){alert(item.name+' is marked unavailable — it can’t be sold. Toggle it back on in Availability first.');return;}
  var body=document.getElementById('pzItemBody'); var titleEl=document.getElementById('pzItemTitle');
  titleEl.textContent=item.name;
  var plat=posIsPlatform();
  mSel={item:Object.assign({key:key},item), size:null, price:posBasePrice(item,'S'), opts:{}, qty:1};
  var html='';
  if(plat)html+='<div style="font-size:0.72rem;color:var(--tl);margin-bottom:0.4rem;">'+esc(channelLabel(posChannel))+' pricing — item &amp; add-on prices from Channel Pricing.</div>';
  var hasM=item.priceM&&item.priceL, hasAB=item.labelS&&item.labelL&&item.priceL;
  if(hasAB){ html+=sizeBlock([['S',item.labelS||'Option 1',posBasePrice(item,'S')],['L',item.labelL||'Option 2',posBasePrice(item,'L')]]); }
  else if(hasM){ html+=sizeBlock([['S','Small',posBasePrice(item,'S')],['M','Medium',posBasePrice(item,'M')],['L','Large',posBasePrice(item,'L')]]); }
  else { mSel.size='S'; mSel.price=posBasePrice(item,'S'); }
  var groups=(A().getItemOptionGroups?A().getItemOptionGroups(item):[]);
  groups.forEach(function(g){
    html+='<div style="margin-top:0.8rem;"><span class="pz-lbl">'+esc(g.name)+(g.type!=='multi'&&g.required!==false?' (required)':'')+'</span>';
    html+=(g.choices||[]).map(function(c,ci){var pp=optChoicePrice(g.id,c.label,c.price);return '<div class="pz-opt" data-g="'+esc(g.id)+'" data-multi="'+(g.type==='multi'?1:0)+'" data-label="'+esc(c.label)+'" data-price="'+pp+'"><span>'+esc(c.label)+'</span><span>'+(pp>0?'+₱'+pp:'Free')+'</span></div>';}).join('');
    html+='</div>';
  });
  html+='<div style="margin-top:0.9rem;display:flex;align-items:center;gap:0.8rem;"><span class="pz-lbl" style="margin:0;">Qty</span><button class="pz-btn sec" id="pzQtyM" style="padding:0.2rem 0.7rem;">−</button><span id="pzQtyN" style="font-weight:600;">1</span><button class="pz-btn sec" id="pzQtyP" style="padding:0.2rem 0.7rem;">+</button></div>';
  body.innerHTML=html;
  body.querySelectorAll('.pz-opt').forEach(function(o){o.onclick=function(){toggleOpt(o);};});
  document.getElementById('pzQtyM').onclick=function(){mSel.qty=Math.max(1,mSel.qty-1);document.getElementById('pzQtyN').textContent=mSel.qty;updatePzTotal();};
  document.getElementById('pzQtyP').onclick=function(){mSel.qty++;document.getElementById('pzQtyN').textContent=mSel.qty;updatePzTotal();};
  updatePzTotal();
  var _pzm=document.getElementById('pzItemMask'); _pzm.classList.remove('ch-grabfood','ch-foodpanda'); if(posChannel==='grabfood')_pzm.classList.add('ch-grabfood'); else if(posChannel==='foodpanda')_pzm.classList.add('ch-foodpanda'); _pzm.classList.add('show');
}
function sizeBlock(arr){ return '<div><span class="pz-lbl">Serving size (required)</span>'+arr.map(function(a){return '<div class="pz-opt" data-size="'+a[0]+'" data-price="'+a[2]+'"><span>'+esc(a[1])+'</span><span>₱'+a[2]+'</span></div>';}).join('')+'</div>'; }
function toggleOpt(el){
  if(el.hasAttribute('data-size')){ document.querySelectorAll('#pzItemBody .pz-opt[data-size]').forEach(function(o){o.classList.remove('on');}); el.classList.add('on'); mSel.size=el.getAttribute('data-size'); mSel.price=Number(el.getAttribute('data-price'))||0; updatePzTotal(); return; }
  var g=el.getAttribute('data-g'), multi=el.getAttribute('data-multi')==='1', label=el.getAttribute('data-label'), price=Number(el.getAttribute('data-price'))||0;
  mSel.opts[g]=mSel.opts[g]||[];
  if(multi){ var ix=mSel.opts[g].findIndex(function(x){return x.label===label;}); if(ix>-1){mSel.opts[g].splice(ix,1);el.classList.remove('on');} else {mSel.opts[g].push({label:label,price:price});el.classList.add('on');} }
  else { document.querySelectorAll('#pzItemBody .pz-opt[data-g="'+g+'"]').forEach(function(o){o.classList.remove('on');}); el.classList.add('on'); mSel.opts[g]=[{label:label,price:price}]; }
  updatePzTotal();
}
function pzUnit(){ var t=mSel.price||0; Object.keys(mSel.opts).forEach(function(g){(mSel.opts[g]||[]).forEach(function(c){t+=c.price||0;});}); return t; }
function updatePzTotal(){ document.getElementById('pzItemTotal').textContent=peso(pzUnit()*mSel.qty); }
function pzAddToCart(){
  var item=mSel.item; var plat=posIsPlatform();
  var hasM=item.priceM&&item.priceL, hasAB=item.labelS&&item.labelL&&item.priceL;
  if((hasM||hasAB)&&!mSel.size){alert('Please select a size.');return;}
  if(plat&&!(posBasePrice(item,mSel.size||'S')>0)){alert('No '+channelLabel(posChannel)+' price set for this item/size — set it in Channel Pricing first.');return;}
  var groups=(A().getItemOptionGroups?A().getItemOptionGroups(item):[]);
  for(var i=0;i<groups.length;i++){var g=groups[i];if(g.type!=='multi'&&g.required!==false&&!(mSel.opts[g.id]&&mSel.opts[g.id].length)){alert('Please select: '+g.name);return;}}
  var optLabels=[],details=[]; Object.keys(mSel.opts).forEach(function(g){(mSel.opts[g]||[]).forEach(function(c){optLabels.push(c.label);details.push(c.label);});});
  var key=uid('pc_');
  posCart[key]={itemKey:item.key,name:item.name+(mSel.size&&(hasM||hasAB)?' ('+mSel.size+')':''),size:mSel.size||'S',optLabels:optLabels,details:details.join(', '),qty:mSel.qty,unitTotal:pzUnit()};
  document.getElementById('pzItemMask').classList.remove('show');
  renderPosCart();
}
