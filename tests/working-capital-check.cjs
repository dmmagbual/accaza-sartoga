const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const model=fs.readFileSync('src/books/app/00-accounting-model.js','utf8');
const start=model.indexOf('function workingCapitalAt('),end=model.indexOf('\n}',start)+2;
assert.ok(start>=0&&end>start,'working-capital helper must exist');
const balances={1000:10000,1100:2500,1290:1000,1400:500,1500:90000,2000:3000,2100:200,2200:800,2300:12000};
const context={
  DB:{accounts:Object.keys(balances).map(code=>({code,type:Number(code)<2000?'Asset':'Liability'}))},
  ENTRIES:()=>[{date:'2026-08-31'},{date:'2026-09-01'}],
  normalBalanceFor:(code,entries)=>{assert.equal(entries.length,1);return balances[code];},
  r2:value=>Math.round(Number(value)*100)/100
};
vm.createContext(context);vm.runInContext(model.slice(start,end),context);
const result=vm.runInContext("workingCapitalAt('2026-08-31')",context);
assert.equal(result.currentAssets,14000,'cash, receivables, inventory and other current assets are included');
assert.equal(result.currentLiabilities,4000,'payables, other current obligations and tax liabilities are included');
assert.equal(result.amount,10000,'working capital equals current assets less current liabilities');
const dashboard=fs.readFileSync('src/books/app/30-statements-pages.js','utf8');
const subledgers=fs.readFileSync('src/books/app/40-subledgers.js','utf8');
assert.match(dashboard,/kpi\("Working capital"/);
assert.match(dashboard,/Current assets .*current liabilities/);
assert.doesNotMatch(dashboard+subledgers,/Net working capital|net working capital/);
console.log('PASS: Working Capital uses current assets less current liabilities and excludes fixed assets and loans.');
