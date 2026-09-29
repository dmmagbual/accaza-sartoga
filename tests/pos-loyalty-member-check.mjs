// Attaching a Rewards member to a POS sale. The earning trigger only fires for an order
// carrying loyaltyMemberId, so the wiring asserted here is the whole difference between a
// loyalty program that works and one that silently never awards anything.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const root = new URL('..', import.meta.url);
const read = (file) => fs.readFileSync(new URL(file, root), 'utf8');
const source = read('src/admin/pos/50i-loyalty-member.js');
const cart = read('src/admin/pos/50e-cart-checkout.js');
const persistence = read('src/admin/pos/50f-sale-persistence.js');
const bundle = read('assets/js/admin/pos.js');
const client = read('assets/js/admin/firebase-client.mjs');

// --- the badge parser, exercised for real -----------------------------------
const context = {};
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('function posLoyaltyParseBadge')).split('\nfunction posLoyaltySummary')[0], context);
const parse = context.posLoyaltyParseBadge;

const code = 'a1b2c3d4e5f6';
// Compared field by field: the parser returns an object built inside the vm realm, so a
// strict deep-equal would reject identical values purely on prototype identity.
const parsed = (raw) => { const r = parse(raw); return r ? r.memberId + '|' + r.code : null; };
assert.equal(parsed('ACZ1:m_63917abc1234:' + code), 'm_63917abc1234|' + code, 'a real badge must parse');
assert.equal(parsed('  ACZ1:m_1:' + code + '  '), 'm_1|' + code, 'scanners often add surrounding whitespace');
assert.equal(parsed('ACZ1:m_1:' + code.toUpperCase()), 'm_1|' + code, 'the code is normalised to lower case for the server comparison');

// A keyboard-wedge scanner types ANY barcode that crosses it into whatever has focus -
// a product code, a courier label, a loyalty card from another shop. None of these may
// be mistaken for an Accaza badge.
for (const junk of ['4806515740012', 'ACZ1:m_1', 'ACZ1:m_1:short', 'ACZ1::' + code, 'ACZ2:m_1:' + code,
  'ACZ1:m_1:' + code + ':extra', 'https://accazacoffee.com/rewards.html', '', '   ', 'ACZ1:m_1:zzzzzzzzzzzz']) {
  assert.equal(parse(junk), null, `a stray scan must be refused, not guessed at: ${JSON.stringify(junk)}`);
}

// --- the order actually carries the member ----------------------------------
assert.ok(/loyaltyMemberId:\(\(!isPlat&&posLoyaltyMember&&posLoyaltyMember\.memberId\)\|\|''\)/.test(persistence),
  'the saved order must carry loyaltyMemberId, or onOrderLoyaltyEarning can never fire');
assert.ok(persistence.includes("channel:(isPlat?platform.channel:'instore')"),
  'in-store POS sales must still be channel "instore" - the earning trigger skips anything else');

// --- the member never carries over to the next customer ---------------------
// Crediting the previous customer for this sale is worse than crediting nobody, so every
// path that empties the cart must also drop the member.
const resets = persistence.match(/posLoyaltyReset\(\)/g) || [];
assert.ok(resets.length >= 1, 'a completed sale must clear the attached member');
assert.ok((cart.match(/posLoyaltyReset\(\)/g) || []).length >= 2,
  'both the clear-sale and cancel-correction paths must drop the attached member');

// --- phone lookup stays earn-only -------------------------------------------
assert.ok(source.includes("'phone_lookup'"), 'phone lookup must be recorded as its own verification method');
assert.ok(/Phone lookup .*cannot redeem/.test(source),
  'the cashier must be told on screen that a phone-lookup member cannot redeem');

// --- nothing unbounded is ever read at the till -----------------------------
for (const forbidden of ['loyaltyMembers', 'loyaltyLedger', 'loyaltyRewards', 'loyaltyBalances']) {
  assert.ok(!source.includes(`'${forbidden}'`) && !source.includes(`"${forbidden}"`),
    `the till must never read /${forbidden} directly - it grows with the business`);
}
assert.ok(!/onValue|ref\(/.test(source), 'the loyalty till code must not subscribe to anything');

// --- the callables are reachable from the POS bundle ------------------------
for (const name of ['scanLoyaltyBadge', 'lookupLoyaltyMemberByPhone']) {
  assert.ok(client.includes(`'${name}'`), `${name} must be registered in callableNames or the till cannot call it`);
}
assert.ok(bundle.includes('function posLoyaltyParseBadge'), 'the built POS bundle is missing the loyalty section');
assert.ok(bundle.includes('posLoyaltyCartRow()'), 'the cart must render the Rewards member control');

console.log('PASS: the till attaches a Rewards member by badge scan or phone lookup, refuses stray barcodes, writes loyaltyMemberId onto the sale, drops the member afterwards, and reads nothing unbounded.');
