import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url),Correction=require('../functions/lib/order-correction'),Financial=require('../functions/lib/financial');
const base={id:'POS-COFFEE1',total:1000,paymentStatus:'cashier_verified',payments:[{method:'GCash · GCash',paymentMethod:'GCash',amount:1000,ref:'GC-1000'}],lineItems:[{itemKey:'spanish',size:'L',qty:2,unitTotal:250}],cogsAccountSnapshot:{'1210|5010':300}};

assert.equal(Correction.paymentKind(base),'gcash');
assert.equal(Correction.paymentKind({...base,payments:[{method:'Bank Transfer · BDO',paymentMethod:'Bank Transfer',amount:1000,ref:'BDO-1'}]}),'bank_transfer');
assert.equal(Correction.paymentKind({...base,payments:[{method:'PayMaya',amount:1000,ref:'M-1'}]}),'');
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
const adjustments=fs.readFileSync('src/functions/43g-order-adjustments.js','utf8'),inventory=fs.readFileSync('src/functions/50-inventory.js','utf8'),rules=fs.readFileSync('database.rules.json','utf8');
assert(adjustments.includes('correctedInventoryUsage:correctedMeta.inventoryUsage'));
assert(adjustments.includes('correctionInventoryToken:token'));
assert(inventory.includes('order.completedOrderCorrectionId && order.correctedInventoryUsage'));
assert(inventory.includes('`crs_${order.correctionInventoryToken}_${itemId}`'));
assert(rules.includes('"orderCorrectionCommands": { ".read": false, ".write": false }'));
assert(rules.includes('"orderCorrections": { ".read": false, ".write": false }'));
console.log('completed-order correction checks passed');
