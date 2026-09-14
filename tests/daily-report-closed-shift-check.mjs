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

const cash=context.drShiftCash({status:'closed',openingFloat:100,zReport:{openingFloat:100,cashSales:500,tips:20,payIns:50,cashRefunds:10,payOuts:30,expectedCash:630,countedCash:625,actualFloatRetained:100,cashToSettle:525}},{cash:500});
if(cash.calculated!==630||cash.expected!==630||cash.counted!==625||cash.variance!==-5||cash.retained!==100||cash.settle!==525)throw new Error('Shift cash accountability equation does not reconcile expected, counted, variance, retained float and handover.');
if(!source.includes('Shift Cash Accountability')||!source.includes('Expected drawer = opening float + cash sales + cash tips + cash in')||!source.includes('data-dr-shift-close')||!source.includes('Online / no-shift sales')||!source.includes('Shift data could not load'))throw new Error('Shift-first cash accountability surface is incomplete.');
for(const marker of ['function drReconciliation(rows)','Sales Control','Tender variance','Itemized bridge variance','No item-level detail (unitemized sales)','Refunds</th>','Platform fees (expense only)','Revenue sales</th>','Commission expense','Show calculation and exceptions'])if(!source.includes(marker))throw new Error(`Daily Report reconciliation safeguard missing: ${marker}`);
if(source.includes('<th class="r">Commission</th>'))throw new Error('Sales by channel must not present commission as a sales deduction column.');
const rec=context.drReconciliation([
  {id:'A',dateTime:'14 Sep 2026 · 10:00 AM',net:90,discount:10,refund:0,paymentAmount:100,lineSales:110,hasLines:true,paymentKnown:true},
  {id:'B',dateTime:'14 Sep 2026 · 11:00 AM',net:50,discount:0,refund:5,paymentAmount:55,lineSales:0,hasLines:false,paymentKnown:true}
]);
if(rec.channelNet!==140||rec.tenderBeforeRefunds!==155||rec.refunds!==5||rec.netTender!==150||rec.tenderVariance!==10)throw new Error('Daily Report tender bridge does not quantify tender-versus-revenue variance.');
if(rec.itemizedLineSales!==110||rec.itemizedDiscounts!==10||rec.itemizedRefunds!==0||rec.unitemizedNet!==50||rec.lineBasisDifference!==-10||rec.itemBridgeTotal!==140||rec.itemBridgeVariance!==0)throw new Error('Daily Report itemized bridge does not reconcile line detail to net sales.');
if(!rec.issues.some(x=>x.reason==='No item-level detail (unitemized sales)'&&x.id==='B')||!rec.issues.some(x=>x.reason==='Payment tender differs from revenue basis'&&x.id==='A'))throw new Error('Daily Report reconciliation variance detail does not retain order-level explanations.');

await context.loadDailyShifts('2026-09-14');
const query=calls.at(-1);
if(!query||query[0]!=='shifts'||query[1].orderByChild!=='openAt'||query[2].startAt!==Date.parse('2026-09-14T00:00:00+08:00')||query[3].endAt-query[2].startAt!==86399999)throw new Error('Daily Report shift read is not bounded to the selected Philippine trading day by indexed openAt.');
console.log('Daily Report shift cash accountability checks passed.');
