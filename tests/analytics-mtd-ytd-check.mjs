import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {summarizeHistoricalSales} from "../assets/js/admin/historical-sales-summary.mjs";

function day(netCents, cashiers, hours) {
  return {orders:1,grossCents:netCents,discountCents:0,refundCents:0,netCents,cogsCents:0,channels:{},payments:{},items:{},cashiers,hours};
}

const months = {
  "2026-01": {schemaVersion:3,analyticsSchemaVersion:2,cashiers:{incorrectWholeMonth:{name:"Incorrect whole month",orders:99,netCents:999999}},weekdays:{"4":{orders:99,netCents:999999}},days:{
    "2026-01-15":day(10000,{rya:{name:"Rya",orders:1,netCents:10000}},{"12":{orders:1,netCents:10000}}),
  }},
  "2026-09": {schemaVersion:3,analyticsSchemaVersion:2,cashiers:{incorrectWholeMonth:{name:"Incorrect whole month",orders:88,netCents:888888}},weekdays:{"2":{orders:88,netCents:888888}},days:{
    "2026-09-01":day(2000,{rya:{name:"Rya",orders:1,netCents:2000}},{"9":{orders:1,netCents:2000}}),
    "2026-09-02":day(3000,{maria:{name:"Maria",orders:1,netCents:3000}},{"12":{orders:1,netCents:3000}}),
  }},
};
const mtd = summarizeHistoricalSales(months,{start:Date.parse("2026-09-01T00:00:00+08:00"),end:Date.parse("2026-09-02T23:59:59.999+08:00")});
const ytd = summarizeHistoricalSales(months,{start:Date.parse("2026-01-01T00:00:00+08:00"),end:Date.parse("2026-09-02T23:59:59.999+08:00")});
assert.deepEqual(mtd.cashiers,{rya:{name:"Rya",orders:1,net:20},maria:{name:"Maria",orders:1,net:30}},"MTD cashier totals must use only selected daily rows");
assert.equal(ytd.cashiers.rya.net,120,"YTD must retain prior selected days");
assert.equal(mtd.cashiers.incorrectWholeMonth,undefined,"whole-month aggregates must never leak into MTD");
assert.equal(mtd.weekdays["2"].net,20,"MTD weekday total must use only the sale date");
assert.equal(ytd.weekdays["4"].net,100,"YTD weekday total must include January without reusing its monthly aggregate");
assert.equal(Object.values(mtd.cashiers).reduce((sum,row)=>sum+row.net,0),mtd.net,"cashier MTD must reconcile to the selected-period sales total");
assert.equal(Object.values(mtd.weekdays).reduce((sum,row)=>sum+row.net,0),mtd.net,"weekday MTD must reconcile to the selected-period sales total");
assert.equal(Object.values(mtd.hours).reduce((sum,row)=>sum+row.net,0),mtd.net,"peak-hour MTD must reconcile to the selected-period sales total");

const analyticsSource = readFileSync("src/admin/analytics/10-sales-model-history.js","utf8");
assert(analyticsSource.includes("function comparisonTable"),"cashier, peak-hour, and weekday comparisons must use a shared column renderer");
assert(analyticsSource.includes("<th class=\"r\">MTD</th><th class=\"r\">YTD</th>"),"comparisons must label the two value columns once");
assert(!analyticsSource.includes("MTD ·"),"comparisons must not repeat MTD and YTD labels in every row");
assert(analyticsSource.includes("Top drinks")&&analyticsSource.includes("coverageComplete"),"the vacant-space panel must remain summary-backed and comparisons must require complete coverage");
const analyticsCss=readFileSync("assets/css/admin/analytics.css","utf8");
assert(analyticsCss.includes(".az-meter")&&analyticsCss.includes(".az-analytics-split"),"the compact analytics layout must retain its visual hierarchy and in-cell comparison bars");
console.log("analytics MTD/YTD checks passed");
