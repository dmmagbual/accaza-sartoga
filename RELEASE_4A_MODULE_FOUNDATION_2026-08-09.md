# Release 4A — Admin Module Foundation

**Date:** 9 August 2026  
**Status:** Implemented and automated tests passed; GitHub publication pending  
**Admin build:** v157  
**Service-worker cache:** v46

## Delivered

- Central Firebase client and callable registry.
- One shared real-time subscription and bounded-history service.
- Separate portal authentication and manager-approval modules.
- Separate active-order and customer-registry modules.
- Shared safe UI utilities.
- Removal of duplicate customer-registry globals.
- Removal of unreachable legacy browser password recovery/hash loading.
- Core-size and module-boundary regression guards.

The admin core decreased from 230,525 bytes to 196,310 bytes. Business workflows, Firebase paths, security rules, and Cloud Functions were not changed by this release.

## GitHub publication

Push these files together:

- `admin.html`
- `sw.js`
- `assets/js/admin/core.mjs`
- `assets/js/admin/firebase-client.mjs`
- `assets/js/admin/realtime-hub.mjs`
- `assets/js/admin/history-pager.mjs`
- `assets/js/admin/manager-approval.mjs`
- `assets/js/admin/portal-auth.mjs`
- `assets/js/admin/admin-orders.mjs`
- `assets/js/admin/customer-registry.mjs`
- `assets/js/admin/shared-ui.mjs`

No Firebase deployment is required for Release 4A itself. However, admin v157 includes the earlier Release 3D/3E frontend. If the matching Release 3D/3E Functions and Database rules are not yet live, deploy that coordinated backend before or during the v157 maintenance window.

## Smoke test

1. Hard-refresh and confirm **build v157**.
2. Log in, refresh the page, and confirm the authorized session restores without delay or empty data.
3. Open POS, add an item, and complete one test sale.
4. Change one order status and confirm only the affected order card updates.
5. Archive an eligible test order and confirm the server-controlled archive flow works.
6. Trigger one manager-approved action and confirm the independent manager sign-in works.
7. Open Customer Registry, filter it, change the promotion threshold, and export CSV.
8. Open at least two history-heavy tabs and use **Load older**.
9. Switch back to POS and confirm checkout remains responsive.

## Validation completed

- `npm test` — passed.
- 26 executable HTML and external scripts parsed successfully.
- Existing security, customer ownership, active-order, payment-proof, inventory, costing, financial, and operational-control guards passed.
- New module imports and ownership guards passed.
- All new modules and `core.mjs` passed JavaScript syntax checks.
- `core.mjs` size: 196,310 bytes, below the 205,000-byte guard.

## Checksums

- `admin.html`: `A0CC168B3B98E39E26B6F16314726BA9A7E723122C4B161A99A80184E38ECEDF`
- `sw.js`: `8A1B3182EA27493B01257DED0D7ECEF08DD78CB640C49F731373BE012EE7AC78`
- `assets/js/admin/core.mjs`: `BB3BE7A19DA27F6D547646F64A8BF957E5411C28C7C3E3A73C2C85BB7ED58BF5`
- `assets/js/admin/firebase-client.mjs`: `F12AAB049EDB8AC64FCB7C84CFF79053E02174DB2CE271CBB7C93DA330696BBB`
- `assets/js/admin/realtime-hub.mjs`: `3A595CDC09EB6237F5FB3A855EB2023F0B578909857937D3DF7EFDAD37E74060`
- `assets/js/admin/history-pager.mjs`: `6820ADFFF61DC429895C3CC4CF7FB48DBB2C784C8E9C77FA01284F138EF4396F`
- `assets/js/admin/manager-approval.mjs`: `AA52DBA30BE77068AE0528D847408B9D5DF10A6A22D228D4787E27ED89FF323B`
- `assets/js/admin/portal-auth.mjs`: `10ADCD8715B438B9898892C95993A43150A2E97F3E401BE927C56110BE70AE26`
- `assets/js/admin/admin-orders.mjs`: `1102E84A9AE2A0595673251A2F8437740979293135311654DD487E8B3D229D39`
- `assets/js/admin/customer-registry.mjs`: `D09358D8ECF5898847C34E75A3F941872AF248A22EE631DB05CE92055B64DA87`
- `assets/js/admin/shared-ui.mjs`: `AF838FF13D540E17442D48E30BA85F75396F45F366D6497B3BD9EF987AB1CE49`

## Rollback

Restore `admin.html`, `sw.js`, and the complete previous `assets/js/admin/` directory together. Publishing only `core.mjs` without the new modules will prevent the admin portal from loading.

## Known limitations

- This is the first Phase 4 slice, not completion of Phase 4.
- `core.mjs` is still 196 KB and still coordinates catalog/menu administration, reservations, and other shared admin/storefront behavior.
- Existing global and inline-handler compatibility remains until Releases 4B/4C.
- Cashier-device performance targets still require production measurement; file-size reduction alone does not prove faster checkout.
