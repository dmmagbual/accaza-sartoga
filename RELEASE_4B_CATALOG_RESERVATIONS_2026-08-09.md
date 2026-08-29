# Release 4B — Catalog, Reservations, and Channel Pricing

**Date:** 9 August 2026  
**Status:** Implemented and automated tests passed; GitHub publication and production smoke test pending  
**Admin build:** v158  
**Service-worker cache:** v47

## Critical live-site hotfix

The live v157 admin page was browser-verified to fail with `ReferenceError: printOrder is not defined`. That stops startup before the login handler is installed. v158 replaces the eager reference with a safe deferred callback. The live login is not repaired until the complete v158 file set below is published.

## Delivered

- Dedicated catalog-administration module.
- Dedicated customer/admin reservations and calendar module.
- Independently lazy-loaded channel-pricing module.
- Safe receipt/notification callback wiring that cannot block login startup.
- Escaped catalog item names/descriptions and validated image sources in moved admin rendering.
- One-owner and file-size architecture regression guards.

## Atomic GitHub publication

Upload all eight files together:

- `admin.html`
- `sw.js`
- `assets/js/admin/core.mjs`
- `assets/js/admin/catalog-admin.mjs`
- `assets/js/admin/reservations.mjs`
- `assets/js/admin/channel-pricing.js`
- `assets/js/admin/module-loader.js`
- `assets/js/admin/pos.js`

Do not upload `core.mjs` alone. It imports the two new `.mjs` files; either missing file will prevent login startup.

No Firebase deployment is required for Release 4B itself.

## Post-publication cache refresh

1. Wait until GitHub Pages shows all eight files.
2. Close every Accaza tab.
3. Reopen `https://accazacoffee.com/admin.html`.
4. If v157 remains, hard-refresh once or clear site cache/service-worker data.
5. Confirm the header shows **build v158**.

## Smoke test

1. Open the old staff/admin login page and sign in. Refresh and confirm the session restores.
2. Add and edit a test category/menu item, change its options, then remove the test data.
3. Mark one item unavailable and confirm it is unavailable in POS; restore it.
4. Create a test reservation, accept it, change one slot, contact the customer, complete/archive it, and print the archive.
5. Open Channel Pricing. Confirm the screen loads only then, edit one test price, save, reopen, and verify it persisted.
6. Export the channel-pricing workbook.
7. Complete one in-store POS sale and one platform test order.

## Validation completed

- `npm test` passed.
- 29 executable HTML and external scripts parsed.
- All existing security, server pricing, ownership, active-order, inventory, costing, financial, and operational guards passed.
- Module syntax checks passed.
- Browser inspection identified the live v157 login blocker and confirmed the v158 source no longer contains the eager callback.
- Core size: 131,560 bytes, below the 135,000-byte guard.

## Checksums

- `admin.html`: `9C7F4C5E31832CFDB81F38B5469FCFD03F63726B6E1BC5CEA824922964F93C12`
- `sw.js`: `69954C784A786C8AC870B7C1952C77B20C2A290A0E7C81F20682CFCCAC866672`
- `assets/js/admin/core.mjs`: `DE27E8BC6894825ECBBB176CFECED5CCF5E2BF89C61B4D8C4980D26BE8F0E063`
- `assets/js/admin/catalog-admin.mjs`: `DDCFA3FA00F86A4450375512020A562B6AFEDAC9D3FE60EFEF41B9BAF962465F`
- `assets/js/admin/reservations.mjs`: `D5F324779CFB7014C7F9E3B409238DB7E790936BA275AA23EB69ABE80E0FA6A0`
- `assets/js/admin/channel-pricing.js`: `86348EF8149F70AA74D8F66959D1D56B344D4EC5C0BE525A2A940F9BB181EDE8`
- `assets/js/admin/module-loader.js`: `0C0F2AE3D4C2295C39A4D96D7560C87022ECC2FF253ACAA6FEC5D2733A4C5121`
- `assets/js/admin/pos.js`: `0E8C7FE91B145ACCCB54B9A4DBA24E83690AB5F2C94594821B64B18D9DD1F128`

## Rollback

Restore `admin.html`, `sw.js`, `core.mjs`, `module-loader.js`, and `pos.js` from v157 together. The new 4B modules may remain unused, but never restore only the old core while retaining a mismatched loader/POS pair.

## Known limitations

- The live login remains broken until v158 is published.
- Static tests cannot replace the production smoke test with actual Firebase authentication and catalog writes.
- `core.mjs` still owns customer menu/order/storefront behavior.
- `pos.js` remains 244 KB and needs later checkout/inventory decomposition after browser workflow coverage.
