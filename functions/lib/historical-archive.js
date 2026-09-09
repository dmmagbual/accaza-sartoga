"use strict";

const crypto = require("node:crypto");

const SCHEMA_VERSION = 1;
const COLLECTION = "historicalOrders";
const OMITTED_BINARY_FIELDS = new Set(["proof", "proofData"]);

function clean(value) {
  if (Array.isArray(value)) return value.map(clean).filter((item) => item !== undefined);
  if (!value || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) return null;
    return value === undefined ? undefined : value;
  }
  const result = {};
  Object.keys(value).sort().forEach((key) => {
    if (OMITTED_BINARY_FIELDS.has(key)) return;
    const next = clean(value[key]);
    if (next !== undefined) result[key] = next;
  });
  return result;
}

function checksum(value) {
  return crypto.createHash("sha256").update(JSON.stringify(clean(value))).digest("hex");
}

function effectiveStatus(order) {
  return String(order && order.status === "Archived" ? order.prevStatus : order && order.status || "");
}

function assessEvidence(input) {
  const order = input.order || {}, status = effectiveStatus(order);
  const finalSale = ["Completed", "Received"].includes(status) && order.paymentStatus !== "pending";
  const financialRequired = finalSale;
  const refundCents = Math.round((Number(order.refundAmount) || 0) * 100);
  const remainingCents = Math.max(0, Math.round((Number(order.total) || 0) * 100) - refundCents);
  const refundRequired = finalSale && refundCents > 0;
  const voidRequired = finalSale && order.voided === true && remainingCents > 0;
  const inventoryRequired = finalSale && Array.isArray(order.lineItems) && order.lineItems.length > 0;
  const financialComplete = (!financialRequired || !!(input.saleMovement && input.saleJournal)) &&
    (!refundRequired || !!(input.refundMovement && input.refundJournal)) &&
    (!voidRequired || !!(input.voidMovement && input.voidJournal));
  const inventoryComplete = !inventoryRequired || !!(
    order.inventoryDeducted === true && Number(order.inventoryLedgerVersion) === 1 && input.inventoryPlan
  );
  const reversalPending = order.inventoryReversalRequested === true && order.inventoryReversed !== true;
  const settlementPending = ["grabfood", "foodpanda"].includes(String(order.channel || "")) &&
    String(order.settlementStatus || "unsettled") === "unsettled";
  const issues = [];
  if (financialRequired && !input.saleMovement) issues.push("sale_movement_missing");
  if (financialRequired && !input.saleJournal) issues.push("sale_journal_missing");
  if (refundRequired && !input.refundMovement) issues.push("refund_movement_missing");
  if (refundRequired && !input.refundJournal) issues.push("refund_journal_missing");
  if (voidRequired && !input.voidMovement) issues.push("void_movement_missing");
  if (voidRequired && !input.voidJournal) issues.push("void_journal_missing");
  if (inventoryRequired && order.inventoryDeducted !== true) issues.push("inventory_confirmation_missing");
  if (inventoryRequired && Number(order.inventoryLedgerVersion) !== 1) issues.push("inventory_ledger_version_missing");
  if (inventoryRequired && !input.inventoryPlan) issues.push("inventory_plan_missing");
  if (reversalPending) issues.push("inventory_reversal_pending");
  if (settlementPending) issues.push("platform_settlement_pending");
  return {
    status, financialRequired, financialComplete, refundRequired, voidRequired, inventoryRequired, inventoryComplete,
    reversalPending, settlementPending, issues,
    verified: issues.length === 0,
    eligibleForFutureRtdbRetirement: issues.length === 0,
  };
}

function buildDocument(orderId, input, replicatedAt = Date.now()) {
  const order = clean(Object.assign({id: orderId}, input.order || {}));
  const evidence = assessEvidence(Object.assign({}, input, {order}));
  const source = {
    rtdbPath: `/archivedOrders/${orderId}`,
    orderId,
    archivedAt: Number(order.archivedAt || 0),
    saleMovementId: input.saleMovement ? `sale_${orderId}` : "",
    saleJournalId: input.saleJournal ? String(input.saleJournalId || "") : "",
    refundMovementId: input.refundMovement ? String(input.refundMovementId || "") : "",
    refundJournalId: input.refundJournal ? String(input.refundJournalId || "") : "",
    voidMovementId: input.voidMovement ? String(input.voidMovementId || "") : "",
    voidJournalId: input.voidJournal ? String(input.voidJournalId || "") : "",
    inventoryPlanId: input.inventoryPlan ? orderId : "",
  };
  return {
    schemaVersion: SCHEMA_VERSION,
    sourceSystem: "firebase-rtdb",
    source,
    sourceChecksum: checksum(order),
    evidenceChecksum: checksum({
      saleMovement: input.saleMovement || null,
      saleJournal: input.saleJournal || null,
      refundMovement: input.refundMovement || null,
      refundJournal: input.refundJournal || null,
      voidMovement: input.voidMovement || null,
      voidJournal: input.voidJournal || null,
      inventoryPlan: input.inventoryPlan || null,
      evidence,
    }),
    replicatedAt: Number(replicatedAt),
    evidence,
    omittedSourceFields: ["proof", "proofData"],
    order,
  };
}

function unchanged(existing, next) {
  return !!existing && existing.schemaVersion === next.schemaVersion &&
    existing.sourceChecksum === next.sourceChecksum && existing.evidenceChecksum === next.evidenceChecksum;
}

module.exports = {SCHEMA_VERSION, COLLECTION, clean, checksum, effectiveStatus, assessEvidence, buildDocument, unchanged};
