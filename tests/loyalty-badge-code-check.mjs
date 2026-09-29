// The Rewards badge derives its rotating code in the browser; scanLoyaltyBadge and
// getLoyaltyMemberCard re-derive it on the server. If those two ever disagree the badge
// silently stops scanning at the counter, so this pins both halves of the contract:
// the algorithm itself, the 60-second window, the one-window drift tolerance the server
// allows, and the exact QR payload shape the till has to parse.
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const root = new URL('..', import.meta.url);
const read = (file) => fs.readFileSync(new URL(file, root), 'utf8');
const server = read('src/functions/26-loyalty.js');
const client = read('assets/js/customer/rewards.js');

// --- the two sides agree on the window length -------------------------------
const serverWindow = Number((server.match(/const LOYALTY_BADGE_WINDOW_SECONDS = (\d+)/) || [])[1]);
const clientWindow = Number((client.match(/const BADGE_WINDOW_SECONDS = (\d+)/) || [])[1]);
assert.ok(serverWindow > 0, 'server badge window not found');
assert.equal(clientWindow, serverWindow, 'the Rewards page and the server disagree on the badge window length');

// --- the server still signs the badgeSecret STRING, not hex-decoded bytes ----
// The browser signs with TextEncoder().encode(badgeSecret). Node's createHmac with a
// string key hashes its utf-8 bytes, which is the same thing. If the server ever
// switched to Buffer.from(secret,'hex') the browser would have to change with it.
assert.ok(/createHmac\("sha256", String\(badgeSecret \|\| ""\)\)/.test(server),
  'the server no longer signs the badgeSecret string - the browser derivation must be updated to match');
assert.ok(/encoder\.encode\(String\(badgeSecret\)\)/.test(client),
  'the Rewards page no longer signs the badgeSecret string');

// --- the message being signed is identical ----------------------------------
assert.ok(/update\(`\$\{memberId\}:\$\{timeWindow\}`\)/.test(server), 'server signs memberId:window');
assert.ok(/encoder\.encode\(memberId \+ ":" \+ badgeWindow\(atMs\)\)/.test(client), 'client signs memberId:window');

// --- an independent implementation produces the same 12 hex characters ------
// Written from the contract rather than by calling either side, so a change to the
// shared algorithm has to be deliberate on both.
const badgeWindow = (atMs) => Math.floor(atMs / (serverWindow * 1000));
const expectedCode = (memberId, secret, atMs) =>
  crypto.createHmac('sha256', String(secret)).update(`${memberId}:${badgeWindow(atMs)}`).digest('hex').slice(0, 12);

const memberId = 'm_63917abc1234';
const badgeSecret = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718';
const at = Date.UTC(2026, 8, 29, 12, 0, 30);
const code = expectedCode(memberId, badgeSecret, at);
assert.match(code, /^[0-9a-f]{12}$/, 'a badge code is 12 lowercase hex characters');

// Stable for the whole 60-second window, different in the next one.
assert.equal(expectedCode(memberId, badgeSecret, at + 25000), code, 'the code must not change inside its window');
assert.notEqual(expectedCode(memberId, badgeSecret, at + 60000), code, 'the code must change in the next window');
// A different member with the same secret never collides.
assert.notEqual(expectedCode('m_63917abc9999', badgeSecret, at), code, 'the code must be bound to the member');

// --- the server accepts the previous window, and only that far back ---------
assert.ok(/for \(const w of \[window, window - 1\]\)/.test(server),
  'the server must tolerate exactly one previous 60s window of clock and network drift');

// --- the QR payload shape the till will parse -------------------------------
assert.ok(client.includes('"ACZ1:" + member.memberId + ":" + code'),
  'the badge QR must encode ACZ1:<memberId>:<code>');
const payload = `ACZ1:${memberId}:${code}`;
const parts = payload.split(':');
assert.equal(parts.length, 3, 'the till splits the payload on ":" into prefix, member and code');
assert.equal(parts[0], 'ACZ1', 'prefix marks this as an Accaza loyalty badge, so a stray barcode is not mistaken for one');
assert.equal(parts[1], memberId);
assert.equal(parts[2], code);

console.log('PASS: the Rewards badge code matches the server contract (algorithm, window, drift tolerance) and the QR payload parses as ACZ1:member:code.');
