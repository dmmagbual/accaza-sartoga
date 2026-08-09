"use strict";

function money(value) { return Math.round((Number(value) || 0) * 100) / 100; }
function safe(value) { return String(value == null ? "" : value).trim().slice(0, 160); }
function line(account, debit, credit, label) {
  return {account: safe(account), debit: money(debit), credit: money(credit), label: safe(label)};
}
function totals(lines) {
  return (lines || []).reduce((out, item) => {
    out.debit = money(out.debit + money(item.debit));
    out.credit = money(out.credit + money(item.credit));
    return out;
  }, {debit: 0, credit: 0});
}
function assertBalanced(lines) {
  const sum = totals(lines);
  if (Math.abs(sum.debit - sum.credit) > 0.009) throw new Error(`Unbalanced financial movement: debit ${sum.debit}, credit ${sum.credit}`);
  return sum;
}
function paymentRows(order) {
  const rows = Array.isArray(order && order.payments) && order.payments.length ? order.payments : [{method: order && order.payment, amount: order && order.total}];
  return rows.map((row) => ({method: safe(row.method || "Unknown"), amount: money(row.amount)})).filter((row) => row.amount > 0);
}
function accountForMethod(method, accounts) {
  const wanted = safe(method).toLowerCase(); let match = "";
  Object.keys(accounts || {}).forEach((id) => {
    const methods = Array.isArray(accounts[id] && accounts[id].feedMethods) ? accounts[id].feedMethods : [];
    if (methods.some((name) => safe(name).toLowerCase() === wanted)) match = id;
  });
  return match;
}
function orderPosting(order, accounts) {
  order = order || {}; const id = safe(order.id); if (!id) throw new Error("Order ID is required.");
  const channel = safe(order.channel || "instore").toLowerCase();
  const lines = [], cashEntries = [], warnings = [];
  if (channel !== "instore") {
    const gross = money(order.grossPlatform != null ? order.grossPlatform : (order.subtotal != null ? order.subtotal : order.total));
    const commission = money(order.commission), discount = money(order.platformDiscount), wht = money(order.platformWht), vat = money(order.platformVat);
    const net = money(order.netPlatform != null ? order.netPlatform : gross - commission - discount - wht - vat);
    lines.push(line(`asset:platform_receivable:${channel}`, net, 0, "Platform receivable"));
    if (commission) lines.push(line("expense:platform_commission", commission, 0, "Platform commission"));
    if (discount) lines.push(line("expense:platform_discount", discount, 0, "Platform discount"));
    if (wht) lines.push(line("asset:withholding_tax", wht, 0, "Withholding tax receivable"));
    if (vat) lines.push(line("expense:platform_service_vat", vat, 0, "Platform service VAT"));
    const debits = totals(lines).debit;
    if (Math.abs(debits - gross) > 0.009) lines.push(line(debits < gross ? "expense:platform_estimate_variance" : "revenue:platform_estimate_variance", debits < gross ? money(gross - debits) : 0, debits > gross ? money(debits - gross) : 0, "Platform estimate rounding/variance"));
    lines.push(line("revenue:sales", 0, gross, "Platform gross sales"));
  } else {
    const payments = paymentRows(order); const total = money(order.total);
    payments.forEach((payment, index) => {
      const isCash = payment.method.toLowerCase() === "cash";
      const accountId = isCash ? "" : accountForMethod(payment.method, accounts);
      const asset = isCash ? "asset:register_cash" : (accountId ? `asset:cash_account:${accountId}` : `asset:unmapped_payment:${payment.method.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`);
      lines.push(line(asset, payment.amount, 0, payment.method));
      if (!isCash && accountId) {const slug = payment.method.replace(/[^A-Za-z0-9]/g, "") || String(index); cashEntries.push({id: `cfauto_${id}_${slug}`, accountId, dir: "in", amount: payment.amount, category: `Sale · ${payment.method}`, method: payment.method});}
      if (!isCash && !accountId) warnings.push(`No cash-flow account mapping for ${payment.method}.`);
    });
    const paid = totals(lines).debit;
    if (Math.abs(paid - total) > 0.009) lines.push(line(paid < total ? "asset:unmapped_payment:balance" : "revenue:payment_overage", paid < total ? money(total - paid) : 0, paid > total ? money(paid - total) : 0, "Payment allocation difference"));
    lines.push(line("revenue:sales", 0, total, "In-store sales"));
  }
  const sum = assertBalanced(lines);
  return {type: "order_sale", sourceType: "order", sourceId: id, channel, amount: sum.credit, lines, cashEntries, warnings};
}
function reversalPosting(order, amount, kind, accounts, settlementPayments) {
  order = order || {}; const value = money(amount); if (!(value > 0)) throw new Error("Reversal amount must be positive.");
  const channel = safe(order.channel || "instore").toLowerCase(); const lines = [], cashEntries = [], warnings = [];
  lines.push(line("revenue:sales_reversal", value, 0, kind === "void" ? "Voided sale" : "Sales refund"));
  if (channel !== "instore") lines.push(line(`asset:platform_receivable:${channel}`, 0, value, "Reduce platform receivable"));
  else {
    let settlements = Array.isArray(settlementPayments) ? settlementPayments.map((row) => ({method: safe(row.method), amount: money(row.amount)})).filter((row) => row.method && row.amount > 0) : [];
    if (!settlements.length) {const payments = paymentRows(order), cash = payments.find((row) => row.method.toLowerCase() === "cash"), chosen = cash || payments[0] || {method: "Cash"}; settlements = [{method: chosen.method, amount: value}];}
    if (Math.abs(settlements.reduce((sum, row) => money(sum + row.amount), 0) - value) > 0.009) throw new Error("Refund/void tender allocations must equal the reversal amount.");
    settlements.forEach((chosen) => {if (chosen.method.toLowerCase() === "cash") lines.push(line("asset:register_cash", 0, chosen.amount, "Refund/void settlement")); else { const accountId = accountForMethod(chosen.method, accounts || {}); lines.push(line(accountId ? `asset:cash_account:${accountId}` : `asset:unmapped_payment:${chosen.method.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`, 0, chosen.amount, "Refund/void settlement")); if (accountId) cashEntries.push({id: "", accountId, dir: "out", amount: chosen.amount, category: kind === "void" ? "Void reversal" : "Refund", method: chosen.method}); else warnings.push(`No cash-flow account mapping for ${chosen.method}.`); }});
  }
  assertBalanced(lines);
  return {type: kind === "void" ? "order_void" : "order_refund", sourceType: "order", sourceId: safe(order.id), channel, amount: value, lines, cashEntries, warnings, settlementPayments: Array.isArray(settlementPayments) ? settlementPayments : []};
}
function movement(type, sourceType, sourceId, lines, extra) {
  assertBalanced(lines); return Object.assign({type: safe(type), sourceType: safe(sourceType), sourceId: safe(sourceId), amount: totals(lines).debit, lines, warnings: []}, extra || {});
}

module.exports = {money, safe, line, totals, assertBalanced, accountForMethod, orderPosting, reversalPosting, movement};
