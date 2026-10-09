# Release 6B — Automated Workflow and Failure-Recovery Tests

**Frontend build:** unchanged at admin v165 · customer v45 · cache v54  
**Date:** 9 August 2026

## Coverage added

- Cash and split-payment accounting.
- GrabFood and FoodPanda gross revenue, commission, and receivable treatment.
- Unavailable-item rejection.
- Multiple add-ons and package discount pricing.
- Actual-tender refund and full void balancing.
- Offline order partial failure after authoritative order write.
- Retry repair of shift and active-drawer projections.
- Duplicate replay proving exactly-once denomination changes.
- Order-ID collision and invalid-denomination rejection.
- Firebase ownership and server-only telemetry/inventory/finance controls.
- CI rejection of tracked secrets, private keys, and database exports.

## Test commands

```powershell
npm test
npm run test:rules
npm run test:safety
```

`npm run test:ci` runs the complete gate in a Git checkout. The local workspace is not itself a Git checkout, so the tracked-file safety step reports SKIP locally and is enforced by GitHub Actions.

## Firebase deployment

The production offline algorithm was moved without intentional behavior change into a directly testable module. Deploy the coordinated Function files:

```powershell
firebase deploy --only functions:syncOfflinePosSale
```

## Files to push to GitHub

- `functions/index.js`
- `functions/lib/offline-sync.js`
- `tests/checkout-workflows-check.mjs`
- `tests/offline-sync-recovery-check.mjs`
- `tests/repository-safety-check.mjs`
- `tests/rules-ownership-check.mjs`
- `tests/static-check.mjs`
- `package.json`
- `.github/workflows/quality-gate.yml`
- `.github/workflows/deploy-functions.yml`
- `ADR-017_RELEASE_QUALITY_GATE.md`
- `RELEASE_6B_AUTOMATED_WORKFLOW_RECOVERY_TESTS_2026-08-09.md`
- `ACCAZA_IMPROVEMENT_ROADMAP.md`
- `CLAUDE_HANDOFF_CURRENT.md`

No HTML, service worker, database-rule, or Storage-rule deployment is introduced by 6B alone.

## Production smoke gate

Automated coverage does not replace one real-device smoke test: open a shift, complete one cash and one split sale, verify one platform order, perform one refund, test offline cash/reconnect, and confirm one order/drawer movement per transaction.
