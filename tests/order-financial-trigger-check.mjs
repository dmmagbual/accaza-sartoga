import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const Trigger = require('../functions/lib/order-financial-trigger.js');
const finalOrder = {status: 'Completed', paymentStatus: 'confirmed', total: 245, payments: [{method: 'Cash', amount: 245}]};

assert.equal(Trigger.requiresFinancialPosting({}, finalOrder), true, 'a newly completed paid order must post its sale');
assert.equal(Trigger.requiresFinancialPosting({status: 'Preparing', paymentStatus: 'confirmed'}, finalOrder), true, 'a completed status transition must post its sale');
assert.equal(Trigger.requiresFinancialPosting({status: 'Completed', paymentStatus: 'pending'}, finalOrder), true, 'payment confirmation of a completed order must post its sale');
assert.equal(Trigger.requiresFinancialPosting(finalOrder, {...finalOrder, inventoryDeducted: true, service: {state: 'served'}}), false, 'operational-only order writes must not start Finance work');
assert.equal(Trigger.requiresFinancialPosting(finalOrder, {...finalOrder, preCompletionCashRefund: {amount: 25}}), true, 'a pre-completion cash refund must post');
assert.equal(Trigger.requiresFinancialPosting({...finalOrder, preCompletionCashRefund: {amount: 25}}, {...finalOrder, preCompletionCashRefund: {amount: 25}}), false, 'an unchanged pre-completion refund must not re-run Finance');
assert.equal(Trigger.requiresFinancialPosting({...finalOrder, refundAmount: 10}, {...finalOrder, refundAmount: 35}), true, 'a larger refund must post its delta');
assert.equal(Trigger.requiresFinancialPosting(finalOrder, {...finalOrder, voided: true}), true, 'a newly voided order must post its reversal');
assert.equal(Trigger.requiresFinancialPosting({...finalOrder, voided: true}, {...finalOrder, voided: true}), false, 'an already voided order must not re-run Finance');

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const source = read('src/functions/40-sales-finance.js');
const trigger = source.slice(source.indexOf('exports.onOrderFinancialPosting'), source.indexOf('// Revenue-completeness control.'));
const gateAt = trigger.indexOf('if (!OrderFinancialTrigger.requiresFinancialPosting(before, order)) return;');
const financeReadAt = trigger.indexOf('const db = getDatabase();');
assert.ok(gateAt >= 0 && financeReadAt >= 0 && gateAt < financeReadAt, 'the financial gate must run before any Finance settings reads');
assert.ok(read('functions/index.js').includes('if (!OrderFinancialTrigger.requiresFinancialPosting(before, order)) return;'), 'the deployed Functions bundle must contain the financial gate');

console.log('PASS: only sale/refund/void financial transitions enter onOrderFinancialPosting; operational order writes exit before Finance reads.');
