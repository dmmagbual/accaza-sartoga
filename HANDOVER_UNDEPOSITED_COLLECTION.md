# Handover — Undeposited Collection pool (Accaza POS / Finance)

Prepared for the next assistant picking up this repo. Written 2026-08-26. Everything below is current as of PR #134.

## Status right now
- Branch `claude/undeposited-collection-pool`, commit `1deb8c7`, 8 files. Pushed to `origin`.
- **PR #134** open against `main`: https://github.com/dmmagbual/accaza-sartoga/pull/134 — Danilo is merging it.
- On merge: the GitHub Action **"Deploy Firebase Functions & Rules"** runs `npm run test:ci` as a gate, then `firebase deploy` for functions + rules. Frontend (admin.html, assets/**) ships via GitHub Pages on push to `main`. Repo is `dmmagbual/accaza-sartoga` (public), Firebase project `accaza-sartoga`, region `asia-southeast1`.
- **One manual step after deploy:** open the POS admin portal → **Undeposited Collection** tab → click **Retire & fold in** once. This runs the `retireRevolvingFund` callable to move the live Revolving Fund balance into the pool. It is idempotent and reversible with a standard reversing JE.

## What this change does (the goal)
Consolidate cash handling into one pool. The register drawer is sales-intake only; at shift close the whole turnover already moves to Undeposited Collection. Every cash payment (operating expenses and supplier payments) is now drawn from Undeposited Collection instead of a separate Revolving Fund (petty cash) imprest, and the Revolving Fund is retired. Supplier payments feed the existing Purchases "allocate to inventory" workflow unchanged.

## Account model
- `asset:cash_awaiting_deposit` = books chart account **1030**, renamed in this PR from "Undeposited Funds" to **"Undeposited Collection"**. This is the pool.
- `asset:petty_cash` = the Revolving Fund imprest, being retired (folded into the pool).
- `asset:purchase_cash_advance:{id}` = a supplier payment awaiting inventory allocation (unchanged).
- `/cashCustody` = per-shift subledger of cash awaiting deposit; server-written only.

## The reconciliation invariant (the core correctness property)
At all times: **`cash_awaiting_deposit` GL balance == Σ `cashCustody[*].remaining`.**

Every event that moves the pool also adjusts custody:
- shift close: +custody record (existing, `onShiftCloseFinancial`)
- bank deposit: −FIFO (existing, `postFinancialCommand` action `cash_deposit`)
- cash payment (expense / supplier advance): −FIFO (NEW, `poolCustodyOutflow`)
- voucher void: +custody record for the returned cash (NEW)
- Revolving Fund retirement: +custody record for the folded amount (NEW)
- opening-float draw: REMOVED (float stays in the drawer)

Because payments draw custody down FIFO, the Sunday deposit screen is unchanged: "deposit all remaining" banks exactly `turnovers − payments`. Proven by a standalone accounting simulation (pool GL == custody and trial balance balanced after every step). Ask Danilo for `sim.js` if you want to re-run it.

## Files changed (8)

### functions/index.js (Cloud Functions)
- `onPettyVoucherFinancial` trigger: on approve, credit leg repointed `asset:petty_cash` → `asset:cash_awaiting_deposit`, and it calls `poolCustodyOutflow(db, value)` to draw custody down FIFO (passed as `commitFinancial` extraWrites, so it's idempotent — the movement id guards the writes). On void, it debits `cash_awaiting_deposit` back and creates a fresh custody record via `poolCustodyInflowRecord` (cash returns to the pool).
- `backfillPettyVoucher`: account repointed only (NO custody writes — custody is live state, not rebuilt during a ledger reconstruction).
- `managePettyVoucher` return path: repointed + custody inflow record.
- `managePettyVoucher` available-funds check: was `openingBalance + Σreplenishments − Σdisbursed`; now `available = Σ cashCustody.remaining` (the live pool balance), no disbursed subtraction (custody already nets out disbursements).
- `onShiftOpenFinancial`: NO-OP now (opening float stays in the drawer; this also removed the old custody-drain bug).
- `onShiftPayOutsFinancial`: NO-OP now (the drawer never funds payments). Historical drawer pay-outs already posted and are idempotent, so they're untouched.
- NEW helpers near `commitFinancial`: `poolCustodyOutflow(db, value)` (FIFO decrement, returns {writes, fromCustody, shortfall, allocations}) and `poolCustodyInflowRecord(cid, value, label, occurredAt, movementId)` (a new awaiting-deposit custody record).
- NEW callable `retireRevolvingFund({preview?, approvalId})`: reads the live `asset:petty_cash` balance from `/financialMovements` (Σ debit−credit on petty lines), and if > 0 posts `Dr cash_awaiting_deposit / Cr petty_cash` for exactly that, opens a custody record, and writes an `operationalAudit` row. Manager-approval gated via `claimManagerApproval`. Idempotent (movementId `revolving_fund_retirement`). `preview:true` returns `{balance}` without posting.

Note: movementType strings (e.g. `revolving_fund_purchase_advance`, `petty_cash_expense`) were deliberately kept so the books mirror (`mirrorPosMovementToBooks`) keeps working; only the account on the cash leg changed.

### assets/js/admin/undeposited.js (NEW module)
The **Undeposited Collection** ledger tab. Subscribes to `financialMovements` + `cashCustody`. Renders a running ledger of every movement touching `cash_awaiting_deposit` (date · type · reference · in · out · running balance), a balance-on-hand header, a custody-tie reconciliation badge (✓ ties to the ledger / ⚠ differs), a date-range filter, and — when petty balance > 0 — the **Retire & fold in** button (`doRetire`: `retireRevolvingFund({preview:true})` → `managerApproval('retire_revolving_fund',...)` → `retireRevolvingFund({approvalId})`).

### assets/js/admin/module-loader.js
Added `undeposited` to `files` (`undeposited.js`), `routes` (`['undeposited']`), `roots` (`undepositedRoot`).

### admin.html
Renamed the `💷 Revolving Fund` nav tab to `💵 Cash Payments`; added a `💰 Undeposited Collection` nav button (`posSwitchTab('undeposited',this)`) and a `tab-undeposited` / `undepositedRoot` content div.

### assets/js/admin/register.js (the Cash Payments tab, function `renderPetty`)
Header/subtitle → Cash Payments funded by Undeposited Collection. Removed the fund-balance summary cards (opening/replen/disb/remaining), the Replenish card, the opening-balance input, and the replenishments table (so the retired fund can't be re-inflated). Kept the voucher form (expense / owner withdrawal / supplier purchase_advance), the custodian card, and the "payments awaiting allocation" figure. `purchaseCashAdvance()` (the old drawer "release cash") is neutralized — it now alerts and redirects to the Cash Payments/pool flow instead of writing a drawer pay-out.

### assets/js/admin/pos.js
Purchases "Payments pending inventory allocation" list: the pool-funded supplier voucher already lands in `purchaseFundAdvanceMap` (it's a `purchase_advance` voucher), so it shows in the list automatically. Only change: the row source badge `'Revolving Fund'` → `'Undeposited Collection'`. The allocate-to-inventory flow (`renderPurchases`, the "Allocate from payment pending inventory allocation" option, `purchase_paid` server action) is unchanged.

### books.html (finance app)
Chart account 1030 label "Undeposited Funds" → "Undeposited Collection" (+ the `cfName` fallback). The shift-close cash already posts `Dr 1030 / Cr register_cash`; only the display name differed.

### tests/static-check.mjs
Two design-lock workflow markers updated to match the intentional label changes: `'Release purchase cash'` → the redirect alert text; `'Record Revolving Fund disbursement'` → `'Record a cash payment'`.

### database.rules.json — NOT changed
`cashCustody`, `financialMovements`, and `operationalAudit` are `.write:false` with no field validation, so server (Admin SDK) writes bypass rules — new custody fields, movement types, and the retirement record need no rule change. `pettyCashVouchers` write rule doesn't restrict extra fields and the voucher shape didn't change.

## Verification done locally
`node --check` on every edited JS file and the extracted books.html main script; `npm test` (static-check) PASS; `npm run test:safety` PASS; `npm run test:release` PASS; standalone accounting simulation PASS. NOT run locally (no Firebase CLI / Playwright browsers on the machine used): `npm run test:rules` (emulator) and `npm run test:e2e` — these run in CI on merge.

## Post-merge checklist
1. Watch the "Deploy Firebase Functions & Rules" Action → green (its `test:ci` includes the emulator + e2e gate). If red, read the log and fix on a follow-up commit to the same branch.
2. In the live portal, click **Retire & fold in** once (Undeposited Collection tab).
3. Verify: the tab's balance-on-hand ties to custody (✓ badge); it matches the books figure for account 1030; the books trial balance still balances; `asset:petty_cash` is zero after retirement.

## Repo gotchas (read before editing)
- **Deploy = git push.** Push to `main` deploys everything (Pages for frontend, Actions for functions + rules). Auth for the Action is `secrets.FIREBASE_TOKEN`; no local Firebase CLI needed.
- **Never `git add -A` from the local folder.** `C:\AKALIKO\DMM\PERSONAL\CLAUDE\Projects\Accaza Coffee Shop` is missing files that exist only on GitHub (`CNAME` for the custom domain, `README.md`, `favicon.svg`, OG images, the Google verification html). A blanket add would stage their deletion and break `accazacoffee.com`. Stage files by name.
- **functions/index.js** contains one literal control character (a NUL) inside the `platformRefKey` sanitizer regex (~byte offset 18297). Edit byte-safely and away from that line; `node --check` after every edit. It is valid UTF-8 and Node parses it.
- **books.html**: the editor's find/replace has doubled backslashes in the past, breaking JS regex/strings. Prefer byte-exact edits; after any edit, extract the `<script>` blocks and `node --check` them.
- **tests/static-check.mjs** encodes design-lock markers asserting workflow strings exist. If you intentionally change a workflow's wording, update its marker in the same PR (as this PR did for two).
- **Concurrency note on the custody FIFO:** the payment-time custody decrement uses the same fire-and-forget-trigger + idempotent-commit model as the existing `onShiftOpenFinancial` float logic. The GL is always correct; in a rare simultaneous double-approval the custody `remaining` could transiently overstate. Hardening to a `cashCustody` transaction is a possible follow-up, but it would also touch the float-draw path, so it was left consistent with what's there.
