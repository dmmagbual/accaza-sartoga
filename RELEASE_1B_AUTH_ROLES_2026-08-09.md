# Release 1B — Firebase Authentication and Role Enforcement

**Prepared:** 9 August 2026  
**Deployment status:** Not deployed  
**Admin build:** v144  
**Customer build:** unchanged (v38)

## Outcome

The admin/POS portal no longer trusts a browser-stored role or a password hash compared in JavaScript. Firebase Authentication establishes identity, `/admins/{uid}` establishes the role, and Realtime Database rules enforce module permissions.

## Changed files

- `admin.html`
- `database.rules.json`
- `tests/static-check.mjs`
- `ACCAZA_IMPROVEMENT_ROADMAP.md`
- `RELEASE_1B_AUTH_ROLES_2026-08-09.md`

Cloud Functions and `index.html` are unchanged for this release.

## Release SHA-256 hashes

| File | SHA-256 |
|---|---|
| `admin.html` v144 | `7F486F215DF9F2D766532C926F05E32EF5A0900143228C73AABE2A1F89D5FEDE` |
| `database.rules.json` | `0C707E8B738ACA7BE481511889CAEC33AB0D0AFFEEE628876DBF53CC81EE222D` |
| `tests/static-check.mjs` | `BD59B0E3CDD0473482DFA884982829478F090A7EC3B14359BD50988D2D4D8795` |

## Authentication changes

1. Portal login now accepts only a Firebase Authentication email/password account.
2. `onAuthStateChanged` must resolve a real signed-in Firebase user before the portal opens.
3. The signed-in UID must have an authorized record at `/admins/{uid}`.
4. `sessionStorage` retains display metadata only; it cannot restore a role or open the portal.
5. Browser-side SHA-256 password comparison was removed from the login path.
6. Password changes now use Firebase Authentication only.
7. The old hash-only Staff Accounts form was replaced with Firebase account setup guidance.
8. The legacy hash records remain temporarily in the database for rollback/data migration, but the login flow no longer consumes them.

## Supported role values

Existing values remain compatible:

| `/admins/{uid}` value | Effective authority |
|---|---|
| `true` | Owner; full access (legacy-compatible) |
| `owner`, `superadmin`, `admin`, `manager` | Privileged manager/admin access |
| `staff`, `cashier`, `kitchen`, `finance` | Staff access, limited by `/adminPerms/{uid}` |
| `{ "role": "..." }` | Same mapping using the object's `role` field |

Unknown or missing role values are rejected by the portal.

## Rule enforcement

- Inventory, recipes, purchasing, internal usage, channel pricing, register operations, analytics, cash flow, receivables, payables, P&L, and related modules now require the corresponding `adminPerms` flag for non-privileged staff.
- Menu/category/option administration, portal settings, payment administration, account records, permission assignment, POS staff setup, and selected finance configuration require a privileged role.
- A cashier with POS/order permission can create ordinary sales and update operational order status, but cannot alter an existing order's void, refund, payment-verification, inventory-deduction, costing snapshot, or payout-settlement fields.
- A non-privileged user may create a pending petty-cash voucher or a new discrepancy record, but cannot approve, reject, review, or void it.
- Manager PIN checks now also require the currently signed-in Firebase account to be privileged. Knowing a PIN alone is no longer financial authority.
- Every signed-in user may read only their own `/admins/{uid}` role record; privileged users may read the role list.
- The legacy `/settings/adminPasswordHash` is no longer publicly readable.

## Validation completed

- All 20 executable script blocks across `admin.html` and `index.html` passed JavaScript syntax checks.
- Release 1A customer-field containment tests still pass.
- Release 1B regression guards confirm Firebase-auth gating, server-backed role lookup, absence of session-role restoration, absence of browser password-hash login, permission rules, and protected refund fields.
- `functions/index.js` passed syntax validation.
- Firebase Realtime Database Emulator compiled the final rules successfully.

Run locally:

```powershell
node tests\static-check.mjs
firebase emulators:exec --only database 'cmd /c exit 0'
```

## Mandatory pre-deployment lockout check

Do not upload v144 or publish these rules until this check passes:

1. Open Firebase Console → Authentication → Users.
2. Confirm at least one owner/admin email account exists.
3. Copy that user's UID.
4. Open Realtime Database → `/admins/{UID}`.
5. Confirm its value is `true`, `owner`, `admin`, `manager`, or an object containing one of those roles.
6. Confirm you know that Firebase account's password or can receive its reset email.

If no matching Firebase user/UID exists, create/fix it before deployment. The old username-only or `superadmin` hash login will not work in v143.

## Deployment order

1. Export a fresh Realtime Database backup outside the public GitHub repository.
2. Preserve the currently deployed `admin.html` and rules for rollback.
3. Publish only `admin.html` v144 to the GitHub Pages source.
4. In a private browser, sign in with the verified Firebase owner email and confirm the portal opens.
5. Deploy the rules from this project folder:

```powershell
firebase deploy --only database --project accaza-sartoga
```

6. Sign out and sign back in as the owner.
7. Test one staff Firebase account and confirm only its assigned tabs and database operations work.
8. Complete a normal POS sale, status update, shift operation, inventory view, and password change.
9. Confirm a cashier cannot approve a discount, refund, void, payment verification, petty-cash approval, or discrepancy review even when the cashier knows a manager PIN.
10. Sign in as a manager/admin and confirm those approved operations still work.

No Functions deployment is required for this release.

## Rollback

If v144 prevents owner login, restore the previous `admin.html` immediately. If ordinary authorized operations fail after rules deployment, restore the prior Release 1A rules and redeploy them, then record the exact denied operation before making another change.

Rolling back reopens browser-trusted login and broad staff privileges; use it only as an emergency recovery step.

## Remaining risks

- Legacy password-hash data and plaintext POS PIN values still exist in the database. They are no longer accepted as stand-alone portal authority, but should be deleted in a controlled cleanup after v143 is proven in production.
- Role creation still requires Firebase Console because `/admins` writes are deliberately denied to browsers. A callable owner-only account-provisioning function can replace this later.
- Release 1C is still required to make online order creation server-priced and customer-owned.
- The portal still starts many listeners before tab-level demand; Phase 2 will reduce startup payload and lag.
