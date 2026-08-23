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
// Finance chart-account id -> Accaza Books COA (bills, manual expenses, owner capital/draw, etc.)
const CHART_COA = {
  rent: "6010", utilities: "6020", salaries: "6000", "bank charges": "6080", bank_charges: "6080",
  repairs: "6060", "repairs & maintenance": "6060", marketing: "6050", supplies: "6070",
  internet: "6030", "internet & phone": "6030", depreciation: "6090",
  purchases: "6100", other_expense: "6100", other: "6100", "fixed asset": "1500",
  capital_in: "3000", "capital in": "3000", owner_draw: "3100", "owner draw": "3100",
  sales_revenue: "4000", other_income: "4990"
};
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
    "cogs:beverage": "5000", "cogs:food": "5030", "cogs:packaging": "5040", "cogs:other": "5000", "inventory:control": "1200",
    "asset:accumulated_depreciation": "1590", "expense:depreciation": "6090", "revenue:asset_disposal_gain": "4990", "expense:asset_disposal_loss": "6100",
  };
  if (exact[a]) return {code: exact[a], unmapped: false};
  if (a === "revenue:sales") return {code: CHANNEL_SALES[String(channel || "instore").toLowerCase()] || "4000", unmapped: false};
  if (a.indexOf("asset:cash_account:") === 0) { const id = a.split(":")[2] || ""; return {code: cashAccountMap[id] || "1010", unmapped: false}; }
  if (a.indexOf("asset:platform_receivable:") === 0 || a.indexOf("asset:platform_clearing:") === 0) return {code: "1100", unmapped: false};
  if (a.indexOf("asset:receivable:") === 0) return {code: "1110", unmapped: false};
  if (a.indexOf("asset:fixed_asset:") === 0) return {code: a.split(":")[2] === "furniture" ? "1510" : "1500", unmapped: false};
  if (a.indexOf("liability:payable:") === 0) return {code: "2000", unmapped: false};
  var seg = a.indexOf(":") >= 0 ? a.slice(a.indexOf(":") + 1).toLowerCase() : "";
  if (a.indexOf("expense_or_inventory:") === 0) return CHART_COA[seg] ? {code: CHART_COA[seg], unmapped: false} : {code: "6100", unmapped: true};
  if (CHART_COA[seg]) return {code: CHART_COA[seg], unmapped: false};
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

/* Build Dr COGS (by category) / Cr Inventory lines from an order's cogs snapshot. */
function cogsLines(order){
  var total = r2(order && order.cogsSnapshot);
  if(!(total>0)) return [];
  var cat = (order && order.cogsCategorySnapshot) || {};
  var bev = r2((Number(cat.beverage)||0) + (Number(cat.directLabor)||0) + (Number(cat.unallocated)||0));
  var food = r2(Number(cat.food)||0);
  var pack = r2(Number(cat.packaging)||0);
  var catSum = r2(bev+food+pack);
  if(Math.abs(catSum-total) >= 0.005){ bev = r2(bev + (total-catSum)); } // reconcile buckets to the authoritative total
  var lines=[];
  if(bev>0) lines.push({account:"cogs:beverage", debit:bev, credit:0});
  if(food>0) lines.push({account:"cogs:food", debit:food, credit:0});
  if(pack>0) lines.push({account:"cogs:packaging", debit:pack, credit:0});
  var creditTotal = r2(bev+food+pack);
  if(creditTotal>0) lines.push({account:"inventory:control", debit:0, credit:creditTotal});
  return lines;
}

/* Pseudo-movement so COGS folds into the same daily-summary-per-channel entry as the sale. */
function cogsMovement(order, orderId){
  return {
    id: "cogs_" + orderId, type: "order_cogs", sourceType: "order",
    channel: String((order && order.channel) || "instore").toLowerCase(),
    occurredAt: Number(order && (order.completedAt || order.receivedAt || order.occurredAt)) || Date.now(),
    lines: cogsLines(order)
  };
}

/* Straight-line monthly depreciation and net book value (shared by server + register UI). */
function monthlyStraightLine(cost, salvage, usefulLifeMonths){
  var dep = r2((Number(cost)||0) - Math.max(0, Number(salvage)||0));
  var life = Math.max(1, Math.round(Number(usefulLifeMonths)||0));
  return r2(dep / life);
}
function netBookValue(asset){
  if(!asset) return 0;
  return r2((Number(asset.cost)||0) - (Number(asset.accumulatedDepreciation)||0));
}

module.exports = {CHANNEL_SALES, r2, businessDate, mapAccount, isSaleMovement, bucketFor, mappedLines, applyDaily, buildSingle, netToLines, linesBalanced, cogsLines, cogsMovement, monthlyStraightLine, netBookValue};
