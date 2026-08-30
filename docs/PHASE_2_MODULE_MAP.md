# Phase 2 runtime module map

The deployed POS and Firebase Functions remain single runtime bundles to preserve startup order, shared state, Cloud Functions export discovery, offline behavior, and checkout performance. Maintain the smaller ordered source sections below, then run `npm run build:runtime`.

## Admin POS

- `src/admin/pos/00-shared-state.js` — shared state, costing helpers, offline queue, Firebase subscriptions, and module boot.
- `10-inventory.js` and `11-inventory-skus.js` — inventory views, migration controls, approved brands, and stock adjustment workflows.
- `20-purchasing.js` — purchasing, supplier invoices, WAC inputs, payable links, and purchase correction/reversal UI.
- `30-recipes.js` — recipe costing, options, consumables, validation, and exports.
- `40-internal-usage.js` — staff/R&D usage, inventory movements, Finance classification, reversal, and audit views.
- `50-register-checkout.js` — live register, online orders, payment verification, discounts, checkout, offline persistence, inventory usage, and receipts.

Generated runtime: `assets/js/admin/pos.js`.

## Firebase Functions

- `src/functions/00-bootstrap-notifications.js` — SDK initialization and customer/staff notifications.
- `10-books-bridge.js` — Finance Books mirror, historical reconciliation helpers, cash-float controls, and platform reference indexing.
- `20-portal-auth.js` — callable configuration, authentication, permissions, telemetry, and manager approvals.
- `21-operational-controls.js` — archive, discrepancy, petty-cash, custody, and operational repair controls.
- `22-close-controls.js` — undeposited cash, accounting-period, and certified close controls.
- `30-orders.js` — offline POS synchronization, server pricing, online orders, payment proof, and active-order projections.
- `40-sales-finance.js` — recipe validation and authoritative sale/shift financial posting.
- `41-expense-assets.js` — petty expense classification and fixed assets.
- `42-financial-commands.js` — immutable financial command authority and correction logic.
- `43-purchases-platform.js` — purchases, payables, platform payout settlement/reversal, and order adjustments.
- `44-reconciliation.js` — ledger rebuild, chart controls, date repair, and financial audit controls.
- `50-inventory.js` — idempotent inventory ledger, Finance Books posting, sale usage, refund, and void reversal.
- `60-maintenance.js` — retention, automatic completion, and database backups.

Generated runtime: `functions/index.js`.

## Permanent safeguards

- Never edit either generated runtime bundle without making the same change in its source section.
- `npm run test:bundle-drift` rejects any mismatch.
- Preserve exported Cloud Function names, regions, trigger paths, App Check settings, and initialization order.
- Browser checkout never writes Finance Books directly. Server financial and inventory posting remain authoritative and idempotent.
- Corrections, refunds, voids, purchase reversals, platform settlement, and inventory reversals must retain source IDs and audit links.
