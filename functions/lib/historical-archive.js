"use strict";

const crypto = require("node:crypto");

const SCHEMA_VERSION = 2;
const COLLECTION = "historicalOrders";
const MONTH_COLLECTION = "historicalSalesMonths";
const CONTRIBUTION_COLLECTION = "historicalSalesContributions";
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

function salesAt(order) {
  return Number(order && order.completedAt) || Number(order && order.receivedAt) ||
    Number(order && order.timestamp) || Date.parse(order && order.date || "") ||
    Number(order && order.archivedAt) || 0;
}

function reportingMonth(stamp) {
  const value = Number(stamp) || 0;
  if (!value) return "";
  const date = new Date(value + 8 * 60 * 60 * 1000);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function reportingChannel(order) {
  const channel = String(order && order.channel || "").trim().toLowerCase();
  const source = String(order && order.source || "").trim().toLowerCase();
  if (["grabfood", "foodpanda"].includes(channel)) return channel;
  if (channel === "online" || source === "online") return "online";
  if (channel === "instore") return "instore";
  return "unclassified";
}

function reportingDay(stamp) {
  return new Date(Number(stamp) + 8 * 3600000).toISOString().slice(0, 10);
}

function reportingHour(stamp) {
  return new Date(Number(stamp) + 8 * 3600000).getUTCHours();
}

function reportingPaymentKey(value) {
  const raw = String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (raw === "cash") return "cash";
  if (raw === "gcash") return "gcash";
  if (raw === "paymaya" || raw === "maya") return "paymaya";
  if (raw === "banktransfer" || raw === "bank") return "bank_transfer";
  return raw || "unspecified";
}

function reportingPaymentEntries(order, netCents, grossCents) {
  const rows = Array.isArray(order && order.payments) && order.payments.length ? order.payments : [{method: order && order.payment, amount: grossCents / 100}];
  const weights = rows.map((row) => Math.max(0, Math.round((Number(row && row.amount) || 0) * 100)));
  const total = weights.reduce((sum, value) => sum + value, 0) || grossCents || 1;
  let assigned = 0;
  return rows.map((row, index) => {
    const net = index === rows.length - 1 ? netCents - assigned : Math.round(netCents * weights[index] / total);
    assigned += net;
    return {key: reportingPaymentKey(row && row.method), netCents: Math.max(0, net)};
  });
}

function reportingItems(order, netCents, grossCents) {
  const lines = Array.isArray(order && (order.correctedLineItems || order.lineItems)) ? (order.correctedLineItems || order.lineItems) : [];
  return lines.map((line, index) => {
    const qty = Math.max(0, Number(line && line.qty) || 0), unit = Math.max(0, Number(line && line.unitTotal) || 0);
    const key = String(line && (line.itemKey || line.key || line.name) || `line_${index}`).slice(0, 160);
    const name = String(line && (line.name || line.itemName || line.itemKey) || key).slice(0, 160);
    const categoryId = String(line && (line.categoryId || line.category || line.cat) || "").slice(0, 80);
    const gross = Math.round(qty * unit * 100);
    return {key, name, categoryId, units: qty, netCents: grossCents > 0 ? Math.max(0, Math.round(gross * netCents / grossCents)) : 0};
  }).filter((line) => line.key && line.units > 0);
}

function reportingContribution(order) {
  const status = effectiveStatus(order), stamp = salesAt(order);
  if (!order || order.voided === true || order.paymentStatus === "pending" ||
    !["Completed", "Received"].includes(status) || !stamp) return null;
  const channel = String(order.channel || "").toLowerCase(), platform = ["grabfood", "foodpanda"].includes(channel);
  const gross = Number(platform && order.grossPlatform != null ? order.grossPlatform :
    (order.subtotal != null ? order.subtotal : order.total)) || 0;
  const platformDiscount = order.netSalesPlatform != null ? Math.max(0, gross - (Number(order.netSalesPlatform) || 0)) :
    (Number(order.platformDiscount) || 0);
  const discount = platform ? platformDiscount : (Number(order.discount) || 0), refund = Number(order.refundAmount) || 0;
  const grossCents = Math.round(gross * 100), discountCents = Math.round(discount * 100), refundCents = Math.round(refund * 100);
  const netCents = Math.max(0, grossCents - discountCents - refundCents);
  const contribution = {
    month: reportingMonth(stamp), orders: 1, grossCents,
    discountCents, refundCents, netCents,
    channel: reportingChannel(order), day: reportingDay(stamp), hour: reportingHour(stamp),
    cogsCents: Math.max(0, Math.round((Number(order.correctedCogsSnapshot != null ? order.correctedCogsSnapshot : order.cogsSnapshot) || 0) * 100)),
    payments: reportingPaymentEntries(order, netCents, grossCents), items: reportingItems(order, netCents, grossCents), schemaVersion: 3,
  };
  contribution.checksum = checksum(contribution);
  return contribution;
}

function applyReportingContribution(month, contribution, direction) {
  const result = Object.assign({orders:0,grossCents:0,discountCents:0,refundCents:0,netCents:0,cogsCents:0,channels:{},payments:{},items:{},hours:{},days:{},schemaVersion:3}, clean(month || {}));
  result.channels = Object.assign({}, result.channels || {}); result.payments = Object.assign({}, result.payments || {});
  result.items = Object.assign({}, result.items || {}); result.hours = Object.assign({}, result.hours || {}); result.days = Object.assign({}, result.days || {});
  const sign = direction < 0 ? -1 : 1, channel = String(contribution && contribution.channel || "unclassified");
  for (const field of ["orders", "grossCents", "discountCents", "refundCents", "netCents", "cogsCents"]) {
    result[field] = Math.max(0, Math.round((Number(result[field]) || 0) + sign * (Number(contribution && contribution[field]) || 0)));
  }
  const channelRow = Object.assign({orders:0,netCents:0}, result.channels[channel] || {});
  channelRow.orders = Math.max(0, Math.round((Number(channelRow.orders) || 0) + sign * (Number(contribution && contribution.orders) || 0)));
  channelRow.netCents = Math.max(0, Math.round((Number(channelRow.netCents) || 0) + sign * (Number(contribution && contribution.netCents) || 0)));
  if (!channelRow.orders && !channelRow.netCents) delete result.channels[channel]; else result.channels[channel] = channelRow;
  function addRows(target, rows, withItems) {
    (rows || []).forEach((entry) => {
      const key = String(entry && entry.key || "unspecified"), hasOrders = !withItems && entry && entry.orders != null, current = Object.assign(withItems ? {name:String(entry && entry.name || key),categoryId:String(entry && entry.categoryId || ""),units:0,netCents:0} : (hasOrders ? {orders:0,netCents:0} : {netCents:0}), target[key] || {});
      if (withItems) { current.name = String(entry && entry.name || current.name || key); current.categoryId = String(entry && entry.categoryId || current.categoryId || ""); current.units = Math.max(0, (Number(current.units) || 0) + sign * (Number(entry && entry.units) || 0)); }
      if (hasOrders) current.orders = Math.max(0, Math.round((Number(current.orders) || 0) + sign * (Number(entry && entry.orders) || 0)));
      current.netCents = Math.max(0, Math.round((Number(current.netCents) || 0) + sign * (Number(entry && entry.netCents) || 0)));
      if ((withItems && current.units) || current.orders || current.netCents) target[key] = current; else delete target[key];
    });
  }
  addRows(result.payments, contribution && contribution.payments, false);
  addRows(result.items, contribution && contribution.items, true);
  addRows(result.hours, [{key:String(Number(contribution && contribution.hour) || 0),orders:contribution && contribution.orders,netCents:contribution && contribution.netCents}], false);
  const day = String(contribution && contribution.day || "");
  if (day) {
    const dayRow = Object.assign({orders:0,grossCents:0,discountCents:0,refundCents:0,netCents:0,cogsCents:0,channels:{},payments:{},items:{},hours:{}}, result.days[day] || {});
    dayRow.channels = Object.assign({}, dayRow.channels || {}); dayRow.payments = Object.assign({}, dayRow.payments || {}); dayRow.items = Object.assign({}, dayRow.items || {}); dayRow.hours = Object.assign({}, dayRow.hours || {});
    for (const field of ["orders", "grossCents", "discountCents", "refundCents", "netCents", "cogsCents"]) dayRow[field] = Math.max(0, Math.round((Number(dayRow[field]) || 0) + sign * (Number(contribution && contribution[field]) || 0)));
    const dayChannel = Object.assign({orders:0,netCents:0}, dayRow.channels[channel] || {});
    dayChannel.orders = Math.max(0, Math.round((Number(dayChannel.orders) || 0) + sign * (Number(contribution && contribution.orders) || 0)));
    dayChannel.netCents = Math.max(0, Math.round((Number(dayChannel.netCents) || 0) + sign * (Number(contribution && contribution.netCents) || 0)));
    if (!dayChannel.orders && !dayChannel.netCents) delete dayRow.channels[channel]; else dayRow.channels[channel] = dayChannel;
    addRows(dayRow.payments, contribution && contribution.payments, false); addRows(dayRow.items, contribution && contribution.items, true); addRows(dayRow.hours, [{key:String(Number(contribution && contribution.hour) || 0),orders:contribution && contribution.orders,netCents:contribution && contribution.netCents}], false);
    if (!dayRow.orders && !dayRow.grossCents && !dayRow.netCents) delete result.days[day]; else result.days[day] = dayRow;
  }
  result.schemaVersion = 3;
  return result;
}

function salesLedgerSummary(input) {
  const linked = input.salesMovements && typeof input.salesMovements === "object" ? Object.entries(input.salesMovements) : [];
  const rows = (linked.length ? linked : [
    [input.saleMovementId || "", input.saleMovement],
    [input.refundMovementId || "", input.refundMovement],
    [input.voidMovementId || "", input.voidMovement],
  ]).filter((row) => row[0] && row[1] && (row[1].sourceType === "order" || ["order_sale", "order_void", "order_refund"].includes(String(row[1].type || ""))));
  let grossCents = 0, discountCents = 0, reversalCents = 0, occurredAt = 0, channel = "";
  rows.forEach(([id, movement]) => {
    const stamp = Number(movement.occurredAt || movement.postedAt || 0);
    if (movement.type === "order_sale" || !occurredAt || stamp < occurredAt) occurredAt = stamp;
    channel = channel || String(movement.channel || "");
    (movement.lines || []).forEach((line) => {
      const account = String(line.account || ""), debit = Math.round((Number(line.debit) || 0) * 100), credit = Math.round((Number(line.credit) || 0) * 100);
      if (account === "revenue:sales") grossCents += credit - debit;
      else if (["expense:platform_discount", "expense:customer_discount", "revenue:platform_discount"].includes(account)) discountCents += debit - credit;
      else if (account === "revenue:sales_reversal") reversalCents += debit - credit;
    });
  });
  return clean({
    gross: grossCents / 100,
    discount: discountCents / 100,
    reversal: reversalCents / 100,
    net: (grossCents - discountCents - reversalCents) / 100,
    occurredAt,
    channel,
    movementIds: rows.map((row) => row[0]),
    schemaVersion: 1,
  });
}

function validInventoryPlan(plan) {
  return !!(plan && Number(plan.schemaVersion) === 1 && plan.usage && typeof plan.usage === "object" &&
    !Array.isArray(plan.usage));
}

function legacyInventoryEvidence(orderId, rawMovements) {
  const sourceId = String(orderId || ""), prefix = `sale_${sourceId}_`, movements = [], invalidMovementIds = [];
  Object.keys(rawMovements || {}).sort().forEach((movementId) => {
    const movement = rawMovements[movementId] || {}, itemId = String(movement.itemId || ""),
      qty = Number(movement.qty), unitCost = Number(movement.unitCost || 0), occurredAt = Number(movement.createdAt || movement.occurredAt || 0);
    const valid = !!itemId && movementId === `${prefix}${itemId}` && movement.type === "sale_usage" &&
      movement.sourceType === "order" && String(movement.sourceId || "") === sourceId &&
      String(movement.sourceLine || "") === itemId && Number.isFinite(qty) && qty < 0 &&
      Number.isFinite(unitCost) && unitCost >= 0 && Number.isFinite(occurredAt) && occurredAt > 0;
    if (!valid) { invalidMovementIds.push(movementId); return; }
    movements.push(clean({
      movementId, itemId, sourceLine: itemId, type: "sale_usage", sourceType: "order", sourceId,
      qty, unitCost, totalCost: Number(movement.totalCost || Math.abs(qty) * unitCost),
      unit: String(movement.unit || ""), occurredAt, schemaVersion: Number(movement.schemaVersion || 0),
    }));
  });
  return {valid: movements.length > 0 && invalidMovementIds.length === 0, movements, invalidMovementIds};
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
  const planValid = validInventoryPlan(input.inventoryPlan), legacyInventory = legacyInventoryEvidence(order.id, input.inventoryMovements);
  const inventoryEvidenceMode = planValid ? "sale_time_plan" : legacyInventory.valid ? "legacy_sale_usage_movements" : "missing";
  const inventoryComplete = !inventoryRequired || !!(order.inventoryDeducted === true &&
    Number(order.inventoryLedgerVersion) === 1 && inventoryEvidenceMode !== "missing");
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
  if (inventoryRequired && input.inventoryPlan && !planValid) issues.push("inventory_plan_invalid");
  if (inventoryRequired && inventoryEvidenceMode === "missing") issues.push("inventory_evidence_missing");
  if (inventoryRequired && legacyInventory.invalidMovementIds.length) issues.push("inventory_movement_evidence_invalid");
  if (reversalPending) issues.push("inventory_reversal_pending");
  if (settlementPending) issues.push("platform_settlement_pending");
  return {
    status, financialRequired, financialComplete, refundRequired, voidRequired, inventoryRequired, inventoryComplete, inventoryEvidenceMode,
    reversalPending, settlementPending, issues,
    verified: issues.length === 0,
    eligibleForFutureRtdbRetirement: issues.length === 0,
  };
}

function buildDocument(orderId, input, replicatedAt = Date.now()) {
  const order = clean(Object.assign({id: orderId}, input.order || {}));
  const legacyInventory = legacyInventoryEvidence(orderId, input.inventoryMovements), evidence = assessEvidence(Object.assign({}, input, {order})), salesLedger = salesLedgerSummary(input);
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
    inventoryPlanId: validInventoryPlan(input.inventoryPlan) ? orderId : "",
    inventoryEvidenceMode: evidence.inventoryEvidenceMode,
    inventoryMovementIds: legacyInventory.movements.map((movement) => movement.movementId),
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
      inventoryMovements: legacyInventory.movements,
      invalidInventoryMovementIds: legacyInventory.invalidMovementIds,
      evidence,
    }),
    replicatedAt: Number(replicatedAt),
    evidence,
    omittedSourceFields: ["proof", "proofData"],
    legacyInventoryEvidence: legacyInventory.movements,
    // This is a denormalized, derived reporting key.  Keep the order copy as
    // the source of truth so it never changes the archive checksums or the
    // accounting evidence represented by this replica.
    salesAt: salesAt(order),
    salesLedger,
    salesLedgerChecksum: checksum(salesLedger),
    order,
  };
}

function unchanged(existing, next) {
  return !!existing && existing.schemaVersion === next.schemaVersion &&
    existing.sourceChecksum === next.sourceChecksum && existing.evidenceChecksum === next.evidenceChecksum &&
    Number.isFinite(Number(existing.salesAt)) && existing.salesLedger && Number(existing.salesLedger.schemaVersion) === 1 &&
    existing.salesLedgerChecksum === next.salesLedgerChecksum;
}

module.exports = {SCHEMA_VERSION, COLLECTION, MONTH_COLLECTION, CONTRIBUTION_COLLECTION, clean, checksum, effectiveStatus, salesAt, reportingMonth, reportingChannel, reportingContribution, applyReportingContribution, salesLedgerSummary, validInventoryPlan, legacyInventoryEvidence, assessEvidence, buildDocument, unchanged};
