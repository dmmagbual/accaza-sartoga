# Release 3C — Server Financial Movement Ledger

**Date:** 9 August 2026  
**Status:** Implemented, emulator-tested, and Firebase dry-run validated; production deployment pending  
**Admin build:** v154

## Delivered

- Immutable, balanced `/financialMovements` records written only by Cloud Functions.
- Stable source-based movement IDs and safe retry behavior.
- Server-owned cash-flow ledger, receivables, payables, platform payouts, payment confirmation, refunds, voids, and settlement fields.
- Server posting for sales, split tenders, platform revenue/commission/receivable, purchases, AR/AP, shifts, petty cash, payout variance, and deposits.
- Coordinated order adjustment and accounting updates.
- Idempotent backfill for historical orders, refunds, voids, shifts, petty cash, opening balances, and compatible AR/AP documents.
- A bounded Finance audit table showing movement ID, source, debit/credit lines, amount, actor, and timestamp.
- Browser `reconcileAuto` removed.

## Coordinated deployment

The old frontend cannot work correctly after the new rules lock browser financial writes. Pause POS transactions and deploy this as one coordinated release.

1. Export a fresh Realtime Database backup.
2. Keep the current v153 frontend available for rollback, but do not use it with the new 3C rules.
3. Deploy Functions and Database rules together:

   `firebase deploy --only functions,database --force`

4. Publish these GitHub files together:

   - `admin.html`
   - `assets/js/admin/core.mjs`
   - `assets/js/admin/finance.js`
   - `assets/js/admin/pos.js`
   - `assets/js/admin/register.js`
   - `assets/js/admin/analytics.js`

5. Hard-refresh the admin portal and confirm **build v154**.
6. Open **Finance → Cash Flow** and run **Backfill / verify 3C financial ledger** once. It is idempotent and safe to retry if interrupted.

Source-only deployment files include `functions/index.js`, `functions/lib/financial.js`, `database.rules.json`, and the tests. Do not upload those as website files.

## Smoke test

1. Complete one cash sale and one GCash sale; confirm one `sale_{orderId}` movement per order.
2. Complete one split cash/GCash sale; confirm debits equal the sale total and cash denominations changed only by the cash leg.
3. Refund part of an order; confirm one immutable refund movement and the original sale remains unchanged.
4. Void a test order; confirm the remainder is reversed exactly once.
5. Create and collect one receivable; create and pay one payable.
6. Record a purchase on cash and another on account; confirm inventory and finance each have stable source IDs.
7. Close a shift with a small test variance; confirm shortage/overage posting.
8. Settle a test platform payout; confirm selected orders settle, variance allocations balance, and a later deposit records to the chosen account.
9. Refresh and repeat no commands; confirm movement counts do not increase.
10. Confirm POS startup remains unchanged and the financial audit trail loads only when Finance opens.

## Validation completed

- `npm test` — passed, including 3C split sale, platform receivable, refund, transfer, and balancing tests.
- `npm run test:rules` — passed; forged browser writes to financial movements, cash ledger, AR, AP, payouts, orders, and inventory were denied.
- JavaScript syntax checks — passed.
- `firebase deploy --only functions,database --dry-run --force` — passed.
- Firebase warned that `firebase-functions` is outdated. It was deliberately not upgraded inside 3C because the upgrade may contain breaking changes; dependency upgrade belongs in a separate tested release.

## Rollback warning

Rules and frontend are coupled. If 3C fails, restore the prior Functions/rules and v153 frontend together. Do not roll back only the HTML while leaving 3C rules active.

## Known limitations

- This is a traceable management accounting ledger, not yet a formal statutory general ledger.
- Split-payment refunds use a deterministic tender assumption because the refund screen does not capture the actual refund method.
- The manager PIN is not a server-verifiable approval credential.
- A formal register-to-bank deposit/cash-custody workflow and chart of accounts remain future work.

