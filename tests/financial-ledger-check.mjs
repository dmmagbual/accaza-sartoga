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
const discounted=F.orderPosting({id:'DISC1',channel:'instore',subtotal:125,total:100,discount:25,payment:'Cash'},accounts);
balanced(discounted,'discounted sale');
assert(discounted.lines.some(x=>x.account==='revenue:sales'&&x.credit===125),'discounted sale did not preserve gross revenue');
assert(discounted.lines.some(x=>x.account==='expense:customer_discount'&&x.debit===25),'customer discount was not classified separately');
assert(discounted.lines.some(x=>x.account==='asset:register_cash'&&x.debit===100),'discount changed cash received');
const discountCorrection=F.discountClassificationPosting({id:'OLD1',channel:'instore',discount:25});
balanced(discountCorrection,'historical discount classification');
assert(F.totals(discountCorrection.lines).debit===25&&F.totals(discountCorrection.lines).credit===25,'historical discount classification changed net sales');

const platform=F.orderPosting({id:'GF1',channel:'grabfood',grossPlatform:100,commission:25,platformDiscount:5,platformWht:2,platformVat:3,netPlatform:65},{});
balanced(platform,'platform sale');
assert(platform.lines.some(x=>x.account==='asset:platform_receivable:grabfood'&&x.debit===65),'platform receivable is wrong');
assert(platform.lines.some(x=>x.account==='revenue:sales'&&x.credit===100),'platform gross revenue is wrong');

const online=F.orderPosting({id:'WEB1',source:'online',channel:'online',total:125,payment:'GCash',payments:[{method:'GCash',amount:125}]},accounts);
balanced(online,'online order');
assert(online.lines.some(x=>x.account==='asset:cash_account:gcash'&&x.debit===125),'online payment did not debit the mapped cash account');
assert(!online.lines.some(x=>x.account.indexOf('asset:platform_receivable:')===0),'online order was incorrectly treated as a platform receivable');
assert(online.lines.some(x=>x.account==='revenue:sales'&&x.label==='Online order sales'),'online revenue is not identified separately');

const orphanOriginal=F.orderPosting({id:'ORPHAN1',channel:'instore',total:995,payment:'Cash'},accounts);
orphanOriginal.id='sale_ORPHAN1';orphanOriginal.occurredAt=12345;
const orphanReverse=F.reverseMovement(orphanOriginal,'orphan_order_reversal','Reverse orphaned sale');
balanced(orphanReverse,'orphan reversal');
assert(orphanReverse.lines.some(x=>x.account==='revenue:sales'&&x.debit===995),'orphan reversal does not reverse sales revenue');
assert(orphanReverse.lines.some(x=>x.account==='asset:register_cash'&&x.credit===995),'orphan reversal does not reverse the original asset');
assert(orphanReverse.reversesMovementId==='sale_ORPHAN1'&&orphanReverse.occurredAt===12345,'orphan reversal does not retain source evidence');
const validVoid=F.reverseMovement(orphanOriginal,'order_void','Void sale');validVoid.sourceId='ORPHAN1';
assert(F.netMovementCorrection([orphanOriginal,validVoid],'ORPHAN1','orphan_order_reversal','Correct orphan')===null,'already-voided orphan was reversed twice');
const orphanBalanceFix=F.netMovementCorrection([orphanOriginal],'ORPHAN1','orphan_order_reversal','Correct orphan');
balanced(orphanBalanceFix,'orphan net-balance reversal');
assert(orphanBalanceFix.lines.some(x=>x.account==='revenue:sales'&&x.debit===995),'sale-only orphan net balance was not reversed');
const duplicateOrphanReversal=F.reverseMovement(orphanOriginal,'orphan_order_reversal','Old orphan reversal');duplicateOrphanReversal.sourceId='ORPHAN1';
const duplicateFix=F.netMovementCorrection([orphanOriginal,validVoid,duplicateOrphanReversal],'ORPHAN1','orphan_order_reversal','Correct duplicate reversal');
balanced(duplicateFix,'duplicate orphan correction');
assert(duplicateFix.lines.some(x=>x.account==='revenue:sales'&&x.credit===995),'double-reversed orphan was not restored');

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

console.log('PASS: Release 3C/3D split sale, online direct payment, platform receivable, actual refund tenders, transfer, and balancing checks passed.');
