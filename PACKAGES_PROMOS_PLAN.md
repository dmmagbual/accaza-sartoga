# Accaza — Packages & Promos build plan
_Draft for review. Two phases. Build Phase 1 first._

## Decisions locked
- **Package = a ₱0 configurator**, not a priced line. Adding it opens a **component picker**; the chosen drinks/pastries go into the cart at their **real menu prices**, then a **set discount** (fixed ₱ or %) is applied. Revenue = components − discount = what's collected. No double-counting.
- **Pricing model:** chosen items **minus a set discount** (per package: fixed ₱ off, or % off).
- **Promo** (e.g. 5 + 1) = same picker: pick the paid items at real price + the free item at **₱0 price but full cost**. Option for a discount instead of a free item.
- **Cost = real:** components deduct from inventory via their recipes → true COGS. A **flat "extra cost" field** per package captures non-ingredient costs (labour, rental, setup).
- **Revenue stream:** package/promo sales tagged to their stream (Events / Promo) so the 3-way channel view stays honest.
- **Workflows:** BOTH counter and online-advance — but **counter first** (Phase 1), online-advance second (Phase 2).

## Phase 1 — Counter / event-day (pick-at-sale)  ← build first
The combination is chosen when the sale is rung; pay; stock deducts immediately. Covers most of the value, far simpler.

1. **Package/Promo setup:** define each — type (package/promo), eligible items or category, required qty (e.g. 10), discount (fixed ₱ or %), free qty (promo), flat extra cost. Managed in an admin tab.
2. **Component picker modal:** opens when a package/promo item is added (POS). Enforces **exact quantity** from **eligible items only**; shows running total, discount, and final price live.
3. **Discount + allocation:** applies the set discount and **allocates it across the chosen items** so per-item net revenue and margin are accurate (not just an order-level line).
4. **Inventory + COGS:** components are real line items → existing recipe engine deducts stock and computes cost automatically. Flat extra cost added on top.
5. **Guardrails:** eligible-item fences + quantity enforcement; **manager PIN** to override (e.g. add an ineligible item or change the discount).
6. **Reporting:** revenue lands in the Events/Promo stream; free-item cost shows as promo margin so you can tell if a promo pays for itself.

## Phase 2 — Online-advance + editable + fulfillment  ← build after
Customer books/pays a package online ahead of the event; combination is provisional and changeable on the day.

1. **Online package ordering:** each package/promo appears on the public site as a **clickable card, exactly like a menu item**. Clicking it **pops up the same picker** (reused from the Phase 1 POS build) where the customer selects their coffee items (+ free items for a promo); it's priced, discount-allocated, and added to their online order. Same experience as the counter, customer-facing.
2. **Editable orders:** staff can change a placed package's components before the event (system currently can't edit a placed order — this is the hard part).
3. **Deduct-at-fulfillment:** a **"finalize/fulfill"** action locks the final combo and deducts inventory **at the event**, not at booking — so day-of changes are costed correctly.
4. **Payment vs fulfillment timing:** paid at booking, fulfilled later; reporting handles the gap.

## Brutal notes
- **Do not advertise ONLINE package booking to customers until Phase 2 is done and tested.** Counter/event-day (Phase 1) can go live first; online-advance is a separate, larger release.
- Phase 2's editable-orders + fulfillment-deduction is the genuinely hard, higher-risk part. Keep it separate so Phase 1 ships clean.
- All of this is built on the `admin.html` copy and tested before it touches live — same discipline as the POS.
- "Ready for rollout" = Phase 1 live → you can sell packages at the counter and at events immediately. Online pre-booking comes with Phase 2.

## Next step
Green-light **Phase 1** → I build the setup + picker + discount/allocation + guardrails + reporting, validate, hand back for review before deploy.
