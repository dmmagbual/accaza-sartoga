# Phase 13 — Production observability and early warning

Phase 13 adds an hourly, management-only health signal without touching live business records. Rollback pointer: `backup/phase13-pre-observability-20260831`.

## Design

`bounded operational data → pure health evaluator → sanitized System Health snapshot → Operations Center`

The evaluator checks backup age and integrity, two days of privacy-safe telemetry, performance thresholds, client errors, and the existing bounded scan for stuck orders, incomplete offline sync, missing inventory evidence, missing Finance movements, and aged cash custody. Deterministic signatures prevent repeated history records when nothing changes.

## Financial and operational safeguards

- Monitoring is read-only for orders, stock, subledgers, Finance movements, and Books.
- It never posts, repairs, reverses, allocates, or reconciles automatically.
- Financial or inventory gaps route staff to existing controlled workflows, preserving source references, approvals, idempotency, and audit history.
- History contains sanitized categories and counts, never customer, payment, recipe, or credential data.
- Bounded queries cap cost and runtime; the hourly schedule avoids burdening the active POS.

## Thresholds and trade-offs

Stale or missing backups and existing critical operational exceptions are critical. Performance breaches and client errors are warnings. Fixed thresholds are transparent and inexpensive but are not percentiles; Phase 11 telemetry remains the deeper review source. Revisit percentile storage and external notification only when production sample volume justifies the added cost and false-alert risk.

## Deployment and rollback

Admin build 395 and service-worker cache 345 publish after merge; Functions deploy through the repository workflow. Roll back by reverting the Phase 13 commit. The monitor writes only under `systemHealth/productionMonitor`, so rollback cannot alter financial balances. Stop and investigate if the scheduled Function errors, monitor reads grow unbounded, or the Operations Center cannot load.
