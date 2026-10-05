function editIngredient(id){
  var i=inventoryMap[id]; if(!i)return;
  var ty=ingType(i), manualStd=stdCostMethod()==='manual';
  var units=['g','kg','ml','L','fl oz','pcs','shot','pump','ea','box','pack'];
  var eCats=invCats();
  var uOpts=(units.indexOf(i.unit||'')<0&&(i.unit||'')?'<option selected>'+esc(i.unit)+'</option>':'')+units.map(function(u){return '<option'+(u===(i.unit||'')?' selected':'')+'>'+u+'</option>';}).join('');
  var mask=document.createElement('div');mask.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;';
  mask.innerHTML='<style>.ei-dialog{background:#fff;border-radius:14px;max-width:720px;width:100%;max-height:92vh;overflow:auto;box-shadow:0 22px 60px rgba(20,35,27,.28);border:1px solid #d9cbb9}.ei-head{padding:1.15rem 1.3rem 1rem;border-bottom:1px solid #e7ddd0;background:#fbfaf7}.ei-eyebrow{font-size:.67rem;font-weight:800;letter-spacing:.13em;text-transform:uppercase;color:#8b6746}.ei-title{font-size:1.18rem;font-weight:750;color:var(--bd);margin:.15rem 0 0}.ei-body{padding:1rem 1.3rem 1.2rem}.ei-section{border:1px solid #e3d8ca;border-radius:10px;padding:.85rem;margin-bottom:.75rem;background:#fff}.ei-section-title{font-size:.73rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#5f4b3d;margin-bottom:.65rem}.ei-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.7rem}.ei-wide{grid-column:1/-1}.ei-readout{border:1px solid #d9cbb9;border-radius:8px;padding:.65rem .75rem;background:#f7f4ee}.ei-readout strong{display:block;font-size:1.02rem;color:var(--bd);margin-top:.15rem}.ei-help{font-size:.72rem;line-height:1.42;color:var(--tl);margin-top:.3rem}.ei-actions{display:flex;justify-content:flex-end;gap:.55rem;padding-top:.25rem}.ei-close{border:0;background:transparent;color:#725d4b;font-size:1.15rem;cursor:pointer;padding:.25rem .4rem}.ei-close:focus-visible,.ei-dialog input:focus-visible,.ei-dialog select:focus-visible,.ei-dialog button:focus-visible{outline:3px solid rgba(38,115,84,.24);outline-offset:2px}@media(max-width:580px){.ei-grid{grid-template-columns:1fr}.ei-wide{grid-column:auto}.ei-body,.ei-head{padding-left:.9rem;padding-right:.9rem}}</style>'
    +'<div class="ei-dialog" role="dialog" aria-modal="true" aria-labelledby="eiTitle">'
      +'<div class="ei-head"><div style="display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;"><div><div class="ei-eyebrow">Stock item master</div><h2 class="ei-title" id="eiTitle">Edit '+esc(i.name)+'</h2></div><button class="ei-close" id="eiClose" aria-label="Close">✕</button></div><p class="pz-sub" style="margin:.4rem 0 0;">Maintain the item definition here. Inventory balances and actual costs remain controlled by the stock ledger.</p></div>'
      +'<div class="ei-body">'
        +'<section class="ei-section"><div class="ei-section-title">Item details</div><div class="ei-grid">'
          +'<label class="ei-wide"><span class="pz-lbl">Item name</span><input class="pz-in" id="eiName" value="'+esc(i.name||'')+'"/></label>'
          +'<label><span class="pz-lbl">Type</span><select class="pz-in" id="eiType">'+inventoryTypeOptions(ty)+'</select></label>'
          +'<label><span class="pz-lbl">Category</span><select class="pz-in" id="eiCat"><option value="">Uncategorized</option>'+eCats.map(function(c){return '<option value="'+esc(c.id)+'"'+((i.category||'')===c.id?' selected':'')+'>'+esc(c.name)+'</option>';}).join('')+'</select></label>'
          +'<label><span class="pz-lbl">Inventory unit'+(i.ledgerVersion?' · locked':'')+'</span><select class="pz-in" id="eiUnit"'+(i.ledgerVersion?' disabled title="The unit is locked after ledger initialization"':'')+'>'+uOpts+'</select><div class="ei-help">'+(i.ledgerVersion?'Locked to protect the movement history.':'The base unit used by purchases, recipes, and stock cards.')+'</div></label>'
          +'<label><span class="pz-lbl">Reorder point</span><input class="pz-in" id="eiReorder" type="number" min="0" step="any" value="'+(Number(i.reorder)||0)+'"/><div class="ei-help">Low-stock warning begins at this balance.</div></label>'
        +'</div></section>'
        +'<section class="ei-section"><div class="ei-section-title">Accounting assignment</div><div class="ei-grid">'
          +'<label><span class="pz-lbl">Inventory asset account</span><select class="pz-in" id="eiAssetAccount">'+itemAccountOptions(invItemAccounts(i).inventoryAccount,'inventory')+'</select><div class="ei-help">Where this individual item’s on-hand value appears in Books.</div></label>'
          +'<label><span class="pz-lbl">Cost / COGS account</span><select class="pz-in" id="eiCostAccount">'+itemAccountOptions(invItemAccounts(i).costAccount,'cost')+'</select><div class="ei-help">Recipe items use COGS; cleaning and office stock may use an overhead expense.</div></label>'
        +'</div></section>'
        +'<section class="ei-section"><div class="ei-section-title">Inventory control</div><div class="ei-grid">'
          +'<div class="ei-readout"><span class="pz-lbl">Current balance</span><strong>'+num(Number(i.stock)||0)+' '+esc(i.unit||'')+'</strong><div class="ei-help">Calculated from posted inventory movements.</div></div>'
          +'<div class="ei-readout"><span class="pz-lbl">Actual cost · weighted average</span><strong>'+peso(Number(i.cost)||0)+' / '+esc(i.unit||'unit')+'</strong><div class="ei-help">Calculated automatically from received purchases and used by actual COGS.</div></div>'
          +'<div class="ei-wide" style="display:flex;align-items:center;justify-content:space-between;gap:.75rem;padding-top:.05rem;"><div class="ei-help" style="margin:0;max-width:430px;">Count corrections, wastage, and stock variances belong in the audited adjustment workflow.</div><button class="pz-btn sec" id="eiAdjust" type="button" style="white-space:nowrap;">Adjust stock</button></div>'
        +'</div></section>'
        +'<section class="ei-section"><div class="ei-section-title">Planning cost</div><div class="ei-grid">'
          +'<label><span class="pz-lbl">Standard cost per unit ₱</span><input class="pz-in" id="eiStd" type="number" min="0" step="any" value="'+(i.stdCost!=null&&i.stdCost!==''?i.stdCost:'')+'" placeholder="Uses actual WAC"'+(manualStd?'':' disabled')+'/><div class="ei-help">'+(manualStd?'Used for pricing and margin planning. Leave blank to fall back to actual WAC.':'Standard costing is set to Weighted-average, so it follows the actual WAC automatically.')+'</div></label>'
          +'<div class="ei-readout"><span class="pz-lbl">Costing method</span><strong>'+(manualStd?'Manual standard':'Weighted-average · automatic')+'</strong><div class="ei-help">Change this method from Standard Costing on the Stock Items page.</div></div>'
        +'</div></section>'
        +'<section class="ei-section" id="eiCons" style="display:'+(ty==='consumable'?'block':'none')+';"><div class="ei-section-title">Consumption rule</div><div class="ei-grid">'
          +'<label><span class="pz-lbl">Used for</span><select class="pz-in" id="eiServes"><option value="both"'+((i.serves||'both')==='both'?' selected':'')+'>Drinks and food</option><option value="drink"'+(i.serves==='drink'?' selected':'')+'>Drinks</option><option value="food"'+(i.serves==='food'?' selected':'')+'>Food</option></select></label>'
          +'<label><span class="pz-lbl">Applicable size</span><select class="pz-in" id="eiSize"><option value="">All sizes</option><option'+(i.size==='S'?' selected':'')+'>S</option><option'+(i.size==='M'?' selected':'')+'>M</option><option'+(i.size==='L'?' selected':'')+'>L</option></select></label>'
          +'<label><span class="pz-lbl">Quantity per order</span><input class="pz-in" id="eiQPO" type="number" min="0" step="any" value="'+(i.qtyPerOrder!=null?i.qtyPerOrder:1)+'"/></label>'
        +'</div></section>'
        +'<div class="ei-actions"><button class="pz-btn sec" id="eiCancel">Cancel</button><button class="pz-btn ok" id="eiSave">Save changes</button></div>'
      +'</div></div>';
  document.body.appendChild(mask);
  var keyClose;
  function close(){if(keyClose)document.removeEventListener('keydown',keyClose);if(mask.parentNode)document.body.removeChild(mask);}
  mask.querySelector('#eiType').onchange=function(){mask.querySelector('#eiCons').style.display=(this.value==='consumable')?'block':'none';};
  mask.querySelector('#eiClose').onclick=close;
  mask.querySelector('#eiCancel').onclick=close;
  mask.querySelector('#eiAdjust').onclick=function(){close();adjustStock(id);};
  mask.onclick=function(e){if(e.target===mask)close();};
  keyClose=function(e){if(e.key==='Escape')close();};document.addEventListener('keydown',keyClose);
  mask.querySelector('#eiSave').onclick=function(){
    var type=mask.querySelector('#eiType').value;
    var _stdRaw=(mask.querySelector('#eiStd')||{}).value;
    var inventoryAccount=mask.querySelector('#eiAssetAccount').value,costAccount=mask.querySelector('#eiCostAccount').value;if(!inventoryAccount||!costAccount){alert('Choose both the Inventory Asset and Cost account.');return;}
    var upd={name:(mask.querySelector('#eiName').value||'').trim()||i.name,unit:mask.querySelector('#eiUnit').value,type:type,recipeItem:isSupplyType(type)?false:(i.recipeItem===true),category:(mask.querySelector('#eiCat')||{}).value||'',inventoryAccount:inventoryAccount,costAccount:costAccount,cogsAccount:null,reorder:Number(mask.querySelector('#eiReorder').value)||0,updatedAt:Date.now()};
    if(manualStd)upd.stdCost=(_stdRaw===''||_stdRaw==null)?null:(Number(_stdRaw)||0);
    if(type==='consumable'){upd.recipeItem=true;upd.serves=mask.querySelector('#eiServes').value;upd.size=mask.querySelector('#eiSize').value;upd.qtyPerOrder=Number(mask.querySelector('#eiQPO').value)||1;}else if(isSupplyType(type)){upd.serves=null;upd.size=null;upd.qtyPerOrder=null;}
    A().update(A().ref(A().db,'inventory/'+id),upd).then(close).catch(function(e){alert('Could not save: '+((e&&e.message)||e)+'.');});
  };
  return;
}
function delIngredient(id){
  var i=inventoryMap[id]; if(!i)return;
  if(i.ledgerVersion){alert('Cannot delete "'+i.name+'" after ledger initialization. Its movement history must remain linked to a real item. Create a replacement item and stop using this one instead.');return;}
  var refs=ingredientRefs(id);
  if(refs.length){ alert('Cannot delete "'+i.name+'" — it is still used by '+refs.length+' recipe/option'+(refs.length===1?'':'s')+':\n\n'+refs.slice(0,25).join('\n')+(refs.length>25?'\n…and '+(refs.length-25)+' more':'')+'\n\nRemove it from these (or repoint them to the correct item) first. This keeps every recipe linked to a real inventory item.'); return; }
  if(!confirm('Delete "'+i.name+'"? It is not used by any recipe.'))return;
  var a=A();a.remove(a.ref(a.db,'inventory/'+id));
}
function openCatManager(){
  var mask=document.createElement('div'); mask.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;';
  function draw(){
    var cats=invCats();
    var rows=cats.map(function(c){return '<div style="display:flex;gap:0.4rem;align-items:center;margin-bottom:0.35rem;" data-catrow="'+esc(c.id)+'"><input class="pz-in" data-cf="name" value="'+esc(c.name)+'" style="flex:1;"/><select class="pz-in" data-cf="kind" style="width:190px;"><option value="cogs"'+(c.kind!=='overhead'?' selected':'')+'>Recipe / product</option><option value="overhead"'+(c.kind==='overhead'?' selected':'')+'>Overhead supply</option></select><button class="pz-btn warn" data-catdel="'+esc(c.id)+'" style="padding:0.2rem 0.5rem;">✕</button></div>';}).join('');
    mask.innerHTML='<div style="background:#fff;border-radius:10px;max-width:560px;width:100%;max-height:90vh;overflow:auto;padding:1.2rem;">'
      +'<div style="display:flex;justify-content:space-between;align-items:center;"><div style="font-weight:700;color:var(--bd);">🗂 Inventory categories</div><button class="pz-btn sec" id="cmClose" style="padding:0.2rem 0.6rem;">✕</button></div>'
      +'<p class="pz-sub" style="margin:0.3rem 0 0.6rem;">Categories are only organizational labels for filtering and usage treatment. Assign Inventory Asset and Cost accounts on each individual stock item.</p>'
      +'<div data-catrows>'+(rows||'<div style="color:var(--tl);font-size:0.8rem;">No categories yet.</div>')+'</div>'
      +'<div style="display:flex;gap:0.4rem;margin-top:0.5rem;"><input class="pz-in" id="cmNew" placeholder="new category name" style="flex:1;"/><select class="pz-in" id="cmNewKind" style="width:170px;"><option value="cogs">Product cost (COGS)</option><option value="overhead">Overhead</option></select><button class="pz-btn sec" id="cmAdd">+ Add</button></div>'
      +'<div style="display:flex;gap:0.5rem;margin-top:1rem;"><button class="pz-btn ok" id="cmSave">💾 Save</button><button class="pz-btn sec" id="cmClose2">Close</button></div></div>';
    var a=A();
    mask.querySelector('#cmAdd').onclick=function(){var nm=(mask.querySelector('#cmNew').value||'').trim();if(!nm){alert('Type a category name.');return;}var k=mask.querySelector('#cmNewKind').value;var o={};o[uid('cat_')]={name:nm,kind:k,order:invCats().length};a.update(a.ref(a.db,'posSettings/invCategories'),o);setTimeout(draw,250);};
    mask.querySelectorAll('[data-catdel]').forEach(function(b){b.onclick=function(){var id=b.getAttribute('data-catdel');var used=ings().filter(function(x){return (x.category||'')===id;}).length;if(used&&!confirm(used+' item(s) use this category. Delete it anyway? Those items just lose the label.'))return;a.remove(a.ref(a.db,'posSettings/invCategories/'+id));setTimeout(draw,250);};});
    mask.querySelector('#cmSave').onclick=function(){var ups={};mask.querySelectorAll('[data-catrow]').forEach(function(r,ix){var id=r.getAttribute('data-catrow'),nm=(r.querySelector('[data-cf="name"]').value||'').trim(),k=r.querySelector('[data-cf="kind"]').value;if(nm)ups[id]={name:nm,kind:k,inventoryAccount:null,cogsAccount:null,order:ix};});a.update(a.ref(a.db,'posSettings/invCategories'),ups).then(function(){if(isTab('inventory'))renderInventory();alert('Categories saved. Accounting assignments remain on each stock item.');}).catch(function(e){alert('Could not save: '+((e&&e.code)||e));});};
    var c1=mask.querySelector('#cmClose'),c2=mask.querySelector('#cmClose2');function close(){document.body.removeChild(mask);}if(c1)c1.onclick=close;if(c2)c2.onclick=close;
  }
  document.body.appendChild(mask); draw();
}
/* One-click: relabel any item stocked in ambiguous "oz"/"ounce" to "fl oz" (fluid ounce = volume),
   so ml/L conversion works in recipes. Quantity is unchanged; only the unit label changes.
   Use only for liquids — a weight-ounce item should be set to g/kg instead. */
function migrateOzToFloz(){
  var items=ings().filter(function(i){var u=uNorm(i.unit);return u==='oz'||u==='ounce';});
  if(!items.length){alert('No items are using oz / ounce.');return;}
  if(!confirm('Convert '+items.length+' item(s) from oz/ounce to "fl oz" (fluid ounce)?\n\n'+items.map(function(i){return '• '+i.name;}).join('\n')+'\n\nThe stock number stays the same — this only makes the unit a proper volume so ml/L conversion works. Use this only if these are liquids.'))return;
  var a=A();
  items.forEach(function(i){ a.update(a.ref(a.db,'inventory/'+i.id),{unit:'fl oz',updatedAt:Date.now()}); });
  if(window.__posLog)window.__posLog('unit-migrate','oz → fl oz',items.length+' item(s)');
  alert('Converted '+items.length+' item(s) to fl oz. ✅ You can now enter ml/L in their recipes.');
}
function updateLowStockBadge(){
  var n=ings().filter(function(i){return !ingIsArchived(i)&&Number(i.stock)<=Number(i.reorder||0);}).length;
  var b=document.getElementById('lowStockBadge'); if(!b)return;
  if(n>0){b.textContent=n;b.style.display='inline-block';}else{b.style.display='none';}
}

/* ══════════ RECIPES ══════════ */
