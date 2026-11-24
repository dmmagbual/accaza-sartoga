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

  // Roles: the two owners act directly. The system administrator cannot make their own login an owner.
  const ownerA = {uid: 'ownera', role: 'owner'};
  const ownerB = {uid: 'ownerb', role: 'owner'};
  const {id: ownerAId} = await call(owner, 'saveMember', {email: 'ownera@example.test', name: 'Owner A', role: 'hr_manager', active: true});
  const {id: ownerBId} = await call(owner, 'saveMember', {email: 'ownerb@example.test', name: 'Owner B', role: 'assistant_hr', active: true});
  await denied(call(owner, 'saveMember', {email: 'owner@example.test', name: 'Admin', role: 'hr_manager', active: true}));
  await denied(call(owner, 'saveMember', {email: 'x@example.test', name: 'X', role: 'superadmin', active: true}), 'invalid-argument');
  const roster = (await call(owner, 'list', {resource: 'members'})).rows;
  assert.equal(roster.find((row) => row.id === ownerAId).role, 'hr_manager');
  assert.equal(roster.find((row) => row.id === ownerAId).canManage, true);
  assert.equal(roster.find((row) => row.id === managerId).role, null, 'legacy manager has no role');
  await denied(call(owner, 'saveMember', {id: ownerBId, name: 'Owner B', active: true, canManage: true, revision: 1}), 'failed-precondition');

  // Hours settings: an owner saves directly from a Saturday no earlier than the current pay week.
  const values = {dailyRegularMin: 480, breakThresholdMin: 300, breakDeductMin: 60, restDay: 0, longShiftFlagMin: 960};
  const change = {requestId: 'break-60', values, effectiveFrom: '2026-11-28', reason: 'One-hour meal break.'};
  await denied(call(amy, 'listHoursSettings'));
  await denied(call(manager, 'saveHoursSettings', change));
  await denied(call(ownerA, 'proposeHoursSettings', change), 'invalid-argument');
  await denied(call(ownerA, 'saveHoursSettings', {...change, effectiveFrom: '2026-11-14'}), 'invalid-argument');
  await denied(call(ownerA, 'saveHoursSettings', {...change, effectiveFrom: '2026-11-24'}), 'invalid-argument');
  await denied(call(ownerA, 'saveHoursSettings', {...change, values: {...values, breakDeductMin: 400}}), 'invalid-argument');
  assert.deepEqual(await call(ownerA, 'saveHoursSettings', change), {id: 'break-60'});
  assert.deepEqual(await call(ownerA, 'saveHoursSettings', change), {id: 'break-60'}, 'retry is idempotent');
  await denied(call(ownerA, 'saveHoursSettings', {...change, reason: 'Different'}), 'already-exists');
  let settings = await call(ownerA, 'listHoursSettings');
  assert.equal(settings.earliest, '2026-11-21');
  assert.equal(settings.current.versionId, 'default', 'the saved change starts next week');
  assert.equal(settings.canEdit, true);
  assert.equal(settings.rows[0].status, 'approved');
  assert.equal(settings.rows[0].decidedBy, ownerAId);
  await call(ownerB, 'saveHoursSettings', {requestId: 'now', values: {...values, dailyRegularMin: 420}, effectiveFrom: '2026-11-21'});
  settings = await call(manager, 'listHoursSettings');
  assert.equal(settings.current.versionId, 'now');
  assert.equal(settings.current.values.dailyRegularMin, 420);
  assert.equal(settings.canEdit, false);
  assert.equal((await firestore.collection('hrWorkspace/pilot/audit').where('resource', '==', 'hoursSettings').get()).size, 2);

  const announcement = {id: 'reminder', title: 'Reminder', body: 'Inventory meeting', status: 'draft'};
  await denied(call(amy, 'saveAnnouncement', announcement));
  await call(manager, 'saveAnnouncement', announcement);
  assert.equal((await call(amy, 'home')).announcements.length, 0);
  await denied(call(amy, 'list', {resource: 'announcements', management: true}));
  assert.equal((await call(manager, 'list', {resource: 'announcements', management: true})).rows[0].status, 'draft');
  await call(manager, 'saveAnnouncement', {...announcement, revision: 1, status: 'published'});
  assert.equal((await call(amy, 'home')).announcements[0].id, announcement.id);

  // Read tracking: staff see only their own read state; managers see who has read it.
  let mine = (await call(amy, 'home')).announcements[0];
  assert.deepEqual([mine.read, mine.pinned, 'readIds' in mine], [false, false, false]);
  assert.deepEqual(await call(amy, 'readAnnouncement', {id: announcement.id}), {id: announcement.id, read: true});
  assert.deepEqual(await call(amy, 'readAnnouncement', {id: announcement.id}), {id: announcement.id, read: true}, 'replay');
  assert.equal((await call(amy, 'home')).announcements[0].read, true);
  assert.equal((await call(ben, 'list', {resource: 'announcements'})).rows[0].read, false);
  assert.equal('readIds' in (await call(ben, 'list', {resource: 'announcements'})).rows[0], false);
  assert.deepEqual((await call(manager, 'list', {resource: 'announcements', management: true})).rows[0].readIds, [amyId]);
  await call(manager, 'saveAnnouncement', {id: 'draft-note', title: 'Draft', body: 'Not yet', status: 'draft'});
  await denied(call(amy, 'readAnnouncement', {id: 'draft-note'}), 'not-found');
  await denied(call(amy, 'readAnnouncement', {id: 'missing'}), 'not-found');

  // Pinned announcements come first; unpinning returns them to date order. Reads survive edits.
  await call(manager, 'saveAnnouncement', {id: 'aaa-urgent', title: 'Urgent', body: 'Fridge repair', status: 'published', pinned: true});
  let order = (await call(amy, 'home')).announcements.map((row) => [row.id, row.pinned]);
  assert.deepEqual(order, [['aaa-urgent', true], [announcement.id, false]]);
  await call(manager, 'saveAnnouncement', {id: 'aaa-urgent', title: 'Urgent', body: 'Fridge repair', status: 'published', pinned: false, revision: 1});
  order = (await call(amy, 'home')).announcements.map((row) => row.id);
  assert.deepEqual(order, [announcement.id, 'aaa-urgent'], 'same publish time: id order, unpinned');
  await call(manager, 'saveAnnouncement', {...announcement, revision: 2, status: 'published', pinned: true});
  mine = (await call(amy, 'home')).announcements[0];
  assert.deepEqual([mine.id, mine.pinned, mine.read], [announcement.id, true, true]);
  // An announcement published before pinning existed keeps its key, so editing it never reorders older posts.
  const legacyKey = String(now - 1000).padStart(15, '0') + '~legacy';
  await firestore.doc('hrWorkspace/pilot/announcements/legacy').set({id: 'legacy', title: 'Old', body: 'Old note', status: 'published',
    revision: 1, sortKey: legacyKey, publishedKey: legacyKey});
  await call(manager, 'saveAnnouncement', {id: 'legacy', title: 'Old', body: 'Old note', status: 'published', revision: 1});
  assert.equal((await firestore.doc('hrWorkspace/pilot/announcements/legacy').get()).get('publishedKey'), legacyKey);
  assert.deepEqual((await call(amy, 'home')).announcements.map((row) => row.id), [announcement.id, 'aaa-urgent', 'legacy']);
  await call(manager, 'saveAnnouncement', {id: 'aaa-urgent', title: 'Urgent', body: 'Fridge repair', status: 'published', pinned: true, revision: 2});
  await call(manager, 'saveAnnouncement', {id: 'aaa-urgent', title: 'Urgent edit', body: 'Fridge repair', status: 'published', revision: 3});
  assert.equal((await call(amy, 'home')).announcements.find((row) => row.id === 'aaa-urgent').pinned, true, 'no pinned field keeps the pin');
  await call(manager, 'saveAnnouncement', {id: 'legacy', title: 'Old', body: 'Old note', status: 'archived', revision: 2});
  await call(manager, 'saveAnnouncement', {id: 'aaa-urgent', title: 'Urgent', body: 'Fridge repair', status: 'archived', revision: 4});

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
  // The step that completes a task records when; the task was due yesterday, so it is late.
  const taskDoc = firestore.doc('hrWorkspace/pilot/tasks/opening-check');
  assert.equal((await taskDoc.get()).get('completedAt'), now);
  const own = await call(amy, 'performance', {from: '2026-11-01', to: '2026-11-30'});
  assert.equal(own.team, false);
  assert.deepEqual(own.people.map((row) => [row.id, row.completed, row.late, row.onTimePct]), [[amyId, 1, 1, 0]]);
  assert.deepEqual((await call(amy, 'home')).scorecard.tasks.map((row) => row.outcome), ['late']);
  const teamScore = await call(manager, 'performance', {from: '2026-11-01', to: '2026-11-30'});
  assert.equal(teamScore.team, true);
  assert.equal(teamScore.people.find((row) => row.id === amyId).assigned, 1);
  assert.deepEqual((await call(ben, 'performance', {from: '2026-11-01', to: '2026-11-30'})).people, [], 'staff never see others');
  await denied(call(amy, 'performance', {from: '2026-11-30', to: '2026-11-01'}), 'invalid-argument');
  await denied(call(amy, 'performance', {from: '2026-01-01', to: '2026-11-30'}), 'invalid-argument');
  assert.deepEqual((await call(ben, 'list', {resource: 'tasks'})).rows[0].steps, []);
  const newTask = {...task, id: 'new-task', dueDate: '2026-11-28'};
  await call(manager, 'saveTask', newTask);
  assert.equal((await call(amy, 'home')).tasks[0].id, 'new-task');
  await call(manager, 'saveTask', {...newTask, revision: 1, status: 'archived'});
  await call(amy, 'setStep', {...step, revision: 3, done: false});
  assert.equal((await taskDoc.get()).get('completedAt'), null, 'reopening clears the completion time');
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
  console.log('PASS: HR enrollment, roles, owner settings, revocation, announcements, task ownership/progress, overnight shifts, audit, and bounded pagination.');
} finally {
  await firestore.terminate();
  await deleteApp(app);
}
