# Sales without a usable recipe

Admin build 588, 24 Sep 2026.

## Why

On 23 Sep a cashier could not produce her Z report. The shift contained one Mango Muesli (POS-DZQN35), a pastry marked "needs building" that had no recipe.

1. Costing returned an empty stock usage.
2. The database drops empty maps, so the sale's inventory plan was stored without `usage`.
3. `onOrderFinalize` then threw "Immutable server inventory plan is missing" on every retry, and the order was never marked `inventoryDeducted`.
4. `verifyShiftCloseReadiness` kept answering "Wait for server posting to finish. Inventory: 1", so the till fell back to a handover.
5. A manager could not finalize the handover either, because it waits for the same posting.

POS-CFRIGZ on Maria's 22 Sep shift is stuck the same way.

A recipe pointing at a deleted ingredient was worse: the server refused the whole sale at the till.

## Business rule (Danilo, 24 Sep 2026)

- Every sale proceeds.
- A line whose recipe is missing or broken ignores cost and is flagged.
- A flag must be resolvable. Flagging alone is not the end state.

## Lifecycle

| Stage | What happens | Where |
|---|---|---|
| Sale | The line takes no stock and no cost. The sale's revenue, payment and cash post as normal. | `UncostedSales.costOrderTolerant`, `calculateOrderInventoryPlan` |
| Plan | The immutable plan carries `uncostedLines`, `uncostedVersion: 1`, and `emptyUsage: true` when nothing was used. A server plan with no usage and no cost is valid. | `buildOrderInventoryPlan`, `UncostedSales.validPlan`, `HistoricalArchive.validInventoryPlan` |
| Finalize | Always completes. Sets `costPendingLines` on the order and opens a row per line in `/uncostedSales/{orderId}__{variant}_{line}`. | `finalizeOrderInventory`, `registerUncostedSale` |
| Shift | The close check no longer waits on these sales. The Z report shows "Sold without recipe: N line(s)". If a sale is still not posted, the close message names its order numbers. | `verifyShiftCloseReadiness`, `computeZ`/`showZ`, `ShiftHandover.report` |
| Visibility | Exception Center shows one warning per item. Recipes → Sales awaiting cost shows the list. Financial close shows a timing item (warning only, it does not block). Sales analytics mark the margin incomplete. | `operational-exceptions`, `assets/js/admin/uncosted-sales.js`, `financial-close` |
| Resolve: apply recipe | A manager previews the cost of the open lines of one item against today's recipe and ingredient costs, then approves that exact total. For each line, stock movements `ucs_<row>_<item>` (sale_usage) post, then Finance movement `ucogs_<row>`: Dr Cost of Sales / Cr Inventory, from the value the stock movements actually removed. | `manageUncostedSales` `apply_recipe` |
| Posting date | The original sale date when that accounting period is open, otherwise today. The entry records `originalOccurredAt` and `postedToOriginalDate`. | `uncostedPeriodOpen` |
| Resolve: no cost | A manager gives a reason. Lines close at ₱0 and nothing is posted. The item can optionally be marked `noRecipe: true`, so future sales are not flagged. | `confirm_no_cost` |
| Void / refund | Voided sales drop off the list. When stock is returned, the correction's stock returns too (`void_reversal_ucs_…`) and its journal is reversed (`ucogs_rev_<row>`). A sale that took no stock still completes its reversal. | `onOrderInventoryReversal`, `reverseUncostedCostCorrections` |
| Item correction | A completed-order item correction closes the old lines' flags (`superseded`) and flags the corrected lines. It is refused once a cost correction was posted. | `processOrderAdjustment` |
| Recovery | "Check past sales" (managers, from 1 Sep) finalizes stuck sales and flags lines from plans written before this release. It is idempotent and resumable. | `manageUncostedSales` `scan` |

## Controls

- **Idempotency.** Every row, stock movement and journal has a fixed ID. An apply claims the row with a 5-minute lease and stores the usage and date it will post, so a retry posts exactly the same figures. Applying twice changes nothing.
- **Approved total.** Apply refuses if the recomputed total differs from the total the manager approved in the preview.
- **Access.** Staff with the Recipes or Inventory permission can list and preview. Only owner, superadmin, admin or manager can apply, confirm no cost, or scan. The `/uncostedSales` node is server-only, and browsers cannot write `costCorrections` or `costCorrectionTotal` on orders.
- **History.** Posted sales are never rewritten: `cogsSnapshot` stays the sale-time figure. `costCorrections` and `costCorrectionTotal` sit beside it. The archive replica, sales analytics and the Books rebuild include the correction, and the rebuild no longer reports these sales as unposted historical COGS.
- **Audit.** Every resolution writes to `operationalAudit`.

## Known limits

- **Cost basis.** Ingredient cost is the weighted average at resolution, not at the time of sale. The preview states this.
- **Void without stock return.** The correction keeps its cost, the same as the original sale's usage.
- **Period closed mid-apply.** If the period closes between the preview and the posting, the apply stops with the period-closed error. Reopen the period, or wait for the lease to expire and apply again.
- **Unmapped options.** Options without mapped ingredients (the 24 known) are still warnings only. They are not flagged here.
