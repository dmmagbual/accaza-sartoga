# Release 3E — Operational Controls and Retention

**Date:** 9 August 2026  
**Status:** Implemented, automated tests passed, Firebase dry run passed; production deployment pending  
**Admin build:** v156  
**Service-worker cache:** v45

## Delivered

- Server-authorized manual order archive.
- Manager-approved permanent deletion limited to rejected orders older than 90 days with no financial posting.
- Retained financial sales visibly marked as locked audit records.
- Server-authorized discrepancy review with required root-cause note and manager identity.
- Server-authorized petty voucher approval, rejection, and void with receipt, balance, state, and manager checks.
- Server-side 60-day activity-log archive in batches of up to 500.
- Immutable `/operationalAudit` and `/deletionAudit` records.
- Browser write locks for archive and control nodes.

## Coordinated deployment

1. Export a fresh Realtime Database backup.
2. Pause POS/admin changes briefly.
3. Deploy Firebase Functions and Database rules:

   `firebase deploy --only functions,database --force`

4. Push these website files to GitHub together:

   - `admin.html`
   - `sw.js`
   - `assets/js/admin/core.mjs`
   - `assets/js/admin/register.js`

5. Hard-refresh the admin portal and confirm **build v156**.

## Smoke test

1. Archive one completed test order. Confirm it leaves Orders and appears in Archive.
2. Confirm a completed/received archived sale shows **Retained audit record** and no delete button.
3. Confirm a rejected order younger than 90 days cannot be deleted.
4. For an eligible old rejected test order, confirm deletion requires manager Firebase credentials and leaves `/deletionAudit/orders/{id}`.
5. Review an open discrepancy. Confirm a root-cause note and manager Firebase sign-in are required; verify `reviewApprovalId` is stored.
6. Create a pending petty voucher with a receipt. Approve it and confirm manager identity plus `approvalId`.
7. Reject another voucher with a required reason.
8. Void an approved voucher and confirm the existing financial reversal posts once.
9. Attempt a direct browser/Firebase client write to archived orders or an approved voucher state; it must be denied.
10. Use Register Ops activity archive. Confirm only entries older than 60 days move and the UI reports when another batch remains.

## Validation completed

- `npm test` — passed.
- `npm run test:rules` — passed, including denial of forged archive, discrepancy, petty approval, and audit writes.
- JavaScript syntax checks — passed.
- `firebase deploy --only functions,database --dry-run --force` — passed.
- Firebase still reports the intentionally deferred outdated `firebase-functions` warning.

## Checksums

- `admin.html`: `7621AD5B735EE1FA716185951BCBA85BBE21C1CBCFAA201C4887B9F112785FDC`
- `sw.js`: `FD26A764A334F2D05D92190E068711476D91B176AD31E83A00D0B8196237A5AB`
- `database.rules.json`: `364EEEE8077A6E8205B44F6A76F5ECF0D58465ABEC994E7C381BE8C0AA7EF183`
- `functions/index.js`: `75785E0BCC9F9CEBFFAD1EE870964170928C21D291DC5A3DE1C5CE169CE6B00C`
- `assets/js/admin/core.mjs`: `BD86B94529DD307B8807AB3ED0B6F7AF06612A6A980EA980C7D77A2FA4E26C52`
- `assets/js/admin/register.js`: `6EC3F4DCCC8ADA88E2CC75F5EC0E568656C2866F21F7432833EB3B5249F9EFE0`

## Rollback warning

Do not roll back only the frontend after deploying the 3E rules: old browser archive/review/approval actions will be denied. Roll back Functions, rules, and frontend as one coordinated release, using the database backup if data restoration is required.
