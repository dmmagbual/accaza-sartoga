---
name: accaza-pos-live-safety
description: Use whenever Accaza work can affect POS availability or integrity, including sales, offline queues, shifts, shared auth, pricing, inventory posting, startup, service workers, networking, receipts, or live till recovery.
---

# Accaza POS live safety

The POS is the business lifeline. Protect the ability to take sales and the correctness of every sale throughout investigation, implementation and release, including changes originating in other modules.

Establish whether a shift is active and whether the affected device is taking sales before requesting any refresh, logout, network reset, restart, or storage operation. During an active shift, use source work and safe observation; do not mutate shift/admin records or force refreshes. If live disruption is necessary, obtain explicit approval for a safe window and preserve queued sales first.

Preserve the original browser profile and `accaza-pos-offline` IndexedDB queue. Do not clear browser data, re-enter a failed queued sale, or treat another device as possessing the original queue. Active shift owners and joined crew remain exempt from disruptive idle/session restrictions.

Trace the affected lifecycle: client transaction ID and eligible payment -> durable queue -> `syncOfflinePosSale` / `functions/lib/offline-sync.js` -> authoritative `orders` and live `activeOrders` projection -> drawer -> inventory/COGS -> Finance Books -> close readiness, handover and Z report. Find actual source sections in `src/admin/pos/` and `src/functions/` with targeted searches.

Queued, syncing, failed and confirmed-synced states remain distinguishable. Server acknowledgement and exactly-once evidence are required before declaring recovery. Preserve offline payment eligibility. Serving state is operational and must not create another accounting event.

Before releasing shared auth, pricing, database rules, bundles, cache/service worker or deployment changes, check POS compatibility, startup, durable queue/schema compatibility, retry behavior and an appropriate rollback. Keep heavy work off the checkout path; do not introduce startup/history scans or unnecessary listener/callable work.

Use `accaza-financial-integrity` for sale, tender, stock or close-accounting effects. Add Frontend Developer for material UI and Identity & Access Engineer for session/permission changes. Receipt changes reuse the shared priced-line renderer and preserve print parity.

Test failure/retry, duplicate submission, relevant shift/crew boundaries and close readiness. Fixture success does not confirm a cashier device recovered. Report remaining original-device evidence separately; plan live verification within the user's authority and safe timing. Any unresolved POS regression blocks release of the affected change.
