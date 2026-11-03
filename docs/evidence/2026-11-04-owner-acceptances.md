# Owner acceptances — 4 November 2026

Evidence record for control gaps the owner accepts rather than closes. Owner and decision maker:
Danilo (4 Nov 2026), following the 3 Nov 2026 audit review (`R-07`, permission review).

Accaza has one operator. Controls that need a second, independent person cannot be met without
hiring one, so these are recorded as accepted risks with their mitigations, not as passed controls.

## 1. Restore drill without an independent second reviewer

- Gap: the backup restore drill is run and reviewed by the same person.
- Accepted: yes, 4 Nov 2026.
- Mitigation: the drill verifies the backup's SHA-256 and double-entry balance with
  `tools/verify-backup.mjs` and restores into an isolated emulator only (`BACKUP_RESTORE_RUNBOOK.md`).
  The evidence is the vault backup path and hash plus the logged output; the local
  `restore-drill-backup.json` is a working copy only.
- Review again: if a second operator or an external accountant is engaged.

## 2. Three superadmin accounts

- Gap: three accounts hold the superadmin role.
- Accepted: yes, 4 Nov 2026, as recorded in the 2 Nov quarterly permission review.
- Mitigation: superadmin actions on money and approvals are written to the server audit trail;
  critical production failures alert the owner by SMS and email (Cloud Monitoring).
- Review again: at the next quarterly permission review.

## Not accepted (open)

- Six moderate transitive dependency advisories in the Functions bundle (gaxios, gcp-metadata,
  google-gax, glob, minimatch, rimraf) remain after the 4 Nov 2026 `npm audit fix`; critical and high
  are cleared. Open until the Google client libraries ship non-breaking fixes or the owner decides.
