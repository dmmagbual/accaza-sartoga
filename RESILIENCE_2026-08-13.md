# Accaza — Resilience / Fail-Proofing Pass

**Date:** 2026-08-13 · after build v190. **Goal:** survive what the code can't control — data loss, bad deploys, abuse, human error.

The bug-level work is done (see AUDIT_REVIEW_2026-08-13.md). This pass is about recovery and hardening. Nothing is ever truly "fail-proof," but these close the gaps that would actually hurt.

---

## Shipped this pass

### Automated daily database backup (`backupDatabaseDaily`)
New scheduled Cloud Function, runs **03:00 Asia/Manila daily**. Snapshots all durable business data (orders, inventory, financial ledgers, customers, recipes, settings, shifts, expenses, chart of accounts, etc.) to Cloud Storage as timestamped JSON, and **keeps 30 days** (auto-deletes older).

- **Where:** the payment-proof bucket, prefix `db-backups/accaza-YYYY-MM-DD-HH-MM-SS.json`.
- **Excluded (by design):** `activeOrders`, `orderLocks`, `rateLimits`, `orderStatusCommands`, `offlinePosSync`, `clientTelemetryDaily` — these are transient or reconstructable; a restore rebuilds them.
- **Why it matters:** this is the safety net behind a corrupt write, an accidental delete, or a bad migration. Your `release-manifest.json` flagged `backupRestoreTest: pending`; this is the backup half.

### RESTORE RUNBOOK (do this once to prove it works — closes `backupRestoreTest`)
A backup you've never restored is a guess, not a safety net. Test it once in a safe way:

1. In Firebase Console → Storage, open `db-backups/`, download the latest `accaza-*.json`.
2. Open it — confirm it contains your real nodes (`orders`, `inventoryBalances`, `financialMovements`, etc.) under `data`.
3. To actually restore (only in a real emergency): the JSON's `data` object maps 1:1 to database paths. Restore a single node by importing that sub-object at the node in Console → Realtime Database → (node) → Import JSON. **Never** import the whole file at the root without care — it would overwrite live data. Restore the specific damaged node only.
4. Recommended: once, restore one non-critical node (e.g. `expenseCategories`) into a scratch path to confirm the shape imports cleanly. Then mark `backupRestoreTest: passed` in the manifest.

---

## Investigated, deliberately NOT changed

### Dependency vulnerabilities — no upstream fix exists yet
`npm audit` shows 11 issues (1 high, 9 moderate), all transitive: `firebase-admin` → `@google-cloud/storage@7.21.0` → `teeny-request`/`retry-request`. I tested bumping `firebase-admin` 12 → 14 (latest): **the vulnerable `@google-cloud/storage@7.21.0` is still pulled, and the high-severity issue remains.** So a major-version bump buys real runtime-breakage risk for zero security gain — I reverted it.
**Practical exposure is near-zero:** these are SSRF/redirect issues in an HTTP helper that only ever calls Google's own storage endpoints with non-attacker-controlled URLs. Nothing in your code feeds it external URLs.
**Action:** none now. Recheck at your next `quarterlyDependencyReview` — when Google patches `@google-cloud/storage`, bump `firebase-admin` and re-run `test:ci`.

---

## Your to-dos (need Firebase/Google Cloud console — I can't do these from here)

Ranked by value:

1. **Test the restore** (runbook above). Highest value — an untested backup is a maybe. 20 minutes, once.
2. **Turn on failure alerting.** Google Cloud Console → Monitoring → Alerting → create a policy on Cloud Functions "execution count with status=error" for your functions. Right now if `onOrderFinalize` or `createOnlineOrder` starts failing in production, nobody is told. Push, not pull.
3. **Enable App Check.** Currently `ENFORCE_APP_CHECK=false`, so anyone with your public config can *call* your functions (they still can't act without a valid login, and orders are rate-limited — so it's an abuse surface, not an open door). Set up a provider (reCAPTCHA Enterprise for web) in Console → App Check, init it in the client, then flip the env var. Do this in staging first — misconfiguration locks out real users. Tell me when you're ready and I'll wire the client side.
4. **Close your manifest's own pending checks:** `productionBuild...SmokeTest`, `productionPerformanceReview`, `quarterlyPermissionReview`. You already decided these matter; they're marked `pending`.

---

## What's already solid (don't spend effort here)

Server pricing authority, idempotent order/status/offline flows (exactly-once, tested), double-entry balanced postings, WAC costing, default-deny rules with server-only ledgers, payment-proof rollback on failure, bounded retention (now with the prune sweep), and — as of this pass — automated recovery points. This is a genuinely well-built system.
