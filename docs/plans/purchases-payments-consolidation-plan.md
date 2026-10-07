# Purchases & Payments Consolidation — Implementation Plan

Accaza · 7 October 2026 · Plan only. No code, data or configuration was changed.

**Status: binding.** Danilo, 7 Oct 2026: "this will be the plan that codex and claude must observe."
- **Copies:**
  - Project doc `claude/purchases-payments-consolidation-plan-2026-10-07.md`
  - Repo `docs/plans/purchases-payments-consolidation-plan.md`, referenced from `CLAUDE.md` and `AGENTS.md`
- **Changes:** only with Danilo's approval, recorded in the decisions log at the end.
- **Precedence:** where it conflicts with the AP Integrity Remediation Plan, the AP plan wins.

> **For agentic workers (Claude or Codex):** this plan is executed **one phase at a time, one task at a time**.
>
> **Required skills:**
> - `superpowers:brainstorming` before each phase's design is fixed.
> - `anthropic-skills:ultra-think` at every **Decision Gate** marked ⚖️.
> - `superpowers:using-git-worktrees` for every task branch.
> - `superpowers:test-driven-development` inside every task.
> - `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to run tasks.
> - `superpowers:verification-before-completion` before any "done".
> - `superpowers:requesting-code-review` before each PR.
> - `superpowers:finishing-a-development-branch` to open the PR. **Never merge.**
>
> **Required specialists:** listed per task (see "Specialist protocol"). They are not optional.
>
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Purchases, Cash Payments and supplier bill payments become one work area that shares one set of foundations: payee, payment source, expense account, reference, "needs attention" and actions. Each keeps its own accounting document and lifecycle.

**Architecture:** Shared rules move into single authorities: one server payment-source resolver, one chart-driven expense catalogue, and one client picker module that both screens load lazily. The two documents stay separate on purpose: **Purchase (PUR-YYYY-NNNN)** for goods and itemised supplier invoices, **Cash Voucher (PV-YYYYMM-NNNN)** for operating payments, advances and controlled payments. A single "New entry" front door applies the adopted payment-routing rule so staff never pick the wrong screen. Posting stays server-authoritative, and the AP Integrity Remediation Plan remains the foundation.

**Tech stack:** Firebase RTDB and Cloud Functions (concatenated from `src/functions/*.js` into `functions/index.js`), static admin bundles (`src/admin/**` → `assets/js/admin/*.js`), Finance Books (`src/books/**` → `assets/js/books/app.js`), Node test scripts under `tests/`.

**Spec:** this document, plus `claude/ap-integrity-remediation-plan-2026-10-06.md` (the AP foundation) and the adopted payment-routing rule (Purchases first; Payables to pay a bill; Cash Payments for advances, expenses and owner withdrawals).

---

## 1. Ultra-think analysis (why this design)

**The question behind the request:** "they share the same logic" is true for **how money leaves**, but not for **what the money buys**.

- A purchase creates stock, an expense or an asset, and possibly a bill.
- A cash voucher creates an expense, an owner draw, a staff or supplier advance, a loan repayment or a refund.

Merging the documents would merge two different accounting lifecycles. Merging the *foundations* removes the duplication without that risk.

**What the code shows today (evidence):**

| Shared concern | Purchases | Cash Payments | Problem |
|---|---|---|---|
| Expense classification | Chart-driven 6000-series accounts (`purchaseExpenseAccounts`, 11h) | 12 hard-coded categories (`PETTY_CATS`) mapped server-side by `revolvingFundPosting` (41) | **The same expense can land in different accounts depending on the screen.** This is the highest-value fix. |
| Payment source on the server | Inline resolution in `purchase_paid` (42b) | `advanceFundingAccount` (41), plus checks in `managePettyVoucher` (21) | Two resolvers with two sets of availability checks; Books bill payment (42d) has a third |
| Payment source in the browser | `window.__cf.accounts()` | `window.__cf.accounts()` (same list) | Labels and fallbacks are duplicated (`purchaseFundingLabel`, `purchasePaymentAccountLabel`, `cashPaymentFundingLabel`) |
| Supplier picker | Purchases supplier select | `cashPaymentSupplierOptions` | Duplicated |
| Reference | PUR, server-issued at entry (PR #702) | PV, server-issued at approval (PR #704) | Consistent now, but no shared display or search |
| Missing posting | "Payment not posted" with Post payment (PR #702) | `pettyVoucherAttentionIndex/missing` shown in Undeposited | Two separate attention mechanisms |
| Actions menu | Shared CSS, separate wiring (PR #703 / #704) | Same | Wiring duplicated |
| Navigation | Codex: one "Purchases & Payments" group (local, uncommitted) | Same | In progress |

**Options considered:**

| Option | Description | Verdict |
|---|---|---|
| A. Navigation only | Codex's current step: group the screens, add a Payables shortcut | Necessary but not sufficient. The expense-classification split and three source resolvers remain. |
| B. Shared foundations, two documents | One resolver, one expense catalogue, shared pickers, one attention queue; Purchase and Cash Voucher stay separate | **Recommended.** It removes the real divergence while every posted document type, ID, number and lifecycle stays as it is. |
| C. One merged "payment" document | Replace purchase invoices and vouchers with a single document type | **Rejected.** It needs data migration of posted history, breaks PUR and PV references, couples stock receipt to cash approval, and touches every AP Phase 0 control. The risk is far higher than the benefit. |
| D. Front door on top of B | "New entry" asks what was received and opens the right form, prefilled | **Recommended after B.** It makes the routing rule impossible to get wrong. |

**Adversarial test of B+D.** How to guarantee failure:
1. Change posting while "only refactoring".
2. Let the old category map and the new chart catalogue disagree for a voucher already posted.
3. Make the shared picker a new always-on listener (Firebase cost).
4. Ship the front door before the foundations, so it routes into two inconsistent forms.
5. Merge while Codex's branch bumps the same build numbers.

The plan blocks each one:
- every task has a **posting-parity test** (identical movement lines before and after);
- legacy categories stay readable forever and are only retired for **new** vouchers;
- pickers read data already loaded, with no new subscriptions;
- the front door is Phase 3;
- the merge order is fixed in §6.

**Cross-domain parallel.** Xero and QuickBooks keep *Bill*, *Spend Money/Expense* and *Purchase Order* as separate transaction types. All of them draw from **one** contact list, **one** chart and **one** bank-account picker. Hospital pharmacies work the same way: dispensing and procurement are separate records that share one formulary. The shared catalogue is what prevents mis-coding; the separate documents are what keep the audit trail clean.

**Second-order effects:**
- **6 months:** one place to add a new expense account. Payment-source rules (float protection, Undeposited claim) can't drift between screens.
- **2 years:** franchise branches inherit one resolver. Adding a branch key is one change.
- **Cost of not doing it:** every new rule is implemented two or three times, and the books disagree about where an expense went.

**Confidence:** high on B (evidence above). Medium on D's exact UX, which needs brainstorming with Danilo in Phase 3. The plan would change if Danilo wants pending cash vouchers numbered at creation (affects Task 2.1), or if the AP 1.5 `postPurchase` command lands first (Task 4.1 then becomes trivial).

---

## 2. Global constraints (apply to every task)

- **Stable keys:**
  - Never change, renumber or delete posted `financialMovements`, `purchaseInvoices`, `pettyCashVouchers` or `payables`.
  - PUR and PV numbers already issued are permanent.
  - New fields are additive. Legacy readers keep working.
- **Server authority:** pricing, inventory, COGS, postings, approvals and numbering stay in Cloud Functions. The browser never computes an account to post to without the server re-validating it.
- **Document lifecycles stay separate:**
  - **Purchase:** receive → bill or paid → reverse or Amend.
  - **Cash Voucher:** request → approve (numbered) → post → void, correct, settle, return or allocate.
  - **Supplier bill:** pay, batch pay, reverse payment.
- **Payment sources:**
  - `register` and `cash_float` are always refused, with the existing messages.
  - `revolving_fund` is refused for **new** postings (the fund is retired, balance ₱0) and remains valid in history.
- **Undeposited Collection:** every cash-out takes `claimCustodyPool` and releases it at once (PR #699). Shift close and the Z report never wait.
- **Firebase cost discipline:** no new listeners, triggers, polls or callables unless no existing call can carry the work. Every PR states reads, downloads and calls added or removed.
- **Build sync:**
  - An admin change bumps admin and the SW cache; a Books change bumps books. Update every hard-coded test pin.
  - Run `npm run build:artifacts`. `books.html` is edited directly.
- **Size ceilings:**
  - `src/functions/40-sales-finance.js` is at ~69 KB of its 70 KB section ceiling, so **new server code goes in new section files**.
  - `src/admin/pos/20-purchasing.js` and the `assets/js/admin/pos.js` budget must be checked before adding code there.
- **Tests:** full `npm test`, `test:release` and `test:safety` before every PR. Windows-path tests (`gallery-photo`, `telemetry-signin`) are reported separately.
- **Git:** one branch per task off `main`. Stage named files only. PR with `--body-file`. **Never merge.**

## 3. Review focus (failure modes most likely to bite)

1. **A voucher approved under the old category list after the catalogue switch.**
   - Expected: it posts exactly as before (legacy map), with no account change.
   - Pinned by: Task 1.2 test `legacy-category-voucher-posts-unchanged`.
2. **The same expense entered from Purchases and from Cash Payments.**
   - Expected: identical debit account (`coa:6xxx`).
   - Pinned by: Task 1.2 test `same-expense-same-account-both-screens`.
3. **A payment from Undeposited Collection made from any of the three screens.**
   - Expected: one claim, released at once, Σ custody = GL 1030 afterwards.
   - Pinned by: Task 1.1 test `undeposited-source-claims-and-releases-all-callers`.
4. **A staff member with Cash Payments access but not Purchases** (or the reverse) opening the consolidated area.
   - Expected: they see only their screens, and no module or data loads for the other.
   - Pinned by: Task 0.1 test `route-guard-before-module-load`.
5. **The Purchases screen opened before the finance account list (`window.__cf`) has loaded.**
   - Expected: the picker shows "Loading accounts…", never a partial list, and paying stays disabled until it is ready.
   - Pinned by: Task 1.3 test `picker-waits-for-accounts`.

---

## 4. Specialist protocol (mandatory)

The project specialists are defined in the local folder `.claude/agents/*.md` (Claude) and `.codex/agents/*.md` (Codex). **They are currently untracked in git** (`?? .claude/`). Task 0.2 commits them, so every session and Codex can load them.

**How to call them from a session without native subagent types:** use the Agent tool (`general-purpose`), with the prompt starting with the full text of the specialist's `.md`, followed by:
- the task;
- the exact files and lines;
- the relevant section of this plan;
- the deliverable expected ("findings, risks, recommendation — no long report").

Specialist output is advisory. The primary agent reconciles it against this plan and CLAUDE.md, and records any disagreement in the PR body.

| Phase / task | Required specialists | What they must deliver |
|---|---|---|
| 0.1 Navigation | Identity & Access Engineer, Frontend Developer | Route-guard review (closed until permissions load), Finance-role landing, no data loaded for forbidden screens |
| 1.1 Payment-source resolver | **Bookkeeper & Controller**, Database Optimizer, Software Architect | Account mapping per source, claim order with bill claims, parity proof for every caller |
| 1.2 Expense catalogue | **Bookkeeper & Controller** | Mapping of each legacy category to a 6000-series code, a sign-off that history is untouched, a 6110 exclusion rule |
| 1.3 Shared pickers | Frontend Developer, Code Reviewer | Bundle placement (lazy, no budget breach), accessibility, no new listeners |
| 2.1 Attention queue | Database Optimizer, Bookkeeper & Controller | Bounded queries/indexes only; what counts as "needs attention" for each document |
| 2.2 Unified reference search | Database Optimizer | Index design and download estimate |
| 3.1 Front door | Product Manager, **UX Architect** (`design-ux-architect`), Frontend Developer | Routing questions that match the adopted rule, acceptance criteria, mobile layout |
| 4.1 Posting convergence | Software Architect, **Bookkeeper & Controller**, Database Optimizer, Identity & Access | Only together with AP 1.5 `postPurchase` |
| Every PR | **Code Reviewer** | A final review before handoff |

---

## 5. Phases and tasks

### Phase 0 — Land the navigation consolidation (Codex's step)

Codex owns this step. The listed checks are the acceptance criteria.

#### Task 0.1: Purchases & Payments navigation group

**Files (already modified locally on `codex/purchases-payments-consolidation`):**
- `src/html/admin/50-admin-workspace.html`
- `assets/js/admin/staff-access.js`
- `assets/js/admin/module-loader.js`
- `assets/js/admin/workspace-shell.mjs`
- `src/admin/pos/20-purchasing.js:90`
- tests: `tests/admin-navigation-check.mjs`, `tests/module-loader-check.mjs`, `tests/staff-module-access-check.mjs`

**Interfaces:**
- Produces: `posSwitchTab(tab, button) → Promise<boolean|void>`. It returns `false` when the route guard refuses. Later tasks rely on this.

- [ ] Step 1: rebase onto `main`, which now includes #699–#704. Raise admin to the next free number (currently main is at 655 once #704 merges) and the SW cache to the next free number.
- [ ] Step 2: add test `route-guard-before-module-load`. A user with only `petty` cannot trigger `load('pos')` or any `purchases` scope. A user with only `purchases` cannot load `register`.
- [ ] Step 3: add test `finance-role-landing`. A Finance-role user lands on the first permitted screen of the group.
- [ ] Step 4: add test `purchases-loads-finance-accounts`. Opening Purchases also makes `window.__cf.accounts` available, because paid purchases and **Post payment** depend on it (finding from 7 Oct).
- [ ] Step 5: measure Firebase usage with the same navigation sequence before and after (RTDB bytes, listeners, function calls). Expected: no change. Record the numbers in the PR.
- [ ] Step 6: full test suite, then PR. Specialists: Identity & Access, Frontend Developer, Code Reviewer.

#### Task 0.2: Commit the specialist definitions

- [ ] Stage `.claude/agents/*.md` and `.codex/agents/*.md` by name, with **no other files from `.claude/`**. Check for secrets with `test:safety`. Commit and PR.

⚖️ **Decision Gate 0:** Danilo confirms the navigation in the live admin before Phase 1 starts.

---

### Phase 1 — Shared foundations (no posting change)

Everything in Phase 1 must produce **byte-identical movement lines** for every existing case. Run brainstorming first, then ultra-think on the mapping table (Task 1.2) before coding.

#### Task 1.1: One server payment-source resolver

**Files:**
- Create: `src/functions/41a-payment-sources.js`. It sorts after `41-expense-assets.js`; add it to the drift check's section order if required.
- Modify: `src/functions/42b-financial-command-transactions.js` (`purchase_paid`, `purchase_owner_funded` source parts)
- Modify: `src/functions/41-expense-assets.js` (replace the `advanceFundingAccount` body with a call to the resolver; keep the name as a thin wrapper)
- Modify: `src/functions/21-staff-advance-liquidation.js` (approve availability checks)
- Modify: `src/functions/42d-financial-command-close.js` (`pay_payable` source)
- Test: create `tests/payment-source-resolver-check.mjs`, registered as `test:payment-source` in the `npm test` chain

**Interfaces (produces):**
- `resolvePaymentSource(sourceId: string, accounts: object, {forPosting: boolean}) → {kind: "cash_on_hand"|"undeposited"|"account"|"revolving_fund", account: string, id: string}`
  - `register` and `cash_float` throw `failed-precondition` with the current messages.
  - `revolving_fund` throws only when `forPosting` is true.
  - An unknown or inactive account throws as `accountIdFor` does today.
- `async preparePaymentSourceOutflow(db, source, value: number, {ownerId: string, held: array}) → {writes: object, allocations: object}`
  - `cash_on_hand` runs `availableCashOnHandAboveFloat` (same message).
  - `undeposited` runs `claimCustodyPool` then `poolCustodyOutflow` (same shortfall message).
  - `account` has no pre-check.

**Steps:**
- [ ] Step 1: write the failing parity test `resolver-matches-legacy-for-every-source`. For each of `cash_on_hand`, `undeposited`, an active bank account, an inactive account, `register`, `cash_float` and `revolving_fund`, the resolver output (or error message) equals what `advanceFundingAccount` and the 42b inline code return today.
- [ ] Step 2: write the failing test `undeposited-source-claims-and-releases-all-callers`. It uses the fake DB pattern from `tests/custody-pool-claim-check.mjs` (null-cache transaction semantics). Purchase, voucher and bill payment each claim once and release, and a second payment straight after posts.
- [ ] Step 3: implement both functions in `41a-payment-sources.js`, then switch each caller.
- [ ] Step 4: posting-parity test `movement-lines-unchanged`. Build the movement for a cash purchase, a voucher and a bill payment with fixed inputs; compare against snapshots taken before the change.
- [ ] Step 5: build, run the full suite, PR. Specialists: Bookkeeper, Database Optimizer, Software Architect, Code Reviewer.

**Firebase cost:** zero change. Same reads and same claims.

#### Task 1.2: One expense-account catalogue for both screens

⚖️ **Decision Gate 1.2 (ultra-think + Bookkeeper):** confirm the mapping table before any code.

These are the codes the Books bridge already posts each legacy category to today (`revolvingFundPosting` in `41-expense-assets.js` → `mapAccount` in `functions/lib/books-bridge.js`). The new catalogue must reproduce them exactly, so the switch changes **no** account.

| Legacy category (`PETTY_CATS`) | Server account | Books code today |
|---|---|---|
| operating_supplies / supplies | expense:supplies | 6070 |
| office_supplies | expense:office_supplies | 6075 |
| utilities | expense:utilities | 6020 |
| internet_phone | expense:internet | 6030 |
| marketing | expense:marketing | 6050 |
| repairs | expense:repairs | 6060 |
| bank_fees | expense:bank_charges | 6080 |
| rent | expense:rent | 6010 |
| salaries | expense:salaries | 6000 |
| transport | expense:transportation | 6076 |
| staff_meals | expense:staff_meals | 6077 |
| other_expense / miscellaneous / unknown | expense:other_expense | 6100 |

**The Bookkeeper must also confirm two things:**
- `bridge.js:25` maps both `office_supplies` and a `supplies` key to 6075, while `:24` maps `supplies` to 6070. Confirm which one wins for `expense:supplies`.
- The unmapped fallback is 6100.

**Files:**
- Modify: `src/admin/register/40-revolving-fund.js`
  - The expense form uses chart accounts (6000-series, active, excluding 6110), the same filter as `purchaseExpenseAccounts`.
  - The voucher saves `expenseAccountCode` and `schemaVersion: 4`.
  - `PETTY_CATS` stays for **display of old vouchers only**.
- Modify: `src/functions/41-expense-assets.js`
  - `revolvingFundPosting` uses `coa:${expenseAccountCode}` when present, after validating that the code is an active Expense 6000-series account and not 6110.
  - Otherwise it falls back to the existing legacy map, unchanged.
- Modify: `src/functions/21-staff-advance-liquidation.js`
  - Approve validates `expenseAccountCode`.
  - Correct (`petty_correct_*`) accepts a changed code with the same validation.
- Test: create `tests/expense-account-catalogue-check.mjs`

**Interfaces (produces):** `expenseAccountForVoucher(row, chart) → {account: string, label: string}`, in `41-expense-assets.js` or a new `41b-` section if size requires.

**Steps:**
- [ ] Step 1: failing test `legacy-category-voucher-posts-unchanged`. A schemaVersion-3 voucher with `category: "marketing"` produces exactly today's lines.
- [ ] Step 2: failing test `same-expense-same-account-both-screens`. A purchase expense line with `expenseAccount: "6050"` and a voucher with `expenseAccountCode: "6050"` both debit `coa:6050`.
- [ ] Step 3: failing test `rejects-6110-and-inactive`. `6110`, a non-6000 code and an inactive account are each refused.
- [ ] Step 4: implement, then run the tests.
- [ ] Step 5: the full suite, then PR. Specialists: Bookkeeper (mandatory sign-off on the mapping table and history-untouched proof), Code Reviewer.

**Migration:** none. Posted vouchers keep their lines. New vouchers use the chart.

#### Task 1.3: Shared client pickers (payee, payment source, expense account)

**Files:**
- Create: `src/admin/shared/payment-entry-pickers.js`, built to `assets/js/admin/payment-entry-pickers.js`. Load it lazily through `module-loader.js` as a dependency of both the `purchases` and `petty` routes. **Do not add it to the initial runtime.**
- Modify: `src/admin/pos/11h-purchase-workspace.js` and `src/admin/register/40-revolving-fund.js`. Replace `purchaseFundingLabel`, `purchasePaymentAccountLabel`, `cashPaymentFundingLabel`, `cashPaymentFundingOptions`, `cashPaymentSupplierOptions` and the actions-menu wiring with calls to the shared module. Keep thin wrappers wherever tests pin the old names.
- Modify: `tests/performance-budget-check.mjs` and `tests/bundle-budgets.mjs` (budget for the new file)
- Test: create `tests/payment-entry-pickers-check.mjs`

**Interfaces (produces), all on `window.AccazaPaymentEntry`:**
- `sourceOptions(selectedId) → string (HTML)`
- `sourceLabel(id) → string`
- `supplierOptions(selectedId) → string`
- `expenseAccountOptions(selectedCode) → string`
- `actionsMenu(buttonsHtml, {flag}) → string`
- `wireActionsMenus(root) → void`

**Steps:**
- [ ] Step 1: failing test `picker-waits-for-accounts`. With `window.__cf` absent, `sourceOptions` returns the single "Loading cash, bank and e-wallet accounts…" option.
- [ ] Step 2: failing test `one-label-for-every-source`. `sourceLabel('undeposited'|'cash_on_hand'|bankId)` gives identical text in both screens.
- [ ] Step 3: implement, swap the callers, and confirm no new `subscribe(` or `onValue(` calls (grep assertion in the test).
- [ ] Step 4: the full suite, then PR. Specialists: Frontend Developer, Code Reviewer.

**Firebase cost:** zero. The pickers only read maps that are already loaded.

⚖️ **Decision Gate 1:** Danilo spot-checks one expense entered on each screen and sees the same account in Finance Books.

---

### Phase 2 — Shared lifecycle services

Brainstorm the attention rules with Danilo first.

#### Task 2.1: One "Needs attention" queue for the area

**Scope:** a panel at the top of Purchases & Payments that lists:
- purchases with **Payment not posted** (schemaVersion 2, missing `paymentMovementId` or `fundingMovementId`);
- vouchers **approved but not posted** (`pettyVoucherAttentionIndex/missing`);
- vouchers **pending approval** (`pettyVoucherAttentionIndex/pending`);
- purchases that are **on account without a bill**.

Each row has its existing retry action (**Post payment**, **Repair payable**, **Approve**).

**Files:**
- Create: `src/admin/shared/payment-attention.js` (lazy, as in Task 1.3)
- Modify: `src/functions/21a-undeposited-pages.js`, only if a bounded purchase index is required
- Rules: an `.indexOn` addition for any new index, added together with its query
- Test: create `tests/payment-attention-queue-check.mjs`

**Interfaces:** consumes `purchasePaymentMissing(p)` (11h) and the `pettyVoucherAttentionIndex` shape (21a).

**Steps:**
- [ ] TDD for each source list, including `bounded-queries-only` (every read uses `limitToLast` / an index).
- [ ] The Firebase-cost estimate goes in the PR.
- [ ] Specialists: Database Optimizer, Bookkeeper, Frontend Developer, Code Reviewer.

⚖️ **Decision Gate 2.1:** ⚠️ this decision is open. Should pending vouchers be numbered at creation instead of at approval (today they show "Awaiting approval")? This affects what the queue shows.

#### Task 2.2: One reference search (PUR / PV / supplier ref)

**Scope:** a search box in the area. A PUR, PV or supplier reference opens that document. A lookup by key reads one record by indexed field.

**Steps:**
- [ ] Indexes: `documentNo` on `purchaseInvoices` and `voucherNo` on `pettyCashVouchers`. Add each with its query and record the download estimate.
- [ ] Specialists: Database Optimizer, Code Reviewer.

---

### Phase 3 — Single "New entry" front door

Brainstorming with Danilo is mandatory. UX Architect and Product Manager draft it, and Danilo approves a mockup before any code.

#### Task 3.1: Routing wizard

**Scope:** one **New entry** button. It asks the adopted first-match questions **in this order** and opens the right form, prefilled:
1. Goods, stock or an itemised supplier invoice? → **Purchase**.
2. Paying a bill already in Payables? → **Finance Books → Payables → Pay**, opened via the existing shortcut.
3. Cash to a supplier before goods arrive? → **Cash Voucher, supplier advance**.
4. A small operating cost with no itemised invoice? → **Cash Voucher, expense**.
5. An owner or partner taking money out? → **Cash Voucher, owner withdrawal**.
6. Nothing matched → it is a correction: Books manual journal with a reason.

**Rules:**
- No posting change.
- The wizard only routes and prefills.
- Each target screen still enforces its own server rules.

**Test:** `tests/payment-front-door-check.mjs`. Each answer path opens the matching form with the matching `transactionType` / `pay` mode, and permission-gated targets are hidden from users without access.

**Specialists:** Product Manager, UX Architect, Frontend Developer, Code Reviewer.

⚖️ **Decision Gate 3:** Danilo uses it for one trading day before the old separate buttons are de-emphasised. They are never removed in the same PR.

---

### Phase 4 — Posting convergence

Deferred, and gated on **AP 1.5 `postPurchase`**.

#### Task 4.1: Server-side purchase posting and the voucher posting pattern

**Scope:**
- When AP 1.5 replaces the browser-orchestrated purchase chain (AP-04) with one server command, move the shared parts into one server module used by both documents:
  - payment-source outflow;
  - document-number issue;
  - reference stamping.
- The two documents keep separate commands and separate movement types.

Not started until AP Phase 0 completes and AP 1.5 is approved.

**Specialists:** Software Architect, Bookkeeper, Database Optimizer, Identity & Access, Code Reviewer.

**Explicitly out of scope (rejected in §1, Option C):** merging Purchase and Cash Voucher into one document type, and renumbering any issued PUR or PV.

---

## 6. Sequencing and merge order

1. **Open PRs first:** #704 (Cash Vouchers) merges before Codex rebases Task 0.1.
2. **Then:**
   - Task 0.1 (Codex) → Task 0.2
   - → Gate 0
   - → 1.1 → 1.2 → 1.3 (1.3 may run in parallel with 1.2 only if they touch different files; 40-revolving-fund.js is shared, so **sequential is safer**)
   - → Gate 1
   - → 2.1 → 2.2
   - → 3.1
   - → 4.1 (with AP 1.5)
3. **AP Phase 0 steps still pending** (0.2, 0.6, 0.7, 0.8, 0.9, 0.10, 0.11) keep their own approval flow. Where a consolidation task and an AP step touch the same file, the **AP step goes first**.
4. **Build numbers:** each PR takes the next free admin, books or SW number at rebase time. Whoever merges second rebumps.

## 7. Execution protocol for every task

1. `superpowers:brainstorming` for the phase (once per phase), then `anthropic-skills:ultra-think` at any ⚖️ gate.
2. A concise proposal to Danilo, per the AP rule: scope, reason, risk, affected areas, testing, rollback, specialists. **Wait for approval.**
3. `superpowers:using-git-worktrees`: a worktree off `main` created with Windows git (Desktop Commander), with junctioned `node_modules`.
4. Call the specialists named for the task, using the protocol in §4, before code (design review) and after code (Code Reviewer).
5. `superpowers:test-driven-development`: write the failing test, run it to see it fail, implement, see it pass.
6. `npm run build:artifacts`, then the full `npm test` (Windows-path tests reported separately), `test:release` and `test:safety`.
7. `superpowers:verification-before-completion`: show command output, never "should pass".
8. `superpowers:requesting-code-review` → Code Reviewer specialist; fix the findings.
9. `superpowers:finishing-a-development-branch`: commit named files, push, `gh pr create --body-file`. **No merge.**
10. Handoff:
    - What I found / recommend / changed (local, branch, PR, merged, deployed) / decision needed / next step / specialists used.
    - The PowerShell block.
    - The Firebase cost line.

## 8. Rollback per phase

- **Phase 0:** revert the navigation PR. No data effect.
- **Phase 1:** redeploy previous functions and static. The new voucher field `expenseAccountCode` is additive; old code ignores it and posts through the legacy map. Already-posted movements are unaffected.
- **Phase 2:** remove the panel. Indexes are harmless.
- **Phase 3:** hide the New entry button. The separate buttons still exist.

## 9. Monitoring

- An Exception Center count of "Payment not posted" purchases and "approved not posted" vouchers. Alert when either is above 0 for more than 30 minutes.
- Custody vs GL 1030 drift (existing).
- `financialControlLocks/cashCustodyPool` held for more than 60 s. Alert, because the lease is 180 s and normal holds are under 1 s.
- A weekly list of vouchers posted through the legacy category map after Task 1.2. It should trend to zero.

## 10. Decisions Danilo must make

| # | Decision | Recommended |
|---|---|---|
| C1 | Approve the legacy category → 6000-series mapping table (Gate 1.2) | Bookkeeper's confirmed table |
| C2 | Number pending vouchers at creation, or at approval (current, PR #704) | At approval. Only paid vouchers consume numbers. |
| C3 | Keep the old separate buttons after the front door ships | Yes, for one release, then de-emphasise |
| C4 | Phase 4 timing | Only with AP 1.5 |

## 11. Self-review (writing-plans checklist)

1. **Spec coverage:**
   - Navigation (0.1)
   - Shared logic: source (1.1), expense (1.2), pickers/actions (1.3)
   - References (2.2; numbering already shipped)
   - Missing-posting handling (2.1)
   - Routing rule (3.1)
   - Specialists, ultra-think and superpowers (§0, §4, §7)
   - Firebase cost (each task)
   - Integrity (parity tests)

   No gaps found.
2. **Step scan:** each task names files, signatures and failing tests. Phases 2–4 are scoped at task level on purpose: each gets its own detailed plan after its brainstorming gate, per the writing-plans scope rule (one plan per subsystem).
3. **Type consistency:** `resolvePaymentSource` and `preparePaymentSourceOutflow` (1.1) are used by 4.1. `window.AccazaPaymentEntry.*` (1.3) is used by 2.1 and 3.1. `purchasePaymentMissing` exists in 11h.
4. **Review focus:** the five items in §3 each map to a named test in its owning task.
5. **Proportion:** no code bodies; signatures, tests and decisions only.

## 12. Decisions and results log

- **7 Oct 2026, plan adopted as binding for Claude and Codex** (Danilo).
- **7 Oct 2026, already shipped before this plan:**
  - #699: Undeposited Collection claim release.
  - #700: expense-line layout and ledger dates.
  - #702: PUR as the purchase reference, numbered at entry, with **Post payment**.
  - #703: one Actions menu in Purchases; fully allocated advances hidden.
  - **#704 (merged 7 Oct):** Cash Vouchers keep PV-YYYYMM-NNNN, server-issued at approval, and the PV number is the Finance Books reference.
