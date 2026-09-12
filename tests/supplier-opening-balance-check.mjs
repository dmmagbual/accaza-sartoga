import fs from 'node:fs';

const server=fs.readFileSync('src/functions/42d-financial-command-close.js','utf8');
const client=fs.readFileSync('src/books/opening-payables.js','utf8')+fs.readFileSync('src/books/app/40-subledgers.js','utf8');
function must(source,marker,message){if(!source.includes(marker))throw new Error(message+' Missing: '+marker);}

for(const marker of ['create_supplier_opening_balance','reverse_supplier_opening_balance','"equity:opening_balance"','liability:payable:${docId}','openingPayableReferences/${referenceHash}','confirmedOutstanding !== true','invoiceDate > openingDate','paidBeforeOpening > originalAmount','operationalAuditRecord("create_supplier_opening_balance"','operationalAuditRecord("reverse_supplier_opening_balance"','doc.openingBalance === true && isReverse'])must(server,marker,'Supplier opening-balance server safeguard missing.');
for(const marker of ['App.txnSupplierOpeningBalance','App.reverseSupplierOpeningBalance','paidBeforeOpening','confirmedOutstanding:true','openingPayableHeaderButton','openingPayableRowButton','No document upload or proof is required'])must(client,marker,'Supplier opening-balance UI control missing.');
if(server.includes('statementReference')||client.includes('sob_statement_ref'))throw new Error('Supplier opening balances must not require documentation or proof.');
if(server.includes('expense_or_inventory:${documentType}')&&!server.includes('Financial.line("equity:opening_balance", value, 0'))throw new Error('Opening balances must post to Owner\'s Capital, not current expense.');
console.log('Supplier opening balance checks passed.');
