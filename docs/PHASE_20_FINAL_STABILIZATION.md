# Phase 20 — Final stabilization and production-readiness handoff

Phase 20 closes the numbered construction program with a deterministic meta-gate. Recovery pointer: `backup/phase20-pre-final-stabilization-20260831`.

## Automated completion gate

The gate confirms that recovery certification, production certification, production validation, alert escalation, and security/accounting assurance remain present and passing. It also proves that CI still runs release consistency, repository safety, database-rule emulator tests, and desktop/mobile browser smoke tests.

The release deliberately remains `candidate_pending_production_verification`. Code cannot truthfully complete the following operator evidence:

1. Restore the latest production `backup-v2` into an isolated project and reconcile inventory, cash custody, AR, AP, Finance movements, and Books at one cut-off.
2. Review actual production performance and critical customer/POS/PWA journeys after deployment.
3. Review portal permissions plus Google Cloud/Firebase IAM and service accounts.
4. Review current dependency findings and approve remediation or documented acceptance.
5. Obtain independent qualified financial and security sign-off with dated evidence.

## Deployment checklist

- Merge only during a quiet POS period with a current verified backup.
- Require a green PR quality gate; do not bypass failed tests.
- Confirm Pages, Functions/rules, and post-merge quality workflows succeed.
- Refresh with `Ctrl + Shift + R` and verify the visible build.
- Run Phase 17 validation, inspect Phase 19 assurance results, and monitor Phase 18 alerts for at least one subsequent hourly evaluation.
- Stop and revert if ordering, tracker, reservations, reviews, PWA update, POS operation, balanced journals, or reconciliation fails.

## Final sign-off

Only a separate evidence-only pull request may change the manifest to `production_verified`. It must replace every pending field with a dated passed result and identify preparer and independent reviewer. Never commit credentials, database exports, customer/payment data, or confidential audit evidence.

After Phase 20, use focused maintenance pull requests rather than adding more numbered construction phases: monthly reconciliation, quarterly restore/access testing, dependency updates, performance review, and narrowly scoped features or fixes.
