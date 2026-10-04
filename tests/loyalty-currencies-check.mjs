// Stamp currencies are CONFIGURED, not hardcoded. Red and Yellow are just the two
// seeded ones. These assertions pin the two things that make that safe:
//
//  1. No migration. A currency's balance field is `{code}Balance`, so the existing
//     redBalance/yellowBalance fields ARE red and yellow; adding a stamp only adds a
//     new field. Nothing is ever renamed or deleted, because a code names the field
//     holding real member stamps.
//  2. The seeded pair still behaves exactly as it did before caps were configurable
//     (red capped at 2/day, yellow uncapped).
//
// Colour comes from a fixed 6-colour palette, never a free hex field.
import {createRequire} from 'node:module';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const L = require('../functions/lib/loyalty.js');

const source = fs.readFileSync(new URL('../src/functions/26-loyalty.js', import.meta.url), 'utf8') + '\n' + fs.readFileSync(new URL('../src/functions/26-loyalty2-admin.js', import.meta.url), 'utf8');
const exportSection = (name) => {
  const start = source.indexOf(`exports.${name} = onCall(`);
  assert.ok(start > -1, `${name} is missing`);
  const next = source.indexOf('\nexports.', start + 10);
  return source.slice(start, next === -1 ? source.length : next);
};
const fnSection = (name) => {
  const start = source.indexOf(`async function ${name}(`);
  assert.ok(start > -1, `${name} is missing`);
  const next = source.indexOf('\nexports.', start + 10);
  return source.slice(start, next === -1 ? source.length : next);
};

// --- 1. the fixed palette --------------------------------------------------
assert.equal(L.STAMP_COLORS.length, 6, 'the palette must offer exactly 6 preset colours');
assert.equal(new Set(L.STAMP_COLORS.map((c) => c.hex.toLowerCase())).size, 6, 'palette colours must be distinct');
L.STAMP_COLORS.forEach((c) => {
  assert.ok(/^#[0-9A-Fa-f]{6}$/.test(c.hex), `palette colour ${c.hex} is not a 6-digit hex`);
  assert.ok(c.name && c.name.length, 'every palette colour needs a name - a stamp is shown by label and colour, never colour alone');
  assert.ok(L.isStampColor(c.hex), `${c.hex} should be accepted as a palette colour`);
});
assert.ok(!L.isStampColor('#123456'), 'a free-choice hex outside the palette must be rejected');
assert.ok(!L.isStampColor(''), 'an empty colour must be rejected');

// --- 2. no migration: the seeded pair maps onto the existing fields --------
assert.equal(L.balanceField('red'), 'redBalance', 'red must keep using the existing redBalance field');
assert.equal(L.balanceField('yellow'), 'yellowBalance', 'yellow must keep using the existing yellowBalance field');
assert.equal(L.balanceField('green'), 'greenBalance', 'a new stamp gets its own field rather than reshaping the node');

const seeded = L.DEFAULT_CURRENCIES.map((c) => c.code);
assert.deepEqual(seeded, ['red', 'yellow'], 'the seed must be exactly red and yellow, under those codes - the codes name live balance fields');
const seedCaps = L.capsByCurrency(L.normalizeCurrencies(null));
assert.equal(seedCaps.red, 2, 'red must still be capped at 2/day by default');
assert.ok(!('yellow' in seedCaps), 'yellow must still be uncapped by default');

// --- codes are permanent and strictly shaped -------------------------------
assert.equal(L.currencyCode('Green'), 'green', 'a code is lower-cased');
assert.equal(L.currencyCode('  blue '), 'blue', 'a code is trimmed');
['', 'x', '1red', 'red stamp', 'red-2', 'red.2', 'a'.repeat(17)].forEach((bad) => {
  assert.equal(L.currencyCode(bad), null, `"${bad}" must be rejected as a stamp code`);
});

// --- normalizeCurrencies ---------------------------------------------------
assert.deepEqual(L.currencyCodes(L.normalizeCurrencies({})), ['red', 'yellow'],
  'an empty config must fall back to the seed so earning keeps working before the config is written');
{
  const list = L.normalizeCurrencies({
    green: {label: 'Green stamp', color: '#2E9E5B', dailyCap: 3, order: 3, enabled: true},
    red: {label: 'Red stamp', color: '#D64027', dailyCap: 2, order: 1, enabled: true},
    old: {label: 'Retired', color: '#2D6CDF', order: 2, enabled: false},
  });
  assert.deepEqual(L.currencyCodes(list), ['red', 'green'], 'disabled stamps must be excluded and order respected');
  assert.equal(L.capsByCurrency(list).green, 3, 'a new stamp carries its own daily cap');
}
{
  const list = L.normalizeCurrencies({blue: {label: 'Blue', color: '#BADBAD', enabled: true}});
  assert.ok(L.isStampColor(list[0].color), 'a colour outside the palette must fall back to a palette colour, never render as-is');
}

// --- validateCurrencyDefinition -------------------------------------------
{
  const ok = L.validateCurrencyDefinition({code: 'green', label: 'Green stamp', color: '#2E9E5B', dailyCap: 3});
  assert.ok(ok.ok, `a valid stamp was rejected: ${JSON.stringify(ok.errors)}`);
  assert.equal(ok.currency.dailyCap, 3);
  const uncapped = L.validateCurrencyDefinition({code: 'green', label: 'Green stamp', color: '#2E9E5B', dailyCap: ''});
  assert.ok(uncapped.ok && uncapped.currency.dailyCap === null, 'an empty cap means uncapped');
  assert.ok(!L.validateCurrencyDefinition({code: 'green', label: 'Green', color: '#010203'}).ok,
    'a free-choice hex must be refused - colour comes from the palette');
  assert.ok(!L.validateCurrencyDefinition({code: 'green', label: '', color: '#2E9E5B'}).ok, 'a label is required');
  assert.ok(!L.validateCurrencyDefinition({code: '1bad', label: 'X', color: '#2E9E5B'}).ok, 'an invalid code is refused');
  assert.ok(!L.validateCurrencyDefinition({code: 'green', label: 'X', color: '#2E9E5B', dailyCap: 0}).ok,
    'a zero cap is refused - leave it empty to mean uncapped rather than capping at nothing');
}

// --- rules and rewards validate against the CONFIGURED stamps -------------
assert.ok(L.validateRewardDefinition({costCurrency: 'green', costQty: 5, grantType: 'fixed_off_capped', cap: 50, expiryDays: 30}, ['red', 'yellow', 'green']).ok,
  'a reward costing a newly configured stamp must validate');
assert.ok(!L.validateRewardDefinition({costCurrency: 'green', costQty: 5, grantType: 'fixed_off_capped', cap: 50, expiryDays: 30}, ['red', 'yellow']).ok,
  'a reward costing a stamp that is not configured must be refused');
assert.equal(L.evaluateEarningRules({r: {trigger: 'per_order', currency: 'green', qty: 1, enabled: true}}, {netAmount: 100}, ['red', 'yellow']).length, 0,
  'a rule awarding an unconfigured stamp must not fire');
assert.equal(L.evaluateEarningRules({r: {trigger: 'per_order', currency: 'green', qty: 1, enabled: true}}, {netAmount: 100}, ['red', 'yellow', 'green']).length, 1,
  'a rule awarding a configured stamp must fire');

// --- 3. the engine is currency-driven, with nothing hardcoded -------------
assert.ok(!/applyDailyRedCap/.test(source), 'the red-only cap must be gone from the server wiring');
const earning = fnSection('postLoyaltyEarning');
assert.ok(/Loyalty\.applyDailyCaps\(awards, current, currencyCaps\)/.test(earning),
  'earning must apply each configured currency cap, not a hardcoded red cap');
assert.ok(/Loyalty\.balanceField\(code\)/.test(earning),
  'earning must write each stamp to its own {code}Balance field');
assert.ok(!/redBalance: Loyalty\.positiveInt/.test(earning) && !/yellowBalance: Loyalty\.positiveInt/.test(earning),
  'earning must not write red/yellow as hardcoded fields any more');
assert.ok(/Object\.assign\(\{\}, balances\)/.test(earning),
  'the balance write must MERGE, or adding a stamp would wipe the others');
assert.ok(/currencyCodes\(currencies\)/.test(earning),
  'earning must only honour rules naming a configured stamp');

const snapshot = fnSection('loyaltyMemberSnapshot');
assert.ok(/stamps = currencies\.map/.test(snapshot) && /balance: balanceOf\(currency\.code\)/.test(snapshot),
  'the snapshot must return one entry per configured stamp so screens need no stamp names of their own');
assert.ok(/redBalance, yellowBalance/.test(snapshot),
  'redBalance/yellowBalance must still be returned until every surface reads the stamps list (kept for the till and Rewards page)');
assert.ok(/balanceOf\(r\.costCurrency\)/.test(snapshot),
  'affordability must be checked against the reward\'s own stamp, not a red/yellow guess');

// --- the admin callable protects outstanding stamps ------------------------
const manage = exportSection('manageLoyaltyCurrency');
assert.ok(/requirePortalPermission\(db, request, \["loyaltyAdmin"\]\)/.test(manage), 'stamp config is loyaltyAdmin-only');
assert.ok(!/"delete"|remove\(\)/.test(manage),
  'a stamp must never be deletable - members hold real balances in it; disabling is the only retirement path');
assert.ok(/usedByRule/.test(manage) && /usedByReward/.test(manage),
  'disabling must be refused while a live rule awards it or a live reward costs it, so stamps are never silently dropped');
assert.ok(/colors: Loyalty\.STAMP_COLORS/.test(manage), 'the admin screen must be handed the fixed palette to choose from');
assert.ok(/operationalAuditRecord\("manage_loyalty_currency"/.test(manage), 'a stamp change must be audited');
assert.ok(/existing \? \{\} : \{createdAt: now\}/.test(manage), 'saving an existing stamp must not re-create it');

// --- the seed is written once, and only if absent -------------------------
const seedFn = fnSection('ensureLoyaltyDefaults');
assert.ok(/if \(!currenciesSnap\.exists\(\)\)/.test(seedFn), 'the currency seed must only be written when the node is absent');
assert.ok(/Loyalty\.DEFAULT_CURRENCIES\.forEach/.test(seedFn), 'the seed must come from the single source of truth in the lib');

console.log('PASS: stamp currencies are configurable with a fixed 6-colour palette; red/yellow keep their existing balance fields and behaviour (no migration); a stamp can never be renamed or deleted, and cannot be disabled while a live rule or reward still uses it.');
