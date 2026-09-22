# Cashier handover with unresolved sales — Admin 578 / cache 559

## Cashier workflow

Close shift attempts ordinary synchronization and posting verification. A failed
check or an eight-second timeout opens **Finish shift and hand over**. Count the cash
and submit. No manager approval is required for the owning cashier. Only after the
server saves the original count, retained sale commands and device reports does it
release this till for the incoming cashier. A lost acknowledgement is safe to retry:
the original count wins and a subsequent shift is never cleared.

The old shift is **handover_pending**, not financially certified as closed. Never
delete device-health records or clear browser storage to bypass synchronization.
Internet access is still required to acknowledge the handover and open the incoming
shift; this does not implement multi-device shift allocation during a total outage.
An unreadable queue or an over-limit upload must be recovered first rather than
silently represented as empty.

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
and verify Admin 578. Validate a controlled handover and recovery on the deployed
backend before describing the operational flow as live-verified.
