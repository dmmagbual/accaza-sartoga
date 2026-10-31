# Accaza — App Check Enforcement Runbook (H-1 Step 2)

**Owner:** Danilo Magbual · **Purpose:** safely turn App Check from *monitor* to *enforce* on the staff surface. It stops scripted traffic from calling the admin, POS and Finance Books Cloud Functions.
**Golden rule:** enforce only after the server logs prove real staff traffic is sending *verified* tokens. Enforcing before that **blocks POS sales and admin work**. Do not use the Firebase console's "Verified %" as the gate — on a public site it can never reach 100% (see Section 2).

---

## 0. Where we are now
- App Check is initialized through one shared helper on every active browser Firebase app. Admin/POS, Finance Books, manager-approval sign-in, the main customer app, Rewards, and the standalone order-availability reader all register reCAPTCHA Enterprise before using Authentication, Realtime Database, or Cloud Functions. This coverage repair is Admin **v641**, Customer **v92**, Books **v141**, cache **v629**; it is not production-active until merged and published.
- **Staff enforcement is ON from 28 Oct 2026** (Phase 2): `ENFORCE_APP_CHECK` defaults to `"true"` in `src/functions/00-app-check-flags.js`, so every staff callable except telemetry refuses calls without a valid token. `ENFORCE_APP_CHECK_ORDERS` stays `"false"`: the public order callables remain in monitor mode. Live from the moment the merge deploy completes. From 31 Oct the order flag covers three customer callables (`createOnlineOrder`, `confirmOrderReceived`, `createQrOrderTicket`), and only `recordClientTelemetry` hardcodes `enforceAppCheck: false` (Section 6).
- The two flags are **independent**. `ENFORCE_APP_CHECK` gates the 96 staff callables; `ENFORCE_APP_CHECK_ORDERS` gates only the 2 public order callables (`createOnlineOrder`, `confirmOrderReceived`). Turning the staff flag on no longer turns the order flag on.
- Every online order logs `appCheck: Boolean(request.app)` server-side, so token presence is observable without the console.
- Deploy runs #411 and #412 both failed on a transient Cloud Functions API error with 176 of 177 functions already updated; #412 attempt 2 succeeded at 2026-09-30T15:13:42Z. Both deploy steps now retry once after 60 seconds, so a single straggler no longer fails a run. The earlier **2026-09-30 → 2026-10-08** gate was invalidated when the coverage audit found legitimate unverified Finance Books, manager-approval, and standalone order-availability clients. Start a fresh 7-day gate after v641/v92/v141/v629 is published.

## 1. The lever — READ THIS FIRST
**The only control that reaches production is the committed default in `src/functions/00-app-check-flags.js`:**

```js
const ENFORCE_APP_CHECK = String(process.env.ENFORCE_APP_CHECK || "false").toLowerCase() === "true";
const ENFORCE_APP_CHECK_ORDERS = String(process.env.ENFORCE_APP_CHECK_ORDERS || "false").toLowerCase() === "true";
```

Two places that look like controls and are **not**:
- `functions/.env.accaza-sartoga` — git-ignored (`.gitignore` lines 6–8 allow only `.env.example`), so it does not exist on the GitHub Actions runner and the CLI loads nothing.
- A workflow step's `env:` — that is shell environment for the `firebase` CLI process. The CLI never forwards it into a deployed function's runtime configuration. The values PR #660 added there were inert, which is why they were removed.

**To change enforcement:** edit the default literal (`"false"` → `"true"`) in that file, commit, open a PR, merge. CI redeploys Functions and the value bakes into the function config at deploy time. A manual `firebase deploy --only "functions" --project "accaza-sartoga"` from your PC bakes in the same committed value, so **a local deploy can no longer silently revert what CI set** — that footgun is gone.

The optional `process.env` override still works for a one-off experiment on your own machine, but any later deploy restores the committed default. Do not rely on it.

## 2. Phase 1 — Verify token flow (do this over a few days; do not skip)
**Do not wait for ~100% Verified.** The console showed 89% Auth / 78% Realtime Database on 2026-09-30 and that share can never reach 100% on a public site: JS-running bots that reCAPTCHA Enterprise refuses, privacy browsers and trackers-blockers, and any client whose token exchange fails all sit in the Unverified bucket permanently. Chasing 100% blocks the work forever.

The gate is instead **no legitimate traffic in the Unverified bucket**, proven by all three of:
1. Cloud Functions logs for `createOnlineOrder` show `appCheck: true` on **every** real order for 7 consecutive days (filter `resource.labels.function_name="createOnlineOrder"`, search `appCheck`).
2. Realtime Database row compared over 24h vs 30d: bursty spikes = bot sweeps (expected, ignore); a **steady drip** = a blocked or broken real client — investigate before proceeding (old cached build, unsupported browser, key/domain mismatch).
3. A cold-cache test order (Ctrl+Shift+R), one POS sale, one Finance Books sign-in, and one independent manager approval from real devices all succeed.

For the staff surface specifically, also confirm from a real cashier device: sign in to Admin/POS, ring one sale, and open Finance Books. Then check that no `permission-denied` or `unauthenticated` entries appeared for those callables.

Still owner-owned and worth one check in the GCP console: that site key `6LdQ6Hst…` allows `accazacoffee.com`, the reCAPTCHA Enterprise API is enabled, and billing is active.

## 3. Phase 2 — Enforce the staff surface (at a quiet hour, POS idle)
1. In `src/functions/00-app-check-flags.js`, set the `ENFORCE_APP_CHECK` default to `"true"`. **Leave `ENFORCE_APP_CHECK_ORDERS` at `"false"`.**
2. Commit on a branch, open a PR, merge. The CI deploy bakes it in; enforcement is live the moment the deploy completes.
3. Watch for 24h: sign in to Admin/POS from a real device, ring **one POS sale** (cash and one non-cash), open Finance Books, and check the logs for App Check `permission-denied` / `unauthenticated` on staff callables. Zero legitimate rejections = pass.

**Do not enforce the public order path.** Online ordering has produced roughly two orders since opening because courier booking is too much hassle for customers — it is a product problem, not a security one. Enforcing there risks refusing a genuine order to protect a channel that barely carries traffic, and the order path is already defended by server repricing (`priceOrderLinesServer`), the `expectedTotal` drift check, a 5-per-60s per-uid rate limit, SHA-256 signature idempotency, and quantity/line/total caps. Revisit `ENFORCE_APP_CHECK_ORDERS` only if online volume becomes material.

**Never enforce Realtime Database.** The public RTDB nodes are the public menu. Enforcing would stop privacy-browser and blocker visitors from loading the site at all, in exchange for preventing menu scraping — which is not a threat. Writes are already protected by database rules or performed through the Admin SDK. Remove any older instruction to enable RTDB enforcement; it was dropped deliberately.

## 4. Phase 3 — Verify immediately after
- Ring **one POS sale** (cash + one non-cash) → must succeed.
- Sign in to Admin and open Finance Books → must load.
- Place **one real online order** end-to-end → must still succeed (its flag never changed).
- Watch Cloud Functions logs and App Check metrics for a spike in `permission-denied` / `unverified` for ~15–30 min. Zero legitimate rejections = success.

## 5. Rollback (fast, no data impact)
Enforcement is gatekeeping only — no data migration, so rollback is just turning it back off:
1. Set the `ENFORCE_APP_CHECK` default back to `"false"` in `src/functions/00-app-check-flags.js`, commit, merge. The CI deploy is the rollback; it takes effect the moment it completes.
2. Confirm a POS sale and an admin sign-in succeed again.
   Then disable the Cloud Monitoring policy "Accaza CRITICAL - Staff device refused by App Check". In monitor mode a missing token is not refused, so leaving it on would text you for calls that went through.
3. Then diagnose which device or browser lacked a token before retrying. Check `window.__accazaAppCheckStatus`: the shared helper records initialization and token-exchange status per client surface while leaving the existing server-side `request.app` logging authoritative.

If a deploy is needed in a hurry and CI is unavailable: `firebase deploy --only "functions" --project "accaza-sartoga"`. Never use `firebase deploy --only hosting` for this repository — there is no Hosting target.

## 6. What is never enforced, and why
Since 31 Oct 2026 only `recordClientTelemetry` hardcodes `enforceAppCheck: false`. It keeps `requirePortalUser`, and it stays exempt permanently: it is the diagnostic that reports a staff client without a token, so enforcing it would blind the signal this runbook depends on. `tests/monitoring-alerts-check.mjs` fails if any other callable hardcodes `false`.

The seven callables that used to be exempt now follow `ENFORCE_APP_CHECK`: `getPaymentProof`, `ensureActiveOrders`, `postInventoryMovements`, `ensureInventoryLedger`, `checkBakingMapping`, `postBatchCard` and `reverseBatchCard`. Their exemption was historical, not deliberate (August code written before App Check, then copied by the baking callables on 14 Oct). Since 1 Oct, 1,413 of their 1,418 signed-in calls carried a valid token; the 5 without one were `ensureActiveOrders` calls from 1 to 9 Oct, before the shared initialization fix reached every till.

Keep the `String(process.env.X || "false")` coercion. A `defineBoolean` parameter object is truthy at runtime and would enforce App Check even when the flag reads false — `tests/static/30-server-release.mjs` fails the build if that pattern returns.

Enforcement complements, and does not replace, the existing order defenses.

## 7. Definition of done
After v641/v92/v141/v629 is published: 7 consecutive days of `appCheck: true` on every real `createOnlineOrder` log line, RTDB unverified traffic confirmed bursty rather than a steady drip, and a cold-cache test order, POS sale, Finance Books sign-in, and independent manager approval all passing → set the `ENFORCE_APP_CHECK` committed default to `"true"` → PR merged and Functions redeployed → POS sale, admin sign-in and Finance Books all pass → no legitimate rejections in the logs for 24h. Realtime Database stays unenforced and the order path stays in monitor. Record the date and the App Check metrics screenshot in the operations log.

## 8. Operations log

| Date | Change | Evidence |
| --- | --- | --- |
| 28 Oct 2026 | `ENFORCE_APP_CHECK` default set to `"true"` (staff surface). Orders and RTDB unchanged. New owner alert "Accaza CRITICAL - Staff device refused by App Check" (ops/monitoring/alert-policies.json). | Cloud Logging 18 to 28 Oct: 12,293 of 12,295 `Callable request verification passed` entries had `app: VALID`; 2 `MISSING` were `manageSupplier` development calls on 20 Oct. 7,807 `Staff App Check status` lines across all 5 staff accounts, 3 without a token (the same 2 plus 1 `recordClientTelemetry`, which is exempt). |
| 31 Oct 2026 | The seven former exemptions follow `ENFORCE_APP_CHECK`; only telemetry stays exempt. The alert stops excluding them. | Cloud Logging 1 to 31 Oct: 1,413 of 1,418 signed-in calls to those seven had `app: VALID`; the 5 `MISSING` were `ensureActiveOrders`, latest 9 Oct. Since staff enforcement went live on 28 Oct, 4,591 of 4,594 staff calls were valid, and the 3 exceptions had a valid App Check token but no staff login, so no call was refused by App Check. |
