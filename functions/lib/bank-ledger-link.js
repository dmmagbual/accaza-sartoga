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

module.exports = {LinkError, isBankLedgerCode, resolveCashAccountCodes, accountsForCode, nextBankLedgerCode, ledgerBalance, planCashAccountLink, chartChangeGuard, CODE_RANGES};
