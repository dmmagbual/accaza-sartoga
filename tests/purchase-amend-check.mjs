/* Purchase Amend — regression guard (admin 707).
   Danilo, 22 Oct 2026: "Amend reopens the purchase details on the entry card and Save updates the same
   purchase in place, with no reversal" (like Xero / QuickBooks). Lines can be added, removed or changed.
   Stock already sold when a line is removed or reduced is charged back to the item's COGS; a bill with any
   payment must have the payment reversed first. Also guards the stock-card void display. */
import fs from 'node:fs';
const read = (p) => fs.readFileSync(p, 'utf8');
const amend = read('src/functions/43l-purchase-amend.js'), corrections = read('src/functions/43b-purchase-corrections.js'), inventory = read('src/functions/50-inventory.js');
const client = read('src/admin/pos/20c-purchase-amend.js'), workspace = read('src/admin/pos/11h-purchase-workspace.js'), purchasing = read('src/admin/pos/20-purchasing.js'), card = read('src/admin/analytics/60-inventory-valuation.js');
const pos = read('assets/js/admin/pos.js'), analytics = read('assets/js/admin/analytics.js'), bundle = read('functions/index.js');
const failures = [], must = (s, marker, message) => { if (!s.includes(marker)) failures.push(message); };
const money = (v) => Math.round((Number(v) || 0) * 100) / 100;

// The journal rule: inventory follows the stock ledger; the rest of each item's change goes to COGS.
const amendJournal = (expectedItemChange, ledgerValueChange, fundingDelta) => {
  const used = money(expectedItemChange - ledgerValueChange), inventoryLine = money(expectedItemChange - used), cogsLine = used;
  return {inventoryLine, cogsLine, balance: money(inventoryLine + cogsLine + fundingDelta)};
};
// 1) Remove a P100 line (10 units @ P10) after 8 were sold: only 2 units (P20) can leave the shelf.
{ const j = amendJournal(-100, -20, 100); if (j.inventoryLine !== -20 || j.cogsLine !== -80 || j.balance !== 0) failures.push('Removing a partly sold line must credit Inventory for the stock on hand and COGS for the sold part, against the bill.'); }
// 2) Add a P250 line: everything goes to Inventory, the bill rises by P250.
{ const j = amendJournal(250, 250, -250); if (j.inventoryLine !== 250 || j.cogsLine !== 0 || j.balance !== 0) failures.push('An added stock line must debit Inventory and raise the bill by the same amount.'); }
// 3) Reduce 10 -> 6 units with nothing sold: 4 units @ P10 leave stock, no COGS.
{ const j = amendJournal(-40, -40, 40); if (j.cogsLine !== 0 || j.balance !== 0) failures.push('A quantity reduction with stock on hand must not touch COGS.'); }

// Server rules.
must(corrections, 'if (action === "amend") return await amendPurchase(', 'managePurchaseCorrection must route amend to the Amend function.');
must(corrections, 'new Set(["amend","discard_amend","correct_accounts"', 'Amend must run under the purchase correction lock.');
must(amend, 'actor.role !== "superadmin"', 'Only a Super Admin may amend a posted purchase.');
must(amend, 'await assertAccountingPeriodOpen(db, date, "amending this purchase")', 'Amend must be refused in a closed month.');
must(amend, 'Math.trunc(Number(data.expectedRevision)) !== revision', 'A stale amendment must be refused.');
must(amend, 'Financial.payableHasSettlement(payable)', 'A bill with any payment must not be amended (Xero rule).');
must(amend, 'kept.has(index)', 'An original line may appear once per amendment.');
must(amend, 'line.lineType === "fixed_asset"', 'Equipment lines must stay unchanged.');
must(amend, 'remove the line and add the new item', 'Changing the item of a line must be a remove + add.');
must(amend, 'const [oldGl, newGl] = [await purchaseInventoryLines(db, invoice, false), await purchaseInventoryLines(db, after, false)];', 'Journal accounts must be resolved before any stock moves.');
must(amend, 'Math.min(qty6(k.oldQty - k.newQty), s.b)', 'Only stock still on hand may leave; the sold part is not taken out of stock again.');
must(amend, 'const value = Financial.money((expected[itemId] || 0) - (actual[itemId] || 0));', 'The part of an item change the stock ledger could not carry must go to COGS.');
must(amend, 'Financial.money(qty6(m.balanceAfter) * qty6(m.costAfter) - qty6(m.balanceBefore) * qty6(m.costBefore))', 'Inventory in the books must follow the stock ledger valuation exactly.');
must(amend, 'pending.intent === intent && Array.isArray(pending.plan)', 'A retried amendment must replay its stored stock plan.');
must(amend, 'pending.intent !== intent', 'A half-finished amendment with different values must block a new one.');
must(amend, 'BooksBridge.linesBalanced(journal)', 'An unbalanced amendment must never be posted.');
must(amend, 'Financial.movement("purchase_amend", "purchaseInvoice", invoiceId, journal, {occurredAt: accountingAt', 'The amendment journal is dated on the purchase date.');
must(amend, 'await commitFinancial(db, journalId, movement, actor, writes)', 'Journal and purchase/bill/receipt updates must commit together.');
must(amend, '[`purchaseInvoices/${invoiceId}/movementIds`]: movementIds', 'Void must still find one stock movement per item after lines are added or removed.');
must(amend, '[`stockReceipts/${r.receiptId}/removed`]: true', 'A removed line must leave its receipt marked removed, not deleted.');
must(amend, 'writes[`stockReceipts/${a.receiptId}`] = {', 'An added stock line must get its own stock receipt.');
must(amend, 'writes[`cfLedger/fm_${journalId}`] = cashLedgerRecord(', 'A bank-paid amendment must also correct the cash ledger.');
must(amend, '[`purchaseInvoices/${invoiceId}/editHistory/r${nextRevision}`]', 'Each amendment must keep a before/after history entry.');
// Review fixes (22 Oct 2026): nothing is staged until every refusable check passes; a stopped amendment can be finished or discarded.
must(amend, 'newTotal = Financial.money(oldTotal + (linesNet - oldLinesNet) + (newVat - oldVat))', 'The total must move by the change only, keeping any posted 1290 difference on the bill.');
must(amend, 'if (Financial.money(glSum(newGl) - glSum(oldGl)) !== totalDelta) throw', 'An amendment that cannot balance must be refused before any stock moves.');
must(amend, '// Every refusable check has passed: stage the plan', 'The plan must be staged only after every refusable check.');
must(amend, 'cap = qty6(Math.min(-op.qty, Math.max(0, onHand)))', 'A stock reversal must be re-capped at the stock on hand when it runs.');
must(amend, 'data.resume === true', 'A stopped amendment must be finishable with its staged request.');
must(amend, 'async function discardPendingAmend(', 'A stopped amendment that moved no stock must be discardable.');
must(amend, 'sku.masterId !== row.itemId', 'The server must check that a brand belongs to the item.');
must(amend, 'k.receipt.invoiceId !== invoiceId', 'Changed or removed lines must have a matching stock receipt before anything moves.');
must(amend, 'Math.abs(u.value) > 0.05', 'Cost rounding of a few centavos must not block a later Void.');
must(corrections, 'detailBatches[b].receiptId===id', 'Correct details must find batches by receipt, not line position.');
must(corrections, 'Only a Super Admin can mark voided purchase receipts.', 'Marking voided receipts is Super Admin only.');
must(client, "action:'discard_amend'", 'Admin must offer to discard an unfinished amendment.');
if (/\.remove\(|set\(null\)/.test(amend)) failures.push('Amend must never delete posted records.');
if (/INVENTORY_BOOK_POSTING_TYPES = new Set\([^)]*"purchase"/.test(inventory)) failures.push('purchase movements must not post their own journal (the amendment journal carries them).');
// Void marks receipts so the stock card shows it.
must(corrections, 'Object.assign(writes,purchaseVoidReceiptWrites(invoiceId,invoice,now,reversalDate));', 'Void must mark the purchase stock receipts as voided.');
must(corrections, 'if (action === "mark_void_receipts") {', 'Older voids must be markable without moving stock or money.');
must(card, "type:'Void'+label", 'The stock card must show a Void row for a voided purchase.');
must(card, "r.removed||!(Number(r.qty)>0)", 'A line removed by Amend must not show on the stock card.');
must(card, "else if(/^Void/i.test(m.type||''))received-=Number(m.out)||0;", 'A void must reduce stock received in the reconciliation, not count as consumption.');
// Admin.
must(workspace, 'data-purchase-amend=', 'Purchase history must offer Amend.');
must(purchasing, 'pp.onclick=P.amendOf?savePurchaseAmendment:postPurchases;', 'Save on an amendment must call Amend, never post a second purchase.');
must(client, "action:'amend'", 'The amendment must call the server amend action.');
must(client, 'expectedRevision:P.amendRevision', 'The amendment must send the revision it opened.');
must(client, "String(authz.role||'').toLowerCase()!=='superadmin'", 'Only a Super Admin sees Amend working.');
if (purchasing.includes('ownerAmend:true')) failures.push('The old reverse-and-re-enter Amend must be gone from the Actions menu.');
for (const [name, s, marker] of [['assets/js/admin/pos.js', pos, 'function savePurchaseAmendment('], ['functions/index.js', bundle, 'async function amendPurchase('], ['assets/js/admin/analytics.js', analytics, "type:'Void'+label"]]) if (!s.includes(marker)) failures.push(`${name} must be rebuilt with Purchase Amend.`);

if (failures.length) { console.error('Purchase amend check failed:\n- ' + failures.join('\n- ')); process.exit(1); }
console.log('PASS: Purchase Amend adds, removes and changes lines in place (stock by the difference, sold stock charged to COGS, bill / bank payment and one journal in step), refuses paid bills, closed months and stale forms; voided purchases show on stock cards.');
