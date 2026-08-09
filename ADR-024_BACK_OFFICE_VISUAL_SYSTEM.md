# ADR-024 — Back-Office Visual System

**Status:** Accepted  
**Date:** 2026-08-09  
**Release:** 7F

## Decision

Use one compatibility stylesheet, `assets/css/admin-backoffice.css`, to unify the established admin renderers without changing their data or transaction behavior. Each active workspace exposes its tab and domain through body data attributes. A narrow ledger rail identifies the domain; the remaining interface stays quiet and data-first.

The palette uses roast ink, walnut, brass, ledger paper, service green, exception red, and muted stone. Playfair Display remains restricted to workspace and record headings, Inter remains the operational typeface, and money/quantities use tabular numerals.

## Covered components

- Contextual workspace headers and actions
- Live service-status pills
- Cards, KPI groups and section labels
- Financial and inventory ledger tables
- Buttons, inputs, labels and keyboard focus
- Status badges and operational exceptions
- Orders and reservation service tickets
- Customer, payment, calendar, settings and System Health surfaces
- Responsive and reduced-motion behavior

## Boundaries

The release does not alter authentication, permissions, Firebase paths, order transitions, pricing, inventory, accounting, offline durability, or audit behavior. Existing renderers retain ownership of their content and actions.

## Consequences

- The stylesheet is an authoritative, service-worker-cached release asset.
- `workspace-shell.mjs` owns the active workspace/domain attributes.
- Overview exposes a management-only route to System Health without relocating the Operations Center into Settings.
- New back-office screens should use existing shared primitives before adding one-off inline styling.
