# Accaza Coffee Shop - Claude Handover

**Prepared:** 2026-08-25 (Pacific/Port Moresby)  
**Repository:** `dmmagbual/accaza-sartoga`  
**Workspace:** `C:\AKALIKO\DMM\PERSONAL\CLAUDE\Projects\Accaza Coffee Shop`  
**Production:** `https://accazacoffee.com`  
**Firebase project:** `accaza-sartoga`

## Read this first

Follow the repository `AGENTS.md` exactly. Important requirements:

- Preserve unrelated modified and untracked files.
- Stage only files belonging to the current task.
- After application changes, keep the visible Admin build and service-worker cache synchronized with `release-manifest.json`.
- Run at least `npm test`, `npm run test:release`, and `npm run test:safety`.
- A user instruction of **push it** means: commit task files, push the branch, create/update the correct PR, confirm it is not behind `main`, and check the GitHub quality gate.
- Do not merge unless the user explicitly requests it. GitHub Pages deploys static files after merge to `main`; there is no Firebase Hosting target.
- Every financial change must define original posting, source reference, inventory/subledger effect, settlement/allocation, reversals, audit trail, and idempotency.

## Immediate next action

### Latest status — PR #132 is not deployed yet

Danilo reported that Overview still shows the old figures after PR #131/build v300:

- Transactions: **181**
- Gross sales: **PHP 99,705.00**
- Net sales: **PHP 97,440.00**
- Average sale: **PHP 538**

The live site was inspected directly on 2026-08-25. It served **Admin build v300**, and the deployed `overview-insights.mjs` already contained the shared `window.AccazaSales.stamp(order)` timestamp fix. Therefore, the remaining mismatch is not explained solely by the old private timestamp function.

A second defect was found in Overview's duplicate resolution. Overview combined data in this order:

`orders -> activeOrders -> archivedOrders`

Because later copies overwrite earlier copies, a stale completed record in `/activeOrders` could overwrite the authoritative `/orders` record for the same ID. The active projection may lack the final `completedAt` or other completed-order detail, causing Overview to assign the transaction to its older creation date. Sales History does not merge `/activeOrders`, so its totals remain correct.

PR #132 changes precedence to:

`activeOrders -> orders -> archivedOrders`

This retains active-only queue records while ensuring full order history wins over stale projections and archived history remains final authority. It also adds a regression proving a stale duplicate cannot overwrite a completed authoritative record.

- PR: https://github.com/dmmagbual/accaza-sartoga/pull/132
- Branch: `codex/fix-overview-authority-precedence`
- Commit: `d3656c1354a26196e35c2f4ebef75991102bcd3f`
- PR state at handover update: **OPEN, cleanly mergeable, Quality Gate passed**
- Branch relation at verification: **0 behind / 1 ahead of main**
- Candidate versions: **Admin v301**, service-worker cache **v208**
- Customer build remains **v59**; Books build remains **v14**

Crucially, PR #132 has **not been merged or deployed**. The production site is still expected to show v300 and may still show the incorrect 181 totals. Do not treat the continued v300 mismatch as evidence that the PR #132 fix failed.

Next steps:

1. Merge PR #132 only when Danilo explicitly authorizes merging.
2. Confirm the `main` Quality Gate and GitHub Pages deployment both succeed.
3. Hard-refresh Admin with `Ctrl + Shift + R` and confirm the visible marker is **build v301**.
4. Compare Overview and Sales History using the same selected period.
5. Expected benchmark remains 227 transactions, PHP 117,975.00 gross, PHP 2,459.02 discounts, PHP 0.00 refunds, and PHP 115,515.98 net.
6. If build v301 still shows 181, stop making speculative date/cache changes. Export or instrument both screens and compare duplicate IDs record-by-record across `/activeOrders`, `/orders`, and `/archivedOrders`, including `id`, Firebase key, status, payment status, `completedAt`, `receivedAt`, `timestamp`, `date`, `archivedAt`, subtotal, discount, refund, and total. Determine the exact 46 missing IDs before changing financial-report logic again.

Verification completed for PR #132:

```powershell
node tests/overview-history-autoload-check.mjs
node tests/overview-cold-load-check.mjs
npm test
npm run test:release
npm run test:safety
git diff --check
```

All checks passed locally. GitHub Quality Gate run `32825632652` also passed. `npm run test:release` continued to list the four established production-evidence items as pending, not code failures.

This is a reporting-selection correction only. It does not create or modify Finance Books postings, inventory movements, settlements, reversals, or source transactions.

### Previous PR #131 status

PR #131 was merged at `2026-08-25T07:59:00Z`:

- PR: https://github.com/dmmagbual/accaza-sartoga/pull/131
- PR commit: `785ba79` - `Align Overview sale dates with Sales History`
- Main merge SHA reported by GitHub: `1a005f9667623a908825f5d2253ba5ea5386f25f`
- Main-branch Quality Gate run `32824273539`: **success**.
- GitHub Pages deployment run `32824272795`: **success**.

Ask Danilo to hard-refresh Admin with `Ctrl + Shift + R`, confirm **build v300**, and compare Overview to Sales History for the same selected period.

Expected figures from the supplied Sales History screenshot:

- Transactions: **227**
- Gross sales: **PHP 117,975.00**
- Discounts: **PHP 2,459.02**
- Refunds: **PHP 0.00**
- Net sales: **PHP 115,515.98**

The previously incorrect Overview figures were:

- Transactions: **181**
- Gross sales: **PHP 99,705.00**
- Net sales: **PHP 97,440.00**

Measured difference:

- Missing transactions: **46**
- Missing gross: **PHP 18,270.00**
- Missing net: **PHP 18,075.98**
- Implied missing discounts: **PHP 194.02**

## Exact Overview diagnosis and final correction

Do not restart with cache or pagination guesses. Builds v298 and v299 were confirmed live and still showed the mismatch.

The exact remaining cause was divergent period dating:

- Sales History uses shared `window.AccazaSales.stamp(order)` from `assets/js/shared/sales-authority.js`:
  `completedAt -> receivedAt -> timestamp -> date -> archivedAt`.
- Overview had a private date function using:
  `timestamp -> date -> archivedAt`.

Therefore, orders created earlier but completed/received in the selected reporting period appeared in Sales History but were excluded from Overview. PR #131 changed Overview to call the shared Sales History timestamp authority and added a regression test for an order created earlier but completed this month.

Key files:

- `assets/js/shared/sales-authority.js` - authoritative `qualifies`, `amounts`, and `stamp` rules.
- `assets/js/admin/overview-insights.mjs` - Overview period filtering and complete-history gate.
- `assets/js/admin/core.mjs` - combines orders for Overview.
- `assets/js/admin/sales-history.js` - authoritative comparison screen.
- `tests/overview-history-autoload-check.mjs` - complete-feed, race, period-shortcut, and completed-date regressions.
- `tests/overview-cold-load-check.mjs` - cold-load subscription regression.
- `tests/static-check.mjs` - static safeguard requiring the shared timestamp authority.

Current release markers after PR #131:

- Admin build: **300**
- Service-worker cache: **207**
- Customer build remains **59**
- Books build remains **14**

## Overview PR history

Three incremental PRs were used. Their distinctions matter:

1. **PR #129** - https://github.com/dmmagbual/accaza-sartoga/pull/129  
   Commit `89991d7`: added an Overview `/orders` consumer, combined/deduplicated active, historical, and archived orders, and added pagination race recovery. Merged and deployed as Admin v298/cache v205.

2. **PR #130** - https://github.com/dmmagbual/accaza-sartoga/pull/130  
   Commit `16f6f40`: made Overview fully verify the same three bounded feeds as Sales History (`orders`, `archivedOrders`, `financialMovements`) before showing KPI values. Removed the selected-period loading shortcut and showed dashes instead of provisional figures. Merged and deployed as Admin v299/cache v206.

3. **PR #131** - https://github.com/dmmagbual/accaza-sartoga/pull/131  
   Commit `785ba79`: fixed the actual 46-transaction mismatch by using `window.AccazaSales.stamp` in Overview. Merged and deployed as Admin v300/cache v207; both the main Quality Gate and Pages deployment succeeded.

If v300 still differs after a confirmed successful deployment and hard refresh, do not make another speculative change. Capture the active report period and inspect the exact 46 records' `completedAt`, `receivedAt`, `timestamp`, IDs, qualification status, and amounts on both screens. The existing regression proves the intended date precedence but production data must be compared record-by-record if the result still diverges.

## Finance Books / Miscellaneous work completed

The original task was to trace P&L account **6100 Miscellaneous**, which showed **PHP 16,452.85**.

The General Ledger screenshot contained 15 entries and ended at **PHP 15,870.75**. The exact **PHP 582.10** difference came from a platform-payout reversal credit that the P&L statement omitted. The statement logic was corrected so posted reversal lines are included rather than silently excluded.

Relevant posting groups visible in the supplied ledger:

- POS payable create/reverse entries, including PHP 9,000 and smaller purchase/payable amounts.
- Admin purchase-created entries including PHP 2,707.
- Platform payout settlement PHP 582.10.
- Platform payout settlement PHP 129.75.
- Platform payout reversal credit PHP 582.10.

Accounting decisions implemented:

- Admin purchases should reconstruct into their item-specific inventory/expense accounts from saved purchase detail.
- They should **not** all be forced into Inventory Clearing.
- COA 1290 is retained only as a controlled fallback when historical item mapping genuinely cannot be reconstructed.
- Original postings, reversals, item-level source references, and idempotent Finance Books reconstruction remain auditable.

Relevant merged PRs:

- **PR #127** - https://github.com/dmmagbual/accaza-sartoga/pull/127  
  Reconciled Finance Books Miscellaneous postings and item-level historical purchase reconstruction. Main merge included build Books v14.
- **PR #128** - https://github.com/dmmagbual/accaza-sartoga/pull/128  
  Added platform pre-settlement correction handling.

Important files:

- `books.html`
- `functions/lib/books-bridge.js`
- `tests/books-statement-reconciliation-check.mjs`
- `tests/books-bridge-check.mjs`

## Verification already completed

Before each push, these passed locally:

```powershell
node tests/overview-history-autoload-check.mjs
node tests/overview-cold-load-check.mjs
npm test
npm run test:release
npm run test:safety
git diff --check
```

PR #131's pull-request Quality Gate run `32824127446` also passed.

`npm run test:release` continues to report these production-evidence items as pending, not code failures:

- `productionPerformanceReview`
- `backupRestoreTest`
- `quarterlyPermissionReview`
- `quarterlyDependencyReview`

## Local Git/worktree state

At handover time:

- Current branch: `codex/align-overview-sale-dates`
- Local HEAD: `785ba79`
- PR #131 is merged, but the local branch has not yet been switched to the merged `main` commit.
- `.gitignore` has an unrelated user modification.
- Many unrelated documentation/configuration files are untracked, including the older `Accaza_Handover_for_ChatGPT.md`.
- Do not stage, delete, reset, clean, or overwrite those unrelated files.
- This new handover file is intentionally untracked until Danilo explicitly asks to commit/push it.

Safe state check:

```powershell
Set-Location -LiteralPath "C:\AKALIKO\DMM\PERSONAL\CLAUDE\Projects\Accaza Coffee Shop"
git fetch origin
git status --short
git branch --show-current
git log -1 --oneline
gh pr view 131
gh run list --limit 8
```

## Recommended first message from Claude

> I have read the 2026-08-25 handover and the repository AGENTS.md. PR #131's main-branch Quality Gate and Pages deployment succeeded. I will verify production build v300 and compare Overview against the Sales History benchmark of 227 transactions, PHP 117,975 gross, and PHP 115,515.98 net. I will preserve the unrelated dirty and untracked files and will not make another financial-reporting change without record-level evidence.
