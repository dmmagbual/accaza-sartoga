import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';

assert.match(process.env.FIRESTORE_EMULATOR_HOST ?? '', /^(?:localhost|127\.0\.0\.1|\[::1\]):\d+$/,
  'The HR workspace integration test requires a local Firestore emulator.');

const requireFunctions = createRequire(new URL('../functions/package.json', import.meta.url));
const {initializeApp, deleteApp} = requireFunctions('firebase-admin/app');
const {getFirestore} = requireFunctions('firebase-admin/firestore');
const {HttpsError} = requireFunctions('firebase-functions/v2/https');
const {createHrWorkspace} = requireFunctions('./lib/hr-workspace.js');
const app = initializeApp({projectId: 'demo-accaza-hr-' + randomUUID().slice(0, 8)}, 'hr-test');
const firestore = getFirestore(app);
const now = Date.parse('2026-11-23T12:00:00+08:00');
const execute = createHrWorkspace({
  firestore, HttpsError, now: () => now,
  findPortalAccount: async (email) => email.split('@')[0],
});
const owner = {uid: 'owner', role: 'superadmin'};
const manager = {uid: 'manager', role: 'manager'};
const amy = {uid: 'amy', role: 'staff'};
const ben = {uid: 'ben', role: 'cashier'};
const call = (actor, action, fields) => execute(actor, {action, ...fields});
const denied = (promise, code = 'permission-denied') => assert.rejects(promise, {code});
const enroll = (uid, name, canManage = false) =>
  call(owner, 'saveMember', {email: uid + '@example.test', name, canManage, active: true});

try {
  assert.deepEqual(await call(owner, 'home'), {
    member: null, canEnroll: true, announcements: [], tasks: [], shifts: [],
  });
  await denied(call(manager, 'home'));
  await denied(enroll('owner', 'Owner', 'true'), 'invalid-argument');
  const {id: managerId} = await enroll('manager', 'Team Lead', true);
  const {id: amyId} = await enroll('amy', 'Amy');
  const {id: benId} = await enroll('ben', 'Ben');
  await denied(enroll('amy', 'Amy'), 'already-exists');
  await denied(call(manager, 'saveMember', {email: 'extra@example.test', name: 'Extra', active: true, canManage: false}));
  assert.deepEqual((await call(amy, 'list', {resource: 'members'})).rows.find((row) => row.id === managerId),
    {id: managerId, name: 'Team Lead', active: true});

  const announcement = {id: 'reminder', title: 'Reminder', body: 'Inventory meeting', status: 'draft'};
  await denied(call(amy, 'saveAnnouncement', announcement));
  await call(manager, 'saveAnnouncement', announcement);
  assert.equal((await call(amy, 'home')).announcements.length, 0);
  await denied(call(amy, 'list', {resource: 'announcements', management: true}));
  assert.equal((await call(manager, 'list', {resource: 'announcements', management: true})).rows[0].status, 'draft');
  await call(manager, 'saveAnnouncement', {...announcement, revision: 1, status: 'published'});
  assert.equal((await call(amy, 'home')).announcements[0].id, announcement.id);

  const task = {id: 'opening-check', title: 'Opening check', assigneeId: amyId, dueDate: '2026-11-22', status: 'active'};
  await denied(call(manager, 'saveTask', {...task, dueDate: '2026-02-30'}), 'invalid-argument');
  await call(manager, 'saveTask', task);
  assert.equal((await call(ben, 'list', {resource: 'tasks'})).rows[0].status, 'overdue');
  assert.equal((await call(ben, 'home')).tasks.length, 0);
  const step = {id: task.id, stepId: 'count', title: 'Count cups', revision: 1};
  await denied(call(ben, 'addStep', step));
  await call(amy, 'addStep', step);
  await call(amy, 'addStep', step); // Lost response replay.
  assert.equal((await call(amy, 'home')).tasks[0].steps.length, 1);
  await denied(call(amy, 'setStep', {...step, done: true}), 'aborted');
  await call(amy, 'setStep', {...step, revision: 2, done: true});
  assert.equal((await call(amy, 'home')).tasks[0].progress, 100);
  assert.equal((await call(amy, 'home')).tasks[0].status, 'completed');
  assert.deepEqual((await call(ben, 'list', {resource: 'tasks'})).rows[0].steps, []);
  const newTask = {...task, id: 'new-task', dueDate: '2026-11-28'};
  await call(manager, 'saveTask', newTask);
  assert.equal((await call(amy, 'home')).tasks[0].id, 'new-task');
  await call(manager, 'saveTask', {...newTask, revision: 1, status: 'archived'});
  await call(amy, 'setStep', {...step, revision: 3, done: false});
  assert.equal((await call(amy, 'home')).tasks[0].status, 'overdue');
  await call(manager, 'saveTask', {...task, assigneeId: benId, revision: 4});
  await denied(call(amy, 'setStep', {...step, revision: 5, done: true}));

  const shift = {
    id: 'overnight', employeeId: amyId, status: 'published', note: '',
    startAt: Date.parse('2026-11-23T22:00:00+08:00'), endAt: Date.parse('2026-11-24T06:00:00+08:00'),
  };
  await denied(call(manager, 'saveShift', {...shift, endAt: shift.startAt}), 'invalid-argument');
  await call(manager, 'saveShift', shift);
  assert.equal((await call(amy, 'home')).shifts[0].endAt, shift.endAt);
  assert.equal((await call(ben, 'home')).shifts.length, 0);
  assert.equal((await call(ben, 'list', {resource: 'shifts'})).rows[0].id, shift.id);
  await call(manager, 'saveShift', {...shift, revision: 1, status: 'archived'});
  assert.equal((await call(ben, 'list', {resource: 'shifts'})).rows.length, 0);
  assert.equal((await call(manager, 'list', {resource: 'shifts', management: true})).rows[0].status, 'archived');
  const audits = await firestore.collection('hrWorkspace/pilot/audit').where('recordId', '==', shift.id).get();
  assert.deepEqual(audits.docs.map((doc) => doc.get('revision')).sort(), [1, 2]);

  for (let index = 0; index < 26; index++) {
    await call(manager, 'saveTask', {...task, id: 'check-' + index, dueDate: '2026-11-24'});
  }
  const first = await call(amy, 'list', {resource: 'tasks'});
  const second = await call(amy, 'list', {resource: 'tasks', cursor: first.nextCursor});
  assert.equal(first.rows.length, 25);
  assert.equal(second.rows.length, 2);
  assert.equal(new Set([...first.rows, ...second.rows].map((row) => row.id)).size, 27);
  assert.equal(second.nextCursor, null);
  await call(amy, 'setChart', {chart: 'donut'});
  assert.equal((await call(amy, 'home')).member.chart, 'donut');

  await call(owner, 'saveMember', {id: amyId, name: 'Amy', active: false, canManage: false, revision: 1});
  await denied(call(amy, 'home'));
  await denied(call(amy, 'setChart', {chart: 'bar'}));
  await call(owner, 'saveMember', {id: managerId, name: 'Team Lead', active: true, canManage: false, revision: 1});
  await denied(call(manager, 'saveAnnouncement', {...announcement, status: 'archived', revision: 2}));
  console.log('PASS: HR enrollment, revocation, announcements, task ownership/progress, overnight shifts, audit, and bounded pagination.');
} finally {
  await firestore.terminate();
  await deleteApp(app);
}
