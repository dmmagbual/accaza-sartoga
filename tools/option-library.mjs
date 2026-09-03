#!/usr/bin/env node
/**
 * Accaza - shared option library, dry run.
 * Usage:  node tools/option-library.mjs <recipes-restore-point.json> <data-backup.json>
 * Prices every drink with every one of its choices, before and after, to prove nothing moved.
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
const Plan=load('assets/js/shared/option-library-plan.js');
const recipes=JSON.parse(fs.readFileSync(process.argv[2],'utf8')).recipes;
const data=JSON.parse(fs.readFileSync(process.argv[3],'utf8')).data;
const menuItems=data.menuItems||{},inventory=data.inventory||{},optionGroups=data.optionGroups||{};
const settings=data.posSettings||{};
const result=Plan.plan(recipes,inventory,menuItems,{optionCosts:settings.optionCosts||{}});
const after=Plan.applyTo(recipes,result);
const nm=(id)=>(inventory[id]||{}).name||id;

console.log('\nAccaza - shared option library, dry run');
console.log('definitions        :',result.summary.definitions);
console.log('copies in recipes  :',result.summary.copies);
console.log('copies removed     :',result.summary.copiesRemoved);
console.log('kept as an override:',result.summary.overridesKept);
console.log('choices that disagreed with themselves:',result.summary.disagreeing);
console.log('\nchoice                              copies agreed override  shared definition');
result.entries.slice().sort((a,b)=>b.copies-a.copies).forEach(e=>{
  console.log(`${(e.gid+' · '+e.label).slice(0,34).padEnd(36)} ${String(e.copies).padStart(5)} ${String(e.agreed).padStart(6)} ${String(e.overrides.length).padStart(8)}  ${e.rows.map(r=>nm(r.ing)+' '+r.qtyM).join(', ').slice(0,52)}`);
  if(e.overrides.length)console.log(`${''.padEnd(36)} kept its own: ${e.overrides.map(d=>d.name).join(', ').slice(0,110)}`);
});
function cost(recipeMap,costs,key,size,labels){
  return Costing.costOrder({recipes:recipeMap,menuItems,inventory,optionGroups,
    optionCosts:costs,optionRecipes:{},packagingRules:{},
    lineItems:[{itemKey:key,size,qty:1,optLabels:labels}]});
}
let checked=0,newlyCosted=0,changed=0,newlyValue=0,errored=0;
const gained={};
Object.keys(recipes).forEach(key=>{
  const item=menuItems[key];if(!item)return;
  const labels=[];
  (Array.isArray(item.options)?item.options:[]).forEach(gid=>{
    const choices=(optionGroups[gid]||{}).choices;
    if(Array.isArray(choices))choices.forEach(c=>labels.push(c.label));
  });
  ['S','M','L'].forEach(size=>{
    labels.forEach(label=>{
      const before=cost(recipes,settings.optionCosts||{},key,size,[label]);
      const now=cost(after,result.library,key,size,[label]);
      const plainBefore=cost(recipes,settings.optionCosts||{},key,size,[]).totalCost;
      checked++;
      const delta=now.totalCost-before.totalCost;
      if(now.errors.length&&!before.errors.length){errored++;console.log(`  ERROR ${item.name} ${size} [${label}] -> ${now.errors[0].code}`);return;}
      if(Math.abs(delta)<0.011)return;
      const wasFree=Math.abs(before.totalCost-plainBefore)<0.011;
      if(wasFree){newlyCosted++;newlyValue+=delta;gained[label]=(gained[label]||0)+1;}
      else changed++;
    });
  });
});
console.log('-'.repeat(72));
console.log(`priced ${checked} drink / size / choice combinations`);
console.log(`  unchanged                                  : ${checked-newlyCosted-changed-errored}`);
console.log(`  a choice that used to cost nothing now does: ${newlyCosted}   (PHP ${newlyValue.toFixed(2)} across all of them)`);
console.log(`  a choice that already cost something moved : ${changed}`);
console.log(`  the engine now refuses the combination     : ${errored}`);
console.log('\nchoices that start costing where they did not before:');
Object.entries(gained).sort((a,b)=>b[1]-a[1]).forEach(([l,n])=>console.log(`   ${String(n).padStart(4)} combinations  ${l}`));
console.log(`\nThis migration is NOT cost neutral by design: a definition in the shared library applies`);
console.log(`to every drink that offers the choice, including the ones that never had one. That is the`);
console.log(`point - and the reason it needs approving choice by choice rather than applying blind.`);
