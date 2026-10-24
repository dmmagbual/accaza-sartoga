/* Supplier payment reversal — regression guard.

   The defect: a bill could be recorded as paid when no money ever moved, and nothing in the
   system could undo it. `pay_payable` had no inverse, the Books journal refuses to reverse an
   automatic posting, and the correction modal demands an OPEN payable for any line touching
   2000 — which the wrong payment had just closed. The bill was stuck settled and the cash
   account understated.

   This locks in the reverse_payable_payment action: it must restore the bill to outstanding
   and the cash account in ONE commit, refuse every unsafe case, and never post twice. */
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
const root = path.join(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const failures = [];
const must = (source, marker, message) => { if (!source.includes(marker)) failures.push(message); };
const check = (condition, message) => { if (!condition) failures.push(message); };

/* ---------- executable: the reversal arithmetic actually mirrors the payment ---------- */
const Financial = require(path.join(root, 'functions/lib/financial.js'));
const BooksBridge = require(path.join(root, 'functions/lib/books-bridge.js'));

const payment = Financial.movement('payable_paid', 'payable', 'pay_gp_666374', [
  Financial.line('liability:payable:pay_gp_666374', 9360, 0, 'AP payment'),
  Financial.line('asset:cash_account:bdo', 0, 9360, 'AP payment'),
], {occurredAt: Date.parse('2026-09-02T12:00:00+08:00')});

const reversal = Financial.reverseMovement(Object.assign({}, payment, {id: 'pay_move_1'}), 'payable_payment_reversed', 'Reverse payment');
const byAccount = Object.fromEntries(reversal.lines.map((l) => [l.account, l]));

check(BooksBridge.linesBalanced(reversal.lines), 'The payment reversal must be balanced.');
check(Financial.totals(reversal.lines).debit === 9360, 'The reversal must carry the full payment amount.');
check(byAccount['asset:cash_account:bdo'] && byAccount['asset:cash_account:bdo'].debit === 9360,
  'The reversal must DEBIT the cash account the bill was paid from, restoring the balance.');
check(byAccount['liability:payable:pay_gp_666374'] && byAccount['liability:payable:pay_gp_666374'].credit === 9360,
  'The reversal must CREDIT Accounts Payable, putting the bill back into the liability.');
check(reversal.reversesMovementId === 'pay_move_1', 'The reversal must name the payment movement it undoes.');

/* Net effect of payment + reversal on every account must be exactly zero. */
const net = {};
[payment, reversal].forEach((mv) => mv.lines.forEach((l) => { net[l.account] = Math.round(((net[l.account] || 0) + l.debit - l.credit) * 100) / 100; }));
check(Object.values(net).every((v) => v === 0), 'Payment plus reversal must leave every account exactly where it started: ' + JSON.stringify(net));

/* ---------- server guards ---------- */
for (const file of ['functions/index.js', 'src/functions/42d-financial-command-close.js']) {
  const s = read(file);
  must(s, 'action === "reverse_payable_payment"', `${file}: the reverse_payable_payment action must exist.`);
  must(s, 'const reverseId = `payable_payment_reverse_${paymentId}`', `${file}: the reversal must use a deterministic movement id so a double submit cannot post twice.`);
  must(s, 'if ((await db.ref(`/financialMovements/${reverseId}`).get()).exists()) return {movementId: reverseId, documentId: docId, duplicate: true};', `${file}: a replayed reversal must return the original posting, not a second one.`);
  must(s, 'actor.role !== "superadmin"', `${file}: only a Super Admin may reverse a recorded supplier payment.`);
  must(s, 'if (!reason) throw new HttpsError("invalid-argument", "A reversal reason is required.");', `${file}: a reversal reason must be mandatory.`);
  must(s, 'This bill was reversed at its source transaction.', `${file}: a source-reversed bill must be redirected, not double-corrected.`);
  must(s, 'settlements/${paymentId}/status', `${file}: the selected settlement must carry its own reversal status.`);
  must(s, 'if (original.reversedByMovementId) throw new HttpsError', `${file}: an already-reversed movement must be refused.`);
  must(s, '"payable_paid", "payable_paid_owner_capital"', `${file}: only a genuine supplier bill payment may be reversed here.`);
  must(s, 'customer_change_refund', `${file}: a customer change/refund payable must be sent to its own path.`);
  /* AP 0.6 (approved 12 Oct 2026) supersedes the block that used to live here: the server refused an
     Undeposited-funded reversal outright. The 0.5 custody pool claim removed the race that made that
     necessary, so the requirement is now that the exact rows are restored — never half-undone. The
     restoration itself is proven by the AP 0.6 block below; this proves the refusal is gone. */
  check(!s.includes('Reversing it must also restore the exact cash custody allocations, which this correction does not do.'),
    `${file}: the old Undeposited refusal must be replaced by the exact restoration.`);
  must(s, 'await assertAccountingPeriodOpen(db, date, "reversing this supplier payment");', `${file}: the reversal must respect a closed accounting month.`);
  must(s, 'writes[`payables/${docId}/status`] = "open";', `${file}: the bill must return to outstanding.`);
  must(s, 'currentRemaining+value', `${file}: only the selected payment amount must return to the subledger.`);
  must(s, 'Number(doc.paidAmount||0)-value', `${file}: only the selected payment amount must be removed from paid total.`);
  must(s, 'writes[`financialMovements/${paymentId}/reversedByMovementId`] = reverseId;', `${file}: the original payment must point at its reversal for the audit trail.`);
  must(s, 'operationalAuditRecord("payable_payment_reversed"', `${file}: the reversal must leave an operational audit record.`);
  must(s, 'if (financeText(original.sourceId, 160) !== docId) throw new HttpsError', `${file}: the settlement movement must be proven to belong to THIS bill before it is reversed.`);
  must(s, 'reversalOf: paymentId', `${file}: the reversal must carry reversalOf, or the ledger will not recognise it as a reversal and could offer it for reversal in turn.`);
  must(s, "category: \"AP payment reversed\"", `${file}: the cash ledger must record the money coming back.`);
}

/* The deterministic id has to reach commitFinancial, or idempotency is decorative. */
for (const file of ['functions/index.js', 'src/functions/42a-financial-command-entry.js']) {
  must(read(file), 'movementIdOverride = null', `${file}: movementIdOverride must be declared for deterministic postings.`);
}
for (const file of ['functions/index.js', 'src/functions/42d-financial-command-close.js']) {
  const s = read(file);
  must(s, 'const postingId = movementIdOverride || commandId;', `${file}: the commit must honour a deterministic posting id.`);
  must(s, 'commitFinancial(db, postingId, movement, actor, writes)', `${file}: the deterministic id must be the id actually committed.`);
}
must(read('functions/index.js'), 'cashLedgerRecord(entry, movementIdOverride || commandId, movement, actor)',
  'functions/index.js: the cash-ledger row must reference the posted movement, not the client command id.');

/* ---------- Books UI: a settled bill has to be reachable at all ---------- */
for (const file of ['assets/js/books/subledgers.js', 'src/books/app/40-subledgers.js']) {
  const s = read(file);
  must(s, 'function settledDocs(map)', `${file}: settled bills must be listable — the open-only filter hid them completely.`);
  must(s, 'App.toggleSettled=function()', `${file}: the settled list must be toggleable.`);
  must(s, "onclick=\"App.reversePayablePayment(", `${file}: a settled bill must offer the reversal action.`);
  must(s, "reversed?'<span class=\"tiny muted\">Payment reversed</span>'", `${file}: an already-reversed payment must not offer the action again.`);
}
for (const file of ['assets/js/books/controlled-transactions.js', 'src/books/app/50-controlled-transactions.js']) {
  const s = read(file);
  must(s, 'App.reversePayablePayment=function(id,paymentId)', `${file}: the reversal action must identify one payment.`);
  must(s, "payment.status==='reversed'||payment.reversalMovementId", `${file}: the client must refuse a second reversal of the selected payment.`);
  must(s, "if(!paymentId) return alert(", `${file}: the client must refuse a bill with no settlement record.`);
  must(s, "action:'reverse_payable_payment'", `${file}: the client must call the server action.`);
  must(s, "if(!reason) return alert('Enter the reason for reversing this payment.');", `${file}: the client must require a reason.`);
  must(s, 'window.__isAccountingPeriodClosed(date)', `${file}: the client must warn on a closed accounting month.`);
}

/* ---------- AP 0.6: an Undeposited-funded payment reverses by restoring its custody rows ---------- */
{
  const s = read('functions/index.js');
  must(s, 'const restoreCustody = paidFrom === "undeposited";', 'the reversal must handle Undeposited-funded payments instead of refusing them.');
  must(s, 'await claimCustodyPool(db, commandId, apClaimSets);', 'the custody restoration must run under the 0.5 pool claim, so a concurrent cash-out cannot read a half-restored pool.');
  must(s, 'This Undeposited-funded payment does not record which cash custody rows it consumed', 'a payment with no recorded allocations must be refused, never partially restored.');
  must(s, 'this payment consumed no longer exists', 'a missing custody row must refuse rather than restore a guess.');
  must(s, 'does not show this payment', 'a row that never recorded the consumption must refuse rather than invent a balance.');
  must(s, 'writes[`cashCustody/${id}/remaining`] = remaining;', 'the consumed custody balance must be restored.');
  must(s, 'writes[`cashCustody/${id}/paidOutAmount`] = paidOut;', 'the paid-out total must be reduced by the restored amount.');
  must(s, 'writes[`cashCustody/${id}/status`] = "awaiting_deposit";', 'a restored row goes back to awaiting deposit.');
  must(s, 'writes[`cashCustodyOpenIndex/${id}`] = remaining > 0 ? cashCustodyProjection(', 'a row the deposit path removed must be listed again, or the restored cash stays invisible to the pool.');
  must(s, 'writes[`cashCustody/${id}/lastPaymentReversalMovementId`] = reverseId;', 'the restoration must link the reversal movement for the audit trail.');
  must(s, 'paidFrom !== "undeposited") addCash(', 'an Undeposited-funded reversal must not also write a bank register row.');
  /* The block below is the close-side half of AP 0.6: a reversal restores custody in place on a row
     that already existed at the cutoff, so the close must take that restoration back out. Without it
     a close whose cutoff falls between the payment and the reversal compares a post-reversal custody
     balance against a pre-reversal GL balance and raises a false cash_custody exception. */
  must(s, 'custodyRestoredAllocations: restoredAllocations', 'the reversal must record the allocations it restored, or the close cannot reconstruct the cutoff.');
  must(read('functions/lib/financial-close.js'), 'futureRestored[row.id]', 'the close reconstruction must subtract restorations that happened after the cutoff.');
  must(read('src/functions/42a-financial-command-entry.js'), 'custodyRestoredAllocations:restoredAllocations', 'the multi-bill reversal had the same hole and must record its restorations too.');
  check(!s.includes('Reversing it must also restore the exact cash custody allocations, which this correction does not do.'),
    'the old refusal must be gone: the correction now restores the allocations it named.');
}

if (failures.length) { console.error('Supplier payment reversal check failed:\n- ' + failures.join('\n- ')); process.exit(1); }
console.log('PASS: a supplier payment recorded in error reverses to an outstanding bill and restored cash, once only, with a reason and an audit trail.');
