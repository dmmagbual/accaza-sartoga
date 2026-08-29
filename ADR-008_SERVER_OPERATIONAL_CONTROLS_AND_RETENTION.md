# ADR-008 — Server Operational Controls and Retention

**Status:** Accepted; locally implemented, production rollout pending  
**Date:** 9 August 2026  
**Deciders:** Danilo Magbual and Codex

## Context

Release 3D protected core financial actions but archived orders, discrepancy closure, petty-cash approval/void, and activity-log archival still trusted browser writes. A user with browser access could bypass the intended screen workflow. Permanent deletion of completed sales could also remove evidence required by financial reports.

## Decision

The following operations are permission-checked Cloud Functions:

- Manual order archive.
- Eligible archived-order deletion.
- Discrepancy review.
- Petty voucher approval, rejection, and void.
- Activity-log archival.

Manager-sensitive actions use the Release 3D approval mechanism: independent Firebase sign-in, verified manager role, five-minute expiry, action/source/amount binding, and one-time consumption.

Completed, received, and financially posted sales are retained. Permanent deletion is available only for rejected orders after 90 days, only when no sale movement exists, and only with manager approval. Deletion leaves a non-personal `/deletionAudit` tombstone. Operational actions create server-owned `/operationalAudit` records.

Browser writes are denied for `/archivedOrders`, `/activityLogArchive`, `/operationalAudit`, and `/deletionAudit`. Browser users may create open discrepancies and pending petty vouchers, but cannot review/approve/reject/void them directly.

## Options Considered

### Option A: Keep browser writes and hide buttons by role

Low implementation cost, but the browser remains the authority. Rejected.

### Option B: Allow managers to delete any archived order

Convenient, but destroys financial traceability and can invalidate reports. Rejected.

### Option C: Server controls with constrained retention

Selected. It preserves existing workflows while making sensitive state transitions auditable and enforceable.

## Consequences

- Archived financial sales cannot be deleted from the UI or by Firebase browser credentials.
- Rejected orders remain for at least 90 days before an approved deletion.
- Activity archiving processes up to 500 old records per call; repeat when `hasMore` is returned.
- Manager identity is recorded using Firebase UID/email/name rather than a shared POS PIN.
- Existing direct replenishment and petty opening-balance entry remain separate controls for a later release; 3E secures voucher decisions, not every petty-cash input.

## Action Items

1. Deploy Functions and Database rules together.
2. Publish admin v156, the changed admin scripts, and service worker cache v45.
3. Run the 3E smoke tests.
4. Review whether petty replenishments/opening balance should become manager-approved server commands in the next control release.
