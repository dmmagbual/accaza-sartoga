// Accaza HR weekly hours (with CSV export) and the holiday table.
// Totals come from the server engine (functions/lib/hr-hours.js); this only shows and exports them.

const DAY = 86400000;
const manilaToday = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
const shift = (date, days) => new Date(Date.parse(date + "T00:00:00Z") + days * DAY).toISOString().slice(0, 10);
const saturdayOf = date => shift(date, -((new Date(date + "T00:00:00Z").getUTCDay() + 1) % 7));
const BUCKETS = [["regularMin", "Regular"], ["dailyOtMin", "Daily overtime"], ["restDayMin", "Rest day"],
  ["regularHolidayMin", "Regular holiday"], ["specialHolidayMin", "Special non-working day"]];
const TYPES = { regular: "Regular holiday", special_non_working: "Special non-working day", special_working: "Special working day (ordinary pay)" };
const ISSUES = {
  open: "clock-in without a clock-out", invalid_duration: "clock-out not after clock-in", overlap: "overlapping shifts",
  duplicate_conflict: "conflicting duplicate record", long_shift: "long shift, please check"
};

function minutes(total) {
  const h = Math.floor(total / 60), m = total % 60;
  return h ? h + " h" + (m ? " " + m + " min" : "") : m + " min";
}

function csvCell(value) {
  let text = String(value ?? "");
  if (/^\s*[=+\-@\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}

export function createHoursPanels(ui) {
  const { button, describeSettings, entry, field, formatDay, make, openEditor, reload, save, selectControl, textControl } = ui;
  // Default to the last finished pay week: the one an owner checks on Saturday morning.
  let week = shift(saturdayOf(manilaToday()), -7);
  let year = Number(manilaToday().slice(0, 4));

  function issueText(issue) {
    if (issue.code === "holidays_not_loaded") return "The " + issue.year + " holiday list is not marked complete (Management > Holidays).";
    return (issue.employeeName || "Unknown") + ": " + (ISSUES[issue.code] || issue.code) + ".";
  }

  function exportCsv(meta) {
    const status = meta.blocked ? "Has issues to fix" : "Provisional (week not locked)";
    const head = ["Week start", "Week end", "Status", "Employee", "Employee ID", ...BUCKETS.map(([, label]) => label + " hours"),
      "Paid hours", "Paid minutes", "Break hours", "Settings version"];
    const lines = meta.employees.map(row => [meta.weekStart, meta.weekEnd, status, row.name, row.employeeId,
      ...BUCKETS.map(([key]) => (row[key] / 60).toFixed(2)), (row.paidMin / 60).toFixed(2), row.paidMin,
      (row.breakMin / 60).toFixed(2), meta.settings.versionId]);
    const text = [head, ...lines].map(line => line.map(csvCell).join(",")).join("\r\n");
    const link = make("a");
    link.href = URL.createObjectURL(new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" }));
    link.download = "accaza-hours-" + meta.weekStart + ".csv";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 0);
  }

  const hours = {
    load: async request => {
      const meta = await request("weeklyHours", { weekStart: week });
      return { rows: meta.employees.map(row => ({ ...row, id: row.employeeId })), nextCursor: null, meta };
    },
    intro(meta, current) {
      const nav = make("div", "", "fields");
      const go = days => () => { week = shift(week, days); reload(current); };
      nav.append(button("Previous week", go(-7)), make("p", formatDay(meta.weekStart) + " to " + formatDay(meta.weekEnd)),
        button("Next week", go(7)));
      const nodes = [nav];
      if (meta.employees.length) nodes.push(button("Download CSV", () => exportCsv(meta)));
      nodes.push(make("p", meta.blocked ? "Fix these before the week is closed:" : "No blocking issues this week.", "detail"));
      if (meta.issues.length) {
        const list = make("ul", "", "detail");
        list.append(...meta.issues.map(issue => make("li", issueText(issue))));
        nodes.push(list);
      }
      for (const day of meta.holidays) nodes.push(make("p", "Holiday: " + formatDay(day.date) + ", " + day.name + " (" + TYPES[day.type] + ")", "detail"));
      const settings = make("details");
      settings.append(make("summary", meta.settings.effectiveFrom ? "Settings in force from " + formatDay(meta.settings.effectiveFrom) : "Starting default settings"));
      const list = make("ul", "", "detail");
      list.append(...describeSettings(meta.settings.values).map(line => make("li", line)));
      settings.append(list);
      nodes.push(settings);
      if (!meta.team) nodes.push(make("p", "These are your own hours. Managers see the whole team.", "detail"));
      return nodes;
    },
    row(row) {
      const node = entry(row.name);
      node.append(make("p", "Paid " + minutes(row.paidMin) + " (unpaid breaks " + minutes(row.breakMin) + ")", "detail"));
      const parts = BUCKETS.filter(([key]) => row[key]).map(([key, label]) => label + " " + minutes(row[key]));
      node.append(make("p", parts.join(" · ") || "No hours", "detail"));
      return node;
    },
    action: () => null,
    affects: []
  };

  function editHoliday(current, row) {
    const date = textControl("date", row?.date, { type: "date" });
    if (row) date.readOnly = true;
    openEditor(current, row ? "Edit holiday" : "Add holiday", [
      field("Date", date),
      field("Name", textControl("name", row?.name, { maxLength: 120 })),
      field("Type", selectControl("type", Object.entries(TYPES), row?.type || "regular"))
    ], data => ({
      resource: "holidays",
      args: ["saveHoliday", { date: data.get("date"), name: data.get("name"), type: data.get("type"), ...(row && { revision: row.revision }) }]
    }), document.activeElement);
  }

  function removeHoliday(current, row) {
    openEditor(current, "Remove holiday", [make("p", "Remove " + row.name + " on " + formatDay(row.date) + "? Hours for that day become ordinary.")],
      () => ({ resource: "holidays", args: ["saveHoliday", { date: row.date, active: false, revision: row.revision }] }),
      document.activeElement, "Remove");
  }

  const holidays = {
    load: async request => {
      const meta = await request("listHolidays", { year });
      return { rows: meta.rows, nextCursor: null, meta };
    },
    intro(meta, current) {
      const nav = make("div", "", "fields");
      const go = step => () => { year += step; reload(current); };
      nav.append(button("Previous year", go(-1)), make("p", String(meta.year)), button("Next year", go(1)));
      const nodes = [nav, make("p", "Check each year against the official proclamation. Eid holidays are proclaimed separately.", "detail"),
        make("p", meta.complete ? "The " + meta.year + " list is marked complete." : "The " + meta.year + " list is not complete. Weeks in "
          + meta.year + " cannot be closed until it is.", "detail")];
      if (meta.canEdit) {
        nodes.push(button(meta.complete ? "Mark as incomplete" : "Mark " + meta.year + " complete", () => save(current, "holidays",
          "setHolidayYear", { year: meta.year, complete: !meta.complete, revision: meta.yearRevision })));
      }
      return nodes;
    },
    row(row, current, meta) {
      const node = entry(formatDay(row.date) + ": " + row.name);
      node.append(make("p", TYPES[row.type], "detail"));
      if (meta?.canEdit) node.append(button("Edit", () => editHoliday(current, row)), button("Remove", () => removeHoliday(current, row)));
      return node;
    },
    action: (current, meta) => meta?.canEdit ? button("Add holiday", () => editHoliday(current), true) : null,
    affects: ["hours"]
  };

  return { hours, holidays };
}
