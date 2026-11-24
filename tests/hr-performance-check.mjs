import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const requireFunctions = createRequire(new URL('../functions/package.json', import.meta.url));
const {scoreTasks, taskOutcome} = requireFunctions('./lib/hr-performance.js');

const at = (local) => Date.parse(local + ':00+08:00');
const done = [{id: 's', title: 'x', done: true}];
const open = [{id: 's', title: 'x', done: false}];
const task = (id, assigneeId, dueDate, steps, completedAt, extra = {}) =>
  ({id, title: 'Task ' + id, assigneeId, assigneeName: assigneeId.toUpperCase(), dueDate, status: 'active', steps, completedAt, ...extra});
const today = '2026-11-24';

// Outcomes. On time is judged by the Manila date of completion.
assert.equal(taskOutcome(task('a', 'amy', '2026-11-20', done, at('2026-11-20T23:59')), today), 'on_time');
assert.equal(taskOutcome(task('a', 'amy', '2026-11-20', done, at('2026-11-21T00:01')), today), 'late');
assert.equal(taskOutcome(task('a', 'amy', '2026-11-20', done, Date.parse('2026-11-20T16:30:00Z')), today), 'late', 'UTC 16:30 is Manila 00:30 next day');
assert.equal(taskOutcome(task('a', 'amy', '2026-11-20', done, null), today), 'done_unknown');
assert.equal(taskOutcome(task('a', 'amy', '2026-11-23', open, null), today), 'overdue');
assert.equal(taskOutcome(task('a', 'amy', '2026-11-24', open, null), today), 'open', 'due today is not overdue yet');
assert.equal(taskOutcome(task('a', 'amy', '2026-11-20', [], null), today), 'overdue', 'a task with no steps is never done');

// Scorecard per person, archived tasks ignored, sorted by name.
const people = scoreTasks([
  task('1', 'amy', '2026-11-20', done, at('2026-11-19T10:00')),
  task('2', 'amy', '2026-11-21', done, at('2026-11-22T10:00')),
  task('3', 'amy', '2026-11-22', done, null),
  task('4', 'amy', '2026-11-23', open, null),
  task('5', 'amy', '2026-11-30', open, null),
  task('6', 'amy', '2026-11-30', done, at('2026-11-23T10:00'), {status: 'archived'}),
  task('7', 'ben', '2026-11-25', open, null),
], today);
assert.deepEqual(people.map((row) => row.name), ['AMY', 'BEN']);
const [amy, ben] = people;
assert.deepEqual(
  [amy.assigned, amy.completed, amy.onTime, amy.late, amy.timingUnknown, amy.overdue, amy.open, amy.completionPct, amy.onTimePct],
  [5, 3, 1, 1, 1, 1, 1, 60, 50]);
assert.deepEqual(amy.tasks.map((row) => [row.id, row.outcome]),
  [['1', 'on_time'], ['2', 'late'], ['3', 'done_unknown'], ['4', 'overdue'], ['5', 'open']]);
assert.deepEqual([ben.assigned, ben.completionPct, ben.onTimePct], [1, 0, null], 'no on-time % without completed, timed tasks');
assert.deepEqual(scoreTasks([], today), []);
assert.deepEqual(scoreTasks([{status: 'active'}, null], today), [], 'malformed rows are skipped');

console.log('hr-performance-check: all assertions passed');

// Client period ranges (Manila dates): pay week Saturday-Friday, this month, last month.
const {periodRange} = await import('../assets/js/hr-performance-panel.mjs');
assert.deepEqual(periodRange('week', '2026-11-24'), ['2026-11-21', '2026-11-27']);
assert.deepEqual(periodRange('week', '2026-11-21'), ['2026-11-21', '2026-11-27']);
assert.deepEqual(periodRange('week', '2026-11-27'), ['2026-11-21', '2026-11-27']);
assert.deepEqual(periodRange('month', '2026-02-10'), ['2026-02-01', '2026-02-28']);
assert.deepEqual(periodRange('last-month', '2026-01-15'), ['2025-12-01', '2025-12-31']);
console.log('hr-performance-check: period ranges passed');
