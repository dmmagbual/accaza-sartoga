// Cash accounts are posted only by their own workflows (Danilo, Oct 2026).
//
// 1000 is the cash in the live register. 1001 is the cash on hand / undeposited, used after the
// shift closes: the register cash is transferred to it. 1005 is the fixed Register Cash Float.
// 1040 is the Revolving Fund (dormant: spending is centralised in 1001). Each of these has exactly
// one canonical ledger form that the register, custody and deposit workflows write, so nothing else
// may post them:
//
//   1. the Fixed Register Cash Float is a fixed imprest tied to POS Settings, so no journal may
//      post 1005 at all — it would create a ledger balance the float control journal never expected;
//   2. a cash-difference supplier refund reduces the purchase, inventory or expense account that was
//      over-charged, never a cash account, because a chart cash posting is invisible to the
//      register-drawer control and bypasses the custody workflows.
import assert from 'node:assert/strict';
import {createFakeDatabase} from './helpers/fake-rtdb.mjs';
import {loadFunctions} from './helpers/functions-sandbox.mjs';
import {createRequire} from 'node:module';

// The Functions bundle runs in a VM realm while ./lib modules load in this one, so the write-safety
// plain-object check would refuse every sandbox object. Copy each payload into this realm first.
const realWriteSafety = createRequire(import.meta.url)('../functions/lib/write-safety.js');
const writeSafety = {...realWriteSafety, safeAtomicUpdate: (db, writes) => realWriteSafety.safeAtomicUpdate(db, structuredClone(writes))};

const NOW = Date.parse('2026-10-12T10:00:00+08:00');
const approval = (sourceId) => ({action: 'review_discrepancy', sourceId, amount: null, approvedBy: 'mgr_uid', approvedRole: 'manager', approvedName: 'Manager', expiresAt: NOW + 600000});
const overage = (id) => ({kind: 'cash', shiftId: 'SH1', variance: 150, value: 150, type: 'overage', status: 'open', financialStatus: 'pending_manager_reconciliation', date: '2026-10-11', closedAt: NOW, ts: NOW, staff: 'alex'});

function setup(extra = {}) {
  const db = createFakeDatabase({
    admins: {mgr_uid: 'manager'},
    shifts: {SH1: {id: 'SH1', status: 'closed', closeAt: NOW, staff: 'alex', variance: 150}},
    discrepancies: {D1: overage('D1')},
    financialApprovals: {A1: approval('D1')},
    purchaseInvoices: {P1: {id: 'P1', supplier: 'Airuss Printing Company', date: '2026-09-14', total: 150}},
    ...extra,
  });
  return {db, fx: loadFunctions(db, {now: NOW, libOverrides: {'./lib/write-safety': writeSafety}}).exports};
}
const req = (data) => ({auth: {uid: 'mgr_uid', token: {email: 'manager@example.test'}}, data});
const refundCase = (offsetCode) => ({discrepancyId: 'D1', caseVersion: 2, approvalId: 'A1', note: 'Supplier refunded the packaging purchase; refund receipt on file', allocations: [{id: 'a1', treatment: 'supplier_refund', amount: 150, details: {purchaseId: 'P1', reference: 'RF-202610-0001', offsetCode}}]});

// 1. The fixed Register Cash Float is never posted through a journal.
{
  const {fx} = setup();
  await assert.rejects(
    () => fx.postFinancialCommand(req({action: 'manual_journal', commandId: 'mj_float_1', date: '2026-10-12', memo: 'Float top-up', ref: 'FLOAT-1', lines: [{code: '1005', debit: 100, credit: 0}, {code: '3100', debit: 0, credit: 100}]})),
    (error) => /imprest|POS Settings/.test(String(error && error.message || error)),
    'the fixed Register Cash Float must be refused in a manual journal and point to POS Settings',
  );
}

// 2. A supplier refund must not reduce a cash account, and must still work on the real account.
{
  const {db, fx} = setup();
  await assert.rejects(
    () => fx.reviewDiscrepancy(req(refundCase('1000'))),
    (error) => /Cash accounts are controlled/.test(String(error && error.message || error)),
    'a cash on hand offset must be refused: a chart cash posting is invisible to the register-drawer control',
  );
  await assert.rejects(() => fx.reviewDiscrepancy(req(refundCase('1001'))), (error) => /Cash accounts are controlled/.test(String(error && error.message || error)), 'undeposited cash on hand must be refused as a refund offset');
  await assert.rejects(() => fx.reviewDiscrepancy(req(refundCase('1040'))), (error) => /Cash accounts are controlled/.test(String(error && error.message || error)), 'the Revolving Fund must be refused as a refund offset');
  const rejected = await db.ref('financialMovements/cash_difference_D1_1').get();
  assert.equal(rejected.exists(), false, 'a refused offset must post nothing');

  const result = await fx.reviewDiscrepancy(req(refundCase('1230')));
  assert.ok(result, 'the same refund must still resolve against the account that was over-charged');
  const movement = (await db.ref('financialMovements/cash_difference_D1_1').get()).val() || {};
  const credit = (movement.lines || []).find((line) => String(line.account) === 'coa:1230');
  assert.ok(credit && Number(credit.credit) === 150, 'the refund must credit the original inventory account');
  assert.equal((movement.lines || []).some((line) => String(line.account || '').indexOf('coa:100') === 0), false, 'no cash chart code may appear in the resolution');
}

// 3. The live register is not a spending source in either screen (Danilo, Oct 2026): Cash Payments
// already excludes it explicitly, and Purchases drops every account the Finance list marks disabled.
// The server refuses it too, so a stale bundle cannot spend the drawer.
{
  const fs = await import('node:fs');
  const read = (file) => fs.readFileSync(file, 'utf8');
  const cashPayments = read('src/admin/register/40-revolving-fund.js');
  assert.match(cashPayments, /\['cash_on_hand','cash_float','register'\]\.indexOf\(x\.id\)<0/, 'Cash Payments must keep excluding the live register and the float from its funding sources');
  const payables = read('src/admin/finance/40-payables-api.js');
  assert.match(payables, /id:'cash_on_hand'[^}]*disabled:true,disabledReason:'Live register cash is not available for spending/, 'the Finance account list must mark the live register disabled with a reason, so Purchases and every other !disabled consumer drops it');
  assert.match(payables, /id:'cash_float'[^}]*disabled:true/, 'the float stays disabled');
  const purchases = read('src/admin/pos/11h-purchase-workspace.js');
  assert.match(purchases, /payAccs=accs\.filter\(function\(x\)\{return !x\.disabled;\}\)/, 'Purchases must keep building its payment accounts from the enabled accounts only');
  assert.equal(/value="cash_on_hand"/.test(read('src/admin/finance/00-bootstrap-ledger.js')), false, 'the Finance cash-source picker must not offer the live register');
  for (const [file, marker] of [['src/functions/42b-financial-command-transactions.js', 'requestedAccount === "cash_on_hand"'], ['src/functions/42d-financial-command-close.js', 'source==="cash_on_hand"'], ['src/functions/42a-financial-command-entry.js', "source==='cash_on_hand'"]]) {
    assert.match(read(file), new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${file} must refuse the live register as a spending source, not only the float`);
  }
}

console.log('PASS: the fixed Register Cash Float and every cash account stay closed to journals and refund offsets.');
