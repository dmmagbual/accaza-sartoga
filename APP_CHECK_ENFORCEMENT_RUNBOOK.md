# Accaza — App Check Enforcement Runbook (H-1 Step 2)

**Owner:** Danilo Magbual · **Purpose:** safely turn App Check from *monitor* to *enforce* — the highest-value remaining security step. It stops scripted/bot traffic from calling the order and admin Cloud Functions and the Realtime Database.
**Golden rule:** do NOT flip enforcement until the Firebase console shows real customer **and** admin/POS traffic sending *verified* App Check tokens. Enforcing before that **rejects legitimate orders and POS sales**.

---

## 0. Where we are now
- App Check is **initialized** on both surfaces: customer site (always) and Admin/POS (since **build v411**, PR #328). Both send reCAPTCHA Enterprise tokens.
- Enforcement is **OFF**: `ENFORCE_APP_CHECK=false`. Callables run `enforceAppCheck: process.env.ENFORCE_APP_CHECK === "true"`, so missing/invalid tokens are **logged but not rejected** (monitor mode).
- The reCAPTCHA Enterprise site key is registered for the production domain (`6LdQ6Hst…`).
- Every online order already logs `appCheck: Boolean(request.app)` server-side, so token presence is observable.

## 1. Deploy mechanics — READ THIS FIRST (the gotcha)
`functions/.env.accaza-sartoga` is **git-ignored**, so it is NOT in the repo and NOT available to the GitHub Actions deploy. During a CI deploy `ENFORCE_APP_CHECK` is therefore **undefined → false**. Consequences:
- Editing only the local `.env` enforces on a **manual** `firebase deploy` from your PC, but the **next CI functions deploy silently reverts it to false**.
- To make enforcement **durable**, set the flag where **both** paths see it:
  1. **CI:** add `ENFORCE_APP_CHECK: "true"` to the deploy step `env:` in `.github/workflows/deploy-functions.yml` (a committed, non-secret change).
  2. **Local:** set `ENFORCE_APP_CHECK=true` in `functions/.env.accaza-sartoga` for manual deploys.
- The flag is baked at **deploy time** (the CLI reads it while discovering functions), so a change only takes effect on the **next functions deploy**.

## 2. Phase 1 — Verify token flow (do this over a few days; do not skip)
Firebase Console → **App Check**:
1. Open the **APIs** view. For **Cloud Functions** and **Realtime Database**, App Check reports **Verified** vs **Unverified/Unknown** request counts while still in monitor mode.
2. Let real traffic accumulate across a few normal trading days — customers ordering online **and** cashiers using the POS on their actual devices.
3. **Proceed only when Verified is ~100%** for both APIs and Unverified is effectively just noise. A meaningful Unverified share means some real device/browser is not sending tokens — enforcing now would reject it. Investigate first (old cached build, unsupported browser, key/domain mismatch).
4. Cross-check: in Cloud Functions logs, recent `createOnlineOrder` entries should show `appCheck: true`.

## 3. Phase 2 — Flip to enforce (at a quiet hour, POS idle)
1. **Enable Realtime Database enforcement** in the console: App Check → **Realtime Database → Enforce**. (This is a separate switch from the callable flag.)
2. **Set the callable flag true in both places** (Section 1): the workflow `env:` and the local `.env`.
3. **Deploy Functions** so the new flag bakes in — merge the workflow change (CI deploy) or run `firebase deploy --only "functions" --project "accaza-sartoga"` locally. Pick a genuine lull; enforcement takes effect the moment the deploy completes.

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
