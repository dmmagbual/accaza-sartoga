# Release 7C — Admin Navigation and POS Priority

**Build:** admin v169, customer v45, service-worker cache v58  
**Backend:** no new Function; includes the pending Release 7B database query indexes

## Delivered

- Prominent, persistent POS primary control.
- Primary work areas: Overview, Orders & Operations, Inventory, Financials, Customers, Settings.
- Contextual secondary pages shown only for the selected work area.
- Cashier → POS, kitchen → Orders, and finance → Financials role-aware landing.
- Menu maintenance and channel pricing moved away from daily inventory work.
- Responsive horizontal navigation for tablets and phones.
- Existing workflows, lazy modules, Firebase roles, and page permissions preserved.

## GitHub upload set

- `admin.html`
- `sw.js`
- `database.rules.json`
- `release-manifest.json`
- `assets/js/admin/core.mjs`
- `assets/js/admin/telemetry.js`
- `tests/static-check.mjs`
- `tests/release-readiness-check.mjs`
- `ADR-021_ADMIN_INFORMATION_ARCHITECTURE.md`
- `RELEASE_7C_ADMIN_NAVIGATION_2026-08-09.md`
- `ACCAZA_IMPROVEMENT_ROADMAP.md`
- `CLAUDE_HANDOFF.md`
- `CLAUDE_HANDOFF_CURRENT.md`

## Deployment

1. Upload the complete set and wait for the GitHub Quality Gate.
2. Deploy Database rules so the Release 7B Operations Center indexes become active: `firebase deploy --only database --project accaza-sartoga`.
3. Confirm build v169 and cache v58 in production.

## Production acceptance

1. Owner/admin lands on Overview and can open every permitted work area.
2. Cashier lands directly in POS and cannot see restricted management pages.
3. Kitchen lands in Orders.
4. Finance lands in Financials when finance permissions are assigned.
5. POS, Orders, Register Operations, Inventory, Financials, Customers, Settings, and Operations Center each open correctly.
6. On a phone-width screen, both navigation strips scroll without covering page content.

## Rollback

Restore the coordinated v168/cache-v57 frontend. Database query indexes are safe to retain because they grant no additional read or write access.
