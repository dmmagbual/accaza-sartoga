# Restore point (gate R0)

Run it from the **main project folder**, where the Firebase CLI is signed in with your account. Take one **before merging any change that will be deployed to production** (Purchases & Payments Consolidation Plan, §5A).

```powershell
Set-Location -LiteralPath "C:\AKALIKO\DMM\PERSONAL\CLAUDE\Projects\Accaza Coffee Shop"
.\tools\restore-point\take.ps1 -Task "<short-task-name>"
```

The script:
- Tags `origin/main` as `restore/<task>-<yyyyMMdd-HHmm>` and pushes the tag. If the last successful Functions deploy was a different commit, it also tags that one as `<tag>-functions`.
- Saves small snapshots of `config`, `documentCounters`, `pettyCashCounter`, `booksChart` and `cfAccounts` to `%USERPROFILE%\AccazaRestorePoints\<tag>\`, each with its sha256 in `manifest.json`. This folder is outside the repo; never commit or upload it.
- Refuses any other node, a node over 512 KB, and an empty or null snapshot (restoring a null would delete the live node).
- If the Firebase CLI answers 403 / "Failed to get details for project", it is signed in with a different Google account in that folder. Run from the main project folder.
- Notes the automated daily database backup in `gs://accaza-sartoga-default-rtdb-backups`. It is kept 30 days and is not downloaded.

## If something goes wrong (in this order)

1. **Switch off.** Set the task's feature flag back to `off`, if it has one.
2. **Code.** Revert the merge commit on `main`, for example with `gh pr revert <PR>`. Pages and Functions then redeploy the previous version. The tag marks exactly what was live.
3. **Data, one small node only:**
   ```powershell
   .\tools\restore-point\restore-node.ps1 -Manifest "$env:USERPROFILE\AccazaRestorePoints\<tag>\manifest.json" -Node config -Project accazacoffeepos-uat   # practise on UAT first
   .\tools\restore-point\restore-node.ps1 -Manifest "...\manifest.json" -Node config -Project accaza-sartoga
   ```
   The script:
   - restores only into the project the restore point came from (a production snapshot goes into UAT only with `-ToUat`; a UAT snapshot never goes into production);
   - refuses a snapshot whose sha256 changed, and never restores `documentCounters` or `pettyCashCounter` (numbers only move forward; going back would re-issue PUR / PV numbers already used);
   - saves the live node first as `pre-restore-<node>-<time>.json` in the same folder, so the restore itself can be undone;
   - lists the keys the restore would remove or add, and for `booksChart` / `cfAccounts` refuses to remove keys created since the snapshot unless you add `-AllowRemove` after checking each one;
   - asks you to type the node path back, then writes an `operationalAudit` "intent" row before the restore and a "done" row after it.

## Never

- **Never import a whole-database backup over the live database.** It erases every sale, shift, Z report and payment made since the backup.
- **Never overwrite transaction data** (orders, shifts, movements, payables, purchases, vouchers, custody). A wrong posting is corrected with a reversing or adjusting entry.
