# Accaza Improvement Roadmap

**Prepared:** 9 August 2026  
**Primary objective:** Make the POS secure, fast, real-time, traceable, and safe to change without interrupting store operations.

## Operating rule

Do not rewrite or deploy everything at once. The current system is a working live application with tightly coupled code. Improvements must be released in small, reversible stages, with a backup and acceptance test before every deployment.

Until Phases 0–2 are complete, new convenience features should be paused unless they resolve an operational emergency. Security, performance, and financial integrity now outrank feature growth.

## Roadmap overview

| Order | Initiative | Status | Outcome | Main dependency |
|---:|---|---|---|---|
| 0 | Safety harness and deployment control | Not Started | Every change is recoverable and testable away from production | GitHub repository and Firebase staging/emulators |
| 1 | Emergency security hardening | In Progress — 1A and 1B complete locally | Close customer-to-admin attack paths and enforce real roles | Phase 0 baseline |
| 2 | POS performance and real-time redesign | In Progress — 2A through 2D implemented locally; production timing gate pending | Fast startup and checkout with bounded live data | Secure data model from Phase 1 |
| 3 | Inventory and financial integrity | In Progress — 3A through 3C deployed/tested; 3D and 3E implemented locally | Exactly-once stock, costing, financial movements, approval, and retention controls | Server-authoritative functions |
| 4 | Modularization and maintainability | In Progress — 4A and 4B implemented locally | Smaller files, lower regression risk, easier development | Stable behavior from Phases 1–3 |
| 5 | Offline reliability and usability | Not Started | Dependable offline queue, clear recovery, tablet-friendly screens | Modular POS shell |
| 6 | Monitoring, testing, and operational maturity | Not Started | Measured performance, automated regression checks, controlled releases | All earlier phases |

## NOW — stabilize and secure

### Phase 0: Safety harness and deployment control

**Goal:** Make it possible to improve the live system without gambling with the working version.

#### Deliverables

1. Establish one authoritative Git repository.
2. Create a clean structure:

   - `public/` — only files allowed to be published.
   - `src/` — editable application source.
   - `functions/` — one authoritative Cloud Functions implementation.
   - `tests/` — rules, functions, and checkout tests.
   - `docs/` — current specifications and runbooks.
   - Backups, costing files, exports, and private documents outside the repository.

3. Add `.gitignore` and verify that database backups, ZIP files, pricing sheets, staff information, and private documents were never committed publicly.
4. If sensitive files were committed, purge Git history and rotate affected legacy passwords/PINs.
5. Tag the exact current production version so rollback is possible.
6. Create a Firebase staging project or Firebase Emulator environment using sanitized test data.
7. Add a single deployment checklist covering GitHub Pages, database rules, and Cloud Functions.
8. Record baseline measurements on the actual cashier device:

   - POS cold-start and warm-start time.
   - Initial network payload.
   - Time to add an item.
   - Time from Charge to Firebase acknowledgement.
   - Time for a new order to appear on another device.

#### Release gate

- Current production version can be restored.
- No sensitive backup is publicly accessible.
- Staging/emulator can complete a basic sale without touching production.

### Phase 1: Emergency security hardening

**Goal:** Prevent customers or staff from bypassing intended permissions or corrupting protected records.

#### Release 1A — stored-XSS containment

1. Replace unsafe rendering of order, reservation, feedback, review, customer, and note fields.
2. Use `textContent` wherever HTML formatting is unnecessary.
3. Use one tested escape function for the limited fields that must enter templates.
4. Validate customer submission types, lengths, quantities, and allowed values.
5. Make feedback and reservation writes create-only for customers.
6. Add regression tests with malicious HTML payloads.

#### Release 1B — real authentication and role enforcement

**Local implementation status (9 August 2026):** Complete and emulator-validated; not deployed. See `RELEASE_1B_AUTH_ROLES_2026-08-09.md`. Release 1C remains outstanding.

1. Remove the legacy public admin password-hash login.
2. Stop restoring admin privileges directly from `sessionStorage`.
3. Wait for Firebase Auth and authorized role resolution before showing admin screens.
4. Define roles: owner, manager, cashier, kitchen, finance.
5. Enforce each role in Firebase rules and Cloud Functions—not only by hiding tabs.
6. Treat POS PINs as optional screen-unlock convenience, not financial authorization.
7. Require server approval for voids, refunds, stock adjustments, payout settlement, account changes, and manager overrides.

#### Release 1C — customer ownership and server-priced orders

**Local implementation status (9 August 2026):** Core implementation complete and emulator/dry-run validated; not deployed. App Check is intentionally in monitoring mode until the production domain is registered and legitimate traffic is verified. See `RELEASE_1C_SERVER_ORDERS_2026-08-09.md`.

1. Create online orders through a callable Cloud Function.
2. Server validates menu item, availability, option, quantity, and price.
3. Server calculates the order total and generates an unguessable ID.
4. Stamp `ownerUid` from authenticated context.
5. Let customers read or confirm only their own order.
6. Key customer profiles by UID rather than phone number.
7. Make order locks server-owned and private.
8. Add Firebase App Check and basic abuse monitoring.

#### Release gate

- Anonymous user cannot read or alter another customer's order/profile.
- Cashier cannot write manager/finance-only nodes.
- Submitted HTML renders as harmless text.
- Altered client prices are rejected or recalculated server-side.

## NEXT — remove lag and protect financial truth

### Phase 2: POS performance and real-time redesign

**Goal:** Keep the live POS data path small and predictable regardless of historical growth.

#### Release 2A — remove heavy payloads

**Deployment status (9 August 2026):** Storage and Cloud Functions deployed and verified; frontend publication and end-to-end production test pending. See `RELEASE_2A_PAYMENT_PROOFS_2026-08-09.md` and `ADR-001_PRIVATE_PAYMENT_PROOFS.md`.

1. Move payment proofs from Realtime Database to Firebase Storage.
2. Compress and validate receipt images before upload.
3. Store only file paths and thumbnail paths in orders.
4. Load proof images only when explicitly opened.
5. Move large videos, private images, exports, and spreadsheets outside the published application.

#### Release 2B — one real-time data layer

**Local implementation status:** Complete in admin v148+; production verification remains part of the coordinated 2C rollout.

1. Create one central subscription for each Firebase node.
2. Remove duplicate module listeners and duplicate in-memory maps.
3. Start only POS-critical listeners at launch:

   - Active catalog.
   - Availability.
   - Active shift and cashier.
   - Minimal POS settings.
   - Active orders and recent shift sales.

4. Lazy-subscribe to analytics, cash flow, payouts, history, recipes, and purchasing only when their tabs open.
5. Unsubscribe when heavy tabs close.

#### Release 2C — bounded active data

**Local implementation status (8 August 2026):** Complete in admin v149 with coordinated Functions and Database rules. Static tests, lifecycle tests, rules emulator, and Firebase dry-run pass. Production deployment pending. See `ADR-002_BOUNDED_ACTIVE_ORDERS.md` and `RELEASE_2C_BOUNDED_DATA_2026-08-08.md`.

1. Introduce a small `/activeOrders` projection.
2. Keep completed historical orders outside the live POS node.
3. Query only recent shift records using indexed timestamps/status/shift IDs.
4. Paginate archives, shifts, ledger entries, stock receipts, AR/AP, and payouts.
5. Update only the affected order card instead of rebuilding all order HTML.

#### Release 2D — reduce startup code

**Local implementation status (9 August 2026):** Core performance implementation completed in admin v150, customer v43, and service-worker cache v44. Automated regression and rules-emulator tests pass; coordinated publication and cashier-device timing remain pending. The remaining 224 KB shared admin core is explicitly deferred to Phase 4 because safe removal requires browser-level workflow coverage. See `ADR-003_LAZY_FRONTEND_MODULES.md` and `RELEASE_2D_MODULAR_FRONTEND_2026-08-09.md`.

1. Remove retired admin code from `index.html`.
2. Remove duplicated customer-site code from `admin.html`.
3. Load SheetJS only when Excel import/export is requested.
4. Split POS, register operations, inventory, recipes, analytics, and finance into separately loaded modules.
5. Preserve the current visual design and workflows during the split; do not perform a framework rewrite at the same time.

#### Performance release gate

- POS warm launch under 1.5 seconds on cashier device.
- POS cold launch under 3 seconds on normal store network.
- Cart actions respond in under 100 ms.
- New order appears on another device within 1.5 seconds p95 on a stable connection.
- Initial active-order payload under 250 KB, excluding receipt images.
- No lifetime-history read during POS startup.

### Phase 3: Inventory and financial integrity

**Goal:** Make every stock, cash, receivable, payable, and payout movement exactly traceable and safely retryable.

#### Release 3A — inventory movement ledger

**Production status (9 August 2026):** Deployed in admin v152 with coordinated Cloud Functions and Database rules. Opening balances were initialized, and live purchase, sale, internal-usage/reversal, adjustment, and refund smoke tests passed. See `ADR-004_INVENTORY_MOVEMENT_LEDGER.md` and `RELEASE_3A_INVENTORY_LEDGER_2026-08-09.md`.

1. Replace browser inventory deduction with server-only finalization.
2. Make every ingredient deduction independently idempotent by order ID.
3. Record immutable stock movements: purchase, sale usage, staff use, R&D, adjustment, waste, refund reversal.
4. Materialize current stock from controlled movements while retaining the complete audit trail.
5. Prevent a retry from applying the same order/ingredient movement twice.
6. Add failure-injection tests for partial Cloud Function failure.

#### Release 3B — costing authority

**Local implementation status (9 August 2026):** Complete in admin v153 with a shared browser/Functions engine, server-normalized recipes, authoritative order COGS evidence, and regression coverage. Production deployment and smoke test remain pending. See `ADR-005_SHARED_COSTING_AUTHORITY.md` and `RELEASE_3B_COSTING_AUTHORITY_2026-08-09.md`.

1. Move shared recipe and option costing logic into one tested module.
2. Browser shows a preview; server produces the authoritative COGS snapshot.
3. Record cost source, unit conversion, effective date, and missing-cost warnings.
4. Reject impossible quantities, invalid units, and missing inventory references.

#### Release 3C — server-posted accounting movements

**Local implementation status (9 August 2026):** Complete in admin v154. Balanced immutable movements, server-owned projections, historical backfill, bounded Finance audit view, regression tests, rules-emulator tests, and Firebase dry run pass. Production deployment and smoke testing remain pending. See `ADR-006_SERVER_FINANCIAL_MOVEMENT_LEDGER.md` and `RELEASE_3C_FINANCIAL_LEDGER_2026-08-09.md`.

1. Cloud Functions create ledger entries when payments are confirmed.
2. Server creates/settles receivables and payables.
3. Server posts platform payouts, commission, refund, cancellation, and variance allocations.
4. Server posts void/refund reversals with links to original movements.
5. Remove browser `reconcileAuto` writes.
6. Give each financial movement a stable ID, source document, actor, timestamp, and reversal link.

#### Release 3D — financial controls and cash custody

**Local implementation status (9 August 2026):** Complete in admin v155. Firebase manager approvals, actual refund tenders, closed-shift cash custody, FIFO float issuance, bank deposits, controlled chart accounts, exception audit, regression tests, rules-emulator tests, and Firebase dry run pass. Production deployment and smoke testing remain pending. See `ADR-007_FINANCIAL_CONTROLS_AND_CASH_CUSTODY.md` and `RELEASE_3D_FINANCIAL_CONTROLS_2026-08-09.md`.

1. Require server-verified Firebase manager identity for sensitive financial actions.
2. Capture and validate the actual tender returned on refunds.
3. Track register cash from shift close through next float or bank deposit.
4. Replace free-text manual accounting categories with controlled accounts.
5. Surface missing postings, mapping problems, open balances, and undeposited cash in one control audit.

#### Release 3E — operational controls and retention

**Local implementation status (9 August 2026):** Complete in admin v156. Server-owned order archive, constrained rejected-order deletion, discrepancy review, petty voucher decisions, activity retention, browser write locks, automated tests, rules-emulator tests, and Firebase dry run pass. Production deployment and smoke testing remain pending. See `ADR-008_SERVER_OPERATIONAL_CONTROLS_AND_RETENTION.md` and `RELEASE_3E_OPERATIONAL_CONTROLS_2026-08-09.md`.

1. Route order archive and eligible deletion through permission-checked callables.
2. Retain financial sales; allow only manager-approved deletion of rejected orders after 90 days and without a financial posting.
3. Route discrepancy review and petty voucher approval/rejection/void through manager-approved server actions.
4. Move activity-log archival to a bounded server process.
5. Record immutable operational and deletion audit evidence.

#### Release gate

- Retrying any event produces exactly one financial and inventory result.
- Every balance can be traced to movement IDs.
- Browser closure cannot prevent a required ledger posting.
- Inventory and COGS reconcile to completed order usage.

## LATER — simplify development and improve resilience

### Phase 4: Modularization and maintainability

**Goal:** Make future changes safer and faster without changing working business behavior.

#### Release 4A — admin module foundation

**Local implementation status (9 August 2026):** Complete in admin v157 and service-worker cache v46. Automated tests pass; GitHub publication and production smoke testing remain pending. The admin core is reduced from 230,525 to 196,310 bytes. See `ADR-009_ADMIN_MODULE_BOUNDARIES.md` and `RELEASE_4A_MODULE_FOUNDATION_2026-08-09.md`.

- Centralized Firebase initialization and callable ownership.
- Extracted real-time subscriptions, bounded history paging, portal authentication, manager approvals, active orders, customer registry, and shared UI safety helpers.
- Removed duplicate customer-registry definitions and unreachable legacy browser password recovery.
- Added module-boundary, import-resolution, and core-size regression guards.

#### Planned Release 4B — catalog and reservations

**Local implementation status (9 August 2026):** Complete in admin v158 and cache v47. Catalog administration, reservations/calendar, and channel-pricing UI now have separate owners. The live v157 login blocker is fixed locally; atomic GitHub publication remains pending. See `ADR-010_CATALOG_RESERVATION_AND_CHANNEL_MODULES.md` and `RELEASE_4B_CATALOG_RESERVATIONS_2026-08-09.md`.

- Extracted menu/catalog CRUD, options, availability, channel pricing, and reservation behavior behind explicit interfaces.
- Preserved POS channel-price calculations and existing Firebase paths.
- Reduced `core.mjs` to 131,560 bytes and added a 135 KB regression guard.
- Fixed eager receipt callback initialization that disabled the live v157 login page.

#### Release 4C — compatibility cleanup

**Local implementation status (9 August 2026):** Complete in admin v159 and cache v48. Customer app-session and live order-tracker responsibilities now have separate owners; `core.mjs` is 122,745 bytes with a 125 KB regression gate. GitHub publication and production smoke testing remain pending. See `ADR-011_CUSTOMER_COMPATIBILITY_BOUNDARIES.md` and `RELEASE_4C_CUSTOMER_COMPATIBILITY_2026-08-09.md`.

- Separated standalone customer identity/login, tracker, ready alert, and received-confirmation behavior.
- Removed duplicated customer tracker state from the shared admin core.
- Preserved compatibility bridges while inline HTML handlers still exist.
- Deferred a build pipeline: the current native-module graph does not yet justify adding build-tool complexity.

1. Introduce a clear application structure:

   - `src/shared/` — formatting, validation, Firebase client, units, money.
   - `src/customer/` — menu, order, tracker, reservations.
   - `src/pos/` — cart, channel pricing, payment, receipt.
   - `src/backoffice/` — inventory, recipes, purchasing, internal usage.
   - `src/finance/` — cash flow, AR/AP, payout, P&L.
   - `src/register/` — shifts, denominations, Z-report.

2. Replace chained globals and repeated `window.posSwitchTab` wrappers with explicit module interfaces.
3. Add schema/version documentation and idempotent migration scripts.
4. Remove divergent duplicate files and old production copies from active source.
5. Use a lightweight build pipeline after modules are stable; avoid a full framework rewrite unless a later business need justifies it.

### Phase 5: Offline reliability and usability

**Goal:** Make network interruptions obvious, recoverable, and safe.

**Release 5A local status (9 August 2026):** Complete in admin v160, customer v44, and cache v49. Separate customer/POS manifests, complete icon assets, shared service-worker registration, the real POS shell cache, and type-correct offline fallbacks are implemented. Offline transactions remain intentionally disabled pending Phase 5B. See `ADR-012_PWA_OFFLINE_SHELL.md` and `RELEASE_5A_PWA_OFFLINE_SHELL_2026-08-09.md`.

**Release 5B local status (9 August 2026):** Complete in admin v161 and cache v50. The legacy localStorage/direct-write queue is replaced by IndexedDB, explicit sync states and retry controls, and authenticated idempotent server processing including denomination drawer deltas. Firebase and GitHub deployment plus production interruption testing remain pending. See `ADR-013_DURABLE_OFFLINE_POS_TRANSACTIONS.md` and `RELEASE_5B_DURABLE_OFFLINE_POS_2026-08-09.md`.

**Release 5C local status (9 August 2026):** Complete in admin v162, customer v45, and cache v51. Installation now has one shared owner, visible POS controls, device-specific fallback help, installed-state handling, and update-ready reload UX. GitHub publication and production install testing remain pending. See `ADR-014_SHARED_PWA_INSTALL_UX.md` and `RELEASE_5C_PWA_INSTALL_UX_2026-08-09.md`.

1. Restore and version the PWA manifest/icons.
2. Cache the real POS shell and required local modules.
3. Use IndexedDB—not `localStorage`—for pending offline transactions.
4. Assign idempotency IDs before queueing.
5. Show Pending, Syncing, Failed, and Synced status with retry controls.
6. Never report a sale as safely synchronized until Firebase confirms it.
7. Replace financial `prompt()` flows with validated modal forms.
8. Preserve input/focus during real-time updates.
9. Add keyboard/touch targets and text/icon indicators alongside colors.
10. Test power loss, browser closure, duplicate tap, reconnection, and stale-cache scenarios.

### Phase 6: Monitoring, testing, and operational maturity

**Goal:** Detect regressions before staff or customers do.

**Release 5E/6A local status (9 August 2026):** Complete in admin v165 and cache v54. POS drafts/focus survive background redraws, Charge is single-flight through durable save, touch targets are enlarged, and privacy-safe daily aggregate telemetry measures the critical speed/error paths. Coordinated Firebase/GitHub deployment and cashier-device timing remain pending. See `ADR-016_NON_BLOCKING_OPERATIONAL_TELEMETRY.md` and `RELEASE_5E_6A_POS_STABILITY_TELEMETRY_2026-08-09.md`.

**Release 6B local status (9 August 2026):** Complete. Integrated checkout/accounting tests, executable offline partial-failure and duplicate-replay tests, expanded rules-emulator controls, tracked-secret detection, and GitHub quality/deployment gates pass locally where applicable. Firebase dry run for `syncOfflinePosSale` passed. See `ADR-017_RELEASE_QUALITY_GATE.md` and `RELEASE_6B_AUTOMATED_WORKFLOW_RECOVERY_TESTS_2026-08-09.md`.

**Release 6C local status (9 August 2026):** Complete in admin v166 and cache v55. A lazy, management-only System Health dashboard reads a bounded 7/30-day window, applies honest average/worst timing thresholds, and exposes build/error release signals. The operational runbook formalizes smoke tests, rollback decisions, monthly restore tests, and quarterly permission/dependency reviews. See `ADR-018_OPERATIONAL_HEALTH_RELEASE_GATES.md`, `RELEASE_6C_OPERATIONAL_HEALTH_2026-08-09.md`, and `OPERATIONS_RELEASE_RUNBOOK.md`.

**Release 6D local status (9 August 2026):** Candidate complete. `release-manifest.json`, an automated release-readiness gate, `CLAUDE_HANDOFF.md`, and `CLAUDE.md` now define and verify the authoritative project state. A discovered manager/System Health authorization mismatch was corrected in Database rules and covered by the emulator. Production v166 smoke/performance evidence, backup restore, and periodic reviews remain explicitly pending. See `RELEASE_6D_PRODUCTION_VERIFICATION_HANDOFF_2026-08-09.md`.

1. Firebase Emulator tests for database rules.
2. Cloud Function tests for retries, duplicate events, partial failure, refunds, and reversals.
3. Checkout tests for in-store, split payment, GrabFood, FoodPanda, unavailable items, options, packages, and refunds.
4. Performance telemetry for startup, render, Charge, sync, and remote arrival.
5. Error reporting for permission failures, offline queue failures, function failures, and notification failures.
6. CI checks for syntax, tests, rules, dependency audit, and accidental sensitive files.
7. Staged deployment: staging test, production release, post-deploy smoke test, rollback decision.
8. Monthly restore test for Firebase backups.
9. Quarterly permissions and dependency review.
10. Produce and verify the final Claude project handoff described below.

## Final Claude handoff deliverable

## Phase 5D — Validated operational forms (implemented locally)

- Replaced every active admin/POS browser prompt with one validated Accaza control-record form.
- Added required, range, length, and custom validation with inline errors that preserve entries.
- Added keyboard focus, Escape cancellation, accessible dialog semantics, and service-worker precaching.
- Kept manager approval and server posting authoritative for discounts, voids, refunds, petty cash, and discrepancy controls.
- Added a regression gate that rejects any future active `prompt()` usage.


At the end of the improvement program, create an authoritative `CLAUDE_HANDOFF.md` and a concise root `CLAUDE.md` pointer/instruction file. These must be based on the final deployed source—not copied from old chat summaries.

The handoff must contain:

1. Current production build/version and audit date.
2. Exact runtime architecture: GitHub/Firebase Hosting status, Firebase project, Realtime Database, Auth, Storage, Cloud Functions, and service worker.
3. Authoritative file map and which old/backup files must not be edited or deployed.
4. Firebase database node/schema summary, ownership rules, indexes, and retention/archive behavior.
5. Cloud Function names, triggers, idempotency behavior, and failure/retry handling.
6. Authentication roles and the permissions enforced for each role.
7. POS workflows: shifts, payments, split payments, denominations, channels, refunds, voids, inventory, costing, platform payouts, and Z-reports.
8. Complete change log of the security, performance, data-integrity, offline, and usability improvements.
9. Important business decisions and intentionally rejected approaches, with reasons.
10. Deployment instructions for frontend, rules, functions, Storage rules, and rollback.
11. Test commands, expected results, performance targets, and last verified results.
12. Known limitations, unresolved risks, and the next prioritized work.
13. A warning that every number shown in finance/inventory must remain traceable to a source movement or document.

Before handoff, open the project in a clean session and verify that following only `CLAUDE.md` and `CLAUDE_HANDOFF.md` is sufficient to understand, test, deploy, and safely continue the application.

## Ownership

| Responsibility | Codex | Danilo |
|---|---|---|
| Analyze and implement source changes | Primary | Review business behavior |
| Write tests and deployment instructions | Primary | Follow/approve production deployment |
| Firebase/GitHub credentials and console actions | Guide only | Primary |
| Verify cashier workflow and printed outputs | Support | Primary |
| Decide account roles and approval authority | Recommend | Final decision |
| Confirm live performance on actual device/network | Instrument | Execute/observe |

## Deployment strategy for every release

1. Export a fresh Firebase backup and keep it outside the repository.
2. Tag the current working source.
3. Implement one release only.
4. Run syntax, rules, function, and workflow tests.
5. Test against staging/emulator.
6. Deploy coordinated files/rules/functions.
7. Run smoke tests immediately:

   - Sign in by each role.
   - Open shift.
   - Complete in-store cash and non-cash orders.
   - Complete a platform order where relevant.
   - Confirm inventory/COGS/ledger result.
   - Close shift and print Z-report.
   - Place and track one customer online order.

8. Observe errors and performance.
9. Roll back if the release gate fails; do not patch forward blindly on the live register.

## Deliberately deferred

- A visual redesign.
- A new frontend framework.
- Multi-branch/multi-tenant commercialization.
- New convenience features that increase the monolith.
- Moving GitHub Pages to Firebase Hosting before urgent security and data-path fixes.

Firebase Hosting is recommended later for unified deployment, PWA assets, and security headers. It is not the primary solution to POS lag; the data/listener redesign is.

## Definition of success

The improvement program is complete when:

- Customer input cannot execute code in admin screens.
- Roles are enforced by Firebase/server, not visual hiding.
- Customers can access only their own data.
- Server calculates prices, COGS, stock, and accounting movements.
- Every movement is exactly-once or safely idempotent.
- POS startup and checkout remain fast as history grows.
- Heavy history and finance data are not loaded during checkout.
- Offline actions are visible and recoverable.
- Deployment is reproducible, testable, and reversible.
- No backup/private file is present in the published repository or site.
- A clean Claude session can safely continue the project using the final handoff files without relying on previous conversation history.
