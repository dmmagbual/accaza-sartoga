# ADR-022 — Contextual Admin Workspaces

**Status:** Accepted  
**Date:** 2026-08-09  
**Release:** 7D

## Decision

Keep the Release 7C primary navigation, but give each selected area its own contextual workspace header. The header identifies the operating area, explains the immediate job, and may offer one relevant shortcut. A compact live strip exposes connection, signed-in role, open-shift state, and durable offline-queue state.

POS is treated as the primary transaction workspace. On larger screens it uses a wider canvas, suppresses overview-only dashboard statistics, keeps the cart usable during long orders, and keeps the Charge action within reach. Mobile keeps normal document flow to avoid nested scrolling.

## Rationale

The old portal made every tab feel equally important and forced staff to infer operational context. Release 7C fixed navigation grouping; Release 7D completes the hierarchy inside each destination without changing authorization, Firebase ownership, pricing, inventory, or accounting behavior.

## Consequences

- Workspace presentation is owned by `assets/js/admin/workspace-shell.mjs`.
- Core tab routing calls the shell after selecting content.
- POS and offline-queue modules refresh status without owning the shared chrome.
- The new module is an authoritative release file and service-worker asset.
- Status indicators are operational aids, not substitutes for server authorization or audit records.
