# Release 7J — Order-status "Order not found" cold-cache fix

**Date:** 2026-08-10
**Severity:** High — intermittently blocked all portal order-status changes on live.
**File changed:** `functions/lib/order-status.js` (bundled and deployed via `functions/`).

## Symptom

Changing an order's status in the admin/POS panel returned:

> Could not update order: Order not found.

…even though the order existed. Confirmed live: order `ORD-MSMU96BS-4D044E0C11`
was present under both `/activeOrders` and `/orders`, yet the update failed.

## Root cause

`updateOrderStatusCommand` read the order with a Realtime Database transaction:

```js
await orderRef.transaction((current) => {
  if (!current) { failure = ["not-found", "Order not found."]; return; }
  ...
});
```

The Firebase Admin SDK may invoke a transaction's update function with `null`
on its **first pass** when the node is not locally cached — which is the normal
state on a cold Cloud Function instance. Returning `undefined` on that first
`null` **aborts** the transaction before the SDK fetches the real value, so an
order that exists is reported as "Order not found." It therefore failed on cold
instances and appeared to work when the function was warm — i.e. intermittent.

This affected **every** order status change, not only online orders.

## Why tests missed it

`tests/order-status-command-check.mjs` stubbed `transaction()` to pass the real
current value on the first call, so it never reproduced the cold-cache `null`.
Green tests, live bug.

## Fix

**First attempt (insufficient — kept here for the record):** added a `get()`
existence check before the transaction to prime the cache. Verified against
production via Cloud Logging + the browser Network payload: the admin page sent
the correct `orderId` (`ORD-MSMU96BS-4D044E0C11`), the order existed under
`/orders`, yet the deployed function still returned HTTP 404. The `get()` did
**not** prime the transaction's cache in the Admin SDK, so the transaction's
first pass was still `null` and still aborted.

**Actual fix:** remove the transaction entirely for the order mutation. Read the
order once with `get()`, validate the transition, and commit with a single
atomic multi-path `update()` (which now includes `orders/{orderId}` itself):

```js
const snap = await orderRef.get();
if (!snap.exists()) raise(options, "not-found", "Order not found.");
const current = snap.val() || {};
const from = String(current.status || "Pending");
// ...validate expectedStatus + canTransition...
const writes = { ...commandStatus };
if (!result.duplicate) writes[`orders/${orderId}`] = updatedOrder;
// ...activeOrders projection, customerOrders status, operationalAudit...
await db.ref().update(writes);
```

Idempotency is still guaranteed by the `orderStatusCommands/{requestId}` claim
taken earlier (a replay short-circuits as `duplicate`), and `expectedStatus`
rejects stale transitions. Behaviour is now fully atomic: if the commit fails,
nothing is applied (previously the transaction could commit the order status
before a later projection write failed) and the request is safely retried. A
genuinely missing order still returns not-found.

## Regression test added

`tests/order-status-command-check.mjs` now includes a `ColdRef`/`ColdDb` harness
that returns `null` from `transaction()` until `get()` has primed the path,
reproducing the real cold-cache behavior. The test asserts the status change
still applies, and that a truly missing order still raises not-found. Without the
`get()` fix, this test fails.

## Validation

- `node tests/order-status-command-check.mjs` — PASS (incl. cold-cache case)
- `npm test` (static-check runs the above) — PASS
- `node tests/release-readiness-check.mjs` — PASS
- `node tests/repository-safety-check.mjs` — PASS (171 tracked files)

## Deploy

- Changed file: `functions/lib/order-status.js`
  (`BC268896619A42942E9EA9D27BE283760D524B26A9F7EC4167615ABFC6BDC5E1`, 5,686 bytes)
- `functions/index.js` is unchanged (`D2BB5D44...`) but requires `lib/` present.
- Deploy: push `functions/**` to GitHub (auto-deploys) **or**
  `firebase deploy --only functions:updateOrderStatus`
- No frontend, rules, or storage change in this fix.
