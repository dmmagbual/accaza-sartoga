/* Homemade pastry batch card (admin 688, 14 Oct 2026).

   Proves the two things Danilo asked for before the build:
     1. the card can never proceed on a wrong stock item, and
     2. a delayed bake is never blocked by insufficient ingredient stock.
   Plus the permission, rules, budget and wiring the screen depends on. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
/* The server converts each line's recipe unit to the item's stock unit with the shared costing
   engine, so the test uses the same engine the bundle requires. */
const costing = createRequire(import.meta.url)('../functions/lib/costing.js');

const read = (p) => fs.readFileSync(p, 'utf8');
const inventory = read('src/functions/50-inventory.js');
const baking = read('src/functions/50a-baking.js');
const rules = read('database.rules.json');
const manifest = JSON.parse(read('release-manifest.json'));
const loader = read('assets/js/admin/module-loader.js');
const hub = read('assets/js/admin/realtime-hub.mjs');
const adminHtml = read('admin.html');
const workspaceSource = read('src/html/admin/50-admin-workspace.html');
const sharedState = read('src/admin/pos/00-shared-state.js');
const portalAccounts = read('src/functions/20b-portal-accounts.js');
const core = read('assets/js/admin/core.mjs');
const staffAccess = read('assets/js/admin/staff-access.js');
const sw = read('sw.js');
const budgets = read('tests/bundle-budgets.mjs');
const backupDelta = read('functions/lib/backup-delta.js');
const registerSettings = read('src/admin/register/70-settings-staff.js');

/* ── 1. Movement plumbing: production is a real type, and the browser cannot post it ───────── */
for (const marker of ['"production", "production_reversal",']) {
  assert.ok(inventory.includes(marker), `production movement types missing: ${marker}`);
}
assert.ok(/INVENTORY_BOOK_POSTING_TYPES = new Set\(\[[^\]]*"production", "production_reversal"\]\)/.test(inventory),
  'production must be in the book-posting type list');
assert.ok(/const serverOnly = new Set\(\[[^\]]*"production", "production_reversal"\]\);/.test(inventory),
  'production movements must be server-only, so the shared inventory callable refuses them from a browser');
assert.ok(/\["purchase", "purchase_reversal", "production", "production_reversal"\]\.includes\(type\) \? requestedCost : costBefore\b/.test(inventory),
  'a production movement must carry its own unit cost the way a purchase does');
assert.ok(inventory.includes('A batch card movement must carry a unit cost greater than zero.'),
  'a production movement without a unit cost must be refused');

/* ── 2. Offset rule: a bake may only move value between inventory accounts ─────────────────── */
{
  const start = inventory.indexOf('function inventoryAdjustmentOffset');
  const end = inventory.indexOf('async function postInventoryMovementToBooks', start);
  assert.ok(start >= 0 && end > start, 'inventory offset validator must exist');
  const context = vm.createContext({ HttpsError: class extends Error { constructor(code, message) { super(message); this.code = code; } } });
  vm.runInContext(inventory.slice(start, end), context);
  const offset = context.inventoryAdjustmentOffset;
  assert.equal(offset('production', { offsetAccount: '1240' }), '1240', 'a batch card debits the pastry inventory account');
  assert.equal(offset('production_reversal', { offsetAccount: '1210' }), '1210', 'a reversal may offset another inventory account');
  assert.throws(() => offset('production', { offsetAccount: '5030' }), /inventory control account/, 'a bake may never offset cost of sales');
  assert.throws(() => offset('production', { offsetAccount: '5905' }), /inventory control account/, 'a bake may never offset inventory reconciliation');
  assert.throws(() => offset('production', { offsetAccount: '' }), /inventory control account/, 'a bake must name its inventory offset');
}

/* ── 3. Mapping enforcement operates on real item records ─────────────────────────────────── */
{
  const start = baking.indexOf('const BAKING_MANAGER_ROLES');
  const end = baking.indexOf('async function bakingReadProduct', start);
  assert.ok(start >= 0 && end > start, 'mapping validators must exist');
  const context = vm.createContext({ qty6: (v) => Math.round((Number(v) || 0) * 1e6) / 1e6, Costing: costing });
  vm.runInContext(baking.slice(start, end), context);
  const { bakingPastryProblem, bakingLineProblem, bakingMappingFingerprint, bakingStockQty } = context;
  const pastry = { id: 'ing_cookie', name: 'Choco Chip Cookie', unit: 'pc', inventoryAccount: '1240', costAccount: '5030', active: true };
  const flour = { name: 'Flour', unit: 'kg', inventoryAccount: '1240', costAccount: '5030', recipeItem: true, active: true };

  assert.equal(bakingPastryProblem(pastry, 'ing_cookie'), '', 'a correctly mapped pastry item passes');
  assert.match(bakingPastryProblem(null, 'ing_cookie'), /no longer exists/, 'a deleted pastry item refuses the card');
  assert.match(bakingPastryProblem(Object.assign({}, pastry, { active: false }), 'ing_cookie'), /archived/, 'an archived pastry item refuses the card');
  assert.match(bakingPastryProblem(Object.assign({}, pastry, { unit: '' }), 'ing_cookie'), /no unit/, 'a pastry item without a unit refuses the card');
  assert.match(bakingPastryProblem(Object.assign({}, pastry, { inventoryAccount: '1200' }), 'ing_cookie'), /1240/, 'a cookie produced into Coffee & Beans is refused');
  assert.match(bakingPastryProblem(Object.assign({}, pastry, { costAccount: '5040' }), 'ing_cookie'), /5030/, 'a pastry item on the packaging cost account is refused');

  assert.equal(bakingLineProblem(flour, 'ing_flour', 'ing_cookie', 80), '', 'a correctly mapped ingredient passes');
  assert.match(bakingLineProblem({ name: 'Cups', inventoryAccount: '1230', costAccount: '5040', recipeItem: false, active: true }, 'ing_cups', 'ing_cookie', 2), /supply/, 'a supply cannot be an ingredient');
  assert.match(bakingLineProblem(pastry, 'ing_cookie', 'ing_cookie', 30), /own batch card/, 'a pastry item cannot consume itself');
  assert.match(bakingLineProblem(Object.assign({}, flour, { inventoryAccount: '' }), 'ing_flour', 'ing_cookie', 80), /inventory asset account/, 'an unmapped ingredient is refused');
  assert.match(bakingLineProblem(Object.assign({}, flour, { costAccount: '' }), 'ing_flour', 'ing_cookie', 80), /cost account/, 'an ingredient without a cost account is refused');
  assert.match(bakingLineProblem(flour, 'ing_flour', 'ing_cookie', 0), /no cost yet/, 'a zero-cost ingredient is refused, because the batch would be worth nothing');

  assert.equal(bakingMappingFingerprint(pastry, 'ing_cookie'), bakingMappingFingerprint(Object.assign({}, pastry, { name: 'Chewy Choco Chip' }), 'ing_cookie'),
    'renaming an item must never change the confirmation fingerprint');
  assert.notEqual(bakingMappingFingerprint(pastry, 'ing_cookie'), bakingMappingFingerprint(Object.assign({}, pastry, { inventoryAccount: '1210' }), 'ing_cookie'),
    're-mapping the pastry item must invalidate the confirmation');
  assert.notEqual(bakingMappingFingerprint(pastry, 'ing_cookie'), bakingMappingFingerprint(pastry, 'ing_other'),
    'confirming a different pastry item must be a different confirmation');

  /* The baker types the unit they think in; the ledger holds the item's own stock unit. */
  const kg = { name: 'Flour', unit: 'kg', inventoryAccount: '1240', costAccount: '5030', recipeItem: true, active: true };
  const grams = bakingStockQty({ typedQty: 500, typedUnit: 'g' }, kg, 'ing_flour');
  assert.equal(grams.ok, true, 'a compatible recipe unit converts');
  assert.equal(grams.qty, 0.5, '500 g of a kilogram-stocked item is 0.5 kg');
  assert.equal(grams.from, 'g');
  assert.equal(grams.to, 'kg');
  const sameUnit = bakingStockQty({ typedQty: 2.5, typedUnit: 'kg' }, kg, 'ing_flour');
  assert.equal(sameUnit.ok, true, 'the stock unit itself is accepted');
  assert.equal(sameUnit.qty, 2.5, 'a quantity already in the stock unit is unchanged');
  const defaulted = bakingStockQty({ typedQty: 3, typedUnit: '' }, { name: 'Eggs', unit: 'pc', inventoryAccount: '1240', costAccount: '5030', recipeUnit: true, active: true }, 'ing_eggs');
  assert.equal(defaulted.ok, true, 'a line with no unit falls back to the stock unit');
  assert.equal(defaulted.qty, 3, 'pieces stay pieces');
  const mismatched = bakingStockQty({ typedQty: 2, typedUnit: 'pc' }, kg, 'ing_flour');
  assert.equal(mismatched.ok, false, 'a count cannot be converted to a weight');
  assert.match(mismatched.message, /cannot be converted to kg/, 'the refusal names both units');
  const noStockUnit = bakingStockQty({ typedQty: 1, typedUnit: 'g' }, { name: 'Mystery', unit: '', inventoryAccount: '1240', costAccount: '5030' }, 'ing_mystery');
  assert.equal(noStockUnit.ok, false, 'an item with no stock unit refuses the card');
  assert.match(noStockUnit.message, /no stock unit/, 'the refusal says what to fix');
}

/* ── 4. The rendered ingredient row is well-formed ─────────────────────────────────────────────
   A build once lost a closing attribute quote here: the first <option> and the quantity input were
   swallowed into an attribute value, so the ingredient picker appeared to snap back to its first
   item, the recipe-unit picker rendered empty and there was no quantity box. Rendering the real row
   is the only check that catches it. */
{
  const screen = fs.readFileSync('assets/js/admin/baking.js', 'utf8');
  const start = screen.indexOf('function pr(){');
  const end = screen.indexOf('function sumLines', start);
  assert.ok(start >= 0 && end > start, 'the row helpers must exist');
  const items = {
    ing_cup: { name: '12oz Coffee Cup', unit: 'pc', cost: 3.5, stock: 200, inventoryAccount: '1230', costAccount: '5040' },
    ing_flour: { name: 'Flour', unit: 'kg', cost: 80, stock: 12, inventoryAccount: '1240', costAccount: '5030' },
  };
  const rowContext = vm.createContext({
    window: { __accazaBakingProducts: {}, inventoryMap: items },
    S: { inv: null, pid: '' },
    A: () => null,
    esc: (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    peso: (v) => 'PHP' + (Number(v) || 0).toFixed(2),
    r3: (v) => Math.round((Number(v) || 0) * 1000) / 1000,
    CX: () => costing,
    UM: { volume: ['ml', 'l', 'tsp', 'tbsp', 'cup', 'fl oz'], weight: ['mg', 'g', 'kg', 'lb', 'oz wt'], count: ['pc', 'pcs', 'ea', 'each', 'dozen'] },
  });
  vm.runInContext(screen.slice(start, end), rowContext);
  const blank = rowContext.rw({ itemId: '', qty: '', unit: '', i: 0 }, 'bp');
  const chosen = rowContext.rw({ itemId: 'ing_flour', qty: 0.5, unit: 'g', i: 1 }, 'bp');
  for (const [label, html] of [['blank row', blank], ['flour row', chosen]]) {
    assert.equal((html.match(/data-bpi="\d+"/g) || []).length, 3, `${label}: every line attribute must be closed`);
    assert.ok(!html.includes('data-bpi="0 value'), `${label}: an attribute must never swallow the next one`);
    assert.ok(html.includes('>— item —</option>'), `${label}: the ingredient placeholder must survive`);
    assert.ok(/<input[^>]*data-bpf="qty"[^>]*\/>/.test(html), `${label}: the quantity box must render`);
    assert.ok(/<select[^>]*data-bpf="unit"[^>]*>/.test(html), `${label}: the recipe-unit picker must render`);
  }
  assert.ok(/<option value="" selected>/.test(blank), 'a new line must show the placeholder, never a random item');
  assert.ok(/data-bpf="itemId" data-bpi="0"/.test(blank), 'the ingredient picker must carry its row index');
  assert.ok(/value="0.5"/.test(chosen), 'the typed quantity must survive the render');
  assert.ok(/<option value="g" selected>g<\/option>/.test(chosen), 'the typed recipe unit must stay selected');
  assert.ok(/<option value="kg"/.test(chosen), 'the item stock unit must be offered');
  assert.ok(!/<option value="pc"/.test(chosen), 'a count unit must never be offered for a weight item');
  assert.ok(/PHP0\.04/.test(chosen), 'the line cost must use the converted quantity (0.5 g of a PHP80/kg item)');
  /* The post gate. The stored product record does not carry its own key, so the render must attach
     it: without that the form appeared, the preview priced the batch, and Post batch stayed disabled
     with "Add a baking product first." */
  const product = { name: 'Choco Chip Cookie', pastryItemId: 'ing_cup', mapping: { confirmedAt: 1 } };
  const card = { lines: [{ itemId: 'ing_flour', qty: 1 }], pieces: 17 };
  assert.equal(rowContext.blk(Object.assign({ id: 'bp1' }, product), card), '', 'a product carrying its id must pass the post gate');
  assert.match(rowContext.blk(product, card), /Add a baking product first/, 'the raw product record has no id, so the gate must refuse it');
  assert.match(rowContext.blk(Object.assign({ id: 'bp1' }, product, { mapping: null }), card), /Confirm the mapping/, 'an unconfirmed mapping must block');
  assert.match(rowContext.blk(Object.assign({ id: 'bp1' }, product), { lines: [], pieces: 17 }), /at least one ingredient/, 'a card with no used line must block');
  assert.match(rowContext.blk(Object.assign({ id: 'bp1' }, product), { lines: card.lines, pieces: 0 }), /pieces/, 'a card with no pieces must block');
  assert.ok(/function cp\(\)/.test(screen) && /Object\.assign\(\{id:id\},pr\(\)\[id\]\)/.test(screen), 'one helper must attach the product id');
  assert.ok(!/blk\(pr\(\)\[/.test(screen), 'no caller may hand the raw product record to the post gate');
}

/* ── 5. Delayed posting: a short ingredient is accepted and flagged, never blocked ─────────── */
for (const marker of [
  'wentNegative: balanceAfter < 0',
  'provisional: lines.some((line) => line.wentNegative)',
  'negativeLines: lines.filter((line) => line.wentNegative)',
  'A line left at zero is "not used", so it is skipped rather than failing the card',
]) assert.ok(baking.includes(marker), `negative and zero-quantity handling missing: ${marker}`);
assert.ok(!/Not enough remaining stock/.test(baking), 'a batch card must never refuse because ingredient stock is short');
assert.ok(baking.includes('if (!itemId || !qty) continue;'), 'a zero-quantity line must be skipped, not posted');

/* ── 5. Server authority: the browser never supplies a cost, a total or an account ─────────── */
for (const marker of [
  "unitCost: await bakingUnitCost(db, line.itemId, item)",
  "unit: bakingText(line && line.unit, 20)",
  "stockQty: line.stockQty",
  "const stock = bakingStockQty(line, line.item, line.itemId)",
  "qty: qty6(line.stockQty != null ? line.stockQty : line.qty)",
  '`/inventoryAccounting/${itemId}`',
  'const lines = resolved.map((line, index) => {',
  'const value = money(Math.abs(qty6(posted.totalCost)))',
  'const costPerPiece = money(totalCost / pieces)',
  'setCost: true',
  'mapping.fingerprint || ""',
]) assert.ok(baking.includes(marker), `server-derived value missing: ${marker}`);
for (const marker of ['batchCardRequests', "state: \"posting\"", 'state === "done"', 'duplicate: true'])
  assert.ok(baking.includes(marker), `idempotency missing: ${marker}`);
for (const marker of ['post_baking_batch_card', 'reverse_baking_batch_card', 'confirm_baking_mapping'])
  assert.ok(baking.includes(marker), `audit action missing: ${marker}`);
assert.ok(baking.includes('if (card.reversed === true) return { batchId, duplicate: true };'), 'a reversed card must not reverse twice');

/* ── 5b. The client actually wraps the three callables ─────────────────────────────────────────
   assets/js/admin/firebase-client.mjs builds `callables` from an explicit name list. A callable that
   is missing there renders the screen normally and then fails every action with "Refresh the page to
   load the baking service" — which is exactly what happened in production. */
{
  const firebaseClient = read('assets/js/admin/firebase-client.mjs');
  for (const name of ['checkBakingMapping', 'postBatchCard', 'reverseBatchCard']) {
    assert.ok(new RegExp(`['"]${name}['"]`).test(firebaseClient), `the client must register the ${name} callable`);
    assert.ok(new RegExp(`exports\\.${name}\\s*=\\s*onCall\\(`).test(baking), `the server must export ${name}`);
  }
  assert.ok(/callableNames\.unshift\('postBatchCard','reverseBatchCard','checkBakingMapping'\)/.test(firebaseClient),
    'the baking callables must be registered together, with the reason recorded');
}

/* ── 6. Who may post: a dedicated baking permission, never the shared inventory gate ───────── */
assert.ok(/const BAKING_MANAGER_ROLES = \["owner", "superadmin", "admin", "manager"\]/.test(baking), 'baking manager roles missing');
assert.ok(baking.includes('`/adminPerms/${actor.uid}/baking`'), 'the baking permission key must be checked server-side');
assert.ok(portalAccounts.includes('"usage", "baking", "registerOps"'), 'baking must be a portal permission key');
assert.ok(core.includes('recipes:true,usage:true,baking:false'), 'the Admin permission defaults must carry the baking key');
assert.ok(core.includes('"\'baking\'":\'baking\''), 'the Admin tab-to-permission map must carry baking');
assert.ok(staffAccess.includes("{label:'The Art of Baking',key:'baking'}"), 'Staff access must offer The Art of Baking tick');
assert.ok(rules.includes("child('baking').val() === true"), 'the database rules must honour the baking permission');

/* ── 7. Rules: cards are server-written, products are authorised config ───────────────────── */
assert.ok(/"batchCards":\s*\{ "\.indexOn": "ts",[^}]*"\.write": false \}/.test(rules), 'batchCards must be indexed by ts and server-written');
assert.ok(/"bakingProducts":\s*\{ "\.read":[^}]*"\.write":[^}]*child\('baking'\)\.val\(\) === true \|\| root\.child\('adminPerms'\)\.child\(auth\.uid\)\.child\('inventory'\)\.val\(\) === true\)" \}/.test(rules),
  'bakingProducts must be readable and writable by an authorised role, the baking key or inventory');
assert.ok(/"batchCardRequests":\s*\{ "\.read": false, "\.write": false \}/.test(rules), 'the batch request claim must be private to the server');

/* ── 8. The screen is a separate lazy module, so pos.js keeps its byte headroom ───────────── */
assert.ok(loader.includes("baking:'baking.js'"), 'the loader must know the baking module');
assert.ok(loader.includes("baking:['pos','baking']"), 'the baking route must load POS then the module');
assert.ok(loader.includes("baking:'bakingRoot'"), 'the baking root element must be registered');
assert.ok(sharedState.includes("if(name==='baking'&&window.__accazaRenderBaking)window.__accazaRenderBaking()"), 'the POS bundle must dispatch to the baking screen');
assert.ok(sharedState.includes("a.subscribe('bakingProducts'"), 'bakingProducts must be subscribed');
assert.ok(sharedState.includes("a.subscribe('batchCards'"), 'batchCards must be subscribed');
assert.ok(hub.includes('batchCards:{field:\'ts\',limit:250,page:250}'), 'batchCards must be a bounded history path');
assert.ok(hub.includes("baking:['batchCards']"), 'the baking tab may only attach its bounded paths');
assert.ok(hub.includes("bakingProducts:['baking'],batchCards:['baking']"), 'the baking tab must own its two nodes');
assert.ok(hub.includes("'usage','baking','stockvalue'"), 'the baking tab needs the inventory item master for its pickers');
assert.ok(adminHtml.includes("posSwitchTab('baking',this)" ), 'admin.html must carry the Baking tab');
assert.ok(adminHtml.includes('id="tab-baking"'), 'admin.html must carry the Baking tab container');
assert.ok(adminHtml.includes('id="bakingRoot"'), 'admin.html must carry the Baking root');
assert.ok(workspaceSource.includes("posSwitchTab('baking',this)") && workspaceSource.includes('id="bakingRoot"'), 'the Admin workspace source must generate the Baking tab');
const bakingIndex = adminHtml.indexOf("posSwitchTab('baking',this)"), recipesIndex = adminHtml.indexOf("posSwitchTab('recipes',this)"), usageIndex = adminHtml.indexOf("posSwitchTab('usage',this)");
assert.ok(recipesIndex < bakingIndex && bakingIndex < usageIndex, 'Baking must sit between Recipes and Internal Usage');

/* ── 9. Budget: the new module has its own ceiling and is a declared split ─────────────────── */
assert.ok(budgets.includes("'assets/js/admin/baking.js'"), 'baking.js must be a declared split module with a ceiling');
const bakingCeiling = Number((budgets.match(/'assets\/js\/admin\/baking\.js':(\d+)/) || [])[1]);
const bakingBytes = fs.statSync('assets/js/admin/baking.js').size;
assert.ok(bakingCeiling > bakingBytes, `baking.js (${bakingBytes} bytes) must fit its ceiling (${bakingCeiling})`);
assert.ok(bakingBytes >= bakingCeiling * 0.85, 'the baking.js ceiling must stay narrow, close to the reviewed size');
assert.ok(budgets.includes("'assets/js/admin/pos.js':650000"), 'the POS ceiling must be unchanged by this build');
assert.ok(budgets.includes("'assets/js/admin/pos.js':50000"), 'the POS hard reserve must be unchanged by this build');
const posBytes = fs.statSync('assets/js/admin/pos.js').size;
assert.ok(posBytes <= 650000 - 50000, `pos.js (${posBytes}) must stay under its usable limit (600000)`);
assert.ok(posBytes < 541000, `pos.js (${posBytes}) must carry only the baking wiring, not the screen itself`);

/* ── 10. Release bookkeeping ──────────────────────────────────────────────────────────────── */
assert.ok(manifest.builds.admin === 688, 'the admin build must be bumped to 684');
assert.ok(manifest.builds.serviceWorkerCache === 684, 'the service-worker cache must be bumped to 680');
assert.ok(adminHtml.includes('name="accaza-admin-build" content="688"'), 'admin.html must carry the new build');
assert.ok(adminHtml.includes('build&nbsp;v688'), 'the visible admin build label must match');
assert.ok(adminHtml.includes('module-loader.js?v=688'), 'the cache-busted runtime scripts must match the build');
assert.ok(sw.includes("const CACHE='accaza-v684'"), 'the service worker cache name must match the manifest');
assert.ok(sw.includes("/assets/js/admin/baking.js"), 'the Baking module must be precached for the offline POS shell');
assert.ok(manifest.authoritativeFiles.includes('assets/js/admin/baking.js'), 'baking.js must be an authoritative file');
assert.ok(manifest.authoritativeFiles.includes('src/functions/50a-baking.js'), '50a-baking.js must be an authoritative file');
for (const marker of ['"bakingProducts"', '"batchCards"'])
  assert.ok(backupDelta.includes(marker), `backup tracking missing ${marker}`);
assert.ok(registerSettings.includes("'bakingProducts','batchCards'"), 'the admin data export must include the baking nodes');

/* ── 11. End to end: render the screen, press Post batch, inspect the payload ────────────────────
   Every earlier check confirmed that code existed. This one RUNS the whole screen against a fake DOM
   and a stubbed app, so it proves the chain that Danilo actually walks: render → wire → capture →
   gate → payload → callable. It is the check that would have caught "Add a baking product first."
   staring at a form that had already recognised the product. */
{
  const screen = fs.readFileSync('assets/js/admin/baking.js', 'utf8');
  const nodes = {};
  const node = (value, attrs) => ({ value: value == null ? '' : value, attrs: attrs || {}, tagName: (attrs && attrs.tag) || 'INPUT', onclick: null, oninput: null, onchange: null, getAttribute(k) { return this.attrs[k] == null ? '' : this.attrs[k]; } });
  const root = {
    innerHTML: '',
    querySelector(sel) { return (nodes[sel] || [])[0] || null; },
    querySelectorAll(sel) { return nodes[sel] || []; },
  };
  nodes['[data-bkpost]'] = [node('', { tag: 'BUTTON' })];
  nodes['[data-bkpieces]'] = [node('17')];
  nodes['[data-bkdate]'] = [node('2026-10-14')];
  nodes['[data-bkby]'] = [node('Maria')];
  nodes['[data-bknote]'] = [node('')];
  nodes['[data-bkf]'] = [
    node('ing_flour', { 'data-bkfi': '0', 'data-bkf': 'itemId', tag: 'SELECT' }),
    node('g', { 'data-bkfi': '0', 'data-bkf': 'unit', tag: 'SELECT' }),
    node('5', { 'data-bkfi': '0', 'data-bkf': 'qty' }),
  ];
  const posted = [];
  const alerts = [];
  const app = {
    ref: () => ({}), db: {}, update: () => Promise.resolve(), set: () => Promise.resolve(),
    callables: {
      postBatchCard: (payload) => { posted.push(payload); return Promise.resolve({ card: { id: 'BAKE-TEST-1', pieces: 17, totalCost: 149.76, unitCost: 8.81, lines: [] } }); },
      reverseBatchCard: () => Promise.resolve({}),
      checkBakingMapping: () => Promise.resolve({ ok: true, fingerprint: 'v1|...', confirmedAt: 1, confirmedBy: 'Tester' }),
    },
  };
  const win = {
    __accaza: app,
    __posShift: { staff: 'Maria' },
    AccazaDate: { key: () => '2026-10-14' },
    AccazaCosting: costing,
    AccazaFormDialog: { run: () => {} },
    inventoryMap: {
      ing_cookie: { name: 'Choco Chip Cookie', unit: 'pc', cost: 30, stock: 0, inventoryAccount: '1240', costAccount: '5030' },
      ing_flour: { name: 'Flour', unit: 'kg', cost: 80, stock: 12, inventoryAccount: '1240', costAccount: '5030' },
    },
    __accazaBakingProducts: {
      bp1: { name: 'Choco Chip Cookie', emoji: '🥐', order: 1, active: true, pastryItemId: 'ing_cookie', mapping: { confirmedAt: 1, confirmedBy: 'Tester', fingerprint: 'x' }, template: [{ itemId: 'ing_flour', qty: 5, unit: 'g' }] },
    },
    __accazaBatchCards: {},
  };
  win.window = win;
  const screenContext = vm.createContext({
    window: win, document: { getElementById: (id) => (id === 'bakingRoot' ? root : null), querySelector: () => null },
    console, alert: (m) => alerts.push(String(m)), confirm: () => false, setTimeout, Date, Math, JSON, Object, Array, String, Number, Promise, Intl, RegExp, Error,
  });
  vm.runInContext(`(function(){${screen.slice(screen.indexOf('(function(){') + 12, screen.lastIndexOf('})();'))}})();`, screenContext);
  assert.equal(typeof win.__accazaRenderBaking, 'function', 'the screen must expose its render hook');
  win.__accazaRenderBaking();
  assert.ok(root.innerHTML.includes('New batch card'), 'the card form must render once the mapping is confirmed');
  assert.ok(!/Add a baking product first/.test(root.innerHTML), 'the form must never claim the product is missing');
  assert.ok(/Enter the pieces produced/.test(root.innerHTML), 'before pieces are typed the gate must ask for the pieces, not for a product');
  const post = nodes['[data-bkpost]'][0];
  assert.equal(typeof post.onclick, 'function', 'Post batch must be wired');
  post.onclick();
  assert.equal(alerts.filter((m) => /Add a baking product first/.test(m)).length, 0, 'Post batch must never claim the product is missing when one is selected');
  assert.equal(posted.length, 1, 'Post batch must reach the callable');
  assert.equal(posted[0].productId, 'bp1', 'the payload must carry the product id');
  assert.equal(posted[0].pieces, 17, 'the payload must carry the typed pieces');
  assert.equal(JSON.stringify(posted[0].lines), JSON.stringify([{ itemId: 'ing_flour', qty: 5, unit: 'g' }]), 'the payload must carry the used lines with their typed unit');
  assert.equal(posted[0].bakedBy, 'Maria', 'the payload must carry who baked');
}


console.log('PASS: baking batch cards enforce item mapping, allow delayed posting, stay server-authoritative and fit the bundle budget.');
