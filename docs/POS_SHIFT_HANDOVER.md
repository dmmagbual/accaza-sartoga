# Cashier handover with unresolved sales — Admin 578 / cache 559

## Cashier workflow

Close shift attempts ordinary synchronization and posting verification, once before
the count and again before the report is saved. The check waits up to 15 seconds for
a dropped connection, allows 30 seconds in total, and retries a dropped or slow server
request once. A business refusal (a sale not synchronized, a posting not finished) or
a check that still cannot finish opens **Finish shift**. Count the cash and submit. No manager approval is required for the owning cashier. Only after the
server saves the original count, retained sale commands and device reports does it
release this till for the incoming cashier. A lost acknowledgement is safe to retry:
the original count wins and a subsequent shift is never cleared.

The old shift is **handover_pending**, not financially certified as closed. Never
delete device-health records or clear browser storage to bypass synchronization.
Internet access is still required to acknowledge the handover and open the incoming
shift; this does not implement multi-device shift allocation during a total outage.
An unreadable queue or an over-limit upload must be recovered first rather than
silently represented as empty.

## Every close ends with a Z report (Admin 590 / cache 571)

Decision (Danilo, 24 Sep 2026): no issue may prevent a Z report. Checks still protect
the books, but they no longer decide whether a Z report exists.

| Situation | What the cashier gets | What happens next |
|---|---|---|
| Everything confirmed | Final Z (till) | — |
| Check fails, nothing actually open | Final Z (server, `automatic_handover`) | — |
| Sale retained, other till outstanding, crew till silent, posting running | **Provisional Z**: server orders plus retained sales (their cash is in the counted drawer), open items listed | Server replays retained sales at handover and every 5 minutes (`resolvePendingShiftHandovers`) and issues the final Z as soon as it is clean |
| Still open when the next shift ends (closed or handed over) | — | `onShiftEndResolveEarlierHandovers` issues the **final Z with open items** (`grace_handover`); unrecovered sales move to Sales needing recovery; a follow-up opens |
| Server unreachable at handover | **Provisional Z built on the till** (includes queued sales) | Cashier submits again when back online |
| Final save of a normal close fails | Goes to the handover path above | — |
| Pop-up blocked | Z opens inside the page | — |

**Late sales after a final Z.** A sale rung during the shift can be recovered into it even
after it closed (Sales needing recovery → Recover; `lateRecovery`). The closed drawer is not
changed; the Z report is re-issued as an amendment (previous copy in `shiftZHistory`). The
cash variance posted at close is **not rewritten**: the amended Z shows the posted and the
recalculated figure, and a `late_sale_variance` follow-up asks management to settle the
difference in Discrepancies. Sales rung outside the shift's hours are never taken into it.

**Follow-ups.** `shiftCloseFollowUps/{shiftId}` (Exception Center `shift_close_follow_up`,
Register Ops → Review pending shift handovers) records a final Z with open items, a
late-sale variance change, or a failed amendment. A manager marks each reviewed with a reason.

**Unchanged controls.** All finalization modes (`manager`, `automatic`, `grace`) share
`finalizeShiftHandover`: reconcile lease, sync-gate freeze, Z from server orders and the
immutable count, open accounting period, discrepancy for any variance, custody posted at
handover, variance posted on close, close receipt. The manager path still requires the
device attestation. Automatic closes need the normal-close evidence plus a crew empty-queue
report within 5 minutes. Every handover records the till's failure reason (`closeCheckError`).

## Management recovery

Register Ops → **Review pending shift handovers** lists up to 50 oldest exceptions
using a compact indexed read. Select a shift, retry retained sales (25 per action),
check each original device for additional sales, and record the checks before final
reconciliation. Other devices can upload their original timestamped commands
to the pending shift. Malformed commands are quarantined intact and need
source-data recovery; they do not block the next shift and cannot be silently erased
or certified. A missing original device keeps reconciliation pending, not trading.

Recovery uses the existing server order, payment, inventory and Finance pipeline.
Original sale IDs, timestamps and shift references survive. Drawer deltas apply
once to the original shift and never to the incoming drawer. Recovery reservations
and finalization locks prevent certification while a registered sale is in flight.
Closed, successfully synced commands are acknowledged without reposting so a
browser can clear its already-recovered queue.

## Accounting and audit

The physical cash count is immutable. Cash above retained float transfers through
the existing balanced `shift_custody_<shiftId>` movement (register cash to cash
awaiting deposit); it is not revenue or a bank deposit. Existing custody settlement
records the later deposit/allocation. Pending sale recovery posts revenue,
inventory and COGS through the ordinary idempotent source-linked order pipeline.
Until recovery completes, ledger balances can be incomplete: the owner daily
summary explicitly shows pending reconciliation, not a verified close.

Finalization verifies inventory and Finance movement evidence, enforces the original
accounting period, derives the Z-report from server orders and the original cash
count, and creates a discrepancy for any shortage/overage. Existing manager
discrepancy resolution and posted-sale correction/refund/reversal workflows remain
the correction routes; never patch ledger balances or delete posted history.

Authoritative components: `src/functions/25b-shift-handover.js`,
`functions/lib/shift-handover.js`, `functions/lib/offline-sync.js`,
`src/functions/40-sales-finance.js`, `src/admin/register/79-shift-handover.js`.
Records: shifts, shiftHandovers, pendingShiftHandovers, offlinePosSync,
operationalAudit, cashCustody, financialMovements, discrepancies and close receipts.
Browser rules forbid editing or deleting handed-over shifts and recovery evidence.

## Verification and delivery

Run `npm test`, `npm run test:release`, `npm run test:safety`,
`npm run test:rules`, and `npm run test:e2e`. Dedicated tests cover command retention,
malformed evidence, idempotent recovery, immutable count, next-drawer isolation,
authorization, period locks, reconciliation locks, custody/variance timing and
desktop/mobile handover failure/retry screens.

Frontend, Functions and database rules must all deploy after merge. A pushed PR
alone does not change the live POS. After deployment, refresh with Ctrl+Shift+R
and verify Admin 589 (automatic close) or later. Validate a controlled handover and recovery on the deployed
backend before describing the operational flow as live-verified.
