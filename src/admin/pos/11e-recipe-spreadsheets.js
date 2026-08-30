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
