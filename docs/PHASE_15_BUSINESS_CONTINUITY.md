# Phase 15 — Business continuity and offline resilience

Phase 15 protects the boundary between device-only POS sales and the authoritative Admin, inventory, and Finance records. Rollback pointer: `backup/phase15-pre-offline-resilience-20260831`.

## Continuity behavior

- During an outage, authenticated POS cash sales remain in the durable IndexedDB queue with stable transaction IDs.
- Electronic payments remain blocked offline because they require server-side verification.
- Reconnection retries through the existing exactly-once server command; duplicate replay cannot duplicate the order or drawer movement.
- Shift closure is blocked while offline or while any sale is pending, synchronizing, or failed.
- The queue is flushed and checked before cash counting, then checked again immediately before the close is persisted. If connectivity changes while counting, the shift remains open and the count is not submitted.

## Accounting safeguards

An offline sale has no Finance or inventory effect until the server accepts its stable transaction ID. Server acceptance creates the authoritative order; existing triggers then produce inventory usage, COGS, Finance movements, and Books entries once. A failed or partial retry remains visible in Operations Center and is safe to retry. Shift closure cannot certify cash while a device-only sale is outstanding, preventing an incomplete Z-report, false cash variance, missing inventory deduction, and missing Finance revenue.

Corrections, returns, reversals, and settlements continue through their existing controlled workflows. This phase makes no automatic journal adjustment and does not guess missing transactions. Inventory, cash custody, subledgers, Finance movements, and Books must reconcile after reconnection; qualified financial review remains required for close certification.

## PWA and customer behavior

The service worker continues serving the versioned customer and Admin shells when same-origin assets are unavailable. Customer checkout remains online-only so an order cannot appear accepted without server confirmation. Customer tracker, reservations, and reviews show their existing connection states and resume from server authority after reconnection.

## Deployment and rollback

Admin build 397 and service-worker cache 347 publish after merge. Customer build remains 64 and Books remains 77. Roll back by reverting the Phase 15 commit; queued transactions remain in browser storage. Do not clear browser data while transactions are pending.
