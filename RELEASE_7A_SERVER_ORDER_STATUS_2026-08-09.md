# Release 7A — Server-Authoritative Order Status

**Build:** admin v167, customer v45, service-worker cache v56  
**Firebase:** new `updateOrderStatus` callable plus coordinated Database rules

## Delivered

- Portal status dropdown and Mark Completed now call `updateOrderStatus`.
- The command validates identity, `orders`/`pos` permission, target status, expected current status, terminal states, and request-ID ownership.
- Status changes write actor, role, timestamp, command ID, per-order history, and operational audit evidence.
- Duplicate replay is idempotent; partial projection/audit failure can be retried safely.
- Direct browser changes to existing authoritative or projected status values are denied.
- Customer receipt confirmation continues through `confirmOrderReceived`.
- Offline POS sale creation continues through `syncOfflinePosSale`.
- Kitchen is recognized by the shared server portal-role helper and remains permission-gated.

## Mandatory deployment order

Do not deploy Database rules first.

1. Deploy the new Function:

   ```powershell
   firebase deploy --only functions:updateOrderStatus
   ```

2. Publish the complete GitHub frontend set below and wait for GitHub Pages to update.
3. Confirm admin shows build v167, then deploy rules:

   ```powershell
   firebase deploy --only database
   ```

## GitHub upload set

Runtime:

- `admin.html`
- `sw.js`
- `assets/js/admin/firebase-client.mjs`
- `assets/js/admin/admin-orders.mjs`
- `assets/js/admin/customer-order-tracker.mjs`
- `assets/js/admin/core.mjs`
- `assets/js/admin/telemetry.js`
- `functions/index.js`
- `functions/lib/order-status.js`
- `database.rules.json`

Tests and release truth:

- `tests/order-status-command-check.mjs`
- `tests/static-check.mjs`
- `tests/rules-ownership-check.mjs`
- `release-manifest.json`
- `ADR-019_SERVER_ORDER_STATUS_AUTHORITY.md`
- `RELEASE_7A_SERVER_ORDER_STATUS_2026-08-09.md`
- `CLAUDE_HANDOFF.md`
- `CLAUDE_HANDOFF_CURRENT.md`
- `ACCAZA_IMPROVEMENT_ROADMAP.md`

## Production acceptance

1. Owner/admin: move an online order Pending → Confirmed → Preparing → Ready → Completed.
2. Kitchen account with Orders permission: move a test order to Preparing and Ready.
3. Confirm Ready notification still fires.
4. Confirm Completed produces inventory/COGS and financial evidence exactly once.
5. On a stale browser, attempt a conflicting change and confirm it asks for refresh rather than overwriting.
6. Customer confirms Received through the customer site.
7. Confirm `/orderStatusCommands/{requestId}` and `operationalAudit` contain server evidence.

## Rollback

Rollback must be coordinated:

1. Restore the previous Database rules first so the old browser control can write status.
2. Restore v166/cache-v55 frontend files.
3. The unused `updateOrderStatus` Function may remain temporarily or be deleted after the old frontend is confirmed.

Never restore only the old frontend while keeping the 7A status lock.
