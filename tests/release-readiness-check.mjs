import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const fail=message=>{throw new Error(message);};
const manifest=JSON.parse(read('release-manifest.json'));

if(manifest.schemaVersion!==1||manifest.release!=='7A')fail('Release manifest schema/release is invalid');
if(!['candidate_pending_production_verification','production_verified'].includes(manifest.status))fail('Release manifest status is invalid');

for(const file of manifest.authoritativeFiles){
  if(!fs.existsSync(path.join(root,file)))fail(`Authoritative release file missing: ${file}`);
}

const admin=read('admin.html'),customer=read('index.html'),sw=read('sw.js');
if(!admin.includes(`build&nbsp;v${manifest.builds.admin}`))fail('Admin build marker differs from release manifest');
if(!customer.includes(`accaza-index build v${manifest.builds.customer}`))fail('Customer build marker differs from release manifest');
if(!sw.includes(`const CACHE='accaza-v${manifest.builds.serviceWorkerCache}'`))fail('Service-worker cache differs from release manifest');

const firebase=JSON.parse(read('firebase.json')),fnPackage=JSON.parse(read('functions/package.json'));
if(String(fnPackage.engines&&fnPackage.engines.node)!==String(manifest.project.nodeRuntime))fail('Functions Node runtime differs from release manifest');
if(!Array.isArray(firebase.functions)||firebase.functions[0].runtime!==`nodejs${manifest.project.nodeRuntime}`)fail('firebase.json Functions runtime differs from release manifest');
if(firebase.database?.rules!=='database.rules.json'||firebase.storage?.rules!=='storage.rules')fail('Firebase rules deployment mapping is incomplete');

const functionsSource=read('functions/index.js');
for(const name of manifest.requiredFunctionExports){
  if(!new RegExp(`exports\\.${name}\\s*=`).test(functionsSource))fail(`Required Cloud Function export missing: ${name}`);
}

const rules=read('database.rules.json');
const rulesObject=JSON.parse(rules.replace(/^\s*\/\/.*$/gm,''));
for(const node of manifest.requiredProtectedNodes){
  if(!rules.includes(`"${node}"`))fail(`Required protected database node missing: ${node}`);
}
for(const node of ['offlinePosSync','clientTelemetryDaily','financialMovements','financialApprovals','operationalAudit','deletionAudit']){
  if(rulesObject.rules?.[node]?.['.write']!==false)fail(`Server-write protection missing for: ${node}`);
}

if(read('assets/js/shared/costing.js')!==read('functions/lib/costing.js'))fail('Browser and server costing engines have drifted');

const handoff=read('CLAUDE_HANDOFF.md'),entry=read('CLAUDE.md');
for(const marker of ['Deployment truth','Authoritative file map','Firebase data ownership','Known limitations','Production verification']){
  if(!handoff.includes(marker))fail(`Final handoff section missing: ${marker}`);
}
if(!entry.includes('CLAUDE_HANDOFF.md')||!entry.includes('release-manifest.json')||!entry.includes('npm run test:ci'))fail('CLAUDE.md does not route future sessions to authoritative state and validation');

const pending=Object.entries(manifest.verification).filter(([,status])=>status==='pending').map(([name])=>name);
if(manifest.status==='production_verified'&&pending.length)fail(`Manifest claims production verified with pending checks: ${pending.join(', ')}`);

console.log(`PASS: Release ${manifest.release} files, builds, runtimes, Functions, rules, costing authority, and handoff are internally consistent.`);
console.log(pending.length?`PENDING PRODUCTION EVIDENCE: ${pending.join(', ')}`:'PASS: all recorded production-verification fields are complete.');
