// 29 Oct 2026: the settled payout audit and the P&L CSV export moved unchanged out of analytics.js.
// This runs both moved modules with fixtures, so the split is proved by behaviour, not only by source text.
import {createPayoutAudit} from '../assets/js/admin/payout-audit.mjs';
import {exportPnlCsv} from '../assets/js/admin/pnl-export.mjs';
const fail=m=>{throw new Error(m);};
const has=(html,parts,label)=>{for(const p of parts)if(!html.includes(p))fail(`${label}: missing ${p}`);};
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const peso=n=>'P'+(Number(n)||0).toFixed(2);
let state={ordersMap:{},archMap:{},payoutsMap:{},payoutCashAccounts:{bdo:{name:'BDO <main>'}}};
const audit=createPayoutAudit({state:()=>state,esc,peso,poGrabDeductions:()=>({merchantPromo:10,deliveryFeeDiscount:5}),poGross:o=>o.total,poNet:o=>o.total-100,varAccounts:()=>[{id:'va_ads',name:'Platform ads',type:'expense'}]});

// Immutable snapshot: cent-exact total, allocations, GrabFood loan principal, escaped account name.
const snap={id:'p1',channel:'grabfood',orderSnapshots:[{orderId:'o1',platformRef:'GF-1',expectedNet:150.1},{orderId:'o2',platformRef:'GF-2',expectedNet:49.9}],expectedNet:200,actualPayout:195,variance:-5,accountId:'bdo',allocations:{va_ads:5},loanRepayment:{amount:20,accountCode:'2310',accountName:'GrabFood loan'}};
let html=audit.content(snap,false);
has(html,['GrabFood payout audit','Reconciled','P200.00','Platform ads','liability principal','2310 · GrabFood loan','BDO &lt;main&gt;','data-poprint="p1"'],'snapshot audit');
if(html.includes('Legacy payout'))fail('snapshot audit must not be labelled legacy');

// Legacy payout: rebuilt from current orders, read at call time (state replaced after the module was created).
state={...state,ordersMap:{o1:{id:'FP-1',date:'2026-10-01',total:500}}};
html=audit.content({id:'p2',channel:'foodpanda',orderIds:['o1','gone<1>'],expectedNet:400},true);
has(html,['FoodPanda payout audit','Legacy payout','Missing source order(s): gone&lt;1&gt;','Reconciled','FP-1','P500.00','P10.00'],'legacy audit');
if(html.includes('data-poprint'))fail('print mode must not render the Print audit button');
if(!audit.content({id:'p3',orderSnapshots:[{expectedNet:10}],expectedNet:12},false).includes('Difference P-2.00'))fail('audit difference must be shown');

// Print opens a document for the stored payout; a blocked pop-up is explained.
let written='',alerted='';
globalThis.alert=m=>{alerted=m;};
globalThis.window={open:()=>({document:{write:x=>{written=x;},close(){}}})};
state={...state,payoutsMap:{p1:snap}};
audit.print('p1');
has(written,['<title>Payout audit p1</title>','GrabFood payout audit','window.print()'],'printed audit');
if(written.includes('data-poprint'))fail('printed audit must not include the Print audit button');
globalThis.window={open:()=>null};audit.print('p1');
if(!alerted.includes('Allow pop-ups'))fail('blocked print pop-up must be explained');

// P&L CSV: same lines, signs and file name as before the move.
const side=(k)=>({revenueByChannel:{instore:100*k,grabfood:50*k,foodpanda:25*k,online:5*k},customerDiscounts:3*k,revenue:177*k,cogsByCategory:{food:20*k,beverage:30*k,packaging:4*k,directLabor:0,unallocated:1*k},variance:2*k,totalCogs:57*k,gp:120*k,platformByChannel:{grabfood:12*k,foodpanda:6*k},reconBy:{va_ads:7*k,va_del:3*k},platformCosts:28*k,expenseGroups:{operating:{rent:30*k,other:4*k},other:{interest:1*k,bank:0.5*k,other:0},tax:2*k},totalUsage:1*k,operatingExpenseTotal:35*k,operatingProfit:57*k,otherIncome:0,otherNet:-1.5*k,profitBeforeTax:55.5*k,net:53.5*k,platformWht:0.75*k});
let csv='',clicked=false,fileName='';
globalThis.Blob=class{constructor(parts){csv=parts.join('');}};
globalThis.URL.createObjectURL=()=>'blob:test';globalThis.URL.revokeObjectURL=()=>{};
globalThis.document={createElement:()=>({set download(v){fileName=v;},click(){clicked=true;}})};
exportPnlCsv(side(1),side(2),'2026-09',[], {monthLabel:k=>'M'+k,pnlMonth:'2026-10',varAccounts:()=>[{id:'va_ads',name:'Platform advertising',type:'expense'},{id:'va_del',name:'Delivery rider fee',type:'expense'},{id:'va_inc',name:'Incentive',type:'revenue'}],PNL_OPEX_LINES:[{id:'rent',label:'Rent'}]});
has(csv,['"Accaza Profit & Loss","M2026-10"','"Line","This month","Last month (M2026-09)"','"  In-store sales","100.00","200.00"','"  Platform advertising and promotions","-7.00","-14.00"','"  Delivery charges absorbed by the restaurant","-3.00","-6.00"','"  Rent","-30.00","-60.00"','"  Other identified operating expenses","-5.00","-10.00"','"Net profit","53.50","107.00"','"Memo: creditable withholding tax (not an expense)","0.75","1.50"'],'P&L CSV');
if(!clicked||fileName!=='accaza-pnl-2026-10.csv')fail('P&L CSV download did not start with the expected file name');
console.log('PASS: payout audit (snapshot, legacy, missing orders, loan principal, print) and P&L CSV export behave the same after the split.');
