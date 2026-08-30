# ADR-027: Decompose financially sensitive source without runtime changes

**Status:** Accepted
**Date:** 2026-08-30
**Deciders:** Accaza owner and engineering

## Context

Four authoritative files combined unrelated checkout, inventory, purchase, settlement, and correction responsibilities and ranged from roughly 68 KB to 79 KB. They increased review context and made narrow financial changes harder to isolate. The deployed browser and Functions bundles already use build-time concatenation, so the source can be divided without introducing runtime network or module-loading risk.

## Decision

Split the files at exact byte boundaries into lexicographically ordered source sections. Do not edit statements, whitespace, transaction boundaries, export order, or deployed bundles. Enforce bundle equality, Function export order, retired-name exclusion, and a 70 KB ceiling.

## Options Considered

### Runtime ES-module conversion

**Pros:** Strong runtime module boundaries.

**Cons:** Changes loading, shared scope, initialization timing, offline behavior, and Cloud Function construction. This adds unnecessary operational and financial risk.

### Refactor functions and shared state now

**Pros:** Cleaner semantic interfaces.

**Cons:** Could alter closures, transaction sequencing, error handling, atomic updates, and idempotency. It would mix behavior change with repository optimization.

### Exact build-time source decomposition

**Pros:** Smaller review units with byte-identical runtime output and no deployment behavior change.

**Cons:** Some continuation sections depend on lexical scope established in an earlier file and must not be executed independently.

## Consequences

- Engineers and automated assistants can inspect one financial responsibility without loading the former monolith.
- Ordered section names are part of the build contract.
- Deployed POS, Admin, Finance Books, Functions, security rules, and data remain unchanged.
- Future semantic refactors require a separate phase with explicit accounting and migration analysis.

## Recovery

Restore from `backup/phase9-pre-financial-source-decomposition-20260830` or rebuild the four original files by concatenating their corresponding ordered sections.
