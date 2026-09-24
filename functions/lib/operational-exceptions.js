"use strict";

const {MAX_FAILED_EVENTS_PER_DAY} = require("./retry-guard");

const TERMINAL = new Set(["Completed", "Received", "Rejected", "Archived"]);
const FINALIZED = new Set(["Completed", "Received"]);
function rows(value) {return Object.keys(value || {}).map((id) => Object.assign({id}, value[id] || {}));}
function stamp(row) {return Number(row.updatedAt || row.completedAt || row.receivedAt || row.timestamp || row.createdAt || row.closedAt || 0);}
function item(category, severity, id, title, detail, at, tab) {return {category, severity, id: String(id || "").slice(0, 160), title, detail, at: Number(at || 0), tab};}

// M-3: clearing/suspense accounts that must always settle to zero.
const CLEARING_ACCOUNTS = [
  {code: "1190", name: "Cash Shortage Under Review"},
  {code: "1290", name: "Inventory Receiving Clearing"},
  {code: "1900", name: "Suspense"},
  {code: "2090", name: "Unrecorded Payables Clearing"},
  {code: "5090", name: "Unposted COGS Clearing"},
];
const CLEARING_CODES = new Set(CLEARING_ACCOUNTS.map((a) => a.code));
// A standing General Ledger residual above this many pesos is flagged for review.
const CLEARING_RESIDUAL_THRESHOLD = 50;
// Dead-lettered background events stay on the live exception list for this long.
const DEAD_LETTER_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
function round2(n) {return Math.round((Number(n) || 0) * 100) / 100;}
// Authoritative per-code balances from the Books General Ledger (/books/journal),
// where the POS semantic->chart-code mapping is already applied. Handles daily
// summary nodes (net map) and single journal entries (lines array), so the number
// always equals what Finance Books shows for that account.
function clearingBalancesFromJournal(journal) {
  const bal = {};
  Object.keys(journal || {}).forEach((key) => {
    const entry = journal[key];
    if (!entry || typeof entry !== "object") return;
    if (entry.net && typeof entry.net === "object") {
      Object.keys(entry.net).forEach((code) => {if (CLEARING_CODES.has(code)) bal[code] = round2((bal[code] || 0) + Number(entry.net[code] || 0));});
    } else if (Array.isArray(entry.lines)) {
      entry.lines.forEach((l) => {const code = String((l && l.code) || ""); if (CLEARING_CODES.has(code)) bal[code] = round2((bal[code] || 0) + (Number(l.debit) || 0) - (Number(l.credit) || 0));});
    }
  });
  return bal;
}
function clearingBalancesFromMonthlyNet(monthlyNet) {
  const balances = {};
  Object.values(monthlyNet || {}).forEach((month) => Object.keys(month || {}).forEach((code) => { if (CLEARING_CODES.has(code)) balances[code] = round2(Number(balances[code] || 0) + Number(month[code] || 0)); }));
  return balances;
}


/* Payment routing: a walk-in sale stores the receiving account the cashier picked, but an online sale
   stores no account at all, so the ledger resolves it through accountForMethod - the account whose
   feedMethods claims that method. The two agree only by configuration, never by construction. These
   checks make a divergence visible instead of letting online and POS money drift into two accounts. */
function paymentRoutingIssues(payMethods, cfAccounts, now) {
  const out = [], methods = Array.isArray(payMethods) ? payMethods : [], accounts = cfAccounts || {};
  const lower = (v) => String(v == null ? "" : v).trim().toLowerCase();
  methods.forEach((method) => {
    if (!method || method.active === false) return;
    if (method.cash === true) {
      /* orderPosting decides a sale is cash by the literal name, not by this flag. */
      if (lower(method.name) !== "cash") out.push(item("payment_routing", "critical", `routing_cash_${lower(method.name)}`,
        `Cash method "${String(method.name || "").trim()}" is not named Cash`,
        `The till treats this method as cash, but Finance identifies a cash sale by the literal name "Cash". Sales taken on it post to an unmapped suspense account instead of Register Cash. Rename it back to Cash, or clear its cash flag.`,
        now, "possettings"));
      return;
    }
    const name = String(method.name || "").trim(); if (!name) return;
    const claimants = Object.keys(accounts).filter((id) => {
      const account = accounts[id] || {};
      if (account.active === false) return false;
      const feeds = Array.isArray(account.feedMethods) ? account.feedMethods : [];
      return feeds.some((feed) => lower(feed) === lower(name));
    });
    const label = (id) => String((accounts[id] || {}).name || id);
    if (claimants.length > 1) {
      out.push(item("payment_routing", "critical", `routing_multi_${lower(name)}`,
        `${claimants.length} accounts claim payment method ${name}`,
        `${claimants.map(label).join(", ")} all list ${name} in their feed methods. An online ${name} sale carries no receiving account, so the ledger posts it to whichever of these resolves last - not necessarily the one a cashier picks at the till. Leave ${name} on exactly one account.`,
        now, "possettings"));
      return;
    }
    if (!claimants.length) {
      out.push(item("payment_routing", "warning", `routing_none_${lower(name)}`,
        `No receiving account claims payment method ${name}`,
        `An online ${name} sale carries no receiving account, and no account lists ${name} in its feed methods, so it cannot be mapped to one. Add ${name} to the real receiving account's feed methods.`,
        now, "possettings"));
      return;
    }
    const configured = Array.isArray(method.accountIds) ? method.accountIds.filter((id) => accounts[id]) : [];
    if (configured.length && configured.indexOf(claimants[0]) < 0) {
      out.push(item("payment_routing", "critical", `routing_split_${lower(name)}`,
        `${name} posts to different accounts at the till and online`,
        `A cashier can only pick ${configured.map(label).join(", ")}, but an online ${name} sale resolves to ${label(claimants[0])}. Past and current ${name} money is landing in two different accounts. Align the allowed receiving account with the account whose feed methods claim ${name}.`,
        now, "possettings"));
    }
  });
  return out;
}

function buildOperationalExceptions(input, now = Date.now()) {
  const exceptions = [], active = rows(input.activeOrders), orders = rows(input.orders);
  const financial = input.financialMovements || {},inventoryEvidence=input.inventoryMovementEvidence||{}, offline = rows(input.offlinePosSync), custody = rows(input.cashCustody);
  const thirtyMinutes = 1800000, fiveMinutes = 300000;
  active.forEach((order) => {const at = stamp(order), status = String(order.status || "Pending");if (!TERMINAL.has(status) && at && now - at > thirtyMinutes) exceptions.push(item("stuck_order", now - at > 7200000 ? "critical" : "warning", order.id, `Order ${order.id} is still ${status}`, "Review the live order and confirm its correct status.", at, "orders"));});
  offline.forEach((sync) => {const at = stamp(sync), state = String(sync.state || "unknown");if (state !== "synced" && at && now - at > fiveMinutes) exceptions.push(item("offline_sync", "critical", sync.id, `Offline sale ${sync.id} did not finish`, `Server sync remains ${state}. Use the POS offline queue to retry from the originating device.`, at, "pos"));});
  orders.forEach((order) => {const status = String(order.status || ""), at = stamp(order);if (!FINALIZED.has(status) || order.voided === true) return;if (order.inventoryDeducted !== true || order.inventoryLedgerVersion !== 1){if(inventoryEvidence[order.id])exceptions.push(item("inventory_marker_gap","warning",order.id,`Inventory confirmation marker missing for order ${order.id}`,"Some order-specific inventory movements exist. Use Complete inventory posting to verify the existing evidence and post only proven missing ingredients once.",at,"inventory"));else exceptions.push(item("inventory_gap", "critical", order.id, `Inventory posting missing for order ${order.id}`, "The completed order has no confirmed server inventory deduction or order-specific movement evidence. Investigate before manually adjusting stock.", at, "inventory"));}if (order.paymentStatus !== "pending" && !financial[`sale_${order.id}`]) exceptions.push(item("financial_gap", "critical", order.id, `Accounting posting missing for order ${order.id}`, "The completed order has no immutable sale movement. Open Cash Flow and run the controlled financial audit.", at,"cashflow"));});
  // A positive Undeposited Collection balance is normal custody, not an
  // operational failure. Deposit timing and reconciliation remain controlled
  // in Register Operations, Undeposited Collection, Cash Flow, and Books.
  // The action queue reports the current business day only. Older telemetry
  // remains available in Technical diagnostics as history, not as a live task.
  let proofFailures = 0, clientErrors = 0;const currentTelemetry=Object.values(input.telemetry||{})[0]||{};proofFailures=Number(currentTelemetry.errors&&currentTelemetry.errors.proof_access)||0;Object.keys(currentTelemetry.errors||{}).forEach((key)=>{clientErrors+=Number(currentTelemetry.errors[key])||0;});
  if (proofFailures) exceptions.push(item("payment_proof", "warning", "payment-proof", `${proofFailures} payment-proof failure${proofFailures === 1 ? "" : "s"}`, "Review recent proof access attempts and confirm Storage and getPaymentProof are available.", now, "orders"));
  // Generic browser telemetry belongs in technical diagnostics. It does not
  // identify a business workflow that staff can repair, so it must not enter
  // the operational work queue or imply that normal service is unsafe.
  const clearingThreshold = Number(input.clearingThreshold) > 0 ? Number(input.clearingThreshold) : CLEARING_RESIDUAL_THRESHOLD;
  const clearingBalances = input.booksMonthlyNet ? clearingBalancesFromMonthlyNet(input.booksMonthlyNet) : clearingBalancesFromJournal(input.booksJournal);
  CLEARING_ACCOUNTS.forEach(({code, name}) => {
    const bal = round2(clearingBalances[code] || 0);
    if (Math.abs(bal) > clearingThreshold) exceptions.push(item("clearing_residual", "warning", `clearing_${code}`, `${name} (${code}) has not cleared to zero`, `Books General Ledger shows a ${bal > 0 ? "debit" : "credit"} residual of PHP ${Math.abs(bal).toFixed(2)} in ${code} ${name}. This clearing/suspense account must settle to zero \u2014 review and clear the pending posting in Finance Books.`, now, "cashflow"));
  });
  paymentRoutingIssues(input.payMethods, input.cfAccounts, now).forEach((x) => exceptions.push(x));
  // Shift crew safeguards: a POS sale the server refused is money in the drawer with no
  // sale behind it until management recovers or dismisses it; a handed-over shift has no
  // final Z report until management reconciles it.
  rows(input.posSyncAlerts).forEach((alert) => {if (alert.state !== "open") return;exceptions.push(item("pos_sale_rejected", "critical", alert.id, `POS sale ${alert.orderId || alert.id} was not saved`, `${String(alert.message || "The server refused this sale.").slice(0, 200)} Recover or dismiss it in Register Ops → Sales needing recovery.`, Number(alert.lastAt || alert.firstAt || 0), "ops"));});
  rows(input.pendingShiftHandovers).forEach((handover) => {exceptions.push(item("shift_handover_pending", now - Number(handover.at || 0) > 86400000 ? "critical" : "warning", handover.id, `Shift of ${handover.staff || "a cashier"} has a provisional Z report`, "The server issues the final Z report as soon as every sale is confirmed, and at the latest when the next shift ends. A manager can finalize it sooner in Register Ops.", Number(handover.at || 0), "ops"));});
  // A final Z issued with open items, or re-issued after a late sale changed the cash result.
  rows(input.shiftCloseFollowUps).forEach((row) => {if (row.state !== "open") return;const late = row.kind === "late_sale_variance";exceptions.push(item("shift_close_follow_up", "warning", `close_${row.id}`, late ? `Z report of ${row.staff || "a shift"} changed after a late sale` : row.kind === "z_amendment_failed" ? `Z report of ${row.staff || "a shift"} could not be re-issued` : `Shift of ${row.staff || "a cashier"} closed with open items`, late ? `Cash variance posted at close PHP ${Number(row.postedVariance || 0).toFixed(2)}, recalculated PHP ${Number(row.recalculatedVariance || 0).toFixed(2)}. Settle the difference in Discrepancies, then mark it reviewed in Register Ops.` : "Review the exceptions on its final Z report, recover any sale in Sales needing recovery, then mark it reviewed in Register Ops.", Number(row.at || 0), "ops"));});
  // Sales rung with a missing or broken recipe carry no cost until a manager resolves them.
  const uncostedByItem = {};
  rows(input.uncostedSales).forEach((row) => {if (row.status !== "open") return;const key = String(row.itemKey || "unknown");const group = uncostedByItem[key] || (uncostedByItem[key] = {name: String(row.itemName || key).slice(0, 120), count: 0, firstAt: 0});group.count++;const at = Number(row.occurredAt || 0);if (at && (!group.firstAt || at < group.firstAt)) group.firstAt = at;});
  Object.keys(uncostedByItem).forEach((key) => {const group = uncostedByItem[key];exceptions.push(item("uncosted_sale", "warning", `uncosted_${key}`, `${group.name}: ${group.count} sale${group.count === 1 ? "" : "s"} without recipe cost`, "The sales went through without stock or Cost of Sales for this item. Build or repair its recipe, then resolve them in Recipes \u2192 Sales awaiting cost.", group.firstAt || now, "recipes"));});
  // Background triggers that exhausted their bounded retry window. The event was
  // acknowledged to stop repeated redelivery (and repeated database downloads),
  // so the unfinished work must be visible until it ages out of the window; the
  // posting-specific gap checks above keep flagging any record left incomplete.
  rows(input.deadLetters).forEach((row) => {
    const at = Number(row.abandonedAt || 0);
    if (row.status !== "open" || !at || now - at > DEAD_LETTER_WINDOW_MS) return;
    const params = Object.keys(row.params || {}).map((key) => `${key} ${row.params[key]}`).join(", ");
    exceptions.push(item("background_failure", "critical", row.id, row.functionStopped ? `Background task ${String(row.function || "unknown").slice(0, 80)} stopped for today after repeated failures` : `Background task ${String(row.function || "unknown").slice(0, 80)} stopped retrying`,
      `${params ? params + ": " : ""}${String(row.error || "Unknown error").slice(0, 200)}. ${row.functionStopped ? `More than ${MAX_FAILED_EVENTS_PER_DAY} events of this task failed today (${Number(row.failedEventsToday) || "many"}), so further failures are not retried until tomorrow. Fix the cause first;` : `The system stopped retrying after ${Number(row.attempts) > 1 ? `${Number(row.attempts) - 1} retries` : "its retry limit"} to protect the database;`} confirm the linked record and complete it through its controlled repair workflow.`,
      at, "operations"));
  });
  const rank = {critical: 0, warning: 1};exceptions.sort((a, b) => (rank[a.severity] - rank[b.severity]) || (b.at - a.at));
  return {generatedAt: now, scanned: {activeOrders: active.length, recentOrders: orders.length, offlineSyncs: offline.length, custodyRecords: custody.length}, counts: {critical: exceptions.filter((x) => x.severity === "critical").length, warning: exceptions.filter((x) => x.severity === "warning").length, total: exceptions.length}, exceptions: exceptions.slice(0, 100)};
}
module.exports = {buildOperationalExceptions, DEAD_LETTER_WINDOW_MS, CLEARING_ACCOUNTS, CLEARING_RESIDUAL_THRESHOLD, clearingBalancesFromJournal, clearingBalancesFromMonthlyNet, paymentRoutingIssues};
