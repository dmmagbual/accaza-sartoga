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
console.warn=warn;
console.log('PASS: Accaza AI fallback times out hung providers, treats network errors and empty answers as provider failures, rethrows real errors, reserves Ashna time, and records backup answers and total failures.');
