function recipeChoicePackagingRows(raw){
  var groups=A().optionGroupsMap||{},out=[];Object.keys((raw&&raw.choiceAdd)||{}).forEach(function(g){Object.keys(raw.choiceAdd[g]||{}).forEach(function(k){var e=raw.choiceAdd[g][k]||{};(e.ings||[]).forEach(function(r){if(isPackagingCostItem(r.ing))out.push({groupName:(groups[g]&&groups[g].name)||g,choiceLabel:e.label||k,name:(inventoryMap[r.ing]||{}).name||r.ing});});});});return out;
}
function removeRecipeChoicePackaging(raw){
  Object.keys((raw&&raw.choiceAdd)||{}).forEach(function(g){Object.keys(raw.choiceAdd[g]||{}).forEach(function(k){var e=raw.choiceAdd[g][k]||{};e.ings=(e.ings||[]).filter(function(r){return !isPackagingCostItem(r.ing)});if(!e.ings.length)delete raw.choiceAdd[g][k];});if(!Object.keys(raw.choiceAdd[g]||{}).length)delete raw.choiceAdd[g];});
}
function saveRecipe(key){
  var d=recipeDraft;if(!d){alert('Nothing to save — reopen the recipe and try again.');return Promise.resolve(false);}
  var raw=recipeDraftRaw(d),choicePackaging=recipeChoicePackagingRows(raw),item=(A().menuItemsMap||{})[key]||{};
  if(choicePackaging.length){
    var locations=choicePackaging.map(function(x){return x.name+' ('+x.groupName+' → '+x.choiceLabel+')';}),packagingGap=recipePackagingGap(item);
    if(packagingGap){alert('• '+locations.join('\n• ')+'\n\nShared Packaging is incomplete: '+packagingGap);return Promise.resolve(false);}
    if(!confirm('Clean up and save?\n• '+locations.join('\n• ')+'\n\nThis prevents packaging cost and stock usage from being counted twice.'))return Promise.resolve(false);
    removeRecipeChoicePackaging(raw);
  }
  var local=Costing().normalizeRecipe(raw,inventoryMap);if(!local.ok){alert('Recipe was not saved. Fix these costing errors:\n\n'+costingIssues(local.errors));return Promise.resolve(false);}
  var saved=recipesMap[key];if(saved&&saved.options)raw.options=saved.options;
  var a=A();if(!a.validateRecipeDefinition){alert('The 3B recipe validator is not available. Refresh the portal. Nothing was saved.');return Promise.resolve(false);}
  return a.validateRecipeDefinition(raw).then(function(res){var data=res&&res.data?res.data:res,rec=data&&data.recipe;if(!rec)throw new Error('The server did not return a normalized recipe.');return a.set(a.ref(a.db,'recipes/'+key),rec).then(function(){return data;});}).then(function(data){recipeEditing=false;var note=(data.warnings&&data.warnings.length)?'\n\nWarnings:\n'+costingIssues(data.warnings):'';alert('Recipe saved for '+(A().menuItemsMap[key]?A().menuItemsMap[key].name:key)+'.\nCosting engine '+(data.engineVersion||Costing().VERSION)+'.'+note);curRecipeKey=key;setTimeout(renderRecipes,150);return true;}).catch(function(e){var details=e&&e.details&&e.details.errors;alert('Could not save the recipe: '+((e&&e.message)||(e&&e.code)||e)+(details?'\n\n'+costingIssues(details):'')+'\n\nNothing was saved.');return false;});
}
function saveSharedChoiceCosts(button,original,clean){
  var a=A(),message=document.getElementById('optCostSaveMsg'),settled=false,timer;
  if(!a||!a.saveSharedChoiceIngredients){alert('Shared choice saving is unavailable. Refresh the Admin portal and try again.');return;}
  function restore(){if(document.body.contains(button)){button.disabled=false;button.removeAttribute('aria-busy');button.textContent=original;}}
  button.disabled=true;button.setAttribute('aria-busy','true');button.textContent='Saving choices…';if(message)message.textContent='Waiting for the server…';
  timer=setTimeout(function(){if(settled)return;settled=true;restore();if(message)message.textContent='Save not confirmed — check the connection, then reload to verify.';(window.accazaToast||function(){})('Shared choice save was not confirmed. Check the connection and reload before retrying.','err');},15000);
  a.saveSharedChoiceIngredients(clean).then(function(res){clearTimeout(timer);if(!res||!(res.data||res).saved)throw new Error('The server did not confirm the save.');window.__posSettings=window.__posSettings||{};window.__posSettings.optionCosts=clean;var late=settled;settled=true;if(message)message.textContent='✓ Saved '+new Date().toLocaleTimeString();(window.accazaToast||function(){})(late?'Shared choice ingredients saved after the connection recovered':'Shared choice ingredients saved','ok');restore();}).catch(function(e){clearTimeout(timer);if(settled)return;settled=true;restore();if(message)message.textContent='Save failed — nothing was confirmed.';alert('Could not save shared choice ingredients: '+((e&&e.message)||(e&&e.code)||e)+'. Nothing was saved.');});
}
