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

const beforeMidnight=Date.parse('2026-09-14T23:55:00+08:00'),afterMidnight=Date.parse('2026-09-15T00:10:00+08:00');
const ordered=context.drSortTransactions([{id:'after',occurredAt:afterMidnight},{id:'legacy',occurredAt:0},{id:'before',occurredAt:beforeMidnight}]);
if(ordered.map(row=>row.id).join(',')!=='before,after,legacy')throw new Error('Daily Report transactions are not ordered by full date and time with undated legacy rows last.');
const displayed=context.drTransactionDateTime(afterMidnight,'','');
if(!displayed.includes('15')||!displayed.includes('Sep')||!displayed.includes('2026')||!displayed.match(/12:10/))throw new Error('Daily Report does not display the Philippine calendar date and time across midnight.');
if(context.drTransactionDateKey(beforeMidnight,'')!=='09/14/2026'&&context.drTransactionDateKey(beforeMidnight,'')!=='2026-09-14')throw new Error('Daily Report cannot identify the Philippine trading-date badge.');
if(context.drTransactionDateKey(afterMidnight,'')!=='09/15/2026'&&context.drTransactionDateKey(afterMidnight,'')!=='2026-09-15')throw new Error('Daily Report cannot identify the after-midnight date badge.');
if(context.drTransactionDateTime(0,'2026-09-01','Legacy time')!=='2026-09-01 · Legacy time')throw new Error('Legacy transaction date/time fallback was lost.');
if(!source.includes('<th>Date &amp; time</th>')||!source.includes("[['Date & time','Order','Channel','Method','Amount','Refund']]")||source.includes("tx.push([t.time,t.id"))throw new Error('Daily Report screen and Excel export do not share the full date-and-time display.');
for(const marker of ['After midnight · same trading shift','Trading-date transaction','t.dateKey&&t.dateKey!==d'])if(!source.includes(marker))throw new Error(`Daily Report date highlighting safeguard missing: ${marker}`);
const registerSource=fs.readFileSync('src/admin/register/80-shift-lifecycle-zreport.js','utf8');
for(const marker of ['function saleStamp(o)','function saleDateTime(o)',"timeZone:'Asia/Manila'",'occurredAt:(window.AccazaSales'])if(!registerSource.includes(marker))throw new Error(`Shift Z-report date/time safeguard missing: ${marker}`);

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
