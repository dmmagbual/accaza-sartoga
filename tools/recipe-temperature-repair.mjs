#!/usr/bin/env node
/**
 * Accaza - temperature-option repair, dry run.
 * Usage:  node tools/recipe-temperature-repair.mjs <backup.json>
 *
 * Reads a downloaded backup, builds the repair plan, and proves - drink by drink, size by
 * size - what a customer order costs before and after. Writes nothing anywhere.
 *   plain order  : must be UNCHANGED (or lose only the ice that moved to the Iced choice)
 *   "Hot"  order : must land on the hot recipe the operator wrote, not double it
 *   "Iced" order : must land on the recipe as it stood before
 * Exit 0 = the plan is safe to apply.
 */
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const Costing=require('../functions/lib/costing.js');

const file=process.argv[2];
if(!file){console.error('Usage: node tools/recipe-temperature-repair.mjs <backup.json>');process.exit(2);}
const sandbox={module:{exports:{}},console};sandbox.globalThis=sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('assets/js/shared/recipe-temperature-plan.js','utf8'),sandbox,{filename:'recipe-temperature-plan.js'});
const Plan=sandbox.module.exports;

const envelope=JSON.parse(fs.readFileSync(file,'utf8'));
const data=envelope.data||envelope;
const recipes=data.recipes||{},menuItems=data.menuItems||{},inventory=data.inventory||{},optionGroups=data.optionGroups||{};
const result=Plan.plan(recipes,inventory,menuItems);
const after=Plan.applyToRecipes(recipes,result);
const peso=(v)=>Number(v||0).toFixed(2).padStart(8);
const name=(k)=>(menuItems[k]&&menuItems[k].name)||k;
function cost(map,key,size,labels){
  const r=Costing.costOrder({recipes:map,menuItems,inventory,optionGroups,optionCosts:{},optionRecipes:{},
    lineItems:[{itemKey:key,size,qty:1,optLabels:labels||[]}]});
  return {total:r.totalCost,errors:r.errors.length,usage:r.usage};
}
console.log(`\nAccaza - temperature-option repair, dry run`);
console.log(`backup      : ${file}`);
console.log(`recipes read: ${result.summary.examined}`);
console.log(`drinks moved: ${result.summary.changed}  (full recipe copies rewritten: ${result.summary.fullCopies}, duplicate ice removed: ${result.summary.duplicateIce})`);
console.log(`update paths: ${Object.keys(result.updates).length}`);
console.log('-'.repeat(96));
console.log('drink                          size   plain b/a            Hot b/a              Iced b/a');
let failures=0,hotSaved=0;
for(const d of result.drinks){
  for(const size of ['S','M','L']){
    const pb=cost(recipes,d.key,size,[]),pa=cost(after,d.key,size,[]);
    const hb=cost(recipes,d.key,size,['Hot']),ha=cost(after,d.key,size,['Hot']);
    const ib=cost(recipes,d.key,size,['Iced']),ia=cost(after,d.key,size,['Iced']);
    if(size==='M')hotSaved+=Math.max(0,hb.total-ha.total);
    /* invariant 1 - the plain recipe never moves; the repair only rewrites the choices */
    if(Math.abs(pa.total-pb.total)>0.011){failures++;console.log(`  !! ${name(d.key)} ${size}: plain recipe moved ${pb.total} -> ${pa.total}`);}
    /* invariant 2 - Iced lands on the base recipe when the duplicate ice is removed */
    const icedTarget=d.duplicateIce?pb.total:ib.total;
    if(Math.abs(ia.total-icedTarget)>0.011){failures++;console.log(`  !! ${name(d.key)} ${size}: iced ${ia.total} expected ${icedTarget}`);}
    /* invariant 3 - Hot lands on the hot recipe as written, never on base plus itself */
    if(d.kind==='full-copy'){
      const hotTarget=cost({[d.key]:{base:(d.before.hot||{}).ings||[]}},d.key,size,[]).total;
      if(Math.abs(ha.total-hotTarget)>0.011){failures++;console.log(`  !! ${name(d.key)} ${size}: hot ${ha.total} expected ${hotTarget}`);}
    }else if(Math.abs(ha.total-hb.total)>0.011){failures++;console.log(`  !! ${name(d.key)} ${size}: hot moved on a recipe that was already a difference`);}
    /* invariant 4 - nothing goes negative and nothing breaks */
    if(ha.errors||ia.errors||pa.errors){failures++;console.log(`  !! ${name(d.key)} ${size}: costing errors after the repair`);}
    console.log(`${name(d.key).slice(0,28).padEnd(30)} ${size}   ${peso(pb.total)}${peso(pa.total)}   ${peso(hb.total)}${peso(ha.total)}   ${peso(ib.total)}${peso(ia.total)}`);
  }
}
console.log('-'.repeat(96));
console.log(`overcharge removed from a size-M hot order, summed across drinks: PHP ${hotSaved.toFixed(2)}`);
console.log(failures?`\nFAIL - ${failures} invariant breach(es). Do not apply.`:`\nPASS - every drink lands on the recipe as written. Safe to apply.`);
process.exit(failures?1:0);
