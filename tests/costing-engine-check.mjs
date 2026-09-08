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
  hotCup:{name:'Hot Cup',unit:'pc',cost:4,ledgerVersion:1,ledgerUpdatedAt:100},
  icedCup:{name:'Iced Cup',unit:'pc',cost:5,ledgerVersion:1,ledgerUpdatedAt:100},
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
equal(normalized.recipe.schemaVersion,3,'normalized recipe schema stamp');

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

const categoryPackaging=Costing.costOrder({
  lineItems:[{itemKey:'latte',size:'M',qty:1,optLabels:['Iced']}],recipes:{latte:normalized.recipe},inventory,
  menuItems:{latte:{name:'Latte',cat:'coffee',options:['temp']}},optionGroups:{temp:{choices:[{label:'Hot'},{label:'Iced'}]}},
  packagingRules:{hot:{rows:[{ing:'hotCup',qtyM:1}]},iced:{rows:[{ing:'icedCup',qtyM:1}]}},
  packagingAssignments:{coffee:{choices:{temp:{Hot:'hot',Iced:'iced'}}}},
});
near(categoryPackaging.usage.icedCup,1,'category and current menu choice select iced packaging inventory');
near(categoryPackaging.totalCost,9.9,'category packaging flows into total COGS');
if(!categoryPackaging.lines.some(line=>line.source==='packaging'&&line.ingredientId==='icedCup'))throw new Error('packaging COGS trace is missing');

const noCost=Costing.costRecipe({itemKey:'latte',recipe:normalized.recipe,inventory:{...inventory,milk:{...inventory.milk,cost:0}},item:{name:'Latte'},size:'M'});
if(noCost.cogsCovered||!noCost.warnings.some(x=>x.code==='MISSING_COST'))throw new Error('missing inventory cost was not surfaced');
const inherited=Costing.costRecipe({itemKey:'latte',recipe:{sharedBase:[{ing:'beans'},{ing:'milk'}],base:[{ing:'milk',qtyS:90,qtyM:120,qtyL:150}]},inventory,item:{key:'latte',name:'Latte',cat:'coffee'},size:'M',sharedBaseIngredients:{coffee:{ings:[{ing:'beans',qtyS:18,qtyM:19,qtyL:20},{ing:'milk',qtyS:120,qtyM:160,qtyL:200}]}}});
if(!inherited.ok)throw new Error('shared base recipe should cost successfully');
if(inherited.usage.beans!==19||inherited.usage.milk!==120)throw new Error('recipe-specific quantity must replace, not stack with, shared base');
if(!inherited.lines.some(line=>line.source==='base_shared'&&line.ingredientId==='beans'))throw new Error('shared source trace missing');
if(!inherited.lines.some(line=>line.source==='base_override'&&line.ingredientId==='milk'))throw new Error('override source trace missing');
const selectedReplacement=Costing.costOrder({lineItems:[{itemKey:'americano',size:'M',qty:1,optLabels:['Less Sweet']}],recipes:{americano:{base:[{ing:'milk',qtyM:20}],choiceAdd:{sweet:{'Less Sweet':{label:'Less Sweet',ings:[{ing:'milk',qtyM:15,op:'replace'}]}}}}},inventory,menuItems:{americano:{name:'Americano',options:['sweet']}},optionGroups:{sweet:{required:true,choices:[{label:'Regular'},{label:'Less Sweet'}]}}});
if(!selectedReplacement.ok||selectedReplacement.usage.milk!==15)throw new Error('required choice full quantity must replace the inherited quantity');
const regularDefault=Costing.costOrder({lineItems:[{itemKey:'americano',size:'M',qty:1,optLabels:['Regular']}],recipes:{americano:{base:[{ing:'milk',qtyM:20}],choiceAdd:{sweet:{'Less Sweet':{label:'Less Sweet',ings:[{ing:'milk',qtyM:15,op:'replace'}]}}}}},inventory,menuItems:{americano:{name:'Americano',options:['sweet']}},optionGroups:{sweet:{required:true,choices:[{label:'Regular'},{label:'Less Sweet'}]}}});
if(regularDefault.usage.milk!==20)throw new Error('unselected required-choice override changed the default quantity');
const scopedMilk={latte:{base:[{ing:'beans',qtyM:18}],choiceAdd:{milk:{'Whole Milk':{label:'Whole Milk',ings:[{ing:'milk',qtyM:295,op:'choice_override',when:{temp:'Hot'}}]}}}}};
const scopedCtx={recipes:scopedMilk,inventory,menuItems:{latte:{name:'Latte',options:['temp','milk']}},optionGroups:{temp:{required:true,choices:[{label:'Hot'},{label:'Iced'}]},milk:{required:true,choices:[{label:'Whole Milk'}]}},optionCosts:{milk:{'Whole Milk':{label:'Whole Milk',ings:[{ing:'milk',qtyM:250}]}}}};
const scopedHot=Costing.costOrder({...scopedCtx,lineItems:[{itemKey:'latte',size:'M',qty:1,optLabels:['Hot','Whole Milk']}]});
const scopedIced=Costing.costOrder({...scopedCtx,lineItems:[{itemKey:'latte',size:'M',qty:1,optLabels:['Iced','Whole Milk']}]});
if(scopedHot.usage.milk!==295||scopedIced.usage.milk!==250)throw new Error('a Hot-only shared milk override leaked into Iced');
const splitShared={...scopedCtx,recipes:{latte:{base:[{ing:'beans',qtyM:18}]}},optionCosts:{milk:{'Whole Milk':{label:'Whole Milk',ings:[{ing:'milk',qtyM:240,when:{temp:'Hot'}},{ing:'milk',qtyM:180,when:{temp:'Iced'}}]}}}};
const splitHot=Costing.costOrder({...splitShared,lineItems:[{itemKey:'latte',size:'M',qty:1,optLabels:['Hot','Whole Milk']}]}),splitIced=Costing.costOrder({...splitShared,lineItems:[{itemKey:'latte',size:'M',qty:1,optLabels:['Iced','Whole Milk']} ]});
if(splitHot.usage.milk!==240||splitIced.usage.milk!==180)throw new Error('duplicate shared-choice ingredients did not stay exclusive to Hot and Iced');
const temperatureSpecific={americano:{base:[{ing:'beans',qtyM:18}],choiceAdd:{temp:{Hot:{label:'Hot',ings:[{ing:'milk',qtyM:30}]},Iced:{label:'Iced',ings:[{ing:'milk',qtyM:12}]}}}}};
const hotSpecific=Costing.costOrder({lineItems:[{itemKey:'americano',size:'M',qty:1,optLabels:['Hot']}],recipes:temperatureSpecific,inventory,menuItems:{americano:{name:'Americano',options:['temp']}},optionGroups:{temp:{required:true,choices:[{label:'Hot'},{label:'Iced'}]}}});
const icedSpecific=Costing.costOrder({lineItems:[{itemKey:'americano',size:'M',qty:1,optLabels:['Iced']}],recipes:temperatureSpecific,inventory,menuItems:{americano:{name:'Americano',options:['temp']}},optionGroups:{temp:{required:true,choices:[{label:'Hot'},{label:'Iced'}]}}});
if(hotSpecific.usage.milk!==30||icedSpecific.usage.milk!==12)throw new Error('Hot and Iced choice-specific quantities were not isolated');
const choiceOnly={americano:{choiceAdd:{temp:{Hot:{label:'Hot',ings:[{ing:'beans',qtyM:18}]},Iced:{label:'Iced',ings:[{ing:'beans',qtyM:20},{ing:'milk',qtyM:180}]}}}}};
const choiceOnlyNormalized=Costing.normalizeRecipe(choiceOnly.americano,inventory),choiceOnlyIced=Costing.costOrder({lineItems:[{itemKey:'americano',size:'M',qty:1,optLabels:['Iced']}],recipes:choiceOnly,inventory,menuItems:{americano:{name:'Americano',options:['temp']}},optionGroups:{temp:{required:true,choices:[{label:'Hot'},{label:'Iced'}]}}});
if(!choiceOnlyNormalized.ok||choiceOnlyIced.usage.beans!==20||choiceOnlyIced.usage.milk!==180||choiceOnlyIced.totalCost<=0)throw new Error('a recipe made entirely from selected Hot or Iced ingredients was incorrectly costed as zero');
const broken=Costing.normalizeRecipe({base:[{ing:'deleted',unit:'g',dispM:1}]},inventory);
if(broken.ok||!broken.errors.some(x=>x.code==='BROKEN_INVENTORY_REFERENCE'))throw new Error('broken inventory reference was not blocked');
const zeroChoice=Costing.normalizeRecipe({base:[{ing:'bean',unit:'g',dispM:18}],choiceAdd:{og_shot:{'Add 1 Shot':{label:'Add 1 Shot',ings:[{ing:'bean',unit:'g',dispS:0,dispM:0,dispL:0}]}}}},{...inventory,bean:{name:'Coffee Beans',unit:'g',cost:0.05}});
const zeroChoiceWarning=zeroChoice.warnings.find(x=>x.code==='ZERO_QUANTITY_ROW');
if(!zeroChoiceWarning||zeroChoiceWarning.choiceLabel!=='Add 1 Shot'||zeroChoiceWarning.message!=='Coffee Beans has zero additional quantity for every size under “Add 1 Shot”.')throw new Error('zero choice quantity warning does not identify the affected menu choice');
const corrupt=Costing.costRecipe({itemKey:'bad',recipe:{base:[{ing:'beans',qtyM:'not-a-number'}]},inventory,item:{name:'Bad'},size:'M'});
if(corrupt.ok||!corrupt.errors.some(x=>x.code==='INVALID_QUANTITY'))throw new Error('corrupt stored quantity was not blocked');
const reduced=Costing.costOrder({lineItems:[{itemKey:'hot',size:'M',qty:1,optLabels:['Hot']}],recipes:{hot:{base:[{ing:'milk',qtyM:250}],choiceAdd:{temp:{Hot:{label:'Hot',ings:[{ing:'milk',qtyM:-20}]}}}}},inventory,menuItems:{hot:{name:'Hot latte',options:['temp']}},optionGroups:{temp:{choices:[{label:'Hot'}]}}});
if(!reduced.ok)throw new Error('valid negative option adjustment was rejected: '+JSON.stringify(reduced.errors));
near(reduced.usage.milk,230,'negative option adjustment reduces base usage');
near(reduced.totalCost,4.6,'negative option adjustment reduces COGS');
const belowZero=Costing.costOrder({lineItems:[{itemKey:'badAdjust',size:'M',qty:1,optLabels:['Hot']}],recipes:{badAdjust:{base:[{ing:'milk',qtyM:10}],choiceAdd:{temp:{Hot:{label:'Hot',ings:[{ing:'milk',qtyM:-20}]}}}}},inventory,menuItems:{badAdjust:{name:'Bad adjustment',options:['temp']}},optionGroups:{temp:{choices:[{label:'Hot'}]}}});
if(belowZero.ok||!belowZero.errors.some(x=>x.code==='NEGATIVE_TOTAL_USAGE'))throw new Error('option adjustment was allowed to make total usage negative');

console.log('PASS: Release 3B shared conversions, normalization, option stacking, coverage, usage, and COGS trace checks passed.');
