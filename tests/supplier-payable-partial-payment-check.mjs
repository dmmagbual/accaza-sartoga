import fs from 'node:fs';

const client=fs.readFileSync('src/books/app/40-subledgers.js','utf8')+fs.readFileSync('src/books/app/50-controlled-transactions.js','utf8');
const server=fs.readFileSync('src/functions/42d-financial-command-close.js','utf8');
const period=fs.readFileSync('assets/js/shared/report-period.js','utf8');
const shell=fs.readFileSync('src/books/app/10-application-shell.js','utf8');
const must=(source,marker,message)=>{if(!source.includes(marker))throw new Error(message+': '+marker);};

for(const marker of ['Supplier outstanding balance','Open invoices','Outstanding balance','App.showSupplierPayableLedger','remainingAmount!=null?d.remainingAmount:d.amount'])must(client,marker,'Supplier-level payable ledger is incomplete');
for(const marker of ['id="tp_amount"','Payment cannot exceed the outstanding balance','amount:value','Use Supplier Advances for an overpayment','settlements/${commandId}'])must(client+server,marker,'Partial supplier-payment control is incomplete');
for(const marker of ['data.amount','exceeds the remaining payable','payablePayments/${commandId}','nextRemaining=isAr?0:Financial.money(remaining-value)','nextPaid=isAr?value:Financial.money(Number(doc.paidAmount||0)+value)'])must(server,marker,'Server partial-payment accounting is incomplete');
for(const marker of ['data.paymentId || doc.settlementMovementId','settlements/${paymentId}/status','currentRemaining+value','preserve every other settlement'])must(server,marker,'Individual payment reversal is incomplete');
for(const marker of ['payableSettlementClaims/${docId}','Another payment is being posted to this invoice','payableSettlementClaim={ref:lockRef,token}'])must(server,marker,'Concurrent payment protection is incomplete');
must(period,"var state=normalize({mode:'current'});",'Finance Books must open on the current month instead of a stored historical filter');
must(shell,'resetCurrentMonth()','Current-month reset control is missing');

console.log('PASS: Payables groups supplier balances, drills into invoices, accepts bounded partial payments, reverses one settlement at a time, and opens Finance Books on the current month through today.');
