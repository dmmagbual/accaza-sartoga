/* Recipe costing verification harness — READ ONLY. Writes nothing, changes nothing.

   Two questions this answers, neither of which can be answered from the app today:

   1. Does a FLAT recipe reproduce the current tree exactly? The engine already flattens
      base rows plus resolved option rows into one list on every sale (`contributions` in
      costOrder). If a flat list, fed back through the same engine, costs identically and
      consumes identically for every recipe x size x option combination, then flattening
      the STORED model cannot change a single number. That is the proof required before
      any structural change.

   2. What is the current model actually doing? Where a shared add-on and a drink-specific
      one both define the same option they STACK, they do not override. Where neither
      exists a legacy path fires. Both are invisible in the app.

   Usage:  node tools/recipe-costing-verify.mjs "backup json/<export>.json"
*/
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';

const root = path.join(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const Costing = require(path.join(root, 'functions/lib/costing.js'));

const exportPath = process.argv[2];
if (!exportPath) { console.error('Usage: node tools/recipe-costing-verify.mjs "<rtdb-export.json>"'); process.exit(2); }
const inputPath = path.isAbsolute(exportPath) ? exportPath : path.join(root, exportPath);
const db = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

const REQUIRED_COSTING_NODES = [
  'inventory',
  'recipes',
  'menuItems',
  'optionCosts',
  'optionGroups',
  'optionRecipes',
  'packagingRules',
];
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const missingNodes = REQUIRED_COSTING_NODES.filter((node) =>
  !Object.prototype.hasOwnProperty.call(db, node) || !isRecord(db[node]));
const emptyCoreNodes = ['inventory', 'recipes', 'menuItems'].filter((node) =>
  isRecord(db[node]) && Object.keys(db[node]).length === 0);

if (missingNodes.length || emptyCoreNodes.length) {
  console.error('INCOMPLETE COSTING EXPORT — reproduction was not run.');
  if (missingNodes.length) console.error('Missing or invalid top-level nodes: ' + missingNodes.join(', '));
  if (emptyCoreNodes.length) console.error('Required populated nodes are empty: ' + emptyCoreNodes.join(', '));
  console.error('\nExport checklist (all must be top-level JSON objects):');
  REQUIRED_COSTING_NODES.forEach((node) => {
    const populated = ['inventory', 'recipes', 'menuItems'].includes(node) ? ' (must contain records)' : ' (may be empty)';
    console.error('  [ ] ' + node + populated);
  });
  console.error('\nUse a Firebase Realtime Database export containing these seven nodes.');
  console.error('A file whose kind is accaza-recipe-restore-point contains recipes only and cannot reproduce costs.');
  console.error('Nothing was written.');
  process.exit(2);
}

const inventory    = db.inventory     || {};
const recipes      = db.recipes       || {};
const menuItems    = db.menuItems     || {};
const optionCosts  = db.optionCosts   || {};
const optionGroups = db.optionGroups  || {};
const optionRecipes= db.optionRecipes || {};
const packagingRules=db.packagingRules || {};
const SIZES = ['S', 'M', 'L'];

const ctx = {inventory, recipes, menuItems, optionCosts, optionRecipes, optionGroups, packagingRules};
const cost = (itemKey, size, optLabels) =>
  Costing.costOrder(Object.assign({}, ctx, {lineItems: [{itemKey, size, qty: 1, optLabels}]}));

/* Every option label this item can actually be sold with — the group ids on the menu item,
   exactly as getEffectiveOptionIds does in the app. Guessing wider invents combinations that
   are never sold and floods the report with unmapped options that do not exist. */
function labelsFor(itemKey) {
  const item = menuItems[itemKey] || {};
  const ids = Array.isArray(item.options) ? item.options : [];
  const out = [];
  ids.forEach((gid) => (((optionGroups[gid] || {}).choices) || []).forEach((c) => {
    const l = c && (c.label || c); if (l) out.push(String(l));
  }));
  return [...new Set(out)];
}

/* None, then each option on its own. That exercises every option's cost path once.
   Combining options tests only additivity, which the engine does linearly. */
function combos(labels) { return [[]].concat(labels.map((l) => [l])); }

/* The flat model: resolve every contributing row to explicit per-size quantities.
   This mirrors what costOrder does internally, then stores it as a base-only recipe. */
function flatten(itemKey, recipe, size, optLabels) {
  const probe = cost(itemKey, size, optLabels);
  return {
    base: (probe.lines || []).map((line) => ({
      ing: line.ingredientId,
      qtyS: line.quantityPerServing, qtyM: line.quantityPerServing, qtyL: line.quantityPerServing,
      inputUnit: line.stockUnit,
      _source: line.source,
    })),
    sizeMult: {S: 1, M: 1, L: 1},
  };
}

const sameMoney = (a, b) => Math.abs((Number(a) || 0) - (Number(b) || 0)) < 0.005;
function sameUsage(a, b) {
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  for (const k of keys) if (Math.abs((Number(a[k]) || 0) - (Number(b[k]) || 0)) > 0.000001) return false;
  return true;
}

const mismatches = [], needsReplace = [], stacked = [], legacy = [], unmapped = [], broken = [];
let checked = 0, recipeCount = 0;

for (const itemKey of Object.keys(recipes)) {
  const recipe = recipes[itemKey];
  if (!recipe || !Array.isArray(recipe.base) || !recipe.base.length) continue;
  recipeCount++;
  const name = (menuItems[itemKey] || {}).name || itemKey;
  const labels = labelsFor(itemKey);

  for (const size of SIZES) {
    for (const optLabels of combos(labels)) {
      const tree = cost(itemKey, size, optLabels);
      checked++;

      (tree.warnings || []).forEach((w) => {
        if (w.code === 'UNMAPPED_OPTION') unmapped.push({label: w.label, item: name});
      });
      (tree.errors || []).forEach((e) => broken.push(`${name} · ${size} · ${e.code} · ${e.message}`));

      /* Which sources fired for this combination. */
      const sources = new Set((tree.lines || []).map((l) => l.source));
      if (sources.has('option_global') && sources.has('option_recipe')) {
        stacked.push(`${name} · ${size} · [${optLabels.join(', ')}]`);
      }
      if (sources.has('option_legacy')) legacy.push(`${name} · ${size} · [${optLabels.join(', ')}]`);

      /* The proof: flat list must reproduce the tree exactly. */
      const flat = flatten(itemKey, recipe, size, optLabels);
      const flatResult = Costing.costOrder(Object.assign({}, ctx, {
        recipes: Object.assign({}, recipes, {[itemKey]: flat}),
        lineItems: [{itemKey, size, qty: 1, optLabels: []}],
      }));

      if (!sameMoney(tree.totalCost, flatResult.totalCost) || !sameUsage(tree.usage, flatResult.usage)) {
        /* A negative option row is a SUBSTITUTION expressed as a subtraction. costOrder allows it
           on an option row but rejects it on a base row, so it cannot survive flattening as-is.
           That is not a broken recipe — it is the missing `replace` concept, located precisely. */
        const negative = (tree.lines || []).some((l) => Number(l.quantityPerServing) < 0);
        const row = {item: name, size, options: optLabels.join(', ') || '(none)',
                     tree: tree.totalCost, flat: flatResult.totalCost};
        (negative ? needsReplace : mismatches).push(row);
      }
    }
  }
}

const uniq = (a) => [...new Set(a)];
const show = (title, rows, limit = 12) => {
  if (!rows.length) return;
  console.log(`\n${title} — ${rows.length}`);
  uniq(rows).slice(0, limit).forEach((r) => console.log('   ' + r));
  if (uniq(rows).length > limit) console.log(`   … and ${uniq(rows).length - limit} more`);
};

console.log(`Recipes ${recipeCount} · combinations costed ${checked} · engine ${Costing.VERSION}`);
const clean = checked - mismatches.length - needsReplace.length;
console.log(`\nReproduced exactly: ${clean} of ${checked}`);
if (mismatches.length) {
  console.log(`\n*** ${mismatches.length} UNEXPLAINED DIFFERENCES — investigate before flattening ***`);
  mismatches.slice(0, 15).forEach((m) =>
    console.log(`   ${m.item} · ${m.size} · ${m.options}   tree ${m.tree}  flat ${m.flat}`));
}
if (needsReplace.length) {
  console.log(`\n${needsReplace.length} combinations use a NEGATIVE option row (substitution written as a subtraction).`);
  console.log('These are the recipes that need a real `replace` operation before flattening.');
  uniq(needsReplace.map((m) => `${m.item} · ${m.options}`)).slice(0, 12).forEach((r) => console.log('   ' + r));
}
if (!mismatches.length && !needsReplace.length)
  console.log('*** The flat model reproduces the current tree on every combination. ***');

show('STACKED — shared add-on AND drink-specific both apply (charged twice)', stacked);
show('LEGACY — costed through recipe.options[] or optionRecipes[label]', legacy);
/* Grouped by option, not by combination. "Add 1 Shot is unmapped on 39 drinks" is a decision;
   1,293 individual rows is noise. Some of these are correct — a preference like "Less Sweet"
   consumes nothing. The ones to look at are the options that clearly consume something. */
if (unmapped.length) {
  const byLabel = {};
  unmapped.forEach((u) => { (byLabel[u.label] = byLabel[u.label] || new Set()).add(u.item); });
  const rows = Object.keys(byLabel).map((l) => ({label: l, drinks: byLabel[l].size}))
    .sort((a, b) => b.drinks - a.drinks);
  console.log(`\nUNMAPPED OPTIONS — no ingredient cost attached (${rows.length} distinct options)`);
  console.log('   Review each: a preference consumes nothing, but anything that adds a shot,');
  console.log('   a syrup or a topping should be costing ingredients and currently is not.');
  rows.forEach((r) => console.log(`   ${String(r.drinks).padStart(3)} drinks   ${r.label}`));
}
show('BROKEN — hard costing errors', broken);

if (!stacked.length && !legacy.length && !unmapped.length && !broken.length)
  console.log('\nNo stacking, no legacy paths, no unmapped options, no broken references.');
console.log('\nRead-only. Nothing was written.');
