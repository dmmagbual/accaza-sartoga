# Accaza POS — Build Plan & Roadmap
_Agreed direction, Phase 1 spec, and what's next. Draft for review._
_Last updated: 2026-07-22_

## Decision summary
- **Build the POS into our own site** (the existing Firebase PWA), not a separate off-the-shelf tool.
- **Why:** we already have the menu, orders, inventory, recipes, staff logins, and customer list in one system. A separate POS (e.g. Loyverse) would mean **two inventories and two customer lists** drifting apart daily — nightly reconciliation we don't want. One system = one source of truth.
- **What we rent later, if ever:** only hardware/processor-bound pieces (a card terminal). Everything software, we already have the skeleton for.

## Guardrails (agreed)
- **Single store.** No multi-branch, no warehouse transfers, no serial-number inventory.
- **Tablet/laptop only** for now. Receipts = browser-print + email. No barcode scanner / receipt printer / customer display yet (add later if hardware is bought).
- **Non-VAT** (below the ₱3M threshold). VAT stays a settings toggle for the future.
- **Not a BIR-accredited POS.** It runs the counter and keeps our records; official receipts still go through the BIR-registered channel.

## Already built (in `index-pos.html`, on a copy — live site untouched)
- Ingredient inventory with reorder alerts.
- Recipe builder (base × size multiplier + option add-ons).
- Basic POS register (tap items, cash/e-wallet, printed receipt).
- Auto-deduction of ingredients on order completion (walk-in + online), idempotent.

## Roadmap (built in this order because each feeds the next)
- **P0 — Split back-office into `admin.html` + security foundation** *(prerequisite)*
- **P1 — Counter core + finance control + offline** *(the trunk)*
- **P2 — F&B experience:** floor plan/tables, dine-in vs takeout, QR table ordering
- **P3 — CRM & marketing:** customer profiles + VIP tags, loyalty points, auto-discounts/combos, SMS
- **P4 — Intelligence & books:** analytics dashboard, **simple P&L** (recipe COGS + manual overheads), own ops scorecard, Netsuite/Xero-shaped export

---

## Phase 0 — split + security foundation (do first)

### A. Split back-office into its own file
- New **`admin.html`** at `https://accazacoffee.com/admin.html` (Firebase already serves it directly — no config).
- **Moves to admin.html:** Admin Dashboard (incl. the POS tabs), Availability manager, Comments manager, and the login gate.
- **Stays in index.html:** everything customer-facing — menu, online ordering, reservations + feedback submission, public reviews display, and the *consumption* of availability data (it gates what customers can order). Split is along **"who manages" vs "who consumes,"** not cut-by-section-name.
- **Approach:** `admin.html` is **self-contained** — its own Firebase init + the few shared helpers it needs. Minor duplicated boilerplate, but robust and simple to deploy.
- The POS/inventory/recipe engine already built in `index-pos.html` **migrates into `admin.html`** (not wasted).

### B. Security foundation (the real lock — file split alone secures nothing)
- **Problem today:** login is a client-side hash check; the database can't tell an admin from a stranger, so rules can't protect anything.
- **Fix — adopt Firebase Authentication:**
  - Customers get silent **anonymous auth** (no login prompt; ordering stays seamless).
  - Staff/admin get **real Firebase Auth accounts** (email + password), replacing the hash-in-DB login.
  - A privileged **admins/staff list** (by auth UID) marks who's allowed.
- **Database rules matrix:**
  - Menu, availability, reviews → public read.
  - Place order / reservation / feedback → any visitor may *create* (validated), can't read others'.
  - Orders, customers, sales, inventory, shifts, accounts → **staff/admin only.**
- **Honest costs:** existing staff/admin accounts recreated as Auth users (one-time, passwords re-set); customer order path gains anonymous sign-in (must test ordering stays frictionless); password-change + account-management screens rewire to Auth APIs.
- **Decision:** do the **full** Auth + rules migration here — before the POS handles money.

---

## Phase 1 — detailed spec

### Features
1. **Payments:** multiple methods, **split payment** on one bill (e.g. part cash + part GCash), cash rounding *(off by default, configurable)*.
2. **Hold / recall orders** — save an unfinished sale, pull it back later.
3. **Void / cancel** with reason + **refund** with full audit trail (who, when, why, original order ref).
4. **Split / merge bills.**
5. **Staff PIN login** (4-digit) + **activity log** of every sale, void, refund, discount.
6. **Shift management:** open shift with starting cash float → close shift → **Z-report**.

### Agreed rules
- **Permissions — two tiers:** Cashier rings sales; **Manager PIN required** to void, refund, discount, and close a shift.
- **Attendance:** PIN identity only in P1 (every action stamped with who did it). Clock-in/out + hours-worked comes in a later phase.
- **Refund → stock:** refund **reverses the ingredient deduction (restocks)**, with a **"spoiled/wastage" toggle** to keep it deducted when the item can't be resold.
- **Offline mode:** **cash sales only** while offline (queued locally, synced on reconnect). Refunds, voids, and e-wallet confirmation wait until back online — the safe, standard approach.

### Z-report (shift close) will show
Gross sales · sales by payment method · discounts given · voids · refunds · **expected cash vs counted cash + variance** · broken down per staff. Exportable. _This is the automated reconciliation + handover._

### Data model additions (Firebase Realtime DB)
- `shifts/<id>` — openedBy, openAt, openingFloat, closedBy, closeAt, totals, byMethod, discounts, voids, refunds, countedCash, variance, status
- `activityLog/<id>` — ts, staff, action, ref, detail
- `staffAccounts/<uid>` — add `pin`, `role` (cashier | manager)
- `orders/<id>` — add `payments[]` (splits), `shiftId`, `voided` + `voidReason`, `refundOf`
- Offline queue — browser-local, flushes to `orders/`

## Phase 4 — detailed spec (analytics + P&L)

### Agreed definitions
- **Net sales = gross − discounts − refunds.** Delivery fees = pass-through, not revenue.
- **COGS = actual ingredients consumed × unit cost**, from recipes + the deduction engine. **Snapshot each ingredient's unit cost into the order at time of sale** so COGS is locked to that day and never drifts when prices change later (traceable/defensible).
- This is a **management P&L** (cash-basis by default), not statutory — Netsuite/Xero stay the books of record; P4 export feeds them.

### A. Analytics dashboard (native, traceable)
- **Sales overview:** transactions, gross/net sales, avg daily, daily trend vs prior period, high/low day.
- **Item performance:** top sellers (units, ₱), item trend, decliners — from order line items.
- **Customer insights:** # customers, new vs repeat %, growth — from `appCustomers`.
- **Ratings:** overall + new, from reviews/feedback.
- **Funnel:** Orders + conversion native; **Reach/Visits via manual weekly entry** (read from existing Google Analytics). GA API integration deferred until the manual step proves worth automating.

### B. Own operational scorecard (honest "MQP" equivalent)
- Prep time (placed → completed), cancellation rate, on-time % vs a configurable target. Optional manual "remake/incorrect" tag on void/refund. Only metrics we can actually measure from our own order data.

### C. Simple P&L
- Revenue (net sales) − COGS = **Gross profit + gross margin %**.
- **Operating expenses:** manual entry with **custom categories + line items** (`expenseCategories/`, `expenses/{item, amount, date, category, notes}`), each dated.
- **Net profit** = Gross profit − OpEx, by month. Exportable.

### What your site can NOT produce (flagged honestly)
- Delivery-platform "MQP / Quality Hero" badge (third-party program — replaced by our own scorecard).
- Campaign **ROI** requires promo tagging (P3) + manual **ad spend** input.
- True "Reach" is a GA/ad-platform number, entered manually — not invented by the system.

## Open items before/around the build
- **Firebase database rules** must allow admin/staff writes to the new nodes (`shifts`, `activityLog`, `inventory`, `recipes`, `posSettings`, and the new order fields). Same note already flagged in `TODO_ACCAZA.md` for `appCustomers`.
- **Recipes** still need real quantities entered (grams/ml/pumps) — only we have those; the engine is only as accurate as that data.
- Deduction/engine currently runs in the admin browser (fine for one terminal). A Cloud Function version is the robust long-term option — a small follow-up, not a rebuild.

## Next step
Green-light **Phase 0** → build `admin.html` (split + self-contained), migrate the POS engine into it, stand up Firebase Auth + database rules, validate, hand back for review before deploy. Then Phase 1 into the secured `admin.html`.

_Live `index.html` stays untouched until each phase is reviewed and approved._
