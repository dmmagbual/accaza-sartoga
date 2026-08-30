# Phase 16 — Production validation and release certification

Phase 16 adds a management-only, read-only certification snapshot. Rollback pointer: `backup/phase16-pre-release-certification-20260831`.

## Automated evidence

The Operations Center now evaluates a current backup-v2 fingerprint, Phase 13 production health, critical operational/financial exceptions, unresolved Phase 14 incidents, recent certified financial close evidence, and orphaned portal permission profiles. Queries are bounded to 100 recent incidents and the latest two business dates.

The snapshot never writes to production data and cannot mark the release certified. A blocked item must be resolved through its existing controlled workflow and the snapshot rerun.

## Operator-required evidence

These items deliberately remain operator-required and the release manifest remains `candidate_pending_production_verification`:

1. Restore a production backup into an isolated project; verify its SHA-256 fingerprint and reconcile the restored inventory, cash custody, AR, AP, Finance movements, and Books.
2. Run the current dependency registry audit and review every finding; do not force a breaking downgrade.
3. Have a qualified financial reviewer independently sign off inventory, cash, receivables, payables, Finance, and Books.
4. Review actual Google Cloud/Firebase IAM and service accounts in the provider console; the application snapshot only checks portal-role consistency.
5. Validate customer menu, checkout, tracker, reservations, reviews, PWA refresh, POS sale, offline recovery, and shift close in production without creating fictitious accounting activity.

The 2026-08-31 registry audit found zero high or critical production vulnerabilities. It continues to report seven moderate transitive `uuid` findings through the Google Storage/Firebase dependency chain. npm's forced fix would downgrade `firebase-admin` across major versions, so it was not applied. Dependency certification remains pending until a tested upstream-compatible resolution and operator review are available.

## Certification rule

Code and CI evidence may prove the tooling works, but cannot prove production is healthy. The four existing release-manifest production fields stay pending until dated evidence is captured and reviewed. Only then may the manifest be updated to `production_verified` in a separate evidence-only PR.

## Deployment and rollback

Admin build 398 and service-worker cache 348 publish after merge; Customer remains 64 and Books remains 77. Functions deploy through the repository workflow. Roll back by reverting the Phase 16 commit. The certification endpoint is read-only, so rollback cannot alter operational or financial balances.
