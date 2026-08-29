# ADR-005 — Shared Costing Authority

**Date:** 9 August 2026  
**Status:** Accepted; locally implemented, production rollout pending

## Decision

Recipe normalization, unit conversion, ingredient usage, option stacking, and COGS calculation use one pure engine: `assets/js/shared/costing.js`. The browser loads it for previews and validation. Firebase Functions uses a synchronized byte-identical copy at `functions/lib/costing.js`.

`firebase.json` runs `tools/sync-costing.mjs` before every Functions deployment. Regression tests also compare both files byte-for-byte, so a browser/server formula drift fails the build.

The browser may preview cost, but `onOrderFinalize` calculates the authoritative usage and COGS. Each finalized order keeps the compatible numeric `cogsSnapshot` plus `cogsDetail`, which identifies the engine version, ingredient, source, converted stock quantity, current weighted-average unit cost, cost-effective timestamp, line cost, and warnings.

## Unit policy

- Volume: ml, L, tsp, tbsp, cup, and fluid ounce (`fl oz`).
- Weight: mg, g, kg, lb, and weight ounce (`oz wt`).
- Count: pc/pcs, ea/each, and dozen.
- Unrecognized custom units may convert only to the exact same custom unit.
- Plain `oz` is rejected because it could mean fluid volume or weight.
- Incompatible dimensions are rejected; the system never silently treats their numbers as equivalent.

Recipes are normalized to inventory stock units before storage. Display/input quantities are retained for editing, while `qtyS`, `qtyM`, and `qtyL` are canonical stock-unit usage.

## Authority boundary

The authenticated browser still performs the final recipe database write after a permission-checked callable returns a normalized recipe. This is not fully server-owned recipe persistence and is an intentional intermediate boundary for this release. Order usage, stock deduction, and COGS remain server-authoritative.

## Rejected alternatives

- Duplicated browser and Functions formulas: guaranteed long-term drift.
- Trusting precomputed browser COGS: forgeable and dependent on the device remaining open.
- Silent unit fallback: produces believable but wrong inventory and cost.
- Rounding every ingredient to cents before summing: loses small-but-real ingredient costs. Trace lines retain six decimals; only final order COGS is rounded to cents.
