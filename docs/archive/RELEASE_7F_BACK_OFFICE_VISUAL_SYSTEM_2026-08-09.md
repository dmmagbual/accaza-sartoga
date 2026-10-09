# Release 7F — Back-Office Visual System

**Build:** admin v172, customer v45, service-worker cache v61

## Delivered

- Added the shared `assets/css/admin-backoffice.css` compatibility layer.
- Added domain-colored ledger rails to contextual workspace headers.
- Standardized cards, section labels, KPI surfaces, tables and numeric alignment.
- Standardized buttons, fields, labels, focus states and status badges.
- Improved dense Orders and Reservations layouts with responsive service-ticket grids.
- Unified Customers, Payment Details, Calendar, Settings and Operations Center surfaces.
- Added mobile table safety, compact responsive layouts and reduced-motion behavior.
- Added an Overview shortcut to the management-only System Health screen.

## Safety boundary

Release 7F changes presentation and navigation clarity only. Firebase ownership, authorization, pricing, order processing, inventory, financial posting, offline synchronization and retention controls are unchanged.

## Coordinated publication

Publish every authoritative file in `release-manifest.json`. The minimum 7F-specific set is `admin.html`, `sw.js`, `release-manifest.json`, `assets/css/admin-backoffice.css`, `assets/js/admin/workspace-shell.mjs`, `assets/js/admin/telemetry.js`, the updated tests, and the 7F documentation. Because 7C–7E are not yet production-verified, publish the complete coordinated set rather than individual files.

## Production smoke test

1. Confirm owner/admin Overview shows the System health shortcut and opens Operations Center.
2. Confirm cashier, kitchen and finance roles retain their expected landing pages and restrictions.
3. Inspect Orders, Reservations, Inventory, Financials, Customers and Settings on desktop and tablet.
4. Confirm dense tables scroll safely and numeric columns remain readable.
5. Complete one sale and verify order, inventory and financial results are unchanged.
6. Test keyboard focus through a form and confirm reduced-motion mode has no decorative transitions.
