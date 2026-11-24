// Accaza HR management panels: employee roles and the hours settings screen.
// Rules live on the server (functions/lib/hr-roles.js, hr-settings.js); these only collect and show them.

const roleLabels = { employee: "Employee", hr_manager: "HR Manager", assistant_hr: "Assistant HR" };

export function createAdminPanels(ui) {
  const { button, checkboxControl, entry, field, formatDay, make, newId, openEditor, selectControl, textArea, textControl } = ui;

  function memberRow(row, current, editRecord) {
    const node = entry(row.name, row.active ? "active" : "inactive");
    const label = roleLabels[row.role] || (row.canManage ? "Manager (no approval rights)" : "");
    if (label) node.append(make("p", label, "detail"));
    node.append(button("Edit access", () => editRecord(current, "members", row)));
    return node;
  }

  function memberEditor(row, existing, identifiers) {
    // Members enrolled before roles keep their access until a role is chosen.
    const legacy = existing && !row.role && row.canManage;
    const fields = [
      ...(!existing ? [field("Accaza account email", textControl("email", "", { type: "email", maxLength: 320 }))] : []),
      field("Display name", textControl("name", row?.name, { maxLength: 100 })),
      field("HR access active", checkboxControl("active", row?.active ?? true)),
      field("HR role", selectControl("role", [
        ...(legacy ? [["legacy", "Manager (no approval rights)"]] : []),
        ...Object.entries(roleLabels)
      ], row?.role || (legacy ? "legacy" : "employee")))
    ];
    const saveDetails = data => ["saveMember", {
      ...(existing ? identifiers : { email: data.get("email") }),
      name: data.get("name"), active: data.has("active"),
      ...(data.get("role") === "legacy" ? { canManage: true } : { role: data.get("role") })
    }];
    return { fields, saveDetails };
  }

  const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  function formatMinutes(total) {
    const hours = Math.floor(total / 60);
    const minutes = total % 60;
    if (!hours) return minutes + " min";
    return hours + " h" + (minutes ? " " + minutes + " min" : "");
  }

  function describeSettings(values) {
    return [
      "Unpaid break: " + (values.breakDeductMin
        ? formatMinutes(values.breakDeductMin) + " on shifts longer than " + formatMinutes(values.breakThresholdMin)
        : "none"),
      "Regular hours per day: " + formatMinutes(values.dailyRegularMin) + ", then daily overtime",
      "Rest day: " + weekdays[values.restDay],
      "Flag shifts longer than " + formatMinutes(values.longShiftFlagMin) + " for review"
    ];
  }

  function settingsList(values) {
    const list = make("ul", "", "detail");
    list.append(...describeSettings(values).map(line => make("li", line)));
    return list;
  }

  function settingsIntro(meta) {
    if (!meta) return [];
    const from = meta.current.effectiveFrom ? "Approved, in force since " + formatDay(meta.current.effectiveFrom) + "." : "Starting defaults. No change has been approved yet.";
    const nodes = [make("h3", "In force this pay week"), make("p", from, "detail"), settingsList(meta.current.values)];
    nodes.push(make("p", meta.canApprove
      ? "Changes need the other approver's agreement and start on a Saturday, from " + formatDay(meta.earliest) + " onwards."
      : "Only the HR Manager or Assistant HR can propose or approve changes.", "detail"));
    return nodes;
  }

  function settingsRow(row, current, meta) {
    const node = entry("From " + formatDay(row.effectiveFrom), row.status);
    node.append(settingsList(row.values));
    node.append(make("p", "Reason: " + row.reason, "detail"));
    node.append(make("p", "Proposed by " + row.proposedByName + (row.decidedByName
      ? "; " + (row.status === "approved" ? "approved" : "rejected") + " by " + row.decidedByName : ""), "detail"));
    if (row.status === "proposed" && meta?.canApprove && row.proposedBy !== current.home.member?.id) {
      node.append(button("Review", () => decideSettings(current, row)));
    } else if (row.status === "proposed" && row.proposedBy === current.home.member?.id) {
      node.append(make("p", "Waiting for the other approver.", "detail"));
    }
    return node;
  }

  function numberControl(name, value, { min, max, step }) {
    const control = textControl(name, value, { type: "number" });
    Object.assign(control, { min: String(min), max: String(max), step: String(step) });
    return control;
  }

  function nextSaturdayAfter(date) {
    const day = new Date(date + "T00:00:00Z");
    day.setUTCDate(day.getUTCDate() + 7);
    return day.toISOString().slice(0, 10);
  }

  function hoursToMinutes(value, label) {
    const minutes = Math.round(Number(value) * 60);
    if (!Number.isSafeInteger(minutes) || Math.abs(Number(value) * 60 - minutes) > 1e-6) {
      throw new Error(label + " must be in whole minutes.");
    }
    return minutes;
  }

  function proposeSettings(current, meta) {
    const values = meta.current.values;
    const requestId = newId();
    const date = textControl("effectiveFrom", nextSaturdayAfter(meta.earliest), { type: "date" });
    date.min = meta.earliest;
    openEditor(current, "Propose hours settings", [
      field("Takes effect from (a Saturday)", date),
      field("Unpaid break (minutes)", numberControl("breakDeductMin", values.breakDeductMin, { min: 0, max: 240, step: 5 })),
      field("Deduct the break on shifts longer than (hours)", numberControl("breakThresholdHours", values.breakThresholdMin / 60, { min: 0, max: 24, step: 0.25 })),
      field("Regular hours per day before overtime", numberControl("dailyRegularHours", values.dailyRegularMin / 60, { min: 0.25, max: 24, step: 0.25 })),
      field("Rest day", selectControl("restDay", weekdays.map((name, index) => [String(index), name]), String(values.restDay))),
      field("Flag shifts longer than (hours)", numberControl("longShiftFlagHours", values.longShiftFlagMin / 60, { min: 1, max: 24, step: 0.25 })),
      field("Reason for the change", textArea("reason", "", 500, true))
    ], data => {
      const effectiveFrom = data.get("effectiveFrom");
      if (new Date(effectiveFrom + "T00:00:00Z").getUTCDay() !== 6) throw new Error("Choose a Saturday, the first day of a pay week.");
      return {
        resource: "settings",
        args: ["proposeHoursSettings", {
          requestId, effectiveFrom, reason: data.get("reason"),
          values: {
            breakDeductMin: Number(data.get("breakDeductMin")),
            breakThresholdMin: hoursToMinutes(data.get("breakThresholdHours"), "Break threshold"),
            dailyRegularMin: hoursToMinutes(data.get("dailyRegularHours"), "Regular hours"),
            restDay: Number(data.get("restDay")),
            longShiftFlagMin: hoursToMinutes(data.get("longShiftFlagHours"), "Long-shift flag")
          }
        }]
      };
    }, document.activeElement, "Send for approval");
  }

  function decideSettings(current, row) {
    openEditor(current, "Review hours settings", [
      make("p", "Proposed by " + row.proposedByName + ", to take effect from " + formatDay(row.effectiveFrom) + ".", "detail"),
      settingsList(row.values),
      make("p", "Reason: " + row.reason, "detail"),
      field("Decision", selectControl("decision", [["approve", "Approve"], ["reject", "Reject"]], "approve"))
    ], data => ({
      resource: "settings",
      args: ["decideHoursSettings", { id: row.id, decision: data.get("decision"), revision: row.revision }]
    }), document.activeElement, "Confirm");
  }

  return { memberRow, memberEditor, intro: settingsIntro, row: settingsRow, propose: proposeSettings };
}
