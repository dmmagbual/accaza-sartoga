import fs from 'node:fs';

const shell=fs.readFileSync('src/books/app/10-application-shell.js','utf8');
const html=fs.readFileSync('books.html','utf8');
const css=fs.readFileSync('assets/css/books.css','utf8');
const subledgers=fs.readFileSync('src/books/app/40-subledgers.js','utf8');
const transactionSource=fs.readFileSync('src/books/app/50-controlled-transactions.js','utf8');
const bundleTool=fs.readFileSync('tools/build-runtime-bundles.mjs','utf8');
const offline=fs.readFileSync('sw.js','utf8');

const expected={
  overview:['dashboard','insights'],
  entries:['transactions','fixedassets','purchases','journal'],
  ledgers:['ledger','receivables','payables'],
  statements:['pl','bs','cashflow','tb'],
  controls:['close','coa','settings','data']
};

for(const [group,ids] of Object.entries(expected)){
  if(!shell.includes(`{id:"${group}",label:`))throw new Error(`Missing Finance work area: ${group}`);
  for(const id of ids){
    const matches=shell.match(new RegExp(`\\{id:"${id}"[^\\n]+group:"${group}"`,'g'))||[];
    if(matches.length!==1)throw new Error(`Finance destination ${id} must appear exactly once in ${group}`);
  }
}

const allIds=Object.values(expected).flat();
if(new Set(allIds).size!==17)throw new Error('Finance navigation must retain all 17 destinations');
for(const id of ['fixedassets','purchases']){
  if(!shell.includes(`{id:"${id}",label:`)||!shell.includes(`group:"entries",hidden:true`))throw new Error(`Finance card destination ${id} must be a registered hidden route`);
}
if(!shell.includes('t=>t.group===activeGroup&&!t.hidden'))throw new Error('Finance subpages must remain card destinations instead of duplicating primary navigation tabs');
if(!html.includes('id="bookGroups"')||!html.includes('id="tabs"'))throw new Error('Two-level Finance navigation containers are missing');
if(!shell.includes("selected&&selected.settingsSection?PAGES.settings():PAGES[CURRENT]()"))throw new Error('Finance control screens are not routed through their existing pages');
for(const route of ['transactions','fixedassets','purchases','receivables','payables','journal','coa','settings'])if(!shell.includes(`'${route}'`))throw new Error(`Controlled Finance Tools must load before the ${route} route renders`);
if(!shell.includes('loadControlledTransactions()')||!shell.includes('window.__booksControlledTransactionsReady')||!shell.includes('controlled-transactions.js?v=153'))throw new Error('Controlled Finance Tools need a cached, retryable lazy loader');
if(!bundleTool.includes("target:'assets/js/books/app.js',exclude:['50-controlled-transactions.js']")||!bundleTool.includes("target:'assets/js/books/controlled-transactions.js',include:['50-controlled-transactions.js']"))throw new Error('The Books startup bundle must exclude the controlled-transactions section and build it separately');
for(const marker of ['PAGES.transactions = function()','PAGES.fixedassets = function()','PAGES.purchases = function()','App._txnModal=function'])if(!transactionSource.includes(marker))throw new Error(`The deferred Finance Tools source is missing ${marker}`);
if(!offline.includes("'/assets/js/books/controlled-transactions.js?v=153'"))throw new Error('The deferred Finance Books bundle must remain available offline at its exact versioned URL');
if(!css.includes('.tabs-in{flex-wrap:wrap')||!css.includes('.book-groups{display:grid'))throw new Error('Finance navigation is not protected against hidden mobile tabs');
for(const marker of ['App.showSupplierPayableLedger','payableSupplierDocs','App.showPayableTrace','payableRelatedEntries','Original payable → purchase invoice → journal → payment / reversal.','Related Finance Books transactions'])if(!subledgers.includes(marker))throw new Error(`Supplier payable drill-down is missing: ${marker}`);
for(const marker of ['App.showSupplierAdvanceLedger','Supplier Advances · account 1115','__getSupplierAdvanceDetails','Original payments and allocations'])if(!subledgers.includes(marker))throw new Error(`Supplier advance drill-down is missing: ${marker}`);
if(!subledgers.includes("d.purchaseInvoiceId&&(window.__piMap||{})[d.purchaseInvoiceId]")||!subledgers.includes('e.linkedPayableId===d.id')||!subledgers.includes('wanted[e.reversalOf]'))throw new Error('Supplier payable drill-down does not retain source, journal, payment, and reversal links');

console.log('Finance Books navigation check passed.');
