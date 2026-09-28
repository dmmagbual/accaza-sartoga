# Production Evidence Checklist

`npm run test:release` lists three items as pending production evidence. Only Danilo (or a manager with production access) can close them, because each needs real results from the live system. Never mark an item done without the evidence below.

| Manifest field | What it proves | Procedure | Evidence to keep |
|---|---|---|---|
| `backupRestoreTest` | A nightly backup can actually be restored with correct books | `BACKUP_RESTORE_RUNBOOK.md`, Steps 1–5 | Drill date, backup file name, verified `dataSha256`, trial-balance result |
| `productionPerformanceReview` | The cashier tablet meets the speed targets | Section 2 below | Screenshot of the 7-day and 30-day timing cards, device name |
| `quarterlyPermissionReview` | Every account has only the access it needs | `OPERATIONS_RELEASE_RUNBOOK.md` → Quarterly permission review | List of accounts reviewed, roles changed or disabled, date |

## 1. Backup restore test

Follow `BACKUP_RESTORE_RUNBOOK.md` exactly. It restores into an isolated emulator or staging project and never touches production. The drill passes only if the restored ledger balances (debits = credits) and the representative inventory and financial records match.

## 2. Production performance review

1. Use the POS normally on the real cashier tablet for at least 7 trading days, so System Health has enough samples.
2. In Admin, open **🚨 Operations Center** and select **Run health check now**.
3. Read the timing cards for 7 days and 30 days and compare them with the targets:

   | Card | Target |
   |---|---:|
   | POS launch | under 3,000 ms |
   | POS screen build | under 1,500 ms |
   | Cart response | under 100 ms |
   | Sale safely stored | under 1,500 ms |
   | Online order arrival | under 1,500 ms |
   | Offline reconnect sync | under 5,000 ms |

4. System Health reports the **average and the worst observation**, not p95. Record them under those names.
5. Pass: every average is within target. If the worst observation is far above target, note the date and time; it can point to a Wi-Fi or device problem at that moment rather than a code problem.
6. If POS launch or screen build misses its target, that is the measured evidence needed before changing how the service worker caches files (deliberately held in September 2026 until this review exists).

## 3. Quarterly permission review

Follow the checklist in `OPERATIONS_RELEASE_RUNBOOK.md`. **User Accounts** in Admin shows each account's role, whether it is online, and its app build per device, which covers most of the listing step.

## 4. Closing an item

1. In `release-manifest.json` → `verification`, change the field from `pending` to `passed_YYYY-MM-DD` (the same format as `githubQualityGate`) using the date the evidence was taken.
2. Run `npm run test:release` and confirm that item has left the pending list.
3. Commit only `release-manifest.json` with a message that names the evidence. No build or cache number changes, because no application file changed.
