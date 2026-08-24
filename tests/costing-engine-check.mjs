import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const root=process.cwd();
const canonical=path.join(root,'assets','js','shared','costing.js');
const mirror=path.join(root,'functions','lib','costing.js');
if(fs.readFileSync(canonical,'utf8')!==fs.readFileSync(mirror,'utf8'))throw new Error('Browser and Functions costing engines have drifted. Run node tools/sync-costing.mjs.');
const Costing=require(mirror);

function near(actual,expected,label){if(Math.abs(Number(actual)-Number(expected))>0.000001)throw new Error(`${label}: expected ${expected}, got ${actual}`);}
function equal(actual,expected,label){if(JSON.stringify(actual)!==JSON.stringify(expected))throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);}

near(Costing.convert(1,'l','ml').qty,1000,'litre to ml');
near(Costing.convert(1,'fl oz','ml').qty,29.5735,'fluid ounce to ml');
near(Costing.convert(1,'kg','g').qty,1000,'kg to g');
equal(Costing.convert(1,'oz','ml').code,'AMBIGUOUS_OZ','ambiguous ounce rejected');
equal(Costing.convert(1,'g','ml').code,'INCOMPATIBLE_UNITS','weight-to-volume rejected');

const inventory={
  beans:{name:'Beans',unit:'g',cost:0.05,ledgerVersion:1,ledgerUpdatedAt:100},
  milk:{name:'Milk',unit:'ml',cost:0.02,ledgerVersion:1,ledgerUpdatedAt:100},
  syrup:{name:'Syrup',unit:'ml',cost:0.10,ledgerVersion:1,ledgerUpdatedAt:100},
  cream:{name:'Cream',unit:'ml',cost:0.10,ledgerVersion:1,ledgerUpdatedAt:100},
};
const raw={
  base:[
    {ing:'beans',unit:'g',dispS:18,dispM:18,dispL:18},
    {ing:'milk',unit:'l',dispS:0.2,dispM:0.2,dispL:0.2},
  ],
  choiceAdd:{temp:{Hot:{label:'Hot',ings:[{ing:'cream',qtyS:10,qtyM:10,qtyL:10}]}}},
};
const normalized=Costing.normalizeRecipe(raw,inventory);
if(!normalized.ok)throw new Error('valid recipe normalization failed: '+JSON.stringify(normalized.errors));
near(normalized.recipe.base[1].qtyM,200,'recipe display quantity normalized to stock unit');
equal(normalized.recipe.schemaVersion,2,'normalized recipe schema stamp');

const result=Costing.costOrder({
  lineItems:[{itemKey:'latte',size:'M',qty:2,optLabels:['Vanilla','Hot']}],
  recipes:{latte:normalized.recipe},
  inventory,
  menuItems:{latte:{name:'Latte',options:['extras','temp']}},
  optionGroups:{extras:{choices:[{label:'Vanilla'}]},temp:{choices:[{label:'Hot'}]}},
  optionCosts:{extras:{Vanilla:{label:'Vanilla',ings:[{ing:'syrup',qtyS:5,qtyM:5,qtyL:5}]}}},
});
if(!result.ok)throw new Error('valid order costing failed: '+JSON.stringify(result.errors));
near(result.usage.beans,36,'base usage');
near(result.usage.milk,400,'converted milk usage');
near(result.usage.syrup,10,'global option usage');
near(result.usage.cream,20,'per-recipe choice usage');
near(result.totalCost,12.8,'traceable total COGS');
if(!result.lines.every(line=>line.costSource&&line.stockUnit&&Number.isFinite(line.totalCost)))throw new Error('cost trace is incomplete');
if(!result.cogsCovered)throw new Error('fully costed order marked uncovered');

const noCost=Costing.costRecipe({itemKey:'latte',recipe:normalized.recipe,inventory:{...inventory,milk:{...inventory.milk,cost:0}},item:{name:'Latte'},size:'M'});
if(noCost.cogsCovered||!noCost.warnings.some(x=>x.code==='MISSING_COST'))throw new Error('missing inventory cost was not surfaced');
const broken=Costing.normalizeRecipe({base:[{ing:'deleted',unit:'g',dispM:1}]},inventory);
if(broken.ok||!broken.errors.some(x=>x.code==='BROKEN_INVENTORY_REFERENCE'))throw new Error('broken inventory reference was not blocked');
const corrupt=Costing.costRecipe({itemKey:'bad',recipe:{base:[{ing:'beans',qtyM:'not-a-number'}]},inventory,item:{name:'Bad'},size:'M'});
if(corrupt.ok||!corrupt.errors.some(x=>x.code==='INVALID_QUANTITY'))throw new Error('corrupt stored quantity was not blocked');
const reduced=Costing.costOrder({lineItems:[{itemKey:'hot',size:'M',qty:1,optLabels:['Hot']}],recipes:{hot:{base:[{ing:'milk',qtyM:250}],choiceAdd:{temp:{Hot:{label:'Hot',ings:[{ing:'milk',qtyM:-20}]}}}}},inventory,menuItems:{hot:{name:'Hot latte',options:['temp']}},optionGroups:{temp:{choices:[{label:'Hot'}]}}});
if(!reduced.ok)throw new Error('valid negative option adjustment was rejected: '+JSON.stringify(reduced.errors));
near(reduced.usage.milk,230,'negative option adjustment reduces base usage');
near(reduced.totalCost,4.6,'negative option adjustment reduces COGS');
const belowZero=Costing.costOrder({lineItems:[{itemKey:'badAdjust',size:'M',qty:1,optLabels:['Hot']}],recipes:{badAdjust:{base:[{ing:'milk',qtyM:10}],choiceAdd:{temp:{Hot:{label:'Hot',ings:[{ing:'milk',qtyM:-20}]}}}}},inventory,menuItems:{badAdjust:{name:'Bad adjustment',options:['temp']}},optionGroups:{temp:{choices:[{label:'Hot'}]}}});
if(belowZero.ok||!belowZero.errors.some(x=>x.code==='NEGATIVE_TOTAL_USAGE'))throw new Error('option adjustment was allowed to make total usage negative');

console.log('PASS: Release 3B shared conversions, normalization, option stacking, coverage, usage, and COGS trace checks passed.');
