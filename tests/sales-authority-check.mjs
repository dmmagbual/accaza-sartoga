import fs from 'node:fs';
import vm from 'node:vm';

const context={window:{}};
vm.runInNewContext(fs.readFileSync(new URL('../assets/js/shared/sales-authority.js',import.meta.url),'utf8'),context);
const S=context.window.AccazaSales;
function assert(ok,message){if(!ok)throw new Error(message);}

assert(S.qualifies({status:'Completed',paymentStatus:'confirmed'}),'confirmed completed sale was excluded');
assert(S.qualifies({source:'online',channel:'online',status:'Completed',paymentStatus:'confirmed'}),'confirmed online sale was excluded');
assert(S.qualifies({status:'Archived',prevStatus:'Received',paymentStatus:'confirmed'}),'archived received sale was excluded');
assert(!S.qualifies({source:'pos',status:'Completed',paymentStatus:'pending'}),'pending POS sale was recognized');
assert(!S.qualifies({source:'pos',status:'Completed',paymentStatus:'confirmed',voided:true}),'voided POS sale was recognized');
assert(!S.qualifies({source:'pos',status:'Cancelled',paymentStatus:'confirmed'}),'cancelled POS sale was recognized');
const values=S.amounts({subtotal:1000,discount:125,refundAmount:25,total:875});
assert(values.gross===1000&&values.discount===125&&values.refund===25&&values.net===850,'authoritative sales amounts are wrong');
const grab=S.amounts({channel:'grabfood',grossPlatform:725,subtotal:725,total:725,discount:0,platformDiscount:126.25,netSalesPlatform:598.75,commission:108.75,platformAdsMarketing:20,netPlatform:470});
assert(grab.gross===725&&grab.discount===126.25&&grab.net===598.75,'Grab net sales must subtract customer-related platform discounts but not commission or payout charges');
assert(S.stamp({completedAt:3,receivedAt:2,timestamp:1})===3,'completed timestamp is not authoritative');

console.log('PASS: shared Admin sales authority enforces status, payment, void, amount, and timestamp rules.');
