/* ══════════ INVENTORY ARCHITECTURE v2 — Phase 1: Approved-brand (SKU) manager ══════════
   Per Ingredient Master, manage the approved list of purchasable brands/SKUs. Add/edit/
   activate/deactivate/rank — NEVER touches a recipe. costPerBase auto-derives from pack size
   + purchase cost via the existing unit conversion. Reads/writes inventorySku/{sid}. */
function skuCostPerBase(item,packSize,purchaseUnit,purchaseCost){
  var baseUnits=convertToStock(Number(packSize)||0,purchaseUnit,item); // package size expressed in the item's base unit
  if(!baseUnits)return {base:0,per:0};
  return {base:baseUnits,per:(Number(purchaseCost)||0)/baseUnits};
}
function openSkuManager(id,onUse){
  var a=A(); var item=inventoryMap[id]; if(!item){alert('Item not found.');return;}
  var baseU=item.masterUnit||item.unit||''; var editId=null;
  var mask=document.createElement('div'); mask.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;';
  document.body.appendChild(mask);
  function close(){ if(mask.parentNode)document.body.removeChild(mask); }
  function load(){ a.get(a.ref(a.db,'inventorySku')).then(function(s){ var all=s.val()||{}; inventorySkuMap=all;var mine=Object.keys(all).map(function(k){return Object.assign({id:k},all[k]);}).filter(function(x){return x.masterId===id;}).sort(function(x,y){return (Number(x.priority)||0)-(Number(y.priority)||0);}); draw(mine); }).catch(function(e){ mask.innerHTML='<div style="background:#fff;border-radius:10px;max-width:520px;width:100%;padding:1.2rem;"><div style="font-weight:700;color:var(--bd);">Could not load approved brands</div><p class="pz-sub">'+esc((e&&e.code)||String(e))+'</p><button class="pz-btn sec" id="skErrX">Close</button></div>'; var b=document.getElementById('skErrX'); if(b)b.onclick=close; }); }
  var unitOpts=compatUnits(item).map(function(u){return '<option value="'+esc(u)+'"'+(uNorm(u)===uNorm(item.unit)?' selected':'')+'>'+esc(u)+'</option>';}).join('');
  function draw(mine){
    var rows=mine.map(function(sk,ix){
      var per=Number(sk.costPerBase)||0;
      var pack=(sk.packSize!=null&&sk.packSize!=='')?(num(sk.packSize)+' '+esc(sk.purchaseUnit||'')):'—';
      return '<tr'+(sk.active===false?' style="opacity:0.5;"':'')+'>'
        +'<td style="white-space:nowrap;"><button class="pz-btn sec" data-skup="'+sk.id+'" '+(ix===0?'disabled':'')+' style="padding:0.05rem 0.35rem;">▲</button> <button class="pz-btn sec" data-skdn="'+sk.id+'" '+(ix===mine.length-1?'disabled':'')+' style="padding:0.05rem 0.35rem;">▼</button></td>'
        +'<td><b>'+esc(sk.brand||'—')+'</b></td>'
        +'<td style="font-size:0.8rem;">'+esc(sk.supplier||'—')+'</td>'
        +'<td style="font-size:0.8rem;">'+pack+'</td>'
        +'<td style="font-size:0.8rem;">'+(sk.purchaseCost?peso(sk.purchaseCost):'—')+'</td>'
        +'<td style="font-size:0.8rem;white-space:nowrap;">'+(per?('₱'+per.toFixed(4)+'/'+esc(baseU)):'—')+'</td>'
        +'<td style="font-size:0.8rem;">'+(sk.active===false?'<span style="color:#a55;">inactive</span>':'<span style="color:#2a7;">active</span>')+'</td>'
        +'<td style="white-space:nowrap;">'+(onUse&&sk.active!==false?'<button class="pz-btn ok" data-skuse="'+sk.id+'" style="padding:0.15rem 0.5rem;">Use this brand</button> ':'')+'<button class="pz-btn sec" data-sked="'+sk.id+'" style="padding:0.15rem 0.5rem;">Edit</button> <button class="pz-btn sec" data-sktog="'+sk.id+'" style="padding:0.15rem 0.5rem;">'+(sk.active===false?'Activate':'Deactivate')+'</button> <button class="pz-btn warn" data-skdel="'+sk.id+'" style="padding:0.15rem 0.45rem;">✕</button></td></tr>';
    }).join('');
    var e=editId?(mine.filter(function(x){return x.id===editId;})[0]||{}):{};
    mask.innerHTML='<div style="background:#fff;border-radius:10px;max-width:920px;width:100%;max-height:90vh;overflow:auto;padding:1.2rem;">'
      +'<div style="display:flex;justify-content:space-between;align-items:center;"><div style="font-weight:700;color:var(--bd);">Approved brands — '+esc(item.name)+'</div><button class="pz-btn sec" id="skClose" style="padding:0.2rem 0.6rem;">✕</button></div>'
      +'<p class="pz-sub" style="margin-top:0.3rem;"><b>'+esc(item.name)+'</b> is the common SKU used by recipes. These are the interchangeable brands allowed when purchasing it. Adding, deactivating, or reordering brands never changes a recipe. Cost per '+esc(baseU)+' is calculated from pack size and purchase cost.'+(item.skuMigrated?'':' <b style="color:#8a5a00;">Tip: run “Brand &amp; Batch setup” to seed brands from purchase history.</b>')+'</p>'
      +'<div style="overflow-x:auto;"><table class="pz-tbl"><thead><tr><th>Rank</th><th>Brand</th><th>Supplier</th><th>Pack</th><th>Purchase ₱</th><th>Cost/base</th><th>Status</th><th>Actions</th></tr></thead><tbody>'+(rows||'<tr><td colspan="8" style="padding:0.8rem;color:var(--tl);">No approved brands yet — add one below.</td></tr>')+'</tbody></table></div>'
      +'<div class="pz-card" style="margin-top:0.8rem;">'
        +'<div style="font-weight:600;color:var(--bd);margin-bottom:0.5rem;">'+(editId?'✏️ Edit brand':'➕ Add brand')+'</div>'
        +'<div style="display:grid;grid-template-columns:1.3fr 1.2fr 0.8fr 0.9fr 1fr auto;gap:0.5rem;align-items:end;">'
          +'<div><span class="pz-lbl">Brand</span><input class="pz-in" id="skBrand" value="'+esc(e.brand||'')+'" placeholder="e.g. Arla Full Cream"/></div>'
          +'<div><span class="pz-lbl">Supplier</span><input class="pz-in" id="skSup" value="'+esc(e.supplier||'')+'" placeholder="optional"/></div>'
          +'<div><span class="pz-lbl">Pack size</span><input class="pz-in" id="skPack" type="number" step="any" value="'+(e.packSize!=null?e.packSize:'')+'" placeholder="1"/></div>'
          +'<div><span class="pz-lbl">Purchase unit</span><select class="pz-in" id="skUnit">'+unitOpts+'</select></div>'
          +'<div><span class="pz-lbl">Purchase cost ₱</span><input class="pz-in" id="skCost" type="number" step="any" value="'+(e.purchaseCost!=null?e.purchaseCost:'')+'" placeholder="110"/></div>'
          +'<button class="pz-btn ok" id="skSave">'+(editId?'Save':'Add')+'</button>'
        +'</div>'
        +'<div id="skPrev" style="font-size:0.78rem;color:var(--tm);margin-top:0.4rem;"></div>'
        +(editId?'<button class="pz-btn sec" id="skCancelEdit" style="margin-top:0.5rem;padding:0.2rem 0.6rem;">Cancel edit</button>':'')
      +'</div></div>';
    if(e.purchaseUnit){var us=document.getElementById('skUnit');if(us)us.value=e.purchaseUnit;}
    document.getElementById('skClose').onclick=close;
    function prev(){var p=skuCostPerBase(item,document.getElementById('skPack').value,document.getElementById('skUnit').value,document.getElementById('skCost').value);document.getElementById('skPrev').innerHTML=p.per?('= <b>₱'+p.per.toFixed(4)+'/'+esc(baseU)+'</b> ('+num(p.base)+' '+esc(baseU)+' per pack)'):'Enter pack size + cost to see cost per '+esc(baseU)+'.';}
    ['skPack','skUnit','skCost'].forEach(function(idf){var el=document.getElementById(idf);if(el)el.oninput=prev,el.onchange=prev;}); prev();
    var ce=document.getElementById('skCancelEdit'); if(ce)ce.onclick=function(){editId=null;load();};
    document.getElementById('skSave').onclick=function(){
      var brand=(document.getElementById('skBrand').value||'').trim(); if(!brand){alert('Enter a brand name.');return;}
      var duplicate=mine.some(function(sk){return sk.id!==editId&&uNorm(sk.brand)===uNorm(brand);});if(duplicate){alert('This brand is already approved for '+(item.name||'this item')+'. Select the existing brand instead.');return;}
      var pack=document.getElementById('skPack').value, punit=document.getElementById('skUnit').value, pcost=document.getElementById('skCost').value;
      var p=skuCostPerBase(item,pack,punit,pcost);
      var rec={masterId:id,brand:brand,supplier:(document.getElementById('skSup').value||'').trim(),purchaseUnit:punit,packSize:(pack===''?null:Number(pack)||0),purchaseCost:(pcost===''?null:Number(pcost)||0),convToBase:p.base,costPerBase:p.per,branchAvail:['main'],updatedAt:Date.now()};
      if(editId){ a.update(a.ref(a.db,'inventorySku/'+editId),rec).then(function(){editId=null;load();}).catch(skErr); }
      else { rec.active=true; rec.priority=mine.length; rec.createdAt=Date.now(); rec.seededFrom='manual';var newSid=uid('sku_');a.set(a.ref(a.db,'inventorySku/'+newSid),rec).then(function(){inventorySkuMap[newSid]=rec;if(onUse){onUse(newSid,rec);close();}else load();}).catch(skErr); }
    };
    mask.querySelectorAll('[data-skuse]').forEach(function(b){b.onclick=function(){var sid=b.getAttribute('data-skuse'),selected=mine.filter(function(x){return x.id===sid&&x.active!==false;})[0];if(!selected)return;inventorySkuMap[sid]=selected;onUse(sid,selected);close();};});
    mask.querySelectorAll('[data-sked]').forEach(function(b){b.onclick=function(){editId=b.getAttribute('data-sked');draw(mine);};});
    mask.querySelectorAll('[data-sktog]').forEach(function(b){b.onclick=function(){var sid=b.getAttribute('data-sktog');var cur=mine.filter(function(x){return x.id===sid;})[0]||{};a.update(a.ref(a.db,'inventorySku/'+sid),{active:!(cur.active!==false)}).then(load).catch(skErr);};});
    mask.querySelectorAll('[data-skdel]').forEach(function(b){b.onclick=function(){var sid=b.getAttribute('data-skdel');var cur=mine.filter(function(x){return x.id===sid;})[0]||{};if(!confirm('Remove brand “'+((cur.brand)||'')+'”? Past purchase receipts and batches are unaffected.'))return;a.remove(a.ref(a.db,'inventorySku/'+sid)).then(load).catch(skErr);};});
    function reorder(sid,dir){var i=mine.map(function(x){return x.id;}).indexOf(sid);var j=i+dir;if(i<0||j<0||j>=mine.length)return;var upd={};upd['inventorySku/'+mine[i].id+'/priority']=j;upd['inventorySku/'+mine[j].id+'/priority']=i;a.update(a.ref(a.db),upd).then(load).catch(skErr);}
    mask.querySelectorAll('[data-skup]').forEach(function(b){b.onclick=function(){reorder(b.getAttribute('data-skup'),-1);};});
    mask.querySelectorAll('[data-skdn]').forEach(function(b){b.onclick=function(){reorder(b.getAttribute('data-skdn'),1);};});
  }
  function skErr(e){alert('Could not save: '+((e&&e.code)||e)+'.\n\nIf PERMISSION_DENIED — log in with your admin email and publish the rules (inventorySku node).');}
  load();
}
/* ══════════ INVENTORY ARCHITECTURE v2 — Phase 2: Expiry / batch dashboard ══════════
   Batches are tracked for EXPIRY + brand audit only; the WAC pool (inventory.stock) stays
   authoritative for cost/deduction. Remaining per lot is DERIVED from current stock, consumed
   first-expiry-first-out (FEFO) — always consistent with the pool, no stored depletion to drift. */
function batchExpiryStatus(expiry,today){ if(!expiry)return {k:'none',lbl:'no expiry',col:'var(--tl)'}; if(expiry<today)return {k:'exp',lbl:'EXPIRED',col:'#c0392b'}; var d=new Date(expiry)-new Date(today); var days=Math.round(d/86400000); if(days<=7)return {k:'soon',lbl:days+'d left',col:'#c98a2b'}; return {k:'ok',lbl:days+'d left',col:'#2a7'}; }
function deriveBatchRemaining(batches,stock){ /* batches: non-closed lots for ONE item */
  var order=batches.slice().sort(function(a,b){ var ea=a.expiry||'9999-99-99', eb=b.expiry||'9999-99-99'; if(ea!==eb)return ea<eb?-1:1; return (a.recvDate||'')<(b.recvDate||'')?-1:1; });
  var R=0; order.forEach(function(b){R+=Number(b.qtyRecv)||0;});
  var consumed=Math.max(0,R-(Number(stock)||0)); var rem={};
  order.forEach(function(b){ var q=Number(b.qtyRecv)||0; var take=Math.min(q,consumed); consumed-=take; rem[b.id]=Math.round((q-take)*100000)/100000; });
  return {rem:rem,untracked:Math.max(0,Math.round(((Number(stock)||0)-R)*100000)/100000)};
}
function openExpiryView(){
  var a=A(); var today=window.AccazaDate.key();
  var mask=document.createElement('div'); mask.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;';
  mask.innerHTML='<div style="background:#fff;border-radius:10px;max-width:960px;width:100%;padding:1.2rem;"><div style="font-weight:700;color:var(--bd);">📅 Expiry / batches</div><p class="pz-sub">Loading batches…</p></div>';
  document.body.appendChild(mask);
  function close(){ if(mask.parentNode)document.body.removeChild(mask); }
  function load(){ a.get(a.ref(a.db,'inventoryBatch')).then(function(s){ draw(s.val()||{}); }).catch(function(e){ mask.innerHTML='<div style="background:#fff;border-radius:10px;max-width:520px;width:100%;padding:1.2rem;"><div style="font-weight:700;color:var(--bd);">Could not load</div><p class="pz-sub">'+esc((e&&e.code)||String(e))+'</p><button class="pz-btn sec" id="xpErrX">Close</button></div>'; var b=document.getElementById('xpErrX'); if(b)b.onclick=close; }); }
  function draw(allB){
    var byItem={}; Object.keys(allB).forEach(function(k){ var b=Object.assign({id:k},allB[k]); if(b.closed)return; (byItem[b.masterId]=byItem[b.masterId]||[]).push(b); });
    var flat=[]; var untrackedNotes=[];
    Object.keys(byItem).forEach(function(mid){ var it=inventoryMap[mid]||{name:'(deleted item)',unit:''}; var d=deriveBatchRemaining(byItem[mid],it.stock); if(d.untracked>0)untrackedNotes.push({name:it.name,unit:it.unit,qty:d.untracked}); byItem[mid].forEach(function(b){ var rem=d.rem[b.id]||0; if(rem<=0)return; flat.push({b:b,it:it,rem:rem,st:batchExpiryStatus(b.expiry,today)}); }); });
    flat.sort(function(x,y){ var ex=x.b.expiry||'9999-99-99', ey=y.b.expiry||'9999-99-99'; return ex<ey?-1:(ex>ey?1:0); });
    var nExp=flat.filter(function(r){return r.st.k==='exp';}).length, nSoon=flat.filter(function(r){return r.st.k==='soon';}).length;
    var rows=flat.map(function(r){ var b=r.b, it=r.it;
      return '<tr>'
        +'<td><b>'+esc(it.name||'')+'</b>'+(b.brand?'<div style="font-size:0.7rem;color:var(--tl);">'+esc(b.brand)+'</div>':'')+'</td>'
        +'<td style="font-size:0.8rem;">'+esc(b.lot||'—')+'</td>'
        +'<td style="font-size:0.8rem;">'+num(r.rem)+' '+esc(it.unit||b.unit||'')+'</td>'
        +'<td style="white-space:nowrap;"><input class="pz-in" type="date" data-xpd="'+b.id+'" value="'+esc(b.expiry||'')+'" style="width:140px;"/></td>'
        +'<td style="font-size:0.8rem;font-weight:600;color:'+r.st.col+';">'+r.st.lbl+'</td>'
        +'<td style="white-space:nowrap;"><button class="pz-btn sec" data-xpsave="'+b.id+'" style="padding:0.15rem 0.5rem;">Save</button> <button class="pz-btn warn" data-xpdisc="'+b.id+'" data-xpmid="'+esc(b.masterId)+'" data-xprem="'+r.rem+'" style="padding:0.15rem 0.5rem;">Discard</button></td>'
      +'</tr>';
    }).join('');
    mask.innerHTML='<div style="background:#fff;border-radius:10px;max-width:960px;width:100%;max-height:90vh;overflow:auto;padding:1.2rem;">'
      +'<div style="display:flex;justify-content:space-between;align-items:center;"><div style="font-weight:700;color:var(--bd);">📅 Expiry / batches</div><button class="pz-btn sec" id="xpClose" style="padding:0.2rem 0.6rem;">✕</button></div>'
      +'<p class="pz-sub" style="margin-top:0.3rem;">Lots sorted soonest-expiry first. Remaining is derived from current stock assuming oldest is used first — no separate count to drift. '+(nExp?'<b style="color:#c0392b;">'+nExp+' expired.</b> ':'')+(nSoon?'<b style="color:#c98a2b;">'+nSoon+' expiring ≤7 days.</b>':'')+'</p>'
      +(untrackedNotes.length?'<div style="background:#fff7e6;border:1px solid #e6c07a;border-radius:6px;padding:0.4rem 0.6rem;margin-bottom:0.5rem;font-size:0.76rem;color:#8a5a00;">Stock not yet tied to a dated batch (received before batch tracking, or via opening balance): '+untrackedNotes.map(function(u){return esc(u.name)+' '+num(u.qty)+' '+esc(u.unit||'');}).join(' · ')+'. Add expiry when you next receive these.</div>':'')
      +'<div style="overflow-x:auto;"><table class="pz-tbl"><thead><tr><th>Item / brand</th><th>Lot #</th><th>Remaining</th><th>Expiry</th><th>Status</th><th>Actions</th></tr></thead><tbody>'+(rows||'<tr><td colspan="6" style="padding:1rem;color:var(--tl);">No open batches with expiry to track. Batches are created when you receive stock (Purchases or + Stock).</td></tr>')+'</tbody></table></div>'
      +'<div style="font-size:0.7rem;color:var(--tl);margin-top:0.5rem;">“Discard” posts a wastage adjustment for that lot’s remaining (reduces stock + COGS variance) and closes the lot. Editing expiry only updates the batch record — it doesn’t change stock or cost.</div>'
      +'</div>';
    document.getElementById('xpClose').onclick=close;
    mask.querySelectorAll('[data-xpsave]').forEach(function(btn){ btn.onclick=function(){ var bid=btn.getAttribute('data-xpsave'); var inp=mask.querySelector('[data-xpd="'+bid+'"]'); a.update(a.ref(a.db,'inventoryBatch/'+bid),{expiry:inp?inp.value:'',updatedAt:Date.now()}).then(load).catch(function(e){alert('Could not save expiry: '+((e&&e.code)||e));}); }; });
    mask.querySelectorAll('[data-xpdisc]').forEach(function(btn){ btn.onclick=function(){ var bid=btn.getAttribute('data-xpdisc'); var mid=btn.getAttribute('data-xpmid'); var rem=Number(btn.getAttribute('data-xprem'))||0; var it=inventoryMap[mid]||{}; if(!confirm('Discard '+num(rem)+' '+(it.unit||'')+' of '+(it.name||'this item')+' as wastage? This reduces stock and posts a COGS variance.'))return; a.update(a.ref(a.db,'inventoryBatch/'+bid),{closed:true,qtyRemaining:0,closedAt:Date.now(),closedReason:'wastage'}).then(function(){ if(typeof finalizeAdjust==='function')finalizeAdjust(mid,Number(it.stock)||0,-rem,'wastage'); setTimeout(load,300); }).catch(function(e){alert('Could not discard: '+((e&&e.code)||e));}); }; });
  }
  load();
}
/* ══════════ INVENTORY ARCHITECTURE v2 — Phase 3: Standard vs Actual costing ══════════
   Standard cost = pricing lens (menu margin, food-cost %). Actual COGS stays weighted-average
   (unchanged, already snapshotted per sale into cogsSnapshot). Method 'wac' (default) makes
   standard = live WAC; 'manual' lets you lock a standard that pricing uses independently. */
function openStdCosting(){
  var a=A(); var size=window.__stdSize||'M'; var method=stdCostMethod();
  var mask=document.createElement('div'); mask.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;';
  document.body.appendChild(mask);
  function close(){ if(mask.parentNode)document.body.removeChild(mask); }
  function pctCol(fc){ return fc<=35?'#2a7':(fc<=45?'#c98a2b':'#c0392b'); }
  function draw(){
    size=window.__stdSize||'M'; method=stdCostMethod();
    var items=(typeof menuList==='function'?menuList():[]).slice();
    var sizeBtns=['S','M','L'].map(function(s){return '<button class="pz-btn '+(s===size?'ok':'sec')+'" data-stdsize="'+s+'" style="padding:0.2rem 0.7rem;">'+s+'</button>';}).join(' ');
    var sumFc=0,nFc=0,nUncosted=0,nNoRec=0;
    var rows=items.map(function(it){
      var price=Number(it['price'+size])||0;
      var r=recipeStdCost(it.key,size);
      if(!r.has||it.noRecipe){ if(!it.noRecipe)nNoRec++; return '<tr><td>'+esc(it.name)+'</td><td class="r">'+(price?peso(price):'—')+'</td><td class="r" style="color:var(--tl);">'+(it.noRecipe?'resale':'no recipe')+'</td><td class="r">—</td><td class="r">—</td><td class="r">—</td></tr>'; }
      var cost=r.cost; var gp=price-cost; var gpp=price>0?(gp/price*100):0; var fc=price>0?(cost/price*100):0;
      if(price>0){sumFc+=fc;nFc++;}
      if(!r.covered)nUncosted++;
      return '<tr>'
        +'<td>'+esc(it.name)+(r.covered?'':' <span title="an ingredient has no cost" style="color:#c0392b;">⚠</span>')+'</td>'
        +'<td class="r">'+(price?peso(price):'—')+'</td>'
        +'<td class="r">'+peso(cost)+'</td>'
        +'<td class="r">'+peso(gp)+'</td>'
        +'<td class="r" style="font-weight:600;">'+(price?num(Math.round(gpp*10)/10)+'%':'—')+'</td>'
        +'<td class="r" style="font-weight:600;color:'+pctCol(fc)+';">'+(price?num(Math.round(fc*10)/10)+'%':'—')+'</td>'
      +'</tr>';
    }).join('');
    var avgFc=nFc?Math.round(sumFc/nFc*10)/10:0;
    // ingredient standard vs WAC drift (matters when method=manual or a standard was locked)
    var drift=ings().filter(function(x){return x.stdCost!=null&&x.stdCost!==''&&Math.abs((Number(x.stdCost)||0)-(Number(x.cost)||0))>0.00001;})
      .map(function(x){var d=(Number(x.cost)||0)-(Number(x.stdCost)||0);return '<tr><td>'+esc(x.name)+'</td><td class="r">'+peso(Number(x.stdCost)||0)+'</td><td class="r">'+peso(Number(x.cost)||0)+'</td><td class="r" style="color:'+(d>0?'#c0392b':'#2a7')+';">'+(d>0?'+':'')+peso(d)+'/'+esc(x.unit||'')+'</td></tr>';}).join('');
    mask.innerHTML='<div style="background:#fff;border-radius:10px;max-width:960px;width:100%;max-height:90vh;overflow:auto;padding:1.2rem;">'
      +'<div style="display:flex;justify-content:space-between;align-items:center;"><div style="font-weight:700;color:var(--bd);">📊 Standard costing — pricing &amp; margin</div><button class="pz-btn sec" id="stClose" style="padding:0.2rem 0.6rem;">✕</button></div>'
      +'<p class="pz-sub" style="margin-top:0.3rem;">Expected recipe cost per drink using <b>standard</b> cost, and the margin it implies. Actual COGS on sales stays weighted-average and is unchanged. Options/add-ons are excluded (they’re priced separately); this is the base drink.</p>'
      +'<div style="display:flex;gap:0.8rem;flex-wrap:wrap;align-items:center;background:var(--cd);border-radius:6px;padding:0.5rem 0.7rem;margin-bottom:0.6rem;font-size:0.82rem;">'
        +'<span>Standard cost method: <select class="pz-in" id="stMethod" style="width:auto;display:inline-block;"><option value="wac"'+(method==='wac'?' selected':'')+'>Weighted-average (auto)</option><option value="manual"'+(method==='manual'?' selected':'')+'>Manual / locked</option></select></span>'
        +'<span>Size: '+sizeBtns+'</span>'
        +'<button class="pz-btn sec" id="stSetWac" style="padding:0.2rem 0.6rem;">Set all standards = current WAC</button>'
        +'<button class="pz-btn sec" id="stXls" style="padding:0.2rem 0.6rem;">⬇ Excel</button>'
        +'<span style="margin-left:auto;">Avg food cost: <b style="color:'+pctCol(avgFc)+';">'+num(avgFc)+'%</b>'+(nUncosted?' · <b style="color:#c0392b;">'+nUncosted+' uncosted</b>':'')+'</span>'
      +'</div>'
      +'<div style="overflow-x:auto;"><table class="pz-tbl"><thead><tr><th>Menu item</th><th class="r">Price ('+size+')</th><th class="r">Std cost</th><th class="r">GP ₱</th><th class="r">GP %</th><th class="r">Food %</th></tr></thead><tbody>'+(rows||'<tr><td colspan="6" style="padding:1rem;color:var(--tl);">No menu items with recipes yet.</td></tr>')+'</tbody></table></div>'
      +(method==='manual'?('<div style="margin-top:0.8rem;font-weight:600;color:var(--bd);font-size:0.9rem;">Standard vs actual (WAC) drift — ingredients</div><p class="pz-sub" style="margin-top:0.1rem;">Where your locked standard differs from the live weighted-average. Big gaps = time to refresh the standard.</p><div style="overflow-x:auto;"><table class="pz-tbl"><thead><tr><th>Ingredient</th><th class="r">Standard</th><th class="r">WAC (actual)</th><th class="r">Actual − Std</th></tr></thead><tbody>'+(drift||'<tr><td colspan="4" style="padding:0.6rem;color:var(--tl);">No locked standards differ from WAC.</td></tr>')+'</tbody></table></div>'):'<p class="pz-sub" style="margin-top:0.6rem;">Method is <b>Weighted-average</b>: standard tracks live WAC, so standard = actual. Switch to <b>Manual</b> to lock standards (e.g. a target or replacement cost) and see drift.</p>')
      +'</div>';
    document.getElementById('stClose').onclick=close;
    mask.querySelectorAll('[data-stdsize]').forEach(function(b){b.onclick=function(){window.__stdSize=b.getAttribute('data-stdsize');draw();};});
    document.getElementById('stMethod').onchange=function(){var v=this.value;window.__posSettings=window.__posSettings||{};window.__posSettings.stdCostMethod=v;a.update(a.ref(a.db,'posSettings'),{stdCostMethod:v}).catch(function(e){alert('Could not save method: '+((e&&e.code)||e));});draw();};
    document.getElementById('stSetWac').onclick=function(){ if(!confirm('Set every item’s standard cost to its current weighted-average? This snapshots today’s WAC as the standard (useful before switching to Manual).'))return; var upd={}; ings().forEach(function(x){upd['inventory/'+x.id+'/stdCost']=Number(x.cost)||0;}); a.update(a.ref(a.db),upd).then(function(){alert('Standards set to current WAC for '+Object.keys(upd).length+' item(s).');draw();}).catch(function(e){alert('Could not update: '+((e&&e.code)||e));}); };
    document.getElementById('stXls').onclick=function(){ if(!window.XLSX){alert('Excel library still loading — try again.');return;} var aoa=[['Menu item','Size','Price','Std cost','GP','GP%','Food%','Costed']]; (typeof menuList==='function'?menuList():[]).forEach(function(it){['S','M','L'].forEach(function(s){var price=Number(it['price'+s])||0;var r=recipeStdCost(it.key,s);if(!r.has)return;var gp=price-r.cost;aoa.push([it.name,s,price,r.cost,Math.round(gp*100)/100,price>0?Math.round(gp/price*1000)/10:'',price>0?Math.round(r.cost/price*1000)/10:'',r.covered?'yes':'MISSING']);});}); var wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(aoa),'StdCosting');XLSX.writeFile(wb,'accaza-standard-costing-'+window.AccazaDate.key()+'.xlsx'); };
  }
  draw();
}
function addIngredient(){
  var name=(document.getElementById('invName').value||'').trim(); if(!name){alert('Enter an ingredient name.');return;}
  var type=(document.getElementById('invType')||{}).value||'base';
  var openingStock=Number(document.getElementById('invStock').value)||0, openingCost=Number(document.getElementById('invCost').value)||0;
  if(openingStock<0){alert('Opening stock cannot be negative. Use Adjust for a controlled count correction.');return;}
  if(openingStock>0&&!(document.getElementById('invOpeningConfirmed')||{}).checked){alert('Confirm that this opening stock is physically present and has not already been included in the system’s recorded physical count.');return;}
  if(openingStock>0&&!(openingCost>0)){alert('Enter the opening cost per unit so the physical stock receives the correct inventory value in Finance Books.');return;}
  var inventoryAccount=(document.getElementById('invAssetAccount')||{}).value||'',costAccount=(document.getElementById('invCostAccount')||{}).value||'';if(!inventoryAccount||!costAccount){alert('Choose both the Inventory Asset and Cost account.');return;}
  var maker=(window.__posShift&&window.__posShift.staff)||'Admin',unit=document.getElementById('invUnit').value,openingValue=Math.round(openingStock*openingCost*100)/100;
  if(!confirm('Confirm stock-item setup\n\nItem: '+name+'\nOpening stock: '+openingStock+' '+unit+'\nOpening cost: '+peso(openingCost)+' / '+unit+'\nOpening inventory value: '+peso(openingValue)+'\nMaker: '+maker+'\n\n'+(openingStock>0?'I confirm this stock is physically present and was not already counted or received.':'This creates the item with zero opening stock. Future deliveries must go through Purchases.')))return;
  var o={name:name,unit:document.getElementById('invUnit').value,type:type,recipeItem:!isSupplyType(type),category:(document.getElementById('invCat')||{}).value||'',inventoryAccount:inventoryAccount,costAccount:costAccount,stock:0,reorder:Number(document.getElementById('invReorder').value)||0,cost:0,updatedAt:Date.now()};
  if(type==='consumable'){ o.serves=(document.getElementById('invServes')||{}).value||'both'; o.size=(document.getElementById('invSize')||{}).value||''; o.qtyPerOrder=Number((document.getElementById('invQPO')||{}).value)||1; }
  var a=A(), id=uid('ing_'), sourceId=uid('new_');a.set(a.ref(a.db,'inventory/'+id),o).then(function(){
    return postMovements([{movementId:movementId('manual_edit',sourceId,id),itemId:id,type:'manual_edit',qty:openingStock,unitCost:openingCost,setCost:true,sourceType:'new-inventory-item',sourceId:sourceId,note:'Opening quantity confirmed by '+maker+' when item was created',actorName:maker,occurredAt:Date.now()}]);
  }).then(function(){ document.getElementById('invName').value='';document.getElementById('invStock').value='';document.getElementById('invCost').value='';document.getElementById('invOpeningConfirmed').checked=false; }).catch(function(e){ alert('Could not add the item: '+((e&&e.message)||e)+'. If the item appeared, do not create it again; use Adjust after reviewing the movement ledger.'); });
}
function adjustStock(id){
  var i=inventoryMap[id]; if(!i)return;
  var before=Number(i.stock)||0;
  var mask=document.createElement('div'); mask.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;';
  mask.innerHTML='<div style="background:#fff;border-radius:10px;max-width:420px;width:100%;padding:1.2rem;">'
    +'<div style="font-weight:700;color:var(--bd);margin-bottom:0.2rem;">Adjust stock — '+esc(i.name)+'</div>'
    +'<p class="pz-sub" style="margin:0.2rem 0 0.7rem;">Book stock now: <b>'+num(before)+' '+esc(i.unit||'')+'</b></p>'
    +'<label style="display:block;font-size:0.85rem;margin-bottom:0.35rem;cursor:pointer;"><input type="radio" name="adjmode" value="count" checked/> Enter physical count (system computes the variance)</label>'
    +'<label style="display:block;font-size:0.85rem;margin-bottom:0.6rem;cursor:pointer;"><input type="radio" name="adjmode" value="delta"/> Enter a +/- adjustment (e.g. -3 wastage)</label>'
    +'<div><span class="pz-lbl" id="adjLbl">Physical count ('+esc(i.unit||'units')+')</span><input class="pz-in" id="adjVal" type="number" step="any"/></div>'
    +'<div style="margin-top:0.5rem;"><span class="pz-lbl">Reason</span><select class="pz-in" id="adjReason"><option>count-variance</option><option>wastage</option><option>staff-drink</option><option>extra-cup</option><option>comp</option><option>other</option></select></div>'
    +'<div id="adjPreview" style="margin-top:0.6rem;font-size:0.82rem;color:var(--tm);"></div>'
    +'<div style="display:flex;gap:0.5rem;margin-top:1rem;"><button class="pz-btn ok" id="adjSubmit">Apply adjustment</button><button class="pz-btn sec" id="adjCancel">Cancel</button></div></div>';
  document.body.appendChild(mask);
  function mode(){return (mask.querySelector('input[name=adjmode]:checked')||{}).value||'count';}
  function calcDelta(){var v=Number((mask.querySelector('#adjVal')||{}).value)||0;return mode()==='count'?(v-before):v;}
  function refresh(){var d=calcDelta();var after=before+d;var cost=Number(i.cost)||0;mask.querySelector('#adjLbl').textContent=(mode()==='count'?'Physical count':'Adjustment +/-')+' ('+(i.unit||'units')+')';mask.querySelector('#adjPreview').innerHTML=d?('New stock: <b>'+num(after)+' '+esc(i.unit||'')+'</b> · variance to COGS <b>'+peso(-d*cost)+'</b>'):'';}
  mask.querySelectorAll('input[name=adjmode]').forEach(function(r){r.onchange=refresh;});
  mask.querySelector('#adjVal').oninput=refresh;
  mask.querySelector('#adjCancel').onclick=function(){document.body.removeChild(mask);};
  mask.querySelector('#adjSubmit').onclick=function(){var d=calcDelta();if(!d){alert('No change entered.');return;}var reason=mask.querySelector('#adjReason').value||'other';document.body.removeChild(mask);finalizeAdjust(id,before,d,reason);};
  refresh();
}
function finalizeAdjust(id,before,delta,reason){
  var i=inventoryMap[id]; if(!i)return;
  var after=before+delta; var cost=Number(i.cost)||0; var varianceValue=-delta*cost;  /* stock down = +COGS */
  var a=A(), adjId=uid('adj_'), mid=movementId('adjustment',adjId,id), now=Date.now();
  postMovements([{movementId:mid,itemId:id,type:reason==='wastage'?'waste':'adjustment',qty:delta,unitCost:cost,sourceType:'inventory-adjustment',sourceId:adjId,note:reason,actorName:(window.__posShift&&window.__posShift.staff)||'Admin',occurredAt:now}]).then(function(){
    return a.set(a.ref(a.db,'inventoryAdjustments/'+adjId),{ing:id,name:i.name,unit:i.unit||'',delta:delta,before:before,after:after,reason:reason,unitCost:cost,varianceValue:varianceValue,movementId:mid,ts:now});
  }).then(function(){
  var _invPct=(window.__posSettings&&window.__posSettings.tolerances&&Number(window.__posSettings.tolerances.invPct))||5;
  var _pctMove=before>0?Math.abs(delta)/before*100:(delta!==0?100:0);
  if(_pctMove>_invPct){
    a.set(a.ref(a.db,'discrepancies/'+uid('disc_')),{kind:'inventory',item:i.name,ing:id,expectedQty:before,actualQty:after,variance:delta,value:varianceValue,type:delta<0?'shortage':'overage',staff:(window.__posShift&&window.__posShift.staff)||'Admin',reason:reason,status:'open',ts:Date.now()});
  }
  if(window.__posLog)window.__posLog('inv-adjust',i.name,(delta>0?'+':'')+num(delta)+' '+(i.unit||'')+' · '+reason+' · COGS '+peso(varianceValue));
  alert('Adjusted '+i.name+' to '+num(after)+' '+(i.unit||'')+'.\nVariance to COGS: '+peso(varianceValue)+' ('+reason+').');
  }).catch(function(e){alert('Adjustment FAILED — stock was not changed: '+((e&&e.message)||e));});
}
/* ---------- Recipe Excel export / import ---------- */
function recipesToAOA(){
  var aoa=[['itemKey','itemName','ingredient','unit','qtyS','qtyM','qtyL']];
  menuList().forEach(function(it){ var rec=recipesMap[it.key]; if(!rec||!rec.base||!rec.base.length)return;
    rec.base.forEach(function(b){ var inv=inventoryMap[b.ing]||{};
      aoa.push([it.key,it.name||'',inv.name||'',inv.unit||'',(b.qtyS!=null?b.qtyS:''),(b.qtyM!=null?b.qtyM:''),(b.qtyL!=null?b.qtyL:'')]);
    });
  });
  return aoa;
}
function optionsToAOA(){
  var aoa=[['option','ingredient','qty','unit']];
  Object.keys(optRecipesMap).sort().forEach(function(lb){ var o=optRecipesMap[lb]||{}; var inv=inventoryMap[o.ing]||{}; aoa.push([lb,inv.name||'',(o.qty!=null?o.qty:''),inv.unit||'']); });
  return aoa;
}
function exportRecipesXlsx(){
  if(!window.XLSX){alert('Excel library is still loading — try again in a moment.');return;}
  var wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(recipesToAOA()),'Recipes');
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(optionsToAOA()),'Options');
  XLSX.writeFile(wb,'accaza-recipes-'+window.AccazaDate.key()+'.xlsx');
}
function downloadRecipeTemplate(){
  if(!window.XLSX){alert('Excel library is still loading — try again in a moment.');return;}
  var aoa=[['itemKey','itemName','ingredient','unit','qtyS','qtyM','qtyL']];
  menuList().forEach(function(it){ aoa.push([it.key,it.name||'','','','','','']); aoa.push([it.key,it.name||'','','','','','']); });
  if(aoa.length===1){ aoa.push(['','Latte','Espresso beans','g',18,20,24]); aoa.push(['','Latte','Fresh milk','ml',150,200,250]); }
  var oaoa=[['option','ingredient','qty','unit']];
  allOptionLabels().forEach(function(o){ oaoa.push([o.label,'','','']); });
  if(oaoa.length===1){ oaoa.push(['Extra shot','Espresso beans',9,'g']); }
  var notes=[['Accaza — Recipe import template'],[''],
    ['SHEET "Recipes" = base ingredients per menu item (one row per ingredient).'],
    ['  itemKey  = leave as pre-filled (or blank to match by itemName).'],
    ['  itemName = the exact menu item name.'],
    ['  ingredient = the exact Inventory item name (add it in Inventory first).'],
    ['  qtyS / qtyM / qtyL = quantity used for each size, in that ingredient unit. Blank = none for that size.'],
    ['  Rows are pre-filled with all your menu items (2 blank ingredient rows each) — just type ingredient + quantities.'],
    ['  Importing REPLACES the base list of any item that has at least one filled row. Items with no filled row are left as-is.'],
    [''],
    ['SHEET "Options" = one costing per option, for all sizes.'],
    ['  option = the customer option label (pre-filled from your menu).'],
    ['  ingredient = the Inventory item it consumes ; qty = amount per order.'],
    ['  Blank ingredient/qty rows are ignored (they will NOT delete an existing option).'],
    [''],
    ['Consumables (cups, stirrers) are NOT here — they auto-apply by category. Manage them in Inventory + the Consumables sub-tab.']
  ];
  var wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(aoa),'Recipes');
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(oaoa),'Options');
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(notes),'Instructions');
  XLSX.writeFile(wb,'accaza-recipes-template.xlsx');
}
function importRecipesXlsx(file){
  if(!window.XLSX){alert('Excel library is still loading — try again.');return;}
  var rd=new FileReader();
  rd.onload=function(e){
    try{
      var wb=XLSX.read(e.target.result,{type:'array'});
      var ingByName={}; ings().forEach(function(i){ingByName[(i.name||'').trim().toLowerCase()]=i.id;});
      var itemByName={}; menuList().forEach(function(it){itemByName[(it.name||'').trim().toLowerCase()]=it.key;});
      var mim=A().menuItemsMap||{}; var a=A();
      var recCount=0,recRows=0,optCount=0,missIng={},missItem={},jobs=[];
      var rsh=wb.Sheets['Recipes'];
      if(rsh){
        var grouped={};
        XLSX.utils.sheet_to_json(rsh,{defval:''}).forEach(function(r){
          var key=String(r.itemKey||'').trim();
          if(!key){ var nm=String(r.itemName||'').trim().toLowerCase(); key=nm?(itemByName[nm]||''):''; }
          if(!key||!mim[key]){ if(String(r.itemName||'').trim())missItem[String(r.itemName).trim()]=1; return; }
          var ingName=String(r.ingredient||'').trim(); if(!ingName)return;
          var ingId=ingByName[ingName.toLowerCase()]; if(!ingId){missIng[ingName]=1;return;}
          function q(v){return (v===''||v==null)?null:(Number(v)||0);}
          var inputUnit=String(r.unit||'').trim()||((inventoryMap[ingId]||{}).unit||'');
          (grouped[key]=grouped[key]||[]).push({ing:ingId,unit:inputUnit,dispS:q(r.qtyS),dispM:q(r.qtyM),dispL:q(r.qtyL)}); recRows++;
        });
        Object.keys(grouped).forEach(function(key){
          var rec={base:grouped[key],updatedAt:Date.now()};
          var saved=recipesMap[key]; if(saved&&saved.options)rec.options=saved.options;
          var local=Costing().normalizeRecipe(rec,inventoryMap);if(!local.ok)throw new Error('Recipe '+((mim[key]&&mim[key].name)||key)+': '+costingIssues(local.errors));
          if(!a.validateRecipeDefinition)throw new Error('The 3B recipe validator is not available. Refresh the portal.');
          jobs.push(a.validateRecipeDefinition(rec).then(function(res){var data=res&&res.data?res.data:res;if(!data||!data.recipe)throw new Error('No normalized recipe returned for '+key);return a.set(a.ref(a.db,'recipes/'+key),data.recipe);}));recCount++;
        });
      }
      var osh=wb.Sheets['Options'];
      if(osh){
        XLSX.utils.sheet_to_json(osh,{defval:''}).forEach(function(r){
          var label=String(r.option||'').trim(); if(!label)return;
          var ingName=String(r.ingredient||'').trim(); var qty=Number(r.qty)||0;
          if(!ingName||!qty)return;
          var ingId=ingByName[ingName.toLowerCase()]; if(!ingId){missIng[ingName]=1;return;}
          jobs.push(a.set(a.ref(a.db,'optionRecipes/'+optKey(label)),{label:label,ing:ingId,qty:qty,updatedAt:Date.now()})); optCount++;
        });
      }
      var msg='Recipes imported.\nMenu items updated: '+recCount+' ('+recRows+' ingredient rows)\nOptions set: '+optCount;
      var mi=Object.keys(missItem),mg=Object.keys(missIng);
      if(mi.length)msg+='\n\nUnknown menu items (skipped): '+mi.slice(0,8).join(', ')+(mi.length>8?' …':'');
      if(mg.length)msg+='\n\nUnknown ingredients — add in Inventory first: '+mg.slice(0,8).join(', ')+(mg.length>8?' …':'');
      Promise.all(jobs).then(function(){alert(msg+'\n\nAll recipes were normalized by costing engine '+Costing().VERSION+'.');}).catch(function(err){alert('Import stopped: '+(err&&err.message?err.message:err)+'\n\nSome earlier rows may already have been saved. Fix the error and import again.');});
    }catch(err){alert('Could not read that file: '+err);}
  };
  rd.readAsArrayBuffer(file);
}
/* ---------- Inventory Excel export / import ---------- */
function invColumns(){return ['id','name','type','unit','stock','reorder','cost','serves','size','qtyPerOrder'];}
function invToAOA(){
  var cols=invColumns(); var aoa=[cols];
  ings().forEach(function(i){ var c=ingType(i)==='consumable';
    aoa.push([i.id,i.name||'',ingType(i),i.unit||'',Number(i.stock)||0,Number(i.reorder)||0,(i.cost!=null&&i.cost!==''?Number(i.cost):''),(c?(i.serves||'both'):''),(c?(i.size||''):''),(c?(i.qtyPerOrder!=null?i.qtyPerOrder:1):'')]);
  });
  return aoa;
}
function exportInventoryXlsx(){
  if(!window.XLSX){alert('Excel library is still loading — try again in a moment.');return;}
  var ws=XLSX.utils.aoa_to_sheet(invToAOA());
  var wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'Inventory');
  XLSX.writeFile(wb,'accaza-inventory-'+window.AccazaDate.key()+'.xlsx');
}
function downloadInventoryTemplate(){
  if(!window.XLSX){alert('Excel library is still loading — try again in a moment.');return;}
  var ex=[invColumns(),
    ['','Espresso beans','base','g','',0,0.9,'','',''],
    ['','Fresh milk','base','ml','',0,0.06,'','',''],
    ['','Vanilla syrup','option','pump','',0,3.5,'','',''],
    ['','Medium paper cup','consumable','pcs','',0,2.2,'drink','M',1],
    ['','Stirrer','consumable','pcs','',0,0.3,'drink','',1],
    ['','Pastry box','consumable','pcs','',0,4,'food','',1]
  ];
  var ws=XLSX.utils.aoa_to_sheet(ex);
  var notes=[['Accaza — Inventory import template'],[''],
    ['HOW TO USE'],
    ['1. One row per item. Leave the id column BLANK for new items (fill it only when re-importing an exported file to update exact rows).'],
    ['2. name = required. type = base / option / consumable / operating_supply / office_supply. Supply types are never auto-deducted by recipes.'],
    ['3. unit = g, ml, oz, pcs, shot, pump, ea — use the SAME unit for cost and for recipe quantities.'],
    ['4. cost = price per ONE unit (per g, per ml, per pc). Blank = 0.'],
    ['5. serves / size / qtyPerOrder apply to CONSUMABLES only:'],
    ['      serves = both / drink / food ;  size = S / M / L for cups (blank = all sizes) ;  qtyPerOrder default 1.'],
    ['6. Import matches by id first, else by name (case-insensitive). Blank cells on an EXISTING item are left unchanged (so you will not wipe live stock).'],
    ['7. Delete these example rows, fill your own, Save As .xlsx, then use "⬆ Import Excel" in the Inventory tab.']
  ];
  var wsN=XLSX.utils.aoa_to_sheet(notes);
  var wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'Inventory');
  XLSX.utils.book_append_sheet(wb,wsN,'Instructions');
  XLSX.writeFile(wb,'accaza-inventory-template.xlsx');
}
function importInventoryXlsx(file){
  if(!window.XLSX){alert('Excel library is still loading — try again.');return;}
  var rd=new FileReader();
  rd.onload=function(e){
    try{
      var wb=XLSX.read(e.target.result,{type:'array'});
      var sh=wb.Sheets['Inventory']||wb.Sheets[wb.SheetNames[0]];
      var rows=XLSX.utils.sheet_to_json(sh,{defval:''});
      if(!rows.length){alert('No rows found on the Inventory sheet.');return;}
      var byId={},byName={};
      ings().forEach(function(i){byId[i.id]=i;byName[(i.name||'').trim().toLowerCase()]=i;});
      var created=0,updated=0,skipped=0; var a=A(), writes={}, moves=[];
      var importId='xlsx_'+String(file.name||'inventory').replace(/[^A-Za-z0-9_-]/g,'_').slice(0,70)+'_'+Number(file.lastModified||file.size||0);
      rows.forEach(function(r){
        var name=String(r.name||'').trim(); if(!name){skipped++;return;}
        var id=String(r.id||'').trim();
        var match=(id&&byId[id])||byName[name.toLowerCase()];
        function has(k){return r[k]!==''&&r[k]!=null;}
        var type=has('type')?String(r.type).trim().toLowerCase():(match?ingType(match):'base'); if(['base','option','both','consumable','operating_supply','office_supply'].indexOf(type)<0)type='base';
        var desiredStock=has('stock')?(Number(r.stock)||0):(match?(Number(match.stock)||0):0);
        var desiredCost=has('cost')?(Number(r.cost)||0):(match?(Number(match.cost)||0):0);
        var o=match?{}:{reorder:0};
        o.name=name; o.type=type;o.recipeItem=isSupplyType(type)?false:(match&&match.recipeItem===false?false:true);
        if(has('unit')){var importedUnit=String(r.unit).trim();if(match&&match.ledgerVersion&&uNorm(importedUnit)!==uNorm(match.unit)){throw new Error('Cannot change the unit of ledger item "'+name+'" by import. Create a new item or correct it before ledger initialization.');}o.unit=importedUnit;}
        if(has('reorder'))o.reorder=Number(r.reorder)||0;
        if(type==='consumable'){
          o.serves=has('serves')?String(r.serves).trim().toLowerCase():((match&&match.serves)||'both'); if(['both','drink','food'].indexOf(o.serves)<0)o.serves='both';
          o.size=has('size')?String(r.size).trim().toUpperCase():((match&&match.size)||''); if(['S','M','L'].indexOf(o.size)<0)o.size='';
          o.qtyPerOrder=has('qtyPerOrder')?(Number(r.qtyPerOrder)||1):((match&&match.qtyPerOrder!=null)?match.qtyPerOrder:1);
        }
        o.updatedAt=Date.now();
        var targetId;
        if(match){ targetId=match.id; Object.keys(o).forEach(function(k){writes['inventory/'+targetId+'/'+k]=o[k];}); updated++; byId[targetId]=Object.assign({},match,o); byName[name.toLowerCase()]=byId[targetId]; }
        else { targetId=uid('ing_'); writes['inventory/'+targetId]=Object.assign({},o,{stock:0,cost:0}); created++; var no=Object.assign({id:targetId,stock:0,cost:0},o); byId[targetId]=no; byName[name.toLowerCase()]=no; }
        var oldStock=match?(Number(match.stock)||0):0, oldCost=match?(Number(match.cost)||0):0;
        if(!match||desiredStock!==oldStock||desiredCost!==oldCost){moves.push({movementId:movementId('manual_edit',importId,targetId),itemId:targetId,type:'manual_edit',qty:desiredStock-oldStock,unitCost:desiredCost,setCost:true,sourceType:'inventory-xlsx',sourceId:importId,sourceLine:String(r.id||name),note:'Inventory Excel import',actorName:(window.__posShift&&window.__posShift.staff)||'Admin',occurredAt:Date.now()});}
      });
      a.update(a.ref(a.db),writes).then(function(){return moves.length?postMovements(moves):null;}).then(function(){alert('Import complete.\nCreated: '+created+'\nUpdated: '+updated+'\nLedger movements: '+moves.length+(skipped?'\nSkipped (no name): '+skipped:''));}).catch(function(err){alert('Import FAILED: '+((err&&err.message)||err)+'. The same file is safe to retry.');});
    }catch(err){ alert('Could not read that file: '+err); }
  };
  rd.readAsArrayBuffer(file);
}
function receiveStock(id){
  var i=inventoryMap[id]; if(!i)return;
  var recipeRequired=recipeUsesInventory(id), activeSkus=activeSkusFor(id);
  if(recipeRequired&&!activeSkus.length){alert('“'+i.name+'” is a recipe SKU with no active approved brand. Add a brand before receiving stock.');openSkuManager(id);return;}
  var before=Number(i.stock)||0, oldCost=Number(i.cost)||0, unit=i.unit||'';
  var cf=window.__cf; var accs=(cf&&cf.accounts&&cf.accounts())||[],payAccs=accs.filter(function(x){return !x.disabled;});
  var accOpts=accs.map(function(x){return '<option value="'+esc(x.id)+'"'+(x.disabled?' disabled':'')+'>'+esc(x.name)+' · '+peso(x.balance)+(x.disabled?' · unavailable for purchases':'')+'</option>';}).join('');
  var mask=document.createElement('div'); mask.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;';
  mask.innerHTML='<div style="background:#fff;border-radius:10px;max-width:460px;width:100%;max-height:90vh;overflow:auto;padding:1.2rem;">'
    +'<div style="font-weight:700;color:var(--bd);margin-bottom:0.2rem;">Receive stock — '+esc(i.name)+'</div>'
    +'<p class="pz-sub" style="margin:0.2rem 0 0.7rem;">On hand: <b>'+num(before)+' '+esc(unit)+'</b> · current cost '+peso(oldCost)+' / '+esc(unit||'unit')+'</p>'
    +'<div style="display:flex;gap:0.5rem;flex-wrap:wrap;"><div><span class="pz-lbl">Quantity received ('+esc(unit||'units')+')</span><input class="pz-in" id="rcQty" type="number" step="any" style="width:120px;"/></div><div><span class="pz-lbl">Unit cost ₱ (per '+esc(unit||'unit')+')</span><input class="pz-in" id="rcCost" type="number" step="any" value="'+(oldCost||'')+'" style="width:120px;"/></div></div>'
    +'<div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-top:0.4rem;"><div style="flex:1;min-width:140px;"><span class="pz-lbl">Supplier</span><input class="pz-in" id="rcSup" placeholder="supplier name"/></div><div><span class="pz-lbl">Invoice / ref</span><input class="pz-in" id="rcRef" style="width:130px;"/></div></div>'
    +'<div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-top:0.4rem;"><div><span class="pz-lbl">Date</span><input class="pz-in" id="rcDate" type="date" value="'+window.AccazaDate.key()+'"/></div><div style="flex:1;min-width:140px;"><span class="pz-lbl">Received by</span><input class="pz-in" id="rcBy" value="'+esc((window.__posShift&&window.__posShift.staff)||'Admin')+'"/></div></div>'
    +'<div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-top:0.4rem;"><div class="purchase-sku-cell '+(recipeRequired?'required':'optional')+'" style="flex:1;min-width:180px;"><span class="pz-lbl">Approved brand '+(recipeRequired?'<b>required</b>':'(optional)')+'</span><select class="pz-in" id="rcSku"><option value="">— '+(recipeRequired?'select brand':'no approved brand / legacy receipt')+' —</option>'+activeSkus.map(function(s,ix){return '<option value="'+esc(s.id)+'"'+(recipeRequired&&activeSkus.length===1&&ix===0?' selected':'')+'>'+esc(skuDisplay(s))+'</option>';}).join('')+'</select></div><div style="flex:1;min-width:120px;"><span class="pz-lbl">Brand</span><input class="pz-in" id="rcBrand" placeholder="e.g. Arla"'+(recipeRequired?' readonly':'')+'/></div><div><span class="pz-lbl">Expiry (opt.)</span><input class="pz-in" id="rcExpiry" type="date"/></div><div><span class="pz-lbl">Lot # (opt.)</span><input class="pz-in" id="rcLot" style="width:90px;"/></div></div>'
    +'<label style="display:block;font-size:0.85rem;margin-top:0.6rem;cursor:pointer;"><input type="checkbox" id="rcAvg" checked/> Update item cost to weighted average</label>'
    +'<div style="margin-top:0.6rem;border-top:1px solid var(--cd);padding-top:0.5rem;"><span class="pz-lbl">How was it paid?</span>'
      +'<label style="display:block;font-size:0.85rem;cursor:pointer;"><input type="radio" name="rcPay" value="pending" checked/> Invoice pending — records a provisional supplier obligation</label>'
      +'<label style="display:block;font-size:0.85rem;cursor:pointer;"><input type="radio" name="rcPay" value="paid"'+(payAccs.length?'':' disabled')+'/> Paid now from '+(payAccs.length?('<select class="pz-in" id="rcAcct" style="width:auto;display:inline-block;">'+accOpts+'</select>'):'<span style="color:var(--tl);">(no available Balance Sheet cash account)</span>')+'</label>'
      +'<label style="display:block;font-size:0.85rem;cursor:pointer;"><input type="radio" name="rcPay" value="account"/> On account — creates a Payable, due <input class="pz-in" id="rcDue" type="date" style="width:auto;display:inline-block;"/></label>'
    +'</div>'
    +'<div id="rcPrev" style="margin-top:0.6rem;font-size:0.82rem;color:var(--tm);"></div>'
    +'<div style="display:flex;gap:0.5rem;margin-top:1rem;"><button class="pz-btn ok" id="rcOk">Receive</button><button class="pz-btn sec" id="rcCancel">Cancel</button></div></div>';
  document.body.appendChild(mask);
  function close(){document.body.removeChild(mask);}
  function prev(){var q=Number(mask.querySelector('#rcQty').value)||0;var c=Number(mask.querySelector('#rcCost').value)||0;var tot=Math.round(q*c*100)/100;var navg=(before+q>0)?((before*oldCost+q*c)/(before+q)):c;mask.querySelector('#rcPrev').innerHTML=q?('New stock: <b>'+num(before+q)+' '+esc(unit)+'</b> · total '+peso(tot)+((mask.querySelector('#rcAvg').checked&&c>0)?(' · new avg cost '+peso(Math.round(navg*100)/100)+' / '+esc(unit||'unit')):'')):'';}
  mask.querySelector('#rcQty').oninput=prev; mask.querySelector('#rcCost').oninput=prev; mask.querySelector('#rcAvg').onchange=prev;
  function syncReceiptSku(){var sid=mask.querySelector('#rcSku').value,sk=inventorySkuMap[sid];if(sk)mask.querySelector('#rcBrand').value=sk.brand||'';else if(recipeRequired)mask.querySelector('#rcBrand').value='';}
  mask.querySelector('#rcSku').onchange=syncReceiptSku; syncReceiptSku();
  mask.querySelector('#rcCancel').onclick=close;
  var pendingReceiptId='';
  mask.querySelector('#rcOk').onclick=function(){
    var q=Number(mask.querySelector('#rcQty').value)||0; if(!(q>0)){alert('Enter the quantity received.');return;}
    var c=Number(mask.querySelector('#rcCost').value)||0; var tot=Math.round(q*c*100)/100;
    var sup=(mask.querySelector('#rcSup').value||'').trim(); var ref=(mask.querySelector('#rcRef').value||'').trim();
    var date=mask.querySelector('#rcDate').value||window.AccazaDate.key(); var by=(mask.querySelector('#rcBy').value||'').trim();
    var pay=(mask.querySelector('input[name=rcPay]:checked')||{}).value||'pending';
    var a=A(); var rid=pendingReceiptId||(pendingReceiptId=uid('rcpt_')); var payAcct='', payableId='';
    if(!sup){alert('Enter the supplier. Stock cannot be received without a payment or supplier obligation.');return;}
    if((pay==='account'||pay==='pending')&&!(window.__cf&&window.__cf.addPayable)){alert('Purchase liability service is not ready. Refresh the portal and try again.');return;}
    if(pay==='paid'){ var accEl=mask.querySelector('#rcAcct'); payAcct=accEl?accEl.value:''; if(!payAcct){alert('Pick an account.');return;} }
    var skuId=mask.querySelector('#rcSku').value||'', selectedSku=inventorySkuMap[skuId];
    if(recipeRequired&&(!selectedSku||selectedSku.masterId!==id||selectedSku.active===false)){alert('Select an active approved brand before receiving this recipe item.');return;}
    var brand=selectedSku?(selectedSku.brand||''):(mask.querySelector('#rcBrand').value||'').trim(); var expiry=mask.querySelector('#rcExpiry').value||''; var lot=(mask.querySelector('#rcLot').value||'').trim();
    var now=Date.now(), mid=movementId('purchase',rid,id);
    postMovements([{movementId:mid,itemId:id,type:'purchase',qty:q,unitCost:c,sourceType:'stock-receipt',sourceId:rid,note:(sup||'Supplier')+(ref?' · '+ref:''),actorName:by,occurredAt:now}]).then(function(){
      if(pay==='paid'&&window.__cf&&window.__cf.postOut)return window.__cf.postOut({commandId:'purchase_cash_'+rid,date:date,accountId:payAcct,amount:tot,party:sup||i.name,ref:ref||i.name,category:'Purchases',source:'purchase',linkId:rid,note:'Received '+num(q)+' '+unit+' '+i.name});
      if((pay==='account'||pay==='pending')&&window.__cf&&window.__cf.addPayable){var due=pay==='account'?(mask.querySelector('#rcDue').value||''):'';return window.__cf.addPayable({commandId:'purchase_ap_'+rid,documentId:'ap_'+rid,party:sup||'Supplier',type:pay==='pending'?'inventory_pending_invoice':'inventory',amount:tot,date:date,due:due,ref:ref||('PENDING-'+rid)}).then(function(pid){payableId=pid;});}
      return null;
    }).then(function(){
      var writes={};
      writes['stockReceipts/'+rid]={ing:id,skuId:skuId,skuBrand:brand,name:i.name,unit:unit,qty:q,unitCost:c,total:tot,supplier:sup,brand:brand,ref:ref,date:date,receivedBy:by,payMode:pay,accountId:payAcct,payableId:payableId,movementId:mid,ts:now};
      writes['inventoryBatch/'+('bat_'+now.toString(36)+'_r')]={skuId:skuId,masterId:id,brand:brand,supplier:sup,qtyRecv:q,qtyRemaining:q,unit:unit,unitCost:c,recvDate:date,expiry:expiry,lot:lot,branch:'main',source:'purchase',invoiceId:'',receiptId:rid,createdAt:now};
      return a.update(a.ref(a.db),writes);
    }).then(function(){if(window.__posLog)window.__posLog('stock-receive',i.name,num(q)+' '+unit+' · '+peso(tot)+(pay==='paid'?' · paid':pay==='account'?' · on account':''));close();}).catch(function(e){alert('Receipt did not finish: '+((e&&e.message)||e)+'. Stock or finance may already be posted; the same receipt is safe to retry and cannot double-post.');});
  };
}
/* ══════════ PURCHASES (Goods-Received Note) ══════════
   Function model: receive stock into existing generic items (blends weighted-avg cost)
   or create a new item. Measurement units are dimension-guarded; discrete packaging
   units remain exact-count stock units. Cost is stored at higher precision. Brand rides
   on the receipt/stock card.
   Deduction + recipes untouched — recipes keep costing at the item's blended average. */
function purchBlank(){return {mode:'existing',ing:'',skuId:'',recipeItem:true,newName:'',newUnit:'ml',newType:'base',newInventoryAccount:'',newCostAccount:'',expenseDescription:'',expenseAccount:'6075',assetName:'',assetCategory:'equipment',assetLifeMonths:'60',assetMethod:'straight-line',assetSalvage:'0',assetInServiceDate:window.AccazaDate.key(),assetLocation:'',assetCustodian:'',brand:'',recvUnit:'',qty:'',costMode:'unit',unitCost:'',lineTotal:'',expiry:'',lot:''};}
function purchInit(){ if(!window.__purch){ window.__purch={supplier:'',ref:'',date:window.AccazaDate.key(),by:((window.__posShift&&window.__posShift.staff)||'Admin'),description:'',pay:'pending',acct:'',advanceId:'',due:'',ownerName:'',ownerTreatment:'capital',lines:[purchBlank()]}; } }
function purchaseAdvanceRemaining(x){var allocated=Object.keys(x.allocations||{}).reduce(function(sum,id){return sum+(Number(x.allocations[id]&&x.allocations[id].amount)||0);},0);return Math.max(0,Math.round(((Number(x.amount)||0)-allocated)*100)/100);}
function allPurchaseAdvances(){var rows=[];Object.keys(purchaseShiftMap).forEach(function(shiftId){var s=purchaseShiftMap[shiftId]||{};(s.payOuts||[]).forEach(function(x){if(x&&x.type==='purchase_advance')rows.push(Object.assign({shiftId:shiftId,staff:s.staff||'',advanceSource:'register'},x,{remaining:purchaseAdvanceRemaining(x)}));});});Object.keys(purchaseFundAdvanceMap).forEach(function(id){var x=purchaseFundAdvanceMap[id]||{};if(x.transactionType==='purchase_advance'&&x.status==='approved'&&!x.voided)rows.push(Object.assign({id:id,staff:x.approvedBy||x.createdBy||'',advanceSource:'revolving'},x,{remaining:purchaseAdvanceRemaining(x)}));});return rows.sort(function(a,b){return (b.ts||b.createdAt||0)-(a.ts||a.createdAt||0);});}
function openPurchaseAdvances(){return allPurchaseAdvances().filter(function(x){return x.status!=='cancelled'&&x.remaining>0;});}
function purchaseAdvanceRegisterHtml(){var rows=allPurchaseAdvances();if(!rows.length)return '';return '<div class="pz-h" style="margin-top:1.4rem;">Payments pending inventory allocation</div><p class="pz-sub">Cash has already been paid. Managers allocate each itemized supplier purchase separately; the remaining amount stays unallocated in Finance Books.</p><div class="pz-card" style="overflow:auto;"><table class="pz-table" style="min-width:850px;width:100%;"><thead><tr><th>Paid</th><th>Source / payee</th><th class="r">Payment</th><th>Itemized purchases</th><th class="r">Allocated</th><th class="r">Unallocated</th></tr></thead><tbody>'+rows.map(function(x){var allocations=Object.keys(x.allocations||{}).map(function(id){var a=x.allocations[id]||{},p=purchaseInvoicesMap[id]||{};return '<div><b>'+esc(a.supplier||p.supplier||'Supplier')+'</b> · '+esc(a.ref||p.ref||id)+' · '+peso(a.amount)+'</div>';}).join('')||'<span class="az-note">Pending inventory allocation</span>',allocated=Math.round(((Number(x.amount)||0)-x.remaining)*100)/100,at=x.ts||x.createdAt||0;return '<tr><td>'+esc(at?new Date(at).toLocaleDateString('en-PH'):'—')+'<div class="tiny">'+(x.advanceSource==='revolving'?'Undeposited Collection':esc(x.staff||'Register'))+'</div></td><td><b>'+esc(x.recipient||'—')+'</b><div class="tiny">'+esc(x.purpose||'')+'</div></td><td class="r">'+peso(x.amount)+'</td><td>'+allocations+'</td><td class="r">'+peso(allocated)+'</td><td class="r"><b>'+peso(x.remaining)+'</b></td></tr>';}).join('')+'</tbody></table></div>';}
function purchaseLookup(title){var a=A();if(!a||!a.managePurchaseCorrection)return Promise.reject(new Error('Purchase correction service is unavailable. Refresh the portal.'));return F().run({title:title,subtitle:'Enter the exact supplier invoice reference.',submitLabel:'Find purchase',busyLabel:'Finding purchase…',fields:[{name:'invoiceRef',label:'Invoice / reference',required:true,value:(window.__purch&&window.__purch.ref)||'',maxLength:120}]},function(v){return a.managePurchaseCorrection({action:'lookup',invoiceRef:v.invoiceRef});}).then(function(r){return ((r&&r.data)||r||{}).invoice;});}
function correctedPurchaseDraft(inv){return {supplier:inv.supplier||'',ref:inv.ref||'',date:window.AccazaDate.key(),by:inv.by||((window.__posShift&&window.__posShift.staff)||'Admin'),description:inv.description||'',pay:inv.payMode==='none'?'pending':(inv.payMode||'pending'),acct:'',due:inv.due||'',ownerName:inv.ownerName||'',ownerTreatment:inv.ownerTreatment||'capital',lines:(inv.lines||[]).map(function(x){return x.lineType==='fixed_asset'?Object.assign(purchBlank(),{mode:'asset',assetName:x.itemName||'',assetCategory:x.assetCategory||'equipment',assetLifeMonths:x.usefulLifeMonths||60,assetSalvage:x.salvagePerUnit||0,assetInServiceDate:x.inServiceDate||window.AccazaDate.key(),assetLocation:x.location||'',assetCustodian:x.custodian||'',qty:x.qty||1,costMode:'total',lineTotal:x.total||''}):x.lineType==='expense'?Object.assign(purchBlank(),{mode:'expense',expenseDescription:x.itemName||'',expenseAccount:x.expenseAccount||'6075',qty:x.qty||1,costMode:'total',lineTotal:x.total||''}):Object.assign(purchBlank(),{mode:'existing',ing:x.itemId||'',skuId:x.skuId||'',brand:x.skuBrand||'',recvUnit:x.unit||'',qty:x.qty||'',costMode:'total',lineTotal:x.total||''});})};}
var PURCH_UNITS=['ml','l','g','kg','pcs','pack','box','ream','roll','set'];
function purchCalc(ln){
  if(ln.mode==='expense'||ln.mode==='asset'){var directQty=Number(ln.qty)||0,directTotal=(ln.costMode==='total')?(Number(ln.lineTotal)||0):directQty*(Number(ln.unitCost)||0);return {inv:null,stockUnit:'',recvUnit:'',qty:directQty,stockAdd:0,lineTotal:Math.round(directTotal*100)/100,before:0,oldCost:0,newCost:0};}
  var inv=(ln.mode==='new')?{unit:ln.newUnit||'',stock:0,cost:0}:(inventoryMap[ln.ing]||null);
  if(!inv)return null;
  var recvUnit=(ln.mode==='new')?(ln.newUnit||''):(ln.recvUnit||inv.unit||'');
  if(ln.mode!=='new'&&compatUnits(inv).map(uNorm).indexOf(uNorm(recvUnit))<0)recvUnit=inv.unit||''; /* guard: never convert across dimensions */
  var qty=Number(ln.qty)||0;
  var stockAdd=convertToStock(qty,recvUnit,inv);
  var lineTotal=(ln.costMode==='total')?(Number(ln.lineTotal)||0):qty*(Number(ln.unitCost)||0);
  var before=Number(inv.stock)||0, oldCost=Number(inv.cost)||0;
  var denom=before+stockAdd;
  var newCost=denom>0?((before*oldCost+lineTotal)/denom):(stockAdd>0?lineTotal/stockAdd:0);
  return {inv:inv,stockUnit:inv.unit||'',recvUnit:recvUnit,qty:qty,stockAdd:Math.round(stockAdd*100000)/100000,lineTotal:Math.round(lineTotal*100)/100,before:before,oldCost:oldCost,newCost:Math.round(newCost*100000)/100000};
}
function purchaseAccountOptions(rows){return[{value:'',label:'— Choose an account —'}].concat(rows.map(function(p){return{value:p[0],label:p[0]+' · '+p[1]};}));}
function validPurchaseAccounts(inventoryAccount,costAccount){return ITEM_INVENTORY_ACCOUNTS.some(function(p){return p[0]===inventoryAccount;})&&ITEM_COST_ACCOUNTS.some(function(p){return p[0]===costAccount;});}
function promptPurchaseItemMapping(line,existing){
  var name=(line.newName||existing&&existing.name||'New stock item').trim(),suggested=isSupplyType(line.newType)?(line.newType==='office_supply'?{inventoryAccount:'1280',costAccount:'6075'}:{inventoryAccount:'1270',costAccount:'6070'}):{inventoryAccount:'',costAccount:''},current=existing?invItemAccounts(existing):{inventoryAccount:line.newInventoryAccount||suggested.inventoryAccount,costAccount:line.newCostAccount||suggested.costAccount};
  return F().run({title:'Complete accounting for '+name,subtitle:'Choose where this item is held while in stock and where its cost is recognized when used. The purchase will continue automatically after this mapping is saved.',submitLabel:'Save mapping & continue',busyLabel:'Saving mapping…',fields:[{name:'inventoryAccount',label:'Inventory asset account',type:'select',required:true,value:current.inventoryAccount,options:purchaseAccountOptions(ITEM_INVENTORY_ACCOUNTS),help:'The purchase debits this Inventory Asset account.'},{name:'costAccount',label:'Cost / COGS account',type:'select',required:true,value:current.costAccount,options:purchaseAccountOptions(ITEM_COST_ACCOUNTS),help:'Usage or sale later debits this cost or operating-expense account.'},{name:'confirmed',label:'I reviewed the asset and cost treatment for this item',type:'checkbox',required:true}]},function(v){
    if(!validPurchaseAccounts(v.inventoryAccount,v.costAccount))throw new Error('Choose valid Inventory Asset and Cost accounts.');
    var targetName=uNorm(line.newName||existing&&existing.name||'');((window.__purch&&window.__purch.lines)||[line]).forEach(function(candidate){if(candidate.mode==='new'&&uNorm(candidate.newName||'')===targetName){candidate.newInventoryAccount=v.inventoryAccount;candidate.newCostAccount=v.costAccount;}});
    if(!existing)return v;
    return A().update(A().ref(A().db,'inventory/'+existing.id),{inventoryAccount:v.inventoryAccount,costAccount:v.costAccount,cogsAccount:null,updatedAt:Date.now()}).then(function(){if(inventoryMap[existing.id]){inventoryMap[existing.id].inventoryAccount=v.inventoryAccount;inventoryMap[existing.id].costAccount=v.costAccount;inventoryMap[existing.id].cogsAccount=null;}return v;});
  });
}
function purchasePaymentAccountLabel(id){if(id==='cash_on_hand'||id==='register')return 'Cash on Hand (excluding protected float)';if(id==='undeposited')return 'Undeposited Collection';var rows=(window.__cf&&window.__cf.accounts&&window.__cf.accounts())||[],row=rows.find(function(x){return x.id===id;});return row&&row.name||id||'cash account';}
function purchaseStatusLabel(p){if(p.reversed)return 'Reversed';if(p.payMode==='owner_funded')return 'Paid personally by '+(p.ownerName||'owner/partner')+' · '+(p.ownerTreatment==='reimburse'?'reimburse later':'capital contribution');if(p.payMode==='advance')return 'Allocated from payment pending inventory allocation';if(p.payMode==='paid')return 'Paid · '+purchasePaymentAccountLabel(p.paymentAccountId||p.accountId);if(p.payMode==='account')return 'On account';if(p.payMode==='pending')return 'Invoice pending';return 'Legacy — liability missing';}
var showReversedPurchases=false;
function purchaseHistoryHtml(){var allRows=Object.keys(purchaseInvoicesMap).map(function(id){return Object.assign({id:id},purchaseInvoicesMap[id]);}).sort(function(a,b){return (Number(b.ts)||0)-(Number(a.ts)||0);}),reversedCount=allRows.filter(function(p){return p.reversed;}).length,rows=allRows.filter(function(p){return showReversedPurchases||!p.reversed;}).slice(0,100),toggle=reversedCount?'<button class="pz-btn sec" data-purchase-toggle-reversed style="margin-left:auto;">'+(showReversedPurchases?'Hide reversed':'Show reversed ('+reversedCount+')')+'</button>':'';return '<div style="display:flex;align-items:center;gap:.6rem;margin-top:1.4rem;"><div class="pz-h">Purchase history</div>'+toggle+'</div><p class="pz-sub">Active purchase records are shown by default. Reversed records remain safely available in the audit trail.</p><div class="pz-card" style="overflow:auto;"><table class="pz-table" style="min-width:980px;width:100%;font-size:0.82rem;"><thead><tr><th>Date</th><th>Supplier</th><th>Reference</th><th>Status</th><th class="r">Amount</th><th>Actions</th></tr></thead><tbody>'+(rows.length?rows.map(function(p){var actions='<button class="pz-btn sec" data-purchase-details="'+esc(p.id)+'">Details</button>';if(!p.reversed)actions+=' <button class="pz-btn sec" data-purchase-edit="'+esc(p.id)+'">Edit details</button> <button class="pz-btn ok" data-purchase-amend="'+esc(p.id)+'">Amend</button>';if(!p.reversed&&p.payMode==='pending')actions+=' <button class="pz-btn ok" data-purchase-finalize="'+esc(p.id)+'">Finalize invoice</button>';if(!p.reversed&&p.payMode==='none')actions+=' <button class="pz-btn ok" data-purchase-link="'+esc(p.id)+'">Link existing payable</button>';if(!p.reversed&&p.payMode==='account'&&!p.payableId)actions+=' <button class="pz-btn ok" data-purchase-repair="'+esc(p.id)+'">Repair payable</button>';return '<tr><td>'+esc(p.date||'—')+'</td><td>'+esc(p.supplier||'—')+'</td><td>'+esc(p.ref||p.id)+'</td><td>'+esc(purchaseStatusLabel(p))+'</td><td class="r">'+peso(p.total)+'</td><td style="white-space:nowrap;">'+actions+'</td></tr>';}).join(''):'<tr><td colspan="6">No active purchases recorded.</td></tr>')+'</tbody></table></div>';}
function showPurchaseDetails(id){var p=purchaseInvoicesMap[id];if(!p)return;var old=document.getElementById('purchaseDetailsMask');if(old)old.remove();var m=document.createElement('div');m.id='purchaseDetailsMask';m.className='pz-mask show';var lines=(p.lines||[]).map(function(x){var treatment=x.lineType==='fixed_asset'?((x.assetCategory==='furniture'?'1510 · Furniture & Fixtures':'1500 · Equipment')+' · '+x.usefulLifeMonths+' months'):x.lineType==='expense'?((x.expenseAccount==='6070'?'6070 · Operating Supplies':'6075 · Office Supplies')+' · expensed'):(x.skuBrand||'Inventory');return '<tr><td>'+esc(x.itemName||x.itemId||'')+'</td><td>'+esc(treatment)+'</td><td class="r">'+num(x.qty)+' '+esc(x.unit||'')+'</td><td class="r">'+peso(x.total)+'</td></tr>';}).join('');m.innerHTML='<div class="pz-modal" style="max-width:720px;"><div style="display:flex;justify-content:space-between;gap:1rem;"><div><div class="pz-lbl">Purchase record</div><div class="pz-h">'+esc(p.supplier||'Supplier')+'</div><div>'+esc(p.ref||id)+'</div></div><button class="pz-btn sec" data-purchase-close>✕</button></div><div class="pz-card" style="margin-top:0.8rem;"><b>'+peso(p.total)+'</b> · '+esc(purchaseStatusLabel(p))+'<br><span class="pz-sub">Purchase ID: '+esc(id)+' · Created '+esc(p.ts?new Date(Number(p.ts)).toLocaleString('en-PH'):'—')+'<br>Received '+esc(p.date||'—')+' by '+esc(p.by||'—')+(p.due?' · Due '+esc(p.due):'')+(p.description?'<br>Description: '+esc(p.description):'')+(p.payableId?'<br>Linked payable: '+esc(p.payableId):'')+'</span></div><table class="pz-table" style="width:100%;"><thead><tr><th>Item / expense / asset</th><th>Treatment</th><th class="r">Quantity</th><th class="r">Amount</th></tr></thead><tbody>'+lines+'</tbody></table><button class="pz-btn ok" data-purchase-close style="width:100%;margin-top:0.8rem;">Close</button></div>';document.body.appendChild(m);m.querySelectorAll('[data-purchase-close]').forEach(function(b){b.onclick=function(){m.remove();};});}
function renderPurchases(){
  var root=document.getElementById('purchasesRoot'); if(!root)return;
  purchInit(); var P=window.__purch;
  var cf=window.__cf; var accs=(cf&&cf.accounts&&cf.accounts())||[],payAccs=accs.filter(function(x){return !x.disabled;});
  var advances=openPurchaseAdvances(),advanceOpts=advances.map(function(x){return '<option value="'+esc(x.id)+'"'+(P.advanceId===x.id?' selected':'')+'>'+peso(x.remaining)+' remaining of '+peso(x.amount)+' · '+esc(x.recipient||'')+' · '+esc(x.purpose||'')+' ('+(x.advanceSource==='revolving'?'Revolving Fund':esc(x.staff||'register shift'))+')</option>';}).join('');
  if(P.acct&&!payAccs.some(function(x){return x.id===P.acct;}))P.acct='';
