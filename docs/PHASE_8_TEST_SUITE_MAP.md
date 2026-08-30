# Phase 8 static-test suite map

## Decision

The former 131,715-byte `tests/static-check.mjs` mixed every application domain in one file. Phase 8 preserves its assertions and execution order while making the runner small and moving checks into bounded modules under `tests/static/`.

## Domain ownership

| Module | Responsibility |
|---|---|
| `00-context.mjs` | Read-only project source context and shared test helpers |
| `10-syntax-rendering.mjs` | HTML/script syntax and customer-field rendering containment |
| `20-access-customer.mjs` | Database rules, portal authentication, and customer ownership |
| `30-server-release.mjs` | Server authority, release wiring, deployment, and offline cache |
| `40-operations-ui.mjs` | POS/Admin operations, offline behavior, performance, and UI safeguards |
| `50-executable-regressions.mjs` | Existing unit/integration child checks, including idempotency and reconciliation |
| `60-finance-books.mjs` | Finance Books, subledgers, cash, inventory, corrections, and reversals |
| `70-xss-reconciliation-summary.mjs` | Kitchen-ticket XSS, reconciliation audit, and complete-suite reporting |

## Equivalence safeguards

`npm run test:static-architecture` verifies the exact ordered module inventory, a 50 KB per-domain ceiling, 505 explicit failure guards, 30 executable child checks, their normalized source digest, and complete runner routing. `npm test` continues to run every domain in the original order. The digest matches the merged pre-Phase 8 suite, so a later assertion-level edit must be reviewed and accepted deliberately.

Focused diagnosis is available through `npm run test:static:access`, `npm run test:static:operations`, `npm run test:static:finance`, and `npm run test:static:regressions`. Dependencies run automatically before a requested domain; these commands supplement rather than replace the full release gate.

## Operational and financial impact

No application runtime, Firebase Function, rule, schema, inventory movement, costing, financial posting, allocation, settlement, correction, return, reversal, audit trail, or idempotency behavior changes. Application builds and the service-worker cache therefore remain unchanged.
