# Accaza Website + POS — Full Review

**Date:** 2026-08-13 · **Reviewed at:** build v188 / SW cache v82
**Scope:** money & server authority, security/rules/auth, correctness & offline, UX/a11y & ops.
**Method:** static read of source (functions/, assets/js/, database.rules.json, *.html). No production data was touched. Line refs are to current source.
**Deliverable:** findings below. **Update (same day):** H1, M1, M2, L1 fixed and shipped in build v189 / cache v83; L2 verified safe (no fix needed). M3, M4, L3, L4 deferred with reasoning at the bottom.

## Resolution log (build v189 / cache v83)

- **H1 FIXED** — `posSettings` `.read` changed from `true` to `auth != null && root.child('admins').child(auth.uid).exists()`. Staff/cashier POS still reads it (they're authed portal users); the anonymous public no longer can. Only `admin-backup.html` (never deployed) referenced it publicly.
- **M1 FIXED** — `pos.js` Food Panda prefix `FF`→`FP`; `functions/index.js` online order id `OD-`→`OO-` (new orders only; existing `OD-` ids untouched).
- **M2 FIXED** — `pos.js` Food Panda `wht:0.0005`→`wht:0.005`. You confirmed 0.5% WHT / 3.6% VAT, Food Panda only; VAT `0.036` was already correct, GrabFood stays `0/0`. The WHT was a 10× decimal slip (was rendering as 0.05%).
- **L1 FIXED** — `tests/static-check.mjs` now derives the expected SW cache version from `release-manifest.json` instead of a hardcoded literal. Future cache bumps no longer need a test edit.
- **L2 VERIFIED SAFE** — `showDeletePopup` (core.mjs:1151) uses `textContent`, not `innerHTML`. No XSS. No change made.
- **M3 FIXED (build v190)** — added `pruneEphemeralNodes`, a daily scheduled Cloud Function (03:30 Asia/Manila) that deletes `orderLocks`/`rateLimits` older than 7 days, `orderStatusCommands` older than 45 days, and `clientTelemetryDaily` older than 120 days. Cutoffs are deliberately generous — live data is never touched. Registered in `requiredFunctionExports`.
- **M4 FIXED (build v190)** — draft capture/restore now excludes *all* `<select>` elements (they're state-derived), not just `posChannelSel`. Text/number/checkbox fields still preserved. Any future state-driven select in the cart panel is now immune to the "reverts" bug by construction.
- **L3 FIXED (build v190)** — computed WCAG contrast on the POS surface; two real failures fixed: `.pz-lbl` section labels (`var(--tl)` #79806f → #666c5c, 4.09→5.43) and the header build marker (#b8945f → #7d5f2c, 2.47→5.18). The rest of the POS pairs already pass AA.
- **L4** — `database-debug.log` is gitignored (never deployed); delete locally at will. Branch alignment to `main` done.

All audit items are now resolved.

---


---

## How to read this

Severity = impact × likelihood, from your seat (real money, real books, single-store).
Nothing here is on fire. Server-side authority is genuinely strong (details in "What's solid"). The findings are mostly exposure, config accuracy, and housekeeping — the kind of stuff that bites in month 6, not day 1.

Effort: S = under an hour · M = half a day · L = multi-session.

---

## Findings (ranked)

### H1 — `posSettings` is world-readable, and nothing public needs it — MEDIUM/HIGH · effort S
`database.rules.json` → `posSettings: { ".read": true }`. But the customer site never reads it (grep of `index.html` + `assets/js/customer/` = zero hits). What's inside `posSettings`: `channels` (your GrabFood 25% / FoodPanda 30% commission + WHT/VAT assumptions), **`optionCosts` (ingredient cost mappings)**, `stdCostMethod`, `tolerances`, `payMethods`.
**Impact:** anyone on the internet, unauthenticated, can read your cost structure and platform economics. No write vector — it's disclosure only — but it's your books' cost side, exposed.
**Fix:** change `posSettings` `.read` to the same auth+admin guard the other back-office nodes use. Confirm the POS (admin side) still reads it fine (it will — admin is authed). One-line rule change + re-publish rules.

### M1 — Channel prefixes in code don't match what we agreed — MEDIUM · effort S
We settled on `POS-` / `OO-` / `GF-` / `FP-`. The code emits:
- `pos.js` line 9 → Food Panda returns **`FF`**, not `FP`.
- `functions/index.js` line 743 → online orders are **`OD-`**, not `OO-`.
Walk-in `POS-` and GrabFood `GF-` are correct.
**Impact:** receipts and references read `FF-…` / `OD-…`. `FF` vs `GF` is easy to misread on a printed receipt — the exact ambiguity the prefix was meant to kill.
**Fix:** `FF`→`FP` in pos.js (safe, display only). `OD-`→`OO-` in createOnlineOrder — **new orders only**; existing `OD-` order IDs stay as-is (they're keys, don't rewrite them). Low risk, but it's a server deploy, so bundle it deliberately.

### M2 — Platform WHT/VAT defaults look wrong and asymmetric — MEDIUM · effort S (verify) 
`pos.js` line 11: `grabfood {rate:0.25, wht:0, vat:0}` vs `foodpanda {rate:0.30, wht:0.0005, vat:0.036}`.
Two problems: (a) your GRAB_PANDA_spec says WHT + VAT apply to gross for **both** channels, but GrabFood's defaults are zero. (b) `wht:0.0005` = **0.05%** — that reads like a decimal slip; the PH creditable withholding tax on e-marketplace gross is **0.5% (0.005)**. A missing digit understates the deduction 10×.
**Caveat / assumption:** these are *seed defaults*. If you've set the rates in POS Settings, `posSettings.channels` overrides them and this is moot. If Settings was never filled, the seeds are live → receivable and net platform sales are misstated **until the weekly payout reconciliation trues them up** (so P&L self-corrects weekly; interim management numbers drift).
**Fix:** confirm the effective rates (Settings vs these seeds) against an actual Grab and Panda payout statement. Correct the `0.0005` if it's meant to be `0.005`, and set GrabFood's real WHT/VAT.

### M3 — Idempotency/lock nodes have no pruning (unbounded growth) — MEDIUM/LOW · effort M
`orderStatusCommands`, `orderLocks`, `rateLimits`, `clientTelemetryDaily` are written per-order / per-command and never cleaned (no `remove`/prune/TTL for them in `functions/index.js`). `activeOrders` and `orders` DO get pruned/archived; these don't.
**Impact:** none today; over months these grow without bound → slower reads on those paths and a rising RTDB storage bill. A blindspot, not a bug.
**Fix:** one scheduled function (daily) that deletes entries older than, say, 60–90 days from those four nodes. They're all idempotency/rate bookkeeping — safe to age out well after the order is closed.

### M4 — The draft capture/restore pattern is a latent bug class (the "select twice" root cause) — MEDIUM · effort M
`pos.js` `restorePosDraft` rewrites `el.value` for **every** id'd input/select/textarea after each cart re-render. That's exactly what desynced the channel dropdown (fixed in v188 by excluding `posChannelSel`). Any *other* control whose value is derived from state — not from raw user typing — can desync the same way (stale snapshot wins over the fresh render).
**Impact:** today, only the channel select was affected. But the pattern is a trap for the next state-driven select someone adds.
**Fix:** invert the rule — capture/restore should be an allow-list of genuine free-text fields (customer name, notes, tender amount), not "everything with an id." Medium refactor; prevents a whole class of future "it reverts" bugs.

### L1 — Tests hard-code the SW cache string — LOW · effort S
`tests/static-check.mjs` asserts `const CACHE='accaza-v82'` literally, so every cache bump forces a test edit (I hit this on v82). `release-readiness-check.mjs` already does it right — it reads the version from `release-manifest.json`.
**Fix:** make static-check read the expected version from the manifest too. Removes a step from every deploy.

### L2 — Verify the archive-confirm popup escapes the customer name — LOW · effort S
`admin-orders.mjs` line 34 passes `'Archive order from '+o.name` into `showDeletePopup(title, …)` unescaped. If `showDeletePopup` renders the title via `innerHTML`, a crafted customer name is stored XSS in your admin panel. If it uses `textContent` (likely), it's fine.
**Fix:** confirm one line in `showDeletePopup`; wrap the title in `escHtml` if it's `innerHTML`. (The order *cards* already escape every field — this is the one interpolation that isn't obviously safe.)

### L3 — Accessibility: do a systematic contrast pass — LOW · effort M
Fixed the option highlight in v188. Same low-contrast risk exists on other POS chips/banners (e.g. `#8a5a00` text on `#fff6e5`). Worth one deliberate WCAG-AA sweep of the POS surface rather than fixing pixel-by-pixel as you spot them.

### L4 — Housekeeping — LOW · effort S
`database-debug.log` sits in the repo root (it's gitignored via `*.log`, so it won't deploy — just local clutter). The earlier "Temp: log auth identity" logging is gone (no sensitive `console.log` of uid/token/auth/proof found anywhere — good). Local branch was `master` while the deploy branch is `main`, which is what caused the mis-push earlier; standardize your local clone to `main`.

---

## What's solid (so you know where NOT to spend effort)

- **Server pricing authority.** `createOnlineOrder` re-prices every line server-side, rejects a client `expectedTotal` that doesn't match (±0.01), rate-limits per user, uses a per-signature order lock for exactly-once, and rolls back the payment-proof upload if the DB write fails. This is the hard part and it's done right.
- **Order status changes** are authenticated, transition-validated, and idempotent via an `orderStatusCommands/{requestId}` claim — and the code explicitly dodges the Admin-SDK "transaction sees null on cold start" footgun (documented in `order-status.js`).
- **Financial postings** are double-entry and balanced (`assertBalanced`, ±0.009), with an explicit variance line when platform estimates don't tie to gross. `costing.js` is a careful weighted-average-cost engine with unit conversion and clear error/warning codes.
- **Rules posture:** global default-deny; ledgers (`financialMovements`, `inventoryMovements`, `cashCustody`, etc.) are server-write-only; only catalog nodes are public-read (except the `posSettings` slip in H1).
- **Offline POS sync** carries duplicate/committed idempotency guards.
- **XSS:** the admin order card escapes name, phone, contact, items, address, and notes via `escHtml`.

---

## Suggested order of attack

1. **H1** (posSettings read rule) — smallest change, closes real exposure. Rules-only deploy.
2. **M2** (verify platform WHT/VAT) — no code until you've checked a real payout; may just be a Settings entry.
3. **M1** (FF→FP, OD→OO) — bundle with the next frontend + functions deploy.
4. **M3 / M4 / L1** — plan as a small hardening pass; none are urgent.
5. **L2 / L3 / L4** — clean up opportunistically.

Say which ones you want and I'll implement + hand you the exact deploy set, same as the v188 fix.
