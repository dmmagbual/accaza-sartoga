import fs from 'node:fs';
import vm from 'node:vm';

let failures=0;
function check(condition,message){if(!condition){failures++;console.error('✗ '+message);}else console.log('✓ '+message);}

const recipeSource=fs.readFileSync('src/admin/pos/30-recipes.js','utf8');
const coverageSource=fs.readFileSync('src/admin/pos/29a-recipe-cost-coverage.js','utf8');
const source=coverageSource+'\n'+recipeSource;
const choiceScopeSource=fs.readFileSync('src/admin/pos/29-recipe-choice-scope.js','utf8');
if(!/var recipeCats=\(A\(\)\.getCats\?A\(\)\.getCats\(\):\[\]\);/.test(recipeSource)||/var recipeCats=.*\['coffee'/.test(recipeSource))throw new Error('Recipe Costing must use every live Menu Availability category instead of a hard-coded category allowlist');
if(!/var items=menuList\(\)\.filter\(function\(it\)\{return !recCategory\|\|it\.cat===recCategory;\}\);/.test(recipeSource))throw new Error('Recipe Costing must list every menu item in the selected live category instead of hiding items behind costing-policy classification');
const start=source.indexOf('function recipeItemIsSingleServing');
const end=source.indexOf('function updateCostBadge');
if(start<0||end<0)throw new Error('Recipes cost-gap functions were not found');

const menuItems=[];
const costedItems=[];
const context={
  window:{__posSettings:{catType:{custom_drinks:'drink',meals:'food'},packagingAssignments:{coffee:{choices:{temp:{Hot:'hot',Iced:'iced'}}},pastry:{defaultStyle:'iced'}}}},
  packagingRulesMap:{hot:{rows:[{ing:'hot_cup'}]},iced:{rows:[{ing:'iced_cup'}]},empty:{rows:[]}},
  inventoryMap:{beans:{cost:10}},recipesMap:{},
  menuList(){return menuItems;},
  recipeHasIngredientRows(rec){return !!(rec&&((rec.base||[]).length||(rec.sharedBase||[]).length||Object.values(rec.choiceAdd||{}).some(group=>Object.values(group||{}).some(entry=>(entry.ings||[]).length))));},
  A(){return {getMenuItems(){return menuItems;},getItemOptionGroups(item){return item.groups||[];}};},
  costingContext(){return {packagingAssignments:context.window.__posSettings.packagingAssignments};},
  Costing(){return {costRecipe(args){costedItems.push(args.item);var missing=args.item&&args.item.key==='uncosted',scoped=args.item&&args.item.key==='scoped';return {totalCost:scoped?(args.optLabels||[]).some(x=>x==='Hot'||x==='Iced')?10:0:args.item&&args.item.key?10:0,warnings:missing?[{code:'MISSING_COST',itemId:'beans'}]:[]};},serveStyleFor(item,labels){var a=context.window.__posSettings.packagingAssignments[item.cat]||{};if(item.cat==='pastry')return a.defaultStyle||'';var g=(a.choices||{}).temp||{};if(labels&&labels[0]&&g[labels[0]])return g[labels[0]];var groups=item.groups||[];for(var i=0;i<groups.length;i++){for(var j=0;j<(groups[i].choices||[]).length;j++){var c=groups[i].choices[j];if(labels.indexOf(c.label)>=0&&c.serveStyle)return c.serveStyle;}}return a.defaultStyle||item.serveStyle||'';}};}
};
vm.createContext(context);
vm.runInContext(choiceScopeSource+source.slice(start,end),context);

function gapsFor(items){
  menuItems.splice(0,menuItems.length,...items);
  context.recipesMap={};
  items.forEach(item=>{context.recipesMap[item.key]={base:[{ing:'beans',qtyM:1}]};});
  return context.menuCostGaps();
}
const choices=[{label:'Hot'},{label:'Iced'}];
check(gapsFor([{key:'latte',name:'Latte',cat:'coffee',groups:[{id:'temp',name:'Temperature',choices}]}]).length===0,'category plus live Hot/Iced choices provide packaging coverage');
check(costedItems.some(item=>item&&item.key==='latte'&&item.cat==='coffee'),'recipe completeness costing receives the real menu item context');
context.recipesMap={scoped:{base:[{ing:'beans',qtyM:1,when:{temp:'Hot'}},{ing:'beans',qtyM:1,when:{temp:'Iced'}}]}};menuItems.splice(0,menuItems.length,{key:'scoped',name:'Scoped drink',cat:'coffee',groups:[{id:'temp',name:'Temperature',required:true,type:'single',choices}]});check(context.menuCostGaps().length===0,'Hot/Iced-scoped base rows are tested through real required selections, never a blank artificial path');
context.recipesMap={choice_only:{choiceAdd:{temp:{Iced:{label:'Iced',ings:[{ing:'beans',qtyM:1}]}}}}};menuItems.splice(0,menuItems.length,{key:'choice_only',name:'Choice only',cat:'coffee',groups:[{id:'temp',name:'Temperature',choices}]});check(context.menuCostGaps().length===0,'a recipe made entirely from Hot or Iced rows is not treated as missing');
context.recipesMap={scoped:{base:[{ing:'beans',qtyM:1}]}};menuItems.splice(0,menuItems.length,{key:'scoped',name:'Scoped drink',cat:'coffee',groups:[{id:'temp',name:'Temperature',required:true,type:'single',choices:[{label:'Hot'},{label:'Broken'}]}]});check(context.menuCostGaps()[0].reason==='Recipe cost is ₱0 for Temperature: Broken','a genuine zero-cost required path is retained and names the exact selection');
check(gapsFor([{key:'uncosted',name:'Uncosted drink',cat:'coffee',groups:[{id:'temp',name:'Temperature',choices}]}])[0].reason==='beans has no unit cost','effective costing warnings name an uncosted ingredient even when the recipe total is positive');
delete context.window.__posSettings.packagingAssignments.coffee.choices.temp.Iced;
check(gapsFor([{key:'latte',name:'Latte',cat:'coffee',groups:[{id:'temp',name:'Temperature',choices}]}])[0].reason==='No effective serve style for Iced','a drink is flagged when one current Menu Availability choice lacks packaging');
context.window.__posSettings.packagingAssignments.coffee.choices.temp.Iced='iced';
check(gapsFor([{key:'soda',name:'Soda',cat:'soda',serveStyle:'empty'}])[0].reason==='No packaging set for empty','a mapped style with no packaging rows is warned');
check(gapsFor([{key:'meal',name:'Meal',cat:'meals'}]).length===0,'food is not falsely treated as a drink');
check(gapsFor([{key:'muesli',name:'MUESLI',cat:'pastry',priceS:180}]).length===0,'single-price pastry is audited with its inherited category packaging assignment');
context.recipesMap={};menuItems.splice(0,menuItems.length,{key:'croissant',name:'Croissant',cat:'pastry',priceS:95,needsBuilding:false});check(context.menuCostGaps().length===0,'ready-to-sell pastry requires packaging but not an ingredient recipe');
context.recipesMap={};menuItems.splice(0,menuItems.length,{key:'muesli',name:'MUESLI',cat:'pastry',priceS:180,needsBuilding:true});check(context.menuCostGaps()[0].reason==='No recipe yet','build-required pastry is flagged until its ingredient recipe is saved');
delete context.window.__posSettings.packagingAssignments.pastry;
check(gapsFor([{key:'muesli',name:'MUESLI',cat:'pastry',priceS:180,serveStyle:'iced'}])[0].reason==='No effective serve style','a removed pastry category assignment cannot silently fall back to legacy item packaging');
context.window.__posSettings.packagingAssignments.pastry={defaultStyle:'iced'};
check(gapsFor([{key:'special',name:'Special',cat:'custom_drinks',serveStyle:'iced'}]).length===0,'a custom category tagged drink is checked and can be covered');
check(gapsFor([{key:'resale',name:'Bottled Water',cat:'soda',noRecipe:true}]).length===0,'no-recipe items remain exempt from every cost-gap warning');
check(!/books|financial|journal|ledger/i.test(source.slice(start,end)),'the warning logic has no Finance Books posting behavior');
check(/recipePackagingGap/.test(fs.readFileSync('assets/js/admin/pos.js','utf8')),'the built Admin bundle carries the coverage warning');
check(/Costing Incomplete/.test(source)&&/Every item remains sellable/.test(source),'the UI flags incomplete costing without blocking sales');
check(/recipeCost\(rec,'S',it\)/.test(source)&&/recipeCost\(rec,'M',it\)/.test(source)&&/recipeCost\(rec,'L',it\)/.test(source),'saved recipe costs use the real menu item context for every size');
check(/single-price pastries use one quantity per serving/.test(source)&&/Effective Price &amp; Cost/.test(source),'single-price pastry UI uses one serving quantity and effective price card');
const catalog=fs.readFileSync('assets/js/admin/catalog-admin.mjs','utf8'),catalogHtml=fs.readFileSync('src/html/admin/40-admin-catalog.html','utf8');
check(/needsBuilding/.test(catalog)&&/newItemNeedsBuilding/.test(catalogHtml)&&/Needs building before sale/.test(catalogHtml),'pastry build mode is available when adding and editing menu items');

console.log(failures?'\n'+failures+' check(s) failed.':'\nAll recipe cost-gap checks passed.');
process.exit(failures?1:0);
