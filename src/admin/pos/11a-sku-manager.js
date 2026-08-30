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
