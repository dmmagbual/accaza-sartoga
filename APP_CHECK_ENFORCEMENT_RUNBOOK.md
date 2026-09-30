# Accaza — App Check Enforcement Runbook (H-1 Step 2)

**Owner:** Danilo Magbual · **Purpose:** safely turn App Check from *monitor* to *enforce* on the staff surface. It stops scripted traffic from calling the admin, POS and Finance Books Cloud Functions.
**Golden rule:** enforce only after the server logs prove real staff traffic is sending *verified* tokens. Enforcing before that **blocks POS sales and admin work**. Do not use the Firebase console's "Verified %" as the gate — on a public site it can never reach 100% (see Section 2).

---

## 0. Where we are now
- App Check is **initialized** on both surfaces: the customer site (always) and Admin/POS (since **build v411**, PR #328). Both send reCAPTCHA Enterprise tokens from the app `accaza-web-LIVE`.
- Enforcement is **OFF** on every callable: both committed defaults in `src/functions/00-app-check-flags.js` are `"false"`. Missing or invalid tokens are **logged but not rejected** (monitor mode).
- The two flags are **independent**. `ENFORCE_APP_CHECK` gates the 96 staff callables; `ENFORCE_APP_CHECK_ORDERS` gates only the 2 public order callables (`createOnlineOrder`, `confirmOrderReceived`). Turning the staff flag on no longer turns the order flag on.
- Every online order logs `appCheck: Boolean(request.app)` server-side, so token presence is observable without the console.
- Deploy runs #411 and #412 both failed on a transient Cloud Functions API error with 176 of 177 functions already updated; #412 attempt 2 succeeded at 2026-09-30T15:13:42Z. Both deploy steps now retry once after 60 seconds, so a single straggler no longer fails a run. The 7-day log gate therefore runs **2026-09-30 → review 2026-10-08**.

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
3. A cold-cache test order (Ctrl+Shift+R) and one POS sale from a real device both succeed.

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
3. Then diagnose which device or browser lacked a token before retrying. Check the client `initializeAppCheck` path first — it is a try/catch that only `console.warn`s, with no retry and no telemetry, so a silent failure there looks identical to a bot in the metrics.

If a deploy is needed in a hurry and CI is unavailable: `firebase deploy --only "functions" --project "accaza-sartoga"`. Never use `firebase deploy --only hosting` for this repository — there is no Hosting target.

## 6. What is never enforced, and why
Five callables hardcode `enforceAppCheck: false`, so neither flag reaches them. All five are still gated by portal identity and role — they are exempt from *device attestation*, not from authorization:

| Callable | Authorization it does have |
| --- | --- |
| `recordClientTelemetry` | `requirePortalUser` |
| `getPaymentProof` | `requirePortalUser`, then an order lookup by id |
| `ensureActiveOrders` | `requirePortalUser`, plus an owner/superadmin/admin/manager gate on `force` |
| `postInventoryMovements` | `requirePortalUser`, per-movement-type `adminPerms` check, and server-only movement types rejected outright |
| `ensureInventoryLedger` | `requirePortalPermission(["inventory"])`, plus an initialization-marker and `force` role gate |

**This is a gap to decide on later, not a reason to relax.** Flipping `ENFORCE_APP_CHECK` covers 96 of the 103 callables; these five stay in monitor mode regardless. `recordClientTelemetry` should probably stay exempt permanently — it is the diagnostic that tells you a staff client has no token, and enforcing it would blind the very signal Phase 1 depends on. The other four are ordinary staff operations and could follow the staff flag once Phase 2 has been stable for a few weeks. That is a separate PR; this runbook does not authorize it.

Keep the `String(process.env.X || "false")` coercion. A `defineBoolean` parameter object is truthy at runtime and would enforce App Check even when the flag reads false — `tests/static/30-server-release.mjs` fails the build if that pattern returns.

Enforcement complements, and does not replace, the existing order defenses.

## 7. Definition of done
7 consecutive days of `appCheck: true` on every real `createOnlineOrder` log line, RTDB unverified traffic confirmed bursty rather than a steady drip, and a cold-cache test order plus a real-device POS sale both passing → set the `ENFORCE_APP_CHECK` committed default to `"true"` → PR merged and Functions redeployed → POS sale, admin sign-in and Finance Books all pass → no legitimate rejections in the logs for 24h. Realtime Database stays unenforced and the order path stays in monitor. Record the date and the App Check metrics screenshot in the operations log.
