function exportCostSheet(){
  if(!window.XLSX){alert('Excel library is still loading — try again.');return;}
  function r4(n){return Math.round((Number(n)||0)*10000)/10000;}
  var aoa=[['Category','Item','Line','Type','Unit','S qty','S cost','M qty','M cost','L qty','L cost']];
  menuList().forEach(function(it){
    var rec=recipesMap[it.key]; if(!rec)return;
    var cat=it.cat||''; var catL=(A().getCatLabel?A().getCatLabel(cat):cat)||cat;
    var totS=0,totM=0,totL=0;
    (rec.base||[]).forEach(function(b){ if(!b.ing)return; var inv=inventoryMap[b.ing]||{}; var uc=Number(inv.cost)||0;
      var qs=baseQtyForSize(rec,b,'S'),qm=baseQtyForSize(rec,b,'M'),ql=baseQtyForSize(rec,b,'L');
      var cs=qs*uc,cm=qm*uc,cl=ql*uc; totS+=cs;totM+=cm;totL+=cl;
      var du=b.unit||inv.unit||''; var ds=(b.dispS!=null?b.dispS:qs),dm=(b.dispM!=null?b.dispM:qm),dl=(b.dispL!=null?b.dispL:ql);
      aoa.push([catL,it.name,inv.name||b.ing,'base',du,ds||'',r4(cs),dm||'',r4(cm),dl||'',r4(cl)]);
    });
    aoa.push(['',it.name,'COST PER DRINK','','','',r4(totS),'',r4(totM),'',r4(totL)]);
    aoa.push([]);
  });
  if(aoa.length<=1){alert('No recipes yet to build a cost sheet.');return;}
  var wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(aoa),'CostSheet');XLSX.writeFile(wb,'accaza-cost-sheet-'+window.AccazaDate.key()+'.xlsx');
}
function optKey(label){return String(label).replace(/[.#$\[\]\/]/g,'_');}
function allOptionLabels(){
  var seen={},out=[];
  menuList().forEach(function(it){ (optLabelsForItem(it)||[]).forEach(function(o){ if(o.label&&!seen[o.label]){seen[o.label]=1;out.push(o);} }); });
  return out.sort(function(a,b){return (a.label||'').localeCompare(b.label||'');});
}
function ocSync(){
  var root=document.getElementById('optMasterRoot'); if(!root)return;
  var next={};
  root.querySelectorAll('[data-oc-row]').forEach(function(tr){
    var g=tr.getAttribute('data-oc-g'), lk=tr.getAttribute('data-oc-l'), lbl=tr.getAttribute('data-oc-label')||'';
    var ing=(tr.querySelector('[data-ocf="ing"]')||{}).value||'';
    if(!ing)return;
    var item=inventoryMap[ing]||{},unitEl=tr.querySelector('[data-ocf="unit"]'),u=(unitEl&&unitEl.value)||item.unit||'';function v(f){var el=tr.querySelector('[data-ocf="'+f+'"]');return (el&&el.value!=='')?Number(el.value):0;}
    next[g]=next[g]||{}; next[g][lk]=next[g][lk]||{label:lbl,ings:[]};
    var scope=sharedChoiceScopeFromRow(tr,recipeTemperatureGroup(ocGroups())),row={ing:ing,unit:u,op:tr.getAttribute('data-oc-op')||undefined,when:Object.keys(scope.when).length?scope.when:undefined,useFor:scope.useFor};['S','M','L'].forEach(function(sz){var display=v('disp'+sz);row['disp'+sz]=display;row['qty'+sz]=convertToStock(display,u,item);});next[g][lk].ings.push(row);
  });
  window.__optCostDraft=next;
}
function ocDraw(){
  var root=document.getElementById('optMasterRoot'); if(!root)return;
  var d=window.__optCostDraft||{};
  var tempGroup=recipeTemperatureGroup(ocGroups());
  var invList=ingsActive().slice().sort(function(a,b){return (a.name||'').localeCompare(b.name||'');});
  function ingSel(val){return '<select class="pz-in" data-ocf="ing" style="min-width:150px;"><option value="">— ingredient —</option>'+invList.map(function(i){var blocked=isPackagingCostItem(i.id)&&i.id!==val;return '<option value="'+i.id+'"'+(i.id===val?' selected':'')+(blocked?' disabled':'')+'>'+esc(i.name)+' ('+esc(i.unit||'')+') · '+(blocked?'Packaging Costing only':ingType(i))+'</option>';}).join('')+'</select>';}
  var cards=ocGroups().map(function(g){
    var badge=(g.required?'required':'optional')+' · '+(g.type==='multi'?'multi-select':'single');
    var choices=(g.choices||[]).map(function(c){
      var lk=optKey(c.label); var rows=(d[g.id]&&d[g.id][lk]&&d[g.id][lk].ings)||[];
      var ingRows=rows.map(function(r,ix){
        var item=inventoryMap[r.ing]||{},u=r.unit||item.unit||'',units=compatUnits(item);function shown(sz){if(r['disp'+sz]!=null)return r['disp'+sz];var cv=Costing().convert(Number(r['qty'+sz])||0,item.unit||u,u);return cv.ok?cv.qty:r['qty'+sz];}
        var scope=sharedChoiceTemperatureScope(r,rows,tempGroup,g.id);
        return '<tr data-oc-row data-oc-g="'+esc(g.id)+'" data-oc-l="'+esc(lk)+'" data-oc-label="'+esc(c.label)+'" data-oc-op="'+esc(r.op||'')+'" data-oc-ix="'+ix+'">'
          +'<td>'+ingSel(r.ing)+scope.html+'</td>'
          +'<td><select class="pz-in" data-ocf="unit" style="width:78px">'+units.map(function(x){return '<option'+(uNorm(x)===uNorm(u)?' selected':'')+'>'+esc(x)+'</option>';}).join('')+'</select><small style="display:block;color:var(--tl)">stock: '+esc(item.unit||'—')+'</small></td>'
          +['S','M','L'].map(function(sz){return '<td><input class="pz-in" type="number" step="any" style="width:64px;" data-ocf="disp'+sz+'" value="'+(shown(sz)!=null?shown(sz):'')+'" placeholder="0"/></td>';}).join('')
          +'<td><button class="pz-btn warn" data-ocrem data-g="'+esc(g.id)+'" data-l="'+esc(lk)+'" data-ix="'+ix+'" style="padding:0.15rem 0.45rem;">✕</button></td></tr>';
      }).join('');
      var priceTag=(c.price?'<span style="color:#8a5a00;">+'+peso(c.price)+' price</span>':'<span style="color:var(--tl);">free</span>');
      var costText=sharedChoiceCostText(rows,tempGroup,g.id);
      return '<div style="border-top:1px solid var(--cd);padding:0.5rem 0;">'
        +'<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.4rem;"><b>'+esc(c.label)+'</b> <span style="font-size:0.72rem;">'+priceTag+'</span>'
        +'<span data-occost="'+esc(g.id)+'|'+esc(lk)+'" style="font-size:0.72rem;color:var(--tl);">'+costText+'</span></div>'
        +(ingRows?'<table class="pz-tbl" style="margin:0.35rem 0;"><thead><tr><th>Ingredient</th><th>Recipe unit</th><th>S</th><th>M</th><th>L</th><th></th></tr></thead><tbody>'+ingRows+'</tbody></table>':'')
        +'<button class="pz-btn sec" data-ocadd data-g="'+esc(g.id)+'" data-l="'+esc(lk)+'" data-label="'+esc(c.label)+'" style="padding:0.2rem 0.6rem;font-size:0.78rem;">+ ingredient</button>'
        +'</div>';
    }).join('');
    return '<div class="pz-card" style="margin-bottom:0.9rem;"><div style="display:flex;justify-content:space-between;align-items:center;"><div style="font-weight:700;color:var(--bd);">'+esc(g.name)+'</div><span style="font-size:0.7rem;color:var(--tl);">'+badge+'</span></div>'+choices+'</div>';
  }).join('');
  root.innerHTML='<p class="pz-sub">Cost each customer choice by its ingredients, recipe unit and size. Quantities are converted to the Inventory stock unit. Packaging belongs only in Packaging Costing; Hot or Iced selects the serve style without duplicating cups or lids here.</p>'
    +cards
    +'<div style="display:flex;gap:0.5rem;align-items:center;margin-top:0.3rem;"><button class="pz-btn ok" id="optCostSaveAll">💾 Save option costs</button><span id="optCostSaveMsg" style="font-size:0.78rem;color:var(--tl);"></span></div>';
  root.querySelectorAll('[data-ocadd]').forEach(function(b){b.onclick=function(){ ocSync(); var d=window.__optCostDraft; var g=b.getAttribute('data-g'),lk=b.getAttribute('data-l'),lbl=b.getAttribute('data-label'); d[g]=d[g]||{}; d[g][lk]=d[g][lk]||{label:lbl,ings:[]}; d[g][lk].ings.push({ing:'',unit:'',dispS:null,dispM:null,dispL:null}); ocDraw(); };});
  root.querySelectorAll('[data-ocrem]').forEach(function(b){b.onclick=function(){ ocSync(); var d=window.__optCostDraft; var g=b.getAttribute('data-g'),lk=b.getAttribute('data-l'),ix=Number(b.getAttribute('data-ix')); if(d[g]&&d[g][lk]&&d[g][lk].ings){d[g][lk].ings.splice(ix,1);} ocDraw(); };});
  root.querySelectorAll('select[data-ocf]').forEach(function(s){s.onchange=function(){ ocSync(); ocDraw(); };});
  root.querySelectorAll('input[data-ocf]').forEach(function(inp){inp.oninput=function(){var tr=inp.closest('[data-oc-row]');if(!tr)return;var g=tr.getAttribute('data-oc-g'),lk=tr.getAttribute('data-oc-l');ocSync();var e=window.__optCostDraft[g]&&window.__optCostDraft[g][lk],lab=root.querySelector('[data-occost="'+g+'|'+lk+'"]'),rows=(e&&e.ings)||[];if(lab)lab.textContent=sharedChoiceCostText(rows,tempGroup,g);};});
  root.querySelectorAll('[data-oc-temp]').forEach(function(cb){cb.onchange=function(){var tr=cb.closest('[data-oc-row]'),checked=tr.querySelectorAll('[data-oc-temp]:checked');if(!checked.length){cb.checked=true;alert('Keep at least one serving style selected.');return;}ocSync();ocDraw();};});
  var saveBtn=document.getElementById('optCostSaveAll'); if(saveBtn)saveBtn.onclick=function(){ var button=this,original=button.textContent;ocSync(); var d=window.__optCostDraft||{}; var clean={},invalid='';
    Object.keys(d).forEach(function(g){ var gc={}; Object.keys(d[g]).forEach(function(lk){ var e=d[g][lk]; var kept=(e.ings||[]).filter(function(r){return r&&r.ing&&(r.qtyS!=null||r.qtyM!=null||r.qtyL!=null);});kept.forEach(function(r){if(isPackagingCostItem(r.ing))invalid=((inventoryMap[r.ing]||{}).name||r.ing)+' belongs in Packaging Costing';else if(['S','M','L'].some(function(sz){return !Number.isFinite(r['qty'+sz])||(!r.op&&r['qty'+sz]<0);}))invalid='Choose a compatible recipe unit and enter valid quantities for every size';}); if(kept.length)gc[lk]={label:e.label||lk,ings:kept}; }); if(Object.keys(gc).length)clean[g]=gc; });if(invalid){alert(invalid+'. Nothing was saved.');return;}
    invalid=invalid||sharedChoiceScopeError(clean,tempGroup);if(invalid){alert(invalid+' Nothing was saved.');return;}saveSharedChoiceCosts(button,original,clean);
  };
}
function renderConsumables(){
  var root=document.getElementById('consumRoot'); if(!root)return;
  var cats=(A().getCats?A().getCats():[]).map(function(c){return c.id;});
  if(!cats.length){var catSet={};menuList().forEach(function(it){if(it.cat)catSet[it.cat]=1;});cats=Object.keys(catSet).sort();}
  var ctMap=(window.__posSettings&&window.__posSettings.catType)||{};
  var catRows=cats.length?cats.map(function(nm){var t=ctMap[nm]||'';var label=(A().getCatLabel?A().getCatLabel(nm):nm);
    return '<tr><td>'+esc(label)+'</td><td><select class="pz-in" data-cattype="'+esc(nm)+'"><option value=""'+(t===''?' selected':'')+'>— untagged —</option><option'+(t==='drink'?' selected':'')+'>drink</option><option'+(t==='food'?' selected':'')+'>food</option></select></td></tr>';
  }).join(''):'<tr><td colspan="2" style="color:var(--tl);padding:0.6rem;">No categories found.</td></tr>';
  var cons=ingsByType('consumable');
  var cRows=cons.length?cons.map(function(i){return '<tr><td>'+esc(i.name)+'</td><td>'+esc(i.serves||'both')+'</td><td>'+esc(i.size||'all')+'</td><td>'+num(i.qtyPerOrder||1)+' '+esc(i.unit||'')+'</td><td>'+(i.cost?peso(i.cost):'—')+'</td><td style="font-weight:600;">'+peso((Number(i.qtyPerOrder)||1)*(Number(i.cost)||0))+'</td></tr>';}).join(''):'<tr><td colspan="6" style="color:var(--tl);padding:0.6rem;">No consumables yet — add them in the Inventory tab with Type = Consumable.</td></tr>';
  root.innerHTML=
    '<p class="pz-sub">Tag each category Drink or Food; items in it then auto-consume the matching consumables per order. Cups are size-aware (set a cup’s size = S/M/L); stirrers, sleeves, tissue stay size-independent. Extra water cups = an inventory Adjustment (variance), not a sale.</p>'
    +'<div class="pz-card" style="margin-bottom:1rem;"><div style="font-weight:600;color:var(--bd);margin-bottom:0.5rem;">Category types (drink / food)</div><table class="pz-tbl"><thead><tr><th>Category</th><th>Type</th></tr></thead><tbody>'+catRows+'</tbody></table></div>'
    +'<div class="pz-card"><div style="font-weight:600;color:var(--bd);margin-bottom:0.5rem;">Consumable items</div><table class="pz-tbl"><thead><tr><th>Item</th><th>Serves</th><th>Size</th><th>Per order</th><th>Cost</th><th>Cost/order</th></tr></thead><tbody>'+cRows+'</tbody></table><p class="pz-sub" style="margin-top:0.5rem;">Add or edit these in the Inventory tab (Type = Consumable). A drink order pulls its size-cup + all non-size drink/both consumables; food pulls food/both consumables (no stirrer).</p></div>';
  root.querySelectorAll('[data-cattype]').forEach(function(sel){sel.onchange=function(){
    var nm=sel.getAttribute('data-cattype'); var v=sel.value; var a=A();
    var cur=Object.assign({},(window.__posSettings&&window.__posSettings.catType)||{});
    if(v)cur[nm]=v; else delete cur[nm];
    a.update(a.ref(a.db,'posSettings'),{catType:cur});
  };});
}

/* ══════════ INTERNAL USAGE (Staff consumption + R&D) ══════════ */
