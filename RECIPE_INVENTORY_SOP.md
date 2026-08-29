# Recipe & Inventory SOP — Brand-Independent Costing

_How Accaza's POS keeps every recipe linked to real inventory, so costing stays correct no matter which brand you buy._

## The one principle

**An inventory item is a *function*, not a brand.** You stock "Condensed Milk," "Choco Syrup," "Fresh Milk" — never "Alaska Condensed Milk" or "Hershey's Syrup." A recipe points at that generic item by its internal ID. Whatever brand you buy goes *into* that same item, its cost blends to a weighted average, and every recipe using it re-costs automatically. Brand is recorded on the receipt and the stock card for traceability — it never becomes a separate stock item.

That single rule is what makes costing brand-independent: the recipe captures the real ingredient consumed; the brand only affects the blended cost, not the link.

## The three-layer model

1. **Inventory item** — the generic ingredient, one measurement unit (ml, L, g, kg, pcs), one weighted-average cost. The single source of truth for what an ingredient costs.
2. **Recipe** — references inventory items by ID, with a quantity per size (S/M/L). Cost per drink = sum of (quantity × item cost). Because it links by ID, renaming an item never breaks it.
3. **Purchase** — any brand received into an inventory item; updates its stock and re-blends its weighted-average cost. Recipes need no edit.

## Standard procedures

### A. Create a new ingredient (do this before it appears in a recipe)
1. Inventory → **Add item**.
2. Name it **generically** (the function, no brand). One item per product form: Choco *Syrup*, Choco *Powder*, Choco *Bar* are three items.
3. Pick **one measurement unit** and never mix dimensions for that item (a liquid is ml/L or fl oz — never bare "oz," never grams).
4. Set the type (Base / Option / Consumable / Both). Leave cost at 0 if you'll set it via the first purchase.

### B. Build / cost a recipe
1. Recipes tab → pick the menu item (the **not-costed flag** lists everything still uncosted; click **Cost it** to jump straight in).
2. Add each ingredient from the dropdown — it **only lists real inventory items**, so a recipe can never reference something that doesn't exist.
3. Enter the quantity per size, in whatever unit is convenient (it converts to the item's stock unit for costing).
4. Put drink-specific extras (e.g. Hot → +coffee) in "Extra ingredients per choice"; put things shared across drinks (cups, ice) in the shared **Optional ingredients** tab.
5. Save. The item drops off the not-costed flag.

### C. Buy stock — any brand
1. Purchases tab → one invoice header (supplier, ref, date, payment).
2. Each line: **pick the existing generic item** (this is how a brand switch blends), enter quantity + measurement unit + cost, and note the **brand** on the line.
3. Post. Stock rises, weighted-average cost updates, recipes re-cost automatically. Two brands in one delivery blend into one correct average.
4. Only use **＋ New item** for something genuinely new to the menu — and if the name already exists, the system routes it into that item instead of creating a duplicate.

### D. Retire an ingredient
- You **cannot delete** an inventory item while any recipe or option uses it — the system blocks it and lists where it's used. Repoint or remove those recipe lines first, then delete. This is what prevents broken links.

## What the system enforces for you (build v128)

- **Recipes can only pick real inventory items** (dropdown, no free text) — no dangling or brand-typed ingredients.
- **Delete is blocked** while an item is referenced by any recipe / per-choice extra / shared option cost, with the list of references shown.
- **The not-costed flag** surfaces any menu item that is: not costed, ₱0 cost, has an ingredient with no cost, or **points at a deleted ingredient (broken link)**.
- **Purchases route duplicate names into the existing item** and blend brands at weighted-average cost.
- **Resale / bought-in items** can be marked "No recipe needed" so they don't nag the flag.

## Do / Don't

**Do**
- Keep item names generic; put the brand on the receipt.
- One measurement dimension per item.
- Receive every brand of a product into the same item.
- Clear the not-costed flag before treating the menu as fully costed.

**Don't**
- Don't create brand-specific inventory items.
- Don't delete an ingredient that recipes use (the app will stop you — repoint first).
- Don't use bare "oz" for liquids (use ml/L or fl oz).
- Don't assume a new brand keeps the same recipe *quantity* — if it's more concentrated, adjust the recipe amount by hand; the system blends cost, not yield.

## Honest limits
- Cost is **snapshotted at each sale** and re-blends going forward — entering invoices late means daily COGS lags reality, so receive promptly.
- Server-side lock-down of stock/cost writes and manager-PIN approvals is a separate Firebase/Cloud-Function project (not yet built).
