# Audit brief for Accaza

I own and run Accaza Coffee House. I am the only person who changes this code; AI assistants work on it for me. Please read this whole page before you report anything. The 3 Nov 2026 audit read a working folder that was 10 commits behind main with 42 unfinished changes, and it missed some database rules, so several findings were already fixed on main or could not happen. This page and the audit pack exist to stop that.

## What you are auditing

Audit only the zip built by `npm run audit:pack`. It is an exact copy of one commit on GitHub main. `AUDIT_START_HERE.md` at the top of the zip gives the commit, its date and the build numbers. Every finding must name that commit.

If you are given a working folder, a branch other than main, or files without `AUDIT_START_HERE.md`, stop and ask me for the pack. A working folder can hold old branches and unfinished changes that never shipped.

The code is not the same thing as production. After I merge, the website updates in about a minute and the server functions in 12 to 15 minutes. Do not say something is live, or broken in production, unless you checked production itself.

## The business

- One café in the Philippines. Money is pesos (PHP). Business dates are Manila time (UTC+8, no daylight saving).
- I am the sole operator with a small staff. Controls that assume a team (a second reviewer on every change, weekly triage, board reports) are not defects here. Where I have accepted a gap, it is recorded in `docs/evidence/2026-11-04-owner-acceptances.md`.
- The till comes first. A sale that has already happened at the counter must never be refused by the system. A fix that refuses a real sale is the wrong fix; flag the problem and let a manager review it.
- Accounting follows Xero and QuickBooks: double entry, balances come from postings, posted history is reversed, not edited.

## Where things live

- Sources are in `src/`. These files are generated from them and must not be read as the source of truth: `assets/js/admin/pos.js`, `register.js`, `register-tax.js`, `rewards.js`, `analytics.js`, `finance.js`, `assets/js/customer/core.mjs`, `assets/js/books/app.js`, `subledgers.js`, `controlled-transactions.js`, `functions/index.js`, `admin.html`, `index.html`, `assets/js/admin/pos-capacity.js` and `docs/DATA_FLOW_MAP.md`. The bundle list is in `tools/build-runtime-bundles.mjs`. You may cite a line in a generated file, but name the source file too.
- Server code: `src/functions/*.js` (bundled into `functions/index.js`) and `functions/lib/*.js`.
- Database rules: `database.rules.json` (it has comments), `firestore.rules`, `storage.rules`. Many fields are locked by `.validate` rules, including on writes that change a parent node. Read the rule before you say a browser can write something.
- Alerts: `ops/monitoring/alert-policies.json` holds the 7 critical Cloud Monitoring alerts. Each goes to me by SMS and email. Two cost alerts (database downloads, Firestore reads) send email only and are set up in the Cloud console.
- Tests: the scripts in `package.json`. `npm test` runs the main suite, `npm run test:release` the release checks, `npm run test:rules` the database rules (needs Java for the Firebase emulator). Check `tests/` before you report a gap; many rules already have a test.
- Byte-size limits in `tests/bundle-budgets.mjs` are a gauge, not a gate. Only the POS 50 KB emergency reserve stops a release.

## Decisions already made

These are my decisions. Do not report them as defects. If you think one is wrong, put it in a separate section called "Decisions I would revisit", with your reason and the cost of keeping it.

- A negative note or coin count in the till is accepted and a recount is flagged. The sale is never refused (3 Nov 2026).
- A POS sale whose lines do not add up to its charged total is flagged, never rejected (3 Nov 2026).
- Any cashier may break a bill at the till.
- Every shift close produces a Z report. If the close cannot be confirmed, the till prints a provisional Z and the server issues the final Z later.
- Tips declared in the Z report belong to the business.
- Every completed sale posts to Finance Books even before its payment is verified. A month cannot be closed while sales dated in it still wait in 1060.
- A voided sale reverses in the original sale's month while that month is open. If it is closed, the reversal is dated today.
- Rejecting a website order needs a reason: "payment not found" or "refund due". A refund due posts to 2030 Customer Change / Refund Payable and clears when the refund is paid.
- Sales with no approved cashier are reported under Maria, so cashier reports balance.
- Each document keeps one reference everywhere in the app.
- System Health scans run only when I press the button. No scheduled scans.
- Retention: website order replay keys are kept 90 days, used e-payment references 13 months.
- Accepted gaps: the restore drill has no second reviewer; there are three superadmin accounts.

## Severity

- S1: money is lost or the books are wrong with no visible sign, a real sale is refused, or customer or staff data is exposed. It can happen on a normal trading day.
- S2: the books or a report can be wrong, but the problem shows (a flag, an alert, a red row) or needs an unusual event.
- S3: a control or evidence gap with no direct money effect.
- S4: code quality, documents, style.

Give the peso impact where you can.

## Evidence for every finding

1. The commit from `AUDIT_START_HERE.md`, and the file and line.
2. How you confirmed it: ran a test, ran the code, or read it only.
3. For any claim that a browser or staff account can write something, the rule from `database.rules.json` that allows it, including the `.validate` that applies.
4. Whether a test already covers it, by name.
5. The smallest fix that respects the decisions above.
6. Code and production kept apart. Only say "live" if you checked production.

## What to send back

One table with: ID, severity, file and line, how confirmed, finding, fix. Then a short list of what you could not verify and why. Leave out anything you could not tie to a line in the pack.
