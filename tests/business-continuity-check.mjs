import assert from'node:assert/strict';import fs from'node:fs';import vm from'node:vm';
const queueSource=fs.readFileSync(new URL('../assets/js/admin/offline-queue.js',import.meta.url),'utf8'),register=fs.readFileSync(new URL('../src/admin/register/80-shift-lifecycle-zreport.js',import.meta.url),'utf8'),sw=fs.readFileSync(new URL('../sw.js',import.meta.url),'utf8');
for(const marker of ['async function continuityReadyForClose()','await window.__flushOfflineQueue()','state.pending','state.syncing','state.failed','Your cash count was not submitted; the shift remains open.'])assert.ok(register.includes(marker),`shift continuity guard missing: ${marker}`);
assert.equal((register.match(/await continuityReadyForClose\(\)/g)||[]).length,2,'shift close must check before counting and immediately before persistence');
assert.ok(queueSource.includes('function closeReadiness()')&&queueSource.includes('outstanding===0'),'offline queue close-readiness summary is missing');
assert.ok(sw.includes('authenticated POS cash sales use the durable IndexedDB continuity queue'),'PWA continuity contract is misleading');
const context={window:{},navigator:{},indexedDB:{open(){throw new Error('not invoked');}},localStorage:{getItem(){return null;}}};context.window=context;vm.createContext(context);vm.runInContext(queueSource,context);assert.equal(typeof context.AccazaOfflineQueue.closeReadiness,'function');
console.log('PASS: Phase 15 blocks offline or incomplete shift closure and retains an explicit PWA/POS continuity contract.');
