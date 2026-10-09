// Shift cash over/short posting date (Sep 2026, Danilo): a shift's over/short and every treatment
// that resolves it post at the shift's closing date and time, so the result stays in the day, month
// and year the drawer was counted, even when a manager reviews it days later. Cash physically
// recovered later posts when it is received. A closed accounting period is never written into.
import assert from 'node:assert/strict';
import {createFakeDatabase} from './helpers/fake-rtdb.mjs';
import {loadFunctions} from './helpers/functions-sandbox.mjs';
import {createRequire} from 'node:module';

// The Functions bundle runs in a VM realm while ./lib modules load in this one, so the write-safety
// plain-object check would refuse every sandbox object. Copy each payload into this realm first;
// the check itself still runs in full on the copied writes.
const realWriteSafety=createRequire(import.meta.url)('../functions/lib/write-safety.js');
const writeSafety={...realWriteSafety,safeAtomicUpdate:(db,writes)=>realWriteSafety.safeAtomicUpdate(db,structuredClone(writes))};

const CLOSE=Date.parse('2026-12-31T23:50:00+08:00');   // shift counted 11:50 pm, 31 Dec (Manila)
const REVIEW=Date.parse('2027-01-03T10:00:00+08:00');  // manager reviews on 3 Jan 2027
const manilaDay=(ms)=>new Date(ms+8*3600000).toISOString().slice(0,10);
const approval=(sourceId)=>({action:'review_discrepancy',sourceId,amount:null,approvedBy:'mgr_uid',approvedRole:'manager',approvedName:'Manager',expiresAt:REVIEW+600000});
const shortage=(id,shiftId)=>({kind:'cash',shiftId,variance:-150,value:-150,type:'shortage',status:'open',financialStatus:'pending_manager_reconciliation',date:'2026-12-31',closedAt:CLOSE,ts:CLOSE,staff:'Ana'});
const shift=(id)=>({id,status:'closed',closeAt:CLOSE,staff:'Ana',variance:-150});

function setup(extra={}){
  const db=createFakeDatabase({
    admins:{mgr_uid:'manager'},
    shifts:{SH1:shift('SH1'),SH2:shift('SH2'),SH3:shift('SH3')},
    discrepancies:{D1:shortage('D1','SH1'),D2:shortage('D2','SH2'),D3:shortage('D3','SH3')},
    financialApprovals:{A1:approval('D1'),A2:approval('D2'),A3:approval('D3')},
    ...extra
  });
  return {db,fx:loadFunctions(db,{now:REVIEW,libOverrides:{'./lib/write-safety':writeSafety}}).exports};
}
const req=(data)=>({auth:{uid:'mgr_uid',token:{email:'manager@example.test'}},data});
const val=async(db,path)=>(await db.ref(path).get()).val();

// 1. Current case workflow: the treatment posts on 31 Dec, the returned cash on 3 Jan.
{
  const {db,fx}=setup();
  const result=await fx.reviewDiscrepancy(req({discrepancyId:'D1',caseVersion:2,approvalId:'A1',note:'Drawer counted short; owner took 100, Ana returned 50 on 3 Jan',allocations:[
    {id:'owner',treatment:'owner_draw',amount:100,details:{owner:'Danilo',reference:'Owner note 31-12'}},
    {id:'returned',treatment:'cash_recovered',amount:50,details:{destination:'undeposited',reference:'Returned by Ana'}}
  ]}));
  const main=await val(db,'financialMovements/cash_difference_D1_1'),found=await val(db,'financialMovements/cash_difference_D1_1_recovered');
  assert.ok(main&&found,'the treatment and the recovered cash are separate postings');
  assert.equal(main.occurredAt,CLOSE,'the owner-draw treatment posts at the shift closing time');
  assert.equal(manilaDay(main.occurredAt),'2026-12-31','…which is 31 Dec 2026 in Manila');
  assert.equal(found.occurredAt,REVIEW,'recovered cash posts when it was received');
  assert.ok(main.lines.some((l)=>l.account==='equity:owner_draw')&&!main.lines.some((l)=>l.account==='asset:cash_awaiting_deposit'),'the close-dated posting holds the treatment only');
  assert.ok(found.lines.some((l)=>l.account==='asset:cash_awaiting_deposit'&&Number(l.debit)===50),'the recovered posting holds the cash only');
  const debit=(m)=>m.lines.reduce((s,l)=>s+Number(l.debit||0),0),credit=(m)=>m.lines.reduce((s,l)=>s+Number(l.credit||0),0);
  assert.equal(debit(main),credit(main));assert.equal(debit(found),credit(found));assert.equal(debit(main)+debit(found),150,'together they clear the whole 150 shortage');
  const allocations=await val(db,'discrepancies/D1/resolutionAllocations');
  assert.equal(allocations.owner.resolutionMovementId,'cash_difference_D1_1');
  assert.equal(allocations.returned.resolutionMovementId,'cash_difference_D1_1_recovered','each allocation links to the posting that carries it');
  const custody=await val(db,'cashCustody/cash_recovery_D1_returned');
  assert.equal(custody.movementId,'cash_difference_D1_1_recovered');assert.equal(custody.closedAt,REVIEW,'undeposited custody starts when the cash arrived');
  assert.deepEqual(main.allocationIds,['owner']);assert.deepEqual(found.allocationIds,['returned']);
  assert.equal(result.movementId,'cash_difference_D1_1');assert.equal(result.recoveredMovementId,'cash_difference_D1_1_recovered');
  // A repeat of a completed review is answered as a duplicate and posts nothing more.
  const repeat=await fx.reviewDiscrepancy(req({discrepancyId:'D1',caseVersion:2,approvalId:'A1',note:'retry',allocations:[{id:'again',treatment:'owner_draw',amount:10,details:{owner:'Danilo',reference:'x'}}]}));
  assert.equal(repeat.duplicate,true);
  assert.equal(Object.keys(await val(db,'financialMovements')).filter((k)=>k.startsWith('cash_difference_D1')).length,2,'no duplicate posting on retry');
}

// 2. Recovered cash alone still posts when received, and is the returned movement.
{
  const {db,fx}=setup();
  const result=await fx.reviewDiscrepancy(req({discrepancyId:'D1',caseVersion:2,approvalId:'A1',note:'Ana returned the full amount',allocations:[{id:'returned',treatment:'cash_recovered',amount:150,details:{destination:'undeposited',reference:'Returned by Ana'}}]}));
  assert.equal(result.movementId,'cash_difference_D1_1_recovered');
  assert.equal((await val(db,'financialMovements/cash_difference_D1_1_recovered')).occurredAt,REVIEW);
  assert.equal(await val(db,'financialMovements/cash_difference_D1_1'),null,'no empty close-dated posting');
}

// 3. Current case workflow: an unexplained shortage requires documented investigation and
//    reclassifies the pending shortage to Cash Short / Over at the shift closing time.
{
  const {db,fx}=setup();
  await fx.reviewDiscrepancy(req({discrepancyId:'D2',caseVersion:2,approvalId:'A2',note:'Recount and source review found no identifiable cause',allocations:[
    {id:'unexplained',treatment:'unexplained_shortage',amount:150,details:{investigation:'Manager recounted the drawer and checked sales, change, payouts, tips, and adjacent shifts.'}}
  ]}));
  const movement=await val(db,'financialMovements/cash_difference_D2_1');
  assert.ok(movement,'the unexplained-shortage resolution posted');
  assert.equal(movement.occurredAt,CLOSE,'Cash Short / Over is recognised on the shift closing date');
  assert.deepEqual(movement.lines.map((line)=>[line.account,line.debit,line.credit]),[
    ['expense:cash_shortage',150,0],
    ['asset:cash_shortage_pending',0,150]
  ]);
  assert.equal((await val(db,'discrepancies/D2/resolutionAllocations/unexplained')).details.investigation,'Manager recounted the drawer and checked sales, change, payouts, tips, and adjacent shifts.');
}
{
  const {db,fx}=setup();
  await assert.rejects(fx.reviewDiscrepancy(req({discrepancyId:'D2',caseVersion:2,approvalId:'A2',note:'Cause not identified',allocations:[
    {id:'unexplained',treatment:'unexplained_shortage',amount:150,details:{investigation:'  '}}
  ]})),/Document the investigation before recognizing an unexplained cash shortage expense/);
  assert.equal(await val(db,'financialMovements/cash_difference_D2_1'),null,'missing investigation evidence posts nothing');
  assert.equal((await val(db,'discrepancies/D2')).status,'open','the unexplained case remains open');
}

// 4. Legacy single-treatment workflow: shortage expense posts at the shift closing time.
{
  const {db,fx}=setup();
  await fx.reviewDiscrepancy(req({discrepancyId:'D2',approvalId:'A2',treatment:'shortage_expense',note:'Unexplained shortage after recount'}));
  const movement=await val(db,'financialMovements/shift_variance_resolution_D2');
  assert.ok(movement,'the resolution posted');
  assert.equal(movement.occurredAt,CLOSE,'Cash Short / Over is recognised on the closing date');
  assert.equal(manilaDay(movement.occurredAt),'2026-12-31');
}

// 5. A closed December is never written into; the review is refused and nothing posts.
{
  const {db,fx}=setup({accountingPeriods:{'2026-12':{period:'2026-12',status:'closed'}}});
  await assert.rejects(fx.reviewDiscrepancy(req({discrepancyId:'D3',approvalId:'A3',treatment:'shortage_expense',note:'Late review'})),(e)=>e.code==='failed-precondition');
  assert.equal(await val(db,'financialMovements/shift_variance_resolution_D3'),null);
  assert.equal((await val(db,'discrepancies/D3')).status,'open','the case stays open until December is reopened');
}

// 6. Retry after a partial failure: the found-cash posting and its custody were saved, the case
//    posting was not. The retry completes the case without counting the found cash twice.
{
  const allocations=[{id:'owner',treatment:'owner_draw',amount:100,details:{owner:'Danilo',reference:'Owner note 31-12'}},{id:'returned',treatment:'cash_recovered',amount:50,details:{destination:'undeposited',reference:'Returned by Ana'}}];
  const first=setup();
  await first.fx.reviewDiscrepancy(req({discrepancyId:'D1',caseVersion:2,approvalId:'A1',note:'first attempt',allocations}));
  const savedMovement=await val(first.db,'financialMovements/cash_difference_D1_1_recovered'),savedCustody=await val(first.db,'cashCustody/cash_recovery_D1_returned');
  const {db,fx}=setup({financialMovements:{cash_difference_D1_1_recovered:savedMovement},cashCustody:{cash_recovery_D1_returned:savedCustody}});
  await fx.reviewDiscrepancy(req({discrepancyId:'D1',caseVersion:2,approvalId:'A1',note:'retry after failure',allocations}));
  assert.equal((await val(db,'financialMovements/cash_difference_D1_1')).occurredAt,CLOSE,'the retry posts the case treatment on the closing date');
  assert.deepEqual(await val(db,'cashCustody/cash_recovery_D1_returned'),savedCustody,'the found cash is not added to Undeposited Collection twice');
  assert.equal((await val(db,'discrepancies/D1')).status,'reviewed');
  assert.ok((await val(db,'financialApprovals/A1')).usedAt,'the approval is consumed once the case is complete');
}

console.log('PASS: shift over/short and its treatments post at the shift closing date and time (31 Dec stays in 2026), recovered cash posts when received, a retry after a partial failure completes without double-counting, repeats post nothing twice, and a closed period is never written into.');
