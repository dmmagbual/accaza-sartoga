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
const mappedGrab=F.orderPosting({id:'GF-MAPPED',channel:'grabfood',grossPlatform:200,commission:40,platformDiscount:35,platformMerchantPromo:25,platformDeliveryFeeDiscount:10,netPlatform:125},{});
balanced(mappedGrab,'mapped Grab deductions');
assert(mappedGrab.lines.some(x=>x.account==='expense:platform_merchant_funded_promo'&&x.debit===25),'merchant-funded promo was not posted separately');
assert(mappedGrab.lines.some(x=>x.account==='expense:platform_delivery_fee_discount'&&x.debit===10),'delivery fee discount was not posted separately');
assert(!mappedGrab.lines.some(x=>x.account==='expense:platform_discount'),'mapped Grab deductions were also posted to the legacy discount account');
const mappedGrabCorrection=F.postingDifference(mappedGrab,F.orderPosting({id:'GF-MAPPED',channel:'grabfood',grossPlatform:200,commission:38,platformDiscount:40,platformMerchantPromo:28,platformDeliveryFeeDiscount:12,netPlatform:122},{}),'platform_presettlement_correction','GF-MAPPED','Pre-settlement correction');
balanced(mappedGrabCorrection,'mapped Grab correction');
assert(mappedGrabCorrection.lines.some(x=>x.account==='expense:platform_commission'&&x.credit===2),'commission-only correction was not preserved');
assert(mappedGrabCorrection.lines.some(x=>x.account==='expense:platform_merchant_funded_promo'&&x.debit===3),'merchant promo correction was not preserved');
assert(mappedGrabCorrection.lines.some(x=>x.account==='expense:platform_delivery_fee_discount'&&x.debit===2),'delivery fee correction was not preserved');
assert(mappedGrabCorrection.lines.some(x=>x.account==='asset:platform_receivable:grabfood'&&x.credit===3),'corrected expected net did not update the Grab receivable');
const mappedGrabVoid=F.netMovementCorrection([mappedGrab],'GF-MAPPED','order_void','Fully reverse mapped Grab order');
balanced(mappedGrabVoid,'mapped Grab void');
for(const account of ['revenue:sales','expense:platform_commission','expense:platform_merchant_funded_promo','expense:platform_delivery_fee_discount','asset:platform_receivable:grabfood'])assert(mappedGrabVoid.lines.some(x=>x.account===account),`mapped Grab void did not reverse ${account}`);
const grabSettlement=F.movement('platform_payout_settlement','platformPayout','GRAB-PAYOUT-1',[
  F.line('asset:platform_clearing:grabfood',100,0,'Actual payout clearing'),
  F.line('expense:platform_variance:va_marketing_success',15,0,'Grab marketing success fee'),
  F.line('expense:platform_variance:va_ads',10,0,'Grab advertisements'),
  F.line('asset:platform_receivable:grabfood',0,125,'Settle platform receivable')
],{approvalId:'APPROVAL-1'});
balanced(grabSettlement,'Grab statement-only deductions');
const grabSettlementReversal=F.reverseMovement(Object.assign({id:'payout_GRAB-PAYOUT-1'},grabSettlement),'platform_payout_reversal','Reverse Grab payout');
balanced(grabSettlementReversal,'Grab settlement reversal');
for(const account of ['expense:platform_variance:va_marketing_success','expense:platform_variance:va_ads'])assert(grabSettlementReversal.lines.some(x=>x.account===account&&x.credit>0),`Grab settlement reversal did not reverse ${account}`);
const grabRefundRecovery=F.movement('platform_payout_settlement','platformPayout','GRAB-PAYOUT-RECOVERY',[
  F.line('asset:platform_clearing:grabfood',145,0,'Actual payout clearing'),
  F.line('asset:platform_receivable:grabfood',0,125,'Settle platform receivable'),
  F.line('revenue:platform_variance:va_refund_recovery',0,20,'Grab refund recovery / reversal · GF-521')
]);
balanced(grabRefundRecovery,'positive Grab refund recovery');
const grabRefundRecoveryReversal=F.reverseMovement(Object.assign({id:'payout_GRAB-PAYOUT-RECOVERY'},grabRefundRecovery),'platform_payout_reversal','Reverse Grab payout');
balanced(grabRefundRecoveryReversal,'positive Grab refund recovery reversal');
assert(grabRefundRecoveryReversal.lines.some(x=>x.account==='revenue:platform_variance:va_refund_recovery'&&x.debit===20&&x.label.includes('GF-521')),'Grab refund recovery reversal lost its amount or source reference');

const cashPaymentCorrection=F.movement('petty_cash_payment_correction','pettyVoucher','pv_test',[
  F.line('asset:cash_awaiting_deposit',49,0,'Reverse previous cash payment'),
  F.line('asset:purchase_cash_advance:pv_test',0,49,'Reverse supplier payment'),
  F.line('asset:purchase_cash_advance:pv_test',65,0,'Corrected supplier payment'),
  F.line('asset:cash_awaiting_deposit',0,65,'Corrected cash payment')
]);
balanced(cashPaymentCorrection,'approved cash-payment correction');
assert(cashPaymentCorrection.lines.filter(x=>x.account==='asset:purchase_cash_advance:pv_test').reduce((sum,x)=>sum+x.debit-x.credit,0)===16,'Cash-payment correction did not preserve the net supplier-payment change');
const undepositedOpening=F.movement('undeposited_opening_balance','cashCustody','undeposited_opening_balance',[F.line('asset:cash_awaiting_deposit',500,0,'Undeposited Collection beginning balance'),F.line('equity:opening_balance',0,500,'Opening balance source')]);
balanced(undepositedOpening,'Undeposited Collection beginning balance');

const online=F.orderPosting({id:'WEB1',source:'online',channel:'online',total:125,payment:'GCash',payments:[{method:'GCash',amount:125}]},accounts);
balanced(online,'online order');
assert(online.lines.some(x=>x.account==='asset:cash_account:gcash'&&x.debit===125),'online payment did not debit the mapped cash account');
assert(!online.lines.some(x=>x.account.indexOf('asset:platform_receivable:')===0),'online order was incorrectly treated as a platform receivable');
assert(online.lines.some(x=>x.account==='revenue:sales'&&x.label==='Online order gross sales'),'online revenue is not identified separately');
const discounted=F.orderPosting({id:'DISC1',channel:'instore',subtotal:125,total:100,discount:25,payment:'Cash'},accounts);
balanced(discounted,'discounted in-store sale');
assert(discounted.lines.some(x=>x.account==='revenue:sales'&&x.credit===125),'discounted sale did not recognize gross revenue');
assert(discounted.lines.some(x=>x.account==='expense:customer_discount'&&x.debit===25),'discounted sale did not classify the customer discount');

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
const discountedPlatform=F.orderPosting({id:'GFVOID',channel:'grabfood',grossPlatform:200,commission:40,platformDiscount:20,netPlatform:140},{});discountedPlatform.sourceId='GFVOID';
const correctedPlatform=F.postingDifference(F.orderPosting({id:'GFCORRECT',channel:'grabfood',grossPlatform:775,commission:193.75,netPlatform:581.25},{}),F.orderPosting({id:'GFCORRECT',channel:'grabfood',grossPlatform:525,commission:131.25,netPlatform:393.75},{}),'platform_presettlement_correction','GFCORRECT','Pre-settlement correction');
balanced(correctedPlatform,'platform pre-settlement correction');
assert(correctedPlatform.lines.some(x=>x.account==='revenue:sales'&&x.debit===250),'gross correction does not reduce sales by 250');
assert(correctedPlatform.lines.some(x=>x.account==='asset:platform_receivable:grabfood'&&x.credit===187.5),'gross correction does not reduce Grab receivable correctly');
assert(correctedPlatform.lines.some(x=>x.account==='expense:platform_commission'&&x.credit===62.5),'commission correction is not reversed correctly');
const fullVoid=F.netMovementCorrection([discountedPlatform],'GFVOID','order_void','Fully reverse voided order');
balanced(fullVoid,'full platform void');
const fullyVoided=[discountedPlatform,fullVoid];
for(const account of ['revenue:sales','expense:platform_discount','expense:platform_commission','asset:platform_receivable:grabfood'])assert(F.netMovementCorrection(fullyVoided,'GFVOID','test','Check full void')===null,`full void left a balance in ${account}`);

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
