"use strict";

// One bank or e-wallet = one Finance Books ledger account (Xero-style), Sep 2026.
// The operational cash account (/cfAccounts/{id}) is what every payment screen lists;
// /books/config/cashAccountMap/{id} is the server-only link to its ledger code.
// These rules are pure so they can be tested without Firebase.

const BooksBridge = require("./books-bridge");

const RETIRED_CODES = new Set(["1030"]); // alias of 1001 Undeposited Collection
const CODE_RANGES = {bank: [[1010, 1019], [1031, 1039]], ewallet: [[1022, 1029]]};

class LinkError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function isBankLedgerCode(code) {
  const text = String(code || "");
  if (!/^\d{4}$/.test(text) || RETIRED_CODES.has(text)) return false;
  const n = Number(text);
  return n >= 1010 && n <= 1039;
}

function validCode(code) { return /^\d{4}$/.test(String(code || "")); }

// Explicit link first, then the legacy name rule (unchanged for older accounts).
// booksCode on /cfAccounts is display only: that node is client-writable, the map is not.
function resolveCashAccountCodes(accounts, configured) {
  const out = {}, links = configured || {};
  Object.keys(accounts || {}).forEach((id) => {
    const linked = String(links[id] || "");
    out[id] = validCode(linked) ? linked : BooksBridge.cashCodeForAccount(accounts[id]);
  });
  return out;
}

function accountsForCode(code, accounts, configured) {
  const resolved = resolveCashAccountCodes(accounts, configured);
  return Object.keys(resolved).filter((id) => resolved[id] === String(code));
}

function nextBankLedgerCode(kind, takenCodes) {
  const taken = takenCodes instanceof Set ? takenCodes : new Set(takenCodes || []);
  for (const [from, to] of CODE_RANGES[kind === "ewallet" ? "ewallet" : "bank"]) {
    for (let n = from; n <= to; n++) { const code = String(n); if (!taken.has(code)) return code; }
  }
  return "";
}

function ledgerBalance(monthlyNet, code) {
  let total = 0;
  Object.values(monthlyNet || {}).forEach((month) => { total += Number(month && month[code] || 0); });
  return Math.round(total * 100) / 100;
}

// Decide which ledger code a created or edited cash account uses.
// Returns {code, createChartRow, renameChartRow}.
function planCashAccountLink(input) {
  const {accountId, existing, name, kind, requestedCode, accounts, configured, chart, monthlyNet, monthlyReady} = input;
  const others = Object.assign({}, accounts || {});
  delete others[accountId];
  const resolvedOthers = resolveCashAccountCodes(others, configured);
  const usedByOthers = new Set(Object.values(resolvedOthers));
  const requested = String(requestedCode || "").trim();

  if (existing) {
    const current = resolveCashAccountCodes({[accountId]: existing}, configured)[accountId];
    if (requested && requested !== current) throw new LinkError("failed-precondition", `This account already posts to Finance Books ${current}. Moving an account with history to another ledger code is not supported; add a new bank account instead.`);
    const row = chart && chart[current];
    const shared = usedByOthers.has(current);
    return {code: current, createChartRow: false, renameChartRow: !!(row && row.system !== true && !shared && name && row.name !== name)};
  }

  if (requested && !isBankLedgerCode(requested)) throw new LinkError("invalid-argument", "Bank and e-wallet accounts use a Finance Books code from 1010 to 1039 (1030 is retired).");
  const taken = new Set([...usedByOthers, ...Object.keys(chart || {})]);
  const code = requested || nextBankLedgerCode(kind, taken);
  if (!code) throw new LinkError("resource-exhausted", `No free ${kind === "ewallet" ? "e-wallet (1022-1029)" : "bank (1010-1019, 1031-1039)"} ledger code is left. Enter a code manually.`);
  if (usedByOthers.has(code)) throw new LinkError("already-exists", `Finance Books ${code} is already linked to another bank or e-wallet account.`);
  const row = chart && chart[code];
  if (!row) return {code, createChartRow: true, renameChartRow: false};
  if (row.type !== "Asset") throw new LinkError("failed-precondition", `Finance Books ${code} is a ${row.type} account. A bank account must be an Asset account.`);
  if (row.active === false) throw new LinkError("failed-precondition", `Finance Books ${code} is inactive. Reactivate it first.`);
  if (!monthlyReady) throw new LinkError("unavailable", "Finance Books totals are still being prepared. Open Finance Books, wait a moment, and try again.");
  const balance = ledgerBalance(monthlyNet, code);
  if (Math.abs(balance) >= 0.005) throw new LinkError("failed-precondition", `Finance Books ${code} already has a balance of ${balance.toFixed(2)} from journals posted before it was a bank account. Void or reverse those journals in Transactions first, convert the account, then post them again so the money lands in the bank account itself.`);
  return {code, createChartRow: false, renameChartRow: row.system !== true && !!name && row.name !== name};
}

// Guard for Chart of Accounts edits made outside the bank-account form.
function chartChangeGuard({action, code, existing, linkedAccountIds}) {
  const linked = (linkedAccountIds || []).length > 0;
  if (action === "upsert" && !existing && isBankLedgerCode(code)) {
    throw new LinkError("failed-precondition", `Codes 1010-1039 are bank and e-wallet accounts. Use "+ Add bank account" so ${code} is created together with the bank account that Purchases, Cash Payments and Payables can select.`);
  }
  if (action === "upsert" && linked) return {forceType: "Asset", syncName: linkedAccountIds.length === 1};
  if (action === "deactivate" && linked) return {deactivateAccounts: true};
  if (action === "reactivate" && linked) return {reactivateAccounts: true};
  return {};
}

// Books codes in the bank range that are not a bank or wallet money can land in.
// 1010 "Other Bank Accounts" is the legacy name-rule fallback bucket, not an account.
const NON_ACCOUNT_BANK_CODES = new Set(["1010"]);
function ledgerAccountKind(code) { const n = Number(code); return n >= 1020 && n <= 1029 ? "ewallet" : "bank"; }
const live = (account) => !!account && account.active !== false;

// Oct 2026 rule: every active bank / e-wallet Books code has exactly one active Cash Flow
// account, and every active Cash Flow account posts to one active bank / e-wallet code.
// Incident: 1021 FoodPanda GCash Wallet was seeded into the chart only, so no payout screen could select it.
function cashLedgerCoverage({chart, accounts, configured}) {
  const resolved = resolveCashAccountCodes(accounts, configured), byCode = {};
  Object.keys(resolved).forEach((id) => { if (live(accounts[id])) (byCode[resolved[id]] = byCode[resolved[id]] || []).push(id); });
  const orphanCodes = Object.keys(chart || {}).sort().filter((code) => {
    const row = chart[code] || {};
    return isBankLedgerCode(code) && !NON_ACCOUNT_BANK_CODES.has(code) && row.active !== false && row.type === "Asset" && !(byCode[code] || []).length;
  });
  const sharedCodes = Object.keys(byCode).sort().filter((code) => byCode[code].length > 1).map((code) => ({code, accountIds: byCode[code]}));
  const unlinkedAccounts = Object.keys(resolved).filter((id) => {
    const code = resolved[id], row = chart && chart[code];
    return live(accounts[id]) && (!row || row.active === false || row.type !== "Asset" || !isBankLedgerCode(code) || NON_ACCOUNT_BANK_CODES.has(code));
  }).map((id) => ({accountId: id, code: resolved[id]}));
  return {orphanCodes, sharedCodes, unlinkedAccounts};
}

// Chart-seeded system codes (1020, 1021, ...) never pass through "+ Add bank account", so the
// seed must create their Cash Flow account. A code whose account was deactivated is left for a
// person to decide (reported, not recreated); either way nothing is linked while the code holds a balance.
function plannedSeedCashAccounts({chart, accounts, configured, monthlyNet, monthlyReady}) {
  const planned = [], blocked = [], all = resolveCashAccountCodes(accounts, configured);
  cashLedgerCoverage({chart, accounts, configured}).orphanCodes.forEach((code) => {
    const row = chart[code] || {};
    if (row.system !== true) { blocked.push({code, reason: `Finance Books ${code} ${row.name || ""} has no active Cash Flow account. Use "Make bank account" in Finance Books, or deactivate the code.`}); return; }
    if (Object.keys(all).some((id) => all[id] === code)) { blocked.push({code, reason: `The Cash Flow account for Finance Books ${code} ${row.name || ""} is inactive. Reactivate it in Finance Books.`}); return; }
    const accountId = `acc_books_${code}`;
    try { planCashAccountLink({accountId, existing: null, name: row.name, kind: ledgerAccountKind(code), requestedCode: code, accounts, configured, chart, monthlyNet, monthlyReady}); }
    catch (error) { if (!(error instanceof LinkError)) throw error; blocked.push({code, reason: error.message}); return; }
    planned.push({code, accountId, name: String(row.name || code).slice(0, 100), type: ledgerAccountKind(code), openedAt: Number(row.createdAt) || 0});
  });
  return {planned, blocked};
}

module.exports = {NON_ACCOUNT_BANK_CODES, ledgerAccountKind, cashLedgerCoverage, plannedSeedCashAccounts, LinkError, isBankLedgerCode, resolveCashAccountCodes, accountsForCode, nextBankLedgerCode, ledgerBalance, planCashAccountLink, chartChangeGuard, CODE_RANGES};
