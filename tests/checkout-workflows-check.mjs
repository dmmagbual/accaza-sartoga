import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),F=require('../functions/lib/financial.js');
function assert(ok,message){if(!ok)throw new Error(message);}
function balanced(m,label){const t=F.totals(m.lines);assert(Math.abs(t.debit-t.credit)<.009,`${label} is unbalanced`);}
const source=fs.readFileSync('functions/index.js','utf8'),start=source.indexOf('function textField('),end=source.indexOf('async function enforceOrderRateLimit',start);
class HttpsError extends Error{constructor(code,message){super(message);this.code=code;}}
const sandbox={HttpsError,result:null};vm.runInNewContext(`${source.slice(start,end)}\nresult={priceOrderLinesServer};`,sandbox);const price=sandbox.result.priceOrderLinesServer;
const menu={coffee:{name:'Coffee',cat:'drink',priceS:100,priceM:120,priceL:140,options:['extras']},cake:{name:'Cake',cat:'pastry',priceS:80}};
const groups={extras:{name:'Extras',type:'multi',choices:[{label:'Cream',price:20},{label:'Syrup',price:15}]}};
const regular=price([{itemKey:'coffee',size:'M',optLabels:['Cream','Syrup'],qty:1}],menu,groups,{},{});assert(regular.total===155,'in-store option stack priced incorrectly');
let unavailable=false;try{price([{itemKey:'cake',qty:1}],menu,groups,{Cake:false},{});}catch(e){unavailable=e.code==='failed-precondition';}assert(unavailable,'unavailable checkout item was accepted');
const packages={pair:{name:'Coffee + Cake',type:'package',qty:2,eligibleItems:['coffee','cake'],discType:'fixed',discValue:20,extraCost:0}};
const pkg=price([{itemKey:'coffee',size:'S',qty:1,pkg:'pair',packageRole:'paid'},{itemKey:'cake',qty:1,pkg:'pair',packageRole:'paid'}],menu,groups,{},packages);assert(pkg.total===160&&pkg.packages[0].discount===20,'package checkout calculation failed');
const cash=F.orderPosting({id:'CASH-1',channel:'instore',total:155,payments:[{method:'Cash',amount:155}]},{});balanced(cash,'cash sale');assert(cash.lines.some(x=>x.account==='asset:register_cash'&&x.debit===155),'cash sale did not debit drawer');
const split=F.orderPosting({id:'SPLIT-1',channel:'instore',total:155,payments:[{method:'Cash',amount:100},{method:'GCash',amount:55}]},{gcash:{name:'GCash',feedMethods:['GCash']}});balanced(split,'split sale');assert(split.cashEntries[0].amount===55,'split GCash projection failed');
const routedAccounts={bdo:{name:'BDO'},union:{name:'Union Bank'},wallet:{name:'G-Cash'}};
const routed=F.orderPosting({id:'ROUTED-1',channel:'instore',total:175,payments:[{method:'Bank Transfer · Union Bank',paymentMethod:'Bank Transfer',receivingAccountId:'union',receivingAccountName:'Union Bank',amount:175}]},routedAccounts);balanced(routed,'receiving-account sale');assert(routed.lines.some(x=>x.account==='asset:cash_account:union'&&x.debit===175),'selected Union Bank account did not receive the sale');
const routedRefund=F.reversalPosting({id:'ROUTED-1',channel:'instore',total:175,payments:[{method:'Bank Transfer · Union Bank',paymentMethod:'Bank Transfer',receivingAccountId:'union',amount:175}]},75,'refund',routedAccounts,[{method:'Bank Transfer · Union Bank',amount:75}]);balanced(routedRefund,'receiving-account refund');assert(routedRefund.lines.some(x=>x.account==='asset:cash_account:union'&&x.credit===75),'refund did not reverse the original Union Bank account');
for(const [channel,commission,net] of [['grabfood',25,75],['foodpanda',30,70]]){const m=F.orderPosting({id:channel,channel,grossPlatform:100,commission,netPlatform:net},{});balanced(m,channel);assert(m.lines.some(x=>x.account===`asset:platform_receivable:${channel}`&&x.debit===net),`${channel} receivable failed`);}
const refund=F.reversalPosting({id:'SPLIT-1',channel:'instore',total:155,payments:[{method:'Cash',amount:100},{method:'GCash',amount:55}]},55,'refund',{gcash:{name:'GCash',feedMethods:['GCash']}},[{method:'Cash',amount:25},{method:'GCash',amount:30}]);balanced(refund,'refund');assert(refund.lines.some(x=>x.account==='asset:register_cash'&&x.credit===25),'refund cash custody failed');
const voided=F.reversalPosting({id:'VOID-1',channel:'instore',total:80,payment:'Cash'},80,'void',{});balanced(voided,'void');assert(voided.lines.some(x=>x.account==='revenue:sales_reversal'&&x.debit===80),'void did not reverse revenue');
console.log('PASS: cash, split, GrabFood, FoodPanda, unavailable, options, package, refund, and void workflows passed.');
