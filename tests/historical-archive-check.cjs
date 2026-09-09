"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const HistoricalArchive = require("../functions/lib/historical-archive");

const completed = {
  id: "POS-1", status: "Archived", prevStatus: "Completed", paymentStatus: "confirmed",
  timestamp: 100, archivedAt: 200, lineItems: [{name: "Latte", qty: 1}],
  inventoryDeducted: true, inventoryLedgerVersion: 1, proof: "data:image/png;base64,large",
};
const evidence = {
  order: completed,
  saleMovement: {id: "sale_POS-1", lines: [{debit: 100, credit: 0}]},
  saleJournal: {sources: {"sale_POS-1": true}}, saleJournalId: "2026-09-09_instore",
  inventoryPlan: {schemaVersion: 1, usage: {beans: 0.02}},
};
const doc = HistoricalArchive.buildDocument("POS-1", evidence, 300);
assert.equal(HistoricalArchive.salesAt(completed), 100);
assert.equal(HistoricalArchive.salesAt({completedAt: 300, receivedAt: 200, timestamp: 100}), 300, "completed date must remain the sales authority");
assert.equal(doc.evidence.verified, true);
assert.equal(doc.evidence.eligibleForFutureRtdbRetirement, true);
assert.equal(doc.source.saleJournalId, "2026-09-09_instore");
assert.equal(Object.prototype.hasOwnProperty.call(doc.order, "proof"), false, "binary proof must not be duplicated into Firestore");
assert.equal(HistoricalArchive.unchanged(doc, HistoricalArchive.buildDocument("POS-1", evidence, 999)), true, "replication must avoid unchanged Firestore writes");

const missing = HistoricalArchive.buildDocument("POS-2", {order: Object.assign({}, completed, {id: "POS-2"})}, 300);
assert.equal(missing.evidence.verified, false);
for (const issue of ["sale_movement_missing", "sale_journal_missing", "inventory_evidence_missing"]) {
  assert(missing.evidence.issues.includes(issue), `missing evidence must report ${issue}`);
}
assert.equal(missing.evidence.eligibleForFutureRtdbRetirement, false);

const legacyMovements = {
  "sale_POS-LEGACY_beans": {type: "sale_usage", sourceType: "order", sourceId: "POS-LEGACY", sourceLine: "beans", itemId: "beans", qty: -0.02, unitCost: 800, occurredAt: 150, schemaVersion: 1},
};
const legacyOrder = Object.assign({}, completed, {id: "POS-LEGACY"});
const legacy = HistoricalArchive.buildDocument("POS-LEGACY", Object.assign({}, evidence, {
  order: legacyOrder, inventoryPlan: null, inventoryMovements: legacyMovements,
}), 300);
assert.equal(legacy.evidence.verified, true, "exact immutable sale movements must support legacy archival");
assert.equal(legacy.evidence.inventoryEvidenceMode, "legacy_sale_usage_movements");
assert.deepEqual(legacy.source.inventoryMovementIds, ["sale_POS-LEGACY_beans"]);
assert.equal(legacy.legacyInventoryEvidence[0].qty, -0.02);
assert.equal(HistoricalArchive.unchanged(legacy, HistoricalArchive.buildDocument("POS-LEGACY", Object.assign({}, evidence, {
  order: legacyOrder, inventoryPlan: null, inventoryMovements: legacyMovements,
}), 999)), true, "legacy movement checksums must be idempotent");

const foreignMovement = HistoricalArchive.buildDocument("POS-LEGACY", Object.assign({}, evidence, {
  order: legacyOrder, inventoryPlan: null,
  inventoryMovements: {"sale_POS-LEGACY_beans": Object.assign({}, legacyMovements["sale_POS-LEGACY_beans"], {sourceId: "ANOTHER-ORDER"})},
}), 300);
assert.equal(foreignMovement.evidence.verified, false, "foreign inventory evidence must never qualify an archive");
assert(foreignMovement.evidence.issues.includes("inventory_movement_evidence_invalid"));
assert(foreignMovement.evidence.issues.includes("inventory_evidence_missing"));

const invalidPlan = HistoricalArchive.buildDocument("POS-LEGACY", Object.assign({}, evidence, {
  order: legacyOrder, inventoryPlan: {schemaVersion: 99, usage: {beans: 0.02}}, inventoryMovements: legacyMovements,
}), 300);
assert.equal(invalidPlan.evidence.verified, false, "an invalid plan must stay visible even when legacy movements exist");
assert(invalidPlan.evidence.issues.includes("inventory_plan_invalid"));
assert.equal(invalidPlan.source.inventoryPlanId, "");

const rejected = HistoricalArchive.buildDocument("ONLINE-1", {order: {status: "Archived", prevStatus: "Rejected", archivedAt: 200}}, 300);
assert.equal(rejected.evidence.verified, true, "rejected orders do not require a sale journal");

const refundedOrder = Object.assign({}, completed, {id: "POS-3", refundAmount: 25});
const refunded = HistoricalArchive.buildDocument("POS-3", Object.assign({}, evidence, {order: refundedOrder}), 300);
assert.equal(refunded.evidence.verified, false);
assert(refunded.evidence.issues.includes("refund_movement_missing") && refunded.evidence.issues.includes("refund_journal_missing"));
const corrected = HistoricalArchive.buildDocument("POS-3", Object.assign({}, evidence, {
  order: refundedOrder, refundMovementId: "refund_POS-3_2500", refundMovement: {id: "refund_POS-3_2500"},
  refundJournalId: "2026-09-09_instore", refundJournal: {id: "2026-09-09_instore", sourceId: "refund_POS-3_2500", included: true},
}), 300);
assert.equal(corrected.evidence.verified, true, "a refund is verified only with its movement and journal chain");

const source = fs.readFileSync("src/functions/61-historical-archive.js", "utf8");
for (const marker of [
  "exports.replicateArchivedOrderToFirestore", "exports.refreshHistoricalOrderAfterJournal", "exports.refreshHistoricalOrderAfterInventoryPlan",
  "exports.manageHistoricalOrderArchive", "exports.readHistoricalOrders", "historicalOrdersFromDocuments", "HistoricalArchive.unchanged", "deletionEnabled: false",
  '["preview", "backfill", "verify"]', "orderByKey()", "HISTORICAL_ARCHIVE_BATCH_LIMIT = 100",
  'startAt(`sale_${orderId}_`).endAt(`sale_${orderId}_\\uf8ff`)', "never recalculate history from current recipes", 'db.ref(`/archivedOrders/${orderId}`).get()',
  'db.ref("/historicalArchiveSync").set', 'firestore.collection(HistoricalArchive.COLLECTION).doc(orderId).delete()',
]) assert(source.includes(marker), `historical archive safeguard missing: ${marker}`);
assert(!/Costing\.|ref\([`'"]\/(?:recipes|menuItems|optionRecipes)/.test(source), "historical archive must not use mutable current costing inputs");
assert(!/\.remove\(|\[[`'"]archivedOrders\//.test(source), "historical archive phase 1 must not delete RTDB data");

const rules = fs.readFileSync("firestore.rules", "utf8");
assert(rules.includes("allow read, write: if false"), "Firestore historical replica must be server-only");
const databaseRules = fs.readFileSync("database.rules.json", "utf8");
assert(databaseRules.includes('"historicalArchiveSync"') && databaseRules.includes('".write": false'), "archive change marker must be readable but server-written");
const config = JSON.parse(fs.readFileSync("firebase.json", "utf8"));
assert.deepEqual(config.firestore, {rules: "firestore.rules", indexes: "firestore.indexes.json"});
const workflow = fs.readFileSync(".github/workflows/deploy-functions.yml", "utf8");
assert(workflow.includes("functions,database,firestore,storage"), "production workflow must deploy Firestore rules");
assert(workflow.indexOf("Verify the default Firestore database exists") < workflow.indexOf("Acknowledge retry policy"), "Firestore existence must be checked before any production function deployment");

console.log("historical archive checks passed");
