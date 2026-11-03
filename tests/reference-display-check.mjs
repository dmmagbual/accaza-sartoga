// One reference per document, app wide (3 Nov 2026, Danilo). Staff quote business references
// (POS-/GF- orders, SH-<NAME>- shifts, PUR-, PV-, journal numbers, bill numbers). Database keys,
// movement IDs and entry IDs are internal and never shown on a screen, print, export or message.
// On 3 Nov the handover window showed a shift by its key while the Z report used its reference.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const walk = (dir) => fs.readdirSync(dir, {withFileTypes: true}).flatMap((e) => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
const files = [
  ...walk(path.join(root, 'src/admin')), ...walk(path.join(root, 'src/books')),
  ...fs.readdirSync(path.join(root, 'assets/js/admin')).filter((f) => f.endsWith('.mjs')).map((f) => path.join(root, 'assets/js/admin', f)),
].filter((f) => /\.m?js$/.test(f));

const KEY_FIELDS = '(?:shiftId|sourceId|movementId|payableId|invoiceId|purchaseInvoiceId|custodyId|rootId|transactionId|clientTxnId|depositMovementId|correctsMovementId|reversalOf)';
const banned = [
  [new RegExp(`esc\\(\\s*[\\w.]*\\b${KEY_FIELDS}\\s*\\)`, 'g'), 'renders a raw key field'],
  [new RegExp(`esc\\(\\s*[\\w.]*\\b${KEY_FIELDS}\\s*\\|\\|`, 'g'), 'falls back to a raw key field'],
  [new RegExp(`['"\`]\\s*\\+\\s*[\\w.]*\\b${KEY_FIELDS}\\s*[+:)]`, 'g'), 'concatenates a raw key field into text'],
  [/shiftReference\s*\|\|\s*\w+\.id\b/g, 'falls back from shiftReference to the shift key'],
  [/esc\([^()]{0,80}\|\|\s*(?:[a-z]\w*\.)?id\s*\)/g, 'falls back to a database id'],
  [/(?:ref|reference|documentNo|Ref\([^()]*\))\s*\|\|\s*(?:[a-z]\w*\.)?id\s*\)/gi, 'falls back from a reference to a database id'],
  [/(?:Entry ID|Movement ID|Payout ID|Source movement|Linked payable)/g, 'labels an internal ID'],
  // Variables that hold shifts, journals, movements, bills and payouts (orders use o/order: their ID is the reference).
  [/esc\(\s*(?:shift|activeShift|e|m|mv|movement|entry|original|p|d)\.id\s*\)/g, 'renders a document key'],
];
const financeOnly = [[/esc\(\s*x\.id\s*\)/g, 'renders a document key']];
// A key inside an attribute or a handler argument is an internal handle, not visible text.
// So is a key used to build a database path or another key ('shifts/'+id, 'rcpt_'+id+'_'+n),
// and anything inside a code comment.
const internalUse = (line, at) => {
  const before = line.slice(Math.max(0, at - 70), at);
  if (/localeCompare\(String\($/.test(before) || /String\([a-z]\.$/.test(before)) return true;
  if (/\/\*|^\s*\/\//.test(line.slice(0, at))) return true;
  if (/['"][\w/-]*(?:\/|_|PENDING-)(?:['"]\s*\+\s*)?$/.test(before)) return true;
  return /(data-[\w-]+|value|id|for|name|href)=\\?["']?\$?\{?\s*'?\s*\+?\s*$/.test(before) || /\((?:\\'|&#39;|')'?\s*\+?\s*$/.test(before) || /\(\s*'\$\{\s*$/.test(before);
};
// Fallbacks to a non-document id (a menu category, a cash account, a staff member, an allocation
// definition) or an order number (an order's ID is its reference) are allowed.
const allowed = /(?:\.name|\.label|\.email|platformRef|meta\.name)\s*\|\|\s*(?:[a-z]\w*\.)?id\s*\)|esc\(o\.id\|\|e\.key\)|\|\|\s*o\.id\)/;
const hits = [];
for (const file of files) {
  fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    const rules = /[\\/](?:books|finance)[\\/]/.test(file) ? banned.concat(financeOnly) : banned;
    for (const [re, why] of rules) for (const m of line.matchAll(re)) {
      if (internalUse(line, m.index) || allowed.test(m[0])) continue;
      hits.push(`${path.relative(root, file)}:${i + 1} ${why}: ${m[0].slice(0, 70)}`);
    }
  });
}
assert.deepEqual(hits, [], `Show the business reference (AccazaRef), not an internal key:\n${hits.join('\n')}`);

// Pages load the shared helper before the code that labels with it.
const runtime = fs.readFileSync(path.join(root, 'src/html/admin/70-runtime.html'), 'utf8'), books = fs.readFileSync(path.join(root, 'books.html'), 'utf8'), sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
assert.ok(runtime.includes('assets/js/shared/references.js'), 'admin loads the reference helper');
assert.ok(runtime.indexOf('assets/js/shared/references.js') < runtime.indexOf('assets/js/admin/core.mjs'), 'admin loads the helper before its modules');
assert.ok(books.indexOf('assets/js/shared/references.js') > -1 && books.indexOf('assets/js/shared/references.js') < books.indexOf('src/books/csv-exports.js'), 'Finance Books loads the helper before its exports and pages');
assert.ok(sw.includes("'/assets/js/shared/references.js'"), 'the service worker caches the helper for offline use');

// The Cash Flow custody label shows references, keeps non-shift labels, and hides bare keys.
const ledger = fs.readFileSync(path.join(root, 'src/admin/finance/00-bootstrap-ledger.js'), 'utf8');
const fn = ledger.match(/function custodyReferenceLabel\(x\)\{.*\}\n/);
assert.ok(fn, 'custodyReferenceLabel is defined in the finance ledger bootstrap');
const ctx = {}; vm.createContext(ctx); vm.runInContext(fn[0], ctx);
assert.equal(ctx.custodyReferenceLabel({shiftId: 'SH-566003-61b3d7', shiftReference: 'SH-ALEX-61B3D7'}), 'SH-ALEX-61B3D7');
assert.equal(ctx.custodyReferenceLabel({shiftId: 'SH-566003-61b3d7'}), 'Shift reference pending');

// The handover window labels rows by reference and never by key.
const handover = fs.readFileSync(path.join(root, 'src/admin/register/79-shift-handover.js'), 'utf8');
assert.ok((handover.match(/refLabel\((r|f)\)/g) || []).length >= 3, 'pending rows, follow-ups and the detail view use the reference label');

console.log(`PASS: ${files.length} admin, POS and Finance Books sources show business references, never internal keys`);
