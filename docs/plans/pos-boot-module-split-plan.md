# POS boot module split — stage 3 plan

Status: plan only. Nothing in this document is implemented.
Owner: Danilo. Prepared 2 Nov 2026 after Admin 736.

## Why

`pos_boot` is now DOMContentLoaded (Admin 735), so it measures when the page has parsed and run its
own scripts. Measured with `tools/pos-load-profile.mjs` on a 1.6 Mbps profile before that change:

| Measure | Value |
|---|---|
| load event (old pos_boot) | 8777 ms |
| DOMContentLoaded (new pos_boot) | 6031 ms |
| resources | 76 |
| total decoded | 1549 KB |
| application JavaScript | 51 files, 528 KB |

Two thirds of the weight is not ours to shrink (839 KB is Google reCAPTCHA Enterprise, pulled by App
Check before boot can finish). The 528 KB of application JavaScript is ours, and about 107 KB of it is
four screen modules that every Admin/POS boot fetches whether or not the screen is used.

## Already shipped, do not redo

- **Admin 735** — `pos_boot` reports `domContentLoadedEventEnd`; `history-pager.mjs` no longer fetches a
  second copy of `realtime-hub.mjs` (34 KB); preconnect hints for gstatic, Identity Toolkit and fonts.
- **Admin 736** — Firebase Messaging SDK imported on demand instead of at module load.

## The core finding

The four candidate modules are **pure factories with no module-level side effects** (verified: no
`window.` or `subscribe(` at module scope in any of them). What keeps them on the boot path is that
`assets/js/admin/core.mjs` both imports them statically *and* instantiates them at module load:

| Module | Bytes | Lines | Instantiated | Consumed |
|---|---|---|---|---|
| `order-archive-panel.mjs` | 5,278 | 24 | core.mjs:994 | `renderArchive()` core.mjs:995, only when the archive panel opens (core.mjs:993) |
| `catalog-admin.mjs` | 41,684 | 495 | core.mjs:199 | `buildAvail`, `renderCategoryManager`, `renderOptionManager`, `renderNewItemOptionChecklist`, `renderStaffMenu` — called from tab renders core.mjs:252, 280, 357, 358 |
| `reservations.mjs` | 26,945 | 77 | core.mjs:197 | render functions on tab open; **factory subscribes to `reservations` and `calBlocks` at creation** (reservations.mjs:71-72) and calls `onReservationsChanged:updateStats` |
| `overview-insights.mjs` | 40,664 | 191 | core.mjs:190 | `renderDashboard()` core.mjs:899 — the landing Home screen. **Not deferrable.** |

So converting the `import` statement alone buys nothing: the module still has to run to build the
instance. The safe pattern is to defer **instantiation** and load the module with a dynamic
`import()` at that moment, keeping every call site synchronous.

### Pattern

```js
let catalogAdmin = null;
function withCatalog(fn) {
  if (catalogAdmin) { fn(catalogAdmin); return; }
  import('./catalog-admin.mjs').then(function (m) {
    if (!catalogAdmin) catalogAdmin = m.createCatalogAdmin(CATALOG_DEPS);
    fn(catalogAdmin);
  }).catch(function () { /* leave the screen as it is; do not throw */ });
}
```

Call sites change from `renderCategoryManager()` to `withCatalog(function (c) { c.renderCategoryManager(); })`.
First open of the screen therefore pays one module fetch (already cached afterwards); every other boot
does not fetch it at all. No call site becomes async.

## Phases

Ship one phase per pull request. Each phase bumps Admin and `serviceWorkerCache`, and each needs the
till check listed against it — I cannot verify a signed-in screen from the build environment.

### Phase 1 — archive panel (5 KB, very low risk)

- Move `createOrderArchivePanel` instantiation into a `withArchivePanel` wrapper; call it from
  `renderArchive()` and from the `toggleArchivePanel` first-open path (core.mjs:993-995).
- Also remove the eager `createOrderArchivePanel` import from core.mjs:18.
- Guard update: the Phase 4 module-boundary check in `tests/static/30-server-release.mjs` pins
  `from"./order-archive-panel.mjs"`; update the marker list deliberately and re-baseline the pinned
  digest in `tests/static-suite-architecture-check.mjs` (guard count stays 577).
- Till check: open Admin → Orders → archive panel; confirm history, sorting, archive and delete
  confirmations behave exactly as before.

### Phase 2 — catalog (41 KB, low risk, biggest single win)

- Same pattern for `createCatalogAdmin` (core.mjs:199). Keep the five derived functions
  (`renderCategoryManager`, `renderOptionManager`, `renderNewItemOptionChecklist`, `renderStaffMenu`,
  `buildAvail`) behind wrappers so call sites at core.mjs:252/280/357/358 stay synchronous.
- Confirm `buildAvail()` is not required before the first Product or POS render; if it is, call it
  from the wrapper once the module resolves.
- Till check: Admin → Products (categories, options, new item checklist) and POS menu availability on
  a device; ring one test sale and confirm the item list and availability are unchanged.

### Phase 3 — reservations (26 KB, medium risk)

Riskiest of the three because the factory subscribes to `reservations` and `calBlocks` at creation
(reservations.mjs:71-72) and feeds `updateStats`. Deferring moves those subscriptions to the first
Reservations open, so confirm first whether Home stats read live reservation counts.

- If Home stats only use it for the Reservations tab, defer as in phases 1-2.
- If Home stats need it, split the module instead: keep the subscription/stat part in a small module
  and defer only the calendar/render half.
- Till check: Home stats before and after opening Reservations, the customer calendar, the admin
  calendar, and creating one reservation.

### Phase 4 — overview-insights (40 KB, not deferrable)

It renders Home on boot. Options are internal: split the chart/summary builders from the renderer and
load only the chart part when the Home charts are visible, or accept it. Treat as a separate
investigation with its own measurement; do not bundle it into phases 1-3.

### Optional — Accaza AI scripts (20 KB)

`accaza-ai.js` (12 KB) and `accaza-ai-manager.js` (8 KB) are classic blocking scripts in
`src/html/admin/70-runtime.html`. They are optional UI, not sales. Load them on first AI interaction
through a stub that imports then delegates. Needs an AI panel check.

## Acceptance and measurement

For every phase:

1. `node tools/pos-load-profile.mjs https://accazacoffee.com/admin.html` before and after, on the same
   network; record `resources`, application JavaScript files/bytes, and `DOMContentLoaded`.
2. Expected: application JS files drop by one per phase and total app JS bytes drop by the module size;
   `pos_boot` must not get worse, and should improve by the fetch time of that module on a cold cache.
3. `npm run test:ci:quiet` green (270+ steps), plus the specific checks above.
4. Full rollback for any phase = revert that phase's squash commit; no data, schema or rules involved.

## Guardrails and constraints

- Do **not** change App Check ordering: `initializeAccazaAppCheck` must stay before
  `getDatabase`/`getAuth`/`getFunctions` (`tests/app-check-coverage-check.mjs`).
- Keep `realtime-hub`, `portal-auth`, `manager-approval`, `firebase-client` and `workspace-shell`
  eager: they are needed before the first interactive render.
- Static guards that pin module-boundary literals and the guard digest must be updated deliberately per
  phase, with the count unchanged (577 guards, 33 executable checks), exactly as done in Admin 735.
- No POS checkout, money, inventory, auth, rules or schema changes are involved in phases 1-3.

## Blind spots

- I cannot load a signed-in Admin/POS screen from the build environment; every phase depends on a real
  device check, and a mistake shows up as an empty screen, not a failed test.
- Per-phase cache bumps make every device re-download once; batch phases into one release where the
  till checks can be done back to back.
- These are estimates in bytes, not measured seconds. Phase 2 is the one worth doing first; phases 1
  and 3 are small by comparison, and phase 4 may not be worth the risk at all.
