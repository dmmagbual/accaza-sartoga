---
name: accaza-firebase-cost-review
description: Use when Accaza work affects Firebase RTDB or Firestore queries, listeners, Functions, triggers, schedules, caching, backups, or Firebase usage diagnosis.
---

# Accaza Firebase cost review

Apply the root Firebase Cost Discipline rules to the affected operation. Start with current call sites, the exact paths/fields consumed, their indexes, and the screen/job lifecycle. Use `accaza-pos-live-safety` for access, caching or server changes that can affect the till.

- Prefer a key lookup, indexed bounded query, maintained summary/index, or existing cached data. Historical screens need pagination/incremental reads without silently omitting old unpaid/unsettled records.
- Reuse the server operation already required for posting, approval or close. Explain why any additional callable, trigger, schedule or poll is necessary.
- For each affected Cloud Function, review invocations per business action, retries, execution time, memory, CPU, timeout, concurrency and minimum/maximum instances. Size these from realistic workload evidence; do not add warm instances or raise resources as a precaution without measured need and a cost estimate.
- Prefer atomic multi-path updates where appropriate, small locks/claims, one-time reads for non-live data, and bounded listeners detached when screens close.
- Pair RTDB query indexes with `database.rules.json`; use the actual Firestore index configuration for Firestore queries. Rules and permission checks remain intact.
- Rare unavoidable whole-collection reads belong in explicit manual tools, marked `download-ok` with their reason. Do not add startup/history scans or automatic System Health polling.
- Versioned caches preserve validity, authorization scope and refresh/recovery behavior. Saving reads cannot make the till slow or display stale financial authority.

For every relevant proposal and handoff, provide this cost contract:

| Meter | Required evidence |
|---|---|
| RTDB downloads | Paths, query bounds, expected bytes/download behavior, cache behavior and listener lifetime |
| Firestore document reads | Queries, pagination/index strategy and maximum reads per page or business action |
| Cloud Functions | Invocations added/removed per business action, retry behavior, expected execution time and affected runtime/scaling settings |
| Billing guard | Comparable workload baseline, expected change, alert/rollback threshold and evidence source |

Say "no database access change" when applicable. Distinguish estimates from measured usage; a listener callback is not proof of full retransmission. Normalize comparisons by orders, users, pages, shifts or another stable workload unit rather than comparing raw daily totals alone.

Test query bounds, listener cleanup, relevant missing/stale cache cases, Function retry/runtime behavior and correctness. Quantify savings only with comparable live usage and workload evidence, never from source inspection alone. An unexplained or unbounded Firebase cost regression blocks the affected release until corrected or explicitly accepted with a recorded business reason.
