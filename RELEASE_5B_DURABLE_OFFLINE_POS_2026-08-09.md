# Release 5B — Durable Offline POS Transactions

**Admin:** v161  
**Service worker:** cache v50  
**Backend:** new `syncOfflinePosSale` callable and private `/offlinePosSync` audit node

## Delivered

- Replaced the active POS `localStorage` queue with IndexedDB.
- Added permanent transaction IDs before queueing.
- Added Pending, Syncing, Failed, and Synced states, error details, attempts, and manual retry.
- Added a clickable transaction-sync status panel in the POS header.
- Receipts clearly state when Firebase has not yet confirmed the sale.
- Added authenticated server synchronization and idempotent denomination-drawer application.
- Migrates any legacy queued sales into IndexedDB once.
- Keeps non-cash and platform sales blocked while offline.

## Deployment order

1. Export a Firebase Realtime Database backup.
2. Deploy backend first:

   `firebase deploy --only functions:syncOfflinePosSale,database`

3. Upload the complete frontend set to GitHub:

   - `admin.html`
   - `sw.js`
   - `assets/js/admin/core.mjs`
   - `assets/js/admin/firebase-client.mjs`
   - `assets/js/admin/module-loader.js`
   - `assets/js/admin/offline-queue.js`
   - `assets/js/admin/pos.js`

4. Hard-refresh the cashier device once and confirm build v161.

## Test procedure

Use a low-value test sale and an open test shift.

1. While online, complete one cash sale. The receipt may initially say Pending Sync; the header must return to **Online · Synced**, and the order must appear once in Firebase.
2. Turn off network access.
3. Complete one cash test sale. Confirm the receipt says **PENDING SYNC** and the header shows one pending transaction.
4. Refresh or close/reopen the browser while still offline. Confirm the pending transaction remains.
5. Open the sync queue and verify order number, value, and Pending state.
6. Restore network access. Confirm the transaction becomes Synced and appears exactly once in `/orders`.
7. Confirm the shift drawer denomination quantities increased exactly once.
8. Refresh repeatedly and press retry; confirm neither the order nor denomination delta duplicates.
9. While offline, attempt GCash and platform sales. Both must be blocked.

## Critical warning

Do not clear browser/site data while sales are pending. IndexedDB is device-local until Firebase confirms synchronization.

