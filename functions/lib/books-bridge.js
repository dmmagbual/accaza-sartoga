"use strict";
/* ============================================================
   Accaza Books — POS → journal bridge (server side)
   Maps POS financialMovements (see ./financial.js) into Accaza
   Books journal entries under /books/journal.

   Sale movements (order_sale / order_void / order_refund) are
   rolled up into ONE daily-summary-per-channel entry keyed
   `${businessDate}_${channel}`. All other movements (purchases,
   payroll, transfers, capital, payouts) post as their own
   discrete entry keyed by the movement id.

   Pure + idempotent: every accumulation is guarded by
   sources[movementId] so a re-fired trigger never double-counts.
   No amount is re-derived — only account-string → COA mapping.
   ============================================================ */

const CHANNEL_SALES = {instore: "4000", online: "4010", grabfood: "4020", foodpanda: "4030"};
const MANILA = new Intl.DateTimeFormat("en-US", {timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit"});

function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

function businessDate(ms) {
  const parts = MANILA.formatToParts(new Date(Number(ms) || Date.now())), map = {};
  parts.forEach((p) => { map[p.type] = p.value; });
  return `${map.year}-${map.month}-${map.day}`;
}

/* POS account string → {code, unmapped}. cashAccountMap: POS cash-flow accountId → COA code. */
function mapAccount(posAccount, channel, cashAccountMap) {
  const a = String(posAccount || "");
  cashAccountMap = cashAccountMap || {};
  const exact = {
    "asset:register_cash": "1000", "asset:cash_awaiting_deposit": "1030", "asset:petty_cash": "1040",
    "asset:withholding_tax": "1260", "revenue:sales_reversal": "4900",
    "revenue:cash_overage": "6110", "revenue:payment_overage": "4990",
    "expense:cash_shortage": "6110", "expense:platform_commission": "6040",
    "expense:platform_discount": "6045", "expense:platform_service_vat": "6046",
    "expense:platform_estimate_variance": "6100", "revenue:platform_estimate_variance": "4990",
    "equity:owner_capital": "3000", "equity:opening_balance": "3900", "equity:cash_float_source": "3050",
  };
  if (exact[a]) return {code: exact[a], unmapped: false};
  if (a === "revenue:sales") return {code: CHANNEL_SALES[String(channel || "instore").toLowerCase()] || "4000", unmapped: false};
  if (a.indexOf("asset:cash_account:") === 0) { const id = a.split(":")[2] || ""; return {code: cashAccountMap[id] || "1010", unmapped: false}; }
  if (a.indexOf("asset:platform_receivable:") === 0 || a.indexOf("asset:platform_clearing:") === 0) return {code: "1100", unmapped: false};
  if (a.indexOf("asset:receivable:") === 0) return {code: "1110", unmapped: false};
  if (a.indexOf("liability:payable:") === 0) return {code: "2000", unmapped: false};
  if (a.indexOf("revenue:") === 0) return {code: "4990", unmapped: true};
  if (a.indexOf("expense:") === 0) return {code: "6100", unmapped: true};
  return {code: "1900", unmapped: true};
}

function isSaleMovement(mv) {
  const t = String(mv && mv.type || "");
  return mv && (mv.sourceType === "order" || t === "order_sale" || t === "order_void" || t === "order_refund");
}

/* Key + channel for a movement. */
function bucketFor(mv) {
  const date = businessDate(mv && (mv.occurredAt || mv.postedAt));
  if (isSaleMovement(mv)) {
    const channel = String(mv.channel || "instore").toLowerCase();
    return {mode: "daily", key: `${date}_${channel}`, date, channel};
  }
  return {mode: "single", key: String(mv.id || mv.sourceId || ""), date, channel: String(mv.channel || "").toLowerCase()};
}

function mappedLines(mv, cashMap) {
  const channel = String(mv.channel || "instore").toLowerCase(), unmapped = [];
  const out = (mv.lines || []).map((l) => {
    const m = mapAccount(l.account, channel, cashMap);
    if (m.unmapped) unmapped.push({account: l.account, code: m.code});
    return {code: m.code, debit: r2(l.debit), credit: r2(l.credit), posAccount: String(l.account || "")};
  });
  return {lines: out, unmapped};
}

/* Idempotently fold a sale movement into a daily-summary node (RTDB transaction body).
   Returns the new node, or undefined to abort (already applied / not a sale). */
function applyDaily(current, mv, cashMap) {
  const b = bucketFor(mv);
  if (b.mode !== "daily") return undefined;
  const node = current || {date: b.date, channel: b.channel, ref: `POS-${b.date.replace(/-/g, "")}-${b.channel.toUpperCase()}`,
    net: {}, sources: {}, sourceCount: 0, source: "pos-bridge", memo: `POS daily summary — ${b.channel}`};
  if (node.sources && node.sources[mv.id]) return undefined; // already applied → abort, no double count
  const {lines} = mappedLines(mv, cashMap);
  node.net = node.net || {};
  lines.forEach((l) => { node.net[l.code] = r2((node.net[l.code] || 0) + l.debit - l.credit); });
  node.sources = node.sources || {}; node.sources[mv.id] = true;
  node.sourceCount = Object.keys(node.sources).length;
  return node;
}

/* Build a discrete journal entry for a non-sale movement. */
function buildSingle(mv, cashMap) {
  const b = bucketFor(mv);
  const {lines, unmapped} = mappedLines(mv, cashMap);
  return {
    entry: {
      id: b.key, date: b.date, ref: String(mv.sourceId || mv.id || ""),
      memo: `POS ${String(mv.type || "movement").replace(/_/g, " ")}${mv.sourceId ? " · " + mv.sourceId : ""}`,
      lines: lines.map((l) => ({code: l.code, debit: l.debit, credit: l.credit})),
      sources: {[mv.id]: true}, source: "pos-bridge", sourceType: String(mv.sourceType || ""), sourceId: String(mv.sourceId || ""),
    },
    unmapped,
  };
}

/* Convert a stored daily node's net map into balanced debit/credit lines (for the reader/tests). */
function netToLines(net) {
  return Object.keys(net || {}).filter((c) => Math.abs(net[c]) >= 0.005).sort().map((code) => {
    const v = net[code]; return {code, debit: v > 0 ? v : 0, credit: v < 0 ? -v : 0};
  });
}
function linesBalanced(lines) {
  let dr = 0, cr = 0; (lines || []).forEach((l) => { dr += Number(l.debit) || 0; cr += Number(l.credit) || 0; });
  return Math.abs(r2(dr) - r2(cr)) < 0.005;
}

module.exports = {CHANNEL_SALES, r2, businessDate, mapAccount, isSaleMovement, bucketFor, mappedLines, applyDaily, buildSingle, netToLines, linesBalanced};
