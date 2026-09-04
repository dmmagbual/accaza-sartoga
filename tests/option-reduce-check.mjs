#!/usr/bin/env node
/* Accaza - a choice that takes something out.
   "Not Sweet" means no sweetener, not minus three quarters of an ounce. Held as a fixed minus,
   one shared definition drove the count below zero on every drink that had no condensed milk and
   the till refused the order. A row marked op:'reduce' removes what the drink actually uses and
   nothing more, so the same definition works everywhere. */
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

const inventory={cm:{name:'Condensed Milk',unit:'fl oz',cost:4},milk:{name:'Milk',unit:'ml',cost:0.1},oat:{name:'Oat',unit:'ml',cost:0.15}};
const optionGroups={og_sweet:{choices:[{label:'Not Sweet'},{label:'Less Sweet'}]},og_milk:{choices:[{label:'Sub Oat'}]}};
const menuItems={latte:{name:'Latte',options:['og_sweet','og_milk']},soda:{name:'Soda',options:['og_sweet']}};
const library={
  og_sweet:{'Not Sweet':{label:'Not Sweet',ings:[{ing:'cm',op:'reduce',qtyS:0.75,qtyM:0.75,qtyL:0.75}]},
    'Less Sweet':{label:'Less Sweet',ings:[{ing:'cm',op:'reduce',qtyS:0.35,qtyM:0.35,qtyL:0.35}]}},
  og_milk:{'Sub Oat':{label:'Sub Oat',ings:[{ing:'milk',op:'reduce',qtyS:200,qtyM:250,qtyL:300},{ing:'oat',qtyS:200,qtyM:250,qtyL:300}]}}
};
const recipes={
  latte:{base:[{ing:'cm',qtyS:0.75,qtyM:0.75,qtyL:0.75},{ing:'milk',qtyS:200,qtyM:250,qtyL:300}]},
  soda:{base:[{ing:'milk',qtyS:100,qtyM:120,qtyL:150}]}
};
function run(key,labels,size){
  return Costing.costOrder({recipes,menuItems,inventory,optionGroups,optionCosts:library,optionRecipes:{},packagingRules:{},
    lineItems:[{itemKey:key,size:size||'M',qty:1,optLabels:labels||[]}]});
}
const plainLatte=run('latte',[]),notSweet=run('latte',['Not Sweet']),lessSweet=run('latte',['Less Sweet']);
check(near(plainLatte.totalCost,28),'the plain drink is unaffected');
check(near(notSweet.usage.cm,0),'taking the sweetener out leaves none of it drawn');
check(near(notSweet.totalCost,plainLatte.totalCost-3),'the cost falls by exactly what came out');
check(near(lessSweet.usage.cm,0.4),'a partial reduction leaves the remainder');

const plainSoda=run('soda',[]),sodaNotSweet=run('soda',['Not Sweet']);
check(sodaNotSweet.errors.length===0,'a drink with nothing to take out is not refused');
check(near(sodaNotSweet.totalCost,plainSoda.totalCost),'and it costs the same as before');
check(sodaNotSweet.usage.cm===undefined||near(sodaNotSweet.usage.cm,0),'nothing is drawn that was never there');

/* the same definition must work on every size */
['S','M','L'].forEach(size=>{
  const before=run('latte',[],size),after=run('latte',['Not Sweet'],size);
  if(!near(after.usage.cm,0))fail('size '+size+' still draws condensed milk after Not Sweet');
  if(!(after.totalCost<before.totalCost))fail('size '+size+' did not come down');
  const soda=run('soda',['Not Sweet'],size);
  if(soda.errors.length)fail('size '+size+' refused the soda');
});
ok('one shared definition works on every size, and on drinks that have nothing to take out');

/* a swap takes one thing out and puts another in, in the same choice */
const swap=run('latte',['Sub Oat']);
check(near(swap.usage.milk,0)&&near(swap.usage.oat,250),'a swap removes the milk and adds the oat');
check(swap.errors.length===0,'a swap is never refused');

/* nothing may ever go below zero, and a plain negative row is still caught */
const bad={og_sweet:{'Not Sweet':{label:'Not Sweet',ings:[{ing:'cm',qtyS:-0.75,qtyM:-0.75,qtyL:-0.75}]}}};
const unguarded=Costing.costOrder({recipes,menuItems,inventory,optionGroups,optionCosts:bad,optionRecipes:{},packagingRules:{},
  lineItems:[{itemKey:'soda',size:'M',qty:1,optLabels:['Not Sweet']}]});
check(unguarded.errors.some(e=>e.code==='NEGATIVE_TOTAL_USAGE'),'a fixed minus that has nothing to take from is still refused');
Object.keys(notSweet.usage).forEach(id=>{if(notSweet.usage[id]<0)fail('reduce drove '+id+' below zero');});
ok('a reduce can never drive an ingredient below zero');

/* it must take out only what THIS drink uses, not what another line used */
const two=Costing.costOrder({recipes,menuItems,inventory,optionGroups,optionCosts:library,optionRecipes:{},packagingRules:{},
  lineItems:[{itemKey:'latte',size:'M',qty:1,optLabels:[]},{itemKey:'soda',size:'M',qty:1,optLabels:['Not Sweet']}]});
check(near(two.usage.cm,0.75),'a reduce on one line never eats into another line');
check(two.errors.length===0,'a mixed order is not refused');

/* an order of two drinks reduces twice */
const double=Costing.costOrder({recipes,menuItems,inventory,optionGroups,optionCosts:library,optionRecipes:{},packagingRules:{},
  lineItems:[{itemKey:'latte',size:'M',qty:2,optLabels:['Not Sweet']}]});
check(near(double.usage.cm,0),'two drinks with the sweetener out draw none of it');
check(near(double.usage.milk,500),'the rest of the drink still scales with quantity');

/* the migration must write shared definitions in this form */
const sandbox={module:{exports:{}},console};sandbox.globalThis=sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('assets/js/shared/option-library-plan.js','utf8'),sandbox,{filename:'option-library-plan.js'});
const Plan=sandbox.module.exports;
const converted=Plan.asReducers([{ing:'cm',qtyS:-0.75,qtyM:-0.75,qtyL:-0.75},{ing:'oat',qtyS:200,qtyM:250,qtyL:300}]);
check(converted[0].op==='reduce'&&converted[0].qtyM===0.75,'a shared definition that only subtracts is written as a reduce');
check(!converted[1].op&&converted[1].qtyM===250,'a row that adds is left exactly as it is');
const mixed=Plan.asReducers([{ing:'milk',qtyS:-150,qtyM:-200,qtyL:-250}]);
check(mixed[0].op==='reduce','the take-away half of a swap becomes a reduce');

check(/op:'reduce'/.test(fs.readFileSync('assets/js/shared/costing.js','utf8')),'the shared engine carries the reduce rule');
check(/op:'reduce'/.test(fs.readFileSync('functions/lib/costing.js','utf8')),'the Functions copy of the engine is in step with it');

console.log(failures?`\n${failures} check(s) failed.`:'\nAll reduce-choice checks passed.');
process.exit(failures?1:0);
