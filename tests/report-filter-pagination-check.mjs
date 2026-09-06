import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const books=fs.readFileSync('books.html','utf8');
const shell=fs.readFileSync('src/books/app/10-application-shell.js','utf8');
const cashFlow=fs.readFileSync('src/books/app/20-cash-flow.js','utf8');
const statements=fs.readFileSync('src/books/app/30-statements-pages.js','utf8');
const controls=fs.readFileSync('src/books/app/40-subledgers.js','utf8');
const pagination=fs.readFileSync('assets/js/shared/report-pagination.js','utf8');
const admin=fs.readFileSync('admin.html','utf8');

assert(!/id="periodSel"|>All time</i.test(books),'Finance Books must not expose a global or All Time period selector');
assert(shell.includes("selected.group==='controls'"),'Controls must suppress report filters');
assert(shell.includes("CURRENT==='bs'"),'Balance Sheet must use an as-of control');
assert(shell.includes('periodFrom')&&shell.includes('periodTo')&&shell.includes('periodMonth'),'Dated Books views must provide From, To and Month controls');
assert(cashFlow.includes("typeof periodBounds==='function'?periodBounds()"),'Cash Flow must use the shared report period');
assert(!statements.includes("App.cfRange('from'")&&!statements.includes("App.cfRange('to'"),'Cash Flow must not retain a second date selector');
assert(!controls.includes('id="bc_date"')&&controls.includes('var date=todayStr()'),'Daily close must always use today');
assert(/var SIZE=50/.test(pagination),'Report pagination must cap each page at 50 records');
assert(pagination.includes("classList.contains('total-row')")&&pagination.includes("classList.contains('tot')"),'Pagination must preserve report summary rows');
assert(books.includes('assets/js/shared/report-pagination.js')&&admin.includes('assets/js/shared/report-pagination.js'),'Pagination must load in both Finance Books and Admin');

const events={},storage=new Map(),win={AccazaDate:{key:()=> '2026-09-06'},localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},addEventListener:(name,fn)=>(events[name]??=[]).push(fn),dispatchEvent:event=>(events[event.type]||[]).forEach(fn=>fn(event))};
vm.runInNewContext(fs.readFileSync('assets/js/shared/report-period.js','utf8'),{window:win,localStorage:win.localStorage,CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},Date,Intl});
const period=win.AccazaReportPeriod.get();
assert.equal(period.mode,'current');assert.equal(period.from,'2026-09-01');assert.equal(period.to,'2026-09-06');
assert.throws(()=>win.AccazaReportPeriod.set({mode:'custom',customFrom:'2026-09-07',customTo:'2026-09-07'}),/Future/);
assert.throws(()=>win.AccazaReportPeriod.setMonth('2026-10'),/Future/);
console.log('Report filter and pagination checks passed.');
