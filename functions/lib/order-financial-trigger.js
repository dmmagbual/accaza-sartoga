"use strict";

// A whole-order write is also emitted for kitchen, service and inventory metadata.
// Finance only needs to start work when a sale first becomes postable, a confirmed
// pre-completion cash refund changes, a refund grows, or the order is newly voided.
// Keep this decision independent of Firebase so it can be regression-tested directly.
function money(value) { return Math.round((Number(value) || 0) * 100) / 100; }

function postableSale(order) {
  const status = order && order.status === "Archived" ? order.prevStatus : order && order.status;
  // A sale is a sale (Danilo, 29 Oct 2026): it posts when completed, verified or not. An unverified
  // electronic payment posts to 1060 Payments Awaiting Verification instead of the bank.
  return Boolean(order && ["Completed", "Received"].includes(String(status || "")));
}

function preCompletionRefundAmount(order) {
  return money(order && order.preCompletionCashRefund && order.preCompletionCashRefund.amount);
}

function requiresFinancialPosting(before, after) {
  before = before || {};
  after = after || {};
  if (postableSale(after) && !postableSale(before)) return true;
  if (preCompletionRefundAmount(after) !== preCompletionRefundAmount(before)) return true;
  if (money(after.refundAmount) > money(before.refundAmount)) return true;
  return after.voided === true && before.voided !== true;
}

module.exports = {money, postableSale, preCompletionRefundAmount, requiresFinancialPosting};
