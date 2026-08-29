# Accaza Production Source Baseline

**Captured:** 9 August 2026, before Phase 0 / Release 1A changes  
**Purpose:** Identify the exact local files that existed before the security and performance improvement program.

## Important limitation

This folder is not currently a Git working copy and has no configured GitHub remote. These hashes identify the local source only. They do not prove that the same files are currently deployed on GitHub Pages or Firebase.

## Build markers

- `admin.html`: build v141
- `index.html`: accaza-index build v37

## SHA-256 hashes

| File | SHA-256 |
|---|---|
| `admin.html` | `BEA817E4F626A94EE8017430DF57D3BA417AD8D20DB6B0BAA3C13EA2EEEFE973` |
| `index.html` | `A579E1E57F96BCB43CA636189E039DA93EDD0BB6B20A3FEF92287C63133A15EA` |
| `database.rules.json` | `A5D7A40359D2C3146B96D8724E42CD57EDF0266A36D4B63BB5302E2EB1C3B7AD` |
| `sw.js` | `144B158A90BE5608E6776BC9F5AEC08AE973B306B4EAA0863DCFF538A1D409DB` |
| `functions/index.js` | `F266D6C6223C103E65CAB07BE145C6063735D7E2161D0C982B69B0829180EBCF` |
| `firebase.json` | `0CF9471EB50B91533BB5650D42F70B637830144B0D5797376747DD5C1502F01E` |

## Rollback source currently present

The folder contains manual backups and ZIP archives, but they are divergent and are not a reliable coordinated rollback across frontend, database rules, and Cloud Functions. Do not deploy a backup copy merely because its filename looks recent.

## Before any production deployment

1. Confirm which GitHub repository and branch serve the live site.
2. Compare deployed files or Git commit with the intended release.
3. Export a fresh Firebase backup outside the public repository.
4. Record the deployed Git commit/tag and Firebase deployment result.
5. Run the release smoke test and retain the previous coordinated release for rollback.

