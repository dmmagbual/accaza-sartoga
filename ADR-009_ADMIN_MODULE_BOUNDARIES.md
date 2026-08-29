# ADR-009 — Admin Module Boundaries

**Status:** Accepted; Release 4A implemented locally, production publication pending  
**Date:** 9 August 2026  
**Deciders:** Danilo Magbual and Codex

## Context

The admin application had already gained lazy feature scripts, but `assets/js/admin/core.mjs` remained a 230,525-byte ownership bottleneck. It directly owned Firebase initialization, callable creation, authentication, real-time listener lifecycle, history paging, manager approvals, active-order rendering, customer-registry rendering, and shared escaping utilities. This made unrelated changes collide in one file and allowed duplicate global functions to overwrite each other silently.

A framework rewrite would create excessive regression risk for a live POS. Phase 4 therefore needs incremental extraction with unchanged business behavior and explicit compatibility boundaries.

## Decision

Release 4A introduces small native ES modules without adding a framework or build dependency:

- `firebase-client.mjs` is the only admin module allowed to import Firebase CDN SDKs. It initializes the clients and owns the callable registry.
- `realtime-hub.mjs` owns shared, role-gated, lazy Realtime Database subscriptions and bounded history loading.
- `history-pager.mjs` owns the reusable “Load older” UI.
- `portal-auth.mjs` owns Firebase Auth state, role resolution, login, logout, and listener startup/shutdown.
- `manager-approval.mjs` owns the independent manager authentication and approval request flow.
- `admin-orders.mjs` owns active-order rendering, card patching, status actions, and server archive calls.
- `customer-registry.mjs` owns the admin customer list, filtering, loaded-order counts, promotion threshold, and CSV export.
- `shared-ui.mjs` owns common HTML escaping and safe image-source validation.

`core.mjs` remains the compatibility composition root. Existing `window` interfaces are retained only where older feature scripts or inline HTML still depend on them. New modules receive their dependencies explicitly through imports or factory arguments.

Automated guards enforce one Firebase SDK import owner, valid local module imports, one customer-registry global owner, and a maximum core size of 205,000 bytes.

## Options Considered

### Option A: Rewrite in React/Vue or another framework

Rejected for now. It would combine architecture migration, UI migration, and business-workflow regression in one release.

### Option B: Keep the monolith and only add comments

Rejected. Comments do not prevent duplicate ownership, global overwrite, or cross-feature regression.

### Option C: Incremental native-module extraction

Selected. It lowers coupling while preserving current screens, Firebase data behavior, and deployment model.

## Consequences

- `core.mjs` is reduced from 230,525 to 196,310 bytes, a 34,215-byte or 14.8% reduction.
- Firebase imports and callable names now have one owner.
- The duplicate customer-registry implementation is removed.
- The unused legacy browser password-recovery/hash path and one associated always-live settings subscription are removed. Legitimate Firebase password change remains.
- There is no Firebase schema, rules, or Functions change in Release 4A.
- Phase 4 is not complete: catalog/menu administration, reservations, remaining storefront/admin behavior, globals, and inline handlers still require staged extraction.

## Follow-up

1. Release 4B: extract catalog, menu, options, availability, and reservations behind explicit services.
2. Release 4C: reduce remaining globals/inline handlers and separate remaining customer/storefront responsibilities.
3. Add browser workflow coverage before moving high-risk checkout or finance behavior across boundaries.
4. Consider a lightweight bundler only after the module interfaces stabilize.
