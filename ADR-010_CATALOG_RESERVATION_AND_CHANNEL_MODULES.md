# ADR-010 — Catalog, Reservation, and Channel-Pricing Modules

**Status:** Accepted; Release 4B implemented locally, publication pending  
**Date:** 9 August 2026  
**Deciders:** Danilo Magbual and Codex

## Context

Release 4A established explicit infrastructure modules, but `core.mjs` still owned catalog administration and all customer/admin reservation behavior. `pos.js` also owned the channel-pricing screen even though channel pricing is an administrative workflow, not a checkout render requirement. These ownership overlaps increased regression risk and forced unrelated code to load together.

During 4B verification, the live v157 admin startup was found to stop at an eager `printOrder` callback reference. Because startup stopped before `window.openAdmin` was installed, the login form did not appear. This failure demonstrates why startup dependencies must be lazy and deployment files must be atomic.

## Decision

- `catalog-admin.mjs` owns category CRUD, menu-item CRUD, option-group CRUD, staff menu, item editing, reordering, image links, and availability administration.
- `reservations.mjs` owns reservation data subscriptions, customer booking calendar, capacity/slot logic, submission, admin calendar, status workflow, customer contact links, and reservation archive/print.
- `channel-pricing.js` owns the GrabFood/FoodPanda pricing editor, rate settings, save verification, and Excel import/export. It is loaded only when Channel Pricing opens.
- `pos.js` retains the small channel-pricing state/calculation bridge required during checkout.
- `core.mjs` remains the composition root and retains customer storefront/order behavior for Release 4C.
- Receipt printing and customer notification are passed to the order module through lazy callback wrappers so undefined later-installed globals cannot stop login startup.

## Options Considered

### Keep the workflows in the core/POS files

Rejected. It preserves coupling and allowed an unrelated receipt callback to disable authentication UI.

### Move all storefront and checkout behavior together

Rejected for 4B. It would combine customer ordering, catalog administration, and POS checkout regression in one release.

### Extract administrative ownership while retaining compatibility bridges

Selected. It materially reduces startup coupling while keeping the existing HTML and business workflows.

## Consequences

- `core.mjs` falls from 196,310 bytes after 4A to 131,560 bytes after 4B.
- `pos.js` falls from 256,033 bytes before Phase 4 to 244,678 bytes; channel pricing is independently lazy-loaded.
- Catalog and reservation workflows each have one renderer owner, enforced by tests.
- Publishing `core.mjs` without `catalog-admin.mjs` and `reservations.mjs` will prevent admin startup. Phase 4B website files are one atomic release.
- No Firebase schema, rules, Functions, or financial calculation changes are included.

## Follow-up

1. Release 4C: separate remaining customer storefront/order behavior and reduce globals/inline handlers.
2. Add browser workflow tests for login, catalog CRUD, availability, reservation status/slots, and channel-pricing save/import.
3. Keep checkout channel-price calculations in the POS module until browser checkout coverage exists.
