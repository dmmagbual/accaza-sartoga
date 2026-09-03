function menuList(){ return (A().getMenuItems?A().getMenuItems():[]).slice().sort(function(a,b){return (a.cat||'').localeCompare(b.cat||'')||(a.name||'').localeCompare(b.name||'');}); }
function recipeCost(rec,size){var key='preview';var result=Costing().costRecipe({itemKey:key,recipe:rec,inventory:inventoryMap,item:{name:'Recipe'},size:size});return result.totalCost;}
function recipeDraftRaw(d){
  d=d||{};
  var base=(d.base||[]).filter(function(r){return r&&r.ing&&['S','M','L'].some(function(sz){return r['d'+sz]!=null&&r['d'+sz]!=='';});}).map(function(r){var inv=inventoryMap[r.ing]||{};return {ing:r.ing,unit:r.unit||inv.unit||'',dispS:r.dS===''?null:r.dS,dispM:r.dM===''?null:r.dM,dispL:r.dL===''?null:r.dL};});
  var rec={base:base,updatedAt:Date.now()},allow=caAllowGroups();
  Object.keys(d.choiceAdd||{}).forEach(function(g){if(allow.indexOf(g)<0)return;var group={};Object.keys(d.choiceAdd[g]||{}).forEach(function(lk){var e=d.choiceAdd[g][lk]||{};var rows=(e.ings||[]).filter(function(r){return r&&r.ing&&['S','M','L'].some(function(sz){return r['qty'+sz]!=null&&r['qty'+sz]!=='';});});if(rows.length)group[lk]={label:e.label||lk,ings:rows};});if(Object.keys(group).length){rec.choiceAdd=rec.choiceAdd||{};rec.choiceAdd[g]=group;}});
  return rec;
}
function costingIssues(list){return (list||[]).map(function(x){return '• '+(x.message||x.code||'Costing error');}).join('\n');}
/* Menu items with a costing gap: no recipe, ₱0 recipe cost, or a base ingredient with no cost. */
function markNoRecipe(key,val){ var a=A(); a.set(a.ref(a.db,'menuItems/'+key+'/noRecipe'),val?true:null).then(function(){ updateCostBadge(); }).catch(function(e){ alert('Could not update: '+((e&&e.code)||e)+'. Log in with your admin EMAIL.'); }); }
function menuCostGaps(){
  var out=[];
  menuList().forEach(function(it){
    if(it.noRecipe)return; /* resale / bought-in items opted out of costing */
    var rec=recipesMap[it.key];
    if(!rec||!(rec.base&&rec.base.length)){ out.push({key:it.key,name:it.name,cat:it.cat,reason:'No recipe yet'}); return; }
    if((rec.base||[]).some(function(b){return b.ing&&!inventoryMap[b.ing];})){ out.push({key:it.key,name:it.name,cat:it.cat,reason:'An ingredient was deleted (broken link)'}); return; }
    if(!(recipeCost(rec,'M')>0)){ out.push({key:it.key,name:it.name,cat:it.cat,reason:'Recipe cost is ₱0'}); return; }
    if((rec.base||[]).some(function(b){return b.ing&&!(Number((inventoryMap[b.ing]||{}).cost)>0);})){ out.push({key:it.key,name:it.name,cat:it.cat,reason:'An ingredient has no cost'}); }
  });
  return out;
}
function updateCostBadge(){ var n=menuCostGaps().length; var b=document.getElementById('costGapBadge'); if(!b)return; if(n>0){b.textContent=n;b.style.display='inline-block';}else{b.style.display='none';} }
function renderRecipes(){
  var root=document.getElementById('recipesRoot'); if(!root)return;
  var tabs=[['base','🧪 Recipe (base + consumables)'],['saved','📋 Saved Recipes'],['options','➕ Optional ingredients'],['repair','🛟 Repair & restore']];
  var nav='<div style="display:flex;gap:0.4rem;margin:0.4rem 0 1rem;flex-wrap:wrap;">'+tabs.map(function(t){return '<button class="pz-btn '+(recSub===t[0]?'ok':'sec')+'" data-recsub="'+t[0]+'" style="padding:0.4rem 0.9rem;">'+t[1]+'</button>';}).join('')+'</div>';
  if(recSub==='consumables')recSub='base';
  var body;
  if(recSub==='options'){ body='<div id="optMasterRoot"></div>'; }
  else if(recSub==='repair'){ body='<div id="recRepairRoot"></div>'; }
  else if(recSub==='saved'){
    var sitems=menuList().filter(function(it){return !!recipesMap[it.key];});
    var savedRows=sitems.length?sitems.map(function(it){var rec=recipesMap[it.key];return '<tr style="cursor:pointer;" data-recopen="'+esc(it.key)+'"><td>'+esc(it.name)+'</td><td style="color:var(--tl);font-size:0.8rem;">'+esc(A().getCatLabel?A().getCatLabel(it.cat):(it.cat||''))+'</td><td class="r">'+((rec.base&&rec.base.length)||0)+'</td><td class="r">'+peso(recipeCost(rec,'S'))+'</td><td class="r">'+peso(recipeCost(rec,'M'))+'</td><td class="r">'+peso(recipeCost(rec,'L'))+'</td><td class="r"><button class="pz-btn ok" data-recopen="'+esc(it.key)+'" style="padding:0.15rem 0.6rem;">Open</button></td></tr>';}).join(''):'<tr><td colspan="7" style="color:var(--tl);padding:0.6rem;">No saved recipes yet. Build one in the Recipe tab.</td></tr>';
    body='<p class="pz-sub">All saved recipes ('+sitems.length+'). Click a row to open it in the Recipe tab — edit, add or remove ingredients, then save.</p>'
      +'<div class="pz-card"><div style="overflow-x:auto;"><table class="pz-tbl"><thead><tr><th>Item</th><th>Category</th><th class="r">Ingredients</th><th class="r">Cost S</th><th class="r">Cost M</th><th class="r">Cost L</th><th></th></tr></thead><tbody>'+savedRows+'</tbody></table></div></div>';
  }
  else {
    var items=menuList();
    var opts=items.map(function(it){var has=!!recipesMap[it.key];return '<option value="'+esc(it.key)+'"'+(it.key===curRecipeKey?' selected':'')+'>'+(has?'✓ ':'○ ')+esc(it.name)+'</option>';}).join('');
    var covered=items.filter(function(it){return !!recipesMap[it.key];}).length;
    body='<p class="pz-sub">Build each drink from its ingredients — base + consumables (cups, lids, straws) — with the quantity per size. Cost per drink is the sum. Optional add-ons are costed separately in the Optional ingredients tab and only trigger when a customer picks them. Saved recipes are listed in the <b>Saved Recipes</b> tab. <b>'+covered+' of '+items.length+'</b> items have a recipe.</p>'
      +'<div class="pz-card" style="margin-bottom:1rem;"><span class="pz-lbl">Start / edit a recipe — pick a menu item</span>'
      +'<select class="pz-in" id="recPick" style="max-width:420px;"><option value="">— choose an item —</option>'+opts+'</select></div>'
      +'<div id="recEditor"></div>';
  }
  var tools='<div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-bottom:1rem;">'
    +'<button class="pz-btn sec" id="recCostSheet">📊 Cost sheet</button>'
    +'<button class="pz-btn sec" id="recExport">⬇ Export recipes</button>'
    +'<button class="pz-btn sec" id="recTemplate">⬇ Import template</button>'
    +'<button class="pz-btn ok" id="recImportBtn">⬆ Import recipes</button>'
    +'<input type="file" id="recImportFile" accept=".xlsx,.xls,.csv" style="display:none;"/>'
    +'</div>';
  var _gaps=menuCostGaps();
  var _editingNow=(recSub==='base'&&!!curRecipeKey);
  var gapPanel;
  if(!_gaps.length){ gapPanel='<div class="pz-card" style="border:1px solid #a8d5b5;background:#f0faf4;margin-bottom:0.8rem;color:#2d6a4f;font-weight:600;">✓ All menu items are costed.</div>'; }
  else if(_editingNow){ gapPanel='<div class="pz-card" style="border:1px solid #f0c36d;background:#fff8e8;margin-bottom:0.6rem;padding:0.45rem 0.8rem;display:flex;justify-content:space-between;align-items:center;gap:0.5rem;"><span style="color:#8a5a00;font-weight:600;">⚠ '+_gaps.length+' menu item'+(_gaps.length===1?'':'s')+' still not costed — finish below, the list updates.</span><button class="pz-btn sec" id="recBackToList" style="padding:0.15rem 0.6rem;">◂ Back to list</button></div>'; }
  else { gapPanel='<div class="pz-card" style="border:1px solid #f0c36d;background:#fff8e8;margin-bottom:0.8rem;"><div style="font-weight:700;color:#8a5a00;">⚠ '+_gaps.length+' menu item'+(_gaps.length===1?'':'s')+' not costed yet</div><p class="pz-sub" style="margin:0.2rem 0 0.4rem;">These can be sold without a reliable COGS. Click “Cost it” to open its costing page.</p>'+_gaps.map(function(g){return '<div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;padding:0.25rem 0;border-top:1px solid #f0e0c0;"><span>'+esc(g.name)+' <span style="color:#a06a10;font-size:0.75rem;">· '+esc(g.reason)+'</span></span><span style="white-space:nowrap;"><button class="pz-btn sec" data-noneed="'+esc(g.key)+'" style="padding:0.12rem 0.5rem;font-size:0.72rem;">not a recipe item</button> <button class="pz-btn ok" data-recopen="'+esc(g.key)+'" style="padding:0.12rem 0.6rem;">Cost it</button></span></div>';}).join('')+'</div>'; }
  root.innerHTML='<div class="pz-h">🧪 Recipe &amp; Costing</div>'+gapPanel+nav+tools+body;
  updateCostBadge();
  var _btl=document.getElementById('recBackToList'); if(_btl)_btl.onclick=function(){ curRecipeKey=null; recipeEditing=false; renderRecipes(); };
  root.querySelectorAll('[data-recsub]').forEach(function(b){b.onclick=function(){recSub=b.getAttribute('data-recsub');recipeEditing=false;renderRecipes();};});
  root.querySelectorAll('[data-recopen]').forEach(function(b){b.onclick=function(){curRecipeKey=b.getAttribute('data-recopen');recSub='base';recipeEditing=false;renderRecipes();var e=document.getElementById('recEditor');if(e)e.scrollIntoView({behavior:'smooth',block:'start'});};});
  root.querySelectorAll('[data-noneed]').forEach(function(b){b.onclick=function(){ if(confirm('Mark this as a resale / bought-in item that needs no recipe? It will be hidden from the not-costed flag. Its COGS won\'t be tracked by recipe — record its cost via the purchase price instead.')) markNoRecipe(b.getAttribute('data-noneed'),true); renderRecipes(); };});
  var _cs=document.getElementById('recCostSheet'); if(_cs)_cs.onclick=exportCostSheet;
  var _re=document.getElementById('recExport'); if(_re)_re.onclick=exportRecipesXlsx;
  var _rt=document.getElementById('recTemplate'); if(_rt)_rt.onclick=downloadRecipeTemplate;
  var _rb=document.getElementById('recImportBtn'), _rf=document.getElementById('recImportFile');
  if(_rb&&_rf){ _rb.onclick=function(){_rf.value='';_rf.click();}; _rf.onchange=function(){ if(_rf.files&&_rf.files[0])importRecipesXlsx(_rf.files[0]); }; }
  if(recSub==='options'){ renderOptionsMaster(); }
  else if(recSub==='repair'){ renderRecipeRepair(); }
  else if(recSub==='saved'){ root.querySelectorAll('[data-recopen]').forEach(function(b){b.onclick=function(){curRecipeKey=b.getAttribute('data-recopen');recSub='base';recipeEditing=false;renderRecipes();};}); }
  else { var rp=document.getElementById('recPick'); if(rp)rp.onchange=function(){ curRecipeKey=this.value||null; openRecipe(curRecipeKey); };
    if(curRecipeKey)openRecipe(curRecipeKey); }
}
function optLabelsForItem(item){
  var groups=A().getItemOptionGroups?A().getItemOptionGroups(item):[]; var out=[];
  (groups||[]).forEach(function(g){ (g.choices||[]).forEach(function(c){ out.push({group:g.name,label:c.label}); }); });
  return out;
}
function openRecipe(key){
  var ed=document.getElementById('recEditor'); if(!ed)return;
  if(!key){ed.innerHTML='';recipeEditing=false;return;}
  var _raw=A().menuItemsMap[key]; if(!_raw){ed.innerHTML='<p class="pz-sub">Item not found.</p>';return;}
  var item=Object.assign({key:key},_raw);
  recipeEditing=true;
  var saved=recipesMap[key]||{};
  var sm=saved.sizeMult||{S:1,M:1.3,L:1.6};
  recipeDraft={
    base:(saved.base?saved.base.map(function(b){
      var inv=inventoryMap[b.ing]||{}; var u=b.unit||inv.unit||'';
      if(uNorm(u)==='oz'){var dim=itemDim(inv);u=dim==='volume'?'fl oz':(dim==='weight'?'oz wt':u);}
      var qS,qM,qL;
      if(b.qtyS!=null||b.qtyM!=null||b.qtyL!=null){qS=b.qtyS;qM=b.qtyM;qL=b.qtyL;}
      else{var q=Number(b.qty)||0;qS=q*(sm.S!=null?sm.S:1);qM=q*(sm.M!=null?sm.M:1);qL=q*(sm.L!=null?sm.L:1);}
      function display(stored,shown){if(shown!=null)return shown;var cv=Costing().convert(Number(stored)||0,inv.unit||u,u);return cv.ok?cv.qty:stored;}
      return {ing:b.ing,unit:u,dS:display(qS,b.dispS),dM:display(qM,b.dispM),dL:display(qL,b.dispL)};
    }):[]),
    choiceAdd:ocClone(saved.choiceAdd),
    _optPreview:[]
  };
  var _sel={}; (A().getItemOptionGroups?A().getItemOptionGroups(item):[]).forEach(function(g){ if(g.required&&g.type!=='multi'&&(g.choices||[]).length)_sel[g.id]=g.choices[0].label; });
  window.__recCostSel=_sel;
  drawRecipeEditor(item);
}
function drawRecipeEditor(item){
  var ed=document.getElementById('recEditor'); if(!ed)return;
  var d=recipeDraft; var size=recSize||'M';
  var cat=item.cat||''; var ct=catType(cat);
  function ingSelect(val,attr){return '<select class="pz-in" '+attr+' style="min-width:150px;"><option value="">— ingredient —</option>'+ingsByType('base').concat(ingsByType('both')).concat(ingsByType('consumable')).map(function(i){return '<option value="'+i.id+'"'+(i.id===val?' selected':'')+'>'+esc(i.name)+' ('+esc(i.unit||'')+') · '+ingType(i)+'</option>';}).join('')+'</select>';}
  var baseTotal=0;
  var baseRows=d.base.map(function(r,ix){
    var inv=inventoryMap[r.ing]||{};
    var stockQ=convertToStock((r['d'+size]===''||r['d'+size]==null)?0:Number(r['d'+size]),r.unit,inv);
    var amt=(Number.isFinite(stockQ)?stockQ:0)*ingCost(r.ing); baseTotal+=amt;
    var cu=compatUnits(inv); var uOpts=cu.map(function(u){return '<option'+(uNorm(u)===uNorm(r.unit)?' selected':'')+'>'+esc(u)+'</option>';}).join('');
    var stkNote=!Number.isFinite(stockQ)?'<div style="font-size:0.62rem;color:#b44336;">incompatible unit</div>':((inv.unit&&uNorm(inv.unit)!==uNorm(r.unit))?('<div style="font-size:0.62rem;color:var(--tl);">=&nbsp;'+num(Math.round(stockQ*1000)/1000)+' '+esc(inv.unit)+'</div>'):'');
    function qc(sz){return '<input class="pz-in" type="number" step="any" style="width:80px;text-align:right;" value="'+(r['d'+sz]!=null&&r['d'+sz]!==''?r['d'+sz]:'')+'" data-brow="'+ix+'" data-bfield="d'+sz+'" placeholder="0"/>';}
    return '<tr><td>'+ingSelect(r.ing,'data-brow="'+ix+'" data-bfield="ing"')+'</td>'
      +'<td style="white-space:nowrap;"><select class="pz-in" data-brow="'+ix+'" data-bfield="unit" style="width:70px;padding-left:0.3rem;padding-right:0.2rem;" title="Unit you are entering — converts to the item stock unit for costing">'+(uOpts||'<option></option>')+'</select>'+stkNote+'</td>'
      +'<td>'+qc('S')+'</td><td>'+qc('M')+'</td><td>'+qc('L')+'</td>'
      +'<td style="white-space:nowrap;font-weight:600;">'+peso(amt)+' <button class="pz-btn warn" style="padding:0.2rem 0.45rem;font-weight:400;" data-brem="'+ix+'">✕</button></td></tr>';
  }).join('');
  var sizeBtns=['S','M','L'].map(function(sz){return '<button class="pz-btn '+(sz===size?'ok':'sec')+'" data-recsize="'+sz+'" style="padding:0.25rem 0.8rem;">'+sz+'</button>';}).join(' ');
  var grand=baseTotal;
  var caGroupsAll=(A().getItemOptionGroups?A().getItemOptionGroups(item):[])||[];
  var caAllow=caAllowGroups();
  if(d.choiceAdd){Object.keys(d.choiceAdd).forEach(function(_g){if(caAllow.indexOf(_g)<0)delete d.choiceAdd[_g];});}
  var caGroups=caGroupsAll.filter(function(g){return caAllow.indexOf(g.id)>=0;});
  var caInv=ings().slice().sort(function(a,b){return (a.name||'').localeCompare(b.name||'');});
  function caIngSel(val){return '<select class="pz-in" data-caf="ing" style="min-width:150px;"><option value="">— ingredient —</option>'+caInv.map(function(i){return '<option value="'+i.id+'"'+(i.id===val?' selected':'')+'>'+esc(i.name)+' ('+esc(i.unit||'')+') · '+ingType(i)+'</option>';}).join('')+'</select>';}
  var caCards=caGroups.map(function(g){
    var choices=(g.choices||[]).map(function(c){
      var lk=optKey(c.label); var rows=(d.choiceAdd&&d.choiceAdd[g.id]&&d.choiceAdd[g.id][lk]&&d.choiceAdd[g.id][lk].ings)||[];
      var ingRows=rows.map(function(r,ix){
        return '<tr data-carow data-ca-g="'+esc(g.id)+'" data-ca-l="'+esc(lk)+'" data-ca-label="'+esc(c.label)+'" data-ca-ix="'+ix+'">'
          +'<td>'+caIngSel(r.ing)+'</td>'
          +'<td><input class="pz-in" type="number" step="any" style="width:60px;" data-caf="qtyS" value="'+(r.qtyS!=null&&r.qtyS!==''?r.qtyS:'')+'" placeholder="0"/></td>'
          +'<td><input class="pz-in" type="number" step="any" style="width:60px;" data-caf="qtyM" value="'+(r.qtyM!=null&&r.qtyM!==''?r.qtyM:'')+'" placeholder="0"/></td>'
          +'<td><input class="pz-in" type="number" step="any" style="width:60px;" data-caf="qtyL" value="'+(r.qtyL!=null&&r.qtyL!==''?r.qtyL:'')+'" placeholder="0"/></td>'
          +'<td><button class="pz-btn warn" data-carem data-g="'+esc(g.id)+'" data-l="'+esc(lk)+'" data-ix="'+ix+'" style="padding:0.15rem 0.45rem;">✕</button></td></tr>';
      }).join('');
      return '<div style="border-top:1px solid var(--cd);padding:0.4rem 0;">'
        +'<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.3rem;"><b>'+esc(c.label)+'</b>'
        +'<span data-cacost="'+esc(g.id)+'|'+esc(lk)+'" style="font-size:0.72rem;color:var(--tl);">extra — S '+peso(ocChoiceCost(rows,'S'))+' · M '+peso(ocChoiceCost(rows,'M'))+' · L '+peso(ocChoiceCost(rows,'L'))+'</span></div>'
        +(ingRows?'<table class="pz-tbl" style="margin:0.3rem 0;"><thead><tr><th>Extra ingredient</th><th>S</th><th>M</th><th>L</th><th></th></tr></thead><tbody>'+ingRows+'</tbody></table>':'')
        +'<button class="pz-btn sec" data-caadd data-g="'+esc(g.id)+'" data-l="'+esc(lk)+'" data-label="'+esc(c.label)+'" style="padding:0.15rem 0.55rem;font-size:0.76rem;">+ extra ingredient</button>'
        +'</div>';
    }).join('');
    return '<div style="margin-bottom:0.6rem;"><div style="font-weight:600;color:var(--bd);font-size:0.85rem;">'+esc(g.name)+'</div>'+choices+'</div>';
  }).join('');
  var caManage=caGroupsAll.map(function(g){var on=caAllow.indexOf(g.id)>=0;return '<label style="display:inline-flex;align-items:center;gap:0.3rem;font-size:0.72rem;margin:0 0.7rem 0.25rem 0;cursor:pointer;"><input type="checkbox" data-cagrp="'+esc(g.id)+'"'+(on?' checked':'')+'/>'+esc(g.name)+'</label>';}).join('');
  var caSection=caGroupsAll.length?('<div style="border-top:2px solid var(--cd);margin-top:0.8rem;padding-top:0.6rem;"><div style="font-weight:700;color:var(--bd);margin-bottom:0.2rem;">Extra ingredients per choice — this drink only</div><p class="pz-sub" style="margin-top:0;">Stacks on top of the base recipe and the shared Optional-ingredients cost (cups, ice, milk). Use for drink-specific deltas — e.g. Hot → extra coffee for this drink. Blank = 0 for that size.</p>'+'<div style="background:var(--cd);border-radius:6px;padding:0.4rem 0.55rem;margin-bottom:0.5rem;font-size:0.72rem;"><b>Which choices can carry per-drink extras</b> <span style="color:var(--tl);">(applies to all drinks — Temperature only by default):</span><div style="margin-top:0.3rem;">'+caManage+'</div></div>'+(caCards||'<p class="pz-sub" style="margin:0;">No choices enabled — tick one above to add a per-drink extra.</p>')+'</div>'):'';
  // ── COST PER DRINK calculator: base + selected choices (per-recipe extra + shared optional) ──
  var tempRec={choiceAdd:d.choiceAdd};
  var previewNorm=Costing().normalizeRecipe(recipeDraftRaw(d),inventoryMap);
  var previewRec=previewNorm.ok?previewNorm.recipe:null;
  if(previewRec){var _basePreview=Costing().costRecipe({itemKey:item.key,recipe:previewRec,inventory:inventoryMap,item:item,size:size});baseTotal=_basePreview.totalCost;grand=baseTotal;}
  function selLabelCost(lb){var c=0;choiceIngs(item,tempRec,lb,size).forEach(function(r){c+=(Number(r.qty)||0)*ingCost(r.ing);});return c;}
  var selState=window.__recCostSel||{};
  var selLines=[],extrasTotal=0,selectedLabels=[];
  caGroupsAll.forEach(function(g){var v=selState[g.id];var labels=Array.isArray(v)?v:(v?[v]:[]);labels.forEach(function(lb){var cc=selLabelCost(lb);extrasTotal+=cc;selLines.push('<div style="display:flex;justify-content:space-between;"><span style="color:var(--tl);">'+esc(g.name)+': '+esc(lb)+'</span><span>'+peso(cc)+'</span></div>');});});
  caGroupsAll.forEach(function(g){var v=selState[g.id];(Array.isArray(v)?v:(v?[v]:[])).forEach(function(lb){selectedLabels.push(lb);});});
  var drinkPreview=previewRec?Costing().costRecipe({itemKey:item.key,recipe:previewRec,inventory:inventoryMap,item:item,size:size,optLabels:selectedLabels,optionCosts:optCostStore(),optionRecipes:optRecipesMap,optionGroups:(A()&&A().optionGroupsMap)||{}}):{totalCost:0,lines:[],errors:previewNorm.errors||[],warnings:previewNorm.warnings||[]};
  var drinkTotal=previewRec?drinkPreview.totalCost:(baseTotal+extrasTotal);
  var traceRows=(drinkPreview.lines||[]).map(function(line){return '<tr><td>'+esc(line.source.replace(/_/g,' '))+'</td><td>'+esc(line.ingredientName)+'</td><td class="r">'+num(line.totalQuantity)+' '+esc(line.stockUnit)+'</td><td class="r">'+peso(line.unitCost)+'</td><td class="r">'+peso(line.totalCost)+'</td></tr>';}).join('');
  var previewIssues=(drinkPreview.errors||[]).concat(drinkPreview.warnings||[]);
  var tracePanel='<details style="margin-top:0.55rem;"><summary style="cursor:pointer;font-size:0.75rem;color:var(--bd);font-weight:600;">Cost trace · engine '+esc(Costing().VERSION)+'</summary>'+(previewIssues.length?'<div style="margin:0.4rem 0;padding:0.45rem;background:#fff8e8;color:#8a5a00;font-size:0.72rem;white-space:pre-line;">'+esc(costingIssues(previewIssues))+'</div>':'')+(traceRows?'<div style="overflow-x:auto;"><table class="pz-tbl" style="font-size:0.7rem;"><thead><tr><th>Source</th><th>Ingredient</th><th class="r">Usage</th><th class="r">Unit cost</th><th class="r">Cost</th></tr></thead><tbody>'+traceRows+'</tbody></table></div>':'<div style="font-size:0.72rem;color:var(--tl);padding:0.4rem 0;">Add a valid ingredient and quantity to see the trace.</div>')+'</details>';
  var calcGroups=caGroupsAll.map(function(g){var sv=selState[g.id];var isMulti=g.type==='multi';
    var chips=(g.choices||[]).map(function(c){var on=isMulti?(Array.isArray(sv)&&sv.indexOf(c.label)>-1):(sv===c.label);return '<button class="pz-btn '+(on?'ok':'sec')+'" data-rcsel="'+esc(g.id)+'" data-rcmulti="'+(isMulti?1:0)+'" data-rclabel="'+esc(c.label)+'" style="padding:0.18rem 0.55rem;font-size:0.74rem;margin:0 0.2rem 0.2rem 0;">'+esc(c.label)+'</button>';}).join('');
    return '<div style="margin-bottom:0.3rem;"><span style="font-size:0.7rem;color:var(--tl);text-transform:uppercase;letter-spacing:0.03em;display:block;">'+esc(g.name)+(isMulti?' · pick any':' · pick one')+'</span>'+chips+'</div>';
  }).join('');
  var drinkCard=caGroupsAll.length?('<div class="pz-card" style="margin-bottom:1rem;border:2px solid var(--bd);">'
    +'<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.4rem;margin-bottom:0.4rem;"><span style="font-weight:700;color:var(--bd);">💰 Cost per drink — by selection</span><span><span class="pz-lbl" style="display:inline;margin-right:0.4rem;">Size</span>'+sizeBtns+'</span></div>'
    +'<p class="pz-sub" style="margin-top:0;">Pick the choices a customer would make; this stacks the base, this drink’s per-choice extras, and the shared Optional-ingredients cost, at the '+size+' size.</p>'
    +calcGroups
    +'<div style="border-top:1px solid var(--cd);margin-top:0.4rem;padding-top:0.4rem;font-size:0.8rem;"><div style="display:flex;justify-content:space-between;"><span style="color:var(--tl);">Base</span><span>'+peso(baseTotal)+'</span></div>'+selLines.join('')+'</div>'
    +'<div style="border-top:2px solid var(--bd);margin-top:0.4rem;padding-top:0.5rem;display:flex;justify-content:space-between;align-items:center;"><span style="font-weight:700;color:var(--bd);">COST PER DRINK / '+size+'</span><span style="font-weight:700;font-size:1.2rem;color:var(--bd);">'+peso(drinkTotal)+'</span></div>'
    +'</div>'):'';
  ed.innerHTML=
    '<div class="pz-card" style="margin-bottom:1rem;">'
      +'<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem;margin-bottom:0.6rem;"><div style="font-weight:600;color:var(--bd);">Recipe for “'+esc(item.name)+'”'+(cat?' · <span style="color:var(--tl);font-size:0.82rem;">'+esc(A().getCatLabel?A().getCatLabel(cat):cat)+(ct?' ('+ct+')':'')+'</span>':'')+'</div><div><span class="pz-lbl" style="display:inline;margin-right:0.4rem;">Cost for size</span>'+sizeBtns+'</div></div>'
      +'<label style="display:inline-flex;align-items:center;gap:0.35rem;font-size:0.76rem;color:var(--tl);margin-bottom:0.5rem;cursor:pointer;"><input type="checkbox" id="recNoNeed"'+(item.noRecipe?' checked':'')+'/> No recipe needed (resale / bought-in item — hide from the not-costed flag)</label>'
      +(ings().length?'':'<p class="pz-low" style="font-size:0.8rem;">Add items in the Inventory tab first.</p>')
      +'<span class="pz-lbl">Recipe ingredients — base &amp; consumables (cups, lids, straws…). Enter qty per size.</span>'
      +'<table class="pz-tbl" style="margin-bottom:0.4rem;"><thead><tr><th>Ingredient</th><th>Recipe unit</th><th>S</th><th>M</th><th>L</th><th>Amount ('+size+')</th></tr></thead><tbody>'+(baseRows||'<tr><td colspan="6" style="color:var(--tl);padding:0.5rem;">No ingredients yet.</td></tr>')+'</tbody></table>'
      +'<button class="pz-btn sec" id="recAddBase" style="padding:0.3rem 0.7rem;">+ ingredient</button>'
      +'<div style="font-size:0.72rem;color:var(--tl);margin-top:0.3rem;">Add cups / lids / straws / tissue here too — pick the inventory item (tagged consumable) and its qty. Optional add-ons are costed separately in the Optional ingredients tab and only trigger when a customer picks them.</div>'
      +'<div style="border-top:2px solid var(--bd);margin-top:0.8rem;padding-top:0.6rem;display:flex;justify-content:space-between;align-items:center;"><span style="font-weight:700;color:var(--bd);">BASE COST / '+size+'</span><span style="font-weight:700;font-size:1.1rem;color:var(--bd);">'+peso(grand)+'</span></div>'
      +'<div style="font-size:0.68rem;color:var(--tl);margin-top:0.2rem;">Base ingredients only. The full cost per drink (base + extras + optional) is in the calculator below.</div>'
      +tracePanel
      +caSection
      +'<div style="margin-top:1rem;display:flex;gap:0.5rem;">'
        +'<button class="pz-btn ok" id="recSave">💾 Save recipe</button>'
        +'<button class="pz-btn sec" id="recClose">Close</button>'
        +(recipesMap[item.key]?'<button class="pz-btn warn" id="recDel" style="margin-left:auto;">Delete recipe</button>':'')
      +'</div>'
    +'</div>'
    +drinkCard;
  // sync DOM into draft
  function syncDraft(){
    var base=[]; d.base.forEach(function(_,ix){ var ing=ed.querySelector('[data-brow="'+ix+'"][data-bfield="ing"]'); if(!ing)return; var uEl=ed.querySelector('[data-brow="'+ix+'"][data-bfield="unit"]'); var inv=inventoryMap[ing.value]||{}; var u=uEl?uEl.value:(inv.unit||''); if(compatUnits(inv).map(uNorm).indexOf(uNorm(u))<0)u=inv.unit||u; var row={ing:ing.value,unit:u}; ['S','M','L'].forEach(function(sz){var q=ed.querySelector('[data-brow="'+ix+'"][data-bfield="d'+sz+'"]'); row['d'+sz]=q?(q.value===''?'':(Number(q.value)||0)):'';}); base[ix]=row;});
    d.base=base.filter(function(x){return x;});
  }
  function syncChoiceAdd(){
    var next={};
    ed.querySelectorAll('[data-carow]').forEach(function(tr){
      var g=tr.getAttribute('data-ca-g'),lk=tr.getAttribute('data-ca-l'),lbl=tr.getAttribute('data-ca-label')||'';
      var ing=(tr.querySelector('[data-caf="ing"]')||{}).value||''; if(!ing)return;
      function v(f){var el=tr.querySelector('[data-caf="'+f+'"]');return (el&&el.value!=='')?(Number(el.value)||0):null;}
      next[g]=next[g]||{}; next[g][lk]=next[g][lk]||{label:lbl,ings:[]};
      next[g][lk].ings.push({ing:ing,qtyS:v('qtyS'),qtyM:v('qtyM'),qtyL:v('qtyL')});
    });
    d.choiceAdd=next;
  }
  function syncAll(){syncDraft();syncChoiceAdd();}
  document.getElementById('recAddBase').onclick=function(){syncAll();d.base.push({ing:'',unit:'',dS:'',dM:'',dL:''});drawRecipeEditor(item);};
  ed.querySelectorAll('[data-recsize]').forEach(function(b){b.onclick=function(){syncAll();recSize=b.getAttribute('data-recsize');drawRecipeEditor(item);};});
  ed.querySelectorAll('[data-brem]').forEach(function(b){b.onclick=function(){syncAll();d.base.splice(Number(b.getAttribute('data-brem')),1);drawRecipeEditor(item);};});
  ed.querySelectorAll('select[data-brow]').forEach(function(s){s.onchange=function(){syncAll();drawRecipeEditor(item);};});
  ed.querySelectorAll('[data-caadd]').forEach(function(b){b.onclick=function(){syncAll();var g=b.getAttribute('data-g'),lk=b.getAttribute('data-l'),lbl=b.getAttribute('data-label');d.choiceAdd=d.choiceAdd||{};d.choiceAdd[g]=d.choiceAdd[g]||{};d.choiceAdd[g][lk]=d.choiceAdd[g][lk]||{label:lbl,ings:[]};d.choiceAdd[g][lk].ings.push({ing:'',qtyS:null,qtyM:null,qtyL:null});drawRecipeEditor(item);};});
  ed.querySelectorAll('[data-carem]').forEach(function(b){b.onclick=function(){syncAll();var g=b.getAttribute('data-g'),lk=b.getAttribute('data-l'),ix=Number(b.getAttribute('data-ix'));if(d.choiceAdd&&d.choiceAdd[g]&&d.choiceAdd[g][lk]&&d.choiceAdd[g][lk].ings)d.choiceAdd[g][lk].ings.splice(ix,1);drawRecipeEditor(item);};});
  ed.querySelectorAll('[data-cagrp]').forEach(function(cb){cb.onchange=function(){syncAll();var picked=[];ed.querySelectorAll('[data-cagrp]').forEach(function(x){if(x.checked)picked.push(x.getAttribute('data-cagrp'));});window.__posSettings=window.__posSettings||{};window.__posSettings.choiceAddGroups=picked;var a=A();a.update(a.ref(a.db,'posSettings'),{choiceAddGroups:picked}).catch(function(e){alert('Could not save the choice list: '+((e&&e.code)||e)+'. Log in with your admin email.');});drawRecipeEditor(item);};});
  ed.querySelectorAll('select[data-caf="ing"]').forEach(function(s){s.onchange=function(){syncAll();drawRecipeEditor(item);};});
  ed.querySelectorAll('input[data-caf]').forEach(function(inp){inp.oninput=function(){var tr=inp.closest('[data-carow]');if(!tr)return;var g=tr.getAttribute('data-ca-g'),lk=tr.getAttribute('data-ca-l');var rows=[];ed.querySelectorAll('[data-carow][data-ca-g="'+g+'"][data-ca-l="'+lk+'"]').forEach(function(r){var ing=(r.querySelector('[data-caf="ing"]')||{}).value||'';function v(f){var el=r.querySelector('[data-caf="'+f+'"]');return (el&&el.value!=='')?(Number(el.value)||0):null;}rows.push({ing:ing,qtyS:v('qtyS'),qtyM:v('qtyM'),qtyL:v('qtyL')});});var lab=ed.querySelector('[data-cacost="'+g+'|'+lk+'"]');if(lab)lab.textContent='extra — S '+peso(ocChoiceCost(rows,'S'))+' · M '+peso(ocChoiceCost(rows,'M'))+' · L '+peso(ocChoiceCost(rows,'L'));};});
  ed.querySelectorAll('[data-rcsel]').forEach(function(b){b.onclick=function(){syncAll();var gid=b.getAttribute('data-rcsel');var multi=b.getAttribute('data-rcmulti')==='1';var lb=b.getAttribute('data-rclabel');var sel=window.__recCostSel||{};if(multi){var arr=Array.isArray(sel[gid])?sel[gid].slice():[];var i=arr.indexOf(lb);if(i>-1)arr.splice(i,1);else arr.push(lb);sel[gid]=arr;}else{sel[gid]=(sel[gid]===lb)?null:lb;}window.__recCostSel=sel;drawRecipeEditor(item);};});
  var _nn=document.getElementById('recNoNeed'); if(_nn)_nn.onchange=function(){ markNoRecipe(item.key,this.checked); };
  document.getElementById('recSave').onclick=function(){ try{ syncAll(); saveRecipe(item.key); }catch(err){ alert('Recipe save hit an error: '+(err&&err.message?err.message:err)+'. Nothing was saved — tell support this message.'); } };
  document.getElementById('recClose').onclick=function(){ recipeEditing=false; curRecipeKey=null; renderRecipes(); };
  if(document.getElementById('recDel'))document.getElementById('recDel').onclick=function(){ if(!confirm('Delete this recipe? '+esc(item.name)+' will no longer deduct stock.'))return; var a=A();a.remove(a.ref(a.db,'recipes/'+item.key));recipeEditing=false;curRecipeKey=null;setTimeout(renderRecipes,200);};
}
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
function saveRecipe(key){
  var d=recipeDraft; if(!d){alert('Nothing to save — reopen the recipe and try again.');return;}
  var raw=recipeDraftRaw(d),local=Costing().normalizeRecipe(raw,inventoryMap);
  if(!local.ok){alert('Recipe was not saved. Fix these costing errors:\n\n'+costingIssues(local.errors));return;}
  var saved=recipesMap[key];if(saved&&saved.options)raw.options=saved.options;
  var a=A();if(!a.validateRecipeDefinition){alert('The 3B recipe validator is not available. Refresh the portal. Nothing was saved.');return;}
  a.validateRecipeDefinition(raw).then(function(res){var data=res&&res.data?res.data:res;var rec=data&&data.recipe;if(!rec)throw new Error('The server did not return a normalized recipe.');return a.set(a.ref(a.db,'recipes/'+key),rec).then(function(){return data;});}).then(function(data){recipeEditing=false;var note=(data.warnings&&data.warnings.length)?'\n\nWarnings:\n'+costingIssues(data.warnings):'';alert('Recipe saved for '+(A().menuItemsMap[key]?A().menuItemsMap[key].name:key)+'.\nCosting engine '+(data.engineVersion||Costing().VERSION)+'.'+note);curRecipeKey=key;setTimeout(function(){renderRecipes();},150);}).catch(function(e){var details=e&&e.details&&e.details.errors;alert('Could not save the recipe: '+((e&&e.message)||(e&&e.code)||e)+(details?'\n\n'+costingIssues(details):'')+'\n\nNothing was saved.');});
}
function optKey(label){return String(label).replace(/[.#$\[\]\/]/g,'_');}
function allOptionLabels(){
  var seen={},out=[];
  menuList().forEach(function(it){ (optLabelsForItem(it)||[]).forEach(function(o){ if(o.label&&!seen[o.label]){seen[o.label]=1;out.push(o);} }); });
  return out.sort(function(a,b){return (a.label||'').localeCompare(b.label||'');});
}
function ocClone(o){try{return JSON.parse(JSON.stringify(o||{}));}catch(e){return {};}}
function ocGroups(){var m=(A()&&A().optionGroupsMap)||{};return Object.keys(m).map(function(id){return Object.assign({id:id},m[id]);}).sort(function(a,b){return (a.order||0)-(b.order||0);});}
function ocChoiceCost(ings,size){var c=0;(ings||[]).forEach(function(r){if(!r||!r.ing)return;var q=r['qty'+size];if(q==null||q==='')q=0;c+=(Number(q)||0)*ingCost(r.ing);});return c;}
function renderOptionsMaster(){ window.__optCostDraft=ocClone(optCostStore()); ocDraw(); }
function ocSync(){
  var root=document.getElementById('optMasterRoot'); if(!root)return;
  var next={};
  root.querySelectorAll('[data-oc-row]').forEach(function(tr){
    var g=tr.getAttribute('data-oc-g'), lk=tr.getAttribute('data-oc-l'), lbl=tr.getAttribute('data-oc-label')||'';
    var ing=(tr.querySelector('[data-ocf="ing"]')||{}).value||'';
    if(!ing)return;
    function v(f){var el=tr.querySelector('[data-ocf="'+f+'"]');return (el&&el.value!=='')?(Number(el.value)||0):null;}
    next[g]=next[g]||{}; next[g][lk]=next[g][lk]||{label:lbl,ings:[]};
    next[g][lk].ings.push({ing:ing,qtyS:v('qtyS'),qtyM:v('qtyM'),qtyL:v('qtyL')});
  });
  window.__optCostDraft=next;
}
function ocDraw(){
  var root=document.getElementById('optMasterRoot'); if(!root)return;
  var d=window.__optCostDraft||{};
  var invList=ings().slice().sort(function(a,b){return (a.name||'').localeCompare(b.name||'');});
  function ingSel(val){return '<select class="pz-in" data-ocf="ing" style="min-width:150px;"><option value="">— ingredient —</option>'+invList.map(function(i){return '<option value="'+i.id+'"'+(i.id===val?' selected':'')+'>'+esc(i.name)+' ('+esc(i.unit||'')+') · '+ingType(i)+'</option>';}).join('')+'</select>';}
  var cards=ocGroups().map(function(g){
    var badge=(g.required?'required':'optional')+' · '+(g.type==='multi'?'multi-select':'single');
    var choices=(g.choices||[]).map(function(c){
      var lk=optKey(c.label); var rows=(d[g.id]&&d[g.id][lk]&&d[g.id][lk].ings)||[];
      var ingRows=rows.map(function(r,ix){
        return '<tr data-oc-row data-oc-g="'+esc(g.id)+'" data-oc-l="'+esc(lk)+'" data-oc-label="'+esc(c.label)+'" data-oc-ix="'+ix+'">'
          +'<td>'+ingSel(r.ing)+'</td>'
          +'<td><input class="pz-in" type="number" step="any" style="width:64px;" data-ocf="qtyS" value="'+(r.qtyS!=null&&r.qtyS!==''?r.qtyS:'')+'" placeholder="0"/></td>'
          +'<td><input class="pz-in" type="number" step="any" style="width:64px;" data-ocf="qtyM" value="'+(r.qtyM!=null&&r.qtyM!==''?r.qtyM:'')+'" placeholder="0"/></td>'
          +'<td><input class="pz-in" type="number" step="any" style="width:64px;" data-ocf="qtyL" value="'+(r.qtyL!=null&&r.qtyL!==''?r.qtyL:'')+'" placeholder="0"/></td>'
          +'<td><button class="pz-btn warn" data-ocrem data-g="'+esc(g.id)+'" data-l="'+esc(lk)+'" data-ix="'+ix+'" style="padding:0.15rem 0.45rem;">✕</button></td></tr>';
      }).join('');
      var priceTag=(c.price?'<span style="color:#8a5a00;">+'+peso(c.price)+' price</span>':'<span style="color:var(--tl);">free</span>');
      return '<div style="border-top:1px solid var(--cd);padding:0.5rem 0;">'
        +'<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.4rem;"><b>'+esc(c.label)+'</b> <span style="font-size:0.72rem;">'+priceTag+'</span>'
        +'<span data-occost="'+esc(g.id)+'|'+esc(lk)+'" style="font-size:0.72rem;color:var(--tl);">cost/serving — S '+peso(ocChoiceCost(rows,'S'))+' · M '+peso(ocChoiceCost(rows,'M'))+' · L '+peso(ocChoiceCost(rows,'L'))+'</span></div>'
        +(ingRows?'<table class="pz-tbl" style="margin:0.35rem 0;"><thead><tr><th>Ingredient</th><th>S</th><th>M</th><th>L</th><th></th></tr></thead><tbody>'+ingRows+'</tbody></table>':'')
        +'<button class="pz-btn sec" data-ocadd data-g="'+esc(g.id)+'" data-l="'+esc(lk)+'" data-label="'+esc(c.label)+'" style="padding:0.2rem 0.6rem;font-size:0.78rem;">+ ingredient</button>'
        +'</div>';
    }).join('');
    return '<div class="pz-card" style="margin-bottom:0.9rem;"><div style="display:flex;justify-content:space-between;align-items:center;"><div style="font-weight:700;color:var(--bd);">'+esc(g.name)+'</div><span style="font-size:0.7rem;color:var(--tl);">'+badge+'</span></div>'+choices+'</div>';
  }).join('');
  root.innerHTML='<p class="pz-sub">Cost each customer choice by its ingredients, per size (S/M/L). A choice can pull several ingredients — e.g. <b>Hot</b> → hot cup + lid + extra coffee. Keep the base recipe to what every selection shares; put the choice-specific items here. Cost + stock deduct when that choice is picked. Add-ons with no rows here fall back to the legacy per-name cost.</p>'
    +cards
    +'<div style="display:flex;gap:0.5rem;align-items:center;margin-top:0.3rem;"><button class="pz-btn ok" id="optCostSaveAll">💾 Save option costs</button><span id="optCostSaveMsg" style="font-size:0.78rem;color:var(--tl);"></span></div>';
  root.querySelectorAll('[data-ocadd]').forEach(function(b){b.onclick=function(){ ocSync(); var d=window.__optCostDraft; var g=b.getAttribute('data-g'),lk=b.getAttribute('data-l'),lbl=b.getAttribute('data-label'); d[g]=d[g]||{}; d[g][lk]=d[g][lk]||{label:lbl,ings:[]}; d[g][lk].ings.push({ing:'',qtyS:null,qtyM:null,qtyL:null}); ocDraw(); };});
  root.querySelectorAll('[data-ocrem]').forEach(function(b){b.onclick=function(){ ocSync(); var d=window.__optCostDraft; var g=b.getAttribute('data-g'),lk=b.getAttribute('data-l'),ix=Number(b.getAttribute('data-ix')); if(d[g]&&d[g][lk]&&d[g][lk].ings){d[g][lk].ings.splice(ix,1);} ocDraw(); };});
  root.querySelectorAll('select[data-ocf="ing"]').forEach(function(s){s.onchange=function(){ ocSync(); ocDraw(); };});
  root.querySelectorAll('input[data-ocf]').forEach(function(inp){inp.oninput=function(){ var tr=inp.closest('[data-oc-row]'); if(!tr)return; var g=tr.getAttribute('data-oc-g'),lk=tr.getAttribute('data-oc-l'); var rows=[]; root.querySelectorAll('[data-oc-row][data-oc-g="'+g+'"][data-oc-l="'+lk+'"]').forEach(function(r){ var ing=(r.querySelector('[data-ocf="ing"]')||{}).value||''; function v(f){var el=r.querySelector('[data-ocf="'+f+'"]');return (el&&el.value!=='')?(Number(el.value)||0):null;} rows.push({ing:ing,qtyS:v('qtyS'),qtyM:v('qtyM'),qtyL:v('qtyL')}); }); var lab=root.querySelector('[data-occost="'+g+'|'+lk+'"]'); if(lab)lab.textContent='cost/serving — S '+peso(ocChoiceCost(rows,'S'))+' · M '+peso(ocChoiceCost(rows,'M'))+' · L '+peso(ocChoiceCost(rows,'L')); };});
  var saveBtn=document.getElementById('optCostSaveAll'); if(saveBtn)saveBtn.onclick=function(){ ocSync(); var d=window.__optCostDraft||{}; var clean={};
    Object.keys(d).forEach(function(g){ var gc={}; Object.keys(d[g]).forEach(function(lk){ var e=d[g][lk]; var kept=(e.ings||[]).filter(function(r){return r&&r.ing&&(r.qtyS!=null||r.qtyM!=null||r.qtyL!=null);}); if(kept.length)gc[lk]={label:e.label||lk,ings:kept}; }); if(Object.keys(gc).length)clean[g]=gc; });
    var a=A(); a.update(a.ref(a.db,'posSettings'),{optionCosts:clean}).then(function(){ var m=document.getElementById('optCostSaveMsg'); if(m)m.textContent='✓ Saved '+new Date().toLocaleTimeString(); }).catch(function(e){ alert('Could not save option costs: '+((e&&e.code)||e)+'. If PERMISSION_DENIED, log in with your admin email and publish the DB rules.'); });
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
