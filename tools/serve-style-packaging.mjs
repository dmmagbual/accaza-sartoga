#!/usr/bin/env node
/**
 * Accaza - serve-style packaging, dry run.
 * Usage:  node tools/serve-style-packaging.mjs <recipes-restore-point.json> <data-backup.json>
 *
 * Moves packaging out of the recipes and into one table keyed by how a drink is served, then
 * prices every drink and size before and after so the cost of closing the gap is visible
 * before anything is written. Writes nothing anywhere.
 */
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const Costing=require('../functions/lib/costing.js');
function load(file){
  const sandbox={module:{exports:{}},console};sandbox.globalThis=sandbox;
  vm.createContext(sandbox);vm.runInContext(fs.readFileSync(file,'utf8'),sandbox,{filename:file});
  return sandbox.module.exports;
}
const Plan=load('assets/js/shared/serve-style-plan.js');
const recipes=JSON.parse(fs.readFileSync(process.argv[2],'utf8')).recipes;
const data=JSON.parse(fs.readFileSync(process.argv[3],'utf8')).data;
const menuItems=data.menuItems||{},inventory=data.inventory||{},optionGroups=data.optionGroups||{};
const categories=(data.posSettings&&data.posSettings.invCategories)||{};
const result=Plan.applyPlan(recipes,inventory,menuItems,categories);
const nm=(id)=>(inventory[id]||{}).name||id;
const peso=(v)=>Number(v||0).toFixed(2).padStart(8);

console.log('\nAccaza - serve-style packaging, dry run');
console.log('recipes read        :',Object.keys(recipes).length);
console.log('packaging sets found:',result.proposal.styles.length,'-> collapsed into',Object.keys(result.styles).length,'serve styles');
console.log('recipes stripped    :',result.stripped.length);
console.log('write paths         :',Object.keys(result.updates).length);
Object.entries(result.styles).forEach(([id,style])=>{
  console.log(`\n  ${id.toUpperCase()} - ${style.description}`);
  style.rows.forEach(r=>console.log(`    ${nm(r.ing).padEnd(28)} S ${r.qtyS}  M ${r.qtyM}  L ${r.qtyL}`));
});

/* apply the plan to a copy so the same engine can price both worlds */
const after=JSON.parse(JSON.stringify(recipes));
const menuAfter=JSON.parse(JSON.stringify(menuItems));
const groupsAfter=JSON.parse(JSON.stringify(optionGroups));
Object.entries(result.updates).forEach(([path,value])=>{
  const parts=path.split('/');
  if(parts[0]==='recipes'){
    const recipe=after[parts[1]];if(!recipe)return;
    if(parts[2]==='base')recipe.base=value;
    else{const group=(recipe.choiceAdd||{})[parts[3]];if(!group)return;if(value)group[parts[4]]=value;else delete group[parts[4]];}
  }else if(parts[0]==='menuItems'){(menuAfter[parts[1]]=menuAfter[parts[1]]||{}).serveStyle=value;}
});
Object.entries(result.choiceUpdates).forEach(([gid,map])=>{
  const group=groupsAfter[gid];if(!group||!Array.isArray(group.choices))return;
  group.choices.forEach(choice=>{if(map[choice.label])choice.serveStyle=map[choice.label];});
});
function cost(recipeMap,menuMap,groupMap,rules,key,size,labels){
  const out=Costing.costOrder({recipes:recipeMap,menuItems:menuMap,inventory,optionGroups:groupMap,
    optionCosts:{},optionRecipes:{},packagingRules:rules,
    lineItems:[{itemKey:key,size,qty:1,optLabels:labels||[]}]});
  return out;
}
console.log('\ndrink                          serve     before    after    change');
let gained=0,covered=0,drinks=0;
Object.keys(recipes).sort((a,b)=>String((menuItems[a]||{}).name||a).localeCompare(String((menuItems[b]||{}).name||b))).forEach(key=>{
  const item=menuItems[key];if(!item)return;
  const temp=Array.isArray(item.options)&&item.options.indexOf('og_temp')>=0;
  const labelSets=temp?[['Hot'],['Iced']]:[[]];
  labelSets.forEach(labels=>{
    const before=cost(recipes,menuItems,optionGroups,{},key,'M',labels);
    const now=cost(after,menuAfter,groupsAfter,result.styles,key,'M',labels);
    const delta=now.totalCost-before.totalCost;
    drinks++;if(Math.abs(delta)>0.005)gained+=delta;
    if(!now.warnings.some(w=>w.code==='UNMAPPED_SERVE_STYLE'))covered++;
    console.log(`${String(item.name||key).slice(0,28).padEnd(30)} ${(labels[0]||'-').padEnd(8)} ${peso(before.totalCost)} ${peso(now.totalCost)} ${peso(delta)}`);
  });
});
console.log('-'.repeat(72));
console.log(`priced combinations: ${drinks}   with packaging after: ${covered}   without: ${drinks-covered}`);
console.log(`total COGS added at size M across every drink: PHP ${gained.toFixed(2)}   average per drink: PHP ${(gained/drinks).toFixed(2)}`);
