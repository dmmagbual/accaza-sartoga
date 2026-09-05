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

const page=fs.readFileSync(path.join(root,'src','books','app','30-statements-pages.js'),'utf8');
for(const marker of ['Opening cash · before','Cash received from outside the business','Cash paid outside the business'])assert.ok(page.includes(marker),`missing cash-flow presentation marker: ${marker}`);
assert.equal(page.includes('Banking actions · excluded from cash flow'),false,'Cash Flow must not show the Banking Actions card');

console.log('PASS: Cash Flow uses prior-day opening cash, reports external inflows/outflows, excludes internal deposits, and still reconciles.');
