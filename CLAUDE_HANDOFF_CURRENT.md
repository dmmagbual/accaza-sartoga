# Accaza Coffee Shop — Current Claude Handoff

**Last updated:** 10 August 2026  
**Project:** `accaza-sartoga`  
**Workspace:** `C:\AKALIKO\DMM\PERSONAL\CLAUDE\Projects\Accaza Coffee Shop`

## Read This First

This is the single current handoff document. Claude should inspect the actual workspace files before editing and run `npm test` first. Do not trust old build numbers or older release documents over this file and the current source.

## Current Production Change Pending Deployment

Danilo confirmed all releases through 5D are deployed and production-tested. Release 7B Functions are deployed; Release 7H is implemented and locally validated. Frontend is **`admin.html` v179**, customer v46, and service-worker cache v76. `CLAUDE_HANDOFF.md` and `release-manifest.json` are the authoritative continuation/status sources. Coordinated 7C–7H GitHub publication, Database query-index deployment, and production v179 smoke evidence remain pending.

The prior v157 login/startup incident was fixed and tested in the later coordinated releases. Do not publish individual modules from an older release over the current coordinated set.

- `/orders` remains authoritative.
- `/activeOrders` is the bounded live POS/admin projection.
- Resolved closed-shift POS sales archive automatically.
- Pending non-cash and unsettled platform orders remain active until resolved.
- Analytics and finance use bounded, paginated history.
- High-growth logs and archives have indexed query windows and “Load older” controls.
- Active order updates replace one card where possible.
- Inventory quantity/WAC is server-authoritative. Every sale, purchase, internal use, R&D, waste, adjustment, edit, refund, and void return has an idempotent movement ID and audit record.
- Release 7H automatically detects recipe-linked inventory, requires an active approved SKU when it is received, records the SKU on receipts/invoice lines/batches, and exposes recipe items without a SKU in Inventory.
- The coordinated 7H patch also restores clickable customer reservation time slots with native buttons and explicit module-safe handlers that open the reservation form.
- Inventory now names each stock item as the common recipe SKU and treats child records as approved purchasing brands; its fixed action grid keeps every delete control vertically aligned.
- The compact header now owns an always-live `posActiveShift` subscription, so shift and cashier status update on every workspace without opening Register Operations first.
- Inventory rows now expose only Brands, Adjust, Edit, and delete; supplier receipts remain centralized in Purchases and the four-column action rail stays aligned.
- Release 3B uses one byte-identical costing engine in the browser and Functions. The browser previews; `onOrderFinalize` produces authoritative usage, `cogsSnapshot`, and detailed `cogsDetail` evidence.
- Release 3C adds immutable balanced `/financialMovements`, server-owned financial projections, deterministic retry-safe posting, historical/opening-balance backfill, and a bounded Finance audit view.
- Release 3D adds real Firebase manager approvals, actual refund tenders, register-cash custody/deposit accounting, controlled chart accounts, and a server control audit.
- Release 3E moves order archive/deletion, discrepancy review, petty voucher decisions, and activity retention behind server controls. Financial sales cannot be deleted; only rejected orders older than 90 days without a financial posting are eligible for manager-approved deletion.
- Release 4A extracts Firebase initialization, real-time subscriptions, history paging, portal authentication, manager approval, active orders, customer registry, and shared UI utilities from the admin core. `core.mjs` decreased from 230,525 to 196,310 bytes without changing database behavior.
- Release 4B extracts catalog administration, reservations/calendar, and channel-pricing management.
- Release 4C extracts standalone customer-session and live order-tracker ownership. `core.mjs` is now 122,745 bytes; pricing, payment, inventory, and Firebase paths are unchanged.
- Release 5A restores separate customer/POS manifests and icons, registers the service worker on both entry pages, caches the real POS shell, and prevents admin offline failures from falling back to the customer homepage. Offline sales are not yet enabled.
- Release 5B replaces the legacy localStorage offline queue with IndexedDB and server-owned idempotent synchronization. Cash-only offline sales have visible Pending/Syncing/Failed/Synced states; denomination drawer deltas are applied once.
- Release 5C makes POS/customer installation explicit through one shared controller, visible POS buttons, truthful device instructions, installed-state handling, and update-ready reload UX.
- Release 5D replaces all active browser prompts with a shared validated Accaza form. Financial and operational entries now have required/range validation, accessible keyboard behavior, preserved values on failure, and regression protection against prompt reintroduction.
- Release 5E preserves POS draft values/focus during background redraws, makes Charge single-flight through durable save, prevents duplicate financial forms, and enlarges touch controls.
- Release 6A adds non-blocking, privacy-safe daily aggregate telemetry for startup, POS build, cart render, durable Charge, offline sync, remote-order arrival, and generic client errors.
- Release 6B adds integrated all-channel checkout/accounting tests, executable partial-failure and exactly-once offline replay tests, expanded Database Emulator controls, tracked-secret detection, and mandatory GitHub quality gates before Function deployment.
- Release 6C adds a lazy management-only System Health dashboard with bounded 7/30-day reads, honest average/worst thresholds, build/error release signals, and formal release/restore/review routines.
- Release 6D adds a machine-readable release manifest, CI-enforced release consistency, final Claude handoff/entry files, and manager-role System Health rule coverage.
- Release 7A routes portal order-status changes through an authenticated, permission-checked, stale-state protected, idempotent server command and denies direct browser status changes.
- Release 7B adds a bounded, sanitized, management-only Operations Center for stuck orders, partial offline sync, missing inventory/accounting postings, aged cash custody, proof-access failures, and client health warnings.
- Release 7C declutters the portal into POS, Overview, Orders & Operations, Inventory, Financials, Customers, and Settings, with role-aware landing and unchanged permissions.
- Release 7D adds contextual workspace headers and shortcuts, a live connection/role/shift/offline-queue strip, and a wider focused POS canvas with a sticky checkout action.
- Release 7E optimizes rush-hour selling with local menu search, accessible categories, clearer product tiles, ticket readiness, directed empty states, and one-tap quantity correction.
- Release 7F introduces a shared back-office visual system for ledgers, cards, controls, status badges and dense operational screens, plus an Overview shortcut to System Health.
- Release 7G turns Overview into an actionable command center with a service brief, immediate-attention queue, live-floor signals, money position, stock exceptions, system health and direct controlled routes.

Next deploy Release 7G: publish the coordinated v173/cache-v62 files, wait for CI, then deploy Database rules for the Release 7B query indexes. See `RELEASE_7G_OVERVIEW_COMMAND_CENTER_2026-08-10.md`.

## Current Builds

- `admin.html`: **v179 Release 7H deployment pending**. Hash must be recaptured after final packaging.
- `index.html`: **v46**, modular customer scripts, App Check, shared install UX, and repaired reservation slot selection. Hash must be recaptured after final packaging.
- `sw.js`: **cache v76**, including Release 7H and all earlier PWA assets. Hash must be recaptured after final packaging.
- `assets/js/admin/` and `assets/js/customer/`: **mandatory Release 2D publish directories**. Do not publish only the HTML files.
- Cloud Functions: Node.js 22, region `asia-southeast1`.
- `assets/js/admin/core.mjs`: SHA-256 `C6488B1E9F589746EB75F6AECADF85C523AD3EF728E99E6FE3B8F10BCA04BB02`.
- Release 4C modules: `app-customer-session.mjs` and `customer-order-tracker.mjs`. Both are mandatory with v159.
- Release 4A modules: `firebase-client.mjs`, `realtime-hub.mjs`, `history-pager.mjs`, `manager-approval.mjs`, `portal-auth.mjs`, `admin-orders.mjs`, `customer-registry.mjs`, and `shared-ui.mjs`. All are mandatory with v157.
- `assets/js/admin/module-loader.js`: SHA-256 `05DC6451A33C52E283EACE31A09916EE70FFCEAD6EFC955AA308E28ADBA914D4`.
- `assets/js/admin/pos.js`: 250,295 bytes; SHA-256 `CD2A4CB866C970AE3DDFC870355EB2CD7324F2436D23183EF7A8D2F7F47D62FB`.
- `assets/js/shared/costing.js`: SHA-256 `C5D34EBB0ECD205B901DE8A2CDC2FD0388C93447204131450E39831680F27ACC`.
- `assets/js/admin/register.js`: SHA-256 `F99DFB416B174FCADB9BB6DEA1C2F3A7588089CB923C96A948AD22DE61EE2A56`.
- `assets/js/admin/overview-command.mjs`: Release 7G bounded Overview command center; hash must be recaptured after final packaging.
- `assets/js/admin/telemetry.js`: Release 6A collector now reporting admin-v173; hash must be recaptured after final packaging.
- `assets/js/admin/operations-dashboard.js`: Release 6C bounded System Health view; SHA-256 `6E5944400D178D12D4216FD592AC4E88E9920975FBC22CCB514629486B9DA5E2`.
- `assets/js/admin/firebase-client.mjs`: SHA-256 `384D2F192886D876F22D876467DF1C9420D52E6311D1C9C626C01830D4251453`.
- `assets/js/admin/admin-orders.mjs`: SHA-256 `97796ECB987BFAE5D10C102B50D3FD294E4112F4ECBCDAD39825099725C21EE7`.
- `assets/js/admin/customer-order-tracker.mjs`: SHA-256 `E338D1387B10D75B1D2035FACB0C3B26D4DE46088AC24695BB3B4BD177CF9361`.
- `assets/js/admin/form-dialog.js`: Release 5D validated form service; SHA-256 `F9E3CDEA5B76BAF5EFFB75D6A899ADC0DC2D64517BEACF88308E2791383E2F13`.
- `assets/js/admin/finance.js`: SHA-256 `E5B5EEBDEE0B1E85D0BC3AE9D9BE280BF4095357C39521FFD0F78F0ACD82817D`.
- `assets/js/admin/analytics.js`: SHA-256 `E6202C01F2318FA3129FAAAF8DE0A4DFB1215788BFD7B27D4EA1EF64FC91866C`.
- `functions/index.js`: Release 7A order-status command plus prior Functions; SHA-256 `E0416D520BAA578FE8914DC90A17E9165C2B0A8C31B8FB568BAE98C42F286A7B`.
- `functions/lib/order-status.js`: Release 7A transition/idempotency engine; SHA-256 `7B4390369E228EB7A5AE6F4E2453F94201575C4257D028997B2EB68646271E52`.
- `functions/lib/offline-sync.js`: production offline idempotency/recovery engine; SHA-256 `B33733F3A8C3D0C4A1D2360A5AA25C9969ED6BF2C87B4AFF01F7EC52C79647B2`.
- `functions/lib/financial.js`: SHA-256 `F67488B9BE91A30FF9AF13BFB7585DAD9D5BFEEC46F23C8E4D6B594FCA526B5E`.
- `functions/lib/costing.js`: SHA-256 `C5D34EBB0ECD205B901DE8A2CDC2FD0388C93447204131450E39831680F27ACC` (must match browser engine).
- `database.rules.json`: SHA-256 `D57B8A60E3A32B4108C8CABE390A24A6020B303089E957278AC1CF4018B3D4CA`.

## What Is Already Live

Firebase Authentication:

- Email/password enabled for staff/admin.
- Anonymous enabled for customers.
- Admin authorization comes from `/admins/{firebaseUid}`.
- Legacy browser-trusted password login is removed from the active admin portal.

App Check:

- Correct Firebase web app ID: `1:315522485228:web:64ed3b7facef5a39148ec9`.
- Registered app nickname: `accaza-web-LIVE`.
- reCAPTCHA Enterprise is registered.
- Public site key is already in `index.html`.
- Functions App Check enforcement must remain **false** until valid production tokens are observed consistently.
- Do not enable Realtime Database-wide App Check yet; `admin.html` does not initialize App Check.

Cloud Functions currently deployed and verified in `asia-southeast1`:

- `createOnlineOrder`
- `confirmOrderReceived`
- `getPaymentProof`
- `notifyOnComplete`
- `onOrderFinalize`

Danilo reports the v154 Release 3C package below is deployed and tested:

- `postFinancialCommand`
- `settlePlatformPayout`
- `processOrderAdjustment`
- `ensureFinancialLedger`
- `onOrderFinancialPosting`
- `onShiftPayInsFinancial`
- `onShiftPayOutsFinancial`
- `onShiftCloseFinancial`
- `onPettyVoucherFinancial`
- `onPettyReplenishmentFinancial`

The local v156 package adds these pending 3D endpoints/triggers:

- `createManagerApproval`
- `consumeManagerApproval`
- `manageChartAccount`
- `auditFinancialControls`
- `onShiftOpenFinancial`

It also extends `processOrderAdjustment`, `settlePlatformPayout`, `postFinancialCommand`, and `onShiftCloseFinancial`. Database rules add private `/financialApprovals` and server-written `/chartOfAccounts` and `/cashCustody`. Do not deploy the rules without the matching Functions and v156 frontend.

Release 3E adds these pending endpoints:

- `manageOrderArchive`
- `reviewDiscrepancy`
- `managePettyVoucher`
- `archiveActivityLog`

Rules lock browser writes to `/archivedOrders`, `/activityLogArchive`, `/operationalAudit`, and `/deletionAudit`, and prevent browser updates that review discrepancies or decide petty vouchers. Do not deploy the rules without matching Functions and the v156 frontend.

Storage:

- Default bucket initialized in `asia-southeast1` (Singapore): `accaza-sartoga.firebasestorage.app`.
- `storage.rules` deployed; browser reads/writes are denied.
- Storage and Functions deployment completed successfully.
- Singapore is billable. Approximate Standard storage is about USD 0.022/GB-month; keep it for speed and add lifecycle/budget controls later.

Database rules:

- Release 1A/1B/1C security rules were previously deployed.
- Customer orders are server-created, server-priced, UID-owned, and use private duplicate locks.
- Do not overwrite `database.rules.json` with an older copy.

## Release 2A — Payment Proof Storage

Implementation is complete and backend is deployed. Architecture is documented in `ADR-001_PRIVATE_PAYMENT_PROOFS.md`; rollout details are in `RELEASE_2A_PAYMENT_PROOFS_2026-08-09.md`.

New flow:

1. Customer v42 compresses receipt images in the browser.
2. `createOnlineOrder` validates MIME type, binary signature, and size.
3. Cloud Function stores the image privately in Storage.
4. Realtime Database order stores only `proofPath`, type, size, and schema version—not base64 image data.
5. Admin v146+ shows `View payment proof` and calls `getPaymentProof` only when clicked.
6. `getPaymentProof` verifies the Firebase portal role before returning the image.
7. Legacy orders with embedded `proof` remain viewable.

Frontend publication status must be confirmed. The intended GitHub files are:

- `index.html` v43
- `sw.js` cache v44
- `admin.html` v150
- complete `assets/js/admin/` and `assets/js/customer/` directories

After publication, perform this Release 2A end-to-end test:

1. Place a customer order in incognito with a receipt.
2. Confirm the order succeeds.
3. In Realtime Database, verify the new order has `proofPath` and no large `proof` field.
4. In admin Orders, click `View payment proof` and confirm the image opens.
5. Check function logs if upload/view fails.

## Important Bugs Already Fixed

### Accidental App Check enforcement

`defineBoolean("ENFORCE_APP_CHECK")` was passed directly to callable options. Firebase Functions SDK v6 treated the parameter object as truthy, so missing App Check tokens were rejected even though `.env` said false. Fixed by converting `process.env.ENFORCE_APP_CHECK` to a real Boolean. Regression guard exists in `tests/static-check.mjs`.

### Customer “Unauthenticated” order failures

Logs proved customer Auth was VALID and App Check was MISSING. The real cause was the accidental App Check enforcement above, not Anonymous Auth. `index.html` also now forces a fresh customer ID token and retries once on transient unauthenticated responses.

### Admin empty-data regression

Caused by protected listeners starting before authorization. Emergency v147 restored a reload; Release 2B v148 now fixes the architecture by starting listeners only after authorization and safely removes the reload again.

## Required Test Command

Run from workspace root:

```powershell
npm test
```

The complete suite passes with v158/v43:

- 29 executable HTML and external scripts parsed.
- Customer input containment passed.
- Release 1A/1B/1C guards passed.
- Server pricing tests passed.
- Payment-proof type/signature/size tests passed.
- Active-order lifecycle, projection proof stripping, and closed-shift archival tests passed.
- Lazy module routing, dependency order, reuse, and deferred Excel loading passed.
- Release 3A authority, movement retry, WAC, and rule guards passed.
- Release 3B conversions, normalization, option stacking, cost coverage, usage, trace evidence, and browser/server drift checks passed.
- Release 3C/3D split sale, platform receivable, actual mixed-tender refund, invalid allocation rejection, transfer, and debit/credit balancing checks passed.
- Firebase rules emulator tests passed, including activeOrders/customer isolation and denial of forged financial movements, approvals, chart accounts, custody, cash entries, receivables, payables, payouts, inventory, archived orders, discrepancy reviews, petty voucher decisions, and control-audit records.
- Functions syntax passed.
- Firebase Functions/Database dry run passed. The only warning is an intentionally deferred `firebase-functions` dependency upgrade that may contain breaking changes.

## Next Planned Work

### First: deploy and test coordinated Release 7G

Follow `RELEASE_7G_OVERVIEW_COMMAND_CENTER_2026-08-10.md`: publish the coordinated frontend, wait for CI, deploy Database rules, then verify the command center, role landing and every primary work area.

### Then: production measurement and final handoff

Publish/deploy the 6D package, collect enough production telemetry to evaluate the targets below, execute the restore/role/dependency runbook, then update `release-manifest.json` from candidate to production-verified only when evidence exists. The final `CLAUDE_HANDOFF.md` and concise root `CLAUDE.md` are present and must remain synchronized with verified truth.

Performance targets from `ACCAZA_IMPROVEMENT_ROADMAP.md`:

- Warm POS launch under 1.5 seconds.
- Cold launch under 3 seconds.
- Cart actions under 100 ms.
- Remote order appears within 1.5 seconds p95.
- Initial active-order payload under 250 KB excluding proofs.
- No lifetime-history read during startup.

## Security Constraints Claude Must Preserve

- Never restore browser-trusted admin hashes or legacy username/password authority.
- Never make Storage payment proofs public or store permanent public download URLs.
- Never store new base64 proofs in Realtime Database.
- Keep server pricing authoritative.
- Keep customer ownership based on Firebase UID.
- Keep order locks private/server-owned.
- Keep `ENFORCE_APP_CHECK` a real Boolean.
- Do not enable database-wide App Check until admin initializes it and monitoring is clean.
- Do not weaken Firebase rules merely to make a denied operation work.
- Existing user changes and local files must be preserved; this folder is not currently a Git repository.

## Key Documents

- `CLAUDE_HANDOFF.md` — authoritative architecture, ownership, deployment, limitations, and continuation guide.
- `release-manifest.json` — machine-readable build and production-verification truth.
- `RELEASE_6D_PRODUCTION_VERIFICATION_HANDOFF_2026-08-09.md` — Phase 6D files, Firebase deployment, acceptance, and rollback.
- `ACCAZA_IMPROVEMENT_ROADMAP.md` — master improvement sequence.
- `RED_TEAM_AUDIT_2026-08-09.md` — audit findings and risk baseline.
- `RELEASE_1A_SECURITY_2026-08-09.md` — stored-XSS containment.
- `RELEASE_1B_AUTH_ROLES_2026-08-09.md` — Firebase Auth and role enforcement.
- `RELEASE_1C_SERVER_ORDERS_2026-08-09.md` — server-priced customer orders and App Check rollout.
- `ADR-001_PRIVATE_PAYMENT_PROOFS.md` — private proof architecture.
- `RELEASE_2A_PAYMENT_PROOFS_2026-08-09.md` — proof Storage deployment and test plan.
- `RELEASE_2B_REALTIME_DATA_2026-08-09.md` — auth-gated shared listener architecture and deployment test plan.
- `ADR-002_BOUNDED_ACTIVE_ORDERS.md` — authoritative-order and active-projection architecture decision.
- `RELEASE_2C_BOUNDED_DATA_2026-08-08.md` — coordinated deployment order, checksums, and production smoke tests.
- `ADR-003_LAZY_FRONTEND_MODULES.md` — Release 2D module-loading architecture and trade-offs.
- `RELEASE_2D_MODULAR_FRONTEND_2026-08-09.md` — required publish files, payload measurements, and smoke tests.
- `ADR-005_SHARED_COSTING_AUTHORITY.md` — shared unit, recipe, usage, and COGS authority decision.
- `RELEASE_3B_COSTING_AUTHORITY_2026-08-09.md` — 3B deployment order and production smoke tests.
- `ADR-006_SERVER_FINANCIAL_MOVEMENT_LEDGER.md` — immutable financial ledger, authority boundaries, assumptions, and trade-offs.
- `RELEASE_3C_FINANCIAL_LEDGER_2026-08-09.md` — coordinated 3C deployment, backfill, smoke tests, rollback, and limitations.
- `ADR-007_FINANCIAL_CONTROLS_AND_CASH_CUSTODY.md` — Firebase manager approvals, actual refund tenders, custody, chart-account, and exception-control decisions.
- `RELEASE_3D_FINANCIAL_CONTROLS_2026-08-09.md` — exact v155 deployment files, prerequisites, smoke tests, and limitations.
- `ADR-008_SERVER_OPERATIONAL_CONTROLS_AND_RETENTION.md` — server archive authority, constrained deletion, operational approvals, and retention decision.
- `RELEASE_3E_OPERATIONAL_CONTROLS_2026-08-09.md` — exact v156 deployment files, tests, retention behavior, and rollback warning.
- `ADR-009_ADMIN_MODULE_BOUNDARIES.md` — incremental native-module architecture, ownership rules, and trade-offs.
- `RELEASE_4A_MODULE_FOUNDATION_2026-08-09.md` — exact v157 publish files, checksums, tests, and rollback procedure.
- `ADR-010_CATALOG_RESERVATION_AND_CHANNEL_MODULES.md` — 4B ownership boundaries and atomic deployment decision.
- `RELEASE_4B_CATALOG_RESERVATIONS_2026-08-09.md` — exact v158 files, live-login hotfix, checksums, and smoke tests.
- `FUNCTIONAL_SPEC_pos_features.md` — implemented POS/business behavior.
- `RECIPE_INVENTORY_ARCHITECTURE_v2.md` — inventory/costing design.

## Working Style Requested by Danilo

- Be concise and high-signal.
- Be brutally honest; do not hide uncertainty or failed tests.
- Every financial number must be traceable.
- Flag assumptions.
- Discuss large feature choices before building.
- Prioritize POS speed, real-time reliability, security, and financial integrity over new convenience features.
