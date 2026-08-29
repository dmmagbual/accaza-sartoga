# Release 3B — Costing Authority

**Date:** 9 August 2026  
**Status:** Implemented and validated locally; production deployment and smoke test pending  
**Admin build:** v153

## Delivered

- One tested costing engine for browser previews and Cloud Functions.
- Strict volume, weight, and count conversions with explicit fluid/weight ounces.
- Server-normalized recipe saves and Excel recipe imports.
- Server-authoritative final-order ingredient usage and COGS.
- Option costs stack from shared option mappings and recipe-specific choice additions.
- Per-order trace: ingredient, source, quantity per serving, total stock-unit quantity, weighted-average unit cost, effective timestamp, line cost, engine version, and warnings.
- Missing recipes, unmapped options, missing costs, impossible quantities, incompatible units, and deleted inventory references are surfaced.
- Existing `cogsSnapshot` remains for compatibility; detailed evidence is in `cogsDetail`.
- Browser/server engine copies are synchronized before Functions deployment and checked byte-for-byte in tests.

## Deployment

1. Keep the POS open only for viewing; do not finalize orders during the short Functions update.
2. Export a fresh Realtime Database backup.
3. Deploy Functions:

   `firebase deploy --only functions --force`

4. Publish these GitHub files together:

   - `admin.html`
   - `assets/js/admin/core.mjs`
   - `assets/js/admin/module-loader.js`
   - `assets/js/admin/pos.js`
   - `assets/js/shared/costing.js`

5. Hard-refresh admin and confirm build v153.

`functions/lib/costing.js`, `functions/index.js`, `firebase.json`, and `tools/sync-costing.mjs` belong in the source repository and Functions deployment, but are not browser assets.

## Smoke test

1. Open a recipe with a stock unit in ml; enter one quantity in L and confirm the converted ml trace.
2. Try g against an ml inventory item and confirm save is blocked.
3. Save a valid recipe and reopen it; confirm quantities and engine version remain.
4. Complete a sale with a selected add-on; wait for finalization.
5. In `/orders/{orderId}`, confirm `cogsSnapshot`, `cogsDetail`, `costingEngineVersion`, `inventoryUsage`, and `inventoryLedgerVersion: 1` exist.
6. Add the `cogsDetail.lines[].totalCost` values and confirm they equal `cogsDetail.totalCost` after final cent rounding.
7. Confirm inventory movements equal `inventoryUsage` and refreshing creates no duplicates.

## Validation completed

- `npm test` — passed, including shared-engine conversion, normalization, option stacking, coverage, usage, COGS trace, and browser/server drift checks.
- JavaScript syntax checks — passed.
- Firebase Functions deployment dry run with retry acknowledgement — passed.
- Firebase rules are unchanged by 3B.

## Known limitation

Recipe definitions are permission-checked and server-normalized, but the authorized browser performs the final recipe write. A future hardening release may move persistence and deletion fully into the callable. This does not weaken order COGS authority: final usage and cost are recomputed by Functions from current canonical data.
