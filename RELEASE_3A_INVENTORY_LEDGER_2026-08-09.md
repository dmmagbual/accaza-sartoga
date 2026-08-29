# Release 3A — Inventory Movement Ledger

**Date:** 9 August 2026  
**Status:** Deployed; opening balances initialized and production smoke tests passed  
**Admin build:** v152

## Delivered

- Per-item server accounting transactions with deterministic movement IDs.
- Immutable movement history and current-balance projections.
- Retry-enabled order deduction and void/refund reversal triggers.
- Server-routed purchases, stock receipts, adjustments, manual edits, Excel imports, staff use, R&D, waste, and usage reversals.
- Explicit opening-balance migration button in Inventory; no automatic migration.
- Inventory ledger table showing quantity, before/after balance, unit cost, source, and actor.
- Rules that hide accounting state, deny client writes to movements/balances, and lock stock/cost projections after migration.
- Reversal ordering guard: void/refund returns wait until the original sale deduction is complete.
- Negative-stock WAC guard: a receipt against zero/negative stock establishes the purchase cost instead of producing an invalid blended cost.
- Ledger item units and deletion are locked to preserve quantity meaning and audit references.
- Regression and Firebase rules-emulator coverage.

## Mandatory production order

1. Close the POS on every cashier/admin device and pause order entry.
2. Export a fresh Firebase Realtime Database backup.
3. Deploy Functions and Database rules together:

   `firebase deploy --only functions,database --force`

   `--force` acknowledges retry-enabled idempotent triggers; it does not overwrite database data.
4. Publish `admin.html`, `assets/js/admin/core.mjs`, `assets/js/admin/pos.js`, and `assets/js/admin/register.js` to GitHub together.
5. Hard-refresh the admin portal and confirm build v152.
6. Open Inventory and click **Initialize 3A ledger** once. Confirm the item count. This records current stock and cost as opening balances without changing them.
7. Resume sales only after the checks below pass.

## Smoke test

1. Note one ingredient's starting quantity and WAC.
2. Receive a small purchase; confirm quantity, WAC, receipt, and one purchase movement.
3. Complete one recipe-based sale; confirm one negative movement per ingredient and no duplicate after refresh.
4. Record and reverse one staff-use or R&D entry; confirm linked negative and positive movements.
5. Make one stock adjustment; confirm before/after, reason, and value.
6. Void or fully refund one completed test order and choose restock; confirm server reversal movements.
7. Try editing stock/cost through the item editor; confirm it creates a manual-edit movement.
8. Close/reopen the portal and verify balances remain unchanged.

## Rollback warning

Before opening-balance initialization, rollback is the normal source/rules/functions rollback. After initialization or live movements, do not restore only old frontend/rules while continuing sales: that would re-enable competing stock writers. Pause sales and restore the coordinated backup/source set, or correct forward with traceable reversal movements.

## Validation completed

- `npm test` — passed.
- `npm run test:rules` — passed.
- Firebase dry run with retry acknowledgement — passed.
- Database rule syntax — valid.
- Functions source analysis — valid.

## Known limitation

Cloud Functions reports the installed `firebase-functions` package is outdated. It remains deployable and was not upgraded inside this accounting release because the latest major may contain breaking changes. Upgrade and test it as a separate maintenance release.
