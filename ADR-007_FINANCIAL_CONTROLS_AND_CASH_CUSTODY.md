# ADR-007 — Financial Controls and Cash Custody

**Status:** Accepted; locally implemented, production rollout pending  
**Date:** 9 August 2026  
**Deciders:** Danilo Magbual and Codex

## Context

Release 3C made financial movements immutable and server-owned, but four control gaps remained: a local manager PIN was not real authorization; split refunds did not identify the returned tender; closed-shift cash had no custody-to-bank trail; and manual entries used free-text categories. Finance also lacked one exception-oriented control view.

The solution must not add history listeners to POS startup or invalidate existing 3C movement IDs.

## Decision

Sensitive actions use a short-lived server approval created from a separate Firebase manager sign-in. The cashier session remains open. The server verifies the manager ID token and `/admins/{uid}` role, binds the approval to one action, source, and amount, gives it a five-minute life, and consumes it once using a retry-safe operation key.

Refunds capture actual tender allocations. The server validates that allocations equal the refund and never exceed the original amount paid through each method. Cash-drawer calculations subtract only cash refunds.

Closed-shift counted cash moves from register cash to `asset:cash_awaiting_deposit` and creates `/cashCustody/{shiftId}`. A later opening float consumes custody FIFO; any uncovered float is explicitly credited to `equity:cash_float_source`. Bank deposits consume selected custody records and create a linked bank/e-wallet cash entry.

Manual cash entries use active `/chartOfAccounts` categories. Defaults are server-created; authorized managers may add or deactivate accounts. Historical accounts are not deleted.

The Finance control audit runs on demand on the server and reports missing sales postings, unbalanced/warning movements, legacy cash entries without movement IDs, unmapped payment methods, unsettled platforms, undeposited payouts, open AR/AP, and cash awaiting deposit.

## Options Considered

### Option A: Keep the local manager PIN

| Dimension | Assessment |
|---|---|
| Complexity | Low |
| Security | Weak; browser-readable/shared secret |
| Traceability | Weak identity evidence |
| Operations | Familiar |

**Pros:** Fast and simple.  
**Cons:** The browser decides whether approval is valid; it is not reliable financial authority.

### Option B: Replace the cashier session with manager login

| Dimension | Assessment |
|---|---|
| Complexity | Medium |
| Security | Strong |
| Usability | Poor; interrupts the active register session |
| Failure risk | High during checkout |

**Pros:** Uses Firebase Auth directly.  
**Cons:** Can log out or replace the cashier and destabilize POS state.

### Option C: Separate in-memory manager sign-in and server-bound approval

| Dimension | Assessment |
|---|---|
| Complexity | Medium |
| Security | Strong for the current architecture |
| Usability | Manager signs in without replacing cashier |
| Performance | Loaded only when approval is requested |

**Pros:** Real Firebase identity, short expiry, single use, action/amount binding, no POS listener.  
**Cons:** Managers must have their own Firebase Auth account and enter credentials for each approval.

## Trade-off Analysis

Option C provides meaningful authorization without changing the current portal session model. It adds authentication friction intentionally only to high-risk actions. A reusable approval session was rejected because it would recreate an unattended-manager-authority risk.

## Consequences

- Refund, void, payment verification, payout settlement, and cash-count reopening now identify a Firebase manager.
- Cash deposits and opening floats become traceable custody movements.
- Historical closed shifts are not converted into custody records because their current physical disposition cannot be proven.
- The existing browser archive/delete workflow still requires archived-order writes. That node remains a residual hardening gap until archive actions move server-side.
- This remains a management ledger, not a statutory general ledger.

## Action Items

1. Deploy Functions, Database rules, and admin v155 together.
2. Confirm every manager has a Firebase Auth account and `/admins/{uid}` role of owner, superadmin, admin, or manager.
3. Initialize the default chart in Finance.
4. Test mixed-tender refund, payout approval, count reopening, shift close/open custody, and bank deposit.
5. Move archive and permanent-delete operations behind server callables in a later release.

