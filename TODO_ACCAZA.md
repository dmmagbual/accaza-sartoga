# Accaza — To-Do / Deferred Items

_Last updated: 2026-06-22_

## Maintenance (no rush, but do before late 2026)
- [ ] **Upgrade Cloud Functions runtime Node 20 → 22.** Node 20 is deprecated
      (decommissioned ~2026-10-30). In `functions/package.json` change
      `"engines": { "node": "22" }`, then redeploy: `firebase deploy --only functions`.
- [ ] **Update firebase-functions package.** In the `functions` folder run
      `npm install firebase-functions@latest`, test, then redeploy.
      (Note: may have breaking changes — check the deploy still succeeds.)

## Notifications
- [ ] **Louder / longer / custom alert sound is NOT possible on the PWA.**
      Web push uses the phone's default notification tone (can't be customized,
      looped, or made louder from code). Current build already adds strong
      vibration, a persistent banner (stays until tapped), and a "View order" button.
  - Short-term: on Android, set the app/Chrome notification category to **Urgent**
    and pick a louder sound in phone Settings → Apps → Notifications.
  - Long-term option: build a **real native app** (Play Store / App Store) if a
    loud, looping, rider-app-style alert is required. This is a separate, larger project.

## Housekeeping
- [ ] Confirm Firebase Realtime Database **rules** allow writes to `appCustomers`
      and `orderLocks` (needed for app-customer tracking, push tokens, and the
      duplicate-order guard).
- [ ] Old `functions/SETUP_AUTO_SMS.md` is obsolete (replaced by free Web Push).
      Current guide: `functions/SETUP_PUSH_NOTIFICATIONS.md`.

## Done this session (for reference)
- QR shown beside account number (app only); numbers stay on website.
- PWA login gate (name + phone) + per-order counter + admin "App Customers" tab + CSV export.
- Duplicate-order protection (in-memory + localStorage + server-side Firebase transaction).
- Manual one-tap WhatsApp/Viber/SMS "Notify" button (staff-triggered).
- FREE automatic Web Push on order completion (Cloud Function `notifyOnComplete`, deployed).
- "Enable notifications" button + non-nagging token refresh.
- Service worker cache at v5.
