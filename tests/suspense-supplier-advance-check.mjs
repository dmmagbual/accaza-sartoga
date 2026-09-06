import fs from 'node:fs';

const server=fs.readFileSync('src/functions/42c-financial-command-controls.js','utf8');
const auth=fs.readFileSync('src/functions/20-portal-auth.js','utf8');
const vouchers=fs.readFileSync('src/functions/41-expense-assets.js','utf8');
const journal=fs.readFileSync('src/books/app/30-statements-pages.js','utf8');
const ui=fs.readFileSync('src/books/app/50-controlled-transactions.js','utf8');
const bridge=fs.readFileSync('assets/js/books/suspense-advance.mjs','utf8');
const html=fs.readFileSync('books.html','utf8');
const sw=fs.readFileSync('sw.js','utf8');
const manifest=JSON.parse(fs.readFileSync('release-manifest.json','utf8'));
const rules=fs.readFileSync('database.rules.json','utf8');
const must=(source,marker,message)=>{if(!source.includes(marker))throw new Error(message+': '+marker);};

for(const marker of ['convert_suspense_to_supplier_advance','rows.length!==2','"coa:1900"','asset:purchase_cash_advance:','pettyCashVouchers/${voucherId}','suspenseAdvanceConversions/${originalId}','supplierAdvanceConversionId','pending_inventory_allocation','claimManagerApproval(db,data,"convert_suspense_supplier_advance"','await assertAccountingPeriodOpen','original.reversalOf||original.reversedByMovementId'])must(server,marker,'Server conversion safeguard missing');
for(const marker of ['remainingAmount:value','allocatedAmount:0','allocations:{}','fundingAccountId','operationalAuditRecord("convert_suspense_supplier_advance"'])must(server,marker,'Supplier subledger or audit treatment missing');
for(const marker of ['!after.conversionMovementId','row.conversionMovementId','id === "revolving_fund"','account:"asset:petty_cash"'])must(vouchers,marker,'Converted advances can duplicate cash or return to the wrong account');
must(auth,'"convert_suspense_supplier_advance"','Manager approval action is not registered');
for(const marker of ['Convert to supplier advance','suspenseAdvanceEligible','__suspenseAdvanceConversions'])must(journal,marker,'Journal conversion action missing');
for(const marker of ['App.convertSuspenseAdvance','This does not pay cash again','supplierId','reference','purpose','reason'])must(ui,marker,'Conversion form safeguard missing');
for(const marker of ['createManagerApproval','postFinancialCommand','suspense_advance_reclass_','/suspenseAdvanceConversions'])must(bridge,marker,'Authenticated conversion bridge missing');
must(html,'assets/js/books/suspense-advance.mjs?v=105','Conversion bridge is not loaded by Books');
must(sw,"'/assets/js/books/suspense-advance.mjs'",'Conversion bridge is not cached');
if(!manifest.authoritativeFiles.includes('assets/js/books/suspense-advance.mjs'))throw new Error('Conversion bridge is not release-authoritative');
must(rules,'"suspenseAdvanceConversions"','Conversion status is not readable to signed-in Admin Books users');

console.log('PASS: Suspense converts once into a supplier-linked advance without a second cash movement, with approval, audit, period, allocation, and reversal guards.');
