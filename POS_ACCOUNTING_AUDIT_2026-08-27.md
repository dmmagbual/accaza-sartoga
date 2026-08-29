# POS -> Accounting Posting Audit

Date: 2026-08-27. Scope: every admin/POS action that posts to the books, the accounts that can drift, and where the ledger can break. Grounded in functions/index.js and functions/lib/books-bridge.js.

## Bottom line
You already have the "unified ledger" the brief describes, and it's built to a high standard. `/financialMovements` is the single, immutable, double-entry source of truth; `/books/journal` and the cash ledger are projections of it. The five requirements are effectively met:

- Single source of truth: every admin action commits balanced movements to `/financialMovements` (commitFinancial).
- POS integration: sales/refunds/voids auto-post via postOrderFinancial + the POS->books bridge (BooksBridge.mappedLines).
- Orphan detection: `ensureFinancialLedger` (index.js:2281) reposts every order idempotently AND reverses movements whose order was deleted (`orphan_balance_correction_*`); `auditFinancialControls` (:2390) flags completed orders with no `sale_` movement (`sale_not_posted`, critical).
- Immutability: `commitFinancial` refuses to overwrite an existing movement (deterministic IDs -> retry-safe), corrections are reversing entries only, and DB rules set `/financialMovements ".write": false` (server-only via Admin SDK).
- Balance check: every movement must balance on commit (linesBalanced); `auditFinancialControls` re-sums each movement and flags any `debit != credit` as **critical/unbalanced**, and reconciles the platform-receivable subledger to unsettled orders (`platform_ar_control_mismatch`).

So this audit is about the RESIDUAL risks — the accounts that can quietly accumulate and the couplings that can drift — not a rebuild.

## Accounts that can create variance in the future (ranked)

### 1. HIGH — Clearing / suspense / pending accounts are not watched by the controls dashboard
These accounts are designed to hold value temporarily, but nothing forces them back to zero and `auditFinancialControls` does NOT surface their balances as exceptions:
- **1900 Suspense** — unmapped POS account strings land here (BooksBridge.mapAccount returns `unmapped`, `flagUnmappedBooks` writes `/books/reviewQueue`). Already happened: a one-time ₱995 reclass to Owner's Capital is hardcoded (index.js:306). The review queue exists, but a growing 1900 is not an audit exception.
- **1290 Inventory Receiving Clearing / 5090 Unposted COGS Clearing** — an item with no `inventoryAccount`/`costAccount` dumps inventory to 1290 and COGS to 5090 (`cogsAccountSnapshot` fallback key `1290|5090`). 1290 is only checked to be zero at *opening-balance* posting (index.js:1781), never during normal operations.
- **2090 Unrecorded Payables Clearing + GRNI** — purchases received before the supplier invoice is finalized. If "Finalize invoice" is never clicked, this sits open with no aging alert.
- **1190 Cash Shortage Under Review / 2100 Cash Overage** — shift variances auto-post here (index.js:1639) and wait for a manager to resolve them in Discrepancies. Unreviewed discrepancies are not counted in the controls audit.

**Fix:** add four checks to `auditFinancialControls` — balance of 1900, 1290, 5090, 2090 != 0 (warning/critical by size), and a count of open discrepancies + GRNI older than N days. This turns "silent drift" into a dashboard line. Cheapest, highest-value change here.

### 2. HIGH / structural — the POS->books bridge does not validate against the (now editable) chart
The manual-journal path validates every code against `/booksChart` (booksCodeAccount). The POS auto-projection does NOT — `BooksBridge.mapAccount` maps by its own hardcoded table and, on a miss, routes to 1900. Since the chart of accounts is now owner-editable, two gaps follow:
- Deactivating or renaming a chart account does **not** stop the POS bridge from posting to that code — the bridge never consults the chart. History and reports can show a balance on an account the chart no longer lists ("? <code>").
- A newly introduced POS payment method / platform-variance string with no entry in mapAccount's `exact` table silently lands in 1900.

**Fix:** (a) have `auditFinancialControls` diff the set of codes the bridge can emit against active `/booksChart` codes and flag any bridge code that is missing/inactive; (b) block deactivation of a chart account that the POS bridge still maps to (guard in manageBooksAccount). Keeps the two mapping surfaces from drifting.

### 3. MEDIUM — unmapped stock items still reach 5090/1290 outside the purchase screen
The newer purchase UI forces an inventory/cost account on receiving (good — closes the ₱9,000-in-6100 path). But recipe consumption or manual stock changes on a *legacy* item that never got mapped still fall to `1290|5090`. Until every existing item is mapped, this remains a live COGS/inventory drift.
**Fix:** a one-time report of items with no `inventoryAccount`/`costAccount` that have movement history, plus the check in finding #1.

### 4. MEDIUM — three mapping surfaces to keep in sync
There are three account maps: `/booksChart` (manual journals), the cash-ledger `/chartOfAccounts` category set (DEFAULT_CHART_ACCOUNTS, different code space), and BooksBridge.mapAccount (POS strings -> 4-digit codes), plus per-item accounts. They are consistent today (spot-checked: every code mapAccount emits — 4900/4990/6045/6046/6085/6090/6100/1590/1260/1190/2100 etc. — is in the chart Set). The risk is future edits touching one surface and not the others. Finding #2's automated diff is the guard.

### 5. LOW — UX footguns, not ledger breakage
- The "Reverse duplicate" button was removed today; its click handler is left dormant (harmless dead code) — remove on next pass for tidiness.
- Amend reverses first, then prepares the corrected draft; abandoning before Receive leaves the purchase reversed (recoverable, same as the old Reverse flow). Consider a "you have an un-received amended draft" banner.

## What is NOT broken (verified)
- Sales/refunds/voids post balanced entries and are idempotent (deterministic movement IDs).
- Platform receivables (1100) reconcile to unsettled orders in the controls audit.
- Cash date vs finance date mismatches, duplicate cash-account codes, missing payout movements, and reversed-payout cash-not-reversed are all already caught as critical.
- Register float is control-checked to ₱4,000.
- Deletes are impossible from the client (rules) and corrections are reversal-only.

## Suggested next step
The single highest-leverage change is finding #1: extend `auditFinancialControls` so the suspense/clearing/pending accounts and unreviewed discrepancies appear as dashboard exceptions. That converts every "future variance" listed above into something the manager sees the day it starts, instead of at year-end. I can build that as a contained, frontend+one-function change if you want it.
