import assert from 'node:assert/strict';
import fs from 'node:fs';
import {operatingWeekRows,weeklyBarColor} from '../assets/js/admin/weekly-sales.mjs';

const days={
  '2026-01-01':{orders:0,net:0},
  '2026-07-25':{orders:2,net:1200},
  '2026-07-26':{orders:1,net:800},
  '2026-08-03':{orders:3,net:3000},
  '2026-08-18':{orders:1,net:1750},
  '2026-09-27':{orders:4,net:4400},
};
const rows=operatingWeekRows(days,'2026-09-27');
assert.equal(rows[0].week,'2026-07-20','weekly history must begin with the Monday containing the first recorded sale, not January');
assert.equal(rows[0].net,2000,'opening-week sales must include only recorded operating days');
assert.equal(rows[0].firstSaleDay,'2026-07-25','the chart note must use the actual first sale day, not a pre-opening zero row');
assert.equal(rows[0].openingPartial,true,'the first partial operating week must be identified');
assert.equal(rows.at(-1).week,'2026-09-21','weekly history must continue through the current week');
assert.equal(rows.at(-1).currentPartial,false,'a Sunday period end completes the Monday-Sunday week');
assert.equal(rows.find(row=>row.week==='2026-08-10').net,0,'zero-sales weeks after opening must remain visible');
assert.equal(rows.length,10,'every Monday-Sunday week from opening through the period end must be returned');
assert.equal(new Set(rows.map(row=>weeklyBarColor(row.week))).size,rows.length,'every displayed week must receive a different stable color');
const partial=operatingWeekRows(days,'2026-09-25');
assert.equal(partial.at(-1).currentPartial,true,'an unfinished latest week must be identified as partial');

const analytics=fs.readFileSync('src/admin/analytics/10-sales-model-history.js','utf8');
const render=analytics.slice(analytics.indexOf('function renderCompactAnalyticsV5'),analytics.indexOf('function bar('));
assert.ok(render.includes('operatingYearWeekly.html()'),'only Weekly Sales must render the operating-year controller');
for(const marker of ['kpi(\'Net sales\',peso(current.net),trend)','days.map(function(day)','cashierPie(\'MTD','compactDrinkItems(ytd)','var hourKeys=','var weekdayRows='])assert.ok(render.includes(marker),`another Analytics card lost its existing selected-period source: ${marker}`);
const overview=fs.readFileSync('assets/js/admin/overview-insights.mjs','utf8');
const history=fs.readFileSync('assets/js/admin/sales-history.js','utf8');
for(const source of [overview,history]){assert.ok(!source.includes('operatingWeekRows')&&!source.includes('operatingYearWeekly'),'Overview and Sales History must remain independent of the Weekly Sales change');}

console.log('PASS: Weekly Sales alone covers every post-opening week with stable distinct colors; other reports retain their existing sources.');
