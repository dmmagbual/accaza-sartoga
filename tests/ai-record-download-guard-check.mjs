// Accaza AI record-tool download guard (Oct 2026). Proves, by running the real tool code
// against fake databases: parallel tool calls cannot overshoot the per-question record budget,
// every Realtime Database read is metered by its downloaded JSON size, the per-question and
// per-day download allowances stop further reads, archived sales come from the Firestore
// replica once salesAt is ready (and from the Realtime Database only before that), and the
// day's usage is committed once without ever failing the answer.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const records=read('src/functions/62a-accaza-ai-records.js'),analytics=read('src/functions/62b-accaza-ai-analytics.js'),chat=read('src/functions/62-accaza-chat.js');
const pick=(source,start,end)=>{const a=source.indexOf(start),b=source.indexOf(end,a+start.length);assert.ok(a>=0&&b>a,`missing ${start}`);return source.slice(a,b);};
const usage=pick(analytics,'function accazaAiRtdbUsageRef(){','async function accazaAiSalesMonthDocs(');
const code=records.slice(0,records.indexOf('const ACCAZA_AI_AGENT_GUIDE'))+usage;

function makeLib({salesAtReady=true,dayBytes=0,firestoreDocs=[]}={}){
  const firestore={writes:[],queries:0,claims:[]};
  const getFirestore=()=>({collection(name){
    if(name==='aiAnalyticsUsage')return{doc:()=>({get:async()=>({exists:true,get:field=>field==='rtdbBytes'?dayBytes:undefined}),set:async(value,opts)=>{firestore.writes.push({value,opts});}})};
    const query={where:()=>query,orderBy:()=>query,limit:()=>query,select:()=>query,get:async()=>{firestore.queries+=1;return{size:firestoreDocs.length,docs:firestoreDocs.map(doc=>({id:doc.id,get:field=>field==='order'?doc.order:undefined}))};}};
    return query;
  }});
  const FieldValue={increment:n=>({increment:n})};
  const lib=new Function('getFirestore','FieldValue','HistoricalArchive','historicalSalesAtReady','accazaAiClaimFirestoreReads','financeDateFromTimestamp','logger','accazaAiText','accazaAiTopAccounts','accazaAiMoney',
    `${code};return{ACCAZA_AI_RECORD_TOOLS,ACCAZA_AI_TOOL_RECORD_BUDGET,ACCAZA_AI_RTDB_DAILY_BYTES,ACCAZA_AI_RTDB_QUESTION_BYTES,accazaAiToolContext,accazaAiRunRecordTool,accazaAiCommitRtdbUsage};`)(
    getFirestore,FieldValue,{COLLECTION:'historicalOrders'},async()=>salesAtReady,async(ctx,count)=>{firestore.claims.push(count);},()=> '2026-10-06',{warn(){}},(v,n)=>String(v||'').slice(0,n),()=>[],v=>Number(v)||0);
  return{lib,firestore};
}
// Fake Realtime Database: every query chain resolves to the data stored at the ref path.
function fakeDb(data,delayMs=5){
  const reads=[];
  const snap=value=>({val:()=>value===undefined?null:value,exists:()=>value!=null,numChildren:()=>value&&typeof value==='object'?Object.keys(value).length:0});
  return{reads,ref(p){const query={get:async()=>{reads.push(p);await new Promise(r=>setTimeout(r,delayMs));return snap(data[p]);}};
    for(const m of ['orderByChild','orderByKey','startAt','endAt','equalTo','limitToFirst','limitToLast','child'])query[m]=()=>query;return query;}};
}
const orders=(n,prefix)=>Object.fromEntries(Array.from({length:n},(_,i)=>[`${prefix}${i}`,{timestamp:Date.parse('2026-10-01T02:00:00Z')+i,total:150,status:'Completed',channel:'instore',payment:'Cash',shiftId:'SH1'}]));

// 1. Six parallel get_sales calls (the model's maximum per round) cannot overshoot: each one
//    reserves its 1,200-row maximum before reading, so only two start inside the 2,500 budget.
{const {lib}=makeLib();const db=fakeDb({'/orders':orders(5,'L'),'/posStaff':{}}),ctx=lib.accazaAiToolContext(db);
 const days=['2026-09-01','2026-09-04','2026-09-07','2026-09-10','2026-09-13','2026-09-16'];
 const results=await Promise.all(days.map(day=>lib.accazaAiRunRecordTool(ctx,'get_sales',{date_from:day})));
 const ran=results.filter(r=>!r.error).length,refused=results.filter(r=>r.error&&/record budget/.test(r.error)).length;
 assert.equal(ran,2,'only two 1,200-row reservations fit the 2,500-record budget at once');assert.equal(refused,4);
 assert.equal(ctx.reserved,0,'reservations are released when a call finishes');
 assert.ok(ctx.recordsRead<=lib.ACCAZA_AI_TOOL_RECORD_BUDGET);
 // After the round, the real (small) counts free the budget for the next round.
 const again=await lib.accazaAiRunRecordTool(ctx,'get_sales',{date_from:'2026-09-20'});assert.ok(!again.error,'a later round may read again');}

// 2. Every Realtime Database get() is metered by the JSON size it returns.
{const {lib}=makeLib();const live=orders(3,'M'),db=fakeDb({'/orders':live,'/posStaff':{}}),ctx=lib.accazaAiToolContext(db);
 await lib.accazaAiRunRecordTool(ctx,'get_sales',{date_from:'2026-10-01'});
 const expected=Buffer.byteLength(JSON.stringify(live))+Buffer.byteLength(JSON.stringify({}));
 assert.equal(ctx.rtdbBytes,expected,'metered bytes equal the JSON returned by /orders and /posStaff');}

// 3. With salesAt ready, archived sales come from the Firestore replica (reads claimed against
//    the AI allowance, unused part refunded) and /archivedOrders is never read.
{const {lib,firestore}=makeLib({firestoreDocs:[{id:'A1',order:{timestamp:1,total:200,status:'Completed'}},{id:'L0',order:{timestamp:2,total:150,status:'Completed'}}]});
 const db=fakeDb({'/orders':orders(1,'L'),'/posStaff':{}}),ctx=lib.accazaAiToolContext(db);
 const result=await lib.accazaAiRunRecordTool(ctx,'get_sales',{date_from:'2026-10-01'});
 assert.ok(!db.reads.includes('/archivedOrders'),'archived sales must not be downloaded from the Realtime Database');
 assert.equal(firestore.queries,1);assert.deepEqual(firestore.claims,[600,-598],'reserve 600 Firestore reads, refund the unused 598');
 assert.equal(result.saleCount,2,'live and archived copies of one order are counted once');assert.equal(result.salesTotal,350);}

// 4. Before the salesAt backfill is confirmed, the earlier Realtime Database read is kept.
{const {lib,firestore}=makeLib({salesAtReady:false});const db=fakeDb({'/orders':{},'/archivedOrders':orders(2,'A'),'/posStaff':{}}),ctx=lib.accazaAiToolContext(db);
 const result=await lib.accazaAiRunRecordTool(ctx,'get_sales',{date_from:'2026-10-01'});
 assert.ok(db.reads.includes('/archivedOrders'));assert.equal(firestore.queries,0);assert.equal(result.saleCount,2);}

// 5. The daily allowance stops every record tool; the per-question allowance stops further reads.
{const {lib}=makeLib({dayBytes:50*1024*1024});const db=fakeDb({'/orders':{}}),ctx=lib.accazaAiToolContext(db);
 for(const [tool,args] of [['get_sales',{date_from:'2026-10-01'}],['get_audit_log',{date_from:'2026-10-01'}],['get_finance_month',{month:'2026-09'}]]){
   const result=await lib.accazaAiRunRecordTool(ctx,tool,args);assert.ok(result.error&&/allowance/.test(result.error),`${tool} must stop at the daily allowance`);}
 assert.equal(db.reads.length,0,'no record is downloaded once the day is used up');}
{const {lib}=makeLib();const db=fakeDb({'/orders':{}}),ctx=lib.accazaAiToolContext(db);ctx.rtdbBytes=lib.ACCAZA_AI_RTDB_QUESTION_BYTES;
 const result=await lib.accazaAiRunRecordTool(ctx,'get_audit_log',{date_from:'2026-10-01'});assert.ok(/record budget/.test(result.error));}

// 6. The day's usage is committed once as an increment; a failing write never throws.
{const {lib,firestore}=makeLib();const ctx=lib.accazaAiToolContext(fakeDb({}));
 await lib.accazaAiCommitRtdbUsage(ctx);assert.equal(firestore.writes.length,0,'nothing to record for a question that read nothing');
 ctx.rtdbBytes=1234;await lib.accazaAiCommitRtdbUsage(ctx);assert.deepEqual(firestore.writes[0].value.rtdbBytes,{increment:1234});assert.deepEqual(firestore.writes[0].opts,{merge:true});
 await lib.accazaAiCommitRtdbUsage(null);}
assert.ok(chat.includes('.finally(()=>accazaAiCommitRtdbUsage(toolCtx))'),'askAccazaAI must record the usage whether or not a provider answers');
assert.ok(chat.includes('rtdbBytes:toolCtx?toolCtx.rtdbBytes:0'),'the audit record must carry the downloaded bytes');

console.log('PASS: Accaza AI record tools reserve their row budget before parallel reads, meter every Realtime Database download, stop at the 8 MB question and 50 MB daily allowances, read archived sales from the Firestore replica, and record usage without failing an answer.');
