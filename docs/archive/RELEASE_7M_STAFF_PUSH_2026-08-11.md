# Release 7M — Staff web-push alerts (new orders & reservations)

**Date:** 2026-08-11
**Depends on:** Release 7I FCM infrastructure (service worker + VAPID) already live.

## What it does

Alerts staff/admin devices with a push notification (sound + banner) when a new
**online order** or **reservation** arrives — even when the admin app is closed
or backgrounded. In-app chimes (orders + reservations) already cover the case
where the portal is open; this adds the closed-app path.

## How it works

- **Token registration** (`assets/js/admin/staff-push.mjs`, loaded by `admin.html`):
  when a NON-anonymous user (staff/admin log in with email+password; customers
  are anonymous) is signed into the portal and grants notification permission,
  the device's FCM token is stored at `/staffPushTokens/{uid}`. Reuses the shared
  service worker from 7I; no new SW/cache bump.
- **Security rule** (`database.rules.json` → `staffPushTokens/$uid`): a staff
  member may read/write only their own token, and only if their uid is in
  `/admins`. The server (admin SDK) reads all tokens to fan out.
- **Server triggers** (`functions/index.js`):
  - `notifyStaffOnOrder` — `onValueCreated /orders/{orderId}`, fires only when
    `source === "online"` (POS/GrabFood/FoodPanda are entered by staff already).
  - `notifyStaffOnReservation` — `onValueCreated /reservations/{resId}`.
  - Both call `notifyStaff()`, which sends an FCM data message to every token and
    prunes dead tokens (`registration-token-not-registered` / `invalid-argument`).
- No foreground double-alert: FCM background notifications only show when the app
  is backgrounded; the open-app case is handled by the existing in-page chimes.

## Files changed

- `functions/index.js` — `onValueCreated` import, `notifyStaff()` helper, two triggers.
  SHA-256 `5D1597FDC30AE44C40980F0990EC035F8B202F3436655D5053DFCC5E42FEFD68`.
- `database.rules.json` — `staffPushTokens/$uid` read/write/validate.
- `assets/js/admin/staff-push.mjs` — NEW staff token registration.
- `admin.html` — load `staff-push.mjs`.
- `release-manifest.json` — add `notifyStaffOnOrder`, `notifyStaffOnReservation`, and the new file.

## Deploy (one push)

`functions/**` and `database.rules.json` trigger the **Deploy Firebase Functions
& Rules** workflow (test-gated); `admin.html` + `staff-push.mjs` publish via Pages.

## Test

1. On a staff device, log into the portal → grant the notification prompt →
   toast "Staff alerts on for this device". Confirm a token appears under
   `/staffPushTokens/{uid}` in Realtime Database.
2. Close/background the admin app. From another device, place an **online order**
   → the staff device should receive a push. Repeat by booking a **reservation**.
3. Check Cloud Functions logs for `notifyStaffOnOrder` / `notifyStaffOnReservation`
   if nothing arrives.

## Validation performed

`npm test`, release-readiness, repository-safety — all PASS. `staff-push.mjs` and
`functions/index.js` syntax valid. `test:rules` needs the emulator (runs in CI).
