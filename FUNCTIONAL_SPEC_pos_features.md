# Accaza POS — Functional Specification: Six New Features
_Discovery / design document. Nothing built yet — for review and sign-off._
_Grounded in the existing system: Firebase Realtime DB, the `computeUsage`/`tryDeduct` deduction engine, `inventoryAdjustments` ledger, `shifts`/`computeZ` Z-report, manager-PIN (`__posIsManagerPin`), and `activityLog`._

---

## Design principles carried across all six features
1. **One deduction engine.** Every stock movement (sales, staff, R&D, wastage, count adjustment) flows through the same recipe logic (`computeUsage` → base-per-size + options + category consumables) so nothing is costed twice or missed.
2. **Ledgers, not mutable balances.** Balances (petty cash, drawer, stock) are *derived* from immutable event logs. No silent overwrites — every number traces to an entry. (Your rule #1.)
3. **Idempotent + reversible.** Every deduction/voucher has a stable ID and a reverse path (void = reversing entry + restock), mirroring the existing order-void logic. Nothing is hard-deleted from an audit trail.
4. **Segregation of duties.** Requester ≠ approver; cashier acts, manager PIN approves; cash counted "blind" where it matters.
5. **The P&L must tell the whole story** with four distinct cost lines: COGS-of-sales, consumption variance/wastage, **staff consumption**, and **R&D/testing** — so product margin is never distorted by non-sale usage.

---

# Feature A — Scoped (Line-Item) Discounts

### 1. User Stories
- As a **cashier**, I want to apply a Senior/PWD/Athlete discount to only the eligible person's own drink and food, so that a group's other items aren't wrongly discounted.
- As a **cashier**, I want to log the discount ID number and name, so that the sale is defensible in a BIR/audit review.
- As a **manager**, I want the 5% drink promo limited to one eligible drink per customer after other mechanics, so that group totals can't inflate the promo.
- As a **finance manager**, I want each discount recorded per line with its basis, so that net sales and the discount register are fully traceable.

### 2. Functional Requirements
- **FR-A1** Discounts attach to **line items**, not the receipt. Replace the current flat `order.discount` with a structured `order.discountLines[]`.
- **FR-A2** Discount types: `senior`, `pwd`, `athlete` (statutory, default **20%**, rate configurable), and `promo5` (5% drink promo). Rate stored per type in `posSettings.discountTypes`.
- **FR-A3** Per statutory ID (idNumber), enforce **max 1 drink + 1 food** discounted. Per `promo5`, **max 1 drink** per customer.
- **FR-A4** Capture per discount application: `type`, `idNumber`, `holderName`, `lineRef` (itemKey+size+unit index), `base`, `rate`, `discountValue`.
- **FR-A5** **Per-unit granularity.** A qty-3 line with one eligible unit splits into 1 discounted + 2 full-price for calculation and display.
- **FR-A6** When more units are eligible than the cap allows, discount the **highest-priced** eligible unit (best outcome for the customer) by default.
- **FR-A7** **No stacking** on the same unit (a unit gets statutory *or* promo5, never both).
- **FR-A8** `order.total = Σ line net`; `order.discount` (legacy field) = Σ discountValue for backward compatibility with Z-report/analytics.
- **FR-A9** Rounding: apply rate, then round each discounted line to the nearest centavo; respect `posSettings.cashRounding` at order level only.
- **FR-A10** Manager PIN optional per type (`posSettings.discountTypes[type].requirePin`).

### 3. Data Model
- `orders/{id}.discountLines[]` = `{type, idNumber, holderName, itemKey, size, unitIndex, base, rate, discountValue, ts, by}`
- `posSettings.discountTypes` = `{senior:{rate:0.20,requirePin:false}, pwd:{...}, athlete:{...}, promo5:{rate:0.05,cap:'1drink'}}`
- (Optional, BIR-ready) `statutoryDiscountLog/{YYYY-MM}/{id}` = `{date, type, idNumber, holderName, orderId, grossItem, discount}` for the OSCA/PWD logbook export.

### 4. Business Logic Rules
- If a statutory discount is applied → `idNumber` is **required** (block checkout without it).
- If an eligible drink already carries `promo5` → statutory discount cannot also apply to that unit (and vice-versa).
- If discounted units for an idNumber would exceed 1 drink + 1 food → block the extra and warn.
- If a discounted line is refunded/voided → reverse the exact `discountValue` in net sales.

### 5. Integration Touchpoints
- **Cart/checkout:** `chargeSale` builds `discountLines`, recomputes totals; POS cart UI needs a per-line "apply discount" affordance and a per-unit split renderer.
- **Z-report (`computeZ`):** `z.discounts` sums `discountLines`.
- **Analytics/P&L:** `saleFields.discount` reads summed line discounts; net sales unchanged in formula (gross − discounts − refunds).
- **COGS:** unaffected (cost side); margin per line becomes more accurate.

---

# Feature B — Petty Cash Voucher System

### 1. User Stories
- As a **staff member**, I want to raise a digital petty-cash voucher with a photo of the receipt, so that I never take cash straight from the sales drawer.
- As a **manager**, I want to approve/reject vouchers with my PIN, so that no disbursement happens without authorization.
- As a **finance manager**, I want a petty-cash report (beginning balance, disbursements, replenishments, remaining), so that the fund reconciles like a real imprest fund.

### 2. Functional Requirements
- **FR-B1** Voucher fields: `date`, `amount`, `category`, `requesterName`, `approverName`, `receiptImage` (upload), auto `voucherNo`, `status`.
- **FR-B2** Auto voucher number, sequential, gap-free: format `PV-YYYYMM-####` via a transactional counter.
- **FR-B3** Approval workflow: created as **`pending`** → manager PIN → **`approved`** (only then does it reduce the float) → or **`rejected`**.
- **FR-B4** On approval, the amount is deducted from the **petty-cash fund** (a fund *separate from the sales drawer*).
- **FR-B5** Receipt image upload (Firebase Storage), stored URL on the voucher; mandatory for approval (`no receipt = no approval`, your rule).
- **FR-B6** Print / export a voucher as **PDF** (print-window pattern, same as the Z-report) and export the register to **Excel** (SheetJS, already loaded).
- **FR-B7** Report: **Beginning Balance, Total Disbursements, Total Replenishments, Remaining Balance** for a chosen period, with the voucher list as backup.
- **FR-B8** Replenishment entries top up the fund (`amount`, `date`, `by`, `source`, `note`).
- **FR-B9** Approved vouchers are **locked** (no edit); correction = a **void/reversing** entry, never a delete.
- **FR-B10** Requester ≠ approver enforced.

### 3. Data Model
- `pettyCashVouchers/{id}` = `{voucherNo, date, amount, category, requesterName, approverName, receiptUrl, status, createdBy, createdAt, approvedAt, voided, voidReason}`
- `pettyCashReplenishments/{id}` = `{amount, date, by, source, note, ts}`
- `pettyCashCounter` = `{seq}` (per-month), transactional
- `pettyCashSettings` = `{openingBalance, categories[]}` (categories can map to `expenseItems` for P&L flow)
- **Derived balance** = openingBalance + Σ replenishments − Σ approved-non-void vouchers.

### 4. Business Logic Rules
- If a voucher is approved and its amount > remaining fund balance → **block** (or warn + require replenishment).
- If receipt image is missing → approval is blocked.
- If a voucher is voided after approval → a reversing entry restores the balance; the number stays (marked VOID).
- If replenishment `source = 'sales drawer'` → it must also post a **drawer pay-out** so the Z-report drawer reconciles (see Feature C paid-out).

### 5. Integration Touchpoints
- **Firebase Storage** (new): the one genuinely new infrastructure piece — image bucket + storage rules.
- **P&L:** approved vouchers optionally post to `monthlyExpenses` by category (petty spend flows into overhead automatically — high value).
- **Cash drawer/Z-report:** only if replenished from the register (as a logged pay-out). Otherwise the petty fund is independent.
- **Permissions/`adminPerms`:** new "Petty Cash" section; create vs approve gated separately.

---

# Feature C — Denomination Cash Counting

### 1. User Stories
- As a **cashier**, I want to enter the count of each bill and coin at open/close, so that the drawer total is computed for me and errors drop.
- As a **manager**, I want the counted total compared to expected sales automatically, so that variance surfaces immediately.

### 2. Functional Requirements
- **FR-C1** Denomination grid — bills: **₱1000, 500, 200, 100, 50, 20**; coins: **₱20, 10, 5, 1, ₱0.25, ₱0.10, ₱0.05**.
- **FR-C2** Enter **quantity** per denomination; system computes line value and grand total live.
- **FR-C3** Used at **shift open** (opening float) and **shift close** (counted cash) — replaces the current single-number prompts.
- **FR-C4** Store the full denomination breakdown on the shift, not just the total.
- **FR-C5** Close compares counted vs **expected drawer** (`openingFloat + cash sales − refunds − pay-outs + pay-ins`) → variance.
- **FR-C6** Same component reused for the petty-cash physical count.
- **FR-C7** (Best practice, optional) "blind count" mode — hide the expected figure until the count is submitted.

### 3. Data Model
- `shifts/{id}.openCount` / `.closeCount` = `{ "1000":n, "500":n, …, "0.05":n }`
- `shifts/{id}.openingFloat`, `.countedCash` (derived sums), `.expectedCash`, `.variance` (existing, now denomination-backed)
- Add `shifts/{id}.payIns[]` / `.payOuts[]` = `{amount, reason, ts, by}` (drawer movements mid-shift)

### 4. Business Logic Rules
- Counted total = Σ (denomination × quantity), read-only.
- Expected drawer must include mid-shift **pay-ins/pay-outs** (bank drop, petty replenishment) or variance will be wrong.
- If |variance| > tolerance (`posSettings.cashTolerance`) → raise a **Feature D discrepancy** automatically.

### 5. Integration Touchpoints
- **`computeZ`/Z-report:** `countedCash` now comes from the grid; Z-report prints the denomination breakdown.
- **Feature D:** cash variance beyond tolerance auto-logs a discrepancy.
- **Feature B:** petty-cash count reuses the same grid.

---

# Feature D — Discrepancy Alerts & Audit Log

### 1. User Stories
- As a **manager**, I want to be alerted when counted cash doesn't match expected, or when stock movement doesn't match sales, so that shortages/overages are caught early.
- As a **finance manager**, I want every discrepancy in a permanent audit log with who/when/how much, so that patterns (shortages, encoding errors) are reviewable.

### 2. Functional Requirements
- **FR-D1** Two discrepancy sources: **cash** (counted vs expected at close) and **inventory** (expected consumption from sales vs actual stock movement at count).
- **FR-D2** Each discrepancy records: **Affected Item** (inventory) or drawer (cash), **Expected Qty/Amount**, **Actual**, **Variance**, **Value (₱)**, **Date/Time**, **Staff/Shift**, **type** (shortage/overage/encoding), **status** (open/reviewed).
- **FR-D3** Inventory reconciliation = for a period/count: expected usage (Σ recipe deductions from sales) vs actual movement (opening − closing + purchases − other-usage) → per-item variance; flag items beyond tolerance.
- **FR-D4** Cash discrepancy auto-created from Feature C when |variance| > tolerance.
- **FR-D5** Permanent **audit log** — entries are never deleted; only annotated/closed with a manager note.
- **FR-D6** In-app alert surface: a badge/count on Register Ops + a Discrepancy Log tab (no server push; this is a client PWA).
- **FR-D7** Tolerances configurable (global ₱/% and optional per-item) — "minimal variance acceptable."

### 3. Data Model
- `discrepancies/{id}` = `{kind:'cash'|'inventory', item?, expectedQty, actualQty, variance, value, shiftId, staff, type, status, note, reviewedBy, ts}`
- Builds on existing `inventoryAdjustments` (the inventory variance ledger already captures count-vs-book) and `shifts.variance`.
- `posSettings.tolerances` = `{cash:{peso,pct}, inventoryDefaultPct, perItem:{ingId:pct}}`

### 4. Business Logic Rules
- If close variance > cash tolerance → auto-create cash discrepancy (`open`).
- If a physical count adjustment (`inventoryAdjustments`) exceeds item tolerance → auto-create inventory discrepancy referencing that adjustment.
- Closing a discrepancy requires a manager note (root cause) — status → `reviewed`.
- Discrepancies are **read-append-annotate only**; never editable/deletable.

### 5. Integration Touchpoints
- **Pulls from both** cash counts (Feature C / `shifts`) **and** inventory logs (`inventoryAdjustments`, sales `inventoryUsage`) — exactly the cross-link you called out.
- **Feeds** the P&L variance line and management review.
- **Honesty note:** true "real-time" applies to **cash at close** and **negative-stock flags**; inventory reconciliation is **count-driven** (periodic), because actual usage is only known when someone counts. The word "real-time" is scoped accordingly.

---

# Feature E — Staff Consumption (non-sale deduction)

### 1. User Stories
- As a **staff member**, I want to record a drink/food I made for internal use, so that stock stays accurate without faking a sale.
- As a **finance manager**, I want staff-meal cost reported separately, so that it doesn't distort product margin.

### 2. Functional Requirements
- **FR-E1** Fields: `itemPrepared` (menu item + size), `quantity`, `recipient`, `reason` (Staff Meal / Staff Drink / Management), `dateTime`, `recordingAccount`.
- **FR-E2** Deducts **recipe ingredients + category consumables** (a staff latte still uses a cup) via the **same `computeUsage` engine** as a sale.
- **FR-E3** **Never** written to `orders` → never a sale, no revenue, excluded from sales analytics and channel mix.
- **FR-E4** Cost is **snapshotted** at time of entry (frozen unit costs), like `cogsSnapshot`.
- **FR-E5** Each entry is idempotent with a stable ID; **edit/delete reverses** the stock (restock) and re-applies — mirrors order void.
- **FR-E6** Negative stock allowed + flagged (consistent with the rest of the system).
- **FR-E7** Dedicated report: staff-consumption cost by period, reason, item, recipient.
- **FR-E8** Optional manager PIN above a configurable value/threshold.

### 3. Data Model
- `internalUsage/{id}` = `{kind:'staff', itemKey, size, qty, recipient, reason, recordingAccount, ts, usage:{ing:qty}, cost, reversed}`
- Reuses `recipes`, `optionRecipes`, `inventory`, `posSettings.catType` for the deduction.

### 4. Business Logic Rules
- On save → run `computeUsage([{itemKey,size,qty}])`, subtract from `inventory/{ing}/stock` (transaction), store `usage` + `cost`.
- On delete/void → add the `usage` back (restock), mark `reversed`.
- Excluded from all sales/revenue aggregations by construction (separate node).

### 5. Integration Touchpoints
- **Deduction engine:** identical path to sales (`computeUsage`/stock transaction), guaranteeing consistent costing incl. consumables.
- **P&L:** new line **"Staff consumption"** (operating cost), separate from COGS-of-sales, variance, and R&D.
- **Consolidation:** replaces the ad-hoc `inventoryAdjustments` reason `staff-drink` with a proper recipe-based deduction (one path, not two).
- **Permissions:** new "Internal Usage" section in `adminPerms`.

---

# Feature F — R&D / Product Testing (non-sale deduction)

### 1. User Stories
- As a **product developer**, I want to log ingredients used to develop/test a recipe, so that R&D cost is captured and separated from staff meals.
- As a **finance manager**, I want R&D cost reported on its own, so that it reads as investment, not consumption.

### 2. Functional Requirements
- **FR-F1** Fields: `item/recipe`, `quantity`, `category` (Testing / Training / Sampling / Quality Check), `recipient`, `reason`, `dateTime`, `recordingAccount`.
- **FR-F2** Same recipe-based deduction as Feature E, tagged `kind:'rnd'` + `category`.
- **FR-F3** **Ad-hoc ingredient support:** R&D often tests a recipe **not yet on the menu** — must allow a free-form ingredient list (pick inventory items + quantities on the fly), in addition to selecting an existing menu recipe.
- **FR-F4** Cost snapshot at time of entry; idempotent + reversible (as E).
- **FR-F5** **Separate** reports for R&D cost, split by category — distinct from staff-meal reporting.

### 3. Data Model
- `internalUsage/{id}` = `{kind:'rnd', category, itemKey?|adhocLines:[{ing,qty}], qty, recipient, reason, recordingAccount, ts, usage:{ing:qty}, cost, reversed}`
- (Unified with Feature E under one `internalUsage` node; `kind` + `category` separate the reports.)

### 4. Business Logic Rules
- If `itemKey` given → deduct via recipe; if `adhocLines` given → deduct those ingredients directly.
- Same reverse-on-delete semantics as E.
- R&D never touches sales/COGS-of-sales.

### 5. Integration Touchpoints
- **Deduction engine:** shared with E; only reporting/costing bucket differs.
- **P&L:** new line **"R&D / testing"**, separate from staff consumption.
- **Recipes:** ad-hoc mode is effectively a throwaway mini-recipe — reuses the ingredient picker components from the Recipe builder.

---

# Cross-cutting blind spots (God-mode review)

1. **"Real-time" inventory discrepancy is a half-truth.** Because the engine deducts *exactly* per recipe, sold-vs-deducted always matches by construction. The real discrepancy only appears when a **physical count** disagrees with the book. So Feature D's inventory side is **count-driven, not per-order**. Cash discrepancy *is* real-time (at close). Set expectations now or the feature will feel "broken."
2. **The four-bucket P&L is non-negotiable.** COGS-of-sales, variance/wastage, staff consumption, R&D must be **four separate lines**. If staff/R&D usage lands in COGS-of-sales, product margin lies. This is the single biggest data-integrity risk.
3. **Statutory discount law.** Senior/PWD/Athlete in PH are **20% + VAT-exempt** by statute (RA 9994 / 10754 / 10699) — confirm the current BIR revenue regs with your accountant. You're **non-VAT** so exemption is moot *today*, but the moment you cross ₱3M it isn't. Capture `idNumber` + `holderName` **now** so you're BIR-ready without a rework. Rate must be configurable, not hard-coded at 5%.
4. **Per-unit line splitting is the hard UX.** "1 discounted latte out of 3 on the ticket" means the cart must reason in **units**, not lines. This is the trickiest build in the set — worth prototyping first.
5. **Receipt images = new infrastructure.** Petty cash is the only feature needing **Firebase Storage** (bucket + rules + a small cost). Everything else fits the current RTDB + engine. Decide: Storage, or defer image upload to phase 2 and start with metadata + a "receipt on file" flag.
6. **Petty cash must be a truly separate fund.** If it's quietly drawn from the sales drawer, you've recreated the exact problem you're solving. Define the **replenishment source**; if ever from the register, it must post a logged drawer pay-out (Feature C) or the Z-report breaks.
7. **Segregation of duties or it's theatre.** Requester ≠ approver (petty cash); manager note to close a discrepancy; blind cash count. Without these, the audit trail is decorative.
8. **Reversibility everywhere.** Staff/R&D/petty entries need the same **void-restock** discipline as order voids, or edits silently corrupt stock and cost. Stable IDs + reverse paths, never hard delete.
9. **Data-entry fatigue.** E, F, and petty cash add manual work. If the forms aren't fast (defaults, PIN, 3 fields max on the happy path), staff route around them — and you lose the very accuracy you built this for.
10. **Offline scope.** These are back-office/manager actions. Recommend **online-only** for petty cash, consumption, R&D, and discrepancy review (the offline queue stays sales-cash-only). Cash counting is part of shift open/close and works offline.
11. **Permissions & audit permanence.** Each new tab needs an `adminPerms` entry (and always-hide for staff where money is involved). Discrepancy log and vouchers are **append/annotate-only**.

---

# How I'll build it (fit to the current architecture)

**Reused, not reinvented:** the deduction core (`computeUsage` + stock transactions + cost snapshot) already handles base-per-size + options + consumables — Features **E and F** are a thin `deductInternal(usage, meta)` wrapper over it, writing to a new `internalUsage` node instead of `orders`, plus a reverse function. **Manager PIN**, **`activityLog`**, **SheetJS export**, and the **print-window** (Z-report) pattern are all already in place and reused by B, C, D.

**New infrastructure:** only **Firebase Storage** (Feature B receipt images). New DB nodes: `pettyCashVouchers`, `pettyCashReplenishments`, `pettyCashCounter`, `internalUsage`, `discrepancies`, plus `posSettings` sub-keys (`discountTypes`, `tolerances`, petty categories) and `shifts` extensions (denomination counts, pay-ins/outs). Each new node needs an admin r/w rule (re-publish `database.rules.json`).

**Suggested phasing** (each slice independently shippable, lowest risk first):
1. **Denomination cash counting (C)** — small, high daily value, and it *feeds* D. Extends shift open/close.
2. **Staff + R&D consumption (E + F together)** — one engine, two report buckets. Highest cost-accuracy payoff after recipes are loaded.
3. **Discrepancy log (D)** — builds on C's cash variance + the existing `inventoryAdjustments`. Mostly an audit/reporting layer.
4. **Petty cash (B)** — biggest; gated on the Firebase Storage decision.
5. **Scoped discounts (A)** — trickiest UX (per-unit splitting); prototype the cart model first.

**Deliverables per slice:** DB nodes + rules, the tab UI (under Register Ops or new nav), the engine wiring, an Excel/PDF export where relevant, `adminPerms` entry, a version bump, and a validation pass — same discipline as everything built so far.

---

## Decisions to lock before any build
1. **Discount rates & law:** confirm Senior/PWD/Athlete = 20% (configurable) and whether promo5 can ever stack (recommend: no). Capture ID number + name now?
2. **Petty cash receipt images:** enable Firebase Storage now, or phase-1 metadata + "receipt on file" flag, images in phase 2?
3. **Petty cash fund source:** fully separate imprest fund (recommended), or replenished from the register (needs drawer pay-out logging)?
4. **P&L presentation:** confirm four separate cost lines (COGS-of-sales / variance / staff / R&D).
5. **Consumption approval:** manager PIN always, only above a threshold, or log-only?
6. **Build order:** accept the phasing above (C → E+F → D → B → A), or reprioritise?

---

## Modifier / choice costing (build v110)

**Problem.** Required customer selections change the true cost of a drink: Temperature (Hot needs a hot cup + lid + extra coffee; Iced needs a cold cup + dome lid + ice), Sweetness (Regular / Less / Not = different sugar qty), Choice of Milk (Whole vs Goodmate Sub Oat — different cost; oat also carries a +₱ price). The old model costed only the base recipe plus flat, size-blind add-ons, so these deltas were missing from COGS.

**Structuring rule.** The base recipe holds only what every selection shares. Everything a choice changes is pushed out of the base into per-choice cost rows, so every required choice is purely **additive** (the engine only adds, never subtracts — no negative deltas to fight).

**Data model (new).** `posSettings.optionCosts[groupId][optKey(label)] = { label, ings:[ {ing, qtyS, qtyM, qtyL} ] }`.
- Nested under `posSettings` (already admin-writable) — **no new Firebase rule / re-publish needed**.
- A choice can carry **multiple ingredients** (Hot → hot cup + lid + extra coffee).
- Quantities are **size-aware** (S/M/L) and independent; a blank or empty size cell = **0 for that size** (no inheritance from M), matching the base-recipe engine.
- **Join key = group + choice label.** Group-scoping kills cross-group label collisions (two groups can both have "Regular"). Historical orders are unaffected — COGS is snapshotted (`cogsSnapshot`) at sale time.
- **Backward compatible:** if a choice has no `optionCosts` row, costing falls back to the legacy per-name `optionRecipes` map, so existing add-on (syrup/shot) costs keep working until migrated.

**Engine wiring.** `choiceIngs(item, rec, label, size)` resolves a selected choice to `[{ing, qty}]`. Both cost and stock now use it: `itemCost()` (COGS/margin) and `computeUsage()` (real-time inventory deduction), so booked cost and deducted stock always agree with the customer's actual selections.

**Editor.** Recipe tab → "Optional ingredients" now lists every option group and its choices; under each choice you set ingredient rows with S/M/L quantities and see live cost/serving per size. One "Save option costs" button writes `posSettings.optionCosts`.

**Per-recipe choice deltas (build v113).** Some choice costs differ per drink (e.g. Hot adds +20g coffee on an Americano but +30g on a Vanilla), so they can't live in the shared global cost. New per-recipe field `recipes/{itemKey}.choiceAdd[groupId][optKey(label)]={label,ings:[{ing,qtyS,qtyM,qtyL}]}`. `choiceIngs` now **stacks** layers for a selected choice: global `optionCosts` (shared items like cups/ice/milk) **plus** the recipe's `choiceAdd` (that drink's delta). Legacy `optRecipeFor` only fires if neither layer has an entry. Editor: the recipe screen has an "Extra ingredients per choice — this drink only" section listing that item's option groups/choices with S/M/L ingredient rows; saved into `recipes/{key}.choiceAdd`. So: base = common to all temps; global = shared per-choice; choiceAdd = per-drink per-choice delta. Example: Americano Hot = base 30g + global(hot cup+lid) + choiceAdd(+20g); Vanilla Hot = base 30g + global(hot cup+lid) + choiceAdd(+30g).

**Known limitation / deferred.** The join is group+label, not a stable per-choice ID. Renaming a choice in the Option Groups manager still needs the matching cost row renamed (or it drops to legacy/zero). A full per-choice-ID join was deferred because it would require changing the live order-capture schema (line items store `optLabels`, not IDs) and migrating in-flight data — higher risk for little added safety once collisions are handled by group-scoping.

---

## Purchases — Goods-Received Note (build v119)

**Purpose.** A multi-line supplier-delivery entry that increases stock and re-costs items, replacing one-at-a-time Receive for bulk. Implements the **function model**: brands of the same product blend into one generic inventory item at weighted-average cost; recipes (bound to the item ID) keep costing at that blended average with no edits.

**Where.** Stock group → **📥 Purchases** tab (`renderPurchases`, POS script). Permission `purchases` (default OFF for staff — it touches money).

**Entry.** One invoice header (supplier, invoice/ref, date, received-by, and one payment for the whole invoice: none / paid-now-from-account / on-account payable). Then N lines. Each line:
- **Pick existing item** (blends its cost — this is how a brand switch is handled) **or ＋ new item** (name + stock unit + type; new items are created with the received stock and cost).
- **Brand** (optional) — recorded on the receipt and shown on the stock card; never part of the item name.
- **Qty + unit** — measurement units only (ml/L/g/kg/pcs); the unit dropdown for an existing item is **dimension-guarded** (only units compatible with its stock unit), so you can't receive kg into an ml item. Qty converts to the item's stock unit via `convertToStock`.
- **Cost** — either ₱ per unit or line total (one derives the other).
- Live per-line preview: converted stock added + new weighted-average cost; live invoice total.

**Posting (`postPurchases`).** Per line: new items created via `inventory/{id}` with received stock+cost; existing items get `stock += convertedQty` (transaction) and `cost` recomputed to weighted average, **stored at 5-decimal precision** (display 2) so cheap per-unit costs stay accurate. Each line writes a `stockReceipts` row (adds `brand`, `recvQty`, `recvUnit`, `invoiceId`). One `purchaseInvoices/{id}` record ties the receipts together; one cash-out (`__cf.postOut`, category Purchases) or one Payable (`__cf.addPayable`) for the invoice total. Double-post guarded by an in-flight flag.

**Untouched.** Deduction engine, recipes, and COGS snapshots are unchanged — the page only adds stock and updates item cost via the same weighted-average mechanism the single Receive already used. Recipe costs move only when a purchase moves them, and only for orders after that point.

**Rules.** New node `purchaseInvoices` (admin r/w) — one `database.rules.json` re-publish. `stockReceipts` already existed. **Cloud Function unaffected** (purchases are an admin action; no server deduction involved).

**Verified.** Node test: condensed-milk two-brand blend (0.20 + Brand B → 0.21429/ml), 500 ml received into a litre-stocked item (→ 0.5 L, re-avg 280/L), new-item first receipt (1000 ml @ 0.86). POS block `node --check` clean; rules JSON valid.
