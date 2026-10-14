# Homemade pastry batch card (deferred build)

**Status:** design agreed with Danilo on 14 Oct 2026. **Not approved for implementation.** No code has been written.
**Deferred to:** after the current Purchases/Payments work.

## The problem

Two cookies are baked in-house from bought ingredients (Choco Chip Cookie, Oat Choco Chip Cookie). A run
yields a variable number of pieces — 15, 16, 17, 18 or 19. The original idea was to expense all
ingredients and credit the expense back on production. That fails: the credit is undefined, it can exceed
the month's purchases, and it double-relieves cost whenever the cookies also carry a recipe.

The agreed answer is a **batch card**: a simple tool that records one completed bake and moves value from
the ingredients to the baked cookies. It is documentation plus one inventory movement — not an accounting
state machine, and not a work-in-process ledger.

## Decisions taken

| Date | Decision |
|---|---|
| 14 Oct 2026 | **The card is created after the cookies are already baked.** It is not a live in-progress record and there is no time-lapse posting. |
| 14 Oct 2026 | **Ingredients stay in 1240.** No work-in-process account, no dough stock item, no second transfer. Both sides of the posting use 1240, so the account total and profit never move during baking. |
| 14 Oct 2026 | Yield is variable (15–19). The card uses the **actual** piece count, so cost per piece follows the real bake. Nothing is typed in. |
| 14 Oct 2026 | Recipe costing for drinks and pastries is unchanged. This build adds batch-level inventory, not a second costing engine. |
| 14 Oct 2026 | Placement: **Inventory** group, tab immediately after 🧪 Recipes, labelled **🥐 Baking**. |
| 14 Oct 2026 | The ingredient list comes from a saved per-product **template that is fully editable** — lines added, removed or changed at any time. |
| 14 Oct 2026 | **Sub-tabs are data-driven.** One sub-tab per configured baking product. New cookie variations are added as data, never by changing code or deploying. |
| 14 Oct 2026 | **Any staff may post a batch card, including cashiers.** No approval step. Delivered through a dedicated `baking` permission and a server-only callable — never by widening the shared inventory callable. |
| 14 Oct 2026 | Cost basis is each ingredient's **moving-average cost at posting time**, which is how the rest of the system already behaves. |
| 14 Oct 2026 | Every card can be **printed** as an internal document showing ingredients used, unit cost, total cost and the actual pieces produced. |
| 14 Oct 2026 | **Mapping is enforced, not assumed.** The pastry item must be mapped to 1240 / 5030, and any mapping failure refuses the card outright — the card must never proceed on a wrong stock item. |
| 14 Oct 2026 | **The mapping is confirmed once and stored.** The posting path does not re-interview; it compares against the stored confirmation and refuses only if something drifted. |
| 14 Oct 2026 | **Products, templates and items are added or archived, never hard-deleted** once they have history. A discontinued cookie's sub-tab disappears; its stock item, cards and printed pages stay. |
| 14 Oct 2026 | **A card links to items by ID and keeps a name snapshot.** Renaming an item is cosmetic: it is logged, it never rewrites a posted card, and it never forces re-confirmation. |
| 14 Oct 2026 | **A card is never blocked by insufficient ingredient stock.** Posting may lag production, so a negative ingredient balance is accepted and flagged; cost is provisional until the purchase is booked. Only a line with no cost at all is refused. |

The earlier work-in-process design (account 1245 plus a dough item, posted at mixing and again at baking)
is **dropped**. It assumed the card would be opened while the dough was still dough. Since the card is
written after baking, that stage has nothing to hold.

## Accounts

No new accounts are required.

| Account | Use |
|---|---|
| 1240 Inventory – Food & Pastries | ingredient stock **and** baked cookie stock |
| 5030 COGS – Food & Pastries | cost of a cookie that was actually sold |
| 5900 / 6077 / 6078 | spoiled cookie, staff, samples |
| 1000 / 2000 | cash or payable for the purchase |

## Placement and naming

| Item | Decision |
|---|---|
| Tab group | **Inventory** (`admin.html`, `data-grp="stock"`) |
| Position | **immediately after 🧪 Recipes**, before 🍽️ Internal Usage |
| Tab label | **🥐 The Art of Baking** (tab key stays `baking`) |
| Record name | **Batch Card**; the list reads "Batch cards" |
| Batch ID | `BAKE-2026-10-20-01` |
| Actions | New batch card · Post batch · Reverse batch · Print |
| Screen module | `src/admin/pos/45-baking.js` (next free number after `40-internal-usage.js`) |
| Tab key | `baking` |
| Config node | `bakingProducts` |
| Card node | `batchCards` |
| Movement types | `production` / `production_reversal` — **server-only** |
| Not Purchases | That screen is supplier receiving and raises a payable (`admin.html:640`, `src/admin/pos/20-purchasing.js:75`). A bake has no supplier, invoice or payable. |

Resulting Inventory tab order: Stock Items · Inventory · Recipes · **Baking** · Internal Usage · Packages.

On-screen wording is shop language; node names, movement types and tab keys stay stable technical
identifiers, because display names are labels and never join keys.

If in-house work later expands beyond baking — syrups, sauces, portioned cakes — promote it to its own
**Kitchen** group rather than stretching the word "Baking".

## Sub-tabs and templates, all data-driven

Nothing about the products is hard-coded, so a new cookie variation never needs a code change.

`/bakingProducts/{id}` holds one configured product:

| Field | Meaning |
|---|---|
| `name`, `emoji`, `sortOrder`, `active` | what the sub-tab shows and where it sits |
| `pastryItemId` | the pastry stock item this product produces |
| `template[]` | the usual lines: `itemId`, `qty`, `unit` |

- The Baking tab renders one sub-tab per active product, in `sortOrder`.
- **A "＋ Add product" action** creates a new one: name, emoji, pastry stock item, and the template lines.
  Available to anyone holding the `baking` permission.
- **The template is always editable** — add an ingredient, remove one, change a quantity. It is a starting
  point, never a constraint on the card.
- **Adding a future variation** is data entry: create the pastry stock item, add the menu item with a
  one-line recipe, then add the baking product and its template. No code, no deploy, no release.

**Snapshot rule.** A posted card stores its own copy of the product name, every line's item name, quantity,
unit, unit cost and value, and the actual piece count. Later edits to the template, to an item name or to a
cost never rewrite a posted card. The template is a convenience; the card is the record.

## Once, at setup

1. Ingredient stock items as today: inventory account 1240, cost account 5030.
2. Two pastry stock items: `Choco Chip Cookie` and `Oat Choco Chip Cookie`, unit **pc**, inventory account
   1240, cost account 5030.
3. Each cookie menu item's recipe becomes one line: **1 pc of its pastry stock item**.
4. Ingredient purchases keep going through Purchases. Nothing about that changes.
5. Two baking products configured with their usual ingredient templates.

## How it will happen, moment by moment

This section doubles as the UAT script for the eventual build.

**Moment 1 — shop.** Purchases invoice as today: Dr 1240 ingredients / Cr cash or AP. Unchanged.

**Moment 2 — bake.** Physical work. Nothing is recorded yet, and nothing needs to be.

**Moment 3 — write the card, the same day.**

Admin → Inventory → 🥐 Baking → pick the cookie's sub-tab → New batch card.

- A batch ID is issued (for example `BAKE-2026-10-20-01`). Enter the date and who baked.
- The template's lines arrive prefilled. **Add, remove or change any line** to match what was actually used.
- Enter the **actual pieces** — 15, 16, 17, 18 or 19.
- The card previews each line's quantity, moving-average cost and value, the total batch cost (₱510 in the
  example), and cost per piece = total ÷ actual pieces.
- Post batch. Print if wanted.

| | Debit | Credit |
|---|---|---|
| 1240 Food & Pastries — `Choco Chip Cookie`, 17 pcs at ₱30.00 | ₱510.00 | |
| 1240 Food & Pastries — each ingredient consumed | | ₱510.00 |

Both sides are 1240, so the account total and **profit do not move at all**. Only the items change. A run
of 15 gives ₱34.00 per piece; 19 gives ₱26.84.

**Moment 4 — sell.** The till deducts one pastry item per cookie sold: Dr 5030 / Cr 1240. Revenue posts as
always. **Profit moves here, and only here.**

**Moment 5 — leftovers and mistakes.**

| Event | Entry |
|---|---|
| Spoiled cookie | Dr 5900 / Cr 1240 |
| Staff ate a cookie | Dr 6077 / Cr 1240 |
| Free sample | Dr 6078 / Cr 1240 |
| Wrong card posted | full reversal of both legs, then re-enter |

A posted card is never edited. Reversal restores both the ingredient quantities and the cookie quantity,
and inverts the exact stored amounts.

**Printing.** Following the existing internal-document pattern (`src/admin/pos/40-internal-usage.js:152-161`):
a new window, inline-styled HTML, and a Print button hidden under `@media print`. It shows batch ID, date
and time, product, posted by, every ingredient line with quantity, unit, unit cost and value, the total
batch cost, the actual pieces, the cost per piece, and a "checked by" line. Order receipts use their own
path (`src/admin/pos/50h-receipt.js:12`), which this does not disturb.

**What appears where**

- Admin → Inventory → Baking: sub-tabs per product, each with its card list — batch ID, date, pieces, batch
  cost, cost per piece, who posted, posted or reversed, print.
- Admin → Inventory: ingredient items and the two pastry items.
- Finance Books: no new account and no change to the 1240 total from baking. 5030 moves only on a sale or a
  disposal. Baking is invisible in profit — which is correct.

## Rules that must hold

1. **The cookie recipe is one line: 1 pc of its pastry item.** Never grams of ingredients on the menu item
   once the card exists, or the ingredients are consumed twice — once by the card and once by the sale.
2. **Post the card the same day, before the till sells that batch.** The pastry item can only cost a sale
   once it has stock and a unit cost.
3. A posted card is immutable; correction is a linked reversal plus a replacement.
4. The batch ID is the idempotency key.
5. The pieces created equal the actual count entered, valued at total ÷ actual pieces. Never a nominal 17.
6. `production` and `production_reversal` are **server-only**. The browser never sends a quantity, a cost or
   a total; the server derives all of them.
7. A posted card keeps its own snapshot of every line. Template edits never rewrite history.

## Mapping validation — the card must refuse, not warn

A card resolves three things before it posts: which items are consumed, which item is produced, and which
accounts those items carry. All three are checked **server-side before any write**. One failure refuses the
whole card and nothing posts. Validation runs twice — when a baking product is saved, and again when a card
is posted, because a template can be edited after it was saved.

**The produced pastry item must be:**

| Check | Rule |
|---|---|
| exists | a deleted item refuses the card |
| unit | non-empty |
| inventory account | **1240** Inventory – Food & Pastries. Refused for 1200 / 1210 / 1220 / 1230 / 1270 / 1280 — a cookie produced into Coffee & Beans misstates that account |
| cost account | **5030** COGS – Food & Pastries |
| category | a food/pastry category, so COGS reporting buckets it correctly (`src/functions/50-inventory.js:464`) |
| unique | not the pastry item of another active baking product — two sub-tabs writing one item would blend their costs |
| not an ingredient | must not appear as a line in any product's template |

**Every ingredient line must be:**

| Check | Rule |
|---|---|
| exists | a deleted item refuses the card |
| not a supply | refused if `recipeItem === false` or the item is a supply type |
| inventory account | in the allowed 12xx list (`src/functions/50-inventory.js:230`) |
| cost account | in the allowed cost list (`src/functions/50-inventory.js:231`) |
| not the pastry item | no self-consumption |
| quantity | a positive quantity, inside the existing bounds, and no duplicate line for one item. A line left at **zero is skipped and shown as "not used" in the preview — never posted**, because a zero-quantity movement is refused by the engine anyway (`src/functions/50-inventory.js:212`). It is not a card failure |

**Failure behaviour:** refuse the whole card, post nothing, and name the line and the reason — the same
style as the existing refusal at `src/functions/50-inventory.js:232`. The client checks too, but only for
speed; the server is the authority.

**Make mis-mapping visible before posting:** the preview lists the accounts the card will touch — "Debit
1240 Choco Chip Cookie, credit 1240 ingredients · 6 lines · ₱510.00" — and the printed card repeats them. A
wrong mapping is then obvious at a glance instead of discovered in Inventory Valuation a month later.

**Config health on the tab:** a sub-tab whose product or template fails validation carries a warning badge
and its New batch card button is disabled, in the same spirit as the Recipes cost-gap badge
(`admin.html:647`). A **Check mapping** action names exactly what to fix and where.

**Before the first card, run a one-off mapping audit** over `/inventory` listing every item whose inventory
or cost account is unmapped, and fix those items first. This is a whole-collection read, so it is a rare
manual tool marked `download-ok` with its reason — never a routine path.

## Confirm once, then guard against drift

**Check mapping** runs the full validation and, on success, records the confirmation: who confirmed it, when,
and a fingerprint of everything the card resolved — each item's id and name, its inventory account, its cost
account, and whether it is still active.

Posting does not repeat the interview. It compares the stored fingerprint with the current item records,
which it is already reading for their costs, so **the check adds no Firebase reads**. Two outcomes:

| Outcome | Behaviour |
|---|---|
| No drift | the card posts straight away — the mapping is fixed, as confirmed |
| Drift | the whole card is refused, the exact difference is named ("Butter now points at 1270, it was 1240"), and one click re-confirms |

So the confirmation is durable, and an item edited, re-mapped, deleted or archived months later cannot
quietly post into the wrong account. Confirming once does not mean unchecked forever; it means the check
costs you nothing until something actually changes.

## Adding and retiring things, without breaking history

| Action | How |
|---|---|
| New cookie variation | add a baking product with its pastry item and template — data only, no code, no deploy |
| Remove a sub-tab | archive the product (`active: false`) — the sub-tab disappears, its cards and stock item remain |
| Add or remove an ingredient line | edit the template freely; posted cards keep their own snapshot |
| An ingredient or pastry no longer used or sellable | archive the stock item once its remaining stock is cleared — sold, written off to 5900, or issued to staff under 6077 |

**Never hard-delete an item that has movements.** The per-item ledger and the 12xx GL balance must keep
tying, and Inventory Valuation groups by account, so a deleted item leaves value orphaned. Archiving is what
"delete" means here. An item with no movements at all can be removed outright.

Archiving a pastry item that still holds stock is normal — you still own those cookies. The value stays in
1240, the sub-tab hides, and the cards and printed pages remain readable.

Note: stock items have no `active` field today (`src/admin/pos/11d-stock-adjustments.js:11`), so archiving
is a small addition the build must make, honoured by the card's pickers, the sub-tab list and the Inventory
list.

## Renaming an item or an ingredient

Nothing breaks, because a card stores each item's **ID** as the authoritative link and its **name** only as a
readable snapshot. That is already the rule for financial links in this project: stable identifiers join,
display names are history.

| Thing | After a rename |
|---|---|
| Ingredient ledger, subledger, 1240 balance, reports | unchanged — they group by ID, never by name |
| New cards and their templates | show the new name automatically |
| Already-posted cards | keep the name as it was at the time, including reprints |
| Drift fingerprint | **ignores names** — a rename is not drift and forces no re-confirmation |
| An item's cost history | unchanged; the moving average follows the ID |

Three rules:

1. **Renaming is for the same thing under a new label.** A genuinely different product — another brand,
   another supplier, another formulation — is a **new item**, never a rename. Mixing them blends costs
   silently.
2. **Never rewrite a posted card's snapshot**, and never run a backfill that renames old cards. A printed
   card must still say what it said when it was printed.
3. **Log the rename** to `operationalAudit` with the before and after name, so an old card showing "Butter"
   is explicable after the item is called "Anchor Butter".

One guard: the picker shows name, unit and current cost, and the preview shows the resolved accounts, so two
items with similar names are visible before posting. Renaming an item to a name another active item already
uses raises a warning — the accounting stays correct either way, but the picker becomes ambiguous.

The sub-tab label and the pastry item's name are separate fields: the sub-tab defaults to the item's name
when created and can be renamed independently. A differing name is not a mapping error.

## Posting ahead of the purchase — negative ingredients

Baking happens before the purchase gets booked, because staffing is thin. The card must not stand in the way.

- **Never blocked by quantity.** The engine already permits a negative balance — only `purchase_reversal` and
  `purchase_quantity_correction` are refused it (`src/functions/50-inventory.js:261`). The card proceeds, and
  the preview shows the line going to, say, −2.4 kg without disabling the button.
- **Flagged, not silently accepted.** The card stores each line's balance before and after and marks the ones
  that went negative. The card list shows a badge, and the printed card shows it, so a bookkeeping delay is
  visible where the work happens.
- **The cost is provisional.** The consumed quantity is valued at the item's moving average at posting time.
  If the purchase is booked later at a different price, that batch keeps the cost it posted. The existing
  costing-correction path is the repair.
- **One refusal remains: a line whose ingredient has no cost at all (₱0) is refused.** A zero-cost line does
  not make the batch provisional, it makes it wrong — the cookies would carry no cost and every sale would
  overstate profit. Every ingredient has a real cost from its first purchase or from the opening pantry
  count, so this costs nothing in practice.
- **It heals itself.** The next receipt that recovers a negative balance sets the item's cost to the actual
  purchase price rather than blending a nonsensical average (`src/functions/50-inventory.js:264-269`), so the
  recipe's cost snaps back to reality.
- **Reconciliation is not broken.** The movement posts to the item ledger and to 1240 together, so stock value
  and Books move together and Inventory Valuation still balances. The account simply shows a negative, which
  is the honest picture of a bookkeeping delay.
- **Keep it visible.** A negative ingredient with no unposted purchase and no recent card is a real signal —
  either a purchase is missing or a bake was never carded. The Baking tab and the Inventory list should
  surface it, and financial close should treat a persistent negative as an exception.

## The sold-before-carded edge case

If some cookies are sold before the card is posted, the pastry item has no stock and those sales cost ₱0 —
the same situation the existing "Sales awaiting cost" list already handles. The engine's moving-average
recovery rule covers the stock side: a negative or zero balance takes the new batch cost instead of blending
it (`src/functions/50-inventory.js:264-269`). The already-posted sales, however, keep their ₱0 cost, so COGS
stays understated until the existing costing-correction path repairs them. **Therefore the rule is: card
first, sell second.** This is the main operational discipline the build depends on.

## Who may post, and why it stays safe

The shared inventory callable already supports delegated permissions: a role of
owner/superadmin/admin/manager passes, and any other account passes if it holds the permission key mapped to
the movement type (`src/functions/50-inventory.js:413-417`, mapping at `:14-19`). Today that means a cashier
holding the `inventory` key can already post adjustments and wastage.

**The trap, and how this build avoids it.** Giving cashiers batch cards by adding `production` to that shared
callable would also open whatever else that type maps to, and it would let a crafted client send its own
quantities and costs. Instead:

1. `production` and `production_reversal` are added to the **server-only set** (`src/functions/50-inventory.js:408`),
   so the shared callable refuses them from any browser.
2. A **separate `postBatchCard` callable** is the only door. It takes the product, the lines and the piece
   count, reads each ingredient's moving-average cost from the server, computes the values itself, and writes
   the movements.
3. Authorization inside that callable: manager roles, **or** `adminPerms/{uid}/baking === true`.
4. `baking` is added to `PORTAL_PERMISSION_KEYS` (`src/functions/20b-portal-accounts.js:5`) so the checkbox
   appears on portal accounts, exactly like `usage` and `inventory` do now.

**What a cashier with `baking` still cannot do:** post adjustments, wastage or staff usage through the shared
callable; change purchases, payables, prices or costing corrections; or touch Finance Books.

**Two silent failure modes to avoid.** `movementPermissions` ends with a default `return ["inventory"]`
(`src/functions/50-inventory.js:18`), so any new type that is not given an explicit mapping silently
inherits the `inventory` key. The `baking` checkbox would appear in Settings and appear to work, while the
real gate stayed `inventory`. Second, that callable accepts movement rows supplied by the browser (`:406`,
`:419`), including quantity and unit cost. For a production type that means a user could set a cookie's
unit cost, which then flows into COGS at sale. Both failures are silent — nothing errors, the boundary is
simply wrong. Server-only types plus a separate callable remove both.

**The `baking` key must be added in three coordinated places:** server `PORTAL_PERMISSION_KEYS`
(`src/functions/20b-portal-accounts.js:5`), the client staff-access key list
(`assets/js/admin/staff-access.js`, referenced at `assets/js/admin/core.mjs:1035`), and the `batchCards`
rule clause. Existing tests already enforce that the server and client key lists match
(`tests/staff-module-access-check.mjs`) and that each screen's rule names its permission key
(`tests/staff-screen-data-access-check.mjs`), so an omission fails the suite instead of shipping quietly.

**No approval step** — that is the decision, and it is defensible here because a batch card cannot create
profit, cash or COGS. Both legs are 1240, so the worst a bad card can do is misstate *which item* holds
value, and the card records who posted it, what they used, how many pieces came out and when. Every post and
every reversal also writes `operationalAudit`.

## What the engine lacks today

| Gap | Evidence |
|---|---|
| One stock item cannot be credited while another is debited. Offsets are limited to 3000 / 5900 / 5905. | `src/functions/50-inventory.js:137-170` |
| Manual journals to any inventory control account are blocked. | `src/functions/40-sales-finance.js:99-106` |
| The movement type list and posting switch need the new production type. | `src/functions/50-inventory.js:1-5`, `:178`, `:200` |
| The server-only set must include the production types. | `src/functions/50-inventory.js:408` |
| A `baking` permission key must be added to the portal permission list. | `src/functions/20b-portal-accounts.js:5` |
| New nodes `bakingProducts` and `batchCards` need rules, indexes and backup registration. | `database.rules.json:210` (pattern), `functions/lib/backup-delta.js:43`, `src/admin/register/70-settings-staff.js:81`, `assets/js/admin/register.js:893` |
| The tab, container, module, manifest entry and bounded listener paths must be added. | `admin.html:644-650`, `release-manifest.json:217`, `assets/js/admin/realtime-hub.mjs:11` |
| The offset test asserts the current rules and needs updating. | `tests/inventory-adjustment-offset-check.cjs` |

## Safeguards required before this is complete

1. Both legs post atomically in one multi-path write. A half-posted card must be impossible.
2. All quantities, costs and totals are derived server-side. The client supplies product, lines and pieces only.
3. The card snapshots its lines, so template, item-name or cost changes never rewrite a posted card.
4. Reversal inverts the stored amounts exactly and is idempotent.
5. The batch ID is the idempotency key, using the existing `inventoryAccounting` applied set and
   `commitFinancial('invmove_<id>')`.
6. Ingredient quantity and piece count are both written, so the item subledger and the 1240 GL total stay tied.
7. A "baked but not carded" check, so a remembered bake that was never carded surfaces instead of silently
   leaving ingredients overstated.
8. A cashier's `baking` permission must not grant any other movement type.
9. Mapping validation **refuses; it never warns**. A card that would post to a surprising account, or that
   names a deleted, unmapped or supply item, posts nothing and says why.
10. The pastry item's accounts are pinned to 1240 / 5030, and no two baking products may share one pastry
    item.
11. Config validation runs on save as well as on post, so a broken template is caught when it is written,
    not when a baker is standing over a tray.
12. A confirmed mapping is stored and compared on every post. Drift refuses the card instead of posting into
    a changed account, and re-confirming is one click.
13. Nothing with history is hard-deleted. Products and items are archived, so the item ledger and the 1240
    GL balance keep tying and every posted card stays readable.
14. Cards join to items by ID. A rename is logged, never rewrites a posted card, and never registers as
    drift, so tightening a name can never block a bake or disturb history.
15. A card is never blocked by ingredient quantity. It is blocked only by a zero-cost line, a missing or
    wrong mapping, or an archived item.
16. Every line's balance before and after is recorded, so a negative ingredient is visible on the card, in
    the list and on the printed page instead of passing silently.

## Tests to add

- Round trip: card → sale, proving the 1240 total and profit are unchanged by the card, and profit moves only
  at the sale.
- Yield variance: 15, 17 and 19 pieces from the same ingredient list give ₱34.00, ₱30.00 and ₱26.84.
- Editable template: add a line, remove a line, change a quantity; template edits leave posted cards untouched.
- Data-driven sub-tabs: a new `bakingProducts` entry produces a new sub-tab with no code change.
- Permissions: a cashier with `baking` can post and reverse a card, and is refused every other movement type.
- Server-only: `production` submitted to the shared inventory callable is refused.
- Idempotency: the same card posted twice changes nothing.
- Reversal: voiding a card restores both ingredient and cookie quantities exactly.
- Sold-before-carded: the negative balance takes the batch cost, and the repair path remains available.
- Print: the card document contains every line, the total, the pieces and the cost per piece.
- Mapping refusals, each posting nothing: pastry item mapped to 1200; ingredient with no cost account; a
  deleted item; a supply item used as an ingredient; the pastry item listed as its own ingredient; a
  duplicate line for one item; two products sharing one pastry item.
- Mapping drift: a template that validated when saved is edited to break the mapping, and posting is still
  refused.
- Preview honesty: the accounts shown in the preview are the accounts the card actually posts to.
- Confirm once: after confirmation, posting is a single action with no re-prompt.
- Drift: re-map an ingredient's inventory account after confirmation; the next card is refused, names the
  difference, and posts after one-click re-confirmation.
- Archive a product: its sub-tab disappears while its cards and printed output remain.
- Archive a pastry item: new cards refuse, existing cards and the 1240 balance are untouched.
- Delete versus archive: an item with movements cannot be removed; an item with no movements can.
- Rename: after confirming the mapping, rename an ingredient; the next card posts without re-confirmation,
  shows the new name, and an older card still prints its original name. The 1240 balance and report totals
  are unchanged, and the rename appears in `operationalAudit`.
- Rename collision: an item renamed to a name another active item already uses warns, and the picker still
  resolves the two apart by ID.
- Negative post: bake with insufficient ingredient stock; the card posts, the line is flagged on screen and
  on the print, the batch cost uses the moving average, and 1240 goes negative on both the ledger and Books
  while Inventory Valuation still balances.
- Zero cost refused: an ingredient with no cost refuses the whole card and names the line.
- Recovery: after a negative, the next purchase sets the item's cost to the purchase price and the following
  batch uses it.
- Zero quantity is not a failure: a template line left at zero is skipped, the card posts, and no movement
  exists for that item.

## Firebase cost

One callable per card; one bounded single-item read per ingredient line plus the pastry item and the product
config; one multi-path write. The Baking tab subscribes only to `bakingProducts` (small config) and a bounded
window of `batchCards`. No new triggers, listeners or schedules. Purchases reads are unchanged.

## Still undecided

1. Whether reversal should need a different permission from posting, given anyone may post.
2. Whether "baked but not carded" is a financial-close exception or just a badge on the card list.
3. Whether the printed card needs a physical signature line, or the printed page is enough.
4. Whether sub-tab order is a `sortOrder` number or drag-and-drop.

## Explicitly out of scope

- The work-in-process account (1245) and dough stock items — dropped with the "after baking" decision.
- Adding a production reason or inventory offsets to the general Stock Adjustment screen.
- Any change to Purchases posting, recipe costing, or the till.
