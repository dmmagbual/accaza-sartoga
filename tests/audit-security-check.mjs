// Audit security batch (4 Nov 2026):
//  SEC-03 POS PINs are set and changed only by the server and kept as salted hashes in the
//         server-only /posStaffSecrets; the browser never writes or compares a PIN.
//  SEC-04 the activity log is append-only and stamped with the signed-in login.
//  SEC-05 browser-written finance records are type/range checked and cannot be back-dated.
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

// ---------- SEC-03: server PIN commands ----------
const src = fs.readFileSync('src/functions/20a-pos-staff-identity.js', 'utf8');
class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
const ctx = {crypto, Buffer, HttpsError, Object, String, Number, Date};
vm.createContext(ctx);
vm.runInContext(src.slice(src.indexOf('function posStaffText('), src.indexOf('// Owns the identity bridge')), ctx);
function fakeDb(state) {
  const parts = (p) => String(p || '').split('/').filter(Boolean);
  const read = (path) => {let cur = state; for (const k of parts(path)) {if (cur == null) return undefined; cur = cur[k];} return cur;};
  const write = (path, value) => {const keys = parts(path); let cur = state; for (let i = 0; i < keys.length - 1; i++) cur = cur[keys[i]] || (cur[keys[i]] = {}); if (value === null) delete cur[keys.at(-1)]; else cur[keys.at(-1)] = structuredClone(value);};
  return {state, ref(path = '') {return {async get() {const v = read(path); return {val: () => structuredClone(v), exists: () => v != null};}, async update(u) {for (const [k, v] of Object.entries(u)) write(parts(path).concat(parts(k)).join('/'), v);}};}};
}
const manager = {uid: 'm1', role: 'manager'};
{
  // Existing data: one plain PIN on an unlinked profile, one hash still on a linked profile's row.
  const salt = 'aa11'; const db = fakeDb({posStaff: {
    st_plain: {name: 'Rya', role: 'cashier', pin: '1111'},
    st_rowhash: {name: 'Alex', role: 'cashier', accountUid: 'u2', pinSalt: salt, pinHash: ctx.posPinHash('2222', salt)},
  }});
  const secured = await ctx.managePosStaffPins(db, manager, 'secure_all', {});
  assert.equal(secured.secured, 2, 'both stored PINs move to the server-only store');
  for (const id of ['st_plain', 'st_rowhash']) {
    const row = db.state.posStaff[id];
    assert.deepEqual([row.pin, row.pinHash, row.pinSalt], [undefined, undefined, undefined], `${id} keeps no PIN fields on its readable row`);
  }
  assert.ok(ctx.posPinValid('1111', db.state.posStaffSecrets.st_plain), 'a plain PIN is hashed, not lost');
  assert.ok(ctx.posPinValid('2222', db.state.posStaffSecrets.st_rowhash), 'a row hash moves unchanged');
  assert.equal((await ctx.managePosStaffPins(db, manager, 'secure_all', {})).secured, 0, 'running again changes nothing');
  assert.ok(ctx.posPinValid('2222', await ctx.posStaffPinRow(db, 'st_rowhash', db.state.posStaff.st_rowhash)), 'the shift and crew checks read the secret');
  // Create: hash only; a PIN already in use is refused.
  const made = await ctx.managePosStaffPins(db, manager, 'create', {name: 'Jo', role: 'cashier', pin: '3333'});
  assert.equal(db.state.posStaff[made.staffId].pin, undefined); assert.ok(ctx.posPinValid('3333', db.state.posStaffSecrets[made.staffId]));
  // Change: the current PIN must match the stored hash.
  await assert.rejects(ctx.managePosStaffPins(db, manager, 'change_pin', {staffId: 'st_plain', currentPin: '9999', newPin: '4444'}), /Current PIN is incorrect/);
  const dup = await ctx.managePosStaffPins(db, manager, 'create', {name: 'Mo', role: 'cashier', pin: '1111'});
  assert.ok(dup.created, 'PINs need not be unique (each works only with its own login), so nothing reveals another profile\'s PIN');
  await ctx.managePosStaffPins(db, manager, 'remove', {staffId: dup.staffId});
  assert.deepEqual([db.state.posStaff[dup.staffId], db.state.posStaffSecrets[dup.staffId]], [undefined, undefined], 'removing a profile also removes its stored PIN');
  await ctx.managePosStaffPins(db, manager, 'change_pin', {staffId: 'st_plain', currentPin: '1111', newPin: '4444'});
  assert.ok(ctx.posPinValid('4444', db.state.posStaffSecrets.st_plain) && !ctx.posPinValid('1111', db.state.posStaffSecrets.st_plain), 'the new PIN replaces the old one');
  assert.equal(Object.values(db.state.operationalAudit).filter((r) => r.action === 'change_pos_staff_pin').length, 1, 'a PIN change is audited');
}
{
  const id = src.slice(src.indexOf('exports.managePosStaffIdentity'), src.indexOf('exports.openLinkedPosShift'));
  assert.ok(/managePosStaffPins\(db, actor, action, data\)/.test(id) && id.indexOf('Only a manager') < id.indexOf('managePosStaffPins('), 'PIN commands sit behind the manager check');
  assert.ok(/\[`posStaffSecrets\/\$\{staffId\}`\]/.test(id) && /posPinRowClears\(staffId\)/.test(id), 'linking stores the PIN in the secret store');
  const crew = fs.readFileSync('src/functions/25c-shift-crew.js', 'utf8');
  assert.ok(/posPinValid\(data\.pin,await posStaffPinRow\(db,staffId,row\)\)/.test(crew), 'joining a crew checks the secret');
  const staffUi = fs.readFileSync('src/admin/register/70-settings-staff.js', 'utf8');
  assert.ok(!/pin:pin,role|update\(a\.ref\(a\.db,'posStaff\/'\+id\),\{pin:|String\(s\.pin\)/.test(staffUi), 'the browser no longer writes or compares a PIN');
  assert.ok(/action:'create'/.test(staffUi) && /action:'change_pin'/.test(staffUi) && /action:'secure_all'/.test(staffUi) && /action:'remove'/.test(staffUi) && !/a\.remove\(a\.ref\(a\.db,'posStaff\//.test(staffUi), 'staff settings use the server commands');
}

// ---------- SEC-04 / SEC-05: rules shape ----------
const rules = JSON.parse(fs.readFileSync('database.rules.json', 'utf8').replace(/^\s*\/\/.*$/gm, '')).rules;
assert.equal(rules.activityLog['.write'], undefined, 'no node-wide write on the activity log');
assert.match(rules.activityLog.$logId['.write'], /!data\.exists\(\) && newData\.exists\(\)/, 'entries can only be added');
assert.match(rules.activityLog.$logId['.validate'], /newData\.child\('byUid'\)\.val\(\) === auth\.uid/, 'entries carry the signed-in login');
assert.deepEqual([rules.posStaffSecrets['.read'], rules.posStaffSecrets['.write']], [false, false]);
for (const field of ['pin', 'pinHash', 'pinSalt']) assert.equal(rules.posStaff.$staffId[field]['.validate'], false, `browsers cannot write ${field}`);
assert.equal(rules.pettyCashCounter['.write'], false); assert.equal(rules.expenses['.write'], false);
assert.match(rules.monthlyExpenses.$month.amounts.$line['.validate'], /newData\.isNumber\(\) && newData\.val\(\) >= 0/);
for (const node of ['pettyCashReplenishments', 'inventoryAdjustments']) {
  assert.equal(rules[node]['.write'], undefined, `${node}: no node-wide write (a delete would bypass create-only)`);
  assert.match(rules[node].$id['.write'], /&& !data\.exists\(\) && newData\.exists\(\)$/, `${node}: new entries only, never edited or deleted`);
  assert.match(rules[node].$id['.validate'], /newData\.child\('ts'\)\.val\(\) === now/, `${node}: stamped with the server's commit time`);
}
assert.match(rules.activityLog.$logId['.validate'], /newData\.child\('ts'\)\.val\(\) === now/);
for (const [file, pattern] of [['src/admin/pos/11d-stock-adjustments.js', /ts:\{'\.sv':'timestamp'\},clientTs:now/], ['src/admin/register/40-revolving-fund.js', /ts:\{'\.sv':'timestamp'\},clientTs:Date\.now\(\)/], ['src/admin/register/00-bootstrap-payment-controls.js', /ts:\{'\.sv':'timestamp'\},clientTs:Date\.now\(\)/]]) assert.match(fs.readFileSync(file, 'utf8'), pattern, `${file} writes the server time`);
{
  const fund = fs.readFileSync('src/admin/register/40-revolving-fund.js', 'utf8'), body = fund.slice(fund.indexOf('function addReplenishment'), fund.indexOf('function voucherReceipt'));
  assert.ok(body.indexOf("'pettyCashReplenishments/'") < body.indexOf("payOuts:po") && /\}\)\.catch\(function\(e\)\{alert\('The replenishment was NOT recorded and no drawer pay-out was posted/.test(body), 'the drawer pay-out waits for the Revolving Fund record');
}
assert.match(rules.stockReceipts.$id['.validate'], /newData\.child\('qty'\)\.val\(\) > 0/);
assert.match(rules.purchaseInvoices.$id['.validate'], /^\(\(!data\.exists\(\) && newData\.exists\(\)\) \|\|.*\) && newData\.child\('total'\)\.isNumber\(\)/, 'every purchase write checks its total');
const log = fs.readFileSync('src/admin/register/00-bootstrap-payment-controls.js', 'utf8');
assert.ok(/byUid:\(a\.currentUser&&a\.currentUser\.uid\)/.test(log), 'the POS log stamps the login');
console.log('PASS: audit security (server-only POS PINs, append-only activity log, validated finance records).');
