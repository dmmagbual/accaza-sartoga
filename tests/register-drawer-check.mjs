// Cash in Register (Books 1000) must mirror the POS drawer (28 Sep 2026, Danilo).
// Two gaps were found: tips declared in the Z report were counted in the drawer and handed over
// but never posted, and a "counting error" resolved after close put cash back into a drawer that
// no longer held it. Tips declared in the Z report belong to the business (owner rule); a recount
// after close adjusts the handed-over cash in Undeposited Collection. This check runs the real
// Functions bundle against an in-memory database.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createFakeDatabase} from './helpers/fake-rtdb.mjs';
import {loadFunctions} from './helpers/functions-sandbox.mjs';

const require = createRequire(import.meta.url);
const realWriteSafety = require('../functions/lib/write-safety.js');
const writeSafety = {...realWriteSafety, safeAtomicUpdate: (db, writes) => realWriteSafety.safeAtomicUpdate(db, structuredClone(writes))};
const RegisterDrawer = require('../functions/lib/register-drawer.js');
const BooksBridge = require('../functions/lib/books-bridge.js');

const OPEN = Date.parse('2026-09-23T07:10:00+08:00'), CLOSE = Date.parse('2026-09-23T15:37:00+08:00'), NOW = Date.parse('2026-09-28T14:00:00+08:00');
const val = async (db, path) => (await db.ref(path).get()).val();
const req = (data) => ({auth: {uid: 'mgr_uid', token: {email: 'manager@example.test'}}, data});
const reg = (m) => RegisterDrawer.registerCents(m) / 100;
const balanced = (m) => { const d = m.lines.reduce((s, l) => s + Number(l.debit || 0), 0), c = m.lines.reduce((s, l) => s + Number(l.credit || 0), 0); return Math.abs(d - c) < 0.005; };
const line = (account, debit, credit) => ({account, debit, credit});
// A closed pool-model shift: ₱1,385 cash sales + ₱75 declared tips counted, ₱1,460 handed over.
function tippedShift(extra = {}) {
  return {id: 'SH-T', status: 'closed', staff: 'alex', openAt: OPEN, closeAt: CLOSE, openingFloat: 4000, retainedFloat: 4000, tips: 75, expectedCash: 5460, countedCash: 5460, variance: 0, cashToSettle: 1460, shiftReference: 'SH-T-REF',
    zReport: {tips: 75, sales: [{id: 'POS-A', payment: 'Cash', total: 280}, {id: 'POS-B', payment: 'Cash', total: 1105}]}, ...extra};
}
const saleMovements = {
  sale_POS_A: {type: 'order_sale', sourceType: 'order', sourceId: 'POS-A', occurredAt: OPEN + 3600000, lines: [line('asset:register_cash', 280, 0), line('revenue:sales', 0, 280)]},
  sale_POS_B: {type: 'order_sale', sourceType: 'order', sourceId: 'POS-B', occurredAt: OPEN + 7200000, lines: [line('asset:register_cash', 1105, 0), line('revenue:sales', 0, 1105)]},
  'shift_custody_SH-T': {type: 'shift_cash_to_custody', sourceType: 'shift', sourceId: 'SH-T', occurredAt: CLOSE, lines: [line('asset:cash_awaiting_deposit', 1460, 0), line('asset:register_cash', 0, 1460)]},
};
const approval = (action, sourceId, amount) => ({action, sourceId, amount, approvedBy: 'mgr_uid', approvedRole: 'manager', approvedName: 'Manager', expiresAt: NOW + 600000});
function setup(data) {
  const db = createFakeDatabase({admins: {mgr_uid: 'manager'}, ...data});
  return {db, fx: loadFunctions(db, {now: NOW, libOverrides: {'./lib/write-safety': writeSafety}}).exports};
}

// 1. Books maps declared tips to Other Income, never to sales.
assert.equal(BooksBridge.mapAccount('revenue:pos_tips', 'instore', {}).code, '4990');
assert.equal(BooksBridge.mapAccount('revenue:pos_tips', 'instore', {}).unmapped, false);

// 2. Closing a shift with declared tips posts them once, at the closing time, and clears the drawer.
{
  const {db, fx} = setup({shifts: {'SH-T': tippedShift()}, financialMovements: saleMovements});
  const event = (before, after) => ({params: {shiftId: 'SH-T'}, data: {before: {val: () => before}, after: {val: () => after}}});
  await fx.onShiftCloseFinancial(event('open', 'closed'));
  const tips = await val(db, 'financialMovements/shift_tips_SH-T');
  assert.ok(tips, 'declared tips posted');
  assert.equal(tips.type, 'shift_tips_declared');
  assert.equal(tips.occurredAt, CLOSE, 'tips post at the shift closing time');
  assert.ok(balanced(tips));
  assert.deepEqual(tips.lines.map((l) => [l.account, l.debit, l.credit]), [['asset:register_cash', 75, 0], ['revenue:pos_tips', 0, 75]]);
  const all = await val(db, 'financialMovements');
  assert.equal(RegisterDrawer.shiftRegisterNet('SH-T', tippedShift(), all).net, 0, 'sales + tips - handover leaves nothing in Cash in Register');
  await fx.onShiftCloseFinancial(event('open', 'closed'));
  assert.equal(Object.keys(await val(db, 'financialMovements')).filter((k) => k.startsWith('shift_tips_')).length, 1, 'a retried trigger never posts twice');
}

// 3. A handed-over shift waits for its final Z report; no tips and no Z means no posting.
{
  const {db, fx} = setup({shifts: {'SH-T': tippedShift({status: 'handover_pending'}), 'SH-N': tippedShift({id: 'SH-N', shiftReference: 'SH-N-REF', tips: 0, zReport: {tips: 0, sales: []}})}, financialMovements: saleMovements});
  await fx.onShiftCloseFinancial({params: {shiftId: 'SH-T'}, data: {before: {val: () => 'open'}, after: {val: () => 'handover_pending'}}});
  assert.equal(await val(db, 'financialMovements/shift_tips_SH-T'), null, 'tips wait for the final Z report');
  await fx.onShiftCloseFinancial({params: {shiftId: 'SH-N'}, data: {before: {val: () => 'open'}, after: {val: () => 'closed'}}});
  assert.equal(await val(db, 'financialMovements/shift_tips_SH-N'), null, 'a shift without declared tips posts nothing');
}

// 4. Manager repair for a shift closed before tips were posted (the ₱75 on 23 Sep).
{
  const {db, fx} = setup({shifts: {'SH-T': tippedShift()}, financialMovements: saleMovements, financialApprovals: {A1: approval('repair_shift_declared_tips', 'SH-T', 75)}});
  const preview = await fx.repairShiftDeclaredTips(req({shiftId: 'SH-T', preview: true}));
  assert.equal(preview.amount, 75); assert.equal(preview.registerNet, -75); assert.equal(preview.preview, true);
  assert.equal(await val(db, 'financialMovements/shift_tips_SH-T'), null, 'preview posts nothing');
  const done = await fx.repairShiftDeclaredTips(req({shiftId: 'SH-T', approvalId: 'A1'}));
  assert.equal(done.repaired, true);
  const m = await val(db, 'financialMovements/shift_tips_SH-T');
  assert.equal(m.occurredAt, CLOSE, 'the repair is dated at the shift closing time'); assert.equal(m.approvalId, 'A1'); assert.equal(m.repair, true);
  assert.equal(RegisterDrawer.shiftRegisterNet('SH-T', tippedShift(), await val(db, 'financialMovements')).net, 0);
  const again = await fx.repairShiftDeclaredTips(req({shiftId: 'SH-T', preview: true}));
  assert.equal(again.duplicate, true, 'a second repair is a duplicate');
}
// 4b. Refused when the gap was already absorbed, when there are no tips, and for old-model shifts.
{
  const absorbed = {...saleMovements, fix: {type: 'manual_books_journal', sourceType: 'shift', sourceId: 'SH-T', occurredAt: NOW, lines: [line('asset:register_cash', 75, 0), line('coa:4990', 0, 75)]}};
  const {fx} = setup({shifts: {'SH-T': tippedShift(), 'SH-0': tippedShift({id: 'SH-0', tips: 0, zReport: {tips: 0, sales: []}}), 'SH-OLD': tippedShift({id: 'SH-OLD', closeAt: Date.parse('2026-08-30T20:00:00+08:00'), openAt: Date.parse('2026-08-30T09:00:00+08:00')})}, financialMovements: absorbed});
  await assert.rejects(fx.repairShiftDeclaredTips(req({shiftId: 'SH-T', preview: true})), /nets to 0\.00/);
  await assert.rejects(fx.repairShiftDeclaredTips(req({shiftId: 'SH-0', preview: true})), /declares no tips/);
  await assert.rejects(fx.repairShiftDeclaredTips(req({shiftId: 'SH-OLD', preview: true})), /old drawer model/);
}

// 5. Counting error after close: the recounted cash is in Undeposited Collection, not the drawer.
{
  const variance = (short) => ({type: 'shift_cash_variance_pending', sourceType: 'shift', sourceId: 'SH-C', occurredAt: CLOSE, lines: short ? [line('asset:cash_shortage_pending', 470, 0), line('asset:register_cash', 0, 470)] : [line('asset:register_cash', 100, 0), line('liability:cash_overage_pending', 0, 100)]});
  const shiftC = (v) => ({id: 'SH-C', status: 'closed', staff: 'Louize', openAt: OPEN, closeAt: CLOSE, variance: v, zReport: {sales: []}});
  const disc = (v) => ({kind: 'cash', shiftId: 'SH-C', variance: v, value: v, type: v < 0 ? 'shortage' : 'overage', status: 'open', financialStatus: 'pending_manager_reconciliation', date: '2026-09-23', closedAt: CLOSE, ts: CLOSE, staff: 'Louize'});
  // Shortage recount: +470 to Undeposited Collection with its own custody record.
  {
    const {db, fx} = setup({shifts: {'SH-C': shiftC(-470)}, discrepancies: {D1: disc(-470)}, financialMovements: {shift_variance_SH_C: variance(true)}, financialApprovals: {A1: approval('review_discrepancy', 'D1', null)}});
    await db.ref('financialMovements/shift_variance_SH-C').set(variance(true));
    await fx.reviewDiscrepancy(req({discrepancyId: 'D1', caseVersion: 2, approvalId: 'A1', note: 'Recounted', allocations: [{id: 'recount', treatment: 'counting_error', amount: 470, details: {evidence: 'Recount of handover bag', correctedCount: 4470}}]}));
    const m = await val(db, 'financialMovements/cash_difference_D1_1');
    assert.ok(m && balanced(m));
    assert.ok(m.lines.some((l) => l.account === 'asset:cash_awaiting_deposit' && Number(l.debit) === 470), 'the recounted cash is in Undeposited Collection');
    assert.equal(reg(m), 0, 'Cash in Register is untouched');
    assert.equal(m.occurredAt, CLOSE);
    const custody = await val(db, 'cashCustody/count_correction_D1_recount');
    assert.equal(custody.remaining, 470); assert.equal(custody.movementId, 'cash_difference_D1_1'); assert.equal(custody.closedAt, CLOSE);
  }
  // Overage recount: removes the overstated cash from Undeposited Collection and its custody.
  {
    const {db, fx} = setup({shifts: {'SH-C': shiftC(100)}, discrepancies: {D2: disc(100)}, cashCustody: {'SH-C': {shiftId: 'SH-C', amount: 1100, remaining: 1100, depositedAmount: 0, status: 'awaiting_deposit', closedAt: CLOSE, movementId: 'shift_custody_SH-C'}}, financialApprovals: {A2: approval('review_discrepancy', 'D2', null)}});
    await db.ref('financialMovements/shift_variance_SH-C').set(variance(false));
    await fx.reviewDiscrepancy(req({discrepancyId: 'D2', caseVersion: 2, approvalId: 'A2', note: 'Recounted', allocations: [{id: 'recount', treatment: 'counting_error', amount: 100, details: {evidence: 'Recount', correctedCount: 5000}}]}));
    const m = await val(db, 'financialMovements/cash_difference_D2_1');
    assert.ok(m.lines.some((l) => l.account === 'asset:cash_awaiting_deposit' && Number(l.credit) === 100)); assert.equal(reg(m), 0);
    const custody = await val(db, 'cashCustody/SH-C');
    assert.equal(custody.remaining, 1000); assert.equal(custody.amount, 1000); assert.equal(custody.countCorrections.D2_recount.amount, 100);
  }
  // Overage recount after the cash was already deposited is refused (nothing to remove).
  {
    const {db, fx} = setup({shifts: {'SH-C': shiftC(100)}, discrepancies: {D3: disc(100)}, cashCustody: {'SH-C': {shiftId: 'SH-C', amount: 1100, remaining: 0, depositedAmount: 1100, status: 'deposited', closedAt: CLOSE, movementId: 'shift_custody_SH-C'}}, financialApprovals: {A3: approval('review_discrepancy', 'D3', null)}});
    await db.ref('financialMovements/shift_variance_SH-C').set(variance(false));
    await assert.rejects(fx.reviewDiscrepancy(req({discrepancyId: 'D3', caseVersion: 2, approvalId: 'A3', note: 'Recounted', allocations: [{id: 'recount', treatment: 'counting_error', amount: 100, details: {evidence: 'Recount', correctedCount: 5000}}]})), /already been deposited/);
    assert.equal(await val(db, 'financialMovements/cash_difference_D3_1'), null);
  }
}

// 6. Whole-register control, reproducing 28 Sep 2026: Books 6,365 against float 4,000 + open 1,970.
{
  const movements = {
    ...saleMovements, // SH-T: -75 (tips not posted)
    louize_sale: {type: 'order_sale', sourceType: 'order', sourceId: 'POS-L', occurredAt: OPEN, lines: [line('asset:register_cash', 470, 0), line('revenue:sales', 0, 470)]},
    louize_short: {type: 'shift_cash_variance_pending', sourceType: 'shift', sourceId: 'SH-L', occurredAt: CLOSE, lines: [line('asset:cash_shortage_pending', 470, 0), line('asset:register_cash', 0, 470)]},
    louize_recount: {type: 'cash_difference_case_resolution', sourceType: 'discrepancy', sourceId: 'handover_SH-L', shiftId: 'SH-L', occurredAt: CLOSE, lines: [line('asset:register_cash', 470, 0), line('asset:cash_shortage_pending', 0, 470)]},
    float: {type: 'opening_balance', sourceType: 'register', sourceId: 'float', occurredAt: OPEN - 86400000 * 30, lines: [line('asset:register_cash', 4000, 0), line('equity:opening_balance', 0, 4000)]},
    open_sale: {type: 'order_sale', sourceType: 'order', sourceId: 'POS-O', occurredAt: NOW, lines: [line('asset:register_cash', 1970, 0), line('revenue:sales', 0, 1970)]},
  };
  const shifts = {'SH-T': tippedShift(), 'SH-L': {id: 'SH-L', status: 'closed', staff: 'Louize', closeAt: CLOSE, tips: 0, zReport: {sales: [{id: 'POS-L'}]}}};
  const orderShiftOf = (id) => ({'POS-A': 'SH-T', 'POS-B': 'SH-T', 'POS-L': 'SH-L', 'POS-O': 'SH-OPEN'})[id] || '';
  const control = RegisterDrawer.registerDrawerControl({movements, orderShiftOf, floatAmount: 4000, activeShift: {id: 'SH-OPEN', status: 'open'}, shifts});
  assert.equal(control.registerGross, 6365); assert.equal(control.openShiftNet, 1970); assert.equal(control.residual, 395);
  assert.deepEqual(control.shiftsOff.map((r) => [r.shiftId, r.net]).sort(), [['SH-L', 470], ['SH-T', -75]]);
  // After the turnover repair (470 to Undeposited Collection) and the tips repair, nothing is left.
  movements.turnover = {type: 'shift_cash_to_custody', sourceType: 'shift', sourceId: 'SH-L', occurredAt: CLOSE, lines: [line('asset:cash_awaiting_deposit', 470, 0), line('asset:register_cash', 0, 470)]};
  movements.tips = {type: 'shift_tips_declared', sourceType: 'shift', sourceId: 'SH-T', occurredAt: CLOSE, lines: [line('asset:register_cash', 75, 0), line('revenue:pos_tips', 0, 75)]};
  const after = RegisterDrawer.registerDrawerControl({movements, orderShiftOf, floatAmount: 4000, activeShift: {id: 'SH-OPEN', status: 'open'}, shifts});
  assert.equal(after.residual, 0); assert.equal(after.shiftsOff.length, 0);
  assert.equal(after.registerGross - after.floatAmount, 1970, 'Cash in Register then equals the open shift cash sales');
}

console.log('PASS: Z-declared tips post as business income at close, recounts after close adjust Undeposited Collection, and Cash in Register reconciles to float + open shift.');
