## Imported Claude Cowork project instructions

## Accaza project working instructions

These instructions apply to every task in this folder and its subfolders.

### User handoff requirements

- After every code or configuration change, always provide a copy-ready PowerShell block.
- Start the block with the exact project-folder command:

```powershell
Set-Location -LiteralPath "C:\AKALIKO\DMM\PERSONAL\CLAUDE\Projects\Accaza Coffee Shop"
```

- Include the exact verification, commit, push, deployment, or refresh commands that apply to the completed work. Do not give generic placeholders when the real command is known.
- Explain clearly whether the work is only local, pushed to a branch, in a pull request, merged, or deployed. These states must not be described as interchangeable.

### Build and cache versions

- Never forget the visible build version when changing the application.
- For admin-facing changes, increment the admin build and keep these locations synchronized:
  - `admin.html` meta tag `accaza-admin-build`
  - the visible `build v...` label in `admin.html`
  - `release-manifest.json` → `builds.admin`
- When a frontend file or cached application asset changes, increment the service-worker cache and keep these synchronized:
  - `sw.js` → `const CACHE='accaza-v...'`
  - `release-manifest.json` → `builds.serviceWorkerCache`
- Increment the customer build only when the customer application changes, and keep its visible marker and release manifest synchronized.
- State the final build and cache numbers in the handoff.

### Required verification

- Run the checks relevant to the change. For normal application changes, run at minimum:

```powershell
npm test
npm run test:release
npm run test:safety
```

- Report failures honestly and fix regressions before presenting work as complete.
- Preserve unrelated modified and untracked files. Stage only the files belonging to the current task.

### GitHub workflow

- Do not push merely because files were changed. Push only when the user asks to push or publish.
- When the user says **push it**, this means:
  1. commit only the current task's files;
  2. push the working branch;
  3. create a pull request automatically if no open PR exists;
  4. if an open PR exists, confirm the new commit appears in that PR;
  5. if the previous PR was already merged or closed, create a new PR for the remaining commits rather than claiming the old PR was updated;
  6. check whether the PR branch is behind `main`, update it when safe, and rerun/confirm checks.
- Always return the clickable pull-request link after creating or updating a PR.
- Do not merge into `main` unless the user explicitly asks for the merge.
- Before telling the user there is nothing left to push, verify the local branch, remote branch, PR state, and latest commit.

### Deployment model

- Static files are published through GitHub Pages after merging to `main`; this project does not have a Firebase Hosting target.
- Firebase Functions and rules deploy through the repository workflow after relevant changes are merged to `main`.
- If a manual Functions deployment is genuinely needed, use the PowerShell-safe form:

```powershell
firebase deploy --only "functions" --project "accaza-sartoga"
```

- Never give `firebase deploy --only hosting` for this repository.
- After a frontend deployment, remind the user to refresh with `Ctrl + Shift + R` and verify the visible build number.

### Communication preferences

- Lead with what changed and the current delivery state.
- Use plain, non-technical language unless technical detail is necessary.
- When reviewing totals or financial reports, make every subtotal and total explicit and identify whether values are cash, non-cash, receivable, retained float, variance, or cash to settle.

### Permanent decision safeguards

- Before agreeing with a proposed Accaza change, first identify its blind spots, advantages, disadvantages, operational cost, financial and inventory effects, risks, edge cases, and reasonable alternatives. Then give a recommendation with the safeguards it requires.
- Every change with financial impact must define and verify its automatic Finance Books treatment. Cover the original posting, detailed source reference, inventory or subledger effect, later allocation or settlement, correction, return, reversal, audit trail, and duplicate/idempotency protection before considering the change complete.
- Resolve Accaza issues from top to bottom, never as isolated patches. Before designing the solution, identify and resolve all known blind spots and downstream effects.
- Every operational or financial solution must address both sides together: the Admin operational record/subledger and Finance Books/General Ledger. Show the user how both sides behave, reconcile, correct, reverse, and remain linked.
