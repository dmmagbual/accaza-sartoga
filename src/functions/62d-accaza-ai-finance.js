// Accaza AI finance reasoning layer (Oct 2026, Danilo). Accaza AI answers as the combined
// finance professional for Accaza Coffee House: financial analyst, bookkeeper, CFO and senior
// accountant. This section supplies five READ-ONLY finance tools that read the same derived
// summaries Finance Books reporting uses: position (trial balance and balance sheet with the
// assets = liabilities + equity + result check), performance (a period's revenue, cost of sales
// and operating expenses with account detail and a comparison period), account detail, health
// (ratios, working capital, control reconciliation) and forecast. The persona and the reasoning,
// proactive and finance instructions live with the other instructions in 62-accaza-chat.js, where
// the provider prompts are built.
//
// Accounting basis. The ledger summaries store each entry's net as debit minus credit, so a
// debit-normal account (Asset, COGS, Expense) is positive in its natural direction and a
// credit-normal account (Liability, Equity, Income) is positive when negated. Every figure here
// is a posted Finance Books accounting amount, never cash flow.
//
// Cost. No new listener, trigger, schedule or poll. Per question: one bounded read of the chart
// of accounts, one read of the monthly per-account ledger summary (one compact row per month),
// a bounded /books/dailyNet day range only for a partial month, and indexed bounded queries for
// payables, receivables, uncosted sales and close follow-ups. The record-tool wrapper meters
// every Realtime Database read, so the per-question 8 MB and per-day 50 MB AI allowances and the
// 2,500-record question budget still apply. Nothing here writes any record.
const ACCAZA_AI_FINANCE_MAX_DAYS = 92;
const ACCAZA_AI_FINANCE_MAX_MONTHS = 24;
const ACCAZA_AI_FINANCE_FORECAST_MAX_MONTHS = 3;
const ACCAZA_AI_FINANCE_ROW_LIMIT = 25;
// Finance Books control accounts, as printed by the Finance Books reconciliation screens.
const ACCAZA_AI_FINANCE_CONTROLS = {platformReceivable: "1100", otherReceivable: "1110", supplierAdvances: "1115", payables: "2000"};
const ACCAZA_AI_FINANCE_DEBIT_NORMAL = {Asset: true, COGS: true, Expense: true, Liability: false, Equity: false, Income: false};
function accazaAiFinanceLastDay(month){return new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).getUTCDate();}
function accazaAiFinancePreviousMonth(month){const [year,index]=month.split("-").map(Number);return index===1?`${year-1}-12`:`${year}-${String(index-1).padStart(2,"0")}`;}
function accazaAiFinanceAdd(target,row,weight){const factor=weight===undefined?1:Number(weight)||0;Object.entries(row||{}).forEach(([code,value])=>{const amount=accazaAiMoney((Number(value)||0)*factor);if(!amount)return;target[code]=accazaAiMoney(Number(target[code]||0)+amount);});return target;}
function accazaAiFinanceCumulative(books,throughMonth){const net={};books.months.forEach(month=>{if(month>throughMonth)return;accazaAiFinanceAdd(net,books.monthly[month]);});return net;}
function accazaAiFinanceIsDay(value){return /^\d{4}-\d{2}-\d{2}$/.test(String(value||"").trim())&&Number.isFinite(Date.parse(`${String(value).trim()}T00:00:00+08:00`));}
function accazaAiFinanceDays(args,defaultDay,maxDays){const from=String(args&&args.period_from||defaultDay||"").trim(),to=String(args&&args.period_to||"").trim()||from;if(!accazaAiFinanceIsDay(from)||!accazaAiFinanceIsDay(to))return{error:"Use dates as YYYY-MM-DD (Manila)."};const dayCount=Math.round((Date.parse(`${to}T00:00:00+08:00`)-Date.parse(`${from}T00:00:00+08:00`))/86400000)+1;if(dayCount<1)return{error:"period_from is after period_to."};if(dayCount>maxDays)return{error:`That period is ${dayCount} days; this tool reads at most ${maxDays} days at a time. Ask for a shorter period.`};return{from,to,dayCount};}
// The whole-node reads below are the two small derived summaries Finance Books reporting already
// uses; they are read once per question and memoised on the question's context, and the metered
// database handle counts their bytes like every other record-tool read.
function accazaAiFinanceBooks(db,ctx){
  if(!ctx.financeBooks)ctx.financeBooks=Promise.all([
    /* download-ok: catalog chart-of-accounts configuration, not business history */db.ref("/booksChart").get(),
    /* download-ok: bounded monthly per-account ledger totals (one compact row per month), the derived summary Finance Books reporting uses; the journal history itself is never read */db.ref("/books/monthlyNet").get(),
    db.ref("/books/monthlyNetMeta").get(),
  ]).then(([chartSnap,monthlySnap,metaSnap])=>{const monthly=monthlySnap.val()||{};return{chart:chartSnap.val()||{},monthly,meta:metaSnap.val()||{},months:Object.keys(monthly).filter(month=>/^\d{4}-\d{2}$/.test(month)).sort()};}).catch(error=>({error:`Could not read the Finance Books ledger summaries (${accazaAiText(error&&error.message,120)}).`}));
  return ctx.financeBooks;
}
function accazaAiFinanceOperational(db,ctx){
  if(!ctx.financeOperational)ctx.financeOperational=Promise.all([
    db.ref("/cashBalanceSummary/balances").get(),
    db.ref("/payables").orderByChild("status").equalTo("open").limitToLast(200).get(),
    db.ref("/receivables").orderByChild("status").equalTo("open").limitToLast(200).get(),
    /* download-ok: bounded month-by-month accounting-period control flags, one small row per month, not business history */db.ref("/accountingPeriods").get(),
    db.ref("/uncostedSales").orderByChild("status").equalTo("open").limitToFirst(200).get(),
    db.ref("/shiftCloseFollowUps").orderByChild("state").equalTo("open").limitToFirst(50).get(),
  ]).then(([cashSnap,payablesSnap,receivablesSnap,periodsSnap,uncostedSnap,followUpsSnap])=>({cash:cashSnap.val()||{},payables:accazaAiValues(payablesSnap),receivables:accazaAiValues(receivablesSnap),periods:periodsSnap.val()||{},uncosted:accazaAiValues(uncostedSnap),followUps:accazaAiValues(followUpsSnap)})).catch(error=>{ctx.financeOperational=null;return{error:`Could not read the finance control records (${accazaAiText(error&&error.message,120)}).`};});
  return ctx.financeOperational;
}
const ACCAZA_AI_FINANCE_SUBLEDGER_SKIP = /(token|secret|password|passcode|email|phone|mobile|photo|image|proof|signature|hash$)/i;
function accazaAiFinanceSubledger(rows,label){const open=(rows||[]).filter(row=>String(row&&row.status||"open")==="open"),remaining=row=>accazaAiMoney(row&&row.remainingAmount!=null?row.remainingAmount:row&&row.amount);return{label,openCount:open.length,total:accazaAiMoney(open.reduce((total,row)=>total+remaining(row),0)),rows:open.slice(0,20).map(row=>accazaAiCompact(Object.fromEntries(Object.entries(row).filter(([field])=>!ACCAZA_AI_FINANCE_SUBLEDGER_SKIP.test(field))),1))};}
function accazaAiFinanceCashAccounts(cash){return Object.entries(cash||{}).map(([id,row])=>({account:id,name:accazaAiText(row&&(row.name||row.label)||id,60),balance:accazaAiMoney(row&&row.balance)}));}
function accazaAiFinanceAccountRows(chart,net,types,limit){const allowed=Array.isArray(types)?types:[types];const rows=Object.entries(net||{}).map(([code,value])=>{const account=chart[code]||{},type=String(account.type||"");if(!allowed.includes(type))return null;const debitNormal=ACCAZA_AI_FINANCE_DEBIT_NORMAL[type]!==false,amount=accazaAiMoney(debitNormal?(Number(value)||0):-(Number(value)||0));return Math.abs(amount)<0.005?null:{code,name:accazaAiText(account.name||code,80),type,amount,debitNormal};}).filter(Boolean).sort((left,right)=>Math.abs(right.amount)-Math.abs(left.amount));const shown=rows.slice(0,limit||ACCAZA_AI_FINANCE_ROW_LIMIT),rest=rows.slice(shown.length);return{rows:shown,accountCount:rows.length,otherAccountCount:rest.length,otherAmount:accazaAiMoney(rest.reduce((total,row)=>total+row.amount,0))};}
function accazaAiFinanceTypeTotal(chart,net,types){const allowed=Array.isArray(types)?types:[types];let total=0;Object.entries(net||{}).forEach(([code,value])=>{const account=chart[code]||{},type=String(account.type||"");if(!allowed.includes(type))return;total+=(ACCAZA_AI_FINANCE_DEBIT_NORMAL[type]!==false?1:-1)*(Number(value)||0);});return accazaAiMoney(total);}
function accazaAiFinanceTrialBalance(chart,net){let debit=0,credit=0;const offChart=[];Object.entries(net||{}).forEach(([code,value])=>{if(!chart[code])offChart.push(code);const amount=Number(value)||0;if(amount>0)debit+=amount;else credit-=amount;});return{debitTotal:accazaAiMoney(debit),creditTotal:accazaAiMoney(credit),difference:accazaAiMoney(debit-credit),offChartAccountCount:offChart.length,offChartAccountCodes:offChart.slice(0,10)};}
function accazaAiFinanceBalanceSheet(chart,net){
  let assets=0,liabilities=0,equity=0,income=0,costOfSales=0,operatingExpense=0,unbalancedLedger=0;
  Object.entries(net||{}).forEach(([code,value])=>{const type=String((chart[code]||{}).type||""),amount=Number(value)||0;unbalancedLedger+=amount;if(type==="Asset")assets+=amount;else if(type==="Liability")liabilities-=amount;else if(type==="Equity")equity-=amount;else if(type==="Income")income-=amount;else if(type==="COGS")costOfSales+=amount;else if(type==="Expense")operatingExpense+=amount;});
  const accumulated=accazaAiMoney(accazaAiMoney(income)-accazaAiMoney(costOfSales)-accazaAiMoney(operatingExpense)),totalLiabilitiesEquity=accazaAiMoney(accazaAiMoney(liabilities)+accazaAiMoney(equity)+accumulated),totalAssets=accazaAiMoney(assets);
  return{assets:totalAssets,liabilities:accazaAiMoney(liabilities),equity:accazaAiMoney(equity),revenueToDate:accazaAiMoney(income),costOfSalesToDate:accazaAiMoney(costOfSales),operatingExpenseToDate:accazaAiMoney(operatingExpense),accumulatedResult:accumulated,liabilitiesPlusEquity:totalLiabilitiesEquity,difference:accazaAiMoney(totalAssets-totalLiabilitiesEquity),sumOfAllAccountNets:accazaAiMoney(unbalancedLedger),workingCapital:accazaAiMoney(totalAssets-accazaAiMoney(liabilities)),workingCapitalBasis:"all asset balances less all liability balances (every asset and liability is treated as current, so this is a proxy)"};
}
function accazaAiFinancePctChange(current,previous){return Number(previous)?accazaAiMoney(((Number(current)||0)-(Number(previous)||0))/Math.abs(Number(previous))*100):null;}
// Days-of-month classification: whole months come from the monthly summary (one row each), only a
// partial month reads /books/dailyNet over the days asked.
async function accazaAiFinanceMonthPart(books,db,month,throughDay){
  const last=accazaAiFinanceLastDay(month),endsWithMonth=throughDay>=last;
  if(endsWithMonth&&books.monthly[month]!==undefined)return{net:books.monthly[month]||{},sources:[`books/monthlyNet/${month}`]};
  if(endsWithMonth&&!accazaAiFinanceAnyMonthActivity(books,month))return{net:{},sources:[`books/monthlyNet/${month} (no posted movement)`]};
  const dayList=[];for(let day=1;day<=Math.min(throughDay,last);day+=1)dayList.push(`${month}-${String(day).padStart(2,"0")}`);
  const snap=await db.ref("/books/dailyNet").orderByKey().startAt(dayList[0]).endAt(dayList[dayList.length-1]).get(),rows=snap.val()||{},net={};
  dayList.forEach(day=>{if(rows[day])accazaAiFinanceAdd(net,rows[day]);});
  return{net,sources:[`books/dailyNet ${dayList[0]} to ${dayList[dayList.length-1]} (${dayList.length} days)`]};
}
function accazaAiFinanceAnyMonthActivity(books,month){return Boolean(books.monthly[month]&&Object.keys(books.monthly[month]).length);}
async function accazaAiFinancePeriodNet(books,db,from,to){
  const months=new Set();for(let at=Date.parse(`${from}T00:00:00+08:00`),end=Date.parse(`${to}T00:00:00+08:00`);at<=end;at+=86400000)months.add(accazaAiDay(at).slice(0,7));
  const net={},sources=[];
  for(const month of [...months].sort()){
    const monthFirst=`${month}-01`,monthLast=`${month}-${String(accazaAiFinanceLastDay(month)).padStart(2,"0")}`,first=from>monthFirst?from:monthFirst,last=to<monthLast?to:monthLast;
    if(first===monthFirst&&last===monthLast){const whole=await accazaAiFinanceMonthPart(books,db,month,Number(monthLast.slice(8,10)));accazaAiFinanceAdd(net,whole.net);sources.push(...whole.sources);continue;}
    const upto=await accazaAiFinanceMonthPart(books,db,month,Number(last.slice(8,10)));accazaAiFinanceAdd(net,upto.net);sources.push(...upto.sources);
    if(first!==monthFirst){const before=await accazaAiFinanceMonthPart(books,db,month,Number(first.slice(8,10))-1);accazaAiFinanceAdd(net,before.net,-1);sources.push(...before.sources);}
  }
  return{net,sources:[...new Set(sources)]};
}
function accazaAiFinanceStatement(chart,net){
  const revenue=accazaAiFinanceTypeTotal(chart,net,["Income"]),costOfSales=accazaAiFinanceTypeTotal(chart,net,["COGS"]),operatingExpense=accazaAiFinanceTypeTotal(chart,net,["Expense"]),grossProfit=accazaAiMoney(revenue-costOfSales),operatingResult=accazaAiMoney(grossProfit-operatingExpense);
  return{revenue,costOfSales,operatingExpense,grossProfit,operatingResult,grossMarginPct:accazaAiPct(grossProfit,revenue),operatingMarginPct:accazaAiPct(operatingResult,revenue),costOfSalesPctOfRevenue:accazaAiPct(costOfSales,revenue),operatingExpensePctOfRevenue:accazaAiPct(operatingExpense,revenue)};
}
function accazaAiFinanceMonthsFor(today,count){const months=[];let month=accazaAiFinancePreviousMonth(today.slice(0,7));for(let index=0;index<count;index+=1){months.unshift(month);month=accazaAiFinancePreviousMonth(month);}return months;}
function accazaAiFinanceMonthRevenueSeries(books,monthList){return monthList.map(month=>{const net=books.monthly[month]||{},statement=accazaAiFinanceStatement(books.chart,net);return{month,revenue:statement.revenue,costOfSales:statement.costOfSales,operatingExpense:statement.operatingExpense,grossProfit:statement.grossProfit,operatingResult:statement.operatingResult,grossMarginPct:statement.grossMarginPct,postedMovement:Object.keys(net).length>0};});}
function accazaAiFinanceTrend(values){const points=values.map((value,index)=>({x:index,y:Number(value)||0}));if(points.length<2)return{slope:0,average:accazaAiMoney(points.length?points[0].y:0),deviation:0};const count=points.length,meanX=points.reduce((total,point)=>total+point.x,0)/count,meanY=points.reduce((total,point)=>total+point.y,0)/count,denominator=points.reduce((total,point)=>total+(point.x-meanX)*(point.x-meanX),0),slope=denominator?points.reduce((total,point)=>total+(point.x-meanX)*(point.y-meanY),0)/denominator:0;const deviation=count>2?Math.sqrt(points.reduce((total,point)=>total+(point.y-meanY)*(point.y-meanY),0)/(count-1)):0;return{slope:accazaAiMoney(slope),average:accazaAiMoney(meanY),deviation:accazaAiMoney(deviation)};}

Object.assign(ACCAZA_AI_RECORD_TOOLS,{
  get_finance_position:{
    description:"Finance Books position as of a Manila date (YYYY-MM-DD, default today): the trial balance by account with debit and credit totals, the balance sheet (assets, liabilities, equity, revenue, cost of sales, operating expenses and the accumulated result) with the assets = liabilities + equity + result check, cash by account, open receivables and payables with their control-account balances (1100, 1110, 1115, 2000), working capital and control flags. Posted accounting balances, not cash flow.",
    reserve:820,
    optional:{as_of:{type:"string",description:"As-of Manila date, YYYY-MM-DD. Defaults to today."}},
    async run(db,_range,args,ctx){
      const books=await accazaAiFinanceBooks(db,ctx);if(books.error)return{records:0,result:{error:books.error}};
      const today=accazaAiDay(Date.now()),requested=String(args&&args.as_of||"").trim(),asOf=requested||today;
      if(!accazaAiFinanceIsDay(asOf))return{records:0,result:{error:"Use as_of as YYYY-MM-DD (Manila)."}};
      if(asOf>today)return{records:0,result:{error:`as_of cannot be later than today (${today}).`}};
      const operational=await accazaAiFinanceOperational(db,ctx);if(operational.error)return{records:0,result:{error:operational.error}};
      const month=asOf.slice(0,7),prior=accazaAiFinanceCumulative(books,accazaAiFinancePreviousMonth(month)),monthPart=await accazaAiFinanceMonthPart(books,db,month,Number(asOf.slice(8,10))),net=accazaAiFinanceAdd(accazaAiFinanceAdd({},prior),monthPart.net);
      const trialBalance=accazaAiFinanceTrialBalance(books.chart,net),balanceSheet=accazaAiFinanceBalanceSheet(books.chart,net),cashAccounts=accazaAiFinanceCashAccounts(operational.cash),receivables=accazaAiFinanceSubledger(operational.receivables,"open receivables subledger"),payables=accazaAiFinanceSubledger(operational.payables,"open supplier payables subledger");
      const control=code=>accazaAiMoney((ACCAZA_AI_FINANCE_DEBIT_NORMAL[String((books.chart[code]||{}).type||"Asset")]!==false?1:-1)*(Number(net[code])||0));
      const flags=[];
      if(Math.abs(trialBalance.difference)>=0.01)flags.push(`The posted ledger does not balance: debits ${trialBalance.debitTotal} less credits ${trialBalance.creditTotal} = ${trialBalance.difference}. Report this, do not explain it away.`);
      if(Math.abs(balanceSheet.difference)>=0.01)flags.push(`Assets do not equal liabilities plus equity plus the accumulated result by ${balanceSheet.difference}.`);
      if(trialBalance.offChartAccountCount)flags.push(`${trialBalance.offChartAccountCount} account code(s) with movement are not in the chart of accounts: ${trialBalance.offChartAccountCodes.join(", ")}.`);
      cashAccounts.filter(row=>row.balance<0).forEach(row=>flags.push(`Cash account ${row.name} shows a negative balance of ${row.balance}.`));
      const receivableGap=accazaAiMoney(receivables.total-control(ACCAZA_AI_FINANCE_CONTROLS.otherReceivable)),payablesGap=accazaAiMoney(payables.total-control(ACCAZA_AI_FINANCE_CONTROLS.payables));
      if(Math.abs(receivableGap)>=0.01)flags.push(`Open receivables ${receivables.total} differ from control account ${ACCAZA_AI_FINANCE_CONTROLS.otherReceivable} (${control(ACCAZA_AI_FINANCE_CONTROLS.otherReceivable)}) by ${receivableGap}.`);
      if(Math.abs(payablesGap)>=0.01)flags.push(`Open payables ${payables.total} differ from control account ${ACCAZA_AI_FINANCE_CONTROLS.payables} (${control(ACCAZA_AI_FINANCE_CONTROLS.payables)}) by ${payablesGap}.`);
      return{records:books.months.length+Object.keys(net).length+20,result:{asOf,basis:"posted Finance Books ledger movements (debit less credit), all figures PHP",
        trialBalance:{debitTotal:trialBalance.debitTotal,creditTotal:trialBalance.creditTotal,difference:trialBalance.difference,offChartAccountCount:trialBalance.offChartAccountCount,postedAccounts:Object.keys(net).length,largestBalances:accazaAiFinanceAccountRows(books.chart,net,["Asset","Liability","Equity","Income","COGS","Expense"],ACCAZA_AI_FINANCE_ROW_LIMIT)},
        balanceSheet,workingCapital:balanceSheet.workingCapital,
        cash:{total:accazaAiMoney(cashAccounts.reduce((total,row)=>total+row.balance,0)),accountCount:cashAccounts.length,accounts:cashAccounts.slice(0,12)},
        subledgers:{receivables:{subledgerTotal:receivables.total,openCount:receivables.openCount,controlAccount:`${ACCAZA_AI_FINANCE_CONTROLS.otherReceivable}`,controlBalance:control(ACCAZA_AI_FINANCE_CONTROLS.otherReceivable),difference:receivableGap,rows:receivables.rows},payables:{subledgerTotal:payables.total,openCount:payables.openCount,controlAccount:`${ACCAZA_AI_FINANCE_CONTROLS.payables}`,controlBalance:control(ACCAZA_AI_FINANCE_CONTROLS.payables),difference:payablesGap,rows:payables.rows},platformReceivableControlBalance:control(ACCAZA_AI_FINANCE_CONTROLS.platformReceivable),supplierAdvancesControlBalance:control(ACCAZA_AI_FINANCE_CONTROLS.supplierAdvances)},
        flags,sources:["booksChart","books/monthlyNet",...monthPart.sources,"cashBalanceSummary/balances","payables status=open (latest 200)","receivables status=open (latest 200)"],note:"Accounting balances. Cash, receivables, payables, retained float and profit are separate balances and must be reported separately."}};
    },
  },
  get_finance_performance:{
    description:"Finance Books performance for a Manila period (up to 92 days): revenue by account, cost of sales, operating expenses, gross profit, gross margin, operating result, the expense and cost ratios, revenue per day, plus with compare=true the same figures for the immediately preceding period of equal length and the change in amount and percent, and the largest account movers. Posted accounting amounts, not cash flow.",
    reserve:120,
    optional:{period_from:{type:"string",description:"First Manila date, YYYY-MM-DD. Defaults to today."},period_to:{type:"string",description:"Last Manila date, YYYY-MM-DD (same as period_from for one day)."},compare:{type:"boolean",description:"Also read the immediately preceding period of equal length for comparison."}},
    async run(db,_range,args,ctx){
      const books=await accazaAiFinanceBooks(db,ctx);if(books.error)return{records:0,result:{error:books.error}};
      const today=accazaAiDay(Date.now()),days=accazaAiFinanceDays(args,today,ACCAZA_AI_FINANCE_MAX_DAYS);if(days.error)return{records:0,result:{error:days.error}};
      const current=await accazaAiFinancePeriodNet(books,db,days.from,days.to),statement=accazaAiFinanceStatement(books.chart,current.net);
      const result={period:{from:days.from,to:days.to,days:days.dayCount},basis:"posted Finance Books ledger movements (debit less credit), all figures PHP",revenue:{total:statement.revenue,accounts:accazaAiFinanceAccountRows(books.chart,current.net,["Income"],12)},costOfSales:{total:statement.costOfSales,accounts:accazaAiFinanceAccountRows(books.chart,current.net,["COGS"],12)},operatingExpenses:{total:statement.operatingExpense,accounts:accazaAiFinanceAccountRows(books.chart,current.net,["Expense"],15)},grossProfit:statement.grossProfit,grossMarginPct:statement.grossMarginPct,operatingResult:statement.operatingResult,operatingMarginPct:statement.operatingMarginPct,costOfSalesPctOfRevenue:statement.costOfSalesPctOfRevenue,operatingExpensePctOfRevenue:statement.operatingExpensePctOfRevenue,revenuePerDay:accazaAiMoney(statement.revenue/days.dayCount),operatingResultPerDay:accazaAiMoney(statement.operatingResult/days.dayCount),sources:current.sources};
      if(args&&args.compare===true){
        const previousTo=accazaAiDay(Date.parse(`${days.from}T00:00:00+08:00`)-86400000),previousFrom=accazaAiDay(Date.parse(`${previousTo}T00:00:00+08:00`)-(days.dayCount-1)*86400000),previous=await accazaAiFinancePeriodNet(books,db,previousFrom,previousTo),previousStatement=accazaAiFinanceStatement(books.chart,previous.net);
        const moved=Object.keys(Object.assign({},current.net,previous.net)).map(code=>{const type=String((books.chart[code]||{}).type||"");if(!type)return null;const debitNormal=ACCAZA_AI_FINANCE_DEBIT_NORMAL[type]!==false,now=accazaAiMoney(debitNormal?(Number(current.net[code])||0):-(Number(current.net[code])||0)),before=accazaAiMoney(debitNormal?(Number(previous.net[code])||0):-(Number(previous.net[code])||0));return{code,name:accazaAiText((books.chart[code]||{}).name||code,80),type,current:now,previous:before,change:accazaAiMoney(now-before),changePct:accazaAiFinancePctChange(now,before)};}).filter(row=>row&&Math.abs(row.change)>=0.01).sort((left,right)=>Math.abs(right.change)-Math.abs(left.change)).slice(0,12);
        const pair=(key)=>Object.assign({current:statement[key],previous:previousStatement[key],change:accazaAiMoney(statement[key]-previousStatement[key]),changePct:accazaAiFinancePctChange(statement[key],previousStatement[key])},{});
        result.comparison={period:{from:previousFrom,to:previousTo},revenue:pair("revenue"),costOfSales:pair("costOfSales"),operatingExpense:pair("operatingExpense"),grossProfit:pair("grossProfit"),operatingResult:pair("operatingResult"),grossMarginPct:{current:statement.grossMarginPct,previous:previousStatement.grossMarginPct,change:accazaAiMoney((statement.grossMarginPct||0)-(previousStatement.grossMarginPct||0))},largestAccountMovements:moved,sources:previous.sources};
      }
      return{records:books.months.length+Object.keys(current.net).length,result};
    },
  },
  get_finance_account_detail:{
    description:"One Finance Books account by month: its name and type, its month-by-month posted movement and natural-direction balance for up to 24 months, the period total, the average month, the best and weakest month, the share of its account type's total, its cumulative balance and the direction of the last three months against the three before. Use it to explain what moved a revenue, cost or expense line.",
    params:{account_code:{type:"string",description:"The Finance Books account code, e.g. 4000, 5000, 6100."}},
    reserve:40,
    optional:{month_from:{type:"string",description:"Optional first month, YYYY-MM."},month_to:{type:"string",description:"Optional last month, YYYY-MM."}},
    async run(db,_range,args,ctx){
      const books=await accazaAiFinanceBooks(db,ctx);if(books.error)return{records:0,result:{error:books.error}};
      const code=String(args&&args.account_code||"").trim();if(!code)return{records:0,result:{error:"Give the Finance Books account code."}};
      const account=books.chart[code];if(!account)return{records:0,result:{error:`Account ${accazaAiText(code,20)} is not in the chart of accounts. Available finance tools cover posted Finance Books accounts only.`}};
      const type=String(account.type||""),debitNormal=ACCAZA_AI_FINANCE_DEBIT_NORMAL[type]!==false,today=accazaAiDay(Date.now());
      const available=books.months.filter(month=>{const from=String(args&&args.month_from||"").trim(),to=String(args&&args.month_to||"").trim();if(from&&month<from)return false;if(to&&month>to)return false;return month<=today.slice(0,7);});
      const months=available.slice(-ACCAZA_AI_FINANCE_MAX_MONTHS);
      if(!months.length)return{records:0,result:{account:{code,name:accazaAiText(account.name||code,80),type},months:[],note:"No posted movement for this account in the Finance Books monthly summaries."}};
      const currentMonth=today.slice(0,7),series=months.map(month=>{const raw=Number((books.monthly[month]||{})[code])||0;return{month,amount:accazaAiMoney(debitNormal?raw:-raw),postingDebitLessCredit:accazaAiMoney(raw),partialMonth:month>=currentMonth};});
      // Monthly averages and the direction reading use completed months only, so a part month in
      // progress never reads as a fall in the account.
      const complete=series.filter(row=>row.month<currentMonth),values=complete.map(row=>row.amount),total=accazaAiMoney(series.reduce((sum,row)=>sum+row.amount,0)),nonzero=series.filter(row=>Math.abs(row.amount)>=0.005).sort((left,right)=>right.amount-left.amount);
      const lastThree=values.slice(-3),priorThree=values.slice(-6,-3),average=list=>list.length?accazaAiMoney(list.reduce((sum,value)=>sum+value,0)/list.length):null;
      const directionChange=average(lastThree)===null||average(priorThree)===null?null:accazaAiMoney(average(lastThree)-average(priorThree));
      return{records:months.length+1,result:{account:{code,name:accazaAiText(account.name||code,80),type,naturalDirection:debitNormal?"debit":"credit"},months:series,periodTotal:total,completedMonthsUsed:complete.length,averageMonth:average(complete.slice(-12)),strongestMonth:nonzero[0]||null,weakestMonth:nonzero.length?nonzero[nonzero.length-1]:null,averageLastThreeCompletedMonths:average(lastThree),averagePreviousThreeCompletedMonths:average(priorThree),directionLastThreeCompletedVsPreviousThree:directionChange===null?{change:null,changePct:null,reading:"not enough completed months with movement to compare a direction"}:{change:directionChange,changePct:accazaAiFinancePctChange(average(lastThree),average(priorThree)),reading:Math.abs(directionChange)<0.01?"roughly flat":directionChange>0?"higher":"lower"},shareOfTypeTotalPct:accazaAiPct(total,accazaAiFinanceTypeTotal(books.chart,months.reduce((sum,month)=>accazaAiFinanceAdd(sum,{[code]:Number((books.monthly[month]||{})[code])||0}),{}),[type])),cumulativeBalanceThrough:months[months.length-1],cumulativeBalance:accazaAiMoney(debitNormal?(Number(accazaAiFinanceCumulative(books,months[months.length-1])[code])||0):-(Number(accazaAiFinanceCumulative(books,months[months.length-1])[code])||0)),basis:"posted Finance Books monthly ledger totals (debit less credit), amounts shown in the account's natural direction",note:"Month-level movement only; the Finance Books ledger and journal show the individual entries behind a month."}};
    },
  },
  get_finance_health:{
    description:"Finance Books health check as of a Manila date: gross, operating and cost-of-sales margins for the last three completed months, revenue and result per month, average monthly revenue, break-even revenue from the current margin, working capital, cash total against open payables and receivables, control-account reconciliation, unclosed accounting periods, uncosted sales and open close follow-ups, each as a pass or attention check with the figures behind it.",
    reserve:820,
    optional:{as_of:{type:"string",description:"As-of Manila date, YYYY-MM-DD. Defaults to today."}},
    async run(db,_range,args,ctx){
      const books=await accazaAiFinanceBooks(db,ctx);if(books.error)return{records:0,result:{error:books.error}};
      const operational=await accazaAiFinanceOperational(db,ctx);if(operational.error)return{records:0,result:{error:operational.error}};
      const today=accazaAiDay(Date.now()),requested=String(args&&args.as_of||"").trim(),asOf=requested||today;
      if(!accazaAiFinanceIsDay(asOf))return{records:0,result:{error:"Use as_of as YYYY-MM-DD (Manila)."}};
      if(asOf>today)return{records:0,result:{error:`as_of cannot be later than today (${today}).`}};
      const trailingMonths=accazaAiFinanceMonthsFor(today,3),series=accazaAiFinanceMonthRevenueSeries(books,trailingMonths),posted=series.filter(row=>row.postedMovement),trend=accazaAiFinanceTrend(series.map(row=>row.revenue)),totals=series.reduce((sum,row)=>({revenue:accazaAiMoney(sum.revenue+row.revenue),costOfSales:accazaAiMoney(sum.costOfSales+row.costOfSales),operatingExpense:accazaAiMoney(sum.operatingExpense+row.operatingExpense),grossProfit:accazaAiMoney(sum.grossProfit+row.grossProfit),operatingResult:accazaAiMoney(sum.operatingResult+row.operatingResult)}),{revenue:0,costOfSales:0,operatingExpense:0,grossProfit:0,operatingResult:0});
      const grossMarginPct=accazaAiPct(totals.grossProfit,totals.revenue),averageMonthlyRevenue=accazaAiMoney(totals.revenue/(posted.length||1)),averageMonthlyOperatingExpense=accazaAiMoney(totals.operatingExpense/(posted.length||1)),breakEvenRevenue=grossMarginPct&&grossMarginPct>0?accazaAiMoney(averageMonthlyOperatingExpense/(grossMarginPct/100)):null;
      const month=asOf.slice(0,7),prior=accazaAiFinanceCumulative(books,accazaAiFinancePreviousMonth(month)),monthPart=await accazaAiFinanceMonthPart(books,db,month,Number(asOf.slice(8,10))),net=accazaAiFinanceAdd(accazaAiFinanceAdd({},prior),monthPart.net),balanceSheet=accazaAiFinanceBalanceSheet(books.chart,net),trialBalance=accazaAiFinanceTrialBalance(books.chart,net);
      const cashAccounts=accazaAiFinanceCashAccounts(operational.cash),cashTotal=accazaAiMoney(cashAccounts.reduce((sum,row)=>sum+row.balance,0)),payables=accazaAiFinanceSubledger(operational.payables,"open supplier payables"),receivables=accazaAiFinanceSubledger(operational.receivables,"open receivables");
      const control=code=>accazaAiMoney((ACCAZA_AI_FINANCE_DEBIT_NORMAL[String((books.chart[code]||{}).type||"Asset")]!==false?1:-1)*(Number(net[code])||0));
      const overdue=operational.payables.filter(row=>String(row&&row.status||"open")==="open"&&/^\d{4}-\d{2}-\d{2}$/.test(String(row&&row.due||""))&&String(row.due)<today);
      const openPeriods=trailingMonths.filter(name=>(books.monthly[name]&&Object.keys(books.monthly[name]).length)&&String((operational.periods[name]||{}).status||"open")!=="closed");
      const check=(name,result,detail)=>({check:name,result,detail});
      const receivableGap=accazaAiMoney(receivables.total-control(ACCAZA_AI_FINANCE_CONTROLS.otherReceivable)),payablesGap=accazaAiMoney(payables.total-control(ACCAZA_AI_FINANCE_CONTROLS.payables));
      const checks=[
        check("Trial balance (debits equal credits)",Math.abs(trialBalance.difference)<0.01?"pass":"attention",`debits ${trialBalance.debitTotal} vs credits ${trialBalance.creditTotal}, difference ${trialBalance.difference}`),
        check("Balance sheet (assets equal liabilities plus equity plus accumulated result)",Math.abs(balanceSheet.difference)<0.01?"pass":"attention",`assets ${balanceSheet.assets} vs ${balanceSheet.liabilitiesPlusEquity}, difference ${balanceSheet.difference}`),
        check("Receivables subledger against control account 1110",Math.abs(receivableGap)<0.01?"pass":"attention",`subledger ${receivables.total} vs control ${control(ACCAZA_AI_FINANCE_CONTROLS.otherReceivable)}, difference ${receivableGap}`),
        check("Payables subledger against control account 2000",Math.abs(payablesGap)<0.01?"pass":"attention",`subledger ${payables.total} vs control ${control(ACCAZA_AI_FINANCE_CONTROLS.payables)}, difference ${payablesGap}`),
        check("Cash covers open payables",payables.total<=cashTotal?"pass":"attention",`cash ${cashTotal} against open payables ${payables.total} (coverage ${payables.total?accazaAiMoney(cashTotal/payables.total):null}x)`),
        check("Accounting periods closed",openPeriods.length?"attention":"pass",openPeriods.length?`posted months still open: ${openPeriods.join(", ")}`:`the last ${trailingMonths.length} posted months are closed`),
        check("All sales costed",operational.uncosted.length?"attention":"pass",`${operational.uncosted.length} uncosted sale record(s) open${operational.uncosted.length?`: ${JSON.stringify(operational.uncosted.slice(0,5).map(row=>accazaAiCompact(row,1)))}`:""}`),
        check("Shift close follow-ups cleared",operational.followUps.length?"attention":"pass",`${operational.followUps.length} open shift-close follow-up(s)`),
        check("Cash accounts not negative",cashAccounts.some(row=>row.balance<0)?"attention":"pass",cashAccounts.some(row=>row.balance<0)?cashAccounts.filter(row=>row.balance<0).map(row=>`${row.name} ${row.balance}`).join("; "):`all ${cashAccounts.length} cash account(s) are at or above zero`),
      ];
      return{records:books.months.length+operational.payables.length+operational.receivables.length+operational.uncosted.length+20,result:{asOf,basis:"posted Finance Books ledger movements and server finance control records, all figures PHP",
        margins:{period:`the last ${trailingMonths.length} completed months (${trailingMonths.join(", ")})`,monthsWithPostedMovement:posted.length,revenue:totals.revenue,costOfSales:totals.costOfSales,operatingExpense:totals.operatingExpense,grossProfit:totals.grossProfit,operatingResult:totals.operatingResult,grossMarginPct:grossMarginPct,operatingMarginPct:accazaAiPct(totals.operatingResult,totals.revenue),costOfSalesPctOfRevenue:accazaAiPct(totals.costOfSales,totals.revenue),operatingExpensePctOfRevenue:accazaAiPct(totals.operatingExpense,totals.revenue),averageMonthlyRevenue,averageMonthlyOperatingExpense,averageMonthlyResult:accazaAiMoney(totals.operatingResult/(posted.length||1)),revenueTrendPerMonth:trend.slope,revenueMonthlyDeviation:trend.deviation,monthly:series},
        breakEven:{averageMonthlyBreakEvenRevenue:breakEvenRevenue,basis:"average monthly operating expense over the gross margin of the same period; a rough planning figure, not a target"},
        position:{asOf,workingCapital:balanceSheet.workingCapital,accumulatedResult:balanceSheet.accumulatedResult,cashTotal,cashByAccount:cashAccounts.slice(0,12),openPayables:payables.total,openReceivables:receivables.total,overduePayableCount:overdue.length,overduePayableAmount:accazaAiMoney(overdue.reduce((sum,row)=>sum+accazaAiMoney(row.remainingAmount!=null?row.remainingAmount:row.amount),0))},
        checks,attentionCount:checks.filter(row=>row.result==="attention").length,note:"Control signals are not profit. Every check reads posted or server records; a failed check is a finding to report with its figures, not a number to adjust."}};
    },
  },
  get_finance_forecast:{
    description:"Trend-based Finance Books projection for the next one to three months from the posted monthly ledger totals: expected revenue, cost of sales, operating expenses, gross profit and operating result with a base case plus low and high range from the monthly revenue variation, the break-even revenue implied, the method used and what would invalidate the estimate. An estimate, never a recorded figure.",
    reserve:60,
    optional:{months:{type:"number",description:"How many months to project, 1 to 3 (default 1)."}},
    async run(db,_range,args,ctx){
      const books=await accazaAiFinanceBooks(db,ctx);if(books.error)return{records:0,result:{error:books.error}};
      const today=accazaAiDay(Date.now()),historyMonths=accazaAiFinanceMonthsFor(today,12),history=accazaAiFinanceMonthRevenueSeries(books,historyMonths),posted=history.filter(row=>row.postedMovement);
      if(posted.length<3)return{records:0,result:{error:`Only ${posted.length} completed month(s) with posted movement are available; a projection needs at least three. Answer from the actual months instead.`}};
      const requested=Number(args&&args.months||1),horizon=Math.max(1,Math.min(ACCAZA_AI_FINANCE_FORECAST_MAX_MONTHS,Number.isFinite(requested)?Math.round(requested):1));
      const lastThree=posted.slice(-3),average=key=>accazaAiMoney(lastThree.reduce((sum,row)=>sum+Number(row[key]||0),0)/lastThree.length),trend=key=>accazaAiFinanceTrend(posted.map(row=>row[key]));
      const revenueAverage=average("revenue"),cogsAverage=average("costOfSales"),expenseAverage=average("operatingExpense"),revenueTrend=trend("revenue"),cogsTrend=trend("costOfSales"),expenseTrend=trend("operatingExpense"),grossMarginPct=accazaAiPct(accazaAiMoney(revenueAverage-cogsAverage),revenueAverage);
      // The projection starts at the first month after the last completed one, which is this month.
      const nextMonths=[],startMonth=today.slice(0,7),[startYear,startIndex]=startMonth.split("-").map(Number);
      for(let index=0;index<horizon;index+=1){const step=index+1,revenue=accazaAiMoney(Math.max(0,revenueAverage+revenueTrend.slope*step)),costOfSales=accazaAiMoney(Math.max(0,cogsAverage+cogsTrend.slope*step)),operatingExpense=accazaAiMoney(Math.max(0,expenseAverage+expenseTrend.slope*step)),grossProfit=accazaAiMoney(revenue-costOfSales),projected=new Date(Date.UTC(startYear,startIndex-1+index,1));nextMonths.push({month:`${projected.getUTCFullYear()}-${String(projected.getUTCMonth()+1).padStart(2,"0")}`,revenue,costOfSales,operatingExpense,grossProfit,operatingResult:accazaAiMoney(grossProfit-operatingExpense),grossMarginPct:accazaAiPct(grossProfit,revenue),lowRevenue:accazaAiMoney(Math.max(0,revenue-revenueTrend.deviation)),highRevenue:accazaAiMoney(revenue+revenueTrend.deviation)});}
      const breakEvenRevenue=grossMarginPct&&grossMarginPct>0?accazaAiMoney(expenseAverage/(grossMarginPct/100)):null;
      return{records:books.months.length,result:{method:"estimate — trailing three-month average with a least-squares monthly trend from posted Finance Books monthly balances",notACommitment:"This is an estimate for planning. It records nothing and changes no balance.",historyUsed:posted.map(row=>({month:row.month,revenue:row.revenue,costOfSales:row.costOfSales,operatingExpense:row.operatingExpense,operatingResult:row.operatingResult})),trendPerMonth:{revenue:revenueTrend.slope,costOfSales:cogsTrend.slope,operatingExpense:expenseTrend.slope},monthlyVariation:{revenueDeviation:revenueTrend.deviation,averageRevenue:revenueAverage,averageOperatingExpense:expenseAverage},projection:nextMonths,breakEven:{averageMonthlyBreakEvenRevenue:breakEvenRevenue},assumptions:["Menu prices, recipe costs, staffing and opening hours continue as they are.","No new promotion, price change, closure or supplier change is assumed.","The shops trading days continue as in the months used."],wouldInvalidate:["A price or recipe-cost change, a promotion, a channel-mix shift or reduced opening days.","A month with unusually few or unusually heavy trading days, which distorts both the average and the range.","A change in how a cost is posted (for example a cost moved between COGS and operating expenses)."],note:"Low and high use one standard deviation of monthly revenue, so roughly two months in three should fall between them; this is a planning range, not a guarantee."}};
    },
  },
});
