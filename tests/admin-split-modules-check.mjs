import assert from 'node:assert/strict';
import fs from 'node:fs';

// Oct 2026: Accaza AI's manager tools and Baking's printable card were split into their own files.
// Each file is evaluated here in this realm, as the browser does: a vm context silently accepts a
// strict-mode assignment to an undeclared name (the admin 691 System Health outage), this does not.
const read = rel => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const run = (source, window, document) => new Function('window', 'document', 'sessionStorage', source)(window, document, {getItem: () => null, setItem() {}});

{
  const window = {}, document = {addEventListener() {}, getElementById: () => null};
  run(read('assets/js/admin/accaza-ai.js'), window, document);
  run(read('assets/js/admin/accaza-ai-manager.js'), window, document);
  const core = window.__accazaAiCore, manager = window.__accazaAiManager;
  assert.ok(core && ['by', 'add', 'setMode', 'chat', 'mode'].every(k => typeof core[k] === 'function'), 'accaza-ai.js must expose the core helpers the manager tools use');
  assert.equal(core.mode(), 'accaza');
  assert.ok(manager && typeof manager.section === 'function' && typeof manager.wire === 'function', 'accaza-ai-manager.js must register the manager tools');
  const section = manager.section();
  for (const id of ['accazaManual', 'accazaManualChapter', 'accazaManualSeed', 'accazaManualTitle', 'accazaManualContent', 'accazaManualStatus', 'accazaManualState', 'accazaManualSave'])
    assert.ok(section.includes(`id="${id}"`), `the Operations Manual section must keep #${id}`);
  assert.equal((section.match(/<option value="/g) || []).length, 11 + 2, 'every manual chapter and both publication states must be offered');
}
{
  const window = {}, document = {getElementById: () => null};
  run(read('assets/js/admin/baking.js'), window, document);
  run(read('assets/js/admin/baking-print.js'), window, document);
  assert.equal(typeof window.__accazaRenderBaking, 'function', 'baking.js must load and register its renderer');
  assert.equal(typeof window.__accazaBakingPrint, 'function', 'baking-print.js must register the printable batch card');
  let html = '';
  const popup = {document: {write: s => { html += s; }, close() {}}};
  const card = {id: 'BC_1', productName: 'Choco Cookie', pastryItemName: 'Choco Cookie', date: '2026-10-15', bakedBy: 'Ana', postedBy: 'Owner', pieces: 24, totalCost: 105, unitCost: 4.375, lines: [{itemName: 'Flour', qty: 500, unit: 'g', unitCost: 0.05, value: 25}], reversed: true, reversedBy: 'Owner'};
  const helpers = {esc: v => String(v ?? ''), peso: v => 'P' + Number(v || 0).toFixed(2), r3: v => Math.round(Number(v || 0) * 1e3) / 1e3, st: v => (v ? 'when' : ''), acc: () => ['1240', '1240']};
  window.__accazaBakingPrint(popup, card, helpers);
  for (const part of ['Baking Batch Card', 'Flour', 'Total batch cost', 'P105.00', 'Cost per piece', 'P4.38', 'Debit 1240', 'Credit 1240', 'REVERSED'])
    assert.ok(html.includes(part), `the printed batch card must show ${part}`);
  const baking = read('assets/js/admin/baking.js');
  assert.ok(baking.indexOf("window.open('','_blank'") < baking.indexOf('PR(function(f)'), 'the print pop-up must open inside the click, before the print module loads');
}
console.log('PASS: the split Accaza AI manager tools and Baking print card load in strict mode and keep every field, chapter and printed amount.');
