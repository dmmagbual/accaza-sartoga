# Accaza — Recipe Costing Runbook

**Owner:** Danilo Magbual · **Cadence:** read before touching any recipe; review monthly
**Applies from:** admin build 444, costing engine `3E-1`
**Golden rule:** a recipe says what is **inside the drink**. Nothing else belongs in it.

---

## 0. Why this document exists

Recipe costing had grown by hand over a year. Nobody had written down what a recipe was
*supposed* to say, so each drink was filled in a slightly different way. That is not a
criticism of whoever typed them — it is what happens without a rule. Three defects came out
of it, all of them the same shape: **the same thing said twice.**

Read section 3 before you edit anything. It is the whole rule.

---

## 1. Where the costing lives

| Piece | Where | What it holds |
|---|---|---|
| The drink | `recipes/<itemKey>/base` | the ingredients in the cup, per size |
| Packaging | `packagingRules/<style>` | cup, lid, straw, serviette — by how it is served |
| Customer choices | `posSettings/optionCosts/<group>/<choice>` | one shared definition per choice |
| A drink's own version of a choice | `recipes/<itemKey>/choiceAdd/<group>/<choice>` | only when that drink genuinely differs |

The engine is `assets/js/shared/costing.js`. `functions/lib/costing.js` is a **copy** of it,
synced by `node tools/sync-costing.mjs`. The browser and the server must always run the same
version — the till shows the cost, the server posts it, and they have to agree.

---

## 2. What a drink costs, step by step

For one line of an order the engine adds up, in this order:

1. **base** — the drink's own ingredients at the size ordered
2. **each chosen option** — the drink's own definition if it has one, **otherwise** the shared
   library. One or the other. Never both.
3. **packaging** — from the serve style, which comes from the chosen temperature if that choice
   names one, otherwise from `menuItems/<key>/serveStyle`
4. **reduce rows last** — a row marked `op:"reduce"` takes out what the drink actually uses,
   capped at that, never below zero

Then it multiplies by the quantity ordered.

---

## 3. The rule, in four lines

- **The base is the drink without its temperature and without its cup.**
- **A choice says only what is DIFFERENT about that choice.** Not the whole drink again.
- **A choice that takes something out uses `op:"reduce"`.** Never a fixed minus.
- **Packaging is never typed into a recipe.** It comes from the serve style.

If you follow those four, the arithmetic looks after itself.

---

## 4. The three defects that were fixed, and how to recognise them again

### 4.1 A choice that repeats the whole recipe

`og_temp → Hot` had been filled in with the **complete hot recipe** — beans, milk, syrup, all
of it. But the engine ADDS a choice to the base. So a hot latte was costed twice and pulled
its ingredients off the shelf twice.

```
Cafe Latte  base : Coffee Beans 19g, Whole Milk 250ml
Cafe Latte  "Hot": Whole Milk 250ml, Coffee Beans 19g   ← the entire drink, again
                            cost 39.70 → 79.40
```

**15 drinks.** Repaired via *Recipes → Repair & restore*, which rewrites each temperature
choice as the difference from its base. ₱1,431.45 of cost of sales had already been posted
and was corrected on the same screen.

**How to spot it:** a choice whose ingredient list looks like the base recipe.

### 4.2 The library and the drink both charging

A choice can be defined in the shared library **and** inside the drink. The engine used to add
both, so a hazelnut charged the library's 0.5 fl oz and the drink's 0.75 together.

Fixed in the engine: **the drink's own definition overrides the library.** ₱214.42 of already
posted cost carries this pair; those lines are listed on the correction screen for a manual
look rather than corrected automatically, because the posted record says which *source* a row
came from, not which *choice* — on an order with two choices they cannot be told apart.

**How to spot it:** the same ingredient appearing twice in one drink's cost trace.

### 4.3 Packaging carried by luck

26 of 43 recipes had no cup, lid or straw in them at all — every hot and iced coffee was
showing a margin better than it was. The ones that did have it disagreed: nine near-identical
sets, differing only in serviette count and thick versus thin straw.

Now three serve styles cover all 60 drink-and-serve combinations. ₱391.73 of true cost across
the menu that was not being counted. **No prices changed** — the margin simply stopped
flattering itself.

---

## 5. The screens, and when to use each

All four live under **Recipes**. Each one takes a **restore point** before it will act, and each
one loads that file back to undo. Keep those files.

| Screen | Use it when |
|---|---|
| 🧪 Recipe | changing what is in a drink |
| 📦 Packaging | changing a cup, lid, straw or serviette — or its quantity |
| 📚 Share choices | a choice is spelled out in many drinks and should be in one place |
| 🛟 Repair & restore | after any bulk import, or if a hot drink looks twice its price |

### Changing a cup price
Do **not** edit any recipe. Inventory → the cup → its cost. Every drink follows.

### Changing what goes in a cup
📦 Packaging → edit the style → **Save the styles**. That alone moves no drink cost. The drink
picks it up because it is already told how it is served.

### Adding a new drink
Fill in the base ingredients. Set how it is served. That is all — the cup and the choices are
already defined.

---

## 6. What to check monthly

1. **Cost gap badge** on the Recipes tab — any drink with no recipe, a ₱0 cost, or an
   ingredient with no cost.
2. **Ring up one hot drink and one iced drink.** Confirm the cup shows in the cost trace and
   the total matches the recipe screen. This is the check that catches a till and server
   disagreement, which is the failure that quietly poisons the books.
3. **Repair & restore** — should report *nothing to repair* and *nothing to correct*. If it
   finds something, a recipe has been edited into one of the shapes in section 4.
4. **Physical count on milk, oat milk and beans.** These are the ingredients a double-charge
   shows up in first, because they are in nearly every drink.

---

## 7. Decisions still open

- **`Regular` sweetness.** It is defined as *add condensed milk 0.75*. Most drinks already have
  condensed milk in the base, so sharing that definition would sweeten them twice on paper.
  The recommendation is an **empty** library definition — sweetness lives in the base on this
  menu — but it has not been set.
- **Serviette count on a hot cup.** Set to 5, copied from the cold cup, because the only drink
  that had ever defined a hot style listed none. If the counter hands over 1 or 2, change it in
  📦 Packaging. It is ₱0.24 a serviette.
- **24 options carry no ingredient cost.** Whipped cream, cold foam, chocolate chip and five
  syrups on drinks that offer them. Each needs a yes or no: does it consume stock?

---

## 8. If something looks wrong

**A drink suddenly costs about double.** A choice has been filled in with the whole recipe.
Open Repair & restore; it will name the drink.

**Saving a serve style fails with PERMISSION_DENIED.** The database rules have not been
deployed: `firebase deploy --only "database" --project "accaza-sartoga"`.

**The till and the posted cost disagree.** The Functions copy of the engine is behind. Run
`node tools/sync-costing.mjs`, commit, and deploy Functions.

**You want to undo a bulk change.** Every screen's restore point is a sealed file with a
SHA-256 fingerprint. Load it back on the same screen. It refuses a file that has been altered.

---

## 9. Proving a change before you make it — no login needed

```powershell
Set-Location -LiteralPath "C:\AKALIKO\DMM\PERSONAL\CLAUDE\Projects\Accaza Coffee Shop"

node tools/recipe-temperature-repair.mjs <backup.json>
node tools/serve-style-packaging.mjs <recipes-restore-point.json> <backup.json>
node tools/option-library.mjs <recipes-restore-point.json> <backup.json>
```

Each reads a downloaded file, prices every drink and size before and after, and writes nothing
anywhere. Run one before a change you are unsure of.

Guarded by `npm test` — `test:recipe-temperature`, `test:cogs-duplication`,
`test:serve-style-packaging`, `test:option-reduce`, `test:option-library`. If you change the
costing engine and one of these fails, the failure is the point: read what it says.
