# Accaza POS — Server-Side Security Project (Blaze)
_Blueprint for making manager controls actually enforceable. This is a separate build (Cloud Functions + Firebase CLI), not a one-file upload. Read, then green-light and we build + test it together._

## The problem it fixes (from the review)
- **C2:** every staff account is an `/admins` member, and the rules grant any member near-total write access. So `adminPerms`, manager-PIN gates, and "log-only" are UI deterrence, not enforcement.
- **C3:** PINs are plaintext, readable by any staff → the manager PIN isn't secret from insiders.
- **H1:** deduction + COGS run in the browser; only fire when a tab is open; can race across devices.

The only real fix is to move the **sensitive, money-moving actions to the server**, where staff can't read secrets or write directly.

## Architecture
1. **Lock the sensitive nodes in rules** so clients (even `/admins`) can't write them directly:
   `orders/*/status` transitions to `Completed`, `inventory/*/stock`, `discrepancies`, `pettyCashVouchers.status`, `internalUsage`, refunds/voids.
   Clients may only **request** an action by writing to a request queue (e.g. `actionRequests/{id}`), never touch the protected data.
2. **Callable/queue-triggered Cloud Functions** own the protected writes:
   - `completeOrder` — verifies the caller is an admin, runs `computeUsage`, deducts stock, writes `cogsSnapshot`, sets status `Completed`. Idempotent by order id. (Replaces client `tryDeduct`.)
   - `voidOrRefund`, `approveVoucher`, `verifyPayment`, `recordInternalUsage`, `stockAdjust` — each verifies a **manager PIN server-side** (PIN hash stored where clients can't read it) and performs the write.
3. **Manager PINs** move to a server-only node (`managerAuth`, `.read:false / .write:false` for clients; functions use the Admin SDK which bypasses rules). Store a hash, not plaintext.
4. Deduction becomes **authoritative + concurrency-safe** (transactions server-side), fixing H1.

## What changes in the client (admin.html)
Small: the POS calls a function instead of writing directly. e.g. instead of `update(orders/oid,{status:'Completed'})` + client `tryDeduct`, it calls `completeOrder({oid})`. Manager-PIN prompts send the PIN to the function instead of checking locally. Most UI stays.

## Reference: the key function (server-authoritative completion)
```js
// functions/index.js  (Node 18, firebase-functions v2)
const {onCall, HttpsError} = require('firebase-functions/v2/https');
const admin = require('firebase-admin'); admin.initializeApp();
const db = admin.database();

exports.completeOrder = onCall(async (req) => {
  const uid = req.auth && req.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated','Sign in');
  const isAdmin = (await db.ref('admins/'+uid).get()).exists();
  if (!isAdmin) throw new HttpsError('permission-denied','Admins only');
  const oid = req.data.oid;
  const oref = db.ref('orders/'+oid);
  const snap = await oref.get();
  const o = snap.val();
  if (!o) throw new HttpsError('not-found','Order missing');
  if (o.inventoryDeducted) return {ok:true, already:true};   // idempotent
  // load recipes/optionRecipes/inventory, compute usage (same logic as client computeUsage)
  const usage = await computeUsageServer(o.lineItems);       // port of computeUsage
  let cogs = 0;
  const invSnap = await db.ref('inventory').get(); const inv = invSnap.val()||{};
  Object.keys(usage).forEach(ing => { const c=Number(inv[ing]&&inv[ing].cost)||0; cogs += usage[ing]*c; });
  // deduct atomically
  const updates = {}; updates['orders/'+oid+'/status']='Completed';
  updates['orders/'+oid+'/inventoryDeducted']=true;
  updates['orders/'+oid+'/inventoryUsage']=usage;
  updates['orders/'+oid+'/cogsSnapshot']=cogs;
  updates['orders/'+oid+'/inventoryDeductedAt']=admin.database.ServerValue.TIMESTAMP;
  Object.keys(usage).forEach(ing => { /* transaction per ing */ });
  await db.ref().update(updates);
  await Promise.all(Object.keys(usage).map(ing =>
    db.ref('inventory/'+ing+'/stock').transaction(cur => (Number(cur)||0) - usage[ing])));
  return {ok:true, cogs};
});
```
(`computeUsageServer` is a direct port of the client `computeUsage` — base-per-size + options + category consumables.)

## Rules change (concept)
```
"orders": { "$oid": {
  ".write": "auth!=null && (!data.exists()  /* customer create, as today */
     || ( admin && newData.child('status').val()!=='Completed' )  /* admins edit non-final fields */ )"
  // NOTE: no client may set status=Completed / inventoryDeducted / cogsSnapshot — only the function can.
}}
"managerAuth": { ".read": false, ".write": false }   // functions only (Admin SDK)
```

## Deploy steps (one-time)
1. Install Node 18+ and the Firebase CLI: `npm i -g firebase-tools`, then `firebase login`.
2. In the project folder: `firebase init functions` (JavaScript, install deps).
3. Drop in the functions, `firebase deploy --only functions`.
4. Publish the tightened `database.rules.json`.
5. Seed `managerAuth` with hashed PINs (one-time script).
6. Point the admin.html actions at the callables (I provide these edits).

## Effort & honesty
- ~1 focused build for the core (`completeOrder` + rules + client wiring), then incremental for void/refund/voucher/usage/adjust.
- **Must be tested in a dev/test Firebase project first** — this changes who can write what; a mistake could block legitimate sales. We do a joint test pass before it touches production.
- Until this ships, the current controls remain **deterrence + audit trail** — fine for a small, trusted family team; do this when you add non-family staff or want true enforcement.

## Recommendation
Do this **after** the six features are live, recipe costs are entered, and you've run real transactions for a couple of weeks. Premature hardening of an unpopulated system is wasted effort. When ready, green-light and we build `completeOrder` first, test it in a dev project, then roll forward.
