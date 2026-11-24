import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';

assert.match(process.env.FIRESTORE_EMULATOR_HOST ?? '', /^(?:localhost|127\.0\.0\.1|\[::1\]):\d+$/,
  'The HR weekly hours integration test requires a local Firestore emulator.');

const requireFunctions = createRequire(new URL('../functions/package.json', import.meta.url));
const {initializeApp, deleteApp} = requireFunctions('firebase-admin/app');
const {getFirestore} = requireFunctions('firebase-admin/firestore');
const {HttpsError} = requireFunctions('firebase-functions/v2/https');
const {createHrWorkspace} = requireFunctions('./lib/hr-workspace.js');
const app = initializeApp({projectId: 'demo-hr-week-' + randomUUID().slice(0, 8)}, 'hr-week-test');
const firestore = getFirestore(app);
const now = Date.parse('2026-11-30T09:00:00+08:00');
const execute = createHrWorkspace({firestore, HttpsError, now: () => now, findPortalAccount: async (email) => email.split('@')[0]});
const admin = {uid: 'admin', role: 'superadmin'};
const ownerA = {uid: 'ownera', role: 'owner'};
const amy = {uid: 'amy', role: 'staff'};
const lead = {uid: 'lead', role: 'manager'};
const call = (actor, action, fields = {}) => execute(actor, {action, ...fields});
const denied = (promise, code = 'permission-denied') => assert.rejects(promise, {code});
const enroll = (uid, name, extra) => call(admin, 'saveMember', {email: uid + '@example.test', name, active: true, ...extra});

// Attendance rows in the shape hr-attendance.js writes (see interval()).
const at = (local) => Date.parse(local + ':00+08:00');
async function punch(id, employeeId, from, to) {
  const inAt = at(from);
  const date = from.slice(0, 10);
  const key = String(inAt).padStart(15, '0');
  await firestore.doc('hrWorkspace/pilot/attendanceRecords/' + id).set({
    id, employeeId, employeeName: employeeId, inAt, outAt: to === null ? null : at(to), revision: 1, corrected: false,
    date, personalKey: employeeId + '~' + key + '~' + id, dayKey: date + '~' + key + '~' + id,
  });
}
const totals = (row) => [row.regularMin, row.dailyOtMin, row.restDayMin, row.regularHolidayMin, row.specialHolidayMin];

try {
  const {id: ownerAId} = await enroll('ownera', 'Owner A', {role: 'hr_manager'});
  await enroll('ownerb', 'Owner B', {role: 'assistant_hr'});
  const {id: amyId} = await enroll('amy', 'Amy', {role: 'employee'});
  await enroll('lead', 'Old Lead', {canManage: true});

  await punch('a-sun', amyId, '2026-11-22T08:00', '2026-11-22T14:00');
  await punch('a-mon', amyId, '2026-11-23T07:00', '2026-11-23T17:00');
  await punch('a-wed', amyId, '2026-11-25T07:00', '2026-11-25T15:00');
  await punch('o-tue', ownerAId, '2026-11-24T06:00', '2026-11-24T11:00');
  await punch('next-week', amyId, '2026-11-28T07:00', '2026-11-28T15:00');
  // Friday is the last day of the pay week, including a shift that runs past midnight.
  await punch('a-fri', amyId, '2026-11-27T19:00', '2026-11-28T00:00');
  await punch('last-week', amyId, '2026-11-20T07:00', '2026-11-20T15:00');
  await punch('sat-midnight', amyId, '2026-11-28T00:00', '2026-11-28T04:00');
  const week = {weekStart: '2026-11-21'};

  // Without a confirmed holiday list the week is blocked, and an employee sees only their own row.
  let mine = await call(amy, 'weeklyHours', week);
  assert.equal(mine.team, false);
  assert.equal(mine.weekEnd, '2026-11-27');
  assert.deepEqual(mine.employees.map((row) => row.name), ['Amy']);
  assert.deepEqual(totals(mine.employees[0]), [1230, 90, 330, 0, 0]);
  assert.equal(mine.blocked, true);
  assert.deepEqual(mine.issues.map((issue) => [issue.code, issue.year]), [['holidays_not_loaded', 2026]]);
  assert.equal(mine.settings.versionId, 'default');
  assert.equal(mine.employees[0].days.at(-1).date, '2026-11-27', 'Friday counts in this week');
  assert.equal(mine.employees[0].days[0].date, '2026-11-22', 'last Friday stays in last week');
  await denied(call(amy, 'weeklyHours', {weekStart: '2026-11-23'}), 'invalid-argument');
  await denied(call(amy, 'weeklyHours', {weekStart: '2026-02-29'}), 'invalid-argument');

  // Only the owners (HR Manager, Assistant HR) edit holidays and mark a year complete.
  const holiday = {date: '2026-11-25', name: 'Test special day', type: 'special_non_working'};
  await denied(call(amy, 'saveHoliday', holiday));
  await denied(call(lead, 'saveHoliday', holiday));
  await denied(call(lead, 'setHolidayYear', {year: 2026, complete: true}));
  await denied(call(ownerA, 'saveHoliday', {...holiday, type: 'local'}), 'invalid-argument');
  await denied(call(ownerA, 'saveHoliday', {...holiday, name: ' '}), 'invalid-argument');
  await denied(call(ownerA, 'saveHoliday', {date: '2026-11-26', active: false}), 'not-found');
  assert.deepEqual(await call(ownerA, 'saveHoliday', holiday), {id: '2026-11-25', revision: 1});
  await denied(call(ownerA, 'saveHoliday', {...holiday, name: 'Renamed'}), 'aborted');
  await denied(call(ownerA, 'setHolidayYear', {year: 2026, complete: 'yes'}), 'invalid-argument');
  assert.deepEqual(await call(ownerA, 'setHolidayYear', {year: 2026, complete: true}), {year: 2026, complete: true, revision: 1});

  // Managers see the whole team. The holiday moves Wednesday into its own bucket.
  const team = await call(lead, 'weeklyHours', week);
  assert.equal(team.team, true);
  assert.equal(team.blocked, false);
  assert.deepEqual(team.issues, []);
  assert.deepEqual(team.employees.map((row) => row.name), ['Amy', 'Owner A']);
  assert.deepEqual(totals(team.employees[0]), [780, 90, 330, 0, 450]);
  assert.deepEqual(totals(team.employees[1]), [300, 0, 0, 0, 0]);
  assert.deepEqual(team.holidays, [{date: '2026-11-25', name: 'Test special day', type: 'special_non_working'}]);

  // Removing the holiday is audited and puts Wednesday back to an ordinary day.
  assert.deepEqual(await call(ownerA, 'saveHoliday', {date: '2026-11-25', active: false, revision: 1}), {id: '2026-11-25', revision: 2});
  mine = await call(amy, 'weeklyHours', week);
  assert.deepEqual(totals(mine.employees[0]), [1230, 90, 330, 0, 0]);
  const listed = await call(amy, 'listHolidays', {year: 2026});
  assert.deepEqual([listed.complete, listed.canEdit, listed.rows.length], [true, false, 0]);
  assert.equal((await call(ownerA, 'listHolidays', {year: 2026})).canEdit, true);
  await denied(call(ownerA, 'saveHoliday', {date: '2026-11-25', active: false}), 'not-found');
  assert.deepEqual(await call(ownerA, 'saveHoliday', {...holiday, type: 'regular'}), {id: '2026-11-25', revision: 3});
  assert.deepEqual(totals((await call(amy, 'weeklyHours', week)).employees[0]), [780, 90, 330, 450, 0]);
  assert.deepEqual(await call(ownerA, 'saveHoliday', {date: '2026-11-25', active: false, revision: 3}), {id: '2026-11-25', revision: 4});
  await denied(call(amy, 'listHolidays', {year: '2026'}), 'invalid-argument');

  // An open clock-in blocks the week and is reported with the employee's name.
  await punch('open', amyId, '2026-11-26T07:00', null);
  const open = await call(ownerA, 'weeklyHours', week);
  assert.equal(open.blocked, true);
  assert.deepEqual(open.issues.map((issue) => [issue.code, issue.employeeName]), [['open', 'Amy']]);

  const audit = await firestore.collection('hrWorkspace/pilot/audit').where('resource', 'in', ['holidays', 'holidayYears']).get();
  assert.equal(audit.size, 5);
  console.log('PASS: HR weekly hours by role, holiday table, year completion, audit and blocking issues.');
} finally {
  await firestore.terminate();
  await deleteApp(app);
}
