# ADR-023 — Rush-Hour POS Workflow

**Status:** Accepted  
**Date:** 2026-08-09  
**Release:** 7E

## Decision

Optimize the POS screen around the cashier’s shortest successful path: find an item, verify the ticket, select payment, and charge. Add local menu search, a horizontal category rail, clearer product identity and pricing, explicit ticket readiness, and one-tap quantity adjustment.

The visual language uses Accaza’s roast brown, brass, paper, and service green. The ticket’s three-part order rail is the sole signature device; it communicates progress instead of decorating the screen.

## Rationale

Release 7D gave POS more space but retained a visually flat product grid and a dense receipt-style cart. During rush periods, staff need faster scanning and correction, not more administrative information. Quantity correction previously required removing and rebuilding a line.

## Boundaries

- Search and quantity controls modify only the in-memory draft cart.
- Server pricing, discounts, payment validation, shift enforcement, durable offline save, inventory posting, and financial posting remain unchanged.
- Categories are real buttons with visible keyboard focus.
- Empty search and empty ticket states tell the cashier what to do next.
- Reduced-motion and narrow-screen behavior remain supported.
