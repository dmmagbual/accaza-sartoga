# One-Click Amend for Purchases

Status: BUILT 2026-08-27 (awaiting local test:ci + deploy). Decisions locked: (1) one-click, owner-only, no separate approval modal; (2) block-and-guide on unsafe cases.

## What was actually built (safer than the original atomic-repost design)
Rather than a brand-new server-side atomic reverse+repost (which would re-implement the whole purchase-post path and can't be integration-tested from here), the amend REUSES the already-proven flow:
- functions/index.js: managePurchaseCorrection `reverse` now accepts `ownerAmend:true` -> if the caller is owner/superadmin it self-authorizes (skips the second manager-approval sign-in); everyone else still needs the approval token. One targeted change; no new financial-posting logic; the existing reverse guards (paid payable / not enough stock to reverse / asset depreciated) still fire -> block-and-guide comes free.
- assets/js/admin/pos.js: an "Amend" button on each active purchase row -> asks for a reason -> calls the reverse with ownerAmend, then reuses the existing correctedPurchaseDraft() to pre-fill a corrected entry for you to review and Receive (the normal, tested post path).
Net: one click to reverse-and-prepare, then review + Receive. Same proven pattern the "Reverse a purchase" menu already used, minus the ref lookup and the second sign-in.

Honest tradeoff: this is reverse-then-re-receive (two steps under one button), NOT a single atomic server call. If you Amend and then abandon without receiving the corrected draft, the purchase is left reversed (recoverable, same as today's Reverse flow). A future v2 could make it atomic server-side; deferred deliberately because it can't be integration-tested here.

Verified: node --check functions + pos.js; static-check (incl. the 19-approval-actions invariant), release-readiness, safety all PASS. Deploy: functions/index.js (Actions) + assets/js/admin/pos.js (Pages). No rules change.

## Original plan (atomic-repost design) follows for reference

## Problem
Correcting a posted purchase today = reverse -> void -> re-encode by hand (managePurchaseCorrection `reverse`, which also demands a manager-approval token). For a sole owner-encoder that is slow and error-prone. Wanted: edit a posted purchase in one step while keeping the ledger immutable and auditable.

## What "amend" actually is
A composition of machinery that already exists in functions/index.js:
- `managePurchaseCorrection` -> `reverse`: for every inventory line it posts a negative `purchase_reversal` through `applyInventoryMovement` (so WAC re-derives correctly via /inventoryAccounting), unwinds the payable/GRNI/cash/advance/owner-funded leg with deterministic movement IDs, and marks the invoice reversed. It ALREADY enforces the two chosen guards: refuses if the payable is `paid`, if remaining stock can't cover the reversal (stock already sold/consumed), or if a linked fixed asset is disposed/depreciated.
- The purchase POST path (create_payable / purchase_paid / receiving) posts positive inventory + the payable/cash leg.

So: **amend = reverse (owner self-approved) + repost the corrected invoice, as one resumable operation, linked old->new in the audit.**

## How it will work (server: new `amend` action on managePurchaseCorrection)
Input: invoiceId + corrected invoice {supplier, date, ref, payMode, accountId, lines:[{item, qty, unitCost, inventoryAccount, costAccount}]} + reason (required).
1. Gate to **owner/superadmin only** (this is the "one-click, owner-only" decision). No `claimManagerApproval` step; instead the amend self-authorizes and writes a full audit record with actor + reason.
2. Run the SAME reversal as `reverse` on the original invoice. All its guards fire here -> satisfies "block-and-guide": if it throws "payable already paid" / "not enough stock to reverse" / "asset has depreciation", the amend stops and surfaces that exact message with the next step. Nothing is half-applied because the reversal uses deterministic IDs.
3. Post the corrected purchase as a NEW invoice (fresh invoiceId + commandId) via the existing post path, so it gets its own clean movements, payable, and receiving.
4. Link them: original gets `amendedIntoId`, new gets `amendedFromId`; one `operationalAudit` record captures before/after totals, reason, actor.

## Resumability (the real design work)
The reverse and the repost are separate write phases. To make a dropped connection safe:
- Phase A (reverse) is already idempotent (deterministic IDs; re-running sees invoice.reversed=true).
- The amend carries a single client `commandId`. The new invoiceId is derived deterministically from that commandId, so a retried amend re-uses the same target invoice instead of creating a duplicate.
- On retry the action detects "original already reversed + target invoice already exists" and returns success; "reversed but target missing" -> completes the repost only. So amend is exactly-once and safe to retry.

## Finance Books treatment
- Original purchase's inventory + cost + payable/cash legs are reversed at the amend date; WAC recomputes via applyInventoryMovement; the corrected purchase posts fresh. Immutable: both the reversal and the new purchase remain in /financialMovements and /inventoryMovements. AP re-points to the corrected invoice. Full audit old->new. Idempotent via commandId. No silent edit of any posted movement.
- Unsafe cases are refused, not forced: already-paid bill (reverse the payment first), stock already sold (can't un-sell; post a forward cost adjustment instead), asset depreciated (dispose/reverse depreciation first). Each returns a plain-language next step.

## Editable fields in one amend
Supplier, invoice date, reference, due date, pay mode + source account, and every line (item, qty, unit cost, and the item's inventory/cost account mapping). Effectively re-encode the invoice correctly in place.

## Frontend (assets/js/admin/pos.js)
- Add an **Amend** button beside Edit/Adjust on each posted purchase row.
- Opens the purchase pre-filled in the existing purchase editor, all fields editable, with a required "reason for amendment" note.
- On save -> `managePurchaseCorrection({action:'amend', invoiceId, commandId, reason, invoice:{...}})`; on a guard rejection, show the returned message and the suggested next step; on success, refresh.
- Show an "amended" chip on superseded invoices and a link to the replacement.

## Guards inherited (no new risk)
Everything `reverse` already checks: paid payable, insufficient remaining stock, linked-asset depreciation, missing custody/allocation, duplicate handling. Amend adds no way around them.

## Deploy set
- functions/index.js (new `amend` action) -> Cloud Functions (Actions workflow)
- assets/js/admin/pos.js (Amend button + editor wiring) -> Pages (frontend)
- No database.rules.json change (writes go through the callable, same as reverse).
- npm run test:ci before and after; commit by filename, never git add -A.

## Build phases
1. Server `amend` action (reverse + resumable repost + owner gate + audit link). Deploy functions.
2. Frontend Amend button + prefilled editor + guard-message surfacing. Deploy Pages.
3. Verify DoD across the real cases.

## Definition of done
Edit a posted purchase (wrong account/amount/item/supplier) in one click -> original cleanly reversed, corrected purchase posted, WAC + AP + inventory all correct, audit shows old->new -> and the unsafe cases (paid / sold / depreciated) are refused with a clear next step, never silently forced.

## Open for owner
- Which roles may amend besides you? (Plan: owner + superadmin only.)
- Should an amend be blocked once the period is closed / after month-end sign-off? (Plan: allow, but flag amendments dated into a closed period.)
