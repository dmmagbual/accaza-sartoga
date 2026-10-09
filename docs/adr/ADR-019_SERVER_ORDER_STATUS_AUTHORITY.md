# ADR-019 — Server-Authoritative Order Status Commands

**Status:** Accepted  
**Date:** 9 August 2026  
**Decider:** Accaza Coffee House owner

## Context

Inventory, COGS, financial postings, refunds, voids, and archive decisions already have server authority. Normal portal order-status changes still used direct Realtime Database updates. Database permissions restricted who could write, but the browser—not the server—selected the transition. A compromised authorized session could bypass the intended screen workflow.

The existing customer receipt command and durable offline POS sale command must remain intact. The POS must not become slower during cart work; only the final status action may wait for the server.

## Decision

Add an authenticated callable `updateOrderStatus`. It verifies portal permission, validates the expected current state and transition, claims a client request ID, updates the authoritative order transactionally, stamps actor/history evidence, refreshes the bounded projection, updates the customer index, and records immutable operational audit evidence.

Direct browser changes to an existing `orders/{id}/status` or `activeOrders/{id}/status` are denied by child validation. Creating a new record is not changed in 7A. Admin SDK Functions bypass these browser rules.

Allowed portal targets are Pending, Confirmed, Preparing, Ready, Rejected, and Completed. Completed and Received are terminal. Received remains exclusive to the UID-owned `confirmOrderReceived` command. Kitchen accounts are recognized server-side and still require the relevant `orders` or `pos` permission.

## Options considered

### Keep authenticated browser writes

- Lowest implementation effort and latency.
- Does not solve browser-selected transitions or provide idempotent command evidence.

### Lock all order writes immediately

- Strongest boundary.
- Too risky for one release because payment verification, refund/void, archive, POS creation, and legacy operational updates are coupled to the order record.

### Incremental status-command authority — selected

- Closes the active status mutation path now.
- Preserves unrelated workflows and enables measured migration of later commands.
- Temporarily leaves non-status operational fields under their existing controls.

## Consequences

- Status actions require connectivity and a valid Firebase portal session.
- The UI displays Processing and rejects stale-screen changes instead of silently overwriting newer status.
- Retrying a request ID is safe, including recovery after the order transaction succeeded but projection/audit completion failed.
- Functions, frontend, and rules are a coordinated release; deploying rules first would break the old status controls.
- Phase 7B can apply the same command pattern to shift/cash-event mutations.
