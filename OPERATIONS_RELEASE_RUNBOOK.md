# Accaza Operational Release Runbook

## Every production release

### Before release

- Confirm GitHub Quality Gate is green.
- Export/verify the latest Firebase backup before rules, Functions, inventory, or financial changes.
- Record the current production build and deployment time.
- Test the candidate against Firebase Emulator or staging with sanitized data.
- Check System Health: no unexplained ACTION metric or new client-error increase.

### Deploy

- Publish coordinated frontend files together; never mix HTML, module, and service-worker versions.
- Deploy Functions and rules only when the release document says they changed.
- Do not transact on the live POS during coordinated financial/rules deployment.

### Smoke test

- Login and role access.
- In-store cash sale and receipt.
- Split tender if changed or affected.
- GrabFood/FoodPanda sale if changed or affected.
- Inventory and financial movement created exactly once.
- Customer online order if customer/backend files changed.
- Offline/reconnect sale if POS queue, service worker, or Functions changed.
- System Health receives the new build within the normal telemetry flush window.

### Rollback decision

Rollback immediately for duplicate/missing sales, incorrect prices or COGS, inventory/ledger imbalance, login failure, inaccessible POS, unsafe permission, or service-worker install loop. Cosmetic defects can follow the documented severity decision, but must not be hidden.

## Monthly backup restore test

1. Select one Firebase automatic backup or manual export.
2. Restore it only into a separate test project/database—never over production.
3. Verify representative orders, active orders, inventory balances/movements, financial movements, shifts, recipes, users/roles, and settings.
4. Run one sanitized sale and confirm inventory and finance post exactly once.
5. Record backup date, restore date, tester, result, missing nodes, and corrective action.

## Quarterly permission review

- Export/list Firebase Authentication users and `/admins` role assignments.
- Confirm every active account has the minimum required role.
- Disable departed or unused accounts.
- Test customer isolation, cashier denial of management nodes, and manager/finance boundaries.
- Review App Check monitoring before changing enforcement.

## Quarterly dependency review

- Review Node runtime and Firebase SDK/Functions support notices.
- Run the full quality gate and dependency audit on a branch/staging environment.
- Upgrade major dependencies separately from business features because breaking changes are possible.
- Record accepted risks and the next review date.
