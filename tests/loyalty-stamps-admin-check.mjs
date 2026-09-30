// The Rewards stamps admin card. The point of these assertions is that the screen can
// never imply a capability the server refuses, and can never quietly destroy stamps:
//  - colour comes from the server's palette, never a free colour input;
//  - there is no delete - only enable/disable, because members hold real balances;
//  - the code field is write-once (it names the {code}Balance field);
//  - a server refusal is shown as written, because it names what to turn off first.
import fs from 'node:fs';
import assert from 'node:assert/strict';

const panel = fs.readFileSync(new URL('../src/admin/register/75-loyalty-stamps.js', import.meta.url), 'utf8');
const dispatcher = fs.readFileSync(new URL('../src/admin/register/00-bootstrap-payment-controls.js', import.meta.url), 'utf8');
const client = fs.readFileSync(new URL('../assets/js/admin/firebase-client.mjs', import.meta.url), 'utf8');
const built = fs.readFileSync(new URL('../assets/js/admin/register.js', import.meta.url), 'utf8');

// --- the panel is reachable and the callable is wired ----------------------
assert.ok(/if\(name==='possettings'\)\{renderPosSettings\(\);renderLoyaltyStamps\(\);\}/.test(dispatcher),
  'the stamps card must render when POS Settings opens, after the settings panel writes its root');
assert.ok(/callableNames\.unshift\('manageLoyaltyCurrency'\)/.test(client),
  'manageLoyaltyCurrency must be registered as an admin callable, or the card cannot save');
assert.ok(built.includes('renderLoyaltyStamps'), 'the built register bundle must carry the stamps card');

// --- it appends to POS Settings rather than replacing it --------------------
assert.ok(/getElementById\('posSettingsRoot'\)/.test(panel) && /appendChild/.test(panel),
  'the card must append into POS Settings; renderPosSettings owns that root and rewrites its innerHTML');

// --- colour comes from the server palette, never a free picker -------------
assert.ok(/_loyaltyStampsState\.colors = payload\.colors/.test(panel),
  'the palette must come from the server response');
assert.ok(!/type="color"/.test(panel), 'a free colour input must never be offered - colour is one of the presets');
assert.ok(!/#(?:[0-9A-Fa-f]{6})\b/.test(panel.replace(/#ccc|#fff|#666|#777|#222|#eee|#e3e3e3|#fafafa|#fde8e8|#721c24|#e8f5e9|#1b5e20|#8a6d3b/g, '')),
  'the card must not hardcode stamp colours of its own - only neutral chrome colours are allowed');

// --- no delete path, ever ---------------------------------------------------
assert.ok(!/action: 'delete'|action:'delete'/.test(panel),
  'a stamp must never be deletable from the UI - members hold real balances in it');
assert.ok(/action: action, code: code/.test(panel) && /'enable'/.test(panel) && /'disable'/.test(panel),
  'retirement must go through enable/disable only');
assert.ok(/Members keep/.test(panel),
  'disabling must tell the operator that members keep the stamps they already hold');

// --- the code is write-once -------------------------------------------------
assert.ok(/isNew \? '' : ' disabled'/.test(panel),
  'the code field must be disabled when editing an existing stamp - renaming would strand balances');
assert.ok(/permanent/.test(panel),
  'adding a stamp must warn that the code is permanent');

// --- server refusals are surfaced verbatim ---------------------------------
assert.ok(/function loyaltyStampsMessage/.test(panel) && /error\.message/.test(panel),
  'the card must surface the server message');
const toggle = panel.slice(panel.indexOf('function loyaltyStampsToggle'));
assert.ok(/loyaltyStampsMessage\(error/.test(toggle),
  'a refused disable must show the server reason, which names the live rule or reward to turn off first');

// --- read budget: config only, no history, no listeners --------------------
for (const node of ['loyaltyMembers', 'loyaltyLedger', 'loyaltyBalances', 'loyaltyRewards']) {
  assert.ok(!panel.includes(node), `the stamps card must never read ${node} - those grow with the business`);
}
assert.ok(!/onValue|subscribe\(/.test(panel), 'the card must not subscribe to anything - it loads on open and on Refresh');

// --- output is escaped ------------------------------------------------------
assert.ok(/function loyaltyStampsEscape/.test(panel), 'an escape helper is required');
assert.ok(/loyaltyStampsEscape\(row\.label \|\| code\)/.test(panel),
  'an admin-entered label must be escaped before it is written into the table');

console.log('PASS: the Rewards stamps card renders inside POS Settings, picks colour only from the server palette, keeps the stamp code write-once, offers disable instead of delete, surfaces server refusals verbatim, and reads no growing loyalty node.');
