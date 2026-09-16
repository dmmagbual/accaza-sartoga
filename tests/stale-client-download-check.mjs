// Stale Admin tabs (built before 495) call getOperationalExceptions every minute and never
// reload. They must not download the saved health scan; current clients ask for it with
// cached:true (17 Sep 2026 download audit).
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createFakeDatabase} from './helpers/fake-rtdb.mjs';
import {loadFunctions} from './helpers/functions-sandbox.mjs';

const saved = {generatedAt: 1, counts: {critical: 1, warning: 0, total: 1}, exceptions: [{id: 'x', category: 'inventory_gap', detail: 'y'.repeat(4000)}]};
const db = createFakeDatabase({admins: {owner: 'owner'}, systemHealth: {operationalExceptions: {current: {scannedAt: 5, result: saved, schemaVersion: 1}}}});
const {exports: fx} = loadFunctions(db);
const auth = {uid: 'owner', token: {email: 'owner@example.test'}};
for (const data of [{}, {force: false}, undefined]) {
  const mark = db.reads.length;
  const result = await fx.getOperationalExceptions({auth, data});
  assert.equal(result.staleClient, true, 'a request without cached:true gets the empty manual-only answer');
  assert.equal(result.exceptions.length, 0);
  assert.ok(!db.reads.slice(mark).some((r) => r.path.startsWith('systemHealth')), 'a stale tab never downloads the saved scan');
}
const current = await fx.getOperationalExceptions({auth, data: {force: false, cached: true}});
assert.equal(current.exceptions.length, 1, 'current clients still read the saved scan');
assert.ok(fs.readFileSync(new URL('../assets/js/admin/core.mjs', import.meta.url), 'utf8').includes('getOperationalExceptions({force:force===true,cached:true})'), 'the Admin bridge asks for the saved scan explicitly');
console.log('PASS: stale Admin tabs get an empty health answer without downloading the saved scan; current tabs still read it.');
