import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const csv=fs.readFileSync('src/books/csv-exports.js','utf8');
const html=fs.readFileSync('books.html','utf8');
const pages=fs.readFileSync('src/books/app/30-statements-pages.js','utf8');
const transactions=fs.readFileSync('src/books/app/50-controlled-transactions.js','utf8');
const insights=fs.readFileSync('src/books/business-intelligence.js','utf8');

for(const kind of ['insights','transactions','journal','ledger','pl','bs','cashflow','tb']){
  if(!csv.includes(`${kind}:`))throw new Error(`Missing CSV exporter route: ${kind}`);
}
if(!html.includes('<script src="src/books/csv-exports.js"></script>'))throw new Error('Finance CSV exporter is not loaded');
for(const kind of ['journal','ledger','pl','bs','cashflow','tb']){
  if(!pages.includes(`csvButton('${kind}')`))throw new Error(`Missing CSV control on Finance page: ${kind}`);
}
if(!transactions.includes("csvButton('transactions')")||!transactions.includes('Transaction list · '))throw new Error('Transactions must show and export the selected-period list');
if(!/App\.exportCsv\(\\?'insights\\?'\)/.test(insights)||!insights.includes('AccazaExportBusinessMetrics'))throw new Error('Key Metrics CSV export is incomplete');
if(!csv.includes("if(/^\\s*[=+\\-@\\t\\r]/.test(text))"))throw new Error('CSV cells are not protected from spreadsheet formula injection');
if(!csv.includes("ENTRIES().filter(entryInPeriod)"))throw new Error('CSV exports must use the same selected-period Finance authority');
for(const marker of ['function accountLedgerDetail(code)','function exportAccountLedgerCsv(code)','function printAccountLedger(code)','function printFinancePage(title)','Running balance (normal side)'])if(!csv.includes(marker))throw new Error(`Account-ledger print/CSV safeguard missing: ${marker}`);
const shell=fs.readFileSync('src/books/app/10-application-shell.js','utf8');
for(const marker of ["App.printLedger('","App.exportAccountLedgerCsv('",'accountLedgerDetail(code)','printFinancePage(title)'])if(!shell.includes(marker))throw new Error(`Ledger drill-down action missing: ${marker}`);
for(const marker of ["App.printFinancePage('Journal')","App.printFinancePage('General Ledger')"])if(!pages.includes(marker))throw new Error(`Main Finance print action missing: ${marker}`);
for(const field of ['Entry ID','Reference','Debit','Credit','Reversal of','Corrects movement']){
  if(!csv.includes(field))throw new Error(`Journal audit field missing from CSV: ${field}`);
}

console.log('Finance CSV export check passed.');

// Exercise the actual exporter, including quoted fields and carry-forward balances.
const accounts=[{code:'1000',name:'Cash',type:'Asset'},{code:'4000',name:'Sales',type:'Income'}];
const entries=[{id:'before',date:'2026-07-31',lines:[{code:'1000',debit:100},{code:'4000',credit:100}]},{id:'sale',date:'2026-08-01',ref:'=SUM(1,2)',lines:[{code:'1000',debit:260},{code:'4000',credit:260}]}];
const ctx=vm.createContext({window:{},DB:{accounts},ENTRIES:()=>entries,entriesThroughPeriodEnd:()=>entries,entryInPeriod:e=>e.date>='2026-08-01'&&e.date<='2026-08-31',periodBounds:()=>({start:'2026-08-01',end:'2026-08-31'}),acc:code=>accounts.find(a=>a.code===code),accName:code=>accounts.find(a=>a.code===code)?.name,DEBIT_NORMAL:{Asset:true,Income:false},isBalanceSheetType:t=>t==='Asset',normalBalanceFor:(code,es)=>es.reduce((s,e)=>s+e.lines.filter(l=>l.code===code).reduce((s,l)=>s+(l.debit||0)-(l.credit||0),0),0),r2:v=>Math.round(v*100)/100});
vm.runInContext(csv,ctx);
assert.equal(ctx.csvSafe('  =SUM(1,2)'), '"\'  =SUM(1,2)"');
assert.equal(ctx.csvSafe(-260),'-260.00');
assert.equal(ctx.csvSafe('a,"b"'),'"a,""b"""');
let result;
ctx.csvDownload=(name,headers,rows)=>{result={name,headers,rows};};
ctx.exportLedgerCsv();
assert.equal(result.rows.find(r=>r[1]==='1000'&&r[10]==='Closing')[9],360);
assert.equal(result.rows.find(r=>r[1]==='4000'&&r[10]==='Closing')[9],260);
ctx.exportJournalCsv();
assert.equal(result.rows.length,2);
assert.equal(result.rows[0][1],'sale');
assert.equal(result.rows[0][8],260);
ctx.exportAccountLedgerCsv('1000');
assert.equal(result.rows[0][6],'Opening balance');
assert.equal(result.rows.at(-1)[6],'Closing balance');
assert.equal(result.rows.at(-1)[9],360);
assert.ok(html.indexOf('src/books/csv-exports.js')<html.indexOf('assets/js/books/app.js'),'CSV helpers must load before direct-link rendering');
console.log('PASS: CSV escaping, formula protection, date filtering, journal detail and ledger opening/closing balances.');
