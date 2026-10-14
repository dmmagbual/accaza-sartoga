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

## 8. Off-project copy (do this once, then it runs itself)

Backups currently live only inside the `accaza-sartoga` project — single blast radius. Add at least one copy outside it.

**Option A — scheduled cross-project mirror (robust).** In a *separate* GCP project/account, create a bucket (e.g. `gs://accaza-ledger-offsite/`) and a daily Cloud Scheduler → transfer/`gsutil rsync` that pulls new `db-backups/*.json` from prod:
```bash
gsutil -m rsync -r "gs://accaza-sartoga.firebasestorage.app/db-backups" "gs://accaza-ledger-offsite/db-backups"
```
Grant the offsite project's service account read-only on the prod bucket. Keep the offsite bucket's retention longer than 30 days so you outlast prod's auto-delete.

**Option B — automated in-function second write (later).** Extend `backupDatabaseDaily` to also `save()` the same envelope to an offsite bucket in another project. Cleanest long-term, but it edits `functions/` — schedule it when the Codex functions work is quiet to avoid collisions.

**Option C — manual floor (zero infra, do today).** Once a week, run the Step 1 `gsutil cp` and keep the file somewhere off Google entirely (your machine + one more location). Better than nothing while A is set up.

Recommended: **A** as the standing control, **C** starting this week until A is live.

---

## 9. Cadence & monitoring

- **Daily (automatic):** the backup runs at 03:00 Manila and writes `/systemHealth/backups/latest`. Glance at it weekly — if `takenAt` is stale (>36h old) or `validation` != `"passed"`, the backup job needs attention.
- **Quarterly:** run this full drill (Steps 1–7) and record evidence.
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
