# Books Chart of Accounts — Server Authority & Free Account Creation

Status: BUILT 2026-08-27 (awaiting your local test:ci + deploy). Managers: danilomagbual@gmail.com + contact.mariadaniela@gmail.com.
Date: 2026-08-27

## What was built
- functions/index.js: /booksChart server node seeded from the canonical chart (also fixes latent codes 1050/1190/2030 that the old whitelist rejected); ensureBooksChart(); manageBooksAccount callable (upsert/deactivate/reactivate/import, idempotent, operationalAudit, deactivate-not-delete, system accounts protected); requireBooksChartManager gate reading /config/booksChartManagers (seeded with the two emails); booksCodeAccount now validates against /booksChart with the old hardcoded Set kept as fallback; manual_journal sensitivity now derived from a per-account flag (frozen regex kept as fallback).
- database.rules.json: /booksChart admin-readable, server-only write. /config/booksChartManagers stays under the default deny-all (server-only).
- books.html: subscribes to /booksChart and drives DB.accounts from it; Add/Edit/Deactivate/Reactivate call manageBooksAccount when signed in (localStorage only when offline); Add/Import controls gated to the two managers; one-time "Import local accounts" with dry-run preview + conflict flags; inactive accounts hidden from the posting dropdown, still shown in reports.
- Verified: node --check on functions + both books.html inline scripts; npm test (static-check), test:release, test:safety all PASS. test:rules (emulator) + test:e2e (Playwright) still to run in your CI.

## Original plan follows (for reference)

## The problem (why 2310 got rejected)

Your books app keeps **two charts of accounts that nobody syncs**:

- **Client chart** — lives in your browser's `localStorage` under key `accaza_books_v1`
  (`books.html:211`, saved at `books.html:301`). Seeded by `defaultAccounts()`
  (`books.html:215`) + force-topped-up by `migrate()` (`books.html:263`), plus
  anything you add via **Add account** (`App.saveAccount`, ~`books.html:955`) — which
  writes localStorage only, never the server. The journal dropdown is built from this
  list (`books.html:425`).
- **Server gate** — when you post a journal, `books.html:1031` calls the
  `postFinancialCommand` callable (region `asia-southeast1`). Inside its
  `manual_journal` branch, every line runs through `booksCodeAccount`
  (`functions/index.js:1427`), which checks the code against a **hardcoded whitelist
  Set** (`functions/index.js:1430`). If the code isn't in that Set → rejected.

So creating an account always *looks* like it worked (it's just a localStorage push),
but posting to it fails until a developer edits the server Set and redeploys. Two lists,
maintained by hand, guaranteed to drift.

## Definition of done

1. You add an account in the UI and can **post to it immediately** — no code change, no deploy.
2. Every transaction linked to it (journal, reports, reversals) resolves correctly.
3. The account and its postings appear **on any browser / device**, not just the one you created it on.
4. The server still enforces an **approved chart** — no junk codes, no fat-finger `9999`.
   Server authority over financial postings is preserved, per project rules.

## Blind spot to fix, or drift comes straight back

There are **three** hardcoded code lists on the server, not one. A real fix must
address all three or the problem returns under a new symptom:

1. `booksCodeAccount` allowed **Set** (`functions/index.js:1430`) — the gate we just patched for 2310/2320.
2. The **sensitive-codes regex** inside `manual_journal` (`functions/index.js` ~:1800) —
   codes that require a source reference + privileged Finance role.
3. **Cash-code special mappings** (`1000/1005/1030/1040`, plus `1010–1020` cash-account
   linkage) — these are real behaviour, not drift, and must be preserved exactly.

Lists 1 and 2 must become **data driven from the stored chart**. List 3 stays as code.

## Target architecture

- **`/booksChart/{code}`** RTDB node = the single source of truth:
  `{code, name, type, active, system, sensitive, createdAt, createdBy}`.
  Server-owned. Direct client writes denied by rules; only a Cloud Function writes it.
- **New callable `manageBooksAccount`** (add / edit / deactivate), gated to a **named
  allowlist** (`danilomagbual@gmail.com`, `contact.mariadaniela@gmail.com`) — see Decisions below.
  Enforces server-side: valid 4-digit code, no duplicate, not a protected rollup/main
  code, valid type, code immutable once created, and **deactivate-not-delete** for any
  account that already has posted movements (protects the audit trail). Replaces the
  client-only `saveAccount`.
- **`booksCodeAccount` rewritten** to validate against `/booksChart` (code exists AND
  `active`) instead of the frozen Set — while keeping every cash-code mapping and the
  main-account rejection unchanged (4-digit rule already rejects 3-digit rollups like `125`).
- **Sensitive determination** reads a `sensitive` flag on the stored account, not the regex.
- **`books.html` reads the chart from `/booksChart`**; `saveAccount`/`deleteAccount` call
  the new callable. Rollup groupings (`isMainAccount`, `books.html:311`) stay client-side
  for display.

## Phased build (each phase is independently deployable + reversible)

**Phase 0 — verification spike (no deploy).**
Confirm three things before writing anything: (a) whether `books.html` `DB.entries`
(localStorage) is authoritative or just a mirror of server `financialMovements` — if
entries are ever read authoritatively from localStorage, that's a separate follow-up;
(b) enumerate every consumer of the three hardcoded lists so nothing else validates the
chart; (c) confirm no other callable posts books journals besides `postFinancialCommand`.

**Phase 1 — server chart, seeded, with the old Set kept as fallback.**
Add `/booksChart` + `manageBooksAccount` + rules. Seed `/booksChart` from the canonical
code-defined set (`defaultAccounts` + `migrate` `need[]` list) — these are known and safe.
Old Set stays in place. Deploy functions + rules. Nothing changes for users yet.

**Phase 2 — poster validates against the chart (Set as fallback only).**
Rewrite `booksCodeAccount` to accept any code that's present + active in `/booksChart`;
if `/booksChart` is empty/unreadable it falls back to the old Set (safety net — a bad
migration can't brick posting). Derive `sensitive` from the chart. Deploy functions.

**Phase 3 — client reads the chart from the server + one-time import.**
`books.html` loads the chart from `/booksChart`; `saveAccount`→`manageBooksAccount`.
Ship the migration importer below. Deploy frontend (Pages).

**Phase 4 — verify DoD across two browsers, then retire the hardcoded Set.**
Only after `/booksChart` is confirmed populated and stable do we delete the fallback Set.

## Migration — the risky part, with a dry run

Your chart is per-browser localStorage, so different machines may hold different custom
accounts (2310 "Loan 2" exists only where you created it). Plan:

1. **Seed from canonical set first** — the code-defined accounts are authoritative and go
   in server-side with `system:true`. No user input needed.
2. **Import custom accounts with a dry run.** A one-time "Import my local chart" action
   reads this browser's localStorage, finds any **non-system** accounts (your Loan 2,
   Loan 3, anything else you added), and **shows you a list of exactly what it would
   import** — code, name, type — plus **conflicts** (same code with a different name on a
   different browser). Nothing is written until you approve. You can edit names/types at
   approval time.
3. **After approval**, approved accounts are written to `/booksChart` via
   `manageBooksAccount` (so they pass the same validation as any new account), and
   localStorage becomes a read-through cache, no longer the source of truth.
4. **Repeat the import once per browser** you've used books on, so no custom account is
   stranded. The dry run makes this safe to run repeatedly — re-running just shows
   "already imported."

## Finance Books treatment & safeguards

- **Adding/editing an account is a control-plane change, not a posting** — no debit/credit,
  but it's logged to `operationalAudit` (who, what, when, old→new). Idempotent via a
  `commandId` so a double-click never creates duplicates. Codes are immutable once created.
- **Posting to a new custom account** behaves exactly like today: `booksCodeAccount`
  returns `coa:<code>`, it posts as an ordinary GL line in a balanced, immutable journal,
  reference/role rules follow the `sensitive` flag, reversal uses the existing
  `reverse_manual_journal` path, idempotency via `commandId`. No inventory/cash subledger
  effect for non-cash accounts.
- **Deactivate, never delete** any account with posted history — the audit trail stays intact.
- **Fallback Set retained through Phase 3** — the new gate has to prove itself before the
  old one is removed.

## Deploy set (when built)

- `functions/index.js` — poster rewrite + `manageBooksAccount` — **Cloud Functions (Actions workflow)**
- `database.rules.json` — `/booksChart` node rules — **Actions workflow (rules)**
- `books.html` — read chart from server, `saveAccount`→callable, importer — **Pages (frontend)**

Rules + functions deploy together; frontend after. `npm run test:ci` before and after.
Commit by filename, never `git add -A`.

## Decisions

1. **Who can create/edit accounts — RESOLVED (2026-08-27): a named allowlist of two —**
   `danilomagbual@gmail.com` and `contact.mariadaniela@gmail.com`. `manageBooksAccount`
   checks the authenticated caller against this list and rejects everyone else, whatever
   their role. Each is pinned to its **Firebase Auth UID** (canonical, can't be spoofed),
   resolved from the email at build time, email kept as a human-readable label. The list
   lives in a server config node (`/config/booksChartManagers`), **not hardcoded** — so
   adding or removing a person later is a data change, no redeploy. (Both accounts already exist as Firebase Auth users — confirmed 2026-08-27 — so both UIDs are resolvable at build time.) Posting journals
   keeps its existing role gate; only *managing the chart* is restricted to these two.

## Open questions for you

2. When you deactivate an account with history, hide it from the dropdown but keep it in
   reports? (My default: yes — hidden for new postings, still shown where it has balances.)
3. Any code-numbering rules you want enforced (e.g., 2xxx = liabilities only)? Right now
   any 4-digit code + type combo is allowed.
