// Stamp balances are rendered from the server's configured stamp list, not from two
// hardcoded red/yellow fields. Without this, adding a stamp type in POS Settings would
// award stamps nobody could see -- earned, banked, and invisible at both the till and on
// the customer's badge.
//
// Each surface keeps a red/yellow fallback on purpose: during a deploy an older response
// (no `stamps`) can still arrive, and showing nothing would look like lost stamps.
import fs from 'node:fs';
import assert from 'node:assert/strict';

const till = fs.readFileSync(new URL('../src/admin/pos/50i-loyalty-member.js', import.meta.url), 'utf8');
const rewardsJs = fs.readFileSync(new URL('../assets/js/customer/rewards.js', import.meta.url), 'utf8');
const rewardsHtml = fs.readFileSync(new URL('../rewards.html', import.meta.url), 'utf8');
const builtPos = fs.readFileSync(new URL('../assets/js/admin/pos.js', import.meta.url), 'utf8');

// --- the till renders every configured stamp ------------------------------
assert.ok(/function posLoyaltyStampsText/.test(till), 'the till needs one helper that renders the configured stamps');
assert.ok(/\(m && m\.stamps\) \|\| \[\]/.test(till), 'the till must read the stamp list off the member snapshot');
assert.ok(/s\.label \|\| s\.code/.test(till), 'each stamp must be shown with its label, never by colour or code alone');
assert.ok(builtPos.includes('posLoyaltyStampsText'), 'the built POS bundle must carry the helper');

// the summary and the redeem modal both go through the helper, so they cannot drift apart
const summary = till.slice(till.indexOf('function posLoyaltySummary'), till.indexOf('function posLoyaltyCartRow'));
assert.ok(/posLoyaltyStampsText\(m\)/.test(summary), 'the cart summary must use the helper');
assert.ok(!/redBalance/.test(summary) && !/yellowBalance/.test(summary),
  'the cart summary must not read the two hardcoded balance fields');
assert.ok(/posLoyaltyStampsText\(posLoyaltyMember\)/.test(till), 'the redeem modal must use the same helper');

// exactly one red/yellow mention survives in the till: the documented deploy fallback
assert.equal((till.match(/redBalance/g) || []).length, 1, 'only the documented fallback may mention redBalance');
assert.equal((till.match(/yellowBalance/g) || []).length, 1, 'only the documented fallback may mention yellowBalance');

// --- a reward's cost is named by its stamp's label -------------------------
assert.ok(/r\.costCurrencyLabel \|\| r\.costCurrency/.test(till),
  "a reward's cost must be labelled from the server, so a new stamp is not shown by its bare code");
assert.ok(!/esc\(r\.costCurrency\) \+ ' stamps'/.test(till), 'the hardcoded "<code> stamps" wording must be gone');

// --- the Rewards badge page renders every configured stamp -----------------
assert.ok(/id="stampBalances"/.test(rewardsHtml), 'the badge page needs one container the script fills');
assert.ok(!/id="redBalance"/.test(rewardsHtml) && !/id="yellowBalance"/.test(rewardsHtml),
  'the two fixed stamp tiles must be gone - the page cannot know the stamp types up front');
assert.ok(!/rw-stamp\.red|rw-stamp\.yellow/.test(rewardsHtml),
  'per-stamp colour rules must be gone; colour is applied inline from the configured palette');
assert.ok(/function paintStampBalances/.test(rewardsJs), 'the badge page needs a renderer for the stamp list');
assert.ok(/card\.stamps && card\.stamps\.length/.test(rewardsJs), 'it must prefer the served stamp list');
assert.ok(/label\.textContent = String\(stamp\.label/.test(rewardsJs),
  'an admin-entered label must go in through textContent, never innerHTML');
assert.ok(/count\.style\.color = stamp\.color/.test(rewardsJs), 'the count takes its colour from the configured palette');
assert.ok(/color: "#a4302a"/.test(rewardsJs) && /color: "#b8860b"/.test(rewardsJs),
  'the deploy-window fallback must keep the original red/yellow appearance');

console.log('PASS: the till and the Rewards badge page both render every configured stamp from the served list, label it rather than relying on colour, escape admin-entered labels, and keep a red/yellow fallback for the deploy window.');
