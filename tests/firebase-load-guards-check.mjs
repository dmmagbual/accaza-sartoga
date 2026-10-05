// Firebase load guards for loyalty, QR ordering and AI scratch state (Oct 2026).
// 1. The daily prune removes only stale OTP challenges, SMS throttles, QR duplicate-submit locks,
//    old QR queue counters, old AI usage/health days and old daily stamp counters, using indexed
//    or key-range reads (the fake database refuses an unindexed query, as the real one would
//    download the whole node instead).
// 2. Per-sale loyalty, Dragon Quest and QR ticket history is backed up incrementally, and
//    short-lived secrets/locks are kept out of the backup.
// 3. Public order paths rate-limit before reading, and read only the active shift's id/status.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createFakeDatabase} from './helpers/fake-rtdb.mjs';
const require=createRequire(import.meta.url);
const BackupDelta=require('../functions/lib/backup-delta.js');
const bundle=fs.readFileSync('functions/index.js','utf8'),rules=fs.readFileSync('database.rules.json','utf8');
const DAY=86400000,now=Date.parse('2026-10-06T02:00:00Z');
const manilaDay=ms=>new Date(Number(ms)+8*3600000).toISOString().slice(0,10);
const today=manilaDay(now),daysAgo=n=>manilaDay(now-n*DAY);

// 1. Prune
{const db=createFakeDatabase({
  loyaltyOtp:{old:{expiresAt:now-2*DAY,otpHash:'x'},live:{expiresAt:now+5*60000,otpHash:'y'}},
  loyaltyLinkThrottle:{old:{lastAt:now-3*DAY},recent:{lastAt:now-60000}},
  qrOrderLocks:{uidA:{sigOld:{t:now-3*DAY},sigNew:{t:now-60000}}},
  qrOrderCounters:{[daysAgo(10)]:41,[daysAgo(7)]:12,[today]:3},
  accazaAiGuestUsage:{[daysAgo(40)]:{total:9},[today]:{total:1}},
  accazaAiProviderHealth:{[daysAgo(31)]:{failures:2},[daysAgo(2)]:{failures:1}},
  loyaltyDailyCounters:{mem1:{[daysAgo(5)]:{red:2},[daysAgo(3)]:{red:1},[today]:{red:1}}},
  orderLocks:{u:{s:{t:now}}},
},{rules});
 const start=bundle.indexOf('exports.pruneEphemeralNodes = onSchedule('),end=bundle.indexOf('exports.autoCompleteReadyOnlineOrders',start);
 assert.ok(start>=0&&end>start,'prune job not found');
 class FixedDate extends Date{static now(){return now;}}
 const ctx=vm.createContext({exports:{},onSchedule:(opts,fn)=>fn,getDatabase:()=>db,healRecentBooksNet:async()=>({}),logger:{info(){},error(){},warn(){}},
   financeDateFromTimestamp:manilaDay,RetryGuard:{ATTEMPTS_ROOT:'functionRetryAttempts'},ORDER_REGION:'asia-southeast1',Date:FixedDate,Object,Number,String,Promise,Math,JSON,Array});
 vm.runInContext(bundle.slice(start,end),ctx);
 await ctx.exports.pruneEphemeralNodes();
 const data=db.data();
 assert.deepEqual(Object.keys(data.loyaltyOtp),['live'],'only expired OTP challenges are removed');
 assert.deepEqual(Object.keys(data.loyaltyLinkThrottle),['recent']);
 assert.deepEqual(Object.keys(data.qrOrderLocks.uidA),['sigNew']);
 assert.deepEqual(Object.keys(data.qrOrderCounters).sort(),[daysAgo(7),today].sort(),'QR queue counters keep seven days');
 assert.deepEqual(Object.keys(data.accazaAiGuestUsage),[today]);
 assert.deepEqual(Object.keys(data.accazaAiProviderHealth),[daysAgo(2)]);
 assert.deepEqual(Object.keys(data.loyaltyDailyCounters.mem1).sort(),[daysAgo(3),today].sort(),'stamp caps keep three business days');
 for(const node of ['loyaltyOtp','loyaltyLinkThrottle'])assert.ok(db.reads.some(r=>r.path===node&&r.query&&r.query.by==='child'),`${node} must be pruned through its index`);
 for(const node of ['qrOrderCounters','accazaAiGuestUsage','accazaAiProviderHealth'])assert.ok(db.reads.some(r=>r.path===node&&r.query&&r.query.by==='key'),`${node} must be pruned by key range`);}

// 2. Backup coverage
for(const node of ['loyaltyLedger','loyaltyRewards','dragonQuestLedger','dragonQuestOrderIndex','archivedQrTickets']){
  assert.ok(BackupDelta.TRACKED_PATHS.includes(node),`backup must track ${node} incrementally`);
  const name='markBackupDirty'+node[0].toUpperCase()+node.slice(1);
  assert.ok(bundle.includes(`exports.${name} = backupDirtyTrigger("${node}");`),`dirty trigger ${name} missing`);
}
const exclude=bundle.slice(bundle.indexOf('const BACKUP_EXCLUDE = new Set('),bundle.indexOf('\n',bundle.indexOf('const BACKUP_EXCLUDE = new Set(')));
for(const node of ['qrOrderLocks','loyaltyOtp','loyaltyLinkThrottle'])assert.ok(exclude.includes(`"${node}"`),`${node} is short-lived and must stay out of backups`);

// 3. Public order paths
const body=name=>{const a=bundle.indexOf(`exports.${name} = onCall(`);assert.ok(a>=0,name);return bundle.slice(a,bundle.indexOf('\nexports.',a+10));};
for(const name of ['createQrOrderTicket','createOnlineOrder']){
  const src=body(name),limit=src.indexOf('await enforceOrderRateLimit(db, uid)'),shift=src.indexOf('readActiveShiftHead(db)');
  assert.ok(limit>0&&shift>limit,`${name} must rate-limit before reading the shift`);
  assert.ok(!src.includes('db.ref("/posActiveShift").get()'),`${name} must not download the whole active shift`);
}
assert.ok(body('createQrOrderTicket').includes('db.ref("/publicOrderStatus/acceptingOrders").get()'),'QR tickets read only the ordering flag');
assert.ok(!body('manageQrOrderTicket').includes('db.ref("/posActiveShift").get()'));
{const a=bundle.indexOf('async function readActiveShiftHead(db)'),fn=new Function(`${bundle.slice(a,bundle.indexOf('\n}\n',a)+2)};return readActiveShiftHead;`)();
 const open=createFakeDatabase({posActiveShift:{id:'SH1',status:'open',drawer:{b100:3},offlineSyncApplied:{t1:{at:1},t2:{at:2}}}});
 assert.deepEqual(await fn(open),{id:'SH1',status:'open'});
 assert.ok(open.reads.every(r=>r.path==='posActiveShift/id'||r.path==='posActiveShift/status'),'only id and status are downloaded');
 assert.equal(await fn(createFakeDatabase({})),null,'no active shift reads as closed');}

console.log('PASS: loyalty/QR/AI scratch state is pruned through indexed or key-range reads, per-sale loyalty, Dragon Quest and QR history is backed up incrementally, secrets and locks stay out of backups, and public order paths rate-limit first and read only the shift id and status.');
