# Cloud Functions — Phase 1 deploy & test
_Server-authoritative deduction + fixed "ready" push timing. Purely additive: your live `index.html` / `admin.html` / rules are unchanged, so nothing breaks if you don't deploy. The client still deducts for instant POS; the function is a browser-independent backstop and both are idempotent (never double-deduct)._

## What changed in `functions/index.js`
1. **`notifyOnComplete`** now fires the push when an order becomes **`Ready`** (was `Completed`) — so the "ready for pick-up / delivery" push arrives at the right moment.
2. **New `onOrderFinalize`** — when an order reaches **Completed** or **Received**, the server computes recipe usage (base-per-size + options + category consumables — a faithful port of the client `computeUsage`), deducts stock, and writes `cogsSnapshot` / `inventoryUsage` / `inventoryDeducted` / `deductedBy:"server"`. Idempotent via a transaction claim on `inventoryDeducted`, so it can't double-deduct with the client.

## Deploy (from the project folder, one command)
```
firebase deploy --only functions
```
- You already deploy functions (the push one), so the CLI + login are set up.
- It will deploy `notifyOnComplete` (updated) and `onOrderFinalize` (new).
- First deploy of a 2nd-gen function can take a couple of minutes.

## Test (do this right after deploy)
**A. Ready push timing**
1. Place a test online order (installed app / phone with notifications allowed).
2. In admin, set it to **Ready for Pickup/Delivery**.
3. The push should arrive now (not at Completed). ✅

**B. Server deduction with NO browser open (the key fix)**
1. Make sure a couple of test items have a recipe + costs, and note their stock.
2. Place a test online order for those items.
3. **Close all admin/POS tabs** (so the client engine is NOT running).
4. On the customer view, mark the order **Received** (or set Completed from a phone).
5. In the Firebase console → **Functions → Logs**, look for `Server deducted order`.
6. Check **Inventory**: stock dropped exactly once; the order shows a `cogsSnapshot` and `deductedBy: "server"`. ✅

**C. No double-deduction with a browser open**
1. With an admin/POS tab open, ring a POS sale (or complete an online order).
2. Confirm stock dropped only **once** (client claimed it; server aborted — or vice-versa). ✅
   - In logs you may see the function run and return early ("already claimed") — that's correct.

## Rollback (safe)
- The client still deducts on its own, so if you ever want to disable the server function:
  `firebase deploy --only functions` after commenting out `onOrderFinalize`, or delete it in the console. Behavior reverts to client-only. No data migration needed.

## What this Phase does NOT do yet (Phase 2, when you're ready)
- It does **not** lock the rules or move **manager-PIN approvals** (void / refund / verify / petty approve) to the server. That's the C2/C3 enforcement step: locking `inventory/stock`, `orders/status→Completed`, etc. so clients can only **request** actions and functions perform them after verifying a hashed manager PIN. That step requires client wiring (callable functions) + a joint test, and is best done after Phase 1 has run cleanly for a while.
- Ownership stamping (customer UID on orders) for a fully server-verified "received" is also Phase 2.

## Note
Watch the **Functions logs** for the first day of real orders to confirm `onOrderFinalize` runs cleanly and COGS looks right. If anything looks off, the client deduction is still your safety net.
