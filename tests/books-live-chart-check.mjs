// Finance Books must apply the server chart (/booksChart) from startup. On 8 Oct 2026 the
// applier moved into the lazily loaded controlled-transactions bundle; the live listener in
// live-pos.mjs found nothing to call, so every server-only account (1060, 1130, 2315-2340,
// 6005...) was missing from the chart and the reports, and the Balance Sheet showed out of
// balance by the amounts posted to those accounts (Books 164 fix).
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const app=fs.readFileSync('assets/js/books/app.js','utf8');
const lazy=['assets/js/books/controlled-transactions.js','assets/js/books/subledgers.js'].map(p=>[p,fs.readFileSync(p,'utf8')]);
const live=fs.readFileSync('assets/js/books/live-pos.mjs','utf8');
const html=fs.readFileSync('books.html','utf8');

assert.ok(live.includes('App.applyServerChart()'),'the live /booksChart listener must apply the server chart');
assert.equal((app.match(/App\.applyServerChart=function\(\)\{/g)||[]).length,1,'App.applyServerChart must be defined once in the always-loaded app.js bundle');
for(const [p,src] of lazy)assert.equal(src.includes('App.applyServerChart='),false,`${p} is lazily loaded and must not own App.applyServerChart`);
assert.ok(html.indexOf('assets/js/books/app.js')>-1&&html.indexOf('assets/js/books/app.js')<html.indexOf('assets/js/books/live-pos.mjs'),'app.js must load before the live listener module');

// Behaviour: the applier replaces the local default chart with every server account.
const start=app.indexOf('App.applyServerChart=function(){'),end=app.indexOf('\n};',start)+3;
const ctx={App:{rendered:0,render(){this.rendered++;}},DB:{accounts:[{code:'1000',name:'Local default',type:'Asset'}]},saved:0,window:{}};
ctx.save=()=>{ctx.saved++;};
ctx.window.__booksChart={
  '1000':{code:'1000',name:'Cash on Hand - Cash in Register',type:'Asset',active:true},
  '1060':{code:'1060',name:'Payments Awaiting Verification',type:'Asset',active:true,system:true},
  '2315':{code:'2315',name:'Loan 3',type:'Liability',active:true},
  '4995':{code:'4995',name:'Inventory Reconciliation Gain',type:'Income',active:false}
};
vm.createContext(ctx);
vm.runInContext(app.slice(start,end),ctx);
ctx.App.applyServerChart();
assert.equal(JSON.stringify(ctx.DB.accounts.map(a=>a.code)),JSON.stringify(['1000','1060','2315','4995']),'every server account must reach the Finance Books chart, sorted by code');
assert.equal(ctx.DB.accounts[0].name,'Cash on Hand - Cash in Register','the server name must replace the local default');
assert.equal(ctx.DB.accounts.find(a=>a.code==='1060').system,true,'system-controlled flag must carry over');
assert.equal(ctx.DB.accounts.find(a=>a.code==='4995').active,false,'inactive accounts stay listed as inactive for historical postings');
assert.equal(ctx.window.__booksChartLive,true,'the page must record that the live chart is applied');
assert.equal(ctx.App.rendered,1,'the current page must re-render after the chart changes');
// An empty or missing server chart must never wipe the local chart.
const before=JSON.stringify(ctx.DB.accounts);ctx.window.__booksChart={};ctx.App.applyServerChart();ctx.window.__booksChart=null;ctx.App.applyServerChart();
assert.equal(JSON.stringify(ctx.DB.accounts),before,'an empty server chart must leave the chart unchanged');

console.log('Finance Books live chart check passed.');
