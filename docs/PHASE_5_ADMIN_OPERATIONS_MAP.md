# Phase 5 Admin operations source map

## Decision

Keep `register.js`, `analytics.js`, and `finance.js` as separate lazy-loaded browser bundles, but maintain each from smaller ordered source sections assembled by `npm run build:runtime`.

Runtime ES-module conversion was rejected for this phase because these classic scripts share established globals and subscription timing. Splitting network delivery would add authentication, offline, and partial-load failure modes without improving customer-page performance. Build-time assembly preserves the existing load timing and global scope byte for byte.

## Register operations

`src/admin/register/` separates bootstrap/payment controls, denomination counting, Z-reports, discrepancy resolution, revolving-fund records, cash movement, operations review, settings/staff, shift lifecycle, shift export, and void/refund handling.

## Analytics and reconciliation

`src/admin/analytics/` separates subscriptions, the authoritative sales model, sales analytics, daily close reporting, platform payout reconciliation, profit and loss, and inventory valuation/reconciliation.

## Finance operations

`src/admin/finance/` separates ledger bootstrap, cash-flow statements, receivables, payable detail, and the payables/API bridge.

## Safeguards

- The deployed bundles remain byte-identical to their pre-Phase 5 versions.
- Bundle drift fails `npm test`.
- Existing checks retain balanced postings, reversal links, source references, idempotency, inventory valuation, subledger treatment, and daily-close controls.
- No database schema, Firebase Function, security-rule, or Finance Books runtime behavior changes in this phase.
