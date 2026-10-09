# Firebase Download Audit — 17 September 2026 (Full Surface, No Code Changes)

**Trigger:** Realtime Database downloads spiking toward the Spark-plan allowance
(10 GB/month ≈ **360 MB/day**). Goal: stay under 360 MB/day.

**Scope (as requested — every function, every link, customer site → POS/Admin → Finance
Books → server):** all 135 browser files scanned by hand and by the repo's own guard
suite, every Cloud Function read path, the rules file, the service worker, the CI
pipelines, the static marketing pages, and the live production build. Several production
nodes were measured directly over the public REST API. **Nothing was built or changed;
this document is the only deliverable.**

---

## 0. Verdict in one paragraph

The September 16 audit's fixes **are live** (production serves admin **544**, Books
**123**, service-worker cache **v522**; this checkout is 542/123/v520, one emergency
sign-out release behind). The codebase no longer contains an unbounded whole-node
leak of the kind fixed on 16 Sep. What remains is *structural* consumption — features
that legitimately download a lot by design, multiplied by sessions — plus three
operational amplifiers: **stale clients running pre-fix builds**, **reconnect churn on
POS terminals**, and the **Sales History per-order listener fan-out**, which is the
single largest per-click RTDB consumer left in the product. Below 360 MB/day is
achievable without new development only if sessions/terminals are managed; the durable
fix is the ranked recommendation list in §7.

---

## 1. What the 360 MB actually counts

From the Firebase pricing model, all of the following land on the **same** Downloads
meter (console → **Realtime Database → Usage**):

1. Payload bytes of every read/listen result — **browser and server (Admin SDK) alike**.
2. **TLS handshake + connection setup** (~3.5 KB) per connection — reconnects pay again.
3. **Reads denied by security rules** — PERMISSION_DENIED responses are billed.
4. **Reads performed by the Firebase console data viewer itself** when a human browses data.
5. SSL session resumption / re-listen after a dropped connection re-sends listener state.

**Not** on this meter: Firestore replica reads (separate 50 K reads/day Spark quota),
Cloud Storage/proof images (own quota), Cloud Functions responses (Functions egress),
static hosting (GitHub Pages — unlimited for this purpose), FCM. Two of those "not this
meter" items have their **own** quota hazards; see §6.3 so they are not mistaken for the
RTDB bar.

---

## 2. Customer-facing site (index.html — the only page with Firebase)

`menu.html`, `about.html`, `contact.html`, `reservations.html` contain **no Firebase
code at all** (verified). Everything below runs per visitor of `index.html`.

### 2.1 Measured production payloads (fetched live, 17 Sep 2026)

| Listener/read per visitor | Attach mode | Measured size |
|---|---|---|
| `publicCatalogVersion` | live, whole record | ~100 B |
| `menuItems` (on version change only, else localStorage cache) | one-shot get | **~19–20 KB** (55 items) |
| `categories` (same versioning) | one-shot get | ~0.8 KB |
| `optionGroups` (same versioning) | one-shot get | ~1.9 KB |
| `availability` | **live, whole node, all session** | ~0.7 KB |
| `payment` | live, whole node | ~0.5 KB |
| `publicOrderStatus` | live, single record | ~50 B |
| `.info/connected` | local | free |
| `signInAnonymously` + `customerOrders/<uid>` (limit 20) | live index | tiny for new users |
| `orders/<id>` × up to 20 (only the customer's own recent orders) | live per record | ~0 after archival; ~2 KB each only for *today's* orders |
| `reservations/<id>` × up to 12 (own only) | live per record | small |
| `calBlocks` (only when the Reserve section scrolls near view) | live, key-bounded to one month | ~0–5 KB |
| `reviews` (only when #reviews scrolls near view) | one-shot, `limitToLast(20)` | ≤ ~12 KB (whole node today ≈ 2.3 KB) |
| `packages` (`assets/js/customer/packages.js`) | **live, whole node, all session** | **null today (0 B)** — see finding C-4 |

**Estimated per first-time visitor: ≈ 25–35 KB** (returning visitors ≈ 5 KB when the
menu version is unchanged + ~3.5 KB connection setup). Even 1,000 visitors/day ≈
**~30 MB/day worst case — not the spike source.** Customer-side reads are anonymous-auth
gated (App Check on), bounded, and defer-loaded by IntersectionObserver. Deferred reads
reservations/calendar/reviews only fire when the section approaches the viewport.

Verdict: **clean.** Two small latent items: C-4/C-5 below.

---

## 3. POS / Admin portal (admin.html)

### 3.1 Boot architecture (verified against `realtime-hub.mjs`, `portal-boot.js`, `portal-auth.mjs`)

- Listeners attach **only after sign-in** (`authorize()`), so unauthenticated sessions
  pay no PERMISSION_DENIED churn. Portal boot polls an in-memory gate (no reads).
- One hub, one listener per path, 5-minute linger on tab switch, per-child attach for
  growing nodes, 30-day window on staff messages, own-uid receipt index. Emergency
  sign-out (`sessionControl`, production-only build 544) adds one single-record critical
  listener — negligible.
- Critical per session: `activeOrders`, `posActiveShift`, `staffMessages` (30-day
  windowed), `staffReceiptIndex/<uid>`, `sessionControl`, `.info/connected`.

### 3.2 Per-session RTDB attach, by where the user lands

| Surface | What attaches (initial download) | Estimated initial cost |
|---|---|---|
| Sign-in → Dashboard (default) | critical set + orders (MTD, live node = today's unarchived only) + archivedOrders **from Firestore, not RTDB** + reservations (open only) + reviews + availability + cfAccounts + categories/menuItems (cache: ~22 KB only on version bump) | **~50–300 KB** (dominated by staff inbox window + activeOrders) |
| POS tab (every till, `routes: pos:['inbox','pos']`) | critical set + posStaff, posSettings, heldOrders, optionGroups, packages, channelPrices, availability, cfAccounts | ~100–400 KB on first load, then deltas |
| **Sales History tab** | MTD live orders + MTD archive pages (Firestore) + **financialMovements MTD range query (RTDB) + one live `orderByChild('sourceId')` listener PER ORDER in the period (RTDB)** | **see F-1 — the big one** |
| Analytics / P&L / Stock Value | above + **doubled period range** (analytics adds the previous period), recipes, appCustomers, reviews, feedbacks, monthlyExpenses, expenseItems, inventory (whole, per-child), journals MTD, monthlyNet, bounded 200–250-row history pages (inventoryAdjustments, internalUsage, stockReceipts, platformPayouts, inventoryMovements) | ~0.5–2 MB per visit |
| Ops / Register settings | shifts (last 100), activityLog (last 200), discrepancies (last 200), heldOrders | ~50–150 KB per visit |
| Live Operations | posDeviceHealth/<openShift> + ownerDailySummaries/<today> + activeOrders; 30 s UI timer does **not** read | ~1–10 KB |
| Purchases | purchaseInvoices (last 250), stockReceipts (last 250), suppliers, inventorySku, booksChart, pettyCashVouchers (whole, per-child) | ~100 KB–1 MB depending on voucher history |
| Petty cash | pettyCashVouchers + replenishments + settings; receipt images are per-click single reads from `/pettyCashReceipts/<id>/image` | tens of KB + ~1.3 MB only when a receipt is opened |
| System Health (Operations) | ≤30 day-records of clientTelemetryDaily + 4 single records + cached exception snapshot server-side | ~30–100 KB |
| All other tabs | config-scale nodes gated by hub scopes | KB-scale |

**All-day delta tax (the background drain):** every sale mutates `activeOrders`
(per-child add ~1.5–3 KB), posts 3–6 status transitions (~1.5–3 KB each), transacts
`posActiveShift` (~1–2 KB), and appends to the MTD orders listener. Delivered to
**every connected portal client**. At 150 orders/day and 3 connected clients ≈
**4–7 MB/day**. Necessary by design (live floor), but it scales with *terminals ×
orders*, which is why §7 R-8 (reduce idle sessions) matters.

### 3.3 The largest remaining client consumer: Sales History (`sales-history.js` + hub)

`hub.attach()` for `financialMovements` in the `saleshistory` scope does this:
an MTD `occurredAt` range listener **plus** an individual live indexed
`sourceId == <orderId>` listener **for every order in the period**, and the page's
`load()` automatically loops `loadOlder` until the period is verified complete.
On 17 Sep a month-to-date period realistically holds **1,500–3,500 orders**, so one
visit opens **thousands of simultaneous live queries** and downloads the period's
movements twice (once by `occurredAt`, once by `sourceId`).

- Estimated **3–15 MB per Sales History visit**, and again on **every period change /
Apply** (the hub resets and re-attaches everything).
- Verify in console: watch the Downloads graph within minutes of opening Sales History.
- This is F-1 — the top code-level recommendation (§7 R-1).

---

## 4. Finance Books (books.html + assets/js/books)

### 4.1 Always-on after sign-in (any tab)

- `books/journal` — **month-to-date, per-child** (`orderByChild('date')`, startOf(Manila
  month) → today). Growth: one journal entry per movement implies **1,500–5,000 entries
  by mid-month** (≈ 0.4–0.6 KB each) → **0.7–3 MB per Books sign-in**, growing all month.
- `books/monthlyNet` (compact totals), `accountingPeriods`, `receivables` (~12 KB,
  per-child), `payables` (~12 KB, per-child), `cfAccounts`, `booksChart` (~90-account
  config), `books/config/cashAccountMap`, plus `sessionControl/cutoff` (production 544).
- Outstanding-orders trio: `/orders` by `settlementStatus == unsettled` and `== null`
  (live node only) and `/archivedOrders == unsettled` — **all indexed**, live for the
  whole session but only matching rows.

### 4.2 Per-tab optional feeds (all bounded or config)

Cash Flow: period-bounded `financialMovements`, `cashFlowDaily/Monthly/Openings` (small
server-maintained indexes), undeposited-only `platformPayouts` (indexed null/"" + reversed),
open-only `cashCustody` (indexed). Purchases: period-bounded invoices + per-id keyed
fetches for bills. Payables/Transactions/Journal: `suppliers` (~70), `discrepancies`
(non-reviewed only, indexed), `personalFundings`, `fixedAssets`. Insights: reads from
**Firestore** replica on demand (not RTDB) + `menuItems`/`categories` (config).

### 4.3 Verified removed/absent

- `/suspenseAdvanceConversions` whole-node listener — **gone** (the fix is in
  production); conversion state now rides on the journal entry already downloaded.
- No browser read of `pettyCashReceipts` except per-voucher click.
- Books sign-in triggers `manageSupplier(initialize_legacy)` — server-side, gated to
  one sweep/day (§5.2).

**Books per sign-in ≈ 1–4 MB**, so 3–5 daily sign-ins ≈ **5–15 MB/day** — F-2.

---

## 5. Server side (Cloud Functions — billed downloads too)

### 5.1 Schedules (all verified bounded)

| Job | Cadence | Reads | Verdict |
|---|---|---|---|
| `backupDatabaseDaily` | 03:00 | incremental: dirty-marked records only + all **untracked** nodes in full + one rotating ~2 MB slice; full root (~13 MB on 15 Sep) only when the previous file is missing/invalid/>8 days | **OK, but see F-4** |
| `pruneEphemeralNodes` | 03:30 | only the small nodes it prunes (locks, rate limits, command claims, telemetry days, monitor history) | OK |
| `autoCompleteReadyOnlineOrders` | 15 min | indexed status query, limitToLast(250) | OK |
| `evaluateProductionHealth` | hourly | 5 single records + server-cached exception scan | OK |

### 5.2 On-demand callables

- Per-*sale* work (`createOnlineOrder`, `syncOfflinePosSale`, inventory posting): keyed
  catalog reads (`readCatalogKeyed`), single-record transactions, bounded settings
  subsets. **Per-call reads ≈ a few KB.** Clean.
- `manageSupplier initialize_legacy`: 10 indexed `supplierId == null/""` queries across 5
  nodes, gated to **once per 24 h** (`supplierMigrations/legacySweepCheckedAt`). Clean.
- `getUndepositedPage`: indexed pages of 25; single-voucher receipt fetch only when
  `kind:'voucher'` with an explicit id (≈1 record, capped 1.5 M chars). Clean.
- `reportPosDeviceHealth` (every 60 s active / 5 min idle per till): reads caller role +
  open shift (2 small records) per call → ~1–2 MB/day per busy till, **billed**. Minor
  but real: F-5.
- `readHistoricalOrders`: serves archive pages from **Firestore** (100/page, max 200
  pages) — zero RTDB, but see §6.3.
- `runDatabaseBackupNow` button: same incremental path; a full root read only if the
  last verified backup is unusable.

### 5.3 Nightly backup's untracked growth (F-4)

`TRACKED_PATHS` (dirty-marker incremental) = archivedOrders, inventoryMovements,
orderInventoryPlans, financialMovements, cashBalanceSummaryApplied, books/journal,
shifts, operationalAudit, financialCommandClaims, inventoryAccounting,
financialApprovals, activityLog, cfLedger, pettyCashReceipts. Everything **else** is now
read in full every night, including five nodes that grow forever:
**stockReceipts, purchaseInvoices, platformPayouts, internalUsage,
inventoryAdjustments** (plus archivedReservations, discrepancies, receivables,
payables, suppliers). Estimate **~1–3 MB/night today, rising linearly**, + ~2 MB
rotation slice + dirty deltas → **~3–6 MB/day** (1–2 % of budget). Watch
`systemHealth/backups/latest`: if `mode` shows `full` repeatedly, an invalid-previous-
file loop would cost ~13 MB/night (~30 % of budget by itself).

---

## 6. Findings register

### A — Active RTDB consumers, ranked by likely weight

**F-1 · Sales History per-order listener fan-out (highest).**
`sales-history.js` + `realtime-hub.attach()` (`financialMovements` in `saleshistory`
scope): MTD range listener + one live `sourceId` listener **per order**, auto-completed
by `load()`'s loadOlder loop; fully re-attached on every period Apply. Est. **3–15 MB
per visit** this month, scaling with order volume. Everything else in the tab is fine
(archive pages come from Firestore).

**F-2 · Finance Books sign-ins.** Journal MTD (per-child but voluminous) + ledger
masters + outstanding-unsettled live queries ≈ **1–4 MB per sign-in**, growing through
the month.

**F-3 · All-day fan-out to connected portals (by design).** ~10 KB of deltas per order
**per connected client** (activeOrders + status transitions + posActiveShift + orders
feed) — ~4–7 MB/day at 150 orders × 3 sessions, and it scales with terminals kept
signed in. Not a bug; a multiplier.

**F-4 · Nightly backup untracked full reads.** ~3–6 MB/day and rising (§5.3).

**F-5 · `reportPosDeviceHealth` read cost.** ~1–2 MB/day per always-active till (two
small reads per minute). The write cadence itself is required for shift close.

**F-6 · Analytics/P&L/Stock-value visits.** Doubled periods + config/equity nodes ≈
0.5–2 MB per visit.

### B — Operational amplifiers (check these first when the bar jumps)

**F-7 · Stale clients.** Any tab/point-of-sale still running admin **< 538** or Books
**< 121** keeps the *pre-fix* behavior: whole-node `staffMessages`,
`staffMessageReceipts`, `/suspenseAdvanceConversions` listeners — measured at ~800 KB
**per attach** in the repo's own fixture, re-downloading **the entire node on every
write**. A handful of stale sessions can burn tens of MB/day, worsening daily.
**Self-diagnostic (no console needed):** console → Realtime Database → Data →
`clientTelemetryDaily/<today>` lists `build` labels; any `admin-v` below 538 or
`books-v` below 121 is a leaking session. The 15-minute build-freshness guard
auto-reloads idle-safe tabs, but a till mid-sale can stay stale for hours.

**F-8 · Reconnect churn.** Every dropped connection re-pays TLS (~3.5 KB) **and**
re-syncs the session's live listeners (the hub re-downloads whatever changed while
detached; stale-but-live queries re-pull state). A tablet on flaky Wi-Fi reconnecting
hourly re-pulls ~50–400 KB each time — **1–10 MB/day per flaky terminal**, invisible in
code, visible as a high **Connections** count on the Usage tab.

**F-9 · Mass re-attach surges.** The new owner **emergency sign-out** (production 544)
forces every device to sign in again → every session re-downloads its full attach set
within the same hour. A one-off ~5–30 MB spike on the day it's used. If a spike date
matches a sign-out event, this is why.

**F-10 · Console & denied reads.** Browsing large nodes in the Firebase console data
viewer bills the project; PERMISSION_DENIED responses bill too. Small, but non-zero.

### C — Latent traps (cheap today, worth sealing)

**C-1 · `reviews`** is in the **default dashboard scope**: a growing-forever node
attached at every admin sign-in (per-child, so writes are cheap). ~2.3 KB today with 4
reviews — fine now, unbounded by construction.
**C-2 · `feedbacks`, `appCustomers`, `pettyCashVouchers`** — same shape, tab-gated.
**C-3 · `payables`/`receivables`** stay whole-node per Books/admin sign-ins (deliberate,
documented; ~12 KB each today — recommend open-rows queries later).
**C-4 · Customer `packages.js`** attaches a whole-node live listener on **every
visitor** (`packages` is `null` today — 0 bytes). If promos are ever added, every
visitor pays it, and every edit broadcasts to all visitors. Bound it (e.g., version
cache like the catalog) before use.
**C-5 · Customer seed fallbacks**: `applyCategoriesSnapshot`/`applyMenuSnapshot`
attempt a seed **write** from the anonymous client when the node reads empty (denied by
rules → billed denied ops × every visitor while the node is empty). Only fires if the
catalog is ever wiped — note it, don't build it.
**C-6 · `sessionControl`** (prod-only): any future field added under it is critical-
scoped to every session by default. Keep it single-record.

### D — Verified clean (no action)

Menu/catalog versioned caches (customer + admin), version bump fan-out (~25 KB per menu
save × connected clients, rare); customer defer-loaded sections; books optional feeds;
undeposited pages; supplier sweep; ensureBooksChart journal migration (one-time, gated);
health scan (server-cached, hourly); prune & auto-complete jobs; CI workflows (no DB
reads — `build-runtime-bundles.mjs`/`sync-costing.mjs` copy local files only); static
marketing pages; proof images (Cloud Storage; browser access denied); FCM; emergency
sign-out listener; `.info/connected`. The repo's guard suite (which yesterday's fixes
extended to **all 135 browser files**) passes locally: 292 tests green, including every
`*download*` guard.

---

##  6.3 Two quotas that are NOT the 360 MB bar (don't misread the bill)

1. **Firestore Spark quota (50 K reads/day):** the Overview **12-month rolling chart**
   (`overview-insights.js → hub.watchRollingSales → readHistoricalOrders`) pages a full
   year of archived orders through the callable on every dashboard paint
   (~order-volume × 365 pages/100). At ~150 orders/day ≈ **50 K+ document reads for one
   chart**. This does not touch the RTDB meter, but it can exhaust the Firestore daily
   quota (chart then errors), and Functions egress. Same mechanism, smaller scale, for
   every MTD archive page load on Dashboard/Sales History/Analytics.
2. **Cloud Functions invocations/egress:** report callables per minute per till + page
   loads — Spark has daily invocation limits; watch Functions → Health, not RTDB Usage.

---

## 7. Recommendations, ordered by expected MB/day saved

| # | Action | Expected effect | Effort |
|---|---|---|---|
| R-1 | **Sales History: replace the per-order `sourceId` listener fan-out with a single period query + client-side group-by**, and serve the movements from one keyed fetch pass (list of ids → batched `get` per id, max ~32/request like `readHistoricalOrders` mode `ids`). Also stop re-attaching on every Apply within the same period. | −3–15 MB per Sales History visit (the largest remaining code-level win) | Medium |
| R-2 | **Purge stale clients**: open `clientTelemetryDaily/<today>`, hard-refresh (`Ctrl+Shift+R`) or re-install any device reporting `admin-v < 538` / `books-v < 121`; verify the next day's telemetry shows only 544/123. Zero cost, immediate. | Removes any remaining pre-fix whole-node listeners (up to tens of MB/day if a stale till exists) | Minutes |
| R-3 | **Cashier discipline / connection hygiene**: sign out or close the portal on idle tills instead of leaving 3–5 terminals live all day; prefer wired/strong Wi-Fi for the main till. Watch **Connections** — if ≫ daily sessions, F-8 is costing more than any code item. | −1–10 MB/day | Process |
| R-4 | **Backup**: add `stockReceipts`, `purchaseInvoices`, `platformPayouts`, `internalUsage`, `inventoryAdjustments` to `TRACKED_PATHS` with dirty-marker triggers (same pattern as the other 14). | −1–3 MB/day, grows over time | Small, pattern exists |
| R-5 | **Books**: cache the journal month in `localStorage` keyed by month+journal-version so repeat sign-ins re-download only the delta (the versioned-master pattern already used for the catalog). | −1–3 MB per repeat sign-in | Medium |
| R-6 | **POS health reporting**: drop `reportPosDeviceHealth` to a read-free transaction/write (write-only path) or accept 2 reads per call but batch to 120 s — the 60 s cadence is only needed inside the 120 s freshness window *while a shift close is imminent*. | −1–2 MB/day per till | Small |
| R-7 | **Bound C-1/C-2**: move `reviews` out of the default dashboard scope (attach on the Reviews tab only) and window `feedbacks`/`appCustomers` to recent N like staffMessages. | Future-proofing; ~0 today | Small |
| R-8 | **Cap concurrent portal clients habitually** (the delta tax in F-3 scales per client): one admin screen + tills, not multiple dashboards on personal phones. | −30–50 % of F-3 | Process |
| R-9 | **Seal C-4/C-5** when promos are introduced (version-cache `packages`; remove anonymous seed writes). | Prevents a future whole-node listener on every visitor | Small |
| R-10 | **12-month chart** (Firestore quota, not RTDB): serve from a server-maintained `ownerDailySummaries`/`monthlyNet` rollup instead of paging a year of orders per paint. | Saves the *Firestore* day quota & Functions egress; also makes Overview instant | Medium |

**Do not bother:** touching the customer site (≈30 KB/visitor), the prune/health jobs,
the emergency sign-out listener, or storage/proofs — already minimal.

### Expectation setting

With F-7 cleared and F-8/R-3 applied, a healthy day should land roughly:
backup ~3–6 + POS/admin attach+deltas ~6–12 + Books ~5–15 + customer ~1–5 +
Sales History *when used* ~3–15 ≈ **20–50 MB/day** — comfortably under 360 MB, with
headroom for order growth. The residual risk is behavioral (stale tabs, many live
terminals, flaky networks), which is why R-3/R-8 and the telemetry sweep matter as much
as the code items.

---

## 8. Exactly where to look in Google/Firebase console (the "metrics" step)

I could not open the project console from this environment (no network/credentials),
so verify these with the audit's predictions in hand:

1. **Realtime Database → Usage → Downloads** (daily bars). Prediction: bars step up on
   days Sales History is used heavily; a flat high baseline traces to F-3/F-7.
2. **Realtime Database → Usage → Connections**. Prediction from F-8: if connections/day
   ≫ staff sign-ins, a terminal is flapping and re-paying TLS+re-sync constantly.
3. **Realtime Database → Data → `clientTelemetryDaily/<today>`** → the `build` labels:
   the stale-client census for R-2. Also `systemHealth/backups/latest`: `mode` should be
   `incremental`; repeated `full` means F-4 costs ~13 MB/night and the validation loop
   needs fixing.
4. **Cloud Functions → Dashboard/Health**: invocations of `readHistoricalOrders`
   (correlates with §6.3-1), `reportPosDeviceHealth` (F-5), and error spikes (denied
   reads are billed — App Check should already be enforced per
   `APP_CHECK_ENFORCEMENT_RUNBOOK.md`).
5. **Firestore → Usage**: daily document reads. If near 50 K on days the Overview
   dashboard is opened, §6.3-1 is confirmed (that's *separate* from the 360 MB bar).
6. **Storage → Usage**: should be ~flat (proofs only, browser-blocked).
7. Optional: Cloud console → Billing export / RTDB egress graphs for byte-level
   confirmation of the Usage tab.

---

## Appendix A — What was inspected, end to end

- **Customer:** `src/customer/core/00–16` (+ built `assets/js/customer/*`), `index.html`
  script graph, defer strategy, anonymous auth flow, order/reservation listeners,
  chatbot/push modules; `menu/about/contact/reservations.html` (no Firebase).
- **POS/Admin:** `realtime-hub.mjs` (all attach policies: INCREMENTAL/BOOTSTRAPPED/
  GROWING /WINDOWED/CURRENT_MONTH/OPEN_ROW/VERSIONED), `core.mjs`, `module-loader.js`
  routes, `portal-boot.js`, `portal-auth.mjs` (+ production 544 emergency sign-out),
  `staff-inbox.js`, `pos-sync-health.js`, `telemetry.js`, `live-operations.js`,
  `operations-dashboard.js`, `overview-command/insights.mjs`, `sales-history.js`,
  `sales-period-data.mjs`, `historical-period-store.mjs`, all tab modules
  (`pos.js`, `register.js`, `analytics.js`, `finance.js`, `channel-pricing.js`,
  `packages.js`, `staff-access.js`, `undeposited.js`, `accounting-periods.js`,
  `reservations.mjs`, `customer-registry.mjs`, `app-customer-session.mjs`, and every
  `src/admin/**` section file).
- **Finance Books:** `live-pos.mjs` (every feed incl. OPTIONAL_FEEDS), `app.js`,
  `suspense-advance.mjs`, `accounting-periods.mjs`, `src/books/**` (BI, CSV exports,
  opening payables — computed only).
- **Server:** every `src/functions/**` and `functions/lib/**` read path — order/sale
  pipelines, books bridge, close controls, maintenance/schedules, backup (incl.
  `backup-delta.js` tracked paths), supplier master, cash balances, exceptions cache,
  undeposited pages, historical reader, receipt mover; `database.rules.json` — every
  client query field cross-checked against `.indexOn` (full map in §A1 of the raw
  notes; all present).
- **Infra:** `sw.js` (network-first runtime cache; Firebase/CDN passthrough),
  `pwa-register.js`, `build-freshness.js` (15-min stale-tab guard), `manifest*.json`,
  `.github/workflows/*` (deploy/quality only — no production DB reads), `tools/*`
  (build-local), CI deploy pipeline.
- **Production:** live `build-version.json`, `sw.js`, and public RTDB nodes measured
  over the REST API (table in §2.1); live admin build is 544 (one emergency-sign-out
  release, PR #515, ahead of this checkout — its new `sessionControl` critical
  listener reviewed: single record, negligible).
- **Repo guards:** `client-download-guard-check` (135 files), `download-read-guard`,
  `download-bounded-reads`, `download-loophole`, `firebase-bandwidth-guard`,
  `books-download-scope`, `books-sync-download`, `dashboard-download`,
  `books-live-feeds`, `customer-public-read-scope`, `customer-startup`,
  `live-operations-readonly`, `active-orders`, `archived-order-ghost`,
  `download-attach-cost` (83.4 % session-attach reduction vs pre-16-Sep shape) — all
  PASS; full `npm test` green (292).

## Appendix B — Session attach meter (repo fixture, unchanged here for reference)

```
Staff Inbox messages             340837 ->   40611   (30-day window)
Staff receipts (shared node)     349961 ->   63441   (own index)
Suspense conversions             106381 ->       0   (gone)
Device health (one shift)           469 ->     469
Finance ledger feed (latest 200)  84182 ->   42091   (single listen)
TOTAL                            881830 ->  146612   (-83.4 %)
```

These pre-fix savings are already in production. The remaining daily bar is driven by
F-1…F-6 plus the F-7/F-8/F-9 amplifiers — measure those against the console playbook in
§8 before authorizing any new code.
