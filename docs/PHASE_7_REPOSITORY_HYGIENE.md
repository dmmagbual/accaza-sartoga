# Phase 7 repository and legacy-runtime hygiene

## Outcome

Phase 7 removes the tracked `index-pos.html` historical monolith. The file was not referenced by the current application or release tooling, but static whole-repository publication could expose it at a separate URL. Its customer, Admin, POS, inventory, and authentication implementations were obsolete and conflicted with current server-authoritative controls.

The active sources remain:

- Customer: `src/html/customer/` and `src/customer/core/`, assembled into `index.html` and `assets/js/customer/core.mjs`.
- Admin shell: `src/html/admin/`, assembled into `admin.html`.
- POS and Admin operations: ordered sections under `src/admin/`, assembled into `assets/js/admin/` bundles.
- Finance Books: `books.html` plus `src/books/app/`, assembled into `assets/js/books/app.js`.
- Cloud Functions: `src/functions/`, assembled into `functions/index.js`.

## Safety decision

The retired file is recoverable from Git history and `backup/phase7-pre-legacy-hygiene-20260830`; it does not need to remain in the deployable repository. `npm run test:safety` now rejects tracked retired runtime copies and verifies that their ignore rules remain present.

Ignored local files such as `admin-backup.html` and `index backup*.html` are not deleted by Phase 7. They remain private local references and must never be deployed or treated as authoritative source.

## Operational and financial impact

There is no change to the active customer site, Admin/POS, Finance Books, Firebase Functions, security rules, database schema, inventory movements, COGS, sales posting, cash custody, settlement, corrections, returns, reversals, audit evidence, or idempotency claims. Phase 7 removes only an unreferenced legacy client that contained outdated direct-write workflows.

No application build number or service-worker cache increment is required because no active or cached application asset changes. The deletion takes effect only after this branch is merged and GitHub Pages publishes the new repository state.
