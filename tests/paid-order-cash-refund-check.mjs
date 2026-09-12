import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const Financial=require('../functions/lib/financial.js');
const BooksBridge=require('../functions/lib/books-bridge.js');
const server=fs.readFileSync(new URL('../src/functions/43g-order-adjustments.js',import.meta.url),'utf8');
const register=fs.readFileSync(new URL('../src/admin/register/99-voids-refunds.js',import.meta.url),'utf8');
const pos=fs.readFileSync(new URL('../src/admin/pos/50a-register-shell.js',import.meta.url),'utf8');

const order={id:'ONLINE-CHANGE-1',channel:'online',total:1000,payments:[{method:'GCash',amount:1000,ref:'GC-123'}]};
const movement=Financial.reversalPosting(order,150,'refund',{},[{method:'Cash',amount:150}]);
assert.equal(movement.lines.find((line)=>line.account==='revenue:sales_reversal').debit,150,'refund must reduce net sales');
assert.equal(movement.lines.find((line)=>line.account==='asset:register_cash').credit,150,'refund must reduce register cash');
Financial.assertBalanced(movement.lines);
const books=BooksBridge.mappedLines(movement,{},{});
assert.equal(books.lines.find((line)=>line.code==='4910').debit,150,'Finance Books must debit Sales Returns & Refunds');
assert.equal(books.lines.find((line)=>line.code==='1000').credit,150,'Finance Books must credit Register Cash');
assert(BooksBridge.linesBalanced(books.lines),'Finance Books refund journal must balance');

for(const marker of ['cash_order_change_refund','availableCashOnHandAboveFloat(db)','orderCashRefundLocks','cashier_preauthorized','pending_shift_review','correctedOrderTotal','customerAcknowledgement'])assert(server.includes(marker),`server safeguard missing: ${marker}`);
for(const marker of ['Paid order · cash refund','I will hand the calculated cash refund','inventoryOutcome','Refund posted to register cash and Finance Books'])assert(register.includes(marker),`register workflow missing: ${marker}`);
assert(pos.includes('data-online-change'), 'captured online orders must expose the change-paid-order action');

console.log('PASS: verified electronic order changes post an exact, locked cash refund to Sales Returns and Register Cash.');
