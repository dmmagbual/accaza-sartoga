import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const read=(file)=>fs.readFileSync(path.join(root,file),'utf8');
const html=read('rewards.html');
const rewards=read('assets/js/customer/rewards.js');
const installer=read('assets/js/customer/rewards-install.js');
const sw=read('sw.js');
const manifest=JSON.parse(read('manifest-rewards.json'));

assert.ok(!/class="rw-note rw-how"/.test(html),'Registration must not contain the old hard-coded rewards list');
assert.ok(!/<ul class="nav-links">[\s\S]*?href="rewards\.html"/.test(html),'Rewards must not expose itself as a public navigation tab');
assert.ok(html.includes('rel="manifest" href="/manifest-rewards.json"'),'Rewards must use its dedicated install manifest');
for(const marker of ['id="saveRewardsCard" hidden','id="installRewardsConsent"','I consent to add the Accaza Rewards icon','id="installRewardsBtn"','Add Accaza Rewards','assets/js/customer/rewards-install.js'])assert.ok(html.includes(marker),`Rewards install experience missing: ${marker}`);
assert.equal(manifest.name,'Accaza Rewards','Installed app must have the approved name');
assert.equal(manifest.short_name,'Accaza Rewards','Installed shortcut must have the approved name');
assert.equal(manifest.start_url,'/rewards.html','Installed shortcut must reopen Rewards');
assert.equal(manifest.display,'standalone','Rewards shortcut must open like an app');
for(const size of ['192x192','512x512'])assert.ok(manifest.icons.some(icon=>icon.sizes===size),`Rewards manifest is missing the ${size} icon`);
for(const marker of ["serviceWorker.register('/sw.js',{scope:'/'})",'beforeinstallprompt','appinstalled','deferredPrompt.prompt()','Add to Home Screen','Install app or Add to Home screen','window.AccazaRewardsInstall={show:show}'])assert.ok(installer.includes(marker),`Rewards install lifecycle missing: ${marker}`);
assert.ok(!/firebase|onValue|onSnapshot|getDatabase|getFirestore/i.test(installer),'Install handling must not add Firebase reads or downloads');
assert.equal((rewards.match(/window\.AccazaRewardsInstall\?\.show\(\)/g)||[]).length,2,'Install card must appear for both badge-owning and linked members');
for(const asset of ['/manifest-rewards.json','/assets/js/customer/rewards-install.js'])assert.ok(sw.includes(`'${asset}'`),`Rewards offline shell asset missing: ${asset}`);

console.log('PASS: Rewards is direct-link-only and offers a consented, browser-confirmed Home Screen install after activation.');
