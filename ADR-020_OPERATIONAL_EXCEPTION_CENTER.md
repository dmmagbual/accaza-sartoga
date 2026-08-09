# ADR-020 — Bounded Operational Exception Center

**Date:** 9 August 2026  
**Status:** Accepted — Release 7B

## Decision

Accaza will extend the management-only System Health view into an Operations Center. A callable Cloud Function performs bounded reads and returns at most 100 sanitized exception summaries. The browser does not receive raw offline-sync audit records, customer details, payment data, recipes, or unrestricted financial history.

## Detected conditions

- Active orders unchanged for more than 30 minutes.
- Offline server sync records incomplete for more than 5 minutes.
- Recent completed orders missing the server inventory-finalization marker.
- Recent completed, non-pending-payment orders missing their immutable sale movement.
- Register cash remaining in custody for more than 24 hours.
- Aggregated proof-access failures and other privacy-safe client errors from the last 7 days.

## Safety controls

- Owner, superadmin, admin, or manager role is required by the Function.
- All database queries are capped; the view does not install new listeners.
- Results contain category, severity, sanitized ID, timestamp, guidance, and destination tab only.
- The dashboard is read-only and never manufactures inventory or accounting records.
- Resolution remains inside existing authenticated, idempotent, approval-controlled workflows.

## Consequences

Managers get one actionable queue without weakening existing database rules. The bounded scan is an early-warning control rather than a historical audit substitute.
