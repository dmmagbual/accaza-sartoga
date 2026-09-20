import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root=path.join(import.meta.dirname,'..');
let source=fs.readFileSync(path.join(root,'src','books','app','20-cash-flow.js'),'utf8');
assert.ok(source.includes("let CF_TO=todayStr(), CF_FROM=CF_TO.slice(0,8)+'01';"),'Cash Flow must default to the current month through today');
source=source.replace("let CF_TO=todayStr(), CF_FROM=CF_TO.slice(0,8)+'01';","let CF_FROM='2026-09-01', CF_TO='2026-09-06';");
source+='\nglobalThis.__cashFlowTest={cfStatement};';

const stamp=date=>Date.parse(date+'T12:00:00+08:00');
const line=(account,debit,credit)=>({account,debit,credit});
const context={
  window:{
    __cfAccounts:{security458:{name:'Security Bank-4538',opening:13050,openingDate:'2026-09-01'}},
    __financialMovements:{
      opening:{id:'opening',type:'opening_balance',sourceType:'cashAccount',sourceId:'security458',occurredAt:stamp('2026-08-31'),lines:[line('asset:cash_account:security458',13050,0),line('equity:opening_balance',0,13050)]},
      sale:{id:'sale',type:'order_sale',sourceType:'order',sourceId:'sale1',occurredAt:stamp('2026-09-02'),lines:[line('asset:cash_awaiting_deposit',5000,0),line('revenue:sales',0,5000)]},
      expense:{id:'expense',type:'petty_cash_expense',sourceType:'pettyVoucher',sourceId:'pv1',occurredAt:stamp('2026-09-03'),lines:[line('expense:operations',1000,0),line('asset:cash_awaiting_deposit',0,1000)]},
      deposit:{id:'deposit',type:'register_cash_deposit',sourceType:'cashDeposit',sourceId:'dep1',occurredAt:stamp('2026-09-04'),lines:[line('asset:cash_account:security458',4000,0),line('asset:cash_awaiting_deposit',0,4000)]}
    }
  },
  App:{},
  ENTRIES:()=>[],
  r2:value=>Math.round((Number(value)||0)*100)/100,
  todayStr:()=> '2026-09-06',
  console,
  Intl,
  Date,
  Object,
  Number,
  String,
  Array,
  Set,
  Math
};
// Cash Flow reads the period's movements plus server cash indexes (Sep 2026); build both
// from the same full ledger the way the server and the Books feed do.
const {createRequire}=await import('node:module');
const CashBalances=createRequire(import.meta.url)('../functions/lib/cash-balances.js');
const basisContext=vm.createContext({});vm.runInContext(fs.readFileSync(path.join(root,'assets','js','shared','cash-flow-basis.js'),'utf8'),basisContext);
function useLedger(all,from,to){
  const flow=CashBalances.splitSnapshotFromMovements(all,stamp(to)).flow;
  const start=Date.parse(from+'T00:00:00+08:00'),end=Date.parse(to+'T23:59:59.999+08:00');
  Object.assign(context.window,{__financialMovements:Object.fromEntries(Object.entries(all).filter(([,m])=>m.occurredAt>=start&&m.occurredAt<=end)),__cashFlowPeriodReady:true,__cashFlowMonthly:flow.monthly,__cashFlowMonthlyReady:true,__cashFlowOpenings:flow.openings,__cashFlowOpeningsReady:true,__cashFlowIndexMeta:flow.meta,__cashFlowDaily:flow.daily,__cashFlowDailyMonth:from.slice(0,7),__cashFlowGroups:{},AccazaCashFlowBasis:basisContext.AccazaCashFlowBasis});
}
useLedger(context.window.__financialMovements,'2026-09-01','2026-09-06');
vm.createContext(context);
vm.runInContext(source,context);
const result=context.__cashFlowTest.cfStatement();

assert.equal(result.begin.security458||0,0,'a legacy opening movement timestamp must not override the cash account opening date');
assert.equal(result.add['Opening funds introduced'],13050,'funds effective on the From date must be disclosed as a period inflow');
assert.equal(result.add.Sales,5000,'cash sales remain external cash received');
assert.equal(result.ded['Cash expenses from Undeposited Collection'],1000,'operating cash expenses remain external cash paid');
assert.equal(result.totEnd,17050,'internal transfer preserves total closing cash');
assert.equal(result.detail.some(row=>row.id==='deposit'),false,'Undeposited-to-bank transfer must not appear as cash-flow activity');
assert.equal(result.totBegin+result.totAdd-result.totDed+result.corrections,result.totEnd,'restructured statement must reconcile');

context.window.__cfAccounts={security458:{name:'Security Bank-4538',opening:10050,openingDate:'2026-08-23'}};
useLedger({
  opening:{id:'opening',type:'opening_balance',sourceType:'cashAccount',sourceId:'security458',occurredAt:stamp('2026-08-23'),lines:[line('asset:cash_account:security458',10050,0),line('equity:opening_balance',0,10050)]},
  draw:{id:'draw',type:'manual_books_owner_draw',sourceType:'booksManualJournal',sourceId:'draw25',occurredAt:stamp('2026-08-25'),lines:[line('equity:owner_draw',10050,0),line('asset:cash_account:security458',0,10050)]}

},'2026-09-01','2026-09-06');
const withdrawn=context.__cashFlowTest.cfStatement();
assert.equal(withdrawn.begin.security458||0,0,'an August Security Bank opening fully withdrawn before September must produce a zero September opening balance');
assert.equal(withdrawn.totBegin,0,'the consolidated September opening must include both sides of prior-period Security Bank activity');

const live=fs.readFileSync(path.join(root,'assets','js','books','live-pos.mjs'),'utf8');
// Prior activity comes from the server cash indexes (proven complete by the withdrawn-opening case
// above), so the movement feed itself is bounded to the report period.
assert.ok(live.includes('query(ref(db,"/financialMovements"),orderByChild("occurredAt"),startAt(p.startAt),endAt(p.endAt))'),'the Finance movement feed must be bounded to the report period');
for(const node of ['/cashFlowMonthly','/cashFlowDaily','/cashFlowOpenings','/cashFlowIndexMeta'])assert.ok(live.includes(`ref(db,"${node}")`),`the Cash Flow tab must read ${node}`);

const page=fs.readFileSync(path.join(root,'src','books','app','30-statements-pages.js'),'utf8');
for(const marker of ['Opening cash · before','Cash received from outside the business','Cash paid outside the business'])assert.ok(page.includes(marker),`missing cash-flow presentation marker: ${marker}`);
assert.equal(page.includes('Banking actions · excluded from cash flow'),false,'Cash Flow must not show the Banking Actions card');

console.log('PASS: Cash Flow derives complete prior activity from the cash indexes, derives zero after a fully withdrawn Security Bank opening, reports external flows, excludes internal deposits, and reconciles.');
