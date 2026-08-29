# Deploy Checklist — Release 7I Web-Push (FCM)

**Feature:** Order-ready push notifications to the customer's installed app.
**Date prepared:** 2026-08-10
**Full detail:** `RELEASE_7I_PUSH_NOTIFICATION_REVIEW_2026-08-10.md`

Deploy the whole set as one coordinated release. Never push only the HTML —
the `assets/js/` modules are mandatory companions (handoff rule).

---

## Step 0 — Before you touch anything

- [ ] Run `npm run test:ci` at the project root. Must pass.
      (This session ran static + release + safety = PASS. `test:rules` needs the
      Firebase emulator and was NOT run here — run it now.)
- [ ] Take/verify a current Firebase backup (rules + Functions changed in this release).
- [ ] Confirm in the Firebase console whether `notifyOnComplete` is already
      deployed. The handoff lists it as live — if so, you can SKIP the Functions
      deploy and only publish the frontend.

## Step 1 — Push these files to GitHub (publishes the site + deploys Functions)

Frontend (updates accazacoffee.com):
- [ ] `sw.js`  — cache v78 — `EB50268403A27A2302EDFBE71C9F4005C76A3F0D044C8FB16FE239C65C9AB1F1`
- [ ] `admin.html` — `33C660152C1367C3F948AA73B55A1AC3D64C6322AEE1C2294A641E26BEEA3943`
- [ ] `index.html` — `D735560671F5D0E36CDA559D14310073EB6CF9032315A1C917321F7D5B8DD0B1`
- [ ] `assets/js/admin/core.mjs` — `A7040B48F8C213AC6387B57123CF11FF43396ECC5AEF25FA8AC8EBE39FCFB1A1`
- [ ] `assets/js/customer/core.mjs` — `C03E41A147A6ED02A98436556904482800E7B6F1692AB3AE3513AA81F8B8CF78`

Backend (auto-deploys the Cloud Function via the GitHub Actions quality gate):
- [ ] `functions/index.js` — `D2BB5D44B6C6DC6D8750033322AB5F78BBD755D6E2B2621B2812EB8CF6211F5B`
- [ ] `functions/lib/order-status.js` — `BC268896619A42942E9EA9D27BE283760D524B26A9F7EC4167615ABFC6BDC5E1`
      (Release 7J — fixes the "Order not found" status bug via get()+update(). See `RELEASE_7J_ORDER_STATUS_COLDCACHE_FIX_2026-08-10.md`.)

Repo record (not served, keep in sync so CI passes):
- [ ] `release-manifest.json` (adds `notifyOnComplete`, cache 78)

Not changed by this feature — do NOT include as edits:
`manifest.json`, `manifest-admin.json`, `functions/lib/*`, `database.rules.json`*

\* rules only if the `appCustomers/{uid}/pushToken` rule is not already live — see Step 2.

## Step 2 — Firebase deploys (only what changed)

- [ ] Functions (only if not already live):
      `firebase deploy --only functions:notifyOnComplete`
- [ ] Database rules — only if the pushToken rule isn't live yet:
      `firebase deploy --only database`
      (Without this rule, the token write is rejected and no notification fires.)

## Step 3 — Verify live

- [ ] Hard-refresh / accept the PWA update; confirm the service worker is `accaza-v78`
      (DevTools → Application → Service Workers).
- [ ] Confirm the POS "mark ready" action writes `"Ready"` to `/orders/{id}/status`.
      The trigger fires ONLY on `"Ready"`. If your button writes anything else,
      no push is sent.
- [ ] End-to-end test: place a test order → in the app, tap "Enable notifications"
      and grant permission → confirm a `pushToken` appears under
      `appCustomers/{uid}` in Realtime Database → mark the order Ready in POS →
      confirm the phone receives the notification.
- [ ] Check Cloud Functions logs for `notifyOnComplete` if nothing arrives.

## Step 4 — Record (per handoff)

- [ ] Git commit hash pushed to GitHub.
- [ ] Firebase deploy output.
- [ ] Tester, device, time.
- [ ] Rollback decision.

---

## Important cautions

- This local folder is now under Git but is **not connected to the GitHub
  remote**. Its history differs from `dmmagbual/accaza-sartoga`. Do **not**
  `git push --force` this repo over GitHub — it would wipe the remote history.
  Get the files onto GitHub via your normal method, or connect the real repo
  first (fetch, reconcile, then commit these changes onto it).
- Rollback is coordinated: if you revert, revert the whole set (HTML + modules +
  sw.js + Functions), never a single file.
