# ADR-012 — Versioned Customer and POS Offline Shells

**Status:** Accepted  
**Date:** 9 August 2026  
**Deciders:** Danilo Magbual and Codex

## Context

Both entry pages referenced a missing manifest and missing icons. Only the customer page registered the service worker, and the old offline fallback returned the customer homepage even when an admin/POS module failed. The POS must become more resilient without falsely treating an offline sale as synchronized.

## Decision

- Use separate manifests for customer (`manifest.json`) and POS (`manifest-admin.json`) install identities.
- Use one shared service-worker registrar from both entry pages.
- Pre-cache the real customer and POS shells, including local lazy POS modules.
- Keep same-origin requests network-first and cache only successful responses.
- Route offline navigations to the correct customer or admin shell.
- Return an explicit 503 for uncached assets instead of substituting HTML for JavaScript.
- Keep transactions online-only in 5A. Offline transaction queueing requires idempotency, IndexedDB, visible states, and server confirmation in a later release.

## Options Considered

### One shared manifest

Low complexity, but installing from the customer site and POS would create the same app identity and wrong start page. Rejected.

### Cache shell and queue sales immediately

Higher apparent functionality, but unsafe without idempotency and durable queue states. Rejected for 5A.

### Separate manifests and shell-only offline support

Chosen. It fixes installation and startup resilience while preserving financial integrity.

## Consequences

- POS and customer apps install with the correct names and start pages.
- Previously loaded local UI modules can open during an interruption.
- Firebase authentication/data still require connectivity or existing SDK persistence.
- A sale is not considered complete offline; Phase 5B must design the durable transaction queue.

