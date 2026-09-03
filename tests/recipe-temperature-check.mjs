#!/usr/bin/env node
/* Accaza - temperature-option repair guard.
   A "Hot" choice written as the complete hot recipe was ADDED to the base, so a hot drink
   was costed twice and drew its ingredients twice. These checks pin the repair: choices
   become differences from the base, the base never moves, and a drink that does not offer
   the Temperature group is never touched. */
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const Costing=require('../functions/lib/costing.js');
let failures=0;
function fail(message){failures++;console.error('FAIL: '+message);}
function ok(message){console.log('PASS: '+message);}
function check(condition,message){condition?ok(message):fail(message);}
function near(a,b){return Math.abs(Number(a)-Number(b))<0.011;}

const sandbox={module:{exports:{}},console};sandbox.globalThis=sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('assets/js/shared/recipe-temperature-plan.js','utf8'),sandbox,{filename:'recipe-temperature-plan.js'});
const Plan=sandbox.module.exports;
check(Plan&&typeof Plan.plan==='function','the shared temperature planner loads');

const inventory={
  bean:{name:'Coffee Beans',unit:'g',cost:1.4},
  milk:{name:'WHOLE MILK',unit:'ml',cost:0.1},
  ice:{name:'Ice',unit:'g',cost:0.005},
  water:{name:'Water',unit:'ml',cost:0.002}
};
function row(ing,s,m,l){return {ing:ing,unit:inventory[ing].unit,stockUnit:inventory[ing].unit,qtyS:s,qtyM:m,qtyL:l};}
const optionGroups={
  og_temp:{name:'Temperature',required:true,type:'single',choices:[{label:'Hot',price:0},{label:'Iced',price:0}]},
  og_sweet:{name:'Sweetness',choices:[{label:'Regular',price:0}]}
};
const menuItems={
  latte:{name:'Latte',options:['og_temp']},
  americano:{name:'Americano',options:['og_temp']},
  cocoa:{name:'Cocoa',options:['og_temp']},
  blended:{name:'Blended',options:['og_sweet']}
};
const recipes={
  /* base has no ice; Hot repeats the whole recipe; Iced adds the ice */
  latte:{base:[row('bean',18,19,20),row('milk',200,250,300)],
    choiceAdd:{og_temp:{Hot:{label:'Hot',ings:[row('milk',200,250,300),row('bean',18,19,20)]},
      Iced:{label:'Iced',ings:[row('ice',150,200,250)]}}}},
  /* base carries the ice AND the Iced choice adds it again; Hot repeats the recipe */
  americano:{base:[row('bean',18,19,20),row('water',4,5,6),row('ice',150,200,250)],
    choiceAdd:{og_temp:{Hot:{label:'Hot',ings:[row('bean',18,19,20),row('water',5,6,7)]},
      Iced:{label:'Iced',ings:[row('ice',150,200,250)]}}}},
  /* Hot is already a genuine difference - it must be left exactly as it is */
  cocoa:{base:[row('milk',200,250,300)],
    choiceAdd:{og_temp:{Hot:{label:'Hot',ings:[row('milk',-20,-20,-20)]}}}},
  /* no Temperature group offered - the planner must not touch it */
  blended:{base:[row('milk',200,250,300),row('ice',150,200,250)],
    choiceAdd:{og_temp:{Hot:{label:'Hot',ings:[row('milk',200,250,300)]}}}}
};
const result=Plan.plan(recipes,inventory,menuItems);
const after=Plan.applyToRecipes(recipes,result);
const moved={};result.drinks.forEach(function(d){moved[d.key]=d;});

check(!moved.blended,'a drink that does not offer Temperature is left alone');
check(!moved.cocoa,'a Hot choice that is already a difference is left alone');
check(!!moved.latte&&moved.latte.kind==='full-copy','a Hot choice that repeats the recipe is recognised');
check(!!moved.americano&&moved.americano.duplicateIce,'ice in the base plus ice in the Iced choice is recognised as duplicated');
check(after.blended.choiceAdd.og_temp.Hot.ings.length===1,'the untouched drink keeps its choice rows');

function cost(map,key,size,labels){
  return Costing.costOrder({recipes:map,menuItems,inventory,optionGroups,optionCosts:{},optionRecipes:{},
    lineItems:[{itemKey:key,size:size,qty:1,optLabels:labels||[]}]});
}
['latte','americano','cocoa','blended'].forEach(function(key){
  ['S','M','L'].forEach(function(size){
    const before=cost(recipes,key,size,[]),now=cost(after,key,size,[]);
    if(!near(before.totalCost,now.totalCost))fail('the plain recipe for '+key+' '+size+' moved '+before.totalCost+' -> '+now.totalCost);
  });
});
ok('the plain recipe cost never moves for any drink or size');

/* the whole point: a hot drink stops paying for itself twice */
['S','M','L'].forEach(function(size){
  const target=cost({latte:{base:recipes.latte.choiceAdd.og_temp.Hot.ings}},'latte',size,[]).totalCost;
  const now=cost(after,'latte',size,['Hot']).totalCost;
  const was=cost(recipes,'latte',size,['Hot']).totalCost;
  if(!near(now,target))fail('hot latte '+size+' costs '+now+', the written recipe is '+target);
  if(!(was>now))fail('hot latte '+size+' did not come down from '+was);
});
ok('a hot drink costs the hot recipe as written, not the recipe twice');

/* the ingredient draw has to come down too, not only the peso value */
const usageBefore=cost(recipes,'latte','M',['Hot']).usage,usageAfter=cost(after,'latte','M',['Hot']).usage;
check(usageBefore.bean===38&&usageAfter.bean===19,'a hot latte draws 19g of beans, not 38g');
check(usageAfter.milk===250,'a hot latte draws its milk once');

/* the empty Hot difference is deleted rather than left as an empty husk */
check(after.latte.choiceAdd.og_temp.Hot===undefined,'a Hot choice identical to the base is removed');
check(after.americano.choiceAdd.og_temp.Iced===undefined,'the duplicated Iced ice is removed');
['S','M','L'].forEach(function(size){
  const iced=cost(after,'americano',size,['Iced']).totalCost,plain=cost(recipes,'americano',size,[]).totalCost;
  if(!near(iced,plain))fail('iced americano '+size+' costs '+iced+', the base recipe is '+plain);
  const hot=cost(after,'americano',size,['Hot']);
  const target=cost({americano:{base:recipes.americano.choiceAdd.og_temp.Hot.ings}},'americano',size,[]).totalCost;
  if(!near(hot.totalCost,target))fail('hot americano '+size+' costs '+hot.totalCost+', the written recipe is '+target);
  if(hot.errors.length)fail('hot americano '+size+' reports costing errors after the repair');
  Object.keys(hot.usage).forEach(function(id){if(hot.usage[id]<0)fail('hot americano '+size+' drives '+id+' negative');});
});
ok('an iced drink lands on the base recipe and a hot drink never drives usage negative');

/* every write must be reversible from the restore point, and confined to the choices */
Object.keys(result.updates).forEach(function(path){
  if(!/^recipes\/[^/]+\/choiceAdd\/og_temp\/(Hot|Iced)$/.test(path))fail('the repair writes outside the temperature choices: '+path);
});
ok('the repair only writes temperature choices - the base recipe is never overwritten');

/* the admin surface must offer the restore point before it offers the repair */
const recipesUi=fs.readFileSync('src/admin/pos/31-recipe-temperature-repair.js','utf8')+fs.readFileSync('src/admin/pos/30-recipes.js','utf8');
check(/recTempSnapshot/.test(recipesUi),'the repair screen offers a restore point download');
check(/recTempRestore/.test(recipesUi),'the repair screen offers a restore from file');
check(/recTempApply/.test(recipesUi),'the repair screen offers the repair itself');
check(/recTempSnapshotTaken/.test(recipesUi),'the repair stays locked until a restore point has been taken');
const bundle=fs.readFileSync('assets/js/admin/pos.js','utf8');
check(/recTempApply/.test(bundle),'the built admin bundle carries the repair screen');
const shell=fs.readFileSync('admin.html','utf8');
check(/recipe-temperature-plan\.js/.test(shell),'admin.html loads the shared temperature planner');
const sw=fs.readFileSync('sw.js','utf8');
check(/recipe-temperature-plan\.js/.test(sw),'the service worker caches the shared temperature planner');

console.log(failures?`\n${failures} check(s) failed.`:'\nAll temperature-repair checks passed.');
process.exit(failures?1:0);
