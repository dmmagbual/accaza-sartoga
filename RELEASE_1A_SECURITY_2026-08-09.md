# Release 1A — Customer Input Security Containment

**Prepared:** 9 August 2026  
**Deployment status:** Not deployed  
**Admin build:** v142  
**Customer build:** v38

## Outcome

This release contains the highest-risk stored-injection paths identified by the red-team audit without changing the POS pricing, checkout, inventory, cash-flow, or platform-reconciliation logic.

## Changed files

- `admin.html`
- `index.html`
- `database.rules.json`
- `.gitignore`
- `PRODUCTION_BASELINE_2026-08-09.md`
- `tests/static-check.mjs`

Cloud Functions are unchanged and do not require deployment for Release 1A.

## Release SHA-256 hashes

| File | SHA-256 |
|---|---|
| `admin.html` v142 | `589095F6BA7613491DAB853C5CFF15864F547E82EF7FF367EF6FF44D09C8C6BC` |
| `index.html` v38 | `6531E2C26716D2C645B9F4858D87D7B43B08957A90BC8DA3C91BBD68D4FE8743` |
| `database.rules.json` | `EFB5ABF14ABF5E8BEB0A8AF250A6A1FD9BFADF6206D1D96B54C9C449EC002F28` |

## Security changes

1. The shared `escHtml` helper now escapes ampersand, angle brackets, double quotes, and apostrophes.
2. Customer-controlled feedback, reviews, active orders, archived orders, reservations, reservation archives, and customer order trackers are rendered as text instead of executable HTML.
3. Payment-proof image sources are accepted only when they are recognized image data URLs or HTTPS URLs, and are safely attribute-escaped.
4. Dynamic order action buttons use data attributes/listeners rather than placing database order IDs inside inline JavaScript strings.
5. Reservation and feedback forms now have explicit browser-side length limits.
6. Database rules now enforce matching server-side limits.
7. Customers may create feedback and reservations, but only authorized admins may later update or delete them.
8. Reservation status, contact method, guest count, and required-field formats are constrained for customer-created records.

## Validation completed

- All 20 executable script blocks across `admin.html` and `index.html` passed `node --check`.
- `functions/index.js` passed syntax validation.
- `database.rules.json` passed JSON structure validation.
- Firebase Realtime Database Emulator v4.11.2 started successfully and compiled the updated rules.
- Customer-field HTML containment checks passed in `tests/static-check.mjs`.

Run locally at any time:

```powershell
node tests\static-check.mjs
firebase emulators:exec --only database "node --version" --project accaza-sartoga
```

## Deployment order

### 1. Before deployment

1. Export a fresh Firebase Realtime Database backup outside the GitHub repository.
2. Confirm the GitHub repository/branch that serves the live website.
3. Confirm that database backup JSON, ZIPs, spreadsheets, PDFs, DOCX files, old HTML copies, `PRICING and COSTING/`, and private documents are not present in the public repository or its history.
4. Preserve the currently deployed frontend commit/files for rollback.

### 2. Publish frontend

Publish only:

- `admin.html` v142
- `index.html` v38

Do not upload the entire local project folder.

### 3. Publish database rules

From the project folder:

```powershell
firebase deploy --only database --project accaza-sartoga
```

### 4. Production smoke test

1. Open the customer site in a private/incognito browser.
2. Submit ordinary feedback; confirm success.
3. Submit a reservation for each important type, including Full Day Booking.
4. Sign in as an authorized manager.
5. Confirm feedback displays correctly and can be marked Resolved/deleted.
6. Confirm reservation displays correctly, contact buttons work, status can be changed, and archive works.
7. Open active and archived orders; confirm names, items, notes, payment proof, action buttons, printing, and notification controls work.
8. Complete one normal POS sale and verify no inventory, receipt, or register workflow changed.
9. Test a harmless injection string such as `<b>TEST</b>` in feedback. It must appear literally as text and must not become bold or execute anything.

## Rollback

If frontend rendering or normal submissions fail:

1. Restore the previously deployed `admin.html` and `index.html` from the exact production commit/copy—not an arbitrarily named local backup.
2. If the failure is specifically caused by rules, restore the pre-release `database.rules.json` identified by SHA-256 in `PRODUCTION_BASELINE_2026-08-09.md`, then redeploy database rules.
3. Record the failure before changing anything else.

Rolling back the rules reopens the customer write weakness, so it is an emergency compatibility action only.

## Remaining risk after this release

- Staff roles are still enforced mainly through UI hiding; Phase 1B must enforce roles in Firebase/server logic.
- Online prices and totals are still customer-supplied; Phase 1C will make order creation server-priced and owner-bound.
- `appCustomers` and order reads are not yet owner-bound.
- Legacy admin password hashes and plaintext POS PIN authority remain for Phase 1B.
- Realtime listener and base64 payment-proof performance issues remain for Phase 2.
- Inventory partial-retry/double-deduction risk remains for Phase 3.
