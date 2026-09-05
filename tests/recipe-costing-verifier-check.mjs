import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root = path.join(import.meta.dirname, '..');
const verifier = path.join(root, 'tools', 'recipe-costing-verify.mjs');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'accaza-recipe-verifier-'));

function run(name, data) {
  const file = path.join(temp, name);
  fs.writeFileSync(file, JSON.stringify(data));
  return spawnSync(process.execPath, [verifier, file], {cwd: root, encoding: 'utf8'});
}

try {
  const recipesOnly = run('recipes-only.json', {
    version: 'accaza-recipes-restore-v1',
    kind: 'accaza-recipe-restore-point',
    recipes: {drink: {base: [{ing: 'coffee', qtyS: 10, qtyM: 10, qtyL: 10}]}}
  });
  assert.equal(recipesOnly.status, 2, 'recipes-only restore points must be refused');
  assert.match(recipesOnly.stderr, /INCOMPLETE COSTING EXPORT/);
  for (const node of ['inventory', 'menuItems', 'optionCosts', 'optionGroups', 'optionRecipes', 'packagingRules']) {
    assert.match(recipesOnly.stderr, new RegExp('\\[ \\] ' + node.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      `export checklist must name ${node}`);
  }
  assert.doesNotMatch(recipesOnly.stdout, /reproduces the current tree|Reproduced exactly/,
    'incomplete input must never print a successful reproduction summary');

  const complete = run('complete.json', {
    inventory: {coffee: {name: 'Coffee', unit: 'g', cost: 0.1}},
    recipes: {drink: {base: [{ing: 'coffee', qtyS: 10, qtyM: 10, qtyL: 10}]}},
    menuItems: {drink: {name: 'Coffee', options: []}},
    optionCosts: {},
    optionGroups: {},
    optionRecipes: {},
    packagingRules: {}
  });
  assert.equal(complete.status, 0, complete.stderr || complete.stdout);
  assert.match(complete.stdout, /Reproduced exactly: 3 of 3/);
  assert.match(complete.stdout, /flat model reproduces the current tree on every combination/);

  console.log('PASS: recipe costing verification refuses recipes-only restore points and accepts complete costing exports.');
} finally {
  fs.rmSync(temp, {recursive: true, force: true});
}
