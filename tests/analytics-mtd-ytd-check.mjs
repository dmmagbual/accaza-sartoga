import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {addLiveSales,canonicalCashierName,reconcileCashierSales,summarizeHistoricalSales} from "../assets/js/admin/historical-sales-summary.mjs";

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
assert.equal(canonicalCashierName("OWNER"),"Maria","OWNER sales belong to Maria");
assert.equal(canonicalCashierName(""),"Maria","sales without a cashier belong to Maria");
assert.equal(canonicalCashierName("Alex"),"Alex");assert.equal(canonicalCashierName("LOUIZE"),"Louize");assert.equal(canonicalCashierName("Rya"),"Rya");
const cashierControl=reconcileCashierSales({net:150,cashiers:{owner:{name:"OWNER",orders:1,net:40},blank:{name:"Unassigned",orders:1,net:10},rya:{name:"Rya",orders:1,net:20},alex:{name:"Alex",orders:1,net:30},louize:{name:"Louize",orders:1,net:40}}});
assert.deepEqual(Object.keys(cashierControl),["maria","rya","alex","louize"],"existing names in historical summaries must remain available");
assert.equal(cashierControl.maria.net,60,"Maria receives OWNER, unassigned and any reconciliation residual");
assert.equal(Object.values(cashierControl).reduce((sum,row)=>sum+row.net,0),150,"cashier YTD must equal the same YTD net-sales total used elsewhere");

const roster = [{id:"staff_j",name:"Justine"},{id:"staff_n",name:"Nikko"},{id:"former",name:"Former Cashier",active:false}];
const period = {startAt:Date.parse("2026-09-01T00:00:00+08:00"),endAt:Date.parse("2026-09-02T23:59:59.999+08:00")};
assert.equal(reconcileCashierSales(mtd,roster).staff_id_staff_n.net,0,"a cashier appears before recording the first sale");
assert.equal(reconcileCashierSales(mtd,roster).staff_id_former,undefined,"inactive staff without sales do not add empty chart rows");
const clerk = {soldBy:"Previous name",soldByStaffId:"staff_j",timestamp:period.startAt};
const live = addLiveSales(summarizeHistoricalSales(months,period),[clerk],period,{qualifies:()=>true,stamp:order=>order.timestamp,amounts:()=>({gross:35,discount:0,refund:0,net:35}),paymentKey:()=>"cash"});
const liveRows = reconcileCashierSales(live,roster);
assert.equal(liveRows.staff_id_staff_j.net,35,"live sales must follow the cashier's stable staff ID");
assert.equal(liveRows.maria.net,30,"new-cashier sales must not fall into Maria's total");
assert.equal(Object.values(liveRows).reduce((sum,row)=>sum+row.net,0),live.net,"adding roster names must preserve total sales");
const archivedRows = reconcileCashierSales({net:70,cashiers:{staff_nikko:{name:"NIKKO",net:40,orders:1},staff_id_former:{name:"Old display name",net:30,orders:1}}},roster);
assert.equal(archivedRows.staff_id_staff_n.net,40,"historical sales without staff IDs can match the saved cashier name");
assert.equal(archivedRows.staff_id_former.net,30,"inactivating a cashier does not erase past sales");
const keptStaff = reconcileCashierSales({net:70,cashiers:{staff_cashier_removed:{name:"Former Cashier",net:30,orders:1},staff_cashier_staff_j:{name:"Justine",net:40,orders:1}}},[...roster,{id:"same-name",name:"Justine"}]);
assert.equal(keptStaff.staff_id_removed.net,30,"the saved seller identity survives roster removal");
assert.equal(keptStaff.staff_id_staff_j.net,40,"cashiers with the same name keep separate totals");
assert.equal(keptStaff["staff_id_same-name"].net,0);

const analyticsSource = readFileSync("src/admin/analytics/10-sales-model-history.js","utf8");
for(const marker of ["function cashierPie","function topDrinkGrid","function peakHourChart","function weekdayLineChart","Top 12 drinks · YTD","coverageComplete"])assert(analyticsSource.includes(marker),`analytics chart contract missing: ${marker}`);
assert(analyticsSource.includes("slice(0,12)"),"Top drinks must display twelve YTD rows");
assert(!analyticsSource.includes("overflow-x:auto"),"approved analytics charts must not require a horizontal scrollbar");
const analyticsCss=readFileSync("assets/css/admin/analytics.css","utf8");
for(const marker of [".az-cashier-pies",".az-drink-grid",".az-peak-hours",".az-weekday-chart"])assert(analyticsCss.includes(marker),`analytics chart style missing: ${marker}`);
console.log("analytics MTD/YTD checks passed");
