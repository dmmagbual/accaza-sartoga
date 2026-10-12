# AP Integrity Remediation Plan — working copy

**Reconstructed 12 Oct 2026 from merged commits and `docs/archive/CODEX_HANDOVER.md`.**
**Status authority:** this file, until the original project document is supplied. The original was
`claude/ap-integrity-remediation-plan-2026-10-06.md`; that path has **never been tracked by git**
(no commit on any branch has added or removed `claude/`), so it exists only as a Claude project
document outside the repository. If Danilo supplies it, replace this file's status sections with the
original and record the change in the decisions log below.

Binding companions: `docs/plans/purchases-payments-consolidation-plan.md` (consolidation, adopted
7 Oct 2026). Where they conflict, the AP plan wins. Work is governed by `.agents/skills/accaza-ap-phase-gate`.

## Protocol (unchanged)

One Phase 0 step at a time. Before each step: a concise proposal — scope, reason, risk, affected
areas, testing, rollback, specialists — then **wait for approval**. Build, verify, open a PR; **no
merge** without an explicit request. Do not regenerate analysis that this file or the handover
already contains.

## 1. Done and deployed

| Step | PR | What landed | Guard |
|---|---|---|---|
| 0.1 | #693 | Partly-paid purchases cannot be reversed or amended; out-of-range bills flagged in the close and Books | `tests/purchase-reversal-partly-paid-check.mjs` |
| 0.3 | #694 | `apIntegrityBaseline` — read-only baseline, Super-Admin, Finance Books → Payables → **AP integrity check** | `tests/ap-integrity-baseline-check.mjs` |
| 0.4 | #695 | One settlement claim per supplier bill; `claimPayables` re-reads inside the claim on every balance-changing path | `tests/payable-settlement-claims-check.mjs` |
| 0.5 | #696 | One claim for the Undeposited Collection custody pool (`claimCustodyPool` / `withCustodyPool`); shift close / Z report never wait on it | `tests/custody-pool-claim-check.mjs` |
| refs | #697 | `PUR-YYYY-NNNN` purchase numbers (`purchaseDocumentNumber`) shown instead of `pinv_…`, plus Super-Admin `backfillPurchaseDocumentNumbers` | `tests/purchase-document-number-check.mjs` |
| — | #719 | Purchase amendments can no longer be used as AP payments | `tests/purchase-settlement-binding-check.mjs` (family) |
| — | #698 | Claim released after every payment (custody claim release discipline) | covered by the 0.4/0.5 guards |
| 0.2 | #749 | Legacy supplier sweep stops once the migration is complete — it skips **before** the unlinked scans and `force:true` is the deliberate re-run | `tests/supplier-legacy-sweep-guard-check.mjs` |
| 0.6 | #751, #752 | An Undeposited-funded bill payment reverses by restoring the exact custody rows it consumed; the close subtracts restorations after its cutoff | `tests/payable-payment-reversal-check.mjs`, `tests/financial-close-check.cjs` |

**0.3 baseline result** (27 bills, 137 purchases): all critical checks zero; 10 display-only mirror
drifts; 2 confirmed-separate "duplicate" groups (Ice Plant "NO REF", Shopee) — no invoice issued.

## 2. Manual action — done 12 Oct 2026

Danilo ran **Finance Books → Payables → "Number old purchases"**. Verified read-only against live data on
12 Oct 2026: **182 purchases, 0 without a purchase number, 0 duplicates**, every number well formed as
`PUR-YYYY-NNNN` and continuous from `PUR-2026-0001` to `PUR-2026-0182`.

The field is **`documentNo`**; `documentNumber` is the helper name. Checking the wrong name first produced
a false "nothing is numbered" reading, which is recorded here so the next reader does not repeat it.

## 3. Remaining Phase 0 steps

Each is propose → approve → build → PR (no merge). The one-line scope below comes from the handover;
the first action of each step is to re-verify that scope against current source.

- [x] **0.2 — sweep freeze** — built, PR #749 open. Guard `tests/supplier-legacy-sweep-guard-check.mjs`.
- [x] **0.6 — reverse Undeposited-funded payments** (AP-14) — built and merged (#751; blocker fix #752; behavioural guard #753). Implementation record in §5.
- [ ] **0.7 — explicit permission table + audit** (light; owner-operated, no second-person approval).
- [ ] **0.8 — purchase verification + orphan detector** (AP-04): purchase → AP posting is
      client-orchestrated and non-atomic, so stock can be received with no liability.
- [ ] **0.9 — `purchaseInvoices` create-only rules** (AP-05, client-writable) plus the one-time
      **display-only mirror refresh** that copies each bill's payment status onto its purchase and
      folds in the 10 known drifts.
- [ ] **0.10 — supplier-ID matching + backfill** (AP-06: name-based relationships).
- [ ] **0.11 — duplicate supplier invoice refs** with a **"No receipt" exemption** (Danilo decision A:
      no-receipt purchases skip the duplicate check but are listed for review).

## 4. Step 0.2 proposal (built as PR #749)

**Scope.** Stop the legacy supplier sweep from running implicitly, without breaking the migration for
data that still needs it.

- The sweep is server action `manageSupplier({action:'initialize_legacy'})`,
  `src/functions/20-portal-auth.js:103-132`. It writes supplier masters and stamps
  `supplierMigrations/legacyToMaster`.
- It currently fires **automatically when the suppliers node loads, from two client bundles**:
  `assets/js/admin/pos.js:239` and `assets/js/admin/register.js:37`. Both are guarded by the
  in-memory `window.__supplierLegacyInitRequested` flag, so a fresh page load starts with it unset.
  **First action of this step:** read both call sites in full and confirm whether they also check the
  completed migration status (`supplierMigrations/legacyToMaster`) before firing — the quoted lines
  are truncated at the call itself, and that determines whether the server guard alone is enough.

**Reason (verified against the code on 12 Oct 2026 — this corrects the handover wording).** The sweep writes only to records that have **no** `supplierId`, reads only unlinked rows through indexed queries rather than whole nodes, runs at most once a day, and audits every write, so it cannot overwrite an already-linked historical name. The residual risk — and what 0.2 actually fixed — was narrower: once the migration was complete an automatic run could still fire daily and **create a supplier master from a name on its own** for a record that had newly lost its link.

**Built (server only).** `initialize_legacy` returns `{skipped:true, reason:"migration_complete"}` when `supplierMigrations/legacyToMaster` is complete and no `force` flag is passed, and it decides that **before** reading the unlinked rows, so a completed workspace pays nothing on sign-in. `force:true` remains the deliberate Super Admin re-run and the 24-hour throttle is unchanged. Deliberately **no client change**: the two bundles may keep calling and simply receive the skip, so no till bundle, cache or build marker moves.

**Affected areas.** `src/functions/20-portal-auth.js` (guard + confirmation), the two client
subscriptions, the supplier/AP UI that would host the explicit action, and the static guards that pin
the two bundles.

**Testing.** Extend the supplier-master guard family: the two bundles must no longer call
`initialize_legacy` on load; the server must refuse an unconfirmed sweep; a confirmed sweep must still
link legacy suppliers idempotently and record `supplierMigrations/legacyToMaster`.

**Rollback.** Revert the branch and rebuild; the sweep action itself is idempotent, so no data
migration is needed either way.

**Specialists.** Bookkeeper & Controller (AP lifecycle), Identity & Access Engineer (the
Super-Admin-only guard and audit), Code Reviewer before handoff.


## 5. Step 0.6 implementation record (built and merged 12 Oct 2026)

**Blocker:** `src/functions/42d-financial-command-close.js:133` refuses to reverse a bill payment whose
`paidFrom` is `undeposited`, because "restoring the exact cash custody allocations" is not implemented.
Everything around it is already strict: Super-Admin only, reason required, bill claimed, settlement link
verified, already-reversed refused, idempotent by `payable_payment_reverse_<paymentId>`, accounting
period asserted, and the GL side reverses correctly on its own (Dr `asset:cash_awaiting_deposit` / Cr AP).

**To build:** under `claimCustodyPool(db, commandId, apClaimSets)`, restore the rows the original payment
consumed (its `custodyAllocations`) by incrementing each row's `remaining`/`amount`, clearing
`lastPaymentMovementId`, and keeping the pool projections consistent — `cashCustodyOpenIndex` and
`undepositedLedgerPageIndex` — in the same atomic commit as the payable and ledger reversal. Skip the
bank-register row (`addCash`) for this source: the reversed movement already restores its GL side.

**Trap:** `poolCustodyInflowRecord(cid, …)` (`src/functions/40a-custody-pool.js:75`) **replaces the whole
`cashCustody/<id>` row** — it exists for a new pool deposit and would wipe an existing row's
`depositedAmount`, `retainedFloat` and history. Do not use it to restore existing rows.

**Fail closed, never partial:** refuse when the original carries no `custodyAllocations`, when they do
not sum to the payment value, or when a referenced custody row is missing — with a message pointing at
the custody repair in Undeposited Collection.

**Tests:** extend `tests/payable-payment-reversal-check.mjs` — an Undeposited-funded payment reverses
and restores the exact rows and their index projection; missing or short allocations refuse and write
nothing; a retry is idempotent (no double inflow); the pool claim is released on success **and** on
failure; shift close and the Z report still never wait on the pool lock.

**Rollback:** revert the branch and rebuild; the reversal is idempotent and refuses rather than
half-writing, so no data repair is needed either way.

**Specialists:** Bookkeeper & Controller (AP and custody lifecycle), Identity & Access Engineer
(Super-Admin-only and audit trail), Code Reviewer before handoff.

### Review outcome (12 Oct 2026)

An independent Code Reviewer pass found a **blocker** in the first cut, which had already merged as #751:
the close reconstructs custody at a cutoff as *current remaining + outflows after the cutoff*, but a
reversal restores custody **in place** on a row that existed at the cutoff and `Financial.reverseMovement`
drops the custody fields. A close whose cutoff fell between the payment and the reversal therefore
compared a post-reversal custody balance with a pre-reversal GL balance and raised a **false blocking
`cash_custody` exception** — money and custody rows were correct, but the close demanded an adjustment
that must not be made. Fixed in #752: the reversal records `custodyRestoredAllocations`,
`custodyAtCutoff` subtracts post-cutoff restorations, and the multi-bill reversal in `42a` records its
restorations too (the identical pre-existing hole). The pool claim is now taken after cheap validation,
so a rejected command never holds the single pool lock. #753 adds the behavioural `buildClose` case,
with a negative control proving it fails without the subtraction rather than merely passing.

**Two convention notes recorded for the Bookkeeper & Controller** (deliberately unchanged, because the
shipped multi-bill reversal behaves the same way): the reversal skips the `cfLedger` in-row for
Undeposited Collection while the payment writes an out-row; and a restored row is labelled
`awaiting_deposit` even when `depositedAmount > 0` (display-only).

## 6. Decisions log

| Date | Decision |
|---|---|
| 6 Oct 2026 | AP Integrity Remediation Plan approved (original project document). |
| 7 Oct 2026 | Purchases & Payments Consolidation Plan adopted; AP plan wins on conflict. |
| 12 Oct 2026 | This working copy created because the original was never committed. Status sourced from merged commits (#693–#697, #719) and `docs/archive/CODEX_HANDOVER.md`. |
| 12 Oct 2026 | 0.2 built as PR #749 (the sweep stops once complete, before its unlinked scans). 0.6 approved with the implementation note in §5. |
| 12 Oct 2026 | 0.6 merged (#751), its review blocker fixed and merged (#752), behavioural close guard added (#753). "Number old purchases" run by Danilo and verified: 182 purchases, all numbered `PUR-2026-0001`–`0182`, none blank, none duplicated. |
