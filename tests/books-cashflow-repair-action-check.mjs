import assert from 'node:assert/strict';
import fs from 'node:fs';

const bridge = fs.readFileSync('assets/js/books/live-pos.mjs', 'utf8');
const cashFlow = fs.readFileSync('src/books/app/20-cash-flow.js', 'utf8');
const statements = fs.readFileSync('src/books/app/30-statements-pages.js', 'utf8');

assert.match(bridge, /window\.__booksRepairCashLedger/, 'Finance Books must expose the existing server repair callable');
assert.match(cashFlow, /App\.repairCashPaymentBankLedger=function/, 'Finance Books must provide a controlled bank-register repair action');
assert.match(cashFlow, /__booksRepairCashLedger\(\{voucherId:id\}\)/, 'the Books repair action must target the exact audit voucher');
assert.match(statements, /App\.controlAuditAction\?App\.controlAuditAction\(i\)/, 'the Cash Flow audit table must render the server-authorized repair action');
assert.match(cashFlow, /Repair cash register/, 'the repair must be visible with a clear action label');
console.log('PASS: Finance Books exposes the Cash Flow bank-register repair on the audit row.');
