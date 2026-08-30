# Phase 19 — Security and accounting assurance

Phase 19 adds a bounded, read-only assurance sample to the existing management production-validation response. Recovery pointer: `backup/phase19-pre-security-accounting-assurance-20260831`.

The sample checks up to 100 recent Finance movements, operational audit records, and financial approvals. It blocks on an unbalanced sampled journal, missing Finance source identity, or orphan permission profile. It flags weak correction/reversal links, incomplete consumed-approval claims, and missing audit evidence for qualified review.

This is management testing support, not an audit opinion. Sampling cannot prove population completeness or operating effectiveness for the full period. A qualified financial professional and security reviewer must independently define materiality, select dated random and targeted samples, inspect source documents, reperform calculations, test access provisioning/deprovisioning, and sign the workpaper.

No finding is repaired automatically. Corrections, returns, reversals, allocations, settlements, inventory effects, and Finance Books treatment remain in their original controlled workflows with source references, approval separation, audit history, and idempotency protection. Never place credentials, production exports, customer records, payment details, or full audit populations in Git.

Rollback by reverting Phase 19. The evaluator has no write operation, so rollback cannot alter POS activity or financial balances.
