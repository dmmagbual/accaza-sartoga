import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync('src/admin/analytics/30-daily-close-report.js','utf8');
const adminCore=fs.readFileSync('assets/js/admin/core.mjs','utf8');
if(!adminCore.includes('query,orderByChild,equalTo,startAt,endAt,callables'))throw new Error('Admin API does not expose the range-query constraints used by Daily Report.');
const prefix=source.slice(0,source.indexOf('function renderDailyReport'));
const calls=[];
const context={
  financialCloseState:{},financialCloseLoading:{},
  esc:value=>String(value),peso:value=>String(value),
  A:()=>({db:{},ref:(_db,path)=>path,orderByChild:key=>({orderByChild:key}),startAt:value=>({startAt:value}),endAt:value=>({endAt:value}),query:(...parts)=>{calls.push(parts);return parts;},get:async()=>({val:()=>({closed:{status:'closed'}})})})
};
vm.createContext(context);vm.runInContext(prefix,context);

const empty=context.closeControlHtml('2026-09-14',[],false);
if(!empty.includes('No closed shifts for this trading day')||!empty.includes('id="drRunShiftClose" disabled'))throw new Error('Empty Daily Report shift selector is not explained and disabled.');
const failed=context.closeControlHtml('2026-09-14',[],true);
if(!failed.includes('Could not load closed shifts')||!failed.includes('Check your connection or access'))throw new Error('Shift-load failure is still presented as an empty list.');
const ready=context.closeControlHtml('2026-09-14',[{id:'SH-1',shiftReference:'SHIFT-REF',staff:'Cashier',open:false}],false);
if(!ready.includes('SHIFT-REF · Cashier')||ready.includes('id="drRunShiftClose" disabled'))throw new Error('Eligible closed shift is not selectable by its human-readable reference.');

await context.loadDailyShifts('2026-09-14');
const query=calls.at(-1);
if(!query||query[0]!=='shifts'||query[1].orderByChild!=='openAt'||query[2].startAt!==Date.parse('2026-09-14T00:00:00+08:00')||query[3].endAt-query[2].startAt!==86399999)throw new Error('Daily Report shift read is not bounded to the selected Philippine trading day by indexed openAt.');
console.log('Daily Report closed-shift selector checks passed.');
