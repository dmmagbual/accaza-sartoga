import fs from 'node:fs';
import path from 'node:path';
import {BUDGET_WARN_ROOM,BUNDLE_BUDGETS,BUNDLE_HARD_RESERVES,budgetState,isHardLimited,usableBudget} from '../tests/bundle-budgets.mjs';

const root=process.cwd();
const bundles=[
  {source:'src/admin/pos',target:'assets/js/admin/pos.js'},
  {source:'src/admin/register',target:'assets/js/admin/register.js'},
  {source:'src/admin/rewards',target:'assets/js/admin/rewards.js'},
  {source:'src/admin/analytics',target:'assets/js/admin/analytics.js'},
  {source:'src/admin/finance',target:'assets/js/admin/finance.js'},
  {source:'src/customer/core',target:'assets/js/customer/core.mjs'},
  {source:'src/books/app',target:'assets/js/books/app.js',exclude:['40-subledgers.js','50-controlled-transactions.js','55-payable-batch.js']},
  {source:'src/books/app',target:'assets/js/books/subledgers.js',include:['40-subledgers.js','55-payable-batch.js']},
  {source:'src/books/app',target:'assets/js/books/controlled-transactions.js',include:['50-controlled-transactions.js']},
  {source:'src/functions',target:'functions/index.js'}
];

for(const bundle of bundles){
  const sourceDir=path.join(root,bundle.source);
  const files=fs.readdirSync(sourceDir).filter(name=>/\.m?js$/.test(name)&&(!bundle.include||bundle.include.includes(name))&&(!bundle.exclude||!bundle.exclude.includes(name))).sort();
  if(!files.length)throw new Error(`No source sections found in ${bundle.source}`);
  const output=files.map(name=>fs.readFileSync(path.join(sourceDir,name),'utf8')).join('');
  fs.writeFileSync(path.join(root,bundle.target),output);
  console.log(`Built ${bundle.target} from ${files.length} ordered sections.`);
}

// Operations Center reads this local build artifact; it never calls Firebase for byte health.
// Derive every threshold from the same policy used by CI so the visible card cannot drift.
const posFile='assets/js/admin/pos.js';
const posEnvelope=BUNDLE_BUDGETS[posFile];
const posReserve=BUNDLE_HARD_RESERVES[posFile]||0;
const posLimit=usableBudget(posEnvelope,posReserve);
const posWarning=Math.round(posLimit*(1-BUDGET_WARN_ROOM));
const posBytes=fs.statSync(path.join(root,posFile)).size;
// Release capacity (15 Oct 2026): every other guarded file, as a gauge. Only files near or past their
// review ceiling are listed; the rest are counted. Deterministic (no timestamps) so rebuilds match.
const releaseRows=Object.entries(BUNDLE_BUDGETS).filter(([file])=>!isHardLimited(file)&&fs.existsSync(path.join(root,file))).map(([file,ceiling])=>{
  const bytes=fs.statSync(path.join(root,file)).size,state=budgetState(bytes,ceiling);
  return {file,bytes,ceiling,pct:Math.round(1000*bytes/ceiling)/10,state:state==='fail'?'over':state};
});
const releaseWatch=releaseRows.filter(row=>row.state!=='ok').sort((a,b)=>b.pct-a.pct||(a.file<b.file?-1:1)).map(({file,bytes,ceiling,pct,state})=>({file,bytes,ceiling,pct,state}));
const releaseCapacity=JSON.stringify({total:releaseRows.length,healthy:releaseRows.length-releaseWatch.length,warnRoom:BUDGET_WARN_ROOM,files:releaseWatch});
const posCapacity=`(function(global){\n  'use strict';\n  global.AccazaPosCapacity=Object.freeze({bytes:${posBytes},warning:${posWarning},limit:${posLimit},reserve:${posReserve},envelope:${posEnvelope}});\n  global.AccazaReleaseCapacity=Object.freeze(${releaseCapacity});\n})(window);\n`;
fs.writeFileSync(path.join(root,'assets/js/admin/pos-capacity.js'),posCapacity);
console.log(`Built assets/js/admin/pos-capacity.js from ${posFile} (${posBytes} bytes); release capacity lists ${releaseWatch.length} of ${releaseRows.length} files.`);
