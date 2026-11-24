import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const requireFunctions = createRequire(new URL('../functions/package.json', import.meta.url));
const {ROLES, memberRole, canManageWorkspace, isApprover, approvalBlock, APPROVAL_MESSAGES} = requireFunctions('./lib/hr-roles.js');
const {DEFAULT_HOURS_SETTINGS, validateHoursSettings, validateEffectiveFrom, settingsForWeek, isSaturday} = requireFunctions('./lib/hr-settings.js');

// Roles.
assert.deepEqual(ROLES, ['employee', 'hr_manager', 'assistant_hr']);
const hrManager = {id: 'owner-a', active: true, role: 'hr_manager'};
const assistant = {id: 'owner-b', active: true, role: 'assistant_hr'};
const staff = {id: 'staff-1', active: true, role: 'employee'};
const legacyLead = {id: 'lead', active: true, canManage: true};
const legacyStaff = {id: 'old', active: true, canManage: false};

assert.equal(memberRole(hrManager), 'hr_manager');
assert.equal(memberRole(legacyLead), null);
assert.equal(memberRole({role: 'superadmin'}), null, 'portal roles are not HR roles');
assert.equal(canManageWorkspace(hrManager), true);
assert.equal(canManageWorkspace(assistant), true);
assert.equal(canManageWorkspace(staff), false);
assert.equal(canManageWorkspace({...staff, canManage: true}), false, 'an explicit role overrides a stale canManage');
assert.equal(canManageWorkspace(legacyLead), true, 'legacy managers keep workspace access');
assert.equal(canManageWorkspace(legacyStaff), false);
assert.equal(isApprover(hrManager), true);
assert.equal(isApprover(assistant), true);
assert.equal(isApprover(legacyLead), false, 'legacy managers never approve');
assert.equal(isApprover(staff), false);
assert.equal(isApprover({...hrManager, active: false}), false);
assert.equal(isApprover(null), false);

// Approval routing: each owner approves the other, nobody approves themselves.
assert.equal(approvalBlock(hrManager, {subjectId: 'staff-1'}), null);
assert.equal(approvalBlock(assistant, {subjectId: 'owner-a'}), null, 'assistant approves the HR Manager');
assert.equal(approvalBlock(hrManager, {subjectId: 'owner-b'}), null, 'HR Manager approves the assistant');
assert.equal(approvalBlock(hrManager, {subjectId: 'owner-a'}), 'own_record');
assert.equal(approvalBlock(assistant, {initiatorId: 'owner-b'}), 'own_proposal');
assert.equal(approvalBlock(assistant, {initiatorId: 'owner-a'}), null);
assert.equal(approvalBlock(staff, {subjectId: 'owner-a'}), 'not_approver');
assert.equal(approvalBlock(legacyLead, {subjectId: 'staff-1'}), 'not_approver');
assert.equal(approvalBlock(hrManager, {subjectId: 'owner-a', initiatorId: 'owner-b'}), 'own_record');
assert.equal(approvalBlock(hrManager), null);
for (const code of ['not_approver', 'own_record', 'own_proposal']) assert.ok(APPROVAL_MESSAGES[code]);

// Settings validation.
assert.deepEqual(validateHoursSettings({...DEFAULT_HOURS_SETTINGS}), {...DEFAULT_HOURS_SETTINGS});
assert.equal(Object.isFrozen(DEFAULT_HOURS_SETTINGS), true);
const good = {dailyRegularMin: 480, breakThresholdMin: 360, breakDeductMin: 60, restDay: 1, longShiftFlagMin: 720};
assert.deepEqual(validateHoursSettings(good), good);
for (const bad of [
  null, [], 'x',
  {...good, extra: 1},
  {...good, dailyRegularMin: 0},
  {...good, dailyRegularMin: 1441},
  {...good, breakDeductMin: -1},
  {...good, breakDeductMin: 241},
  {...good, breakThresholdMin: 30, breakDeductMin: 60},
  {...good, restDay: 7},
  {...good, restDay: '0'},
  {...good, longShiftFlagMin: 59},
  {...good, dailyRegularMin: 480.5},
  (({restDay, ...rest}) => rest)(good),
]) {
  assert.throws(() => validateHoursSettings(bad), RangeError, JSON.stringify(bad));
}

// Effective dates: a Saturday, never before the earliest allowed week.
assert.equal(isSaturday('2026-11-28'), true);
assert.equal(isSaturday('2026-11-29'), false);
assert.equal(isSaturday('2026-02-30'), false);
assert.equal(validateEffectiveFrom('2026-11-28', '2026-11-21'), '2026-11-28');
assert.equal(validateEffectiveFrom('2026-11-21', '2026-11-21'), '2026-11-21');
assert.throws(() => validateEffectiveFrom('2026-11-14', '2026-11-21'), /cannot take effect before 2026-11-21/);
assert.throws(() => validateEffectiveFrom('2026-11-23', '2026-11-21'), /Saturday/);
assert.throws(() => validateEffectiveFrom('2026-11-28', '2026-11-23'), /Earliest/);

// Version resolution: approved only, latest effective date on or before the week.
const v = (id, status, effectiveFrom, decidedAt, values = good) => ({id, status, effectiveFrom, decidedAt, values});
const versions = [
  v('a', 'approved', '2026-11-07', 10, {...good, dailyRegularMin: 420}),
  v('b', 'approved', '2026-11-21', 20, {...good, dailyRegularMin: 450}),
  v('c', 'proposed', '2026-11-14', 30, {...good, dailyRegularMin: 300}),
  v('d', 'rejected', '2026-11-14', 40, {...good, dailyRegularMin: 200}),
  v('e', 'approved', '2026-12-05', 50, {...good, dailyRegularMin: 500}),
  v('f', 'approved', '2026-11-21', 60, {...good, dailyRegularMin: 470}),
];
assert.deepEqual(settingsForWeek(versions, '2026-10-31'), {versionId: 'default', effectiveFrom: null, values: {...DEFAULT_HOURS_SETTINGS}});
assert.equal(settingsForWeek(versions, '2026-11-07').values.dailyRegularMin, 420);
assert.equal(settingsForWeek(versions, '2026-11-14').versionId, 'a', 'proposed and rejected versions never apply');
assert.equal(settingsForWeek(versions, '2026-11-21').versionId, 'f', 'same effective date: the later decision wins');
assert.equal(settingsForWeek(versions, '2026-11-28').values.dailyRegularMin, 470);
assert.equal(settingsForWeek(versions, '2026-12-05').values.dailyRegularMin, 500);
assert.deepEqual(settingsForWeek([], '2026-11-21').values, {...DEFAULT_HOURS_SETTINGS});
assert.throws(() => settingsForWeek([v('x', 'approved', '2026-11-07', 1, {dailyRegularMin: 0})], '2026-11-21'), RangeError,
  'a corrupt stored version fails loudly instead of paying on bad settings');
const defaults = settingsForWeek([], '2026-11-21');
defaults.values.dailyRegularMin = 1;
assert.equal(DEFAULT_HOURS_SETTINGS.dailyRegularMin, 480, 'callers cannot mutate the defaults');

console.log('hr-roles-settings-check: all assertions passed');
