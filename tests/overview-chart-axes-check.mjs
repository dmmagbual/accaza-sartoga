import assert from 'node:assert/strict';
import fs from 'node:fs';

// Overview charts: axis labels must be short enough to fit the margin, gridlines must
// fall on round values, and the daily chart must plot each day's real order count
// (a compact day summary is one row, not one order).
globalThis.window={AccazaDate:{key:()=> '2026-10-21'},AccazaSales:{stamp:o=>o.completedAt||o.timestamp,amounts:o=>({net:o.net}),qualifies:()=>true}};
const {overviewAxisMoney,overviewNiceMax,overviewNiceCount}=await import('../assets/js/admin/chart-axes.mjs');
await import('../assets/js/admin/overview-insights.mjs');

assert.equal(overviewNiceMax(352903.61),400000);
assert.equal(overviewNiceMax(32515),40000);
assert.equal(overviewNiceMax(0),1);
assert.equal(overviewNiceMax(191818),200000);
assert.ok(overviewNiceMax(5184.75)>=5184.75);
[1,7,99,1234.5,88225.9,352903.61,2e6].forEach(v=>{const m=overviewNiceMax(v);assert.ok(m>=v,'scale covers the tallest bar '+v);assert.ok(m<=v*2.5+4,'scale is not wasteful '+v);});
assert.equal(overviewNiceCount(45),60);
assert.equal(overviewNiceCount(1),4);
assert.equal(overviewNiceCount(846)%4,0);
[1,3,13,45,846].forEach(v=>{const m=overviewNiceCount(v);assert.ok(m>=v);assert.ok(Number.isInteger(m/4),'order gridlines are whole numbers '+v);});

assert.equal(overviewAxisMoney(0),'₱0');
assert.equal(overviewAxisMoney(400000),'₱400k');
assert.equal(overviewAxisMoney(100000),'₱100k');
assert.equal(overviewAxisMoney(7500),'₱7.5k');
assert.equal(overviewAxisMoney(1500000),'₱1.5M');
assert.equal(overviewAxisMoney(750),'₱750');
[0,.25,.5,.75,1].forEach(p=>assert.ok(overviewAxisMoney(400000*p).length<=6,'axis label stays short'));

const src=fs.readFileSync('assets/js/admin/overview-insights.mjs','utf8');
assert.ok(src.includes("from'./chart-axes.mjs?v="),'overview imports the shared axis helpers');
assert.ok(src.includes('__overviewOrders:Number(summary.days[key].orders)||0'),'day summary rows carry the day order count');
assert.ok(src.includes('b.count+=o.__overviewOrders!=null?Number(o.__overviewOrders)||0:1'),'daily chart counts summary orders, not summary rows');
assert.ok(!src.includes('pad={l:52,')&&!src.includes('pad={l:42,'),'fixed label margins removed');
assert.ok(!/fillText\(money\(maxR\*p\)/.test(src),'axis labels use the short formatter');
console.log('overview chart axes check passed');
