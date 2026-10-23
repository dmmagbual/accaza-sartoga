'use strict';
/* Register cash over/short consolidation (owner decision, 23 Oct 2026):
   new overages post to 6110 beside shortages, posted history keeps its 4990
   mapping, the open month moves through linked idempotent reclass journals,
   and the P&L shows 6110's period net as other income (credit) or other
   expense (debit), never as an operating expense. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const B=require(path.join(root,'functions/lib/books-bridge.js'));
const R=require(path.join(root,'functions/lib/cash-over-short-reclass.js'));
const F=require(path.join(root,'functions/lib/financial.js'));

// 1. Mapping: new key → 6110; the historical key still rebuilds into 4990.
assert.equal(B.mapAccount('revenue:register_cash_overage','instore',{}).code,'6110');
assert.equal(B.mapAccount('revenue:unexplained_cash_overage','instore',{}).code,'4990');
assert.equal(B.mapAccount('expense:cash_shortage','instore',{}).code,'6110');

// 2. Both server overage paths post the new key; neither still posts the old one.
const ops=fs.readFileSync(path.join(root,'src/functions/21-operational-controls.js'),'utf8');
assert.equal((ops.match(/"revenue:register_cash_overage"/g)||[]).length,2,'both unexplained-overage paths use the 6110 key');
assert.ok(!ops.includes('"revenue:unexplained_cash_overage"'),'no live path posts new overages to 4990');
const bundle=fs.readFileSync(path.join(root,'functions/index.js'),'utf8');
assert.ok(bundle.includes("action==='reclass_cash_overage_6110'")&&bundle.includes('require("./lib/cash-over-short-reclass")'),'reclass action is in the deployed bundle');
assert.ok(/reclass_cash_overage_6110[\s\S]{0,900}\['owner','superadmin','admin','manager'\]/.test(bundle),'reclass is manager-only');
assert.ok(bundle.includes('assertAccountingPeriodOpen(db,bounds.start,"reclassifying register overages")'),'a closed month is refused before any read or post');
assert.ok(bundle.includes("The overages changed since your preview."),'posting refuses anything that differs from the approved preview');

// 3. Reclass plan.
const at=(d)=>Date.parse(`${d}T21:00:00+08:00`);
const ov=(id,date,amt,extra)=>[id,Object.assign({type:'shift_cash_variance_resolution',sourceType:'discrepancy',sourceId:'d_'+id,occurredAt:at(date),documentNo:'CV-'+id,
  lines:[{account:'liability:cash_overage_pending',debit:amt,credit:0},{account:'revenue:unexplained_cash_overage',debit:0,credit:amt}]},extra||{})];
const movements=Object.fromEntries([
  ov('a','2026-10-03',50),
  ov('b','2026-10-10',20.5),
  ov('c','2026-10-12',30),                                     // reversed in month → nets to zero
  ['c_rev',{type:'movement_reversal',reversesMovementId:'c',occurredAt:at('2026-10-13'),lines:[{account:'revenue:unexplained_cash_overage',debit:30,credit:0},{account:'liability:cash_overage_pending',debit:0,credit:30}]}],
  ov('sep','2026-09-30',99),                                   // earlier month stays as posted
  ['tips',{type:'shift_tips_declared',occurredAt:at('2026-10-05'),lines:[{account:'asset:register_cash',debit:40,credit:0},{account:'revenue:pos_tips',debit:0,credit:40}]}],
  ['orphan_rev',{type:'movement_reversal',reversesMovementId:'sep_x',occurredAt:at('2026-10-02'),lines:[{account:'revenue:unexplained_cash_overage',debit:15,credit:0},{account:'liability:cash_overage_pending',debit:0,credit:15}]}],
  ['new6110',{type:'shift_cash_variance_resolution',occurredAt:at('2026-10-20'),lines:[{account:'liability:cash_overage_pending',debit:5,credit:0},{account:'revenue:register_cash_overage',debit:0,credit:5}]}]
]);
const p=R.plan(movements,'2026-10');
assert.deepEqual(p.candidates.map(c=>[c.rootId,c.amount]),[['a',50],['b',20.5]],'only October overages still in 4990 are reclassed');
assert.equal(p.total,70.5);
assert.equal(p.candidates[0].occurredAt,at('2026-10-03'),'reclass is dated on the source date');
assert.equal(p.candidates[0].discrepancyId,'d_a','reclass keeps the discrepancy link');
assert.deepEqual(p.skipped.map(r=>r.rootId),['sep_x'],'a reversal of an earlier month\'s overage stays as posted and is only reported');
assert.deepEqual(p.undo,[]);
const lines=R.lines(p.candidates[0],F.line);
assert.deepEqual(lines.map(l=>[l.account,l.debit,l.credit]),[['coa:4990',50,0],['coa:6110',0,50]]);
assert.equal(B.mapAccount('coa:4990','instore',{}).code,'4990');assert.equal(B.mapAccount('coa:6110','instore',{}).code,'6110');
F.movement(R.RECLASS_TYPE,'financialMovement','a',lines,{});  // throws if unbalanced

// Idempotent: the movement id is derived from the source, and a posted reclass is recognised.
assert.equal(R.reclassMovementId('a'),R.reclassMovementId('a'));
assert.match(R.reclassMovementId('x'.repeat(200)),/^[A-Za-z0-9_-]{1,160}$/);
const withDone=Object.assign({},movements,{[R.reclassMovementId('a')]:{type:R.RECLASS_TYPE,reclassOf:'a',occurredAt:at('2026-10-03'),lines}});
const p2=R.plan(withDone,'2026-10');
assert.deepEqual(p2.candidates.map(c=>c.rootId),['b'],'a re-run never posts the same overage twice');
assert.deepEqual(p2.alreadyReclassed.map(r=>r.rootId),['a']);
// A source reversed after its reclass is flagged, never silently left in 6110.
const withLateReversal=Object.assign({},withDone,{a_rev:{type:'movement_reversal',reversesMovementId:'a',occurredAt:at('2026-10-25'),lines:[{account:'revenue:unexplained_cash_overage',debit:50,credit:0},{account:'liability:cash_overage_pending',debit:0,credit:50}]}});
const pl3=R.plan(withLateReversal,'2026-10');
assert.deepEqual(pl3.undo.map(u=>[u.rootId,u.amount,u.reclassMovementId]),[['a',50,R.reclassMovementId('a')]],'a source reversed after its reclass gets a linked undo');
assert.deepEqual(R.undoLines(pl3.undo[0],F.line).map(l=>[l.account,l.debit,l.credit]),[['coa:6110',50,0],['coa:4990',0,50]]);
assert.match(pl3.undo[0].movementId,/^[A-Za-z0-9_-]{1,160}$/);assert.notEqual(pl3.undo[0].movementId,R.reclassMovementId('a'));

// Date repair after a reclass (reverse + repost): ledger-level simulation ends with 4990 untouched
// by register overages and exactly one overage credit in 6110.
const repostLines=movements.a.lines;
let book=Object.assign({},withLateReversal,{a2:{type:'shift_cash_variance_resolution',sourceType:'discrepancy',sourceId:'d_a',occurredAt:at('2026-10-04'),lines:repostLines}});
const pl4=R.plan(book,'2026-10');
assert.deepEqual(pl4.candidates.map(c=>c.rootId).sort(),['a2','b']);assert.deepEqual(pl4.undo.map(u=>u.rootId),['a']);
pl4.candidates.forEach(c=>{book[c.movementId]={type:R.RECLASS_TYPE,reclassOf:c.rootId,occurredAt:c.occurredAt,lines:R.lines(c,F.line)};});
pl4.undo.forEach(u=>{book[u.movementId]={type:R.RECLASS_TYPE,reclassUndoOf:u.rootId,occurredAt:u.occurredAt,lines:R.undoLines(u,F.line)};});
const bal=(code)=>Math.round(Object.values(book).filter(m=>Number(m.occurredAt)>=R.monthBounds('2026-10').start).reduce((s,m)=>s+(m.lines||[]).reduce((n,l)=>{const c=B.mapAccount(l.account,'instore',{}).code;return n+(c===code?(Number(l.credit)||0)-(Number(l.debit)||0):0);},0),0)*100)/100;
assert.equal(bal('4990'),40-15,'4990 keeps only tips and the cross-month reversal after reclass + undo');
assert.equal(bal('6110'),50+20.5+5,'6110 holds every October overage once: a2, b and the new-key overage');
const pl5=R.plan(book,'2026-10');
assert.equal(pl5.candidates.length+pl5.undo.length,0,'re-running after the undo posts nothing');

// A reversal of a reversal folds into the original source.
const chain=Object.fromEntries([ov('z','2026-10-06',10),['z_r',{reversesMovementId:'z',occurredAt:at('2026-10-07'),lines:[{account:'revenue:unexplained_cash_overage',debit:10,credit:0}]}],['z_rr',{reversesMovementId:'z_r',occurredAt:at('2026-10-08'),lines:[{account:'revenue:unexplained_cash_overage',debit:0,credit:10}]}]]);
assert.deepEqual(R.plan(chain,'2026-10').candidates.map(c=>[c.rootId,c.amount]),[['z',10]]);
assert.throws(()=>R.monthBounds('2026-13'));

// 4. P&L presentation from the production Books bundle.
const app=fs.readFileSync(path.join(root,'assets/js/books/app.js'),'utf8');
const start=app.indexOf('const CASH_OVER_SHORT_CODE'),end=app.indexOf('return {income,sales,otherIncome,otherExpense',start);
assert.ok(start>0&&end>start,'P&L model with Cash Over / Short handling is in the Books bundle');
const plSource=app.slice(start,app.indexOf('\n}',end)+2);
const r2=(n)=>Math.round((Number(n)||0)*100)/100;
function pl(entries){
  const DB={accounts:[{code:'4000',name:'Sales - In-store',type:'Income'},{code:'4990',name:'Other Income',type:'Income'},{code:'5000',name:'COGS',type:'COGS'},{code:'6010',name:'Rent',type:'Expense'},{code:'6110',name:'Cash Over / Short',type:'Expense'}]};
  const typeOf=(c)=>(DB.accounts.find(a=>a.code===c)||{}).type;
  const normalBalanceFor=(code,ents)=>r2(ents.reduce((s,e)=>s+e.lines.reduce((n,l)=>n+(l.code===code?(['Income','Liability','Equity'].includes(typeOf(code))?(l.credit||0)-(l.debit||0):(l.debit||0)-(l.credit||0)):0),0),0));
  return new Function('DB','r2','normalBalanceFor','entriesInPeriod',`${plSource}; return plData();`)(DB,r2,normalBalanceFor,()=>entries);
}
const base=[{source:'pos',lines:[{code:'4000',credit:1000}]},{lines:[{code:'5000',debit:300}]},{lines:[{code:'6010',debit:200}]},{lines:[{code:'4990',credit:40}]}];
const over=pl(base.concat([{lines:[{code:'6110',credit:70.5}]},{lines:[{code:'6110',debit:20}]}]));
assert.ok(!over.expense.some(x=>x.a.code==='6110'),'6110 is never an operating expense line');
assert.equal(over.totalExp,200);
assert.deepEqual(over.otherIncome.filter(x=>x.a.code==='6110').map(x=>x.bal),[50.5],'net credit shows as other income');
assert.equal(over.totalOtherExpense,0);
assert.equal(over.net,r2(1000-300-200+40+50.5));
const short=pl(base.concat([{lines:[{code:'6110',credit:10}]},{lines:[{code:'6110',debit:35}]}]));
assert.deepEqual(short.otherExpense.map(x=>[x.a.code,x.bal]),[['6110',25]],'net debit shows as other expense');
assert.ok(!short.otherIncome.some(x=>x.a.code==='6110'));
assert.equal(short.net,r2(1000-300-200+40-25));
const even=pl(base.concat([{lines:[{code:'6110',credit:10}]},{lines:[{code:'6110',debit:10}]}]));
assert.ok(!even.otherIncome.some(x=>x.a.code==='6110')&&!even.otherExpense.length,'zero net is hidden');
// Net profit is the same as the plain ledger sum: presentation never changes the result.
assert.equal(even.net,r2(1000-300-200+40));

console.log('PASS: cash over/short consolidation — mapping, reclass plan, idempotency and P&L sign placement.');
