/* Firebase environment switch + UAT tooling — safety guard.
   The till, the live site and every non-UAT host must ALWAYS talk to production. UAT is
   chosen only on the UAT project's own hosting addresses, and the UAT scripts can never
   target production. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const root = path.join(import.meta.dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const env = await import(pathToFileURL(path.join(root, 'assets/js/shared/firebase-env.mjs')).href);

// 1. Production config is exactly the live project (unchanged values).
assert.deepEqual({...env.PRODUCTION_FIREBASE_CONFIG}, {
  apiKey: 'AIzaSyAsh6j1T0tC-v2avj1J2mfCDdFG88FcpUM', authDomain: 'accaza-sartoga.firebaseapp.com',
  databaseURL: 'https://accaza-sartoga-default-rtdb.asia-southeast1.firebasedatabase.app', projectId: 'accaza-sartoga',
  storageBucket: 'accaza-sartoga.firebasestorage.app', messagingSenderId: '315522485228', appId: '1:315522485228:web:64ed3b7facef5a39148ec9',
});
assert.equal(env.UAT_FIREBASE_CONFIG.projectId, 'accazacoffeepos-uat');

// 2. Every production / unknown / look-alike host gets production.
for (const host of ['accazacoffee.com', 'www.accazacoffee.com', 'dmmagbual.github.io', 'localhost', '127.0.0.1', '', undefined, null,
  'accaza-sartoga.web.app', 'accazacoffeepos-uat.web.app.evil.com', 'evil-accazacoffeepos-uat.web.app', 'accazacoffeepos-uat.web.app.', 'uat.accazacoffee.com']) {
  assert.equal(env.accazaFirebaseEnv(host), 'production', `host ${host} must use production`);
  assert.equal(env.accazaFirebaseConfig(host).projectId, 'accaza-sartoga', `host ${host} must get the production config`);
}
// 3. Only the UAT project's own addresses get UAT.
for (const host of ['accazacoffeepos-uat.web.app', 'accazacoffeepos-uat.firebaseapp.com', 'ACCAZACOFFEEPOS-UAT.WEB.APP']) {
  assert.equal(env.accazaFirebaseEnv(host), 'uat');
  assert.equal(env.accazaFirebaseConfig(host).databaseURL, 'https://accazacoffeepos-uat-default-rtdb.asia-southeast1.firebasedatabase.app');
}
// 4. Outside a browser (no location) the module is production and the UAT label is a no-op.
assert.equal(env.ACCAZA_FIREBASE_ENV, 'production');
assert.doesNotThrow(() => env.markUatPage('Admin'));
// 5. The returned config is a copy, so a caller can never mutate the frozen source.
const copy = env.accazaFirebaseConfig('accazacoffee.com'); copy.projectId = 'x';
assert.equal(env.PRODUCTION_FIREBASE_CONFIG.projectId, 'accaza-sartoga');

// 6. Admin (the till) and Finance Books read the config only through the switch.
for (const file of ['assets/js/admin/firebase-client.mjs', 'assets/js/books/live-pos.mjs']) {
  const s = read(file);
  assert.ok(s.includes('accazaFirebaseConfig(globalThis.location&&globalThis.location.hostname)'), `${file} must use the environment switch`);
  assert.ok(!s.includes('apiKey:"'), `${file} must not hard-wire a Firebase config`);
}
// 7. The till can start offline: the service worker precaches the switch module.
assert.ok(read('sw.js').includes("'/assets/js/shared/firebase-env.mjs'"), 'sw.js must precache firebase-env.mjs');

// 8. UAT tooling can never target production.
const deploy = read('tools/uat/deploy-uat.ps1');
assert.ok(deploy.includes("$UatProject = 'accazacoffeepos-uat'") && deploy.includes('Refusing to deploy'), 'deploy-uat.ps1 must pin and check the UAT project');
assert.ok(deploy.includes('firebase deploy --config firebase.uat.json --project $UatProject'), 'every UAT deploy must pass the UAT project explicitly');
assert.ok(!/accaza-sartoga/.test(deploy), 'deploy-uat.ps1 must not mention the production project');
const seed = await import(pathToFileURL(path.join(root, 'tools/uat/seed-uat.mjs')).href);
assert.throws(() => seed.assertUatTarget('accaza-sartoga', seed.UAT_DB), /Refusing/);
assert.throws(() => seed.assertUatTarget(seed.UAT_PROJECT, env.PRODUCTION_FIREBASE_CONFIG.databaseURL), /Refusing/);
const {uatFunctionNames} = await import(pathToFileURL(path.join(root, 'tools/uat/uat-function-list.mjs')).href);
const fns = uatFunctionNames(read('functions/index.js'));
assert.ok(fns.deploy.length > 100 && fns.scheduled.length >= 1, 'function list must be read from functions/index.js');
assert.ok(fns.scheduled.every((n) => !fns.deploy.includes(n)), 'scheduled functions must never be deployed to UAT');
assert.ok(fns.scheduled.includes('backupDatabaseDaily'), 'the nightly backup must stay out of UAT');

console.log(`PASS: production is the default on every host; UAT only on its own addresses; UAT tooling refuses production (${fns.deploy.length} functions, ${fns.scheduled.length} scheduled excluded).`);
