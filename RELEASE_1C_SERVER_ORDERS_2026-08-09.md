# Release 1C — Server-Priced, Customer-Owned Online Orders

**Prepared:** 9 August 2026  
**Deployment status:** Not deployed  
**Customer build:** v41  
**Admin build:** unchanged (v144)

## Outcome

New customer orders are no longer priced or created by the browser. A callable Cloud Function authenticates the anonymous Firebase customer session, validates every field and line, rebuilds prices from the live Firebase menu, applies valid add-ons and packages, generates an unguessable order ID, stamps `ownerUid`, and writes the order through the Admin SDK.

Customers can read only new orders owned by their Firebase UID. Receipt confirmation is also server-owned. Direct customer writes to `/orders` and `/orderLocks` are denied.

## Changed files

- `index.html` — build v41
- `functions/index.js`
- `database.rules.json`
- `functions/.env.accaza-sartoga` — local, ignored by Git
- `.env.example`
- `package.json`
- `package-lock.json`
- `tests/static-check.mjs`
- `tests/order-pricing-check.mjs`
- `tests/rules-ownership-check.mjs`
- `ACCAZA_IMPROVEMENT_ROADMAP.md`
- `RELEASE_1C_SERVER_ORDERS_2026-08-09.md`

`admin.html` is unchanged in this release.

## Release SHA-256 hashes

| File | SHA-256 |
|---|---|
| `index.html` v41 | `A637E940EB1675E0DC7C3D223DC94389E44802013A4DC062B45D19FC6643A7FA` |
| `functions/index.js` | `D4251229BF04A1A5A08DF5D02D4CE407FDF5A1A36E171CA5D7A11507E6FB82E6` |
| `database.rules.json` | `E4CC41D01FBF9669361A2E04FB0A285BE2B75F277D294C952839393D3F9C9750` |
| `tests/static-check.mjs` | `8207715F3DF6B7B647950FE73D943518F26D17561B8CAA1534206AD89B320967` |
| `tests/order-pricing-check.mjs` | `D7947CBC84A9A093BFBE4EAC952F1469C554F6F97BCFC20027DBA6A5E34B8BD2` |
| `tests/rules-ownership-check.mjs` | `020C3D0C79F9397498CCD3522B32EC87D789554852217EB27D4FC45CD753CF6C` |

## Cloud Functions

### `createOnlineOrder`

- Requires Firebase Authentication; anonymous customer auth is accepted.
- Limits customers to five order attempts per minute.
- Validates name, phone, order type, delivery address, payment method, contact method, notes, proof type/size, line count, and quantities.
- Loads `/menuItems`, `/optionGroups`, `/availability`, and `/packages` on the server.
- Rejects missing or unavailable items.
- Ignores browser-supplied item names and unit prices.
- Recalculates size price and every add-on from the configured menu/option data.
- Validates package eligibility, quantities, paid/free roles, discounts, and extra charges.
- Rejects checkout if the displayed browser total differs from the authoritative server total.
- Uses a private per-UID duplicate lock and an unguessable order ID.
- Writes `ownerUid`, `pricingVersion: server-v1`, server total, server line items, package snapshots, and timestamps.
- Creates `/customerOrders/{uid}/{orderId}` for cross-refresh tracking.
- Updates the UID-keyed customer profile and order count server-side.

### `confirmOrderReceived`

- Requires the same authenticated UID that owns the order.
- Accepts only Ready or Completed orders.
- Writes Received status and receipt audit fields through the server.

### Existing push notification

`notifyOnComplete` now reads the push token from `/appCustomers/{ownerUid}` for new orders, with phone-key fallback for legacy orders.

## Customer frontend changes

- Checkout invokes `createOnlineOrder`; it no longer writes `/orders` or `/orderLocks` directly.
- Receipt confirmation invokes `confirmOrderReceived`.
- Customer order IDs are loaded from the UID-owned `/customerOrders` index.
- Customer profiles and push tokens are now written under the Firebase UID, not the phone number.
- App logout clears local order ownership, removes that UID's push token, and signs out the anonymous Firebase session.
- Package components now carry paid/free roles for server validation.
- Package quantities are locked in the cart; removing a package removes its complete set.
- Package extra charges are included visibly in the customer total.

## Rules changes

- New orders with `ownerUid` are readable only by that UID or authorized staff/admins.
- Customers cannot create, modify, refund, void, verify, settle, or confirm new orders directly.
- `/orderLocks` and `/rateLimits` are private/server-only.
- `/customerOrders/{uid}` is readable only by that UID; browser writes are denied.
- `/appCustomers/{uid}` is owner-readable. Customers may update only their own name, phone, last-seen time, and push token fields; counters remain server-owned.
- Legacy orders without `ownerUid` remain readable by a customer who already knows the order ID, and may still use the old Received transition. This is a temporary compatibility bridge for active pre-1C orders.

## Validation completed

- All 20 executable HTML script blocks pass syntax checks.
- Firebase Realtime Database Emulator compiles the rules.
- Firebase Functions dry-run packaging succeeds; nothing was deployed.
- Server pricing tests prove that forged browser prices are ignored.
- Tests cover valid add-ons, invalid add-ons, unavailable products, fixed-discount packages, package extra charges, and buy-one/free-one promotions.
- Emulator ownership tests prove:

  - Customer A can read Customer A's new order.
  - Customer B and unauthenticated visitors are denied.
  - Customers cannot create orders directly.
  - Customers cannot directly alter new order status.
  - UID-owned customer indexes and profiles reject cross-user access.
  - Order locks reject customer reads and writes.
  - Authorized staff and owners retain operational access.
  - The temporary legacy-order compatibility path works.

Run locally:

```powershell
npm test
npm run test:rules
firebase deploy --only functions --dry-run --project accaza-sartoga
```

## Coordinated deployment order

This order avoids stopping online checkout during the cutover.

### 1. Pre-deployment

1. Confirm Release 1B is stable.
2. Export a fresh Realtime Database backup outside the public repository.
3. Preserve the current live `index.html`, Functions revision, and database rules.
4. Confirm Anonymous Authentication remains enabled in Firebase Authentication.
5. Confirm `functions/.env.accaza-sartoga` contains `ENFORCE_APP_CHECK=false` for the first deployment.

### 2. Deploy Functions first

```powershell
firebase deploy --only functions --project accaza-sartoga
```

Confirm these functions appear successfully:

- `createOnlineOrder`
- `confirmOrderReceived`
- `notifyOnComplete`
- `onOrderFinalize`

### 3. Publish customer build v41

Upload only `index.html` v41 to the GitHub Pages source. Do not upload the local project, backups, dependencies, environment files, or private documents.

Place one low-value test order. Confirm:

- The returned ID has the new long `ORD-...-...` format.
- The order contains `ownerUid` and `pricingVersion: server-v1`.
- The server total matches the displayed total.
- Customer tracking updates without refresh.
- The POS sees the order normally.

### 4. Deploy database rules

```powershell
firebase deploy --only database --project accaza-sartoga
```

Repeat a normal order, add-on order, unavailable-item attempt, package order, Ready notification, and customer receipt confirmation.

### 5. Ownership smoke test

Open the customer site in a different private/incognito browser. Its anonymous UID must not be able to read the first browser's new order even if the order ID is manually supplied.

## App Check rollout — staged, not yet enforced

The customer build now contains the production reCAPTCHA Enterprise public site key, and missing App Check tokens are logged. Build v41 also forces a fresh anonymous-auth ID token before server order submission and retries once if token propagation briefly returns `unauthenticated`. Functions enforcement remains `false` until valid production traffic is confirmed. Enabling enforcement before monitoring could block legitimate customer orders.

Important correction: callable options now receive `ENFORCE_APP_CHECK` as a real environment Boolean. The earlier `defineBoolean` object was truthy inside Firebase Functions SDK v6 and accidentally rejected requests with missing App Check tokens even while `.env` contained `false`. The regression suite now guards against reintroducing this failure.

Safe sequence:

1. Firebase Console → Security → App Check.
2. Register the web app and the exact GitHub Pages/custom production domain using reCAPTCHA Enterprise. (Completed for build v41.)
3. Put the resulting public site key in `APP_CHECK_SITE_KEY` in `index.html`. (Completed.)
4. Publish customer build v41.
5. Monitor Cloud Functions App Check metrics and missing-token logs with enforcement still off.
6. After legitimate production traffic shows valid tokens, change `ENFORCE_APP_CHECK=true` in `functions/.env.accaza-sartoga` and deploy Functions again.

Do not enable Realtime Database-wide App Check enforcement in this release; the admin portal must first initialize App Check as well. Firebase recommends monitoring valid traffic before enforcement to avoid blocking legitimate users.

## Rollback

After the full cutover, rollback in this order:

1. Restore and deploy the previous Release 1B database rules first, so the old browser checkout is allowed again.
2. Restore the previous `index.html` v38.
3. The new callable Functions may remain deployed temporarily; they do not affect v38. Remove them only after checkout is stable.
4. Record the failing order ID, browser error, and Functions log before another change.

## Remaining risks and follow-up

- Customer identity is an anonymous Firebase device session, not a verified human account. It protects one customer session from another but does not provide cross-device recovery. Phone/email authentication would be a separate product decision.
- Pre-1C orders lack `ownerUid`. Remove the temporary legacy read/Received compatibility rule after all old active orders are completed and archived.
- Existing phone-keyed `/appCustomers` records remain as legacy data. Migrate or archive them after UID profiles have operated cleanly.
- Payment proofs are still base64 images inside Realtime Database. Phase 2A must move them to Firebase Storage to reduce payload and lag.
- App Check must be registered, monitored, and then enforced as described above.
- Firebase's dry run warns that `firebase-functions` is not the latest release. Upgrade it in a separate tested maintenance release, not during this security cutover.
