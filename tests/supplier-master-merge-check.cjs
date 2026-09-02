/* Supplier master merge / delete — behaviour check.
   Duplicate supplier records could not be merged or removed: manageSupplier had only
   create, rename, deactivate and reactivate, while every dropdown already filtered on a
   mergedInto flag that nothing ever wrote. These assertions lock in what a merge is
   allowed to touch, and what deleting a record requires. */
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const SupplierMaster = require("../functions/lib/supplier-master.js");

const DUP = "sup_dup", KEEP = "sup_keep", OTHER = "sup_other";
const collections = {
  purchaseInvoices: {pinv_1: {supplierId: DUP, supplier: "ABC Trading", total: 1500}, pinv_2: {supplierId: OTHER}, pinv_3: {supplierId: DUP}},
  payables: {ap_1: {supplierId: DUP, party: "ABC Trading"}, ap_2: {supplierId: KEEP}},
  pettyCashVouchers: {pv_1: {supplierId: DUP, transactionType: "purchase_advance"}, pv_2: {}},
  stockReceipts: {rcpt_1: {supplierId: DUP}},
  inventoryBatch: {bat_1: {supplierId: DUP}},
  inventorySku: {sku_1: {supplierId: DUP}, sku_2: {supplierId: OTHER}},
  shifts: {shift_1: {payOuts: {po_1: {supplierId: DUP}, po_2: {supplierId: OTHER}}}, shift_2: {payOuts: {po_3: {supplierId: DUP}}}},
};

// 1. Every live reference is found, including advances nested inside a shift.
const hits = SupplierMaster.collectReferences(collections, DUP);
assert.deepStrictEqual(hits.purchaseInvoices, ["pinv_1", "pinv_3"], "purchase invoices for the duplicate must be found");
assert.deepStrictEqual(hits.payables, ["ap_1"], "payables for the duplicate must be found");
assert.deepStrictEqual(hits.pettyCashVouchers, ["pv_1"], "cash advances for the duplicate must be found");
assert.deepStrictEqual(hits.shiftAdvances, ["shift_1/po_1", "shift_2/po_3"], "register advances nested in shifts must be found");
assert.strictEqual(hits.total, 9, "every live reference is counted");

// 2. A record nothing points at reports zero — the only case a delete is allowed.
assert.strictEqual(SupplierMaster.collectReferences(collections, "sup_never_used").total, 0, "an unused supplier has no references");
assert.strictEqual(SupplierMaster.collectReferences(collections, "").total, 0, "a blank id never matches rows that have no supplierId");

// 3. A merge repoints the live link and touches nothing else.
const writes = SupplierMaster.planMergeWrites(hits, KEEP);
assert.strictEqual(writes["purchaseInvoices/pinv_1/supplierId"], KEEP);
assert.strictEqual(writes["shifts/shift_2/po_3/supplierId"], KEEP);
assert.strictEqual(Object.keys(writes).length, 9, "one write per reference, nothing more");
for (const key of Object.keys(writes)) {
  assert.ok(key.endsWith("/supplierId"), `a merge may only rewrite supplierId links, found ${key}`);
  assert.ok(!/^financialMovements\//.test(key), "posted Finance movements are immutable and must never be rewritten");
  assert.ok(!/\/(supplier|party|supplierName|recipient)$/.test(key), `the point-in-time supplier name on a document must survive a merge, found ${key}`);
}
assert.ok(!Object.keys(writes).some((k) => k.startsWith("purchaseInvoices/pinv_2/")), "another supplier's records are untouched");

// 4. The refusal message names what is in the way, so the operator knows to merge instead.
const summary = SupplierMaster.referenceSummary(hits);
for (const part of ["purchaseInvoices (2)", "payables (1)", "shiftAdvances (2)"]) {
  assert.ok(summary.includes(part), `the delete refusal must name ${part}`);
}

// 5. The callable's own guards.
const source = fs.readFileSync(path.join(__dirname, "..", "src", "functions", "20-portal-auth.js"), "utf8");
const guards = [
  ['["merge","delete"].includes(action)&&!["owner","superadmin"].includes(actor.role)', "merge and delete must be owner-level"],
  ['if(!reason)throw new HttpsError("invalid-argument","A merge reason is required.")', "a merge must record why"],
  ['if(supplier.mergedInto)throw new HttpsError("failed-precondition",`This supplier was already merged', "merging twice must be refused"],
  ['if(target.mergedInto)throw new HttpsError("failed-precondition","The surviving supplier has itself been merged.', "the survivor may not itself be merged away"],
  ['if(targetId===supplierId)throw new HttpsError("invalid-argument","Choose a different surviving supplier.")', "a supplier cannot be merged into itself"],
  ['if(supplier.mergedInto)throw new HttpsError("failed-precondition","A merged supplier is part of the audit trail and cannot be deleted.")', "a merged record cannot then be deleted"],
  ["if(hits.total>0)throw new HttpsError", "a referenced supplier cannot be deleted"],
  ["operationalAuditRecord(\"merge_supplier\"", "a merge must be written to the operational audit trail"],
  ["operationalAuditRecord(\"delete_supplier\"", "a delete must be written to the operational audit trail"],
  ["redirectedFrom:supplierId", "the duplicate's name index must resolve to the survivor"],
];
for (const [marker, why] of guards) assert.ok(source.includes(marker), `20-portal-auth.js: ${why}`);
assert.ok(fs.readFileSync(path.join(__dirname, "..", "functions", "index.js"), "utf8").includes('require("./lib/supplier-master")'), "the deployed bundle must load the supplier master helper");

console.log("PASS: supplier merge repoints only live links, keeps posted movements and historical names, and delete is refused while anything references the record.");
