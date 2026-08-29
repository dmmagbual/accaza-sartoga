# ADR-002: Authoritative Orders with a Bounded Operational Projection

**Status:** Accepted  
**Date:** 8 August 2026  
**Deciders:** Danilo Magbual and Codex

## Context

The POS historically subscribed to the complete `/orders` node. That made checkout latency and memory usage grow with every sale. The same node is also a financial and customer record, so deleting or aggressively filtering it in the browser would risk refunds, payout settlement, customer tracking, inventory finalization, and reporting.

Release 2B removed duplicate listeners and lazy-loaded heavy tabs, but the POS still had an unbounded live order payload.

## Decision

Keep `/orders` as the authoritative working record and add `/activeOrders` as a server-maintained operational projection.

- POS/admin order boards and Register Ops subscribe to `/activeOrders`.
- Analytics and finance query recent `/orders` and `/archivedOrders` through bounded, paginated subscriptions.
- New online orders enter `/orders` and `/activeOrders` atomically in `createOnlineOrder`.
- POS offline sync writes the authoritative order and immediate projection together; the server trigger repairs projection drift.
- The server strips legacy embedded proof images from `/activeOrders`.
- Resolved closed-shift POS sales move automatically to `/archivedOrders`.
- Pending non-cash and unsettled GrabFood/FoodPanda orders remain operational after shift close. They archive after verification or payout settlement.
- Recent online terminal orders remain active for 48 hours; the periodic login-triggered sweep removes expired entries from the projection.
- `/orders` remains the trigger source for inventory finalization and customer notifications.

## Options Considered

### Option A: Continue subscribing to all orders

| Dimension | Assessment |
|---|---|
| Complexity | Low |
| Scalability | Poor |
| Financial safety | High initially |
| POS latency | Degrades continuously |

**Pros:** No migration or eventual consistency.  
**Cons:** Payload, rendering, and memory grow without bound.

### Option B: Move every completed order immediately

| Dimension | Assessment |
|---|---|
| Complexity | Medium |
| Scalability | Good |
| Financial safety | Risky for unresolved payments/payouts |
| Customer compatibility | Requires tracker redesign |

**Pros:** Very small `/orders`.  
**Cons:** Can hide orders still requiring verification, refunds, settlement, or customer confirmation.

### Option C: Authoritative orders plus active projection — chosen

| Dimension | Assessment |
|---|---|
| Complexity | Medium-high |
| Scalability | Good |
| Financial safety | High when server reconciliation is deployed |
| POS latency | Predictable |

**Pros:** Separates operational speed from historical/financial retention.  
**Cons:** Adds Cloud Functions, deployment ordering, and eventual-consistency monitoring.

## Consequences

- POS startup no longer reads lifetime orders.
- Closed-shift resolved sales leave the live node automatically.
- Historical screens load fixed recent pages and explicitly request older pages.
- A function outage can delay projection updates but cannot destroy the authoritative order.
- Backend and rules must be deployed before admin v149.
- The 6-hour projection sweep still scans `/orders` server-side. Long-term online-order archival/customer-history design remains future work.

## Action Items

1. Deploy Functions and Database rules together.
2. Confirm `ensureActiveOrders`, `syncActiveOrderProjection`, and `pruneClosedShiftOrders` are healthy.
3. Publish admin v149 only after backend deployment succeeds.
4. Run the Release 2C smoke tests.
5. Monitor projection drift and function errors before proceeding to Release 2D.
