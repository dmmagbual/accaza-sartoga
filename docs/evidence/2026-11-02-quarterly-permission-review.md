# Quarterly permission review — 2 November 2026

Evidence record for `quarterlyPermissionReview` in `release-manifest.json`.
Owner and reviewer: Danilo. Method and data: owner decisions recorded below, account inventory read
read-only from production on 2 Nov 2026.

## Scope

Runbook: `OPERATIONS_RELEASE_RUNBOOK.md` → Quarterly permission review.

- Confirm every active account has the minimum required role.
- Disable departed or unused accounts.
- Test customer isolation, cashier denial of management nodes, and manager/finance boundaries.
- Review App Check monitoring before changing enforcement.

## Sources

- `/admins` — role assignment per portal account (6 records).
- `/adminPerms` — per-account module permissions (6 profiles).
- Boundary evidence: the repository quality gate (`npm run test:ci`) passed on 2 Nov 2026, including
  `test:rules` (database and Firestore rules emulator), `test:permission-gate`, and
  `test:security-accounting-assurance`.
- Firebase Authentication user export was **not** taken. Admin and POS access is granted only by an
  `/admins` role, so an Auth login with no `/admins` entry cannot open either surface. The access
  review is therefore complete from `/admins` + `/adminPerms`. The Auth export remains optional if a
  login-level review is wanted later.

## Accounts reviewed

| Account | Role | Title | Modules | Active | Decision |
|---|---|---|---|---|---|
| Alex (`6sA7KnlAQ2gYW2NsyvJcDTVRjQL2`) | superadmin | Manager | all 24 | yes | keep superadmin — owner confirmed all three superadmins need it |
| dmmagbual (`HstyE8bcYwaVjBASmfi94YwHW7J2`) | superadmin | Systems Administrator | all 24 | yes | keep superadmin |
| Maria (`I8lkoOl8uVVe7wHIAUxeZnysXJO2`) | superadmin | Manager | all 24 | yes | keep superadmin |
| xdmmagbualx (`V5877WeQjlaCgzBrnDSK3mzRn5q1`) | cashier | Cashier | 16 | yes | keep — owner confirmed |
| Louize (`fGxiRIc6GJd5pVK3zT3kcSSbhki2`) | staff | Cashier | 16 | yes | keep — current staff, owner confirmed |
| Rya (`wx7NZBmMDEQJHxc29DnoMbb4olJ3`) | staff | Cashier | 16 | yes | keep — current staff, owner confirmed |

### Module boundaries confirmed

- superadmin (3): all 24 modules, as required for owner and systems-administration duties.
- cashier `xdmmagbualx`: denied cashflow, discrepancy, inventory, petty, purchases, stock value and
  undeposited.
- staff `Louize`, `Rya`: the same denials as the cashier account, plus recipes.

No account holds management modules without a management role, and no cashier or staff account can reach
cashflow, inventory, purchases, stock value, petty cash, discrepancies or undeposited funds.

## Owner decisions (2 Nov 2026)

1. All three superadmin accounts (Alex, dmmagbual, Maria) require superadmin. No role change.
2. `xdmmagbualx` is kept. No disable.
3. Louize and Rya remain current staff. No disable.
4. No authentication-email export is required for this review.

## Outcome

- Roles changed: **none**.
- Accounts disabled: **none**.
- Accounts reviewed: **6 of 6** active portal accounts; every active account has the minimum role it
  needs for its duties.
- App Check enforcement: **unchanged** this review. `initializeAccazaAppCheck` still runs before
  `getDatabase`/`getAuth`/`getFunctions` and `test:app-check-coverage` passes.

Recorded in `release-manifest.json` as `quarterlyPermissionReview: passed_2026-11-02`.
