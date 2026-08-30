"use strict";
/* ============================================================
   Accaza Books — standalone double-entry accounting (P1)
   Data model:
     account = {code, name, type, note}
       type ∈ Asset, Liability, Equity, Income, COGS, Expense
       normal balance: Asset/COGS/Expense = debit; Liability/Equity/Income = credit
       (contra accounts handled by sign of their balance, no special flag needed in P1)
     entry = {id, date:'YYYY-MM-DD', ref, memo, lines:[{code, debit, credit}],
              createdAt, reversed:false, reversalOf:null}
   All amounts stored in centavos-free floats but rounded to 2dp on posting.
   ============================================================ */

const TYPES = ["Asset","Liability","Equity","Income","COGS","Expense"];
const DEBIT_NORMAL = {Asset:true, COGS:true, Expense:true, Liability:false, Equity:false, Income:false};
const TYPE_ORDER = {Asset:1, Liability:2, Equity:3, Income:4, COGS:5, Expense:6};

/* Display-only control accounts. They never enter the journal or stored ledger. */
const ACCOUNT_GROUPS = [
  {code:"10",prefix:"10",name:"Cash and Cash Equivalents",type:"Asset",note:"Main account · calculated from cash subaccounts"},
  {code:"11",prefix:"11",name:"Receivables",type:"Asset",note:"Main account · calculated from receivable subaccounts"},
  {code:"12",prefix:"12",name:"Inventories",type:"Asset",note:"Main account · calculated from inventory subaccounts",matches:a=>/^(120|121|122|123|124|127|128|129)/.test(String(a.code))},
  {code:"125",prefix:"12",name:"Recoverable Taxes",type:"Asset",note:"Main account · calculated from VAT and withholding-tax credit subaccounts",matches:a=>/^(125|126)/.test(String(a.code))&&!isMainAccount(a.code)},
  {code:"15",prefix:"15",name:"Property, Plant and Equipment",type:"Asset",note:"Main account · calculated from fixed-asset and accumulated-depreciation subaccounts"},
  {code:"20",prefix:"20",name:"Payables and Related Obligations",type:"Liability",note:"Main account · calculated from payable subaccounts"},
  {code:"21",prefix:"21",name:"Payroll Liabilities",type:"Liability",note:"Main account · calculated from payroll-liability subaccounts"},
  {code:"22",prefix:"22",name:"Tax Liabilities",type:"Liability",note:"Main account · calculated from tax-liability subaccounts"},
  {code:"23",prefix:"23",name:"Loans Payable",type:"Liability",note:"Main account · calculated from loan subaccounts"},
  {code:"30",prefix:"30",name:"Owner's Equity",type:"Equity",note:"Main account · calculated from capital, float-clearing, and drawings subaccounts"},
  {code:"40",prefix:"40",name:"Sales Revenue",type:"Income",note:"Main account · calculated from sales-channel subaccounts"},
  {code:"49",prefix:"49",name:"Revenue Adjustments and Other Income",type:"Income",note:"Main account · calculated from contra-revenue and other-income subaccounts"},
  {code:"50",prefix:"50",name:"Cost of Sales",type:"COGS",note:"Main account · calculated from cost-of-sales subaccounts"},
  {code:"59",prefix:"59",name:"Inventory Losses",type:"COGS",note:"Main account · calculated from wastage and inventory-loss subaccounts"},
  {code:"60",prefix:"60",name:"Operating Expenses",type:"Expense",note:"Main account · calculated from operating-expense subaccounts"},
  {code:"61",prefix:"61",name:"Other Operating Expenses",type:"Expense",note:"Main account · calculated from miscellaneous and variance subaccounts"}
];

const STORE_KEY = "accaza_books_v1";
window.__booksLiveLoading = true;

/* ---------- default coffee-shop chart of accounts ---------- */
function defaultAccounts(){
  return [
    // Assets
    ["1000","Cash on Hand","Asset"],["1005","Register Cash Float","Asset","Fixed imprest tied to POS Settings"],["1010","Other Bank Accounts","Asset"],["1011","Union Bank","Asset"],["1012","BDO","Asset"],
    ["1013","Security Bank – 4538","Asset"],["1014","Security Bank – 4389","Asset"],["1020","GCash / Maya Wallet","Asset"],["1021","FoodPanda GCash Wallet","Asset","Dedicated FoodPanda payout destination"],["1050","Platform Payouts in Transit","Asset","Temporary platform payout clearing account"],
    ["1100","Accounts Receivable – Platforms","Asset","Grab/Panda settlements owed to us"],
    ["1200","Inventory – Coffee & Beans","Asset"],["1210","Inventory – Milk & Dairy","Asset"],
    ["1220","Inventory – Syrups & Flavors","Asset"],["1230","Inventory – Cups & Packaging","Asset"],
    ["1240","Inventory – Food & Pastries","Asset"],["1270","Inventory – Operating & Cleaning Supplies","Asset"],["1280","Inventory – Office Supplies","Asset"],["1290","Inventory Receiving Clearing","Asset","Received inventory awaiting complete posting"],
    ["1500","Equipment","Asset","Espresso machine, grinders"],["1510","Furniture & Fixtures","Asset"],
    ["1590","Accumulated Depreciation","Asset","Contra-asset (credit balance)"],
    // Liabilities
    ["2000","Accounts Payable – Suppliers","Liability"],["2020","Due to Platforms","Liability","Negative Grab/FoodPanda settlements owed to the platform"],["2050","Due to Owner / Partners","Liability","Personally funded business costs awaiting reimbursement"],["2090","Unrecorded Payables Clearing","Liability","Supplier obligations awaiting complete posting"],["2100","Cash Overage Under Review","Liability","Pending manager reconciliation"],["2120","Accrued Salaries","Liability"],
    ["2200","Taxes Payable","Liability"],["2300","Loans Payable","Liability"],["2310","Loan 2","Liability"],["2320","Loan 3","Liability"],
    // Equity
    ["3000","Owner's Capital","Equity"],["3100","Owner's Drawings","Equity","Contra-equity (debit balance)"],
    ["3900","Retained Earnings","Equity"],
    // Income
    ["4000","Sales – In-store","Income"],["4010","Sales – Online (own)","Income"],
    ["4020","Sales – GrabFood","Income"],["4030","Sales – FoodPanda","Income"],
    ["4900","Discounts & Comps","Income","Contra-income (debit balance)"],
    ["4910","Sales Returns & Refunds","Income","Existing void and refund adjustments"],
    // COGS
    ["5000","COGS – Coffee & Beans","COGS"],["5010","COGS – Milk & Dairy","COGS"],
    ["5020","COGS – Syrups & Flavors","COGS"],["5030","COGS – Food & Pastries","COGS"],
    ["5040","COGS – Cups & Packaging","COGS"],["5090","Unposted COGS Clearing","COGS","Costs awaiting complete item-level posting"],["5900","Wastage & Spoilage","COGS","Physical spoilage, expiry, spillage, or discard only"],["5905","Inventory Reconciliation Gain / (Loss)","COGS","Count or valuation variance only: debit is loss, credit is gain"],
    // Expenses
    ["6000","Salaries & Wages","Expense"],["6010","Rent","Expense"],["6020","Utilities","Expense","Electricity, water"],
    ["6030","Internet & Phone","Expense"],["6040","Platform Commissions","Expense","Grab/Panda fees"],
    ["6050","Marketing & Promotions","Expense"],["6060","Repairs & Maintenance","Expense"],
    ["6070","Cleaning & Operating Supplies","Expense"],["6075","Office & Administrative Supplies","Expense"],["6076","Transportation & Delivery","Expense"],["6077","Staff Consumption & Welfare","Expense","Inventory consumed by staff"],["6078","Product R&D & Testing","Expense","Inventory consumed for product development, testing, training, or sampling"],["6080","Bank & Payment Fees","Expense"],
    ["6085","Platform Penalties & Adjustments","Expense"],["6090","Depreciation","Expense"],["6100","Miscellaneous","Expense"]
  ].map(a=>({code:a[0],name:a[1],type:a[2],note:a[3]||""}));
}

/* ---------- remove the original browser-only demo journal ---------- */
const SAMPLE_ENTRY_IDS = new Set(["E1","E2","E3","E4","E5","E6","E7","E8","E9","E10"]);
function stripSampleEntries(p){
  const removed=(p.entries||[]).filter(e=>SAMPLE_ENTRY_IDS.has(e.id)||SAMPLE_ENTRY_IDS.has(e.reversalOf));
  if(!removed.length)return p;
  try{if(!localStorage.getItem(STORE_KEY+"_sample_backup"))localStorage.setItem(STORE_KEY+"_sample_backup",JSON.stringify({removedAt:Date.now(),entries:removed}));}catch(_e){}
  p.entries=(p.entries||[]).filter(e=>!SAMPLE_ENTRY_IDS.has(e.id)&&!SAMPLE_ENTRY_IDS.has(e.reversalOf));
  p.meta=Object.assign({},p.meta||{},{sampleEntriesRemovedAt:Date.now()});
  return p;
}

/* ---------- state ---------- */
let DB = load();
function migrate(p){
  p.accounts=p.accounts||defaultAccounts(); p.entries=p.entries||[]; p.meta=p.meta||{name:"Accaza Coffee House",created:Date.now()};
  // accounts the POS→journal bridge maps into, plus VAT-activation accounts (kept even while Non-VAT)
  var need=[
    ["1005","Register Cash Float","Asset","Fixed imprest tied to POS Settings"],
    ["1030","Undeposited Collection","Asset","Cash awaiting bank deposit"],
    ["1040","Revolving Fund","Asset"],["1050","Platform Payouts in Transit","Asset","Settled platform payouts awaiting bank deposit"],
    ["1011","Union Bank","Asset"],["1012","BDO","Asset"],["1013","Security Bank – 4538","Asset"],["1014","Security Bank – 4389","Asset"],["1021","FoodPanda GCash Wallet","Asset","Dedicated FoodPanda payout destination"],
    ["1110","Other Receivables","Asset"],["1190","Cash Shortage Under Review","Asset","Pending manager reconciliation"],
    ["1250","Input VAT (creditable)","Asset","Used when VAT-registered"],
    ["1260","Creditable Withholding Tax","Asset","CWT withheld by platforms/customers"],
    ["1900","Suspense","Asset","Post-cutover unmapped Finance sources only; every item must retain its source and clear through the controlled mapping workflow"],
    ["1290","Inventory Receiving Clearing","Asset","Received inventory awaiting complete posting"],
    ["1270","Inventory – Operating & Cleaning Supplies","Asset"],["1280","Inventory – Office Supplies","Asset"],
    ["2020","Due to Platforms","Liability","Negative Grab/FoodPanda settlements owed to the platform"],["2050","Due to Owner / Partners","Liability","Personally funded business costs awaiting reimbursement"],
    ["2030","Customer Change / Refund Payable","Liability","Customer-related cash overages awaiting refund"],["2090","Unrecorded Payables Clearing","Liability","Supplier obligations awaiting complete posting"],["2100","Cash Overage Under Review","Liability","Pending manager reconciliation"],["2120","Accrued Salaries","Liability"],
    ["2210","Output VAT Payable","Liability","Used when VAT-registered"],
    ["2220","Percentage Tax Payable","Liability","Non-VAT percentage tax on gross receipts"],
    ["2230","Withholding Tax Payable","Liability","EWT withheld from payments"],
    ["3050","Cash Float Clearing","Equity","POS shift float source"],
    ["4910","Sales Returns & Refunds","Income","Existing void and refund adjustments"],
    ["4990","Other Income","Income"],
    ["5090","Unposted COGS Clearing","COGS","Costs awaiting complete item-level posting"],["5905","Inventory Reconciliation Gain / (Loss)","COGS","Single net valuation adjustment: debit is loss, credit is gain"],
    ["6045","Platform Discounts","Expense","Grab/Panda-funded or shared discounts"],
    ["6046","Platform Service VAT","Expense"],
    ["6085","Platform Penalties & Adjustments","Expense"],
    ["6075","Office & Administrative Supplies","Expense"],["6076","Transportation & Delivery","Expense"],["6077","Staff Consumption & Welfare","Expense","Inventory consumed by staff"],["6078","Product R&D & Testing","Expense","Inventory consumed for product development, testing, training, or sampling"],
    ["6110","Cash Short / Over","Expense","Register variance"]
  ];
  need.forEach(function(n){ if(!p.accounts.find(function(a){return a.code===n[0];})) p.accounts.push({code:n[0],name:n[1],type:n[2],note:n[3]||""}); });
  var canonical={"5900":["Wastage & Spoilage","COGS","Physical spoilage, expiry, spillage, or discard only"],"5905":["Inventory Reconciliation Gain / (Loss)","COGS","Count or valuation variance only: debit is loss, credit is gain"],"6077":["Staff Consumption & Welfare","Expense","Inventory consumed by staff"],"6078":["Product R&D & Testing","Expense","Inventory consumed for product development, testing, training, or sampling"]};Object.keys(canonical).forEach(function(code){var a=p.accounts.find(function(row){return row.code===code;}),v=canonical[code];if(a){a.name=v[0];a.type=v[1];a.note=v[2];}});p.accounts=p.accounts.filter(function(a){return a.code!=='4995';});(p.entries||[]).forEach(function(e){(e.lines||[]).forEach(function(line){if(String(line.code)==='4995')line.code='5905';});});
  var supplies=p.accounts.find(function(a){return a.code==='6070';});if(supplies)supplies.name='Cleaning & Operating Supplies';
  p.accounts.sort(function(x,y){return String(x.code).localeCompare(String(y.code));});
  return p;
}
function load(){
  try{ const raw = localStorage.getItem(STORE_KEY); if(raw){ const p=JSON.parse(raw); if(p&&p.accounts&&p.entries) return migrate(stripSampleEntries(p)); } }catch(e){}
  return migrate({ accounts: defaultAccounts(), entries: [], meta:{name:"Accaza Coffee House", created:Date.now()} });
}
function save(){ try{ localStorage.setItem(STORE_KEY, JSON.stringify(DB)); }catch(e){ alert("Could not save to this browser: "+e.message); } }
save();

/* ---------- helpers ---------- */
const peso = n => "₱"+ (Math.round((Number(n)||0)*100)/100).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
const pesoNoDec = n => "₱"+ Math.round(Number(n)||0).toLocaleString();
const r2 = n => Math.round((Number(n)||0)*100)/100;
const esc = s => String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const acc = code => DB.accounts.find(a=>a.code===code);
const accName = code => { const a=acc(code); return a?a.name:("? "+code); };
const isMainAccount = code => ACCOUNT_GROUPS.some(g=>g.code===code);
const accountMatchesGroup = (account,group) => group.type===account.type&&!isMainAccount(account.code)&&(group.matches?group.matches(account):String(account.code).startsWith(group.prefix));
const accountGroupFor = account => ACCOUNT_GROUPS.find(g=>accountMatchesGroup(account,g))||null;
const groupChildren = group => DB.accounts.filter(a=>accountMatchesGroup(a,group));
function groupBalance(group, entries){
  return r2(groupChildren(group).reduce((sum,a)=>sum+normalBalanceFor(a.code,entries),0));
}
function todayStr(){ const d=new Date(); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }

/* Shared statement periods: current month is always the initial view. */
const REPORT_PERIOD_KEY = "accaza-report-period";
let PERIOD = (window.AccazaReportPeriod&&window.AccazaReportPeriod.get?window.AccazaReportPeriod.get().mode:"month");
/* Browser entries are retained only as a recovery backup. Authoritative
   statements consume shared server entries exclusively, on every device. */
function ENTRIES(){ return (window.__posEntries||[]).slice(); }
function periodBounds(){const p=window.AccazaReportPeriod&&window.AccazaReportPeriod.get?window.AccazaReportPeriod.get():{from:todayStr(),to:todayStr()};return{start:p.from,end:p.to};}
function entryInPeriod(e){const d=String(e&&e.date||"").slice(0,10),r=periodBounds();return !!d&&(!r.start||d>=r.start)&&d<=r.end;}
function entriesInPeriod(){ return ENTRIES().filter(entryInPeriod); }
/* Balance-sheet accounts carry forward. Their displayed balance is the opening
   balance plus every posting through the selected end date, never just the
   activity inside the report range. */
function entriesThroughPeriodEnd(){const end=periodBounds().end;return ENTRIES().filter(e=>{const d=String(e&&e.date||"").slice(0,10);return !!d&&(!end||d<=end);});}
function isBalanceSheetType(type){return type==='Asset'||type==='Liability'||type==='Equity';}
function accountReportEntries(code){const a=acc(code);return isBalanceSheetType(a&&a.type)?entriesThroughPeriodEnd():entriesInPeriod();}
function monthLabel(ym){ if(!ym) return "Current month"; const [y,m]=ym.split("-"); return ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][+m-1]+" "+y; }
function periodLabel(){var p=window.AccazaReportPeriod&&window.AccazaReportPeriod.get?window.AccazaReportPeriod.get():{};return p.label||'This month';}
function periodOptions(){return '<option value="month">Monthly</option><option value="quarter">Quarterly</option><option value="year">Annually</option><option value="custom">Custom dates</option>';}
function periodButtons(){return '<div class="report-periods" aria-label="Financial reporting period"><span class="tiny muted">Shared period: '+esc(periodLabel())+'</span></div>';}
function linkedCustomerPayableId(entry){const payables=window.__apMap||{},exact=Object.keys(payables).filter(id=>{const p=payables[id]||{};return p.type==='customer_change_refund'&&p.status==='open'&&(id===entry.linkedPayableId||p.movementId===entry.id||(entry.sourceId&&p.discrepancyId===entry.sourceId));});return exact.length===1?exact[0]:'';}

/* Append-only journal authority: originals and reversing entries are both posted lines. */
function postedAccountNet(code, entries){
  let bal=0;
  (entries||[]).forEach(e=>{ (e.lines||[]).forEach(l=>{ if(l.code===code) bal+=(Number(l.debit)||0)-(Number(l.credit)||0); }); });
  return r2(bal);
}
/* signed balance in the account's NORMAL direction (debits positive for debit-normal) */
function accountBalance(code, uptoPeriodOnly){
  const a=acc(code);
  const bal=postedAccountNet(code,uptoPeriodOnly?accountReportEntries(code):ENTRIES());
  return DEBIT_NORMAL[a?a.type:"Asset"] ? bal : -bal; // positive = normal side
}
/* raw debit-minus-credit (for balance sheet math) */
function accountNet(code, periodEntries){
  return postedAccountNet(code,periodEntries||ENTRIES());
}
function normalBalanceFor(code, entries){
  const a=acc(code),net=postedAccountNet(code,entries);
  return DEBIT_NORMAL[a?a.type:"Asset"]?net:-net;
}

/* P&L numbers for the current period */
function plData(){
  const ents = entriesInPeriod();
  const salesCodes = new Set(["4000","4010","4020","4030","4900","4910"]);
  const authoritativeEntries=ents.filter(e=>e&&e.source==="pos"),manualEntries=ents.filter(e=>!e||e.source!=="pos");
  const sum = type => DB.accounts.filter(a=>a.type===type).map(a=>({a, bal:normalBalanceFor(a.code,ents)})).filter(x=>Math.abs(x.bal)>0.005);
  const income = sum("Income"), cogs = sum("COGS"), expense = sum("Expense");
  const sales = DB.accounts.filter(a=>a.type==="Income"&&salesCodes.has(a.code)).map(a=>({a,bal:normalBalanceFor(a.code,authoritativeEntries)})).filter(x=>Math.abs(x.bal)>0.005);
  const otherIncome = income.filter(x=>!salesCodes.has(x.a.code));
  const manualSales=salesCodes.size?Array.from(salesCodes).reduce((s,code)=>s+normalBalanceFor(code,manualEntries),0):0;
  if(Math.abs(manualSales)>0.005)otherIncome.push({a:{code:"REVIEW",name:"Unverified manual sales — excluded from net sales",type:"Income"},bal:r2(manualSales),synthetic:true});
  const netSales = sales.reduce((s,x)=>s+x.bal,0);
  const totalOtherIncome = otherIncome.reduce((s,x)=>s+x.bal,0);
  const totalIncome = netSales+totalOtherIncome;
  const totalCogs = cogs.reduce((s,x)=>s+x.bal,0);
  const totalExp = expense.reduce((s,x)=>s+x.bal,0);
  const gross = netSales-totalCogs;
  const net = gross+totalOtherIncome-totalExp;
  return {income,sales,otherIncome,cogs,expense,totalIncome,netSales,totalOtherIncome,totalCogs,totalExp,gross,net,ents};
}
