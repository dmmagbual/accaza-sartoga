# Accaza Coffee Shop — Current Claude Handover

**Updated:** 21 August 2026

**Project:** `accaza-sartoga`

**Workspace:** `C:\AKALIKO\DMM\PERSONAL\CLAUDE\Projects\Accaza Coffee Shop`

**Production:** <https://accazacoffee.com>

**Repository:** <https://github.com/dmmagbual/accaza-sartoga>

## Start Here

This document is the current continuation point. The older `CLAUDE_HANDOFF.md` is useful architecture background but contains stale build and deployment details. Trust the current source, `release-manifest.json`, GitHub, and Firebase over older release notes.

Before changing anything:

```powershell
Set-Location -LiteralPath "C:\AKALIKO\DMM\PERSONAL\CLAUDE\Projects\Accaza Coffee Shop"
git fetch origin --prune
git status --short
git log -5 --oneline --decorate
npm test
npm run test:release
npm run test:safety
```

Read `AGENTS.md` before working. It contains mandatory build, testing, GitHub, deployment, and handoff rules.

## Current Delivery State

- Latest merged PR: [#49 — Redesign purchases as a unified receiving sheet](https://github.com/dmmagbual/accaza-sartoga/pull/49)
- PR #49 merge commit on `main`: `448b85d4fe01b1235495bed10b834390dca0abe8`
- PR #49 GitHub quality gate: passed.
- PR #49 GitHub Pages deployment: passed. The Purchases redesign is live.
- Previous merged PR: [#48 — Configurable payment verification policies](https://github.com/dmmagbual/accaza-sartoga/pull/48)
- PR #48 quality gate, GitHub Pages deployment, and Firebase Functions/rules deployment: passed.
- No pull request is currently awaiting work from this handover.
- Local branch at handover time: `codex/recover-pos-storage-quota` at `79095b2`. It predates the PR #49 merge commit. Fetch and start new work from current `origin/main`; do not assume the old branch is current.

## Current Builds

- Admin application: **v238**
- Customer application: **v57**
- Service-worker cache: **v140**
- Release manifest line: **7M**
- Firebase Functions runtime: Node.js 22, `asia-southeast1`

For an admin-facing change, increment and synchronize:

1. `admin.html` meta `accaza-admin-build`
2. visible `build v...` label in `admin.html`
3. `release-manifest.json` → `builds.admin`

For a frontend or cached-asset change, also increment and synchronize:

1. `sw.js` → `const CACHE='accaza-v...'`
2. `release-manifest.json` → `builds.serviceWorkerCache`

Only increment the customer build when the customer application changes.

## Most Recent Product Changes

### Purchases — live in v238/cache v140

The Goods Received entry was redesigned as one unified supplier-invoice card in:

- `assets/js/admin/pos.js`
- `assets/css/admin-backoffice.css`
- `admin.html`
- `sw.js`
- `release-manifest.json`

The receiving workflow now has four visually connected parts:

1. Delivery details
2. Whole-invoice payment choice
3. Numbered stock-item lines
4. Invoice total and `Receive stock` action

Payment choices remain financially explicit:

- `Invoice pending — provisional obligation`
- `Paid now` from a Cash Flow account
- `On account` with a due date

Correction, reversal, and payable-repair tools are now secondary controls inside a collapsible section. Existing posting, inventory, weighted-average cost, payable, and correction behavior was not changed.

If Danilo asks for further Purchases work, begin at `renderPurchases()` in `assets/js/admin/pos.js` and the `Purchases — one receiving sheet` block in `assets/css/admin-backoffice.css`. Test desktop and narrow/mobile layouts, keyboard focus, adding/removing lines, all three payment modes, total updates, and `Receive stock` validation.

### Payment verification — live in v237/cache v139 and Firebase

POS Settings supports only these two policies for GCash, Maya, bank, and other direct online payments:

- Cashier verification followed by manager review
- Manager-only verification

There is deliberately no cashier-final-verification option. GrabFood and FoodPanda remain platform-settlement flows.

Authority is enforced in both the frontend and Cloud Functions. Key files:

- `functions/lib/payment-verification.js`
- `functions/lib/offline-sync.js`
- `functions/index.js`
- `assets/js/admin/register.js`
- `assets/js/admin/pos.js`
- `assets/js/admin/admin-orders.mjs`
- `assets/css/admin-backoffice.css`

Do not weaken the server-side verification checks while changing labels or UI.

### Recent POS reliability/UI fixes

- The Transaction Sync Queue button is clickable even when empty and reports `Nothing to sync`.
- Synced queue records are pruned so the list does not grow forever.
- Sync is automatic; the retry control is a recovery action, not a normal required step.
- The receipt no longer exposes Firebase confirmation wording to customers.
- Durable sale failures distinguish browser/device quota problems from Firebase failures. `QuotaExceededError` is local browser storage pressure, not Firebase Storage quota.
- Reversed purchases are hidden from Purchase history by default but remain available in the audit trail.
- Completed active-order cards use a compact layout rather than leaving large blank areas.

Inspect the current code and tests before assuming the exact implementation details of these fixes.

## Architecture and Deployment Truth

- Static frontend hosting is GitHub Pages. This repository has no Firebase Hosting target.
- Frontend changes become live after merge to `main` and successful Pages deployment.
- Firebase Functions and rules deploy through the repository workflow after relevant changes merge to `main`.
- Never advise `firebase deploy --only hosting` for this project.
- If a manual Functions deployment is genuinely required, use:

```powershell
firebase deploy --only "functions" --project "accaza-sartoga"
```

- `/orders` is authoritative; `/activeOrders` is the bounded live projection.
- Inventory movements, weighted-average costing, protected financial movements, approvals, and offline replay are server-authoritative and idempotent.
- Firebase Realtime Database is the operational data store. Private payment-proof images use Firebase Storage through authorized Functions.
- The offline POS queue uses IndexedDB. A sale must not be called synced until Firebase confirms it.

## Required Verification

For normal application changes, run at minimum:

```powershell
npm test
npm run test:release
npm run test:safety
```

The last local run passed all three. `test:release` still reports these existing pending production-evidence items:

- `productionPerformanceReview`
- `backupRestoreTest`
- `quarterlyPermissionReview`
- `quarterlyDependencyReview`

Do not describe those evidence items as complete without real proof.

## Working-Tree Safety

At handover time the workspace also contains an unrelated modified `.gitignore` and many unrelated untracked ADR, release, setup, and helper files. They belong to the user. Preserve them and stage only files for the current task.

Never use broad cleanup, reset, checkout, or deletion commands. Never stage everything for a scoped task.

## GitHub Workflow

When Danilo says `push it`:

1. Commit only the current task files.
2. Fetch and ensure the branch is current with `main`.
3. Push the working branch.
4. Create a new PR if the preceding PR is merged or closed.
5. Confirm the pushed commit appears in the open PR.
6. Wait for and report the GitHub quality gate.
7. Do not merge unless Danilo explicitly asks.

Always give the clickable PR link and distinguish local, pushed, PR-open, merged, and deployed states.

## Recommended Next Action for Claude

There is no unfinished code change. Start by asking Danilo what he wants to improve next, or review the live Purchases page with him after a hard refresh (`Ctrl + Shift + R`) and confirm the visible admin build is v238.

If he reports a defect, reproduce and diagnose it before editing. Preserve financial and inventory behavior while changing presentation. Discuss materially different business-policy choices before implementing them.
