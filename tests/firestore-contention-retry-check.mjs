import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url), Retry=require('../functions/lib/firestore-retry.js'), H=require('../functions/lib/historical-archive.js');

// Firestore ABORTED (gRPC 10) is what dead-lettered replicateArchivedOrderToFirestore:
// every order in a month writes the same monthly summary document, so concurrent
// deliveries aborted each other and the throw was counted against the per-function
// daily failure budget. Contention must now be replayed instead of thrown.
const aborted=()=>Object.assign(new Error('10 ABORTED: Aborted due to cross-transaction contention. This occurs when multiple transactions attempt to access the same data, requiring Firestore to abort at least one in order to enforce serializable isolation.'),{code:10});

let calls=0;
const value=await Retry.runTransaction({runTransaction:async (fn,options)=>{calls++;assert.equal(options.maxAttempts,1,'every replay must ask the SDK for exactly one internal attempt');if(calls<4)throw aborted();return fn({});}},async()=>'committed',{baseDelayMs:1,maxDelayMs:2});
assert.equal(value,'committed','a contended transaction must commit after replay');
assert.equal(calls,4,'every ABORTED attempt must be replayed');

let permanent=0;
await assert.rejects(()=>Retry.runTransaction({runTransaction:async()=>{permanent++;throw Object.assign(new Error('7 PERMISSION_DENIED: Missing or insufficient permissions.'),{code:7});}},async()=>null,{baseDelayMs:1,maxDelayMs:2}),/PERMISSION_DENIED/);
assert.equal(permanent,1,'a permanent failure must reach the retry guard on its first attempt');

let exhausted=0;
await assert.rejects(()=>Retry.retryTransient(async()=>{exhausted++;throw aborted();},{attempts:3,baseDelayMs:1,maxDelayMs:2}),/ABORTED/);
assert.equal(exhausted,3,'replay stays bounded so a real fault still dead-letters for review');

for(const error of [
  aborted(),
  {code:14,message:'14 UNAVAILABLE: The service is currently unavailable.'},
  {code:4,message:'4 DEADLINE_EXCEEDED'},
  {code:'ABORTED',message:'Aborted due to cross-transaction contention.'},
  {status:10,message:'Aborted'},
  {code:null,status:'',message:'Aborted due to cross-transaction contention. This occurs when multiple transactions attempt to access the same data.'},
  {message:'14 UNAVAILABLE: The service is currently unavailable.'},
])assert.equal(Retry.isTransient(error),true,'transient codes must be replayed: '+JSON.stringify(error.code));
for(const error of [{code:3,message:'3 INVALID_ARGUMENT'},{code:5,message:'5 NOT_FOUND'},{code:7,message:'7 PERMISSION_DENIED'},{code:9,message:'9 FAILED_PRECONDITION'}])assert.equal(Retry.isTransient(error),false,'permanent codes must never be replayed');

// An absorbed replay must stay visible, and a broken log hook must not break it.
const seen=[];
let logged=0;
await Retry.retryTransient(async()=>{if(seen.length<2)throw aborted();return 'ok';},{attempts:5,baseDelayMs:1,maxDelayMs:2,onRetry:(info)=>{logged++;seen.push(info);throw new Error('logger unavailable');}});
assert.equal(logged,2,'every replay must be reported to the caller');
assert.equal(seen[0].attempt,1);assert.equal(seen[0].code,10);assert(seen[0].delayMs>=1,'the replay must report its delay');
const delays=[];
await Retry.retryTransient(async()=>{if(delays.length<6)throw aborted();return 'ok';},{attempts:8,baseDelayMs:50,maxDelayMs:20,onRetry:(info)=>delays.push(info.delayMs)});
assert(delays.length===6&&delays.every((ms)=>ms>=1&&ms<=20),'maxDelayMs must stay a hard bound on every replay delay');
assert.equal(Retry.batchOptions().attempts,4,'batch maintenance must use a short replay budget');
assert.equal(Retry.batchOptions().maxDelayMs,400);
assert.equal(Retry.batchOptions({attempts:9}).attempts,9,'the caller may still override the batch budget');

// The common no-op delivery (an unchanged order re-run by a journal or inventory
// refresh) must not need a transaction over the shared monthly summary at all.
const source=fs.readFileSync('src/functions/61-historical-archive.js','utf8');
const slice=source.slice(source.indexOf('async function reconcileHistoricalSalesRollup'),source.indexOf('async function replicateHistoricalOrder'));
const ctx={HistoricalArchive:H,FirestoreRetry:Retry,Date,Number,Set,Object,Promise};
vm.createContext(ctx);vm.runInContext(slice,ctx);
const order={id:'sale1',status:'Completed',paymentStatus:'confirmed',timestamp:Date.parse('2026-09-10T12:00:00+08:00'),total:100,subtotal:100,payment:'Cash',channel:'instore',lineItems:[{itemKey:'latte',name:'Latte',categoryId:'coffee',qty:2,unitTotal:50}]};
const contribution=H.reportingContribution(order),monthKey=H.MONTH_COLLECTION+'/'+contribution.month,stateKey=H.CONTRIBUTION_COLLECTION+'/sale1';
assert(contribution.month,'the fixture must report into a monthly summary');
const currentMonth={month:contribution.month,schemaVersion:3,analyticsSchemaVersion:2};
const documents=new Map([[stateKey,{contribution}],[monthKey,currentMonth]]);
let transactionAttempts=0;
const firestore={collection:name=>({doc:id=>({get:async()=>{const key=name+'/'+id;return {exists:documents.has(key),data:()=>documents.get(key)};}})}),runTransaction:async()=>{transactionAttempts++;throw new Error('an unchanged delivery must not open a transaction on the shared monthly summary');}};
assert.equal(await ctx.historicalRollupWriteNeeded(firestore,'sale1',order),false,'an unchanged, current-schema order needs no summary transaction');
documents.delete(monthKey);
assert.equal(await ctx.historicalRollupWriteNeeded(firestore,'sale1',order),true,'a missing or legacy month summary must still be migrated');
documents.set(monthKey,currentMonth);
documents.set(stateKey,{contribution:Object.assign({},contribution,{checksum:'stale'})});
assert.equal(await ctx.historicalRollupWriteNeeded(firestore,'sale1',order),true,'a stale contribution must still be repaired');
assert.equal(transactionAttempts,0,'the no-op decision must be read-only');

for(const marker of [
  'FirestoreRetry.retryTransient(() => historicalRollupWriteNeeded(firestore, orderId, next.order),',
  'FirestoreRetry.runTransaction(firestore, async (transaction) => reconcileHistoricalSalesRollup',
  'const rollupChanged = duplicate && !rollupRequired ? false : await reconcileHistoricalSalesRollup',
  'historicalRollupWriteRequired(previous, next, months, snapshots)',
  'onRetry: logHistoricalContention("replica-precheck")',
  'onRetry: logHistoricalContention("replica-transaction")',
  'onRetry: logHistoricalContention("replica-delete")',
  'FirestoreRetry.batchOptions({onRetry: logHistoricalContention("sales-rollup-backfill")})',
  'logger.warn("Historical archive replayed a transient Firestore failure"',
]) assert(source.includes(marker),'historical archive contention safeguard missing: '+marker);
assert(source.includes("const legacyContribution = previous && Number(previous.schemaVersion || 0) < 3")&&source.includes('const legacyMonth = months.some'),'legacy month summaries must still migrate instead of being treated as complete');
assert(fs.readFileSync('src/functions/00-bootstrap-notifications.js','utf8').includes('require("./lib/firestore-retry")'),'the function bundle must require the contention retry module');
const bundle=fs.readFileSync('functions/index.js','utf8');
assert(bundle.includes('require("./lib/firestore-retry")')&&bundle.includes('FirestoreRetry.runTransaction')&&bundle.includes('FirestoreRetry.retryTransient'),'the deployed bundle must carry the contention retry');
assert(bundle.includes('const rollupRequired = await FirestoreRetry.retryTransient'),'the archive trigger must decide the shared-month write before its transaction');

console.log('PASS: Firestore ABORTED contention is replayed within a bounded budget, permanent faults still dead-letter, and an unchanged order no longer locks the shared monthly summary.');
