"use strict";

function money(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

const LEGACY_DISCREPANCY_CUTOFF = "2026-08-30";

// Account behavior belongs in one shared registry. A non-zero balance is only
// exceptional for accounts explicitly configured as clearing accounts; normal
// asset, liability, equity, income, expense and COGS balances are not guessed at.
const DEFAULT_ACCOUNT_RULES = Object.freeze({
  "1900": {code: "1900", name: "Suspense - unmapped POS accounts", mode: "clearing", expectedBalance: 0, cutoverDate: "2026-08-30", maxAgeDays: 0},
  "1290": {code: "1290", name: "Inventory Receiving Clearing", mode: "clearing", expectedBalance: 0, maxAgeDays: 30},
  "5090": {code: "5090", name: "Unposted COGS Clearing", mode: "clearing", expectedBalance: 0, maxAgeDays: 0},
  "2090": {code: "2090", name: "Unrecorded Payables Clearing", mode: "clearing", expectedBalance: 0, maxAgeDays: 30},
  "1190": {code: "1190", name: "Cash Shortage Under Review", mode: "clearing", expectedBalance: 0, cutoverDate: "2026-08-29", maxAgeDays: 30},
  "2100": {code: "2100", name: "Cash Overage Under Review", mode: "clearing", expectedBalance: 0, cutoverDate: "2026-08-29", maxAgeDays: 30},
});

function accountRules(configured) {
  const result = {};
  Object.keys(DEFAULT_ACCOUNT_RULES).forEach((code) => {result[code] = Object.assign({}, configured && configured[code] || {}, DEFAULT_ACCOUNT_RULES[code]);});
  Object.keys(configured || {}).forEach((code) => {if (!result[code]) result[code] = Object.assign({}, configured[code]);});
  return result;
}

function entryDate(entry) {
  const raw = String(entry && entry.date || "").slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const at = Number(entry && (entry.occurredAt || entry.postedAt || entry.createdAt));
  return at > 0 ? new Date(at + 10 * 60 * 60 * 1000).toISOString().slice(0, 10) : "";
}

function lineBalance(entry, code) {
  if (entry && entry.net && Object.prototype.hasOwnProperty.call(entry.net, code)) return money(entry.net[code]);
  return money((Array.isArray(entry && entry.lines) ? entry.lines : []).reduce((sum, line) => {
    return String(line && line.code || "") === String(code) ? sum + (Number(line.debit) || 0) - (Number(line.credit) || 0) : sum;
  }, 0));
}

function journalBalances(journal) {
  const balances = {};
  Object.keys(journal || {}).forEach((id) => {
    const entry = journal[id] || {};
    if (entry.net && typeof entry.net === "object") Object.keys(entry.net).forEach((code) => {balances[code] = money((balances[code] || 0) + Number(entry.net[code] || 0));});
    else (Array.isArray(entry.lines) ? entry.lines : []).forEach((line) => {const code=String(line && line.code || "");if(code)balances[code]=money((balances[code]||0)+(Number(line.debit)||0)-(Number(line.credit)||0));});
  });
  return balances;
}

function accountActivity(journal, code, rule) {
  const rows = [];
  Object.keys(journal || {}).forEach((id) => {
    const entry = journal[id] || {}, date = entryDate(entry);
    if (rule.cutoverDate && date && date <= rule.cutoverDate) return;
    const amount = lineBalance(entry, code);
    if (Math.abs(amount) >= 0.005) rows.push({id, date, amount, sourceType: String(entry.sourceType || entry.source || "")});
  });
  return rows.sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.id.localeCompare(b.id));
}

function controlAccountIssues(journal, rules) {
  rules = accountRules(rules);
  return Object.keys(rules).map((code) => {
    const rule = rules[code] || {};
    if (rule.mode !== "clearing") return null;
    const rows = accountActivity(journal, code, rule), balance = money(rows.reduce((sum, row) => sum + row.amount, 0) - Number(rule.expectedBalance || 0));
    if (Math.abs(balance) < 0.5) return null;
    const oldest = rows.find((row) => row.date), newest = [...rows].reverse().find((row) => row.date);
    return {code, balance, count: rows.length, oldestDate: oldest && oldest.date || "", newestDate: newest && newest.date || "", rule};
  }).filter(Boolean);
}

function discrepancyDate(row) {
  const raw = String(row && row.date || "").slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const at = Number(row && (row.closedAt || row.ts || row.createdAt));
  return at > 0 ? new Date(at + 10 * 60 * 60 * 1000).toISOString().slice(0, 10) : "";
}

function retainedLegacyDiscrepancy(row) {
  return discrepancyDate(row) === LEGACY_DISCREPANCY_CUTOFF && row && row.kind === "cash" && Number(row.variance) < 0 && Math.abs(Math.abs(Number(row.variance)) - 120) < 0.005;
}

function operationalDiscrepancy(row) {
  if (!row || ["reviewed", "legacy_closed"].includes(String(row.status || ""))) return false;
  const date = discrepancyDate(row);
  return retainedLegacyDiscrepancy(row) || !date || date > LEGACY_DISCREPANCY_CUTOFF;
}

module.exports = {DEFAULT_ACCOUNT_RULES, LEGACY_DISCREPANCY_CUTOFF, accountRules, entryDate, lineBalance, journalBalances, accountActivity, controlAccountIssues, discrepancyDate, retainedLegacyDiscrepancy, operationalDiscrepancy};
