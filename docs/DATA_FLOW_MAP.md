# Accaza data-flow map

> **Generated file — do not edit by hand.** `npm run build:runtime` rebuilds it automatically after bundling; run `npm run map:data-flow` on its own after editing only `functions/lib/` or `tools/data-flow-money-paths.json`. `npm test` fails while this file is stale or a money-path link is broken.

Use this map to find *where to look*, then confirm in the source it points to. It comes from static analysis: helpers are followed by name, so calls made through variables or paths built at runtime can be missed (absence from this map is not proof that nothing writes a node), and a shared helper can make a function look like it touches more nodes than one run really does.

Screens and server code connect through the Realtime Database rather than through imports: a screen writes a record or calls a callable, and a Cloud Function that watches that record reacts. Sources are the `src/functions/` sections that `npm run build:runtime` joins into `functions/index.js`; search the file for `exports.<name>` to find a function.

Inventory: 39 database triggers, 117 callables, 6 scheduled jobs, 0 backup markers. Generated from `src/functions/` and `functions/lib/`.

## 1. Money paths

Curated in `tools/data-flow-money-paths.json` and checked against the scan on every `npm test`: each function must exist, each trigger must still watch the stated path, that path must be written by an earlier step, and each step must still write the nodes listed.

### Till sale (POS Charge & Complete)

Every till sale, online or replayed after being offline, reaches the server once through `syncOfflinePosSale`. Everything after that is a reaction to the saved order record.

| # | Function | Runs when | Writes | Source |
|---|---|---|---|---|
| 1 | `syncOfflinePosSale` | called by a screen | `orders`, `offlinePosSync`, `shifts` | `src/functions/30-orders.js` |
|   | ↳ Accepts the sale exactly once (client transaction id) and saves the authoritative order. | | | |
| 2 | `onOrderFinancialPosting` | `/orders/{orderId}` changes | `financialMovements` | `src/functions/40-sales-finance.js` |
|   | ↳ Posts revenue, tax and each tender as a balanced, immutable movement. | | | |
| 3 | `onOrderFinalize` | `/orders/{orderId}` changes | `orderInventoryPlans`, `inventoryMovements`, `inventoryBalances`, `orders`, `uncostedSales` | `src/functions/50-inventory.js` |
|   | ↳ Deducts stock from the recipe plan and stamps `cogsSnapshot` on the order; lines with no usable recipe go to uncostedSales. | | | |
| 4 | `mirrorPosMovementToBooks` | `/financialMovements/{movementId}` changes | `books` | `src/functions/10-books-bridge.js` |
|   | ↳ Projects each movement into the Finance Books journal; unmapped accounts go to books/reviewQueue. | | | |
| 5 | `mirrorPosCogsToBooks` | `/orders/{orderId}/cogsSnapshot` changes | `books` | `src/functions/10-books-bridge.js` |
|   | ↳ Projects the order's COGS into the Finance Books journal. | | | |
| 6 | `updateBooksMonthlyNet` | `/books/journal/{entryId}` changes | `books` | `src/functions/10-books-bridge.js` |
|   | ↳ Keeps the daily and monthly net totals the Books reports read. | | | |
| 7 | `updateCashBalanceSummary` | `/financialMovements/{movementId}` changes | `cashBalanceSummaryPending`, `cashFlowDaily` | `src/functions/23-cash-balance-summary.js` |
|   | ↳ Keeps the cash balance and cash-flow summaries current. | | | |

Shows in: Admin Sales History and Daily Report (orders); inventory balances; Finance Books journal, P&L and Balance Sheet (books/journal and monthly net).

If the numbers are wrong: follow the order id downstream: the /orders record (status, inventoryDeducted, cogsSnapshot), its /financialMovements, the /books/journal entry, then /books/reviewQueue for unmapped accounts. The first record that is missing points at the step that failed.

### Online and QR order (customer app)

The customer app creates the order; staff or the scheduler move it to completed. Posting then follows the same chain as a till sale.

| # | Function | Runs when | Writes | Source |
|---|---|---|---|---|
| 1 | `createOnlineOrder` | called by a screen | `orders`, `customerOrders`, `activeOrders` | `src/functions/30-orders.js` |
|   | ↳ Server prices the order and saves it; the customer index is keyed by Firebase UID. | | | |
| 2 | `acceptOnlineOrder` | called by a screen | `orders` | `src/functions/20-portal-operations.js` |
|   | ↳ Staff accept the order. | | | |
| 3 | `updateOrderStatus` | called by a screen | `orders`, `orderStatusCommands` | `src/functions/20-portal-operations.js` |
|   | ↳ Staff status changes, with transition history and idempotency. | | | |
| 4 | `confirmOrderReceived` | called by a screen | `orders` | `src/functions/30-orders.js` |
|   | ↳ Customer confirms receipt. | | | |
| 5 | `autoCompleteReadyOnlineOrders` | schedule | `orders` | `src/functions/60-maintenance.js` |
|   | ↳ Scheduled every 15 minutes: completes ready orders nobody closed. | | | |
| 6 | `onOrderFinancialPosting` | `/orders/{orderId}` changes | `financialMovements` | `src/functions/40-sales-finance.js` |
|   | ↳ Posts the sale to the account the customer chose to pay into. | | | |
| 7 | `onOrderFinalize` | `/orders/{orderId}` changes | `inventoryMovements`, `orders` | `src/functions/50-inventory.js` |
|   | ↳ Deducts stock and stamps COGS. | | | |
| 8 | `mirrorPosMovementToBooks` | `/financialMovements/{movementId}` changes | `books` | `src/functions/10-books-bridge.js` |
| 9 | `mirrorPosCogsToBooks` | `/orders/{orderId}/cogsSnapshot` changes | `books` | `src/functions/10-books-bridge.js` |

Shows in: Customer order tracking (customerOrders); live order cards (activeOrders); then the same reports as a till sale.

If the numbers are wrong: check the order's status first; nothing posts until it is completed. Then follow the till-sale checks.

### Refund, void and order correction

A manager adjustment changes the order record; the posting and inventory triggers react with linked reversals rather than editing the original sale.

| # | Function | Runs when | Writes | Source |
|---|---|---|---|---|
| 1 | `processOrderAdjustment` | called by a screen | `orders`, `orderCorrections`, `financialMovements` | `src/functions/43g-order-adjustments.js` |
|   | ↳ Records the refund, void or correction; requests a stock return when restocking. | | | |
| 2 | `onOrderFinancialPosting` | `/orders/{orderId}` changes | `financialMovements` | `src/functions/40-sales-finance.js` |
|   | ↳ Posts a reversal for the refunded or voided amount, linked to the original sale. | | | |
| 3 | `onOrderInventoryReversal` | `/orders/{orderId}/inventoryReversalRequested` changes | `inventoryMovements`, `inventoryBalances`, `financialMovements`, `orders` | `src/functions/50-inventory.js` |
|   | ↳ Returns the stock the sale used and offsets its COGS; waits for finalization if the sale is still being costed. | | | |
| 4 | `repairFinanceDates` | called by a screen | `financialMovements`, `orders`, `archivedOrders`, `operationalAudit` | `src/functions/44-reconciliation.js` |
|   | ↳ Finance Books date repair: re-dates a void posted after its sale onto the sale date (net-zero reversal plus repost) and, when ticked, requests the stock return. | | | |
| 5 | `onArchivedOrderInventoryReversal` | `/archivedOrders/{orderId}/inventoryReversalRequested` changes | `inventoryMovements`, `inventoryBalances`, `financialMovements`, `archivedOrders` | `src/functions/50-inventory.js` |
|   | ↳ The same stock return for an order already archived; COGS reversal dated on the void accounting date. | | | |
| 6 | `mirrorPosMovementToBooks` | `/financialMovements/{movementId}` changes | `books` | `src/functions/10-books-bridge.js` |
| 7 | `updateBooksMonthlyNet` | `/books/journal/{entryId}` changes | `books` | `src/functions/10-books-bridge.js` |

Shows in: Sales History refund/void columns; inventory balances; Finance Books journal and P&L.

If the numbers are wrong: check the order's refundAmount, voided and inventoryReversed fields, then the reversal movements linked to the order id, then the journal.

### Shift close and cash custody

The Register screen writes the closed shift directly. Server triggers post the shift's cash into custody and record the close receipt.

Starts from: `shifts/{shiftId}/status (Register screen, Close Shift)`, `shifts/{shiftId}/payIns (Register screen, Pay-in)`

| # | Function | Runs when | Writes | Source |
|---|---|---|---|---|
| 1 | `onShiftCloseFinancial` | `/shifts/{shiftId}/status` changes | `financialMovements`, `cashCustody`, `shifts` | `src/functions/40-sales-finance.js` |
|   | ↳ Moves the counted cash into the Undeposited Collection custody pool and posts the shift's movements. | | | |
| 2 | `onShiftCloseAssurance` | `/shifts/{shiftId}/status` changes | `shiftCloseReceipts`, `ownerDailySummaries` | `src/functions/25-pos-assurance.js` |
|   | ↳ Writes the tamper-evident close receipt and owner daily summary, flagging outstanding inventory or finance postings. | | | |
| 3 | `onShiftPayInsFinancial` | `/shifts/{shiftId}/payIns` changes | `financialMovements` | `src/functions/40-sales-finance.js` |
|   | ↳ Posts register pay-ins. | | | |
| 4 | `mirrorPosMovementToBooks` | `/financialMovements/{movementId}` changes | `books` | `src/functions/10-books-bridge.js` |
| 5 | `updateCashBalanceSummary` | `/financialMovements/{movementId}` changes | `cashBalanceSummaryPending` | `src/functions/23-cash-balance-summary.js` |

Shows in: Z report and Daily Report; Undeposited Collection; Finance Books cash accounts.

If the numbers are wrong: compare the shift's zReport with /shiftCloseReceipts for that shift (status posting_follow_up lists what is outstanding), then the shift's movements and /cashCustody.

### Purchase, supplier bill and payment

Finance Books and the Admin Purchases screen post through one financial command; corrections go through a separate, controlled callable.

| # | Function | Runs when | Writes | Source |
|---|---|---|---|---|
| 1 | `postFinancialCommand` | called by a screen | `purchaseInvoices`, `payables`, `payablePayments`, `financialMovements` | `src/functions/42a-financial-command-entry.js` |
|   | ↳ Actions include purchase_paid, purchase_owner_funded, create_payable, pay_payable and reverse_payable_payment. | | | |
| 2 | `managePurchaseCorrection` | called by a screen | `purchaseInvoices`, `payables`, `financialMovements`, `inventoryBalances` | `src/functions/43b-purchase-corrections.js` |
|   | ↳ Amend or reverse a posted purchase with linked reversals. | | | |
| 3 | `mirrorPosMovementToBooks` | `/financialMovements/{movementId}` changes | `books` | `src/functions/10-books-bridge.js` |
|   | ↳ Builds a single journal entry per purchase, using the purchase invoice for line detail. | | | |
| 4 | `updateBooksMonthlyNet` | `/books/journal/{entryId}` changes | `books` | `src/functions/10-books-bridge.js` |

Shows in: Admin Purchases; Finance Books Payables and journal.

If the numbers are wrong: start from the purchase invoice (PUR number), then its payable and payments, then the movements that cite it, then the journal entry.

### Cash payment voucher (petty cash)

A voucher is saved through a callable; a trigger on the voucher record posts it and allocates the cash from custody.

| # | Function | Runs when | Writes | Source |
|---|---|---|---|---|
| 1 | `managePettyVoucher` | called by a screen | `pettyCashVouchers` | `src/functions/21-staff-advance-liquidation.js` |
|   | ↳ Creates, corrects or reverses a cash payment voucher. | | | |
| 2 | `onPettyVoucherFinancial` | `/pettyCashVouchers/{voucherId}` changes | `financialMovements`, `cashCustody` | `src/functions/41-expense-assets.js` |
|   | ↳ Posts the voucher and allocates the cash from the custody pool. | | | |
| 3 | `mirrorPosMovementToBooks` | `/financialMovements/{movementId}` changes | `books` | `src/functions/10-books-bridge.js` |
| 4 | `updateCashBalanceSummary` | `/financialMovements/{movementId}` changes | `cashBalanceSummaryPending` | `src/functions/23-cash-balance-summary.js` |

Shows in: Cash Payments; Undeposited Collection; Finance Books expense and cash accounts.

If the numbers are wrong: check the voucher's cashCustodyStatus and cashCustodyShortfall fields, then its movement, then the journal.

### GrabFood and FoodPanda payout

Platform sales post gross revenue and leave the expected net as a receivable until a payout is settled against matched orders.

| # | Function | Runs when | Writes | Source |
|---|---|---|---|---|
| 1 | `settlePlatformPayout` | called by a screen | `platformPayouts`, `financialMovements` | `src/functions/43d-platform-settlement.js` |
|   | ↳ Settles a payout against matched orders only. | | | |
| 2 | `reversePlatformPayout` | called by a screen | `platformPayouts`, `financialMovements` | `src/functions/43e-platform-reversal.js` |
|   | ↳ Reverses a settled payout with linked movements. | | | |
| 3 | `mirrorPosMovementToBooks` | `/financialMovements/{movementId}` changes | `books` | `src/functions/10-books-bridge.js` |

Shows in: Platform payouts screen; Finance Books 1100 Accounts Receivable - Platforms and bank accounts.

If the numbers are wrong: check the payout's matched orders and amounts, then its movements, then the journal.

## 2. When a record changes, what reacts

Database node → the triggers that fire when something under it is written.

| Node | Trigger | Watches | Event | Source |
|---|---|---|---|---|
| `archivedOrders` | `replicateArchivedOrderToFirestore` | `/archivedOrders/{orderId}` | onValueWritten | `src/functions/61-historical-archive.js` |
| `archivedOrders` | `onArchivedOrderInventoryReversal` | `/archivedOrders/{orderId}/inventoryReversalRequested` | onValueWritten | `src/functions/50-inventory.js` |
| `books` | `updateBooksMonthlyNet` | `/books/journal/{entryId}` | onValueWritten | `src/functions/10-books-bridge.js` |
| `books` | `refreshHistoricalOrderAfterJournal` | `/books/journal/{journalId}` | onValueWritten | `src/functions/61-historical-archive.js` |
| `categories` | `updatePublicCatalogVersionOnCategories` | `/categories` | onValueWritten | `src/functions/24-public-catalog-version.js` |
| `cfLedger` | `autoRepairFinanceDateOnCashLedgerCreate` | `/cfLedger/{ledgerId}` | onValueCreated | `src/functions/44-reconciliation.js` |
| `feedbacks` | `notifyOnContactMessage` | `/feedbacks/{fbId}` | onValueCreated | `src/functions/00-bootstrap-notifications.js` |
| `financialMovements` | `mirrorPosMovementToBooks` | `/financialMovements/{movementId}` | onValueCreated | `src/functions/10-books-bridge.js` |
| `financialMovements` | `reopenFinancialCloseOnMovement` | `/financialMovements/{movementId}` | onValueCreated | `src/functions/22-close-controls.js` |
| `financialMovements` | `syncUndepositedLedgerPageIndex` | `/financialMovements/{movementId}` | onValueWritten | `src/functions/21a-undeposited-pages.js` |
| `financialMovements` | `updateCashBalanceSummary` | `/financialMovements/{movementId}` | onValueWritten | `src/functions/23-cash-balance-summary.js` |
| `menuItems` | `updatePublicCatalogVersionOnMenuItems` | `/menuItems` | onValueWritten | `src/functions/24-public-catalog-version.js` |
| `optionGroups` | `updatePublicCatalogVersionOnOptionGroups` | `/optionGroups` | onValueWritten | `src/functions/24-public-catalog-version.js` |
| `orderInventoryPlans` | `refreshHistoricalOrderAfterInventoryPlan` | `/orderInventoryPlans/{orderId}` | onValueWritten | `src/functions/61-historical-archive.js` |
| `orders` | `indexPlatformOrderRef` | `/orders/{orderId}` | onValueCreated | `src/functions/10-books-bridge.js` |
| `orders` | `notifyStaffOnOrder` | `/orders/{orderId}` | onValueCreated | `src/functions/00-bootstrap-notifications.js` |
| `orders` | `onOrderFinalize` | `/orders/{orderId}` | onValueWritten | `src/functions/50-inventory.js` |
| `orders` | `onOrderFinancialPosting` | `/orders/{orderId}` | onValueWritten | `src/functions/40-sales-finance.js` |
| `orders` | `preservePostedOrderOnDelete` | `/orders/{orderId}` | onValueDeleted | `src/functions/40-sales-finance.js` |
| `orders` | `reopenFinancialCloseOnOrderChange` | `/orders/{orderId}` | onValueWritten | `src/functions/22-close-controls.js` |
| `orders` | `syncActiveOrderProjection` | `/orders/{orderId}` | onValueWritten | `src/functions/30-orders.js` |
| `orders` | `mirrorPosCogsToBooks` | `/orders/{orderId}/cogsSnapshot` | onValueWritten | `src/functions/10-books-bridge.js` |
| `orders` | `onOrderInventoryReversal` | `/orders/{orderId}/inventoryReversalRequested` | onValueWritten | `src/functions/50-inventory.js` |
| `orders` | `notifyOnComplete` | `/orders/{orderId}/status` | onValueUpdated | `src/functions/00-bootstrap-notifications.js` |
| `packages` | `updatePublicCatalogVersionOnPackages` | `/packages` | onValueWritten | `src/functions/24-public-catalog-version.js` |
| `pettyCashReplenishments` | `onPettyReplenishmentFinancial` | `/pettyCashReplenishments/{replenishmentId}` | onValueWritten | `src/functions/41-expense-assets.js` |
| `pettyCashVouchers` | `onPettyVoucherFinancial` | `/pettyCashVouchers/{voucherId}` | onValueWritten | `src/functions/41-expense-assets.js` |
| `pettyCashVouchers` | `syncPettyVoucherAttentionIndex` | `/pettyCashVouchers/{voucherId}` | onValueWritten | `src/functions/21a-undeposited-pages.js` |
| `posActiveShift` | `pruneClosedShiftOrders` | `/posActiveShift` | onValueWritten | `src/functions/30-orders.js` |
| `posActiveShift` | `syncActiveRegisterCashFloat` | `/posActiveShift` | onValueWritten | `src/functions/10-books-bridge.js` |
| `posActiveShift` | `syncPublicOrderStatus` | `/posActiveShift` | onValueWritten | `src/functions/30-orders.js` |
| `posSettings` | `syncRegisterCashFloat` | `/posSettings/fixedFloat` | onValueWritten | `src/functions/10-books-bridge.js` |
| `reservations` | `notifyStaffOnReservation` | `/reservations/{resId}` | onValueCreated | `src/functions/00-bootstrap-notifications.js` |
| `shifts` | `onShiftOpenFinancial` | `/shifts/{shiftId}` | onValueWritten | `src/functions/40-sales-finance.js` |
| `shifts` | `onShiftPayInsFinancial` | `/shifts/{shiftId}/payIns` | onValueWritten | `src/functions/40-sales-finance.js` |
| `shifts` | `onShiftPayOutsFinancial` | `/shifts/{shiftId}/payOuts` | onValueWritten | `src/functions/40-sales-finance.js` |
| `shifts` | `onShiftCloseAssurance` | `/shifts/{shiftId}/status` | onValueWritten | `src/functions/25-pos-assurance.js` |
| `shifts` | `onShiftCloseFinancial` | `/shifts/{shiftId}/status` | onValueWritten | `src/functions/40-sales-finance.js` |
| `shifts` | `onShiftEndResolveEarlierHandovers` | `/shifts/{shiftId}/status` | onValueWritten | `src/functions/25b-shift-handover.js` |

## 3. Who writes each node

Database node → every Cloud Function whose code (or helpers) writes it. Browser screens also write some operational nodes directly under `database.rules.json`; those writers are not listed here.

| Node | Written by |
|---|---|
| `accazaAiIssues` | `manageAccazaAiIssue` |
| `accazaAiKnowledge` | `manageAccazaAiKnowledge` |
| `accazaAiProviderHealth` | `askAccazaAI`, `askAccazaAIStandalone` |
| `accountingPeriods` | `manageAccountingPeriod` |
| `activeOrders` | `acceptOnlineOrder`, `confirmOrderReceived`, `correctPlatformPresettlement`, `createOnlineOrder`, `ensureActiveOrders`, `manageOrderArchive`, `manageOrderService`, `managePosSaleRecovery`, `manageShiftHandover`, `onShiftEndResolveEarlierHandovers`, `processOrderAdjustment`, `pruneClosedShiftOrders`, `resolvePendingShiftHandovers`, `sweepOrderArchive`, `syncActiveOrderProjection`, `syncOfflinePosSale`, `updateOrderStatus` |
| `activeQrTickets` | `createQrOrderTicket`, `managePosSaleRecovery`, `manageQrOrderTicket`, `manageShiftHandover`, `onShiftEndResolveEarlierHandovers`, `resolvePendingShiftHandovers`, `syncOfflinePosSale` |
| `activityLog` | `archiveActivityLog` |
| `activityLogArchive` | `archiveActivityLog` |
| `adminPerms` | `managePortalAccount` |
| `admins` | `managePortalAccount` |
| `appCustomers` | `confirmLoyaltyLinkOtp`, `createOnlineOrder`, `linkLoyaltyByBadge`, `notifyOnComplete`, `unlinkLoyaltyFromDevice` |
| `archivedOrders` | `auditFinancialControls`, `ensureActiveOrders`, `indexPlatformOrderRef`, `manageOrderArchive`, `manageUncostedSales`, `notifyOnComplete`, `onArchivedOrderInventoryReversal`, `onOrderFinalize`, `onOrderInventoryReversal`, `preservePostedOrderOnDelete`, `pruneClosedShiftOrders`, `repairFinanceDates`, `repairOrderInventoryMarker`, `sweepOrderArchive`, `syncActiveOrderProjection` |
| `archivedQrTickets` | `createQrOrderTicket`, `managePosSaleRecovery`, `manageQrOrderTicket`, `manageShiftHandover`, `onShiftEndResolveEarlierHandovers`, `resolvePendingShiftHandovers`, `syncOfflinePosSale` |
| `bakingProducts` | `checkBakingMapping` |
| `batchCardRequests` | `postBatchCard` |
| `batchCards` | `postBatchCard`, `reverseBatchCard` |
| `books/chartCodeMigrations` | `ensureBooksJournal`, `manageBooksAccount`, `manageCashAccount`, `managePettyVoucher`, `managePurchaseCorrection`, `manageUncostedSales`, `onArchivedOrderInventoryReversal`, `onOrderFinalize`, `onOrderInventoryReversal`, `postBatchCard`, `postInventoryMovements`, `processOrderAdjustment`, `reconcilePurchasePayable`, `repairOrderInventoryMarker`, `reverseBatchCard`, `reviewDiscrepancy` |
| `books/config` | `ensureBooksJournal`, `manageBooksAccount`, `manageCashAccount` |
| `books/dailyNet` | `backupDatabaseDaily`, `ensureBooksJournal`, `evaluateProductionHealth`, `getOperationalExceptions`, `getProductionCertification`, `getProductionValidation`, `manageBooksAccount`, `pruneEphemeralNodes`, `repairReversalAccountingDate`, `runDatabaseBackupNow`, `updateBooksMonthlyNet` |
| `books/journal` | `ensureBooksJournal`, `manageBooksAccount`, `manageCashAccount`, `managePettyVoucher`, `managePurchaseCorrection`, `manageUncostedSales`, `mirrorPosCogsToBooks`, `mirrorPosMovementToBooks`, `onArchivedOrderInventoryReversal`, `onOrderFinalize`, `onOrderInventoryReversal`, `postBatchCard`, `postInventoryMovements`, `processOrderAdjustment`, `reconcilePurchasePayable`, `repairOrderInventoryMarker`, `repairReversalAccountingDate`, `reverseBatchCard`, `reviewDiscrepancy`, `setPlatformPayoutDate`, `syncActiveRegisterCashFloat`, `syncRegisterCashFloat` |
| `books/monthlyNet` | `backupDatabaseDaily`, `ensureBooksJournal`, `evaluateProductionHealth`, `getOperationalExceptions`, `getProductionCertification`, `getProductionValidation`, `manageBooksAccount`, `pruneEphemeralNodes`, `repairReversalAccountingDate`, `runDatabaseBackupNow`, `updateBooksMonthlyNet` |
| `books/monthlyNetMeta` | `backupDatabaseDaily`, `ensureBooksJournal`, `evaluateProductionHealth`, `getOperationalExceptions`, `getProductionCertification`, `getProductionValidation`, `manageBooksAccount`, `pruneEphemeralNodes`, `repairReversalAccountingDate`, `runDatabaseBackupNow`, `updateBooksMonthlyNet` |
| `books/reconciliationConfig` | `ensureBooksJournal` |
| `books/reviewQueue` | `ensureBooksJournal`, `mirrorPosMovementToBooks` |
| `booksChart` | `ensureBooksJournal`, `manageBooksAccount`, `manageCashAccount`, `managePettyVoucher`, `managePurchaseCorrection`, `manageUncostedSales`, `onArchivedOrderInventoryReversal`, `onOrderFinalize`, `onOrderInventoryReversal`, `postBatchCard`, `postInventoryMovements`, `processOrderAdjustment`, `reconcilePurchasePayable`, `repairOrderInventoryMarker`, `reverseBatchCard`, `reviewDiscrepancy` |
| `cashBalanceSummaryPending` | `apIntegrityBaseline`, `getCurrentCashBalances`, `getUndepositedControlSnapshot`, `manageBooksAccount`, `managePettyVoucher`, `processOrderAdjustment`, `updateCashBalanceSummary` |
| `cashCustody` | `ensureFinancialLedger`, `ensureShiftReference`, `managePettyVoucher`, `managePurchaseCorrection`, `onPettyVoucherFinancial`, `onShiftCloseFinancial`, `postFinancialCommand`, `reconcileUndepositedCustody`, `repairClosedShiftTurnover`, `repairPettyVoucherFinancial`, `repairReversalAccountingDate`, `retireRevolvingFund`, `reviewDiscrepancy`, `setUndepositedOpeningBalance` |
| `cashCustodyOpenIndex` | `auditFinancialControls`, `autoRepairFinanceDateOnCashLedgerCreate`, `correctPlatformPresettlement`, `ensureBooksJournal`, `ensureFinancialLedger`, `getUndepositedControlSnapshot`, `getUndepositedPage`, `legacyOwnerCapitalReset`, `manageFixedAsset`, `managePettyVoucher`, `managePurchaseCorrection`, `manageUncostedSales`, `onArchivedOrderInventoryReversal`, `onOrderFinalize`, `onOrderFinancialPosting`, `onOrderInventoryReversal`, `onPettyReplenishmentFinancial`, `onPettyVoucherFinancial`, `onShiftCloseFinancial`, `onShiftPayInsFinancial`, `postBatchCard`, `postFinancialCommand`, `postInventoryMovements`, `processOrderAdjustment`, `reconcilePurchasePayable`, `recordPlatformCatchup`, `repairClosedShiftTurnover`, `repairFinanceDates`, `repairOrderInventoryMarker`, `repairPettyExpenseClassifications`, `repairPettyVoucherFinancial`, `repairReversalAccountingDate`, `repairReversedPayoutDeposit`, `repairShiftDeclaredTips`, `retireRevolvingFund`, `reverseBatchCard`, `reversePlatformPayout`, `reviewDiscrepancy`, `setUndepositedOpeningBalance`, `settlePlatformPayout` |
| `cashFlowDaily` | `apIntegrityBaseline`, `getCurrentCashBalances`, `getUndepositedControlSnapshot`, `manageBooksAccount`, `managePettyVoucher`, `processOrderAdjustment`, `updateCashBalanceSummary` |
| `cashFlowMonthly` | `apIntegrityBaseline`, `getCurrentCashBalances`, `getUndepositedControlSnapshot`, `manageBooksAccount`, `managePettyVoucher`, `processOrderAdjustment`, `updateCashBalanceSummary` |
| `cashFlowOpenings` | `apIntegrityBaseline`, `getCurrentCashBalances`, `getUndepositedControlSnapshot`, `manageBooksAccount`, `managePettyVoucher`, `processOrderAdjustment`, `updateCashBalanceSummary` |
| `cfAccounts` | `manageBooksAccount`, `manageCashAccount` |
| `cfLedger` | `ensureFinancialLedger`, `managePettyVoucher`, `managePurchaseCorrection`, `onOrderFinancialPosting`, `onPettyVoucherFinancial`, `postFinancialCommand`, `processOrderAdjustment`, `recordPlatformCatchup`, `repairPettyVoucherFinancial`, `repairReversalAccountingDate`, `repairReversedPayoutDeposit`, `reversePlatformPayout`, `setPlatformPayoutDate`, `settlePlatformPayout` |
| `chartOfAccounts` | `manageChartAccount`, `postFinancialCommand` |
| `clientTelemetryDaily` | `recordClientTelemetry` |
| `customerOrders` | `acceptOnlineOrder`, `autoCompleteReadyOnlineOrders`, `confirmOrderReceived`, `createOnlineOrder`, `processOrderAdjustment`, `updateOrderStatus` |
| `deletionAudit` | `preservePostedOrderOnDelete` |
| `deletionAudit/orders` | `manageOrderArchive` |
| `discrepancies` | `legacyOwnerCapitalReset`, `managePettyVoucher`, `managePurchaseCorrection`, `manageShiftHandover`, `manageUncostedSales`, `onArchivedOrderInventoryReversal`, `onOrderFinalize`, `onOrderInventoryReversal`, `onShiftEndResolveEarlierHandovers`, `postBatchCard`, `postInventoryMovements`, `processOrderAdjustment`, `reopenDiscrepancy`, `repairOrderInventoryMarker`, `resolvePendingShiftHandovers`, `reverseBatchCard`, `reviewDiscrepancy` |
| `dragonQuestConfig/activeSeasonId` | `manageDragonQuest` |
| `dragonQuestEnrollments` | `enrollDragonQuest` |
| `dragonQuestLedger` | `enrollDragonQuest` |
| `dragonQuestMissions` | `manageDragonQuest` |
| `dragonQuestSeasons` | `manageDragonQuest` |
| `financialApprovals` | `consumeManagerApproval`, `correctPlatformPresettlement`, `createManagerApproval`, `manageOrderArchive`, `managePettyVoucher`, `managePurchaseCorrection`, `openLinkedPosShift`, `processOrderAdjustment`, `reconcileUndepositedCustody`, `recordPlatformCatchup`, `reopenDiscrepancy`, `repairClosedShiftTurnover`, `repairReversedPayoutDeposit`, `repairShiftDeclaredTips`, `retireRevolvingFund`, `reversePlatformPayout`, `reviewDiscrepancy`, `runFinancialClose`, `setUndepositedOpeningBalance`, `settlePlatformPayout` |
| `financialCloseClaims` | `managePettyVoucher`, `managePurchaseCorrection`, `runFinancialClose` |
| `financialCloseIndex` | `managePettyVoucher`, `managePurchaseCorrection`, `reopenFinancialCloseOnMovement`, `reopenFinancialCloseOnOrderChange`, `runFinancialClose`, `setPlatformPayoutDate` |
| `financialCloses` | `managePettyVoucher`, `managePurchaseCorrection`, `reopenFinancialCloseOnMovement`, `reopenFinancialCloseOnOrderChange`, `runFinancialClose`, `setPlatformPayoutDate` |
| `financialCommandClaims` | `auditFinancialControls`, `autoRepairFinanceDateOnCashLedgerCreate`, `correctPlatformPresettlement`, `ensureBooksJournal`, `ensureFinancialLedger`, `legacyOwnerCapitalReset`, `manageFixedAsset`, `managePettyVoucher`, `managePurchaseCorrection`, `manageUncostedSales`, `onArchivedOrderInventoryReversal`, `onOrderFinalize`, `onOrderFinancialPosting`, `onOrderInventoryReversal`, `onPettyReplenishmentFinancial`, `onPettyVoucherFinancial`, `onShiftCloseFinancial`, `onShiftPayInsFinancial`, `postBatchCard`, `postFinancialCommand`, `postInventoryMovements`, `processOrderAdjustment`, `reconcilePurchasePayable`, `recordPlatformCatchup`, `repairClosedShiftTurnover`, `repairFinanceDates`, `repairOrderInventoryMarker`, `repairPettyExpenseClassifications`, `repairPettyVoucherFinancial`, `repairReversedPayoutDeposit`, `repairShiftDeclaredTips`, `retireRevolvingFund`, `reverseBatchCard`, `reversePlatformPayout`, `reviewDiscrepancy`, `setUndepositedOpeningBalance`, `settlePlatformPayout` |
| `financialMovements` | `auditFinancialControls`, `autoRepairFinanceDateOnCashLedgerCreate`, `correctPlatformPresettlement`, `ensureBooksJournal`, `ensureFinancialLedger`, `legacyOwnerCapitalReset`, `manageCashAccount`, `manageFixedAsset`, `managePettyVoucher`, `managePurchaseCorrection`, `manageUncostedSales`, `onArchivedOrderInventoryReversal`, `onOrderFinalize`, `onOrderFinancialPosting`, `onOrderInventoryReversal`, `onPettyReplenishmentFinancial`, `onPettyVoucherFinancial`, `onShiftCloseFinancial`, `onShiftPayInsFinancial`, `postBatchCard`, `postFinancialCommand`, `postInventoryMovements`, `processOrderAdjustment`, `reconcilePurchasePayable`, `recordPlatformCatchup`, `repairClosedShiftTurnover`, `repairFinanceDates`, `repairOrderInventoryMarker`, `repairPettyExpenseClassifications`, `repairPettyVoucherFinancial`, `repairReversalAccountingDate`, `repairReversedPayoutDeposit`, `repairShiftDeclaredTips`, `retireRevolvingFund`, `reverseBatchCard`, `reversePlatformPayout`, `reviewDiscrepancy`, `setPlatformPayoutDate`, `setUndepositedOpeningBalance`, `settlePlatformPayout` |
| `fixedAssets` | `manageFixedAsset`, `managePurchaseCorrection` |
| `historicalArchiveSync` | `backupDatabaseDaily`, `evaluateProductionHealth`, `getOperationalExceptions`, `getProductionCertification`, `getProductionValidation`, `manageHistoricalOrderArchive`, `refreshHistoricalOrderAfterInventoryPlan`, `refreshHistoricalOrderAfterJournal`, `replicateArchivedOrderToFirestore`, `resolveBackgroundFailure`, `runDatabaseBackupNow` |
| `incidentCommandClaims` | `manageIncident` |
| `incidents` | `manageIncident` |
| `inventory` | `ensureInventoryLedger`, `managePurchaseCorrection`, `manageUncostedSales`, `onArchivedOrderInventoryReversal`, `onOrderFinalize`, `onOrderInventoryReversal`, `postBatchCard`, `postInventoryMovements`, `processOrderAdjustment`, `repairOrderInventoryMarker`, `reverseBatchCard` |
| `inventoryAccounting` | `ensureInventoryLedger`, `managePurchaseCorrection`, `manageUncostedSales`, `onArchivedOrderInventoryReversal`, `onOrderFinalize`, `onOrderInventoryReversal`, `postBatchCard`, `postInventoryMovements`, `processOrderAdjustment`, `repairOrderInventoryMarker`, `reverseBatchCard` |
| `inventoryBalances` | `ensureInventoryLedger`, `managePurchaseCorrection`, `manageUncostedSales`, `onArchivedOrderInventoryReversal`, `onOrderFinalize`, `onOrderInventoryReversal`, `postBatchCard`, `postInventoryMovements`, `processOrderAdjustment`, `repairOrderInventoryMarker`, `reverseBatchCard` |
| `inventoryBatch` | `managePurchaseCorrection`, `manageSupplier` |
| `inventoryMovements` | `ensureInventoryLedger`, `managePurchaseCorrection`, `manageUncostedSales`, `onArchivedOrderInventoryReversal`, `onOrderFinalize`, `onOrderInventoryReversal`, `postBatchCard`, `postInventoryMovements`, `processOrderAdjustment`, `repairOrderInventoryMarker`, `reverseBatchCard` |
| `loyaltyBalances` | `claimLoyaltyReward`, `releaseLoyaltyClaim` |
| `loyaltyEarningRules` | `manageLoyaltyEarningRule` |
| `loyaltyEarningRules/rule_red_per_order` | `completeLoyaltySignup` |
| `loyaltyEarningRules/rule_signup_bonus` | `completeLoyaltySignup` |
| `loyaltyEarningRules/rule_yellow_1000` | `completeLoyaltySignup` |
| `loyaltyEarningRules/rule_yellow_500` | `completeLoyaltySignup` |
| `loyaltyLedger` | `claimLoyaltyReward`, `confirmLoyaltyBadgeRecovery`, `releaseLoyaltyClaim` |
| `loyaltyLinkThrottle` | `startLoyaltyBadgeRecovery`, `startLoyaltyLinkOtp` |
| `loyaltyMembers` | `completeLoyaltySignup`, `confirmLoyaltyBadgeRecovery`, `manageLoyaltyMemberAnonymize`, `manageLoyaltyMemberStatus` |
| `loyaltyMembersByPhone` | `completeLoyaltySignup`, `manageLoyaltyMemberAnonymize` |
| `loyaltyOtp` | `claimLoyaltyReward`, `completeLoyaltySignup`, `confirmLoyaltyBadgeRecovery`, `confirmLoyaltyLinkOtp`, `startLoyaltyBadgeRecovery`, `startLoyaltyLinkOtp`, `startLoyaltyRedeemOtp`, `startLoyaltySignup` |
| `loyaltyRewardCatalog` | `manageLoyaltyRewardCatalog` |
| `loyaltyRewardCatalog/reward_20_off` | `completeLoyaltySignup` |
| `loyaltyRewardCatalog/reward_free_drink` | `completeLoyaltySignup` |
| `loyaltyRewards` | `claimLoyaltyReward`, `finalizeLoyaltyRedemption`, `releaseLoyaltyClaim` |
| `loyaltyStats/redemptionCostByReward` | `finalizeLoyaltyRedemption` |
| `menuItems` | `manageUncostedSales` |
| `offlinePosSync` | `managePosSaleRecovery`, `manageShiftHandover`, `onShiftEndResolveEarlierHandovers`, `resolvePendingShiftHandovers`, `syncOfflinePosSale` |
| `operationalAudit` | `acceptOnlineOrder`, `apIntegrityBaseline`, `askAccazaAI`, `askAccazaAIStandalone`, `auditFinancialControls`, `autoCompleteReadyOnlineOrders`, `autoRepairFinanceDateOnCashLedgerCreate`, `backfillPurchaseDocumentNumbers`, `backupDatabaseDaily`, `checkBakingMapping`, `correctPlatformPresettlement`, `ensureBooksJournal`, `ensureFinancialLedger`, `evaluateProductionHealth`, `getOperationalExceptions`, `getProductionCertification`, `getProductionValidation`, `getSupplierAdvanceDetails`, `getUndepositedControlSnapshot`, `getUndepositedPage`, `legacyOwnerCapitalReset`, `manageAccazaAiIssue`, `manageAccazaAiKnowledge`, `manageAccountingPeriod`, `manageBooksAccount`, `manageCashAccount`, `manageDragonQuest`, `manageHistoricalOrderArchive`, `manageIncident`, `manageLoyaltyCurrency`, `manageLoyaltyEarningRule`, `manageLoyaltyMemberAnonymize`, `manageLoyaltyMemberStatus`, `manageLoyaltyRewardCatalog`, `manageOrderArchive`, `manageOrderService`, `managePettyVoucher`, `managePortalAccount`, `managePosSaleRecovery`, `managePosShiftCrew`, `managePosStaffIdentity`, `managePurchaseCorrection`, `manageQrOrderTicket`, `manageShiftHandover`, `manageStaffMessage`, `manageSupplier`, `manageUncostedSales`, `onArchivedOrderInventoryReversal`, `onOrderFinalize`, `onOrderInventoryReversal`, `onPettyVoucherFinancial`, `onShiftCloseAssurance`, `onShiftEndResolveEarlierHandovers`, `openLinkedPosShift`, `postBatchCard`, `postFinancialCommand`, `postInventoryMovements`, `prepareQuarterlyTaxReturn`, `processOrderAdjustment`, `reconcilePurchasePayable`, `reconcileUndepositedCustody`, `recordPlatformCatchup`, `reopenDiscrepancy`, `repairClosedShiftTurnover`, `repairFinanceDates`, `repairOrderInventoryMarker`, `repairPettyExpenseClassifications`, `repairPettyVoucherFinancial`, `repairReversalAccountingDate`, `repairReversedPayoutDeposit`, `repairShiftDeclaredTips`, `reportPosDeviceHealth`, `resolveBackgroundFailure`, `resolvePendingShiftHandovers`, `retireRevolvingFund`, `reverseBatchCard`, `reversePlatformPayout`, `reviewDiscrepancy`, `runDatabaseBackupNow`, `runFinancialClose`, `saveSharedChoiceIngredients`, `setCompanyInfo`, `setPlatformPayoutDate`, `setTaxSettings`, `setUndepositedOpeningBalance`, `settlePlatformPayout`, `signOutAllPortalSessions`, `sweepOrderArchive`, `syncActiveRegisterCashFloat`, `syncOfflinePosSale`, `syncRegisterCashFloat`, `updateOrderStatus` |
| `orderCorrectionCommands` | `processOrderAdjustment` |
| `orderCorrections` | `processOrderAdjustment` |
| `orderInventoryPlans` | `managePosSaleRecovery`, `manageShiftHandover`, `manageUncostedSales`, `onOrderFinalize`, `onShiftEndResolveEarlierHandovers`, `repairOrderInventoryMarker`, `resolvePendingShiftHandovers`, `syncOfflinePosSale` |
| `orderLocks` | `createOnlineOrder` |
| `orderStatusCommands` | `updateOrderStatus` |
| `orders` | `acceptOnlineOrder`, `auditFinancialControls`, `autoCompleteReadyOnlineOrders`, `confirmOrderReceived`, `createOnlineOrder`, `ensureActiveOrders`, `indexPlatformOrderRef`, `manageOrderArchive`, `manageOrderService`, `managePosSaleRecovery`, `manageShiftHandover`, `manageUncostedSales`, `notifyOnComplete`, `onArchivedOrderInventoryReversal`, `onOrderFinalize`, `onOrderInventoryReversal`, `onShiftEndResolveEarlierHandovers`, `processOrderAdjustment`, `pruneClosedShiftOrders`, `recordPlatformCatchup`, `repairFinanceDates`, `repairOrderInventoryMarker`, `resolvePendingShiftHandovers`, `sweepOrderArchive`, `syncActiveOrderProjection`, `syncOfflinePosSale`, `updateOrderStatus` |
| `ownerDailySummaries` | `manageShiftHandover`, `onShiftCloseAssurance` |
| `payablePayments` | `managePettyVoucher`, `postFinancialCommand` |
| `payableSettlementClaims` | `managePurchaseCorrection`, `postFinancialCommand` |
| `payables` | `backfillPurchaseDocumentNumbers`, `ensureFinancialLedger`, `manageFixedAsset`, `managePettyVoucher`, `managePurchaseCorrection`, `manageSupplier`, `onOrderFinancialPosting`, `postFinancialCommand`, `reconcilePurchasePayable`, `reviewDiscrepancy` |
| `pendingShiftHandovers` | `manageShiftHandover`, `onShiftEndResolveEarlierHandovers`, `resolvePendingShiftHandovers` |
| `pettyCashCounter` | `managePettyVoucher` |
| `pettyCashReceipts` | `backupDatabaseDaily`, `getSupplierAdvanceDetails`, `runDatabaseBackupNow` |
| `pettyCashVouchers` | `backupDatabaseDaily`, `ensureFinancialLedger`, `getSupplierAdvanceDetails`, `managePettyVoucher`, `manageSupplier`, `onPettyVoucherFinancial`, `repairPettyExpenseClassifications`, `repairPettyVoucherFinancial`, `repairReversalAccountingDate`, `runDatabaseBackupNow` |
| `pettyVoucherAttentionIndex/missing` | `getUndepositedControlSnapshot`, `getUndepositedPage`, `syncPettyVoucherAttentionIndex`, `syncUndepositedLedgerPageIndex` |
| `pettyVoucherAttentionIndex/pending` | `getUndepositedControlSnapshot`, `getUndepositedPage`, `syncPettyVoucherAttentionIndex` |
| `pettyVoucherPostingIndex` | `getUndepositedControlSnapshot`, `getUndepositedPage`, `syncUndepositedLedgerPageIndex` |
| `platformPayouts` | `repairReversedPayoutDeposit`, `reversePlatformPayout`, `setPlatformPayoutDate`, `settlePlatformPayout` |
| `platformRefDuplicates` | `correctPlatformPresettlement`, `indexPlatformOrderRef` |
| `platformRefIndex` | `correctPlatformPresettlement`, `indexPlatformOrderRef`, `recordPlatformCatchup` |
| `portalAccountMutationLock` | `managePortalAccount` |
| `portalLastSeen` | `managePortalAccount`, `signOutAllPortalSessions` |
| `portalPresence` | `managePortalAccount` |
| `posActiveShift` | `managePosSaleRecovery`, `managePosShiftCrew`, `manageShiftHandover`, `onShiftEndResolveEarlierHandovers`, `openLinkedPosShift`, `processOrderAdjustment`, `resolvePendingShiftHandovers`, `syncOfflinePosSale` |
| `posDeviceHealth` | `reportPosDeviceHealth` |
| `posSettings/optionCosts` | `saveSharedChoiceIngredients` |
| `posStaff` | `managePosStaffIdentity` |
| `posSyncAlerts` | `managePosSaleRecovery`, `manageShiftHandover`, `onShiftEndResolveEarlierHandovers`, `resolvePendingShiftHandovers`, `syncOfflinePosSale` |
| `publicCatalogVersion` | `updatePublicCatalogVersionOnCategories`, `updatePublicCatalogVersionOnMenuItems`, `updatePublicCatalogVersionOnOptionGroups`, `updatePublicCatalogVersionOnPackages` |
| `publicOrderStatus` | `syncPublicOrderStatus` |
| `purchaseInvoices` | `backfillPurchaseDocumentNumbers`, `manageFixedAsset`, `managePurchaseCorrection`, `manageSupplier`, `postFinancialCommand`, `reconcilePurchasePayable` |
| `qrOrderCounters` | `createQrOrderTicket` |
| `qrOrderLocks` | `createQrOrderTicket` |
| `rateLimits` | `readHistoricalOrders`, `readHistoricalSalesRollup` |
| `rateLimits/orders` | `createOnlineOrder`, `createQrOrderTicket` |
| `receivables` | `reviewDiscrepancy` |
| `sessionControl/cutoff` | `signOutAllPortalSessions` |
| `sessionControl/users` | `managePortalAccount` |
| `shiftCloseFollowUps` | `managePosSaleRecovery`, `manageShiftHandover`, `onShiftEndResolveEarlierHandovers`, `resolvePendingShiftHandovers` |
| `shiftCloseReceipts` | `onShiftCloseAssurance` |
| `shiftCloseVerifications` | `manageShiftHandover`, `onShiftEndResolveEarlierHandovers`, `resolvePendingShiftHandovers`, `verifyShiftCloseReadiness` |
| `shiftCrews` | `managePosShiftCrew`, `manageShiftHandover`, `onShiftCloseAssurance` |
| `shiftHandovers` | `managePosSaleRecovery`, `manageShiftHandover`, `onShiftEndResolveEarlierHandovers`, `resolvePendingShiftHandovers`, `syncOfflinePosSale` |
| `shiftSyncGates` | `managePosSaleRecovery`, `manageShiftHandover`, `onShiftEndResolveEarlierHandovers`, `resolvePendingShiftHandovers`, `syncOfflinePosSale` |
| `shiftZHistory` | `managePosSaleRecovery` |
| `shifts` | `ensureShiftReference`, `manageOrderService`, `managePosSaleRecovery`, `managePosShiftCrew`, `manageShiftHandover`, `manageSupplier`, `onShiftCloseAssurance`, `onShiftCloseFinancial`, `onShiftEndResolveEarlierHandovers`, `openLinkedPosShift`, `processOrderAdjustment`, `reopenDiscrepancy`, `repairClosedShiftTurnover`, `resolvePendingShiftHandovers`, `reviewDiscrepancy`, `syncOfflinePosSale` |
| `staffMessageReceipts` | `manageStaffMessage` |
| `staffMessages` | `manageStaffMessage` |
| `staffPushTokens` | `manageStaffMessage`, `notifyOnContactMessage`, `notifyStaffOnOrder`, `notifyStaffOnReservation`, `syncOfflinePosSale` |
| `staffReceiptIndex` | `manageStaffMessage` |
| `stockReceipts` | `managePurchaseCorrection`, `manageSupplier`, `reconcilePurchasePayable` |
| `supplierAdvanceShifts` | `auditFinancialControls`, `getSupplierAdvanceDetails`, `managePurchaseCorrection`, `manageSupplier`, `onShiftPayOutsFinancial`, `runFinancialClose` |
| `supplierNameIndex` | `manageSupplier` |
| `supplierTaxIdIndex` | `manageSupplier` |
| `suppliers` | `manageSupplier` |
| `systemHealth/backups` | `backupDatabaseDaily`, `runDatabaseBackupNow` |
| `systemHealth/historicalArchive` | `manageHistoricalOrderArchive` |
| `systemHealth/orderArchiveSweep` | `sweepOrderArchive` |
| `systemHealth/productionMonitor` | `backupDatabaseDaily`, `evaluateProductionHealth`, `runDatabaseBackupNow` |
| `systemHealth/undepositedIndexVerification` | `getUndepositedControlSnapshot` |
| `systemMaintenance/activeOrdersLastSweep` | `ensureActiveOrders` |
| `systemMaintenance/booksJournalSynced` | `ensureBooksJournal` |
| `systemMaintenance/financialLedgerInitialized` | `ensureFinancialLedger` |
| `systemMaintenance/historicalArchiveDaily` | `manageHistoricalOrderArchive` |
| `systemMaintenance/historicalArchiveReplicaDaily` | `manageHistoricalOrderArchive` |
| `systemMaintenance/historicalRollupCompletion` | `manageHistoricalOrderArchive` |
| `systemMaintenance/historicalRollupReadBudget` | `manageHistoricalOrderArchive` |
| `systemMaintenance/inventoryLedgerInitializedAt` | `ensureInventoryLedger` |
| `systemMaintenance/voucherReceiptsMoved` | `getSupplierAdvanceDetails` |
| `taxReturns` | `prepareQuarterlyTaxReturn` |
| `uncostedSales` | `manageUncostedSales`, `onArchivedOrderInventoryReversal`, `onOrderFinalize`, `onOrderInventoryReversal`, `processOrderAdjustment`, `repairOrderInventoryMarker` |
| `undepositedLedgerPageIndex` | `getUndepositedControlSnapshot`, `getUndepositedPage`, `managePettyVoucher`, `repairReversalAccountingDate`, `syncUndepositedLedgerPageIndex` |
| `undepositedPageIndexMeta` | `getUndepositedControlSnapshot`, `getUndepositedPage` |

## 4. Database triggers

| Trigger | Watches | Event | Writes | Reads | Source |
|---|---|---|---|---|---|
| `replicateArchivedOrderToFirestore` | `/archivedOrders/{orderId}` | onValueWritten | `historicalArchiveSync` | `archivedOrders`, `books/journal`, `financialMovements`, `inventoryMovements`, `orderInventoryPlans` | `src/functions/61-historical-archive.js` |
| `onArchivedOrderInventoryReversal` | `/archivedOrders/{orderId}/inventoryReversalRequested` | onValueWritten | `archivedOrders`, `books/chartCodeMigrations`, `books/journal`, `booksChart`, `cashCustodyOpenIndex`, `discrepancies`, `financialCommandClaims`, `financialMovements`, `inventory`, `inventoryAccounting`, `inventoryBalances`, `inventoryMovements`, `operationalAudit`, `orders`, `uncostedSales` | `accountingPeriods`, `cashCustody`, `posSettings/invCategories`, `posSettings/tolerances` | `src/functions/50-inventory.js` |
| `updateBooksMonthlyNet` | `/books/journal/{entryId}` | onValueWritten | `books/dailyNet`, `books/monthlyNet`, `books/monthlyNetMeta` | `books/journal` | `src/functions/10-books-bridge.js` |
| `refreshHistoricalOrderAfterJournal` | `/books/journal/{journalId}` | onValueWritten | `historicalArchiveSync` | `archivedOrders`, `books/journal`, `financialMovements`, `inventoryMovements`, `orderInventoryPlans` | `src/functions/61-historical-archive.js` |
| `updatePublicCatalogVersionOnCategories` | `/categories` | onValueWritten | `publicCatalogVersion` | `categories` | `src/functions/24-public-catalog-version.js` |
| `autoRepairFinanceDateOnCashLedgerCreate` | `/cfLedger/{ledgerId}` | onValueCreated | `cashCustodyOpenIndex`, `financialCommandClaims`, `financialMovements`, `operationalAudit` | `accountingPeriods`, `cashCustody`, `cfLedger` | `src/functions/44-reconciliation.js` |
| `notifyOnContactMessage` | `/feedbacks/{fbId}` | onValueCreated | `staffPushTokens` | `admins`, `feedbacks` | `src/functions/00-bootstrap-notifications.js` |
| `mirrorPosMovementToBooks` | `/financialMovements/{movementId}` | onValueCreated | `books/journal`, `books/reviewQueue` | `books/config`, `cfAccounts`, `financialMovements`, `payables`, `purchaseInvoices` | `src/functions/10-books-bridge.js` |
| `reopenFinancialCloseOnMovement` | `/financialMovements/{movementId}` | onValueCreated | `financialCloseIndex`, `financialCloses` | `financialMovements` | `src/functions/22-close-controls.js` |
| `syncUndepositedLedgerPageIndex` | `/financialMovements/{movementId}` | onValueWritten | `pettyVoucherAttentionIndex/missing`, `pettyVoucherPostingIndex`, `undepositedLedgerPageIndex` | `financialMovements` | `src/functions/21a-undeposited-pages.js` |
| `updateCashBalanceSummary` | `/financialMovements/{movementId}` | onValueWritten | `cashBalanceSummaryPending`, `cashFlowDaily`, `cashFlowMonthly`, `cashFlowOpenings` | `financialMovements` | `src/functions/23-cash-balance-summary.js` |
| `updatePublicCatalogVersionOnMenuItems` | `/menuItems` | onValueWritten | `publicCatalogVersion` | `menuItems` | `src/functions/24-public-catalog-version.js` |
| `updatePublicCatalogVersionOnOptionGroups` | `/optionGroups` | onValueWritten | `publicCatalogVersion` | `optionGroups` | `src/functions/24-public-catalog-version.js` |
| `refreshHistoricalOrderAfterInventoryPlan` | `/orderInventoryPlans/{orderId}` | onValueWritten | `historicalArchiveSync` | `archivedOrders`, `books/journal`, `financialMovements`, `inventoryMovements`, `orderInventoryPlans` | `src/functions/61-historical-archive.js` |
| `indexPlatformOrderRef` | `/orders/{orderId}` | onValueCreated | `archivedOrders`, `orders`, `platformRefDuplicates`, `platformRefIndex` | — | `src/functions/10-books-bridge.js` |
| `notifyStaffOnOrder` | `/orders/{orderId}` | onValueCreated | `staffPushTokens` | `admins`, `orders` | `src/functions/00-bootstrap-notifications.js` |
| `onOrderFinalize` | `/orders/{orderId}` | onValueWritten | `archivedOrders`, `books/chartCodeMigrations`, `books/journal`, `booksChart`, `cashCustodyOpenIndex`, `discrepancies`, `financialCommandClaims`, `financialMovements`, `inventory`, `inventoryAccounting`, `inventoryBalances`, `inventoryMovements`, `operationalAudit`, `orderInventoryPlans`, `orders`, `uncostedSales` | `accountingPeriods`, `cashCustody`, `menuItems`, `optionRecipes`, `posSettings`, `posSettings/tolerances` | `src/functions/50-inventory.js` |
| `onOrderFinancialPosting` | `/orders/{orderId}` | onValueWritten | `cashCustodyOpenIndex`, `cfLedger`, `financialCommandClaims`, `financialMovements`, `payables` | `accountingPeriods`, `cashCustody`, `cfAccounts`, `orders`, `taxSettings` | `src/functions/40-sales-finance.js` |
| `preservePostedOrderOnDelete` | `/orders/{orderId}` | onValueDeleted | `archivedOrders`, `deletionAudit` | `financialMovements`, `orders` | `src/functions/40-sales-finance.js` |
| `reopenFinancialCloseOnOrderChange` | `/orders/{orderId}` | onValueWritten | `financialCloseIndex`, `financialCloses` | `orders`, `shifts` | `src/functions/22-close-controls.js` |
| `syncActiveOrderProjection` | `/orders/{orderId}` | onValueWritten | `activeOrders`, `archivedOrders`, `orders` | `posActiveShift` | `src/functions/30-orders.js` |
| `mirrorPosCogsToBooks` | `/orders/{orderId}/cogsSnapshot` | onValueWritten | `books/journal` | `archivedOrders`, `orders`, `posSettings/invCategories` | `src/functions/10-books-bridge.js` |
| `onOrderInventoryReversal` | `/orders/{orderId}/inventoryReversalRequested` | onValueWritten | `archivedOrders`, `books/chartCodeMigrations`, `books/journal`, `booksChart`, `cashCustodyOpenIndex`, `discrepancies`, `financialCommandClaims`, `financialMovements`, `inventory`, `inventoryAccounting`, `inventoryBalances`, `inventoryMovements`, `operationalAudit`, `orders`, `uncostedSales` | `accountingPeriods`, `cashCustody`, `posSettings/invCategories`, `posSettings/tolerances` | `src/functions/50-inventory.js` |
| `notifyOnComplete` | `/orders/{orderId}/status` | onValueUpdated | `appCustomers`, `archivedOrders`, `orders` | — | `src/functions/00-bootstrap-notifications.js` |
| `updatePublicCatalogVersionOnPackages` | `/packages` | onValueWritten | `publicCatalogVersion` | `packages` | `src/functions/24-public-catalog-version.js` |
| `onPettyReplenishmentFinancial` | `/pettyCashReplenishments/{replenishmentId}` | onValueWritten | `cashCustodyOpenIndex`, `financialCommandClaims`, `financialMovements` | `accountingPeriods`, `cashCustody`, `pettyCashReplenishments` | `src/functions/41-expense-assets.js` |
| `onPettyVoucherFinancial` | `/pettyCashVouchers/{voucherId}` | onValueWritten | `cashCustody`, `cashCustodyOpenIndex`, `cfLedger`, `financialCommandClaims`, `financialMovements`, `operationalAudit`, `pettyCashVouchers` | `accountingPeriods` | `src/functions/41-expense-assets.js` |
| `syncPettyVoucherAttentionIndex` | `/pettyCashVouchers/{voucherId}` | onValueWritten | `pettyVoucherAttentionIndex/missing`, `pettyVoucherAttentionIndex/pending` | `financialMovements`, `pettyCashVouchers`, `pettyVoucherPostingIndex` | `src/functions/21a-undeposited-pages.js` |
| `pruneClosedShiftOrders` | `/posActiveShift` | onValueWritten | `activeOrders`, `archivedOrders`, `orders` | `posActiveShift` | `src/functions/30-orders.js` |
| `syncActiveRegisterCashFloat` | `/posActiveShift` | onValueWritten | `books/journal`, `operationalAudit` | `accountingPeriods`, `posActiveShift`, `posSettings`, `posSettings/fixedFloat` | `src/functions/10-books-bridge.js` |
| `syncPublicOrderStatus` | `/posActiveShift` | onValueWritten | `publicOrderStatus` | `posActiveShift` | `src/functions/30-orders.js` |
| `syncRegisterCashFloat` | `/posSettings/fixedFloat` | onValueWritten | `books/journal`, `operationalAudit` | `accountingPeriods`, `posActiveShift`, `posSettings`, `posSettings/fixedFloat` | `src/functions/10-books-bridge.js` |
| `notifyStaffOnReservation` | `/reservations/{resId}` | onValueCreated | `staffPushTokens` | `admins`, `reservations` | `src/functions/00-bootstrap-notifications.js` |
| `onShiftOpenFinancial` | `/shifts/{shiftId}` | onValueWritten | — | `shifts` | `src/functions/40-sales-finance.js` |
| `onShiftPayInsFinancial` | `/shifts/{shiftId}/payIns` | onValueWritten | `cashCustodyOpenIndex`, `financialCommandClaims`, `financialMovements` | `accountingPeriods`, `cashCustody`, `shifts` | `src/functions/40-sales-finance.js` |
| `onShiftPayOutsFinancial` | `/shifts/{shiftId}/payOuts` | onValueWritten | `supplierAdvanceShifts` | `shifts` | `src/functions/40-sales-finance.js` |
| `onShiftCloseAssurance` | `/shifts/{shiftId}/status` | onValueWritten | `operationalAudit`, `ownerDailySummaries`, `shiftCloseReceipts`, `shiftCrews`, `shifts` | `archivedOrders`, `financialMovements`, `orders`, `shiftCloseVerifications` | `src/functions/25-pos-assurance.js` |
| `onShiftCloseFinancial` | `/shifts/{shiftId}/status` | onValueWritten | `cashCustody`, `cashCustodyOpenIndex`, `financialCommandClaims`, `financialMovements`, `shifts` | `accountingPeriods` | `src/functions/40-sales-finance.js` |
| `onShiftEndResolveEarlierHandovers` | `/shifts/{shiftId}/status` | onValueWritten | `activeOrders`, `activeQrTickets`, `archivedQrTickets`, `discrepancies`, `offlinePosSync`, `operationalAudit`, `orderInventoryPlans`, `orders`, `pendingShiftHandovers`, `posActiveShift`, `posSyncAlerts`, `shiftCloseFollowUps`, `shiftCloseVerifications`, `shiftHandovers`, `shiftSyncGates`, `shifts` | `accountingPeriods`, `archivedOrders`, `financialMovements`, `optionRecipes`, `posDeviceHealth`, `posSettings`, `posStaff`, `shiftCrews` | `src/functions/25b-shift-handover.js` |

## 5. Scheduled jobs

| Job | Schedule | Writes | Reads | Source |
|---|---|---|---|---|
| `resolvePendingShiftHandovers` | every 5 minutes | `activeOrders`, `activeQrTickets`, `archivedQrTickets`, `discrepancies`, `offlinePosSync`, `operationalAudit`, `orderInventoryPlans`, `orders`, `pendingShiftHandovers`, `posActiveShift`, `posSyncAlerts`, `shiftCloseFollowUps`, `shiftCloseVerifications`, `shiftHandovers`, `shiftSyncGates`, `shifts` | `accountingPeriods`, `archivedOrders`, `financialMovements`, `optionRecipes`, `posDeviceHealth`, `posSettings`, `posStaff`, `shiftCrews` | `src/functions/25b-shift-handover.js` |
| `pruneEphemeralNodes` | every day 03:30 | `books/dailyNet`, `books/monthlyNet`, `books/monthlyNetMeta` | `books/journal`, `clientTelemetryDaily`, `functionFailureBudget`, `functionRetryAttempts`, `loyaltyDailyCounters`, `loyaltyLinkThrottle`, `loyaltyOtp`, `orderCorrectionCommands`, `orderLocks`, `orderStatusCommands`, `qrOrderLocks`, `rateLimits/orders`, `systemHealth/productionMonitor`, `systemMaintenance/historicalArchiveDaily` | `src/functions/60-maintenance.js` |
| `autoCompleteReadyOnlineOrders` | every 15 minutes | `customerOrders`, `operationalAudit`, `orders` | `activeOrders` | `src/functions/60-maintenance.js` |
| `sweepOrderArchive` | every 3 hours | `activeOrders`, `archivedOrders`, `operationalAudit`, `orders`, `systemHealth/orderArchiveSweep` | `shifts` | `src/functions/60-maintenance.js` |
| `backupDatabaseDaily` | every day 03:00 | `books/dailyNet`, `books/monthlyNet`, `books/monthlyNetMeta`, `historicalArchiveSync`, `operationalAudit`, `pettyCashReceipts`, `pettyCashVouchers`, `systemHealth/backups`, `systemHealth/productionMonitor` | `accazaAiProviderHealth`, `activeOrders`, `archivedOrders`, `books/journal`, `cashCustody`, `cfAccounts`, `clientTelemetryDaily`, `financialMovements`, `inventoryMovements`, `offlinePosSync`, `orderInventoryPlans`, `orders`, `payment`, `pendingShiftHandovers`, `posSettings/payMethods`, `posSyncAlerts`, `shiftCloseFollowUps`, `uncostedSales` | `src/functions/60-maintenance.js` |
| `evaluateProductionHealth` | every 60 minutes | `books/dailyNet`, `books/monthlyNet`, `books/monthlyNetMeta`, `historicalArchiveSync`, `operationalAudit`, `systemHealth/productionMonitor` | `accazaAiProviderHealth`, `activeOrders`, `archivedOrders`, `books/journal`, `cashCustody`, `cfAccounts`, `clientTelemetryDaily`, `financialMovements`, `inventoryMovements`, `offlinePosSync`, `orderInventoryPlans`, `orders`, `payment`, `pendingShiftHandovers`, `posSettings/payMethods`, `posSyncAlerts`, `shiftCloseFollowUps`, `systemHealth/backups`, `uncostedSales` | `src/functions/60-maintenance.js` |

## 6. Callables (called by screens)

| Callable | Writes | Reads | Source |
|---|---|---|---|
| `acceptOnlineOrder` | `activeOrders`, `customerOrders`, `operationalAudit`, `orders` | `adminPerms`, `admins`, `posActiveShift`, `sessionControl/cutoff`, `sessionControl/users` | `src/functions/20-portal-operations.js` |
| `apIntegrityBaseline` | `cashBalanceSummaryPending`, `cashFlowDaily`, `cashFlowMonthly`, `cashFlowOpenings`, `operationalAudit` | `admins`, `cashCustody`, `financialMovements`, `inventoryMovements`, `payables`, `purchaseInvoices`, `sessionControl/cutoff`, `sessionControl/users` | `src/functions/44b-ap-integrity.js` |
| `archiveActivityLog` | `activityLog`, `activityLogArchive` | `adminPerms`, `admins`, `sessionControl/cutoff`, `sessionControl/users` | `src/functions/22-close-controls.js` |
| `askAccazaAI` | `accazaAiProviderHealth`, `operationalAudit` | `accazaAiIssues`, `accazaAiKnowledge`, `admins`, `books/monthlyNet`, `booksChart`, `financialCloses`, `inventory`, `menuItems`, `payables`, `posSettings`, `posStaff`, `recipes`, `sessionControl/cutoff`, `sessionControl/users`, `suppliers` | `src/functions/62-accaza-chat.js` |
| `askAccazaAIStandalone` | `accazaAiProviderHealth`, `operationalAudit` | `admins`, `sessionControl/cutoff`, `sessionControl/users` | `src/functions/63-accaza-ai-standalone.js` |
| `auditFinancialControls` | `archivedOrders`, `cashCustodyOpenIndex`, `financialCommandClaims`, `financialMovements`, `operationalAudit`, `orders`, `supplierAdvanceShifts` | `accountingPeriods`, `adminPerms`, `admins`, `books/config`, `books/journal`, `books/reconciliationConfig`, `books/registerFloatState`, `booksChart`, `cashCustody`, `cfAccounts`, `cfLedger`, `discrepancies`, `payables`, `pettyCashVouchers`, `platformPayouts`, `posActiveShift`, `posSettings`, `posSettings/fixedFloat`, `receivables`, `sessionControl/cutoff`, `sessionControl/users`, `shifts`, `supplierAdvanceShiftIndexMeta`, `taxSettings` | `src/functions/44-reconciliation.js` |
| `backfillPurchaseDocumentNumbers` | `operationalAudit`, `payables`, `purchaseInvoices` | `admins`, `sessionControl/cutoff`, `sessionControl/users` | `src/functions/44c-purchase-doc-numbers.js` |
| `checkBakingMapping` | `bakingProducts`, `operationalAudit` | `adminPerms`, `admins`, `inventory`, `inventoryAccounting`, `sessionControl/cutoff`, `sessionControl/users` | `src/functions/50a-baking.js` |
| `claimLoyaltyReward` | `loyaltyBalances`, `loyaltyLedger`, `loyaltyOtp`, `loyaltyRewards` | `adminPerms`, `admins`, `loyaltyMembers`, `loyaltyRewardCatalog`, `sessionControl/cutoff`, `sessionControl/users` | `src/functions/26-loyalty.js` |
| `completeLoyaltySignup` | `loyaltyEarningRules/rule_red_per_order`, `loyaltyEarningRules/rule_signup_bonus`, `loyaltyEarningRules/rule_yellow_1000`, `loyaltyEarningRules/rule_yellow_500`, `loyaltyMembers`, `loyaltyMembersByPhone`, `loyaltyOtp`, `loyaltyRewardCatalog/reward_20_off`, `loyaltyRewardCatalog/reward_free_drink` | `loyaltyEarningRules`, `loyaltyRewardCatalog`, `loyaltyStats/activeMembers` | `src/functions/26-loyalty.js` |
| `confirmLoyaltyBadgeRecovery` | `loyaltyLedger`, `loyaltyMembers`, `loyaltyOtp` | — | `src/functions/26a-loyalty-members.js` |
| `confirmLoyaltyLinkOtp` | `appCustomers`, `loyaltyOtp` | `loyaltyBalances`, `loyaltyMembers`, `loyaltyRewardCatalog`, `loyaltyRewards` | `src/functions/26-loyalty.js` |
| `confirmOrderReceived` | `activeOrders`, `customerOrders`, `orders` | — | `src/functions/30-orders.js` |
| `consumeManagerApproval` | `financialApprovals` | `adminPerms`, `admins`, `sessionControl/cutoff`, `sessionControl/users` | `src/functions/20-portal-operations.js` |
| `correctPlatformPresettlement` | `activeOrders`, `cashCustodyOpenIndex`, `financialApprovals`, `financialCommandClaims`, `financialMovements`, `operationalAudit`, `platformRefDuplicates`, `platformRefIndex` | `accountingPeriods`, `adminPerms`, `admins`, `archivedOrders`, `cashCustody`, `cfAccounts`, `orders`, `sessionControl/cutoff`, `sessionControl/users`, `taxSettings` | `src/functions/43c-platform-presettlement.js` |
| `createManagerApproval` | `financialApprovals` | `admins`, `sessionControl/cutoff`, `sessionControl/users` | `src/functions/20-portal-operations.js` |
| `createOnlineOrder` | `activeOrders`, `appCustomers`, `customerOrders`, `orderLocks`, `orders`, `rateLimits/orders` | `availability`, `cfAccounts`, `payment`, `posActiveShift/id`, `posActiveShift/status`, `posSettings`, `taxSettings` | `src/functions/30-orders.js` |
| `createQrOrderTicket` | `activeQrTickets`, `archivedQrTickets`, `qrOrderCounters`, `qrOrderLocks`, `rateLimits/orders` | `availability`, `posActiveShift/id`, `posActiveShift/status`, `publicOrderStatus/acceptingOrders`, `taxSettings` | `src/functions/30-orders.js` |
| `enrollDragonQuest` | `dragonQuestEnrollments`, `dragonQuestLedger` | `appCustomers`, `dragonQuestConfig/activeSeasonId`, `dragonQuestMissions`, `dragonQuestSeasons`, `loyaltyMembers` | `src/functions/26b-dragon-quest.js` |
| `ensureActiveOrders` | `activeOrders`, `archivedOrders`, `orders`, `systemMaintenance/activeOrdersLastSweep` | `admins`, `posActiveShift`, `sessionControl/cutoff`, `sessionControl/users` | `src/functions/30-orders.js` |
| `ensureBooksJournal` | `books/chartCodeMigrations`, `books/config`, `books/dailyNet`, `books/journal`, `books/monthlyNet`, `books/monthlyNetMeta`, `books/reconciliationConfig`, `books/reviewQueue`, `booksChart`, `cashCustodyOpenIndex`, `financialCommandClaims`, `financialMovements`, `operationalAudit`, `systemMaintenance/booksJournalSynced` | `accountingPeriods`, `adminPerms`, `admins`, `archivedOrders`, `books/review`, `cashCustody`, `cfAccounts`, `inventory`, `inventoryMovements`, `orders`, `payables`, `posActiveShift`, `posSettings`, `posSettings/fixedFloat`, `posSettings/invCategories`, `purchaseInvoices`, `sessionControl/cutoff`, `sessionControl/users` | `src/functions/10-books-bridge.js` |
| `ensureFinancialLedger` | `cashCustody`, `cashCustodyOpenIndex`, `cfLedger`, `financialCommandClaims`, `financialMovements`, `operationalAudit`, `payables`, `pettyCashVouchers`, `systemMaintenance/financialLedgerInitialized` | `accountingPeriods`, `adminPerms`, `admins`, `archivedOrders`, `cfAccounts`, `orders`, `pettyCashReplenishments`, `pettyCashSettings`, `platformPayouts`, `platformVarAccounts`, `receivables`, `sessionControl/cutoff`, `sessionControl/users`, `shifts`, `taxSettings` | `src/functions/44-reconciliation.js` |
| `ensureInventoryLedger` | `inventory`, `inventoryAccounting`, `inventoryBalances`, `inventoryMovements`, `systemMaintenance/inventoryLedgerInitializedAt` | `adminPerms`, `admins`, `sessionControl/cutoff`, `sessionControl/users` | `src/functions/50-inventory.js` |
| `ensureShiftReference` | `cashCustody`, `shifts` | `adminPerms`, `admins`, `sessionControl/cutoff`, `sessionControl/users` | `src/functions/40-sales-finance.js` |
| `finalizeLoyaltyRedemption` | `loyaltyRewards`, `loyaltyStats/redemptionCostByReward` | `adminPerms`, `admins`, `loyaltyStats/redemptionsByCashier`, `sessionControl/cutoff`, `sessionControl/users` | `src/functions/26-loyalty.js` |
| `getCurrentCashBalances` | `cashBalanceSummaryPending`, `cashFlowDaily`, `cashFlowMonthly`, `cashFlowOpenings` | `adminPerms`, `admins`, `financialMovements`, `posActiveShift`, `posSettings`, `sessionControl/cutoff`, `sessionControl/users` | `src/functions/23-cash-balance-summary.js` |
| `getDragonQuest` | — | `appCustomers`, `dragonQuestConfig/activeSeasonId`, `dragonQuestEnrollments`, `dragonQuestMissions`, `dragonQuestSeasons`, `loyaltyMembers` | `src/functions/26b-dragon-quest.js` |
| `getLoyaltyMemberCard` | — | `loyaltyBalances`, `loyaltyMembers`, `loyaltyRewardCatalog`, `loyaltyRewards` | `src/functions/26-loyalty.js` |
| `getLoyaltyReports` | — | `adminPerms`, `admins`, `loyaltyMembers`, `loyaltyStats/activeMembers`, `loyaltyStats/redemptionCostByReward`, `loyaltyStats/redemptionsByCashier`, `loyaltyStats/stampsByCashier`, `posStaff`, `sessionControl/cutoff`, `sessionControl/users` | `src/functions/26-loyalty2-admin.js` |
| `getMyLoyaltyCard` | — | `appCustomers`, `loyaltyBalances`, `loyaltyMembers`, `loyaltyRewardCatalog`, `loyaltyRewards` | `src/functions/26-loyalty.js` |
| `getOperationalExceptions` | `books/dailyNet`, `books/monthlyNet`, `books/monthlyNetMeta`, `historicalArchiveSync`, `operationalAudit` | `accazaAiProviderHealth`, `activeOrders`, `admins`, `archivedOrders`, `books/journal`, `cashCustody`, `cfAccounts`, `clientTelemetryDaily`, `financialMovements`, `inventoryMovements`, `offlinePosSync`, `orderInventoryPlans`, `orders`, `payment`, `pendingShiftHandovers`, `posSettings/payMethods`, `posSyncAlerts`, `sessionControl/cutoff`, `sessionControl/users`, `shiftCloseFollowUps`, `uncostedSales` | `src/functions/20-portal-operations.js` |
| `getPaymentProof` | — | `admins`, `archivedOrders`, `orders`, `sessionControl/cutoff`, `sessionControl/users` | `src/functions/30-orders.js` |
| `getProductionCertification` | `books/dailyNet`, `books/monthlyNet`, `books/monthlyNetMeta`, `historicalArchiveSync`, `operationalAudit` | `accazaAiProviderHealth`, `activeOrders`, `adminPerms`, `admins`, `archivedOrders`, `books/journal`, `cashCustody`, `cfAccounts`, `clientTelemetryDaily`, `financialCloseIndex`, `financialMovements`, `incidents`, `inventoryMovements`, `offlinePosSync`, `orderInventoryPlans`, `orders`, `payment`, `pendingShiftHandovers`, `posSettings/payMethods`, `posSyncAlerts`, `sessionControl/cutoff`, `sessionControl/users`, `shiftCloseFollowUps`, `systemHealth/backups`, `uncostedSales` | `src/functions/20-portal-operations.js` |
| `getProductionValidation` | `books/dailyNet`, `books/monthlyNet`, `books/monthlyNetMeta`, `historicalArchiveSync`, `operationalAudit` | `accazaAiProviderHealth`, `activeOrders`, `adminPerms`, `admins`, `archivedOrders`, `books/journal`, `calBlocks`, `cashCustody`, `categories`, `cfAccounts`, `clientTelemetryDaily`, `financialApprovals`, `financialCloseIndex`, `financialMovements`, `incidents`, `inventoryMovements`, `menuItems`, `offlinePosSync`, `orderInventoryPlans`, `orders`, `payment`, `pendingShiftHandovers`, `posSettings/payMethods`, `posSyncAlerts`, `publicOrderStatus`, `sessionControl/cutoff`, `sessionControl/users`, `shiftCloseFollowUps`, `systemHealth/backups`, `uncostedSales` | `src/functions/20-portal-operations.js` |
| `getSupplierAdvanceDetails` | `operationalAudit`, `pettyCashReceipts`, `pettyCashVouchers`, `supplierAdvanceShifts`, `systemMaintenance/voucherReceiptsMoved` | `adminPerms`, `admins`, `sessionControl/cutoff`, `sessionControl/users`, `shifts`, `supplierAdvanceShiftIndexMeta` | `src/functions/30-orders.js` |
| `getUndepositedControlSnapshot` | `cashBalanceSummaryPending`, `cashCustodyOpenIndex`, `cashFlowDaily`, `cashFlowMonthly`, `cashFlowOpenings`, `operationalAudit`, `pettyVoucherAttentionIndex/missing`, `pettyVoucherAttentionIndex/pending`, `pettyVoucherPostingIndex`, `systemHealth/undepositedIndexVerification`, `undepositedLedgerPageIndex`, `undepositedPageIndexMeta` | `adminPerms`, `admins`, `cashCustody`, `financialMovements`, `financialMovements/revolving_fund_retirement`, `financialMovements/undeposited_opening_balance`, `pettyCashVouchers`, `sessionControl/cutoff`, `sessionControl/users` | `src/functions/21a-undeposited-pages.js` |
| `getUndepositedPage` | `cashCustodyOpenIndex`, `operationalAudit`, `pettyVoucherAttentionIndex/missing`, `pettyVoucherAttentionIndex/pending`, `pettyVoucherPostingIndex`, `undepositedLedgerPageIndex`, `undepositedPageIndexMeta` | `adminPerms`, `admins`, `cashCustody`, `financialMovements`, `pettyCashReceipts`, `pettyCashVouchers`, `sessionControl/cutoff`, `sessionControl/users` | `src/functions/21a-undeposited-pages.js` |
| `legacyOwnerCapitalReset` | `cashCustodyOpenIndex`, `discrepancies`, `financialCommandClaims`, `financialMovements`, `operationalAudit` | `accountingPeriods`, `adminPerms`, `admins`, `books/journal`, `cashCustody`, `sessionControl/cutoff`, `sessionControl/users` | `src/functions/22-close-controls.js` |
| `linkLoyaltyByBadge` | `appCustomers` | `loyaltyBalances`, `loyaltyMembers`, `loyaltyRewardCatalog`, `loyaltyRewards` | `src/functions/26-loyalty.js` |
| `lookupLoyaltyMemberByPhone` | — | `adminPerms`, `admins`, `loyaltyMembers`, `loyaltyMembersByPhone`, `sessionControl/cutoff`, `sessionControl/users` | `src/functions/26-loyalty.js` |
| `manageAccazaAiBusiness` | — | `admins`, `menuItems`, `sessionControl/cutoff`, `sessionControl/users` | `src/functions/62c-accaza-ai-business.js` |
| `manageAccazaAiIssue` | `accazaAiIssues`, `operationalAudit` | `admins`, `sessionControl/cutoff`, `sessionControl/users` | `src/functions/62-accaza-chat.js` |
| `manageAccazaAiKnowledge` | `accazaAiKnowledge`, `operationalAudit` | `admins`, `sessionControl/cutoff`, `sessionControl/users` | `src/functions/62-accaza-chat.js` |
| `manageAccountingPeriod` | `accountingPeriods`, `operationalAudit` | `adminPerms`, `admins`, `sessionControl/cutoff`, `sessionControl/users` | `src/functions/20-portal-auth.js` |
| `manageBooksAccount` | `books/chartCodeMigrations`, `books/config`, `books/dailyNet`, `books/journal`, `books/monthlyNet`, `books/monthlyNetMeta`, `booksChart`, `cashBalanceSummaryPending`, `cashFlowDaily`, `cashFlowMonthly`, `cashFlowOpenings`, `cfAccounts`, `operationalAudit` | `admins`, `financialMovements`, `sessionControl/cutoff`, `sessionControl/users` | `src/functions/44-reconciliation.js` |
| `manageCashAccount` | `books/chartCodeMigrations`, `books/config`, `books/journal`, `booksChart`, `cfAccounts`, `financialMovements`, `operationalAudit` | `adminPerms`, `admins`, `books/monthlyNet`, `books/monthlyNetMeta`, `sessionControl/cutoff`, `sessionControl/users` | `src/functions/10-books-bridge.js` |
| `manageChartAccount` | `chartOfAccounts` | `admins`, `sessionControl/cutoff`, `sessionControl/users` | `src/functions/44-reconciliation.js` |
| `manageDragonQuest` | `dragonQuestConfig/activeSeasonId`, `dragonQuestMissions`, `dragonQuestSeasons`, `operationalAudit` | `adminPerms`, `admins`, `loyaltyRewardCatalog`, `sessionControl/cutoff`, `sessionControl/users` | `src/functions/26b-dragon-quest.js` |
| `manageFixedAsset` | `cashCustodyOpenIndex`, `financialCommandClaims`, `financialMovements`, `fixedAssets`, `payables`, `purchaseInvoices` | `accountingPeriods`, `adminPerms`, `admins`, `cashCustody`, `cfAccounts`, `sessionControl/cutoff`, `sessionControl/users` | `src/functions/41-expense-assets.js` |
| `manageHistoricalOrderArchive` | `historicalArchiveSync`, `operationalAudit`, `systemHealth/historicalArchive`, `systemMaintenance/historicalArchiveDaily`, `systemMaintenance/historicalArchiveReplicaDaily`, `systemMaintenance/historicalRollupCompletion`, `systemMaintenance/historicalRollupReadBudget` | `admins`, `archivedOrders`, `books/journal`, `financialMovements`, `inventoryMovements`, `orderInventoryPlans`, `sessionControl/cutoff`, `sessionControl/users` | `src/functions/61-historical-archive.js` |
| `manageIncident` | `incidentCommandClaims`, `incidents`, `operationalAudit` | `admins`, `sessionControl/cutoff`, `sessionControl/users` | `src/functions/20-portal-auth.js` |
| `manageLoyaltyCurrency` | `operationalAudit` | `adminPerms`, `admins`, `loyaltyEarningRules`, `loyaltyRewardCatalog`, `sessionControl/cutoff`, `sessionControl/users` | `src/functions/26-loyalty2-admin.js` |
| `manageLoyaltyEarningRule` | `loyaltyEarningRules`, `operationalAudit` | `adminPerms`, `admins`, `sessionControl/cutoff`, `sessionControl/users` | `src/functions/26-loyalty2-admin.js` |
| `manageLoyaltyMemberAnonymize` | `loyaltyMembers`, `loyaltyMembersByPhone`, `operationalAudit` | `adminPerms`, `admins`, `loyaltyBalances`, `loyaltyStats/activeMembers`, `sessionControl/cutoff`, `sessionControl/users` | `src/functions/26a-loyalty-members.js` |
| `manageLoyaltyMemberStatus` | `loyaltyMembers`, `operationalAudit` | `adminPerms`, `admins`, `loyaltyStats/activeMembers`, `sessionControl/cutoff`, `sessionControl/users` | `src/functions/26-loyalty2-admin.js` |
| `manageLoyaltyRewardCatalog` | `loyaltyRewardCatalog`, `operationalAudit` | `adminPerms`, `admins`, `sessionControl/cutoff`, `sessionControl/users` | `src/functions/26-loyalty2-admin.js` |
| `manageOrderArchive` | `activeOrders`, `archivedOrders`, `deletionAudit/orders`, `financialApprovals`, `operationalAudit`, `orders` | `adminPerms`, `admins`, `financialMovements`, `sessionControl/cutoff`, `sessionControl/users`, `shifts` | `src/functions/21-operational-controls.js` |
| `manageOrderService` | `activeOrders`, `operationalAudit`, `orders`, `shifts` | `adminPerms`, `admins`, `archivedOrders`, `posActiveShift`, `sessionControl/cutoff`, `sessionControl/users` | `src/functions/43j-order-service.js` |
| `managePettyVoucher` | `books/chartCodeMigrations`, `books/journal`, `booksChart`, `cashBalanceSummaryPending`, `cashCustody`, `cashCustodyOpenIndex`, `cashFlowDaily`, `cashFlowMonthly`, `cashFlowOpenings`, `cfLedger`, `discrepancies`, `financialApprovals`, `financialCloseClaims`, `financialCloseIndex`, `financialCloses`, `financialCommandClaims`, `financialMovements`, `operationalAudit`, `payablePayments`, `payables`, `pettyCashCounter`, `pettyCashVouchers`, `undepositedLedgerPageIndex` | `accountingPeriods`, `adminPerms`, `admins`, `books/config`, `cfAccounts`, `pettyCashReceipts`, `posStaff`, `sessionControl/cutoff`, `sessionControl/users`, `shifts`, `suppliers` | `src/functions/21-staff-advance-liquidation.js` |
| `managePortalAccount` | `adminPerms`, `admins`, `operationalAudit`, `portalAccountMutationLock`, `portalLastSeen`, `portalPresence`, `sessionControl/users` | `posActiveShift`, `posDeviceHealth`, `posStaff`, `sessionControl/cutoff`, `shifts` | `src/functions/20b-portal-accounts.js` |
| `managePosSaleRecovery` | `activeOrders`, `activeQrTickets`, `archivedQrTickets`, `offlinePosSync`, `operationalAudit`, `orderInventoryPlans`, `orders`, `posActiveShift`, `posSyncAlerts`, `shiftCloseFollowUps`, `shiftHandovers`, `shiftSyncGates`, `shiftZHistory`, `shifts` | `adminPerms`, `admins`, `archivedOrders`, `optionRecipes`, `posSettings`, `posStaff`, `sessionControl/cutoff`, `sessionControl/users`, `shiftCrews` | `src/functions/25c-shift-crew.js` |
| `managePosShiftCrew` | `operationalAudit`, `posActiveShift`, `shiftCrews`, `shifts` | `adminPerms`, `admins`, `posStaff`, `sessionControl/cutoff`, `sessionControl/users` | `src/functions/25c-shift-crew.js` |
| `managePosStaffIdentity` | `operationalAudit`, `posStaff` | `admins`, `sessionControl/cutoff`, `sessionControl/users` | `src/functions/20a-pos-staff-identity.js` |
| `managePurchaseCorrection` | `books/chartCodeMigrations`, `books/journal`, `booksChart`, `cashCustody`, `cashCustodyOpenIndex`, `cfLedger`, `discrepancies`, `financialApprovals`, `financialCloseClaims`, `financialCloseIndex`, `financialCloses`, `financialCommandClaims`, `financialMovements`, `fixedAssets`, `inventory`, `inventoryAccounting`, `inventoryBalances`, `inventoryBatch`, `inventoryMovements`, `operationalAudit`, `payableSettlementClaims`, `payables`, `purchaseInvoices`, `stockReceipts`, `supplierAdvanceShifts` | `accountingPeriods`, `adminPerms`, `admins`, `books/config`, `cfAccounts`, `inventorySku`, `pettyCashVouchers`, `posSettings/tolerances`, `sessionControl/cutoff`, `sessionControl/users`, `shifts`, `supplierAdvanceShiftIndexMeta`, `suppliers` | `src/functions/43b-purchase-corrections.js` |
| `manageQrOrderTicket` | `activeQrTickets`, `archivedQrTickets`, `operationalAudit` | `adminPerms`, `admins`, `availability`, `posActiveShift/id`, `posActiveShift/status`, `sessionControl/cutoff`, `sessionControl/users`, `taxSettings` | `src/functions/30-orders.js` |
| `manageShiftHandover` | `activeOrders`, `activeQrTickets`, `archivedQrTickets`, `discrepancies`, `offlinePosSync`, `operationalAudit`, `orderInventoryPlans`, `orders`, `ownerDailySummaries`, `pendingShiftHandovers`, `posActiveShift`, `posSyncAlerts`, `shiftCloseFollowUps`, `shiftCloseVerifications`, `shiftCrews`, `shiftHandovers`, `shiftSyncGates`, `shifts` | `accountingPeriods`, `adminPerms`, `admins`, `archivedOrders`, `financialMovements`, `optionRecipes`, `posDeviceHealth`, `posSettings`, `posSettings/fixedFloat`, `posStaff`, `sessionControl/cutoff`, `sessionControl/users` | `src/functions/25b-shift-handover.js` |
| `manageStaffMessage` | `operationalAudit`, `staffMessageReceipts`, `staffMessages`, `staffPushTokens`, `staffReceiptIndex` | `admins`, `sessionControl/cutoff`, `sessionControl/users` | `src/functions/20-portal-auth.js` |
| `manageSupplier` | `inventoryBatch`, `operationalAudit`, `payables`, `pettyCashVouchers`, `purchaseInvoices`, `shifts`, `stockReceipts`, `supplierAdvanceShifts`, `supplierNameIndex`, `supplierTaxIdIndex`, `suppliers` | `adminPerms`, `admins`, `inventorySku`, `sessionControl/cutoff`, `sessionControl/users`, `supplierAdvanceShiftIndexMeta` | `src/functions/20-portal-auth.js` |
| `manageUncostedSales` | `archivedOrders`, `books/chartCodeMigrations`, `books/journal`, `booksChart`, `cashCustodyOpenIndex`, `discrepancies`, `financialCommandClaims`, `financialMovements`, `inventory`, `inventoryAccounting`, `inventoryBalances`, `inventoryMovements`, `menuItems`, `operationalAudit`, `orderInventoryPlans`, `orders`, `uncostedSales` | `accountingPeriods`, `adminPerms`, `admins`, `cashCustody`, `optionRecipes`, `posSettings`, `posSettings/tolerances`, `sessionControl/cutoff`, `sessionControl/users` | `src/functions/43i-uncosted-sales.js` |
| `openLinkedPosShift` | `financialApprovals`, `operationalAudit`, `posActiveShift`, `shifts` | `adminPerms`, `admins`, `posSettings`, `posStaff`, `sessionControl/cutoff`, `sessionControl/users` | `src/functions/20a-pos-staff-identity.js` |
| `postBatchCard` | `batchCardRequests`, `batchCards`, `books/chartCodeMigrations`, `books/journal`, `booksChart`, `cashCustodyOpenIndex`, `discrepancies`, `financialCommandClaims`, `financialMovements`, `inventory`, `inventoryAccounting`, `inventoryBalances`, `inventoryMovements`, `operationalAudit` | `accountingPeriods`, `adminPerms`, `admins`, `bakingProducts`, `cashCustody`, `posSettings/tolerances`, `sessionControl/cutoff`, `sessionControl/users` | `src/functions/50a-baking.js` |
| `postFinancialCommand` | `cashCustody`, `cashCustodyOpenIndex`, `cfLedger`, `chartOfAccounts`, `financialCommandClaims`, `financialMovements`, `operationalAudit`, `payablePayments`, `payableSettlementClaims`, `payables`, `purchaseInvoices` | `accountingPeriods`, `adminPerms`, `admins`, `books/journal`, `cfAccounts`, `inventory`, `sessionControl/cutoff`, `sessionControl/users` | `src/functions/42a-financial-command-entry.js` |
| `postInventoryMovements` | `books/chartCodeMigrations`, `books/journal`, `booksChart`, `cashCustodyOpenIndex`, `discrepancies`, `financialCommandClaims`, `financialMovements`, `inventory`, `inventoryAccounting`, `inventoryBalances`, `inventoryMovements`, `operationalAudit` | `accountingPeriods`, `adminPerms`, `admins`, `cashCustody`, `posSettings/tolerances`, `sessionControl/cutoff`, `sessionControl/users` | `src/functions/50-inventory.js` |
| `prepareQuarterlyTaxReturn` | `operationalAudit`, `taxReturns` | `adminPerms`, `admins`, `companyInfo`, `financialCloseIndex`, `financialCloses`, `purchaseInvoices`, `sessionControl/cutoff`, `sessionControl/users`, `taxSettings` | `src/functions/20d-tax-returns.js` |
| `processOrderAdjustment` | `activeOrders`, `books/chartCodeMigrations`, `books/journal`, `booksChart`, `cashBalanceSummaryPending`, `cashCustodyOpenIndex`, `cashFlowDaily`, `cashFlowMonthly`, `cashFlowOpenings`, `cfLedger`, `customerOrders`, `discrepancies`, `financialApprovals`, `financialCommandClaims`, `financialMovements`, `inventory`, `inventoryAccounting`, `inventoryBalances`, `inventoryMovements`, `operationalAudit`, `orderCorrectionCommands`, `orderCorrections`, `orders`, `posActiveShift`, `shifts`, `uncostedSales` | `accountingPeriods`, `adminPerms`, `admins`, `archivedOrders`, `availability`, `cashCustody`, `cfAccounts`, `optionRecipes`, `orderInventoryPlans`, `posSettings`, `posSettings/fixedFloat`, `posSettings/tolerances`, `sessionControl/cutoff`, `sessionControl/users`, `taxSettings` | `src/functions/43g-order-adjustments.js` |
| `readHistoricalOrders` | `rateLimits` | `adminPerms`, `admins`, `archivedOrders`, `sessionControl/cutoff`, `sessionControl/users`, `systemHealth/historicalArchive` | `src/functions/61-historical-archive.js` |
| `readHistoricalSalesRollup` | `rateLimits` | `adminPerms`, `admins`, `sessionControl/cutoff`, `sessionControl/users`, `systemHealth/historicalArchive` | `src/functions/61-historical-archive.js` |
| `reconcilePurchasePayable` | `books/chartCodeMigrations`, `books/journal`, `booksChart`, `cashCustodyOpenIndex`, `financialCommandClaims`, `financialMovements`, `operationalAudit`, `payables`, `purchaseInvoices`, `stockReceipts` | `accountingPeriods`, `adminPerms`, `admins`, `cashCustody`, `inventory`, `sessionControl/cutoff`, `sessionControl/users`, `suppliers` | `src/functions/43a-purchase-payable.js` |
| `reconcileUndepositedCustody` | `cashCustody`, `financialApprovals`, `operationalAudit` | `adminPerms`, `admins`, `financialMovements`, `sessionControl/cutoff`, `sessionControl/users` | `src/functions/22-close-controls.js` |
| `recordClientTelemetry` | `clientTelemetryDaily` | `admins`, `sessionControl/cutoff`, `sessionControl/users` | `src/functions/20-portal-operations.js` |
| `recordPlatformCatchup` | `cashCustodyOpenIndex`, `cfLedger`, `financialApprovals`, `financialCommandClaims`, `financialMovements`, `operationalAudit`, `orders`, `platformRefIndex` | `accountingPeriods`, `adminPerms`, `admins`, `archivedOrders`, `cashCustody`, `cfAccounts`, `menuItems`, `sessionControl/cutoff`, `sessionControl/users`, `taxSettings` | `src/functions/43h-platform-catchup.js` |
| `releaseLoyaltyClaim` | `loyaltyBalances`, `loyaltyLedger`, `loyaltyRewards` | `adminPerms`, `admins`, `sessionControl/cutoff`, `sessionControl/users` | `src/functions/26-loyalty2-admin.js` |
| `reopenDiscrepancy` | `discrepancies`, `financialApprovals`, `operationalAudit`, `shifts` | `adminPerms`, `admins`, `financialMovements`, `sessionControl/cutoff`, `sessionControl/users` | `src/functions/21-operational-controls.js` |
| `repairClosedShiftTurnover` | `cashCustody`, `cashCustodyOpenIndex`, `financialApprovals`, `financialCommandClaims`, `financialMovements`, `operationalAudit`, `shifts` | `accountingPeriods`, `adminPerms`, `admins`, `sessionControl/cutoff`, `sessionControl/users` | `src/functions/22-close-controls.js` |
| `repairFinanceDates` | `archivedOrders`, `cashCustodyOpenIndex`, `financialCommandClaims`, `financialMovements`, `operationalAudit`, `orders` | `accountingPeriods`, `adminPerms`, `admins`, `cashCustody`, `cfLedger`, `sessionControl/cutoff`, `sessionControl/users` | `src/functions/44-reconciliation.js` |
| `repairOrderInventoryMarker` | `archivedOrders`, `books/chartCodeMigrations`, `books/journal`, `booksChart`, `cashCustodyOpenIndex`, `discrepancies`, `financialCommandClaims`, `financialMovements`, `inventory`, `inventoryAccounting`, `inventoryBalances`, `inventoryMovements`, `operationalAudit`, `orderInventoryPlans`, `orders`, `uncostedSales` | `accountingPeriods`, `adminPerms`, `admins`, `cashCustody`, `menuItems`, `optionRecipes`, `posSettings`, `posSettings/tolerances`, `sessionControl/cutoff`, `sessionControl/users` | `src/functions/20-portal-operations.js` |
| `repairPettyExpenseClassifications` | `cashCustodyOpenIndex`, `financialCommandClaims`, `financialMovements`, `operationalAudit`, `pettyCashVouchers` | `accountingPeriods`, `adminPerms`, `admins`, `cashCustody`, `sessionControl/cutoff`, `sessionControl/users` | `src/functions/41-expense-assets.js` |
| `repairPettyVoucherFinancial` | `cashCustody`, `cashCustodyOpenIndex`, `cfLedger`, `financialCommandClaims`, `financialMovements`, `operationalAudit`, `pettyCashVouchers` | `accountingPeriods`, `adminPerms`, `admins`, `sessionControl/cutoff`, `sessionControl/users` | `src/functions/22-close-controls.js` |
| `repairReversalAccountingDate` | `books/dailyNet`, `books/journal`, `books/monthlyNet`, `books/monthlyNetMeta`, `cashCustody`, `cashCustodyOpenIndex`, `cfLedger`, `financialMovements`, `operationalAudit`, `pettyCashVouchers`, `undepositedLedgerPageIndex` | `accountingPeriods`, `adminPerms`, `admins`, `sessionControl/cutoff`, `sessionControl/users` | `src/functions/22-close-controls.js` |
| `repairReversedPayoutDeposit` | `cashCustodyOpenIndex`, `cfLedger`, `financialApprovals`, `financialCommandClaims`, `financialMovements`, `operationalAudit`, `platformPayouts` | `accountingPeriods`, `adminPerms`, `admins`, `cashCustody`, `cfAccounts`, `sessionControl/cutoff`, `sessionControl/users` | `src/functions/22-close-controls.js` |
| `repairShiftDeclaredTips` | `cashCustodyOpenIndex`, `financialApprovals`, `financialCommandClaims`, `financialMovements`, `operationalAudit` | `accountingPeriods`, `adminPerms`, `admins`, `cashCustody`, `sessionControl/cutoff`, `sessionControl/users`, `shifts` | `src/functions/22-close-controls.js` |
| `reportPosDeviceHealth` | `operationalAudit`, `posDeviceHealth` | `adminPerms`, `admins`, `posActiveShift`, `sessionControl/cutoff`, `sessionControl/users` | `src/functions/25-pos-assurance.js` |
| `resolveBackgroundFailure` | `historicalArchiveSync`, `operationalAudit` | `admins`, `archivedOrders`, `books/journal`, `financialMovements`, `inventoryMovements`, `orderInventoryPlans`, `orders`, `sessionControl/cutoff`, `sessionControl/users` | `src/functions/20-portal-operations.js` |
| `retireRevolvingFund` | `cashCustody`, `cashCustodyOpenIndex`, `financialApprovals`, `financialCommandClaims`, `financialMovements`, `operationalAudit` | `accountingPeriods`, `adminPerms`, `admins`, `sessionControl/cutoff`, `sessionControl/users` | `src/functions/21-staff-advance-liquidation.js` |
| `reverseBatchCard` | `batchCards`, `books/chartCodeMigrations`, `books/journal`, `booksChart`, `cashCustodyOpenIndex`, `discrepancies`, `financialCommandClaims`, `financialMovements`, `inventory`, `inventoryAccounting`, `inventoryBalances`, `inventoryMovements`, `operationalAudit` | `accountingPeriods`, `adminPerms`, `admins`, `cashCustody`, `posSettings/tolerances`, `sessionControl/cutoff`, `sessionControl/users` | `src/functions/50a-baking.js` |
| `reversePlatformPayout` | `cashCustodyOpenIndex`, `cfLedger`, `financialApprovals`, `financialCommandClaims`, `financialMovements`, `operationalAudit`, `platformPayouts` | `accountingPeriods`, `adminPerms`, `admins`, `archivedOrders`, `cashCustody`, `cfAccounts`, `orders`, `platformVarAccounts`, `sessionControl/cutoff`, `sessionControl/users` | `src/functions/43e-platform-reversal.js` |
| `reviewDiscrepancy` | `books/chartCodeMigrations`, `books/journal`, `booksChart`, `cashCustody`, `cashCustodyOpenIndex`, `discrepancies`, `financialApprovals`, `financialCommandClaims`, `financialMovements`, `operationalAudit`, `payables`, `receivables`, `shifts` | `accountingPeriods`, `adminPerms`, `admins`, `cfAccounts`, `inventoryAdjustments`, `inventoryMovements`, `posStaff`, `purchaseInvoices`, `sessionControl/cutoff`, `sessionControl/users` | `src/functions/21-operational-controls.js` |
| `runDatabaseBackupNow` | `books/dailyNet`, `books/monthlyNet`, `books/monthlyNetMeta`, `historicalArchiveSync`, `operationalAudit`, `pettyCashReceipts`, `pettyCashVouchers`, `systemHealth/backups`, `systemHealth/productionMonitor` | `accazaAiProviderHealth`, `activeOrders`, `admins`, `archivedOrders`, `books/journal`, `cashCustody`, `cfAccounts`, `clientTelemetryDaily`, `financialMovements`, `inventoryMovements`, `offlinePosSync`, `orderInventoryPlans`, `orders`, `payment`, `pendingShiftHandovers`, `posSettings/payMethods`, `posSyncAlerts`, `sessionControl/cutoff`, `sessionControl/users`, `shiftCloseFollowUps`, `uncostedSales` | `src/functions/60-maintenance.js` |
| `runFinancialClose` | `financialApprovals`, `financialCloseClaims`, `financialCloseIndex`, `financialCloses`, `operationalAudit`, `supplierAdvanceShifts` | `adminPerms`, `admins`, `archivedOrders`, `books/journal`, `cashCustody`, `financialMovements`, `inventoryMovements`, `orders`, `payables`, `pettyCashVouchers`, `platformPayouts`, `purchaseInvoices`, `receivables`, `sessionControl/cutoff`, `sessionControl/users`, `shifts`, `supplierAdvanceShiftIndexMeta`, `taxSettings` | `src/functions/22-close-controls.js` |
| `saveSharedChoiceIngredients` | `operationalAudit`, `posSettings/optionCosts` | `adminPerms`, `admins`, `sessionControl/cutoff`, `sessionControl/users` | `src/functions/40-sales-finance.js` |
| `scanLoyaltyBadge` | — | `adminPerms`, `admins`, `loyaltyBalances`, `loyaltyMembers`, `loyaltyRewardCatalog`, `loyaltyRewards`, `sessionControl/cutoff`, `sessionControl/users` | `src/functions/26-loyalty.js` |
| `searchLoyaltyMembers` | — | `adminPerms`, `admins`, `loyaltyBalances`, `loyaltyMembers`, `loyaltyMembersByPhone`, `loyaltyRewards`, `sessionControl/cutoff`, `sessionControl/users` | `src/functions/26a-loyalty-members.js` |
| `setCompanyInfo` | `operationalAudit` | `admins`, `companyInfo`, `sessionControl/cutoff`, `sessionControl/users` | `src/functions/20e-company-info.js` |
| `setPlatformPayoutDate` | `books/journal`, `cfLedger`, `financialCloseIndex`, `financialCloses`, `financialMovements`, `operationalAudit`, `platformPayouts` | `accountingPeriods`, `adminPerms`, `admins`, `sessionControl/cutoff`, `sessionControl/users` | `src/functions/43f-platform-metadata.js` |
| `setTaxSettings` | `operationalAudit` | `admins`, `companyInfo`, `sessionControl/cutoff`, `sessionControl/users`, `taxSettings` | `src/functions/20c-tax-settings.js` |
| `settlePlatformPayout` | `cashCustodyOpenIndex`, `cfLedger`, `financialApprovals`, `financialCommandClaims`, `financialMovements`, `operationalAudit`, `platformPayouts` | `accountingPeriods`, `adminPerms`, `admins`, `archivedOrders`, `cashCustody`, `cfAccounts`, `orders`, `platformRefDuplicates`, `platformVarAccounts`, `sessionControl/cutoff`, `sessionControl/users` | `src/functions/43d-platform-settlement.js` |
| `setUndepositedOpeningBalance` | `cashCustody`, `cashCustodyOpenIndex`, `financialApprovals`, `financialCommandClaims`, `financialMovements`, `operationalAudit` | `accountingPeriods`, `adminPerms`, `admins`, `sessionControl/cutoff`, `sessionControl/users` | `src/functions/22-close-controls.js` |
| `signOutAllPortalSessions` | `operationalAudit`, `portalLastSeen`, `sessionControl/cutoff` | `admins`, `sessionControl/users` | `src/functions/25-pos-assurance.js` |
| `startLoyaltyBadgeRecovery` | `loyaltyLinkThrottle`, `loyaltyOtp` | `loyaltyMembers`, `loyaltyMembersByPhone` | `src/functions/26a-loyalty-members.js` |
| `startLoyaltyLinkOtp` | `loyaltyLinkThrottle`, `loyaltyOtp` | `loyaltyMembersByPhone` | `src/functions/26-loyalty.js` |
| `startLoyaltyRedeemOtp` | `loyaltyOtp` | `adminPerms`, `admins`, `loyaltyMembers`, `sessionControl/cutoff`, `sessionControl/users` | `src/functions/26-loyalty2-admin.js` |
| `startLoyaltySignup` | `loyaltyOtp` | `loyaltyMembersByPhone` | `src/functions/26-loyalty.js` |
| `syncOfflinePosSale` | `activeOrders`, `activeQrTickets`, `archivedQrTickets`, `offlinePosSync`, `operationalAudit`, `orderInventoryPlans`, `orders`, `posActiveShift`, `posSyncAlerts`, `shiftHandovers`, `shiftSyncGates`, `shifts`, `staffPushTokens` | `adminPerms`, `admins`, `archivedOrders`, `optionRecipes`, `posSettings`, `sessionControl/cutoff`, `sessionControl/users`, `shiftCrews` | `src/functions/30-orders.js` |
| `unlinkLoyaltyFromDevice` | `appCustomers` | — | `src/functions/26-loyalty.js` |
| `updateOrderStatus` | `activeOrders`, `customerOrders`, `operationalAudit`, `orderStatusCommands`, `orders` | `adminPerms`, `admins`, `posActiveShift`, `sessionControl/cutoff`, `sessionControl/users` | `src/functions/20-portal-operations.js` |
| `validateRecipeDefinition` | — | `adminPerms`, `admins`, `sessionControl/cutoff`, `sessionControl/users` | `src/functions/40-sales-finance.js` |
| `verifyShiftCloseReadiness` | `shiftCloseVerifications` | `adminPerms`, `admins`, `archivedOrders`, `financialMovements`, `orders`, `posActiveShift`, `posDeviceHealth`, `sessionControl/cutoff`, `sessionControl/users` | `src/functions/25-pos-assurance.js` |

## 7. Backup markers

Each marks the nightly incremental backup dirty when its node changes: .
