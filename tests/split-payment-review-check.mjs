import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync('src/admin/register/50-cash-movements.js', 'utf8');
const start = source.indexOf('function paymentReviewDetails(');
const end = source.indexOf('function recordRejectionRefund(', start);
assert.ok(start >= 0 && end > start);
const context = {cashAccountsMap:{wallet:{name:'G-Cash'}}, esc:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'), peso:n=>'₱'+Number(n).toFixed(2), paysOf:o=>o.payments?.length?o.payments:[{method:o.payment,amount:o.total}], verificationPolicyForOrder:()=> 'cashier_manager'};
vm.createContext(context);
vm.runInContext(source.slice(start,end), context);
const order={id:'sale',total:670,payment:'Split',payments:[{method:'Cash',amount:300},{paymentMethod:'E-Wallet',method:'E-Wallet · G-Cash',receivingAccountId:'wallet',amount:370,ref:'28e8'}]};
for (const status of ['pending','cashier_verified']) {
  context.ordersMap={sale:{...order,paymentStatus:status}};
  const html=context.pendingPanel();
  for (const part of ['Cash · ₱300.00','E-Wallet · ₱370.00','Receiving account: G-Cash','Ref 28e8']) assert.ok(html.includes(part),status+': '+part);
}
assert.match(context.paymentReviewDetails({payments:[{method:'Cash',amount:1},{method:'Bank',amount:2,ref:'<ref>'}]}),/Receiving account not recorded.*&lt;ref&gt;/);
assert.equal(context.paymentReviewDetails({payment:'Cash',total:5}), 'Cash');
console.log('split-payment-review-check: ok');
