# ADR-029: Measured Performance and Bounded Customer State

**Status:** Accepted
**Date:** 2026-08-31
**Deciders:** Accaza owner and engineering

## Context

The application has already been split into maintainable source sections and Admin back-office listeners are scoped and paginated. Measurement identified a remaining growth risk on the customer side: every order and reservation ID retained in local storage could create a permanent live listener on every later visit. Catalog startup could also perform the same complete menu and order render several times when categories, items, and availability arrived close together.

Performance work must not truncate Finance Books, change account balances, recalculate inventory, or weaken online-order tracking. The live POS must continue receiving current data immediately.

## Decision

- Keep the latest 20 customer-owned orders and latest 12 locally owned reservations live on the customer device.
- Use the server-owned `customerOrders/{uid}` index ordered by `createdAt`, supported by a database index, instead of downloading an unlimited ownership index.
- Store unsubscribe functions and detach listeners that fall outside the live window.
- Coalesce catalog rendering into one animation frame and cache derived category/menu arrays until their authoritative snapshot changes.
- Measure Admin deferred-module download time and time to the first critical `activeOrders` snapshot using the existing privacy-safe aggregate telemetry pipeline.
- Enforce static bundle-size budgets and listener/query contracts in the release gate.

No Finance Books, financial movement, inventory movement, reconciliation, settlement, correction, return, or reversal calculation is changed.

## Options considered

### Keep unlimited customer listeners

Lowest engineering cost but unbounded database reads, memory use, rerenders, and reconnections for returning customers.

### Replace live tracking with manual refresh

Lowest listener cost but unacceptable order-status and ready-notification behavior.

### Bounded recent live state — selected

Preserves automatic tracking for the records customers are reasonably expected to need while giving startup work a fixed upper bound.

## Consequences

- Returning customers no longer reconnect to every historical order and reservation.
- Recent order status, checkout ownership, receipt confirmation, and ready alerts remain live.
- Older records remain in the authoritative Admin and Finance databases; only the customer device's live window is bounded.
- The query requires the `customerOrders/{uid}` `createdAt` index to deploy with the Functions/static release workflow.
- Performance telemetry remains aggregate-only and contains no order, customer, payment, inventory, or accounting content.

## Rollback

Revert the Phase 11 commit and redeploy the static application and database rules. No data restoration is required because Phase 11 does not delete or transform production records.
