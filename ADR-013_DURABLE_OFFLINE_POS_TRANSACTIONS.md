# ADR-013 — Durable and Idempotent Offline POS Transactions

**Status:** Accepted  
**Date:** 9 August 2026  
**Deciders:** Danilo Magbual and Codex

## Context

The legacy POS queued sales in `localStorage` and later wrote `/orders` and `/activeOrders` directly. It had no durable state history, no reliable failure/retry control, weak collision protection, and denomination changes could be lost or applied inconsistently.

## Decision

- Store every POS sale command in IndexedDB before clearing the cart or printing success.
- Assign a permanent random `clientTxnId` and collision-resistant order ID before queueing.
- Use explicit `pending`, `syncing`, `failed`, and `synced` states with attempt count, error, and retry controls.
- Print **PENDING SYNC** until Firebase confirmation is received.
- Allow offline cash sales only. Non-cash and platform payments remain blocked offline.
- Synchronize through the authenticated `syncOfflinePosSale` Cloud Function.
- Let the server create the authoritative order and apply denomination drawer deltas once using per-transaction markers.
- Preserve legacy `localStorage` entries only through a one-time IndexedDB migration, then remove the old key.

## Options Considered

### Keep localStorage and direct writes

Low effort but not transaction-safe, weakly observable, and unable to protect drawer deltas from retries. Rejected.

### Use Firebase browser persistence alone

Useful for ordinary writes, but it does not provide the business-visible queue states and server command idempotency required for financial transactions. Rejected.

### IndexedDB plus server-owned command

Chosen. More code and one new callable, but provides durable local intent, visible failure, authenticated processing, and idempotent denomination updates.

## Consequences

- A browser/device retains pending sales through refresh or closure.
- A cashier can inspect and retry failures.
- Clearing browser site data still destroys unsynchronized local commands; operational controls must warn against doing this.
- The device must reconnect and the same cashier/admin must authenticate before synchronization.
- Cash is the only payment permitted while offline.

