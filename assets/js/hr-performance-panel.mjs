// Accaza HR task performance: Management > Performance and the "My performance" card.
// Scores come from the server (functions/lib/hr-performance.js); this only shows them.

const DAY = 86400000;
const manilaToday = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
const shift = (date, days) => new Date(Date.parse(date + "T00:00:00Z") + days * DAY).toISOString().slice(0, 10);
const monthEnd = date => new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7), 0)).toISOString().slice(0, 10);
const OUTCOMES = { on_time: "done on time", late: "done late", done_unknown: "done (time not recorded)", overdue: "overdue", open: "not due yet" };
const PERIODS = [["week", "This pay week"], ["month", "This month"], ["last-month", "Last month"]];

export function periodRange(period, today = manilaToday()) {
  if (period === "week") {
    const start = shift(today, -((new Date(today + "T00:00:00Z").getUTCDay() + 1) % 7));
    return [start, shift(start, 6)];
  }
  const first = today.slice(0, 8) + "01";
  if (period === "last-month") {
    const previous = shift(first, -1);
    return [previous.slice(0, 8) + "01", previous];
  }
  return [first, monthEnd(today)];
}

export function createPerformancePanel(ui) {
  const { entry, formatDay, make, reload, section, selectControl } = ui;
  let period = "month";

  function summary(row) {
    const parts = ["Completed " + row.completed + " of " + row.assigned + (row.completionPct === null ? "" : " (" + row.completionPct + "%)")];
    if (row.onTime + row.late) parts.push("On time " + row.onTime + " of " + (row.onTime + row.late) + " (" + row.onTimePct + "%)");
    if (row.overdue) parts.push("Overdue now " + row.overdue);
    return parts.join(" · ");
  }

  function taskList(row) {
    const details = make("details");
    details.append(make("summary", "Tasks"));
    const list = make("ul", "", "detail");
    list.append(...row.tasks.map(task => make("li", formatDay(task.dueDate) + ": " + task.title + ", " + OUTCOMES[task.outcome])));
    details.append(list);
    return details;
  }

  const view = {
    load: async request => {
      const [from, to] = periodRange(period);
      const meta = await request("performance", { from, to });
      return { rows: meta.people, nextCursor: null, meta };
    },
    intro(meta, current) {
      const label = make("label", "Period");
      const choose = selectControl("period", PERIODS, period);
      choose.addEventListener("change", () => { period = choose.value; reload(current); });
      label.append(choose);
      const total = meta.people.reduce((sum, row) => ({
        assigned: sum.assigned + row.assigned, completed: sum.completed + row.completed,
        onTime: sum.onTime + row.onTime, late: sum.late + row.late, overdue: sum.overdue + row.overdue
      }), { assigned: 0, completed: 0, onTime: 0, late: 0, overdue: 0 });
      return [label, make("p", "Tasks due " + formatDay(meta.from) + " to " + formatDay(meta.to) + ". Team: completed "
        + total.completed + " of " + total.assigned + ", on time " + total.onTime + " of " + (total.onTime + total.late)
        + ", overdue now " + total.overdue + ".", "detail")];
    },
    row(row) {
      const node = entry(row.name);
      node.append(make("p", summary(row), "detail"));
      if (row.timingUnknown) node.append(make("p", row.timingUnknown + " finished before completion times were recorded.", "detail"));
      node.append(taskList(row));
      return node;
    },
    action: () => null,
    affects: []
  };

  function homeCard(home) {
    const row = home.scorecard;
    if (!row?.assigned) return null;
    const card = section("My performance this month");
    card.end.append(make("p", summary(row), "detail"), taskList(row));
    return card.node;
  }

  return { view, homeCard };
}
