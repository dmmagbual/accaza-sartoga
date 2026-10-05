// Every runtime script of meaningful size carries a byte ceiling (Oct 2026). Before this, a
// feature could avoid the budget review by living in a new or unbudgeted file (rewards.js grew
// to 89.5 KB with no ceiling), and code split out of a guarded bundle escaped review entirely.
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {BUNDLE_BUDGETS,BUDGET_COVERAGE_MIN_BYTES,SPLIT_MODULES} from './bundle-budgets.mjs';
const fail=message=>{throw new Error(message);};
let tracked;
try{tracked=execFileSync('git',['ls-files','assets/js'],{encoding:'utf8'}).split('\n').filter(Boolean);}
catch{tracked=[];const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).forEach(e=>{const p=`${dir}/${e.name}`;if(e.isDirectory())walk(p);else tracked.push(p);});walk('assets/js');}
const scripts=tracked.filter(file=>/\.m?js$/.test(file)&&fs.existsSync(file));
const missing=scripts.filter(file=>fs.statSync(file).size>=BUDGET_COVERAGE_MIN_BYTES&&!Object.hasOwn(BUNDLE_BUDGETS,file));
if(missing.length)fail(`Runtime scripts of ${BUDGET_COVERAGE_MIN_BYTES} bytes or more need a ceiling in tests/bundle-budgets.mjs: ${missing.join(', ')}`);
for(const file of SPLIT_MODULES)if(!Object.hasOwn(BUNDLE_BUDGETS,file))fail(`${file} was split out of a guarded bundle and must keep its own ceiling`);
for(const file of Object.keys(BUNDLE_BUDGETS))if(!fs.existsSync(file))fail(`${file} has a ceiling but no longer exists; remove it from tests/bundle-budgets.mjs`);
console.log(`PASS: checked ${scripts.length} runtime scripts; every one of ${BUDGET_COVERAGE_MIN_BYTES} bytes or more, and every split-out module, carries a byte ceiling (${Object.keys(BUNDLE_BUDGETS).length} ceilings).`);
