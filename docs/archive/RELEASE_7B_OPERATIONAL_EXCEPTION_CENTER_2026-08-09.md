# Release 7B — Operational Exception Center

**Build:** admin v168, customer v45, service-worker cache v57  
**Backend:** `getOperationalExceptions` callable plus privacy-safe `proof_access` telemetry

## Delivered

- Extends System Health into an Operations Center while preserving its performance view.
- Adds critical and warning exception counts with navigation to existing controlled workflows.
- Detects stuck orders, partial offline syncs, inventory gaps, accounting gaps, aged cash custody, proof-access failures, and other client errors.
- Uses a management-only callable and bounded reads; no new browser database permission is introduced.
- Adds deterministic regression coverage for classifications, severity, and false-positive suppression.

## Mandatory deployment order

1. Confirm `npm run test:ci` is green in GitHub.
2. Deploy `functions:getOperationalExceptions,functions:recordClientTelemetry`.
3. Publish `admin.html`, `sw.js`, `assets/js/admin/core.mjs`, `firebase-client.mjs`, `telemetry.js`, and `operations-dashboard.js` together.
4. Confirm build v168 and service-worker cache v57.

No Database rule deployment is required for 7B.

## Production acceptance

1. Sign in as owner/admin/manager and open Settings → Operations Center.
2. Confirm exceptions and 7/30-day System Health load.
3. As ordinary staff, confirm the tab is hidden and the callable is denied.
4. Complete a normal sale and confirm no inventory or financial exception remains after triggers settle.
5. In sanitized staging, create a stale active order and incomplete offline sync; confirm both appear.
6. Cause a proof-access failure in staging; after telemetry flush, confirm only an aggregate warning appears.
7. Confirm POS, Charge, order status, receipt, offline retry, Inventory, and Cash Flow still work.

## Rollback

Restore the coordinated v167/cache-v56 frontend. Do not roll back unrelated 7A order-status authority.
