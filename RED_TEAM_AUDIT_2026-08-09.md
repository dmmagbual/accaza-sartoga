# Accaza Coffee House — Whole-Project Red-Team Audit

**Audit date:** 9 August 2026  
**Scope:** The files currently present in the project folder, including the customer website, admin/POS, Firebase Realtime Database rules, Cloud Functions, service worker, deployment configuration, local backups, templates, and dependency tree.

## Executive verdict

Accaza is a **feature-rich working prototype**, but it is not yet a production-safe financial POS. The greatest current risk is not missing features; it is that too much authority, financial logic, and rendering are trusted to the browser.

The POS can feel fast today because the available local backup contains only 48 menu items and a small operating history. Its current architecture will slow down as orders, payment proofs, ledger entries, shifts, stock receipts, and activity logs accumulate. It loads entire database nodes, keeps multiple copies in memory, reruns full scans on small changes, and initializes finance/analytics listeners even when those tabs are closed.

There is also a **critical stored cross-site scripting path**: anonymous-authenticated customers can create feedback, reservations, and orders containing HTML, while the admin page renders several of those fields directly with `innerHTML`. Opening a malicious record could execute code under a manager's signed-in Firebase session.

**Overall production-readiness score: 4/10.** I would not expand usage, add a second register, or treat the finance and inventory records as audit-grade until the Priority 0 items are fixed.

## Scorecard

| Area | Score | Red-team assessment |
|---|---:|---|
| Completeness | 6/10 | Broad feature coverage, but clean deployment, PWA assets, test coverage, staging, and operational controls are incomplete. |
| Security | 2/10 | Critical stored XSS; staff permissions are UI-only; customer records and orders are not owner-bound; legacy hashes/PINs are exposed too broadly. |
| Performance and scalability | 3/10 | Fast enough for today's small data, but the full-node listeners, base64 images, monolithic UI, and browser reconciliation will create lag. |
| Reliability and data integrity | 3/10 | Inventory finalization can partially commit and then double-deduct on retry; client and server still race; client prices are trusted. |
| Adaptability and maintainability | 3/10 | A 968 KB global-script admin monolith, duplicated logic, implicit schema, and divergent backups make change risky. |
| Usability | 6/10 | Strong domain-specific workflows, but silent failures, native prompts, heavy rerenders, and inconsistent authentication state weaken day-to-day operation. |

## What is in the project

### Runtime application

- `admin.html` — 968,268 bytes, 7,793 lines, build v141. Contains the POS, register operations, inventory, recipes, analytics, finance, staff access, packages, and substantial duplicated customer-site code.
- `index.html` — 499,338 bytes, 4,058 lines. Customer website plus a large amount of retired admin functionality.
- `styles.css` — shared website styling, 53,208 bytes.
- `sw.js` — service worker and Firebase Messaging bootstrap, 2,302 bytes.
- `about.html`, `contact.html`, `menu.html`, `reservations.html` — smaller public pages.
- `functions/index.js` — two Cloud Functions: ready notification and inventory finalization.
- `database.rules.json` — Realtime Database authorization rules.
- `firebase.json` and `.firebaserc` — database/functions deployment configuration for `accaza-sartoga`.

### Project material mixed into the same root

- Database backup: `accaza-backup 27-07-2026.json`.
- Full HTML backups and retired pages.
- Two repository ZIP files.
- Costing and pricing spreadsheets/PDFs.
- Planning, deployment, and security documents.
- A second, divergent `PRICING and COSTING/functions/index.js`.
- Several large videos, including files around 30 MB. They are not referenced by the current runtime pages, so they do not currently explain page lag, but they should not be in a deployable web root.

This is not a clean separation between **source**, **public deployment**, **private business documents**, and **backups**.

## Priority 0 — fix before adding more features

### P0.1 Critical: customer-controlled stored XSS can run in the admin session

**Evidence**

- `database.rules.json` allows any authenticated user—including anonymous Firebase users—to create reservations and write any feedback record.
- `admin.html:2523`, `admin.html:2526`, and `admin.html:2548` insert order and reservation fields into `innerHTML` without escaping.
- `admin.html:3343` inserts feedback `name`, `contact`, and `message` without escaping.
- `admin.html:3352` does the same for review fields.
- The application has no Content Security Policy, and it contains hundreds of inline event handlers.

**Failure mode**

An attacker creates a feedback/reservation/order field containing an element with a JavaScript event handler. When a manager opens the relevant admin screen, the payload runs on the Accaza origin and can act with the manager's Firebase credentials.

**Required fix**

1. Immediately render all customer-controlled values with `textContent`, or pass every value through one tested HTML/attribute escaping function.
2. Validate field types, lengths, and allowed values in database rules or, preferably, accept submissions through a server function.
3. Make customer writes create-only and owner-bound.
4. Add a real CSP after removing inline handlers/scripts. CSP is defense-in-depth; it does not replace safe rendering.

### P0.2 Critical: UI permissions do not enforce database permissions

**Evidence**

- Almost every back-office rule uses only `root.child('admins').child(auth.uid).exists()`.
- That same test protects inventory, recipes, payouts, cash flow, receivables, payables, shifts, petty cash, logs, orders, and account hashes.
- `adminPerms` controls which tabs are shown in `admin.html`, but those permissions are not checked by the database rules.

**Failure mode**

Any Firebase UID listed in `/admins`, including a staff UID, can bypass hidden buttons and directly write finance, inventory, payout, recipe, shift, or account data through browser developer tools or the Firebase API.

**Required fix**

- Use Firebase Auth custom claims or a server-maintained role node with explicit rule checks: owner, manager, cashier, kitchen, finance.
- Enforce permissions per node and per operation in rules. Hiding a tab is usability, not security.
- Move manager-only approvals, voids, refunds, payout settlement, stock adjustment, and account changes to callable/server functions.

### P0.3 Critical: online orders trust customer prices and are not owner-bound

**Evidence**

- The order rule accepts any numeric total between 0 and 200,000 but does not verify line-item prices, menu IDs, quantities, option prices, or the computed total.
- `index.html:2252` uses a predictable `ORD-` plus the last six digits of `Date.now()`.
- `orders/$oid/.read` allows **any** authenticated user to read a known order ID.
- Any authenticated user can mark any known Ready/Completed order Received.
- There is no `ownerUid` on new orders.
- `appCustomers/$phone` permits any authenticated user to read or write any phone-keyed record.

**Failure modes**

- A customer can submit a zero/altered price while retaining real menu IDs, causing revenue and inventory to disagree.
- Anonymous users can enumerate predictable IDs and read other customers' names, phone numbers, addresses, notes, and payment proofs.
- A user can modify another customer's loyalty/customer record or mark another order received.

**Required fix**

- Create online orders through a callable Cloud Function. The server must load catalog prices, validate options/availability, calculate the total, generate an unguessable ID, and stamp `ownerUid` from the auth context.
- Rules must allow customers to read/update only records where `data.ownerUid === auth.uid`.
- Key customer profiles by UID, not phone number; store normalized phone as a validated field.
- Add App Check and rate limits/quotas to reduce automated abuse.

### P0.4 Critical data integrity: inventory deduction is not atomically retry-safe

**Evidence**

- `functions/index.js:183` claims the order by setting `inventoryDeducted`.
- `functions/index.js:219` runs separate ingredient stock transactions in `Promise.all`.
- If any later transaction or the order update fails, `functions/index.js:233` removes the claim.
- The POS still has a client-side whole-order listener and `tryDeduct` path at `admin.html:4255` and `admin.html:6118`.

**Failure mode**

Ingredient A can be deducted successfully, ingredient B can fail, and the function then removes the claim. A retry deducts ingredient A a second time. The browser can also win the claim before the server, so the current process is not truly server-authoritative.

**Required fix**

- Remove client-side stock deduction after the server path is proven.
- Make each ingredient application independently idempotent by recording `orderId` in the same transaction as that ingredient's stock change, or redesign finalization around an immutable stock-movement ledger.
- Do not clear a global claim after partial effects unless every effect can be safely identified and reversed.
- Add an automated failure-injection test: ingredient one succeeds, ingredient two fails, function retries, and total deduction remains exactly once.

### P0.5 High: sensitive private files are mixed with deployable/public files

The root contains a Firebase backup with `admins`, `adminPerms`, `staffAccounts`, `posStaff`, payment data, customer records, shift data, and activity logs. There is no `.gitignore`, no Firebase Hosting `public` directory, and no local Git repository identifying what is actually published.

I cannot prove from the folder alone that these files are publicly reachable, but the consequence is severe if the repository root is hosted or uploaded wholesale.

**Required fix**

- Immediately verify that the backup JSON, backup HTML files, ZIPs, spreadsheets, QR source images, and internal documents are not reachable on the public website or GitHub repository.
- If any backup was public, rotate Firebase credentials where relevant, all legacy passwords/PINs, and customer push tokens.
- Create a dedicated `public/` directory containing only runtime web assets. Keep backups encrypted and outside the repository.
- Add `.gitignore` and secret scanning.

## Performance and real-time findings

### P1.1 The admin starts 63 live Firebase listeners

The admin contains 63 `onValue` calls. Several subscribe to the same full nodes:

- `/orders`: five admin listeners.
- `/archivedOrders`: three listeners.
- `/inventory`, `/recipes`, `/internalUsage`, `/appCustomers`, reviews, feedback, and platform payouts: multiple listeners/copies.

The Firebase SDK may share an underlying network listen for identical references, but every registered callback still runs, maintains state, scans data, and can rerender.

All major module listeners initialize even when their tabs are closed. POS startup therefore also initializes analytics, register operations, and cash-flow state.

**Required fix**

- Create one central data store/subscription per node.
- Subscribe only to the POS hot path at startup: catalog, availability, active shift, minimal POS settings, and active/recent orders.
- Lazy-load analytics, historical inventory, cash flow, payouts, and reports when those tabs open; unsubscribe when they close.
- Query bounded records rather than loading entire nodes.

### P1.2 Every order mutation triggers broad scans and rerenders

The core listener at `admin.html:1792` replaces the entire order map and, for logged-in users, calls `renderOrders`, `renderDashboard`, and `renderAppCustomers`, followed by other customer/status rendering. The POS listener at `admin.html:4255` scans all orders to find undeducted completed records. Analytics scans all orders and writes missing completion timestamps. Cash flow also listens to all orders.

At `admin.html:7661`, `reconcileAuto` scans active orders, archived orders, accounts, payment methods, and the ledger; then it may write/remove ledger entries. A sale update can therefore trigger additional Firebase writes and additional listener cycles.

**Required fix**

- Use child-level events or a normalized active-order feed and update only the affected DOM card.
- Move `completedAt`, auto-ledger posting, receivable creation, and other derived records to server triggers.
- Do not recompute all historical records after every live sale.

### P1.3 Payment-proof images are stored directly inside Realtime Database orders

`index.html:2131` reads the original image as a data URL with no size or dimension limit. `index.html:2253` stores the full base64 string in the order.

This inflates:

- initial `/orders` download size;
- browser memory for each duplicated order map;
- snapshot processing and full-order rerenders;
- backup/export size;
- Realtime Database bandwidth and storage cost.

It is a likely future lag source and also permits oversized-payload abuse.

**Required fix**

- Upload compressed receipts to Firebase Storage with strict MIME and size rules.
- Store only a Storage path plus a small thumbnail path in the order.
- Load the full image only when the manager opens it.
- Exclude proof metadata from the POS active-order projection if the cashier does not need it.

### P1.4 The application ships as two large HTML monoliths

`admin.html` contains about 963,000 characters and 15 scripts. Its largest script blocks are roughly 244 KB for POS and 210 KB for the main module. `index.html` contains about 496,000 characters and still includes old admin order, reservation, review, archive, and login code.

The browser must download, parse, compile, and retain code for screens that are never used in the current session. The architecture also relies on globals such as `window.__accaza` and repeatedly wraps `window.posSwitchTab`, making load order fragile.

**Required fix**

- Split customer, POS, inventory, recipes, finance, analytics, and register operations into separate ES modules.
- Use dynamic `import()` for non-POS tabs.
- Remove retired admin code from `index.html` and customer-site code from `admin.html`.
- Load SheetJS only when an Excel import/export action is opened; it is currently a blocking CDN script on every admin load.

### P1.5 There are no bounded database queries or indexes

Orders, archives, shifts, logs, stock receipts, batches, SKUs, cash-flow ledger, receivables, and payables are loaded as whole nodes. `database.rules.json` has no `.indexOn` declarations.

**Required fix**

- Keep a small `/activeOrders` node and archive completed orders server-side.
- Query recent records with `orderByChild` plus `limitToLast`.
- Add indexes only for fields actually queried, such as `timestamp`, `status`, `shiftId`, `settlementStatus`, `date`, and `linkId`.
- Add paginated history screens instead of loading lifetime history.

### P1.6 Cash flow is reconciled only while an authorized browser is running

`reconcileAuto` is client code. If no manager browser opens the admin—or a browser closes mid-write—the ledger is not guaranteed to reflect every movement. Different clients can also race to write the same derived records.

**Required fix**

Post immutable ledger entries in Cloud Functions when a payment is confirmed, a payout settles, a purchase is received, a refund is approved, or an AR/AP item is collected/paid. The browser should display and request actions, not manufacture accounting history.

## Security and privacy findings

### P1.7 Public settings expose a legacy admin password hash

`settings` is publicly readable, and `admin.html:1593` reads `settings.adminPasswordHash`. The legacy login compares an unsalted SHA-256 password hash in browser code. Even when database rules prevent a fake browser session from writing protected data, publishing a reusable password hash enables offline guessing and creates dangerous security theater.

**Required fix:** remove the legacy username/hash login and use Firebase Auth only. Never put password hashes in publicly readable settings.

### P1.8 POS staff PINs are plaintext and readable by every authorized staff UID

`admin.html:7210` stores `pin` directly under `/posStaff`; all `/admins` members can read it. Manager-PIN approvals are therefore not a trustworthy authorization control.

**Required fix:** approvals must be validated server-side against the acting Firebase UID/role. If a local PIN is retained for convenience, treat it only as a screen unlock, not authorization.

### P1.9 Browser session storage can restore an unverified admin-looking UI

`admin.html:3587` calls `loginSuccess` using role/username/UID from `sessionStorage`; imported `onAuthStateChanged` is not used to gate that UI restoration. Database rules still protect restricted data when Firebase auth is absent, but the screen can show a false role state and hidden-tab controls remain untrustworthy.

**Required fix:** render no admin UI until Firebase Auth resolves and the server-authorized role is loaded. Clear the local session whenever auth and role disagree.

### P1.10 Customer writes lack robust validation and abuse controls

Reservations, feedback, orders, customer profiles, and order locks lack comprehensive type/length/schema limits. `orderLocks` is publicly readable and writable by any authenticated user. There is no visible App Check integration or server rate limiting.

**Required fix:** validate every customer-write field; cap item counts, string lengths, file sizes, quantities, and allowed enums; make locks private/server-owned; add App Check and abuse monitoring.

### P1.11 No CSP, no SRI for the blocking SheetJS CDN, and many inline handlers

The admin has 464 inline event-handler attributes and 152 `innerHTML` assignments. `index.html` has 159 inline handlers and 72 `innerHTML` assignments. This greatly increases injection risk and makes a strict Content Security Policy difficult.

**Required fix:** move event handlers into modules, eliminate raw `innerHTML` for data rendering, self-host or integrity-pin third-party assets, and deploy security headers through Firebase Hosting.

### P1.12 Dependency audit is not clean

`npm audit --omit=dev` on 9 August 2026 reported 11 vulnerabilities: one high, nine moderate, and one low. The high finding is a transitive `fast-xml-parser` issue; several moderate findings flow through the current `firebase-admin` dependency tree. Exploitability depends on the code paths used, but the deployed tree should not be left unreviewed.

**Required fix:** test an upgrade of `firebase-admin` and `firebase-functions` in a staging Firebase project, rerun the emulator/test suite, and deploy only after compatibility verification. Do not blindly apply a major-version audit fix directly to production.

## Reliability and financial-control findings

### P1.13 Client-generated IDs can collide and are guessable

Online IDs use only the last six timestamp digits. POS and other records also use timestamp/random helpers of varying strength. IDs should not carry security assumptions.

**Required fix:** use Firebase `push()` keys or cryptographically random UUIDs generated server-side.

### P1.14 Notification idempotency is not atomic

The notification function checks `pushNotified`, sends the message, and then updates the flag. A retry after sending but before the flag write can send a duplicate.

**Required fix:** use a transactional/outbox notification record with states and a stable notification ID. Accept that delivery can be at-least-once and make the client deduplicate by order/status.

### P1.15 Silent catches hide operational failure

The pages contain multiple empty catches, including service-worker registration and offline queue sync. Staff can believe an action succeeded while sync, notifications, ledger posting, or background initialization failed.

**Required fix:** create a visible sync/error center with retry, last-success time, pending count, and actionable error details. Send structured errors to monitoring.

### P1.16 Offline POS is not yet a dependable offline application

As represented by the current folder, `manifest.json` and all referenced favicon/PWA icon files are missing. `sw.js` calls `cache.addAll` with missing icons, so a clean deployment can fail service-worker installation. The service worker does not cache `admin.html` or the external Firebase modules needed to start the POS. Its catch-all fallback returns `index.html` for any failed same-origin GET, including non-navigation assets.

The POS outbox uses `localStorage`, silently ignores sync failures, and has no durable retry/dead-letter state.

**Required fix:** restore manifest/icons to source control, bundle critical JS locally, precache the real POS shell, use IndexedDB for an idempotent outbox, and return the HTML fallback only for navigation requests.

## Adaptability and maintainability findings

### P2.1 Duplicated client/server costing logic can drift

Recipe and option consumption logic exists in both `admin.html` and `functions/index.js`, with comments requiring manual synchronization. The second divergent function file under `PRICING and COSTING/functions` increases the risk of editing or deploying the wrong implementation.

**Required fix:** put pure costing/usage logic in a shared tested module used by both browser previews and server finalization. The server result remains authoritative.

### P2.2 The database has an implicit schema and no migration/version process

Dozens of nodes and historical formats are interpreted directly by UI code. There is no schema version, migration runner, or compatibility contract.

**Required fix:** document each node's schema, ownership, retention, indexes, and allowed transitions; add `schemaVersion`; write idempotent migrations and backup/restore checks.

### P2.3 Deployment is fragmented and drift-prone

`firebase.json` configures database rules and functions, but not Hosting. The GitHub workflow deploys only functions, uses a long-lived `FIREBASE_TOKEN`, and includes `--force`. Frontend and rules deployment remain separate/manual. The current folder itself is not a Git repository.

The result can be a frontend expecting rules/functions that are not yet deployed—or vice versa.

**Required fix:** create one version-controlled repository, add staging and production Firebase projects, configure Hosting, run tests in CI, and deploy frontend/rules/functions from one reviewed release. Prefer a scoped service account or workload identity over a long-lived CLI token; remove `--force` from routine deploys.

### P2.4 Backups are copies, not controlled rollback

`admin-backup.html`, old indexes, ZIPs, and duplicate functions are all divergent. This makes it unclear which version is authoritative and encourages accidental rollback of only one layer.

**Required fix:** use Git tags/releases for code rollback and tested Firebase backups for data recovery. Keep generated exports outside source.

## Usability findings

- Native `prompt()`/`confirm()` flows are used throughout complex financial and inventory actions. They are weak on tablets, provide poor validation, and are easy to dismiss accidentally.
- Full `innerHTML` replacement can reset focus/scroll/input state during real-time updates.
- The app often suppresses technical errors rather than giving the cashier a clear recover/retry action.
- Color-coded states should always retain visible text/icon labels for accessibility; color alone is insufficient.
- Admin initialization can show a role/state before authentication has resolved, which creates confusing permission errors.

**Recommended improvement:** replace prompts with consistent modal forms, preserve draft state, disable duplicate actions while pending, show success only after Firebase confirms, and give every critical action a traceable reference ID.

## Target architecture for a fast POS

The fastest practical design is not “more real-time listeners.” It is a **small, deliberate real-time hot path**.

### POS startup should load only

1. Active menu/catalog projection.
2. Availability projection.
3. Current shift and authorized cashier identity.
4. Minimal POS settings/payment methods.
5. Active orders plus the last 20–50 completed orders for this shift/register.

### Load only on demand

- Historical orders and archives.
- Analytics and P&L.
- Cash-flow ledger, AR/AP, payouts.
- Inventory batches, purchase history, usage history.
- Recipe editor and costing details.
- Excel libraries.

### Server should own

- Online price calculation and order creation.
- Finalization, COGS snapshot, and idempotent inventory movements.
- Completion timestamps and archival.
- Ledger/AR/AP posting.
- Refund/void/manager approvals.
- Payout settlement and variance postings.
- Notification outbox.

### Browser should own

- Fast cart interaction and provisional calculations.
- Local draft state.
- Display and printing.
- A durable offline command queue with clear pending/failed state.

## Recommended implementation order

### Phase 0 — emergency hardening (1–3 focused work sessions)

1. Escape customer-controlled output and constrain customer writes.
2. Remove public/legacy password hash paths and plaintext-PIN authority.
3. Verify no backups/private documents are publicly hosted.
4. Bind orders/customer records to auth UID.
5. Add strict size/schema limits to order proof and submission payloads.

### Phase 1 — remove the main lag multipliers

1. Move payment proofs to Storage and lazy-load them.
2. Create a single centralized Firebase subscription/store.
3. Use `/activeOrders` plus bounded recent/history queries.
4. Lazy-load non-POS modules and SheetJS.
5. Remove dead admin code from `index.html` and customer code from `admin.html`.
6. Move browser auto-reconciliation and completion stamping to functions.

### Phase 2 — make accounting/inventory trustworthy

1. Replace inventory finalization with independently idempotent movement posting.
2. Remove client deduction.
3. Make server-calculated prices/totals authoritative.
4. Make cash flow, AR/AP, payouts, refunds, and voids server-posted immutable events.
5. Add reconciliation reports that trace every balance to movement IDs.

### Phase 3 — controlled engineering and deployment

1. Establish Git, `public/`, `src/`, `functions/`, `tests/`, and private backup boundaries.
2. Add staging Firebase project and emulator tests.
3. Configure Hosting headers and unified CI deployment.
4. Add monitoring, performance telemetry, error reporting, and data-retention jobs.
5. Upgrade dependencies through staging.

## Performance acceptance targets

Measure these on the actual cashier device and normal PNG network—not only a desktop development machine:

| Metric | Target |
|---|---:|
| POS usable after warm launch | under 1.5 seconds |
| POS usable after cold launch on normal network | under 3 seconds |
| Add item / change quantity UI response | under 100 ms |
| Charge button acknowledgement | under 300 ms locally; visible pending state immediately |
| New order visible on another terminal | p95 under 1.5 seconds on stable network |
| Active-order initial payload | under 250 KB excluding lazily loaded proofs |
| Main-thread long tasks during checkout | none over 100 ms |
| Duplicate or missing inventory movements | zero in retry/failure tests |
| Unbounded lifetime-history reads on POS startup | zero |

Instrument `performance.mark` around startup, first catalog render, cart render, charge, Firebase acknowledgement, and remote-order arrival. Record payload bytes and listener callback durations. Without measurements, “real-time” is only a feeling.

## Positive controls already present

- Firebase Realtime Database region aligns with the operating geography (`asia-southeast1`).
- Node 22 is configured for functions.
- Order inventory deduction has an idempotency concept, even though the partial-failure implementation needs correction.
- COGS snapshots and on-duty stamping improve traceability.
- The application has strong domain coverage: shifts, denomination tracking, blind counts, platform reconciliation, inventory, recipes, internal usage, AR/AP, and cash flow.
- Current executable JavaScript passed syntax checking, and the rule file has valid JSON structure after removing Firebase-style comments.

These are good foundations. The next gains should come from reducing trust in the browser and reducing the amount of data/code involved in each sale—not from adding more fields to the monolith.

## Audit limitations

- This was a static/local project audit, not a penetration test against the live Firebase project.
- I did not write malicious records to production or attempt credential cracking.
- I did not run a live-device Lighthouse/network benchmark, because the local folder does not define the complete Hosting deployment and lacks the referenced PWA assets.
- The local backup is a snapshot, not proof of current production volume.
- Firebase's internal connection multiplexing can reduce duplicate network streams, but it does not eliminate duplicate callbacks, scans, state copies, or DOM work in this code.

