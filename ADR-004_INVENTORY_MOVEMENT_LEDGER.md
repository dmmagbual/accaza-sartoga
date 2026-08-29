# ADR-004 — Server-Authoritative Inventory Movement Ledger

**Date:** 9 August 2026  
**Status:** Accepted; locally implemented, production rollout pending

## Decision

Inventory quantity and weighted-average cost are controlled by Cloud Functions. The browser submits business movements but cannot write the accounting state, current-balance projection, or immutable movement history.

Each item uses `/inventoryAccounting/{itemId}` as its atomic transaction boundary. A deterministic movement ID is stored under that item's `applied` map in the same transaction as the new quantity and cost. Replaying the same movement is therefore a no-op. `/inventoryMovements/{movementId}` is the queryable audit projection and `/inventoryBalances/{itemId}` is the current balance projection. Legacy `/inventory/{itemId}/stock` and `cost` remain synchronized compatibility fields for the existing UI and recipes.

## Why

The previous order-level claim could survive a partial ingredient deduction. A retry could then either skip missing deductions or repeat completed ones. Per-item movement IDs make each ingredient independently retryable. Browser closure no longer prevents order deduction, and browser writes cannot forge migrated stock balances.

## Movement sources

- Completed/received sale usage: server trigger.
- Void/refund return: server trigger linked to the original sale movements.
- Purchase, internal usage, R&D, waste, adjustment, direct edit, and usage reversal: authenticated callable, permission checked server-side.
- Opening balance: explicit administrator initialization from the current legacy stock and WAC.

## Trade-offs

- `/inventoryAccounting/{itemId}/applied` grows with movements. It is private and provides atomic idempotency; later compaction must preserve a permanent movement-ID claim index.
- Existing screens still read `/inventory`; this avoids a risky simultaneous UI rewrite. Those fields become server projections after initialization.
- Negative stock remains allowed and visible. Blocking it would stop sales when counts are temporarily wrong; the ledger makes the cause traceable instead.
- Migration is never automatic. The owner must back up Firebase, stop sales briefly, deploy backend/rules, and explicitly capture opening balances.

## Rejected alternatives

- One transaction for the whole inventory tree: high contention and large retry payloads.
- One order-level `inventoryDeducted` flag: unsafe after partial failure.
- Browser-authored movement records: forgeable and not an accounting authority.
- Rebuilding every balance from all history on each screen load: slow and unsuitable for live POS use.
