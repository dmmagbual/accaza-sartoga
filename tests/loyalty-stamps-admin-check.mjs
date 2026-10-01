// The Rewards stamps admin screen (now a subtab of the Rewards program tab).
// The point of these assertions is that the screen can never imply a capability
// the server refuses, and can never quietly destroy stamps:
//  - colour comes from the server's palette, never a free colour input;
//  - there is no delete - only enable/disable, because members hold real balances;
//  - the code field is write-once (it names the {code}Balance field);
//  - a server refusal is shown as written, because it names what to turn off first.
import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const panel = read('../src/admin/rewards/15-rewards-stamps.js');
const core = read('../src/admin/rewards/00-rewards-core.js');
const dispatcher = read('../src/admin/register/00-bootstrap-payment-controls.js');
const client = read('../assets/js/admin/firebase-client.mjs');
const builtRegister = read('../assets/js/admin/register.js');
const builtRewards = read('../assets/js/admin/rewards.js');

// --- the screen lives in the Rewards tab, not POS Settings -------------------
assert.ok(/function rewardsStampsHtml/.test(panel) && /function rewardsStampsWire/.test(panel),
  'the stamps screen must render as a Rewards subview (markup + wiring)');
assert.ok(/if \(_rewardsState\.view === 'stamps'\) return rewardsStampsHtml\(\);/.test(core),
  'the Rewards core must route the stamps subtab to the stamps markup');
assert.ok(/rewardsStampsWire\(body\)/.test(core) && /rewardsStampsLoad\(\)/.test(core),
  'the Rewards core must wire and lazily load the stamps screen');
assert.ok(!/renderLoyaltyStamps|loyaltyStamps/.test(dispatcher),
  'POS Settings must no longer render the stamps card - it moved to the Rewards tab');
assert.ok(/if\(name==='possettings'\)\{renderPosSettings\(\);\}/.test(dispatcher),
  'POS Settings still renders its own settings panel');
assert.ok(!builtRegister.includes('renderLoyaltyStamps'),
  'the built register bundle must no longer carry the stamps card');
assert.ok(builtRewards.includes('rewardsStampsHtml'),
  'the built rewards bundle must carry the stamps screen');
assert.ok(/callableNames\.unshift\('manageLoyaltyCurrency'\)/.test(client),
  'manageLoyaltyCurrency must be registered as an admin callable, or the screen cannot save');

// --- colour comes from the server palette, never a free picker -------------
assert.ok(/_rewardsStampsState\.colors = payload\.colors/.test(panel),
  'the palette must come from the server response');
assert.ok(!/type="color"/.test(panel), 'a free colour input must never be offered - colour is one of the presets');
assert.ok(!/#(?:[0-9A-Fa-f]{6})\b/.test(panel.replace(/#ccc|#fff|#666|#777|#222|#eee|#e3e3e3|#fafafa|#fde8e8|#721c24|#e8f5e9|#1b5e20|#8a6d3b/g, '')),
  'the screen must not hardcode stamp colours of its own - only neutral chrome colours are allowed');

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
assert.ok(/function rewardsMessage/.test(core) && /error\.message/.test(core),
  'the shared message helper must surface the server message');
const toggle = panel.slice(panel.indexOf('function rewardsStampsToggle'));
assert.ok(/rewardsMessage\(error/.test(toggle),
  'a refused disable must show the server reason, which names the live rule or reward to turn off first');

// --- read budget: config only, no history, no listeners --------------------
for (const node of ['loyaltyMembers', 'loyaltyLedger', 'loyaltyBalances', 'loyaltyRewards']) {
  assert.ok(!panel.includes(node), `the stamps screen must never read ${node} - those grow with the business`);
}
assert.ok(!/onValue|subscribe\(/.test(panel), 'the screen must not subscribe to anything - it loads on open and on Refresh');

// --- output is escaped ------------------------------------------------------
assert.ok(/function rewardsEscape/.test(core), 'an escape helper is required');
assert.ok(/rewardsEscape\(row\.label \|\| code\)/.test(panel),
  'an admin-entered label must be escaped before it is written into the table');

console.log('PASS: the Rewards stamps screen renders inside the Rewards tab (not POS Settings), picks colour only from the server palette, keeps the stamp code write-once, offers disable instead of delete, surfaces server refusals verbatim, and reads no growing loyalty node.');
