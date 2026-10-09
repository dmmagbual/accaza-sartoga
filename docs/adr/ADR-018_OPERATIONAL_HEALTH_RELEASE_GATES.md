# ADR-018 — Bounded Operational Health and Release Gates

**Date:** 9 August 2026  
**Status:** Accepted — Release 6C

## Decision

Accaza will expose a management-only System Health tab that reads only the latest 7 or 30 daily aggregate telemetry records. The dashboard is lazy-loaded and therefore adds no code or database read to normal POS startup.

The view reports sample count, arithmetic average, worst observed duration, failed timing count, generic client-error count, and reporting build IDs. It must never describe these aggregates as p95 because individual timing samples are not retained.

## Thresholds

| Signal | Good target |
|---|---:|
| POS launch | under 3,000 ms cold; under 1,500 ms warm |
| POS screen build | under 1,500 ms |
| Cart response | under 100 ms |
| Charge safely stored | under 1,500 ms |
| Offline reconnect sync | warning at 5,000 ms |
| Remote order arrival | under 1,500 ms |

`WATCH` means the average is near target or the worst observation crossed target. `ACTION` means the average crossed target, the worst exceeded twice the target, or a failed timing was reported.

## Controls

- Only approved management Firebase accounts can read `/clientTelemetryDaily`.
- Browser writes remain denied; the Cloud Function remains the sole writer.
- No customer, order, payment, staff PIN, recipe, or item detail is collected.
- Release decisions must use the dashboard together with functional smoke tests; telemetry alone cannot prove correctness.

## Consequences

The dashboard stays bounded and inexpensive as history grows. It can detect broad regressions but cannot calculate percentiles, device segmentation, or root-cause traces. Those require a future privacy-reviewed schema change.
