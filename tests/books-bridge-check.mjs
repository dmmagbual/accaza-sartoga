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
ok(B.mapAccount('liability:payable:po_1','instore',cashMap).code==='2000','payable→2000');
const un = B.mapAccount('asset:unmapped_payment:foo','instore',cashMap);
ok(un.code==='1900' && un.unmapped===true,'unknown account→1900 + unmapped flag');

// 2) business date (Asia/Manila). 2026-08-22T20:00:00Z → Manila 2026-08-23 04:00.
ok(B.businessDate(Date.parse('2026-08-22T20:00:00Z'))==='2026-08-23','business date rolls into Manila day');
ok(B.businessDate(Date.parse('2026-08-22T10:00:00Z'))==='2026-08-22','business date same Manila day');

// 3) classification
ok(B.isSaleMovement({type:'order_sale'}),'order_sale is sale');
ok(B.isSaleMovement({sourceType:'order'}),'sourceType order is sale');
ok(!B.isSaleMovement({type:'purchase_receive',sourceType:'purchase'}),'purchase is not sale');

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
// bucket mismatch reconciles to authoritative total
const order2 = {channel:"instore", cogsSnapshot:50, cogsCategorySnapshot:{beverage:30, food:10}, completedAt: Date.parse("2026-08-22T05:00:00Z")};
ok(Math.abs(B.cogsLines(order2).find(l=>l.account==="inventory:control").credit - 50) < 0.005, "cogs reconciles buckets to total (50)");
// fold cogs pseudo-movement into a daily node and stay balanced + idempotent
const cm = B.cogsMovement(order, "ORD1");
let n = B.applyDaily(null, cm, {});
ok(B.linesBalanced(B.netToLines(n.net)), "cogs-only daily node balances");
ok(B.applyDaily(n, cm, {})===undefined, "cogs movement idempotent (re-fire aborts)");

if(failed){ console.error(`\n${failed} bridge check(s) FAILED`); process.exit(1); }
console.log('PASS: Accaza Books POS→journal bridge (mapping, business date, daily aggregation, idempotency, discrete entries, COGS leg) checks passed.');
