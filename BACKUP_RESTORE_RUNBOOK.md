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

## 5. Step 3 — Stand up an ISOLATED target

Pick one. Never point at production.

**Option A — Local Emulator (recommended: zero cost, zero risk, no cloud project).**
```bash
firebase emulators:start --only database --project demo-accaza-restore
# leave this running in its own terminal; note the DB emulator host it prints (default 127.0.0.1:9000)
```

**Option B — Dedicated staging project** (create once, e.g. `accaza-restore-staging`, empty RTDB). Use only if you need a cloud target. Never `accaza-sartoga`.

## 6. Step 4 — Restore into the target and verify fidelity

Save this as `restore-drill.mjs`, then run it. It restores `envelope.data`, reads it back, re-fingerprints, and spot-checks headline balances.

```js
// restore-drill.mjs  —  run against the EMULATOR or a STAGING project only.
import fs from 'node:fs';
import admin from 'firebase-admin';
import R from './functions/lib/recovery-validation.js' assert { type: 'commonjs' };

// EMULATOR target (Option A):
process.env.FIREBASE_DATABASE_EMULATOR_HOST = '127.0.0.1:9000';
admin.initializeApp({ databaseURL: 'https://demo-accaza-restore-default-rtdb.firebaseio.com' });
// STAGING target (Option B) instead: remove the EMULATOR line above and initializeApp with the staging databaseURL + credential.

const env = JSON.parse(fs.readFileSync('restore-drill-backup.json', 'utf8'));
const pre = R.validateEnvelope(env, {});
if (!pre.ok) { console.error('Envelope invalid, aborting:', pre.issues); process.exit(1); }

const db = admin.database();
await db.ref('/').set(env.data);                       // RESTORE
const restored = (await db.ref('/').get()).val();       // READ BACK
const restoredSha = R.fingerprint(restored);

console.log('restored SHA-256 :', restoredSha);
console.log('envelope SHA-256 :', env.integrity.dataSha256);
console.log('FIDELITY MATCH   :', restoredSha === env.integrity.dataSha256);

// Spot-check a few headline numbers survived (adjust node paths to your chart)
const fm = restored.financialMovements || {};
let dr=0, cr=0; Object.values(fm).forEach(m => (Array.isArray(m.lines)?m.lines:[]).forEach(l => { dr+=Math.round((+l.debit||0)*100); cr+=Math.round((+l.credit||0)*100); }));
console.log('financialMovements total debits==credits:', dr===cr, `(dr ${dr/100}, cr ${cr/100})`);
console.log('excluded-by-design nodes absent:', env.excluded.every(n => restored[n]===undefined));
await admin.app().delete();
```

```bash
node restore-drill.mjs
```

**Pass criteria:** `FIDELITY MATCH: true`, debits==credits `true`, and excluded nodes absent `true`. That is your proof the ledger restores exactly.

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
| `FIDELITY MATCH: false` | The restore target altered data (wrong target, partial write, or a non-empty target). Wipe target and re-run. |
| Excluded nodes present after restore | You restored an old `backup-v1` or a hand-edited file — expected only for the six transient nodes. |
