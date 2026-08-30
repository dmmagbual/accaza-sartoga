/* ---------- scoped line-item discounts (Feature A) ---------- */
function lineCat(key){var c=posCart[key];if(!c)return '';var it=(A().menuItemsMap||{})[c.itemKey];return it?catType(it.cat):'';}
function discountedUnits(key){return posScopedDisc.filter(function(d){return d.key===key;}).length;}
function scopedDiscTotal(){return posScopedDisc.reduce(function(s,d){return s+(Number(d.value)||0);},0);}
function idSlotUsed(idNum,cat){return posScopedDisc.some(function(d){return d.type!=='promo5'&&d.idNumber===idNum&&d.cat===cat;});}
function applyScoped(key,type,idNum,name){
  var c=posCart[key]; if(!c){return false;}
  var cat=lineCat(key);
  if(discountedUnits(key)>=c.qty){alert('Every unit of this line is already discounted (no stacking).');return false;}
  if(type==='promo5'){
    if(cat!=='drink'){alert('The 5% promo applies to a drink only.');return false;}
  } else {
    if(!idNum){alert('Enter the ID number for a Senior/PWD/Athlete discount.');return false;}
    if(cat!=='drink'&&cat!=='food'){alert('Tag this item’s category as drink or food first (Recipe → Consumables tab).');return false;}
    if(idSlotUsed(idNum,cat)){alert('ID '+idNum+' already used its '+cat+' discount (max 1 drink + 1 food per ID).');return false;}
  }
  var rate=(DISC_TYPES[type]||{}).rate||0;
  var value=Math.round(c.unitTotal*rate*100)/100;
  posScopedDisc.push({type:type,rate:rate,idNumber:idNum||'',holderName:name||'',key:key,itemKey:c.itemKey,name:c.name,size:c.size||'',cat:cat,unitPrice:c.unitTotal,value:value});
  return true;
}
function openDiscountModal(){
  if(!Object.keys(posCart).length){alert('Add items to the cart first.');return;}
  var mask=document.createElement('div'); mask.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;';
  function draw(){
    var type=(mask.querySelector('#dscType')||{}).value||'senior';
    var idNum=(mask.querySelector('#dscId')||{}).value||'';
    var nm=(mask.querySelector('#dscName')||{}).value||'';
    var isPromo=type==='promo5';
    var rows=Object.keys(posCart).map(function(k){var c=posCart[k];var cat=lineCat(k);var left=c.qty-discountedUnits(k);
      var eligible = left>0 && (isPromo?cat==='drink':(cat==='drink'||cat==='food'));
      return '<tr><td>'+esc(c.name)+(c.size?' ('+esc(c.size)+')':'')+'<div style="font-size:0.7rem;color:var(--tl);">'+(cat||'untagged')+' · '+peso(c.unitTotal)+'/unit · '+left+' of '+c.qty+' left</div></td><td style="text-align:right;">'+(eligible?'<button class="pz-btn ok" data-dscapply="'+k+'" style="padding:0.2rem 0.55rem;">Discount 1</button>':'<span style="font-size:0.72rem;color:var(--tl);">—</span>')+'</td></tr>';
    }).join('');
    var applied=posScopedDisc.length?posScopedDisc.map(function(d,ix){return '<tr><td>'+esc((DISC_TYPES[d.type]||{}).label||d.type)+' · '+esc(d.name)+(d.idNumber?' · ID '+esc(d.idNumber):'')+'</td><td style="text-align:right;">−'+peso(d.value)+' <button class="pz-btn warn" data-dscrm="'+ix+'" style="padding:0.1rem 0.4rem;">✕</button></td></tr>';}).join(''):'<tr><td colspan="2" style="color:var(--tl);padding:0.4rem;">None applied yet.</td></tr>';
    mask.innerHTML='<div style="background:#fff;border-radius:10px;max-width:520px;width:100%;max-height:90vh;overflow:auto;padding:1.2rem;">'
      +'<div style="font-weight:700;color:var(--bd);margin-bottom:0.2rem;">Scoped discount</div>'
      +'<p class="pz-sub" style="margin-top:0.2rem;">Statutory Senior/PWD/Athlete = 20% on the eligible person’s own items (max 1 drink + 1 food per ID). 5% promo = 1 drink. No stacking on the same unit.</p>'
      +'<div style="display:flex;gap:0.5rem;flex-wrap:wrap;align-items:end;margin-bottom:0.6rem;"><div><span class="pz-lbl">Type</span><select class="pz-in" id="dscType">'+Object.keys(DISC_TYPES).map(function(t){return '<option value="'+t+'"'+(t===type?' selected':'')+'>'+esc(DISC_TYPES[t].label)+' ('+Math.round(DISC_TYPES[t].rate*100)+'%)</option>';}).join('')+'</select></div>'
      +(isPromo?'':'<div><span class="pz-lbl">ID number</span><input class="pz-in" id="dscId" value="'+esc(idNum)+'" placeholder="OSCA/PWD/athlete ID"/></div><div><span class="pz-lbl">Holder name</span><input class="pz-in" id="dscName" value="'+esc(nm)+'"/></div>')+'</div>'
      +'<table class="pz-tbl"><thead><tr><th>Cart item</th><th></th></tr></thead><tbody>'+rows+'</tbody></table>'
      +'<div style="font-weight:600;color:var(--bd);margin-top:0.8rem;margin-bottom:0.3rem;">Applied</div><table class="pz-tbl"><tbody>'+applied+'</tbody></table>'
      +'<div style="display:flex;justify-content:space-between;align-items:center;margin-top:0.8rem;"><span style="font-weight:700;">Total discount: '+peso(scopedDiscTotal())+'</span><button class="pz-btn ok" id="dscDone">Done</button></div>'
      +'</div>';
    var ts=mask.querySelector('#dscType'); if(ts)ts.onchange=draw;
    mask.querySelectorAll('[data-dscapply]').forEach(function(b){b.onclick=function(){ var liveId=((mask.querySelector('#dscId')||{}).value||'').trim(); var liveNm=((mask.querySelector('#dscName')||{}).value||'').trim(); if(applyScoped(b.getAttribute('data-dscapply'),type,liveId,liveNm))draw(); };});
    mask.querySelectorAll('[data-dscrm]').forEach(function(b){b.onclick=function(){posScopedDisc.splice(+b.getAttribute('data-dscrm'),1);draw();};});
    mask.querySelector('#dscDone').onclick=function(){document.body.removeChild(mask);renderPosCart();};
  }
  document.body.appendChild(mask); draw();
}
