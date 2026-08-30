# Phase 11 — Measured Performance and Data Efficiency

## Baseline measured before implementation

| Runtime asset | Baseline bytes | Phase 11 bytes | Phase 11 budget |
|---|---:|---:|---:|
| Admin POS | 345,102 | 345,102 | 365,000 |
| Finance Books | 168,513 | 168,513 | 180,000 |
| Admin Register | 149,699 | 149,699 | 165,000 |
| Admin Analytics | 134,484 | 134,484 | 150,000 |
| Admin Core | 121,877 | 121,877 | 135,000 |
| Customer Core | 101,956 | 103,588 | 115,000 |
| Admin Finance | 64,560 | 64,560 | 75,000 |

These budgets are regression ceilings, not performance targets. A future increase must be deliberately reviewed rather than silently accepted.

## Improvements

- Customer order-index reads are limited to the latest 20 owned orders using `createdAt`.
- Customer order listeners outside that window are detached.
- Customer reservation listeners are limited to the latest 12 locally owned reservations and stale listeners are detached.
- Corrupt or oversized local ID history cannot prevent customer startup.
- Category, menu, and availability updates share one scheduled render instead of repeatedly rebuilding both catalog surfaces in the same frame.
- Derived category and menu arrays are reused until authoritative data changes.
- Admin deferred-module load time and first critical live-data readiness are captured by the existing aggregate telemetry system.
- Executable budgets protect the principal browser bundles.

## Financial and operational safeguards

- There are no changes to General Ledger lines, Finance Books journals, inventory quantities, valuation, WAC, purchases, payables, receivables, platform settlements, corrections, returns, or reversals.
- No production data is deleted, migrated, or recomputed.
- Recent customer order tracking remains live and server-authoritative.
- All historical orders remain available to Admin and existing financial reports; only customer-device subscriptions are bounded.
- Online/offline ordering, tracker, reservations, reviews, and PWA startup remain covered by browser tests.

## Backup and rollback

Pre-change Git pointer: `backup/phase11-pre-performance-20260831`.

Rollback is code-only. Revert the Phase 11 commit, allow static assets and rules to redeploy, then hard-refresh or reopen the installed PWA. No financial restoration is required.

## Post-merge checks

1. Confirm the GitHub deployment workflow succeeds.
2. Hard-refresh Admin and verify build 394.
3. Open or reinstall the customer PWA and verify website version 64.
4. Confirm availability, menu, checkout, owned-order tracker, reservation calendar, and reviews.
5. Confirm Admin POS, Inventory, Purchases, Finance, and Finance Books load normally.
6. Review aggregate `module_load` and `live_ready` telemetry after normal use; do not generate artificial transactions.
