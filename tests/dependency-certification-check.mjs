import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=file=>JSON.parse(fs.readFileSync(new URL(`../${file}`,import.meta.url),'utf8'));
const root=read('package-lock.json'),functionsLock=read('functions/package-lock.json'),functionsPackage=read('functions/package.json');
assert.equal(root.lockfileVersion,3,'root lockfile must use npm lockfile v3');
assert.equal(functionsLock.lockfileVersion,3,'Functions lockfile must use npm lockfile v3');
assert.equal(String(functionsPackage.engines.node),'22','Functions must remain on supported Node 22');
for(const [name,range] of Object.entries(functionsPackage.dependencies||{})){
  assert.ok(functionsLock.packages?.[`node_modules/${name}`]?.version,`production dependency is not locked: ${name}`);
  assert.ok(!/^(?:latest|\*|file:|git\+|https?:)/.test(String(range)),`unsafe dependency source/range: ${name}`);
  assert.ok(functionsLock.packages[`node_modules/${name}`].integrity,`dependency has no integrity hash: ${name}`);
}
console.log('PASS: Phase 12 dependency locks, integrity metadata, production dependency sources, and Node runtime are controlled.');
