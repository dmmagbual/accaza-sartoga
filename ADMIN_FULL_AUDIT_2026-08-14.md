# Accaza Admin full audit — 14 August 2026

## Executive result

Every visible Admin workspace was opened in the signed-in production site, from Overview/POS through Petty Cash and Settings. All workspaces rendered, no tab remained stuck in a loading state, and no browser-console error was produced during the walkthrough. The complete local quality gate also passed, including Firebase Realtime Database emulator permission tests.

The review found and fixed four release-level defects: a fragile reservation shortcut, customer access to legacy ownerless orders, unsafe Firebase deployment workflow behavior, and public GitHub Pages publication of backend/internal files. Admin build 198 and service-worker cache 92 contain the corrections.

## Production walkthrough

The following areas were opened and checked: Overview, Operations Center, Orders, Register Operations, Reservations, Calendar, POS, Stock Items, Purchases, Recipes, Internal Usage, Packages, Analytics, Profit & Loss, Daily Report, Platform Payouts, Cash Flow, Receivables, Payables, Inventory, Discrepancies, Petty Cash, Reviews, App Customers, POS Settings, Channel Pricing, Menu Maintenance, Payment Details, Account Setup, Staff Access, and Change Password.

Observed result: every workspace rendered successfully. Daily Report loaded rather than remaining on its loading placeholder. Operations Center loaded with zero critical exceptions, two warnings, and historical client telemetry available for review.

## Corrections prepared in build 198

1. The Overview reservation alert now opens Reservations by its stable route name instead of assuming it is the third tab.
2. Realtime Database rules now deny customer reads of legacy orders that have no `ownerUid`. Customers can read only orders explicitly owned by their Firebase UID; staff access remains permission-based.
3. Firebase production deployment now runs only from `main`, cannot overlap another production deployment, uses the production GitHub environment, has a timeout, and no longer uses `--force`.
4. GitHub Pages now excludes Functions source, Firebase rules/configuration, release manifests, tests, tools, dependencies, backups, and internal documents from the public site.
5. Firebase Admin and Functions packages were upgraded to current major versions compatible with Node 22. The previous high-severity dependency finding was removed.
6. Regression tests now enforce the order privacy rule, Pages exclusions, safe deployment workflow, and stable reservation navigation.

## Deployment and repository findings

- The production domain is served by GitHub Pages from the root of `main`; it is not served by Firebase Hosting. Static-site releases therefore require a Git push. Firebase deploy is only for Functions, Realtime Database rules, and Storage rules.
- The custom domain uses enforced HTTPS and has an approved certificate.
- The `main` branch currently has no branch protection. A mistaken direct push can bypass pull-request review. Enable branch protection/rulesets and require the quality-gate check before merging.
- The Firebase workflow still authenticates with the legacy `FIREBASE_TOKEN` secret. Move it to Google Workload Identity Federation or a narrowly scoped service account before token authentication is retired.
- Many user-created audit/release documents are untracked. They were deliberately left untouched. Decide which are authoritative and commit or archive them separately so future developers do not follow conflicting instructions.

## Database and application risks still requiring planned migrations

### High — POS staff PIN storage

Staff PINs are stored in Realtime Database and compared in browser code. Anyone with sufficient POS database access can inspect the values. Replace this with a server callable that verifies salted password hashes, then force a one-time PIN reset. This needs a controlled credential migration and should not be performed as a blind code-only change.

### Medium — database growth in reports and controls

Several server control/audit functions still read large order, archive, ledger, voucher, or shift collections in one operation. They work now, but will become slower and may hit Function memory/time limits as years of transactions accumulate. Add date-bounded queries, pagination, and scheduled monthly aggregates before volume becomes large.

### Medium — petty-cash images in Realtime Database

Petty-cash receipt images are compressed but stored as data URLs in Realtime Database. This increases payload size and report/listener cost. Migrate images to Firebase Storage and retain only protected object paths in the database, following the same pattern already used for online-order payment proofs.

### Medium — client activity logs are not authoritative

Authenticated portal clients can create activity-log records, so those entries can be spoofed. Continue treating server-only `operationalAudit` and financial ledgers as authoritative. Route security-sensitive activity through server callables if it must become audit evidence.

### Medium — remaining dependency advisory

The Functions package retains seven moderate advisories in a transitive `uuid` dependency under Google Cloud Storage/Firebase Admin. The only automated npm proposal is a breaking downgrade to Firebase Admin 10, which is unsafe and was not applied. Monitor upstream releases and retest when Google publishes a fixed dependency chain.

### Medium — missing browser smoke automation

The production walkthrough passed, but it is manual. Add an authenticated Playwright smoke suite that opens every workspace and fails on loading placeholders, console errors, or missing route targets. This would have detected the earlier Daily Report and navigation regressions before deployment.

### Low/medium — monolithic Admin shell and browser headers

`admin.html` remains a large shell containing substantial customer-facing markup and inline code. Lazy modules reduce startup cost, but splitting the Admin and customer shells further will reduce regression surface. GitHub Pages also offers limited response-header control; adopting a host that supports Content Security Policy and other security headers would improve browser hardening.

## Verification evidence

- Full `npm run test:ci`: passed.
- 38 executable HTML/external scripts: syntax passed.
- Server pricing, payment proofs, active-order lifecycle, module loading, inventory ledger, costing, finance, checkout, offline recovery, operations exceptions, and approval checks: passed.
- Realtime Database emulator ownership/permission suite: passed, including denial of legacy ownerless-order reads.
- Root production dependency audit: zero vulnerabilities.
- Functions runtime load under Node 22: passed.
- Patch whitespace/integrity check: passed.
- Production Admin browser walkthrough: all workspaces rendered; no console errors.

## Release sequence

1. Commit only the build-198 audit files; do not include unrelated untracked documents.
2. Push to `main`. GitHub Pages will publish the website, while the Functions workflow will test and deploy Functions plus Database/Storage rules.
3. Wait for both GitHub Actions workflows to finish successfully.
4. Confirm Admin shows build 198, force-refresh once to activate cache 92, and repeat an order status change plus a Daily Report date click.
5. Verify public URLs such as `/functions/index.js`, `/database.rules.json`, and `/release-manifest.json` return 404 after Pages completes.
6. Enable `main` branch protection and schedule the PIN, bounded-query, and petty-cash-image migrations above.
