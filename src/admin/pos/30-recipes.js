function menuList(){ return (A().getMenuItems?A().getMenuItems():[]).slice().sort(function(a,b){return (a.cat||'').localeCompare(b.cat||'')||(a.name||'').localeCompare(b.name||'');}); }
function recipeCostResult(rec,size,item){item=item||{name:'Recipe'};var key=item.key||'preview';return Costing().costRecipe(Object.assign({itemKey:key,recipe:rec,item:item,size:size},costingContext()));}
function recipeCost(rec,size,item){return recipeCostResult(rec,size,item).totalCost;}
function costingIssues(list){return (list||[]).map(function(x){return '• '+(x.message||x.code||'Costing error');}).join('\n');}
/* Menu items with a costing gap: recipe/cost failures, or a drink sale path with no packaging. */
function markNoRecipe(key,val){ var a=A(); a.set(a.ref(a.db,'menuItems/'+key+'/noRecipe'),val?true:null).then(function(){ updateCostBadge(); }).catch(function(e){ alert('Could not update: '+((e&&e.code)||e)+'. Log in with your admin EMAIL.'); }); }
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
    var savedRows=sitems.length?sitems.map(function(it){var rec=recipesMap[it.key],single=recipeItemIsSingleServing(it);return '<tr style="cursor:pointer;" data-recopen="'+esc(it.key)+'"><td>'+esc(it.name)+'</td><td style="color:var(--tl);font-size:0.8rem;">'+esc(A().getCatLabel?A().getCatLabel(it.cat):(it.cat||''))+'</td><td class="r">'+((rec.base&&rec.base.length)||0)+'</td><td class="r">'+peso(recipeCost(rec,'S',it))+'</td><td class="r">'+(single?'—':peso(recipeCost(rec,'M',it)))+'</td><td class="r">'+(single?'—':peso(recipeCost(rec,'L',it)))+'</td><td class="r"><button class="pz-btn ok" data-recopen="'+esc(it.key)+'" style="padding:0.15rem 0.6rem;">Open</button></td></tr>';}).join(''):'<tr><td colspan="7" style="color:var(--tl);padding:0.6rem;">No saved recipes yet. Build one in the Recipe tab.</td></tr>';
    body='<p class="pz-sub">All saved recipes ('+sitems.length+'). Click a row to open it in the Recipe tab — edit, add or remove ingredients, then save.</p>'
      +'<div class="pz-card"><div style="overflow-x:auto;"><table class="pz-tbl"><thead><tr><th>Item</th><th>Category</th><th class="r">Ingredients</th><th class="r">Cost S</th><th class="r">Cost M</th><th class="r">Cost L</th><th></th></tr></thead><tbody>'+savedRows+'</tbody></table></div></div>';
  }
  else {
    var recipeCats=(A().getCats?A().getCats():[]);
    if(!recCategory&&recipeCats.length)recCategory=recipeCats[0].id;
    var items=menuList().filter(function(it){return !recCategory||it.cat===recCategory;});
    var opts=items.map(function(it){var has=!!recipesMap[it.key];return '<option value="'+esc(it.key)+'"'+(it.key===curRecipeKey?' selected':'')+'>'+(has?'✓ ':'○ ')+esc(it.name)+'</option>';}).join('');
    var covered=items.filter(function(it){return !!recipesMap[it.key];}).length;
    var catOpts=recipeCats.map(function(c){return '<option value="'+esc(c.id)+'"'+(c.id===recCategory?' selected':'')+'>'+esc(c.icon+' '+c.label)+'</option>';}).join('');
    body='<p class="pz-sub">Menu Availability is the source of truth. Drinks use S/M/L quantities; single-price pastries use one quantity per serving. Only options assigned to the selected item appear below. <b>'+covered+' of '+items.length+'</b> items in this category have a saved recipe.</p>'
      +'<div class="pz-card" style="margin-bottom:1rem;"><div style="display:flex;gap:0.7rem;flex-wrap:wrap;"><label style="flex:1 1 240px;"><span class="pz-lbl">1. Menu category</span><select class="pz-in" id="recCategoryPick">'+catOpts+'</select></label><label style="flex:1 1 280px;"><span class="pz-lbl">2. Menu item</span><select class="pz-in" id="recPick"><option value="">— choose a menu item —</option>'+opts+'</select></label></div></div><div id="recEditor"></div>';
  }
  var tools='';
  var _gaps=menuCostGaps();
  var _editingNow=(recSub==='base'&&!!curRecipeKey);
  var gapPanel;
  if(!_gaps.length){ gapPanel='<div class="pz-card" style="border:1px solid #a8d5b5;background:#f0faf4;margin-bottom:0.8rem;color:#2d6a4f;font-weight:600;">✓ All recipe menu items have complete costing.</div>'; }
  else if(_editingNow){ gapPanel='<div class="pz-card" style="border:1px solid #f0c36d;background:#fff8e8;margin-bottom:0.6rem;padding:0.45rem 0.8rem;display:flex;justify-content:space-between;align-items:center;gap:0.5rem;"><span style="color:#8a5a00;font-weight:600;">⚠ '+_gaps.length+' menu item'+(_gaps.length===1?'':'s')+' still not costed — finish below, the list updates.</span><button class="pz-btn sec" id="recBackToList" style="padding:0.15rem 0.6rem;">◂ Back to list</button></div>'; }
  else { gapPanel='<div class="pz-card" style="border:1px solid #f0c36d;background:#fff8e8;margin-bottom:0.8rem;"><div style="font-weight:700;color:#8a5a00;">⚠ Costing Incomplete — '+_gaps.length+' menu item'+(_gaps.length===1?'':'s')+'</div><p class="pz-sub" style="margin:0.2rem 0 0.4rem;">Every item remains sellable. These flags identify missing recipe, inventory-cost or packaging links so COGS can be completed.</p>'+_gaps.map(function(g){return '<div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;padding:0.25rem 0;border-top:1px solid #f0e0c0;"><span>'+esc(g.name)+' <span style="color:#a06a10;font-size:0.75rem;">· '+esc(g.reason)+'</span></span><button class="pz-btn ok" data-recopen="'+esc(g.key)+'" style="padding:0.12rem 0.6rem;">Cost it</button></div>';}).join('')+'</div>'; }
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
  var cat=window.__sharedBaseCat||'',store=(window.__posSettings&&window.__posSettings.sharedBaseIngredients)||{},rows=ocClone((store[cat]||{}).ings||[]),inv=ingsActive();
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
