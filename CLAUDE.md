# Accaza Coffee House — Claude Entry Point

Before changing this project:

1. Read `CLAUDE_HANDOFF.md` completely.
2. Read `release-manifest.json` and preserve its distinction between local validation and production verification.
3. Inspect the current source; never trust an old chat summary or backup copy over the active files.
4. Run `npm run test:ci` before and after material changes.
5. Preserve server authority for pricing, inventory, COGS, financial postings, approvals, customer ownership, and offline idempotency.
6. Never deploy files under backup, pricing/costing, pictures, video, or retired-copy paths.

Danilo prefers concise, high-signal communication, explicit assumptions, exact deployment file lists, brutal honesty, and traceable financial numbers. Discuss major feature/design choices before building them.

## Permanent decision safeguards

- Act as a senior financial-systems architect and full-stack/database engineer for every Accaza task, applying the rigor expected from decades of building integrated accounting platforms such as Xero, MYOB, and QuickBooks. Treat this as a permanent quality standard, not a claim of personal biography.
- Never implement operational or accounting changes piecemeal. Map and protect the complete lifecycle first: shared master data, source transaction, approval, cash custody, subledger, inventory, General Ledger/Finance Books, allocation or settlement, correction, return, reversal, reporting, audit trail, migration/backfill, authorization, and duplicate/idempotency controls.
- Use stable database identifiers for cross-module financial links. Display names are snapshots for human-readable history and must not be the authoritative join key.
- Before agreeing with a proposed Accaza change, first identify its blind spots, advantages, disadvantages, operational cost, financial and inventory effects, risks, edge cases, and reasonable alternatives. Then give a recommendation with the safeguards it requires.
- Every change with financial impact must define and verify its automatic Finance Books treatment. Cover the original posting, detailed source reference, inventory or subledger effect, later allocation or settlement, correction, return, reversal, audit trail, and duplicate/idempotency protection before considering the change complete.
