// Cloud Functions cold-start guard (31 Oct 2026). Cloud Run bills instance start-up, and on
// 24-31 Oct start-up was about three quarters of all billed function time. Firestore, Messaging
// and Storage were half of the module load and are used by only a few functions, so they load on
// first use. This check fails if any of them is required again at load time, and proves the lazy
// FieldPath/FieldValue/getX wrappers still behave like the real SDK.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';

const functionsDir = new URL('../functions/', import.meta.url);
const source = fs.readFileSync(new URL('index.js', functionsDir), 'utf8');
for (const name of ['firestore', 'messaging', 'storage']) {
  assert.ok(!new RegExp(`(const|let|var)\\s*\\{[^}]*\\}\\s*=\\s*require\\(["']firebase-admin/${name}["']\\)`).test(source), `firebase-admin/${name} must not be required at load time`);
  assert.ok(source.includes(`lazyAdminModule("firebase-admin/${name}")`), `firebase-admin/${name} must load through lazyAdminModule`);
}

const env = {...process.env, GCLOUD_PROJECT: 'accaza-sartoga', FIREBASE_CONFIG: JSON.stringify({projectId: 'accaza-sartoga', databaseURL: 'https://accaza-sartoga-default-rtdb.asia-southeast1.firebasedatabase.app'})};
const probe = "const path=require('path');const x=require('./index.js');const keys=Object.keys(require.cache);" +
  "console.log(JSON.stringify({exports:Object.keys(x).length,loaded:['firestore','messaging','storage'].filter(n=>keys.some(k=>k.includes(path.join('firebase-admin','lib',n))))}))";
const result = JSON.parse(execFileSync(process.execPath, ['-e', probe], {cwd: functionsDir, env, encoding: 'utf8'}).trim().split('\n').pop());
assert.ok(result.exports > 100, 'functions/index.js must load and register its exports');
assert.deepEqual(result.loaded, [], `loading functions/index.js must not load ${result.loaded.join(', ')}`);

const start = source.indexOf('function lazyAdminModule(name)');
const end = source.indexOf('\n', source.indexOf('const getStorage = '));
assert.ok(start > 0 && end > start, 'lazy SDK wrappers missing');
const requireFromFunctions = createRequire(new URL('index.js', functionsDir));
const wrappers = new Function('require', `${source.slice(start, end)}\nreturn {getFirestore, FieldPath, FieldValue, getMessaging, getStorage};`)(requireFromFunctions);
const real = requireFromFunctions('firebase-admin/firestore');
assert.ok(wrappers.FieldPath.documentId().isEqual(real.FieldPath.documentId()), 'FieldPath.documentId() must match the SDK');
assert.ok(wrappers.FieldValue.increment(3).isEqual(real.FieldValue.increment(3)), 'FieldValue.increment() must match the SDK');
for (const fn of ['getFirestore', 'getMessaging', 'getStorage']) assert.equal(typeof wrappers[fn], 'function', `${fn} wrapper missing`);
// Optional firebase-admin dependencies now load on first use, so prove each one resolves here
// rather than finding a missing package on the first production call.
for (const name of ['firestore', 'messaging', 'storage']) assert.equal(typeof requireFromFunctions(`firebase-admin/${name}`)[`get${name[0].toUpperCase()}${name.slice(1)}`], 'function', `firebase-admin/${name} must resolve`);
console.log(`Functions cold-start checks passed (${result.exports} exports; Firestore, Messaging and Storage load on first use).`);
