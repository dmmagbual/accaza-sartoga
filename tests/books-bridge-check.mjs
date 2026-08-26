// Accaza Books — POS → journal bridge checks (mapping, business date, daily
// aggregation, idempotency, discrete non-sale entries). Pure, no Firebase.
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const B = require('../functions/lib/books-bridge.js');

let failed = 0;
function ok(cond, msg){ if(!cond){ console.error('FAIL: '+msg); failed++; } }
const cashMap = {gcash:'1020', bank:'1010'};

// 1) account mapping
ok(B.mapAccount('revenue:sales','instore',cashMap).code==='4000','revenue:sales instore→4000');
ok(B.mapAccount('revenue:sales','online',cashMap).code==='4010','revenue:sales online→4010');
ok(B.mapAccount('revenue:sales','grabfood',cashMap).code==='4020','revenue:sales grabfood→4020');
ok(B.mapAccount('asset:register_cash','instore',cashMap).code==='1000','register_cash→1000');
ok(B.mapAccount('asset:cash_account:gcash','instore',cashMap).code==='1020','cash_account:gcash→1020 via map');
ok(B.mapAccount('asset:cash_account:unknownid','instore',cashMap).code==='1010','unmapped cash_account→1010 default');
ok(B.mapAccount('asset:platform_receivable:grabfood','grabfood',cashMap).code==='1100','platform_receivable→1100');
ok(B.mapAccount('expense:platform_commission','grabfood',cashMap).code==='6040','platform_commission→6040');
ok(B.mapAccount('expense:platform_variance:va_ads','grabfood',cashMap).code==='6050','Grab ads settlement variance→6050 marketing');
ok(B.mapAccount('expense:platform_variance:va_marketing_success','grabfood',cashMap).code==='6050','Grab marketing success fee→6050 marketing');
ok(B.mapAccount('revenue:platform_variance:va_refund_recovery','grabfood',cashMap).code==='4910','Grab refund recovery→4910 sales returns/refunds');
ok(B.mapAccount('expense:platform_variance:va_promo','grabfood',cashMap).code==='6045','platform promo variance→6045 platform discounts');
ok(B.mapAccount('expense:platform_variance:va_fees','grabfood',cashMap).code==='6080','platform fee variance→6080 bank/payment fees');
ok(B.mapAccount('expense:platform_variance:va_penalty','grabfood',cashMap).code==='6085','platform penalty variance→6085 penalties/adjustments');
ok(B.mapAccount('expense:platform_variance:va_refund','grabfood',cashMap).code==='4910','platform refund variance→4910 returns/refunds');
ok(B.mapAccount('expense:customer_discount','instore',cashMap).code==='4900','customer discount→sales contra-income 4900');
ok(B.mapAccount('expense:platform_discount','grabfood',cashMap).code==='4900','platform discount→sales contra-income 4900');
ok(B.mapAccount('expense:platform_merchant_funded_promo','grabfood',cashMap).code==='6045','merchant-funded promo→6045 platform discounts');
ok(B.mapAccount('expense:platform_delivery_fee_discount','grabfood',cashMap).code==='6045','delivery fee discount→6045 platform discounts');
const grabDeductionMovement={type:'platform_payout_settlement',sourceId:'GRAB-PAYOUT-1',channel:'grabfood',lines:[
  {account:'expense:platform_commission',debit:25,credit:0,label:'Commission'},
  {account:'expense:platform_merchant_funded_promo',debit:10,credit:0,label:'Merchant-funded promo'},
  {account:'expense:platform_delivery_fee_discount',debit:5,credit:0,label:'Delivery fee discount'},
  {account:'expense:platform_variance:va_marketing_success',debit:3,credit:0,label:'Marketing success fee'},
  {account:'expense:platform_variance:va_ads',debit:2,credit:0,label:'Advertisements'},
  {account:'asset:platform_receivable:grabfood',debit:0,credit:45,label:'Grab receivable'}
]};
const grabDeductionBooks=B.mappedLines(grabDeductionMovement,cashMap,{});
ok(grabDeductionBooks.lines.filter(l=>l.code==='6040').reduce((s,l)=>s+l.debit,0)===25,'Grab commission reaches Finance Books 6040');
ok(grabDeductionBooks.lines.filter(l=>l.code==='6045').reduce((s,l)=>s+l.debit,0)===15,'Grab merchant promo and delivery discount reach Finance Books 6045');
ok(grabDeductionBooks.lines.filter(l=>l.code==='6050').reduce((s,l)=>s+l.debit,0)===5,'Grab marketing success fee and advertisements reach Finance Books 6050');
ok(B.mapAccount('revenue:sales_reversal','instore',cashMap).code==='4910','refund reversal→returns and refunds 4910');
ok(B.mapAccount('liability:payable:po_1','instore',cashMap).code==='2000','payable→2000');
ok(B.mapAccount('liability:platform_owing:grabfood','grabfood',cashMap).code==='2020','negative platform payout→2020 liability');
ok(B.mapAccount('expense:cash_shortage','instore',{}).code==='3100','cash shortage→owner drawings');
ok(B.mapAccount('inventory:legacy_receipt','instore',{}).code==='1290','unposted inventory receipt→1290 clearing');
ok(B.mapAccount('liability:grni:legacy','instore',{}).code==='2090','unrecorded payable→2090 clearing');
const legacyMovement={type:'payable_created',sourceId:'ap_pinv_legacy',lines:[{account:'expense_or_inventory:purchases',debit:100,credit:0},{account:'liability:payable:ap_pinv_legacy',debit:0,credit:100}]};
const legacyPurchase=B.mappedLines(legacyMovement,{}, {purchaseInvoice:{lines:[{itemId:'beans',total:100}]},inventory:{beans:{inventoryAccount:'1200',costAccount:'5000'}}});
ok(legacyPurchase.lines.some(l=>l.code==='1200'&&l.debit===100),'legacy Admin purchase rebuilds to its item inventory account');
const legacyPurchaseFallback=B.mappedLines(legacyMovement,{},{});
ok(legacyPurchaseFallback.lines.some(l=>l.code==='1290'&&l.debit===100),'legacy purchase without saved item mapping→1290 review clearing');
ok(B.mapAccount('cogs:legacy','instore',{}).code==='5090','unposted COGS→5090 clearing');
ok(B.cashCodeForAccount({name:'Union Bank',type:'bank'})==='1011','Union Bank→1011');
ok(B.cashCodeForAccount({name:'BDO',type:'bank'})==='1012','BDO→1012');
ok(B.cashCodeForAccount({name:'G-Cash',type:'ewallet'})==='1020','G-Cash→1020');
ok(B.cashCodeForAccount({name:'Security Bank-4538',type:'bank'})==='1013','Security Bank 4538→1013');
ok(B.cashCodeForAccount({name:'Security Bank-4389',type:'bank'})==='1014','Security Bank 4389→1014');
const un = B.mapAccount('asset:unmapped_payment:foo','instore',cashMap);
ok(un.code==='1900' && un.unmapped===true,'unknown account→1900 + unmapped flag');

// 2) business date (Asia/Manila). 2026-08-22T20:00:00Z → Manila 2026-08-23 04:00.
ok(B.businessDate(Date.parse('2026-08-22T20:00:00Z'))==='2026-08-23','business date rolls into Manila day');
ok(B.businessDate(Date.parse('2026-08-22T10:00:00Z'))==='2026-08-22','business date same Manila day');

// 3) classification
ok(B.isSaleMovement({type:'order_sale'}),'order_sale is sale');
ok(B.isSaleMovement({sourceType:'order'}),'sourceType order is sale');
ok(!B.isSaleMovement({type:'purchase_receive',sourceType:'purchase'}),'purchase is not sale');
const voidSources=B.fullyVoidedSourceIds({sale_A:{type:'order_sale',sourceId:'A'},void_A:{type:'order_void',sourceId:'A'},sale_B:{type:'order_sale',sourceId:'B'}});
ok(voidSources.has('A')&&!voidSources.has('B'),'full void source detection is exact');
ok(!B.includeInRecognizedBooks({type:'order_sale',sourceType:'order',sourceId:'A'},voidSources),'voided sale is excluded from recognized Books');
ok(!B.includeInRecognizedBooks({type:'orphan_order_reversal',sourceType:'order',sourceId:'A'},voidSources),'void correction chain is excluded with its source');
ok(B.includeInRecognizedBooks({type:'order_refund',sourceType:'order',sourceId:'B'},voidSources),'non-void refund remains in recognized Books');

// helper to make a sale movement
const t = Date.parse('2026-08-22T05:00:00Z'); // Manila 13:00 same day
function sale(id, channel, lines){ return {id, type:'order_sale', sourceType:'order', channel, occurredAt:t, lines}; }

// 4) daily aggregation + idempotency
let node = null;
node = B.applyDaily(node, sale('m1','instore',[{account:'asset:register_cash',debit:500,credit:0},{account:'revenue:sales',debit:0,credit:500}]), cashMap);
node = B.applyDaily(node, sale('m2','instore',[{account:'asset:cash_account:gcash',debit:300,credit:0},{account:'revenue:sales',debit:0,credit:300}]), cashMap);
// re-fire m1 → must abort (undefined), no double count
const again = B.applyDaily(node, sale('m1','instore',[{account:'asset:register_cash',debit:500,credit:0},{account:'revenue:sales',debit:0,credit:500}]), cashMap);
ok(again===undefined,'re-applying same movement id aborts (idempotent)');
ok(node.sourceCount===2,'sourceCount=2 after two distinct movements');
const lines = B.netToLines(node.net);
ok(B.linesBalanced(lines),'daily summary net → balanced lines');
const c4000 = lines.find(l=>l.code==='4000');
ok(c4000 && Math.abs(c4000.credit-800)<0.005,'4000 sales credit = 800 (500+300)');
const c1000 = lines.find(l=>l.code==='1000');
ok(c1000 && Math.abs(c1000.debit-500)<0.005,'1000 cash debit = 500');
const c1020 = lines.find(l=>l.code==='1020');
ok(c1020 && Math.abs(c1020.debit-300)<0.005,'1020 gcash debit = 300');
ok(B.netSales(node.net)===800,'net sales includes channel sales and excludes non-sales income');
ok(B.netSales({'4000':-1000,'4900':75,'4910':50,'4990':-50})===875,'net sales deducts discounts and refunds but excludes other income');

// 5) discrete non-sale entry (purchase on account)
const purchase = {id:'purchase_ap_po9', type:'purchase_receive', sourceType:'purchase', occurredAt:t,
  lines:[{account:'inventory:beans',debit:1000,credit:0},{account:'liability:payable:po9',debit:0,credit:1000}]};
const built = B.buildSingle(purchase, cashMap);
ok(built.entry.id==='purchase_ap_po9','single entry keyed by movement id');
ok(B.linesBalanced(built.entry.lines),'discrete purchase entry balances');
ok(built.entry.lines.some(l=>l.code==='2000'&&l.credit===1000),'payable→2000 credit 1000');
ok(built.unmapped.some(u=>u.account==='inventory:beans'),'unknown inventory account flagged unmapped');

// 6) COGS leg: order cogs snapshot -> Dr COGS / Cr Inventory (account strings; codes via mapAccount)
const order = {channel:"instore", cogsSnapshot:41.5, cogsCategorySnapshot:{beverage:30, food:10, packaging:1.5, directLabor:0, unallocated:0}, completedAt: Date.parse("2026-08-22T05:00:00Z")};
const cl = B.cogsLines(order);
ok(B.linesBalanced(cl), "cogs lines balance (Dr COGS = Cr Inventory)");
ok(cl.find(l=>l.account==="cogs:beverage" && Math.abs(l.debit-30)<0.005), "beverage COGS debit 30");
ok(cl.find(l=>l.account==="cogs:food" && Math.abs(l.debit-10)<0.005), "food COGS debit 10");
ok(cl.find(l=>l.account==="cogs:packaging" && Math.abs(l.debit-1.5)<0.005), "packaging COGS debit 1.5");
ok(cl.find(l=>l.account==="inventory:control" && Math.abs(l.credit-41.5)<0.005), "inventory:control credit 41.5");
ok(B.mapAccount("cogs:beverage","instore",{}).code==="5000", "cogs:beverage -> 5000");
ok(B.mapAccount("cogs:food","instore",{}).code==="5030", "cogs:food -> 5030");
ok(B.mapAccount("cogs:packaging","instore",{}).code==="5040", "cogs:packaging -> 5040");
ok(B.mapAccount("inventory:control","instore",{}).code==="1200", "inventory:control -> 1200");
const detailedOrder={channel:"instore",cogsSnapshot:15,cogsAccountSnapshot:{"1200|5000":4,"1210|5010":5,"1220|5020":3,"1230|5040":2,"1240|5030":1}};
const detailed=B.cogsLines(detailedOrder);
ok(B.linesBalanced(detailed),"item-category COGS mapping balances");
for(const [asset,cogs,amount] of [["1200","5000",4],["1210","5010",5],["1220","5020",3],["1230","5040",2],["1240","5030",1]]){ok(detailed.some(l=>l.account===`coa:${asset}`&&l.credit===amount),`inventory ${asset} credited`);ok(detailed.some(l=>l.account===`coa:${cogs}`&&l.debit===amount),`COGS ${cogs} debited`);}
ok(B.mapAccount("coa:1210","instore",{}).code==="1210","direct mapped COA account retained");
const historical=B.cogsAccountSnapshot({cogsDetail:{lines:[{ingredientId:"milk",totalCost:8}]}},{milk:{inventoryAccount:"1210",costAccount:"5010"}},{});
ok(historical["1210|5010"]===8,"historical item detail uses the item's own account mapping");
const overhead=B.cogsAccountSnapshot({cogsDetail:{lines:[{ingredientId:"cleaner",totalCost:6}]}},{cleaner:{inventoryAccount:"1270",costAccount:"6070"}},{});
ok(overhead["1270|6070"]===6,"overhead item uses its own inventory and expense codes");
ok(B.mapAccount("coa:1270","instore",{}).code==="1270"&&B.mapAccount("coa:6070","instore",{}).code==="6070","overhead direct COA codes retained");
// bucket mismatch reconciles to authoritative total
const order2 = {channel:"instore", cogsSnapshot:50, cogsCategorySnapshot:{beverage:30, food:10}, completedAt: Date.parse("2026-08-22T05:00:00Z")};
ok(Math.abs(B.cogsLines(order2).find(l=>l.account==="inventory:control").credit - 50) < 0.005, "cogs reconciles buckets to total (50)");
// fold cogs pseudo-movement into a daily node and stay balanced + idempotent
const cm = B.cogsMovement(order, "ORD1");
let n = B.applyDaily(null, cm, {});
ok(B.linesBalanced(B.netToLines(n.net)), "cogs-only daily node balances");
ok(B.applyDaily(n, cm, {})===undefined, "cogs movement idempotent (re-fire aborts)");
ok(B.recognizedOrderForCogs({status:'Completed',paymentStatus:'confirmed'})===true,'completed confirmed order qualifies for COGS');
ok(B.recognizedOrderForCogs({status:'Archived',prevStatus:'Received',paymentStatus:'cashier_verified'})===true,'archived received order qualifies for COGS');
ok(B.recognizedOrderForCogs({status:'Archived',prevStatus:'Completed',paymentStatus:'confirmed',voided:true})===false,'voided order COGS is excluded');
ok(B.recognizedOrderForCogs({status:'Completed',paymentStatus:'pending'})===false,'pending-payment order COGS is excluded');

// 7) Fixed assets: account mappings + straight-line depreciation math
ok(B.mapAccount("asset:fixed_asset:equipment","instore",{}).code==="1500", "fixed_asset:equipment -> 1500");
ok(B.mapAccount("asset:fixed_asset:furniture","instore",{}).code==="1510", "fixed_asset:furniture -> 1510");
ok(B.mapAccount("asset:accumulated_depreciation","instore",{}).code==="1590", "accum depreciation -> 1590");
ok(B.mapAccount("expense:depreciation","instore",{}).code==="6090", "depreciation expense -> 6090");
ok(B.mapAccount("revenue:asset_disposal_gain","instore",{}).code==="4990", "disposal gain -> 4990");
ok(B.mapAccount("expense:asset_disposal_loss","instore",{}).code==="6100", "disposal loss -> 6100");
ok(Math.abs(B.monthlyStraightLine(85000,5000,60) - 1333.33) < 0.005, "straight-line monthly = (85000-5000)/60 = 1333.33");
ok(Math.abs(B.monthlyStraightLine(12000,0,12) - 1000) < 0.005, "straight-line monthly = 1000");
ok(Math.abs(B.netBookValue({cost:85000, accumulatedDepreciation:1333.33}) - 83666.67) < 0.005, "NBV = cost - accum dep");

// 8) Bill / manual expense / owner capital-draw chart-category mapping
ok(B.mapAccount("expense_or_inventory:rent","instore",{}).code==="6010", "bill rent -> 6010");
ok(B.mapAccount("expense_or_inventory:bank charges","instore",{}).code==="6080", "bill 'bank charges' -> 6080");
ok(B.mapAccount("expense_or_inventory:utilities","instore",{}).code==="6020", "bill utilities -> 6020");
ok(B.mapAccount("expense:rent","instore",{}).code==="6010", "manual expense rent -> 6010");
ok(B.mapAccount("expense:utilities","instore",{}).code==="6020", "manual expense utilities -> 6020");
ok(B.mapAccount("expense:supplies","instore",{}).code==="6070", "Revolving Fund operating supplies -> 6070");
ok(B.mapAccount("expense:office_supplies","instore",{}).code==="6075", "Revolving Fund office supplies -> 6075");
ok(B.mapAccount("equity:capital_in","instore",{}).code==="3000", "owner capital -> 3000");
ok(B.mapAccount("equity:owner_draw","instore",{}).code==="3100", "owner draw -> 3100");
var u=B.mapAccount("expense_or_inventory:zzzunknown","instore",{}); ok(u.code==="6100" && u.unmapped===true, "unknown bill type -> 6100 + flag");
// existing POS strings must be unaffected
ok(B.mapAccount("revenue:sales","instore",{}).code==="4000", "revenue:sales still -> 4000");
ok(B.mapAccount("asset:register_cash","instore",{}).code==="1000", "register_cash still -> 1000");
ok(B.mapAccount("liability:payable:po1","instore",{}).code==="2000", "payable still -> 2000");

// 9) Server-authoritative inventory opening-balance preview.
const invRecon=B.inventoryReconciliationSnapshot({
  beans:{name:'Beans',stock:10,cost:20,inventoryAccount:'1200',costAccount:'5000'},
  milk:{name:'Milk',stock:5,cost:10,inventoryAccount:'1210',costAccount:'5010'}
},{daily:{net:{'1200':-25,'1210':10}},purchase:{lines:[{code:'1200',debit:5,credit:0}]}});
ok(invRecon.totalStock===250,'inventory reconciliation stock value is server-derived');
ok(invRecon.totalBooks===-10,'inventory reconciliation Books balance includes net and line journal formats');
ok(invRecon.totalDifference===260,'inventory reconciliation difference is correct');
ok(invRecon.rows.find(r=>r.code==='1200').difference===220,'inventory account difference is correct');
ok(invRecon.unmapped.length===0&&invRecon.clearingBalance===0,'clean inventory reconciliation has no blocking exceptions');

if(failed){ console.error(`\n${failed} bridge check(s) FAILED`); process.exit(1); }
console.log('PASS: Accaza Books POS→journal bridge (mapping, business date, daily aggregation, idempotency, discrete entries, COGS leg, fixed assets, chart-category mapping) checks passed.');
