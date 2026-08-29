# Release 3D — Financial Controls and Cash Custody

**Date:** 9 August 2026  
**Status:** Implemented, emulator-tested, and Firebase dry-run validated; production deployment pending  
**Admin build:** v155

## Delivered

- Firebase-account manager approval for payment verification, refunds, voids, platform settlement, and reopened cash counts.
- Five-minute, action/source/amount-bound, single-use approval records.
- Actual cash/non-cash refund tender allocations with server validation.
- Cash drawer and Z-report calculations subtract only cash refunds.
- Closed-shift cash custody, FIFO opening-float issuance, partial deposits, and bank/e-wallet deposit movements.
- Controlled chart of accounts for manual cash movements.
- On-demand server financial-control audit and Finance exception dashboard.
- Server-only rules for approvals, chart changes, and cash custody.

## Prerequisite

Each approving manager needs:

1. Their own Firebase Authentication email/password account.
2. The same UID under `/admins/{uid}`.
3. Role `owner`, `superadmin`, `admin`, or `manager`.

The old POS manager PIN is not accepted for 3D financial approvals.

## Coordinated deployment

1. Export a fresh Realtime Database backup.
2. Pause POS transactions.
3. Deploy Functions and Database rules:

   `firebase deploy --only functions,database --force`

4. Publish these GitHub website files together:

   - `admin.html`
   - `assets/js/admin/core.mjs`
   - `assets/js/admin/register.js`
   - `assets/js/admin/finance.js`
   - `assets/js/admin/analytics.js`

5. Hard-refresh and confirm **build v155**.
6. Open **Finance → Cash Flow → Initialize defaults** under Controlled chart of accounts.
7. Run **3D control audit**.

## Smoke test

1. Verify a pending payment; manager email/password must be required and the cashier session must remain open.
2. Refund a split cash/GCash order using both tenders. Confirm allocations equal the refund, only the cash amount reduces the drawer, and the movement has separate credits.
3. Attempt to refund more through a tender than originally paid; the server must reject it.
4. Void an order and confirm manager approval plus one reversal.
5. Confirm a used/expired approval cannot authorize a second action.
6. Reopen a confirmed cash count; manager Firebase approval must be required.
7. Close a shift and confirm `/cashCustody/{shiftId}` appears.
8. Open the next shift and confirm its float reduces oldest custody first.
9. Record a partial bank deposit; confirm custody remaining, bank cash entry, and balanced movement.
10. Add a custom chart account, post one manual movement, and then deactivate the account. Historical posting must remain.
11. Run the control audit and resolve any critical exception before normal operation.

## Validation completed

- `npm test` — passed, including mixed-tender refund and allocation rejection.
- `npm run test:rules` — passed, including denied browser writes to approvals, chart accounts, custody, and 3C finance nodes.
- JavaScript syntax checks — passed.
- Firebase Functions/Database dry run — passed.
- Firebase still warns that `firebase-functions` is outdated; upgrading remains a separate breaking-change test.

## Important limitations

- Historical closed shifts are not backfilled into cash custody because whether that cash was already deposited is unknown.
- Archived-order archive/delete remains browser-driven for compatibility. Sensitive active-order fields are locked, but full archive authority must move server-side later.
- A manager must enter credentials for every sensitive approval; no reusable approval session is intentionally retained.
- This is a management control ledger, not a statutory general ledger or tax filing system.

