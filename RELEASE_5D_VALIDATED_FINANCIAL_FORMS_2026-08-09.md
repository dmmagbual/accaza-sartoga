# Release 5D — Validated Financial and Operational Forms

**Build:** Admin v164 · Customer v45 · Service worker cache v53  
**Date:** 9 August 2026

## Outcome

The POS/admin portal no longer uses native browser prompts. Operational and financial inputs now use a consistent Accaza control-record form with validation, accessible keyboard behavior, inline failure messages, and preserved entries.

Void and refund remain protected by Firebase manager approval and the existing server adjustment function. Refund amount cannot exceed the remaining refundable balance. Refund tender allocation must still equal the refund exactly. Inventory is returned only when explicitly selected and permitted by the existing reversal rules.

## Files to publish to GitHub

- `admin.html`
- `sw.js`
- `assets/js/admin/form-dialog.js`
- `assets/js/admin/core.mjs`
- `assets/js/admin/pos.js`
- `assets/js/admin/register.js`

No Firebase rules or Function deployment is required for 5D alone.

## Smoke test

1. Force-refresh `admin.html` and confirm build v164.
2. Open and cancel each new form with Escape.
3. Verify required reasons cannot be blank.
4. Verify refund amount rejects zero and amounts above the remaining balance.
5. Cancel refund-tender allocation and confirm the original refund form remains open with its values.
6. Complete a manager-approved refund and void; verify financial movements, inventory treatment, drawer effect, and activity log.
7. Confirm shift open, petty voucher decisions, discrepancy review, manual discount, and password reset still work.

## Rollback

Restore the previous coordinated frontend set. Do not roll back only `form-dialog.js`, because v164 callers depend on it.
