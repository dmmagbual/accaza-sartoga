// Owner emergency sign-out (17 Sep 2026). One owner action revokes every portal account's
// refresh tokens and records a cutoff that every portal service and current build enforce,
// so forgotten or very old tabs stop downloading. Customers are untouched.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createFakeDatabase} from './helpers/fake-rtdb.mjs';
import {loadFunctions} from './helpers/functions-sandbox.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const revoked = [];
const authStub = {getAuth: () => ({revokeRefreshTokens: async (uid) => { if (uid === 'ghost_user') { const e = new Error('gone'); e.code = 'auth/user-not-found'; throw e; } revoked.push(uid); }})};
const db = createFakeDatabase({
  admins: {owner_uid1: 'owner', cashier_uid: {role: 'cashier'}, manager_uid: 'manager', ghost_user: 'staff'},
  appCustomers: {'09170000000': {name: 'Customer'}},
});
const {exports: fx} = loadFunctions(db, {libOverrides: {'firebase-admin/auth': authStub}});
const nowSec = Math.floor(Date.now() / 1000);
const req = (uid, authTime, data = {}) => ({auth: {uid, token: {email: `${uid}@example.test`, auth_time: authTime}}, data});

// Only the owner may do it, and only with a reason.
await assert.rejects(fx.signOutAllPortalSessions(req('manager_uid', nowSec, {reason: 'lost tablet'})), (e) => e.code === 'permission-denied');
await assert.rejects(fx.signOutAllPortalSessions(req('owner_uid1', nowSec, {reason: 'x'})), (e) => e.code === 'invalid-argument');

// Services still accept a session before any cutoff exists.
await fx.getOperationalExceptions(req('owner_uid1', nowSec - 7200, {cached: true}));

const result = await fx.signOutAllPortalSessions(req('owner_uid1', nowSec - 3600, {reason: 'Download spike from old tabs'}));
assert.deepEqual(revoked.sort(), ['cashier_uid', 'manager_uid', 'owner_uid1'], 'every portal account is revoked, including the owner');
assert.equal(result.accounts, 4); assert.equal(result.revoked, 3); assert.equal(result.failed, 0, 'an account already deleted is not a failure');
const cutoff = (await db.ref('/sessionControl/cutoff').get()).val();
assert.equal(cutoff.reason, 'Download spike from old tabs'); assert.equal(cutoff.by, 'owner_uid1'); assert.equal(cutoff.at % 1000, 0, 'the cutoff is whole seconds, like token times');
const audit = Object.entries((await db.ref('/operationalAudit').get()).val() || {}).find(([k]) => k.endsWith('_sign_out_all_sessions'));
assert.ok(audit, 'the action is audited');
assert.ok((await db.ref('/appCustomers/09170000000').get()).exists(), 'customer records are untouched');

// Sessions from before the cutoff are refused by every portal service; new sign-ins work.
await assert.rejects(fx.getOperationalExceptions(req('owner_uid1', nowSec - 3600, {cached: true})), (e) => e.code === 'unauthenticated');
await assert.rejects(fx.reportPosDeviceHealth(req('cashier_uid', nowSec - 60, {shiftId: 'SH1', deviceId: 'pos_abc'})), (e) => e.code === 'unauthenticated');
await fx.getOperationalExceptions(req('owner_uid1', cutoff.at / 1000 + 5, {cached: true}));
// A repeat within five minutes is refused.
await assert.rejects(fx.signOutAllPortalSessions(req('owner_uid1', cutoff.at / 1000 + 5, {reason: 'Again straight away'})), (e) => e.code === 'resource-exhausted');

// Rules and clients.
const rules = read('database.rules.json');
assert.ok(/"sessionControl": \{ "\.read": "auth != null && root\.child\('admins'\)\.child\(auth\.uid\)\.exists\(\)", "\.write": false \}/.test(rules), 'portal users can read the cutoff; nobody writes it from a browser');
const portalAuth = read('assets/js/admin/portal-auth.mjs');
assert.ok(portalAuth.includes("subscriptionHub.subscribe('sessionControl'") && portalAuth.includes('getIdTokenResult'), 'Admin/POS signs out a session older than the cutoff');
// A cashier ringing up a sale (assets/js/admin/pos.js keeps the cart only in memory) gets a
// short, capped grace window before the device signs out, instead of a blanket exemption for
// any account with an open shift — which would leave a compromised cashier session untouched
// for the rest of their shift and defeat the emergency button.
assert.ok(portalAuth.includes('window.__pos&&window.__pos.hasItems&&window.__pos.hasItems()'), 'the grace check is tied to an actual unsaved cart, not shift or role status');
assert.ok(/CUTOFF_CART_GRACE_MS=90000/.test(portalAuth), 'the cart grace window is capped so the sign-out still completes');
assert.ok(!/authz\.role|shift.*status|posActiveShift/i.test(portalAuth.slice(portalAuth.indexOf('watchSessionCutoff'))), 'the grace window is not gated on role or shift status');
assert.ok(read('assets/js/books/live-pos.mjs').includes('ref(db,"/sessionControl/cutoff")'), 'Finance Books signs out a session older than the cutoff');
const ops = read('assets/js/admin/operations-dashboard.js');
assert.ok(ops.includes("['owner','superadmin'].indexOf(authz.role)>-1") && ops.includes('signOutAllPortalSessions({reason:reason})'), 'only the owner sees the emergency button');
assert.ok(read('assets/js/admin/firebase-client.mjs').includes("callableNames.unshift('signOutAllPortalSessions')"));
console.log('PASS: owner-only emergency sign-out revokes every portal account, records an audited cutoff, and every portal service and current tab enforces it.');
