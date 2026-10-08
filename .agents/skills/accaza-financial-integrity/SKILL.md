---
name: accaza-financial-integrity
description: Use for Accaza changes or investigations involving money, inventory, recipes, COGS, purchases, payments, refunds, settlement, accounting reports, or financial reconciliation.
---

# Accaza financial integrity

Involve Bookkeeper & Controller for finance/inventory changes. Add Database Optimizer for relevant schema, transaction, query, or migration work; Identity & Access Engineer for authorization changes. Purchases/supplier-payment work also uses `accaza-ap-phase-gate`. Load `accaza-pos-live-safety` whenever the change can affect a sale, stock deduction, shared pricing or POS posting.

Read the relevant authority sections of `CLAUDE_HANDOFF.md`, then verify the current source. Starting points are `src/functions/`, `functions/lib/financial.js`, `functions/lib/books-bridge.js`, `functions/lib/cash-balances.js`, `functions/lib/accounting-periods.js`, `functions/lib/costing.js`, and the affected client source. Generated `functions/index.js` is not the editing source for concatenated sections.

Before implementation, establish the lifecycle applicable to the change:

| Stage | Evidence to preserve or verify |
|---|---|
| Original event | Stable source ID, actor, Manila business date, document number, approval policy and revision |
| Posting | Balanced debits/credits using existing decimal/fixed-precision helpers; exact amount, account, funding source, inventory valuation and COGS |
| Operational and Books views | Source links, subledger/custody movements, derived GL/report balances and reconciliation |
| Later action | Allocation, settlement, partial payment, return, correction and linked reversal |
| Failure/retry | Idempotency keys, concurrent claims, atomic writes, recovery evidence and permanent audit |

Preserve server authority and period locks. Posted history is immutable; use the supported correction/reversal command. Do not fix a displayed balance, bypass a control account, or change historical costing silently. Preserve command-specific approval rules and approved exceptions rather than inventing a universal approval policy.

When bill/custody claims are involved, verify lock ordering and release on duplicate, success and failure in the current implementation. Do not make shift-close or Z-report paths wait on cash-out custody locks.

Distinguish actual cash, receivables, advances, retained float and variance. Platform gross revenue, commission expense and payout settlement are separate. State each affected subtotal/total explicitly.

Verify both Admin/POS records and Finance Books/GL with meaningful lifecycle tests, including retry and reversal. State historical-data assessment/backfill still required and Firebase cost impact; use `accaza-firebase-cost-review` for affected access paths.
