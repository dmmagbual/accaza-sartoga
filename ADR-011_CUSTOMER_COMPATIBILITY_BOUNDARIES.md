# ADR-011 — Customer Compatibility Boundaries

**Date:** 9 August 2026  
**Status:** Accepted for Release 4C

## Decision

Keep the existing embedded customer workflow visually and behaviorally compatible, but move customer app-session and live order-tracker ownership out of `assets/js/admin/core.mjs`.

- `app-customer-session.mjs` owns standalone-app detection, saved customer identity, login/logout, profile refresh, and checkout prefill.
- `customer-order-tracker.mjs` owns customer order IDs, ready alerts/chimes, active-order rendering, and receipt confirmation.
- `core.mjs` retains small compatibility bridges because the current HTML still uses legacy inline entry points.
- Firebase initialization remains centralized in `firebase-client.mjs`.

## Why

Customer-only startup code was executing inside the shared admin core. A failure in that code could disable the admin login, and every admin launch paid its parse cost. Explicit owners reduce startup coupling without changing pricing, payment, inventory, or database paths.

## Guardrails

- Exactly one app-customer login owner.
- No `myOrderIds`, `statusConfig`, or `isAppMode` state may return to `core.mjs`.
- Admin core must remain at or below 125 KB.
- The current HTML visual workflow remains unchanged until browser coverage supports removing compatibility bridges.

