# Asset cache-busting: stop releases forcing a full re-download

**Status:** planned, not started. Written 13 Oct 2026 from the POS launch investigation.

## The problem, with evidence

Every admin asset is requested with one **global** version token, the admin build number. So **any**
release changes the URL of **every** file, and each device re-downloads the lot — whether or not those
files changed.

Measured cost per device per release: roughly **900 KB** (≈210 KB of eager shell scripts, ≈530 KB of
`pos.js` once the POS opens, plus the rest on demand).

Seen in the numbers: POS launch averaged **6.07 s in the last 7 days against 1.1 s over 30 days**, and
six releases merged in a single day. Each one invalidated every device's cache, which inflates exactly
the window the Operations Center reports.

## How it is wired today (verified 13 Oct 2026)

| Where | What it does |
|---|---|
| `assets/js/admin/module-loader.js:13` | reads `meta[name="accaza-admin-build"]` into `build` |
| `assets/js/admin/module-loader.js:27` | `script.src = base + files[name] + '?v=' + build` — **one token for every lazily loaded module**, including `pos.js` |
| `admin.html` / `books.html` / `index.html` | 6 / 14 / 2 versioned `<script src="…?v=N">` references, written at build time |
| `sw.js:39` | `const CACHE='accaza-v666'` — the service worker cache name is the same global version |
| `sw.js` precache lists | entries with build numbers baked in (for example `/assets/js/books/controlled-transactions.js?v=153`) |

## Proposed change

Compute a **content hash per file at build time** and use it in place of the global build number:

1. **HTML pages** — the build writes `?v=<hash>` per referenced script (each file's own hash).
2. **`module-loader.js`** — becomes a generated output (or gains a generated, sentinel-wrapped
   `VERSIONS = {…}` block) so each module resolves to its own hash, falling back to the build number
   when an entry is missing.
3. **`sw.js`** — the precache list carries each file's own hash. The **cache name stays the global
   build** (it must still change so stale entries are dropped), but the *entries* only change when the
   files change, so a release no longer re-downloads unchanged files.

The global admin build number keeps its other jobs: the visible label, the release manifest and the
service worker cache name.

## Why this needs care

**The failure mode is a blank screen, not a slow one.** A wrong token means a device requests a module
URL that does not exist, and the loader cannot open the POS, the register or the Books screens. Two
specific hazards:

- Mixed versions across a release: a device holding an older shell that asks for a newer module (or the
  reverse). The loader must tolerate a missing hash entry by falling back, never by 404ing.
- The service worker precaching a URL that no longer exists — this already produced two 404 script
  fetches on the till and is the same class of mistake.

Offline must keep working: the durable queue and shift flows depend on cached assets, so the POS has to
open with no network after a release.

## Verification this change requires

1. Static guards: every versioned reference in the built HTML and loader resolves to an existing file.
2. A service worker check: every precache entry resolves (no 404s) for the current build.
3. In a browser, before and after a release that changes one file: confirm in DevTools → Network that
   only the changed file is re-downloaded (compare transferred sizes).
4. `npm test`, `npm run test:release`, `npm run test:safety`.
5. **Staging/rehearsal:** load the admin shell, open the POS and the register, close a shift, and reload
   with the network disabled, before this reaches production.

## Rollback

Revert the build change and rebuild: the previous global-version scheme returns exactly. No data effect
either way — this is cache behaviour only.

## Cheaper alternative if the full scheme is not wanted

Leave the global token, and reduce the number of releases that touch assets by **batching asset
changes** — for example, merging them into one release rather than several in a day. That recovers most
of the cost with no code change, at the price of slower shipping. The per-file hash is the real fix.
