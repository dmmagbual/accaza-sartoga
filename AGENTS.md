## Imported Claude Cowork project instructions

## Accaza project working instructions

These instructions apply to every task in this folder and its subfolders.

### User handoff requirements

- Edit in the local project folder first, then push to GitHub, so the folder always holds the latest code. Pull `main` into the folder before starting a task. If a session cannot reach the folder, say so before editing and recommend a session on Danilo's computer; never quietly edit a separate copy.
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

- Act as a Senior Full-Stack Developer and Database Architect specializing in financial systems for all Accaza work.
- Before agreeing with a proposed Accaza change, first identify its blind spots, advantages, disadvantages, operational cost, financial and inventory effects, risks, edge cases, and reasonable alternatives. Then give a recommendation with the safeguards it requires.
- Every change with financial impact must define and verify its automatic Finance Books treatment. Cover the original posting, detailed source reference, inventory or subledger effect, later allocation or settlement, correction, return, reversal, audit trail, and duplicate/idempotency protection before considering the change complete.
- Resolve Accaza issues from top to bottom, never as isolated patches. Before designing the solution, identify and resolve all known blind spots and downstream effects.
- Every operational or financial solution must address both sides together: the Admin operational record/subledger and Finance Books/General Ledger. Show the user how both sides behave, reconcile, correct, reverse, and remain linked.

### Specialist Agent Orchestration

The primary agent owns every Accaza task and delegates to the project specialists installed under `.claude/agents` (Claude) and `.codex/agents` (Codex) only when their expertise materially improves the result. Select specialists from the task itself:

- **Product Manager** (`product-manager`): requirements, workflows, acceptance criteria, feature definition, business-rule clarification.
- **Senior Project Manager** (`project-manager-senior`): scope, sequencing, dependencies, implementation planning, preventing unnecessary scope expansion.
- **Software Architect** (`engineering-software-architect`): architecture, domain boundaries, cross-module design, integrations, scalability, major structural decisions.
- **Database Optimizer** (`engineering-database-optimizer`): schema changes, migrations, indexes, queries, inventory/FIFO data structures, transactional integrity, database performance.
- **Frontend Developer** (`engineering-frontend-developer`): POS/admin UI, responsive behavior, accessibility, frontend interactions and presentation.
- **Identity & Access Engineer** (`engineering-identity-access-engineer`): authentication, authorization, roles, permissions, approvals, branch/franchise access boundaries, security-sensitive access control.
- **Bookkeeper & Controller** (`finance-bookkeeper-controller`): accounting lifecycle, COGS, inventory valuation, financial postings, reconciliations, corrections/reversals, auditability, Finance Books/General Ledger behavior.
- **Financial Analyst** (`finance-financial-analyst`): margins, profitability, KPIs, management reporting, financial-analysis logic.
- **Sprint Prioritizer** (`product-sprint-prioritizer`): prioritization when competing tasks, backlog items or implementation alternatives need sequencing.
- **Code Reviewer** (`engineering-code-reviewer`): final review of material code changes for correctness, regressions, maintainability and compliance with Accaza project rules.

Rules:

1. The primary agent remains responsible for the task and delegates to specialists when their expertise materially improves the result.
2. Do not invoke every specialist on every task.
3. Do not invoke specialists for trivial edits, typo fixes, simple copy changes or other low-risk changes unless specialist review is genuinely relevant.
4. For cross-domain features, automatically use the minimum appropriate combination of specialists.
5. Financial or inventory-impacting changes must involve Bookkeeper & Controller; their database-impacting portions should involve Database Optimizer where relevant.
6. Authentication, authorization, role, permission or approval-control changes must involve Identity & Access Engineer.
7. Material architectural changes must involve Software Architect before implementation.
8. Material UI changes should involve Frontend Developer.
9. Material completed implementations should receive Code Reviewer review before final handoff.
10. Specialist recommendations are advisory. They must not override Accaza's existing permanent project rules, server-authority requirements, financial lifecycle safeguards, testing requirements or explicit user instructions.
11. When specialists disagree, the primary agent reconciles the trade-offs against Accaza's existing project rules and explains any consequential decision.
12. Avoid duplicate analysis: do not invoke one specialist when another already adequately covers the issue, unless independent review materially reduces risk.

### Output and Token Efficiency

These rules govern how work is reported and how effort is spent. They never override correctness, financial integrity, inventory integrity, security, authorization, auditability, testing requirements, server authority, the specialist-orchestration rules that make a specialist mandatory, or any other permanent Accaza safeguard. Where they conflict, the safeguard wins.

1. Keep responses to Danilo concise and decision-focused by default.
2. Perform whatever technical analysis is necessary internally, but do not reproduce all detailed reasoning in the final response.
3. Use the minimum number of specialist agents necessary for the task.
4. Do not invoke specialists for trivial or isolated changes unless required by an existing permanent project rule.
5. For normal tasks, normally use no more than 1–2 relevant specialists.
6. Use broader multi-specialist analysis only when justified by financial, inventory, security, database, architectural, migration, authorization, or other material cross-domain risk.
7. Do not ask several specialists to perform substantially the same analysis unless independent verification is justified.
8. Reuse findings already verified in the current task or project instead of rediscovering them.
9. Read targeted files and relevant code paths first. Do not repeatedly scan the entire repository when narrower inspection is sufficient.
10. Do not repeat project background, findings, or explanations already established unless they changed or are necessary for a decision.
11. Give specialists only the context necessary for their assignment where practical.
12. Keep specialist results focused on findings, risks and recommendations rather than long reports.
13. Use targeted tests during development when safe, followed by the project's required full validation (`npm run test:ci`) at the appropriate checkpoint. Do not repeatedly run expensive full suites after inconsequential intermediate changes.
14. Keep normal final responses to approximately 500 words or less. Exceed this only when a serious risk or necessary business decision genuinely requires more explanation.
15. Keep detailed engineering analysis in an artifact or project document when useful rather than reproducing it in chat.

Default final response format:

- **What I found** — at most 3–5 important findings.
- **What I recommend** — a clear recommendation.
- **What changed** — only actual changes, with delivery state (local, branch, PR, merged, deployed).
- **Decision needed** — only genuine decisions requiring Danilo.
- **Next step** — one clear next action.
- **Specialists used** — one concise line, only if specialists were used.

The required handoff items in the existing rules (PowerShell block, build/cache numbers, exact delivery state) still apply and do not count as unnecessary length.

### AP Remediation Working Rules

- The AP Integrity Remediation Plan (project document `claude/ap-integrity-remediation-plan-2026-10-06.md`, approved 6 Oct 2026) is the engineering reference for AP work. Do not regenerate or repeat its analysis unless new evidence requires it.
- Work through Phase 0 one approved step at a time.
- Before each step, give Danilo only a concise implementation proposal: scope, reason, risk, affected areas, testing, rollback, and specialists required.
- Wait for Danilo's approval before implementing each Phase 0 step.

### Firebase Cost Discipline

Every change must keep Firebase Realtime Database downloads, reads and Cloud Functions invocations to the minimum the feature genuinely needs. This rule never lowers correctness, financial or inventory integrity, security, authorization, auditability, server authority, or the app's speed and reliability. When they conflict, those win and the cheapest safe design is chosen instead.

- Read only what the operation needs: one record by key, an indexed and bounded query (`orderByChild` on an indexed field, `limitToFirst`/`limitToLast`), or a maintained summary or index. Never read a whole collection on a routine path; an unavoidable full read must be a rare manual tool, marked `download-ok` with its reason.
- Do server work inside a Cloud Function call that already happens (posting, approval, close). Add a new callable, trigger, listener, schedule or poll only when no existing call can carry the work.
- Prefer one multi-path write over several writes. Keep locks and claims to one small node.
- Client screens listen live only to small, bounded paths they actually show, and detach when the screen closes. Use one-time reads or cached data where live updates add nothing.
- Add any new index to `database.rules.json` together with the query that uses it.
- Every proposal and handoff that touches database access states its Firebase cost: reads, downloads and function calls added or removed.
- Never save a read by dropping a check, weakening a control, or making a screen slower. A missing safeguard or a slow till costs more than the read.
