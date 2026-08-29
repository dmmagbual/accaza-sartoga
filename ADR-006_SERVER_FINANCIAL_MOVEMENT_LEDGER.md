# ADR-006 — Server Financial Movement Ledger

**Date:** 9 August 2026  
**Status:** Accepted; locally implemented, production rollout pending

## Decision

`/financialMovements/{movementId}` is the immutable accounting audit ledger. Cloud Functions alone may write it. Each record contains a stable movement ID, source type and source ID, actor, occurrence/posting timestamps, and balanced debit/credit lines.

The browser submits commands through callable Functions. It may display previews and collect inputs, but it cannot directly write financial movements, cash ledger entries, receivables, payables, platform payouts, settlement fields, refunds, or voids. `/cfLedger`, `/receivables`, `/payables`, and `/platformPayouts` are server-written operational projections.

Movement IDs are deterministic for source events. Retried order, shift, petty-cash, refund, void, payout, purchase, AR, and AP operations therefore return the existing result instead of creating another movement. The movement and its projection/document updates are sent in one Realtime Database root update.

## Posting coverage

- Completed/received POS sales, including split payment.
- GrabFood/FoodPanda gross revenue, commission, discounts, withholding tax, VAT/service charges, estimated variance, and receivable.
- Payment confirmation, refunds, voids, and linked cash reversals.
- Platform payout settlement, variance allocations, and bank/e-wallet deposit.
- Cash-flow entries and transfers.
- Receivable/payable creation, collection/payment, and reversal.
- Cash purchases and purchase payables.
- Shift cash-ins, cash-outs, shortages, and overages.
- Petty-cash expenses, replenishments, and void reversals.
- Opening balances and compatible historical-data backfill.

## Performance boundary

The new ledger is not POS-critical. Finance subscribes only while a Finance-related tab is open and receives the latest 300 movements. Older pages load only on request. No 3C listener is added to POS startup.

## Accounting assumptions

- Platform withholding tax is posted as an asset; commission, platform discount, and service VAT are expenses.
- Platform payout allocations must exactly explain the server-calculated difference between selected-order expected net and actual payout.
- For a split-payment refund, the current UI does not ask which tender is returned. The engine credits cash when the original order included cash; otherwise it credits the first non-cash tender. This is deterministic but is an operational assumption, not proof of the cashier’s actual refund method.
- Register cash is an operational subledger. Shift opening/closing custody transfers are not yet a formal bank-deposit workflow, so the accounting audit lines must not be presented as a complete statutory general ledger or bank reconciliation.
- Free-text manual categories post to management-ledger offset accounts. A formal chart of accounts remains future work.

## Security boundary

Firebase Auth roles and portal permissions authorize callables. The local manager PIN remains a screen-control convenience and is not server-verifiable financial authorization. Database rules prevent browser forgery, but stronger per-action manager approval requires a server-verifiable approval credential in a later release.

## Rejected alternatives

- Browser-generated ledger entries: closure, tampering, and retries can omit or duplicate postings.
- Mutable balance-only records: they destroy the source trail and make reconciliation impossible.
- One giant transaction history listener: it would recreate the POS lag problem.
- Silent imbalance correction: it hides data defects. The engine rejects unbalanced movements.

