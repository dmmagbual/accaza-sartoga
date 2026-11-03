// One reference per document, shown the same way everywhere (3 Nov 2026, Danilo). Database keys
// are never shown; discrepancies and cash custody use their shift's reference; a journal with
// no number of its own is labelled by its source document.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const ctx = {}; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(new URL('../assets/js/shared/references.js', import.meta.url), 'utf8'), ctx);
const R = ctx.AccazaRef;
assert.ok(R, 'AccazaRef is exposed to the browser');

// Keys versus business references.
for (const key of ['SH-566003-61b3d7', 'pinv_lq2x9abc', 'sale_POS-ABC123', 'shift_variance_SH-566003-61b3d7', 'petty_pv_x1', 'pos_tx_1', '-NqZb1cD2eF3gH4iJ5k', 'PENDING-pinv_1', 'disc_abc'])
  assert.equal(R.isKey(key), true, `${key} is an internal key`);
for (const ref of ['SH-ALEX-61B3D7', 'SH-LEGACY-566003', 'POS-ABC123', 'GF-1A2B3C', 'PUR-2026-0012', 'PV-202611-0003', 'JE-2026-0004', 'POS-20261101-INSTORE', 'INV 4471', 'OR#5566'])
  assert.equal(R.isKey(ref), false, `${ref} is a business reference`);
assert.equal(R.text('pinv_1'), ''); assert.equal(R.text('pinv_1', 'Purchase'), 'Purchase'); assert.equal(R.text(' PUR-2026-0001 '), 'PUR-2026-0001');

// Shifts, custody and discrepancies use the shift reference, never the key.
const shifts = {'SH-566003-61b3d7': {shiftReference: 'SH-ALEX-61B3D7'}, 'SH-111111-aaaaaa': {zReport: {shiftReference: 'SH-RYA-AAAAAA'}}};
R.provide('shift', () => shifts);
assert.equal(R.shiftById('SH-566003-61b3d7'), 'SH-ALEX-61B3D7');
assert.equal(R.shiftById('SH-111111-aaaaaa'), 'SH-RYA-AAAAAA');
assert.equal(R.shiftById('SH-999999-ffffff'), R.PENDING);
assert.equal(R.custody({shiftId: 'SH-566003-61b3d7'}), 'SH-ALEX-61B3D7');
assert.equal(R.custody({shiftId: 'opening_2026', reference: 'OB-2026'}), 'OB-2026');
assert.equal(R.discrepancy({shiftId: 'SH-566003-61b3d7'}), 'SH-ALEX-61B3D7');
assert.equal(R.discrepancy({}), R.PENDING);

// Bills, purchases, vouchers, payouts.
assert.equal(R.bill({documentNo: 'PI-2026-0001', ref: 'INV 99'}), 'PI-2026-0001 · INV 99');
assert.equal(R.bill({documentNo: 'PI-2026-0001', ref: 'pinv_1'}), 'PI-2026-0001');
assert.equal(R.bill({ref: 'PENDING-pinv_1'}), R.PENDING);
assert.equal(R.purchase({documentNo: 'PUR-2026-0012', ref: 'SI 2231'}), 'PUR-2026-0012 · SI 2231');
assert.equal(R.voucher({voucherNo: 'PV-202611-0003'}), 'PV-202611-0003');
assert.equal(R.payout({}), R.PENDING);

// Movements: own number first, then the source document, never the movement ID.
R.provide('purchase', () => ({pinv_1: {documentNo: 'PUR-2026-0012'}}));
R.provide('voucher', () => ({pv_1: {voucherNo: 'PV-202611-0003'}}));
assert.equal(R.movement({id: 'purchase_pinv_1', documentNo: 'PI-2026-0007', sourceType: 'purchaseInvoice', sourceId: 'pinv_1'}), 'PI-2026-0007');
assert.equal(R.movement({id: 'purchase_pinv_1', sourceType: 'purchaseInvoice', sourceId: 'pinv_1'}), 'PUR-2026-0012');
assert.equal(R.movement({id: 'petty_pv_1', sourceType: 'pettyVoucher', sourceId: 'pv_1'}), 'PV-202611-0003');
assert.equal(R.movement({id: 'sale_POS-ABC123', sourceType: 'order', sourceId: 'POS-ABC123'}), 'POS-ABC123');
assert.equal(R.movement({id: 'shift_variance_SH-566003-61b3d7', sourceType: 'shift', sourceId: 'SH-566003-61b3d7'}), 'SH-ALEX-61B3D7');
assert.equal(R.movement({id: 'x_1', sourceType: 'purchaseInvoice', sourceId: 'pinv_unknown'}), 'Purchase');
assert.equal(R.movement({id: 'offline', sourceType: 'order', sourceId: 'pos_tx_9'}), 'Sale');
assert.equal(R.journal({id: '2026-11-01_instore', ref: 'POS-20261101-INSTORE'}), 'POS-20261101-INSTORE');
assert.equal(R.journal({id: 'unposted_1', ref: 'pinv_1'}), 'Journal entry');

// Finance Books has no shift list: custody rows supply the shift reference; journals resolve
// through the movement they were posted from.
R.provide('custody', () => ({'SH-222222-bbbbbb': {shiftId: 'SH-222222-bbbbbb', shiftReference: 'SH-JO-BBBBBB'}}));
assert.equal(R.shiftById('SH-222222-bbbbbb'), 'SH-JO-BBBBBB');
R.provide('movement', () => ({purchase_pinv_1: {id: 'purchase_pinv_1', documentNo: 'PI-2026-0007'}}));
assert.equal(R.journal({id: 'purchase_pinv_1', ref: 'pinv_1'}), 'PI-2026-0007');
assert.equal(R.movementById('purchase_pinv_1'), 'PI-2026-0007');

// A provider that throws or is missing never breaks a page.
R.provide('payable', () => { throw new Error('not loaded'); });
assert.equal(R.forSource('payable', 'ap_1'), 'Bill');
assert.equal(R.forSource('unknownType', 'zz_1'), 'Record');

// Close-control exceptions name the source document, never the key.
assert.equal(R.exception({control: 'cash_variance', sourceId: 'SH-566003-61b3d7'}), 'SH-ALEX-61B3D7');
assert.equal(R.exception({control: 'sales_missing', sourceId: 'POS-ABC123'}), 'POS-ABC123');
assert.equal(R.exception({control: 'purchase_posting', sourceId: 'pinv_1'}), 'PUR-2026-0012');
assert.equal(R.exception({control: 'unbalanced_movement', sourceId: 'mv_unknown'}), 'Journal');
assert.equal(R.exception({control: 'supplier_advances_control', sourceId: 'supplier_advances'}), '');
assert.equal(R.exception({control: 'cash_custody', sourceId: 'undeposited'}), 'undeposited');

console.log('PASS: references show business numbers (shift, purchase, voucher, bill, journal, sale) and never database keys');
