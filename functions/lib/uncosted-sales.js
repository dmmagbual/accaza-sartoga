"use strict";
// Sales without a usable recipe (24 Sep 2026).
//
// A paid sale is never refused, and a shift is never blocked, because an item's recipe is
// missing or broken. The line that cannot be costed takes no stock and carries no cost; it is
// recorded in /uncostedSales so a manager can resolve it later, either by applying the recipe
// once it is built (stock and Cost of Sales are then posted as a separate, linked correction)
// or by confirming that the item genuinely carries no cost.
//
// Everything here is pure: no database access, so the rules are unit-testable.
const Costing = require("./costing");
const BooksBridge = require("./books-bridge");

const SCHEMA_VERSION = 1;
const COVERAGE_WARNINGS = ["MISSING_COST", "MISSING_RECIPE", "UNMAPPED_OPTION", "UNMAPPED_SERVE_STYLE"];
const REASON_LABELS = {missing_recipe: "No recipe", broken_recipe: "Recipe needs repair", invalid_line: "Sale line is incomplete"};

function n(value) { const x = Number(value); return Number.isFinite(x) ? x : 0; }
function q6(value) { return Math.round(n(value) * 1000000) / 1000000; }
function money(value) { return Math.round(n(value) * 100) / 100; }
function isObject(value) { return !!value && typeof value === "object" && !Array.isArray(value); }
function text(value, max) { return String(value == null ? "" : value).trim().slice(0, max || 160); }

// The database drops empty objects, so a plan whose usage is {} is stored without `usage`.
// A server plan with no usage and no cost is therefore an empty plan, not a missing one.
function validPlan(plan) {
  return !!(plan && plan.capturedBy === "server" && Number(plan.schemaVersion) === 1 &&
    (isObject(plan.usage) || (plan.usage == null && !(n(plan.totalCost) > 0))));
}
function planUsage(plan) { return isObject(plan && plan.usage) ? plan.usage : {}; }

function uncostedLine(li, lineIndex, item, result) {
  const key = li && li.itemKey ? text(li.itemKey, 160) : "";
  const qty = Number(li && li.qty);
  const invalid = !key || !Number.isFinite(qty) || qty <= 0;
  const errors = (result && result.errors) || [];
  const codes = invalid ? ["INVALID_ORDER_LINE"] : errors.length ? [...new Set(errors.map((row) => text(row.code, 60)))] : ["MISSING_RECIPE"];
  const reason = invalid ? "invalid_line" : errors.length ? "broken_recipe" : "missing_recipe";
  const message = invalid ? "The sale line has no menu item or quantity." : errors.length ? text(errors[0].message, 240) : `${text(item.name || li.name || key, 120)} has no recipe.`;
  return {
    lineIndex, itemKey: key, itemName: text(item.name || (li && li.name) || key || "Unknown item", 160),
    size: text(li && li.size, 8), qty: invalid ? 0 : qty,
    optLabels: Array.isArray(li && li.optLabels) ? li.optLabels.map((label) => text(label, 80)).filter(Boolean).slice(0, 20) : [],
    reason, codes: codes.slice(0, 10), message,
  };
}

// Costs every line of an order. A line whose recipe is missing or broken is excluded as a
// whole (no ingredients, no packaging, no cost) and reported in `uncosted`. When nothing needs
// excluding, the result is exactly Costing.costOrder's, so fully costed sales are unchanged.
function costOrderTolerant(ctx) {
  ctx = ctx || {};
  const menu = ctx.menuItems || {}, whole = Costing.costOrder(ctx);
  const confirmedNoRecipe = (li) => !!(li && li.itemKey && menu[li.itemKey] && menu[li.itemKey].noRecipe === true);
  const needsSplit = !whole.ok || whole.warnings.some((row) => row.code === "MISSING_RECIPE" && !(menu[row.itemKey] && menu[row.itemKey].noRecipe === true));
  const covered = (warnings) => !warnings.some((row) => COVERAGE_WARNINGS.includes(row.code) && !(row.code === "MISSING_RECIPE" && menu[row.itemKey] && menu[row.itemKey].noRecipe === true));
  if (!needsSplit) return Object.assign(whole, {cogsCovered: covered(whole.warnings), uncosted: []});
  let lines = [], warnings = [];
  const usage = {}, uncosted = [];
  (ctx.lineItems || []).forEach((li, lineIndex) => {
    const result = Costing.costOrder(Object.assign({}, ctx, {lineItems: [li]})), item = (li && menu[li.itemKey]) || {};
    const missing = result.warnings.some((row) => row.code === "MISSING_RECIPE");
    if (!result.ok || (missing && !confirmedNoRecipe(li))) { uncosted.push(uncostedLine(li, lineIndex, item, result)); return; }
    lines = lines.concat(result.lines);
    warnings = warnings.concat(result.warnings);
    Object.keys(result.usage).forEach((id) => { usage[id] = q6((usage[id] || 0) + result.usage[id]); });
  });
  return {
    ok: true, engineVersion: whole.engineVersion, usage, lines,
    totalCost: money(lines.reduce((sum, line) => sum + n(line.totalCost), 0)),
    cogsCovered: !uncosted.length && covered(warnings),
    errors: [], warnings, uncosted,
  };
}

// Plans written before this release recorded a missing recipe only as a warning.
function legacyUncostedLines(plan, lineItems, menu) {
  const keys = new Set(((plan && plan.warnings) || []).filter((row) => row && row.code === "MISSING_RECIPE").map((row) => String(row.itemKey || "")));
  if (!keys.size) return [];
  const out = [];
  (Array.isArray(lineItems) ? lineItems : []).forEach((li, lineIndex) => {
    const key = li && li.itemKey ? String(li.itemKey) : "", item = (menu || {})[key] || {};
    if (!keys.has(key) || item.noRecipe === true) return;
    out.push(uncostedLine(li, lineIndex, item, {errors: []}));
  });
  return out;
}
function planUncostedLines(plan, lineItems, menu) {
  if (plan && Array.isArray(plan.uncostedLines)) return plan.uncostedLines.filter(Boolean);
  if (plan && isObject(plan.uncostedLines)) return Object.values(plan.uncostedLines).filter(Boolean);
  return legacyUncostedLines(plan, lineItems, menu);
}

function rowId(orderId, variant, lineIndex) { return `${text(orderId, 120)}__${text(variant || "sale", 30)}_${Number(lineIndex) || 0}`; }

function registerRows(input) {
  const order = input.order || {}, orderId = text(input.orderId || order.id, 120), variant = text(input.variant || "sale", 30), rows = {};
  (input.lines || []).forEach((line) => {
    const id = rowId(orderId, variant, line.lineIndex);
    rows[id] = {
      id, orderId, variant, lineIndex: Number(line.lineIndex) || 0, itemKey: text(line.itemKey, 160), itemName: text(line.itemName, 160),
      size: text(line.size, 8), qty: n(line.qty), optLabels: Array.isArray(line.optLabels) ? line.optLabels : [],
      reason: REASON_LABELS[line.reason] ? line.reason : "missing_recipe", codes: Array.isArray(line.codes) ? line.codes : [], message: text(line.message, 240),
      shiftId: text(order.shiftId, 120), channel: text(order.channel || "instore", 30),
      occurredAt: n(order.completedAt || order.receivedAt || order.timestamp) || n(input.now),
      businessDate: text(input.businessDate, 10), status: "open", createdAt: n(input.now), schemaVersion: SCHEMA_VERSION,
    };
  });
  return rows;
}

// Dr Cost of Sales / Cr Inventory from the stock movements the correction actually applied, so
// the General Ledger moves by exactly the value that left the stock ledger.
function financeLines(movements, inventory, label) {
  const byKey = {};
  (movements || []).forEach((movement) => {
    const amount = money(Math.abs(n(movement && movement.totalCost)));
    if (!amount) return;
    const mapping = BooksBridge.itemAccounts((inventory || {})[movement.itemId] || {});
    const key = mapping.inventory && mapping.cost ? `${mapping.inventory}|${mapping.cost}` : "1290|5090";
    byKey[key] = money((byKey[key] || 0) + amount);
  });
  const lines = [];
  Object.keys(byKey).sort().forEach((key) => {
    const [inventoryCode, costCode] = key.split("|"), amount = byKey[key];
    lines.push({account: `coa:${costCode}`, debit: amount, credit: 0, label: text(label, 200)});
    lines.push({account: `coa:${inventoryCode}`, debit: 0, credit: amount, label: text(label, 200)});
  });
  return lines;
}

// A row can be costed now only when its recipe is complete: no errors and no missing recipe.
function costRow(row, catalog) {
  const line = {itemKey: row.itemKey, size: row.size, qty: row.qty, optLabels: row.optLabels || []};
  const result = Costing.costOrder(Object.assign({}, catalog, {lineItems: [line]}));
  const missing = result.warnings.some((w) => w.code === "MISSING_RECIPE");
  if (!result.ok || missing) {
    const first = result.errors[0] || result.warnings.find((w) => w.code === "MISSING_RECIPE") || {};
    return {ok: false, message: text(first.message || "The recipe is not complete.", 240), codes: [...new Set(result.errors.map((e) => e.code))].concat(missing ? ["MISSING_RECIPE"] : [])};
  }
  return {ok: true, usage: result.usage, totalCost: result.totalCost, lines: result.lines, warnings: result.warnings};
}

function summarize(rows) {
  const groups = {};
  Object.keys(rows || {}).forEach((id) => {
    const row = rows[id] || {};
    if (row.status !== "open" && row.status !== "applying") return;
    const key = row.itemKey || "__unknown";
    const group = groups[key] || (groups[key] = {itemKey: row.itemKey || "", itemName: row.itemName || "Unknown item", count: 0, qty: 0, firstAt: 0, lastAt: 0, reasons: {}, rows: []});
    group.count++; group.qty = q6(group.qty + n(row.qty));
    const at = n(row.occurredAt);
    if (at && (!group.firstAt || at < group.firstAt)) group.firstAt = at;
    if (at > group.lastAt) group.lastAt = at;
    group.reasons[row.reason] = (group.reasons[row.reason] || 0) + 1;
    group.rows.push({id, orderId: row.orderId, occurredAt: at, businessDate: row.businessDate, qty: n(row.qty), size: row.size || "", optLabels: row.optLabels || [], reason: row.reason, message: row.message || "", status: row.status});
  });
  return Object.values(groups).sort((a, b) => b.count - a.count || String(a.itemName).localeCompare(String(b.itemName)))
    .map((group) => Object.assign(group, {rows: group.rows.sort((a, b) => a.occurredAt - b.occurredAt)}));
}

module.exports = {SCHEMA_VERSION, REASON_LABELS, validPlan, planUsage, costOrderTolerant, legacyUncostedLines, planUncostedLines, rowId, registerRows, financeLines, costRow, summarize};
