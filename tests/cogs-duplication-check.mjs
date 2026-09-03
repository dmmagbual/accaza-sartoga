#!/usr/bin/env node
/* Accaza - guard for correcting cost of sales that was posted twice.
   A Hot choice that repeated the whole recipe was ADDED to the base, so the order's own posted
   cost detail carries the same ingredient twice. The correction reads that posted record, puts
   the stock back at today's cost, and credits the cost-of-sales account it was charged to. */
import fs from 'node:fs';
import vm from 'node:vm';
let failures=0;
const fail=m=>{failures++;console.error('FAIL: '+m);};
const ok=m=>console.log('PASS: '+m);
const check=(c,m)=>c?ok(m):fail(m);
const near=(a,b)=>Math.abs(Number(a)-Number(b))<0.011;

const sandbox={module:{exports:{}},console};sandbox.globalThis=sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('assets/js/shared/cogs-duplication-audit.js','utf8'),sandbox,{filename:'cogs-duplication-audit.js'});
const Audit=sandbox.module.exports;
check(Audit&&typeof Audit.audit==='function','the shared COGS duplication audit loads');

function line(itemKey,size,source,ingredientId,name,qty,cost){
  return {itemKey,size,source,ingredientId,ingredientName:name,stockUnit:'ml',totalQuantity:qty,totalCost:cost,itemName:'Latte'};
}
const orders={
  /* a hot latte: the base charged milk and beans, and the Hot choice charged them again */
  o1:{timestamp:Date.UTC(2026,7,14),lineItems:[{itemKey:'latte',size:'M',name:'Latte',qty:1,optLabels:['Hot']}],
    cogsDetail:{lines:[
      line('latte','M','base','milk','Milk',250,25),line('latte','M','base','bean','Beans',19,26.6),
      line('latte','M','option_recipe','milk','Milk',250,25),line('latte','M','option_recipe','bean','Beans',19,26.6)]}},
  /* an iced latte: no Hot choice, nothing to correct */
  o2:{timestamp:Date.UTC(2026,7,15),lineItems:[{itemKey:'latte',size:'M',name:'Latte',qty:1,optLabels:['Iced']}],
    cogsDetail:{lines:[line('latte','M','base','milk','Milk',250,25),line('latte','M','option_recipe','ice','Ice',200,1)]}},
  /* a hot latte with syrup: the syrup is a genuine addition and must survive */
  o3:{timestamp:Date.UTC(2026,8,2),lineItems:[{itemKey:'latte',size:'M',name:'Latte',qty:1,optLabels:['Hot','Hazelnut Syrup']}],
    cogsDetail:{lines:[
      line('latte','M','base','milk','Milk',250,25),line('latte','M','option_recipe','milk','Milk',250,25),
      line('latte','M','option_recipe','syrup','Hazelnut',0.75,16)]}},
  /* a hot latte with an extra shot: the second helping of beans may be genuine - never guess */
  o4:{timestamp:Date.UTC(2026,7,20),lineItems:[{itemKey:'latte',size:'M',name:'Latte',qty:1,optLabels:['Hot','Add 1 Shot']}],
    cogsDetail:{lines:[line('latte','M','base','bean','Beans',19,26.6),line('latte','M','option_recipe','bean','Beans',19,26.6)]}}
};
const result=Audit.audit(orders);
check(result.ordersRead===4,'every posted order is read');
check(result.linesCorrected===2,'only the lines that chose Hot and double-charged are corrected');
check(near(result.historicCost,25+26.6+25),'the amount corrected is exactly what was charged twice');
check(result.rows.every(r=>r.itemId!=='syrup'),'a syrup the base never held is left alone');
check(result.rows.every(r=>r.itemId!=='ice'),'an iced order is left alone');
check(result.skipped.length===1&&near(result.skipped[0].cost,26.6),'a line with an extra shot is reported, never corrected');
check(result.rows.some(r=>r.month==='2026-08')&&result.rows.some(r=>r.month==='2026-09'),'the schedule splits by the month the order was rung up');

const inventory={milk:{name:'Milk',unit:'ml',cost:0.08},bean:{name:'Beans',unit:'g',cost:1.2}};
const plan=Audit.movements(result,inventory,{now:Date.UTC(2026,8,3),actorName:'Tester'});
check(plan.movements.length===result.rows.length,'one stock movement per ingredient per month');
check(plan.movements.every(m=>m.type==='adjustment'),'the correction is posted as a stock adjustment');
check(plan.movements.every(m=>m.adjustmentNature==='costing-correction'),'every movement is marked a costing correction');
check(plan.movements.every(m=>m.offsetAccount==='5000'),'the credit goes to the cost-of-sales account it was charged to');
check(plan.movements.every(m=>m.qty>0),'the correction puts stock back, never takes it away');
const ids=plan.movements.map(m=>m.movementId);
check(new Set(ids).size===ids.length,'movement ids are unique');
check(ids.every(id=>/^costfix_\d{6}_/.test(id)),'movement ids are derived from the month and item, so a second run posts nothing');
const august=plan.movements.filter(m=>/^costfix_202608_/.test(m.movementId));
check(august.length>0&&august.every(m=>new Date(m.occurredAt).getUTCMonth()===7||new Date(m.occurredAt).getMonth()===7),'an August correction is dated into August');
check(plan.movements.every(m=>m.occurredAt<=Date.UTC(2026,8,3)),'no correction is dated in the future');
check(near(plan.restoredValue,250*0.08+19*1.2+250*0.08),'the value restored is the quantity at the cost ruling today');
check(near(plan.residualValue,plan.historicCost-plan.restoredValue),'the gap between what was charged and what is restored is reported, not hidden');
check(plan.residualValue!==0,'the cost drift is surfaced as its own number');

/* running the audit again on the same orders must produce the same movement ids */
const again=Audit.movements(Audit.audit(orders),inventory,{now:Date.UTC(2026,8,4)});
check(JSON.stringify(again.movements.map(m=>m.movementId).sort())===JSON.stringify(ids.slice().sort()),'a second run asks to post exactly the same movements, so nothing doubles up');

/* the server must only let a costing correction reach a cost-of-sales account */
const inv=fs.readFileSync('src/functions/50-inventory.js','utf8');
check(/COST_OF_SALES_ACCOUNTS/.test(inv),'the server names the cost-of-sales accounts it will accept');
check(/A cost of sales account may only offset a costing correction/.test(inv),'the server refuses a cost-of-sales offset on any other adjustment');
check(/A costing correction must offset the cost of sales account it was charged to/.test(inv),'the server refuses a costing correction sent to wastage or reconciliation');
check(/A costing correction must be posted as a stock adjustment/.test(inv),'a revaluation cannot reach a cost-of-sales account');

const ui=fs.readFileSync('src/admin/pos/31-recipe-temperature-repair.js','utf8');
check(/cogsFixPost/.test(ui),'the admin screen offers the correction');
check(/5905/.test(ui)&&/residualValue/.test(ui),'the screen tells the user the leftover entry to post by hand');
check(/skipped/.test(ui),'the screen surfaces the lines it refused to correct');
check(/cogs-duplication-audit\.js/.test(fs.readFileSync('admin.html','utf8')),'admin.html loads the audit');
check(/cogs-duplication-audit\.js/.test(fs.readFileSync('sw.js','utf8')),'the service worker caches the audit');
check(/cogsFixPost/.test(fs.readFileSync('assets/js/admin/pos.js','utf8')),'the built admin bundle carries the correction');

console.log(failures?`\n${failures} check(s) failed.`:'\nAll COGS duplication checks passed.');
process.exit(failures?1:0);
