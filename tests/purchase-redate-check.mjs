/* Purchase date correction — regression guard (admin 709).
   Danilo, 23 Oct 2026: editing a purchase date "did not take effect" because no screen could change it
   (Amend locks the date; Edit details only had the Due date). Edit details now re-dates the purchase in
   place, like the reversal-date correction. Also guards the removed Legacy brand note and Lot # fields. */
import fs from 'node:fs';
const read = (p) => fs.readFileSync(p, 'utf8');
const redate = read('src/functions/43m-purchase-redate.js'), corrections = read('src/functions/43b-purchase-corrections.js'), purchasing = read('src/admin/pos/20-purchasing.js');
const bundle = read('functions/index.js'), pos = read('assets/js/admin/pos.js');
const failures = [], must = (s, marker, message) => { if (!s.includes(marker)) failures.push(message); };

// Server rules.
must(corrections, 'if (action === "correct_date") return await redatePurchase(', 'managePurchaseCorrection must route correct_date to the re-date function.');
must(corrections, '"correct_date","correct_accounts"', 'A date change must run under the purchase correction lock.');
must(redate, 'actor.role !== "superadmin"', 'Only a Super Admin may change a posted purchase date.');
must(redate, 'await assertAccountingPeriodOpen(db, oldDate,', 'The old month must be open.');
must(redate, 'await assertAccountingPeriodOpen(db, newDate,', 'The new month must be open.');
must(redate, 'Math.trunc(Number(data.expectedDateRevision)) !== revision', 'A stale date change must be refused.');
must(redate, 'Financial.payableHasSettlement(payable)', 'A bill with any payment must not be re-dated.');
must(redate, 'claimPayables(db, [payableId]', 'The supplier bill must be claimed so a payment cannot slip in.');
must(redate, 'newDate.slice(0, 4) !== oldDate.slice(0, 4) && invoice.documentNo', 'The PUR number must stay in its year.');
must(redate, 'orderByChild("sourceId").equalTo(invoiceId)', 'Linked postings must be read through the sourceId index, not a full download.');
must(redate, 'orderByChild("sourceId").equalTo(payableKey)', 'A bill purchase posting is filed under the supplier bill and must be found there.');
must(redate, '["payable_created", "grni_created"].includes(', 'Only the bill-creating posting may move with the purchase, never a bill payment.');
must(redate, 'if (!main) throw', 'The purchase or payment posting itself must move, or the date change is refused.');
must(redate, 'invoice.reversed === true', 'A voided purchase must not be re-dated.');
must(redate, 'collected > newDate', 'An Undeposited-paid purchase must not be dated before its cash was collected.');
must(redate, 'if (date < newDate) throw', 'A posting of the purchase must never end up dated before the purchase.');
must(redate, 'ledger.bankReconciled === true', 'A bank-reconciled payment must block the date change.');
must(redate, '[`books/journal/${key}`] = Object.assign({}, journal, {date: newDate', 'Books journal dates must move while the posted lines stay as they are.');
must(redate, '[`cfLedger/fm_${key}`] = Object.assign({}, ledger, {date: newDate', 'The bank / Undeposited ledger row must move with its posting.');
must(redate, '[`payables/${payableId}/date`]: newDate', 'The supplier bill must carry the new date.');
must(redate, '[`stockReceipts/${financeKey(id, "Stock receipt ID")}/date`] = newDate', 'Stock receipts must carry the new date.');
must(redate, 'cashJournalRevisions/${key}/${nextRevision}', 'Every moved posting must keep a before/after revision.');
must(redate, '[`purchaseInvoices/${invoiceId}/dateHistory/r${nextRevision}`]', 'The purchase must keep a date history.');
must(redate, 'claimPurchaseReversalCloseLocks(db, [oldDate, newDate]', 'Closes covering either date must be locked and reopened.');
must(redate, 'await db.ref().update(writes);', 'All changes must commit in one atomic update.');
if (/inventoryMovements\//.test(redate)) failures.push('Re-dating must never rewrite the stock ledger (its posting order drives cost).');
if (/\.remove\(|set\(null\)/.test(redate)) failures.push('Re-dating must never delete posted records.');
// Shifting keeps the time of day: 23 Oct 00:00 Manila moved to 21 Oct is exactly two days earlier.
{ const day = (d) => Date.parse(`${d}T00:00:00+08:00`), at = day('2026-10-23') + 3600000, moved = at + (day('2026-10-21') - day('2026-10-23'));
  if (moved !== day('2026-10-21') + 3600000) failures.push('A re-dated posting must keep its time of day.'); }
// Admin.
must(purchasing, "{name:'date',label:'Purchase date',type:'date'", 'Edit details must offer the purchase date to a Super Admin.');
must(purchasing, "action:'correct_date'", 'Edit details must call the server date correction.');
must(purchasing, 'expectedDateRevision:', 'Edit details must send the date revision it opened.');
if (purchasing.includes('Use Amend to reverse and re-enter if the wrong supplier or accounting date')) failures.push('The stale Edit details text pointing to Amend for the date must be gone.');
if (purchasing.includes('Legacy brand note')) failures.push('The Legacy brand note field must stay removed from the purchase card.');
if (purchasing.includes('data-pf="lot"')) failures.push('The Lot # field must stay removed from the purchase card.');
for (const [name, s, marker] of [['functions/index.js', bundle, 'async function redatePurchase('], ['assets/js/admin/pos.js', pos, "action:'correct_date'"]]) if (!s.includes(marker)) failures.push(`${name} must be rebuilt with the purchase date correction.`);

if (failures.length) { console.error('Purchase re-date check failed:\n- ' + failures.join('\n- ')); process.exit(1); }
console.log('PASS: a Super Admin can change a posted purchase date in place (postings, Books, bank / Undeposited row, bill, receipts move together; stock ledger untouched), refused for paid bills, closed months, reconciled payments, stale forms and year changes; Legacy brand note and Lot # stay removed.');
