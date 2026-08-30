# ADR-028: Production Assurance and Financial Write Safety

**Status:** Accepted
**Date:** 2026-08-30
**Deciders:** Accaza owner and engineering

## Context

A valid inventory reconciliation request failed because one Firebase multi-location update contained both a complete Books account path and fields below that same path. Firebase rejected the whole request. The rejection preserved the database, but the browser received only a generic internal error and the command-claim lifecycle could leave a retry blocked after an interrupted request.

The POS and customer applications are live. The solution must therefore be additive, must not migrate production records, and must preserve the atomic relationship between operational subledgers and Finance Books.

## Decision

Accaza will use one reusable write-safety component for protected financial multi-location updates. It validates paths and values, combines compatible parent/child writes into one record, and rejects contradictory updates before Firebase receives them.

Critical financial commands retain their immutable movement ID as the idempotency key. An active command cannot be treated as a successful duplicate unless its financial movement exists. Interrupted processing claims may be recovered after fifteen minutes, safely beyond the longest nine-minute financial callable. Financial posting and Books chart management receive correlation IDs, structured start/success/failure logs, and user-safe unexpected-error messages.

No physical inventory quantity, opening balance, journal history, customer order, or production schema is rewritten by this phase.

## Options considered

### Keep safeguards local to each function

Low initial effort, but inconsistent validation and repeated defects remain likely.

### Rely on Firebase rejection

Firebase protects atomicity, but failures are discovered late, diagnostics are poor, and retry state can remain ambiguous.

### Central validation and traceability — selected

Moderate implementation and test cost. It provides consistent preflight protection, actionable references, independent tests, and controlled retry recovery.

## Consequences

- Compatible overlapping writes are safely normalized before submission.
- Contradictory paths, unsafe values, and malformed destinations are blocked without posting.
- Retried requests do not report success unless the immutable movement exists.
- Logs contain operation and correlation identifiers, but not payloads, amounts, account details, email addresses, or authentication tokens.
- The fifteen-minute recovery window favors duplicate prevention over immediate retry after an interrupted invocation and cannot overtake a normally running financial callable.
- Backup restoration, production performance evidence, permission review, and dependency review remain controlled operational gates; this code change does not falsely mark them complete.

## Financial control behavior

- The original operational record or subledger and the Finance Books movement remain in one atomic update.
- Source type, source ID, movement ID, actor, and posting time remain on the immutable movement.
- Inventory reconciliation adjusts valuation accounts and account 5905 only; it never changes quantities or opening balances.
- Corrections, returns, settlements, and reversals continue through their dedicated linked workflows.
- Movement IDs and command claims prevent duplicate General Ledger and subledger posting.

## Rollback

Revert the Phase 10 commit and redeploy Functions. No data rollback or record transformation is required because the phase adds validation and metadata behavior only.
