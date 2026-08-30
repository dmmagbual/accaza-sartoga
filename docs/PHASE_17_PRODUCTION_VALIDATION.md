# Phase 17 — Production validation and resilience evidence

Phase 17 adds a management-only, read-only validation matrix in Operations Center. Recovery pointer: `backup/phase17-merged-main-20260831`.

## Automated evidence

The bounded snapshot checks the active customer catalog and categories, current public order-availability projection, reservation-calendar and review data paths, checkout payment-configuration presence, recent order status fields used by the customer tracker, and the Phase 16 certification gate. It returns counts and control states only. It never returns customer, reservation, review, order, payment, inventory, or accounting content.

The callable performs no database writes and cannot certify production. It does not create synthetic orders, reservations, reviews, stock activity, payments, or journals, so it is safe to run while the POS is active.

## Witnessed evidence still required

1. On a real customer device, verify menu, availability, checkout, POS acceptance, tracker, completion, reservation calendar, review display, PWA install/update, and cache refresh. Avoid fictitious chargeable activity; use a genuine order or an approved non-production environment.
2. In an isolated project, restore the current `backup-v2`, verify its SHA-256 fingerprint, and reconcile inventory, cash custody, AR, AP, Finance movements, and Books at one cut-off.
3. Exercise offline POS reconnect and duplicate submission protection in isolation. Confirm one operational record, one inventory effect, and one balanced Finance/Books treatment.
4. Validate genuine correction, return, and reversal cases through controlled workflows. Preserve original source references, later allocations or settlements, reversal links, audit evidence, and idempotency claims.
5. Have a qualified financial professional independently review and sign the reconciliation. The operator who performed the test should not be the sole reviewer.

## Stop and rollback triggers

Stop validation and open an incident if the customer menu, checkout, tracker, reservation calendar, or reviews fail; availability is stale; any duplicate operational or financial posting appears; inventory differs from Books; a journal is unbalanced; or a PWA cache update prevents normal use. Do not repair balances with manual database edits.

Rollback the release by reverting the Phase 17 commit. Because the Phase 17 endpoint is read-only, rollback itself cannot alter live POS, inventory, or accounting data.

## Completion rule

Phase 17 tooling does not change `candidate_pending_production_verification`. The release may move to production-verified only through a separate evidence-only pull request containing dated, independently reviewed results. Never store production exports, credentials, customer details, payment data, or account numbers in Git.
