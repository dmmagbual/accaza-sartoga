# Release 2B — Auth-Gated Real-Time Data Layer

**Status:** Implemented and locally validated on 9 August 2026  
**Admin build:** v148  
**SHA-256:** `AFECCB531C939B543D695D568C1EF25EAFFB2D3740E623EF9063B0BD3B051CE9`

## Outcome

`admin.html` now uses one shared subscription hub for Realtime Database data. Protected listeners do not connect until the Firebase user has passed the server-backed `/admins/{uid}` authorization check. The login flow therefore no longer needs a page reload.

The hub guarantees one physical Firebase listener per database path even when several modules consume that path. It keeps POS-critical paths live and attaches larger back-office paths only while a relevant tab is active. When the user leaves the last relevant tab, the heavy listener is detached and its cached snapshot is released.

## Always-Live POS Data

- Categories and menu items
- Item option groups
- Availability
- POS settings and channel prices
- Active orders
- POS staff and active shift
- Packages
- Firebase connection state

## Lazy Data Examples

- Inventory, recipes, purchases, and internal usage
- Analytics, reviews, feedback, and customer profiles
- P&L, stock value, payouts, receivables, payables, and cash flow
- Archived orders and reservations
- Register activity, shift history, discrepancies, and petty cash
- Admin/staff account-management records

## Authentication Changes

- Firebase Auth continues to use `browserLocalPersistence`.
- The shared listener hub starts only after `authorizePortalUser()` succeeds.
- The forced `location.reload()` after login was removed.
- Logout and unauthenticated state immediately detach all managed listeners.
- The login dialog now waits for the Firebase Auth gate to resolve, avoiding the old fixed-delay race.

## Validation

`npm test` passes:

- 20 executable HTML scripts parse successfully.
- Security and customer-field containment checks pass.
- Server pricing and payment-proof validation pass.
- New guards confirm the subscription hub exists, tab activation is wired, isolated modules no longer create raw listeners, and portal login has no forced reload.

## Deployment

Upload only `admin.html` v148 to the GitHub-hosted site. No Firebase Database, Functions, or Storage deployment is required for this release.

After GitHub publishes it, verify:

1. Log in and confirm the dashboard data appears without a page refresh.
2. Refresh manually and confirm the session and data remain.
3. Open POS and place a small test order.
4. Open Inventory, Analytics, P&L, and Cash Flow once; confirm each loads when selected.
5. In the browser console, run `window.__accazaLiveStats()` to inspect the current tab scope and attached database paths.

## Honest Remaining Limit

Release 2B removes duplicate connections and lifetime-history reads at startup, but `orders` is still a full-node live subscription. Release 2C should introduce bounded active-order queries and pagination/archive windows so performance remains predictable as the order count grows.
