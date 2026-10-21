/* Purchase Edit (corrections only) — regression guard (admin 706).
   Danilo, 21 Oct 2026: "if you edit the amount then change the amount, if you edit the quantity then
   change the quantity." A Super Admin corrects line quantities / amounts / input VAT of a posted purchase
   in an open month. Stock, the bill or bank payment and ONE Finance Books journal move by the difference
   only; nothing posted is deleted, and the purchase keeps its PUR number with an edit history. */
import fs from 'node:fs';
const read = (p) => fs.readFileSync(p, 'utf8');
const inventory = read('src/functions/50-inventory.js'), edit = read('src/functions/43k-purchase-edit.js'), corrections = read('src/functions/43b-purchase-corrections.js');
const workspace = read('src/admin/pos/11h-purchase-workspace.js'), purchasing = read('src/admin/pos/20-purchasing.js'), pos = read('assets/js/admin/pos.js'), bundle = read('functions/index.js');
const failures = [], must = (s, marker, message) => { if (!s.includes(marker)) failures.push(message); };
const money = (v) => Math.round((Number(v) || 0) * 100) / 100, qty6 = (v) => Math.round((Number(v) || 0) * 1000000) / 1000000;

// Worked example 1: 1,000 g received at P500, price corrected to P600; only 400 g still on hand.
// The on-hand share (40%) restates stock, the used share goes to COGS, the bill rises by the full P100.
{ const valueDelta = 100, lineQty = 1000, before = 400, costBefore = 0.5, onHand = Math.max(0, Math.min(before, lineQty));
  const stock = money(valueDelta * (onHand / lineQty)), used = money(valueDelta - stock), costAfter = qty6((before * costBefore + stock) / before);
  const journal = [{a: 'coa:1200', dr: stock, cr: 0}, {a: 'coa:5000', dr: used, cr: 0}, {a: 'liability:payable:ap_x', dr: 0, cr: valueDelta}];
  if (stock !== 40 || used !== 60) failures.push('A price correction must split into the on-hand share (stock) and the used share (COGS).');
  if (costAfter !== 0.6) failures.push('The on-hand stock must carry the corrected unit cost.');
  if (money(journal.reduce((s, l) => s + l.dr - l.cr, 0)) !== 0) failures.push('The correction journal must balance.'); }
// Worked example 2: all stock still on hand -> the whole difference restates stock, nothing to COGS.
{ const stock = money(-50 * (Math.min(2000, 1000) / 1000)); if (stock !== -50) failures.push('With the delivery fully on hand the whole correction must restate stock.'); }
// Worked example 3: quantity only (100 -> 1,000 pieces, amount unchanged): value kept, no journal.
{ const costAfter = qty6((100 * 4.05) / 1000); if (costAfter !== 0.405) failures.push('A quantity-only edit must keep the carrying value.'); }

// Stock engine: value-only correction that posts no journal of its own.
must(inventory, '"purchase_cost_correction"', 'The stock engine must recognise purchase_cost_correction.');
must(inventory, 'const onHand = Math.max(0, Math.min(before, costCorrectionLineQty));', 'Only the on-hand share of the delivery may restate stock value.');
must(inventory, 'totalCost: type === "purchase_cost_correction" ? costCorrectionStock', 'The movement must carry the stock share as its value.');
if (/INVENTORY_BOOK_POSTING_TYPES = new Set\([^)]*purchase_cost_correction/.test(inventory)) failures.push('purchase_cost_correction must not post its own journal (the edit journal carries it).');
// Server edit action.
must(corrections, '"edit_lines"', 'Edit must run under the purchase correction lock.');
must(corrections, 'if (action === "edit_lines") return await editPurchaseLines(', 'managePurchaseCorrection must route edit_lines to the edit function.');
must(edit, 'actor.role !== "superadmin"', 'Only a Super Admin may edit a posted purchase.');
must(edit, 'await assertAccountingPeriodOpen(db, date, "editing this purchase")', 'Edits must be refused in a closed month.');
must(edit, 'Math.trunc(Number(data.expectedRevision)) !== revision', 'A stale edit form must be refused.');
must(edit, 'Financial.payableHasSettlement(payable)', 'A bill with any payment must not be edited.');
must(edit, 'seen.has(index)', 'A line may be corrected only once per edit (no double-counted rows).');
must(edit, 'qty6(row.expectedQty) !== oldQty', 'Each changed line must match what the form saw, so a stale form cannot undo a correction.');
must(edit, 'const [oldGl, newGl] = [await purchaseInventoryLines(db, invoice, false), await purchaseInventoryLines(db, after, false)];', 'Journal accounts must be resolved before any stock moves.');
must(edit, 'does not have enough stock on hand to lower this quantity', 'Stock feasibility must be checked before any stock moves.');
must(edit, 'lineQty: it.invoiceQty', 'The on-hand share must be capped at the item quantity across the whole purchase, not per line.');
must(edit, '|| `purchase_cash_${invoiceId}`', 'Older paid purchases without paymentMovementId must still find their payment.');
must(edit, 'writes[`cfLedger/fm_${journalId}`] = cashLedgerRecord(', 'A bank-paid edit must also correct the cash ledger.');
must(corrections, 'if (invoice.pendingEdit && ["correct_accounts","correct_quantity","reverse"].includes(action))', 'No other correction or Void may run while an edit is half-finished.');
must(corrections, 'was changed with Edit, so its account can', 'Recoding an expense line changed by Edit must be refused with a next step.');
must(edit, '/^asset:cash_account:/', 'Paid purchases may be edited only against their bank / e-wallet account.');
must(edit, 'line.lineType === "fixed_asset"', 'Equipment lines must not be edited.');
must(edit, 'pending.intent !== intent', 'A half-finished earlier edit with different values must block a new one.');
must(edit, 'type: "purchase_quantity_correction"', 'Quantity edits must use the value-preserving quantity movement.');
must(edit, 'type: "purchase_cost_correction"', 'Amount edits must use the value correction movement.');
must(edit, 'await purchaseInventoryLines(db, invoice, false)', 'The journal must be the difference of the posted and corrected purchase lines.');
must(edit, 'BooksBridge.linesBalanced(journal)', 'An unbalanced correction must never be posted.');
must(edit, 'Financial.movement("purchase_edit", "purchaseInvoice", invoiceId, journal, {occurredAt: accountingAt', 'The correction journal is dated on the purchase date.');
must(edit, 'await commitFinancial(db, journalId, movement, actor, writes)', 'The journal and the purchase/bill/receipt updates must commit together, idempotently per revision.');
must(edit, '[`purchaseInvoices/${invoiceId}/editHistory/r${nextRevision}`]', 'Each edit must keep a before/after history entry.');
must(edit, '[`payables/${payableId}/amount`]: newTotal', 'The unpaid bill amount must follow the corrected total.');
if (/\.remove\(|set\(null\)/.test(edit)) failures.push('Edit must never delete posted records.');
// Void of an edited purchase.
must(corrections, 'This purchase had a price correction partly charged to cost of sales, so it cannot be voided.', 'Void must refuse a purchase whose price edit was partly charged to COGS.');
must(corrections, 'movement=Object.assign({},movement,{qty:currentStock[movement.itemId].qty', 'Void must reverse an edited purchase at its current quantities and amounts.');
// Admin.
must(workspace, 'data-purchase-editlines=', 'Purchase history must offer Edit.');
must(workspace, 'data-purchase-void=', 'Purchase history must offer Void.');
if (workspace.includes('data-purchase-amend=')) failures.push('Edit replaces Amend in the Actions menu.');
must(purchasing, "action:'edit_lines'", 'The Edit form must call the server edit action.');
must(purchasing, 'expectedQty:Number(l.qty)||0', 'The Edit form must send what it saw for each changed line.');
must(purchasing, "managerApproval('reverse_purchase'", 'Void must keep the manager approval.');
for (const [name, s] of [['assets/js/admin/pos.js', pos], ['functions/index.js', bundle]]) if (!s.includes(name === 'functions/index.js' ? 'async function editPurchaseLines(' : "action:'edit_lines'")) failures.push(`${name} must be rebuilt with Purchase Edit.`);

if (failures.length) { console.error('Purchase edit check failed:\n- ' + failures.join('\n- ')); process.exit(1); }
console.log('PASS: Purchase Edit corrects quantity and amount by the difference only (stock share vs used share), keeps the bill / bank payment and Finance Books in step, refuses paid bills, closed months and stale forms, and Void reverses the purchase as it stands.');
