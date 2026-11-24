import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const requireFunctions = createRequire(new URL('../functions/package.json', import.meta.url));
const {computeWeekHours, payWeekStart, manilaDate} = requireFunctions('./lib/hr-hours.js');

const at = (local) => Date.parse(local + ':00+08:00');
const settings = {dailyRegularMin: 480, breakThresholdMin: 300, breakDeductMin: 30};
const week = '2026-11-21';
let seq = 0;
const rec = (employeeId, from, to, id = 'r' + ++seq) => ({id, employeeId, inAt: at(from), outAt: to === null ? null : at(to)});
const run = (records, extra = {}) => computeWeekHours({weekStart: week, records, holidays: [], holidayYears: [2026], settings, ...extra});
const totals = (row) => ({regularMin: row.regularMin, dailyOtMin: row.dailyOtMin, sundayMin: row.sundayMin,
  regularHolidayMin: row.regularHolidayMin, specialHolidayMin: row.specialHolidayMin});
const zero = {regularMin: 0, dailyOtMin: 0, sundayMin: 0, regularHolidayMin: 0, specialHolidayMin: 0};

// Pay week and Manila dates.
assert.equal(payWeekStart('2026-11-21'), '2026-11-21');
assert.equal(payWeekStart('2026-11-22'), '2026-11-21');
assert.equal(payWeekStart('2026-11-27'), '2026-11-21');
assert.equal(payWeekStart('2026-11-28'), '2026-11-28');
assert.equal(manilaDate(Date.parse('2026-11-22T16:30:00Z')), '2026-11-23', 'Manila is UTC+8');

// Spec section 4 worked examples, one employee.
{
  const result = run([
    rec('amy', '2026-11-23T07:00', '2026-11-23T17:00'), // Mon 600 gross, 570 paid: 480 + 90 OT
    rec('amy', '2026-11-22T08:00', '2026-11-22T14:00'), // Sun 360 gross, 330 Sunday
    rec('amy', '2026-11-27T22:00', '2026-11-28T06:00'), // Fri night into Sat: 450 regular on Friday
    rec('amy', '2026-11-25T06:00', '2026-11-25T10:00'), // Wed 240, no break
    rec('amy', '2026-11-24T06:00', '2026-11-24T11:00'), // Tue 300 exactly, no break
    rec('amy', '2026-11-24T15:00', '2026-11-24T21:00'), // Tue 360, 330 paid: day 630 = 480 + 150 OT
  ]);
  assert.equal(result.blocked, false);
  assert.deepEqual(result.issues, []);
  const [amy] = result.employees;
  assert.deepEqual(totals(amy), {...zero, regularMin: 1650, dailyOtMin: 240, sundayMin: 330});
  assert.equal(amy.paidMin, 2220);
  assert.equal(amy.grossMin, 2340);
  assert.equal(amy.breakMin, 120);
  assert.deepEqual(amy.days.map((day) => [day.date, day.dayType, day.paidMin]), [
    ['2026-11-22', 'sunday', 330], ['2026-11-23', 'ordinary', 570], ['2026-11-24', 'ordinary', 630],
    ['2026-11-25', 'ordinary', 240], ['2026-11-27', 'ordinary', 450],
  ]);
}

// Break threshold boundary: 300 has no deduction, 301 does.
{
  const result = run([rec('ben', '2026-11-23T08:00', '2026-11-23T13:00'), rec('cy', '2026-11-23T08:00', '2026-11-23T13:01')]);
  assert.equal(result.employees[0].paidMin, 300);
  assert.equal(result.employees[1].paidMin, 271);
}

// Holiday types. Regular holiday on a Sunday counts once, as holiday.
{
  const holidays = [
    {date: '2026-11-22', type: 'regular'},
    {date: '2026-11-23', type: 'special_non_working'},
    {date: '2026-11-24', type: 'special_working'},
  ];
  const result = run([
    rec('dee', '2026-11-22T08:00', '2026-11-22T14:00'),
    rec('dee', '2026-11-23T07:00', '2026-11-23T17:00'),
    rec('dee', '2026-11-24T07:00', '2026-11-24T17:00'),
  ], {holidays});
  const [dee] = result.employees;
  assert.deepEqual(totals(dee), {...zero, regularHolidayMin: 330, specialHolidayMin: 570, regularMin: 480, dailyOtMin: 90});
  assert.deepEqual(dee.days.map((day) => day.dayType), ['regular_holiday', 'special_holiday', 'ordinary']);
}

// Blocking issues: open, invalid duration, overlap, conflicting duplicate.
{
  const result = run([
    rec('eve', '2026-11-23T07:00', null, 'open-1'),
    rec('eve', '2026-11-24T10:00', '2026-11-24T10:00', 'bad-1'),
    rec('fay', '2026-11-25T07:00', '2026-11-25T12:00', 'ov-1'),
    rec('fay', '2026-11-25T11:00', '2026-11-25T15:00', 'ov-2'),
    rec('gus', '2026-11-26T07:00', '2026-11-26T12:00', 'dup-1'),
    rec('gus', '2026-11-26T07:00', '2026-11-26T12:00', 'dup-1'),
    rec('gus', '2026-11-26T07:00', '2026-11-26T13:00', 'dup-1'),
  ]);
  assert.equal(result.blocked, true);
  assert.deepEqual(result.issues.map((item) => [item.code, item.recordId, item.blocking]), [
    ['duplicate_conflict', 'dup-1', true], ['invalid_duration', 'bad-1', true],
    ['open', 'open-1', true], ['overlap', 'ov-2', true],
  ]);
  assert.equal(result.employees.find((row) => row.employeeId === 'gus').paidMin, 300, 'identical duplicate counted once');
  assert.equal(result.employees.some((row) => row.employeeId === 'eve'), false, 'open and invalid records add no hours');
}

// Over 16 hours is flagged for review, not blocking, and still counted.
{
  const result = run([rec('hal', '2026-11-23T06:00', '2026-11-23T23:00', 'long-1')]);
  assert.deepEqual(result.issues.map((item) => [item.code, item.blocking]), [['over_16h', false]]);
  assert.equal(result.blocked, false);
  assert.deepEqual(totals(result.employees[0]), {...zero, regularMin: 480, dailyOtMin: 510});
}

// Records whose Manila start date is outside the week are ignored.
{
  const result = run([rec('ivy', '2026-11-28T07:00', '2026-11-28T15:00'), rec('ivy', '2026-11-20T23:00', '2026-11-21T07:00')]);
  assert.deepEqual(result.employees, []);
}

// Holiday table must be loaded for every year the week touches.
{
  assert.deepEqual(run([], {holidayYears: []}).issues.map((item) => [item.code, item.year]), [['holidays_not_loaded', 2026]]);
  const span = computeWeekHours({weekStart: '2026-12-26', records: [], holidays: [], holidayYears: [2026], settings});
  assert.equal(span.weekEnd, '2027-01-01');
  assert.deepEqual(span.issues.map((item) => [item.code, item.year]), [['holidays_not_loaded', 2027]]);
  assert.equal(span.blocked, true);
}

// Invalid input is rejected outright.
assert.throws(() => run([], {weekStart: '2026-11-23'}), /Saturday/);
assert.throws(() => run([], {weekStart: '2026-02-30'}), /real calendar date/);
assert.throws(() => run([], {settings: {...settings, breakDeductMin: 301}}), /cannot exceed/);
assert.throws(() => run([], {settings: {...settings, dailyRegularMin: 0}}), /dailyRegularMin/);
assert.throws(() => run([], {settings: {...settings, breakDeductMin: 1.5}}), /breakDeductMin/);
assert.throws(() => run([], {holidays: [{date: '2026-11-23', type: 'local'}]}), /unknown type/);
assert.throws(() => run([], {holidays: [{date: '2026-11-23', type: 'regular'}, {date: '2026-11-23', type: 'special_non_working'}]}), /two different types/);
assert.throws(() => run([{id: 'x', employeeId: 'a', inAt: 1.5, outAt: null}]), /clock-in/);
assert.throws(() => run([{id: '', employeeId: 'a', inAt: at('2026-11-23T07:00'), outAt: null}]), /needs an id/);

// Every result keeps integer minutes and buckets that sum to paid minutes.
{
  const result = run([
    rec('jo', '2026-11-22T07:00', '2026-11-22T19:00'),
    rec('jo', '2026-11-23T07:00:59'.slice(0, 16), '2026-11-23T15:07'),
    rec('kim', '2026-11-26T05:00', '2026-11-26T20:30'),
  ]);
  for (const row of result.employees) {
    for (const value of [...Object.values(totals(row)), row.paidMin, row.grossMin, row.breakMin]) assert.ok(Number.isSafeInteger(value) && value >= 0);
    const sum = Object.values(totals(row)).reduce((a, b) => a + b, 0);
    assert.equal(sum, row.paidMin);
  }
}

// Sub-minute remainders are truncated to whole minutes.
{
  const result = computeWeekHours({weekStart: week, holidays: [], holidayYears: [2026], settings,
    records: [{id: 's1', employeeId: 'lu', inAt: at('2026-11-23T07:00'), outAt: at('2026-11-23T08:00') + 59999}]});
  assert.equal(result.employees[0].paidMin, 60);
}

console.log('hr-hours-check: all assertions passed');
