import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';

assert.match(process.env.FIRESTORE_EMULATOR_HOST ?? '', /^(?:localhost|127\.0\.0\.1|\[::1\]):\d+$/,
  'The attendance integration test requires a local Firestore emulator.');

const requireFunctions = createRequire(new URL('../functions/package.json', import.meta.url));
const {initializeApp, deleteApp} = requireFunctions('firebase-admin/app');
const {getFirestore} = requireFunctions('firebase-admin/firestore');
const {HttpsError} = requireFunctions('firebase-functions/v2/https');
const {createHrWorkspace} = requireFunctions('./lib/hr-workspace.js');
const {createHrAttendance} = requireFunctions('./lib/hr-attendance.js');
const app = initializeApp({projectId: 'demo-hr-attend-' + randomUUID().slice(0, 8)}, 'hr-attendance-test');
const firestore = getFirestore(app);
let timestamp = Date.parse('2026-11-23T22:00:00+08:00');
const now = () => timestamp;
const enabled = new Set(['amy', 'ben']);
const staff = createHrWorkspace({firestore, HttpsError, now, findPortalAccount: async (email) => email.split('@')[0]});
let duringPortalCheck;
const {tablet} = createHrAttendance({
  firestore, HttpsError, now,
  isPortalActive: async (uid) => {
    if (duringPortalCheck) {
      const callback = duringPortalCheck;
      duringPortalCheck = null;
      await callback();
    }
    return enabled.has(uid);
  },
});
const owner = {uid: 'owner', role: 'superadmin'};
const manager = {uid: 'manager', role: 'manager'};
const amy = {uid: 'amy', role: 'staff'};
const ben = {uid: 'ben', role: 'staff'};
const call = (actor, action, data) => staff(actor, {action, ...data});
const reject = (operation, code = 'permission-denied') => assert.rejects(operation, {code});
const enroll = (uid, name, role = 'employee') =>
  call(owner, 'saveMember', {email: uid + '@example.test', name, role, active: true});

try {
  const {id: managerId} = await enroll('manager', 'Shift Lead', 'hr_manager');
  const {id: employeeId} = await enroll('amy', 'Amy');
  const {id: benId} = await enroll('ben', 'Ben');
  await reject(call(amy, 'createAttendancePairing'));
  await reject(call(amy, 'setAttendancePin', {pin: 123456}), 'invalid-argument');
  await call(amy, 'setAttendancePin', {pin: '012345'});
  await call(ben, 'setAttendancePin', {pin: '630123'});
  const {code: expired} = await call(manager, 'createAttendancePairing');
  timestamp += 600001;
  await reject(tablet({action: 'pair', code: expired}));
  const {code} = await call(manager, 'createAttendancePairing');
  const pairings = await Promise.allSettled([tablet({action: 'pair', code}), tablet({action: 'pair', code})]);
  assert.equal(pairings.filter((result) => result.status === 'fulfilled').length, 1);
  const {credential} = pairings.find((result) => result.status === 'fulfilled').value;
  await reject(tablet({action: 'roster'}), 'unauthenticated');
  const roster = await tablet({action: 'roster', credential});
  assert.deepEqual(roster.rows.find(({id}) => id === employeeId), {id: employeeId, name: 'Amy'});

  const punch = (fields) => tablet({action: 'punch', credential, employeeId, pin: '012345', ...fields});
  await reject(punch({type: 'in', requestId: 'punch-wrong', pin: '111111'}));
  enabled.delete('amy');
  await reject(punch({type: 'in', requestId: 'punch-disabled'}));
  enabled.add('amy');
  const inAt = timestamp;
  const started = await punch({type: 'in', requestId: 'punch-in'});
  assert.deepEqual(started, {id: 'punch-in', type: 'in', at: inAt});
  assert.deepEqual(await punch({type: 'in', requestId: 'punch-in'}), started);
  await reject(punch({type: 'in', requestId: 'punch-in', pin: '111111'}));
  await reject(punch({type: 'in', requestId: 'double-in'}), 'failed-precondition');
  await reject(punch({type: 'out', requestId: 'punch-in'}), 'already-exists');

  timestamp = Date.parse('2026-11-24T06:00:00+08:00');
  const outAt = timestamp;
  const ended = await punch({type: 'out', requestId: 'punch-out'});
  assert.deepEqual(await punch({type: 'out', requestId: 'punch-out'}), ended);
  assert.deepEqual(ended, {id: 'punch-in', type: 'out', at: outAt});
  assert.equal((await call(ben, 'listAttendance', {scope: 'personal'})).rows.length, 0);
  const {rows} = await call(ben, 'listAttendance', {scope: 'team', date: '2026-11-23'});
  assert.deepEqual(rows[0], {id: 'punch-in', employeeId, employeeName: 'Amy', inAt, outAt, date: '2026-11-23', revision: 2, corrected: false});
  assert.equal((await call(ben, 'listAttendance', {scope: 'team', date: '2026-11-24'})).rows.length, 0);
  await reject(call(ben, 'listAttendance', {scope: 'team', date: '2026-02-30'}), 'invalid-argument');

  const correction = {id: 'punch-in', employeeId, revision: 2, inAt, outAt: outAt - 60000, requestId: 'edit-shift', reason: 'Shift lead confirmed clock-out time.'};
  await reject(call(amy, 'correctAttendance', correction));
  assert.deepEqual(await call(manager, 'correctAttendance', correction), {id: 'punch-in'});
  assert.deepEqual(await call(manager, 'correctAttendance', correction), {id: 'punch-in'});
  await reject(call(manager, 'correctAttendance', {...correction, requestId: 'edit-stale'}), 'aborted');
  const manual = {employeeId, inAt: inAt - 7200000, outAt: inAt - 3600000, reason: 'Tablet offline.', requestId: 'outage'};
  const manualResult = await call(manager, 'correctAttendance', manual);
  assert.deepEqual(await call(manager, 'correctAttendance', manual), manualResult);
  await reject(call(manager, 'correctAttendance', {...manual, outAt: inAt + 10, requestId: 'overlap'}), 'failed-precondition');
  // Anyone with HR management access corrects directly, including their own record and legacy managers.
  await call(manager, 'correctAttendance', {...manual, employeeId: managerId, requestId: 'own-record'});
  const lead = {uid: 'lead', role: 'manager'};
  await call(owner, 'saveMember', {email: 'lead@example.test', name: 'Old Lead', canManage: true, active: true});
  await call(lead, 'correctAttendance', {...manual, inAt: inAt - 14400000, outAt: inAt - 10800000, requestId: 'legacy-lead'});
  const corrections = await firestore.collection('hrWorkspace/pilot/attendanceAudit').where('action', '==', 'correct').get();
  assert.equal(corrections.size, 4);
  const edited = corrections.docs.find((row) => row.get('recordId') === 'punch-in').data();
  assert.equal(edited.previous.outAt, outAt);
  assert.equal(edited.next.outAt, outAt - 60000);
  assert.equal(edited.actorUid, manager.uid);

  timestamp += 610000;
  const raceIn = await punch({type: 'in', requestId: 'race-in'});
  timestamp += 3000;
  duringPortalCheck = async () => {
    await call(manager, 'correctAttendance', {
      id: raceIn.id, employeeId, revision: 1, inAt: raceIn.at, outAt: timestamp - 1000,
      requestId: 'race-correction', reason: 'Manager confirmed earlier clock-out.',
    });
    await punch({type: 'in', requestId: 'replacement-in'});
  };
  const staleOut = {type: 'out', requestId: 'stale-out'};
  await assert.rejects(punch(staleOut), /open attendance record changed/);
  timestamp += 1000;
  await assert.rejects(punch(staleOut), /open attendance record changed/);
  assert.equal((await call(amy, 'listAttendance', {scope: 'personal'})).rows[0].outAt, null);

  for (let attempt = 0; attempt < 8; attempt++) {
    await reject(punch({employeeId: benId, type: 'in', requestId: 'guess-' + attempt, pin: '999999'}));
  }
  await reject(punch({employeeId: benId, type: 'in', requestId: 'limited', pin: '630123'}), 'resource-exhausted');
  timestamp += 600001;
  await call(ben, 'setAttendancePin', {pin: '654321'});
  await reject(punch({employeeId: benId, type: 'in', requestId: 'old-pin', pin: '630123'}));
  await punch({employeeId: benId, type: 'in', requestId: 'new-pin', pin: '654321'});
  await call(manager, 'revokeAttendanceKiosk');
  await reject(tablet({action: 'roster', credential}), 'unauthenticated');
  await reject(punch({type: 'in', requestId: 'punch-in'}), 'unauthenticated');
  console.log('PASS: attendance pairing, PIN limits and resets, idempotent overnight punches, personal and team scope, audited corrections, and kiosk revocation.');
} finally {
  await firestore.terminate();
  await deleteApp(app);
}
