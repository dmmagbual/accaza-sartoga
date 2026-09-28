// Cash payments paid from a bank or e-wallet must also appear in that account's cash register
// (cfLedger). Six GCash payments approved before 17 Sep 2026 (PV-202609-0001/0004/0012/0013/
// 0014/0015, ₱11,888.50) posted to Finance Books without their register rows (28 Sep 2026 review).
// repairPettyVoucherFinancial now rebuilds a missing row from the posted movement, once.
import assert from 'node:assert/strict';
import {createFakeDatabase} from './helpers/fake-rtdb.mjs';
import {loadFunctions} from './helpers/functions-sandbox.mjs';

const AT = Date.parse('2026-09-01T09:30:00+08:00'), NOW = Date.parse('2026-09-28T20:00:00+08:00');
const line = (account, debit, credit) => ({account, debit, credit});
const voucher = (extra) => ({voucherNo: 'PV-202609-0001', status: 'approved', amount: 5637.5, date: '2026-09-01', transactionType: 'operating_expense', expenseCategory: 'supplies', recipient: 'Airuss Printing', fundingAccountId: 'acc_gcash', ...extra});
const db = createFakeDatabase({
  admins: {mgr_uid: 'manager'},
  pettyCashVouchers: {V1: voucher(), V2: voucher({voucherNo: 'PV-2', fundingAccountId: 'undeposited'}), V3: voucher({voucherNo: 'PV-3', status: 'rejected'})},
  financialMovements: {
    petty_V1: {type: 'petty_cash_expense', sourceType: 'pettyVoucher', sourceId: 'V1', occurredAt: AT, lines: [line('expense:supplies', 5637.5, 0), line('asset:cash_account:acc_gcash', 0, 5637.5)]},
    petty_V2: {type: 'petty_cash_expense', sourceType: 'pettyVoucher', sourceId: 'V2', occurredAt: AT, lines: [line('expense:supplies', 100, 0), line('asset:cash_awaiting_deposit', 0, 100)]},
  },
});
const fx = loadFunctions(db, {now: NOW}).exports;
const req = (voucherId) => ({auth: {uid: 'mgr_uid', token: {email: 'manager@example.test'}}, data: {voucherId}});
const val = async (path) => (await db.ref(path).get()).val();

const first = await fx.repairPettyVoucherFinancial(req('V1'));
assert.equal(first.duplicate, true, 'the Finance posting already existed and is not reposted');
assert.equal(first.cashLedgerRepaired, true, 'the missing register row is rebuilt');
const row = await val('cfLedger/fm_petty_V1');
assert.equal(row.accountId, 'acc_gcash'); assert.equal(row.dir, 'out'); assert.equal(row.amount, 5637.5);
assert.equal(row.movementId, 'petty_V1'); assert.equal(row.date, '2026-09-01', 'the row carries the posting\'s Manila business date');
assert.equal(row.ref, 'PV-202609-0001');
assert.equal(Object.keys(await val('financialMovements')).length, 2, 'no Finance movement was created');
const again = await fx.repairPettyVoucherFinancial(req('V1'));
assert.equal(again.cashLedgerRepaired, false, 'a second run adds nothing');
const pooled = await fx.repairPettyVoucherFinancial(req('V2'));
assert.equal(pooled.cashLedgerRepaired, false, 'Undeposited Collection payments have no bank register row');
assert.equal(await val('cfLedger/fm_petty_V2'), null);
console.log('PASS: bank/e-wallet cash payments missing their register row are rebuilt once from the posted movement; pooled cash payments are untouched.');
