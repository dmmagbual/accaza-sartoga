"use strict";

const Financial = require("./financial");

function paymentKind(order) {
  const payments = Array.isArray(order && order.payments) && order.payments.length ? order.payments : [{method: order && order.payment, amount: order && order.total}];
  if (payments.length !== 1) return "";
  const row = payments[0] || {}, base = String(row.paymentMethod || row.method || "").split(" · ")[0].trim().toLowerCase();
  if (base === "gcash") return "gcash";
  if (base === "bank transfer") return "bank_transfer";
  return "";
}

function currentLines(order) {
  return Array.isArray(order && order.correctedLineItems) && order.correctedLineItems.length ? order.correctedLineItems : Array.isArray(order && order.lineItems) ? order.lineItems : [];
}

function cogsCorrectionLines(originalSnapshot, correctedSnapshot) {
  const before = originalSnapshot || {}, after = correctedSnapshot || {}, keys = new Set([...Object.keys(before), ...Object.keys(after)]), lines = [];
  [...keys].sort().forEach((key) => {
    const parts = String(key).split("|"), inventory = /^12\d{2}$/.test(parts[0] || "") ? parts[0] : "1290", cost = /^(?:5\d{3}|60\d{2})$/.test(parts[1] || "") ? parts[1] : "5090";
    const delta = Financial.money(Number(after[key] || 0) - Number(before[key] || 0));
    if (delta > 0) {
      lines.push(Financial.line(`coa:${cost}`, delta, 0, "Corrected order COGS"));
      lines.push(Financial.line(`coa:${inventory}`, 0, delta, "Corrected order inventory"));
    } else if (delta < 0) {
      lines.push(Financial.line(`coa:${inventory}`, -delta, 0, "Reverse excess order inventory usage"));
      lines.push(Financial.line(`coa:${cost}`, 0, -delta, "Reverse excess order COGS"));
    }
  });
  return lines;
}

function movement(order, correctedPlan, refund, accounts) {
  const value = Financial.money(refund), cogs = cogsCorrectionLines(order && order.cogsAccountSnapshot, correctedPlan && correctedPlan.accountSnapshot);
  let result = null;
  if (value > 0) result = Financial.reversalPosting(order, value, "refund", accounts || {}, [{method: "Cash", amount: value}]);
  if (!result && cogs.length) result = Financial.movement("completed_order_item_correction", "order", String(order && order.id || ""), cogs);
  else if (result && cogs.length) { result.lines = result.lines.concat(cogs); Financial.assertBalanced(result.lines); result.amount = Financial.totals(result.lines).debit; }
  if (result) result.type = "completed_order_item_correction";
  return result;
}

module.exports = {paymentKind, currentLines, cogsCorrectionLines, movement};
