import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file));
const manifest=JSON.parse(read('release-manifest.json').toString('utf8'));
const admin=read('admin.html').toString('utf8');
const scriptMatch=admin.match(/<script src="(assets\/js\/admin\/accaza-ai\.js)\?v=(\d+)"><\/script>/);
assert.ok(scriptMatch,'Admin page must load the reviewed Accaza AI browser bundle.');
assert.equal(Number(scriptMatch[2]),manifest.builds.admin,'Admin AI cache key must match the visible build.');
assert.ok(admin.includes(`name="accaza-admin-build" content="${manifest.builds.admin}"`),'Admin telemetry build must match the release.');
assert.ok(admin.includes(`build&nbsp;v${manifest.builds.admin}`),'Visible Admin build must match the release.');
assert.ok(read('sw.js').toString('utf8').includes(`const CACHE='accaza-v${manifest.builds.serviceWorkerCache}'`),'Service worker cache must match the release.');

const bundlePath=scriptMatch[1];
const bundle=read(bundlePath);
const source=bundle.toString('utf8');
for(const marker of ['id="accazaAiProvider"','Qwen / Ollama',"PROVIDER='auto'",'provider:PROVIDER',"role==='owner'||role==='superadmin'"]){
  assert.ok(source.includes(marker),`Admin AI bundle lacks model selector wiring: ${marker}`);
}
const expectedHash=createHash('sha256').update(bundle).digest('hex');
console.log(`PASS: Admin v${manifest.builds.admin} loads the selector-enabled AI bundle; cache v${manifest.builds.serviceWorkerCache} is synchronized.`);

if(process.argv.includes('--live')){
  const base=new URL(manifest.project.productionDomain);
  const wait=process.argv.includes('--wait');
  const attempts=wait?18:1;
  let failure;
  for(let attempt=1;attempt<=attempts;attempt++){
    try{
      const nonce=`${Date.now()}-${attempt}`;
      const pageResponse=await fetch(new URL(`/admin.html?deployment_check=${nonce}`,base),{headers:{'cache-control':'no-cache'},signal:AbortSignal.timeout(15000)});
      assert.equal(pageResponse.status,200,'Production Admin page did not load.');
      const page=await pageResponse.text();
      assert.ok(page.includes(`name="accaza-admin-build" content="${manifest.builds.admin}"`),'Production Admin build is stale.');
      assert.ok(page.includes(`src="${bundlePath}?v=${manifest.builds.admin}"`),'Production Admin page loads the wrong AI bundle.');
      const liveBundleResponse=await fetch(new URL(`/${bundlePath}?v=${manifest.builds.admin}&deployment_check=${nonce}`,base),{headers:{'cache-control':'no-cache'},signal:AbortSignal.timeout(15000)});
      assert.equal(liveBundleResponse.status,200,'Production AI bundle did not load.');
      const liveHash=createHash('sha256').update(Buffer.from(await liveBundleResponse.arrayBuffer())).digest('hex');
      assert.equal(liveHash,expectedHash,'Production AI bundle differs from the reviewed selector-enabled bundle.');
      console.log(`PASS: Production Admin v${manifest.builds.admin} serves the exact selector-enabled AI bundle.`);
      process.exit(0);
    }catch(error){
      failure=error;
      if(attempt<attempts){
        console.log(`Production Admin has not reached v${manifest.builds.admin} (attempt ${attempt}/${attempts}): ${error.message}`);
        await new Promise(resolve=>setTimeout(resolve,15000));
      }
    }
  }
  throw new Error(`Production Admin deployment verification failed after ${attempts} attempt(s): ${failure.message}`);
}
