# ADR-014 — Shared and Explicit PWA Installation UX

**Status:** Accepted  
**Date:** 9 August 2026  
**Deciders:** Danilo Magbual and Codex

## Context

Browser installation controls are inconsistent and often hidden. The customer navigation file owned the only install prompt handler, so the POS page could display an install button whose function was not loaded.

## Decision

- `assets/js/pwa-register.js` is the sole owner of service-worker registration and PWA installation.
- Show explicit POS install buttons on the login panel and logged-in admin header.
- Preserve the customer hero install button through the shared controller.
- Use the native prompt when available; otherwise show truthful browser/device instructions.
- Detect standalone mode and installation completion.
- Notify users when a new cached version is ready and offer a controlled reload.

## Consequences

- Installation is discoverable instead of depending on a hidden browser icon.
- Customer and POS install behavior no longer diverge.
- Browsers still retain final authority over whether a native prompt is available.

