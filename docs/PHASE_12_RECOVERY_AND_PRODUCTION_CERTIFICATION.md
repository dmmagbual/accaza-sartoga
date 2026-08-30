# Phase 12 — Recovery and production certification

Phase 12 makes recovery testable without touching the live POS or production database. The pre-change Git pointer is `backup/phase12-pre-certification-20260831`.

## Safeguards delivered

- Daily backups now use `backup-v2`, with a deterministic SHA-256 fingerprint stored both inside the backup and in private object metadata/System Health.
- A backup is rejected before upload only if its envelope or fingerprint is invalid. It is still captured when business data needs investigation, because that is exactly when a recovery point is most valuable.
- Isolated restore certification rejects any Finance movement or Books journal entry that is not balanced.
- The automated test serializes an isolated, sanitized business snapshot, restores it into a separate in-memory object, compares every durable value and fingerprint, and reruns financial balance validation.
- Database permission coverage and locked production dependencies are checked on every quality-gate run.
- Backup v1 remains readable for historical recovery; newly created backups use v2.

## Accounting and operational behavior

This phase does not create, update, reverse, or delete inventory quantities, subledger records, Finance movements, Books journal entries, or production accounts. The recovery validator preserves source IDs and requires every restored Finance/Books entry to remain debit-credit balanced. Actual recovery must restore the complete snapshot to an isolated project first, then reconcile inventory control, receivables, payables, cash custody, Finance movements, and Books before any production decision.

## Production certification checklist

The four release-manifest fields remain `pending` until real evidence is reviewed. They must never be completed from a code test alone.

1. Confirm System Health shows a recent `backup-v2`, `validation: passed`, and a 64-character fingerprint.
2. Copy one production backup to an isolated recovery project; never restore over the live project.
3. Compare the recovered fingerprint with System Health and run all Finance reconciliation screens. Every debit/credit difference and all control-account differences must be zero or separately investigated.
4. Review Firebase/Google Cloud users, service accounts, custom roles, Admin staff roles, and permission overrides. Remove access through the provider console only after owner review.
5. Run `npm run audit:dependencies`, record the date/output in the PR evidence, and investigate every high/critical finding before release.
6. Review 30 days of production telemetry for customer start-up, live readiness, POS charge, Finance operations, and Function errors. Compare p95/error rates with the Phase 11 baselines.

Local dependency review on 2026-08-31 found zero high/critical production vulnerabilities. npm reported seven moderate transitive `uuid` findings through the current Google Storage/Firebase chain. npm's forced fix proposes a breaking downgrade to `firebase-admin` 10.3.0, so it was not applied. Keep the quarterly dependency review pending, monitor the upstream packages, and upgrade through a tested non-breaking release when available.

## Deployment and rollback

Merging deploys the Function change through the repository workflow. Static builds remain admin 394, customer 64, Books 77, and service-worker cache 344 because no browser asset changed. Rollback is code-only: revert the Phase 12 commit and redeploy Functions; existing v1/v2 backup objects remain recoverable. Stop and roll back if backup creation fails, the System Health fingerprint is absent/mismatched, any recovered journal is unbalanced, or a new Function error appears.
