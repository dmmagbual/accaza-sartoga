# Accaza — App Check Enforcement Runbook (H-1 Step 2)

**Owner:** Danilo Magbual · **Purpose:** safely turn App Check from *monitor* to *enforce* — the highest-value remaining security step. It stops scripted/bot traffic from calling the order and admin Cloud Functions and the Realtime Database.
**Golden rule:** do NOT flip enforcement until the Firebase console shows real customer **and** admin/POS traffic sending *verified* App Check tokens. Enforcing before that **rejects legitimate orders and POS sales**.

---

## 0. Where we are now
- App Check is **initialized** on both surfaces: customer site (always) and Admin/POS (since **build v411**, PR #328). Both send reCAPTCHA Enterprise tokens.
- Enforcement is **OFF**: `ENFORCE_APP_CHECK=false` and `ENFORCE_APP_CHECK_ORDERS=false`. Callables coerce the flag with `String(process.env.… || "false")`, so missing/invalid tokens are **logged but not rejected** (monitor mode). `ENFORCE_APP_CHECK_ORDERS` gates only the public order path (`createOnlineOrder`, `confirmOrderReceived`); `ENFORCE_APP_CHECK=true` implies it.
- The reCAPTCHA Enterprise site key is registered for the production domain (`6LdQ6Hst…`).
- Every online order already logs `appCheck: Boolean(request.app)` server-side, so token presence is observable.

## 1. Deploy mechanics — READ THIS FIRST (the gotcha)
`functions/.env.accaza-sartoga` is **git-ignored**, so it is NOT in the repo and NOT available to the GitHub Actions deploy. During a CI deploy `ENFORCE_APP_CHECK` is therefore **undefined → false**. Consequences:
- Editing only the local `.env` enforces on a **manual** `firebase deploy` from your PC, but the **next CI functions deploy silently reverts it to false**.
- To make enforcement **durable**, set the flag where **both** paths see it:
  1. **CI:** the deploy step `env:` in `.github/workflows/deploy-functions.yml` pins both flags to `"false"` (a committed, non-secret change). Flip them there.
  2. **Local:** set the same flag in `functions/.env.accaza-sartoga` for manual deploys.
- The flag is baked at **deploy time** (the CLI reads it while discovering functions), so a change only takes effect on the **next functions deploy**.

## 2. Phase 1 — Verify token flow (do this over a few days; do not skip)
Firebase Console → **App Check**:
1. Open the **APIs** view. For **Cloud Functions** and **Realtime Database**, App Check reports **Verified** vs **Unverified/Unknown** request counts while still in monitor mode.
2. Let real traffic accumulate across a few normal trading days — customers ordering online **and** cashiers using the POS on their actual devices.
3. **Do not wait for ~100%.** On a public site the Verified share can never reach 100%: JS-running bots (which reCAPTCHA Enterprise refuses), privacy browsers and blockers, and any client whose token exchange fails all count as Unverified forever. The gate is instead **no legitimate traffic in the Unverified bucket**, proven by all three of:
   - Cloud Functions logs for `createOnlineOrder` show `appCheck: true` on **every** real order for 7 consecutive days (filter `resource.labels.function_name="createOnlineOrder"`, search `appCheck`).
   - Realtime Database row compared over 24h vs 30d: bursty spikes = bot sweeps (expected, ignore); a steady drip = a blocked or broken real client — investigate before proceeding (old cached build, unsupported browser, key/domain mismatch).
   - A cold-cache test order (Ctrl+Shift+R) and one POS sale from a real device both succeed.
4. Cross-check: in Cloud Functions logs, recent `createOnlineOrder` entries should show `appCheck: true`.

## 3. Phase 2 — Flip in two stages (at a quiet hour, POS idle)
**Stage A — order path only (smallest blast radius):**
1. Set `ENFORCE_APP_CHECK_ORDERS: "true"` in the workflow `env:` **and** the local `.env` (Section 1). Leave `ENFORCE_APP_CHECK` false and leave Realtime Database unenforced.
2. **Deploy Functions** so the flag bakes in — merge the workflow change (CI deploy) or run `firebase deploy --only "functions" --project "accaza-sartoga"` locally. Enforcement touches only `createOnlineOrder`/`confirmOrderReceived`, effective the moment the deploy completes.
3. Watch for 24h: place **one real online order** (must succeed) and check the logs for App Check `permission-denied`/`unauthenticated` on the order callables. Zero legitimate rejections = pass.

**Stage B — everything else:**
4. **Enable Realtime Database enforcement** in the console: App Check → **Realtime Database → Enforce**. (This is a separate switch from the callable flags.)
5. Set `ENFORCE_APP_CHECK: "true"` in both places (Section 1) and redeploy Functions. Pick a genuine lull; enforcement takes effect the moment the deploy completes.
6. Ring **one POS sale** (cash + one non-cash) → must succeed, then continue with Phase 3.

## 4. Phase 3 — Verify immediately after
- Place **one real online order** end-to-end → it must succeed.
- Ring **one POS sale** (cash + one non-cash) → must succeed.
- Watch Cloud Functions logs and App Check metrics for a spike in `permission-denied` / `unverified` for ~15–30 min. Zero legitimate rejections = success.

## 5. Rollback (fast, no data impact)
Enforcement is display/gatekeeping only — no data migration, so rollback is just turning it back off:
1. Set `ENFORCE_APP_CHECK` back to **false** in the workflow `env:` and the local `.env`.
2. Redeploy Functions (CI or manual).
3. In the console, set App Check → **Realtime Database → Unenforced**.
4. Confirm a test order + POS sale succeed again. Then diagnose which device/browser lacked a token before retrying.

## 6. Notes / limits
- **Single flag today:** every callable reads the same `ENFORCE_APP_CHECK`, so enforcement is all-or-nothing. True per-callable staging (e.g. order callables first, admin later) would need a small code change to add a second flag — optional; the monitor-then-flip-all approach with fast rollback is fine for this shop.
- The code already guards a known footgun (a `defineBoolean` param object is truthy and would accidentally enforce even when false) by coercing with `String(process.env.ENFORCE_APP_CHECK || "false")` — keep that pattern.
- Enforcement complements, does not replace, the existing order defenses (anonymous-auth + rate limit + SHA-256 signature + quantity/total caps).

## 7. Definition of done
Verified ~100% for a few days → RTDB enforce ON + `ENFORCE_APP_CHECK=true` in CI **and** local → Functions redeployed → test order + POS sale pass → no legitimate rejections in logs. Record the date and the App Check metrics screenshot in the operations log.
