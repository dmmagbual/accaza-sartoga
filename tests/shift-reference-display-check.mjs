// Staff and managers quote the server-issued shift reference (e.g. SH-ALEX-1A2B3C). The
// shifts/<id> database key (SH-<6 digits>-<6 hex>) is internal and must never be shown:
// on 3 Nov 2026 the handover window listed a shift by its key while the Z report used the
// reference, so one shift appeared under two numbers.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const walk = (dir) => fs.readdirSync(dir, {withFileTypes: true}).flatMap((e) => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
const files = [...walk(path.join(root, 'src/admin')).filter((f) => f.endsWith('.js')), path.join(root, 'assets/js/admin/daily-report-output.mjs')];

// Rendering patterns that put a raw shift key on screen.
const banned = [
  [/esc\(\s*[\w.]*\bshiftId\s*\)/g, 'renders a raw shiftId'],
  [/esc\(\s*[\w.]*\bshiftId\s*\|\|/g, 'falls back to a raw shiftId'],
  [/shiftReference\s*\|\|\s*\w+\.id\b/g, 'falls back from shiftReference to the shift key'],
];
// A key inside a data-* attribute is an internal handle for a button, not visible text.
const inDataAttribute = (line, at) => /data-[\w-]+="'\+\s*$/.test(line.slice(Math.max(0, at - 60), at));
const hits = [];
for (const file of files) {
  fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    for (const [re, why] of banned) for (const m of line.matchAll(re)) if (!inDataAttribute(line, m.index)) hits.push(`${path.relative(root, file)}:${i + 1} ${why}`);
  });
}
assert.deepEqual(hits, [], `Show the shift reference, not the shifts/<id> key:\n${hits.join('\n')}`);

// The Cash Flow custody label shows references, keeps non-shift labels, and hides bare keys.
const ledger = fs.readFileSync(path.join(root, 'src/admin/finance/00-bootstrap-ledger.js'), 'utf8');
const fn = ledger.match(/function custodyReferenceLabel\(x\)\{.*\}\n/);
assert.ok(fn, 'custodyReferenceLabel is defined in the finance ledger bootstrap');
const ctx = {}; vm.createContext(ctx); vm.runInContext(fn[0], ctx);
assert.equal(ctx.custodyReferenceLabel({shiftId: 'SH-566003-61b3d7', shiftReference: 'SH-ALEX-61B3D7'}), 'SH-ALEX-61B3D7');
assert.equal(ctx.custodyReferenceLabel({shiftId: 'SH-566003-61b3d7'}), 'Shift reference pending');
assert.equal(ctx.custodyReferenceLabel({id: 'opening_2026', shiftId: 'opening_2026', reference: 'OB-2026'}), 'OB-2026');
assert.equal(ctx.custodyReferenceLabel({id: 'journal_recovery_1', shiftId: 'journal_recovery_1'}), 'journal_recovery_1');

// The handover window labels rows by reference and never by key.
const handover = fs.readFileSync(path.join(root, 'src/admin/register/79-shift-handover.js'), 'utf8');
assert.ok((handover.match(/refLabel\((r|f)\)/g) || []).length >= 3, 'pending rows, follow-ups and the detail view use the reference label');

console.log(`PASS: ${files.length} admin sources show the shift reference, never the shifts/<id> key`);
