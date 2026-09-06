import assert from 'node:assert/strict';
import fs from 'node:fs';

globalThis.window={AccazaDate:{key:()=> '2026-09-07'},AccazaSales:{stamp:o=>o.completedAt,amounts:o=>({net:o.net})}};
const {buildChannelBreakdown,buildRollingYear,overviewChannelKey,overviewRollingYearRange}=await import('../assets/js/admin/overview-insights.mjs');
const ts=date=>Date.parse(date+'T12:00:00+08:00');
const range=overviewRollingYearRange('2026-09-07');
assert.equal(range.from,'2025-10-01');assert.equal(range.to,'2026-09-07');
const rows=[
  {channel:'online',source:'online',completedAt:ts('2025-10-02'),net:100},
  {channel:'instore',source:'pos',completedAt:ts('2026-08-02'),net:200},
  {channel:'grabfood',source:'pos',completedAt:ts('2026-09-02'),net:300},
  {channel:'foodpanda',source:'pos',completedAt:ts('2026-09-03'),net:400},
  {channel:'',source:'pos',completedAt:ts('2026-09-04'),net:50}
];
assert.equal(overviewChannelKey(rows[1]),'instore');assert.equal(overviewChannelKey(rows[2]),'grabfood');assert.equal(overviewChannelKey(rows[3]),'foodpanda');
const channels=buildChannelBreakdown(rows);assert.deepEqual(channels.channels.map(x=>[x.key,x.orders,x.net]),[['online',1,100],['instore',1,200],['grabfood',1,300],['foodpanda',1,400]]);assert.deepEqual(channels.unclassified,{orders:1,net:50});
const months=buildRollingYear(rows,range);assert.equal(months.length,12);assert.deepEqual(months[0],{key:'2025-10',net:100,orders:1});assert.deepEqual(months[10],{key:'2026-08',net:200,orders:1});assert.deepEqual(months[11],{key:'2026-09',net:750,orders:3});
const html=fs.readFileSync('src/html/admin/50-admin-workspace.html','utf8'),core=fs.readFileSync('assets/js/admin/core.mjs','utf8');
assert(html.includes('id="overviewYearChart"')&&html.includes('id="channelBreakdown"'));assert(!html.includes('Order Activity &amp; Outcomes'));assert(core.includes('readRollingSales:readOverviewSalesRange'));
console.log('PASS: Overview has a bounded rolling 12-month trend and mutually exclusive sales-channel totals.');
