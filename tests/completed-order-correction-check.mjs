import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';

const require=createRequire(import.meta.url),Correction=require('../functions/lib/order-correction'),Financial=require('../functions/lib/financial');
const base={id:'POS-COFFEE1',total:1000,paymentStatus:'cashier_verified',payments:[{method:'GCash · GCash',paymentMethod:'GCash',amount:1000,ref:'GC-1000'}],lineItems:[{itemKey:'spanish',size:'L',qty:2,unitTotal:250}],cogsAccountSnapshot:{'1210|5010':300}};

assert.equal(Correction.paymentKind(base),'gcash');
assert.equal(Correction.paymentKind({...base,payments:[{method:'Bank Transfer · BDO',paymentMethod:'Bank Transfer',amount:1000,ref:'BDO-1'}]}),'bank_transfer');
assert.equal(Correction.paymentKind({...base,payments:[{method:'PayMaya',amount:1000,ref:'M-1'}]}),'maya');
assert.equal(Correction.paymentKind({...base,payments:[{method:'E-Wallet · G-Cash',paymentMethod:'E-Wallet',receivingAccountId:'wallet',amount:1000,ref:'EW-1'}]},{wallet:{name:'G-Cash',type:'ewallet'}}),'ewallet');
assert.equal(Correction.paymentKind({...base,payments:[{method:'Card',paymentMethod:'Card',receivingAccountId:'unknown',amount:1000,ref:'C-1'}]},{}),'');
assert.equal(Correction.paymentKind({...base,payments:[{method:'GCash',amount:850},{method:'Cash',amount:150}]}),'');

const plan={totalCost:240,accountSnapshot:{'1210|5010':220,'1220|5030':20}};
const movement=Correction.movement(base,plan,150,{});
assert.equal(movement.type,'completed_order_item_correction');
assert.deepEqual(Financial.totals(movement.lines),{debit:250,credit:250});
assert(movement.lines.some(line=>line.account==='revenue:sales_reversal'&&line.debit===150));
assert(movement.lines.some(line=>line.account==='asset:register_cash'&&line.credit===150));
assert(movement.lines.some(line=>line.account==='coa:1210'&&line.debit===80));
assert(movement.lines.some(line=>line.account==='coa:5010'&&line.credit===80));
assert(movement.lines.some(line=>line.account==='coa:5030'&&line.debit===20));
assert(movement.lines.some(line=>line.account==='coa:1220'&&line.credit===20));

assert.equal(Correction.currentLines({...base,correctedLineItems:[{itemKey:'americano'}]})[0].itemKey,'americano');
const adjustments=fs.readFileSync('src/functions/43g-order-adjustments.js','utf8'),inventory=fs.readFileSync('src/functions/50-inventory.js','utf8'),rules=fs.readFileSync('database.rules.json','utf8'),shiftOrders=fs.readFileSync('src/admin/pos/50a-register-shell.js','utf8');
assert(adjustments.includes('correctedInventoryUsage:correctedMeta.inventoryUsage'));
assert(adjustments.includes('correctionInventoryToken:token'));
for(const marker of ['claimManagerApproval(db,data,"correct_completed_order"','"completed_order_cash_refund"','actor.uid','correctionApprovalId','cashRefundApprovalId','approvalMode:"independent_manager"','correctionInitiatedByStaff','initiatedByStaff'])assert(adjustments.includes(marker),`completed correction approval safeguard missing: ${marker}`);
assert(inventory.includes('order.completedOrderCorrectionId && order.correctedInventoryUsage'));
assert(inventory.includes('`crs_${order.correctionInventoryToken}_${itemId}`'));
assert(rules.includes('"orderCorrectionCommands": { ".read": false, ".write": false }'));
assert(rules.includes('"orderCorrections": { ".read": false, ".write": false }'));
const completedCard=(shiftOrders.match(/function completedCard\(o\)\{([\s\S]*?)function exceptionCard/)||[])[1]||'';
assert(completedCard,'completed-sale card renderer must remain covered');
assert(!completedCard.includes('Start preparing'),'completed sales must not expose a start-preparing action');
assert(!completedCard.includes('Not prepared'),'completed sales must not be relabelled as not prepared');
assert(completedCard.includes('data-completed-correction'),'eligible completed-sale correction remains available');
const persistence=fs.readFileSync('src/admin/pos/50f-sale-persistence.js','utf8'),helper=(persistence.match(/function completedCorrectionPaymentKind\(o\)\{[\s\S]*?\n\}/)||[])[0];
const context={paymentAccountsMap:{wallet:{name:'G-Cash',type:'ewallet'},bank:{name:'BDO',type:'bank'}},result:null};vm.createContext(context);vm.runInContext(`${helper};result=completedCorrectionPaymentKind;`,context);
assert.equal(context.result({payments:[{method:'E-Wallet · G-Cash',paymentMethod:'E-Wallet',receivingAccountId:'wallet',receivingAccountName:'G-Cash'}]}),'G-Cash');
assert.equal(context.result({payments:[{method:'Bank Transfer · BDO',paymentMethod:'Bank Transfer',receivingAccountId:'bank'}]}),'Bank Transfer · BDO');
for(const marker of ["managerApproval('correct_completed_order'","managerApproval('completed_order_cash_refund'",'requireIndependent:true','refundApprovalId'])assert(persistence.includes(marker),`POS independent approval flow missing: ${marker}`);
const shiftReview=fs.readFileSync('src/admin/register/60-operations-shift-review.js','utf8'),registerBootstrap=fs.readFileSync('src/admin/register/00-bootstrap-payment-controls.js','utf8');assert(shiftReview.includes('Manager-approved correction'),'shift review must identify completed-order corrections without another Firebase read');assert(shiftReview.includes('completedCorrectionElectronicKindR(o)')&&registerBootstrap.includes("type==='ewallet'"),'Register Ops must recognize configured e-wallet corrections from its existing account subscription');
console.log('completed-order correction checks passed');
