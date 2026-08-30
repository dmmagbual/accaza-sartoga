# Phase 18 — Proactive observability and controlled recovery

Phase 18 turns the existing hourly health evaluation into a deduplicated management alert. Recovery pointer: `backup/phase18-pre-observability-recovery-20260831`.

## Escalation policy

- A first warning is sent to management immediately.
- A new critical state, severity increase, or changed critical signal is sent immediately.
- Unchanged critical states remind after four hours; unchanged warnings remind after twelve hours.
- Recovery sends one notice asking management to verify service and reconciliation before resolving any incident.
- Repeated unchanged signals inside the cooldown are suppressed.

Only sanitized severity, counts, reason, signature, and timestamps are stored under `systemHealth/productionMonitor`. Notifications contain no customer, order, payment, recipe, stock, or journal detail. Invalid staff push tokens may be pruned through the existing notification service.

## Response runbook

1. Open Operations Center and classify impact: SEV1 for total service loss, SEV2 for a major customer/POS function, SEV3 for limited degradation, or SEV4 for cosmetic/low impact.
2. Confirm the backup fingerprint and open an incident for a material or repeated alert. Do not edit live database balances.
3. Route repairs through the original controlled order, inventory, cash-custody, receivable, payable, Finance, or Books workflow.
4. Preserve the source reference, subledger effect, later allocation or settlement, correction or reversal link, approval, audit trail, and idempotency claim.
5. Compare inventory and subledgers with Finance Books at the same cut-off. Any difference remains open and blocks incident resolution.
6. Monitor at least one subsequent healthy evaluation. A recovery notification means the signal cleared; it is not financial certification.
7. A different management reviewer and a qualified financial professional must review financial-impact evidence before final sign-off.

## Rollback triggers

Revert Phase 18 if alerts expose business content, repeat within their cooldown without a new critical signal, fail the scheduled health Function, or slow the active POS. Notification failure is retried on the next hourly evaluation because notification state is saved only after the send completes.

The monitor never posts, repairs, allocates, reverses, restores, or reconciles business data. Reverting Phase 18 cannot change live orders, inventory, cash, subledgers, Finance movements, or Books journals.
