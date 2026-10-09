# Accaza AP Integrity Remediation — Handover to Codex (7 Oct 2026)

Repo: `dmmagbual/accaza-sartoga`. Local folder: `C:\AKALIKO\DMM\PERSONAL\CLAUDE\Projects\Accaza Coffee Shop`.
One owner-operated coffee shop (PHP, Asia/Manila). Firebase RTDB + Cloud Functions (server-authoritative), static admin/POS (`admin.html`) + Finance Books (`books.html`).

Companion docs: `AGENTS.md` (working instructions), `CLAUDE_HANDOFF.md` (authoritative architecture), and the roadmap `claude/ap-integrity-remediation-plan-2026-10-06.md` (in the Claude project).

## 0. How to work on this (read first)
- Follow `AGENTS.md`. The engineering roadmap is the AP Integrity Remediation Plan (approved 6 Oct). **Do not redo the AP audit.**
- Work **one Phase 0 step at a time**. Before each step give Danilo a concise proposal: scope, reason, risk, affected areas, testing, rollback, specialists. **Wait for his approval.**
- **Never merge to `main` without Danilo's approval.** Branch off `main`, PR, let him merge.
- Permanent safeguards: server authority for all financial/inventory/COGS postings; stable DB IDs as join keys (names are display snapshots); every financial change defines original posting, source reference, subledger effect, settlement, correction, return, reversal, audit trail, idempotency; never rewrite posted history (reverse/adjust); money uses `Financial.money` / fixed precision, never floats.
- **Firebase Cost Discipline** (standing rule in `CLAUDE.md`/`AGENTS.md`): minimum downloads, reads and Cloud Function calls — never at the expense of quality, integrity or performance. Read by key / indexed+bounded query; do work inside a call that already happens; no new trigger/listener/poll unless nothing existing can carry it; add any new index with its query.
- Small-shop reality: the owner does the purchasing and purchasing reports are accepted as entered. **Do not design corporate approval flows.** Steps 0.7/1.2 are audit-trail only, no second-person approval.
- **No back-office issue may ever block a shift Z report.**
- Keep responses concise (What I found / recommend / changed / decision needed / next step / specialists). Use 1–2 specialists normally.

## 1. Done and deployed
- **0.1** (PR #693): partly-paid purchases can't be reversed/amended; out-of-range bills flagged in the close and Books. Guard `tests/purchase-reversal-partly-paid-check.mjs`.
- **0.3** (PR #694): `apIntegrityBaseline` — Super-Admin, read-only baseline, Finance Books -> Payables -> **AP integrity check**. Guard `tests/ap-integrity-baseline-check.mjs`.
- **0.4** (PR #695): one settlement claim per supplier bill — `claimPayables` re-reads bills inside the claim across every balance-changing path. Guard `tests/payable-settlement-claims-check.mjs`.
- **0.5** (PR #696): one claim for the Undeposited Collection custody pool — `claimCustodyPool`/`withCustodyPool` on every custody read-modify-write; shift close / Z report never wait. Guard `tests/custody-pool-claim-check.mjs`.
- **Simple references** (PR #697, merged + deployed 7 Oct): each purchase gets **`PUR-YYYY-NNNN`** (`purchaseDocumentNumber`), shown instead of `pinv_...`; Super-Admin backfill `backfillPurchaseDocumentNumbers`. Guard `tests/purchase-document-number-check.mjs`.
- **0.3 baseline result** (27 bills, 137 purchases): all critical checks zero; 10 display-only mirror drifts; 2 confirmed-separate "duplicate" groups (Ice Plant "NO REF", Shopee) — no invoice issued.

## 2. Pending MANUAL step for Danilo (not code)
- Run **Finance Books -> Payables -> "Number old purchases"** once, after the #697 deploy and **before posting new purchases** (keeps numbering in date order). Idempotent; preview changes nothing. Then confirm a Shopee/Ice Plant row shows `PUR-2026-...`.

## 3. Remaining Phase 0 steps (each: propose -> approve -> build -> PR, no merge)
- **0.2 sweep freeze** (recommended): the legacy supplier sweep (`manageSupplier initialize_legacy`, `20-portal-auth`) auto-creates masters and overwrites historical `party`/`supplier` names on Books sign-in — freeze/guard it.
- **0.6 reverse Undeposited-funded payments** (AP-14): now safe to build on the 0.5 custody lock.
- **0.7 explicit permission table + audit** — LIGHT, owner-operated, no second-person approval.
- **0.8 purchase verification + orphan detector** (AP-04): purchase->AP posting is client-orchestrated and non-atomic; stock can be received with no liability.
- **0.9 purchaseInvoices create-only rules** (AP-05 client-writable) + the one-time **display-only mirror refresh** (copy each bill's payment status onto its purchase — folds in the 10 known drifts).
- **0.10 supplier-ID matching + backfill** (AP-06 name-based relationships).
- **0.11 duplicate supplier invoice refs** with a **"No receipt" exemption** (Danilo decision A: no-receipt purchases skip the duplicate check but are listed for review).

## 4. Key code pointers
- **Document numbers**: `src/functions/40-sales-finance.js` — `nextDocumentNumber`, `DOCUMENT_PREFIXES` (PV/RV/PI/FA/IR/IA/JE), and `purchaseDocumentNumber` (PUR, from `/documentCounters/PUR/{year}`). `commitFinancial` assigns `documentNo` and is idempotent per movementId via `/financialCommandClaims`.
- **Purchase posting paths** (where PUR is stamped on purchase + bill): `43a reconcilePurchasePayable` (on-account, 3 write branches), `42b purchase_cash` (cash/advance) + `purchase_owner_funded`. Inventory lines `42e`; corrections/reversal/Amend `43b`.
- **Settlement claims**: `src/functions/42-ap-settlement-claims.js` — `claimPayables`, `/payableSettlementClaims/{id}`.
- **Custody pool claim**: `40-sales-finance.js` — `claimCustodyPool`/`withCustodyPool`, `/financialControlLocks/cashCustodyPool`; FIFO `poolCustodyOutflow`/`poolCustodyDeposit`. Invariant: sum of `cashCustody.remaining` = GL 1030 Undeposited Collection.
- **Backfills / maintenance callables**: `44-reconciliation.js`, `44b-ap-integrity.js` (`apIntegrityBaseline`), `44c-purchase-doc-numbers.js` (`backfillPurchaseDocumentNumbers`). All Super-Admin, `download-ok` justified, idempotent.
- **Books Payables UI**: `src/books/app/40-subledgers.js` (`subledgerPage('ap')`); `assets/js/books/live-pos.mjs` registers `window.__...` callables; new admin buttons sit next to "AP integrity check".
- **Verified findings AP-01...AP-16**: in the remediation plan doc.

## 5. Build / test / deploy (critical mechanics)
- **Build**: `npm run build:artifacts` concatenates `src/functions/*.js` (filename order) into `functions/index.js`, and rebuilds `admin.html`, `index.html`, `assets/js/admin/pos.js`, `assets/js/books/app.js`. **`books.html` is NOT rebuilt — edit it directly.**
- **Tests before PR**: full `npm test` chain, plus `npm run test:release`, `test:safety`, and `npx playwright test` (e2e).
- **New callable checklist** (do ALL): `release-manifest.json` -> `requiredFunctionExports` + `authoritativeFiles` (**full path**, e.g. `src/functions/44c-purchase-doc-numbers.js`); `tests/runtime-bundle-drift-check.mjs` -> splice the export into `expectedFunctionExports` at the right bundle position (put the new file right after its neighbour so order matches); `tests/download-read-guard-check.mjs` -> add to `MANUAL_TOOLS` if it does whole-node reads; every full-node read needs a `/* download-ok: <kind> ... */` comment whose **first word is a known kind** (e.g. `manual`).
- **VERSION-SYNC WEB — bump ALL of these together** when a shipped bundle changes (this cost several CI/test failures, so be thorough):
  - `build-version.json` -> `builds.admin` / `books` / `customer`
  - `release-manifest.json` -> `builds.admin` / `books` / `customer` / `serviceWorkerCache`
  - `sw.js` -> `const CACHE='accaza-vNNN'`
  - `src/html/admin/00-document-navigation.html` -> `<meta name="accaza-admin-build" content="NNN">`
  - `src/html/admin/50-admin-workspace.html` -> visible `build&nbsp;vNNN`
  - `src/html/admin/70-runtime.html` + `assets/js/admin/core.mjs` -> `?v=NNN` on script/import URLs
  - `books.html` -> `<meta name="accaza-books-build">`, visible `build vNNN`, and every `?v=NNN` script tag (edit directly)
  - Tests that HARDCODE versions: `tests/business-intelligence-check.mjs`, `tests/performance-budget-check.mjs`, `tests/suspense-supplier-advance-check.mjs` (`?v=`). Grep `tests/` for the old numbers before pushing.
  - Which to bump: admin bundle (pos.js) change -> admin; books app.js/live-pos change -> books; the SW precaches customer+POS, so an **admin** change also bumps `serviceWorkerCache`.
- **Git** (from Windows PowerShell): branch off `main`, **never commit to `main`**; stage task files **explicitly, never `git add -A`**; commit via `-F <msgfile>`; PR body via `--body-file`; use `git --no-optional-locks` for reads. Attribution lines per the repo's current rule. **Never merge without Danilo.**
- **Windows-only test noise**: the repo path has a **space** (`Accaza Coffee Shop`), so two tests **always fail locally on Windows** regardless of changes — `tests/gallery-photo-check.mjs` and `tests/telemetry-signin-check.mjs` (ENOENT with `%20` in the path). They pass in CI. Skip them locally; don't chase them.

## 6. Do-nots
- Never deploy backup, pricing/costing, picture/video, or retired-copy paths.
- Never rewrite posted history — reverse/adjust with an audit trail.
- Never block a shift Z report with a back-office control.
- Never use float arithmetic for money.
