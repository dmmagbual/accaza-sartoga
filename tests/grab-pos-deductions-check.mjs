import fs from 'node:fs';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const F=require('../functions/lib/financial.js');
const source=fs.readFileSync('assets/js/admin/pos.js','utf8');
const start=source.indexOf('function platDiscDefs(ch)');
const end=source.indexOf('\n  function refreshPlat()',start);
if(start<0||end<0)throw new Error('Platform POS discount calculator was not found.');
function assert(ok,message){if(!ok)throw new Error(message);}
function calculatorFor(channel,values){
  const document={getElementById(id){return{value:values[id]??''};}};
  return new Function('document',`var posChannel='${channel}';${source.slice(start,end)};return platformDiscountData;`)(document);
}

// GrabFood: unchanged behaviour (2 percent + 2 amount rows; commission on gross less merchant-funded promo).
const grab=calculatorFor('grabfood',{
  posPlatDiscType1:'Delivery / Pickup',posPlatDiscPct1:10,
  posPlatDiscType2:'Merchant-funded promo',posPlatDiscPct2:5,
  posPlatDiscType3:'Merchant-funded promo',posPlatDiscAmt1:20,
  posPlatDiscType4:'Delivery fee discount',posPlatDiscAmt2:30
})(1000);
assert(grab.amount===200,'Grab POS total deductions should be 200.');
assert(grab.merchantPromo===70,'Grab POS merchant-funded promo should combine percent and amount rows.');
assert(grab.deliveryFeeDiscount===130,'Grab POS delivery-labelled rows should map to delivery-fee discount.');
assert(grab.lines.length===4&&grab.lines.every(line=>line.category),'Every Grab POS deduction line needs a Finance Books category.');
const commission=Math.round((1000-grab.merchantPromo)*.25*100)/100;
const net=Math.round((1000-grab.amount-commission)*100)/100;
assert(commission===232.5&&net===567.5,'Grab POS commission/net estimate changed unexpectedly.');

// FoodPanda: 1 percent row (Delivery / Pickup) + 3 open amount rows, classified with the Grab rule.
// Grab-only input ids are populated too, to prove a GrabFood draft cannot leak into a FoodPanda order.
const fp=calculatorFor('foodpanda',{
  posPlatDiscPct1:50,posPlatDiscAmt1:99,
  posFpDiscType1:'Delivery / Pickup',posFpDiscPct1:10,
  posFpDiscType2:'Store voucher',posFpDiscAmt1:20,
  posFpDiscType3:'Delivery fee subsidy',posFpDiscAmt2:15,
  posFpDiscType4:'',posFpDiscAmt3:0
})(1000);
assert(fp.amount===135,'FoodPanda POS total deductions should be 135 (10% of 1000 + 20 + 15).');
assert(fp.lines.length===3,'FoodPanda POS should ignore empty rows and GrabFood inputs.');
assert(fp.lines[0].type==='Delivery / Pickup'&&fp.lines[0].mode==='percent'&&fp.lines[0].amount===100&&fp.lines[0].category==='delivery_fee_discount','FoodPanda Delivery / Pickup row must be a percent of gross tagged like Grab.');
assert(fp.lines.slice(1).every(line=>line.mode==='amount'),'FoodPanda rows 2-4 must be peso amounts.');
assert(fp.merchantPromo===20&&fp.deliveryFeeDiscount===115,'FoodPanda open rows must follow the Grab label rule.');
const fpBlank=calculatorFor('foodpanda',{posFpDiscPct1:5,posFpDiscType2:'',posFpDiscAmt1:12})(200);
assert(fpBlank.lines[0].type==='Percentage discount','FoodPanda blank-label fallback should be named.');
assert(fpBlank.lines[1].type==='Amount discount 1'&&fpBlank.lines[1].category==='merchant_funded_promo','FoodPanda unlabelled amount rows default to merchant-funded promo.');

// Commission, WHT and VAT stay on gross for FoodPanda; only GrabFood commission uses gross less merchant promo.
for(const marker of [
  "var commBase=(posChannel==='grabfood')?r2(gross-(Number(discounts.merchantPromo)||0)):gross;",
  "var wht=r2(gross*whtR); var vat=r2(gross*vatR);",
  "var pcommBase=(posChannel==='grabfood')?_r2(tot-(Number(pdiscounts.merchantPromo)||0)):tot;",
  "pwht=_r2(tot*pwhtR), pvat=_r2(tot*pvatR);",
  'merchantPromo:Number(pdiscounts.merchantPromo)||0','deliveryFeeDiscount:Number(pdiscounts.deliveryFeeDiscount)||0',
  'order.platformMerchantPromo=Number(platform.merchantPromo)||0','order.platformDeliveryFeeDiscount=Number(platform.deliveryFeeDiscount)||0'
])assert(source.includes(marker),`Platform POS mapping is missing: ${marker}`);
assert(!source.includes("val('posPlatDisc')"),'The old single FoodPanda percent field must be gone.');

// Finance Books: a FoodPanda order from the new card posts classified discounts, never the legacy/unclassified expense.
const gross=1000,comm=250,disc=fp.amount;
const posting=F.orderPosting({id:'FP-T1',status:'Completed',channel:'foodpanda',grossPlatform:gross,subtotal:gross,total:gross-disc,
  platformDiscount:disc,platformMerchantPromo:fp.merchantPromo,platformDeliveryFeeDiscount:fp.deliveryFeeDiscount,
  netSalesPlatform:gross-disc,commission:comm,platformWht:0,platformVat:0,netPlatform:gross-comm-disc},{},{});
const text=JSON.stringify(posting);
assert(!/Legacy\/unclassified/.test(text),'FoodPanda discounts must not post to the legacy/unclassified platform discount expense.');
assert(/Merchant-funded promo/.test(text)&&/Delivery fee discount/.test(text),'FoodPanda discounts must post as merchant promo and delivery fee discount.');

console.log('PASS: GrabFood and FoodPanda POS discount cards calculate, classify (Grab label rule), keep FoodPanda commission/WHT/VAT on gross, and post classified Finance Books deductions.');
