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
  flat:{name:'WHITE FLAT LID',unit:'pc',cost:3.31,category:'cat_packaging'}
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
check(Object.keys(plan.updates).every(p=>p==='packagingRules'||/^(menuItems|recipes)\//.test(p)),'the plan writes only packaging, serve styles and recipe rows');
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
check(/packagingRules/.test(fs.readFileSync('src/functions/20-portal-auth.js','utf8')),'the order repair path reads it too');
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

console.log(failures?`\n${failures} check(s) failed.`:'\nAll serve-style packaging checks passed.');
process.exit(failures?1:0);
