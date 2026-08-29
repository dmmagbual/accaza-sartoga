# Accaza Coffee — Project Handover (for ChatGPT)

**Owner:** Danilo Magbual — Senior Finance Manager / Corporate Services Manager.
**Purpose:** hand the full working context to a fresh assistant so it can continue the Accaza build without re-discovering everything. Paste this as the first message to ChatGPT, or attach it.
**Last updated:** 2026-08-28.

---

## 0. Where we are RIGHT NOW (read this first)

- Latest feature just built: **owner date-repair** for finance/cash date mismatches.
- It lives on branch **`claude/repair-finance-dates`** (PR open, **CI green**, ready to merge). Three commits: `e8c4c51` (feature), `4d8981c` (manifest bump), `e9a1b10` (books build markers).
- **Not deployed yet.** After merge: `firebase deploy --only functions:repairFinanceDates`, then deploy hosting (books.html + sw.js). The new callable will error in the UI until functions are deployed.
- Current build state: **admin 352, books 42, customer 59, serviceWorkerCache v277** (`release-manifest.json`).

---

## 1. What Accaza is

A **Firebase Realtime Database PWA** for a coffee shop. Two apps share one codebase and one database:

- **admin.html** — the admin / POS app (point of sale, orders, inventory, reconciliation).
- **books.html** — a companion double-entry finance app ("Accaza Books"). Cash Flow now lives here (moved out of Admin).

**Stack**
- Firebase Realtime Database (RTDB), region `asia-southeast1`.
- Cloud Functions v2 (Node 22): `onCall`, `onValueCreated`, `onValueWritten`.
- Vanilla JS ES modules (`.mjs`) + plain `.js`. No framework.
- Service worker (`sw.js`) caches the app shell; transactions stay online-only.
- Firebase project id: `accaza-sartoga`. Production domain: `https://accazacoffee.com`.
- Repo: `dmmagbual/accaza-sartoga` (GitHub).

**Money is double-entry and immutable.** Every financial event writes balanced debit/credit lines to `/financialMovements` — the single source of truth. `commitFinancial` refuses to overwrite an existing movement (deterministic IDs make it idempotent); DB rules set `/financialMovements` write:false. **Corrections are reversal-only** — you never edit a posted movement in place; you post a reversal and (if needed) a fresh repost. A server-side **books bridge** (`functions/lib/books-bridge.js`) mirrors movements into `/books/journal` and maps each POS account string to a Chart-of-Accounts (COA) code.

---

## 2. The finance ledger model (the spine of the system)

- **`/financialMovements`** — immutable, balanced debit/credit movements. The truth.
- **`/books/journal`** — a projection of movements by COA code (via `ensureBooksJournal`). What Books renders.
- **`/cfLedger`** — the cash-flow ledger; each row has its own `date` field and a `movementId` back-reference. Cash Flow statement reads this.
- **`/booksChart`** — **server-authoritative** Chart of Accounts. Any account the owner adds here is immediately usable for posting (see §3). Old behaviour hard-coded the approved codes in a server Set, which caused the "account 2310 is not in the approved chart" error when the client chart and server Set drifted.
- **`/discrepancies`** — cash-register variances (shortage/overage) awaiting review.

**Reconciliation engines (callables):**
- **`auditFinancialControls`** — read-only. Flags unbalanced movements, `sale_not_posted`, `platform_ar_control_mismatch`, suspense/clearing/pending balances, off-chart or inactive-account balances, unreviewed discrepancies, and **`cash_finance_date_mismatch`** (a `/cfLedger` row whose date differs from its movement's business date).
- **`ensureFinancialLedger`** — reposts orders idempotently and reverses orphaned movements (orphan detection runs both ways).
- **`repairFinanceDates`** — see §3.

---

## 3. Features shipped in the recent run

### Server-authoritative Chart of Accounts
- New callable **`manageBooksAccount`** (upsert / deactivate / reactivate / import) writing `/booksChart`. `booksCodeAccount()` in `functions/index.js` now validates journal-line codes against `/booksChart` (old hard-coded Set is only a fallback). So any account the owner adds is postable immediately — no code change needed.
- **Account management is locked** to two emails via `/config/booksChartManagers` (`requireBooksChartManager`): `danilomagbual@gmail.com` and `contact.mariadaniela@gmail.com`.
- Books chart UI (add/edit/import) is in `books.html` (`App.applyServerChart`, driven from `/booksChart`).
- `2310` = "Loan 2", `2320` = "Loan 3" exist as owner-created accounts.

### One-click owner "Amend" for posted purchases
- `managePurchaseCorrection` gained an **`ownerAmend:true`** self-authorize path: owner/superadmin can amend a posted purchase in one step (immutable reverse + redo under the hood) instead of the reverse→void→redo grind. Other roles still need a manager approval to reverse.
- Purchases list UI: removed the redundant "Reverse duplicate" button, renamed "Amend amounts/items" → "Amend", reduced table font. (`assets/js/admin/pos.js`.)

### Financial control audit surfaced in Finance Books
- The Cash Flow page in **books.html** has a **"Run control audit"** button and a control-audit card that lists exceptions from `auditFinancialControls`. Read-only, with fallbacks so a bad check can't break the page.

### Owner date-repair (the newest thing) — `repairFinanceDates`
- **Why:** a one-off backfill left ~35 platform-payout **finance** movements stamped Aug 24, while the **cash** ledger (`/cfLedger`) carried the correct settlement dates. The audit flags these as `cash_finance_date_mismatch`. Danilo confirmed **the cash dates are authoritative**.
- **Callable `repairFinanceDates` (region asia-southeast1):**
  - `action:"preview"` — read-only. Returns every mismatch `{movementId, amount, currentDate, targetDate, type}` plus a count of `ambiguous` ones (a movement referenced by cf rows with conflicting dates — skipped).
  - `action:"apply"` — **owner/superadmin only**, requires a `reason`, accepts an approved `movementIds[]`. For each: posts an immutable **net-zero reversal** at the wrong date + a **repost** at the correct cash date, deterministic IDs (`finance_datefix_rev_<mid>`, `finance_datefix_new_<mid>`), idempotent via `commitFinancial`, writes an `operationalAudit` record, and marks the original `dateRepairSupersededBy`. **Never touches `/cfLedger`** (cash side already correct). Total cash and balances do not change.
- **UI (books.html):** a **"Repair date mismatches"** button appears in the control-audit card only when the audit contains `cash_finance_date_mismatch`. It opens a **preview modal** (checkbox per movement, from→to dates, amount, required reason), applies only the checked ones, then re-runs the audit. Preview-first: nothing re-dates until the owner reviews and approves.
- Follows the existing `manual_books_journal_period_repair` reverse-and-repost pattern.

### Earlier platform-payout reconciliation (still current)
- Grab/FoodPanda payout screen: `assets/js/admin/analytics.js` (`renderPayouts`). Settles expected receivable vs actual payout, books the variance across named expense allocations, holds money in `asset:platform_clearing:<channel>` until a separate **Record deposit** step. Negative "actual payout" = **owing to platform** (`liability:platform_owing:` → COA 2020), auto-nets against the next positive payout. `payout_deposit_missing_reference` is a known, safe cleanup (attach bank references) — deferred.

---

## 4. Key code locations

- **`functions/index.js`** (~300KB) — all callables. Recent additions: `manageBooksAccount`, `ensureBooksChart` / `BOOKS_CHART_SEED_ROWS`, `repairFinanceDates`, the `ownerAmend` path in `managePurchaseCorrection`, and the read-only extra checks in `auditFinancialControls`. `booksCodeAccount()` validates line codes vs `/booksChart`. **Note: this file is flagged binary by grep — edit it via python or an editor, not `sed`.**
- **`books.html`** (~127KB) — Accaza Books app. Chart driven from `/booksChart`; inline `<script type="module">` block wires **callable wrappers** as `window.__financeCmd`, `window.__auditControls`, `window.__repairFinanceDates`, etc. Control-audit card + repair modal live in the `cashflow()` page render and `App.runControlAudit` / `App.repairFinanceDates` / `App.repairFinanceDatesApply`.
- **`functions/lib/books-bridge.js`** — `mapAccount()` (POS string → 4-digit COA; unmapped → 1900 Suspense), `businessDate()`, `itemAccounts()`, INVENTORY/COST codes.
- **`functions/lib/financial.js`** — `Financial.line()`, `.movement()` (asserts balanced), `.reverseMovement()` (swaps debit/credit, keeps original `occurredAt`), `.money()`, `netMovementCorrection()`; `commitFinancial()` (idempotent).
- **`functions/lib/costing.js`** — recipe/product costing = Σ(qty per size × ingredient weighted-average cost). "VERSION 3B-1".
- **`assets/js/admin/pos.js`** — POS/admin module (lazy-loaded): purchase Amend button, item category → inventory (12xx) + cost (5xxx COGS / 6xxx overhead) account maps, category management.
- **`assets/js/admin/analytics.js`** — payout reconciliation screen.
- **`release-manifest.json`** — build numbers + `requiredFunctionExports` + `requiredProtectedNodes`; release-readiness check enforces consistency.
- **`tests/static-check.mjs`**, **`tests/release-readiness-check.mjs`** — the quality gate (see §6).

### Two different callable-wiring conventions (don't mix them up)
- **Admin app** callables must be registered in `assets/js/admin/firebase-client.mjs` `callableNames[]` **and** get a facade in `core.mjs`.
- **Books app** callables are wired **inline** in the `books.html` module block as `window.__X = httpsCallable(fns,"X")` wrappers. `repairFinanceDates` is a Books callable, so it did NOT need firebase-client/core changes.

### Cross-file rules that bite if forgotten
1. **New admin callable** → export in `functions/index.js` **AND** `firebase-client.mjs` `callableNames[]` **AND** facade in `core.mjs`. **New books callable** → export in `index.js` **AND** an inline `window.__X` wrapper in `books.html`.
2. **New manager-approval action** → add to `MANAGER_APPROVAL_ACTIONS` (index.js) **AND** `expected[]` in `tests/approval-matrix-check.mjs`.
3. **New required export** listed in `release-manifest.json.requiredFunctionExports` must exist in `index.js` (regex `exports.<name> =`). Adding an export that is NOT in that list is fine — the check only fails on missing listed ones.

### 3b. THE BUILD-VERSION BUMP IS A COORDINATED SET (this cost 2 CI rounds — do it in one shot)
Bumping the "build version" is never one edit. The quality gate cross-checks all of these against `release-manifest.json`:
- **SW cache:** `sw.js` `const CACHE='accaza-v<serviceWorkerCache>'` must equal `builds.serviceWorkerCache`.
- **Books (if books.html changed):** bump `builds.books`, then update **three** markers in `books.html`: `Coffee-shop accounting · build v<n>` (header), `<meta name="accaza-books-build" content="<n>"/>`, and `Accaza Books · build v<n> ·` (footer).
- **Admin (if admin.html changed):** bump `builds.admin`, then `build&nbsp;v<n>` (visible) and `<meta name="accaza-admin-build" content="<n>"/>`.
- **Customer (if index.html changed):** bump `builds.customer`, then `accaza-index build v<n>`, `<meta name="accaza-customer-build" content="<n>"/>`, and `>Website version <n></span>` (footer).
Miss any and `test:release` (release-readiness-check.mjs) fails with "…build marker differs from release manifest".

---

## 5. Quality gate & test suite

CI = **"Accaza Quality Gate / test"** (a required check on PRs). It runs `npm run test:ci`:
`npm test` (static-check.mjs) → `test:release` (release-readiness-check.mjs) → `test:safety` → `test:rules` (needs Firebase emulator) → `test:e2e` (needs Playwright/Chromium).

- Locally you can run the light suites fast: `node tests/static-check.mjs`, `node tests/release-readiness-check.mjs`, `npm run test:safety`. `test:rules` and `test:e2e` need infra — let CI run those.
- **Always run static-check + release-readiness locally AFTER a version bump**, not before. (The v277 bump broke both because they were run before the bump — don't repeat that.)

---

## 6. Deploy process (has gotchas)

- The cloud/dev clone **cannot push** (no GitHub creds on the Linux bridge; proxy rejects). **All git writes happen from the user's Windows machine** via Desktop Commander native git at
  `C:\AKALIKO\DMM\PERSONAL\CLAUDE\Projects\Accaza Coffee Shop`.
- PowerShell has **no heredoc** — write the commit message to a temp file and `git commit -F file`, then delete the file. PowerShell also treats git's `remote:`/stderr lines as errors (`NativeCommandError`) even on success — check the actual push line (`... -> branch`), not the red text.
- **Never `git add -A`.** Add specific files by name.
- **Branch discipline:** branch fresh off `origin/main` (`git checkout -b claude/<feature> origin/main`); a recurring bug was committing to a branch after its PR already merged.
- If `.git/index.lock` is stale: `Remove-Item -Force .git\index.lock`.
- **GitHub Actions** deploys functions + rules on merge to `main`; **hosting** deploys the web app. For a new callable you can also deploy just it: `firebase deploy --only functions:repairFinanceDates`.
- **Working preference:** do sync/push/PR quietly — report the PR link and a one-line outcome; don't attach changed source files to chat.

---

## 7. Open / deferred items

- **`repairFinanceDates`: merge → deploy → run.** After deploy, open Finance Books → Cash Flow → Run control audit → Repair date mismatches → review the preview → apply. Preview-first; owner-gated.
- **`payout_deposit_missing_reference` cleanup** — attach bank references to platform-payout deposits. Separate and safe; not built.
- **Purchase amend policy** — decide whether anyone besides the owner can amend a posted purchase (today: owner/superadmin one-click; others need approval). Open.
- **Closed-period handling** — no accounting-period lock yet; corrections can land in any prior period. Open.
- **Books cutover** — retire the remaining admin finance screens once Books fully takes over.

---

## 8. How Danilo works (so the output fits him)

- Casual but respectful — trusted colleague, not a formal letter.
- **Show the work.** Every number needs traceable logic and supporting detail; no headline without backup.
- Compare against a baseline (prior year / budget / forecast).
- Flag assumptions explicitly. For cash/liquidity work, state collection and payable assumptions.
- Don't hide bad news — surface it with the supporting data.
- Push back on vague asks; don't fill gaps with filler.
- Expense budget = ceiling; revenue budget = target to beat. Disbursements need original receipts/bills.

---

## 9. Suggested first message to ChatGPT

> I'm continuing work on Accaza Coffee, a Firebase RTDB PWA (POS + immutable double-entry Books). The handover doc below has the full context — architecture, the ledger model, the payout reconciliation, the new date-repair feature, code locations, the build-version coordination, deploy process, and open items. Read it, then help me with: **[your next task]**.

---
*Handover for a fresh assistant session. The repo is the source of truth; this doc is the context.*
