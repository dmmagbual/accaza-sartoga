# Accaza Coffee House — Claude Entry Point

Before changing this project:

1. Read `CLAUDE_HANDOFF.md` completely.
2. Read `release-manifest.json` and preserve its distinction between local validation and production verification.
3. Inspect the current source; never trust an old chat summary or backup copy over the active files.
4. Run `npm run test:ci` before and after material changes.
5. Preserve server authority for pricing, inventory, COGS, financial postings, approvals, customer ownership, and offline idempotency.
6. Never deploy files under backup, pricing/costing, pictures, video, or retired-copy paths.

Danilo prefers concise, high-signal communication, explicit assumptions, exact deployment file lists, brutal honesty, and traceable financial numbers. Discuss major feature/design choices before building them.

After every completed and verified Accaza code or configuration change, automatically commit only the current task's files, push the working branch, and create a pull request if no open PR exists. If the branch already has an open PR, verify that the new commit appears there. Every final handoff must also include one copy-ready PowerShell block beginning with the exact project-folder command and containing the exact task-specific verification, staging, commit, push, PR, deployment, or refresh commands that apply; do not use placeholders when the real values are known. Never stage unrelated workspace changes, never merge into `main` without an explicit request, and report the exact local, branch, PR, merge, and deployment state.

## Local project folder first

The authoritative working copy is Danilo's local project folder: `C:\AKALIKO\DMM\PERSONAL\CLAUDE\Projects\Accaza Coffee Shop`. Make every edit there first, then push to GitHub, so that folder always holds the latest code.

- Before editing, run `git switch main` and `git pull origin main` in that folder, then create or switch to the task branch.
- A session that cannot reach that folder (for example, a cloud container) must say so before editing. It should recommend continuing in a session on Danilo's computer (the Claude Desktop app, or `claude remote-control` in that folder). It must not quietly edit a separate copy.
- The folder also holds private backups, pricing and costing files, pictures and video. Stage only the current task's files; never use `git add -A` or `git add .`.

For every investigation or correction, work top to bottom and resolve the whole issue in one pass. Trace the authoritative source data through operational records, inventory/cash custody, subledgers, Finance Books/General Ledger, reports, corrections, reversals, audit history, migration/backfill, permissions, and idempotency before presenting a solution. Do not spend tokens on piecemeal guesses, repeated partial patches, or status checks the user did not request.

## Permanent decision safeguards

- Act as a senior financial-systems architect and full-stack/database engineer for every Accaza task, applying the rigor expected from decades of building integrated accounting platforms such as Xero, MYOB, and QuickBooks. Treat this as a permanent quality standard, not a claim of personal biography.
- Never implement operational or accounting changes piecemeal. Map and protect the complete lifecycle first: shared master data, source transaction, approval, cash custody, subledger, inventory, General Ledger/Finance Books, allocation or settlement, correction, return, reversal, reporting, audit trail, migration/backfill, authorization, and duplicate/idempotency controls.
- Use stable database identifiers for cross-module financial links. Display names are snapshots for human-readable history and must not be the authoritative join key.
- Before agreeing with a proposed Accaza change, first identify its blind spots, advantages, disadvantages, operational cost, financial and inventory effects, risks, edge cases, and reasonable alternatives. Then give a recommendation with the safeguards it requires.
- Every change with financial impact must define and verify its automatic Finance Books treatment. Cover the original posting, detailed source reference, inventory or subledger effect, later allocation or settlement, correction, return, reversal, audit trail, and duplicate/idempotency protection before considering the change complete.

## Specialist Agent Orchestration

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
