# Phase 6 customer runtime hardening

The customer application is maintained in ordered sections under `src/customer/core/` and assembled into `assets/js/customer/core.mjs` by `npm run build:runtime`.

Phase 6 removed legacy Admin dashboards, staff/Admin credential tools, archive controls, menu administration, Admin calendar mutation, and kitchen-ticket printing from the public customer runtime. Those operational capabilities remain owned by the authenticated Admin application.

The customer bundle retains anonymous Firebase authentication, App Check, server-authoritative order creation, payment-proof preparation, duplicate submission protection, owned order tracking, reservations, reviews, notifications, and customer UI. It no longer constructs references to staff or Admin account records.

Safeguards include an exact source-to-bundle drift check, a 110 KB size ceiling, forbidden privileged-symbol checks, release version coordination, and desktop/mobile browser tests. Finance Books, inventory, journal posting, corrections, reversals, subledgers, and Firebase Functions are unchanged.
