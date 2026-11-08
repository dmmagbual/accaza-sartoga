// POS change from the drawer (1 Nov 2026, Danilo). A cashier was told "no exact change" for
// P30 although the drawer held P20s and P10s: the bill had been broken without telling the POS,
// and the change finder only tried the biggest note first. This checks the exact change finder
// and that checkout and Register Ops wire the recovery (edit change given, bill break, recount).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=(f)=>fs.readFileSync(f,'utf8');
const mod={exports:{}};
vm.runInThisContext('(function(module){'+read('assets/js/shared/cash-change.js')+'\n})')(mod);
const {plan,DENOMS}=mod.exports;
const value=(c)=>Math.round(Object.keys(c).reduce((t,k)=>t+c[k]*Math.round(DENOMS.find((d)=>d.k===k).v*100),0))/100;
const within=(given,avail)=>Object.keys(given).every((k)=>given[k]<=(avail[k]||0));

// The incident: P30 change, the POS count holds only 5 x P1 -> honest shortfall of P25.
let r=plan(30,{b500:1,c1:5});
assert.equal(r.ok,false); assert.equal(r.short,25); assert.deepEqual(r.denoms,{c1:5});
// Once the bill break is recorded, P30 comes out as P20 + P10.
r=plan(30,{b500:1,p20:2,c10:1,c1:5});
assert.equal(r.ok,true); assert.deepEqual(r.denoms,{p20:1,c10:1});
// Largest-first used to fail here: P60 from one P50 and three P20s.
r=plan(60,{b50:1,p20:3});
assert.equal(r.ok,true); assert.deepEqual(r.denoms,{p20:3});
// Prefer larger bills while preserving exact change and availability.
r=plan(265,{b100:2,b50:1,p20:3,c10:1,c5:1});
assert.equal(r.ok,true); assert.deepEqual(r.denoms,{b100:2,b50:1,c10:1,c5:1});
// The closest attainable amount takes priority when exact change is unavailable.
r=plan(65,{b50:1,p20:3,c1:3});
assert.equal(r.ok,false); assert.equal(r.short,2); assert.deepEqual(r.denoms,{p20:3,c1:3});
// Centavos: 30c from one 25c and three 10c must use the 10c coins.
r=plan(0.30,{c25:1,c10s:3});
assert.equal(r.ok,true); assert.deepEqual(r.denoms,{c10s:3});
// Never more pieces than the drawer holds, and the shortfall is the closest amount below.
r=plan(25,{p20:1,c1:3});
assert.equal(r.ok,false); assert.equal(r.short,2); assert.ok(within(r.denoms,{p20:1,c1:3}));
// Zero, negative and junk counts.
assert.deepEqual(plan(0,{}),{denoms:{},ok:true,short:0});
assert.deepEqual(plan(-5,{c1:9}),{denoms:{},ok:true,short:0});
r=plan(10,{c10:-3,c5:'2',c1:'x'});
assert.equal(r.ok,true); assert.deepEqual(r.denoms,{c5:2});
// A typing slip (500 x P500 received) must not freeze the till or claim change it did not make.
r=plan(249900,{b500:500});
assert.equal(r.ok,false); assert.equal(r.short,400); assert.deepEqual(r.denoms,{b500:499});
// Centavos below the smallest coin can never be handed over.
r=plan(0.03,{c5s:9}); assert.equal(r.ok,false); assert.equal(r.short,0.03);
r=plan(0.32,{c25:1,c5s:1}); assert.equal(r.ok,false); assert.equal(r.short,0.02);
// Fuzz: every answer is within the drawer, adds up, and is exact whenever brute force finds a way.
let seed=7;const rnd=(n)=>{seed=(seed*1103515245+12345)%2147483648;return seed%n;};
const small=DENOMS.filter((d)=>d.v<=100);
for(let i=0;i<400;i++){
  const avail={};small.forEach((d)=>{const q=rnd(4);if(q)avail[d.k]=q;});
  const amount=(rnd(30000)+5)/100, res=plan(amount,avail);
  assert.ok(within(res.denoms,avail),'never more than the drawer holds');
  assert.equal(Math.round((value(res.denoms)+res.short)*100),Math.round(amount*100),'given + short = change');
  if(!res.ok){ // brute force over the small drawer must agree there is no exact answer
    const keys=Object.keys(avail),target=Math.round(amount*100);let found=false;
    (function go(j,left){if(found||left<0)return;if(left===0){found=true;return;}if(j===keys.length)return;const cents=Math.round(DENOMS.find((d)=>d.k===keys[j]).v*100);for(let q=0;q<=avail[keys[j]];q++)go(j+1,left-q*cents);})(0,target);
    assert.equal(found,false,`exact change for ${amount} exists but was missed`);
  }
}
// Bounded work: the biggest realistic change computes quickly.
const t0=Date.now();plan(19999.95,{b1000:3,b500:5,b200:5,b100:10,b50:10,p20:40,c10:50,c5:50,c1:300,c25:60,c10s:60,c5s:60});
assert.ok(Date.now()-t0<500,'change plan stays fast');

// Wiring: the admin page and offline cache load the finder; both modules use it.
assert.match(read('admin.html'),/shared\/cash-change\.js/);
assert.match(read('sw.js'),/\/assets\/js\/shared\/cash-change\.js/);
const has=(src,re,label)=>assert.ok(re.test(src),label||String(re));
const pos=read('src/admin/pos/50c-cash-denominations.js'),checkout=read('src/admin/pos/50e-cart-checkout.js'),reg=read('src/admin/register/10-cash-denominations.js'),ops=read('src/admin/register/60-operations-shift-review.js');
has(pos,/function makeChange\(amount,avail\)\{if\(window\.AccazaCashChange\)return window\.AccazaCashChange\.plan/);
has(reg,/function makeChangeD\(amount,avail\)\{if\(window\.AccazaCashChange\)return window\.AccazaCashChange\.plan/);
// Checkout: edited change is checked against the POS count before the sale is sent, because the
// server refuses a drawer change that would take any count below zero.
has(checkout,/var ce=window\.__posChangeEdit,mc; if\(ce&&giveChg>0\.001\)\{ var lk=posDenomLack\(ce,mergeDenoms\(shiftDrawer\(\),r\.counts\)\)/);
has(checkout,/if\(lk\.length\)\{alert\('The POS count shows only '\+lk\.join\(', '\)\+' in the drawer\. Record the bill break or recount the drawer first\.'\);return;\}/);
has(checkout,/if\(ce\)payments\[0\]\.changeEdited=true;/);
has(checkout,/data-chg="swap"/); has(checkout,/data-chg="recount"/); has(checkout,/data-chg="edit"/);
has(checkout,/window\.__posCashSwap\(refreshDenom\)/); has(checkout,/window\.__posDrawerRecount\(refreshDenom,pc\.received\|\|\{\}\)/);
// Register: drawer writes are transactional deltas on both copies; swaps cannot take out what the
// POS count does not hold; recount waits for unsynced sales and keeps an audit record.
has(reg,/return a\.runTransaction\(a\.ref\(a\.db,'shifts\/'\+id\+'\/drawer'\),next\)\.then\(function\(r\)\{if\(!r\|\|!r\.committed\)return fail\(/,'shift record first, abort is not success');
has(reg,/var v=\(Number\(o\[keys\[i\]\]\)\|\|0\)\+delta\[keys\[i\]\];if\(v<0\)return;/,'never below zero');
has(reg,/if\(window\.__online===false\)return Promise\.resolve\(fail\(/,'offline refused, not hung');
has(reg,/saveDrawer\(c\.counts,true\)/,'recount replaces the count');
has(reg,/if\(hc&&hc\.checked\)v-=Number\(held\[d\.k\]\)\|\|0;/,'customer cash held at checkout is not counted twice');
has(reg,/'shifts\/'\+shiftId\+'\/cashSwaps\/'\+ts/,'swap record keyed by time');
assert.ok(!/a\.update\(a\.ref\(a\.db,'posActiveShift'\),\{drawer:/.test(reg),"/a\\.update\\(a\\.ref\\(a\\.db,'posActiveShift'\\),\\{drawer:/");
has(reg,/var lack=drawerShortOf\(o\.counts\);if\(lack\.length\)/);
has(reg,/Number\(q\.pending\)\|\|0\)\+\(Number\(q\.syncing\)\|\|0\)/);
has(reg,/'shifts\/'\+shiftId\+'\/drawerRecounts\/'\+ts/);
has(reg,/window\.__posCashSwap=function\(done\)/); has(reg,/window\.__posDrawerRecount=function\(done,held\)/);
has(ops,/id="opsRecount">🧮 Recount drawer<\/button>/);
console.log('cash change check passed');

// Opening drawer count (3 Nov 2026): the server keeps only the till's denominations, so the
// database rules can freeze every key of an open shift's openCount.
{
  const src=read('src/functions/20a-pos-staff-identity.js');
  const body=src.slice(src.indexOf('const POS_DRAWER_DENOMS'),src.indexOf('// The bundle loads this section'));
  class HttpsError extends Error{constructor(code,msg){super(msg);this.code=code;}}
  const {POS_DRAWER_DENOMS:keys,posOpenCountMap}=new Function('HttpsError',body+'\nreturn {POS_DRAWER_DENOMS,posOpenCountMap};')(HttpsError);
  assert.deepEqual(keys,DENOMS.map((d)=>d.k));
  assert.deepEqual(posOpenCountMap({b1000:3,b100:4,b50:12,c1:0}),{b1000:3,b100:4,b50:12});
  assert.deepEqual(posOpenCountMap(null),{});
  assert.deepEqual(posOpenCountMap({b20:0}),{});
  for(const bad of [{b20:2},{b100:-1},{b100:1.5},{b100:'x'},{b100:{n:1}}])assert.throws(()=>posOpenCountMap(bad),/Opening cash count/);
  assert.match(src,/const counts = posOpenCountMap\(data\.openCount\)/);
  const rules=read('database.rules.json');
  for(const k of keys)assert.equal(rules.split(`newData.child('openCount/${k}').val() === data.child('openCount/${k}').val()`).length-1,2,k);
  assert.doesNotMatch(rules,/newData\.child\('openCount'\)\.val\(\) === data\.child\('openCount'\)\.val\(\) && newData\.child\('floatMode'\)/);
}
console.log('opening drawer count: denominations ok');

// Shift review drawer by denomination (3 Nov 2026): totals in centavos, blank and bad counts ignored.
{
  const src=read('src/admin/register/90-shift-review-export.js');
  const body=src.slice(src.indexOf('function shiftDrawerBreakdown'),src.indexOf('function shiftDrawerCardHtml'));
  const peso=(n)=>'P'+Number(n).toFixed(2);
  const {shiftDrawerBreakdown,shiftDrawerDiff,shiftDrawerDiffText}=new Function('DENOMS','peso',body+'\nreturn {shiftDrawerBreakdown,shiftDrawerDiff,shiftDrawerDiffText};')(DENOMS.map((d)=>({k:d.k,v:d.v,lbl:d.k})),peso);
  assert.equal(shiftDrawerBreakdown({}),null);
  assert.equal(shiftDrawerBreakdown({drawer:{}}),null);
  assert.equal(shiftDrawerBreakdown({drawer:{b100:0,c1:-3}}),null);
  const b=shiftDrawerBreakdown({drawer:{b1000:3,b100:4,b50:12,c25:3,c10s:1,c5s:1,c1:-2,p20:'x',c5:Infinity}});
  assert.equal(b.total,4000.9);
  assert.deepEqual(b.rows.map((r)=>[r.label,r.count,r.amount]),[['b1000',3,3000],['b100',4,400],['b50',12,600],['c25',3,0.75],['c10s',1,0.1],['c5s',1,0.05]]);
  assert.equal(shiftDrawerDiff(b,{expectedCash:4000}),90);
  assert.equal(shiftDrawerDiffText(90),'Over P0.90');
  assert.equal(shiftDrawerDiffText(shiftDrawerDiff({total:6815},{expectedCash:6815})),'Matches');
  assert.equal(shiftDrawerDiffText(shiftDrawerDiff({total:0.3},{expectedCash:0.1+0.2})),'Matches');
  assert.equal(shiftDrawerDiffText(-400000),'Short P4000.00');
  const reg=read('src/admin/register/00-bootstrap-payment-controls.js');
  assert.match(reg,/^function num\(n\)/m,'the Register bundle must define its own num()');
  assert.match(read('src/admin/register/60-operations-shift-review.js'),/try\{openShiftReview\(\);\}catch\(e\)\{shiftReviewFailed/);
}
console.log('shift review drawer breakdown ok');

// Platform commission defaults (3 Nov 2026): one shared list, loaded on every admin page, equal to the
// POS copy, so the re-key hint in platform payout reconciliation shows the real rate.
{
  const m={exports:{}};
  vm.runInThisContext('(function(module){'+read('assets/js/shared/platform-channels.js')+'\n})')(m);
  const P=m.exports;
  const pos=read('src/admin/pos/00-shared-state.js').match(/var POS_CHANNELS=(\[[^\n]*\]);/);
  assert.ok(pos,'POS_CHANNELS not found');
  assert.deepEqual(P.CHANNELS,new Function('return '+pos[1])(),'shared platform defaults must equal POS_CHANNELS');
  assert.equal(P.rate('grabfood',null),0.25);
  assert.equal(P.rate('foodpanda',{foodpanda:{rate:0.28}}),0.28);
  assert.equal(P.rate('foodpanda',{foodpanda:{rate:'x'}}),0.30);
  assert.equal(P.rate('instore',null),0);
  assert.match(read('admin.html'),/shared\/platform-channels\.js/);
  assert.match(read('sw.js'),/\/assets\/js\/shared\/platform-channels\.js/);
  const rk=read('src/admin/analytics/40-platform-payout-reconciliation.js');
  assert.doesNotMatch(rk,/channelRate\(/);
  assert.match(rk,/commissionRate:rate/);
}
console.log('platform commission defaults ok');
