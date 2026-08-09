# Release 7D — Contextual Workspaces and Focused POS

Release 7D completes the admin-panel decluttering started in 7C.

## What changed

- Added a clear area name, page title, short task description, and relevant shortcut above every admin workspace.
- Added a live service strip for connection, portal role, open shift, and offline transaction queue.
- Made POS the focused operational canvas on desktop, with more usable width, a bounded cart, and a sticky Charge action.
- Kept mobile POS in normal page flow to avoid nested scrolling and trapped controls.
- Extracted shared workspace behavior to `assets/js/admin/workspace-shell.mjs` so `core.mjs` stays below its 125 KB guard.

## Behavior intentionally unchanged

Authentication, permissions, Firebase reads/writes, server pricing, inventory posting, financial posting, offline transaction durability, and role-aware landing behavior are unchanged.

## Coordinated upload set

Upload the authoritative files from `release-manifest.json`. The minimum Release 7D UI set includes `admin.html`, `sw.js`, `release-manifest.json`, `assets/js/admin/core.mjs`, `assets/js/admin/workspace-shell.mjs`, `assets/js/admin/pos.js`, `assets/js/admin/telemetry.js`, and the updated tests and release documents. Include `database.rules.json` because the pending Release 7B query indexes are still required in production.

## Verification

Run `npm run test:ci`. After GitHub Pages publishes, sign in as cashier, kitchen, finance, and management; confirm the correct landing workspace and permissions. In POS, open a shift, confirm all four service indicators, build a long cart, complete one cash test sale, and verify mobile checkout remains reachable.
