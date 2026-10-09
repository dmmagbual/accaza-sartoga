# Release 7E — Rush-Hour POS Workflow

**Build:** admin v171, customer v45, service-worker cache v60

## Delivered

- Search-as-you-type menu filtering without losing the current category.
- Horizontally scrollable, keyboard-accessible category buttons.
- Stronger menu tiles with category, product, price, and a consistent add affordance.
- A dedicated ticket header showing item count and charge readiness.
- A three-stage Items → Payment → Charge order rail.
- One-tap quantity increase/decrease on every ticket line.
- Directed empty states for an empty ticket and an unsuccessful search.
- Responsive two-column tablet tiles, visible focus treatment, and reduced-motion support.

## Safety boundary

This is a presentation and draft-cart interaction release. It does not alter Firebase paths, authentication, permissions, authoritative prices, discounts, payment rules, inventory movements, accounting movements, or offline transaction persistence.

## Coordinated publication

Publish the authoritative files listed in `release-manifest.json`. The minimum 7E-specific set is `admin.html`, `sw.js`, `release-manifest.json`, `assets/js/admin/pos.js`, `assets/js/admin/telemetry.js`, the updated tests, and this release documentation. The complete coordinated upload must still include the undelivered 7D module and pending `database.rules.json` query indexes.

## Production smoke test

1. Open POS as cashier and confirm the role lands directly in POS.
2. Search by a partial product name, switch categories, and clear the search.
3. Add a sized/customized item, increase and decrease its quantity, then remove it.
4. Confirm the order rail and Ready/Waiting badge react correctly.
5. Complete cash and non-cash sales and verify the receipt, inventory, and financial records are unchanged.
6. Repeat on the cashier tablet and confirm the ticket and Charge action remain reachable.
