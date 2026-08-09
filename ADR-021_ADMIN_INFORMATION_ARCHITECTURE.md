# ADR-021 — Role-Aware Admin Information Architecture

**Date:** 9 August 2026  
**Status:** Accepted — Release 7C

## Decision

The admin portal will use seven primary work areas: POS, Overview, Orders & Operations, Inventory, Financials, Customers, and Settings. Only the selected area exposes its secondary pages. POS remains a permanent, visually dominant primary control rather than an ordinary administrative tab.

## Role landing

- Cashier opens directly in POS.
- Kitchen opens directly in Orders.
- Finance opens directly in Financials when at least one permitted finance page is available.
- Owner, manager, and admin retain Overview as their home.

Existing Firebase roles and page permissions remain authoritative. Navigation visibility does not grant data access.

## Content placement

- Register operations belongs with Orders & Operations.
- Petty cash belongs in Financials.
- Packages remain with Inventory/catalog work.
- Channel pricing and menu de-duplication belong in Settings and maintenance.
- Operations Center stays beside Overview so release and operational warnings remain visible.

## Responsive behavior

The primary rail scrolls horizontally on narrow screens; contextual secondary tabs use a separate horizontal strip. The design avoids collapsing all pages back into one crowded mobile row.
