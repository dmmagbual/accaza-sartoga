"use strict";

function periodKey(value) {
  const period = String(value || "").trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new Error("Accounting period must use YYYY-MM.");
  return period;
}

function periodForDate(value) {
  if (typeof value === "number") {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) throw new Error("A valid accounting date is required.");
    const parts = new Intl.DateTimeFormat("en-CA", {timeZone: "Asia/Manila", year: "numeric", month: "2-digit"}).formatToParts(date);
    const map = {}; parts.forEach((part) => { map[part.type] = part.value; });
    return periodKey(`${map.year}-${map.month}`);
  }
  return periodKey(String(value || "").slice(0, 7));
}

function isClosed(record) { return !!record && record.status === "closed"; }

function transition(current, action, period, actor, reason, now) {
  const prior = current && typeof current === "object" ? current : {};
  const target = action === "close" ? "closed" : action === "reopen" ? "open" : "";
  if (!target) throw new Error("Accounting-period action must be close or reopen.");
  if (prior.status === target) return prior;
  const revision = Number(prior.revision || 0) + 1;
  const event = {revision, action, status: target, reason, changedAt: now, changedBy: actor.uid, changedByRole: actor.role};
  return Object.assign({}, prior, {
    period, status: target, revision, updatedAt: now, updatedBy: actor.uid, updatedByRole: actor.role,
    history: Object.assign({}, prior.history || {}, {[String(revision)]: event}),
    closedAt: target === "closed" ? now : prior.closedAt || null,
    closedBy: target === "closed" ? actor.uid : prior.closedBy || null,
    closeReason: target === "closed" ? reason : prior.closeReason || "",
    reopenedAt: target === "open" ? now : prior.reopenedAt || null,
    reopenedBy: target === "open" ? actor.uid : prior.reopenedBy || null,
    reopenReason: target === "open" ? reason : prior.reopenReason || ""
  });
}

// A month cannot be closed while sales dated in it still sit in 1060 Payments Awaiting
// Verification (Danilo, 2 Nov 2026). Verifying after the close would post Dr bank / Cr 1060 on
// the verification date instead of the sale date, so the closed month's bank balance would no
// longer match the bank or e-wallet statement. Rows dated in other months do not block. A row
// whose date or amount cannot be read fails closed: it is reported and blocks every close until
// it is resolved. Amounts are summed in whole centavos.
function manilaDay(at) {
  const date = new Date(at);
  if (!Number.isFinite(date.getTime())) throw new Error("A valid sale time is required.");
  return new Intl.DateTimeFormat("en-CA", {timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit"}).format(date);
}
function verificationRowDate(row) {
  const text = String(row.saleDate || "").slice(0, 10);
  if (/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(text)) return text;
  return row.saleAt != null && row.saleAt !== "" ? manilaDay(Number(row.saleAt)) : "";
}
function openPaymentVerificationsForPeriod(queue, period) {
  const target = periodKey(period), rows = [], unreadable = [];
  Object.keys(queue && typeof queue === "object" ? queue : {}).forEach((key) => {
    const row = queue[key];
    if (row == null) return;
    const orderId = String((row && row.orderId) || key);
    let saleDate = "";
    try { saleDate = row && typeof row === "object" ? verificationRowDate(row) : ""; } catch (error) { saleDate = ""; }
    const cents = Math.round(Number(row && row.amount) * 100), amountOk = Number.isFinite(cents) && cents > 0;
    if (!saleDate || !amountOk) { unreadable.push({orderId, saleDate, amount: amountOk ? cents / 100 : null}); return; }
    if (saleDate.slice(0, 7) !== target) return;
    rows.push({orderId, saleDate, cents});
  });
  rows.sort((a, b) => a.saleDate.localeCompare(b.saleDate) || a.orderId.localeCompare(b.orderId));
  unreadable.sort((a, b) => a.orderId.localeCompare(b.orderId));
  const totalCents = rows.reduce((sum, row) => sum + row.cents, 0);
  return {count: rows.length, total: totalCents / 100, rows: rows.map((row) => ({orderId: row.orderId, saleDate: row.saleDate, amount: row.cents / 100})), unreadable};
}

// Payments still in 1060 whose sale month is already closed (a late offline sync after the close, or
// a month closed before this control existed). Verifying them posts the bank receipt on the
// verification date, so each closed month is listed once for System Health. Centavo totals.
function paymentVerificationsInClosedPeriods(queue, periods) {
  const byPeriod = {};
  Object.keys(queue && typeof queue === "object" ? queue : {}).forEach((key) => {
    const row = queue[key];
    if (!row || typeof row !== "object") return;
    let saleDate = "";
    try { saleDate = verificationRowDate(row); } catch (error) { return; }
    const period = saleDate.slice(0, 7), cents = Math.round(Number(row.amount) * 100);
    if (!saleDate || !isClosed(periods && periods[period])) return;
    // A row with an unreadable amount still counts: the month is listed even if the total is short.
    const group = byPeriod[period] || (byPeriod[period] = {period, count: 0, cents: 0, orderIds: []});
    group.count += 1; group.cents += Number.isFinite(cents) && cents > 0 ? cents : 0; group.orderIds.push(String(row.orderId || key));
  });
  return Object.keys(byPeriod).sort().map((period) => { const group = byPeriod[period]; return {period, count: group.count, total: group.cents / 100, orderIds: group.orderIds.sort()}; });
}

module.exports = {periodKey, periodForDate, isClosed, transition, openPaymentVerificationsForPeriod, paymentVerificationsInClosedPeriods};
