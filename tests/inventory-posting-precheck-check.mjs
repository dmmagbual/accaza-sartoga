/* Inventory posting pre-check — regression guard (21 Oct 2026).
   A stock movement that posts to Finance Books (waste, adjustment, manual edit, internal usage, revaluation,
   batch card) must be refused BEFORE stock moves when its offset account is invalid or its month is closed.
   These checks used to run only inside the posting step after the stock transaction, so a refused waste
   left stock changed with no journal, and every retry failed the same way (reproduced in UAT). */
import fs from 'node:fs';
const source = fs.readFileSync('src/functions/50-inventory.js', 'utf8'), bundle = fs.readFileSync('functions/index.js', 'utf8');
const failures = [];
const start = source.indexOf('async function applyInventoryMovement('), body = source.slice(start);
const precheck = body.indexOf('if (INVENTORY_BOOK_POSTING_TYPES.has(type)) {\n    inventoryAdjustmentOffset(type, {offsetAccount: String(raw.offsetAccount || "").slice(0, 4)');
const period = body.indexOf('await assertAccountingPeriodOpen(db, Number(raw.occurredAt || now)');
const transaction = body.indexOf('await accountingRef.transaction(');
if (start < 0 || precheck < 0) failures.push('applyInventoryMovement must validate the Finance offset account before stock moves.');
if (period < 0) failures.push('applyInventoryMovement must refuse a closed month before stock moves.');
if (!(precheck < transaction && period < transaction)) failures.push('Both pre-checks must run before the inventory transaction.');
if (!body.includes('offsetAccount:String(raw.offsetAccount||"").slice(0,4),adjustmentNature:String(raw.adjustmentNature||"").slice(0,80)')) failures.push('The pre-check must validate the same values the stored movement keeps.');
if (!bundle.includes('inventoryAdjustmentOffset(type, {offsetAccount: String(raw.offsetAccount || "").slice(0, 4)')) failures.push('functions/index.js must be rebuilt with the pre-check.');
if (failures.length) { console.error('Inventory posting pre-check failed:\n- ' + failures.join('\n- ')); process.exit(1); }
console.log('PASS: a stock movement that posts to Finance Books is refused before stock moves when its offset account is invalid or its month is closed.');
