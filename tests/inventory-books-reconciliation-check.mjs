import assert from 'node:assert/strict';
import {inventoryBookCode,reconcileInventoryBooks,canPostOpeningBalance,canPostReconciliationAdjustment} from '../assets/js/admin/inventory-books-reconciliation.mjs';

assert.equal(inventoryBookCode('coa:1210'),'1210');
assert.equal(inventoryBookCode('inventory:control'),'1200');
assert.equal(inventoryBookCode('inventory:legacy-item'),'1290');
assert.equal(inventoryBookCode('expense:other'),'');

const result=reconcileInventoryBooks([
  {inventoryAccount:'1200',quantity:10,unitCost:20},
  {inventoryAccount:'1210',quantity:5,unitCost:10},
  {inventoryAccount:'',quantity:2,unitCost:15}
],[
  {occurredAt:100,lines:[{account:'coa:1200',debit:250,credit:0},{account:'coa:1210',debit:50,credit:0}]},
  {occurredAt:200,lines:[{account:'coa:1200',debit:0,credit:50},{account:'inventory:old',debit:10,credit:0}]},
  {occurredAt:999,lines:[{account:'coa:1210',debit:999,credit:0}]}
],500);
assert.deepEqual(result.totals,{stockValue:280,booksValue:260,difference:20});
assert.equal(result.rows.find(function(r){return r.code==='1200';}).difference,0);
assert.equal(result.rows.find(function(r){return r.code==='1210';}).difference,0);
assert.equal(result.unmappedCount,1);
assert.equal(result.clearingBalance,10);
assert.equal(result.balanced,false);

const journalResult=reconcileInventoryBooks([
  {inventoryAccount:'1200',quantity:10,unitCost:20},
  {inventoryAccount:'1210',quantity:5,unitCost:10}
],[
  {date:'2026-08-24',net:{'1200':200,'1210':50}},
  {date:'2026-08-26',lines:[{code:'1200',debit:999,credit:0}]}
],'2026-08-25');
assert.equal(journalResult.rows.find(function(r){return r.code==='1200';}).booksValue,200);
assert.equal(journalResult.rows.find(function(r){return r.code==='1210';}).booksValue,50);

const pennyResult=reconcileInventoryBooks([{inventoryAccount:'1220',quantity:1,unitCost:99.99}],[{lines:[{code:'1220',debit:100,credit:0}]}]);
assert.equal(pennyResult.totals.difference,-0.01);
assert.equal(pennyResult.rows.find(function(r){return r.code==='1220';}).withinTolerance,true);
assert.equal(pennyResult.balanced,true);
const twoCentResult=reconcileInventoryBooks([{inventoryAccount:'1220',quantity:1,unitCost:99.98}],[{lines:[{code:'1220',debit:100,credit:0}]}]);
assert.equal(twoCentResult.balanced,false);


// --- Button-visibility gating (regression: the opening-balance repost was twice
// silently re-hidden behind a 1290-clearing check the server-side repost doesn't
// require -- PR #171 fixed it once, PR d73fdf9c/e8222664 quietly reintroduced it).
// Opening-balance re-post has no clearing-balance requirement server-side (it trues
// 1290 itself), so it must stay available whenever unmapped===0, regardless of 1290.
// Gain/(Loss) must never be offered while 1290 is dirty -- it deliberately excludes
// 1290 from its own rows, and the server hard-blocks it, since posting a variance
// there would launder a receiving/COGS-mapping defect into a P&L line.
const reconciled={balanced:true,unmappedCount:0,clearingBalance:0};
assert.equal(canPostOpeningBalance(reconciled),false,'fully reconciled: nothing to post');
assert.equal(canPostReconciliationAdjustment(reconciled),false,'fully reconciled: nothing to post');

const unmapped={balanced:false,unmappedCount:2,clearingBalance:0};
assert.equal(canPostOpeningBalance(unmapped),false,'unmapped items must block opening balance (server hard-blocks this)');
assert.equal(canPostReconciliationAdjustment(unmapped),false,'unmapped items must block gain/loss (server hard-blocks this)');

const dirtyClearing={balanced:false,unmappedCount:0,clearingBalance:-2861.47};
assert.equal(canPostOpeningBalance(dirtyClearing),true,'opening-balance re-post must stay available with a dirty 1290 -- it is the action that zeroes 1290');
assert.equal(canPostReconciliationAdjustment(dirtyClearing),false,'gain/loss must stay blocked while 1290 is dirty -- server hard-blocks this to avoid laundering a receiving defect into P&L');

const roundingOnly={balanced:false,unmappedCount:0,clearingBalance:0};
assert.equal(canPostOpeningBalance(roundingOnly),true,'cents-level rounding drift: opening-balance re-post available');
assert.equal(canPostReconciliationAdjustment(roundingOnly),true,'cents-level rounding drift: gain/loss also available once clearing is clean');

console.log('PASS: opening-balance and gain/loss button visibility gate independently on the server\'s actual preconditions.');

console.log('PASS: inventory valuation reconciles by account against complete Finance Books movements.');
