import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const source=fs.readFileSync(path.join(process.cwd(),'functions','index.js'),'utf8');
const start=source.indexOf('function textField(');
const end=source.indexOf('async function enforceOrderRateLimit',start);
if(start<0||end<0)throw new Error('Could not locate server pricing helpers.');
const pricingSource=source.slice(start,end);

class HttpsError extends Error{
  constructor(code,message){super(message);this.code=code;}
}
const sandbox={HttpsError,result:null};
vm.runInNewContext(`${pricingSource}\nresult={priceOrderLinesServer};`,sandbox);
const price=sandbox.result.priceOrderLinesServer;

function equal(actual,expected,label){
  if(JSON.stringify(actual)!==JSON.stringify(expected))throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function throws(fn,code,label){
  try{fn();}catch(error){if(error&&error.code===code)return;throw new Error(`${label}: wrong error ${error&&error.code}: ${error&&error.message}`);}
  throw new Error(`${label}: expected ${code}`);
}

const menu={
  coffee:{name:'Test Coffee',cat:'coffee',priceS:100,priceM:120,priceL:140,options:['extras']},
  pastry:{name:'Test Pastry',cat:'pastry',priceS:80,optionsSet:true},
};
const groups={extras:{name:'Extras',type:'multi',choices:[{label:'Cream',price:20}]}};

const regular=price([{itemKey:'coffee',size:'S',optLabels:['Cream'],qty:2,unitTotal:1}],menu,groups,{},{});
equal(regular.total,240,'server ignores forged client unit price');
equal(regular.lines[0].unitTotal,120,'server rebuilds base plus add-on price');

throws(()=>price([{itemKey:'coffee',size:'S',optLabels:['Fake add-on'],qty:1}],menu,groups,{},{}),'failed-precondition','invalid add-on rejected');
throws(()=>price([{itemKey:'coffee',size:'S',optLabels:[],qty:1}],menu,groups,{'Test Coffee':false},{}),'failed-precondition','unavailable item rejected');

const fixedPackage={bundle:{name:'Pair',type:'package',qty:2,eligibleItems:['coffee','pastry'],discType:'fixed',discValue:10,extraCost:5}};
const bundle=price([
  {itemKey:'coffee',size:'S',optLabels:[],qty:1,pkg:'bundle',packageRole:'paid'},
  {itemKey:'pastry',optLabels:[],qty:1,pkg:'bundle',packageRole:'paid'},
],menu,groups,{},fixedPackage);
equal(bundle.total,175,'fixed package discount and extra charge');
equal(bundle.packages[0].discount,10,'fixed package discount snapshot');

const promo={promo:{name:'Buy One Get One',type:'promo',qty:1,freeQty:1,eligibleItems:['coffee','pastry'],extraCost:0}};
const promoResult=price([
  {itemKey:'coffee',size:'S',optLabels:[],qty:1,pkg:'promo',packageRole:'paid'},
  {itemKey:'pastry',optLabels:[],qty:1,pkg:'promo',packageRole:'free'},
],menu,groups,{},promo);
equal(promoResult.total,100,'promotion charges paid item only');
equal(promoResult.lines[1].unitTotal,0,'promotion free line is zero');

console.log('PASS: server pricing rejects forged/invalid lines and correctly prices add-ons and packages.');
