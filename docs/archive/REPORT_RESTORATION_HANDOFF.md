# Sales summary restoration

## Confirmed failure

The deployed report reader requires `salesRollupBackfill.schemaVersion >= 4`.
The live readiness record inspected on 20 September still had a completed
version 2 build. Deployment alone cannot upgrade these stored summaries.
Do not change the readiness flag or version manually.

The Dashboard also passed `{start,end}` into a summary calculator expecting
`{startAt,endAt}`. This repair supports both consumers and keeps live orders
within the same period. An unavailable summary now stays visibly unavailable
instead of falling through to an indefinite loading message.

## Local changes

- Retain the no-retry guards in Dashboard and Books.
- Stop maintenance after one incomplete batch. Save the server cursor and
  require another deliberate action to continue. Completed prerequisite
  stages are skipped; a valid replica is not rebuilt just to upgrade summaries.
- Reserve a separate project-wide budget before summary migration: four
  document reads per requested order, at most 1,000 per Pacific calendar day.
  This covers the page, contribution, and up to two monthly records. Repair
  transactions have one attempt; failed attempts retain their reservation.
- Existing contribution reconciliation upgrades legacy rows and is idempotent.
  Source orders, stock evidence, settlements and Finance Books journals are
  not modified. No journal is created by report preparation.

## Release and recovery

This is a local build, not a completed production restoration. No live
Firestore report or migration was run during this build.

After review, push/merge/deploy the frontend and Functions together. Refresh
Admin and verify build 565 (service-worker cache 546). Wait until the daily
Firestore allowance has reset and sufficient headroom is available before
starting migration. The separate migration budget is not a measurement of
remaining project quota and does not guarantee that the free allowance remains.

Use the owner maintenance action only after deployment. It skips valid
replica/date/ledger stages and upgrades the outdated summary. Stop after each
batch, inspect progress and usage, and resume only with available headroom.
On failure it stops; do not repeatedly restart from the beginning. After all
pages complete, the server records version 4 and enables the summary reader.

Verify one controlled report load: 12-month revenue/orders, selected-period
revenue/orders, payment split, top sellers, channels and Sales Analytics.
Reconcile their totals to the selected source period, then inspect request
logs during an idle interval to prove that no retry loop remains. Frontend
deployment, successful migration, report correctness and measured read rate
are separate acceptance checks.
