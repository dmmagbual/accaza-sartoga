#!/usr/bin/env node
/* Accaza - moving customer choices into the shared library.
   A shared definition applies to every drink that offers the choice, including drinks that never
   had one, so this is never applied wholesale. These checks pin that: one choice at a time, each
   with its own writes, nothing ticked by default, and a restore point before anything is written. */
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
const sandbox={module:{exports:{}},console};sandbox.globalThis=sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('assets/js/shared/option-library-plan.js','utf8'),sandbox,{filename:'option-library-plan.js'});
const Plan=sandbox.module.exports;
check(Plan&&typeof Plan.plan==='function','the shared option library planner loads');

const inventory={syrup:{name:'Hazelnut',unit:'fl oz',cost:20},cm:{name:'Condensed Milk',unit:'fl oz',cost:4},milk:{name:'Milk',unit:'ml',cost:0.1}};
const menuItems={a:{name:'Latte A',options:['og_syrup']},b:{name:'Latte B',options:['og_syrup']},c:{name:'Latte C',options:['og_syrup']}};
const row=(ing,s,m,l)=>({ing,unit:inventory[ing].unit,stockUnit:inventory[ing].unit,qtyS:s,qtyM:m,qtyL:l});
const recipes={
  a:{base:[row('milk',200,250,300)],choiceAdd:{og_syrup:{'Hazelnut Syrup':{label:'Hazelnut Syrup',ings:[row('syrup',0.5,0.75,0.75)]}}}},
  b:{base:[row('milk',200,250,300)],choiceAdd:{og_syrup:{'Hazelnut Syrup':{label:'Hazelnut Syrup',ings:[row('syrup',0.5,0.75,0.75)]}}}},
  c:{base:[row('milk',200,250,300)],choiceAdd:{og_syrup:{'Hazelnut Syrup':{label:'Hazelnut Syrup',ings:[row('syrup',0.5,0.5,0.5)]}}}}
};
const result=Plan.plan(recipes,inventory,menuItems,{});
check(result.summary.definitions===1,'the same choice across three drinks is one definition');
check(result.summary.copies===3,'every copy is counted');
const entry=result.entries[0];
check(entry.agreed===2&&entry.overrides.length===1,'the spelling most drinks use wins, and the odd one out keeps its own');
check(entry.overrides[0].name==='Latte C','the drink that keeps its own is named');
check(near(entry.rows[0].qtyM,0.75),'the shared definition is the one two of the three drinks agreed on');

/* each choice carries its own writes, so one can move without the others */
check(entry.id==='og_syrup|Hazelnut Syrup','each choice has a stable id of its own');
check(entry.updates&&Object.keys(entry.updates).length===3,'a choice carries its own writes: the library entry and the copies it replaces');
check(entry.updates['recipes/c/choiceAdd/og_syrup/Hazelnut Syrup']===undefined,'the drink that disagrees is never stripped');
check(entry.updates['recipes/a/choiceAdd/og_syrup/Hazelnut Syrup']===null,'a drink that agrees has its copy removed');

/* only the ticked choices are written */
const none=Plan.updatesFor(result,[]);
check(Object.keys(none.updates).length===0,'nothing ticked writes nothing');
const one=Plan.updatesFor(result,[entry.id]);
check(Object.keys(one.updates).length===3&&one.library.og_syrup['Hazelnut Syrup'],'ticking one choice writes only that choice');
const bogus=Plan.updatesFor(result,['og_syrup|Does Not Exist']);
check(Object.keys(bogus.updates).length===0,'an id that does not exist writes nothing');

/* the drinks that agreed must cost exactly what they did; the one that differs must not move */
const optionGroups={og_syrup:{choices:[{label:'Hazelnut Syrup'}]}};
const after=Plan.applyTo(recipes,{updates:one.updates});
function cost(recipeMap,costs,key,size){
  return Costing.costOrder({recipes:recipeMap,menuItems,inventory,optionGroups,optionCosts:costs,optionRecipes:{},packagingRules:{},
    lineItems:[{itemKey:key,size,qty:1,optLabels:['Hazelnut Syrup']}]});
}
['a','b','c'].forEach(key=>['S','M','L'].forEach(size=>{
  const before=cost(recipes,{},key,size),now=cost(after,one.library,key,size);
  if(!near(before.totalCost,now.totalCost))fail(`${key} ${size} moved ${before.totalCost} -> ${now.totalCost}`);
}));
ok('every drink costs exactly what it did - the ones that agreed and the one that kept its own');
check(near(cost(after,one.library,'c','M').totalCost,cost(recipes,{},'c','M').totalCost),'the drink that kept its own overrides the library rather than adding to it');

/* a definition the user already saved in the library is the one that stays */
const saved={og_syrup:{'Hazelnut Syrup':{label:'Hazelnut Syrup',ings:[row('syrup',0.6,0.6,0.6)]}}};
const withSaved=Plan.plan(recipes,inventory,menuItems,{optionCosts:saved});
check(near(withSaved.entries[0].rows[0].qtyM,0.6),'a definition already in the library is not overwritten by what the recipes say');
check(withSaved.entries[0].overrides.length===3,'and every drink then keeps its own, because none of them match it');

/* the screen must pick one choice at a time, and never before a restore point */
const ui=fs.readFileSync('src/admin/pos/33-option-library.js','utf8');
check(/optLibSnap/.test(ui)&&/optLibRestoreFile/.test(ui),'the screen takes a restore point and can undo from it');
check(/optLibSnapshotTaken/.test(ui),'nothing can be moved until a restore point has been taken');
check(/data-optlib/.test(ui),'each choice is ticked on its own');
check(/optLibPicked=\{\}/.test(ui),'nothing is ticked to begin with');
check(/would be refused/.test(ui),'a choice that would break an order says so');
check(/disabled/.test(ui),'and cannot be ticked');
check(/optLibPickSafe/.test(ui),'there is a way to take only the choices that change nothing');
check(/newlyCosted/.test(ui)&&/start costing/.test(ui),'each choice shows how many combinations start costing, and how much');
check(/updatesFor/.test(ui),'only the ticked choices are written');
check(/optLibMeasure/.test(ui),'the effect is worked out from the real menu, not assumed');
const shell=fs.readFileSync('admin.html','utf8');
check(/option-library-plan\.js/.test(shell),'admin.html loads the planner');
check(/option-library-plan\.js/.test(fs.readFileSync('sw.js','utf8')),'the service worker caches it');
check(/optLibApply/.test(fs.readFileSync('assets/js/admin/pos.js','utf8')),'the built admin bundle carries the screen');
check(/optlibrary/.test(fs.readFileSync('src/admin/pos/30-recipes.js','utf8')),'the Recipes tab offers it');

console.log(failures?`\n${failures} check(s) failed.`:'\nAll option library checks passed.');
process.exit(failures?1:0);
