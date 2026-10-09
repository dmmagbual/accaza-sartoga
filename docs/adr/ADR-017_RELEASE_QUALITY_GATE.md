# ADR-017 — Release Quality Gate

**Status:** Accepted  
**Date:** 9 August 2026  
**Deciders:** Danilo Magbual and Codex

## Context

The POS has server-authoritative inventory, finance, offline synchronization, and permissions. A syntax-only test cannot prove these workflows remain balanced, idempotent, or protected after a change.

## Decision

Every GitHub push and pull request runs a layered quality gate:

1. Static syntax, module, source-contract, pricing, costing, inventory, finance, and active-order checks.
2. Integrated checkout scenarios for cash, split payment, both platforms, unavailable items, options, packages, refunds, and voids.
3. Failure injection into production offline-sync logic, proving retry repair and exactly-once drawer changes.
4. Realtime Database Emulator ownership/server-only-write tests.
5. Tracked-file checks for environment files, database exports, service-account files, and private keys.

The Firebase Functions deployment workflow runs the same gate before deployment. A failed gate prevents deployment.

## Trade-offs

- These tests exercise production business functions and Firebase rules without requiring a live database.
- They do not yet drive a real browser through every screen. Browser/device smoke testing remains required after deployment until a stable browser automation harness is added.
- Extracting offline synchronization into `functions/lib/offline-sync.js` slightly increases module count but makes the actual retry algorithm testable instead of duplicating it in a test.
