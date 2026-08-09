"use strict";

const TERMINAL = new Set(["Completed", "Received", "Rejected", "Archived"]);
const FINALIZED = new Set(["Completed", "Received"]);
function rows(value) {return Object.keys(value || {}).map((id) => Object.assign({id}, value[id] || {}));}
function stamp(row) {return Number(row.updatedAt || row.completedAt || row.receivedAt || row.timestamp || row.createdAt || row.closedAt || 0);}
function item(category, severity, id, title, detail, at, tab) {return {category, severity, id: String(id || "").slice(0, 160), title, detail, at: Number(at || 0), tab};}

function buildOperationalExceptions(input, now = Date.now()) {
  const exceptions = [], active = rows(input.activeOrders), orders = rows(input.orders);
  const financial = input.financialMovements || {}, offline = rows(input.offlinePosSync), custody = rows(input.cashCustody);
  const thirtyMinutes = 1800000, fiveMinutes = 300000, oneDay = 86400000;
  active.forEach((order) => {const at = stamp(order), status = String(order.status || "Pending");if (!TERMINAL.has(status) && at && now - at > thirtyMinutes) exceptions.push(item("stuck_order", now - at > 7200000 ? "critical" : "warning", order.id, `Order ${order.id} is still ${status}`, "Review the live order and confirm its correct status.", at, "orders"));});
  offline.forEach((sync) => {const at = stamp(sync), state = String(sync.state || "unknown");if (state !== "synced" && at && now - at > fiveMinutes) exceptions.push(item("offline_sync", "critical", sync.id, `Offline sale ${sync.id} did not finish`, `Server sync remains ${state}. Use the POS offline queue to retry from the originating device.`, at, "pos"));});
  orders.forEach((order) => {const status = String(order.status || ""), at = stamp(order);if (!FINALIZED.has(status) || order.voided === true) return;if (order.inventoryDeducted !== true || order.inventoryLedgerVersion !== 1) exceptions.push(item("inventory_gap", "critical", order.id, `Inventory posting missing for order ${order.id}`, "The completed order has no confirmed server inventory deduction. Investigate before manually adjusting stock.", at, "inventory"));if (order.paymentStatus !== "pending" && !financial[`sale_${order.id}`]) exceptions.push(item("financial_gap", "critical", order.id, `Accounting posting missing for order ${order.id}`, "The completed order has no immutable sale movement. Open Cash Flow and run the controlled financial audit.", at, "cashflow"));});
  custody.forEach((row) => {const remaining = Number(row.remaining != null ? row.remaining : row.amount) || 0, at = stamp(row);if (remaining > 0.009 && at && now - at > oneDay) exceptions.push(item("cash_custody", now - at > 3 * oneDay ? "critical" : "warning", row.id, `Cash awaiting deposit: ${remaining.toFixed(2)}`, "Allocate this custody record through the controlled register-cash deposit workflow.", at, "cashflow"));});
  let proofFailures = 0, clientErrors = 0;rows(input.telemetry).forEach((day) => {proofFailures += Number(day.errors && day.errors.proof_access) || 0;Object.keys(day.errors || {}).forEach((key) => {clientErrors += Number(day.errors[key]) || 0;});});
  if (proofFailures) exceptions.push(item("payment_proof", "warning", "payment-proof", `${proofFailures} payment-proof failure${proofFailures === 1 ? "" : "s"}`, "Review recent proof access attempts and confirm Storage and getPaymentProof are available.", now, "orders"));
  if (clientErrors - proofFailures > 0) exceptions.push(item("client_error", "warning", "client-errors", `${clientErrors - proofFailures} other client error${clientErrors - proofFailures === 1 ? "" : "s"}`, "Review System Health release signals before the next deployment.", now, "operations"));
  const rank = {critical: 0, warning: 1};exceptions.sort((a, b) => (rank[a.severity] - rank[b.severity]) || (b.at - a.at));
  return {generatedAt: now, scanned: {activeOrders: active.length, recentOrders: orders.length, offlineSyncs: offline.length, custodyRecords: custody.length}, counts: {critical: exceptions.filter((x) => x.severity === "critical").length, warning: exceptions.filter((x) => x.severity === "warning").length, total: exceptions.length}, exceptions: exceptions.slice(0, 100)};
}
module.exports = {buildOperationalExceptions};
