"use strict";

// Accaza HR task performance. Pure: no database access.
// Measure (decided 24 Nov 2026): tasks done, on time vs late, overdue now, by due date in a period.
// A task is done when it has steps and all are ticked. On time means completed on or before
// its due date (Manila). Tasks finished before completedAt was recorded count as done with
// unknown timing, never as on time or late.

const MANILA_DATE = new Intl.DateTimeFormat("sv-SE", {timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit"});

function taskOutcome(task, today) {
  const steps = Array.isArray(task.steps) ? task.steps : [];
  const done = steps.length > 0 && steps.every((step) => step.done === true);
  if (done) {
    if (!Number.isSafeInteger(task.completedAt)) return "done_unknown";
    return MANILA_DATE.format(task.completedAt) <= task.dueDate ? "on_time" : "late";
  }
  return task.dueDate < today ? "overdue" : "open";
}

const percent = (part, whole) => whole ? Math.round(part * 100 / whole) : null;

/**
 * tasks: [{id, title, assigneeId, assigneeName, dueDate, status, steps, completedAt}]
 * today: Manila YYYY-MM-DD. Archived tasks are ignored.
 */
function scoreTasks(tasks, today) {
  const people = new Map();
  for (const task of tasks ?? []) {
    if (task?.status !== "active" || typeof task.assigneeId !== "string") continue;
    const outcome = taskOutcome(task, today);
    let row = people.get(task.assigneeId);
    if (!row) {
      row = {id: task.assigneeId, name: task.assigneeName || "Former employee", assigned: 0, completed: 0,
        onTime: 0, late: 0, timingUnknown: 0, overdue: 0, open: 0, tasks: []};
      people.set(task.assigneeId, row);
    }
    row.assigned += 1;
    if (outcome === "on_time") row.onTime += 1;
    else if (outcome === "late") row.late += 1;
    else if (outcome === "done_unknown") row.timingUnknown += 1;
    else row[outcome] += 1;
    if (outcome === "on_time" || outcome === "late" || outcome === "done_unknown") row.completed += 1;
    row.tasks.push({id: task.id, title: task.title, dueDate: task.dueDate, outcome});
  }
  return [...people.values()].map((row) => ({
    ...row,
    completionPct: percent(row.completed, row.assigned),
    onTimePct: percent(row.onTime, row.onTime + row.late),
    tasks: row.tasks.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id)),
  })).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

module.exports = {scoreTasks, taskOutcome};
