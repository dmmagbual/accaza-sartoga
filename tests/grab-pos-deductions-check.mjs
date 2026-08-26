import fs from 'node:fs';

const source=fs.readFileSync('assets/js/admin/pos.js','utf8');
const start=source.indexOf('function platformDiscountData(gross)');
const end=source.indexOf('\n  function refreshPlat()',start);
if(start<0||end<0)throw new Error('Grab POS discount calculator was not found.');

const values={
  posPlatDiscType1:'Delivery / Pickup',posPlatDiscPct1:10,
  posPlatDiscType2:'Merchant-funded promo',posPlatDiscPct2:5,
  posPlatDiscType3:'Merchant-funded promo',posPlatDiscAmt1:20,
  posPlatDiscType4:'Delivery fee discount',posPlatDiscAmt2:30
};
const document={getElementById(id){return{value:values[id]??''};}};
const calculator=new Function('document',`var posChannel='grabfood';${source.slice(start,end)};return platformDiscountData;`)(document);
const result=calculator(1000);
function assert(ok,message){if(!ok)throw new Error(message);}

assert(result.amount===200,'Grab POS total deductions should be 200.');
assert(result.merchantPromo===70,'Grab POS merchant-funded promo should combine percent and amount rows.');
assert(result.deliveryFeeDiscount===130,'Grab POS delivery-labelled rows should map to delivery-fee discount.');
assert(result.lines.length===4&&result.lines.every(line=>line.category),'Every Grab POS deduction line needs a Finance Books category.');
const commission=Math.round((1000-result.merchantPromo)*.25*100)/100;
const net=Math.round((1000-result.amount-commission)*100)/100;
assert(commission===232.5&&net===567.5,'Grab POS commission/net estimate changed unexpectedly.');
for(const marker of ['merchantPromo:Number(pdiscounts.merchantPromo)||0','deliveryFeeDiscount:Number(pdiscounts.deliveryFeeDiscount)||0','order.platformMerchantPromo=Number(platform.merchantPromo)||0','order.platformDeliveryFeeDiscount=Number(platform.deliveryFeeDiscount)||0'])assert(source.includes(marker),`Grab POS saved-order mapping is missing: ${marker}`);

console.log('PASS: Grab POS restored discount rows calculate, classify, and save Finance Books deduction fields.');
