// Accaza AI provider fallback (Sep 2026): each provider call is timed, a timeout / network
// error / non-OK reply / empty answer moves on to the next provider, a non-provider error
// (auth, validation) is never swallowed, Ashna keeps a reserved slice of the budget, and
// every backup answer or total failure is recorded for the Exception Center.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=fs.readFileSync(path.join(root,'src/functions/62-accaza-ai.js'),'utf8');
const pick=(start,end)=>{const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a,`missing ${start}`);return source.slice(a,b);};
const lineOf=start=>{const a=source.indexOf(start);assert.ok(a>=0,`missing ${start}`);return source.slice(a,source.indexOf('\n',a)+1);};
let code=lineOf('function accazaAiText(')+lineOf('function accazaAiProviderFailure(')+lineOf('function accazaAiAnswer(')
  +pick('const ACCAZA_AI_REQUEST_BUDGET_MS','// General chat (admin General chat')
  +pick('async function accazaAiRecordProviderHealth(','exports.askAccazaAI=');
// Shrink the real time limits 1000x so the timeout paths run in milliseconds.
code=code.replace('ACCAZA_AI_REQUEST_BUDGET_MS = 110000','ACCAZA_AI_REQUEST_BUDGET_MS = 1100').replace('ACCAZA_AI_CLOUD_TIMEOUT_MS = 25000','ACCAZA_AI_CLOUD_TIMEOUT_MS = 250')
  .replace('ACCAZA_AI_OLLAMA_TIMEOUT_MS = 70000','ACCAZA_AI_OLLAMA_TIMEOUT_MS = 700').replace('ACCAZA_AI_ASHNA_TIMEOUT_MS = 20000','ACCAZA_AI_ASHNA_TIMEOUT_MS = 200').replace('ACCAZA_AI_MIN_ATTEMPT_MS = 8000','ACCAZA_AI_MIN_ATTEMPT_MS = 80')
  .replace('Math.max(1000,Number(timeoutMs)','Math.max(1,Number(timeoutMs)');
class HttpsError extends Error{constructor(code,message,details){super(message);this.code=code;this.details=details;}}
const build=new Function('HttpsError','fetch','accazaAiDay',`${code};return{accazaAiFetchJson,accazaAiWithFallback,accazaAiRecordProviderHealth,accazaAiAnswer,accazaAiTrimToSentence};`);
const warn=console.warn;console.warn=()=>{};
function fakeDb(){const store={};return{store,ref(p){return{async transaction(fn){const next=fn(store[p]);if(next!==undefined)store[p]=next;return{committed:next!==undefined};}};}};}
// Behaves like a hung server: it never answers, and (like real fetch) rejects once aborted.
const neverFetch=(url,init)=>new Promise((resolve,reject)=>{init.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')));});
const lib=build(HttpsError,neverFetch,()=> '2026-09-25');
const ok=value=>()=>Promise.resolve(value);
const provider=(name,ask,extra={})=>Object.assign({name,enabled:()=>true,ask},extra);
const failure=message=>()=>Promise.reject(new HttpsError('unavailable',message,{providerFailure:true}));

// 1. Primary answers: no health write.
{const db=fakeDb(),r=await lib.accazaAiWithFallback([provider('gemini',ok('A'))],{db,general:true});
assert.equal(r.provider,'gemini');assert.equal(Object.keys(db.store).length,0,'a normal primary answer writes nothing');}
// 2. Primary fails, backup answers: recorded as a backup answer.
{const db=fakeDb(),r=await lib.accazaAiWithFallback([provider('gemini',failure('quota')),provider('deepseek',ok('B'))],{db,general:true});
assert.equal(r.provider,'deepseek');const h=db.store['/accazaAiProviderHealth/2026-09-25'];assert.equal(h.backupAnswers.deepseek,1);assert.equal(h.providerFailures.gemini,1);assert.equal(h.failedQuestions,0);assert.equal(h.lastEvent.failures[0].reason,'quota');}
// 3. A hung provider is aborted by its own timer and the next provider answers.
{const started=Date.now(),db=fakeDb(),r=await lib.accazaAiWithFallback([provider('gemini',timeoutMs=>lib.accazaAiFetchJson('Gemini','https://x',{},timeoutMs)),provider('ollama',ok('C'),{maxMs:700})],{db});
assert.equal(r.provider,'ollama');assert.ok(Date.now()-started<600,'hung provider must be cut off at its own limit');assert.match(db.store['/accazaAiProviderHealth/2026-09-25'].lastEvent.failures[0].reason,/did not answer within/);}
// 4. A network error is a provider failure.
{const netLib=build(HttpsError,()=>Promise.reject(new TypeError('fetch failed')),()=> '2026-09-25');
await assert.rejects(netLib.accazaAiFetchJson('DeepSeek','https://x',{},100),e=>e.details&&e.details.providerFailure===true&&/could not be reached/.test(e.message));}
// 5. An empty answer is a provider failure (falls through), not a user-facing error.
assert.throws(()=>lib.accazaAiAnswer('   '),e=>e.details&&e.details.providerFailure===true);
// 6. A non-provider error (e.g. permission) is rethrown immediately, never swallowed.
{let called=false;await assert.rejects(lib.accazaAiWithFallback([provider('gemini',()=>Promise.reject(new HttpsError('permission-denied','no'))),provider('deepseek',()=>{called=true;return Promise.resolve('x');})],{db:fakeDb()}),e=>e.code==='permission-denied');assert.equal(called,false);}
// 7. Everything fails: one clean user message, and the failure is recorded.
{const db=fakeDb();await assert.rejects(lib.accazaAiWithFallback([provider('gemini',failure('a')),provider('deepseek',failure('b')),provider('ollama',failure('c'),{maxMs:700})],{db,general:true}),e=>e.code==='unavailable'&&/temporarily unavailable/.test(e.message)&&!/Accaza/.test(e.message));
const h=db.store['/accazaAiProviderHealth/2026-09-25'];assert.equal(h.failedQuestions,1);assert.equal(h.lastEvent.answeredBy,'none');assert.deepEqual(Object.keys(h.providerFailures).sort(),['deepseek','gemini','ollama']);}
// 8. The last provider's reserve shortens the one before it.
{let qwenLimit=0;await lib.accazaAiWithFallback([provider('ollama',limit=>{qwenLimit=limit;return Promise.reject(new HttpsError('unavailable','slow',{providerFailure:true}));},{maxMs:700}),provider('ashna',ok('D'),{maxMs:200,reserveMs:200})],{db:fakeDb()});
assert.ok(qwenLimit<=900&&qwenLimit>=600,'Qwen gets the budget minus Ashna reserve, capped at its own limit');}
// 9. Disabled providers are skipped; none configured is a configuration error.
await assert.rejects(lib.accazaAiWithFallback([provider('gemini',ok('x'),{enabled:()=>false})],{db:fakeDb()}),e=>e.code==='failed-precondition');
// 10. A reply cut by the token cap ends at a full sentence.
assert.equal(lib.accazaAiTrimToSentence('A flat white is a small espresso drink with microfoam. It originated in Austral'),'A flat white is a small espresso drink with microfoam.');
// 11. Reply formatter: Markdown from any provider becomes clean chat text with tidy lists.
{const fmtCode=pick('function accazaAiProseAnswer(','\nasync function askGeminiAccazaAi(');
const format=new Function('accazaAiProviderFailure',`${fmtCode};return accazaAiProseAnswer;`)(message=>new HttpsError('unavailable',message,{providerFailure:true}));
const messy='Based on the records, profit is healthy. *(Note: accounting amounts are not cash flow.)*\n### 1. Observed Facts\n* **Revenue:** PHP 152,370.88\n* **COGS:** PHP 26,687.71\n### 2. Recommendations\n1. **Audit utilities:** they are the largest expense.\n2) Renegotiate platform fees.\nKeep 2*3*4 intact.';
const clean=format(messy);
assert.ok(!/[#]|\*\*/.test(clean),'no Markdown markers survive: '+clean);
assert.ok(clean.includes('• Revenue: PHP 152,370.88\n• COGS: PHP 26,687.71'),'bullets become • items, one per line');
assert.ok(clean.includes('1. Audit utilities: they are the largest expense.\n2. Renegotiate platform fees.'),'numbered items stay numbered');
assert.ok(clean.includes('(Note: accounting amounts are not cash flow.)'),'single-asterisk emphasis is removed');
assert.ok(clean.includes('2*3*4'),'arithmetic asterisks are untouched');
assert.ok(/cash flow\.\)\n\nObserved Facts\n\n• Revenue/.test(clean)&&/PHP 26,687\.71\n\nRecommendations/.test(clean),'lists are separated from surrounding text by a blank line');
assert.throws(()=>format('  **  '),e=>e.details&&e.details.providerFailure===true);}
// 12. Record tools show staff names instead of account IDs, and never rewrite JSON keys.
{const records=fs.readFileSync(path.join(root,'src/functions/62a-accaza-ai-records.js'),'utf8');const line=records.match(/function accazaAiNameAccounts[^\n]*/)[0];
const nameAccounts=new Function(`${line};return accazaAiNameAccounts;`)();
const out=JSON.parse(nameAccounts(JSON.stringify({averageDistinctItemsPerOrder:1.8,by:'HstyE8bcYwaVjBASmfi94YwHW7J2',who:'Zz9abcdefghijklmnopqrstuvwxy',note:'abcdefghijabcdefghijabcdefgh'}),{Zz9abcdefghijklmnopqrstuvwxy:'Maria'}));
assert.equal(out.averageDistinctItemsPerOrder,1.8,'28-character keys stay intact');assert.equal(out.who,'Maria');assert.equal(out.by,'account …W7J2');assert.equal(out.note,'abcdefghijabcdefghijabcdefgh','plain words are not treated as account IDs');}
console.warn=warn;
console.log('PASS: Accaza AI fallback times out hung providers, treats network errors and empty answers as provider failures, rethrows real errors, reserves Ashna time, and records backup answers and total failures; replies are normalized to clean paragraphs and lists.');
