import assert from 'node:assert/strict';import {createRequire} from 'node:module';const require=createRequire(import.meta.url),Health=require('../functions/lib/production-health.js'),now=1788105600000;
const good=Health.evaluate({backup:{takenAt:now-3600000,version:'backup-v2',validation:'passed',dataSha256:'a'.repeat(64)},telemetry:[{updatedAt:now,metrics:{pos_boot:{count:10,totalMs:10000,maxMs:1200,failed:0}},errors:{}}],operational:{generatedAt:now,counts:{critical:0,total:0}}},now);assert.equal(good.status,'healthy');
const stale=Health.evaluate({backup:{takenAt:now-3600000,version:'backup-v2',validation:'passed',dataSha256:'a'.repeat(64)},telemetry:[],operational:{generatedAt:now-27*3600000,counts:{critical:0,total:0}}},now);assert.equal(stale.status,'warning');assert.ok(stale.alerts.some(x=>x.id==='operational_scan_stale'));
const bad=Health.evaluate({backup:{takenAt:now-40*3600000},telemetry:[{metrics:{charge_to_durable:{count:2,totalMs:6000,maxMs:4000,failed:1}},errors:{js_runtime:2}}],operational:{counts:{critical:2,total:2}}},now);assert.equal(bad.status,'critical');assert.ok(bad.alerts.some(x=>x.id==='backup_stale'));assert.ok(bad.alerts.some(x=>x.id==='operational_critical'));assert.equal(bad.signature,Health.evaluate({backup:{takenAt:now-40*3600000},telemetry:[{metrics:{charge_to_durable:{count:2,totalMs:6000,maxMs:4000,failed:1}},errors:{js_runtime:2}}],operational:{counts:{critical:2,total:2}}},now).signature);// 2 Nov 2026 (Danilo): a slow launch or one browser error must not move a business card. The pooled
// today+yesterday alert kept "Frontend & customer app" amber for two days per event, so it never
// cleared and never named anything a manager could repair. The figures stay as diagnostics evidence.
const visual=Health.evaluate({backup:{takenAt:now-3600000,version:'backup-v2',validation:'passed',dataSha256:'a'.repeat(64)},telemetry:[{updatedAt:now,errors:{js_register:15},metrics:{pos_boot:{count:45,totalMs:291285,maxMs:40350,failed:0}}},{}],operational:{generatedAt:now,counts:{critical:0,total:0}}},now);
assert.equal(visual.status,'healthy','a slow launch and client errors must not move the business panel');
assert.equal(visual.counts.total,0,'frontend telemetry must not be counted as a business alert');
assert.deepEqual(visual.alerts.map(x=>x.id),[],'frontend telemetry must not be a business alert');
assert.ok(visual.telemetry.some(x=>x.id==='client_errors'&&x.diagnosticsOnly===true),'client errors must stay available as diagnostics evidence');
assert.ok(visual.telemetry.some(x=>x.id==='performance_pos_boot'&&x.diagnosticsOnly===true),'a slow launch must stay available as diagnostics evidence');
assert.ok(visual.telemetry.every(x=>!x.id.startsWith('backup_')&&x.id!=='operational_critical'),'diagnostics evidence must never mix in business alerts');
assert.ok(bad.alerts.every(x=>!x.id.startsWith('performance_')&&x.id!=='client_errors'),'a real critical failure must not carry frontend telemetry as a business alert');
console.log('PASS: Phase 13 health thresholds, severity, and deduplicated signatures are deterministic and read-only; frontend telemetry stays diagnostics evidence and never becomes a business to-do.');

// A scheduled retry must reuse a completed scan for the same occurrence and
// must never report an older cached scan as success when another scan holds the lock.
const fs = await import('node:fs');
const vm = await import('node:vm');
const scanSource = fs.readFileSync(new URL('../src/functions/20-portal-operations.js', import.meta.url), 'utf8');
const start = scanSource.indexOf('async function getCachedOperationalExceptions(');
const end = scanSource.indexOf('// 60s matches the scan lock:', start);
let scanned = 0, cached = {scannedAt: 5000, result: {generatedAt: 5000}}, lockHeld = false;
const db = {ref(path){return path === '/cache' ? {async get(){return {val:()=>cached};}, async set(v){cached=v;}} : {async transaction(fn){if(lockHeld)return {committed:false};return {committed:true,snapshot:{val:()=>fn(null)}};}};}};
const ctx = {Date, Math, OPERATIONAL_EXCEPTION_CACHE_PATH:'/cache', OPERATIONAL_EXCEPTION_LOCK_PATH:'/lock', OPERATIONAL_EXCEPTION_LOCK_MS:60000, cachedOperationalResult:r=>r&&r.result, emptyOperationalResult:()=>({}), pauseOperationalCache:async()=>{}, scanOperationalExceptions:async()=>{scanned++;return {generatedAt:Date.now()};}, HttpsError:class extends Error{constructor(code,message){super(message);this.code=code;}}};
vm.createContext(ctx);vm.runInContext(scanSource.slice(start,end),ctx);
assert.equal((await ctx.getCachedOperationalExceptions(db,6000,true,true,4000)).generatedAt,5000);
assert.equal(scanned,0,'retry reused the completed scan');
lockHeld=true;
await assert.rejects(ctx.getCachedOperationalExceptions(db,6000,true,true,6000),/shared operational health scan/i);
assert.equal((await ctx.getCachedOperationalExceptions(db,6000,true,false)).generatedAt,5000,'manual lock contention may still show the saved result');
console.log('PASS: scheduled scan retries reuse completed scans and do not accept stale results under contention.');
lockHeld=false;
await ctx.getCachedOperationalExceptions(db,6000,true,true,6000);
assert.equal(scanned,1,'a later scheduled run starts a fresh scan');
await ctx.getCachedOperationalExceptions(db,6000,true,true,6000);
assert.equal(scanned,1,'duplicate delivery does not scan again');
lockHeld=true;cached={scannedAt:1,result:{generatedAt:1}};
ctx.pauseOperationalCache=async()=>{cached={scannedAt:Date.now()+1,result:{generatedAt:Date.now()}};};
await ctx.getCachedOperationalExceptions(db,6000,true,true,6000);
assert.equal(scanned,1,'a concurrent completed manual scan is reused');
const scanStart=scanSource.indexOf('async function scanOperationalExceptions(');
const scanEnd=scanSource.indexOf('// Background-task dead letters',scanStart);
let journalReads=0;
const ref={orderByChild(){return this;},startAt(){return this;},limitToLast(){return this;},limitToFirst(){return this;},equalTo(){return this;},async get(){return {val:()=>null,exists:()=>false};}};
ctx.financeDateFromTimestamp=()=> '2026-11-12';ctx.OperationalExceptions={DEAD_LETTER_WINDOW_MS:1,TOTAL_CHECK_WINDOW_MS:1};ctx.RetryGuard={DEAD_LETTER_ROOT:'dead'};
vm.runInContext(scanSource.slice(scanStart,scanEnd),ctx);
await assert.rejects(ctx.scanOperationalExceptions({ref(path){if(path==='/books/journal')journalReads++;return ref;}},Date.now(),true),/requires the monthly Books summary/);
assert.equal(journalReads,0,'automatic scan never reads full journal when summary is missing');
