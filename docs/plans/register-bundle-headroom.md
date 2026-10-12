# Register bundle headroom — split plan

**Status:** planned, not started. Written 12 Oct 2026 from the analysis in this session.
**Owner step:** execute as **step 1 of the next register feature**, in a fresh session, or as a
standalone pass if headroom is wanted sooner. See "Alternative" for a smaller safe rehearsal.

## Why

`assets/js/admin/register.js` is generated from **every** `.js` file in `src/admin/register/`
(sorted), so the bundle grows with each register feature:

```
assets/js/admin/register.js   275,443 bytes   ceiling 278,800   3,357 free (98.8%)
```

The ceiling in `tests/bundle-budgets.mjs` is a **growth-review gate, not a device limit** — nothing
is broken today. It exists so that a future register feature cannot silently overrun the budget.

Section sizes (largest first) and whether they may move:

| Section | Size | May go lazy? |
|---|---|---|
| `40-revolving-fund.js` (Cash Payments) | 56.6 KB | riskiest — defines helpers other sections call |
| `80-shift-lifecycle-zreport.js` (close / Z report) | 35.3 KB | **no — shift close must never wait on a fetch** |
| `60-operations-shift-review.js` | 23.8 KB | possible |
| `30-discrepancy-controls.js` | 23.2 KB | **yes — recommended** |
| `20-z-report-payment-methods.js` | 19.2 KB | **no — every Z report needs it** |
| `70-settings-staff.js` | 18.0 KB | possible |
| `90-shift-review-export.js` (print / CSV) | 11.8 KB | yes — smallest, caller-free |

**Invariant:** shift close, Z report, handover, cash movements and denominations stay in the eager
bundle. A cashier closing a shift must never wait on a network fetch (`accaza-pos-live-safety`).

## How lazy loading already works

`assets/js/admin/module-loader.js` is a route-based loader:

- `files` — module name → file in `assets/js/admin/`
- `routes` — tab name → the modules that tab needs, e.g. `discrepancy:['pos','register']`
- `roots` — tab name → its container element id (`discrepancy:'discrepancyRoot'`)
- `load(name)` — injects `<script src="assets/js/admin/<file>?v=<admin build>">` and memoises it

The register bundle is **already** loaded per tab, so a companion bundle needs no HTML change.

The build tool already has the companion pattern to copy: `src/books/app` splits
`50-controlled-transactions.js` into `assets/js/books/controlled-transactions.js` with
`exclude` / `include`, and `module-loader` loads it on demand.

## The blocker that shapes the split

`src/admin/register/00-bootstrap-payment-controls.js:29` is an **always-on** subscription:

```js
a.subscribe('discrepancies', function(s){ discMap=s.val()||{}; updateDiscBadge(); if(isTab('discrepancy')) renderDiscrepancies(); });
```

`updateDiscBadge()` runs on **every** discrepancies update, on **any** register tab, so it and the
list helpers it reads must stay eager. Only `renderDiscrepancies` is tab-gated.

The other two external references are fine: `assets/js/admin/core.mjs:19,90` is the **server
callable** bridge (`reviewDiscrepancyCall`), not the UI function; and
`00-bootstrap-payment-controls.js:54` dispatches by tab name
(`window.__accazaRegisterModule('register', function(name){ … })`), which is exactly the hook the
companion load can hang on.

## The six steps

1. **Keep the eager helpers eager.** Move `dnum`, `discrepancyDate`,
   `isRetainedLegacyDiscrepancy`, `isHiddenLegacyDiscrepancy`, `discList`, `updateDiscBadge` out of
   `30-discrepancy-controls.js` and into the eager
   `src/admin/register/00-bootstrap-payment-controls.js` (or a new eagerly bundled sibling such as
   `src/admin/register/05-discrepancy-badge.js` — pick whichever keeps the diff smaller).
2. **Leave the on-demand code in place.** `renderDiscrepancies`, `reviewDiscrepancy`,
   `cashDifferenceCase`, `finishIncompleteDiscrepancy`, `exportDiscrepancies`, `discrepancyOutcome`
   stay in `src/admin/register/30-discrepancy-controls.js`, which becomes the companion bundle.
3. **Split the bundle** in `tools/build-runtime-bundles.mjs`:
   - register bundle gains `exclude:['30-discrepancy-controls.js']`
   - new entry `{source:'src/admin/register',target:'assets/js/admin/register-discrepancies.js',include:['30-discrepancy-controls.js']}`
4. **Wire the loader** in `assets/js/admin/module-loader.js`:
   - `files`: `registerdiscrepancies:'register-discrepancies.js'`
   - `routes.discrepancy`: add the module **after** `'register'` so it is fetched before the tab
     renders. Confirm the route runner awaits every module before dispatching
     `__accazaRegisterModule('register', …)`, and add the module to any other route whose render
     calls into the moved functions.
5. **Budgets and guards.**
   - `tests/bundle-budgets.mjs`: add a ceiling for `assets/js/admin/register-discrepancies.js`.
   - Repoint any static guard that asserts a moved marker against the built `register.js`
     (check `tests/static/40-operations-ui.mjs` and `tests/static/60-finance-books.mjs`);
     `tests/bundle-closure-check.mjs` covers the new bundle automatically because it is built the
     same way.
   - If `sw.js` precaches admin bundles, add the companion there.
6. **Version markers, then verify.** Admin build **669 → 670**, service-worker cache
   **664 → 665**, synchronised in: `src/html/admin/00-document-navigation.html` (meta),
   `src/html/admin/50-admin-workspace.html` (visible label), `src/html/admin/70-runtime.html`
   (`?v=`), `assets/js/admin/core.mjs`, `assets/js/admin/portal-auth.mjs`, `sw.js`,
   `build-version.json`, `release-manifest.json` (`builds.admin`, `builds.serviceWorkerCache`),
   and the two hard-coded expectations in `tests/business-intelligence-check.mjs` and
   `tests/performance-budget-check.mjs`. Then `npm run build:runtime`, `npm run build:html`,
   `npm test`, `npm run test:release`, `npm run test:safety`.

## Expected outcome

`register.js` ≈ **252 KB** (~9% headroom), companion ≈ 23 KB. The budget warning from the deploy
log disappears.

## Verification that matters

The suite does not execute the browser, so a wrong split shows up as a broken Discrepancies tab in
production, not as a red build. Before merging, open the register on a **staging/UAT project** and
check: the discrepancies badge still counts on other tabs, the Discrepancies tab renders on first
open, and reviewing a discrepancy still posts. Do not split the shift-close path.

## Alternative (smaller, safer rehearsal)

Split only `90-shift-review-export.js` (11.8 KB, print/CSV helpers, no cross-module callers) the same
way: ~5% headroom for a fraction of the risk. Worth doing first if you want the mechanism proven
before the bigger move.

## Rollback

Revert the branch and run `npm run build:artifacts`; the bundles are generated, so the previous
artifacts return exactly. No data or ledger effect either way.
