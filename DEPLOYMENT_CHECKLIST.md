# Accaza POS — Deployment Checklist (build v45)
_Covers everything built this session: offline mode, two-state payments, recipe/costing rebuild, Excel import/export, and the six-feature roadmap (C→E+F→D→B→A)._

## 1. Deploy — two steps
1. **Upload `admin.html`** to GitHub (the back-office). This single file contains all the changes.
2. **Re-publish `database.rules.json`** in the Firebase Console → Realtime Database → Rules → paste → Publish.
   - Required because several phases added new nodes. Until you publish, saving to those nodes is denied.
   - `index.html` (customer site) was **not** changed this session — no need to re-upload it.

**Rollback:** keep the previous `admin.html`; if anything misbehaves, re-upload the old file. Rules can be reverted the same way.

## 2. New database nodes added this session (all admin-only r/w)
Confirm these appear in the published rules:
- `optionRecipes`, `inventoryAdjustments` (recipe/costing rebuild)
- `internalUsage` (staff + R&D consumption)
- `discrepancies` (discrepancy log)
- `pettyCashVouchers`, `pettyCashReplenishments`, `pettyCashCounter`, `pettyCashSettings` (petty cash)

No new node for scoped discounts (rides on `orders`) or offline mode (localStorage only).

## 3. One-time setup after deploy
- **Recipe → Consumables sub-tab:** tag each menu category as **Drink** or **Food** (so cups/stirrers auto-apply and consumables cost correctly).
- **Inventory:** load items (use **⬇ Import template → fill → ⬆ Import Excel**). Set Type (Base/Option/Consumable), unit, and **cost per unit**. For consumables set serves + cup size + qty/order.
- **Recipe → Base/Options sub-tabs:** load per-size quantities (Import template pre-fills your menu items) and map options to ingredients.
- **Register Ops → Payment methods:** turn on Card/EFTPOS only when your terminal arrives.
- **Discrepancies tab:** set tolerances (default Cash ± ₱50, Inventory ± 5%).
- **Petty Cash tab:** set the **Opening balance**.
- **Staff Access tab:** review the new per-staff toggles — Internal Usage (default on), Discrepancy Log (default off), Petty Cash (default on).

## 4. Smoke test (≈10 min, do after deploy)
**Offline mode** — open POS, disable Wi-Fi, ring a **cash** sale (works, red banner), try G-Cash (blocked), re-enable Wi-Fi (syncs, banner clears). Don't hard-refresh while offline.

**Payments (pending/verified)** — ring a G-Cash sale: it asks for a **reference number**, posts as **pending**; Register Ops → "Payments to verify" → Verify with manager PIN → card shows ✅ Payment verified.

**Recipe & costing** — add a Base ingredient + a Consumable cup; tag the coffee category Drink; build a recipe with S/M/L quantities; ring it → stock (incl. cup) drops, the order carries a COGS, P&L reflects it.

**Cash counting** — open a shift with the **denomination grid**; close with the **blind-count modal**; Z-report prints the breakdown.

**Internal Usage** — Staff → pick a latte → Record → stock drops, cost lands in P&L "Staff consumption", nothing in sales. R&D → ad-hoc ingredients → Record → lands in "R&D / testing".

**Discrepancies** — close a shift with a wrong count (> ₱50) → cash discrepancy + red badge; Adjust an ingredient > 5% → inventory discrepancy; Review one with manager PIN + note.

**Petty Cash** — set opening balance → create a voucher with a receipt photo → approve with manager PIN (approver must differ from requester) → Remaining drops → replenish "from register" with a shift open → pay-out shows in the Z-report → Print + Export.

**Scoped discounts** — ring 3 lattes + 1 pastry → discount modal → Senior + ID → "Discount 1" on a latte and the pastry (2nd Senior drink on same ID = blocked) → 5% promo on food = blocked → charge → receipt itemizes discounts; P&L/Z-report net sales drop.

## 5. Still pending (data entry, not code)
- Real gram/ml quantities per size and true unit costs — the #1 driver of COGS accuracy. Everything else is built and waiting on these numbers.

## Reference
- Full feature spec: `FUNCTIONAL_SPEC_pos_features.md`
- Import templates: `accaza-inventory-template.xlsx`, `accaza-recipes-template.xlsx`
- Current back-office build tag shown in the app: **v45**
