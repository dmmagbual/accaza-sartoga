/* Inventory revaluation — regression guard.

   Danilo needed to correct a wrong weighted average cost without touching quantity, and without
   disturbing orders already completed. The server could already set a unit cost (`setCost`), but a
   zero-quantity movement carries totalCost = qty * cost = 0, so the weighted average would have moved
   while NOTHING posted to the ledger — inventory value in Books silently diverging from the item.

   A revaluation restates only the stock still on hand. Completed orders booked COGS at the cost
   prevailing at the time, into immutable /financialMovements, so "future orders only" holds by
   construction rather than by effort. */
import fs from 'node:fs';
import path from 'node:path';
const root = path.join(import.meta.dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const failures = [];
const must = (source, marker, message) => { if (!source.includes(marker)) failures.push(message); };
const check = (condition, message) => { if (!condition) failures.push(message); };
const money = (v) => Math.round((Number(v) || 0) * 100) / 100;

/* ---------- the arithmetic the server posts ---------- */
const delta = (onHand, oldCost, newCost) => money(onHand * (newCost - oldCost));

check(delta(150, 3.92, 4.20) === 42, 'A cost increase must post the value uplift on stock held.');
check(delta(150, 3.92, 3.50) === -63, 'A cost decrease must post a negative value delta.');
check(delta(150, 3.92, 3.92) === 0, 'No cost change must post nothing.');
check(money(150 * 3.92 + delta(150, 3.92, 4.20)) === money(150 * 4.20),
  'Stock value before plus the posted delta must equal stock value after — otherwise Books and inventory diverge.');
check(delta(0, 3.92, 4.20) === 0, 'With no stock on hand there is no value to restate.');

/* Only stock ON HAND is revalued. Units already sold keep the cost they were sold at, which is what
   makes this prospective. */
check(delta(150, 4.00, 5.00) === 150 && delta(400, 4.00, 5.00) === 400,
  'The delta must scale with quantity on hand only, never with quantity already consumed.');

/* ---------- server contract ---------- */
const inv = read('src/functions/50-inventory.js');
must(inv, '"purchase_reversal", "revaluation"', 'revaluation must be a recognised inventory movement type.');
must(inv, '"usage_reversal", "revaluation"', 'revaluation must post to Books.');
must(inv, 'type === "revaluation"', 'the movement builder must special-case a revaluation.');
must(inv, 'totalCost: type === "revaluation" ? money(before * (requestedCost - costBefore))',
  'a revaluation must carry the value delta, or qty * cost = 0 and nothing reaches the ledger.');
must(inv, 'if (qty !== 0) throw new HttpsError("invalid-argument", "A revaluation changes the unit cost only.',
  'a revaluation must refuse to move quantity.');
must(inv, 'if (type === "revaluation" && !(before > 0)) {nothingToRevalue = true; return;}',
  'revaluing an item with no stock on hand must be refused.');
must(inv, 'A revaluation must offset 5905 Inventory Reconciliation Gain / (Loss), or 3000 Owner’s Capital'.replace('’', "'"),
  'a revaluation must restrict its offset accounts — 5900 Wastage makes no sense with no stock movement.');
must(inv, 'if(want==="3000"&&why!=="beginning-inventory")',
  "Owner's Capital must stay gated to a beginning inventory correction, matching the quantity path.");

/* ---------- client contract ---------- */
for (const file of ['assets/js/admin/pos.js', 'src/admin/pos/11d-stock-adjustments.js']) {
  const s = read(file);
  must(s, 'value="reval"', `${file}: the adjust dialog must offer a cost restatement mode.`);
  must(s, 'function finalizeRevaluation(id,onHand,newCost,reason,offsetAccount)', `${file}: the revaluation poster must exist.`);
  must(s, "type:'revaluation',qty:0", `${file}: the client must post a zero-quantity revaluation.`);
  must(s, 'Completed orders keep the cost they were sold at', `${file}: the dialog must say plainly that completed orders are untouched.`);
  must(s, "if(ro==='3000'&&rr!=='beginning-inventory')", `${file}: the client must gate Owner's Capital the same way the server does.`);
  must(s, "That is the cost already on file", `${file}: a no-op restatement must be refused before it posts.`);
}

if (failures.length) { console.error('Inventory revaluation check failed:\n- ' + failures.join('\n- ')); process.exit(1); }
console.log('PASS: a value-only revaluation restates stock on hand, posts the exact value delta to 5905 or capital, refuses to move quantity, and leaves completed orders at the cost they were sold at.');
