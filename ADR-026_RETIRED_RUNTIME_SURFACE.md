# ADR-026: Retire the historical combined customer and POS runtime

**Status:** Accepted
**Date:** 2026-08-30
**Deciders:** Accaza owner and engineering

## Context

`index-pos.html` was a 574,574-byte historical copy of the customer site, Admin portal, and POS. Nothing in the current application, service worker, build tools, tests, or release manifest referenced it. Because it was tracked at the repository root, GitHub Pages could still publish it as a second application endpoint.

The file contained superseded browser-side password hashes, Manager PIN authorization, direct order and inventory writes, direct status changes, legacy stock deduction, and old Admin account management. Current Firebase rules and server commands are the authority, but leaving a stale client publicly reachable increases attack surface, operator confusion, maintenance effort, and the chance that a future rule change accidentally re-enables an obsolete path.

## Decision

Remove `index-pos.html` from the tracked release. Preserve recovery through Git history and `backup/phase7-pre-legacy-hygiene-20260830`. Keep retired/manual copies ignored locally, and make the repository safety test fail if a named retired runtime is tracked again.

## Options Considered

### Keep the file in the repository root

| Dimension | Assessment |
|---|---|
| Complexity | Low |
| Security | Poor; retains a stale public application surface |
| Performance | Poor repository/context efficiency |
| Recovery | Immediate file access |

**Pros:** No deletion and easy manual comparison.

**Cons:** Publicly deployable, obsolete controls remain discoverable, and every code audit can waste context on non-authoritative logic.

### Move it to a tracked archive directory

| Dimension | Assessment |
|---|---|
| Complexity | Low |
| Security | Poor under static whole-repository publishing |
| Performance | No meaningful repository/context reduction |
| Recovery | Immediate file access |

**Pros:** Makes the historical label clearer.

**Cons:** The file remains tracked and may remain publishable; scanners and agents still encounter it.

### Remove it and rely on version-control recovery

| Dimension | Assessment |
|---|---|
| Complexity | Low |
| Security | Best; removes the stale endpoint from the next Pages release |
| Performance | Removes 574,574 bytes from the working repository |
| Recovery | Available from Git history and the Phase 7 backup branch |

**Pros:** One authoritative customer runtime, smaller review context, and a CI-enforced boundary.

**Cons:** Historical inspection requires Git rather than opening a root-level file.

## Trade-off Analysis

Version control is the correct recovery mechanism for retired source. A tracked archive provides convenience at the cost of continued publication and ambiguity. The current applications already have modular authoritative source, generated-bundle drift checks, release manifests, and backup branches, so the historical monolith provides no operational recovery capability that Git does not provide more safely.

## Consequences

- GitHub Pages will stop serving the stale tracked file after Phase 7 is merged and published.
- The active customer, Admin, POS, Finance Books, Functions, rules, and database schema remain unchanged.
- Old bookmarks to `/index-pos.html` will no longer load that retired application; online requests receive the host's normal missing-file behavior, while an installed service worker may use the current customer shell when offline.
- Repository safety checks prevent the retired runtime names from being tracked again.
- Recovery remains possible from commit `f039f7f` or `backup/phase7-pre-legacy-hygiene-20260830`.

## Action Items

1. Remove `index-pos.html` from the tracked branch.
2. Enforce retired-runtime exclusions in `npm run test:safety`.
3. Keep authoritative-source routing documented in the release manifest and Phase 7 note.
4. Verify the customer, Admin/POS, and Finance Books applications before merge.
