# ADR-025 — Overview Command Center

**Status:** Accepted  
**Date:** 2026-08-10  
**Release:** 7G

## Decision

Turn Overview into a management command center that answers three questions in order: what needs attention, what is happening on the floor, and what needs review in money, stock, or system health.

The command center reuses existing authoritative and bounded sources: the active-order projection, reservation totals, current shift, IndexedDB offline-queue summary, dashboard totals, and the Release 7B `getOperationalExceptions` callable. It does not introduce a second business calculation path or any new database listener.

## Interaction model

- A quiet service brief is the visual signature and shows either a clear state or the number of visible items needing attention.
- The work queue places critical and warning exceptions before supporting analytics.
- Live-floor signals route directly to Orders, Reservations, Register Operations, or the durable offline queue workflow.
- Money, inventory, and system controls link to their existing authorized workspaces.
- The management exception scan remains permission-controlled. Users without access still see non-sensitive live store signals.

## Boundaries

Release 7G changes information hierarchy and presentation only. Authentication, role permissions, pricing, payment verification, inventory, accounting, order status, offline replay, and Firebase ownership remain unchanged. Displayed financial totals continue to come from existing dashboard sources and are not recalculated by the command center.

## Consequences

- `overview-command.mjs` is an authoritative, service-worker-cached admin module.
- The module refreshes from existing page state and performs a bounded exception refresh at most once per minute.
- Shortcut destinations are allow-listed and use the established workspace router.
- Supporting charts remain below the command center rather than competing with immediate operational work.
