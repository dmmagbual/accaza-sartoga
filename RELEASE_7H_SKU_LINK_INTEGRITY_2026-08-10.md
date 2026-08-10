# Release 7H — SKU Link Integrity

**Build:** admin v176, customer v46, service-worker cache v73

## Delivered

- Detects recipe-linked inventory automatically from saved recipes, options, choice costing, consumables, and explicit new-item intent.
- Requires an active approved SKU before an existing recipe item can be received.
- Lets a new purchase item be marked “Used in recipes” and creates its first approved SKU from the required brand.
- Saves `skuId` and the resolved SKU brand on stock receipts, purchase invoice lines, and inventory batches.
- Applies the same SKU requirement to the Inventory “+ Stock” shortcut so the control cannot be bypassed.
- Adds Recipe/SKU status stamps to Inventory and a “Recipe items without SKU” filter.
- Keeps recipes linked to the generic inventory master and preserves weighted-average costing.
- Leaves legacy opening batches and historical receipts unchanged; they remain valid but are not presented as SKU-linked records.
- Extends the existing Purchases permission to approved-SKU and batch records so authorized purchasing staff can complete the required linkage.
- Replaces the full-width three-card service banner with one compact header line: a bright online dot, shift cashier identity, and an actionable offline-queue sync note.
- Repairs the customer reservation path with native time-slot buttons and explicit module-safe handlers that reveal and focus the reservation form.
- Applies the same resilient time-slot controls to the portal reservation preview so both entry points behave consistently.

## Smoke test

1. Open Inventory and select “Recipe items without SKU”; confirm only recipe-linked items with no active SKU appear.
2. Open Purchases and choose an existing recipe item with no SKU; confirm Receive all is blocked and “Add an approved SKU” is shown.
3. Add an active SKU, return to Purchases, select it, and receive stock.
4. Confirm the resulting receipt, purchase invoice line, and inventory batch contain the same `skuId`.
5. Create a new purchase item with “Used in recipes” checked; confirm its SKU brand is required and an approved SKU is created.
6. Confirm non-recipe or overhead purchases can still be received without a SKU.
7. Select an available customer reservation date and time; confirm the reservation-details form opens and receives the selected date and time.
8. Hard-refresh once after deployment to activate cache v73.

## Deployment

Publish the hosted application through GitHub Pages after the quality gate passes, then deploy the updated Realtime Database Rules with `firebase deploy --only database`. No Firebase Functions deployment is required.
