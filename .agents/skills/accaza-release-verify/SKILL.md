---
name: accaza-release-verify
description: Use for Accaza code or configuration handoff, verification, task commits, push requests, pull requests, merges, deployments, or production release checks.
---

# Accaza release verification

Apply current root GitHub and handoff rules. Recognize prior explicit authorization, but do not infer permission to push/publish or merge from an implementation request. Verify branch, remote and PR state before release claims.

1. Inspect `git status`, current branch, attached/active worktrees and current remote `main`. Update safely before task work; preserve unrelated changes. Prefer a suitable existing checkout/worktree. Use the approved Superpowers worktree procedure when required by the task plan.
2. Identify exact task files and editing sources. Rebuild generated application artifacts with `npm run build:artifacts` when applicable. Check tracked gitlinks/worktree paths before a Pages release.
3. Run targeted checks, then required application gates: `npm test`, `npm run test:release`, `npm run test:safety`; use `npm run test:ci` at the required checkpoint, including rules/e2e where applicable. Documentation-only skills require structural/reference validation and proportionate repository checks; report full gates skipped explicitly. Resolve failures or report the remaining blocker honestly.
4. For application changes synchronize relevant source/generated visible builds and manifest. Admin meta/visible label and `builds.admin` agree; cached frontend changes synchronize `sw.js` and `builds.serviceWorkerCache`; customer/Books changes update their own markers. Read current numbers, never copy historical ones. Documentation-only changes do not bump application builds/cache.
5. Obtain Code Reviewer review for material implementations. Stage only named task files when committing. On "push it", commit/push the branch, create a new PR if the prior PR closed/merged, verify the commit in the open PR, and update safely against `main` with relevant checks. Attach created PRs to the chat when supported. Merge only with explicit authorization.
6. Static frontend deployment is GitHub Pages after `main` merge. Firebase Functions/rules use repository workflows. Manual Functions deployment, only if needed and authorized: `firebase deploy --only "functions" --project "accaza-sartoga"`. This repository has no Firebase Hosting target.
7. Load `accaza-pos-live-safety` for any release that can affect the till, including shared assets, server commands, rules or auth. Unresolved POS regressions block the affected release. Apply `accaza-firebase-cost-review` when a change can affect a Firebase billing meter. Record its workload-normalized RTDB/Firestore/Functions baseline and rollback threshold, and block unexplained cost regressions. For Firebase changes that cannot affect reads, downloads, invocations, execution or scaling, state the verified no-cost-change basis instead. Verify deployment/runtime separately from local tests and preserve pending production evidence until proved; do not disrupt an active till for verification.

Handoff includes delivery state, exact task commands in a PowerShell block starting with the root project-folder command, final build/cache numbers, and `Ctrl + Shift + R` after frontend deployment when safe. Never imply local, pushed, PR, merged, deployed and live-verified are interchangeable.
