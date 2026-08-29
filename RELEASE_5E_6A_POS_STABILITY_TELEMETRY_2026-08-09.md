# Release 5E + 6A — POS Stability and Operational Telemetry

**Build:** Admin v165 · Customer v45 · Service worker cache v54  
**Date:** 9 August 2026

## 5E outcome

- Cart input values and keyboard focus survive background cart redraws.
- Charge is single-flight from first tap through confirmed IndexedDB durable save.
- Intentional Clear, Hold, and completed sales reset the draft.
- Refund/void cannot open a second financial form over an active form.
- Primary POS controls meet a 44 px minimum target, rising to 48 px on coarse-pointer devices.
- Existing status and channel colors retain explicit icons and text.

## 6A outcome

- Measures page boot, POS build, cart render, Charge-to-durable-save, offline flush, and remote-order arrival.
- Captures only generic JavaScript source/error categories.
- Sends at most 20 allow-listed events per asynchronous batch.
- Stores daily aggregate data under `/clientTelemetryDaily/YYYY-MM-DD`.
- Does not collect customer names, order lines, payment references, platform references, PINs, or financial amounts.
- Monitoring failure cannot reject or delay a sale.

## Firebase deployment

```powershell
firebase deploy --only functions:recordClientTelemetry,database
```

## GitHub files

- `admin.html`
- `sw.js`
- `assets/js/admin/telemetry.js`
- `assets/js/admin/firebase-client.mjs`
- `assets/js/admin/core.mjs`
- `assets/js/admin/pos.js`
- `assets/js/admin/register.js`

## Production tests

1. Confirm admin build v165 and force-refresh once for cache v54.
2. Start a sale, type customer/payment information, then cause a settings or availability update; confirm the values and focus remain.
3. Double-tap Charge rapidly; confirm exactly one receipt, one queued transaction, and one order.
4. Test cash, split payment, GrabFood, and FoodPanda checkout.
5. Disconnect the network, complete one cash sale, reconnect, and confirm one synchronized order.
6. Open Firebase `/clientTelemetryDaily/{today}` and confirm aggregate metric names appear without business/customer fields.
7. In the browser console, `AccazaTelemetry.snapshot()` shows local count/average inputs for the current session.

## Performance targets

- Warm POS launch: under 1.5 seconds.
- Cold launch: under 3 seconds.
- Cart render/action: under 100 ms.
- Remote order arrival: under 1.5 seconds.
- Charge-to-durable-save: target under 300 ms on the register device.
