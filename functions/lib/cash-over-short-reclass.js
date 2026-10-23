"use strict";
/* Register cash over/short consolidation (owner decision, 23 Oct 2026).

   New unexplained register overages post to 6110 Cash Over / Short beside
   shortages. Overages already posted in the open month went to 4990 Other
   Income through the immutable key revenue:unexplained_cash_overage. This
   module plans one linked reclass movement per source overage (Dr 4990 /
   Cr 6110), dated on the source date, so posted history is never rewritten
   and a re-run can never post twice.

   A source and its reversals are folded together by root movement id; only a
   positive remaining overage is reclassed. A source reversed after it was
   reclassed gets a linked undo (Dr 6110 / Cr 4990) so neither account is left
   with a stray balance. A reversal whose original sits in another month is
   correct as posted and is only reported. */
const crypto = require("node:crypto");

const OVERAGE_KEY = "revenue:unexplained_cash_overage";
const RECLASS_TYPE = "cash_over_short_reclass";
const FROM_ACCOUNT = "coa:4990";
const TO_ACCOUNT = "coa:6110";
const FIRST_MONTH = "2026-10";

function money(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function text(v) { return String(v == null ? "" : v); }

function monthBounds(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(text(month))) throw new Error("Month must be YYYY-MM.");
  const [y, m] = month.split("-").map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  // Accaza books run on Manila business dates (UTC+8, no daylight saving).
  return {start: Date.parse(`${month}-01T00:00:00+08:00`), end: Date.parse(`${next}-01T00:00:00+08:00`) - 1};
}

function reclassMovementId(rootId) {
  const id = `cos_reclass_${text(rootId)}`;
  if (/^[A-Za-z0-9_-]{1,160}$/.test(id)) return id;
  return `cos_reclass_h_${crypto.createHash("sha256").update(text(rootId)).digest("hex").slice(0, 40)}`;
}

function overageNet(movement) {
  return money((movement && Array.isArray(movement.lines) ? movement.lines : []).reduce((sum, line) =>
    sum + (line && line.account === OVERAGE_KEY ? (Number(line.credit) || 0) - (Number(line.debit) || 0) : 0), 0));
}

function plan(movements, month) {
  const bounds = monthBounds(month), all = movements || {}, groups = {}, reclassed = {}, undone = {};
  const inMonth = (m) => { const at = Number(m && (m.occurredAt || m.postedAt) || 0); return at >= bounds.start && at <= bounds.end; };
  // Follow reversal links back to the original source, so a reversal of a
  // reversal (or a date repair's reversal) folds into the first movement.
  const rootOf = (id) => { let cur = text(id); const seen = new Set(); for (;;) { const m = all[cur]; const up = m && text(m.reversesMovementId || m.reversalOf); if (!up || seen.has(cur)) return cur; seen.add(cur); cur = up; } };
  Object.keys(all).forEach((id) => {
    const m = all[id];
    if (!m || typeof m !== "object" || !inMonth(m)) return;
    if (m.type === RECLASS_TYPE) { if (m.reclassUndoOf) undone[text(m.reclassUndoOf)] = id; else if (m.reclassOf) reclassed[text(m.reclassOf)] = id; return; }
    const net = overageNet(m);
    if (Math.abs(net) < 0.005) return;
    const root = rootOf(id);
    const g = groups[root] || (groups[root] = {rootId: root, net: 0, sourceMovementIds: []});
    g.net = money(g.net + net);
    g.sourceMovementIds.push(id);
  });
  Object.keys(reclassed).forEach((root) => { if (!groups[root]) groups[root] = {rootId: root, net: 0, sourceMovementIds: []}; });
  const candidates = [], undo = [], alreadyReclassed = [], skipped = [];
  Object.keys(groups).sort().forEach((root) => {
    const g = groups[root], done = reclassed[root] || "", r = all[root];
    if (done) {
      const reclassAmount = money((all[done].lines || []).reduce((s, l) => s + (l && l.account === FROM_ACCOUNT ? Number(l.debit) || 0 : 0), 0));
      if (undone[root]) { skipped.push({rootId: root, movementId: done, amount: 0, reason: "Reclass already undone after its source was reversed."}); return; }
      if (g.net > 0.005) { alreadyReclassed.push({rootId: root, movementId: done, amount: reclassAmount}); return; }
      // The source was reversed (for example by a date repair) after it was
      // reclassed: post the mirror entry so 4990 and 6110 both return to zero.
      undo.push({rootId: root, movementId: `cos_reclass_undo_${crypto.createHash("sha256").update(root).digest("hex").slice(0, 40)}`, reclassMovementId: done, amount: reclassAmount, occurredAt: Number(all[done].occurredAt || all[done].postedAt), documentNo: text(all[done].reference || root)});
      return;
    }
    if (g.net <= 0.005 || !r || !inMonth(r)) {
      if (Math.abs(g.net) > 0.005) skipped.push({rootId: root, amount: g.net, reason: "Its original overage is dated in another month, which stays as posted; no reclass is needed."});
      return;
    }
    candidates.push({
      rootId: root, movementId: reclassMovementId(root), amount: g.net, occurredAt: Number(r.occurredAt || r.postedAt),
      sourceMovementIds: g.sourceMovementIds.slice().sort(),
      discrepancyId: r.sourceType === "discrepancy" ? text(r.sourceId) : text(r.discrepancyId || r.linkedDiscrepancyId || ""),
      shiftId: text(r.shiftId || ""), documentNo: text(r.documentNo || "")
    });
  });
  return {month, bounds, candidates, undo, alreadyReclassed, skipped, total: money(candidates.reduce((s, c) => s + c.amount, 0) - undo.reduce((s, u) => s + u.amount, 0))};
}

function lines(candidate, line) {
  const label = `Reclass register overage to 6110 Cash Over / Short · ${candidate.documentNo || candidate.rootId}`;
  return [line(FROM_ACCOUNT, candidate.amount, 0, label), line(TO_ACCOUNT, 0, candidate.amount, label)];
}

function undoLines(item, line) {
  const label = `Undo register overage reclass after its source was reversed · ${item.documentNo || item.rootId}`;
  return [line(TO_ACCOUNT, item.amount, 0, label), line(FROM_ACCOUNT, 0, item.amount, label)];
}

module.exports = {OVERAGE_KEY, RECLASS_TYPE, FROM_ACCOUNT, TO_ACCOUNT, FIRST_MONTH, monthBounds, reclassMovementId, overageNet, plan, lines, undoLines};
