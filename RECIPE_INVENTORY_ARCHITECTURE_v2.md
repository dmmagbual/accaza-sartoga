# Recipe / Inventory / Costing — Architecture Redesign & Migration Plan

Status: **analysis + proposal. No code changed.** Read this, pick the scope at the bottom, then I build in backward-compatible slices.
Date: 2026-08-08 · Author: Claude (for Danilo) · Current build: admin v133, functions Phase 1, sw v34.

---

## 0. Bottom line up front

Your #1 stated pain — *"switching brands forces me to re-edit every recipe"* — **is already solved in your live system.** Today a recipe row points at a generic inventory item (`Fresh Milk`, one ID), not at a brand. Brands blend into that one item at weighted-average cost; the brand name only lives on the purchase receipt. So changing Magnolia → Arla today is a purchase entry, not a recipe edit. That's the same principle you locked in the v119/v128 SOP.

What you're asking for on top of that is **four genuinely new capabilities**, and they do not carry the same cost/benefit:

| New layer you're requesting | Value | Effort | Risk | My call |
|---|---|---|---|---|
| Formal **SKU + Approved-brand list** (activate/deactivate/priority, supplier, package size, per-brand cost visibility) | High | Medium | Low, additive | **Build it** |
| **Standard cost vs Actual COGS** split (pricing cost vs accounting cost) | High | Low | Low, additive | **Build it** |
| **Batch/Lot tracking** (remaining qty per lot, expiry, per-lot cost preserved) | Medium–High | High | Medium | **Phase carefully** |
| **FIFO consumption** across lots + per-lot actual COGS | Medium | High | High (concurrency) | **Only with server-authoritative engine** |
| **Multi-branch** (different brands per branch, shared recipe) | High *later*, low *today* (single store) | High (touches everything) | High | **Schema-ready now, don't build the machinery yet** |

The honest tension I want you to see before we commit: **weighted-average cost (WAC) already produces a defensible "actual" COGS** — it's a GAAP/PFRS-accepted method, and it's what NetSuite would call moving-average. FIFO's extra accounting benefit over WAC is small for a coffee shop. FIFO's *real* payoff is **expiry / lot traceability** (which milk lot is about to spoil), not cost accuracy. So the question isn't "FIFO is better" — it's "do you want lot-level expiry tracking badly enough to pay the daily data-entry and engineering cost." I lay that out in §7 and §11 so you decide with eyes open, per your own rule: no hidden bad news.

---

## 0.5 Locked scope (decided 2026-08-08)

Danilo's answers, and what they mean:

1. **Batches for expiry only — keep WAC as actual COGS.** → The **deduction engine, recipes, and COGS stay exactly as they are.** No FIFO rebuild, **no Cloud Function redeploy** for costing. Batches (`inventoryBatch`) become a *parallel* layer for expiry/spoilage tracking + brand-lot audit; `inventory.stock` (WAC pool) remains the source of truth for stock and cost. **Phase 4 (FIFO) is dropped** from scope.
2. **Multi-branch — schema-ready now, build later.** → Every new stock node carries `branch:"main"`. No branch UI/machinery built now.
3. **Committed phases — P0→P3, revisit later.** → Migration scaffolding → SKU/approved-brand UI → purchases-create-batches (+ expiry view) → standard-vs-actual cost split. Each ships independently.
4. **Standard cost method — assumption:** default = current WAC (change to latest-purchase/replacement or manual in Phase 3). Flagged for your confirmation; not a blocker.

**Resulting risk profile:** low. The engines that could break history (client `tryDeduct`, server `onOrderFinalize`) are **not modified**. New work is additive nodes + UI + purchase writes. Standard-vs-actual is a reporting addition. Only caveat to decide in Phase 2: whether sale-time batch depletion (for the expiry view) is best-effort client-side, or also mirrored in the Cloud Function — see §9 P2.

Deploy footprint for the committed scope: **admin.html + database.rules.json** (re-publish for new nodes). **No `functions/index.js` change** unless we choose server-side batch depletion in P2.

---

## 1. Current architecture (as-is, traceable to code)

**Inventory item** — `inventory/{ing_id}` (created in `addIngredient`, admin.html):
```
{ name, unit, type: base|option|consumable|both, category,
  stock,            // single pooled number
  reorder, cost,    // single weighted-average cost per base unit
  serves, size, qtyPerOrder, updatedAt }
```
This one record silently plays **three roles at once**: the logical ingredient, the stock pool, and the cost. There is no separate brand/SKU record and no lot.

**Recipe** — `recipes/{itemKey}` (`saveRecipe`):
```
{ base:[ {ing, unit, dispS/M/L, qtyS/M/L} ],   // ing = inventory item ID
  choiceAdd:{ gid:{ optKey:{label, ings:[{ing,qtyS/M/L}]} } },
  options:[…legacy…], updatedAt }
```
Recipe rows already bind to the **generic item ID**, not a brand. Good — this is the part we preserve verbatim.

**Purchases** — `postPurchases` / `receiveStock` write:
- `inventory/{id}.stock += received` and `inventory/{id}.cost = weighted-average` (5-dp),
- an audit row `stockReceipts/{id} = {ing, brand, supplier, recvQty, recvUnit, unitCost, invoiceId, date…}` — **brand is captured here only, as metadata**,
- one `purchaseInvoices/{id}` header, plus cash-out or a payable via `window.__cf`.

**Deduction + COGS** — two engines that must stay in lockstep:
- Client `computeUsage(lineItems)` → per-item total qty → `tryDeduct` subtracts `inventory/{ing}/stock` (idempotent transaction claim on `orders/{id}/inventoryDeducted`) and snapshots `order.cogsSnapshot = Σ usage×inventory.cost`, `cogsCovered`.
- Server `computeUsageServer` in `functions/index.js` (`onOrderFinalize`, fires on `Completed`/`Received`) — a **port of the same logic**, same idempotent claim, so whoever wins deducts exactly once.

**Other consumption paths** (all subtract the same pooled `stock`): `internalUsage` (staff / R&D / overhead), `inventoryAdjustments` (count-variance, wastage), refunds/voids restock.

**Costing today:** one number. `inventory.cost` (WAC) is used for **both** menu-pricing analysis **and** actual COGS. Snapshot at sale (`cogsSnapshot`) freezes it so history doesn't drift.

**Reports reading `inventory.stock` / `.cost`:** Stock Value tab, Cost Sheet, P&L (`pnlFor` uses `cogsSnapshot` + variance), Analytics channel mix, Daily Report, Discrepancies, `menuCostGaps`, `brandBreakdown` (already reads `stockReceipts`), Excel import/export. **~14 call sites.** Full list in §5.

**Scope guardrails in force:** single store; Blaze plan (you already run 2nd-gen Cloud Functions); client deducts instantly for POS speed, server is the browser-independent backstop.

---

## 2. Target architecture, mapped to your 9 requirements

Your hierarchy, expressed as Firebase nodes:

```
MENU PRODUCT            menuItems/{key}                       (exists)
  └ RECIPE (versioned)  recipes/{key} + recipeVersions/{key}/{vId}   (versioning NEW)
      └ RECIPE INGREDIENT   base[].ing  → points at INGREDIENT MASTER   (unchanged binding)
          └ INGREDIENT MASTER   ingredientMaster/{mid}                 (= today's inventory item, promoted)
              └ APPROVED SKU     inventorySku/{sid}  (masterId, brand, supplier, pack, active, priority)   NEW
                  └ BATCH/LOT    inventoryBatch/{bid} (skuId, masterId, qtyRecv, qtyRemain, unitCost, recvDate, expiry, lot, branch)   NEW
                      └ FIFO CONSUMPTION   consumptionLedger/{cid} (txnType, refId, masterId, lots:[{bid,qty,unitCost}], totalCost)   NEW
                          └ ACTUAL COGS    order.cogsActual + order.cogsLots   NEW (keep cogsSnapshot for compat)
```

Requirement-by-requirement target:

1. **Ingredient Master** — `ingredientMaster/{mid}` with `baseUnit`. **We do not create new IDs**; we *reinterpret each existing `inventory/{id}` as the master* (see §4). Recipes keep pointing at the same IDs → zero recipe edits.
2. **Inventory SKU** — new `inventorySku/{sid}` = `{masterId, brand, supplier, purchaseUnit, packSize, purchaseCost, convToBase, costPerBase, active, priority, branchAvail[]}`.
3. **Approved mapping** — the `masterId` on each SKU *is* the mapping; `active` + `priority` give you approve/deactivate/rank. No recipe edit ever needed to add/drop a brand.
4. **Batches/Lots** — new `inventoryBatch/{bid}` with `qtyRemaining`, `unitCost` (frozen), `recvDate`, `expiry`, `lot`, `branch`. Purchases create batches; historical costs never overwritten.
5. **FIFO consumption** — deduction walks eligible batches oldest-first, splitting one sale across lots when needed. Recipe still just says `Fresh Milk = 180 ml`.
6. **Recipe structure** — unchanged shape; add **versioning** so a historical order references the recipe version in force at sale time.
7. **Costing** — two numbers: **Standard** (`master.stdCost`, configurable = current/replacement or WAC — used for pricing/margin/food-cost%) and **Actual** (from FIFO lots — used for accounting).
8. **Multi-branch** — every stock-bearing node carries `branch` (default `main`); recipes stay global. Depletion is branch-scoped.
9. **All consumption types** (POS, staff, waste, production, R&D, adjustments) route through the **same** FIFO ledger, each writing an auditable `consumptionLedger` row of which lots at which cost.

**Core principle preserved:** recipe = *what*; SKU/approved-list = *which brand*; batch = *what it actually cost*.

---

## 3. Gap analysis (have / partial / missing)

| # | Requirement | Today | Gap |
|---|---|---|---|
| 1 | Ingredient Master, brand-independent | **Have** (generic item) | Formalize: add `baseUnit`, `stdCost`, `kind`; rename role |
| 2 | SKU with brand/supplier/pack/active/priority | **Partial** (brand on receipts only) | Missing first-class SKU records |
| 3 | Approved Ingredient→SKU mapping | **Missing** (any receipt allowed) | New mapping + approve/rank |
| 4 | Batches/lots, no cost overwrite | **Missing** (single pool + WAC) | New batch layer |
| 5 | FIFO consumption across lots | **Missing** (WAC pool subtract) | New depletion engine (client+server) |
| 6 | Recipe versioning | **Missing** (overwrite; orders snapshot usage) | Add version records |
| 7 | Standard vs Actual COGS | **Partial** (one WAC number, snapshotted) | Split the two concepts |
| 8 | Multi-branch | **Missing** (single store) | Branch scoping across nodes |
| 9 | Unified consumption ledger w/ lot audit | **Partial** (usage recorded per order/adjustment, no lots) | Add lot-level ledger |

---

## 4. The migration keystone (this is what makes it safe)

**Promote, don't replace.** Each existing `inventory/{id}` *becomes* its Ingredient Master **keeping the same key**. Recipes reference those keys today, so **recipes need no edits** — the exact outcome you demanded.

One-time, reversible migration script (dry-run first, backup exists):

1. **Master:** for every `inventory/{id}`, set `masterUnit = unit`, `stdCost = cost` (seed standard = current WAC), `kind = cogs|overhead` (from `category`). Keep `stock`, `cost` as-is (now treated as *cache/standard*, see step 4).
2. **SKU seed:** for each distinct `brand` seen in that item's `stockReceipts`, create one `inventorySku/{sid}` `{masterId:id, brand, active:true, priority}`. Items with no brand history get one default SKU `"(unbranded)"`. You then curate the approved list in the UI.
3. **Opening batch:** create **one** `inventoryBatch` per master = `{skuId: default, masterId:id, qtyRemaining: current stock, unitCost: current WAC, recvDate: today, lot:"OPENING", branch:"main"}`. **Quantities and cost preserved exactly** — the sum of batch remaining = today's stock, at today's cost.
4. **Derived cache:** keep `inventory/{id}.stock` and `.cost` **updated as a cache** = `Σ batch.qtyRemaining` and standard cost. Every existing report keeps working unchanged during and after migration (they read the cache); we swap them to batch-aware reads slice by slice.
5. **History untouched:** past orders keep `cogsSnapshot`/`inventoryUsage`; `stockReceipts`/`purchaseInvoices` untouched; `recipes` untouched.

Rollback = restore the pre-migration backup node; the batch/SKU nodes are additive so deleting them reverts behavior.

---

## 5. Dependency map — everything that touches stock/cost (must be updated in lockstep)

Deduction / cost engines (the pair that must never diverge):
1. `computeUsage` (client) and 2. `tryDeduct` (client) — admin.html
3. `computeUsageServer` and 4. `onOrderFinalize` — functions/index.js **(Blaze redeploy each time this changes)**

Consumption writers (all currently subtract `inventory.stock`):
5. `receiveStock` / 6. `postPurchases` (create stock+WAC) → become **batch creators**
7. `finalizeAdjust` (`inventoryAdjustments`) 8. `internalUsage` (staff/R&D/overhead) 9. refund/void restock

Readers of `stock`/`cost` (kept working via the cache, then upgraded):
10. Stock Value tab 11. Cost Sheet 12. `pnlFor` (P&L) 13. Analytics channel-mix COGS 14. Daily Report 15. Discrepancies 16. `menuCostGaps` 17. `brandBreakdown` (already receipt-based) 18. Excel import/export (inventory + recipes)

Rules (`database.rules.json`): new admin-r/w nodes `ingredientMaster` (or reuse `inventory`), `inventorySku`, `inventoryBatch`, `consumptionLedger`, `recipeVersions`. **Re-publish required.**

That's ~18 call sites + rules + a Cloud Function redeploy. This is why we phase, and why every phase keeps the `stock`/`cost` cache alive so nothing breaks mid-migration.

---

## 6. Costing: standard vs actual

**Standard / expected cost** (`master.stdCost`, per base unit): drives menu pricing, target margin, food-cost %, the recipe Cost-per-drink calculator. Configurable method — default = current WAC; options = replacement (latest purchase) or manual. Changing it never touches history.

**Actual COGS** (per sale, from FIFO lots): when an order finalizes, the engine records `order.cogsLots = [{masterId, bid, qty, unitCost}…]` and `order.cogsActual = Σ`. Example, 180 ml milk:
- Lot A Magnolia @ ₱0.095/ml has 120 ml left → take 120 ml = ₱11.40
- Lot B Arla @ ₱0.11/ml → take remaining 60 ml = ₱6.60
- `cogsActual` line = **₱18.00**, fully traceable to two lots. Recipe unchanged.

P&L uses `cogsActual` when present, falls back to `cogsSnapshot` for legacy orders → no gap in historical statements. Standard-vs-actual variance becomes a reportable number (your kind of number).

---

## 7. FIFO + concurrency — the real engineering decision  *(RESOLVED: not building FIFO — see §0.5. Kept for the record.)*

FIFO across lots is **stateful**: each sale must read eligible batches, decide the split, and decrement `qtyRemaining` on possibly several lots. Two risks:

- **Race conditions.** Two POS terminals (or client + the server backstop) depleting the same master at once can double-spend a lot or drive `qtyRemaining` negative. Your current single-subtract model tolerates concurrency; multi-lot FIFO does not, unless writes are serialized.
- **Client vs server duplication.** Today both client and server can deduct (idempotent claim picks one). With FIFO, the *lot split* must be computed by exactly one authority or the two can disagree.

Recommendation: **make FIFO depletion server-authoritative.** The client keeps instant *optimistic* UX (shows the sale, decrements the cached `stock` for display), but the **authoritative lot split + `cogsActual` is computed in the Cloud Function** inside a transaction per master. This is correct-by-construction and removes the "two engines must match byte-for-byte" burden — the server owns lots, the client owns speed. Cost: the actual-COGS number lands a second or two after the sale (on finalize), not instantly. For a coffee shop that's fine.

Alternative (not recommended): keep client-side FIFO with per-master transactions. Works at one terminal, gets fragile with two terminals + the server backstop.

---

## 8. Migration risks & mitigations

| Risk | Mitigation |
|---|---|
| Recipes break / need relinking | **Keystone §4:** masters keep existing IDs; recipes never touched |
| Inventory quantities drift | Opening batch = exact current stock; cache `stock` = Σ remaining, reconciled post-migrate |
| Historical costs overwritten | Batches freeze `unitCost`; WAC cache untouched; past `cogsSnapshot` untouched |
| Purchase history lost | `stockReceipts`/`purchaseInvoices` untouched; new batches link back to them |
| Sales history lost | Orders keep `cogsSnapshot`/`inventoryUsage`; `cogsActual` added only forward |
| Client/server engines diverge | Server-authoritative FIFO (§7) removes the dual-engine hazard |
| Mid-migration breakage | Every phase keeps the `stock`/`cost` cache live; readers upgraded one at a time |
| Negative stock during cutover | Batch depletion clamps ≥0 + writes a discrepancy (reuse existing tolerance/discrepancy tab) |
| Rollback | Additive nodes; restore pre-migration backup to revert |

---

## 9. Phased implementation plan (each phase ships on its own, backward-compatible)

**Phase 0 — Migration scaffolding (no behavior change).** Add `ingredientMaster` fields in place (`baseUnit`, `stdCost`, `kind`), seed `inventorySku` from receipt brands, seed one opening `inventoryBatch` per item, keep `stock`/`cost` as cache. Ship dry-run report first. *Deploy: rules + admin.html.*

**Phase 1 — SKU & Approved-brand management UI (high value, low risk).** New "Approved SKUs" panel under each ingredient: add/edit brand, supplier, pack size, purchase cost, conversion, active toggle, priority. This alone gives you brand control with zero recipe edits — likely the 80/20 of what you actually want. *Deploy: admin.html (+rules if not from P0).*

**Phase 2 — Purchases create batches.** `postPurchases`/`receiveStock` write `inventoryBatch` rows (with expiry, lot) against the chosen SKU, and keep updating the WAC cache. Brand breakdown + stock value read batches. *Deploy: admin.html.*

**Phase 3 — Standard vs Actual cost split.** Add `stdCost` method setting; pricing/calculator use standard; nothing consumes lots yet (actual still = WAC snapshot). Low risk, unlocks variance reporting. *Deploy: admin.html.*

**Phase 4 — Server-authoritative FIFO depletion + actual COGS.** The big one. Cloud Function depletes eligible batches oldest-first, writes `consumptionLedger` + `order.cogsLots`/`cogsActual`; client switches to optimistic display + defers authority to server. Extend to staff/R&D/waste/adjustments. *Deploy: admin.html + functions redeploy + rules.*

**Phase 5 — Recipe versioning.** Snapshot `recipeVersions/{key}/{vId}` on save; orders stamp `recipeVersionId`. *Deploy: admin.html + rules.*

**Phase 6 — Multi-branch (only if/when you open a second store).** Add `branch` scoping to batches/ledger/shifts/reports + a branch switcher. Schema is branch-ready from P0 (`branch:"main"`), so this is additive, not a rewrite. *Deploy: broad.*

You can stop after any phase and have a coherent, shippable system. My recommendation: **do P0→P3 now** (brand/SKU control + costing split — the real business win, low risk), then **decide on P4 FIFO** deliberately, and **defer P6** until a second branch is real.

---

## 10. What I explicitly recommend against (and why)

- **Don't** create brand-new master IDs and relink recipes — it re-introduces the exact pain you're removing. Promote in place.
- **Don't** run FIFO on the client across multiple terminals — concurrency will corrupt lot balances. Server authority or nothing.
- **Don't** build full multi-branch now for a single store — it taxes every node and report for zero current benefit. Make the schema branch-ready and stop there.
- **Consider** whether you need FIFO at all vs WAC + expiry alerts. If the goal is "know which milk expires first," a lightweight **expiry-batch tracker** (Phase 2 batches + an expiry dashboard) gives you that **without** rebuilding the costing engine (Phase 4). WAC already costs correctly. This could save the largest, riskiest phase.

---

## 11. Decisions I need from you before building

1. **FIFO depth.** (a) Full server-authoritative FIFO + per-lot actual COGS, or (b) batches for **expiry tracking only**, keep WAC as actual COGS (much smaller, lower risk)? — *the single biggest cost/scope fork.*
2. **Multi-branch.** Schema-ready now but build later (recommended), or you need working multi-branch in this project now?
3. **Standard cost method.** Current WAC / latest-purchase replacement / manual — for menu pricing.
4. **Scope to approve now.** I recommend committing **P0→P3** first and revisiting P4 after you see the SKU/costing layer live. Agree, or go further?

Answer these four and I'll turn the approved phases into the usual full deploy set (admin.html + rules + functions as needed), built in backward-compatible slices with node-checks at each step.
