// Guards docs/DATA_FLOW_MAP.md, the reference used when diagnosing how a screen,
// a database record and a Cloud Function connect. Fails when:
//   - the committed map no longer matches the Functions source (run `npm run map:data-flow`)
//   - a curated money-path link is broken (renamed function, changed trigger path,
//     a step that no longer writes the node the next step watches)
//   - the scanner stops seeing exports or the write patterns the money paths depend on.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {build, validateFlows, MAP_FILE} from '../tools/data-flow-map.mjs';

const root = process.cwd();
const {model, flows, problems, markdown} = build(root);

// 1. Curated money paths are intact.
assert.deepEqual(problems, [], `Money-path map has broken links:\n- ${problems.join('\n- ')}`);
assert.ok(flows.flows.length >= 7, 'money-path flows were removed');

// 2. The committed map is current.
const committed = fs.readFileSync(path.join(root, MAP_FILE), 'utf8').replace(/\r\n/g, '\n');
assert.equal(committed, markdown, `${MAP_FILE} is stale. Run: npm run map:data-flow`);

// 3. The scanner sees every Cloud Function export (same count as the deployed bundle).
const bundle = fs.readFileSync(path.join(root, 'functions/index.js'), 'utf8');
const bundleExports = new Set([...bundle.matchAll(/\bexports\.([A-Za-z_$][\w$]*)\s*=/g)].map((m) => m[1]));
const scanned = new Set(model.exports.map((e) => e.name));
const missed = [...bundleExports].filter((n) => !scanned.has(n));
assert.deepEqual(missed, [], `Scanner missed exports: ${missed.join(', ')}`);
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'release-manifest.json'), 'utf8'));
for (const name of manifest.requiredFunctionExports || []) assert.ok(scanned.has(name), `required export not scanned: ${name}`);
for (const e of model.exports) {
  assert.ok(!e.kind.startsWith('other:'), `${e.name}: unrecognised export kind ${e.kind}`);
  if (e.kind === 'trigger') assert.ok(e.watches.startsWith('/'), `${e.name}: trigger path not found`);
}

// 4. The three write patterns the money paths rely on are still detected.
const fn = (name) => model.exports.find((e) => e.name === name);
assert.ok(fn('mirrorPosMovementToBooks').writes.includes('books/journal/{*}'), 'ref held in a variable then .transaction() not detected');
assert.ok(fn('syncRegisterCashFloat').writes.includes('books/journal/register_float_control'), 'writes["path"] = value multi-path key not detected');
assert.ok(fn('onOrderFinalize').writes.includes('orders/{*}'), 'ref passed to a helper that writes it not detected');
assert.ok(fn('onOrderFinancialPosting').writes.includes('financialMovements/{*}'), 'write through a resolved helper not detected');

// 5. The validator really rejects broken links.
const clone = () => JSON.parse(JSON.stringify(flows));
const expectProblem = (mutate, pattern, label) => {
  const f = clone(); mutate(f.flows.find((x) => x.id === 'pos-sale'));
  const found = validateFlows(model, f);
  assert.ok(found.some((p) => pattern.test(p)), `${label} was not detected: ${found.join(' | ') || 'no problems'}`);
};
expectProblem((flow) => { flow.steps[1].fn = 'onOrderFinancialPostingRenamed'; }, /no exported Cloud Function/, 'renamed function');
expectProblem((flow) => { flow.steps[1].watches = '/orderz/{orderId}'; }, /source watches/, 'changed trigger path');
expectProblem((flow) => { flow.steps[0].writes = ['offlinePosSync']; }, /no earlier step in this flow writes \/orders/, 'missing upstream writer');
expectProblem((flow) => { flow.steps[3].writes = ['loyaltyLedger']; }, /no longer references that node/, 'step that stopped writing a node');

console.log(`Data-flow map current: ${flows.flows.length} money paths, ${model.exports.length} exports scanned.`);
