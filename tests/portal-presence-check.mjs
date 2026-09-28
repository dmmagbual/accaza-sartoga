import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = rel => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const {describeDevice, startPortalPresence, runningBuild} = await import('../assets/js/shared/portal-presence.mjs');

// 1. Device labels are short and never the raw user agent.
assert.equal(describeDevice({userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit Chrome/128 Mobile Safari/537'}), 'Chrome · Android');
assert.equal(describeDevice({userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/128 Safari/537 Edg/128'}), 'Edge · Windows');
assert.equal(describeDevice({userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Version/17 Safari/604'}), 'Safari · iOS');
assert.equal(describeDevice(null), 'Browser · Unknown');
assert.equal(runningBuild({querySelector: () => ({getAttribute: () => '606'})}, 'accaza-admin-build'), 606);

// 2. Presence lifecycle against a fake Firebase: onDisconnect is armed before the record is
// written, re-armed on every reconnect, and stop() cancels it and removes the record.
const log = [];
let connected = null;
const fb = {
  db: {},
  ref: (_db, p) => ({path: p}),
  push: r => ({path: `${r.path}/conn1`}),
  serverTimestamp: () => 'SERVER_TIME',
  onValue: (r, cb) => { assert.equal(r.path, '.info/connected'); connected = cb; return () => log.push('unwatch'); },
  onDisconnect: r => ({remove: () => { log.push(`arm ${r.path}`); return Promise.resolve(); }, set: (v) => { log.push(`arm-seen ${r.path} ${v.at} signedOut=${v.signedOut}`); return Promise.resolve(); }, cancel: () => { log.push(`cancel ${r.path}`); return Promise.resolve(); }}),
  set: (r, v) => { log.push(`set ${r.path} ${v.app} ${v.build} ${v.connectedAt || v.at}${'signedOut' in v ? ` signedOut=${v.signedOut}` : ''}`); return Promise.resolve(); },
  remove: r => { log.push(`remove ${r.path}`); return Promise.resolve(); },
};
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const stop = startPortalPresence(fb, {uid: 'u1', app: 'admin', build: 606});
connected({val: () => false}); await tick();
assert.deepEqual(log, [], 'nothing is written while offline');
connected({val: () => true}); await tick();
connected({val: () => true}); await tick();
const armed = ['arm portalPresence/u1/conn1', 'arm-seen portalLastSeen/u1 SERVER_TIME signedOut=false', 'set portalPresence/u1/conn1 admin 606 SERVER_TIME'];
assert.deepEqual(log, [...armed, ...armed], 'presence and last-seen are armed before each write');
stop({signedOut: true}); stop();
await tick(); await tick();
assert.deepEqual(log.slice(6), ['unwatch', 'set portalLastSeen/u1 admin 606 SERVER_TIME signedOut=true', 'remove portalPresence/u1/conn1', 'cancel portalPresence/u1/conn1', 'cancel portalLastSeen/u1'], 'sign-out is recorded first, then the disconnect handlers are disarmed; stop is idempotent');
assert.equal(typeof startPortalPresence(fb, {uid: '', app: 'admin', build: 1}), 'function', 'no uid writes nothing');
// A refused last-seen write must not stop presence (portalLastSeen rules may deploy after the page).
const log2 = []; let connected2 = null;
const fb2 = Object.assign({}, fb, {onValue: (_r, cb) => { connected2 = cb; return () => {}; }, onDisconnect: r => ({remove: () => Promise.resolve(), set: () => Promise.reject(new Error('PERMISSION_DENIED')), cancel: () => Promise.resolve()}), set: (r) => { log2.push(r.path); return Promise.resolve(); }});
startPortalPresence(fb2, {uid: 'u2', app: 'admin', build: 608});
connected2({val: () => true}); await tick(); await tick();
assert.deepEqual(log2, ['portalPresence/u2/conn1'], 'presence is written even when last-seen is refused');

// 3. Admin/POS and Finance Books start presence after sign-in and end it before every sign-out.
const auth = read('assets/js/admin/portal-auth.mjs');
assert.ok(auth.includes("watchSessionCutoff(user);beginPresence(user.uid);"), 'Admin starts presence once authorized');
assert.ok(auth.includes("endPresence(true);try{await signOut(auth);}catch(_o){}") && auth.includes('window.logoutAdmin=function(){\n    endPresence(true);'), 'Admin ends presence before signing out');
assert.ok(auth.includes("mine=control.users&&control.users[user.uid]"), 'Admin honours the per-account sign-out');
const books = read('assets/js/books/live-pos.mjs');
assert.ok(books.includes('app:"books",build:runningBuild(document,"accaza-books-build")'), 'Books reports its own build');
assert.ok(books.includes('window.__booksSignOut=()=>{ endPresence(true); return signOut(auth); };') && books.includes('watchValue(ref(db,"/sessionControl/users/"+user.uid)'), 'Books ends presence and honours the per-account sign-out');

// 4. Rules: each account writes only its own presence; only a Super Admin reads the list.
const rulesLine = read('database.rules.json').split('\n').find(line => line.includes('"portalPresence"'));
assert.ok(rulesLine, 'portalPresence rule missing');
const presenceRead = rulesLine.slice(rulesLine.indexOf('".read"'), rulesLine.indexOf('"$uid"'));
assert.ok(presenceRead.includes("'superadmin'") && !presenceRead.includes("'manager'") && !presenceRead.includes('adminPerms'), 'only a Super Admin may read presence');
assert.ok(rulesLine.includes('".write": "auth != null && auth.uid === $uid && root.child(\'admins\').child(auth.uid).exists()"'), 'a portal account writes only its own presence');
assert.ok(rulesLine.includes('"connectedAt": { ".validate": "newData.val() === now" }') && rulesLine.includes('"$other": { ".validate": false }'), 'presence records are validated');

// 5. Server: per-account cutoff on every callable, and a Super Admin sign-out action.
const portalAuth = read('src/functions/20-portal-auth.js');
assert.ok(portalAuth.includes('if (userCutoff && signedInAt < userCutoff) throw new HttpsError("unauthenticated"'), 'callables refuse a signed-out account');
const accounts = read('src/functions/20b-portal-accounts.js');
const signOutAction = accounts.slice(accounts.indexOf('if (action === "sign_out")'), accounts.indexOf('if (action === "normalize_legacy")'));
for (const marker of ['if (uid === actor.uid)', 'reason.length < 5', 'revokeRefreshTokens(uid)', '[`sessionControl/users/${uid}`]', 'portal_account_signed_out']) assert.ok(signOutAction.includes(marker), `sign_out is missing ${marker}`);
assert.ok(accounts.indexOf('const db = getDatabase(), actor = await requireSuperAdmin(db, request)') > -1, 'account management stays Super Admin only');

// 6. Firebase usage: presence is read only by the User Accounts screen, while it is open.
const screen = read('assets/js/admin/staff-access.js');
assert.ok(screen.includes("a.hub.subscribe('portalPresence',function(snap){state.presence=snap.val()||{};paintPresence();},{scopes:['staffaccounts']})"), 'presence attaches only on User Accounts');
assert.ok(screen.includes("fetch('/build-version.json',{cache:'no-store',credentials:'omit'})"), 'latest builds come from GitHub Pages, not Firebase');
const readers = [];
for (const dir of ['assets/js/admin', 'assets/js/books', 'assets/js/customer', 'assets/js/shared']) for (const file of fs.readdirSync(new URL(`../${dir}`, import.meta.url))) {
  if (!/\.(m?js)$/.test(file)) continue;
  if (read(path.posix.join(dir, file)).includes('portalPresence')) readers.push(`${dir}/${file}`);
}
assert.deepEqual(readers.sort(), ['assets/js/admin/staff-access.js', 'assets/js/shared/portal-presence.mjs'], 'no other screen may touch portalPresence');

// 7. Truth on the account row: Online comes from live presence or a POS on the open shift that
// reported within 12 minutes (older builds report too); shift facts come from the shift record.
assert.ok(screen.includes('var TILL_ONLINE_MS=12*60000;') && screen.includes('tillLive=!!(till&&till.lastContactAt&&Date.now()-till.lastContactAt<TILL_ONLINE_MS)'), 'a reporting till counts as online');
assert.ok(screen.includes('<small>Password entered ') && !screen.includes('Last signed in '), 'Firebase last sign-in is labelled as the last password entry');
for (const marker of ['portalLastSeen', 'tillFor(uid)', 'how: shift.accountUid === uid ? "opened" : "crew"', 'posDeviceHealth/${financeKey(shift.id, "Shift")}']) assert.ok(accounts.includes(marker), `account list is missing ${marker}`);
const seenRule = read('database.rules.json').split('\n').find(line => line.includes('"portalLastSeen"'));
assert.ok(seenRule && seenRule.includes('auth.uid === $uid') && seenRule.includes('"at": { ".validate": "newData.isNumber() && newData.val() <= now" }'), 'last seen is own-write and validated');

// 8. If the sign-out writes are refused (session already ended in another tab), the disconnect
// handlers stay armed so Firebase still clears presence when the page closes.
const log3 = []; let connected3 = null;
const fb3 = Object.assign({}, fb, {onValue: (_r, cb) => { connected3 = cb; return () => {}; }, onDisconnect: r => ({remove: () => Promise.resolve(), set: () => Promise.resolve(), cancel: () => { log3.push(`cancel ${r.path}`); return Promise.resolve(); }}), set: () => Promise.reject(new Error('PERMISSION_DENIED')), remove: () => Promise.reject(new Error('PERMISSION_DENIED'))});
const stop3 = startPortalPresence(fb3, {uid: 'u3', app: 'admin', build: 609});
connected3({val: () => true}); await tick(); stop3({signedOut: true}); await tick(); await tick();
assert.deepEqual(log3, [], 'handlers are not disarmed when the sign-out writes fail');
// 9. Three honest states: Online, Inactive (signed in, device not connected), Signed out.
assert.ok(screen.includes('>Inactive</span>') && screen.includes('>Signed out</span>') && screen.includes("'<small>Not connected since '"), 'Inactive and Signed out states are shown');
assert.ok(screen.includes('if(seen&&seen.signedOut&&Number(seen.at)>=Number(till&&till.lastContactAt||0))'), 'Signed out only when a Log out is recorded after the last activity');
assert.ok(auth.includes('window.logoutAdmin=function(){\n    endPresence(true);') && auth.includes('endPresence(false);stopPresence=startPortalPresence('), 'Admin records real sign-outs only');
assert.ok(books.includes('window.__booksSignOut=()=>{ endPresence(true); return signOut(auth); };'), 'Books records real sign-outs');
assert.ok(read('database.rules.json').includes('"signedOut": { ".validate": "newData.isBoolean()" }'), 'signedOut is validated');

console.log('PASS: portal presence shows who is online with app, build and device; only the Super Admin reads it; sign out works per account.');
