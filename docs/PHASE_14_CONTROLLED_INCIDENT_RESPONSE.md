# Phase 14 — Controlled incident response and recovery

Phase 14 converts Phase 13 warnings into a controlled, server-authoritative incident record. Rollback pointer: `backup/phase14-pre-incident-response-20260831`.

## Workflow

1. Management classifies the event as SEV1–SEV4 and records affected users/systems.
2. Updates move through investigating, identified, and monitoring with an append-only timeline.
3. Repairs remain in the existing order, inventory, cash, receivable, payable, and Finance Books workflows.
4. Resolution requires explicit confirmation that service, backup, inventory, and Finance reconciliation are verified.
5. A financial-impact incident cannot be resolved by its creator; a different management reviewer must sign off.

## Safeguards

- Browser and database rules cannot write incident records directly; only the authenticated callable can.
- Request IDs are claimed once, preventing duplicate incident events on retry.
- Resolved incidents are immutable.
- Every action creates an operational audit record with the incident ID and actor.
- The incident workflow has no write path to orders, stock, cash custody, subledgers, Finance movements, or Books journals.
- No live database restore is exposed. A backup must first be restored and reconciled in an isolated project under the Phase 12 procedure.

## Financial treatment

Creating, updating, or resolving an incident creates no journal entry because it is evidence, not an economic transaction. Any correction or reversal uses the original controlled workflow and retains its source reference, approval, idempotency protection, subledger effect, Finance movement, Books posting, and audit trail. Inventory, AR, AP, cash custody, and Books must reconcile before resolution. A qualified financial professional should review financial-impact incident evidence before sign-off.

## Deployment and rollback

Admin build 396 and service-worker cache 346 publish after merge; Functions and rules deploy through the repository workflow. Rollback by reverting the Phase 14 commit. Existing incident evidence remains read-only and does not affect balances or POS operation.
