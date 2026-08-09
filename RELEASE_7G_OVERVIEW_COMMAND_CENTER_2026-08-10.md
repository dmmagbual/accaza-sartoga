# Release 7G — Overview Command Center

**Build:** admin v173, customer v45, service-worker cache v62

## Delivered

- Rebuilt Overview around a service brief and immediate-attention queue.
- Reused the bounded Release 7B operational exception scan for critical and warning work.
- Added live active-order, reservation, register-shift, and offline-queue signals.
- Added concise sales, payment-verification, inventory-exception, and system-health summaries.
- Added direct, allow-listed routes from each signal to the existing controlled workspace.
- Kept existing dashboard periods, trends, payment mix, best sellers, and status analytics as supporting detail.
- Added responsive layouts, keyboard focus compatibility, sanitization, and offline precaching.
- Extended the register to the usable viewport, compacted its vertical rhythm, collapsed inactive checkout controls on an empty ticket, and condensed denomination entry to reduce nested scrolling.
- Repaired active-order cards with a contained action grid, separated payment summary, unambiguous status language, and proof warnings only while verification is pending.

## Safety boundary

Release 7G adds no Firebase node, database listener, Cloud Function, financial formula, inventory calculation, or permission. It reads existing authorized UI state and the existing `getOperationalExceptions` callable. Failure or denial of the management scan does not expose data and does not prevent the remaining overview signals from rendering.

## Coordinated publication

Publish every authoritative file in `release-manifest.json`. The 7G-specific files are `admin.html`, `sw.js`, `release-manifest.json`, `assets/css/admin-backoffice.css`, `assets/js/admin/overview-command.mjs`, `assets/js/admin/workspace-shell.mjs`, `assets/js/admin/telemetry.js`, the updated tests, `ADR-025_OVERVIEW_COMMAND_CENTER.md`, this release note, the roadmap, and both handoff documents.

Because Releases 7C–7F are not yet production-verified, publish the complete coordinated source set rather than mixing individual files from older builds.

## Production smoke test

1. Sign in as owner/admin/manager and confirm Overview shows build v173 and the command center.
2. Confirm the service brief, work queue, active orders, reservations, register, and offline queue render without blocking.
3. Open every command-center shortcut and confirm it reaches the intended authorized workspace.
4. Confirm a user without management exception access sees no protected exception detail.
5. Create or use a pending test order and confirm the Overview attention count and Orders shortcut update.
6. Confirm existing sales totals and supporting charts still match their prior dashboard sources.
7. Test desktop, tablet, and narrow mobile layouts, then hard-refresh once to activate cache v62.
8. Complete one normal sale and confirm order, inventory, and financial behavior is unchanged.

## Firebase deployment

No new Function or rule is introduced by 7G. The previously pending Release 7B Database query indexes still require `firebase deploy --only database` after the GitHub quality gate passes.
