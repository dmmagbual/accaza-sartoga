# Release 7I — Web-Push (FCM) Review & Fixes

**Date:** 2026-08-10
**Author:** Danilo (with Claude review)
**Origin:** Auto web-push feature was authored in an external ChatGPT session, then reviewed and corrected here.

## Context

An external session added a Firebase Cloud Messaging (FCM) web-push feature so a
customer receives a push notification when their order status changes to `Ready`.
During that session, a broken copy command also created a stray root folder
literally named `$repoPath` holding ~5,890 duplicate files. That folder was
emptied and removed from tracking (it was already in the Hosting `ignore` list,
so it never deployed). The project was then placed under git with a baseline
commit.

## What the feature does (verified correct)

- **Server-triggered, not client.** `functions/index.js` → `notifyOnComplete`,
  an `onValueUpdated` trigger on `/orders/{orderId}/status`. Fires only on the
  transition into `"Ready"` (`after === "Ready" && before !== "Ready"`).
  Server authority preserved.
- **Idempotent.** Guards with `if (o.pushNotified) return;` and sets
  `pushNotified: true` after a successful send. No double-notify.
- **Self-healing tokens.** On `messaging/registration-token-not-registered` or
  `messaging/invalid-argument`, the stale token is deleted so it isn't retried.
- **Correct payload shape.** Sends a `data:`-only message; the service worker
  (`sw.js` `onBackgroundMessage`) builds the notification itself. This avoids the
  duplicate-notification bug that a `notification:` payload would cause.
- **Cache versioning.** `sw.js` cache bumped `accaza-v77 → accaza-v78`, matched
  in `release-manifest.json` (`serviceWorkerCache: 78`), so clients pull the new
  service worker.

## Bugs found and fixed

### 1. `admin/core.mjs` — `app` was never imported (push silently dead on the app path)
`registerPushToken()` called `getMessaging(app)`, but `app` was not in the file's
import list from `firebase-client.mjs`. The reference threw and was swallowed by
the surrounding `try/catch`, so push registration never ran for customers using
the admin/app shell bundle.
**Fix:** added `app` to the `firebase-client.mjs` import.

### 2. `admin/core.mjs` — token stored under the wrong key (blocked by rules)
The token was written to `appCustomers/{phoneDigits}/pushToken`, but
`database.rules.json` only permits a write where `auth.uid === $uid`
(`appCustomers/{auth.uid}/pushToken`). The phone-keyed write was therefore
rejected, and the server lookup (`o.ownerUid || phone`, with orders created as
`ownerUid: uid`) would not have found it anyway.
**Fix:** key the token by `auth.currentUser.uid`, matching
`assets/js/customer/core.mjs` and the server's lookup.

### 3. `release-manifest.json` — new function not listed
`notifyOnComplete` was missing from `requiredFunctionExports`, so deploy
verification would not confirm it shipped.
**Fix:** added `notifyOnComplete` to `requiredFunctionExports`.

## Still to verify before production deploy

- **`test:rules`** was NOT run here (needs the Firebase emulator, unavailable in
  this environment). Run locally — this change touches the `appCustomers/{uid}/pushToken`
  write path.
- **Status string.** Confirm the POS "mark ready" action actually writes
  `"Ready"` to `/orders/{orderId}/status`. `"Ready"` is a valid status in
  `functions/lib/order-status.js`, but confirm the button lands there.
  Note: the `functions/index.js` header comment says "Completed" while the code
  checks "Ready" — stale comment, code is authoritative.

## Local validation performed

- `node tests/static-check.mjs` — PASS
- `node tests/release-readiness-check.mjs` — PASS (production-evidence items still pending, as expected)
- `node tests/repository-safety-check.mjs` — PASS (169 tracked files, no forbidden artifacts)
- `node --check assets/js/admin/core.mjs` — PASS
- `release-manifest.json` parses as valid JSON

## Files changed in this pass

- `assets/js/admin/core.mjs` — import `app`; key push token by `auth.currentUser.uid`
- `release-manifest.json` — add `notifyOnComplete` to `requiredFunctionExports`
- `.gitignore` — ignore stray `$repoPath/` folder

## Deployment note

Full feature (authored externally + these fixes) touches, at minimum:
`sw.js`, `admin.html`, `index.html`, `assets/js/admin/core.mjs`,
`assets/js/customer/core.mjs`, `functions/index.js`, `manifest.json`,
`manifest-admin.json`, `release-manifest.json`. Confirm against
`release-manifest.json` `authoritativeFiles` before deploying.
