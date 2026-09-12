import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const Financial=require('../functions/lib/financial.js');
const BooksBridge=require('../functions/lib/books-bridge.js');
const server=fs.readFileSync(new URL('../src/functions/43g-order-adjustments.js',import.meta.url),'utf8');
const register=fs.readFileSync(new URL('../src/admin/register/99-voids-refunds.js',import.meta.url),'utf8');
const checkout=fs.readFileSync(new URL('../src/admin/pos/50e-cart-checkout.js',import.meta.url),'utf8');
const persistence=fs.readFileSync(new URL('../src/admin/pos/50f-sale-persistence.js',import.meta.url),'utf8');
const salesFinance=fs.readFileSync(new URL('../src/functions/40-sales-finance.js',import.meta.url),'utf8');
const offlineSync=fs.readFileSync(new URL('../functions/lib/offline-sync.js',import.meta.url),'utf8');

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
for(const marker of ['__posBeginCompletedCorrection','Open POS → Shift Orders','Change completed order'])assert(register.includes(marker),`register workflow missing: ${marker}`);
for(const marker of ['beginCompletedOrderCorrection','completeCompletedOrderCorrection','Do not hand over cash'])assert(persistence.includes(marker),`completed-order correction workflow missing: ${marker}`);
assert(server.includes('in-store orders only'), 'processed cash-refund path must reject non-store channels');

const prepaidOrder={id:'POS-PREPAID-1',channel:'instore',subtotal:850,total:850,payments:[{method:'GCash',amount:1000,receivingAccountId:'gcash'}],preCompletionCashRefund:{amount:150}};
const prepaidSale=Financial.orderPosting(prepaidOrder,{gcash:{name:'GCash'}});
assert.equal(prepaidSale.lines.find((line)=>line.account==='asset:cash_account:gcash').debit,1000,'sale must preserve the full confirmed GCash receipt');
assert.equal(prepaidSale.lines.find((line)=>line.account==='revenue:sales').credit,850,'sale must recognize only the corrected coffee order');
assert.equal(prepaidSale.lines.find((line)=>line.account==='liability:customer_change_refund:POS-PREPAID-1').credit,150,'excess must first be a customer refund liability');
Financial.assertBalanced(prepaidSale.lines);
const prepaidBooks=BooksBridge.mappedLines(prepaidSale,{gcash:'1010'},{});
assert.equal(prepaidBooks.lines.find((line)=>line.code==='4000').credit,850,'Finance Books must recognize only the corrected in-store sale');
assert.equal(prepaidBooks.lines.find((line)=>line.code==='2030').credit,150,'Finance Books must route the excess through Customer Change / Refund Payable');
assert(BooksBridge.linesBalanced(prepaidBooks.lines),'pre-completion Finance Books sale journal must balance');
for(const marker of ['Confirmed amount received ₱','Complete Sale & Refund','Complete corrected sale · cash refund','cash is handed over only after POS confirms'])assert(checkout.includes(marker),`pre-completion checkout marker missing: ${marker}`);
for(const marker of ['preCompletionCashRefund','refundPayments={Cash:preCompletionRefund.amount}','syncOfflinePosSale'])assert(persistence.includes(marker),`pre-completion persistence marker missing: ${marker}`);
for(const marker of ['postPreCompletionCashRefund','customer_change_refunded','asset:register_cash'])assert(salesFinance.includes(marker),`pre-completion Finance Books marker missing: ${marker}`);
for(const marker of ['drawerDeltaValue','Confirmed payment, corrected sale, and cash refund do not reconcile','availableCash'])assert(offlineSync.includes(marker),`pre-completion server safeguard missing: ${marker}`);

console.log('PASS: completed and pre-completion electronic order corrections preserve the receipt, corrected sale, cash drawer, liability settlement, and Finance Books balance.');
