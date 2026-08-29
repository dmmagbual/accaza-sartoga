# Release 2C — Bounded Active Data

**Status:** Implemented, emulator-tested, and Firebase dry-run validated; production deployment pending  
**Admin build:** v149  
**Date:** 8 August 2026

## Changed Files and Checksums

- `admin.html` — `D92F336D4B9ABD9A9580A9C53C26C6781FE47022570AC549976F4E6D3FCB4297`
- `functions/index.js` — `4FC92B46E12FAC5E86A400311F905E85484509DFBF4F1C94C5CCA21B239D1988`
- `database.rules.json` — `978FA55F65247868C0BD172F21870D49CCADC49B43024CFF60FDB726CF38698F`
- `tests/static-check.mjs`
- `tests/active-orders-check.mjs`
- `tests/rules-ownership-check.mjs`

## Delivered

- Server-maintained `/activeOrders` projection.
- One-time/throttled migration and repair callable: `ensureActiveOrders`.
- Continuous projection repair trigger: `syncActiveOrderProjection`.
- Shift-close archival trigger: `pruneClosedShiftOrders`.
- Automatic archival of resolved closed-shift POS sales.
- Unverified non-cash and unsettled platform orders stay active until resolved.
- Embedded legacy proofs are excluded from the live projection.
- POS order board and Register Ops now consume `/activeOrders`.
- Analytics and finance use bounded recent `/orders` and `/archivedOrders` pages.
- Bounded subscriptions for shifts, activity, discrepancies, stock receipts, adjustments, internal usage, cash ledger, payouts, and archives.
- Explicit “Load older” controls on history/reporting tabs.
- Archive screen loads 100 orders per page.
- Active order updates replace one affected card when possible instead of rebuilding the full order list.
- Browser-side inventory deduction removed; Cloud Function finalization is the only deduction path.
- Firebase `.indexOn` rules added for every bounded query.

## Validation Completed

- `npm test` passes, including active-order lifecycle tests.
- Firebase Database rules emulator passes customer ownership and activeOrders access tests.
- `firebase deploy --only functions,database --dry-run` passes.
- Firebase CLI reports `firebase-functions` is outdated. It was intentionally not upgraded inside 2C because the latest version may contain breaking changes; upgrade separately with its own regression cycle.

## Mandatory Deployment Order

1. Deploy backend and rules first:

   `firebase deploy --only functions,database`

2. Confirm these functions appear successfully:

   - `ensureActiveOrders`
   - `syncActiveOrderProjection`
   - `pruneClosedShiftOrders`

3. Upload `admin.html` v149 to GitHub.
4. Hard-refresh the admin page.

Do not upload v149 before the Functions and Database deployment. It reads `/activeOrders`, which does not exist in the old backend/rules architecture.

## Production Smoke Test

1. Login: data appears without a reload and the session survives manual refresh.
2. Confirm `/activeOrders` is populated after login.
3. Open a shift and ring one cash sale.
4. Confirm the sale exists in both `/orders` and `/activeOrders` while the shift is open.
5. Close the shift and print the Z-report.
6. Confirm the resolved sale moves to `/archivedOrders` and disappears from `/orders` and `/activeOrders`.
7. Ring or identify one pending non-cash sale; close the shift and confirm it remains active until verified.
8. Verify it; confirm it then archives automatically.
9. Confirm an unsettled Grab/Panda order remains active until payout settlement.
10. Open Archive, Analytics, P&L, Cash Flow, Usage, and Register Ops. Use at least one “Load older” button.
11. Confirm inventory is deducted exactly once and COGS is present.

## Rollback Warning

If 2C backend has been deployed and v149 fails, republish v148 only as a temporary frontend rollback. Do not immediately remove the 2C functions or rules: backend automatic archival may already have moved orders. Investigate first using `/orders`, `/activeOrders`, and `/archivedOrders` counts and function logs.
