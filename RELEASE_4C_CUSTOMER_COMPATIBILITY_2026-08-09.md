# Release 4C — Customer Compatibility Cleanup

**Build:** admin v159  
**Service worker:** cache v48  
**Firebase backend change:** none

## Delivered

- Extracted standalone customer identity/login behavior into `app-customer-session.mjs`.
- Extracted customer order IDs, active-order tracker, ready alert/chime, and received confirmation into `customer-order-tracker.mjs`.
- Removed duplicate tracker and ready-alert implementation from the admin core.
- Reduced `core.mjs` from 131,560 bytes in 4B to 122,745 bytes.
- Added single-owner and 125 KB core regression gates.
- Preserved existing pricing, payment, Firebase paths, order write behavior, and visual layout.

## GitHub publication — publish together

1. `admin.html`
2. `sw.js`
3. `assets/js/admin/core.mjs`
4. `assets/js/admin/app-customer-session.mjs`
5. `assets/js/admin/customer-order-tracker.mjs`

Do not upload `core.mjs` alone. No Firebase Functions, Database rules, or Storage rules deployment is required.

## Verification

- Full static/regression suite: passed (31 executable scripts parsed).
- `admin.html`: `D34DCC5063539E51A7C175AE512E16F84FE7FA296523F3C93200737C21104A11`
- `sw.js`: `4DF419B517DAC48E7D8FEFD300D5D5AB42F05CF44EECD070C9A89DB52746C07E`
- `core.mjs`: `15363E9D669F77953503C0EDCDD20784A8F8E93FB142F79DDFBD41FD4F848ECA`
- `app-customer-session.mjs`: `9985914A75B98EDC554CB08B600E0F1C2B090C751AE5A7CFE72DA97825939658`
- `customer-order-tracker.mjs`: `8AC0C0C465A1CAE10E3517334B74443D94B86869CBEDE3D553C47E4997C45789`

## Production smoke test

1. Hard refresh once and confirm admin shows build v159.
2. Log in, refresh, and confirm the session remains active.
3. Open POS and confirm menu, cart, payment, and receipt remain unchanged.
4. On the customer workflow, confirm saved name/phone prefill still works.
5. Place a test order; confirm it appears in the customer tracker in real time.
6. Mark it Completed; confirm the ready alert sounds/displays.
7. Confirm receipt; verify the alert closes and status becomes Received.

