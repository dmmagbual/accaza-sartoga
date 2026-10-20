// Supplier contact and tax details (Oct 2026).
//
// The supplier master held only a name, so there was nowhere to keep the contact person or the
// TIN, registered name and address a BIR purchase listing needs, and nothing stopped two records
// carrying the same TIN. These checks lock in: validation and normalisation of every field, the
// rule that a VAT-registered supplier must have a TIN, one supplier per TIN + branch (a stale
// claim from a merged or deleted record is taken over), an audit entry with before/after values,
// renames from older clients leaving the details alone, and the screen using the dropdown menu.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {createFakeDatabase} from './helpers/fake-rtdb.mjs';
import {loadFunctions} from './helpers/functions-sandbox.mjs';

const require = createRequire(import.meta.url);
const SupplierMaster = require('../functions/lib/supplier-master.js');
const realWriteSafety = require('../functions/lib/write-safety.js');
const writeSafety = {...realWriteSafety, safeAtomicUpdate: (db, writes) => realWriteSafety.safeAtomicUpdate(db, structuredClone(writes))};
const NOW = Date.parse('2026-10-20T09:00:00+08:00');

// 1. Pure normalisation.
{
  const {details, errors} = SupplierMaster.normalizeSupplierDetails({tin: '123-456-789-000', vatStatus: 'VAT', email: ' Sales@Bean.PH ', phone: '+63 917 555 0101', contactPerson: '  Ana   Cruz ', registeredName: 'Bean  Trading Inc.'});
  assert.deepEqual(errors, []);
  assert.equal(details.tin, '123456789', 'TIN keeps only its 9 digits');
  assert.equal(details.branchCode, '00000', 'a 3-digit branch typed after the TIN pads to the 5-digit BIR code');
  assert.equal(details.vatStatus, 'vat');
  assert.equal(details.email, 'sales@bean.ph');
  assert.equal(details.contactPerson, 'Ana Cruz');
  assert.equal(details.registeredName, 'Bean Trading Inc.');
  assert.equal(SupplierMaster.formatTin(details.tin, details.branchCode), '123-456-789-00000');
  assert.equal(SupplierMaster.taxIdKey(details.tin, details.branchCode), '123456789_00000');
  const pasted = SupplierMaster.normalizeSupplierDetails({tin: '123-456-789-002', branchCode: '00000'});
  assert.deepEqual(pasted.errors, [], 'a TIN pasted with its branch over the default 00000 is accepted');
  assert.equal(pasted.details.branchCode, '00002', 'and the embedded branch wins over the default');
  assert.ok(SupplierMaster.normalizeSupplierDetails({tin: '123-456-789-002', branchCode: '00005'}).errors.length, 'two different branches are refused');
  const bad = (input) => SupplierMaster.normalizeSupplierDetails(input).errors;
  assert.ok(bad({tin: '12345'}).length, 'a short TIN is refused');
  assert.ok(bad({tin: '000-000-000'}).length, 'an all-zero TIN is refused');
  assert.ok(bad({vatStatus: 'vat'}).length, 'a VAT-registered supplier without a TIN is refused');
  assert.ok(bad({vatStatus: 'exempt'}).length, 'an unknown VAT status is refused');
  assert.ok(bad({email: 'not-an-email'}).length);
  assert.ok(bad({phone: '12'}).length);
  assert.ok(bad({branchCode: '00002'}).length, 'a branch code without a TIN is refused');
  const empty = SupplierMaster.normalizeSupplierDetails({});
  assert.deepEqual(empty.errors, []);
  assert.equal(empty.details.vatStatus, 'unknown', 'everything is optional and the VAT status defaults to unknown');
  assert.equal(empty.details.branchCode, '', 'no branch code is stored without a TIN');
  assert.deepEqual(Object.keys(SupplierMaster.changedDetails({tin: '1'}, {tin: '1', phone: '0917'})), ['phone']);
}

// 2. Through manageSupplier.
function setup(extra = {}) {
  const db = createFakeDatabase({
    admins: {mgr_uid: 'manager'},
    suppliers: {
      sup_a: {name: 'Bean Trading', normalizedName: 'bean trading', active: true},
      sup_b: {name: 'Bean Trading PH', normalizedName: 'bean trading ph', active: true},
    },
    ...extra,
  });
  return {db, fx: loadFunctions(db, {now: NOW, libOverrides: {'./lib/write-safety': writeSafety}}).exports};
}
const req = (data) => ({auth: {uid: 'mgr_uid', token: {email: 'manager@example.test'}}, data});
const val = async (db, path) => (await db.ref(path).get()).val();

{
  const {db, fx} = setup();
  const saved = await fx.manageSupplier(req({action: 'update', supplierId: 'sup_a', name: 'Bean Trading', details: {tin: '123456789', vatStatus: 'vat', contactPerson: 'Ana Cruz', phone: '0917 555 0101', email: 'ana@bean.ph', address: 'Makati City'}}));
  assert.equal(saved.details.tin, '123456789');
  const row = await val(db, 'suppliers/sup_a');
  assert.equal(row.tin, '123456789');
  assert.equal(row.branchCode, '00000');
  assert.equal(row.contactPerson, 'Ana Cruz');
  assert.equal(row.registeredName, undefined, 'an empty field is not stored');
  assert.equal((await val(db, 'supplierTaxIdIndex/123456789_00000')).supplierId, 'sup_a', 'the TIN + branch is claimed by the supplier');
  const audit = Object.values(await val(db, 'operationalAudit') || {}).find((x) => x.action === 'update_supplier');
  assert.equal(audit.detailChanges.tin.before, '', 'the audit trail records the old value');
  assert.equal(audit.detailChanges.tin.after, '123456789', 'and the new value');

  // Another supplier cannot take the same TIN + branch.
  await assert.rejects(() => fx.manageSupplier(req({action: 'update', supplierId: 'sup_b', name: 'Bean Trading PH', details: {tin: '123-456-789'}})), (e) => e.code === 'already-exists' && /Bean Trading/.test(e.message) && /merge/i.test(e.message));
  assert.equal((await val(db, 'suppliers/sup_b')).tin, undefined, 'the refused save wrote nothing');
  // The same TIN with a different branch is a different registration and is allowed.
  await fx.manageSupplier(req({action: 'update', supplierId: 'sup_b', name: 'Bean Trading PH', details: {tin: '123456789', branchCode: '00001'}}));
  assert.equal((await val(db, 'suppliers/sup_b')).branchCode, '00001');

  // A rename from an older client leaves every detail alone.
  await fx.manageSupplier(req({action: 'update', supplierId: 'sup_a', name: 'Bean Trading Co'}));
  assert.equal((await val(db, 'suppliers/sup_a')).tin, '123456789', 'a name-only update keeps the TIN');

  // Changing the TIN releases the old claim.
  await fx.manageSupplier(req({action: 'update', supplierId: 'sup_a', name: 'Bean Trading Co', details: {tin: '987654321'}}));
  assert.equal(await val(db, 'supplierTaxIdIndex/123456789_00000'), null, 'the previous TIN claim is released');
  assert.equal((await val(db, 'supplierTaxIdIndex/987654321_00000')).supplierId, 'sup_a');
  // Clearing the TIN clears the stored branch and the claim.
  await fx.manageSupplier(req({action: 'update', supplierId: 'sup_a', name: 'Bean Trading Co', details: {}}));
  const cleared = await val(db, 'suppliers/sup_a');
  assert.equal(cleared.tin, undefined);
  assert.equal(cleared.branchCode, undefined);
  assert.equal(await val(db, 'supplierTaxIdIndex/987654321_00000'), null);

  // A VAT-registered supplier must have its TIN.
  await assert.rejects(() => fx.manageSupplier(req({action: 'update', supplierId: 'sup_a', name: 'Bean Trading Co', details: {vatStatus: 'vat'}})), (e) => e.code === 'invalid-argument');
}

// 3. A stale claim (holder merged away, or holder never stored that TIN) is taken over.
{
  const {db, fx} = setup({
    suppliers: {
      sup_a: {name: 'Bean Trading', normalizedName: 'bean trading', active: true},
      sup_old: {name: 'Old Beans', normalizedName: 'old beans', active: false, mergedInto: 'sup_a', tin: '111222333', branchCode: '00000'},
      sup_half: {name: 'Half Save', normalizedName: 'half save', active: true},
    },
    supplierTaxIdIndex: {'111222333_00000': {supplierId: 'sup_old', claimedAt: NOW - 1000}, '444555666_00000': {supplierId: 'sup_half', claimedAt: NOW - 600000}, '777888999_00000': {supplierId: 'sup_inflight', claimedAt: NOW - 5000}},
  });
  await fx.manageSupplier(req({action: 'update', supplierId: 'sup_a', name: 'Bean Trading', details: {tin: '111222333'}}));
  assert.equal((await val(db, 'supplierTaxIdIndex/111222333_00000')).supplierId, 'sup_a', 'a merged holder gives up the TIN');
  await fx.manageSupplier(req({action: 'update', supplierId: 'sup_a', name: 'Bean Trading', details: {tin: '444555666'}}));
  assert.equal((await val(db, 'supplierTaxIdIndex/444555666_00000')).supplierId, 'sup_a', 'a claim whose holder never stored the TIN is stale');
  // A claim whose holder has no record yet, taken seconds ago, may be a create still saving: refused as busy.
  await assert.rejects(() => fx.manageSupplier(req({action: 'update', supplierId: 'sup_a', name: 'Bean Trading', details: {tin: '777888999'}})), (e) => e.code === 'aborted');
  assert.equal((await val(db, 'supplierTaxIdIndex/777888999_00000')).supplierId, 'sup_inflight', 'an in-flight claim is not taken over');
  // A merged record cannot be edited.
  await assert.rejects(() => fx.manageSupplier(req({action: 'update', supplierId: 'sup_old', name: 'Old Beans', details: {}})), (e) => e.code === 'failed-precondition');
}

// 4. Creating a supplier with details stores them and claims the TIN.
{
  const {db, fx} = setup();
  const created = await fx.manageSupplier(req({action: 'create', name: 'Ice Plant', details: {vatStatus: 'non_vat', contactPerson: 'Mang Ben', phone: '0918 222 3333'}}));
  const row = await val(db, `suppliers/${created.supplierId}`);
  assert.equal(row.contactPerson, 'Mang Ben');
  assert.equal(row.vatStatus, 'non_vat');
  await assert.rejects(() => fx.manageSupplier(req({action: 'create', name: 'Bad Email Co', details: {email: 'x'}})), (e) => e.code === 'invalid-argument');
  assert.equal(Object.values(await val(db, 'suppliers')).some((x) => x.name === 'Bad Email Co'), false, 'a refused create writes nothing');
  assert.equal(Object.values(await val(db, 'supplierNameIndex') || {}).some((x) => x.normalizedName === 'bad email co'), false, 'a field error is refused before the name is claimed');
  // A TIN conflict on create gives the name claim back, so the name can still be used.
  await fx.manageSupplier(req({action: 'update', supplierId: 'sup_a', name: 'Bean Trading', details: {tin: '123456789'}}));
  await assert.rejects(() => fx.manageSupplier(req({action: 'create', name: 'Juan Farm', details: {tin: '123456789'}})), (e) => e.code === 'already-exists');
  assert.equal(Object.values(await val(db, 'supplierNameIndex') || {}).some((x) => x.normalizedName === 'juan farm'), false, 'the name claim is released after a TIN conflict');
  await fx.manageSupplier(req({action: 'update', supplierId: 'sup_b', name: 'Juan Farm'}));
  assert.equal((await val(db, 'suppliers/sup_b')).name, 'Juan Farm', 'the name stays usable');
}

// 5. The screen and the rules.
const rules = fs.readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8');
assert.match(rules, /"supplierTaxIdIndex":\s*\{ "\.read": false, "\.write": false \}/, 'the TIN index is server-only');
const screen = fs.readFileSync(new URL('../src/admin/pos/11i-supplier-master.js', import.meta.url), 'utf8');
const bundle = fs.readFileSync(new URL('../assets/js/admin/pos.js', import.meta.url), 'utf8');
for (const [file, text] of [['11i-supplier-master.js', screen], ['pos.js', bundle]]) {
  for (const marker of ['data-supplier-action', 'data-supplier-search', "['missing_tin','Active, missing TIN']", 'Registered business name', "action:'update',supplierId:id,name:v.name,details:details"]) {
    assert.ok(text.includes(marker), `${file}: supplier list marker missing: ${marker}`);
  }
  assert.ok(!text.includes('data-supplier-rename'), `${file}: the separate row buttons were replaced by the Actions menu`);
}
console.log('PASS: supplier details validate and normalise, a VAT-registered supplier needs its TIN, one supplier per TIN + branch (stale claims taken over, old claims released), changes are audited before/after, a rename keeps the details, and the list uses search, filters and an Actions menu.');
