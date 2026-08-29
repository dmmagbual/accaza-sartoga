# Accaza — FREE Automatic Web Push on Order Completion

When staff set an order's status to **Completed**, the customer's installed app
gets a push notification automatically (pick-up or delivery message).
**No per-message cost** — this uses Firebase Cloud Messaging (FCM).

Reach: works for customers who **installed the app** (added to home screen) and
tapped **Allow** for notifications. (iPhone needs iOS 16.4+ and the app installed.)
For everyone else, the manual one-tap WhatsApp button on each order still works.

---

## One-time setup

### 1. Get your Web Push certificate key (VAPID)
Firebase Console -> Project settings (gear) -> **Cloud Messaging** tab ->
**Web configuration** -> **Web Push certificates** -> Generate key pair -> copy it.

### 2. Paste it into index.html
Find this line near the top of the main script:
```
const VAPID_KEY="PASTE_YOUR_WEB_PUSH_CERTIFICATE_KEY_HERE";
```
Replace the placeholder with your copied key. (This key is safe to be public.)

### 3. Upgrade Firebase to the Blaze plan
Cloud Functions require pay-as-you-go billing (a card on file).
FCM push has **no per-message charge**, and the function's usage sits inside the
free tier, so your real cost is effectively **₱0**.
Console -> Usage and billing -> Modify plan -> **Blaze**.

### 4. Install tools (on your computer)
```
npm install -g firebase-tools
firebase login
```

### 5. Install function dependencies
```
cd functions
npm install
cd ..
```

### 6. Deploy
```
firebase deploy --only functions
```
(No secret/API key needed — the function uses your project's own credentials.)

### 7. Deploy the website too
Push the updated **index.html** and **sw.js** (cache bumped to v4) to your host.

---

## How it flows
1. Customer installs the app, signs in, and taps **Allow** when asked about notifications.
   Their device push token is saved under `appCustomers/{phone}/pushToken`.
2. Staff mark the order **Completed**.
3. The `notifyOnComplete` function fires, looks up that customer's token, and sends
   the push. It sets `pushNotified: true` so nobody is notified twice.

## Test
1. On a phone, install the app, sign in, allow notifications.
2. Place an order from that phone.
3. In admin, set the order to **Completed**.
4. The phone should get "Accaza Coffee House — your order is ready…" within seconds.
5. Logs: Firebase Console -> Functions -> Logs.

## Notes
- Wording (pick-up vs delivery) lives in `functions/index.js`.
- Dead/expired tokens are auto-removed so the function won't keep retrying.
- The earlier paid-SMS version was replaced by this free push version.
