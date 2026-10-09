# Release 6C — Operational Health and Release Gates

**Build:** admin v166, service-worker cache v55  
**Backend change:** none beyond the already deployed Release 6A telemetry Function/rules

## What changed

- Added a management-only `System Health` tab under Settings.
- Reads exactly 7 or 30 date-keyed telemetry records; no unbounded listener or history scan.
- Shows average, worst duration, sample count, failures, generic errors, and reporting builds.
- Applies GOOD, WATCH, and ACTION thresholds to the six critical POS signals.
- Lazy-loads `operations-dashboard.js`, adding no module cost to POS startup.
- Added automated route, privacy disclosure, threshold, and service-worker cache guards.

## GitHub files to publish together

- `admin.html`
- `sw.js`
- `assets/js/admin/core.mjs`
- `assets/js/admin/module-loader.js`
- `assets/js/admin/telemetry.js`
- `assets/js/admin/operations-dashboard.js`
- `tests/static-check.mjs`
- `tests/module-loader-check.mjs`
- `ADR-018_OPERATIONAL_HEALTH_RELEASE_GATES.md`
- `RELEASE_6C_OPERATIONAL_HEALTH_2026-08-09.md`
- `OPERATIONS_RELEASE_RUNBOOK.md`
- `ACCAZA_IMPROVEMENT_ROADMAP.md`
- `CLAUDE_HANDOFF_CURRENT.md`

## Firebase deployment

There is no new Function or Database rule in Release 6C. It depends on Release 6A already being live:

```powershell
firebase deploy --only functions:recordClientTelemetry,database
```

Run that command only if Release 6A telemetry was not previously deployed. Otherwise, GitHub publication is sufficient.

## Production acceptance

1. Sign in with the owner/admin account.
2. Open Settings → System Health.
3. Confirm 7-day and 30-day views load without a permission error.
4. Perform a POS sale and wait for the telemetry batch to flush (normally within 30 seconds).
5. Reload System Health and confirm samples/build `admin-v166` appear.
6. Sign in as ordinary staff and confirm System Health is not visible.
7. Confirm normal POS, cart, Charge, receipt, and offline reconnect still work.

## Rollback

Restore the previous coordinated `admin.html`, `sw.js`, `core.mjs`, `module-loader.js`, and `telemetry.js`. Removing only the new module while cache v55 still references it can break service-worker installation; rollback the coordinated set.
