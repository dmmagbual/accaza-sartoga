import fs from 'node:fs';
import vm from 'node:vm';

let failures=0;
function check(condition,message){if(!condition){failures++;console.error('✗ '+message);}else console.log('✓ '+message);}

const source=fs.readFileSync('src/admin/pos/30-recipes.js','utf8');
const start=source.indexOf('function recipeItemIsDrink');
const end=source.indexOf('function updateCostBadge');
if(start<0||end<0)throw new Error('Recipes cost-gap functions were not found');

const menuItems=[];
const costedItems=[];
const context={
  window:{__posSettings:{catType:{custom_drinks:'drink',meals:'food'},packagingAssignments:{coffee:{choices:{temp:{Hot:'hot',Iced:'iced'}}}}}},
  packagingRulesMap:{hot:{rows:[{ing:'hot_cup'}]},iced:{rows:[{ing:'iced_cup'}]},empty:{rows:[]}},
  inventoryMap:{beans:{cost:10}},recipesMap:{},
  A(){return {getMenuItems(){return menuItems;},getItemOptionGroups(item){return item.groups||[];}};},
  costingContext(){return {packagingAssignments:context.window.__posSettings.packagingAssignments};},
  Costing(){return {costRecipe(args){costedItems.push(args.item);return {totalCost:args.item&&args.item.key?10:0};},serveStyleFor(item,labels){var a=context.window.__posSettings.packagingAssignments[item.cat]||{},g=(a.choices||{}).temp||{};if(labels&&labels[0]&&g[labels[0]])return g[labels[0]];var groups=item.groups||[];for(var i=0;i<groups.length;i++){for(var j=0;j<(groups[i].choices||[]).length;j++){var c=groups[i].choices[j];if(labels.indexOf(c.label)>=0&&c.serveStyle)return c.serveStyle;}}return a.defaultStyle||item.serveStyle||'';}};}
};
vm.createContext(context);
vm.runInContext(source.slice(0,source.indexOf('function recipeDraftRaw'))+source.slice(start,end),context);

function gapsFor(items){
  menuItems.splice(0,menuItems.length,...items);
  context.recipesMap={};
  items.forEach(item=>{context.recipesMap[item.key]={base:[{ing:'beans',qtyM:1}]};});
  return context.menuCostGaps();
}
const choices=[{label:'Hot'},{label:'Iced'}];
check(gapsFor([{key:'latte',name:'Latte',cat:'coffee',groups:[{id:'temp',name:'Temperature',choices}]}]).length===0,'category plus live Hot/Iced choices provide packaging coverage');
check(costedItems.some(item=>item&&item.key==='latte'&&item.cat==='coffee'),'recipe completeness costing receives the real menu item context');
delete context.window.__posSettings.packagingAssignments.coffee.choices.temp.Iced;
check(gapsFor([{key:'latte',name:'Latte',cat:'coffee',groups:[{id:'temp',name:'Temperature',choices}]}])[0].reason==='No effective serve style for Iced','a drink is flagged when one current Menu Availability choice lacks packaging');
context.window.__posSettings.packagingAssignments.coffee.choices.temp.Iced='iced';
check(gapsFor([{key:'soda',name:'Soda',cat:'soda',serveStyle:'empty'}])[0].reason==='No packaging set for empty','a mapped style with no packaging rows is warned');
check(gapsFor([{key:'meal',name:'Meal',cat:'meals'}]).length===0,'food is not falsely treated as a drink');
check(gapsFor([{key:'special',name:'Special',cat:'custom_drinks',serveStyle:'iced'}]).length===0,'a custom category tagged drink is checked and can be covered');
check(gapsFor([{key:'resale',name:'Bottled Water',cat:'soda',noRecipe:true}]).length===0,'no-recipe items remain exempt from every cost-gap warning');
check(!/books|financial|journal|ledger/i.test(source.slice(start,end)),'the warning logic has no Finance Books posting behavior');
check(/recipePackagingGap/.test(fs.readFileSync('assets/js/admin/pos.js','utf8')),'the built Admin bundle carries the coverage warning');
check(/Costing Incomplete/.test(source)&&/Every drink remains sellable/.test(source),'the UI flags incomplete costing without blocking sales');
check(/recipeCost\(rec,'S',it\)/.test(source)&&/recipeCost\(rec,'M',it\)/.test(source)&&/recipeCost\(rec,'L',it\)/.test(source),'saved recipe costs use the real menu item context for every size');

console.log(failures?'\n'+failures+' check(s) failed.':'\nAll recipe cost-gap checks passed.');
process.exit(failures?1:0);
