import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {BUDGET_WARN_ROOM,BUNDLE_BUDGETS,BUNDLE_HARD_RESERVES,usableBudget} from './bundle-budgets.mjs';

const read=path=>fs.readFileSync(path,'utf8');
const posFile='assets/js/admin/pos.js';
const capacitySource=read('assets/js/admin/pos-capacity.js');
const operationsSource=read('assets/js/admin/operations-dashboard.js');
const buildSource=read('tools/build-runtime-bundles.mjs');
const adminSource=read('src/html/admin/70-runtime.html');
const adminHtml=read('admin.html');
const sw=read('sw.js');

const capacityWindow={};
vm.runInNewContext(capacitySource,{window:capacityWindow,Object});
const capacity=capacityWindow.AccazaPosCapacity;
const expectedLimit=usableBudget(BUNDLE_BUDGETS[posFile],BUNDLE_HARD_RESERVES[posFile]);
const expectedWarning=Math.round(expectedLimit*(1-BUDGET_WARN_ROOM));
assert.deepEqual(JSON.parse(JSON.stringify(capacity)),{
  bytes:fs.statSync(posFile).size,
  warning:expectedWarning,
  limit:expectedLimit,
  reserve:BUNDLE_HARD_RESERVES[posFile],
  envelope:BUNDLE_BUDGETS[posFile]
},'generated Operations Center capacity must match the actual POS file and CI policy');

const operationsWindow={__accazaRegisterModule(){}};
operationsWindow.window=operationsWindow;
vm.runInNewContext(operationsSource,{window:operationsWindow,Date,Math,Number,String,Object,Array,JSON,console});
const state=operationsWindow.__accazaOperationsHealth.posCapacityState;
assert.equal(state({bytes:584999,warning:585000,limit:600000,reserve:50000,envelope:650000}).level,'good');
assert.equal(state({bytes:585000,warning:585000,limit:600000,reserve:50000,envelope:650000}).level,'watch');
assert.equal(state({bytes:600000,warning:585000,limit:600000,reserve:50000,envelope:650000}).level,'watch');
assert.equal(state({bytes:600001,warning:585000,limit:600000,reserve:50000,envelope:650000}).level,'blocked');
assert.equal(state(null).level,'missing');

for(const marker of ['POS RELEASE SAFEGUARD','POS bundle capacity','RELEASE BLOCKED','WATCH — PLAN POS SPLIT','protected emergency reserve'])assert.ok(operationsSource.includes(marker),`Operations Center is missing ${marker}`);
const panel=operationsSource.slice(operationsSource.indexOf('function posCapacityPanel(){'),operationsSource.indexOf('function card(def,data)'));
for(const forbidden of ['global.__accaza','subscribe(','onValue(','ref(','get('])assert.ok(!panel.includes(forbidden),`POS capacity panel must not add a Firebase operation: ${forbidden}`);
for(const marker of ['fs.statSync','assets/js/admin/pos-capacity.js','BUNDLE_HARD_RESERVES','BUDGET_WARN_ROOM'])assert.ok(buildSource.includes(marker),`runtime build does not regenerate capacity from ${marker}`);
for(const html of [adminSource,adminHtml])assert.ok(html.includes('assets/js/admin/pos-capacity.js?v=638'), 'Admin must load the generated capacity before Operations Center');
assert.ok(sw.includes("'/assets/js/admin/pos-capacity.js'"),'Admin offline shell must cache POS capacity');

console.log('PASS: Operations Center shows automatically generated POS capacity with GOOD, WATCH, and RELEASE BLOCKED states without a Firebase read.');
