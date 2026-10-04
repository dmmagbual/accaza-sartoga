// Releasing a claimed reward. claimLoyaltyReward debits the stamps immediately, so a sale
// that never completes used to leave the member short: the reward sat at "claimed", which
// loyaltyMemberSnapshot does not list (it returns "available" only), and there was no way
// back. These assertions pin the reversal so it cannot quietly disappear again.
import fs from 'node:fs';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../src/functions/26-loyalty.js', import.meta.url), 'utf8') + '\n' + fs.readFileSync(new URL('../src/functions/26-loyalty2-admin.js', import.meta.url), 'utf8');
const section = (name) => {
  const start = source.indexOf(`exports.${name} = onCall(`);
  assert.ok(start > -1, `${name} is missing`);
  const next = source.indexOf('\nexports.', start + 10);
  return source.slice(start, next === -1 ? source.length : next);
};

const release = section('releaseLoyaltyClaim');
const claim = section('claimLoyaltyReward');
const finalize = section('finalizeLoyaltyRedemption');

// --- only an open claim may be released, so stamps are never returned twice ---
assert.ok(/current\.status !== "claimed"\) return;/.test(release),
  'only a reward still at "claimed" may be released - a redeemed, released or expired one must be left alone');
assert.ok(release.includes('status: "released"'), 'a released claim must be marked released, not deleted');
assert.ok(/if \(!result\.committed\) throw new HttpsError\("failed-precondition"/.test(release),
  'a release that did not commit must fail loudly rather than silently crediting stamps');

// --- the refund is what was charged, not what the catalog says today ---------
assert.ok(claim.includes('costCurrency: catalog.costCurrency, costQty: catalog.costQty'),
  'the claim must record what it actually charged, because the catalog is admin-editable');
assert.ok(release.includes('released.costCurrency') && release.includes('released.costQty'),
  'the release must refund from the claim record, never by re-reading the live catalog');
assert.ok(!/loyaltyRewardCatalog/.test(release),
  'the release must not consult the reward catalog - a changed price would refund the wrong number of stamps');

// --- the stamps genuinely go back ------------------------------------------
assert.ok(/\[field\]: Loyalty\.positiveInt\(current\[field\], 0\) \+ qty/.test(release),
  'the release must credit the stamps back to the balance');
assert.ok(release.includes('loyaltyLedger/${memberId}/release_${rewardInstanceId}'),
  'a release must leave its own ledger entry, keyed so a retry overwrites rather than doubles');
assert.ok(release.includes('type: "redeem_release"'), 'the ledger entry must name what happened');
assert.ok(release.includes('reason'), 'a release must record why, for the audit trail');

// --- cold-cache safety, same as every other loyalty transaction -------------
for (const [name, body] of [['releaseLoyaltyClaim', release]]) {
  assert.ok(body.includes('transactionCurrent('),
    `${name} must use transactionCurrent - the Admin SDK hands the first callback null on a cold instance`);
}

// --- both halves of the spec 10 control count the same event ----------------
// Redemptions per cashier is weighed against that cashier's sales volume. A claim that was
// released gave no product away, so counting it at claim time would put noise straight into
// the number meant to make give-aways visible.
assert.ok(!/redemptionsByCashier/.test(claim),
  'the per-cashier redemption count must not be incremented at claim time - a released claim gave nothing away');
assert.ok(/redemptionsByCashier/.test(finalize),
  'the per-cashier redemption count belongs with the cost, at finalize, where a real redemption happened');
assert.ok(finalize.includes('finalized.claimedBy'),
  'the redemption is attributed to whoever authorised it, not whoever happened to finalize after a handover');

console.log('PASS: a claimed reward can be given back exactly once, refunding what was actually charged, with its own audit entry; and redemption count and cost are booked together at the moment product is really handed over.');
