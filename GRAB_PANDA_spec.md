# Accaza POS — GrabFood & FoodPanda Integration (Build Spec)
_For sign-off before coding. All decisions below are locked from our discussion._

## Principles
- **POS is the single source of truth.** Every Grab/Panda order is re-keyed here → inventory + COGS deduct in real time.
- **Gross platform price = revenue; commission = expense.** Grab 25%, Panda 30% (editable). The real cost is trued-up weekly against the actual payout.
- **Platform sales are receivables, not drawer cash** — excluded from the cash drawer / Z-report; settled at the weekly payout.
- **Everything traceable** — the weekly payout variance is *allocated* to named accounts; nothing unexplained.

## Data model (new)
- `posSettings.channels` = `{ grabfood:{label,rate:0.25,active:true}, foodpanda:{label,rate:0.30,active:true} }` — rates & on/off editable in Settings.
- `channelPrices/{channel}/{itemKey}` = `{S,M,L}` — the Grab/Panda menu price per item & size. **Admin-editable** in a pricing screen + Excel import/export.
- **Order fields (added):** `channel` ('instore' | 'grabfood' | 'foodpanda'), `platformRef` (the Grab/Panda order #), `grossPlatform`, `platformDiscountPct`/`platformDiscount`, `commission`, `commissionRate`, `platformWht`/`platformWhtRate`, `platformVat`/`platformVatRate`, `netPlatform` (gross − commission − discount − WHT − VAT), `settlementStatus` ('unsettled' | 'settled'), `payoutId`.
- **Commission base:** GrabFood commission is `(gross − discount) × rate` — commission is charged on the price *after* the order discount. FoodPanda commission stays on full gross (`gross × rate`). WHT and VAT are on gross for both channels.
- `platformPayouts/{id}` = `{channel, periodStart, periodEnd, expectedNet, actualPayout, variance, allocations:{accountId:amount}, orderIds:[…], by, settledAt}`.
- `platformVarAccounts/{id}` = `{name, type:'expense'|'revenue', order}` — the variance account list, **editable** (seeded: Platform ads, Promo co-funding, Payment/processing fees, Penalties/adjustments, Refunds/cancellations [expense]; Incentives/rebates [revenue]).

## Feature 1 — Channel switch & platform checkout (POS)
- A **channel selector** by the Customer field: **In-store / GrabFood / FoodPanda** (only active channels show).
- Selecting Grab/Panda:
  - Every cart item re-prices to that channel's price list (`channelPrices`). Cart total = **platform gross**.
  - The payment area switches to a **platform panel**: a **required order-# field**, an optional **discount %** field, and a read-out of `Gross / Discount / Commission (rate) / WHT / VAT / Net`. No cash pad, no change, no drawer. For GrabFood, the read-out labels commission as "% of net of discount" when a discount is applied.
  - On **Charge & Complete**: records the order with `channel`, `platformRef`, `grossPlatform`, `platformDiscount`, `commission` (GrabFood: on gross less discount; FoodPanda: on gross), `platformWht`, `platformVat`, `netPlatform`, `settlementStatus:'unsettled'`; recipe COGS deducts in real time (same engine).
- Add-ons: platform prices are **all-inclusive**, so option prices are ignored for platform sales (item price only).
- Packages/promos: **in-store only** — not offered on the platform channel.

## Feature 2 — Channel pricing management (admin)
- A pricing screen (under Recipe/Menu or a new "Channel Pricing" tab): edit each item's Grab and Panda S/M/L prices inline; **admin-editable anytime**.
- **Excel import/export** (two templates: Grab, Panda — itemKey, item, S, M, L), same pattern as inventory/recipes, for bulk setup and updates.
- Reminder surfaced in the UI: the price here must match the live Grab/Panda menu, or recorded revenue drifts.

## Feature 3 — Finance → Platform Payout Reconciliation (per platform, weekly)
1. Pick **platform + period** (week). App lists that platform's **unsettled** orders in range and computes **Expected net** = Σ `netPlatform` (gross − commission − discount − WHT − VAT).
2. Enter the **actual payout** received (from the Grab/Panda statement / bank).
3. **Variance = actual − expected.** Allocate it across the **variance accounts** — each line an amount, and the allocations **must sum to the variance** (else it won't save). Accounts are editable (add/rename).
4. **Save & settle** → the period's orders are marked `settled` (payoutId set), the payout record is stored, and each allocation posts to its P&L line.
- **Cancellations/refunds** that happened on the platform are handled here: either void the re-keyed order (restocks + drops it from the receivable) or absorb it via the *Refunds/cancellations* allocation.

## P&L changes
- **Revenue** = in-store net sales **+ platform gross**.
- **Platform commission** — its own expense line (Σ commission of platform orders in the month).
- **Reconciliation allocations** — each variance account posts to its own expense/revenue line for the month.
- COGS unchanged (recipes, all channels). Net profit now reflects the true platform economics.

## Analytics changes
- Channel mix gains **GrabFood** and **FoodPanda**: gross revenue, commission, and **net margin after commission + COGS** per channel — so you can see whether platform orders actually make money.
- **Platform receivables** figure = Σ net of unsettled platform orders per channel (what the platforms still owe you).

## Rules (Firebase) — new nodes, admin r/w (must re-publish)
`channelPrices`, `platformPayouts`, `platformVarAccounts`, plus `posSettings.channels`.

## Suggested build order
- **Phase A:** Settings (channels + rates) · channel-pricing data + admin editor + Excel import/export · checkout channel switch + platform pricing + platform order capture (gross/commission/net/receivable) · analytics channel mix + commission. → You can start ringing platform sales and see them costed.
- **Phase B:** Finance payout reconciliation (expected vs actual, categorized variance, settle orders, editable accounts) + the P&L allocation lines + receivables view. → Full weekly truth-up.

## Honest notes
- The flat 25/30% is an estimate; **the reconciliation is where reality is booked** — expect a variance most weeks (ads, promos, fees), which is exactly why it's categorized.
- Accuracy depends on **re-keying discipline** and keeping **channel prices in sync** with the live platform menus. You've confirmed order volume is manageable.
- Books of record stay NetSuite/Xero — this is the management view; the variance accounts can map to your chart of accounts at posting time.
