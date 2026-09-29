import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const L=require('../functions/lib/loyalty.js');
function assert(ok,message){if(!ok)throw new Error(message);}

// ---- Phone normalization ----
assert(L.normalizePhonePH('09171234567')==='+639171234567','local 09 format did not normalize');
assert(L.normalizePhonePH('+639171234567')==='+639171234567','already-E.164 format changed unexpectedly');
assert(L.normalizePhonePH('639171234567')==='+639171234567','63-prefixed format did not normalize');
assert(L.normalizePhonePH('0917 123 4567')==='+639171234567','spaced format did not normalize');
assert(L.normalizePhonePH('123')===null,'garbage phone was accepted');
assert(L.normalizePhonePH('+15551234567')===null,'non-PH mobile number was accepted');

// ---- Earning rules engine (spec §1/§3) ----
const rules={
  red_per_order:{trigger:'per_order',currency:'red',qty:1,enabled:true},
  yellow_500:{trigger:'amount_threshold',currency:'yellow',qty:1,condition:{minNetAmount:500},enabled:true},
  yellow_1000:{trigger:'amount_threshold',currency:'yellow',qty:2,condition:{minNetAmount:1000},enabled:true},
  signup_bonus:{trigger:'first_order_after_signup',currency:'red',qty:3,enabled:true},
  disabled_rule:{trigger:'per_order',currency:'red',qty:99,enabled:false},
};
{
  const awards=L.evaluateEarningRules(rules,{netAmount:300,isFirstOrderAfterSignup:false});
  assert(awards.length===1&&awards[0].ruleId==='red_per_order','a ₱300 order should only earn the base red stamp');
}
{
  // Flat tier, not incremental: >₱1000 nets exactly 2 yellow, not 1 (for crossing 500) + 2 (for crossing 1000).
  const awards=L.evaluateEarningRules(rules,{netAmount:1200,isFirstOrderAfterSignup:false});
  const yellow=awards.filter(a=>a.currency==='yellow');
  assert(yellow.length===1&&yellow[0].qty===2,`>₱1000 should award exactly 2 yellow via the flat 1000-tier rule alone, got ${JSON.stringify(yellow)}`);
}
{
  const awards=L.evaluateEarningRules(rules,{netAmount:600,isFirstOrderAfterSignup:false});
  const yellow=awards.filter(a=>a.currency==='yellow');
  assert(yellow.length===1&&yellow[0].qty===1,'>₱500 but ≤₱1000 should award exactly 1 yellow');
}
{
  const awards=L.evaluateEarningRules(rules,{netAmount:200,isFirstOrderAfterSignup:true});
  assert(awards.some(a=>a.ruleId==='signup_bonus'&&a.qty===3),'signup bonus did not fire on first order after signup');
  const notFirst=L.evaluateEarningRules(rules,{netAmount:200,isFirstOrderAfterSignup:false});
  assert(!notFirst.some(a=>a.ruleId==='signup_bonus'),'signup bonus fired on a non-first order');
}
assert(!L.evaluateEarningRules(rules,{netAmount:1500}).some(a=>a.qty===99),'a disabled rule still fired');
{
  // order_count trigger: every 5th order.
  const countRules={fifth:{trigger:'order_count',currency:'red',qty:2,condition:{every:5},enabled:true}};
  assert(L.evaluateEarningRules(countRules,{orderCount:5}).length===1,'order_count rule did not fire on the 5th order');
  assert(L.evaluateEarningRules(countRules,{orderCount:4}).length===0,'order_count rule fired early');
  assert(L.evaluateEarningRules(countRules,{orderCount:10}).length===1,'order_count rule did not fire on the 10th order');
}
{
  // Date-range gating (what makes a "promotion" just a temporary rule — spec §3/§5).
  const now=Date.now();
  const promoRules={promo:{trigger:'per_order',currency:'red',qty:5,enabled:true,startAt:now-1000,endAt:now+1000}};
  assert(L.evaluateEarningRules(promoRules,{occurredAt:now}).length===1,'in-range promo rule did not fire');
  assert(L.evaluateEarningRules(promoRules,{occurredAt:now+5000}).length===0,'expired promo rule still fired');
  assert(L.evaluateEarningRules(promoRules,{occurredAt:now-5000}).length===0,'not-yet-started promo rule already fired');
}

// ---- Overlapping promotions STACK (confirmed 2026-09-29) ----
{
  const stackRules={
    base:{trigger:'per_order',currency:'red',qty:1,enabled:true},
    doubleStampsWeekend:{trigger:'per_order',currency:'red',qty:1,enabled:true},
    signupWeekBonus:{trigger:'first_order_after_signup',currency:'red',qty:3,enabled:true},
  };
  const awards=L.evaluateEarningRules(stackRules,{netAmount:100,isFirstOrderAfterSignup:true});
  assert(awards.length===3,`stacked promotions should all fire independently, got ${JSON.stringify(awards)}`);
  const totalRed=awards.reduce((s,a)=>s+a.qty,0);
  assert(totalRed===5,`stacked red total should be 1+1+3=5, got ${totalRed}`);
}

// ---- Daily caps: PER CURRENCY. The seeded pair still behaves exactly as before
// ---- (red capped at 2/day, yellow uncapped) — the cap is now config, not code.
const SEEDED_CAPS={red:2}; // yellow absent = uncapped, same as the original behaviour
{
  const awards=[{ruleId:'r1',currency:'red',qty:1},{ruleId:'r2',currency:'red',qty:1},{ruleId:'y1',currency:'yellow',qty:10}];
  const result=L.applyDailyCaps(awards,{},SEEDED_CAPS);
  assert(result.applied.filter(a=>a.currency==='red').reduce((s,a)=>s+a.qty,0)===2,'red should cap at 2/day');
  assert(result.applied.find(a=>a.currency==='yellow').qty===10,'yellow must remain uncapped');
  assert(result.cappedOut===false,'exactly hitting the cap should not report cappedOut for this case');
  assert(result.counts.red===2,'the returned counter should carry the day total for a capped currency');
}
{
  // Already at 1/2 red today; a 3-red award should be trimmed to 1, not dropped whole or granted in full.
  const result=L.applyDailyCaps([{ruleId:'r1',currency:'red',qty:3}],{red:1},SEEDED_CAPS);
  assert(result.applied.length===1&&result.applied[0].qty===1,`partial red-cap grant is wrong: ${JSON.stringify(result.applied)}`);
  assert(result.cappedOut===true,'partial grant should report cappedOut');
}
{
  // Already at cap: 6th order in one day earns no further red, order-level concern (charging) is out of scope here.
  const result=L.applyDailyCaps([{ruleId:'r1',currency:'red',qty:1}],{red:2},SEEDED_CAPS);
  assert(result.applied.length===0,'red award should be fully suppressed once the daily cap is already reached');
}
{
  // A newly added stamp gets its own independent cap and its own counter.
  const result=L.applyDailyCaps([{ruleId:'g1',currency:'green',qty:5},{ruleId:'r1',currency:'red',qty:5}],{red:0,green:1},{red:2,green:3});
  assert(result.applied.find(a=>a.currency==='green').qty===2,'a new capped stamp should be trimmed against its own cap');
  assert(result.applied.find(a=>a.currency==='red').qty===2,"one stamp's cap must not affect another's");
  assert(result.counts.green===3&&result.counts.red===2,'each stamp keeps its own day counter');
}
{
  // The counter node also stores bookkeeping keys; they must never be read as a stamp count.
  const result=L.applyDailyCaps([{ruleId:'r1',currency:'red',qty:1}],{red:0,_applied:[{ruleId:'x'}]},SEEDED_CAPS);
  assert(result.applied.length===1&&result.applied[0].qty===1,'a non-numeric bookkeeping key must not break cap maths');
  assert(result.counts._applied===undefined,'bookkeeping keys must not be echoed back as counts');
}

// ---- Reward catalog validation — cannot submit an uncapped reward (spec §4) ----
{
  const freeDrink=L.validateRewardDefinition({costCurrency:'red',costQty:10,grantType:'free_item_capped',cap:120,expiryDays:30});
  assert(freeDrink.ok,'the spec’s starting free-drink reward failed validation: '+JSON.stringify(freeDrink.errors));
  const twentyOff=L.validateRewardDefinition({costCurrency:'yellow',costQty:30,grantType:'percent_off_capped',percent:20,cap:200,expiryDays:30});
  assert(twentyOff.ok,'the spec’s starting 20%-off reward failed validation: '+JSON.stringify(twentyOff.errors));
  const uncappedPercent=L.validateRewardDefinition({costCurrency:'yellow',costQty:30,grantType:'percent_off_capped',percent:20,expiryDays:30});
  assert(!uncappedPercent.ok,'an uncapped percent-off reward was accepted');
  const uncappedFixed=L.validateRewardDefinition({costCurrency:'red',costQty:5,grantType:'fixed_off_capped',expiryDays:30});
  assert(!uncappedFixed.ok,'an uncapped fixed-off reward was accepted');
  const zeroCost=L.validateRewardDefinition({costCurrency:'red',costQty:0,grantType:'free_item_capped',cap:120,expiryDays:30});
  assert(!zeroCost.ok,'a zero-cost reward was accepted');
  const noExpiry=L.validateRewardDefinition({costCurrency:'red',costQty:10,grantType:'free_item_capped',cap:120,expiryDays:0});
  assert(!noExpiry.ok,'a reward with no expiry was accepted');
}

// ---- Reward discount computation ----
{
  assert(L.computeRewardDiscount({grantType:'free_item_capped',cap:120},150,0)===120,'free-drink discount should cap at ₱120 for a pricier item');
  assert(L.computeRewardDiscount({grantType:'free_item_capped',cap:120},90,0)===90,'free-drink discount should not exceed the item price when it is under the cap');
  assert(L.computeRewardDiscount({grantType:'percent_off_capped',percent:20,cap:200},0,500)===100,'20% of ₱500 should be ₱100');
  assert(L.computeRewardDiscount({grantType:'percent_off_capped',percent:20,cap:200},0,2000)===200,'20% off should cap at ₱200 for a large order');
  assert(L.computeRewardDiscount({grantType:'fixed_off_capped',cap:50},0,30)===30,'fixed-off should not exceed order net');
}

console.log('PASS: Loyalty earning rules engine (bounded triggers, flat yellow tiers, signup bonus, promotion stacking), per-currency daily caps (the seeded pair still capping red at 2/day and leaving yellow uncapped), and reward-builder cap validation all behave per spec.');
