# Accaza Coffee Shop — Current Handover for Claude

**Updated:** 1 September 2026
**Workspace:** `C:\AKALIKO\DMM\PERSONAL\CLAUDE\Projects\Accaza Coffee Shop`
**Production:** <https://accazacoffee.com>
**Repository:** <https://github.com/dmmagbual/accaza-sartoga>
**Firebase project / region:** `accaza-sartoga` / `asia-southeast1`
**Release manifest:** 7M, candidate pending production evidence

## Start Here

Read `AGENTS.md` first. It is mandatory: preserve unrelated work, use `apply_patch` for edits, run the three required checks, increment visible builds/cache, stage only task files, and push only when Danilo says **push**.

```powershell
Set-Location -LiteralPath "C:\AKALIKO\DMM\PERSONAL\CLAUDE\Projects\Accaza Coffee Shop"
git fetch origin --prune
git status --short --branch
git log -6 --oneline --decorate
npm test
npm run test:release
npm run test:safety
```

The current local branch is `codex/reconcile-legacy-other-income`. Its sole commit, `fde0161`, is already merged into `main` as [PR #318](https://github.com/dmmagbual/accaza-sartoga/pull/318), merge commit `12aae5885a0ebd3a997639f496cf35d322d61f2c`. GitHub quality gate and the merge-triggered workflows passed. Do not create another PR for this change.

## Live Application Status — Verified 31 August 2026

Current visible builds:

| Surface | Build |
|---|---:|
| Admin | v409 |
| Finance Books | v89 |
| Customer | v64 |
| Service-worker cache | v367 |

The signed-in production Admin portal and Finance Books were accessible. Admin showed an active operational dashboard; Finance Books was live for `danilomagbual@gmail.com` and its General Ledger loaded successfully.

Verified Finance snapshot at that time:

- Cash position: ₱56,912.
- Platform Accounts Receivable: ₱6,933.66.
- Supplier Accounts Payable: ₱27,743.43; total listed current liabilities included loans and customer refund payable.
- Inventory Receiving Clearing (1290): ₱0.00.
- Other Income (4990): ₱0.00 after the reconciliation below.
- Inventory Reconciliation Gain / (Loss) (5905): ₱-715.83. This is a separate current balance; it was not changed by the legacy reset correction and still needs normal accounting review before month close.

These are live UI observations, not a signed financial close or tax filing. Qualified accounting review remains required before formal sign-off.

## Completed Financial Reconciliation

### Legacy Other Income / Owner's Capital correction — completed in production

The journal `legacy_owner_capital_reset_v2_2026-08-29` was historically posted as:

| Account | Original amount |
|---|---:|
| Dr 4990 Other Income | ₱6,445.28 |
| Cr 3000 Owner's Capital | ₱6,445.28 |

Root cause of the later mismatch: ₱5,960.78 of the legacy reset related to inventory adjustments that Finance Books now classifies separately, so it was duplicated in the old reset.

| Component | Amount | Current treatment |
|---|---:|---|
| Biscuit spread opening adjustment | ₱4,950.00 | Inventory against Owner's Capital |
| Strawless lid adjustment | ₱589.26 | Inventory reconciliation |
| Thin straw adjustment | ₱421.52 | Inventory reconciliation |
| Total duplicated legacy content | **₱5,960.78** | Removed from the reset |
| Grab refund recovery GF-746 | **₱484.50** | Genuine Other Income retained |

On 31 August 2026, Danilo explicitly authorized and confirmed the in-app production journal edit. The journal was revised **in place**, with audit history:

| Account | Revised amount |
|---|---:|
| Dr 4990 Other Income | ₱484.50 |
| Cr 3000 Owner's Capital | ₱484.50 |

Revision reason: `Remove inventory adjustments already reclassified from Other Income`.

Verification completed after save:

- Journal displays `History · r1` and ₱484.50 on both lines.
- General Ledger 4990 Other Income = **₱0.00**.
- No Admin inventory quantities, inventory value, cash, or net revenue were changed.
- The correction preserved the original journal ID and the audit history rather than deleting/voiding it.

Do **not** rerun or reverse this correction unless a qualified reviewer identifies new evidence. The journal must remain at ₱484.50 unless the underlying Grab recovery is separately corrected.

## Finance Safeguards Now Live — PR #318

Future stock adjustments now require one explicit Finance offset account at the time of posting. The choice is stored on both the Admin movement and the Finance movement; server-side validation rejects missing or disallowed offsets.

| Adjustment purpose | Required / suggested offset |
|---|---|
| Beginning inventory correction | 3000 Owner's Capital only |
| Physical-count variance or standard reconciliation | 5905 Inventory Reconciliation Gain / (Loss) |
| Wastage / spoilage | 5900 Wastage & Spoilage |

Important rules:

- Inventory is automatically the other side of the entry.
- 3000 Owner's Capital is blocked unless the adjustment nature is `beginning-inventory`.
- New-item opening inventory must use 3000.
- The Finance journal guard now permits a safe, classification-only in-place revision of legacy cutover journals while their period is open. It preserves source ID, revision history, date, and all operational account balances.
- Do not bypass this via direct Realtime Database writes.

Key implementation files:

- `src/admin/pos/11d-stock-adjustments.js`
- `src/admin/pos/11f-inventory-spreadsheets.js`
- `src/functions/50-inventory.js`
- `functions/lib/journal-reclassification.js`
- `src/books/app/30-statements-pages.js`
- `tests/inventory-adjustment-offset-check.cjs`

## Recent Previously-Merged Finance Work

- [PR #315](https://github.com/dmmagbual/accaza-sartoga/pull/315): guarded in-place journal reclassifications.
- [PR #316](https://github.com/dmmagbual/accaza-sartoga/pull/316): journal correction lock retry/release fix.
- [PR #317](https://github.com/dmmagbual/accaza-sartoga/pull/317): database indexes required for journal edits.
- [PR #318](https://github.com/dmmagbual/accaza-sartoga/pull/318): inventory-adjustment offset selection plus legacy reset reconciliation safeguard.

Other recently delivered product changes include Admin/Finance tab cleanup, Inventory visibility restoration, Accounting Periods under Settings, CSV downloads for Finance reports/journals/ledgers/transactions, Philippine business-date reporting, working-capital terminology, sales-source reconciliation guards, and category-level product reporting. Inspect current source and UI before changing any of these.

## Architecture and Deployment Truth

- Frontend static assets deploy through GitHub Pages after merge to `main`; there is no Firebase Hosting target.
- Firebase Functions and rules deploy through repository workflows after relevant merges. Use `firebase deploy --only "functions" --project "accaza-sartoga"` only when a manual Functions deployment is genuinely necessary.
- `orders` is authoritative; `activeOrders` is the bounded live projection.
- Inventory quantities and weighted-average value are server-authoritative movement records.
- `financialMovements` are balanced, source-linked, immutable evidence. Corrections must use a supported correction/reclassification workflow and preserve audit links.
- Each financial/inventory workflow must handle original posting, source reference, subledger effect, settlement/allocation, correction/reversal, audit trail, and idempotency.
- Reports use Philippine business-date boundaries, independent of the operator device timezone.

## Current Known Items / Do Not Misstate

1. `release-manifest.json` remains `candidate_pending_production_verification`. The following evidence is still pending and must not be claimed complete without actual evidence:
   - production performance review
   - backup restore test
   - quarterly permission review
   - quarterly dependency review
2. The visible 5905 balance of ₱-715.83 is not the legacy reset defect. Reconcile it against detailed inventory movements before posting anything.
3. Admin inventory balances were not changed by the legacy journal correction. Any inventory adjustment must be posted from Admin so the Admin movement and Finance Books source stay linked.
4. Do not treat a successful static deployment as proof that Functions/rules have deployed; verify workflow results when those files change.
5. Preserve existing local user changes. Do not reset, clean broadly, or stage all files.

## Required Verification and Handoff

For normal changes:

```powershell
npm test
npm run test:release
npm run test:safety
```

The last run for PR #318 passed all three. `test:release` reported the pending production evidence above, which is expected and not a test failure.

When Danilo says **push it**:

1. Commit only current-task files.
2. Fetch and ensure the branch is current with `main`.
3. Push the branch; create a PR if none is open.
4. Confirm the exact commit appears in the PR and wait for the quality gate.
5. Do not merge unless Danilo explicitly asks.
6. State accurately whether work is local, pushed, PR-open, merged, and deployed.

After frontend changes, remind Danilo to hard refresh with `Ctrl + Shift + R` and confirm the visible build marker.

## Recommended Claude Continuation

Start from current `origin/main`, not the older local branch. Ask Danilo what he wants next. If he asks about finance, first identify the exact movement/source and show how Admin subledger and Finance Books behave together. For inventory issues, never change a GL inventory control account manually when it would disconnect quantity/value from the stock movement.
