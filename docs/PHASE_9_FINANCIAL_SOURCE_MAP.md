# Phase 9 financially sensitive source map

## Outcome

Phase 9 decomposes four oversized authoritative source sections into ordered, responsibility-focused files. `npm run build:runtime` still concatenates each directory lexicographically, producing byte-identical `assets/js/admin/pos.js` and `functions/index.js` bundles.

## POS checkout

`src/admin/pos/50a` through `50h` separate the register shell and live orders, item customization, cash denominations, scoped discounts, cart and tender validation, sale persistence, inventory usage, and receipt output.

The split does not change tender totals, platform deductions, manager/cashier verification, duplicate transaction IDs, offline recovery, cash denomination custody, inventory deduction, void/refund treatment, or receipt evidence.

## Inventory and purchasing

`src/admin/pos/11a` through `11h` separate SKU/approved-brand management, expiry batches, standard costing, stock adjustments, recipe spreadsheets, inventory spreadsheets, receiving, and the purchase workspace.

The split preserves weighted-average cost, inventory movement authority, purchase-to-item account mapping, payable allocation, fixed-asset and expense classification, purchase correction, reversal visibility, and source references.

## Financial commands and platform settlement

`src/functions/42a` through `42e` retain the single financial-command transaction across ordered continuation sections and separate the purchase inventory-line helper. `src/functions/43a` through `43h` separate purchase/payable reconciliation, purchase corrections, pre-settlement correction, payout settlement, payout reversal, metadata correction, order adjustment, and platform catch-up.

These are source-maintenance boundaries only. Atomic writes, balanced movements, detailed source IDs, subledger links, inventory effects, later allocation/settlement, corrections, reversals, audit evidence, and deterministic duplicate/idempotency claims remain byte-for-byte unchanged in the deployed Functions bundle.

## Safeguards

- Generated POS and Functions bundles must exactly equal the ordered source sections.
- All 78 Firebase Function export names and registration order remain fixed.
- The four retired monolith filenames are prohibited.
- Financially sensitive source sections under `src/admin/pos` and `src/functions` have a 70 KB ceiling.
- Application build numbers and service-worker cache remain unchanged because deployed output is identical.
