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
  onDisconnect: r => ({remove: () => { log.push(`arm ${r.path}`); return Promise.resolve(); }, cancel: () => { log.push(`cancel ${r.path}`); return Promise.resolve(); }}),
  set: (r, v) => { log.push(`set ${r.path} ${v.app} ${v.build} ${v.connectedAt}`); return Promise.resolve(); },
  remove: r => { log.push(`remove ${r.path}`); return Promise.resolve(); },
};
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const stop = startPortalPresence(fb, {uid: 'u1', app: 'admin', build: 606});
connected({val: () => false}); await tick();
assert.deepEqual(log, [], 'nothing is written while offline');
connected({val: () => true}); await tick();
connected({val: () => true}); await tick();
assert.deepEqual(log, ['arm portalPresence/u1/conn1', 'set portalPresence/u1/conn1 admin 606 SERVER_TIME', 'arm portalPresence/u1/conn1', 'set portalPresence/u1/conn1 admin 606 SERVER_TIME']);
stop(); stop();
assert.deepEqual(log.slice(4), ['unwatch', 'cancel portalPresence/u1/conn1', 'remove portalPresence/u1/conn1'], 'stop is idempotent and cleans up');
assert.equal(typeof startPortalPresence(fb, {uid: '', app: 'admin', build: 1}), 'function', 'no uid writes nothing');

// 3. Admin/POS and Finance Books start presence after sign-in and end it before every sign-out.
const auth = read('assets/js/admin/portal-auth.mjs');
assert.ok(auth.includes("watchSessionCutoff(user);beginPresence(user.uid);"), 'Admin starts presence once authorized');
assert.ok(auth.includes("endPresence();try{await signOut(auth);}catch(_o){}") && auth.includes('window.logoutAdmin=function(){\n    endPresence();'), 'Admin ends presence before signing out');
assert.ok(auth.includes("mine=control.users&&control.users[user.uid]"), 'Admin honours the per-account sign-out');
const books = read('assets/js/books/live-pos.mjs');
assert.ok(books.includes('app:"books",build:runningBuild(document,"accaza-books-build")'), 'Books reports its own build');
assert.ok(books.includes('window.__booksSignOut=()=>{ endPresence(); return signOut(auth); };') && books.includes('watchValue(ref(db,"/sessionControl/users/"+user.uid)'), 'Books ends presence and honours the per-account sign-out');

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

console.log('PASS: portal presence shows who is online with app, build and device; only the Super Admin reads it; sign out works per account.');
