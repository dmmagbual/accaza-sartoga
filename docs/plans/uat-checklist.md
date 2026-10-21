# Accaza UAT checklist (gate R3)

UAT is the separate Firebase project `accazacoffeepos-uat`, holding **synthetic data only**. It is used to test changes to how purchases, payments and the books post, against the real Cloud Functions, before they reach production. See the Purchases & Payments Consolidation Plan §5A (R3) and Task 0.3.

## Environment

| Item | Value |
|---|---|
| Admin | https://accazacoffeepos-uat.web.app/admin.html |
| Finance Books | https://accazacoffeepos-uat.web.app/books.html |
| Database | `accazacoffeepos-uat-default-rtdb` (asia-southeast1) |
| Test login | `uat-owner@accazacoffee.com` (Super Admin). The password is in `%USERPROFILE%\accaza-uat-owner-login.txt` on Danilo's PC. To set a new one: `node tools/uat/seed-uat.mjs --reset-password` |
| Cost guard | Budget "Accaza UAT monthly cap alert": US$5/month, emails at 50/90/100% |

**Safety:**
- Every UAT page shows a red **UAT TEST ENVIRONMENT** banner, and its tab title starts with `[UAT]`.
- The live site, the till and localhost always use production; `tests/firebase-env-check.mjs` enforces this.
- The scheduled functions (nightly backup, prune, health, archive sweep, auto-complete, handover resolver) are **not** deployed to UAT, so UAT has no timers.
- AI and SMS secrets are the placeholder `uat-disabled`, so UAT can't call a paid provider or send a real SMS.

## Deploy and seed (from the project folder)

```powershell
powershell -ExecutionPolicy Bypass -File tools\uat\deploy-uat.ps1            # full: rules, functions (no schedules), site
powershell -ExecutionPolicy Bypass -File tools\uat\deploy-uat.ps1 -SkipFunctions   # rules + site only (fast)
powershell -ExecutionPolicy Bypass -File tools\uat\deploy-uat.ps1 -PlanOnly        # show what would deploy; deploys nothing
node tools/uat/seed-uat.mjs                                                         # sign-in, Super Admin role, Books chart access
```

## R3 flows (evidence goes in the PR: movement JSON or screenshots)

Baseline proof (Task 0.3):
- [ ] Sign in to Admin and Finance Books in UAT. Both show the UAT banner, and Books seeds its chart.
- [ ] Purchase **on account**, with a new supplier and a new stock item. Check:
  - stock and average cost on the item;
  - one open bill in Books → Payables;
  - one balanced journal (Dr 12xx / Cr 2000) carrying the PUR reference.

Required for posting-path changes (§5A R3):
- [ ] A purchase paid from **Undeposited Collection**. Needs an open shift with collected cash in UAT.
- [ ] A purchase on account, then its bill paid, then the payment reversed.
- [ ] A cash voucher: approve → post → void.
- [ ] Two Undeposited payments back to back: no lock wait, and custody = GL 1030 afterwards.
- [ ] A shift close and Z report are unaffected.
- [ ] Feature-specific flows (for example, Purchase Edit: price, quantity, item, supplier, date and payment-method corrections; a blocked edit on a paid bill; a closed month).

## Known gaps

- No open shift or cash custody is seeded yet. The Undeposited flows need one created through the till in UAT first.
- Payment-proof storage is not set up in UAT, so the customer payment-proof flows can't be tested there.
