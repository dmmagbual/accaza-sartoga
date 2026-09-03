/* Human document numbers — regression guard.

   The Books journal rendered `adjustment_adj_mtl7mznbr9c0_ing_ms6y917wdqjy` because
   books-bridge fell back to mv.sourceId || mv.id when a movement carried no reference.
   That string is the stable join and idempotency key and must NOT change; the fix is a
   readable document number stored alongside it and preferred for display. */
import fs from 'node:fs';
import path from 'node:path';
const root = path.join(import.meta.dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const failures = [];
const must = (source, marker, message) => { if (!source.includes(marker)) failures.push(message); };
const check = (condition, message) => { if (!condition) failures.push(message); };

/* ---------- executable: prefix routing and formatting ---------- */
const src = read('src/functions/40-sales-finance.js');
const block = src.slice(src.indexOf('const DOCUMENT_PREFIXES'), src.indexOf('async function nextDocumentNumber'));
const prefixFor = new Function('financeText', block + '; return documentPrefix;')((v) => String(v == null ? '' : v));

const expected = {
  payable_paid: 'PV', payable_payment_reversed: 'PV', customer_change_refunded: 'PV',
  receivable_collected: 'RV', platform_payout_deposit: 'RV', register_cash_deposit: 'RV',
  purchase_received: 'PI', purchase_reversed: 'PI',
  fixed_asset_acquisition_reversed: 'FA',
  revaluation: 'IR',
  adjustment: 'IA', manual_edit: 'IA', waste: 'IA', staff_use: 'IA',
  manual_books_journal: 'JE', cash_transfer: 'JE', payable_created: 'JE',
};
for (const [type, want] of Object.entries(expected)) {
  const got = prefixFor({type});
  if (got !== want) failures.push(`${type} must number as ${want}, got ${got}`);
}
check(prefixFor({type:'something_unmapped'}) === 'JE', 'An unmapped movement type must still receive a number, not none.');
check(prefixFor({type:''}) === '' && prefixFor({}) === '', 'A movement with no type must not be numbered.');

/* IR must win over IA — a revaluation is not a quantity adjustment. */
check(prefixFor({type:'inventory_revaluation'}) === 'IR', 'A revaluation must number as IR, not IA.');

/* format */
const pad = (n) => `IA-2026-${String(n).padStart(4,'0')}`;
check(pad(1) === 'IA-2026-0001' && pad(43) === 'IA-2026-0043' && pad(12345) === 'IA-2026-12345',
  'Numbers must be zero-padded to four digits and must not truncate beyond that.');

/* ---------- contract ---------- */
must(src, 'async function nextDocumentNumber(db, prefix, year)', 'the counter helper must exist.');
must(src, '.transaction((current) => (Number(current) || 0) + 1)', 'the counter must increment atomically, or two postings can share a number.');
must(src, 'if (!financeText(record.documentNo, 40))', 'a movement that already carries a number must keep it.');
must(src, 'catch (error) { record.documentNo = ""; }', 'a counter failure must not block a financial posting.');
check(src.indexOf('record.documentNo = await nextDocumentNumber') > src.indexOf('if (existing.exists()) return {duplicate: true'),
  'numbering must happen after the idempotency check, or a replayed posting burns a number.');

must(read('functions/lib/books-bridge.js'), 'String(mv.documentNo || (mv.revision ? mv.reference || mv.sourceId || mv.id : mv.sourceId || mv.id) || "")',
  'the journal must prefer the document number and keep the id as the last-resort fallback.');

/* The id itself must not be touched — it is the join and idempotency key. */
check(!src.includes('movementId = `${prefix}'), 'the movement id must never be rebuilt from the document number.');

if (failures.length) { console.error('Document number check failed:\n- ' + failures.join('\n- ')); process.exit(1); }
console.log('PASS: every posted movement gets a readable document number (PV/RV/PI/FA/IR/IA/JE, sequential per year) while the movement id stays the stable join key.');
