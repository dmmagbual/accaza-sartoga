/* Register Cash Float (1005) is posted as dated events (Danilo, 19 Oct 2026).

   The defect: one standing journal (Dr 1005 / Cr 1000) carried the whole float and was re-dated
   by Books rebuilds and float triggers, so the 30 Sep Balance Sheet showed no float at all: the
   entry sat in October. The fix anchors the baseline to 26 Aug 2026 (the day the float was
   established) and posts every later change as its own dated adjustment for the difference.

   This runs the real routines from src/functions/10-books-bridge.js against an in-memory
   database whose transactions behave like the Admin SDK (first pass on a null cache). */
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
const root = path.join(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };

function fakeDb(initial) {
  const data = structuredClone(initial || {});
  const at = (p) => p.replace(/^\//, '').split('/').filter(Boolean);
  const getAt = (p) => at(p).reduce((node, key) => (node == null ? undefined : node[key]), data);
  const setAt = (p, value) => { const keys = at(p), last = keys.pop(); let node = data; for (const key of keys) node = node[key] = node[key] || {}; if (value === null || value === undefined) delete node[last]; else node[last] = structuredClone(value); };
  const tick = () => new Promise((resolve) => setImmediate(resolve));
  const snap = (value) => ({exists: () => value !== undefined && value !== null, val: () => (value === undefined ? null : structuredClone(value))});
  return {
    data,
    ref: (p = '') => ({
      get: async () => { await tick(); return snap(getAt(p)); },
      orderByKey: () => ({startAt: (low) => ({endAt: (high) => ({get: async () => { await tick(); const rows = getAt(p) || {}, out = {}; Object.keys(rows).forEach((k) => { if (k >= low && k <= high) out[k] = rows[k]; }); return snap(out); }})})}),
      update: async (fields) => { await tick(); Object.keys(fields).forEach((k) => setAt(`${p}/${k}`, fields[k])); },
      transaction: async (fn) => { await tick(); const current = getAt(p);
        let next = fn(null);
        if (next === undefined) return {committed: false, snapshot: snap(null)};
        if (current !== undefined) next = fn(structuredClone(current));
        if (next === undefined) return {committed: false, snapshot: snap(current)}; setAt(p, next); return {committed: true, snapshot: snap(next)}; },
    }),
    update: async (writes) => { await tick(); Object.keys(writes).forEach((p) => setAt(p, writes[p])); },
  };
}

const Financial = require(path.join(root, 'functions/lib/financial.js'));
const BooksBridge = require(path.join(root, 'functions/lib/books-bridge.js'));
const AccountingPeriods = require(path.join(root, 'functions/lib/accounting-periods.js'));
const financeText = (value, max) => String(value == null ? '' : value).trim().slice(0, max || 160);
const books = read('src/functions/10-books-bridge.js'), voidDate = read('src/functions/44a-void-sale-date.js');
const slice = (source, from, to) => { const a = source.indexOf(from), b = source.indexOf(to, a); check(a >= 0 && b > a, `Source block not found: ${from}`); return source.slice(a, b); };
const block = [
  slice(books, 'function firebaseSafeSourceKey(', 'function historicalSuspenseCapitalEntry('),
  slice(voidDate, 'async function accountingPeriodClosedFor(', 'function voidTaxQuarter('),
  slice(books, 'const REGISTER_FLOAT_ESTABLISHED_DATE', 'exports.syncRegisterCashFloat'),
].join('\n');
const F = new Function('Financial', 'BooksBridge', 'AccountingPeriods', 'financeText', `${block}\nreturn {postRegisterFloatTarget, reconcileRegisterFloatPosting, completeRegisterFloatPending, registerFloatAnchorDates, registerFloatControlIssues};`)(Financial, BooksBridge, AccountingPeriods, financeText);

const control = (amount) => ({amount, source: 'posSettings/fixedFloat', shiftId: ''});
const manila = (iso) => Date.parse(`${iso}+08:00`);
const balance1005 = (db, through) => Financial.money(Object.values(db.data.books.journal).filter((e) => e && e.date <= through).reduce((s, e) => s + e.lines.reduce((t, l) => t + (l.code === '1005' ? l.debit - l.credit : 0), 0), 0));
const balanced = (db) => Object.values(db.data.books.journal).every((e) => Math.abs(e.lines.reduce((s, l) => s + l.debit - l.credit, 0)) < 0.005);
const changes = (db) => Object.keys(db.data.books.journal).filter((k) => k.startsWith('register_float_change_')).sort();
const legacy = (date) => ({books: {journal: {register_float_control: {id: 'register_float_control', date, ref: 'REGISTER-FLOAT', lines: [{code: '1005', debit: 4000, credit: 0}, {code: '1000', debit: 0, credit: 4000}]}}}});

/* 1. The live case: the standing entry drifted into October. One sync re-anchors it to 26 Aug. */
let db = fakeDb(legacy('2026-10-12'));
check(balance1005(db, '2026-09-30') === 0, 'Control: before the fix the 30 Sep float must be missing, or this test proves nothing.');
let written = await F.reconcileRegisterFloatPosting(db, control(4000));
let entry = db.data.books.journal.register_float_control;
check(written === 1, `Anchoring must count as one journal write (got ${written}).`);
check(entry.date === '2026-08-26' && entry.lines[0].code === '1005' && entry.lines[0].debit === 4000, 'The baseline must be Dr 1005 4,000 dated 26 Aug 2026.');
check(balance1005(db, '2026-08-25') === 0 && balance1005(db, '2026-08-31') === 4000 && balance1005(db, '2026-09-30') === 4000, 'Aug and Sep Balance Sheets must show the 4,000 float in 1005.');
check(changes(db).length === 0, 'Re-anchoring an unchanged float must not post an adjustment.');
check(db.data.books.registerFloatState.anchored === true && db.data.books.registerFloatState.postedTotal === 4000, 'State must record the anchored baseline and posted total.');
check(Object.values(db.data.operationalAudit || {}).some((a) => a.action === 'register_float_baseline_anchored' && a.fromDate === '2026-10-12' && a.toDate === '2026-08-26'), 'The re-date must leave an audit record with the old and new dates.');

/* 2. Idempotent: another sync changes nothing. */
const snapshot = JSON.stringify(db.data.books.journal);
written = await F.reconcileRegisterFloatPosting(db, control(4000));
check(written === 0 && JSON.stringify(db.data.books.journal) === snapshot, 'A repeat sync must write nothing.');

/* 3. A later change posts only the difference, dated the day it happened; history stays put. */
await F.postRegisterFloatTarget(db, control(5000), manila('2026-10-20T10:00:00'), 'register_float_changed');
await F.postRegisterFloatTarget(db, control(3500), manila('2026-11-03T09:00:00'), 'register_float_changed');
const [c1, c2] = changes(db).map((k) => db.data.books.journal[k]);
check(c1 && c1.date === '2026-10-20' && c1.lines[0].code === '1005' && c1.lines[0].debit === 1000, 'Increase must post Dr 1005 1,000 on 20 Oct.');
check(c2 && c2.date === '2026-11-03' && c2.lines[0].code === '1000' && c2.lines[0].debit === 1500 && c2.lines[1].credit === 1500, 'Decrease must post Dr 1000 / Cr 1005 1,500 on 3 Nov.');
check(balance1005(db, '2026-09-30') === 4000 && balance1005(db, '2026-10-31') === 5000 && balance1005(db, '2026-11-30') === 3500, 'Each month-end must show the float that applied then.');
check(db.data.books.journal.register_float_control.date === '2026-08-26', 'A float change must never re-date the baseline.');
check(balanced(db), 'Every float entry must balance.');

/* 4. Concurrent triggers for the same change post it once. */
await Promise.all([F.postRegisterFloatTarget(db, control(6000), manila('2026-11-05T09:00:00'), 'register_float_changed'), F.postRegisterFloatTarget(db, control(6000), manila('2026-11-05T09:00:01'), 'register_float_synced')]);
check(changes(db).length === 3 && balance1005(db, '2026-12-31') === 6000, `Concurrent triggers must post one adjustment (got ${changes(db).length - 2}).`);

/* 5. An interrupted run (state claimed, journal not written) is completed once by the next sync. */
db.data.books.registerFloatState.pending = {seq: 4, before: 6000, after: 4000, at: manila('2026-11-06T09:00:00'), action: 'register_float_changed', source: 'posSettings/fixedFloat', shiftId: ''};
db.data.books.registerFloatState.seq = 4; db.data.books.registerFloatState.postedTotal = 4000;
await F.reconcileRegisterFloatPosting(db, control(4000));
await F.reconcileRegisterFloatPosting(db, control(4000));
check(changes(db).length === 4 && !db.data.books.registerFloatState.pending && balance1005(db, '2026-12-31') === 4000, 'A pending change must be completed exactly once.');

/* 6. A closed August blocks the re-date; changes still post; reopening lets the next sync finish it. */
db = fakeDb(Object.assign(legacy('2026-10-12'), {accountingPeriods: {'2026-08': {status: 'closed'}}}));
await F.reconcileRegisterFloatPosting(db, control(4000));
check(db.data.books.journal.register_float_control.date === '2026-10-12' && db.data.books.registerFloatState.anchorBlockedPeriod === '2026-08', 'A closed August must block the re-date and record why.');
await F.postRegisterFloatTarget(db, control(4500), manila('2026-10-21T09:00:00'), 'register_float_changed');
check(changes(db).length === 1 && balance1005(db, '2026-10-31') === 4500, 'A float change must still post while the anchor is blocked.');
db.data.accountingPeriods['2026-08'].status = 'open';
await F.reconcileRegisterFloatPosting(db, control(4500));
check(db.data.books.journal.register_float_control.date === '2026-08-26' && balance1005(db, '2026-09-30') === 4000 && balance1005(db, '2026-10-31') === 4500 && !db.data.books.registerFloatState.anchorBlockedPeriod, 'After reopening, the sync must anchor the baseline without touching later changes.');

/* 7. Review fixes (19 Oct 2026). */
const journalFloat = (db) => balance1005(db, '9999-12-31');
// 7a. A change arriving while another run's claim is unfinished is not dropped.
db = fakeDb(legacy('2026-08-26'));
await F.reconcileRegisterFloatPosting(db, control(4000));
db.data.books.registerFloatState.pending = {seq: 1, before: 4000, after: 5000, at: manila('2026-10-20T09:00:00'), action: 'register_float_changed', source: 'posSettings/fixedFloat', shiftId: ''};
db.data.books.registerFloatState.seq = 1; db.data.books.registerFloatState.postedTotal = 5000;
await F.postRegisterFloatTarget(db, control(6000), manila('2026-10-20T09:00:05'), 'register_float_changed');
check(changes(db).length === 2 && journalFloat(db) === 6000 && db.data.books.registerFloatState.postedTotal === 6000 && !db.data.books.registerFloatState.pending, 'A change blocked by an unfinished claim must complete that claim and then post its own difference.');
// 7b. Concurrent different amounts: the journal always equals the posted total.
await Promise.all([F.postRegisterFloatTarget(db, control(7000), manila('2026-10-21T09:00:00'), 'register_float_changed'), F.postRegisterFloatTarget(db, control(7500), manila('2026-10-21T09:00:00'), 'register_float_synced')]);
check(journalFloat(db) === db.data.books.registerFloatState.postedTotal && !db.data.books.registerFloatState.pending && balanced(db), `Concurrent different amounts must leave Books 1005 equal to the posted total (journal ${journalFloat(db)}, posted ${db.data.books.registerFloatState.postedTotal}).`);
// 7c. A slow run finishing an old claim never clears a newer one.
db.data.books.registerFloatState.pending = {seq: 9, before: 1, after: 2, at: 1};
await F.completeRegisterFloatPending(db, {seq: 3, before: 5000, after: 6000, at: manila('2026-10-20T09:00:05'), source: 'posSettings/fixedFloat'});
check(db.data.books.registerFloatState.pending && db.data.books.registerFloatState.pending.seq === 9, 'Completing an old claim must not clear a newer pending claim.');
// 7d. The re-date is blocked by any closed month it changes, not only August.
check(JSON.stringify(F.registerFloatAnchorDates('2026-10-12')) === JSON.stringify(['2026-08-26', '2026-09-01', '2026-10-01']), 'Anchor periods must run from 26 Aug through the entry\'s current month.');
db = fakeDb(Object.assign(legacy('2026-10-12'), {accountingPeriods: {'2026-09': {status: 'closed'}}}));
await F.reconcileRegisterFloatPosting(db, control(4000));
check(db.data.books.journal.register_float_control.date === '2026-10-12' && db.data.books.registerFloatState.anchorBlockedPeriod === '2026-09', 'A closed September must block the re-date even when August is open.');

// 7e. Exception Center: Books 1005 against the live float, and a blocked start date.
let issues = await F.registerFloatControlIssues(db, control(4000));
check(issues.length === 1 && issues[0].kind === 'register_float_anchor_blocked' && issues[0].severity === 'warning', 'A blocked start date must raise one warning while Books 1005 still equals the live float.');
issues = await F.registerFloatControlIssues(db, control(5000));
const mismatch = issues.find((issue) => issue.kind === 'register_float_books_mismatch');
check(mismatch && mismatch.severity === 'critical' && mismatch.amount === 1000, 'A live float the books have not caught up with must raise a critical mismatch for the difference.');
db.data.accountingPeriods['2026-09'].status = 'open';
await F.reconcileRegisterFloatPosting(db, control(5000));
check((await F.registerFloatControlIssues(db, control(5000))).length === 0, 'After the sync, the control must be clean.');

if (failures.length) { console.error(`register-float-dated-postings-check failed:\n- ${failures.join('\n- ')}`); process.exit(1); }
console.log('register-float-dated-postings-check passed: baseline anchored to 26 Aug 2026, changes dated, idempotent, concurrent-safe, period-locked.');
