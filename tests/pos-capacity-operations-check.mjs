import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {BUDGET_WARN_ROOM,BUNDLE_BUDGETS,BUNDLE_HARD_RESERVES,HARD_LIMIT_FILES,budgetState,isHardLimited,usableBudget} from './bundle-budgets.mjs';

const read=path=>fs.readFileSync(path,'utf8');
const posFile='assets/js/admin/pos.js';
const capacitySource=read('assets/js/admin/pos-capacity.js');
const operationsSource=read('assets/js/admin/operations-dashboard.js');
const buildSource=read('tools/build-runtime-bundles.mjs');
const adminSource=read('src/html/admin/70-runtime.html');
const adminHtml=read('admin.html');
const sw=read('sw.js');
const adminBuild=(adminHtml.match(/<meta name="accaza-admin-build" content="(\d+)"\/>/)||[])[1];
assert.ok(adminBuild,'Admin build marker is missing');

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
for(const html of [adminSource,adminHtml])assert.ok(html.includes(`assets/js/admin/pos-capacity.js?v=${adminBuild}`), 'Admin must load the generated capacity before Operations Center');
assert.ok(sw.includes("'/assets/js/admin/pos-capacity.js'"),'Admin offline shell must cache POS capacity');

// Release capacity (15 Oct 2026): every other guarded file is a gauge, not a gate.
assert.deepEqual([...HARD_LIMIT_FILES],[posFile],'only the POS emergency reserve may block a release');
assert.equal(isHardLimited('assets/js/admin/accaza-ai.js'),false);
const perf=read('tests/performance-budget-check.mjs');
assert.ok(perf.includes("if(state==='fail'&&!isHardLimited(file)){warn(file,")&&perf.includes('continue;}'),'a non-POS file past its ceiling must warn, not fail');
for(const [file,marker] of [['tests/static/10-syntax-rendering.mjs','customer runtime is past its review ceiling'],['tests/static/30-server-release.mjs','Phase 4C core module is past its review ceiling']])assert.ok(read(file).includes(`console.warn('BUDGET WARNING: ${marker}`),`${file} size guard must be a warning`);
const release=capacityWindow.AccazaReleaseCapacity;
assert.ok(release&&Array.isArray(release.files),'the build must generate the release capacity list');
const tracked=Object.keys(BUNDLE_BUDGETS).filter(file=>!isHardLimited(file)&&fs.existsSync(file));
assert.equal(release.total,tracked.length,'release capacity must count every guarded non-POS file');
const expected=tracked.map(file=>{const bytes=fs.statSync(file).size,ceiling=BUNDLE_BUDGETS[file],state=budgetState(bytes,ceiling);return {file,bytes,ceiling,pct:Math.round(1000*bytes/ceiling)/10,state:state==='fail'?'over':state};}).filter(row=>row.state!=='ok').sort((a,b)=>b.pct-a.pct||(a.file<b.file?-1:1));
assert.deepEqual(JSON.parse(JSON.stringify(release.files)),expected,'release capacity must match the actual files; run npm run build:runtime');
assert.equal(release.healthy,release.total-expected.length);
const releaseState=operationsWindow.__accazaOperationsHealth.releaseCapacityState;
assert.equal(releaseState({total:33,healthy:33,files:[]}).level,'good');
assert.equal(releaseState({total:33,healthy:32,files:[{file:'assets/js/admin/a.js',bytes:99,ceiling:100,pct:99,state:'warn'}]}).level,'watch');
assert.equal(releaseState({total:33,healthy:32,files:[{file:'assets/js/admin/a.js',bytes:101,ceiling:100,pct:101,state:'over'}]}).level,'over');
assert.equal(releaseState(null).level,'missing');
assert.equal(releaseState({total:3,healthy:5,files:[]}).level,'missing','impossible counts must not render as healthy');
for(const marker of ['RELEASE CAPACITY','App file sizes','A warning never stops a release; only the POS emergency reserve above can.','posCapacityPanel()+releaseCapacityPanel()+'])assert.ok(operationsSource.includes(marker),`Operations Center is missing ${marker}`);
const releasePanel=operationsSource.slice(operationsSource.indexOf('function releaseCapacityState('),operationsSource.indexOf('function status(avg,max,target,count,failed)'));
for(const forbidden of ['global.__accaza','subscribe(','onValue(','ref(','get('])assert.ok(!releasePanel.includes(forbidden),`Release capacity panel must not add a Firebase operation: ${forbidden}`);

console.log('PASS: Operations Center shows automatically generated POS capacity (the only hard release stop) and the Release capacity gauge for every other file, without a Firebase read.');
