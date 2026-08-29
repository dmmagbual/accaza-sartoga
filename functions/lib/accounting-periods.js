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

module.exports = {periodKey, periodForDate, isClosed, transition};
