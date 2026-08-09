# Release 6D — Production Verification and Final Handoff

**Application build:** unchanged at admin v166, customer v45, cache v55  
**Release status:** candidate pending production evidence

## Delivered

- `release-manifest.json`: machine-readable release/build/status truth.
- `tests/release-readiness-check.mjs`: verifies builds, mandatory files, Node/Firebase runtime, Function exports, protected nodes, costing-engine equality, documentation, and honest production status.
- `CLAUDE_HANDOFF.md`: authoritative architecture, ownership, deployment, limitations, and continuation guide.
- `CLAUDE.md`: short entry point for a new Claude session.
- `npm run test:release`, now included in `npm run test:ci` and therefore GitHub Quality Gate/Function deployment gates.
- Corrected System Health read access for the real Firebase `manager` role, with emulator coverage. Browser telemetry writes remain denied.

## GitHub upload set

- `CLAUDE.md`
- `CLAUDE_HANDOFF.md`
- `release-manifest.json`
- `RELEASE_6D_PRODUCTION_VERIFICATION_HANDOFF_2026-08-09.md`
- `package.json`
- `tests/release-readiness-check.mjs`
- `tests/rules-ownership-check.mjs`
- `database.rules.json`
- `CLAUDE_HANDOFF_CURRENT.md`
- `ACCAZA_IMPROVEMENT_ROADMAP.md`

Do not upload local backups, exports, spreadsheets, ZIP files, pictures, or retired HTML copies.

## Firebase deployment

Release 6D changes Database rules only, to allow the genuine manager role to read aggregate System Health telemetry:

```powershell
firebase deploy --only database
```

No Functions, Storage rules, HTML, module, or service-worker deployment is required for 6D itself. Phase 6C frontend files must already be published for the tab to exist.

## Acceptance

1. GitHub Quality Gate passes with the new release-readiness check.
2. Deploy Database rules.
3. Owner/admin opens Settings → System Health.
4. Manager opens Settings → System Health successfully.
5. Cashier/staff does not see the tab and cannot read `/clientTelemetryDaily`.
6. Browser attempts to write `/clientTelemetryDaily` remain denied.
7. Complete the pending production items in `release-manifest.json`; do not mark the release production-verified early.

## Rollback

If manager telemetry access is not desired, restore the previous `clientTelemetryDaily` read expression and deploy Database rules. The documentation and readiness test can remain; update the manifest/handoff to state owner/admin-only access.
