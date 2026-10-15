# Accaza — Backup Restore Drill & Off-Project Copy Runbook

**Owner:** Danilo Magbual · **Cadence:** quarterly (and before any major migration)
**Closes:** audit finding **H-2** and release-manifest item `backupRestoreTest`
**Golden rule:** a restore drill is **READ-ONLY against production**. You only *download* from prod. You never restore into `accaza-sartoga` (production). Restore only into an **isolated target** (the local Emulator or a throwaway staging project).

---

## 0. What you are proving

1. The latest daily backup **exists**, is **intact** (SHA-256 matches), and is **financially valid** (every Finance movement and Books journal balances).
2. The backup can be **restored** into a clean database and comes back **byte-identical**.
3. You have at least one **off-project copy**, so a lost/compromised `accaza-sartoga` project does not take the ledger with it.

## 1. How the backup works (context)

- `backupDatabaseDaily` runs **03:00 Asia/Manila**, writes the whole Realtime Database (minus transient nodes) as an integrity envelope to Cloud Storage.
- **Bucket / path:** `gs://accaza-sartoga.firebasestorage.app/db-backups/accaza-<YYYY-MM-DD-HH-MM-SS>.json`
- **Health record:** `/systemHealth/backups/latest` in RTDB (`takenAt`, `objectName`, `bytes`, `nodes`, `dataSha256`, `validation:"passed"`).
- **Retention:** 30 days (older snapshots auto-deleted).
- **Envelope shape:** `{ takenAt, version:"backup-v2", excluded:[...], integrity:{ algorithm:"sha256", canonical:"sorted-json-v1", dataSha256 }, data }`.
- **Deliberately excluded (transient, safe to omit):** `activeOrders`, `orderLocks`, `rateLimits`, `orderStatusCommands`, `offlinePosSync`, `clientTelemetryDaily`. These rebuild themselves at runtime — their absence after a restore is **expected, not data loss**.

---

## 2. Pre-drill checklist

- [ ] You have the Firebase CLI (`firebase --version`) and Google Cloud SDK (`gsutil version`) installed and are logged in to the `accaza-sartoga` owner account.
- [ ] You are doing this **outside POS hours** (drill is low-risk, but keep prod quiet).
- [ ] Confirm the daily backup is healthy first — in Admin / Firebase console, read `/systemHealth/backups/latest` and note its `takenAt`, `objectName`, and `dataSha256`.

---

## 3. Step 1 — Download the latest backup (read-only from prod)

```bash
# List the most recent snapshots
gsutil ls -l "gs://accaza-sartoga.firebasestorage.app/db-backups/" | sort | tail -5

# Download the newest one (substitute the exact object name from the listing)
gsutil cp "gs://accaza-sartoga.firebasestorage.app/db-backups/accaza-<STAMP>.json" ./restore-drill-backup.json
```

Windows PowerShell is identical (`gsutil` is cross-platform). Do **not** delete or overwrite anything in the bucket.

## 4. Step 2 — Verify the backup (one command, integrity + double-entry)

Run the committed verifier — pure Node, no GCP or emulator needed:

```bash
node tools/verify-backup.mjs restore-drill-backup.json
```

It prints INTACT (SHA-256 matches the sealed envelope), BALANCED (every financialMovement and Books journal balances), the clearing/suspense standing at backup time, and a final **PASS** / **FAIL** (exit 0 / 1). A FAIL names the exact node/row (e.g. `financialMovements/<id>: debits and credits differ by N cent(s)`) — stop and investigate before trusting that backup. This step alone (download + verify) is a valid quick "is my latest backup good?" check; Steps 3–4 add the full restore-fidelity drill.

## 5. Step 3 — Start an ISOLATED target (local emulator)

Never point at production. The drill tool below refuses anything but a local emulator.

On Windows with Java 17+, start the Realtime Database emulator **directly with Java** and give it a temp folder without spaces. A user folder with a space (`C:\Users\Danilo Magbual`) makes Java's internal pipe fail, and `firebase emulators:start` then exits with code 1 and an empty log:

```powershell
New-Item -ItemType Directory -Force -Path C:\AccazaJavaTmp | Out-Null
java -Djdk.net.unixdomain.tmpdir=C:\AccazaJavaTmp -Djava.io.tmpdir=C:\AccazaJavaTmp -jar "$env:USERPROFILE\.cache\firebase\emulators\firebase-database-emulator-v4.11.2.jar" --port 9123
# leave it running; it prints "Listening at localhost:9123"
```

(Option B, a cloud target, is the UAT project `accazacoffeepos-uat`. Never `accaza-sartoga`.)

## 6. Step 4 — Restore into the target and verify fidelity (one command)

```powershell
node tools/restore-drill.cjs "<path to downloaded backup.json>" 9123
```

It restores every node, reads the whole database back, re-fingerprints it and re-checks double entry, then prints **PASS** or **FAIL** (exit 0 / 2). It forces the emulator host, loads no credentials and refuses a non-empty target, so it cannot write to production.

**Pass criteria:** `FIDELITY MATCH: true`, `movements balanced: true`, `excluded absent: true`. Stop the emulator afterwards (Ctrl+C); its data disappears with it.

## 7. Step 5 — Record evidence & close the manifest item

- Save the console output of Steps 4 and 6 (or screenshots) into your operations log per `OPERATIONS_RELEASE_RUNBOOK.md`.
- In `release-manifest.json`, move `backupRestoreTest` from pending to satisfied, recording the drill date and the verified `dataSha256`. Re-run `npm run test:release` and confirm the pending list shrinks by one. Commit that as its own small change (build-marker rules do not apply — no app asset changed).
- Tear down: `Ctrl+C` the emulator (Option A), or wipe the staging RTDB (Option B). Delete `restore-drill-backup.json` locally when done.

---

## 8. Off-project copy (LIVE since 15 Oct 2026)

Every backup is copied every night to a separate Google Cloud project, so losing, locking or compromising `accaza-sartoga` does not take the backups with it.

| Item | Setting |
|---|---|
| Project | `accaza-backup-vault` (own project, same billing account `01D784-AE2D40-BE3911`; "My First Project" was unlinked from billing to free the slot) |
| Bucket | `gs://accaza-backup-vault-db/db-backups/`, region `asia-east1` (production is `asia-southeast1`), class NEARLINE, public access prevented |
| Protection | 30-day retention policy (objects cannot be deleted or replaced for 30 days, not locked, so the owner can still change it), 7-day soft delete, lifecycle delete after 365 days (production keeps 30) |
| Copy | Storage Transfer job `transferJobs/9637376379524151450`, daily 20:30 UTC = 04:30 Manila (after the 03:00 backup). Pull model: the vault reads production; production holds no access to the vault. Never deletes from source or vault |
| Access | The vault's transfer agent `project-467521083783@storage-transfer-service.iam.gserviceaccount.com` has read-only `objectViewer` + `legacyBucketReader` on the production bucket. It cannot be narrowed to `db-backups/` because that bucket uses fine-grained ACLs (enabling uniform access could break Firebase Storage download links); the job itself copies only `db-backups/` |
| Alert | "Accaza CRITICAL - Off-site backup copy failed": any ERROR log in the vault project emails danilomagbual@gmail.com (the vault runs nothing else) |
| First run | 15 Oct 2026: 25/25 files, 411,984,553 bytes, every MD5 identical to production |
| Cost | ~11 GB/year in NEARLINE, cents per month; no Firebase reads |

Restore from the vault: download from `gs://accaza-backup-vault-db/db-backups/` instead of production, then Steps 2-4 unchanged.

Remaining hardening option: the vault sits under the same Google account as production. A separate Google account owning the vault (with its own 2-step verification) would also survive a compromised owner account.

## 9. Cadence & monitoring

- **Daily (automatic):** the backup runs at 03:00 Manila and writes `/systemHealth/backups/latest`. Glance at it weekly — if `takenAt` is stale (>36h old) or `validation` != `"passed"`, the backup job needs attention.
- **Quarterly:** run this full drill (Steps 1–7) and record evidence. Also confirm the vault holds last night's file: `gcloud storage ls gs://accaza-backup-vault-db/db-backups/ | Select-Object -Last 2`.
- **Before any schema/migration change:** run Steps 1–2 (download + validate) as a known-good recovery point.

## 10. Troubleshooting

| Symptom | Meaning / action |
|---|---|
| `gsutil ls` empty | Backup job never ran or bucket path changed. Check the `backupDatabaseDaily` function logs and `/systemHealth/backups/latest`. |
| `VALID: false` with `differ by N cent(s)` | A Finance/Books row in the backup is unbalanced — a real data-integrity issue in prod at backup time. Investigate that source id before trusting the snapshot. |
| `matches envelope: false` | The file was truncated/corrupted in transit — re-download. |
| Emulator exits with code 1 and an empty log (Windows) | Java cannot open its internal pipe under a user folder with a space. Start it with Java directly and `-Djdk.net.unixdomain.tmpdir=C:\AccazaJavaTmp` (Step 3). |
| `FIDELITY MATCH: false` | The restore target altered data (wrong target, partial write, or a non-empty target). Wipe target and re-run. |
| Excluded nodes present after restore | You restored an old `backup-v1` or a hand-edited file — expected only for the six transient nodes. |

---

## 11. Drill log

| Date | Backup | Quick check | Full restore | By |
|---|---|---|---|---|
| 15 Oct 2026 | `db-backups/accaza-2026-10-14-19-00-04.json` (full, 29.3 MB, 134 nodes), SHA-256 `1049d29c5bc5a5c2a69f5401c7c429b01a1f89d51b9820565f9b039c04a5879c` | PASS: intact, balanced; clearing/suspense 1190, 1290, 1900, 2090, 5090 all 0.00 | PASS: 134/134 nodes in 5.1 s, fidelity match, 2,441 movements balanced (debits = credits 9,220,890.75), excluded nodes absent. Counts: archivedOrders 1,224, orders 28, shifts 170, inventoryMovements 12,426, payables 31 | Claude for Danilo, local emulator, while the POS was live (no production access beyond downloading the backup file) |
