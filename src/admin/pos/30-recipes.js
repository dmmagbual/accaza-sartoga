function menuList(){ return (A().getMenuItems?A().getMenuItems():[]).slice().sort(function(a,b){return (a.cat||'').localeCompare(b.cat||'')||(a.name||'').localeCompare(b.name||'');}); }
function recipeCostResult(rec,size,item){item=item||{name:'Recipe'};var key=item.key||'preview';return Costing().costRecipe(Object.assign({itemKey:key,recipe:rec,item:item,size:size},costingContext()));}
function recipeCost(rec,size,item){return recipeCostResult(rec,size,item).totalCost;}
function costingIssues(list){return (list||[]).map(function(x){return '• '+(x.message||x.code||'Costing error');}).join('\n');}
/* Menu items with a costing gap: recipe/cost failures, or a drink sale path with no packaging. */
function markNoRecipe(key,val){ var a=A(); a.set(a.ref(a.db,'menuItems/'+key+'/noRecipe'),val?true:null).then(function(){ updateCostBadge(); }).catch(function(e){ alert('Could not update: '+((e&&e.code)||e)+'. Log in with your admin EMAIL.'); }); }
function recipeItemIsDrink(it){
  var cat=String((it&&it.cat)||''),types=(window.__posSettings&&window.__posSettings.catType)||{};
  if(types[cat])return types[cat]==='drink';
  return ['coffee','noncaf','frappe','nonfrappe','soda'].indexOf(cat)>=0||(it&&it.type==='drink');
}
function recipePackagingGap(it){
  if(!recipeItemIsDrink(it))return null;
  var groups=(A().getItemOptionGroups?A().getItemOptionGroups(it):[])||[],assignments=(window.__posSettings&&window.__posSettings.packagingAssignments)||{},assignment=assignments[it.cat]||{},paths=[];
  var mappedGroups=assignment.choices||{},usedMapped=false;
  groups.forEach(function(g){if(!mappedGroups[g.id])return;usedMapped=true;(g.choices||[]).forEach(function(c){paths.push({label:c.label||g.name||'choice',style:Costing().serveStyleFor(it,[c.label],costingContext())});});});
  if(!usedMapped)paths.push({label:'drink',style:Costing().serveStyleFor(it,[],costingContext())});
  var missing=paths.filter(function(p){return !p.style;});
  if(missing.length)return 'No effective serve style'+(missing[0].label==='drink'?'':' for '+missing[0].label);
  var uncovered=paths.filter(function(p){var rule=packagingRulesMap[p.style];return !(rule&&Array.isArray(rule.rows)&&rule.rows.some(function(r){return r&&r.ing;}));});
  if(uncovered.length)return 'No packaging set for '+uncovered[0].style;
  return null;
}
function menuCostGaps(){
  var out=[];
  menuList().forEach(function(it){
    if(!recipeItemIsDrink(it))return;
    if(it.noRecipe)return; /* resale / bought-in items opted out of costing */
    var rec=recipesMap[it.key];
    if(!recipeHasIngredientRows(rec)){ out.push({key:it.key,name:it.name,cat:it.cat,reason:'No recipe yet'}); return; }
    if((rec.base||[]).some(function(b){return b.ing&&!inventoryMap[b.ing];})){ out.push({key:it.key,name:it.name,cat:it.cat,reason:'An ingredient was deleted (broken link)'}); return; }
    var failedPath=null;recipeRequiredPaths(it).some(function(path){var result=Costing().costRecipe(Object.assign({itemKey:it.key,recipe:rec,item:it,size:'M',optLabels:path.map(function(x){return x.label;})},costingContext())),missing=(result.warnings||[]).filter(function(w){return w.code==='MISSING_COST';})[0];if(missing||!(result.totalCost>0)){failedPath={path:path,result:result,missing:missing};return true;}return false;});
    if(failedPath){var suffix=failedPath.path.length?' for '+recipePathLabel(failedPath.path):'';if(failedPath.missing){var missingItem=inventoryMap[failedPath.missing.itemId]||{};out.push({key:it.key,name:it.name,cat:it.cat,reason:(missingItem.name||failedPath.missing.itemId||'An ingredient')+' has no unit cost'+suffix});}else out.push({key:it.key,name:it.name,cat:it.cat,reason:'Recipe cost is ₱0'+suffix});return;}
    var packagingGap=recipePackagingGap(it);
    if(packagingGap)out.push({key:it.key,name:it.name,cat:it.cat,reason:packagingGap});
  });
  return out;
}
function updateCostBadge(){ var n=menuCostGaps().length; var b=document.getElementById('costGapBadge'); if(!b)return; if(n>0){b.textContent=n;b.style.display='inline-block';}else{b.style.display='none';} }
function renderRecipes(){
  var root=document.getElementById('recipesRoot'); if(!root)return;
  if(['options','optlibrary','repair','consumables'].indexOf(recSub)>=0)recSub='base';
  var tabs=[['base','🧪 Recipe Costing'],['shared','Shared Ingredients'],['packaging','📦 Packaging Costing'],['saved','📋 Saved Recipes'],['export','⬇ Export Recipes']];
  var nav='<div style="display:flex;gap:0.4rem;margin:0.4rem 0 1rem;flex-wrap:wrap;">'+tabs.map(function(t){return '<button class="pz-btn '+(recSub===t[0]?'ok':'sec')+'" data-recsub="'+t[0]+'" style="padding:0.4rem 0.9rem;">'+t[1]+'</button>';}).join('')+'</div>';
  var body;
  if(recSub==='packaging'){ body='<div id="packagingRoot"></div>'; }
  else if(recSub==='shared'){body='<p class="pz-sub">Define quantities once, then select the ingredients each drink inherits. Menu Availability categories and choices remain the source of truth.</p><div style="display:flex;gap:.4rem;margin-bottom:.8rem;"><button class="pz-btn ok" data-sharedview="base">Shared Base Ingredients</button><button class="pz-btn sec" data-sharedview="choice">Shared Choice Ingredients</button></div><div id="sharedIngredientsRoot"></div>';}
  else if(recSub==='export'){
    body='<p class="pz-sub">Download recipe costing for review, backup or controlled spreadsheet maintenance.</p><div class="pz-card"><div style="display:flex;gap:0.5rem;flex-wrap:wrap;">'
      +'<button class="pz-btn sec" id="recCostSheet">📊 Cost sheet</button><button class="pz-btn sec" id="recExport">⬇ Export recipes</button><button class="pz-btn sec" id="recTemplate">⬇ Import template</button><button class="pz-btn ok" id="recImportBtn">⬆ Import recipes</button><input type="file" id="recImportFile" accept=".xlsx,.xls,.csv" style="display:none;"/></div><p class="pz-sub" style="margin-bottom:0;">Import remains available here for controlled maintenance. It validates recipes before saving and does not change completed order snapshots.</p></div>';
  }
  else if(recSub==='saved'){
    var sitems=menuList().filter(function(it){return !!recipesMap[it.key];});
    var savedRows=sitems.length?sitems.map(function(it){var rec=recipesMap[it.key];return '<tr style="cursor:pointer;" data-recopen="'+esc(it.key)+'"><td>'+esc(it.name)+'</td><td style="color:var(--tl);font-size:0.8rem;">'+esc(A().getCatLabel?A().getCatLabel(it.cat):(it.cat||''))+'</td><td class="r">'+((rec.base&&rec.base.length)||0)+'</td><td class="r">'+peso(recipeCost(rec,'S',it))+'</td><td class="r">'+peso(recipeCost(rec,'M',it))+'</td><td class="r">'+peso(recipeCost(rec,'L',it))+'</td><td class="r"><button class="pz-btn ok" data-recopen="'+esc(it.key)+'" style="padding:0.15rem 0.6rem;">Open</button></td></tr>';}).join(''):'<tr><td colspan="7" style="color:var(--tl);padding:0.6rem;">No saved recipes yet. Build one in the Recipe tab.</td></tr>';
    body='<p class="pz-sub">All saved recipes ('+sitems.length+'). Click a row to open it in the Recipe tab — edit, add or remove ingredients, then save.</p>'
      +'<div class="pz-card"><div style="overflow-x:auto;"><table class="pz-tbl"><thead><tr><th>Item</th><th>Category</th><th class="r">Ingredients</th><th class="r">Cost S</th><th class="r">Cost M</th><th class="r">Cost L</th><th></th></tr></thead><tbody>'+savedRows+'</tbody></table></div></div>';
  }
  else {
    var drinkCats=(A().getCats?A().getCats():[]).filter(function(c){return ['coffee','noncaf','frappe','nonfrappe','soda'].indexOf(c.id)>=0;});
    if(!recCategory&&drinkCats.length)recCategory=drinkCats[0].id;
    var items=menuList().filter(function(it){return recipeItemIsDrink(it)&&(!recCategory||it.cat===recCategory);});
    var opts=items.map(function(it){var has=!!recipesMap[it.key];return '<option value="'+esc(it.key)+'"'+(it.key===curRecipeKey?' selected':'')+'>'+(has?'✓ ':'○ ')+esc(it.name)+'</option>';}).join('');
    var covered=items.filter(function(it){return !!recipesMap[it.key];}).length;
    var catOpts=drinkCats.map(function(c){return '<option value="'+esc(c.id)+'"'+(c.id===recCategory?' selected':'')+'>'+esc(c.icon+' '+c.label)+'</option>';}).join('');
    body='<p class="pz-sub">Menu Availability is the source of truth. Choose a category, then a drink. Only the option groups assigned to that drink—Temperature, Milk, Sweetness, Shots, Syrups, Toppings or future choices—appear below. <b>'+covered+' of '+items.length+'</b> drinks in this category have a saved recipe.</p>'
      +'<div class="pz-card" style="margin-bottom:1rem;"><div style="display:flex;gap:0.7rem;flex-wrap:wrap;"><label style="flex:1 1 240px;"><span class="pz-lbl">1. Drink category</span><select class="pz-in" id="recCategoryPick">'+catOpts+'</select></label><label style="flex:1 1 280px;"><span class="pz-lbl">2. Drink</span><select class="pz-in" id="recPick"><option value="">— choose a drink —</option>'+opts+'</select></label></div></div><div id="recEditor"></div>';
  }
  var tools='';
  var _gaps=menuCostGaps();
  var _editingNow=(recSub==='base'&&!!curRecipeKey);
  var gapPanel;
  if(!_gaps.length){ gapPanel='<div class="pz-card" style="border:1px solid #a8d5b5;background:#f0faf4;margin-bottom:0.8rem;color:#2d6a4f;font-weight:600;">✓ All drinks have complete costing.</div>'; }
  else if(_editingNow){ gapPanel='<div class="pz-card" style="border:1px solid #f0c36d;background:#fff8e8;margin-bottom:0.6rem;padding:0.45rem 0.8rem;display:flex;justify-content:space-between;align-items:center;gap:0.5rem;"><span style="color:#8a5a00;font-weight:600;">⚠ '+_gaps.length+' menu item'+(_gaps.length===1?'':'s')+' still not costed — finish below, the list updates.</span><button class="pz-btn sec" id="recBackToList" style="padding:0.15rem 0.6rem;">◂ Back to list</button></div>'; }
  else { gapPanel='<div class="pz-card" style="border:1px solid #f0c36d;background:#fff8e8;margin-bottom:0.8rem;"><div style="font-weight:700;color:#8a5a00;">⚠ Costing Incomplete — '+_gaps.length+' drink'+(_gaps.length===1?'':'s')+'</div><p class="pz-sub" style="margin:0.2rem 0 0.4rem;">Every drink remains sellable. These flags identify missing recipe, inventory-cost or packaging links so COGS can be completed.</p>'+_gaps.map(function(g){return '<div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;padding:0.25rem 0;border-top:1px solid #f0e0c0;"><span>'+esc(g.name)+' <span style="color:#a06a10;font-size:0.75rem;">· '+esc(g.reason)+'</span></span><button class="pz-btn ok" data-recopen="'+esc(g.key)+'" style="padding:0.12rem 0.6rem;">Cost it</button></div>';}).join('')+'</div>'; }
  root.innerHTML='<div class="pz-h">🧪 Recipe &amp; Costing</div>'+gapPanel+nav+tools+body;
  updateCostBadge();
  var _btl=document.getElementById('recBackToList'); if(_btl)_btl.onclick=function(){ curRecipeKey=null; recipeEditing=false; renderRecipes(); };
  root.querySelectorAll('[data-recsub]').forEach(function(b){b.onclick=function(){recSub=b.getAttribute('data-recsub');recipeEditing=false;renderRecipes();};});
  root.querySelectorAll('[data-recopen]').forEach(function(b){b.onclick=function(){curRecipeKey=b.getAttribute('data-recopen');var target=(A().menuItemsMap||{})[curRecipeKey];if(target&&target.cat)recCategory=target.cat;recSub='base';recipeEditing=false;renderRecipes();var e=document.getElementById('recEditor');if(e)e.scrollIntoView({behavior:'smooth',block:'start'});};});
  root.querySelectorAll('[data-noneed]').forEach(function(b){b.onclick=function(){ if(confirm('Mark this as a resale / bought-in item that needs no recipe? It will be hidden from the not-costed flag. Its COGS won\'t be tracked by recipe — record its cost via the purchase price instead.')) markNoRecipe(b.getAttribute('data-noneed'),true); renderRecipes(); };});
  var _cs=document.getElementById('recCostSheet'); if(_cs)_cs.onclick=exportCostSheet;
  var _re=document.getElementById('recExport'); if(_re)_re.onclick=exportRecipesXlsx;
  var _rt=document.getElementById('recTemplate'); if(_rt)_rt.onclick=downloadRecipeTemplate;
  var _rb=document.getElementById('recImportBtn'), _rf=document.getElementById('recImportFile');
  if(_rb&&_rf){ _rb.onclick=function(){_rf.value='';_rf.click();}; _rf.onchange=function(){ if(_rf.files&&_rf.files[0])importRecipesXlsx(_rf.files[0]); }; }
  if(recSub==='packaging'){ renderServeStylePackaging(); }
  else if(recSub==='shared'){renderSharedIngredients();}
  else if(recSub==='saved'){ root.querySelectorAll('[data-recopen]').forEach(function(b){b.onclick=function(){curRecipeKey=b.getAttribute('data-recopen');recSub='base';recipeEditing=false;renderRecipes();};}); }
  else if(recSub==='base'){ var cp=document.getElementById('recCategoryPick');if(cp)cp.onchange=function(){recCategory=this.value;curRecipeKey=null;recipeEditing=false;renderRecipes();};var rp=document.getElementById('recPick'); if(rp)rp.onchange=function(){ curRecipeKey=this.value||null; openRecipe(curRecipeKey); };
    if(curRecipeKey)openRecipe(curRecipeKey); }
}
function optLabelsForItem(item){
  var groups=A().getItemOptionGroups?A().getItemOptionGroups(item):[]; var out=[];
  (groups||[]).forEach(function(g){ (g.choices||[]).forEach(function(c){ out.push({group:g.name,label:c.label}); }); });
  return out;
}
function isPackagingCostItem(id){var inv=inventoryMap[id]||{},cat=(invCatsMap()[inv.category]||{}).name||inv.category||'';if(/packag|cup|lid|straw|sleeve|tissue|serviette/i.test(String(cat)))return true;return Object.keys(packagingRulesMap||{}).some(function(style){return ((packagingRulesMap[style]||{}).rows||[]).some(function(row){return row&&row.ing===id;});});}
function renderSharedIngredients(){
  var root=document.getElementById('sharedIngredientsRoot');if(!root)return;
  var view=window.__sharedIngredientView||'base';
  document.querySelectorAll('[data-sharedview]').forEach(function(b){b.className='pz-btn '+(b.getAttribute('data-sharedview')===view?'ok':'sec');b.onclick=function(){window.__sharedIngredientView=b.getAttribute('data-sharedview');renderSharedIngredients();};});
  if(view==='choice'){root.innerHTML='<div id="optMasterRoot"></div>';renderOptionsMaster();return;}
  var cats=(A().getCats?A().getCats():[]).filter(function(c){return menuList().some(function(it){return it.cat===c.id&&recipeItemIsDrink(it);});});
  if(!window.__sharedBaseCat&&cats.length)window.__sharedBaseCat=cats[0].id;
  var cat=window.__sharedBaseCat||'',store=(window.__posSettings&&window.__posSettings.sharedBaseIngredients)||{},rows=ocClone((store[cat]||{}).ings||[]),inv=ings();
  function sel(v){return '<select class="pz-in" data-sbf="ing"><option value="">— ingredient —</option>'+inv.map(function(i){return '<option value="'+esc(i.id)+'"'+(i.id===v?' selected':'')+'>'+esc(i.name)+' ('+esc(i.unit||'')+')</option>';}).join('')+'</select>';}
  var body=rows.map(function(r,i){var item=inventoryMap[r.ing]||{},u=r.unit||item.unit||'',units=compatUnits(item);function shown(sz){if(r['disp'+sz]!=null)return r['disp'+sz];var cv=Costing().convert(Number(r['qty'+sz])||0,item.unit||u,u);return cv.ok?cv.qty:r['qty'+sz];}return '<tr data-sbrow="'+i+'"><td>'+sel(r.ing)+'</td><td><select class="pz-in" data-sbf="unit" style="width:82px">'+units.map(function(x){return '<option'+(uNorm(x)===uNorm(u)?' selected':'')+'>'+esc(x)+'</option>';}).join('')+'</select><small style="display:block;color:var(--tl)">stock: '+esc(item.unit||'—')+'</small></td>'+['S','M','L'].map(function(sz){return '<td><input class="pz-in" data-sbf="disp'+sz+'" type="number" step="any" value="'+(shown(sz)!=null?shown(sz):'')+'" style="width:82px;text-align:right"></td>';}).join('')+'<td><button class="pz-btn warn" data-sbrem="'+i+'">✕</button></td></tr>';}).join('');
  root.innerHTML='<div class="pz-card"><label><span class="pz-lbl">Menu category</span><select id="sharedBaseCat" class="pz-in">'+cats.map(function(c){return '<option value="'+esc(c.id)+'"'+(c.id===cat?' selected':'')+'>'+esc(c.label||c.id)+'</option>';}).join('')+'</select></label><p class="pz-sub">Choose the recipe unit you actually measure. Quantities are converted to the Inventory stock unit for costing and stock deduction. Changes affect future sales only.</p><div style="overflow-x:auto"><table class="pz-tbl"><thead><tr><th>Ingredient</th><th>Recipe unit</th><th>S quantity</th><th>M quantity</th><th>L quantity</th><th></th></tr></thead><tbody>'+(body||'<tr><td colspan="6" style="color:var(--tl)">No shared base ingredients defined.</td></tr>')+'</tbody></table></div><div style="display:flex;gap:.5rem;margin-top:.6rem"><button class="pz-btn sec" id="sharedBaseAdd">+ ingredient</button><button class="pz-btn ok" id="sharedBaseSave">Save shared base</button><span id="sharedBaseMsg" class="pz-sub"></span></div></div>';
  function sync(){var out=[];root.querySelectorAll('[data-sbrow]').forEach(function(tr){var ing=(tr.querySelector('[data-sbf="ing"]')||{}).value||'';if(!ing)return;var item=inventoryMap[ing]||{},unitEl=tr.querySelector('[data-sbf="unit"]'),u=(unitEl&&unitEl.value)||item.unit||'',row={ing:ing,unit:u};['S','M','L'].forEach(function(sz){var el=tr.querySelector('[data-sbf="disp'+sz+'"]'),display=el&&el.value!==''?Number(el.value):0,stock=convertToStock(display,u,item);row['disp'+sz]=display;row['qty'+sz]=stock;});out.push(row);});return out;}
  function stage(next){var copy=ocClone(store);copy[cat]=Object.assign({},copy[cat]||{},{ings:next});window.__posSettings.sharedBaseIngredients=copy;renderSharedIngredients();}
  document.getElementById('sharedBaseCat').onchange=function(){window.__sharedBaseCat=this.value;renderSharedIngredients();};
  document.getElementById('sharedBaseAdd').onclick=function(){var next=sync();next.push({ing:'',unit:'',dispS:null,dispM:null,dispL:null});stage(next);};
  root.querySelectorAll('[data-sbrem]').forEach(function(b){b.onclick=function(){var next=sync();next.splice(Number(b.getAttribute('data-sbrem')),1);stage(next);};});
  root.querySelectorAll('select[data-sbf="ing"]').forEach(function(s){s.onchange=function(){stage(sync());};});
  document.getElementById('sharedBaseSave').onclick=function(){var next=sync(),seen={};for(var i=0;i<next.length;i++){if(seen[next[i].ing]){alert('Each shared ingredient may appear only once.');return;}if(['S','M','L'].some(function(sz){return !Number.isFinite(next[i]['qty'+sz])||next[i]['qty'+sz]<0;})){alert('Choose a compatible recipe unit and enter zero or positive quantities for every size.');return;}seen[next[i].ing]=1;}var prior=store[cat]||{},proposed=ocClone(store);proposed[cat]={ings:next};var affected=menuList().filter(function(it){return it.cat===cat&&recipesMap[it.key]&&(recipesMap[it.key].sharedBase||[]).length;});var delta={S:0,M:0,L:0};affected.forEach(function(it){['S','M','L'].forEach(function(sz){var args=Object.assign({},costingContext(),{itemKey:it.key,recipe:recipesMap[it.key],item:it,size:sz,optLabels:[]});var before=Costing().costRecipe(args).totalCost;args.sharedBaseIngredients=proposed;delta[sz]+=Costing().costRecipe(args).totalCost-before;});});if(affected.length&&!confirm('This will update future costing for '+affected.length+' saved drink(s). Combined base-cost change: S '+peso(delta.S)+' · M '+peso(delta.M)+' · L '+peso(delta.L)+'.\n\nCompleted orders and their COGS snapshots will not change. Continue?'))return;var entry={ings:next,revision:Number(prior.revision||0)+1,updatedAt:Date.now(),updatedBy:(A().auth&&A().auth.currentUser&&A().auth.currentUser.uid)||'admin',lastChange:{previousRevision:Number(prior.revision||0),previousIngredients:prior.ings||[],affectedDrinks:affected.length,costDelta:delta}};A().set(A().ref(A().db,'posSettings/sharedBaseIngredients/'+cat),entry).then(function(){document.getElementById('sharedBaseMsg').textContent='✓ Saved revision '+entry.revision;}).catch(function(e){alert('Could not save shared base: '+((e&&e.message)||e));});};
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
    sharedBase:(saved.sharedBase||[]).map(function(x){return {ing:typeof x==='string'?x:x.ing};}),
    base:(saved.base?saved.base.map(function(b){
      var inv=inventoryMap[b.ing]||{}; var u=b.unit||inv.unit||'';
      if(uNorm(u)==='oz'){var dim=itemDim(inv);u=dim==='volume'?'fl oz':(dim==='weight'?'oz wt':u);}
      var qS,qM,qL;
      if(b.qtyS!=null||b.qtyM!=null||b.qtyL!=null){qS=b.qtyS;qM=b.qtyM;qL=b.qtyL;}
      else{var q=Number(b.qty)||0;qS=q*(sm.S!=null?sm.S:1);qM=q*(sm.M!=null?sm.M:1);qL=q*(sm.L!=null?sm.L:1);}
      function display(stored,shown){if(shown!=null)return shown;var cv=Costing().convert(Number(stored)||0,inv.unit||u,u);return cv.ok?cv.qty:stored;}
      return {ing:b.ing,unit:u,dS:display(qS,b.dispS),dM:display(qM,b.dispM),dL:display(qL,b.dispL),when:b.when,useFor:b.useFor};
    }):[]),
    choiceAdd:(function(){var out={};Object.keys(saved.choiceAdd||{}).forEach(function(g){out[g]={};Object.keys(saved.choiceAdd[g]||{}).forEach(function(lk){var e=saved.choiceAdd[g][lk]||{};out[g][lk]={label:e.label||lk,ings:(e.ings||[]).map(function(r){var inv=inventoryMap[r.ing]||{},u=r.unit||inv.unit||'';if(uNorm(u)==='oz'){var dim=itemDim(inv);u=dim==='volume'?'fl oz':(dim==='weight'?'oz wt':u);}function display(sz){var shown=r['disp'+sz];if(shown!=null)return shown;var cv=Costing().convert(Number(r['qty'+sz])||0,inv.unit||u,u);return cv.ok?cv.qty:r['qty'+sz];}return {ing:r.ing,unit:u,dS:display('S'),dM:display('M'),dL:display('L'),op:r.op,when:r.when,useFor:r.useFor};})};});});return out;})(),
    _optPreview:[]
  };
  var _sel={}; (A().getItemOptionGroups?A().getItemOptionGroups(item):[]).forEach(function(g){
    var choices=g.choices||[],name=String(g.name||'').toLowerCase();
    if(g.required&&g.type!=='multi'&&choices.length&&!/(sweet|milk)/.test(name))_sel[g.id]=choices[0].label;
  });
  window.__recCostSel=_sel;
  drawRecipeEditor(item);
}
function drawRecipeEditor(item){
  var ed=document.getElementById('recEditor'); if(!ed)return;
  var d=recipeDraft; var size=recSize||'M';
  var recipeCols='<colgroup><col style="width:32%"><col style="width:13%"><col style="width:10%"><col style="width:10%"><col style="width:10%"><col style="width:25%"></colgroup>';
  var cat=item.cat||''; var ct=catType(cat);
  var tempSelection=recipeTemperatureSelection((A().getItemOptionGroups?A().getItemOptionGroups(item):[])||[],window.__recCostSel||{}),tempGroup=tempSelection.group,tempLabel=Array.isArray(tempSelection.label)?'':tempSelection.label;
  var sharedLibrary=(((window.__posSettings&&window.__posSettings.sharedBaseIngredients)||{})[cat]||{}).ings||[],sharedSelected={};(d.sharedBase||[]).forEach(function(x){sharedSelected[typeof x==='string'?x:x.ing]=1;});
  var sharedPicker=sharedLibrary.length?'<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:.35rem;">'+sharedLibrary.map(function(r){var inv=inventoryMap[r.ing]||{};return '<label style="display:flex;gap:.45rem;align-items:flex-start;padding:.45rem;border:1px solid var(--cd);border-radius:7px;background:#fff"><input type="checkbox" data-sharedpick="'+esc(r.ing)+'"'+(sharedSelected[r.ing]?' checked':'')+'><span><b>'+esc(inv.name||r.ing)+'</b><small style="display:block;color:var(--tl)">'+num(r.qtyS)+' / '+num(r.qtyM)+' / '+num(r.qtyL)+' '+esc(inv.unit||'')+' · inherited</small></span></label>';}).join('')+'</div>':'<p class="pz-sub">No shared base is defined for this category. Add it under Shared Ingredients, or add recipe-specific ingredients below.</p>';
  function ingSelect(val,attr){return '<select class="pz-in" '+attr+' style="min-width:150px;"><option value="">— ingredient —</option>'+ingsByType('base').concat(ingsByType('both')).concat(ingsByType('consumable')).map(function(i){return '<option value="'+i.id+'"'+(i.id===val?' selected':'')+'>'+esc(i.name)+' ('+esc(i.unit||'')+') · '+ingType(i)+'</option>';}).join('')+'</select>';}
  var baseTotal=0;
  var baseRows=d.base.map(function(r,ix){
    var inv=inventoryMap[r.ing]||{};
    var stockQ=convertToStock((r['d'+size]===''||r['d'+size]==null)?0:Number(r['d'+size]),r.unit,inv);
    var amt=(Number.isFinite(stockQ)?stockQ:0)*ingCost(r.ing); baseTotal+=amt;
    var cu=compatUnits(inv); var uOpts=cu.map(function(u){return '<option'+(uNorm(u)===uNorm(r.unit)?' selected':'')+'>'+esc(u)+'</option>';}).join('');
    var stkNote=!Number.isFinite(stockQ)?'<div style="font-size:0.62rem;color:#b44336;">incompatible unit</div>':((inv.unit&&uNorm(inv.unit)!==uNorm(r.unit))?('<div style="font-size:0.62rem;color:var(--tl);">=&nbsp;'+num(Math.round(stockQ*1000)/1000)+' '+esc(inv.unit)+'</div>'):'');
    function qc(sz){return '<input class="pz-in" type="number" step="any" style="width:100%;max-width:90px;text-align:right;" value="'+(r['d'+sz]!=null&&r['d'+sz]!==''?r['d'+sz]:'')+'" data-brow="'+ix+'" data-bfield="d'+sz+'" placeholder="0"/>';}
    var scope=recipeBaseTemperatureScope(r,d.base,tempGroup);
    return '<tr data-base-row><td>'+ingSelect(r.ing,'data-brow="'+ix+'" data-bfield="ing"')+scope.html+'</td>'
      +'<td style="white-space:nowrap;"><select class="pz-in" data-brow="'+ix+'" data-bfield="unit" style="width:70px;padding-left:0.3rem;padding-right:0.2rem;" title="Unit you are entering — converts to the item stock unit for costing">'+(uOpts||'<option></option>')+'</select>'+stkNote+'</td>'
      +'<td class="r">'+qc('S')+'</td><td class="r">'+qc('M')+'</td><td class="r">'+qc('L')+'</td>'
      +'<td class="r" style="white-space:nowrap;font-weight:600;">'+peso(amt)+recipeBaseMoveButton(ix,tempLabel)+' <button class="pz-btn warn" style="padding:0.2rem 0.45rem;font-weight:400;" data-brem="'+ix+'">✕</button></td></tr>';
  }).join('');
  var sizeBtns=['S','M','L'].map(function(sz){return '<button class="pz-btn '+(sz===size?'ok':'sec')+'" data-recsize="'+sz+'" style="padding:0.25rem 0.8rem;">'+sz+'</button>';}).join(' ');
  var grand=baseTotal;
  var caGroupsAll=(A().getItemOptionGroups?A().getItemOptionGroups(item):[])||[];
  var selState=window.__recCostSel||{};
  var temperatureGroup=recipeTemperatureGroup(caGroupsAll);
  function caSelected(g,c){var s=selState[g.id];return Array.isArray(s)?s.indexOf(c.label)>=0:s===c.label;}
  var caAllow=caGroupsAll.map(function(g){return g.id;});
  if(d.choiceAdd){Object.keys(d.choiceAdd).forEach(function(_g){if(caAllow.indexOf(_g)<0)delete d.choiceAdd[_g];});}
  var caGroups=caGroupsAll.filter(function(g){return (g.choices||[]).some(function(c){return caSelected(g,c);});});
  var caInv=ings().slice().sort(function(a,b){return (a.name||'').localeCompare(b.name||'');});
  function caIngSel(val){return '<select class="pz-in" data-caf="ing" style="min-width:150px;"><option value="">— ingredient —</option>'+caInv.map(function(i){var blocked=isPackagingCostItem(i.id)&&i.id!==val;return '<option value="'+i.id+'"'+(i.id===val?' selected':'')+(blocked?' disabled':'')+'>'+esc(i.name)+' ('+esc(i.unit||'')+') · '+(blocked?'Packaging Costing only':ingType(i))+'</option>';}).join('')+'</select>';}
  function caDraftCost(rows,sz){var total=0;(rows||[]).forEach(function(r){var inv=inventoryMap[r.ing]||{},q=convertToStock((r['d'+sz]===''||r['d'+sz]==null)?0:Number(r['d'+sz]),r.unit||inv.unit,inv);if(Number.isFinite(q))total+=q*ingCost(r.ing);});return total;}
  var caCards=caGroups.map(function(g){
    var choices=(g.choices||[]).filter(function(c){return caSelected(g,c);}).map(function(c){
      var lk=optKey(c.label); var rows=(d.choiceAdd&&d.choiceAdd[g.id]&&d.choiceAdd[g.id][lk]&&d.choiceAdd[g.id][lk].ings)||[];
      var ingRows=rows.map(function(r,ix){
        var inv=inventoryMap[r.ing]||{},cu=compatUnits(inv),u=r.unit||inv.unit||'',uOpts=cu.map(function(x){return '<option'+(uNorm(x)===uNorm(u)?' selected':'')+'>'+esc(x)+'</option>';}).join('');
        var stockQ=convertToStock((r['d'+size]===''||r['d'+size]==null)?0:Number(r['d'+size]),u,inv),amount=(Number.isFinite(stockQ)?stockQ:0)*ingCost(r.ing);
        var activeTemp=temperatureGroup&&selState[temperatureGroup.id],scope=recipeTemperatureControl(r,temperatureGroup,activeTemp);
        return '<tr data-carow data-ca-g="'+esc(g.id)+'" data-ca-l="'+esc(lk)+'" data-ca-label="'+esc(c.label)+'" data-ca-op="'+esc(r.op||'')+'" data-ca-when="'+esc(JSON.stringify(r.when||{}))+'" data-ca-temp-group="'+esc(temperatureGroup&&temperatureGroup.id||'')+'" data-ca-ix="'+ix+'"'+(scope.active?'':' style="opacity:.58"')+'>'
          +'<td>'+caIngSel(r.ing)+(scope.active?'':('<small style="display:block;color:#a55">Not used for '+esc(activeTemp)+'</small>'))+scope.html+'</td>'
          +'<td><select class="pz-in" data-caf="unit" style="width:70px;" title="Unit you are entering — converts to the item stock unit for costing">'+(uOpts||'<option></option>')+'</select></td>'
          +'<td class="r"><input class="pz-in" type="number" step="any" style="width:100%;max-width:90px;text-align:right;" data-caf="dS" value="'+(r.dS!=null&&r.dS!==''?r.dS:'')+'" placeholder="0"/></td>'
          +'<td class="r"><input class="pz-in" type="number" step="any" style="width:100%;max-width:90px;text-align:right;" data-caf="dM" value="'+(r.dM!=null&&r.dM!==''?r.dM:'')+'" placeholder="0"/></td>'
          +'<td class="r"><input class="pz-in" type="number" step="any" style="width:100%;max-width:90px;text-align:right;" data-caf="dL" value="'+(r.dL!=null&&r.dL!==''?r.dL:'')+'" placeholder="0"/></td>'
          +'<td class="r" style="white-space:nowrap;font-weight:600;"><span data-caamount>'+peso(amount)+'</span> <button class="pz-btn warn" data-carem data-g="'+esc(g.id)+'" data-l="'+esc(lk)+'" data-ix="'+ix+'" style="padding:0.15rem 0.45rem;font-weight:400;">✕</button></td></tr>';
      }).join('');
      return '<div data-ca-choice data-ca-g="'+esc(g.id)+'" data-ca-l="'+esc(lk)+'" style="border-top:1px solid var(--cd);padding:0.4rem 0;">'
        +'<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.3rem;"><b>'+esc(c.label)+'</b>'
        +'<span data-cacost="'+esc(g.id)+'|'+esc(lk)+'" style="font-size:0.72rem;color:var(--tl);">extra — S '+peso(caDraftCost(rows,'S'))+' · M '+peso(caDraftCost(rows,'M'))+' · L '+peso(caDraftCost(rows,'L'))+'</span></div>'
        +(ingRows?'<table class="pz-tbl" style="margin:0.3rem 0;width:100%;table-layout:fixed;">'+recipeCols+'<thead><tr><th>Extra ingredient</th><th>Recipe unit</th><th class="r">S</th><th class="r">M</th><th class="r">L</th><th class="r">Amount ('+size+')</th></tr></thead><tbody>'+ingRows+'</tbody></table>':'')
        +'<button class="pz-btn sec" data-caadd data-g="'+esc(g.id)+'" data-l="'+esc(lk)+'" data-label="'+esc(c.label)+'" style="padding:0.15rem 0.55rem;font-size:0.76rem;">+ ingredient for '+esc(c.label)+'</button>'
        +'</div>';
    }).join('');
    return '<div style="margin-bottom:0.6rem;"><div style="font-weight:600;color:var(--bd);font-size:0.85rem;">'+esc(g.name)+'</div>'+choices+'</div>';
  }).join('');
  var caSection=caCards?('<div style="border-top:2px solid var(--cd);margin-top:0.8rem;padding-top:0.6rem;"><div style="font-weight:700;color:var(--bd);margin-bottom:0.2rem;">Ingredients for selected choices</div><p class="pz-sub" style="margin-top:0;">Only selected choices appear. Other saved choices stay separate.</p>'+caCards+'</div>'):'';
  var previewNorm=Costing().normalizeRecipe(recipeDraftRaw(d),inventoryMap);
  var previewRec=previewNorm.ok?previewNorm.recipe:null;
  if(previewRec){var _basePreview=Costing().costRecipe(Object.assign({itemKey:item.key,recipe:previewRec,item:item,size:size},costingContext()));baseTotal=_basePreview.totalCost;grand=baseTotal;}
  var selectedLabels=[],selectedChoices=[];
  caGroupsAll.forEach(function(g){var v=selState[g.id];(Array.isArray(v)?v:(v?[v]:[])).forEach(function(lb){selectedLabels.push(lb);selectedChoices.push({groupId:g.id,groupName:g.name||'Option',label:lb});});});
  var previewGroups=(A()&&A().optionGroupsMap)||{},previewAssignments=(window.__posSettings&&window.__posSettings.packagingAssignments)||{};
  var drinkPreview=previewRec?Costing().costRecipe(Object.assign({itemKey:item.key,recipe:previewRec,item:item,size:size,optLabels:selectedLabels},costingContext())):{totalCost:0,lines:[],errors:previewNorm.errors||[],warnings:previewNorm.warnings||[]};
  var drinkTotal=previewRec?drinkPreview.totalCost:baseTotal;
  var breakdown={base:0,options:0,packaging:0},optionAmounts={};
  selectedChoices.forEach(function(c){optionAmounts[c.groupId+'|'+c.label]=0;});
  (drinkPreview.lines||[]).forEach(function(line){var amount=Number(line.totalCost)||0;if(String(line.source).indexOf('base_')===0)breakdown.base+=amount;else if(line.source==='packaging')breakdown.packaging+=amount;else{breakdown.options+=amount;var key=(line.optionGroupId||'')+'|'+(line.optionLabel||'');optionAmounts[key]=(optionAmounts[key]||0)+amount;}});
  var serveStyle=Costing().serveStyleFor(item,selectedLabels,{optionGroups:previewGroups,packagingAssignments:previewAssignments});
  var serveName=(serveStyle&&packagingRulesMap[serveStyle]&&packagingRulesMap[serveStyle].name)||serveStyle||'not assigned';
  function selectedDetail(line){return esc(line.ingredientName)+' · '+num(line.recipeQuantityPerServing??line.quantityPerServing)+' '+esc(line.recipeUnit||line.stockUnit)+' × '+peso(line.unitCost);}
  var optionCostLines=selectedChoices.length?selectedChoices.map(function(c){var detail=(drinkPreview.lines||[]).filter(function(line){return line.optionGroupId===c.groupId&&line.optionLabel===c.label;}).map(function(line){return '<small style="display:block;color:var(--tl);padding-left:.8rem">'+selectedDetail(line)+'</small>';}).join('');return '<div style="display:flex;justify-content:space-between;padding-left:0.8rem;"><span style="color:var(--tl);">'+esc(c.groupName)+' · '+esc(c.label)+'</span><span>'+peso(optionAmounts[c.groupId+'|'+c.label]||0)+'</span></div>'+detail;}).join(''):'<div style="display:flex;justify-content:space-between;padding-left:0.8rem;"><span style="color:var(--tl);">No options selected</span><span>'+peso(0)+'</span></div>';
  var packagingDetail=(drinkPreview.lines||[]).filter(function(line){return line.source==='packaging';}).map(function(line){return '<small style="display:block;color:var(--tl);padding-left:.8rem">'+selectedDetail(line)+'</small>';}).join('');
  var costBreakdown='<div style="display:flex;justify-content:space-between;"><span style="color:var(--tl);">Base recipe</span><span>'+peso(breakdown.base)+'</span></div>'
    +'<div style="display:flex;justify-content:space-between;font-weight:600;"><span style="color:var(--tl);">Selected option ingredients</span><span>'+peso(breakdown.options)+'</span></div>'+optionCostLines
    +'<div style="display:flex;justify-content:space-between;"><span style="color:var(--tl);">Packaging · '+esc(serveName)+'</span><span>'+peso(breakdown.packaging)+'</span></div>'+packagingDetail;
  var traceRows=(drinkPreview.lines||[]).map(function(line){return '<tr><td>'+esc(line.source.replace(/_/g,' ')+(line.optionLabel?' · '+line.optionLabel:''))+'</td><td>'+esc(line.ingredientName)+'</td><td class="r">'+num(line.totalQuantity)+' '+esc(line.stockUnit)+'</td><td class="r">'+peso(line.unitCost)+'</td><td class="r">'+peso(line.totalCost)+'</td></tr>';}).join('');
  var effective={},effectiveTotals={};['S','M','L'].forEach(function(sz){var result=previewRec?Costing().costRecipe(Object.assign({itemKey:item.key,recipe:previewRec,item:item,size:sz,optLabels:selectedLabels},costingContext())):{lines:[],totalCost:0};effectiveTotals[sz]=result.totalCost;(result.lines||[]).forEach(function(line){var k=line.source+'|'+(line.optionLabel||'')+'|'+line.ingredientId;effective[k]=effective[k]||{source:line.source,label:line.optionLabel||'',groupId:line.optionGroupId||'',ingredientId:line.ingredientId,name:line.ingredientName,unit:line.recipeUnit||line.stockUnit,unitCost:line.unitCost};effective[k]['q'+sz]=line.recipeQuantityPerServing??line.quantityPerServing;effective[k]['c'+sz]=line.totalCost;});});
  var requiredSelections=selectedChoices.filter(function(c){return (previewGroups[c.groupId]||{}).required;});
  function effectiveSection(r){if(r.source==='packaging')return 'packaging';if(String(r.source).indexOf('option_')===0&&!((previewGroups[r.groupId]||{}).required))return 'additional';return 'base';}
  function replacementFor(ing,c){var entry=d.choiceAdd&&d.choiceAdd[c.groupId]&&d.choiceAdd[c.groupId][optKey(c.label)];return entry&&(entry.ings||[]).some(function(x){return x.ing===ing&&x.op==='replace';});}
  function inheritedRow(r){return !!sharedSelected[r.ingredientId]&&(r.source==='base_shared'||(r.source==='option_recipe'&&replacementFor(r.ingredientId,{groupId:r.groupId,label:r.label})));}
  function effectiveRow(r){var section=effectiveSection(r),isInherited=inheritedRow(r),choice={groupId:r.groupId,label:r.label},isSharedChoice=!!recipeSharedChoiceRow(r.ingredientId,choice),view=isSharedChoice&&recipeChoiceOverrideView(d,r,temperatureGroup,selState),hasChoiceOverride=view&&view.has,src=section==='additional'?(r.label||'Selected add-on'):r.source==='packaging'?'Serve-style packaging':isInherited?(r.source==='base_shared'?'Shared base':'Shared base · overridden for '+r.label):isSharedChoice?view.label:String(r.source).indexOf('base_')===0?'Recipe-specific ingredient':('Recipe-specific required choice'+(r.label?' · '+r.label:''));var include=isInherited?'<input type="checkbox" data-effective-include="'+esc(r.ingredientId)+'" checked aria-label="Include '+esc(r.name)+'">':hasChoiceOverride&&temperatureGroup?'<input type="checkbox" data-effective-choice-include="'+esc(r.ingredientId)+'" data-choice-group="'+esc(choice.groupId)+'" data-choice-label="'+esc(choice.label)+'" data-temp-group="'+esc(temperatureGroup.id)+'" data-temp-label="'+esc(view.temp)+'"'+(view.on?' checked':'')+' title="Apply this override to '+esc(view.temp)+'" aria-label="Apply '+esc(r.name)+' override to '+esc(view.temp)+'">':'';var overrides=requiredSelections.map(function(c){var attr='',on=false;if(isInherited){attr='data-effective-replace';on=replacementFor(r.ingredientId,c);}else if(isSharedChoice&&r.groupId===c.groupId&&r.label===c.label){attr='data-effective-choice-override';on=hasChoiceOverride;}if(!attr)return '<td></td>';return '<td style="text-align:center"><input type="checkbox" '+attr+'="'+esc(r.ingredientId)+'" data-replace-group="'+esc(c.groupId)+'" data-replace-label="'+esc(c.label)+'"'+(on?' checked':'')+' aria-label="Override '+esc(r.name)+' for '+esc(c.label)+'"></td>';}).join('');return '<tr><td><b>'+esc(r.name)+'</b><small style="display:block;color:var(--tl)">'+esc(src)+'</small></td><td class="r">'+num(r.qS)+' '+esc(r.unit)+'<small style="display:block">'+peso(r.cS)+'</small></td><td class="r">'+num(r.qM)+' '+esc(r.unit)+'<small style="display:block">'+peso(r.cM)+'</small></td><td class="r">'+num(r.qL)+' '+esc(r.unit)+'<small style="display:block">'+peso(r.cL)+'</small></td><td class="r">'+peso(r.unitCost)+'</td><td style="text-align:center">'+include+'</td>'+overrides+'</tr>';}
  function sectionRows(kind,title,note,empty){var list=Object.keys(effective).map(function(k){return effective[k];}).filter(function(r){return effectiveSection(r)===kind;}),tot={S:0,M:0,L:0};list.forEach(function(r){['S','M','L'].forEach(function(sz){tot[sz]+=Number(r['c'+sz])||0;});});var rows=list.map(effectiveRow).join(''),span=6+requiredSelections.length;return '<tr style="background:var(--cm)"><th colspan="'+span+'" style="padding:.42rem .55rem">'+title+(note?' <small style="font-weight:400;color:var(--tl)">— '+note+'</small>':'')+'</th></tr>'+(rows||'<tr><td colspan="'+span+'" style="color:var(--tl)">'+empty+'</td></tr>')+'<tr style="background:#f5f0e8"><th>'+title+' total</th><th class="r">'+peso(tot.S)+'</th><th class="r">'+peso(tot.M)+'</th><th class="r">'+peso(tot.L)+'</th><th></th><th></th>'+requiredSelections.map(function(){return '<th></th>';}).join('')+'</tr>';}
  var overrideHead=requiredSelections.length?'<th colspan="'+requiredSelections.length+'" style="text-align:center">Override</th>':'',overrideLabels=requiredSelections.map(function(c){return '<th style="text-align:center;white-space:nowrap">'+esc(c.label)+'</th>';}).join(''),tableWidth=820+(requiredSelections.length*95);
  var effectiveTable='<div style="overflow-x:auto;margin-top:.7rem"><table class="pz-tbl" style="font-size:.76rem;table-layout:fixed;min-width:'+tableWidth+'px"><colgroup><col style="width:250px"><col style="width:125px"><col style="width:125px"><col style="width:125px"><col style="width:100px"><col style="width:70px">'+requiredSelections.map(function(){return '<col style="width:95px">';}).join('')+'</colgroup><thead><tr><th rowspan="2">Ingredient and source</th><th class="r">S</th><th class="r">M</th><th class="r">L</th><th class="r" rowspan="2">Unit cost</th><th rowspan="2" style="text-align:center">Include</th>'+overrideHead+'</tr><tr><th class="r">Qty / value</th><th class="r">Qty / value</th><th class="r">Qty / value</th>'+overrideLabels+'</tr></thead><tbody>'+sectionRows('base','Base ingredients','Shared base and required-choice replacements.','Select shared ingredients or add a recipe-specific ingredient.')+sectionRows('packaging','Packaging','Selected automatically from the serving style.','No packaging is assigned for this selection.')+sectionRows('additional','Additional ingredients','Included only when selected.','No additional ingredients selected.')+'</tbody><tfoot><tr><th>Cost per drink</th><th class="r">'+peso(effectiveTotals.S)+'</th><th class="r">'+peso(effectiveTotals.M)+'</th><th class="r">'+peso(effectiveTotals.L)+'</th><th></th><th></th>'+requiredSelections.map(function(){return '<th></th>';}).join('')+'</tr></tfoot></table></div>';
  var previewIssues=(drinkPreview.errors||[]).concat(drinkPreview.warnings||[]);
  var tracePanel='<details style="margin-top:0.55rem;"><summary style="cursor:pointer;font-size:0.75rem;color:var(--bd);font-weight:600;">Cost trace · engine '+esc(Costing().VERSION)+'</summary>'+(previewIssues.length?'<div style="margin:0.4rem 0;padding:0.45rem;background:#fff8e8;color:#8a5a00;font-size:0.72rem;white-space:pre-line;">'+esc(costingIssues(previewIssues))+'</div>':'')+(traceRows?'<div style="overflow-x:auto;"><table class="pz-tbl" style="font-size:0.7rem;"><thead><tr><th>Source</th><th>Ingredient</th><th class="r">Usage</th><th class="r">Unit cost</th><th class="r">Cost</th></tr></thead><tbody>'+traceRows+'</tbody></table></div>':'<div style="font-size:0.72rem;color:var(--tl);padding:0.4rem 0;">Add a valid ingredient and quantity to see the trace.</div>')+'</details>';
  var calcGroups=caGroupsAll.map(function(g){var sv=selState[g.id];var isMulti=g.type==='multi';
    var control=(g.choices||[]).map(function(c){var on=isMulti?(Array.isArray(sv)&&sv.indexOf(c.label)>-1):(sv===c.label);return '<label style="display:inline-flex;gap:.3rem;align-items:center;margin:0 .7rem .3rem 0;padding:.28rem .5rem;border:1px solid var(--cd);border-radius:6px;cursor:pointer"><input type="'+(isMulti?'checkbox':'radio')+'" '+(isMulti?'data-rcmulti-check':'data-rcradio')+'="'+esc(g.id)+'" name="rc_'+esc(g.id)+'" data-rclabel="'+esc(c.label)+'"'+(on?' checked':'')+'> '+esc(c.label)+'</label>';}).join('');
    return '<label style="display:block;margin-bottom:.55rem"><span style="font-size:0.7rem;color:var(--tl);text-transform:uppercase;letter-spacing:0.03em;display:block;">'+esc(g.name)+(isMulti?' · optional add-ons':' · required choice')+'</span>'+control+'</label>';
  }).join('');
  var drinkCard='<div class="pz-card" style="margin-bottom:1rem;border:2px solid var(--bd);">'
    +'<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.4rem;margin-bottom:0.4rem;"><span style="font-weight:700;color:var(--bd);">Effective Recipe · '+esc(item.name)+'</span><span><span class="pz-lbl" style="display:inline;margin-right:0.4rem;">Preview size</span>'+sizeBtns+'</span></div>'
    +'<p class="pz-sub" style="margin-top:0;">Required choices show the complete recipe for that selection. Optional add-ons are included only when selected and remain outside the normal base total.</p>'
    +calcGroups
    +effectiveTable
    +'<div style="border-top:1px solid var(--cd);margin-top:0.4rem;padding-top:0.4rem;font-size:0.8rem;">'+costBreakdown+'</div>'
    +'<div style="border-top:2px solid var(--bd);margin-top:0.4rem;padding-top:0.5rem;display:flex;justify-content:space-between;align-items:center;"><span style="font-weight:700;color:var(--bd);">COST PER DRINK / '+size+'</span><span style="font-weight:700;font-size:1.2rem;color:var(--bd);">'+peso(drinkTotal)+'</span></div>'
    +'</div>';
  ed.innerHTML=drinkCard
    +'<div class="pz-card" style="margin-bottom:1rem;">'
      +'<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem;margin-bottom:0.6rem;"><div style="font-weight:600;color:var(--bd);">Recipe for “'+esc(item.name)+'”'+(cat?' · <span style="color:var(--tl);font-size:0.82rem;">'+esc(A().getCatLabel?A().getCatLabel(cat):cat)+(ct?' ('+ct+')':'')+'</span>':'')+'</div><div><span class="pz-lbl" style="display:inline;margin-right:0.4rem;">Cost for size</span>'+sizeBtns+'</div></div>'
      +'<label style="display:inline-flex;align-items:center;gap:0.35rem;font-size:0.76rem;color:var(--tl);margin-bottom:0.5rem;cursor:pointer;"><input type="checkbox" id="recNoNeed"'+(item.noRecipe?' checked':'')+'/> No recipe needed (resale / bought-in item — hide from the not-costed flag)</label>'
      +(ings().length?'':'<p class="pz-low" style="font-size:0.8rem;">Add items in the Inventory tab first.</p>')
      +'<span class="pz-lbl">Shared base ingredients — select what this drink uses</span>'+sharedPicker
      +'<details style="margin-top:.7rem;"'+(baseRows?' open':'')+'><summary style="cursor:pointer;font-weight:700;color:var(--bd)">Recipe-specific base ingredients</summary><p class="pz-sub">A single ingredient applies to all temperatures. Add the same ingredient again to set separate Hot and Iced quantities.</p>'
      +'<table class="pz-tbl" style="margin-bottom:0.4rem;width:100%;table-layout:fixed;">'+recipeCols+'<thead><tr><th>Ingredient</th><th>Recipe unit</th><th class="r">S</th><th class="r">M</th><th class="r">L</th><th class="r">Amount ('+size+')</th></tr></thead><tbody>'+(baseRows||'<tr><td colspan="6" style="color:var(--tl);padding:0.5rem;">No ingredients yet.</td></tr>')+'</tbody></table>'
      +'<button class="pz-btn sec" id="recAddBase" style="padding:.2rem .6rem;font-size:.78rem;">+ ingredient for all choices</button>'
      +'</details>'
      +'<div style="font-size:0.72rem;color:var(--tl);margin-top:0.3rem;"><b>Do not add cups, lids, straws or tissue here.</b> Packaging is costed once through Packaging Costing. Every ingredient selected here is linked to its Inventory record and is included in sale COGS.</div>'
      +'<div style="border-top:2px solid var(--bd);margin-top:0.8rem;padding-top:0.6rem;display:flex;justify-content:space-between;align-items:center;"><span style="font-weight:700;color:var(--bd);">BASE COST / '+size+'</span><span style="font-weight:700;font-size:1.1rem;color:var(--bd);">'+peso(grand)+'</span></div>'
      +'<div style="font-size:0.68rem;color:var(--tl);margin-top:0.2rem;">Base ingredients only. The full cost per drink (base + extras + optional) is in the calculator below.</div>'
      +tracePanel
      +caSection
      +'<div style="margin-top:1rem;display:flex;gap:0.5rem;">'
        +'<button class="pz-btn ok" id="recSave">💾 Save recipe</button>'
        +'<button class="pz-btn sec" id="recClose">Close</button>'
        +(recipesMap[item.key]?'<button class="pz-btn warn" id="recDel" style="margin-left:auto;">Delete recipe</button>':'')
      +'</div>'
    +'</div>';
  // sync DOM into draft
  function syncDraft(){
    var base=[]; d.base.forEach(function(_,ix){ var ing=ed.querySelector('[data-brow="'+ix+'"][data-bfield="ing"]'); if(!ing)return; var tr=ing.closest('[data-base-row]'),uEl=ed.querySelector('[data-brow="'+ix+'"][data-bfield="unit"]'); var inv=inventoryMap[ing.value]||{}; var u=uEl?uEl.value:(inv.unit||''); if(compatUnits(inv).map(uNorm).indexOf(uNorm(u))<0)u=inv.unit||u; var row={ing:ing.value,unit:u},when=recipeBaseScopeFromRow(tr,tempGroup);if(Object.keys(when).length)row.when=when; ['S','M','L'].forEach(function(sz){var q=ed.querySelector('[data-brow="'+ix+'"][data-bfield="d'+sz+'"]'); row['d'+sz]=q?(q.value===''?'':(Number(q.value)||0)):'';}); base[ix]=row;});
    d.base=base.filter(function(x){return x;});
  }
  function syncChoiceAdd(){
    var next=ocClone(d.choiceAdd||{});
    ed.querySelectorAll('[data-ca-choice]').forEach(function(card){var g=card.getAttribute('data-ca-g'),lk=card.getAttribute('data-ca-l');if(next[g])delete next[g][lk];});
    ed.querySelectorAll('[data-carow]').forEach(function(tr){
      var g=tr.getAttribute('data-ca-g'),lk=tr.getAttribute('data-ca-l'),lbl=tr.getAttribute('data-ca-label')||'';
      var ing=(tr.querySelector('[data-caf="ing"]')||{}).value||''; if(!ing)return;
      function v(f){var el=tr.querySelector('[data-caf="'+f+'"]');return (el&&el.value!=='')?(Number(el.value)||0):null;}
      var inv=inventoryMap[ing]||{},unitEl=tr.querySelector('[data-caf="unit"]'),u=unitEl?unitEl.value:(inv.unit||'');if(compatUnits(inv).map(uNorm).indexOf(uNorm(u))<0)u=inv.unit||u;
      next[g]=next[g]||{}; next[g][lk]=next[g][lk]||{label:lbl,ings:[]};
      var op=tr.getAttribute('data-ca-op')||undefined,when={};try{when=JSON.parse(tr.getAttribute('data-ca-when')||'{}')||{};}catch(_e){}if(op==='choice_override'&&!Object.keys(when).length)when=recipeTemperatureScope(g);
      next[g][lk].ings.push({ing:ing,unit:u,dS:v('dS'),dM:v('dM'),dL:v('dL'),op:op,when:Object.keys(when).length?when:undefined});
    });
    d.choiceAdd=next;
  }
  function syncAll(){syncDraft();syncChoiceAdd();}
  ed.querySelectorAll('[data-sharedpick]').forEach(function(cb){cb.onchange=function(){syncAll();d.sharedBase=[];ed.querySelectorAll('[data-sharedpick]:checked').forEach(function(x){d.sharedBase.push({ing:x.getAttribute('data-sharedpick')});});drawRecipeEditor(item);};});
  ed.querySelectorAll('[data-recsize]').forEach(function(b){b.onclick=function(){syncAll();recSize=b.getAttribute('data-recsize');drawRecipeEditor(item);};});
  document.getElementById('recAddBase').onclick=function(){syncAll();d.base.push({ing:'',unit:'',dS:null,dM:null,dL:null});drawRecipeEditor(item);};
  ed.querySelectorAll('[data-brem]').forEach(function(b){b.onclick=function(){syncAll();d.base.splice(Number(b.getAttribute('data-brem')),1);drawRecipeEditor(item);};});
  ed.querySelectorAll('[data-bmove]').forEach(function(b){b.onclick=function(){syncAll();if(!tempGroup||!tempLabel)return;moveRecipeBaseToChoice(d,Number(b.getAttribute('data-bmove')),tempGroup.id,tempLabel,sharedSelected);drawRecipeEditor(item);};});
  ed.querySelectorAll('select[data-brow]').forEach(function(s){s.onchange=function(){syncAll();drawRecipeEditor(item);};});
  bindRecipeBaseTemperatureControls(ed,syncAll,drawRecipeEditor,item);
  ed.querySelectorAll('[data-caadd]').forEach(function(b){b.onclick=function(){syncAll();var g=b.getAttribute('data-g'),lk=b.getAttribute('data-l'),lbl=b.getAttribute('data-label');d.choiceAdd=d.choiceAdd||{};d.choiceAdd[g]=d.choiceAdd[g]||{};d.choiceAdd[g][lk]=d.choiceAdd[g][lk]||{label:lbl,ings:[]};d.choiceAdd[g][lk].ings.push({ing:'',unit:'',dS:null,dM:null,dL:null});drawRecipeEditor(item);};});
  ed.querySelectorAll('[data-carem]').forEach(function(b){b.onclick=function(){syncAll();var g=b.getAttribute('data-g'),lk=b.getAttribute('data-l'),ix=Number(b.getAttribute('data-ix'));if(d.choiceAdd&&d.choiceAdd[g]&&d.choiceAdd[g][lk]&&d.choiceAdd[g][lk].ings)d.choiceAdd[g][lk].ings.splice(ix,1);drawRecipeEditor(item);};});
  bindChoiceIngredientSelectors(ed,d,item,syncAll);
  ed.querySelectorAll('input[data-caf]').forEach(function(inp){inp.oninput=function(){var tr=inp.closest('[data-carow]');if(!tr)return;var g=tr.getAttribute('data-ca-g'),lk=tr.getAttribute('data-ca-l'),rows=[];ed.querySelectorAll('[data-carow][data-ca-g="'+g+'"][data-ca-l="'+lk+'"]').forEach(function(r){var ing=(r.querySelector('[data-caf="ing"]')||{}).value||'',inv=inventoryMap[ing]||{},unitEl=r.querySelector('[data-caf="unit"]');function v(f){var el=r.querySelector('[data-caf="'+f+'"]');return (el&&el.value!=='')?(Number(el.value)||0):null;}var row={ing:ing,unit:unitEl?unitEl.value:(inv.unit||''),dS:v('dS'),dM:v('dM'),dL:v('dL')};rows.push(row);var amount=r.querySelector('[data-caamount]');if(amount)amount.textContent=peso(caDraftCost([row],size));});var lab=ed.querySelector('[data-cacost="'+g+'|'+lk+'"]');if(lab)lab.textContent='extra — S '+peso(caDraftCost(rows,'S'))+' · M '+peso(caDraftCost(rows,'M'))+' · L '+peso(caDraftCost(rows,'L'));};});
  bindRecipeTemperatureControls(ed,syncAll,drawRecipeEditor,item);
  ed.querySelectorAll('[data-rcradio]').forEach(function(r){r.onchange=function(){if(!r.checked)return;syncAll();window.__recCostSel=window.__recCostSel||{};window.__recCostSel[r.getAttribute('data-rcradio')]=r.getAttribute('data-rclabel');drawRecipeEditor(item);};});
  ed.querySelectorAll('[data-rcmulti-check]').forEach(function(cb){cb.onchange=function(){syncAll();var gid=cb.getAttribute('data-rcmulti-check'),arr=[];ed.querySelectorAll('[data-rcmulti-check="'+gid+'"]:checked').forEach(function(x){arr.push(x.getAttribute('data-rclabel'));});window.__recCostSel=window.__recCostSel||{};window.__recCostSel[gid]=arr;drawRecipeEditor(item);};});
  ed.querySelectorAll('[data-effective-include]').forEach(function(cb){cb.onchange=function(){if(cb.checked)return;syncAll();var ing=cb.getAttribute('data-effective-include');d.sharedBase=(d.sharedBase||[]).filter(function(x){return (typeof x==='string'?x:x.ing)!==ing;});Object.keys(d.choiceAdd||{}).forEach(function(g){Object.keys(d.choiceAdd[g]||{}).forEach(function(lk){var entry=d.choiceAdd[g][lk];entry.ings=(entry.ings||[]).filter(function(x){return !(x.ing===ing&&x.op==='replace');});if(!entry.ings.length)delete d.choiceAdd[g][lk];});});drawRecipeEditor(item);};});
  ed.querySelectorAll('[data-effective-replace]').forEach(function(b){b.onchange=function(){syncAll();var ing=b.getAttribute('data-effective-replace'),gid=b.getAttribute('data-replace-group'),label=b.getAttribute('data-replace-label'),lk=optKey(label);d.choiceAdd=d.choiceAdd||{};d.choiceAdd[gid]=d.choiceAdd[gid]||{};if(!b.checked){var old=d.choiceAdd[gid][lk];if(old){old.ings=(old.ings||[]).filter(function(x){return !(x.ing===ing&&x.op==='replace');});if(!old.ings.length)delete d.choiceAdd[gid][lk];}drawRecipeEditor(item);return;}var shared=optCostStore()[gid]&&optCostStore()[gid][lk],base=sharedLibrary.filter(function(x){return x.ing===ing;})[0],inv=inventoryMap[ing]||{},u=(base&&base.unit)||inv.unit||'';if(!d.choiceAdd[gid][lk])d.choiceAdd[gid][lk]={label:label,ings:(shared&&shared.ings||[]).map(function(x){return {ing:x.ing,unit:x.unit||(inventoryMap[x.ing]||{}).unit||'',dS:x.dispS!=null?x.dispS:x.qtyS,dM:x.dispM!=null?x.dispM:x.qtyM,dL:x.dispL!=null?x.dispL:x.qtyL,op:x.op};})};var rows=d.choiceAdd[gid][lk].ings,existing=rows.filter(function(x){return x.ing===ing;})[0],values={ing:ing,unit:u,dS:base&&base.dispS!=null?base.dispS:base&&base.qtyS,dM:base&&base.dispM!=null?base.dispM:base&&base.qtyM,dL:base&&base.dispL!=null?base.dispL:base&&base.qtyL,op:'replace'};if(existing)Object.assign(existing,values);else rows.push(values);drawRecipeEditor(item);};});
  ed.querySelectorAll('[data-effective-choice-override]').forEach(function(b){b.onchange=function(){syncAll();var gid=b.getAttribute('data-replace-group');setRecipeChoiceOverride(d,b.getAttribute('data-effective-choice-override'),gid,b.getAttribute('data-replace-label'),b.checked,recipeTemperatureScope(gid));drawRecipeEditor(item);};});
  bindEffectiveChoiceIncludes(ed,d,item,syncAll);
  var _nn=document.getElementById('recNoNeed'); if(_nn)_nn.onchange=function(){ markNoRecipe(item.key,this.checked); };
  document.getElementById('recSave').onclick=function(){
    var button=this,original=button.textContent;
    try{
      syncAll();button.disabled=true;button.setAttribute('aria-busy','true');button.textContent='Saving recipe…';
      Promise.resolve(saveRecipe(item.key)).finally(function(){if(document.body.contains(button)){button.disabled=false;button.removeAttribute('aria-busy');button.textContent=original;}});
    }catch(err){button.disabled=false;button.removeAttribute('aria-busy');button.textContent=original;alert('Recipe save hit an error: '+(err&&err.message?err.message:err)+'. Nothing was saved — tell support this message.');}
  };
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
  var invList=ings().slice().sort(function(a,b){return (a.name||'').localeCompare(b.name||'');});
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
