#!/usr/bin/env node
/* Accaza - packaging by serve style.
   A cup, lid and straw depend on how a drink is served, not on which drink it is. These checks
   pin three things: the engine does nothing until a serve style is named, the styles replace
   packaging exactly where a recipe already carried it, and the till and the server read the
   same table so the cost posted is the cost shown. */
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const Costing=require('../functions/lib/costing.js');
let failures=0;
const fail=m=>{failures++;console.error('FAIL: '+m);};
const ok=m=>console.log('PASS: '+m);
const check=(c,m)=>c?ok(m):fail(m);
const near=(a,b)=>Math.abs(Number(a)-Number(b))<0.011;
function load(file){
  const sandbox={module:{exports:{}},console};sandbox.globalThis=sandbox;
  vm.createContext(sandbox);vm.runInContext(fs.readFileSync(file,'utf8'),sandbox,{filename:file});
  return sandbox.module.exports;
}
const Plan=load('assets/js/shared/serve-style-plan.js');
check(Plan&&typeof Plan.applyPlan==='function','the shared serve-style planner loads');

const inventory={
  milk:{name:'WHOLE MILK',unit:'ml',cost:0.1,category:'cat_milk'},
  straw:{name:'Strawberry Jam',unit:'g',cost:0.12,category:'cat_syrup'},
  cup12:{name:'12oz Coffee Cup',unit:'pc',cost:3.92,category:'cat_packaging'},
  cup16:{name:'16oz Coffee Cup',unit:'pc',cost:4.02,category:'cat_packaging'},
  lid:{name:'Strawless lid',unit:'pc',cost:1.22,category:'cat_packaging'},
  thin:{name:'Thin Straw',unit:'pc',cost:0.88,category:'cat_packaging'},
  hotcup:{name:'16oz Double Wall Cup',unit:'pc',cost:5.6,category:'cat_packaging'},
  flat:{name:'WHITE FLAT LID',unit:'pc',cost:3.31,category:'cat_packaging'},
  ice:{name:'Ice',unit:'g',cost:0.01,category:'cat_other'}
};
const categories={cat_packaging:{name:'Packaging'},cat_milk:{name:'Milk'},cat_syrup:{name:'Syrup'}};
const row=(ing,s,m,l)=>({ing,unit:inventory[ing].unit,stockUnit:inventory[ing].unit,qtyS:s,qtyM:m,qtyL:l});
const optionGroups={og_temp:{name:'Temperature',required:true,choices:[{label:'Hot'},{label:'Iced'}]}};
const menuItems={
  latte:{name:'Latte',cat:'coffee',options:['og_temp']},
  soda:{name:'Soda',cat:'soda'},
  blend:{name:'Blend',cat:'frappe'}
};
const recipes={
  latte:{base:[row('milk',200,250,300)],
    choiceAdd:{og_temp:{Hot:{label:'Hot',ings:[row('hotcup',1,1,1),row('flat',1,1,1)]},
      Iced:{label:'Iced',ings:[row('cup12',1,0,0),row('cup16',0,1,0),row('lid',1,1,1),row('thin',1,1,1)]}}}},
  soda:{base:[row('milk',100,120,150),row('cup12',1,0,0),row('cup16',0,1,0),row('lid',1,1,1),row('thin',1,1,1)]},
  blend:{base:[row('milk',150,200,250),row('straw',10,15,20)]}
};

/* 1. the packaging test must not fire on an ingredient whose NAME merely contains a word */
check(Plan.isPackaging('straw',inventory,categories)===false,'"Strawberry Jam" is not mistaken for a straw');
check(Plan.isPackaging('cup16',inventory,categories)===true,'a cup in the packaging category is packaging');

/* 2. the engine must do nothing at all until a serve style is named */
function cost(recipeMap,menuMap,groups,rules,key,size,labels){
  return Costing.costOrder({recipes:recipeMap,menuItems:menuMap,inventory,optionGroups:groups,
    optionCosts:{},optionRecipes:{},packagingRules:rules||{},
    lineItems:[{itemKey:key,size,qty:1,optLabels:labels||[]}]});
}
const scopedMilkGroups={og_temp:optionGroups.og_temp,og_milk:{name:'Choice of Milk',required:true,choices:[{label:'Whole Milk'}]}};
const scopedMilkRecipe={base:[row('straw',1,1,1)],choiceAdd:{og_milk:{'Whole Milk':{label:'Whole Milk',ings:[
  Object.assign(row('milk',200,250,300),{op:'choice_override',when:{og_temp:'Hot'}}),
  Object.assign(row('milk',300,350,400),{op:'choice_override',when:{og_temp:'Iced'}})
]}}}};
const scopedMilkMenu={latte:{name:'Latte',cat:'coffee',options:['og_temp','og_milk']}};
const hotMilk=cost({latte:scopedMilkRecipe},scopedMilkMenu,scopedMilkGroups,{},'latte','S',['Hot','Whole Milk']);
const icedMilk=cost({latte:scopedMilkRecipe},scopedMilkMenu,scopedMilkGroups,{},'latte','S',['Iced','Whole Milk']);
check(near(hotMilk.totalCost,20.12)&&near(icedMilk.totalCost,30.12),'duplicate shared-choice ingredients cost only the row assigned to Hot or Iced');
['latte','soda','blend'].forEach(key=>['S','M','L'].forEach(size=>{
  const bare=cost(recipes,menuItems,optionGroups,{},key,size,key==='latte'?['Iced']:[]);
  const withRules=cost(recipes,menuItems,optionGroups,{iced:{rows:[row('cup16',1,1,1)]}},key,size,key==='latte'?['Iced']:[]);
  if(!near(bare.totalCost,withRules.totalCost))fail(`${key} ${size} moved when a packaging table existed but no serve style was set`);
}));
ok('a packaging table alone changes nothing - a drink must be told how it is served');

/* 3. the plan collapses the sets and strips only packaging */
const plan=Plan.applyPlan(recipes,inventory,menuItems,categories);
check(Object.keys(plan.styles).length>=2,'the scattered packaging collapses into serve styles');
check(plan.stripped.length===2,'every recipe that carried packaging has it removed - and only those');
const strippedSoda=plan.updates['recipes/soda/base'];
check(Array.isArray(strippedSoda)&&strippedSoda.length===1&&strippedSoda[0].ing==='milk','stripping a base leaves the drink ingredients untouched');
check(Object.keys(plan.updates).every(p=>p==='packagingRules'||/^(menuItems|recipes|posSettings\/optionCosts)\//.test(p)),'the plan writes only packaging, serve styles, recipe rows and the option library');
check(plan.updates.packagingRules&&typeof plan.updates.packagingRules==='object','the packaging table is written as one node, so a removed style is removed in the data');
check(plan.choiceUpdates.og_temp.Hot==='hot'&&plan.choiceUpdates.og_temp.Iced==='iced','the temperature choice itself carries the serve style');

/* 4. applying it must leave a drink that already had packaging costing exactly the same */
const after=JSON.parse(JSON.stringify(recipes)),menuAfter=JSON.parse(JSON.stringify(menuItems)),groupsAfter=JSON.parse(JSON.stringify(optionGroups));
Object.entries(plan.updates).forEach(([path,value])=>{
  const parts=path.split('/');
  if(parts[0]==='recipes'){
    const recipe=after[parts[1]];if(!recipe)return;
    if(parts[2]==='base')recipe.base=value;
    else{const g=(recipe.choiceAdd||{})[parts[3]];if(!g)return;if(value)g[parts[4]]=value;else delete g[parts[4]];}
  }else if(parts[0]==='menuItems')(menuAfter[parts[1]]=menuAfter[parts[1]]||{}).serveStyle=value;
});
groupsAfter.og_temp.choices.forEach(c=>{c.serveStyle=plan.choiceUpdates.og_temp[c.label];});
['S','M','L'].forEach(size=>{
  [['latte',['Hot']],['latte',['Iced']],['soda',[]]].forEach(([key,labels])=>{
    const before=cost(recipes,menuItems,optionGroups,{},key,size,labels);
    const now=cost(after,menuAfter,groupsAfter,plan.styles,key,size,labels);
    if(!near(before.totalCost,now.totalCost))fail(`${key} ${labels.join('')||'-'} ${size} moved: ${before.totalCost} -> ${now.totalCost}`);
  });
});
ok('a drink that already carried its packaging costs exactly the same afterwards');

/* 5. a drink is never pointed at a serve style that does not exist */
check(Object.values(plan.mapping.items).every(style=>!!plan.styles[style]),'every drink is assigned to a serve style that actually exists');
check(!plan.styles.blended?plan.mapping.items.blend==='iced':plan.mapping.items.blend==='blended','a blended drink falls back to the nearest style that exists');
check(Object.keys(plan.choiceUpdates.og_temp||{}).every(label=>!!plan.styles[plan.choiceUpdates.og_temp[label]]),'a temperature choice never names a missing style');
['S','M','L'].forEach(size=>{
  const before=cost(recipes,menuItems,optionGroups,{},'blend',size,[]);
  const now=cost(after,menuAfter,groupsAfter,plan.styles,'blend',size,[]);
  if(!(now.totalCost>before.totalCost))fail(`blend ${size} still carries no packaging cost`);
});
ok('a drink that carried no packaging now pays for its cup');
const missing=cost(after,menuAfter,groupsAfter,{},'blend','M',[]);
check(missing.warnings.some(w=>w.code==='UNMAPPED_SERVE_STYLE'),'a serve style with no packaging set is reported, never silently free');
check(missing.cogsCovered===false,'an unmapped serve style marks the order as not fully costed');

/* 6. the till and the server must read the same table */
const inv=fs.readFileSync('src/functions/50-inventory.js','utf8');
check(/db\.ref\("\/packagingRules"\)\.get\(\)/.test(inv),'the authoritative server costing reads the packaging table');
check(/packagingRules: pkSnap\.val\(\)/.test(inv),'the server passes packaging into the costing engine');
check(/orderInventoryPlans/.test(fs.readFileSync('src/functions/20-portal-auth.js','utf8')),'the order repair path uses the immutable sale-time plan instead of current packaging');
check(/packagingRules/.test(fs.readFileSync('functions/index.js','utf8')),'the built Functions bundle carries it');
const state=fs.readFileSync('src/admin/pos/00-shared-state.js','utf8');
check(/subscribe\('packagingRules'/.test(state),'the admin portal subscribes to the packaging table');
check(/packagingRules:packagingRulesMap/.test(state),'the till prices with the same table the server posts with');
check(/packagingRules:\['recipes'/.test(fs.readFileSync('assets/js/admin/realtime-hub.mjs','utf8')),'the realtime hub registers the packaging scope, so the subscription actually attaches');
check(/"packagingRules"/.test(fs.readFileSync('database.rules.json','utf8')),'the database rules cover the packaging table');
const ui=fs.readFileSync('src/admin/pos/32-serve-style-packaging.js','utf8');
check(/packSnapshot/.test(ui)&&/packRestore/.test(ui),'the screen takes a restore point and can undo from it');
check(/packStyleSnapshotTaken/.test(ui),'the change stays locked until a restore point has been taken');
check(/packApply/.test(fs.readFileSync('assets/js/admin/pos.js','utf8')),'the built admin bundle carries the packaging screen');
check(/serve-style-plan\.js/.test(fs.readFileSync('admin.html','utf8')),'admin.html loads the planner');
check(/serve-style-plan\.js/.test(fs.readFileSync('sw.js','utf8')),'the service worker caches the planner');

/* 7. a hot cup is handed over with the same serviette as a cold one */
const tissueInv=Object.assign({},inventory,{tissue:{name:'Quarterfold brown tissue',unit:'pc',cost:0.24,category:'cat_packaging'}});
const tissueRecipes=JSON.parse(JSON.stringify(recipes));
tissueRecipes.soda.base.push({ing:'tissue',unit:'pc',stockUnit:'pc',qtyS:5,qtyM:5,qtyL:5});
const tissuePlan=Plan.applyPlan(tissueRecipes,tissueInv,menuItems,categories);
check(!tissuePlan.styles.hot||tissuePlan.styles.hot.rows.some(r=>r.ing==='tissue'),'a serviette on the cold cup is carried across to the hot one');
check(!tissuePlan.styles.iced||tissuePlan.styles.iced.rows.some(r=>r.ing==='tissue'),'the cold cup keeps its serviette');

/* 8. the styles are the user's to change, and bad edits are caught before they are saved */
const ui2=fs.readFileSync('src/admin/pos/32-serve-style-packaging.js','utf8');
check(/data-pack-addrow/.test(ui2)&&/data-pack-delrow/.test(ui2),'an item can be added to a style and taken out of it');
check(/packAddStyle/.test(ui2)&&/data-pack-delstyle/.test(ui2),'a whole serve style can be added and removed');
check(/data-pack-qty/.test(ui2)&&/data-pack-name/.test(ui2),'quantities and the style name are editable');
check(/packStyleSaveStyles/.test(ui2)&&/a\.set\(a\.ref\(a\.db,'packagingRules'\)/.test(ui2),'the styles save on their own, without touching a recipe');
check(/packStyleValidate/.test(ui2),'edits are checked before they are saved');
['has no items in it','has no item chosen','twice','negative quantity','zero for every size'].forEach(phrase=>{
  if(!ui2.includes(phrase))fail('the check for "'+phrase+'" is missing');
});
ok('an empty style, a blank row, a duplicate item, a negative and an all-zero row are all refused');
check(/packDraftRead/.test(ui2),'what is typed survives the screen redrawing');
check(/packReseed/.test(ui2),'the user can start again from what the recipes already do');
check(/styles:draft/.test(ui2),'costs and assignments follow the edited styles, not the original proposal');
check(/packAddStyle/.test(fs.readFileSync('assets/js/admin/pos.js','utf8')),'the built admin bundle carries the editor');

/* 9. the recipe calculator must show exactly what the sale-costing engine will post */
const recipeUi=fs.readFileSync('src/admin/pos/30-recipes.js','utf8');
const choiceScope=fs.readFileSync('src/admin/pos/29-recipe-choice-scope.js','utf8');
const costingSource=fs.readFileSync('assets/js/shared/costing.js','utf8');
check(/costingContext\(\)/.test(recipeUi)&&/packagingRules:packagingRulesMap/.test(fs.readFileSync('src/admin/pos/00-shared-state.js','utf8')),'the recipe calculator includes assigned packaging in its total');
check(/Base recipe/.test(recipeUi)&&/Selected option ingredients/.test(recipeUi)&&/Packaging ·/.test(recipeUi),'the calculator separates base, selected options and packaging');
check(/String\(line\.source\)\.indexOf\('base_'\)===0/.test(recipeUi)&&/line\.source==='packaging'/.test(recipeUi),'the displayed subtotals come from the same engine lines as the final total');
const labeledOption=cost(recipes,menuItems,optionGroups,{},'latte','M',['Hot']).lines.filter(line=>/^option_/.test(line.source));
check(labeledOption.length>0&&labeledOption.every(line=>line.optionGroupId==='og_temp'&&line.optionLabel==='Hot'),'costing-engine option lines retain their group and choice for itemized review');
check(/selectedChoices\.map/.test(recipeUi)&&/groupName/.test(recipeUi)&&/optionAmounts/.test(recipeUi),'every selected menu option is shown on its own costing line');
check(/<th>Recipe unit<\/th>/.test(recipeUi)&&/Amount \('\+size\+'\)/.test(recipeUi),'every per-choice recipe table shows recipe unit and current-size amount');
check(/data-caf="unit"/.test(recipeUi)&&/dispS:r\.dS/.test(choiceScope),'per-choice units and display quantities are converted and saved through the costing engine');
check(/table-layout:fixed/.test(recipeUi)&&/class="r">Amount/.test(recipeUi),'base and option recipe columns share a fixed grid with right-aligned amounts');
check(/data-effective-replace/.test(recipeUi)&&/requiredSelections\.map/.test(recipeUi),'the effective recipe table provides choice-specific shared overrides');
check(/data-rcradio/.test(recipeUi)&&/type="'\+\(isMulti\?'checkbox':'radio'\)/.test(recipeUi)&&/data-rcmulti-check/.test(recipeUi),'required choices use compact exclusive ticks and optional add-ons use checkboxes');
check(/selectedDetail\(line\)/.test(recipeUi)&&/packagingDetail/.test(recipeUi),'selected option and packaging lines enumerate quantity, unit and cost');
check(/line\.recipeQuantityPerServing\?\?line\.quantityPerServing/.test(recipeUi)&&/line\.recipeUnit\|\|line\.stockUnit/.test(recipeUi),'effective recipe rows use the chosen recipe measurement while retaining stock-unit fallback');
check(/Ingredients for selected choices/.test(recipeUi)&&/caSelected\(g,c\)/.test(recipeUi),'only the currently selected choice is shown in the choice-specific editor');
check(/var next=ocClone\(d\.choiceAdd\|\|\{\}\)/.test(recipeUi)&&/data-ca-choice/.test(recipeUi),'editing one choice preserves hidden choice-specific recipes');
check(/Recipe-specific base ingredients/.test(recipeUi)&&/ingredient for '\+esc\(c\.label\)/.test(recipeUi),'the editor clearly separates base ingredients from exact-choice ingredients');
check(/isPackagingCostItem/.test(recipeUi)&&/Packaging Costing only/.test(recipeUi),'packaging items cannot be newly selected as shared choice ingredients');
check(/data-sbf="unit"/.test(recipeUi)&&/data-sbf="disp'\+sz\+'"/.test(recipeUi)&&/convertToStock\(display,u,item\)/.test(recipeUi),'shared base quantities use an editable recipe unit and normalize to the stock unit');
check(/data-ocf="unit"/.test(recipeUi)&&/data-ocf="disp'\+sz\+'"/.test(recipeUi)&&/row\['qty'\+sz\]=convertToStock/.test(recipeUi),'shared choice quantities use an editable recipe unit and normalize to the stock unit');
check(/effectiveSection/.test(recipeUi)&&/Additional ingredients/.test(recipeUi)&&/Included only when selected/.test(recipeUi),'selected optional ingredients remain distinctly labelled in the unified effective table');
check(/sectionRows\('packaging'/.test(recipeUi)&&/sectionRows\('base'/.test(recipeUi)&&/sectionRows\('additional'/.test(recipeUi),'base, packaging and additional ingredients share one aligned table with separate reconciled sections');
check(/data-effective-include/.test(recipeUi)&&/d\.sharedBase=.*filter/.test(recipeUi),'an inherited shared base ingredient can be excluded from one drink in the effective recipe');
check(/colspan=.*requiredSelections\.length/.test(recipeUi)&&/Override/.test(recipeUi)&&/data-effective-replace/.test(recipeUi),'the grouped Override header follows the currently selected required choices');
check(/x\.ing===ing&&x\.op==='replace'/.test(recipeUi),'excluding an inherited ingredient also clears its now-invalid choice replacements');
check(/!\/\(sweet\|milk\)\//.test(recipeUi),'Sweetness and Choice of Milk start without a costing preview default');
check(/data-effective-choice-override/.test(recipeUi)&&/setRecipeChoiceOverride/.test(recipeUi)&&/choice_override/.test(choiceScope),'a selected shared-choice ingredient supports a drink-and-choice-specific quantity override');
check(/recipeTemperatureScope/.test(choiceScope)&&/data-ca-when/.test(recipeUi)&&/when:r\.when/.test(recipeUi),'shared-choice overrides retain an explicit Hot or Iced scope');
check(/op==='choice_override'&&!Object\.keys\(when\)\.length/.test(recipeUi),'an existing unscoped shared-choice override adopts the selected temperature when resaved');
check(/data-ca-temp-scope/.test(choiceScope)&&/Use for:/.test(choiceScope)&&/Not used for/.test(recipeUi),'shared-choice overrides expose explicit Hot and Iced include controls');
check(/data-effective-choice-include/.test(recipeUi)&&/setRecipeChoiceOverrideTemperature/.test(choiceScope),'the main effective-recipe Include column controls a shared-choice override for the selected temperature');
check(/bindChoiceIngredientSelectors/.test(recipeUi)&&/markInheritedChoiceOverride/.test(choiceScope)&&/row\.op='choice_override'/.test(choiceScope)&&/row\.when=recipeTemperatureScope/.test(choiceScope),'adding an inherited shared-choice ingredient creates a separate override for the selected temperature');
check(/if\(!row\)own\.ings\.push\(values\)/.test(choiceScope),'creating one shared-choice override preserves every other inherited shared-choice ingredient');
check(/data-bmove/.test(recipeUi)&&/moveRecipeBaseToChoice/.test(recipeUi)&&/Move to /.test(choiceScope),'an existing all-choice ingredient can be moved to the selected temperature');
check(/id="recAddBase"/.test(recipeUi)&&/\+ ingredient for all choices/.test(recipeUi),'recipe-specific base ingredients can be added again');
check(/recipeBaseTemperatureScope/.test(recipeUi)&&/data-base-temp/.test(choiceScope)&&/recipeBaseScopeFromRow/.test(recipeUi),'duplicate base ingredients expose Hot and Iced assignments and retain their scope');
check(/DUPLICATE_BASE_SCOPE/.test(costingSource)&&/different serving style/.test(costingSource),'overlapping duplicate base ingredient assignments are blocked by canonical validation');
check(/sharedSelected&&sharedSelected\[row\.ing\]\?'replace'/.test(choiceScope),'moving a shared-base ingredient creates a full-quantity replacement for only that choice');
check(/sharedChoiceDuplicate/.test(choiceScope)&&/data-oc-temp/.test(choiceScope)&&/sharedChoiceScopeFromRow/.test(recipeUi),'duplicate ingredients in every shared choice expose Hot and Iced assignments');
check(/recipeServingScopeLabels/.test(choiceScope)&&/Blended/.test(choiceScope)&&/useFor:picked/.test(choiceScope),'shared choices support explicit multi-select Hot, Iced and Blended scopes');
check(/sharedChoiceScopeError/.test(choiceScope)&&/different serving style/.test(choiceScope),'overlapping duplicate serving-style assignments are blocked before saving');
check(/useFor:scope\.useFor/.test(recipeUi)&&/at least one serving style/.test(recipeUi),'shared-choice multi-style selections persist and cannot be left empty');
check(/recipeHasIngredientRows\(rec\)/.test(recipeUi),'choice-only Hot and Iced recipes are recognized by recipe completeness checks');
const recipeSaveUi=fs.readFileSync('src/admin/pos/31-recipe-save.js','utf8');
check(/recipeChoicePackagingRows/.test(recipeSaveUi)&&/groupName/.test(recipeSaveUi)&&/choiceLabel/.test(recipeSaveUi),'legacy packaging warnings identify the exact hidden group and choice');
check(/packagingGap=recipePackagingGap\(item\)/.test(recipeSaveUi)&&/Shared Packaging is incomplete/.test(recipeSaveUi),'legacy packaging is never auto-removed while a serving path lacks shared packaging');
check(/removeRecipeChoicePackaging\(raw\)/.test(recipeSaveUi)&&/prevents packaging cost and stock usage from being counted twice/.test(recipeSaveUi),'covered legacy packaging can be removed with explicit confirmation before save');
const saveHelpers=recipeSaveUi.slice(0,recipeSaveUi.indexOf('function saveRecipe'));
const saveContext={inventoryMap:{cup:{name:'Cold Cup'},lid:{name:'Lid'},milk:{name:'Milk'}},A(){return {optionGroupsMap:{temp:{name:'Temperature'}}};},isPackagingCostItem(id){return id==='cup'||id==='lid';}};
vm.createContext(saveContext);vm.runInContext(saveHelpers,saveContext);
const legacy={choiceAdd:{temp:{Iced:{label:'Iced',ings:[{ing:'cup'},{ing:'milk'}]},Hot:{label:'Hot',ings:[{ing:'lid'}]}}}};
const foundLegacy=saveContext.recipeChoicePackagingRows(legacy);
check(foundLegacy.length===2&&foundLegacy[0].groupName==='Temperature'&&foundLegacy[0].choiceLabel==='Iced','hidden packaging rows are reported with user-facing locations');
saveContext.removeRecipeChoicePackaging(legacy);
check(legacy.choiceAdd.temp.Iced.ings.length===1&&legacy.choiceAdd.temp.Iced.ings[0].ing==='milk'&&!legacy.choiceAdd.temp.Hot,'cleanup removes only packaging and preserves real choice ingredients');
const iceScoped={latte:{base:[row('milk',200,250,300)],choiceAdd:{og_temp:{Iced:{label:'Iced',ings:[row('ice',120,160,200)]}}}}};
const hotIce=cost(iceScoped,menuItems,optionGroups,{},'latte','M',['Hot']).lines.filter(line=>line.ingredientId==='ice');
const icedIce=cost(iceScoped,menuItems,optionGroups,{},'latte','M',['Iced']).lines.filter(line=>line.ingredientId==='ice');
check(hotIce.length===0&&icedIce.length===1&&icedIce[0].quantityPerServing===160,'Ice saved for Iced is absent from Hot and keeps its Iced quantity');

/* 10. the shared option library can hold packaging too - leaving it there charges the cup twice */
const libraryCosts={og_temp:{Hot:{label:'Hot',ings:[row('hotcup',1,1,1),row('flat',1,1,1)]},
  Iced:{label:'Iced',ings:[row('cup16',1,1,1),row('milk',10,10,10)]}}};
const libPlan=Plan.applyPlan(recipes,inventory,menuItems,categories,{optionCosts:libraryCosts});
check(libPlan.updates['posSettings/optionCosts/og_temp/Hot']===null,'a library entry that was only packaging is emptied');
const icedEntry=libPlan.updates['posSettings/optionCosts/og_temp/Iced'];
check(icedEntry&&icedEntry.ings.length===1&&icedEntry.ings[0].ing==='milk','a library entry keeps its real ingredients and loses only the packaging');
check((libPlan.libraryStripped||[]).length===2,'both library entries carrying packaging are reported');
check(Plan.applyPlan(recipes,inventory,menuItems,categories).libraryStripped.length===0,'a library with no packaging in it is left alone');

console.log(failures?`\n${failures} check(s) failed.`:'\nAll serve-style packaging checks passed.');
process.exit(failures?1:0);
