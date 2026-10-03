import {createRequire} from 'node:module';
import fs from 'node:fs';
const require=createRequire(import.meta.url);
const Q=require('../functions/lib/dragon-quest.js');
function assert(ok,message){if(!ok)throw new Error(message);}

const base={name:'Chapter',story:'A sufficiently clear story.',requirementText:'Complete the task.',sequence:1,targetCount:2,minimumNetAmount:0,rewardType:'catalog',rewardName:'Treasure',rewardId:'reward_1',enabled:true};
assert(Q.validateSeason({name:'Ember Cup',story:'A story',startAt:100,endAt:200}).ok,'valid season rejected');
assert(!Q.validateSeason({name:'',story:'',startAt:200,endAt:100}).ok,'invalid season accepted');

const distinct=Q.validateMission({...base,requirementType:'distinct_items',categoryIds:['coffee']}).mission;
let result=Q.evaluateMissionOrder(distinct,{}, {total:300,lineItems:[{itemKey:'latte',categoryId:'coffee',qty:1,unitTotal:150},{itemKey:'latte',categoryId:'coffee',qty:1,unitTotal:150}]},'2026-10-03');
assert(result.matched&&result.value===1&&!result.completed,'one menu item in two lines must count once for a distinct-item mission');
result=Q.evaluateMissionOrder(distinct,result.progress,{total:180,lineItems:[{itemKey:'mocha',categoryId:'coffee',qty:1,unitTotal:180}]},'2026-10-03');
assert(result.completed&&result.value===2,'second distinct item did not complete mission');

const pair=Q.validateMission({...base,requirementType:'pair_same_order',targetCount:1,categoryIds:['coffee'],pairCategoryIds:['pastry']}).mission;
assert(!Q.evaluateMissionOrder(pair,{}, {total:150,lineItems:[{itemKey:'latte',categoryId:'coffee',qty:1,unitTotal:150}]},'2026-10-03').matched,'unpaired drink advanced a pair mission');
assert(Q.evaluateMissionOrder(pair,{}, {total:250,lineItems:[{itemKey:'latte',categoryId:'coffee',qty:1,unitTotal:150},{itemKey:'croissant',categoryId:'pastry',qty:1,unitTotal:100}]},'2026-10-03').completed,'same-order pairing did not complete');

const visits=Q.validateMission({...base,requirementType:'different_day_visits',categoryIds:['coffee']}).mission;
let day=Q.evaluateMissionOrder(visits,{}, {total:150,lineItems:[{itemKey:'latte',categoryId:'coffee',qty:1,unitTotal:150}]},'2026-10-03');
day=Q.evaluateMissionOrder(visits,day.progress,{total:150,lineItems:[{itemKey:'mocha',categoryId:'coffee',qty:1,unitTotal:150}]},'2026-10-03');
assert(day.value===1,'two purchases on one day counted as two visit days');
day=Q.evaluateMissionOrder(visits,day.progress,{total:150,lineItems:[{itemKey:'mocha',categoryId:'coffee',qty:1,unitTotal:150}]},'2026-10-04');
assert(day.completed,'second distinct business day did not complete visit mission');

const quantity=Q.validateMission({...base,requirementType:'item_quantity',targetCount:3,categoryIds:['coffee']}).mission;
assert(Q.evaluateMissionOrder(quantity,{}, {total:450,lineItems:[{itemKey:'latte',categoryId:'coffee',qty:3,unitTotal:150}]},'2026-10-03').completed,'eligible line quantity did not count');
const guarded=Q.validateMission({...base,requirementType:'item_quantity',targetCount:1,minimumNetAmount:500,categoryIds:['coffee']}).mission;
assert(!Q.evaluateMissionOrder(guarded,{}, {total:499.99,lineItems:[{itemKey:'latte',categoryId:'coffee',qty:3,unitTotal:150}]},'2026-10-03').matched,'below-minimum order advanced mission');

const backend=fs.readFileSync('src/functions/26b-dragon-quest.js','utf8');
const loyalty=fs.readFileSync('src/functions/26-loyalty.js','utf8')+'\n'+fs.readFileSync('src/functions/26-loyalty2-admin.js','utf8');
const customer=fs.readFileSync('assets/js/customer/rewards.js','utf8');
const page=fs.readFileSync('rewards.html','utf8');
const pos=fs.readFileSync('src/admin/pos/50i-loyalty-member.js','utf8');
const rules=fs.readFileSync('database.rules.json','utf8');
const admin=fs.readFileSync('src/admin/rewards/50-dragon-quest.js','utf8');
['getDragonQuest','enrollDragonQuest','onOrderDragonQuestProgress','manageDragonQuest'].forEach(name=>assert(backend.includes(`exports.${name}`),`missing ${name} backend export`));
assert(backend.includes('processedOrders')&&backend.includes('transaction('),'quest order posting lacks transaction/idempotency evidence');
assert(backend.includes('season.status === "paused"')&&backend.includes('Another Dragon Quest season is already active'),'paused-season ownership can be lost or resumed over another campaign');
assert(backend.includes('seasonCount >= DRAGON_LIMITS.seasons'),'cloning can bypass the bounded season cap');
assert(loyalty.includes('earned_reward_claim')&&loyalty.includes('returnedToAvailable'),'earned reward claim/release lifecycle is incomplete');
assert(pos.includes('rewardInstanceId: chosen.rewardInstanceId'),'POS does not send the earned reward instance');
assert(customer.includes('showBadge(member, true)')&&customer.includes('enrollDragonQuest'),'new member is not directed to the quest');
assert(page.includes('How Dragon Brew Quest works')&&page.includes('Rewards &amp; Dragon Quest'),'customer mechanics or discoverable route is missing');
assert(admin.includes('Sariwa, the Ember Dragon')&&admin.includes('Published seasons are immutable'),'story starter or immutable campaign control is missing');
['dragonQuestConfig','dragonQuestSeasons','dragonQuestMissions','dragonQuestEnrollments','dragonQuestLedger','dragonQuestOrderIndex'].forEach(node=>assert(new RegExp(`"${node}"\\s*:\\s*\\{\\s*"\\.read"\\s*:\\s*false,\\s*"\\.write"\\s*:\\s*false`).test(rules),`${node} is not protected`));

console.log('dragon quest checks passed');
