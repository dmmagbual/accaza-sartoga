// Void sale-date visibility (16 Oct 2026). After PR #802 the server posts every new void on its sale
// date, but nine older voids sat on their void date and Run control audit reported "No exceptions":
// the Repair date mismatches button only appeared when an unrelated cash-ledger date mismatch existed,
// so the repair could be reached only from the browser console. This check guards:
// 1. the control audit lists every void that is not on its sale date (and nothing else), using the
//    same definition as the repair preview, so the two always name the same voids;
// 2. its resolution opens the repair, and Cash Flow always shows the Repair date mismatches button.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createFakeDatabase} from './helpers/fake-rtdb.mjs';
import {loadFunctions} from './helpers/functions-sandbox.mjs';

const NOW = Date.parse('2026-10-16T12:00:00+08:00');
const at = (date) => Date.parse(`${date}T12:00:00+08:00`);
const line = (account, debit, credit) => ({account, debit, credit});
const voidLines = (amount) => [line('revenue:sales:grabfood', amount, 0), line('asset:platform_receivable:grabfood', 0, amount)];
const order = (id, date, extra = {}) => ({id, status: 'Completed', channel: 'grabfood', total: 490, timestamp: at(date), completedAt: at(date), voided: true, voidReason: 'Duplicate', ...extra});
const db = createFakeDatabase({
  admins: {manager_uid: 'manager'},
  orders: {
    'GF-LATE': order('GF-LATE', '2026-09-22'),
    'GF-SAMEDAY': order('GF-SAMEDAY', '2026-10-06'),
    'GF-REPAIRED': order('GF-REPAIRED', '2026-09-24'),
    'GF LATE': order('GF LATE', '2026-09-22'),
  },
  archivedOrders: {'GF-ARCHIVED': {...order('GF-ARCHIVED', '2026-09-24'), status: 'Archived', prevStatus: 'Completed'}},
  financialMovements: {
    'void_GF-LATE': {type: 'order_void', sourceType: 'order', sourceId: 'GF-LATE', occurredAt: at('2026-10-06'), amount: 490, lines: voidLines(490)},
    'void_GF-ARCHIVED': {type: 'order_void', sourceType: 'order', sourceId: 'GF-ARCHIVED', occurredAt: at('2026-10-06'), amount: 350, lines: voidLines(350)},
    'void_GF-SAMEDAY': {type: 'order_void', sourceType: 'order', sourceId: 'GF-SAMEDAY', occurredAt: at('2026-10-06'), amount: 290, lines: voidLines(290)},
    'void_GF-REPAIRED': {type: 'order_void', sourceType: 'order', sourceId: 'GF-REPAIRED', occurredAt: at('2026-10-06'), amount: 280, dateRepairSupersededBy: 'void_GF-REPAIRED_redate', lines: voidLines(280)},
    'void_GF-REPAIRED_redate': {type: 'order_void', sourceType: 'order', sourceId: 'GF-REPAIRED', occurredAt: at('2026-09-24'), amount: 280, redatedFromMovementId: 'void_GF-REPAIRED', lines: voidLines(280)},
    'void_bad id':{type: 'order_void', sourceType: 'order', sourceId: 'GF LATE', occurredAt: at('2026-10-06'), amount: 50, lines: voidLines(50)},
    'void_GF-GONE': {type: 'order_void', sourceType: 'order', sourceId: 'GF-GONE', occurredAt: at('2026-10-06'), amount: 100, lines: voidLines(100)},
  },
});
const request = {auth: {uid: 'manager_uid', token: {email: 'manager@example.test'}}, data: {}};
const fx = loadFunctions(db, {now: NOW}).exports;
const audit = await fx.auditFinancialControls(request);
const flagged = audit.issues.filter((issue) => issue.kind === 'void_not_on_sale_date');

// 1. Exactly the misdated voids, live and archived. Not a void on its date, not a void already re-dated
// (or its repost), not a void whose order no longer exists, not an order ID the repair
// cannot address (the audit and the preview share one definition).
assert.deepEqual(Array.from(flagged, (issue) => issue.source).sort(), ['GF-ARCHIVED', 'GF-LATE'], 'the audit lists every void not on its sale date, and only those');
const late = flagged.find((issue) => issue.source === 'GF-LATE');
assert.equal(late.severity, 'critical', 'Admin and Finance Books net sales disagree: critical');
assert.equal(late.amount, 490);
assert.equal(late.detail, 'Void posted 2026-10-06; sale date 2026-09-22');
assert.equal(late.title, 'Void is not on its sale date');
assert.equal(late.actionTarget, 'repair_finance_dates', 'the audit row opens the repair');
assert.match(late.solution, /Repair date mismatches/);
assert.match(late.solution, /Refund dated today/, 'a locked row is routed to a Refund, never a back-dated edit');

// The audit and the repair preview use one definition, so they name the same voids.
const preview = await fx.repairFinanceDates({...request, data: {action: 'preview'}});
const previewVoids = Array.from(preview.mismatches || [], (row) => row).filter((row) => row.basis === 'void_sale_date').map((row) => String(row.orderId)).sort();
assert.deepEqual(previewVoids, ['GF-ARCHIVED', 'GF-LATE'], 'the repair preview lists the same voids the audit flags');

// 2. Books: the repair is always reachable from Cash Flow and from the audit row.
const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
for (const source of [read('src/books/app/30-statements-pages.js'), read('assets/js/books/app.js')]) {
  assert.ok(source.includes('Run control audit</button> <button class="btn" onclick="App.repairFinanceDates(this)">Repair date mismatches</button>'), 'Cash Flow always shows Repair date mismatches beside Run control audit');
  assert.ok(!source.includes("(i.kind||'')==='cash_finance_date_mismatch';})?' <button"), 'the repair button must not depend on which issue the audit happens to find');
}
for (const source of [read('src/books/app/20-cash-flow.js'), read('assets/js/books/app.js')])
  assert.ok(source.includes("if(target==='repair_finance_dates')return App.repairFinanceDates(btn);"), 'the audit row action opens the repair');

console.log('PASS: the control audit lists every void not on its sale date (same rows as the repair preview), and Repair date mismatches is always on Cash Flow.');
