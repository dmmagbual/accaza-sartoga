import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const WriteSafety=require('../functions/lib/write-safety.js');
const read=file=>fs.readFileSync(new URL(`../${file}`,import.meta.url),'utf8');

const source={
  bootstrap:read('src/functions/05-production-assurance.js'),
  finance:read('src/functions/40-sales-finance.js'),
  entry:read('src/functions/42a-financial-command-entry.js'),
  close:read('src/functions/42d-financial-command-close.js'),
  reconciliation:read('src/functions/44-reconciliation.js')
};

const original={
  'booksChart/6078':{code:'6078',name:'Product R&D'},
  'booksChart/6078/active':true,
  'financialMovements/test':{id:'test'}
};
const normalized=WriteSafety.normalizeAtomicUpdatePaths(original);
assert.deepEqual(normalized['booksChart/6078'],{code:'6078',name:'Product R&D',active:true});
assert.equal(Object.hasOwn(normalized,'booksChart/6078/active'),false);
assert.deepEqual(original['booksChart/6078'],{code:'6078',name:'Product R&D'},'normalization mutated caller-owned data');

const balancedMovement={id:'balanced',lines:[{account:'coa:1200',debit:12.34,credit:0},{account:'coa:5905',debit:0,credit:12.34}]};
const protectedBalance=WriteSafety.normalizeAtomicUpdatePaths({'financialMovements/balanced':balancedMovement,'inventoryReconciliations/adjustments/balanced':{movementId:'balanced'}});
assert.deepEqual(protectedBalance['financialMovements/balanced'],balancedMovement,'write safety changed a balanced Finance movement');
assert.equal(protectedBalance['financialMovements/balanced'].lines.reduce((sum,line)=>sum+line.debit-line.credit,0),0,'write safety changed debit/credit balance');

assert.throws(()=>WriteSafety.normalizeAtomicUpdatePaths({'booksChart/6078':{active:false},'booksChart/6078/active':true}),WriteSafety.UnsafeAtomicUpdateError);
assert.throws(()=>WriteSafety.normalizeAtomicUpdatePaths({'booksChart/6078':'invalid','booksChart/6078/active':true}),WriteSafety.UnsafeAtomicUpdateError);
assert.throws(()=>WriteSafety.normalizeAtomicUpdatePaths({'/booksChart/6078':{}}),WriteSafety.UnsafeAtomicUpdateError);
assert.throws(()=>WriteSafety.normalizeAtomicUpdatePaths({'booksChart/bad#code':{}}),WriteSafety.UnsafeAtomicUpdateError);
assert.throws(()=>WriteSafety.normalizeAtomicUpdatePaths({'booksChart/6078':undefined}),WriteSafety.UnsafeAtomicUpdateError);

let submitted=null;
await WriteSafety.safeAtomicUpdate({ref:()=>({update:async value=>{submitted=value;}})},original);
assert.deepEqual(submitted,normalized);

assert.match(source.bootstrap,/Financial operation failed/);
assert.match(source.bootstrap,/Nothing was posted\. Reference:/);
assert.match(source.finance,/claimedAt - 900000/);
assert.match(source.finance,/already being processed/);
assert.match(source.finance,/safeFinancialUpdate\(db, writes, "financial"\)/);
assert.match(source.entry,/observeFinancialOperation\(request, "postFinancialCommand"/);
assert.match(source.close,/\}\),\s*\n\);/);
assert.match(source.reconciliation,/observeFinancialOperation\(request, "manageBooksAccount"/);

console.log('PASS: Phase 10 blocks unsafe atomic writes, recovers stale claims, and traces financial operations safely.');
