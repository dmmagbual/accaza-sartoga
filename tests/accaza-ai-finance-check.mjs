// Accaza AI finance reasoning layer (Oct 2026). Proves, by running the real finance tool code
// against a fake database, that:
//   1. The trial balance and the balance sheet hold the accounting identities (debits equal
//      credits, assets equal liabilities plus equity plus the accumulated result) and that a
//      ledger that does not balance is REPORTED with its difference instead of hidden.
//   2. A period's performance, its comparison period, the account detail, the health checks and
//      the forecast all compute from the same posted monthly and daily ledger summaries the
//      Finance Books screens use, with the sign convention debit minus credit.
//   3. The tools are read-only (the fake database fails the test if anything writes), metered by
//      downloaded bytes, and exposed to the model with their own argument schemas.
//   4. Every analysis prompt carries the reasoning method and the always-proactive rule, and the
//      finance method reaches the record-reading providers.
// "Today" is fixed so the assertions are stable: 14 October 2026, Manila.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const pick = (source, start, end) => {const a = source.indexOf(start); const b = source.indexOf(end, a + start.length); assert.ok(a >= 0 && b > a, `missing ${start}`); return source.slice(a, b);};

const FIXED_NOW = Date.parse('2026-10-14T10:00:00+08:00');
const DAY = 86400000;
const manilaDay = ms => new Date(Number(ms) + 8 * 3600000).toISOString().slice(0, 10);
class FixedDate extends Date {constructor(...args){super(...(args.length ? args : [FIXED_NOW]));} static now(){return FIXED_NOW;}}

const records = read('src/functions/62a-accaza-ai-records.js');
const analytics = read('src/functions/62b-accaza-ai-analytics.js');
const finance = read('src/functions/62d-accaza-ai-finance.js');
const chat = read('src/functions/62-accaza-chat.js');
const recordsCode = records.slice(0, records.indexOf('const ACCAZA_AI_AGENT_GUIDE'));
const usage = pick(analytics, 'function accazaAiRtdbUsageRef(){', 'async function accazaAiSalesMonthDocs(');
const code = recordsCode + usage + finance;

function fakeDb(data){
  const reads = [];
  // Flat lookups first (the seed uses full paths), then a nested walk for any rooted path.
  const resolve = p => {const key = String(p || ''); if(Object.prototype.hasOwnProperty.call(data, key)) return data[key]; return key.split('/').filter(Boolean).reduce((current, part) => current == null ? undefined : current[part], data);};
  const snap = value => ({val: () => value === undefined ? null : value, exists: () => value != null, numChildren: () => value && typeof value === 'object' ? Object.keys(value).length : 0});
  const node = (path, q) => ({
    orderByChild: field => node(path, {...q, child: field}),
    orderByKey: () => node(path, {...q, key: true}),
    startAt: value => node(path, {...q, start: value}),
    endAt: value => node(path, {...q, end: value}),
    equalTo: value => node(path, {...q, equal: value}),
    limitToFirst: count => node(path, {...q, first: count}),
    limitToLast: count => node(path, {...q, last: count}),
    async get(){
      const stored = resolve(path);
      let value = stored === undefined ? undefined : structuredClone(stored);
      if(value && typeof value === 'object'){
        let rows = Object.entries(value);
        if(q.child) rows = rows.filter(([, row]) => (q.equal === undefined || String(row && row[q.child]) === String(q.equal)));
        if(q.key){if(q.start !== undefined) rows = rows.filter(([key]) => key >= q.start); if(q.end !== undefined) rows = rows.filter(([key]) => key <= q.end);}
        if(q.first) rows = rows.slice(0, q.first);
        if(q.last) rows = rows.slice(-q.last);
        value = Object.fromEntries(rows);
      }
      reads.push(path);
      return snap(value);
    },
    set(){throw new Error(`accaza_ai_finance_write_attempt:${path}`);},
    update(){throw new Error(`accaza_ai_finance_write_attempt:${path}`);},
    push(){throw new Error(`accaza_ai_finance_write_attempt:${path}`);},
    remove(){throw new Error(`accaza_ai_finance_write_attempt:${path}`);},
    transaction(){throw new Error(`accaza_ai_finance_write_attempt:${path}`);},
  });
  return {reads, ref: p => node(p, {})};
}

// The ledger used by every case: three completed months of trading plus the current month to the
// 14th. Each day posts cash sales, cost of sales matched by an equal inventory purchase on credit,
// operating expense and (from August) owner's drawings, so every month's entries balance to zero.
const RATE = {
  '2026-07': {revenue: 1400, cogs: 500, opex: 100, drawings: 0},
  '2026-08': {revenue: 1500, cogs: 500, opex: 100, drawings: 300},
  '2026-09': {revenue: 1600, cogs: 500, opex: 100, drawings: 300},
};
const OCTOBER_DAYS = 14;
const dayRow = row => ({'1010': row.revenue - row.opex - row.drawings, '4000': -row.revenue, '5000': row.cogs, '1200': 0, '2000': -row.cogs, '6100': row.opex, '3100': row.drawings});
function ledger(){
  const daily = {};
  Object.entries(RATE).forEach(([month, row]) => {
    const days = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
    for(let day = 1; day <= days; day += 1) daily[`${month}-${String(day).padStart(2, '0')}`] = dayRow(row);
  });
  for(let day = 1; day <= OCTOBER_DAYS; day += 1) daily[`2026-10-${String(day).padStart(2, '0')}`] = dayRow({revenue: 1600, cogs: 500, opex: 100, drawings: 300});
  const monthly = {};
  Object.entries(daily).forEach(([day, row]) => {
    const month = day.slice(0, 7);
    monthly[month] = monthly[month] || {};
    Object.entries(row).forEach(([code, value]) => {monthly[month][code] = (monthly[month][code] || 0) + value;});
  });
  return {daily, monthly};
}
const CHART = {
  '1010': {code: '1010', name: 'Cash in Register', type: 'Asset'},
  '1020': {code: '1020', name: 'Maribank', type: 'Asset'},
  '1100': {code: '1100', name: 'Platform Receivable', type: 'Asset'},
  '1110': {code: '1110', name: 'Other Receivables', type: 'Asset'},
  '1115': {code: '1115', name: 'Supplier Advances', type: 'Asset'},
  '1200': {code: '1200', name: 'Inventory', type: 'Asset'},
  '2000': {code: '2000', name: 'Accounts Payable', type: 'Liability'},
  '3000': {code: '3000', name: "Owner's Capital", type: 'Equity'},
  '3100': {code: '3100', name: "Owner's Drawings", type: 'Equity'},
  '4000': {code: '4000', name: 'Coffee Sales', type: 'Income'},
  '5000': {code: '5000', name: 'Cost of Goods Sold', type: 'COGS'},
  '6100': {code: '6100', name: 'Rent', type: 'Expense'},
};

function makeLib(){
  const getFirestore = () => ({collection: () => ({doc: () => ({get: async () => ({exists: false, get: () => undefined}), set: async () => {}}), where: () => ({where: () => ({orderBy: () => ({limit: () => ({select: () => ({get: async () => ({size: 0, docs: []})})})})})})}), runTransaction: async () => true});
  const lib = new Function('Date', 'getFirestore', 'FieldValue', 'HistoricalArchive', 'historicalSalesAtReady', 'accazaAiClaimFirestoreReads', 'financeDateFromTimestamp', 'logger', 'accazaAiText', 'accazaAiTopAccounts', 'accazaAiMoney', 'accazaAiPct', 'accazaAiPesos', 'accazaAiDay',
    `${code};return{ACCAZA_AI_RECORD_TOOLS,ACCAZA_AI_TOOL_RECORD_BUDGET,accazaAiToolContext,accazaAiRunRecordTool,accazaAiToolSchema};`)(
    FixedDate,
    getFirestore,
    {increment: n => ({increment: n})},
    {COLLECTION: 'historicalOrders', MONTH_COLLECTION: 'historicalSalesMonths'},
    async () => false,
    async () => {},
    manilaDay,
    {warn(){}},
    (value, max) => String(value || '').slice(0, max || 800),
    () => [],
    value => Math.round((Number(value) || 0) * 100) / 100,
    (part, whole) => Number(whole) ? Math.round(Number(part) / Number(whole) * 1000) / 10 : null,
    cents => Math.round(Number(cents) || 0) / 100, manilaDay,
  );
  return lib;
}
function seed(extra = {}){
  const books = ledger();
  return Object.assign({
    '/booksChart': CHART,
    '/books/dailyNet': books.daily,
    '/books/monthlyNet': books.monthly,
    '/books/monthlyNetMeta': {updatedAt: FIXED_NOW, schemaVersion: 2},
    '/cashBalanceSummary/balances': {cf1: {name: 'Maribank', balance: 60000}, cf2: {name: 'GCash', balance: 4000}},
    '/payables': {p1: {status: 'open', party: 'Supplier One', ref: 'INV-1', date: '2026-09-01', due: '2026-09-15', remainingAmount: 53000, supplierId: 's1'}},
    '/receivables': {},
    '/accountingPeriods': {'2026-07': {status: 'closed'}, '2026-08': {status: 'closed'}, '2026-09': {status: 'open'}},
    '/uncostedSales': {u1: {status: 'open', orderId: 'O1'}},
    '/shiftCloseFollowUps': {},
    '/posStaff': {},
    '/menuItems': {},
    '/orders': {},
    '/archivedOrders': {},
    '/operationalAudit': {},
    '/offlinePosSync': {},
    '/posSyncAlerts': {},
    '/functionDeadLetters': {},
    '/shifts': {},
    '/cashCustody': {},
    '/pendingShiftHandovers': {},
    '/incidents': {},
    '/accazaAiIssues': {},
    '/clientTelemetryDaily': {},
    '/inventory': {},
    '/recipes': {},
    '/suppliers': {},
    '/posSettings': {},
    '/books/config/cashAccountMap': {},
  }, extra);
}

const lib = makeLib();
const run = async (ctx, name, args) => lib.accazaAiRunRecordTool(ctx, name, args);

// 1. The position holds both accounting identities and reports its cash separately from the ledger.
{
  const db = fakeDb(seed());
  const ctx = lib.accazaAiToolContext(db);
  const result = await run(ctx, 'get_finance_position', {as_of: '2026-10-14'});
  assert.ok(!result.error, `position must answer: ${result.error}`);
  assert.equal(result.asOf, '2026-10-14');
  assert.equal(result.trialBalance.difference, 0, 'posted debits must equal posted credits');
  assert.equal(result.balanceSheet.sumOfAllAccountNets, 0, 'every posted entry is balanced, so all account nets total zero');
  assert.equal(result.balanceSheet.revenueToDate, 160300, 'revenue to 14 October is 43,400 + 46,500 + 48,000 + 22,400');
  assert.equal(result.balanceSheet.costOfSalesToDate, 53000);
  assert.equal(result.balanceSheet.operatingExpenseToDate, 10600);
  assert.equal(result.balanceSheet.accumulatedResult, 96700, 'revenue less cost of sales and operating expenses');
  assert.equal(result.balanceSheet.liabilities, 53000, 'payables control 2000 is presented credit-normal');
  assert.equal(result.balanceSheet.equity, -22500, "owner's drawings is a negative equity balance");
  assert.equal(result.balanceSheet.assets, result.balanceSheet.liabilitiesPlusEquity, 'assets equal liabilities plus equity plus the accumulated result');
  assert.equal(result.balanceSheet.difference, 0);
  assert.equal(result.workingCapital, 74200, 'assets less liabilities');
  assert.equal(result.cash.total, 64000, 'cash comes from the cash summary, not the accrual ledger');
  assert.equal(result.cash.accounts.find(row => row.name === 'Maribank').balance, 60000);
  assert.equal(result.subledgers.payables.subledgerTotal, 53000);
  assert.equal(result.subledgers.payables.difference, 0, 'the payables subledger agrees with control account 2000');
  assert.deepEqual(result.flags, [], 'a balanced, reconciled ledger raises no control flag');
  assert.ok(ctx.rtdbBytes > 0, 'the position read is metered in downloaded bytes');
  assert.ok(ctx.recordsRead > 0 && ctx.recordsRead <= lib.ACCAZA_AI_TOOL_RECORD_BUDGET);
  assert.equal(new Set(db.reads).has('/books/journal'), false, 'the journal history is never read');
}

// 2. An out-of-balance ledger and an unreconciled subledger are reported with their difference.
{
  const broken = seed();
  broken['/books/monthlyNet']['2026-09']['4000'] = broken['/books/monthlyNet']['2026-09']['4000'] + 5000;
  broken['/receivables'] = {r1: {status: 'open', party: 'GrabFood', amount: 1000}};
  const ctx = lib.accazaAiToolContext(fakeDb(broken));
  const result = await run(ctx, 'get_finance_position', {as_of: '2026-10-14'});
  assert.equal(result.trialBalance.difference, 5000, 'an unbalanced ledger shows its difference: debits exceed credits by the missing income');
  assert.equal(result.balanceSheet.sumOfAllAccountNets, 5000);
  assert.equal(result.balanceSheet.difference, 5000, 'assets then exceed liabilities plus equity plus the accumulated result by the same amount');
  assert.ok(result.flags.some(flag => /does not balance/.test(flag)), 'the imbalance is flagged, not explained away');
  assert.ok(result.flags.some(flag => /differ from control account 1110/.test(flag)), 'the receivable control gap is flagged');
  assert.equal(result.subledgers.receivables.difference, 1000);
}

// 3. Performance for a whole month, with the comparison period, is derived from the same summaries.
{
  const ctx = lib.accazaAiToolContext(fakeDb(seed()));
  const result = await run(ctx, 'get_finance_performance', {period_from: '2026-09-01', period_to: '2026-09-30', compare: true});
  assert.ok(!result.error, `performance must answer: ${result.error}`);
  assert.equal(result.period.days, 30);
  assert.equal(result.revenue.total, 48000);
  assert.equal(result.costOfSales.total, 15000);
  assert.equal(result.operatingExpenses.total, 3000);
  assert.equal(result.grossProfit, 33000);
  assert.equal(result.grossMarginPct, 68.8);
  assert.equal(result.operatingResult, 30000);
  assert.equal(result.revenuePerDay, 1600);
  assert.equal(result.comparison.period.from, '2026-08-02', 'the comparison is the preceding 30 days');
  assert.equal(result.comparison.period.to, '2026-08-31');
  assert.equal(result.comparison.revenue.current, 48000);
  assert.equal(result.comparison.revenue.previous, 45000);
  assert.equal(result.comparison.revenue.change, 3000);
  assert.equal(result.comparison.revenue.changePct, 6.67);
  assert.ok(result.comparison.largestAccountMovements.some(row => row.code === '4000' && row.change === 3000));
  assert.ok(!result.comparison.sources.some(source => source.includes('/books/monthlyNet/2026-08')), 'whole months come from the monthly summary');
}

// 4. Account detail reads one account's monthly movement and refuses to invent a direction.
{
  const ctx = lib.accazaAiToolContext(fakeDb(seed()));
  const result = await run(ctx, 'get_finance_account_detail', {account_code: '4000'});
  assert.ok(!result.error, `account detail must answer: ${result.error}`);
  assert.equal(result.account.type, 'Income');
  assert.equal(result.account.naturalDirection, 'credit');
  assert.deepEqual(result.months.map(row => row.month), ['2026-07', '2026-08', '2026-09', '2026-10']);
  assert.equal(result.months[0].amount, 43400, 'income is presented credit-normal (positive)');
  assert.equal(result.months[3].partialMonth, true);
  assert.equal(result.periodTotal, 160300);
  assert.equal(result.strongestMonth.month, '2026-09');
  assert.equal(result.cumulativeBalance, 160300);
  assert.equal(result.cumulativeBalanceThrough, '2026-10');
  assert.equal(result.directionLastThreeCompletedVsPreviousThree.change, null, 'three completed months cannot show a direction against a further three');
  assert.match(result.directionLastThreeCompletedVsPreviousThree.reading, /not enough completed months/);
  const unknown = await run(ctx, 'get_finance_account_detail', {account_code: '9999'});
  assert.match(unknown.error, /not in the chart of accounts/);
}

// 5. Health checks turn the same figures into pass or attention findings with their numbers.
{
  const ctx = lib.accazaAiToolContext(fakeDb(seed()));
  const result = await run(ctx, 'get_finance_health', {as_of: '2026-10-14'});
  assert.ok(!result.error, `health must answer: ${result.error}`);
  const check = name => result.checks.find(row => row.check.startsWith(name));
  assert.equal(check('Trial balance').result, 'pass');
  assert.equal(check('Balance sheet').result, 'pass');
  assert.equal(check('Payables subledger').result, 'pass');
  assert.equal(check('Cash covers open payables').result, 'pass');
  assert.equal(check('Accounting periods').result, 'attention', 'September is still open');
  assert.match(check('Accounting periods').detail, /2026-09/);
  assert.equal(check('All sales costed').result, 'attention');
  assert.equal(result.attentionCount, 2);
  assert.equal(result.position.overduePayableCount, 1);
  assert.equal(result.position.overduePayableAmount, 53000);
  assert.equal(result.position.cashTotal, 64000);
  assert.equal(result.margins.period, 'the last 3 completed months (2026-07, 2026-08, 2026-09)');
  assert.equal(result.margins.revenue, 137900);
  assert.equal(result.margins.grossMarginPct, 66.6);
  assert.equal(result.breakEven.averageMonthlyBreakEvenRevenue, 4604.61, 'average monthly operating expense over the gross margin');
  assert.ok(result.breakEven.basis.includes('rough planning figure'));
}

// 6. The forecast is labelled an estimate, carries its method and assumptions, and never answers
//    from fewer than three completed months.
{
  const ctx = lib.accazaAiToolContext(fakeDb(seed()));
  const result = await run(ctx, 'get_finance_forecast', {months: 2});
  assert.ok(!result.error, `forecast must answer: ${result.error}`);
  assert.match(result.method, /^estimate/);
  assert.equal(result.historyUsed.length, 3);
  assert.deepEqual(result.projection.map(row => row.month), ['2026-10', '2026-11']);
  assert.equal(result.projection[0].revenue, 48266.67, 'trailing average plus one least-squares step');
  assert.ok(result.projection[0].lowRevenue <= result.projection[0].revenue && result.projection[0].revenue <= result.projection[0].highRevenue, 'the range brackets the base case');
  assert.ok(result.projection[1].revenue > result.projection[0].revenue, 'the rising trend continues into the second month');
  assert.equal(result.projection[0].grossProfit, result.projection[0].revenue - result.projection[0].costOfSales);
  assert.equal(result.projection[0].operatingResult, result.projection[0].grossProfit - result.projection[0].operatingExpense);
  assert.ok(result.assumptions.length >= 3 && result.wouldInvalidate.length >= 3);
  assert.ok(result.breakEven.averageMonthlyBreakEvenRevenue > 0);
  const thin = seed({'/books/monthlyNet': {'2026-09': {'4000': -48000, '1010': 48000}}, '/books/dailyNet': {}});
  const refused = await run(lib.accazaAiToolContext(fakeDb(thin)), 'get_finance_forecast', {});
  assert.match(refused.error, /at least three/);
}

// 7. Optional-argument finance tools ask for no date range; every tool is described and named.
{
  const names = ['get_finance_position', 'get_finance_performance', 'get_finance_account_detail', 'get_finance_health', 'get_finance_forecast'];
  names.forEach(name => {
    const tool = lib.ACCAZA_AI_RECORD_TOOLS[name];
    assert.ok(tool && tool.description.length > 120, `${name} must be described for the model`);
    const schema = lib.accazaAiToolSchema(name);
    assert.ok(!('date_from' in schema.parameters.properties), `${name} must not ask for a date range`);
  });
  assert.deepEqual(lib.accazaAiToolSchema('get_finance_account_detail').parameters.required, ['account_code']);
  assert.deepEqual(lib.accazaAiToolSchema('get_finance_position').parameters.required, []);
  assert.deepEqual(lib.accazaAiToolSchema('get_sales').parameters.required, ['date_from'], 'date-range tools keep their required range');
  // Read-only proof, twice over: no write call appears in the source, and every tool above ran
  // against a fake database whose set/update/push/remove/transaction throw on use.
  assert.deepEqual(finance.match(/\.(set|update|remove|transaction)\s*\(/g) || [], [], 'the finance tools contain no database write');
  assert.equal(finance.includes('runTransaction('), false, 'the finance tools open no transaction');
}

// 8. The persona, the reasoning method and the proactive rule reach every analysis prompt, and the
//    finance method reaches the providers that can read records.
{
  const bundle = read('functions/index.js');
  for(const marker of ['senior accountant, bookkeeper, financial analyst and CFO in one', 'REASONING METHOD', 'ALWAYS PROACTIVE', 'Recommended next steps', 'Watch-outs', 'FINANCE METHOD', 'get_finance_position', 'get_finance_health', 'get_finance_forecast']) assert.ok(bundle.includes(marker), `the bundle lacks the finance reasoning marker: ${marker}`);
  assert.equal((bundle.match(/\$\{ACCAZA_AI_ANALYSIS_INSTRUCTION\}/g) || []).length, 1, 'the raw persona must only be used inside the composed analysis system prompt');
  ['const ACCAZA_AI_ANALYSIS_SYSTEM=', 'const ACCAZA_AI_ANALYSIS_SYSTEM_WITH_TOOLS=', 'content:ACCAZA_AI_ANALYSIS_SYSTEM', 'instruction=ACCAZA_AI_ANALYSIS_SYSTEM'].forEach(marker => assert.ok(bundle.includes(marker), `the analysis prompts must use the composed system prompt: ${marker}`));
  assert.ok(bundle.includes('${ACCAZA_AI_ANALYSIS_SYSTEM_WITH_TOOLS} ${ACCAZA_AI_AGENT_GUIDE} ${ACCAZA_AI_STRATEGY_GUIDE}'), 'the record-reading providers must also receive the finance method');
  assert.ok(!bundle.includes('Do not add generic recommendations to an incident answer'), 'the old no-recommendations rule must be gone: every Accaza answer is proactive');
  assert.ok(bundle.includes('General chat mode'), 'the proactive rule must stay out of general chat');
  assert.ok(chat.includes('ACCAZA_AI_ANALYSIS_SYSTEM'), 'the composed prompts live with the other instructions');
}

console.log('PASS: Accaza AI finance reasoning — identities, reporting, forecast, read-only tools and prompt wiring verified.');
