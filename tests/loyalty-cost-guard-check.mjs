// Cost controls for the Rewards program. These assertions pin the failure paths that can
// otherwise turn a small loyalty feature into repeated Functions calls or growing RTDB reads.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {rulesIndex} from '../tools/download-read-graph.mjs';

const read = (rel) => fs.readFileSync(new URL('../' + rel, import.meta.url), 'utf8');
const admin = read('src/admin/rewards/00-rewards-core.js');
const stamps = read('src/admin/rewards/15-rewards-stamps.js');
const server = read('src/functions/26-loyalty.js') + '\n' + read('src/functions/26-loyalty2-admin.js');
const rules = read('database.rules.json');
const availability = read('assets/js/customer/order-availability.mjs');
const rewardsHtml = read('rewards.html');

// A failed currency request is attempted once. Only a cashier/admin pressing Refresh may
// clear the attempt guard; render itself must never recursively retry a failed callable.
assert.ok(/currenciesAttempted: false/.test(admin), 'Rewards admin needs a persistent load-attempt guard');
assert.ok(/!_rewardsState\.currenciesLoaded && !_rewardsState\.currenciesAttempted && !_rewardsState\.busy/.test(admin),
  'renderRewards must not automatically retry a rejected currency request');
assert.ok(/if \(!loaded\) return;/.test(admin), 'a failed currency load must not chain into another subview request');
assert.ok(/if \(!_rewardsState\.currenciesLoaded\) \{[\s\S]*currenciesAttempted = false;[\s\S]*rewardsLoadCurrencies\(\);[\s\S]*return;/.test(admin),
  'the visible Refresh button must provide the bounded manual retry');
assert.equal((stamps.match(/currenciesAttempted = false;/g) || []).length, 3,
  'loading, saving or toggling stamps must invalidate the shared currency cache exactly where currencies are invalidated');

// Dynamic member paths must carry their own server-side indexes. The rules helper resolves
// $dynamic through the wildcard rule, so future template-literal queries cannot bypass this.
const indexed = rulesIndex(rules);
assert.equal(indexed('loyaltyRewards/$dynamic', 'status'), true, 'available reward lookups need the per-member status index');
assert.equal(indexed('loyaltyLedger/$dynamic', 'type'), true, 'first-order checks need the per-member ledger type index');

// Earning happens only on the transition into eligibility. Later preparation/service/order
// metadata writes remain idempotent without paying for another ledger existence read.
const eligibilitySource = (server.match(/function loyaltyOrderCanEarn\(order\) \{[\s\S]*?\n\}/) || [])[0];
assert.ok(eligibilitySource, 'the order eligibility gate is missing');
const context = {};
vm.createContext(context);
vm.runInContext(eligibilitySource, context);
const eligible = context.loyaltyOrderCanEarn;
assert.equal(eligible({status:'Completed',channel:'instore',paymentStatus:'confirmed',loyaltyMemberId:'mem_1'}), true);
assert.equal(eligible({status:'Completed',channel:'instore',paymentStatus:'pending',loyaltyMemberId:'mem_1'}), false);
assert.equal(eligible({status:'Completed',channel:'instore',paymentStatus:'confirmed'}), false);
assert.equal(eligible({status:'Completed',channel:'instore',paymentStatus:'confirmed',loyaltyMemberId:'mem_1',voided:true}), false);
assert.ok(/if \(!loyaltyOrderCanEarn\(beforeOrder\) && loyaltyOrderCanEarn\(order\)\) await postLoyaltyEarning/.test(server),
  'the RTDB trigger must invoke earning only when an order becomes eligible');

// Already verified member data is passed into the snapshot and device-link helpers, avoiding
// repeated reads of the same member in one callable.
assert.ok(/loyaltyMemberSnapshot\(db, memberId, knownMember\)/.test(server));
assert.ok((server.match(/loyaltyMemberSnapshot\(db, memberId, member\)/g) || []).length >= 4,
  'badge, self-card and link flows must reuse the member record they already verified');
assert.ok(/setLoyaltyDeviceLink\(db, request\.auth\.uid, memberId, "badge", member\)/.test(server),
  'badge linking must not reread the verified member');

// Defaults become one fixed marker read after first initialization, and operator-managed
// configuration has hard record ceilings rather than relying on convention to stay bounded.
assert.ok(/loyaltyConfigState\/defaultsV1/.test(server), 'successful signups need the initialized-config marker');
assert.ok(/LOYALTY_CONFIG_LIMITS = Object\.freeze\(\{currencies: 12, rules: 50, catalog: 50\}\)/.test(server));
assert.equal((server.match(/createLoyaltyConfigRow\(/g) || []).length, 4,
  'the transactional helper plus new currency, rule and catalog rows must enforce their configured ceilings');
assert.ok(/db\.ref\(path\)\.transaction/.test(server), 'configuration ceilings must remain correct across double-submit or concurrent admin tabs');

// Rewards is a read-mostly page. It checks order availability once (and again only when the
// browser comes back online) instead of keeping an RTDB listener alive for the whole visit.
assert.ok(/data-order-availability-mode="once"/.test(rewardsHtml));
assert.ok(/if\(once\)refresh\(\);else onValue\(statusRef,receive,failed\);/.test(availability));

console.log('PASS: Rewards retries are bounded, member queries are indexed and deduplicated, earning runs only on the eligible transition, config size is capped, and the customer Rewards page uses one-shot availability.');
