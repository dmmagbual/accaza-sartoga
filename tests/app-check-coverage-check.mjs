import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const read=(file)=>fs.readFileSync(path.join(root,file),'utf8');
const fail=(message)=>{throw new Error(message);};
const manifest=JSON.parse(read('release-manifest.json'));
const helperPath='assets/js/shared/firebase-app-check.mjs';
const helper=read(helperPath);

for(const marker of ['ReCaptchaEnterpriseProvider','isTokenAutoRefreshEnabled:true','getToken(instance,false)','__accazaAppCheckStatus']){
  if(!helper.includes(marker))fail(`Shared App Check helper is missing ${marker}`);
}

function requireBefore(file,createMarker,checkMarker,serviceMarker){
  const source=read(file),created=source.indexOf(createMarker),checked=source.indexOf(checkMarker,created),used=source.indexOf(serviceMarker,created);
  if(created<0||checked<0||used<0||checked>used)fail(`${file} must initialize App Check after creating its Firebase app and before ${serviceMarker}`);
}

requireBefore('assets/js/admin/firebase-client.mjs','const app=initializeApp(firebaseConfig)','initializeAccazaAppCheck(app','getDatabase(app)');
requireBefore('assets/js/admin/manager-approval.mjs','mgrApp=initializeApp(firebaseConfig','initializeAccazaAppCheck(mgrApp','getAuth(mgrApp)');
requireBefore('assets/js/books/live-pos.mjs','app=initializeApp(cfg)','initializeAccazaAppCheck(app','getDatabase(app)');
requireBefore('assets/js/customer/core.mjs','const app=initializeApp(firebaseConfig)','initializeAccazaAppCheck(app','getDatabase(app)');
requireBefore('assets/js/customer/order-availability.mjs','const app=getApps()[0]||initializeApp(firebaseConfig)','initializeAccazaAppCheck(app','getDatabase(app)');
requireBefore('assets/js/customer/rewards.js','const app = initializeApp(firebaseConfig)','initializeAccazaAppCheck(app','getFunctions(app');

const activeFiles=new Set([...(manifest.authoritativeFiles||[]),'ai.html','ai-business.html','assets/js/customer/order-availability.mjs','assets/js/customer/rewards.js']);
for(const file of activeFiles){
  if(!/\.(?:html|m?js)$/.test(file)||file==='sw.js'||file.startsWith('functions/')||file.startsWith('src/functions/')||!fs.existsSync(path.join(root,file)))continue;
  const source=read(file);
  if(source.includes('initializeApp(')&&!source.includes('initializeAccazaAppCheck')&&!source.includes('initializeAppCheck'))fail(`${file} creates an active browser Firebase app without App Check`);
}

const sw=read('sw.js');
if(!sw.includes(`'/${helperPath}'`))fail('The App Check helper must be present in the offline cache');
if((manifest.authoritativeFiles||[]).filter(file=>file===helperPath).length!==1)fail('The App Check helper must be listed exactly once as an authoritative release file');

console.log('PASS: every active browser Firebase app initializes App Check before using Auth, Database, or Functions.');
