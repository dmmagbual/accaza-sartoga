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
  saleMovementId: "sale_POS-1", saleMovement: {id: "sale_POS-1", type: "order_sale", sourceType: "order", sourceId: "POS-1", occurredAt: 100, lines: [{account: "revenue:sales", debit: 0, credit: 100}]},
  saleJournal: {sources: {"sale_POS-1": true}}, saleJournalId: "2026-09-09_instore",
  inventoryPlan: {schemaVersion: 1, usage: {beans: 0.02}},
};
const doc = HistoricalArchive.buildDocument("POS-1", evidence, 300);
assert.equal(HistoricalArchive.salesAt(completed), 100);
assert.equal(doc.salesAt, HistoricalArchive.salesAt(completed), "the replica must persist the exact reporting date");
assert.deepEqual(doc.salesLedger, {channel:"",discount:0,gross:100,movementIds:["sale_POS-1"],net:100,occurredAt:100,reversal:0,schemaVersion:1}, "the replica must carry a compact source-linked Finance summary");
assert.equal(doc.salesLedgerChecksum, HistoricalArchive.checksum(doc.salesLedger));
assert.equal(HistoricalArchive.salesAt({completedAt: 300, receivedAt: 200, timestamp: 100}), 300, "completed date must remain the sales authority");
assert.equal(HistoricalArchive.buildDocument("DATE-ONLY", {order: {date: "2026-09-19"}}, 300).salesAt, Date.parse("2026-09-19"), "legacy date-only orders need a persisted reporting date");
assert.equal(HistoricalArchive.buildDocument("ARCHIVED-ONLY", {order: {archivedAt: 200}}, 300).salesAt, 200, "legacy archived-only orders need a persisted reporting date");
assert.equal(HistoricalArchive.buildDocument("NO-DATE", {order: {}}, 300).salesAt, 0, "undated orders must remain identifiable for review");
assert.equal(doc.evidence.verified, true);
assert.equal(doc.evidence.eligibleForFutureRtdbRetirement, true);
assert.equal(doc.source.saleJournalId, "2026-09-09_instore");
assert.equal(Object.prototype.hasOwnProperty.call(doc.order, "proof"), false, "binary proof must not be duplicated into Firestore");
assert.equal(HistoricalArchive.unchanged(doc, HistoricalArchive.buildDocument("POS-1", evidence, 999)), true, "replication must avoid unchanged Firestore writes");

const reportOrder = Object.assign({}, completed, {timestamp:Date.parse("2026-09-19T12:00:00+08:00"),subtotal:125.55,discount:5.25,refundAmount:20,channel:"instore"});
const contribution = HistoricalArchive.reportingContribution(reportOrder);
assert.equal(contribution.month,"2026-09");assert.equal(contribution.day,"2026-09-19");assert.equal(contribution.orders,1);assert.equal(contribution.grossCents,12555);assert.equal(contribution.discountCents,525);assert.equal(contribution.refundCents,2000);assert.equal(contribution.netCents,10030);assert.equal(contribution.channel,"instore");assert.equal(contribution.schemaVersion,2);
assert.deepEqual(contribution.payments,[{key:"unspecified",netCents:10030}]);assert.deepEqual(contribution.items,[{key:"Latte",name:"Latte",units:1,netCents:0}]);
let monthly = HistoricalArchive.applyReportingContribution({}, contribution, 1);
assert.deepEqual({orders:monthly.orders,netCents:monthly.netCents,channel:monthly.channels.instore},{orders:1,netCents:10030,channel:{orders:1,netCents:10030}});
assert.deepEqual(monthly.days["2026-09-19"].payments,{unspecified:{netCents:10030}});assert.equal(monthly.schemaVersion,2);
monthly = HistoricalArchive.applyReportingContribution(monthly, contribution, -1);
assert.equal(monthly.orders,0);assert.equal(monthly.netCents,0);assert.deepEqual(monthly.channels,{},"retries and corrections must reverse a prior contribution without drift");
const legacyContribution = Object.assign({}, contribution, {schemaVersion:1});
delete legacyContribution.day;delete legacyContribution.cogsCents;delete legacyContribution.payments;delete legacyContribution.items;
let migrated = HistoricalArchive.applyReportingContribution({}, legacyContribution, 1);
migrated = HistoricalArchive.applyReportingContribution(migrated, legacyContribution, -1);
migrated = HistoricalArchive.applyReportingContribution(migrated, contribution, 1);
assert.deepEqual({orders:migrated.orders,netCents:migrated.netCents,channel:migrated.channels.instore},{orders:1,netCents:10030,channel:{orders:1,netCents:10030}},"migrating a V1 contribution must preserve reported totals");
assert.deepEqual(migrated.days["2026-09-19"].payments,{unspecified:{netCents:10030}},"migrating a V1 contribution must add the dashboard payment and day breakdowns");
assert.deepEqual(migrated.items.Latte,{name:"Latte",units:1,netCents:0},"migrating a V1 contribution must add best-seller data");
assert.equal(HistoricalArchive.reportingContribution(Object.assign({},reportOrder,{voided:true})),null,"voided sales must not contribute to the monthly rollup");

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
  "exports.manageHistoricalOrderArchive", "exports.readHistoricalOrders", "exports.readHistoricalSalesRollup", "historicalOrdersFromDocuments", "HistoricalArchive.unchanged", "deletionEnabled: false",
  '"sales-at-backfill"', '"sales-at-audit"', '"sales-ledger-backfill"', '"sales-rollup-backfill"', "Firestore replica maintenance only", "orderByKey()", "HISTORICAL_ARCHIVE_BATCH_LIMIT = 100",
  'startAt(`sale_${orderId}_`).endAt(`sale_${orderId}_\\uf8ff`)', "never recalculate history from current recipes", 'db.ref(`/archivedOrders/${orderId}`).get()',
  'db.ref("/historicalArchiveSync").transaction', "reconcileHistoricalSalesRollup", "salesRollupReady", "salesAtReady", "HISTORICAL_SALES_AT_BACKFILL_SCHEMA_VERSION = 3", "HISTORICAL_SALES_ROLLUP_BACKFILL_SCHEMA_VERSION = 4", "HISTORICAL_MAINTENANCE_DAILY_DOCUMENT_LIMIT = 4000", "HISTORICAL_REPLICA_BATCH_LIMIT = 10", "HISTORICAL_REPLICA_DAILY_SOURCE_LIMIT = 1000", '"sales-replica-backfill"', "reserveHistoricalReplicaBudget", "salesReplicaBackfill", "sourceReplicaRunId", "historicalFirestoreReadsV3", "HISTORICAL_USER_BURST_READ_LIMIT = 200", "limit * (salesAtReady ? 1 : 3)",
]) assert(source.includes(marker), `historical archive safeguard missing: ${marker}`);
assert(source.includes("const legacyContribution = previous && Number(previous.schemaVersion || 0) < 2"), "legacy rollup contributions must be migrated instead of treated as complete");
assert(source.includes("const legacyMonth = months.some"), "legacy month summaries must be migrated instead of treated as complete");
assert(!/Costing\.|ref\([`'"]\/(?:recipes|menuItems|optionRecipes)/.test(source), "historical archive must not use mutable current costing inputs");
const salesAtMaintenance = source.slice(source.indexOf('if (["sales-at-audit"'), source.indexOf('if (action === "sales-ledger-backfill")'));
assert(!salesAtMaintenance.includes('historicalArchiveInputs'), "salesAt maintenance must not replay RTDB archive evidence");
assert(source.includes('batch.update(document.ref, {salesAt: stamp})'), "salesAt maintenance must update only the reporting key");
assert(!/\.remove\(|\[[`'"]archivedOrders\//.test(source), "historical archive phase 1 must not delete RTDB data");

const maintenanceUi = fs.readFileSync("assets/js/admin/operations-dashboard.js", "utf8");
assert(maintenanceUi.includes("salesAtStageState") && maintenanceUi.includes("dependentStageState(status,'salesAt',3)") && maintenanceUi.includes("dependentStageState(status,'salesRollup',4)") && maintenanceUi.includes("sourceReplicaRunId"), "the owner repair must rerun incomplete summary-schema states once");
assert(maintenanceUi.includes("sales-replica-backfill") && maintenanceUi.includes("reportingReady"), "the owner repair must populate and validate the detailed-report reader before reporting success");
assert(maintenanceUi.includes("Detailed-report reader ready"), "the owner must be able to distinguish rollup-ready from detailed-reader-ready reporting");

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
