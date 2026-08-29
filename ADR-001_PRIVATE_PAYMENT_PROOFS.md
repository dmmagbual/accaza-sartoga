# ADR-001: Private, On-Demand Payment-Proof Storage

**Status:** Accepted and implemented locally  
**Date:** 9 August 2026  
**Decider:** Accaza Coffee House

## Context

Online orders currently embed full base64 receipt images inside Realtime Database order records. Every active-order listener therefore downloads every receipt even when staff never opens it. This makes startup payload and real-time updates grow with image size and exposes sensitive payment evidence to every reader of the order record.

## Decision

1. Customer build v42 compresses receipt images in-browser to JPEG, maximum 1,600 px on the longest side and normally below 1.4 MB.
2. `createOnlineOrder` validates the claimed MIME type, binary signature, and size, then writes the file to the private default Firebase Storage bucket.
3. Realtime Database stores only `proofPath`, content type, byte count, and storage schema version.
4. Storage browser access is deny-all. Only Admin SDK code can access proof objects.
5. Admin build v146 shows a lightweight “View payment proof” button. `getPaymentProof` verifies the Firebase UID against `/admins`, downloads the object only on demand, and returns it through the callable response.
6. Legacy orders containing `order.proof` remain viewable. No historical migration is required for this release.

## Options Considered

### Keep base64 in Realtime Database

Low implementation effort, but permanently increases listener payload, database transfer, rendering work, and privacy exposure. Rejected.

### Direct browser upload with Storage rules

Efficient transfer, but Storage rules cannot use the project's Realtime Database role records. Implementing equivalent authorization would require custom claims or a second role source. Deferred.

### Server-owned upload and retrieval

Uses the existing authenticated callable boundary, keeps Storage private, preserves RTDB roles, and makes proof reads lazy. Selected. The trade-off is that proof bytes pass through Cloud Functions during upload and explicit viewing.

## Consequences

- Active-order listeners no longer carry receipt images for new orders.
- New proofs are private objects rather than permanent public download URLs.
- A Cloud Function call is required to place an online order and to view a stored proof.
- Cached v41 customers remain temporarily supported up to 5 MB; v42 compresses before submission.
- Orphan files are deleted if the order write fails.

