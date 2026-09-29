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
// A completed sale clears the member through posLoyaltyFinalize (which also closes the
// reward); every other exit clears it through posLoyaltyReset (which hands stamps back).
// Either way the next customer starts clean.
assert.ok(/posLoyaltyFinalize\(oid\)/.test(persistence),
  'a completed sale must clear the attached member as it finalizes the reward');
assert.ok(/posLoyaltyMember = null;/.test(source) && (source.match(/posLoyaltyMember = null;/g) || []).length >= 2,
  'both the reset and the finalize path must drop the member');
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

// --- redemption: the money path ---------------------------------------------
const cartSrc = cart, posSrc = source;

// The discount must actually come off what the customer pays, and must be recorded
// separately from the Senior/PWD discount so it posts to 4920 rather than 4900.
assert.ok(/scopedDiscTotal\(\)\+posLoyaltyDiscount\(\)/.test(cartSrc),
  'the loyalty reward must reduce the charged total, not just decorate the cart');
assert.ok(/loyaltyDiscount:\(isPlat\?0:posLoyaltyDiscount\(\)\)/.test(persistence),
  'the saved order must carry loyaltyDiscount separately - that is what posts to 4920');
assert.ok(persistence.includes('loyaltyRewardId:') && persistence.includes('loyaltyRewardName:'),
  'the order must name which reward was given, so redemption cost is reportable by reward');

// A reward is priced by the server against the order as it was at claim time. If the cart
// then changes, that discount is simply wrong for this sale - charging it would take the
// wrong amount from the customer.
assert.ok(posSrc.includes('function posLoyaltyCheckStale'), 'a stale claim must be detected');
assert.ok(/posLoyaltyCheckStale\(\)/.test(cartSrc), 'staleness must be checked on every cart render');
assert.ok(/basis: basis/.test(posSrc), 'the claim must remember what it was priced against');
assert.ok(/Math\.abs\(now - posLoyaltyClaim\.basis\) < 0\.005/.test(posSrc),
  'the basis comparison must tolerate float noise but nothing larger');

// Releasing is what makes that safe: the stamps go back rather than being burned.
assert.ok(posSrc.includes("posLoyaltyReleaseClaim('Sale changed after the reward was applied'"),
  'a cart change must hand the stamps back, not silently drop the reward');
assert.ok(posSrc.includes("posLoyaltyReleaseClaim('Sale cleared before payment')"),
  'clearing a sale must hand the stamps back');

// A completed sale is the one case where the reward must NOT be released - the customer
// already walked away with the drink. It is finalized against the real order id instead.
assert.ok(/posLoyaltyFinalize\(oid\)/.test(persistence),
  'a completed sale must finalize the reward against its order id, never release it');
assert.ok(!/posLoyaltyReset\(\);\s*renderPosCart\(\{fresh:true\}\);\s*showReceipt/.test(persistence),
  'the completed-sale path must not release a reward the customer already received');

// Presence checks. Phone lookup earns but can never redeem (spec 1); the server refuses it
// too, this keeps the till from offering something that will be refused.
assert.ok(/verifiedBy === 'phone_lookup'\) return '';/.test(posSrc),
  'a phone-lookup member must not be offered a redeem button');
assert.ok(/verifiedBy: 'badge_scan'/.test(posSrc) && /verifiedBy: 'otp'/.test(posSrc),
  'redemption must offer both presence proofs the server accepts');
assert.ok(posSrc.includes('belongs to a different member'),
  'a badge scanned at redemption must be the badge of the member on this sale');

// No stacking with Senior/PWD unless the reward itself allows it (spec 1).
assert.ok(/posScopedDisc\.length > 0 \|\| \(Number\(\(document\.getElementById\('posDisc'\)/.test(posSrc),
  'an existing Senior/PWD or manual discount must block a non-stacking reward');
assert.ok(/chosen && chosen\.stackingAllowed/.test(posSrc),
  'the reward catalog decides whether stacking is allowed, not a hardcoded rule');

// The order value a reward is priced on must exclude the loyalty discount itself.
assert.ok(/sub - manual - scopedDiscTotal\(\)/.test(posSrc),
  'the pricing basis must net off other discounts but never the loyalty one - that is circular');

// Still nothing unbounded, now that redemption reads a catalog: it comes down with the
// member snapshot, which the till already fetches.
assert.ok(posSrc.includes('posLoyaltyMember.redeemable'),
  'redeemable rewards must come from the member snapshot the till already has');

console.log('PASS: a reward reduces the charged total, posts separately for 4920, is priced against a recorded basis that is rechecked every render, hands stamps back when the sale changes or is cleared, finalizes only on a completed sale, and cannot be redeemed without proof the member was present.');
