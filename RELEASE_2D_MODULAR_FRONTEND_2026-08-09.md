# Release 2D — Modular Frontend and Lazy Startup

**Date:** 9 August 2026  
**Status:** Implemented and locally validated; production deployment and browser smoke test pending  
**Admin build:** v150  
**Customer build:** v43  
**Service-worker cache:** v44

## Delivered

- Extracted all large inline application scripts into `assets/js/admin` and `assets/js/customer`.
- Added one dependency-aware admin tab loader.
- POS, analytics, register operations, finance, packages, and staff-access code load only when used.
- SheetJS loads only on the first Excel import/export action.
- Removed the retired embedded admin dashboard from `index.html`.
- Removed customer startup reads for the whole `/orders` and `/appCustomers` nodes.
- Added customer module files to the PWA precache.
- Removed nonexistent icons from the precache list; those files previously caused cache installation failure.
- Extended regression tests to parse all external modules and test lazy loading, dependency order, module reuse, and deferred Excel loading.

## Measured Source Payload

Measurements are uncompressed local source bytes. They do not include Firebase CDN modules.

| Startup path | Before | After | Change |
|---|---:|---:|---:|
| Admin first-party startup | 977,649 B | ~515,032 B | -47.3% |
| Customer first-party startup | 505,482 B | ~452,889 B | -10.4% |
| Deferred admin feature modules | 0 B deferred | ~455,884 B deferred | Loaded by tab |

These are payload measurements, not cashier-device timing results. Cold/warm timing must still be measured after publication.

## Required GitHub Files

Upload these together in one commit:

- `admin.html`
- `index.html`
- `sw.js`
- the complete `assets/js/admin/` directory
- the complete `assets/js/customer/` directory

Do not upload only the HTML files. They now reference external modules.

## Primary File Fingerprints

- `admin.html`: `90B491EE8AADAB2DBDEB66527711EBE17C848A0D6C48FB740CC97CDE51990D98`
- `index.html`: `B9C3A1E1A99DC7ECDAE4AB8B22A3BC76C7D09825F62374C7095F7E2D7E941FFE`
- `sw.js`: `DBCCBA0C041203D446C3F28FE9410D09883955CD00FBCAD5380F58B07AB75C01`
- `assets/js/admin/core.mjs`: `3677268371268900BCC7CE0A593376707D7CDF5F1E870DBF2B8F1465A5112DED`
- `assets/js/admin/module-loader.js`: `03DB580DD85FD2D58292EBAA248700267C809AC0A8AB6949307E9EC720A38C4F`
- `assets/js/customer/core.mjs`: `0F4DEAD4D6F1F2013886ABC2DE680D7E75ED067DDDE46E0E25870865E7777B36`

## Validation Completed

- `npm test` — passed.
- Every HTML and external JavaScript module parses successfully.
- Server-pricing, payment-proof, active-order, and security regression checks passed.
- Lazy module behavior test passed.
- `npm run test:rules` — passed in the Firebase Database Emulator.
- `sw.js` syntax check passed.

## Mandatory Deployment Order

Release 2C backend is still listed as pending in the current handoff. Therefore:

1. Export a fresh Firebase backup.
2. Deploy Release 2C backend first: `firebase deploy --only functions,database`.
3. Confirm backend deployment succeeds.
4. Publish all Release 2D GitHub files together.
5. Hard-refresh or close/reopen the installed app so service-worker cache v44 activates.

## Browser Smoke Test

1. Open customer site and confirm menu, packages, checkout, order tracking, reservations, reviews, and payment information.
2. Log into admin and confirm Dashboard opens before any optional module is requested.
3. Open POS and complete one cash sale.
4. Open Inventory, Recipes, Channel Pricing, Register Ops, Analytics, P&L, Platform Payouts, Packages, Staff Access, Cash Flow, Receivables, and Payables.
5. Use one Excel export and confirm SheetJS is fetched only at that moment.
6. Close the shift and print the Z-report.
7. Confirm inventory deduction, active-order projection, archive behavior, and payment proof viewing.
8. Check the browser console and Firebase Function logs for errors.

## Known Limitation

The admin core is still 224,590 bytes and contains shared legacy responsibilities. Removing more from it without browser-level workflow tests would create disproportionate risk. Release 2D establishes the safe module boundaries; deeper source cleanup belongs in Phase 4 after live timing and workflow verification.
