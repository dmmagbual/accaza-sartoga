# Open-period cash journal edits

## Supported correction

Finance Books **Journal → Edit / correct** can amend an existing two-line
`manual_books_journal` or `register_cash_deposit` in place when one account is
Undeposited Collection and the other is Register Cash or a configured cash/bank
account. The account pair and transfer direction must stay unchanged. The user
supplies the actual amount, Philippine accounting date, reference, memo and reason.

The original movement and Books journal IDs remain unchanged. There is no extra
General Ledger reversal or replacement. Original and revised periods must be open.
This does not post a planned deposit, personal withdrawal, or any other live entry
automatically. Other journal types retain their existing controlled workflows.

## Accounting and operational effects

- Increasing a bank deposit from PHP 6,717 to PHP 6,907 changes the existing entry
  to Dr bank 6,907 / Cr Undeposited Collection 6,907. Bank increases by PHP 190,
  available undeposited cash decreases by PHP 190, and total cash is unchanged.
- Sales, expenses, profit, equity, receivables, payables and inventory cannot be
  introduced or changed through this edit path.
- Validation uses the entire available undeposited pool, not the original
  remittances assigned to the deposit. No remittance selection is needed to edit.
- For compatibility with existing Admin payments and settlement workflows,
  positive custody rows remain the supporting availability records. A reduction
  in the pool updates these rows oldest-first; a return to the pool creates a
  linked correction-availability row. This is not a full replacement of the
  legacy remittance-based custody model or the new-deposit screen.
- A bank-deposit increase updates deposited amounts, not expense-paid amounts.
  Original allocations are retained as `originalCustodyAllocations`; the revised
  movement is explicitly marked `pooled_journal_revision`. Historical allocations
  are evidence, not a cap on a future correction.
- The two cash-ledger legs are replaced under the same movement ID. Existing
  cash-ledger rows and custody changes are captured in the revision record.
- Affected daily-close snapshots are reopened for review. Closed months are never
  reopened automatically. Philippine dates apply regardless of the device timezone.

## Safeguards and history

The server checks the privileged Finance role, reason, original revision, actual
date, original/new period locks, cash account availability, bank-reconciliation
flags, current cash balances, protected register float and historical daily cash
balances. It rejects existing ledger-to-custody mismatches instead of concealing
them with an automatic balancing entry. Linked-control or already reversed
journals are excluded.

A root database transaction validates the latest state and commits the movement,
journal, cash-ledger legs, custody availability, close status, command receipt and
revision history together. Exact retries reuse the stored result; a reused command
ID with a different payload fails. The browser carries the opened revision and a
stable submission ID. Existing financial posting claims block the edit; pending
custody writes are rechecked after acquiring their posting claim so they cannot
overwrite a correction completed during preparation.

History is server-written under `cashJournalRevisions/<movementId>/<revision>` and
read through the privileged `cash_journal_history` callable. Books exposes a
**History · rN** button. Direct client writes are not enabled. Books rebuilds and
creation-trigger retries preserve newer journal revisions.

Journal-only void/reversal is disabled after an in-place cash revision because it
would leave custody availability unsynchronized. Amount/date corrections continue
through Edit / correct. A full cancellation or changed account/direction requires
a separately designed linked workflow; this release does not silently bypass that
restriction.

## Verification and deployment

`tests/cash-journal-edit-check.cjs` checks pooled increases/returns, unchanged
revenue and IDs, revision history, retries, stale revisions, role/period/bank locks,
historical negative cash, float protection, duplicate bank references, stale
custody writes, callable routing, real account mapping and browser payloads.

The root transaction is intentionally an infrequent correction operation. It
reads the database root, so production database size, memory and contention must
be monitored; local fixture tests do not establish production performance. No
production transactions are needed or authorized by building this feature.

Both Functions and the Books frontend must be deployed before use. This local
build does not certify that deployment. Admin build 403, Books build 82 and
service-worker cache 355 identify this release; customer build stays 64.
