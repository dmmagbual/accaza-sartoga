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
  must(s, '!["owner", "superadmin"].includes(actor.role)', `${file}: only the owner may reverse a recorded supplier payment.`);
  must(s, 'if (!reason) throw new HttpsError("invalid-argument", "A reversal reason is required.");', `${file}: a reversal reason must be mandatory.`);
  must(s, 'This bill is already outstanding. There is no recorded payment to reverse.', `${file}: an already-open bill must be refused.`);
  must(s, 'This bill was reversed at its source transaction.', `${file}: a source-reversed bill must be redirected, not double-corrected.`);
  must(s, 'if (doc.paymentReversalMovementId) throw new HttpsError', `${file}: a bill whose payment was already reversed must be refused.`);
  must(s, 'if (original.reversedByMovementId) throw new HttpsError', `${file}: an already-reversed movement must be refused.`);
  must(s, '"payable_paid", "payable_paid_owner_capital"', `${file}: only a genuine supplier bill payment may be reversed here.`);
  must(s, 'customer_change_refund', `${file}: a customer change/refund payable must be sent to its own path.`);
  must(s, 'paid from Undeposited Collection', `${file}: a custody-funded payment must be blocked rather than half-undone.`);
  must(s, 'await assertAccountingPeriodOpen(db, date, "reversing this supplier payment");', `${file}: the reversal must respect a closed accounting month.`);
  must(s, 'writes[`payables/${docId}/status`] = "open";', `${file}: the bill must return to outstanding.`);
  must(s, 'writes[`payables/${docId}/remainingAmount`] = Financial.money(doc.amount);', `${file}: the full amount must return to the subledger.`);
  must(s, 'writes[`payables/${docId}/paidAmount`] = 0;', `${file}: the paid amount must be cleared.`);
  must(s, 'writes[`payables/${docId}/settlementMovementId`] = null;', `${file}: the stale settlement link must be cleared.`);
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
for (const file of ['assets/js/books/app.js', 'src/books/app/40-subledgers.js']) {
  const s = read(file);
  must(s, 'function settledDocs(map)', `${file}: settled bills must be listable — the open-only filter hid them completely.`);
  must(s, 'App.toggleSettled=function()', `${file}: the settled list must be toggleable.`);
  must(s, "onclick=\"App.reversePayablePayment(", `${file}: a settled bill must offer the reversal action.`);
  must(s, "reversed?'<span class=\"tiny muted\">Payment reversed</span>'", `${file}: an already-reversed payment must not offer the action again.`);
}
for (const file of ['assets/js/books/app.js', 'src/books/app/50-controlled-transactions.js']) {
  const s = read(file);
  must(s, 'App.reversePayablePayment=function(id)', `${file}: the reversal action must exist in the Books client.`);
  must(s, "if(d.paymentReversalMovementId) return alert('This payment has already been reversed.');", `${file}: the client must refuse a second reversal.`);
  must(s, "if(!d.settlementMovementId) return alert(", `${file}: the client must refuse a bill with no settlement record.`);
  must(s, "action:'reverse_payable_payment'", `${file}: the client must call the server action.`);
  must(s, "if(!reason) return alert('Enter the reason for reversing this payment.');", `${file}: the client must require a reason.`);
  must(s, 'window.__isAccountingPeriodClosed(date)', `${file}: the client must warn on a closed accounting month.`);
}

if (failures.length) { console.error('Supplier payment reversal check failed:\n- ' + failures.join('\n- ')); process.exit(1); }
console.log('PASS: a supplier payment recorded in error reverses to an outstanding bill and restored cash, once only, with a reason and an audit trail.');
