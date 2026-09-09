(function(root,factory){
  var api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.AccazaCosting=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  var VERSION='3F-3';
  var SIZES=['S','M','L'];
  var UNITS={
    ml:{dim:'volume',factor:1},l:{dim:'volume',factor:1000},tsp:{dim:'volume',factor:4.92892},tbsp:{dim:'volume',factor:14.7868},cup:{dim:'volume',factor:240},'fl oz':{dim:'volume',factor:29.5735},
    mg:{dim:'weight',factor:0.001},g:{dim:'weight',factor:1},kg:{dim:'weight',factor:1000},lb:{dim:'weight',factor:453.592},'oz wt':{dim:'weight',factor:28.3495},
    pc:{dim:'count',factor:1},pcs:{dim:'count',factor:1},ea:{dim:'count',factor:1},each:{dim:'count',factor:1},dozen:{dim:'count',factor:12}
  };
  var ALIASES={liter:'l',litre:'l',liters:'l',litres:'l',gram:'g',grams:'g',kilogram:'kg',kilograms:'kg',floz:'fl oz','fluid ounce':'fl oz','fluid ounces':'fl oz',piece:'pc',pieces:'pcs',unit:'ea',doz:'dozen','weight ounce':'oz wt'};
  function n(value){var x=Number(value);return Number.isFinite(x)?x:0;}
  function q6(value){return Math.round(n(value)*1000000)/1000000;}
  function money(value){return Math.round(n(value)*100)/100;}
  function unit(value){var u=String(value==null?'':value).trim().toLowerCase().replace(/\s+/g,' ');return ALIASES[u]||u;}
  function unitInfo(value){var u=unit(value);if(u==='oz')return {unit:u,error:'AMBIGUOUS_OZ'};if(UNITS[u])return {unit:u,dim:UNITS[u].dim,factor:UNITS[u].factor};if(u)return {unit:u,dim:'custom:'+u,factor:1,custom:true};return {unit:u,error:'MISSING_UNIT'};}
  function compatible(from,to){var a=unitInfo(from),b=unitInfo(to);return !a.error&&!b.error&&a.dim===b.dim;}
  function convert(value,from,to){
    var qty=Number(value),a=unitInfo(from),b=unitInfo(to);
    if(!Number.isFinite(qty))return {ok:false,code:'INVALID_QUANTITY',qty:0};
    if(a.error)return {ok:false,code:a.error,qty:0};
    if(b.error)return {ok:false,code:b.error,qty:0};
    if(a.dim!==b.dim)return {ok:false,code:'INCOMPATIBLE_UNITS',qty:0,from:a.unit,to:b.unit};
    return {ok:true,qty:q6(qty*a.factor/b.factor),from:a.unit,to:b.unit};
  }
  function optKey(label){return String(label==null?'':label).replace(/[.#$[\]\/]/g,'_');}
  function groupIdForLabel(item,label,groups){
    var ids=Array.isArray(item&&item.options)?item.options:Object.keys(groups||{});
    for(var i=0;i<ids.length;i++){var g=(groups||{})[ids[i]]||{};var choices=Array.isArray(g.choices)?g.choices:[];for(var j=0;j<choices.length;j++)if(choices[j]&&choices[j].label===label)return ids[i];}
    return null;
  }
  function rawSize(row,size,recipe){
    var direct=row&&row['qty'+size];if(direct!=null&&direct!==''){var dx=Number(direct);return Number.isFinite(dx)?dx:NaN;}
    if(!row||row.qty==null||row.qty==='')return 0;
    var base=Number(row.qty),sm=recipe&&recipe.sizeMult||{S:1,M:1.3,L:1.6},mult=Number(sm[size]==null?1:sm[size]);return Number.isFinite(base)&&Number.isFinite(mult)?base*mult:NaN;
  }
  function recipeDisplay(row,size,stockQty,stockUnit,useStoredDisplay){var recipeUnit=unit(row&&row.unit||stockUnit),display=useStoredDisplay&&row&&row['disp'+size],qty;if(display!=null&&display!=='')qty=Number(display);else{var cv=convert(stockQty,stockUnit,recipeUnit);qty=cv.ok?cv.qty:stockQty;}return {qty:q6(qty),unit:recipeUnit};}
  function normalizeRow(row,inventory,path,errors,warnings,allowNegative,choiceLabel){
    row=row||{};var id=String(row.ing||'').trim(),item=inventory[id];
    if(!id){errors.push({code:'MISSING_INGREDIENT',path:path,message:'Ingredient is required.'});return null;}
    if(!item){errors.push({code:'BROKEN_INVENTORY_REFERENCE',path:path,itemId:id,message:'Inventory item '+id+' does not exist.'});return null;}
    var stockUnit=unit(item.unit),inputUnit=unit(row.inputUnit||row.unit||item.unit);
    var out={ing:id,unit:inputUnit,stockUnit:stockUnit};if(row.op)out.op=String(row.op);var useFor=Array.isArray(row.useFor)?row.useFor.map(function(label){return String(label||'').trim();}).filter(function(label,ix,all){return !!label&&all.indexOf(label)===ix;}):[];if(useFor.length)out.useFor=useFor;var when={};Object.keys(row.when||{}).forEach(function(gid){var label=String(row.when[gid]||'').trim();if(gid&&label)when[String(gid)]=label;});if(Object.keys(when).length)out.when=when;
    var any=false;
    SIZES.forEach(function(size){
      var display=row['disp'+size];if(display==null||display==='')display=row['input'+size];
      var stored=row['qty'+size];var qty;
      if(display!=null&&display!==''){
        var cv=convert(display,inputUnit,stockUnit);
        if(!cv.ok){errors.push({code:cv.code,path:path+'.'+size,itemId:id,from:inputUnit,to:stockUnit,message:'Cannot convert '+inputUnit+' to '+stockUnit+'.'});qty=0;}
        else qty=cv.qty;
        out['disp'+size]=q6(display);
      }else if(stored!=null&&stored!==''){
        qty=Number(stored);out['disp'+size]=null;
      }else if(row.qty!=null&&row.qty!==''){
        qty=rawSize(row,size,{sizeMult:row.sizeMult});out['disp'+size]=null;
      }else{qty=0;out['disp'+size]=null;}
      if(!Number.isFinite(Number(qty))||(!allowNegative&&qty<0))errors.push({code:'INVALID_QUANTITY',path:path+'.'+size,itemId:id,message:allowNegative?'Quantity must be a valid number.':'Quantity must be zero or positive.'});
      out['qty'+size]=q6(allowNegative?n(qty):Math.max(0,n(qty)));if(out['qty'+size]!==0)any=true;
    });
    if(!any)warnings.push({code:'ZERO_QUANTITY_ROW',path:path,itemId:id,choiceLabel:choiceLabel||'',message:(item.name||id)+(choiceLabel?' has zero additional quantity for every size under “'+choiceLabel+'”.':' has zero quantity for every size.')});
    return out;
  }
  function normalizeRecipe(recipe,inventory){
    recipe=recipe||{};inventory=inventory||{};var errors=[],warnings=[],seen={};
    var base=(Array.isArray(recipe.base)?recipe.base:[]).map(function(row,ix){var r=normalizeRow(row,inventory,'base['+ix+']',errors,warnings);if(r){(seen[r.ing]=seen[r.ing]||[]).push({row:r,ix:ix});}return r;}).filter(Boolean);
    Object.keys(seen).forEach(function(ing){var rows=seen[ing];if(rows.length<2)return;for(var i=0;i<rows.length;i++)for(var j=i+1;j<rows.length;j++)if(scopesOverlap(rows[i].row,rows[j].row)){errors.push({code:'DUPLICATE_BASE_SCOPE',path:'base['+rows[j].ix+']',itemId:ing,message:'Assign each duplicate base ingredient to a different serving style.'});return;}});
    var sharedBase=(Array.isArray(recipe.sharedBase)?recipe.sharedBase:[]).map(function(ref){return typeof ref==='string'?{ing:ref}:{ing:String((ref&&ref.ing)||'')};}).filter(function(ref){return !!ref.ing;});
    var choiceAdd={};Object.keys(recipe.choiceAdd||{}).forEach(function(gid){var group={};Object.keys(recipe.choiceAdd[gid]||{}).forEach(function(key){var entry=recipe.choiceAdd[gid][key]||{},label=entry.label||key;var rows=(entry.ings||[]).map(function(row,ix){return normalizeRow(row,inventory,'choiceAdd.'+gid+'.'+key+'['+ix+']',errors,warnings,true,label);}).filter(Boolean);if(rows.length)group[key]={label:label,ings:rows};});if(Object.keys(group).length)choiceAdd[gid]=group;});
    if(!base.length&&!sharedBase.length&&!hasChoiceRows(choiceAdd))errors.push({code:'EMPTY_RECIPE',path:'base',message:'Select a shared base ingredient or add an ingredient to a required choice.'});
    var normalized={base:base,sharedBase:sharedBase,choiceAdd:choiceAdd,schemaVersion:3,costingEngineVersion:VERSION,updatedAt:n(recipe.updatedAt)||Date.now()};
    if(Array.isArray(recipe.options))normalized.options=recipe.options;
    return {ok:errors.length===0,recipe:normalized,errors:errors,warnings:warnings,engineVersion:VERSION};
  }
  function scopesOverlap(a,b){a=a||{};b=b||{};var au=Array.isArray(a.useFor)?a.useFor:[],bu=Array.isArray(b.useFor)?b.useFor:[];if(au.length&&bu.length&&!au.some(function(label){return bu.some(function(other){return optKey(label)===optKey(other);});}))return false;var aw=a.when||{},bw=b.when||{},shared=Object.keys(aw).filter(function(gid){return Object.prototype.hasOwnProperty.call(bw,gid);});return !shared.some(function(gid){return optKey(aw[gid])!==optKey(bw[gid]);});}
  function hasChoiceRows(choiceAdd){return Object.keys(choiceAdd||{}).some(function(gid){return Object.keys(choiceAdd[gid]||{}).some(function(key){return !!(((choiceAdd[gid]||{})[key]||{}).ings||[]).length;});});}
  function effectiveBaseRows(item,recipe,ctx,warnings,optLabels){
    var own={},out=[];(recipe.base||[]).forEach(function(row){if(row&&row.ing)own[row.ing]=1;});
    var library=((ctx.sharedBaseIngredients||{})[String((item&&item.cat)||'')]||{}).ings||[];
    var byIng={};library.forEach(function(row){if(row&&row.ing)byIng[row.ing]=row;});
    (recipe.sharedBase||[]).forEach(function(ref){var id=typeof ref==='string'?ref:ref&&ref.ing;if(!id||own[id])return;var row=byIng[id];if(row&&rowMatchesSelections(item,row,optLabels,ctx.optionGroups||{}))out.push({row:row,source:'base_shared'});else if(!row)warnings.push({code:'MISSING_SHARED_BASE',itemKey:item&&item.key,itemId:id,message:'A selected shared base ingredient is no longer defined for this menu category.'});});
    (recipe.base||[]).forEach(function(row){if(rowMatchesSelections(item,row,optLabels,ctx.optionGroups||{}))out.push({row:row,source:byIng[row.ing]?'base_override':'base_recipe'});});
    return out;
  }
  function selectedServingStyle(item,optLabels,groups){var selected='';(optLabels||[]).some(function(label){var gid=groupIdForLabel(item,label,groups||{}),group=gid&&(groups||{})[gid]||{};if((/temperature/i.test(group.name||'')||/temp/i.test(gid||''))&&/^(hot|iced)$/i.test(String(label||''))){selected=/^hot$/i.test(label)?'Hot':'Iced';return true;}return false;});if(selected)return selected;var cat=String(item&&item.cat||'').toLowerCase();return cat==='frappe'||cat==='nonfrappe'?'Blended':'';}
  function rowMatchesSelections(item,row,optLabels,groups){var useFor=Array.isArray(row&&row.useFor)?row.useFor:[],style=selectedServingStyle(item,optLabels,groups);if(useFor.length&&!useFor.some(function(label){return optKey(label)===optKey(style);}))return false;var when=row&&row.when||{};return Object.keys(when).every(function(gid){return (optLabels||[]).some(function(selected){return groupIdForLabel(item,selected,groups||{})===gid&&optKey(selected)===optKey(when[gid]);});});}
  function optionRows(item,recipe,label,size,ctx,optLabels){
    var gid=groupIdForLabel(item,label,ctx.optionGroups||{}),key=optKey(label),rows=[],found=false;
    function add(arr,source){var matched=(arr||[]).filter(function(r){return r&&r.ing&&rowMatchesSelections(item,r,optLabels,ctx.optionGroups||{});});matched.forEach(function(r){rows.push({row:r,source:source,optionGroupId:gid||null,optionLabel:label});});if(matched.length)found=true;}
    /* One definition wins, never both. A drink that spells the choice out for itself OVERRIDES the
       shared library; it does not add to it. Stacking them charged the customer twice. */
    var own=gid&&recipe&&recipe.choiceAdd&&recipe.choiceAdd[gid]&&recipe.choiceAdd[gid][key];
    var shared=gid&&ctx.optionCosts&&ctx.optionCosts[gid]&&ctx.optionCosts[gid][key];
    if(own)add(own.ings,'option_recipe');
    if(!found&&shared)add(shared.ings,'option_global');
    if(!found){var legacy=null;if(recipe&&Array.isArray(recipe.options))legacy=recipe.options.find(function(x){return x&&x.label===label;})||null;if(!legacy)legacy=(ctx.optionRecipes||{})[label]||null;if(legacy&&legacy.ing)rows.push({row:{ing:legacy.ing,qtyS:legacy.qty,qtyM:legacy.qty,qtyL:legacy.qty},source:'option_legacy',optionGroupId:gid||null,optionLabel:label});}
    return rows;
  }
  /* Which cup, lid and straw a drink is served in depends on how it is served, not on which
     drink it is. A choice may name the serve style (Hot, Iced); otherwise the menu item does.
     Nothing happens at all until a serve style is named, so this is inert on existing data. */
  function serveStyleFor(item,optLabels,ctx){
    var groups=ctx.optionGroups||{},ids=Array.isArray(item&&item.options)?item.options:[];
    var labels=Array.isArray(optLabels)?optLabels:[];
    /* Category + menu-choice assignments are the current source of truth. This lets Hot/Iced
       packaging differ by menu category without hiding metadata inside the customer option. */
    var assignment=((ctx.packagingAssignments||{})[String((item&&item.cat)||'')])||{};
    var mapped=assignment.choices||{};
    for(var a=0;a<labels.length;a++){
      var mappedGroup=groupIdForLabel(item,labels[a],groups),byGroup=mappedGroup&&mapped[mappedGroup];
      var mappedStyle=byGroup&&(byGroup[optKey(labels[a])]||byGroup[labels[a]]);
      if(mappedStyle)return String(mappedStyle);
    }
    if(assignment.defaultStyle)return String(assignment.defaultStyle);
    for(var i=0;i<labels.length;i++){
      for(var j=0;j<ids.length;j++){
        var group=groups[ids[j]]||{},choices=Array.isArray(group.choices)?group.choices:[];
        for(var c=0;c<choices.length;c++){
          if(choices[c]&&choices[c].label===labels[i]&&choices[c].serveStyle)return String(choices[c].serveStyle);
        }
      }
    }
    return String((item&&item.serveStyle)||'');
  }
  function packagingRows(style,ctx){
    var rule=style?(ctx.packagingRules||{})[style]:null;
    return rule&&Array.isArray(rule.rows)?rule.rows:[];
  }
  function costOrder(ctx){
    ctx=ctx||{};var inventory=ctx.inventory||{},recipes=ctx.recipes||{},menu=ctx.menuItems||{};var lines=[],usage={},errors=[],warnings=[];
    (ctx.lineItems||[]).forEach(function(li,lix){
      if(!li||!li.itemKey){errors.push({code:'INVALID_ORDER_LINE',path:'lineItems['+lix+']',message:'Menu item is required.'});return;}
      var orderQty=Number(li.qty),size=SIZES.indexOf(li.size)>=0?li.size:'M';if(!Number.isFinite(orderQty)||orderQty<=0){errors.push({code:'INVALID_ORDER_QUANTITY',path:'lineItems['+lix+'].qty',message:'Order quantity must be positive.'});return;}
      var recipe=recipes[li.itemKey],item=Object.assign({key:li.itemKey},menu[li.itemKey]||{});
      if(!recipe||(!(recipe.base&&recipe.base.length)&&!(recipe.sharedBase&&recipe.sharedBase.length)&&!hasChoiceRows(recipe.choiceAdd))){warnings.push({code:'MISSING_RECIPE',itemKey:li.itemKey,message:(item.name||li.itemKey)+' has no recipe.'});return;}
      var contributions=effectiveBaseRows(item,recipe,ctx,warnings,li.optLabels||[]);
      (li.optLabels||[]).forEach(function(label){var found=optionRows(item,recipe,label,size,ctx,li.optLabels||[]);if(!found.length)warnings.push({code:'UNMAPPED_OPTION',itemKey:li.itemKey,label:label,message:'No ingredient cost is mapped to option '+label+'.'});contributions=contributions.concat(found);});
      var serveStyle=serveStyleFor(item,li.optLabels,ctx);
      if(serveStyle){
        var packing=packagingRows(serveStyle,ctx);
        if(!packing.length)warnings.push({code:'UNMAPPED_SERVE_STYLE',itemKey:li.itemKey,serveStyle:serveStyle,message:'No packaging is set for serve style '+serveStyle+'.'});
        packing.forEach(function(row){if(row&&row.ing)contributions.push({row:row,source:'packaging'});});
      }
      /* A choice that TAKES something out can only take out what is there. "Not Sweet" means no
         sweetener, not minus three quarters of an ounce - on a drink with no condensed milk it
         removes nothing rather than driving the count below zero. Rows marked op:'reduce' are
         held back and applied last, capped at what the drink actually uses. */
      var reducers=[],lineUsage={},replaced={};
      contributions.forEach(function(entry){if(entry&&entry.row&&entry.row.op==='replace'){var id=entry.row.ing;if(replaced[id]&&replaced[id]!==entry.optionGroupId+'|'+entry.optionLabel)errors.push({code:'CONFLICTING_REQUIRED_REPLACEMENT',itemKey:li.itemKey,itemId:id,message:'Two selected choices replace the same ingredient.'});replaced[id]=entry.optionGroupId+'|'+entry.optionLabel;}});
      contributions=contributions.filter(function(entry){return !(String(entry.source).indexOf('base_')===0&&replaced[entry.row&&entry.row.ing]);});
      contributions=contributions.filter(function(entry){
        if(entry&&entry.row&&String(entry.row.op||'')==='reduce'&&String(entry.source).indexOf('base_')!==0){reducers.push(entry);return false;}
        return true;
      });
      contributions.forEach(function(entry,rix){var row=entry.row||{},id=row.ing,inv=inventory[id];if(!id||!inv){errors.push({code:'BROKEN_INVENTORY_REFERENCE',itemKey:li.itemKey,itemId:id||'',message:'Recipe points to a missing inventory item.'});return;}var per=rawSize(row,size,recipe),adjustment=String(entry.source).indexOf('base_')!==0;if(!Number.isFinite(per)||(!adjustment&&per<0)){errors.push({code:'INVALID_QUANTITY',itemKey:li.itemKey,itemId:id,message:'Recipe quantity is invalid.'});return;}var totalQty=q6(per*orderQty);if(!totalQty)return;var unitCost=n(inv.cost);if(!(unitCost>0))warnings.push({code:'MISSING_COST',itemKey:li.itemKey,itemId:id,message:(inv.name||id)+' has no current unit cost.'});var totalCost=q6(totalQty*unitCost),shown=recipeDisplay(row,size,per,inv.unit,true);usage[id]=q6((usage[id]||0)+totalQty);lineUsage[id]=q6((lineUsage[id]||0)+totalQty);lines.push({itemKey:li.itemKey,itemName:item.name||li.itemKey,size:size,orderQty:orderQty,source:entry.source,optionGroupId:entry.optionGroupId||null,optionLabel:entry.optionLabel||null,ingredientId:id,ingredientName:inv.name||id,recipeQuantityPerServing:shown.qty,recipeUnit:shown.unit,quantityPerServing:q6(per),totalQuantity:totalQty,stockUnit:unit(inv.unit),unitCost:q6(unitCost),totalCost:totalCost,costSource:inv.ledgerVersion?'inventory-ledger-wac':'inventory-wac',costEffectiveAt:n(inv.ledgerUpdatedAt||inv.updatedAt)||null});});
      reducers.forEach(function(entry){
        var row=entry.row||{},id=row.ing,inv=inventory[id];
        if(!id||!inv){errors.push({code:'BROKEN_INVENTORY_REFERENCE',itemKey:li.itemKey,itemId:id||'',message:'Recipe points to a missing inventory item.'});return;}
        var per=rawSize(row,size,recipe);
        if(!Number.isFinite(per)){errors.push({code:'INVALID_QUANTITY',itemKey:li.itemKey,itemId:id,message:'Recipe quantity is invalid.'});return;}
        var want=q6(Math.abs(per)*orderQty),available=q6(Math.max(0,lineUsage[id]||0));
        var takeQty=q6(-Math.min(want,available));
        if(!takeQty)return;
        var unitCost=n(inv.cost),takeCost=q6(takeQty*unitCost),shown=recipeDisplay(row,size,takeQty/orderQty,inv.unit,false);
        usage[id]=q6((usage[id]||0)+takeQty);lineUsage[id]=q6((lineUsage[id]||0)+takeQty);
        lines.push({itemKey:li.itemKey,itemName:item.name||li.itemKey,size:size,orderQty:orderQty,source:entry.source,
          optionGroupId:entry.optionGroupId||null,optionLabel:entry.optionLabel||null,ingredientId:id,ingredientName:inv.name||id,recipeQuantityPerServing:shown.qty,recipeUnit:shown.unit,quantityPerServing:q6(takeQty/orderQty),totalQuantity:takeQty,
          stockUnit:unit(inv.unit),unitCost:q6(unitCost),totalCost:takeCost,
          costSource:inv.ledgerVersion?'inventory-ledger-wac':'inventory-wac',
          costEffectiveAt:n(inv.ledgerUpdatedAt||inv.updatedAt)||null});
      });
    });
    Object.keys(usage).forEach(function(id){if(usage[id]<0){errors.push({code:'NEGATIVE_TOTAL_USAGE',itemId:id,message:'Recipe option adjustments cannot reduce total ingredient usage below zero.'});}});
    var total=money(lines.reduce(function(sum,line){return sum+n(line.totalCost);},0));
    return {ok:errors.length===0,engineVersion:VERSION,usage:usage,lines:lines,totalCost:total,cogsCovered:errors.length===0&&!warnings.some(function(w){return w.code==='MISSING_COST'||w.code==='MISSING_RECIPE'||w.code==='UNMAPPED_OPTION'||w.code==='UNMAPPED_SERVE_STYLE';}),errors:errors,warnings:warnings};
  }
  function costRecipe(args){args=args||{};return costOrder({lineItems:[{itemKey:args.itemKey||'item',size:args.size||'M',qty:args.qty||1,optLabels:args.optLabels||[]}],recipes:(function(){var o={};o[args.itemKey||'item']=args.recipe;return o;})(),inventory:args.inventory||{},menuItems:(function(){var o={};o[args.itemKey||'item']=args.item||{};return o;})(),sharedBaseIngredients:args.sharedBaseIngredients||{},optionCosts:args.optionCosts||{},optionRecipes:args.optionRecipes||{},optionGroups:args.optionGroups||{},packagingRules:args.packagingRules||{},packagingAssignments:args.packagingAssignments||{}});}
  return {VERSION:VERSION,SIZES:SIZES,normalizeUnit:unit,unitInfo:unitInfo,compatible:compatible,convert:convert,normalizeRecipe:normalizeRecipe,effectiveBaseRows:effectiveBaseRows,rowMatchesSelections:rowMatchesSelections,costOrder:costOrder,costRecipe:costRecipe,optKey:optKey,serveStyleFor:serveStyleFor,packagingRows:packagingRows};
});
