# Accaza — Quarterly Dependency Review

**Date:** 2026-09-01 · **Reviewer:** Danilo Magbual (with Claude)
**Scope:** production dependencies of `functions/` (the Cloud Functions backend) and root test tooling.
**Closes:** audit finding **M-5** and release-manifest `verification.quarterlyDependencyReview`.

## Method
- `npm --prefix functions audit --omit=dev --json` (production deps only).
- `npm audit --omit=dev` at repo root (test tooling).
- Reachability check of the flagged code path against `src/functions`, `functions/lib`, `functions/index.js`.

## Findings

**Root test tooling:** 0 vulnerabilities.

**Functions backend:** 7 *moderate* advisories reported. All 7 trace to **one** root cause:

> `uuid` < 11.1.1 — "Missing buffer bounds check in v3/v5/v6 when `buf` is provided" (moderate).

Propagation chain (why 7 packages light up for 1 issue):
`uuid` → `gaxios` / `teeny-request` / `retry-request` → `@google-cloud/storage` (7.22.0) → `firebase-admin` (^14.2.0) → `firebase-functions` (^7.3.2).

Resolved `uuid` versions in the tree: **9.0.1** and **10.0.0**, pulled transitively by Google's `google-gax` / `@google-cloud/storage`. `uuid` is **not** a direct Accaza dependency.

## Risk assessment

- **Not reachable from Accaza code.** The advisory affects `uuid` v3/v5/v6 **only when a caller supplies its own `buf`**. Grep of all functions source finds no v3/v5/v6-with-buffer usage. Google's clients use random (v4) IDs, which the advisory does not touch. Practical exposure: effectively nil.
- **Below the project's own gate.** `npm run audit:dependencies` runs at `--audit-level=high`; these are *moderate* and do not fail it.
- **Severity in context:** moderate, transitive, in Google's first-party SDK.

## Decision — accept, do not patch (this quarter)

1. **Do NOT run `npm audit fix --force`.** Its only "fix" is a *major* `firebase-admin` / `firebase-functions` bump — a breaking change to the entire callable/runtime surface, unjustified by an unreachable moderate.
2. **Do NOT add an `overrides: { uuid: "^11.1.1" }` pin.** uuid v11 is a major jump from the v9/v10 that `google-gax` / `@google-cloud/storage` were built against. Forcing it risks breaking the exact clients behind **payment-proof uploads** and the **daily database backup** — a real operational risk for zero reachable-security gain.
3. **Let it clear upstream.** Google patches `@google-cloud/storage` / `google-gax` regularly; a routine future `firebase-admin` minor/patch bump will pull a patched `uuid` with no manual override. Re-check at the next dependency review.

## Re-review triggers
- Any advisory here escalates to **high/critical**, or becomes **reachable** (we start using uuid v3/v5/v6 with a buffer) → patch immediately.
- Next scheduled quarterly review, or before any major migration.
- On a planned `firebase-admin` upgrade, re-run `npm --prefix functions audit --omit=dev` and expect this to be gone.

## Record
`release-manifest.json → verification.quarterlyDependencyReview` set to `reviewed_2026-09-01`, referencing this file.
