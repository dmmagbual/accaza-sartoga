# Phase 10 — Production Assurance, Observability, and Financial Write Safety

## Scope delivered

- Reusable validation for protected Firebase multi-location writes.
- Safe normalization of compatible record/child updates and rejection of contradictory updates.
- Retry-safe financial command claims with stale-processing recovery.
- Correlation IDs and privacy-safe structured logs for financial commands and Books chart management.
- User-safe unexpected-error references that explicitly confirm nothing was posted.
- Executable regression coverage for the chart-path conflict and malformed update cases.

## Production safety

This phase has no database migration and does not rewrite live orders, stock quantities, opening balances, or journal history. The deployed Functions behavior changes only after the pull request is merged and the repository workflow completes.

Rollback is code-only: revert the Phase 10 commit and redeploy Functions. The pre-change Git pointer is `backup/phase10-pre-production-assurance-20260830`.

## Verification matrix

| Control | Automated evidence | Production evidence |
|---|---|---|
| Parent/child write conflict | `tests/production-assurance-check.mjs` | Review Functions error rate after deployment |
| Malformed/unsafe write | `tests/production-assurance-check.mjs` | No unsafe update should reach Firebase |
| Duplicate command | Existing financial tests plus claim source assertions | Retry one preview-safe workflow only |
| Interrupted claim | Stale-claim source assertion | Observe naturally; do not interrupt a live financial posting |
| Inventory reconciliation | Existing reconciliation and financial ledger tests | Preview first, review rows, then post only if needed |
| Online ordering/tracker/PWA | Existing customer startup and end-to-end suites | Customer smoke check after deployment |
| Backup restore | No live restore in this PR | Isolated restore rehearsal remains required |
| Permissions/dependencies/performance | Release gate keeps pending evidence visible | Complete through controlled operational reviews |

## Post-merge smoke sequence

1. Confirm the Functions deployment workflow succeeded.
2. Open Finance Books and confirm the chart loads.
3. Open Inventory-to-Books reconciliation and run preview only.
4. Confirm purchases, payables, and cash-flow pages load without a server error.
5. Place no test sale during rush operations; use an approved normal transaction and confirm its existing Admin/Books links.
6. Check the customer menu, order availability, checkout, tracker, reservation calendar, reviews, and installed PWA startup.
7. Review Functions errors and latency using the returned correlation reference if any operation fails.

## Deferred production evidence

The release manifest correctly keeps production performance review, isolated backup restore, quarterly permission review, and quarterly dependency review pending. They require real operational evidence and must not be marked passed by source code alone.
