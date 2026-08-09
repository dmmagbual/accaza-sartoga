import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const F=require('../functions/lib/financial.js');
function assert(ok,message){if(!ok)throw new Error(message);}
function balanced(m,label){const t=F.totals(m.lines);assert(Math.abs(t.debit-t.credit)<0.009,`${label} is unbalanced: ${JSON.stringify(t)}`);}

const accounts={gcash:{name:'GCash',feedMethods:['GCash']}};
const split=F.orderPosting({id:'O1',channel:'instore',total:100,payments:[{method:'Cash',amount:60},{method:'GCash',amount:40}]},accounts);
balanced(split,'split sale');
assert(split.cashEntries.length===1&&split.cashEntries[0].accountId==='gcash'&&split.cashEntries[0].amount===40,'split non-cash projection is wrong');
assert(split.lines.some(x=>x.account==='asset:register_cash'&&x.debit===60),'split cash asset is missing');

const platform=F.orderPosting({id:'GF1',channel:'grabfood',grossPlatform:100,commission:25,platformDiscount:5,platformWht:2,platformVat:3,netPlatform:65},{});
balanced(platform,'platform sale');
assert(platform.lines.some(x=>x.account==='asset:platform_receivable:grabfood'&&x.debit===65),'platform receivable is wrong');
assert(platform.lines.some(x=>x.account==='revenue:sales'&&x.credit===100),'platform gross revenue is wrong');

const refund=F.reversalPosting({id:'O2',channel:'instore',payment:'GCash',total:80},30,'refund',accounts);
balanced(refund,'refund');
assert(refund.cashEntries.length===1&&refund.cashEntries[0].dir==='out'&&refund.cashEntries[0].amount===30,'non-cash refund projection is wrong');
const splitRefund=F.reversalPosting({id:'O3',channel:'instore',total:100,payments:[{method:'Cash',amount:60},{method:'GCash',amount:40}]},30,'refund',accounts,[{method:'Cash',amount:20},{method:'GCash',amount:10}]);
balanced(splitRefund,'split-tender refund');
assert(splitRefund.lines.some(x=>x.account==='asset:register_cash'&&x.credit===20),'actual cash refund tender is wrong');
assert(splitRefund.cashEntries.length===1&&splitRefund.cashEntries[0].amount===10,'actual GCash refund tender is wrong');
let badTender=false;try{F.reversalPosting({id:'O4',channel:'instore',payment:'Cash',total:50},30,'refund',accounts,[{method:'Cash',amount:20}]);}catch(_e){badTender=true;}assert(badTender,'mismatched refund tender allocation was accepted');

const transfer=F.movement('cash_transfer','transfer','T1',[F.line('asset:to',50,0,'in'),F.line('asset:from',0,50,'out')]);
balanced(transfer,'transfer');
let rejected=false;try{F.movement('bad','test','B1',[F.line('asset:x',10,0,'bad')]);}catch(_e){rejected=true;}assert(rejected,'unbalanced movement was accepted');

console.log('PASS: Release 3C/3D split sale, platform receivable, actual refund tenders, transfer, and balancing checks passed.');
