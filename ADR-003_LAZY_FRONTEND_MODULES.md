# ADR-003: Lazy Frontend Modules Without a Framework Rewrite

**Status:** Accepted  
**Date:** 9 August 2026  
**Deciders:** Danilo Magbual and Codex

## Context

The admin portal was a 977,649-byte HTML monolith containing roughly 680 KB of inline JavaScript. POS, analytics, register operations, finance, packages, staff access, and SheetJS were parsed during startup even when the user opened only the dashboard. The customer page also contained a retired embedded admin portal and attempted admin-wide database reads.

The application is live and tightly coupled through `window.__accaza`, `window.switchTab`, and established Firebase workflows. A framework rewrite would create a large regression surface.

## Decision

Keep the current UI and Firebase architecture, but extract scripts into separately cacheable files and add a small dependency-aware tab loader.

- `admin/core.mjs` remains the authenticated portal core.
- POS, analytics, register, staff access, packages, and finance are classic-script modules loaded only when one of their tabs is opened.
- A single `module-loader.js` owns `window.posSwitchTab`; feature modules register handlers instead of wrapping one another.
- SheetJS loads only after an Excel import/export action.
- Customer scripts are external and cacheable.
- The retired embedded admin DOM and admin-wide customer-page startup listeners are removed.
- No framework, bundler, or new production dependency is introduced.

## Options Considered

### Option A: Keep one HTML file

| Dimension | Assessment |
|---|---|
| Complexity | Low initially |
| Startup performance | Poor |
| Cacheability | Poor |
| Regression isolation | Poor |

**Pros:** No packaging change.  
**Cons:** Every feature is downloaded and parsed on every startup; unrelated changes remain tightly coupled.

### Option B: External modules with a lightweight loader

| Dimension | Assessment |
|---|---|
| Complexity | Medium |
| Startup performance | Improved |
| Cacheability | Good |
| Regression isolation | Improved |

**Pros:** Material reduction without changing business workflows; modules can be cached independently.  
**Cons:** Every deploy must include the complete `assets/js` tree; direct local `file://` opening is unsupported.

### Option C: Framework rewrite and bundler

| Dimension | Assessment |
|---|---|
| Complexity | High |
| Startup performance | Potentially excellent |
| Delivery risk | High |
| Team familiarity | Low |

**Pros:** Clean long-term component model.  
**Cons:** Large rewrite risk while security, inventory, and accounting controls are still evolving.

## Trade-off Analysis

Option B produces most of the immediate startup benefit while preserving existing screens and Firebase behavior. It also creates boundaries that Phase 4 can refine. The remaining 224 KB admin core still mixes legacy responsibilities; a deeper rewrite is intentionally deferred until production behavior is measured.

## Consequences

- Admin first-party startup payload falls from 977,649 bytes to approximately 515,032 bytes before compression and excluding Firebase CDN modules—a 47.3% reduction.
- About 455 KB of feature code is deferred until relevant tabs open.
- SheetJS is absent from startup.
- Customer first-party startup payload falls from 505,482 bytes to approximately 452,889 bytes and becomes independently cacheable.
- Deploying only the HTML files will break the site. The complete `assets/js` directory is mandatory.
- The admin core remains larger than the final target and must be measured before further splitting.

## Action Items

1. Deploy all Release 2D frontend files atomically.
2. Run the browser smoke test on the cashier device.
3. Record cold/warm timings and loaded network bytes.
4. Continue deeper shared-core cleanup only after production behavior is stable.
