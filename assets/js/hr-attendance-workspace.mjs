const attendanceOffset = 8 * 60 * 60 * 1000;
const attendanceTime = new Intl.DateTimeFormat("en-PH", {
  dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila"
});

function manilaToday() {
  return new Date(Date.now() + attendanceOffset).toISOString().slice(0, 10);
}

export function createAttendanceWorkspace(ui) {
  const { allowed, button, entries, entry, errorMessage, field, formatDay, make, manilaInput,
    manilaTimestamp, message, newId, openEditor, render, request, rosterField,
    rosterForEditor, save, section, textArea, textControl } = ui;
  const attendance = new WeakMap();

  function dataFor(current) {
    if (!attendance.has(current)) {
      attendance.set(current, { tab: "personal", date: manilaToday(), pages: new Map(), loads: new Map() });
    }
    return attendance.get(current);
  }

  function clearPairing(current) {
    const feature = attendance.get(current);
    if (!feature) return;
    clearTimeout(feature.expiryTimer);
    feature.pairing = null;
  }

  function reset(current) {
    if (!current) return;
    clearPairing(current);
    const feature = attendance.get(current);
    feature?.pages.clear();
    feature?.loads.clear();
  }

  function isViewing(current) {
    return allowed(current) && current.route === "attendance";
  }

  function pageKey(feature) {
    return feature.tab === "team" ? "team/" + feature.date : feature.tab;
  }

  async function load(current, more = false) {
    if (!isViewing(current)) return;
    const feature = dataFor(current);
    if (feature.tab === "setup") return;
    const key = pageKey(feature);
    const previous = feature.pages.get(key);
    if (feature.loads.has(key) || (more ? !previous?.nextCursor : previous)) return;
    const scope = feature.tab;
    const date = feature.date;
    const ticket = Symbol(key);
    feature.loads.set(key, ticket);
    message("workspace-status", "Loading attendance…");
    message("workspace-error", "");
    try {
      const page = await request("listAttendance", {
        scope, ...(scope === "team" && { date }),
        ...(more && { cursor: previous.nextCursor })
      });
      if (!isViewing(current) || feature.loads.get(key) !== ticket || pageKey(feature) !== key) return;
      const rows = new Map((more ? previous.rows : []).map(row => [row.id, row]));
      for (const row of page.rows || []) rows.set(row.id, row);
      if (scope === "team") {
        for (const cached of feature.pages.keys()) {
          if (cached.startsWith("team/") && cached !== key) feature.pages.delete(cached);
        }
      }
      feature.pages.set(key, { rows: [...rows.values()], nextCursor: page.nextCursor || null });
      render(current);
    } catch (error) {
      if (isViewing(current) && pageKey(feature) === key) {
        message("workspace-error", errorMessage(error, "Could not load attendance. Select Refresh to retry."));
      }
    } finally {
      if (feature.loads.get(key) === ticket) feature.loads.delete(key);
      if (isViewing(current) && pageKey(feature) === key) message("workspace-status", "");
    }
  }

  function selectTab(current, tab) {
    const feature = dataFor(current);
    if (!isViewing(current) || feature.tab === tab) return;
    clearPairing(current);
    feature.tab = tab;
    message("workspace-status", "");
    message("workspace-error", "");
    render(current);
    void load(current);
  }

  function pinControl(name) {
    const input = textControl(name, "", { type: "password" });
    input.inputMode = "numeric";
    input.autocomplete = "off";
    input.pattern = "[0-9]{6}";
    input.minLength = 6;
    input.maxLength = 6;
    return input;
  }

  function editPin(current) {
    const first = pinControl("pin");
    const second = pinControl("repeatPin");
    openEditor(current, "Set attendance PIN", [
      make("p", "Use six digits. Keep your PIN private and enter it when you use the shop tablet.", "detail"),
      field("New six-digit PIN", first), field("Confirm PIN", second)
    ], values => {
      const pin = values.get("pin");
      first.value = "";
      second.value = "";
      if (!/^[0-9]{6}$/.test(pin) || pin !== values.get("repeatPin")) {
        first.focus();
        throw new Error("Enter the same six-digit PIN in both fields.");
      }
      return { resource: "attendance", args: ["setAttendancePin", { pin }] };
    }, document.activeElement);
  }

  function formatPunch(at) {
    return Number.isFinite(at) ? attendanceTime.format(at) : "—";
  }

  function punchRow(current, row, team) {
    const node = entry(team ? (row.employeeName || "Employee") : formatDay(row.date));
    const start = make("p", "Clock in · " + formatPunch(row.inAt), "detail");
    const end = make("p", "Clock out · " + (row.outAt ? formatPunch(row.outAt) : "Open"), "detail");
    node.append(start, end);
    if (row.corrected) node.append(make("p", "Manager correction", "detail"));
    if (team && current.home.member?.canManage) {
      node.append(button("Correct attendance", () => void editCorrection(current, row)));
    }
    return node;
  }

  async function editCorrection(current, row = null) {
    if (!isViewing(current) || !current.home.member?.canManage) return;
    const trigger = document.activeElement;
    const tab = dataFor(current).tab;
    const fields = [];
    if (row) {
      fields.push(make("p", row.employeeName || "Employee", "detail"));
    } else {
      try {
        const roster = await rosterForEditor(current);
        if (!isViewing(current) || dataFor(current).tab !== tab || trigger !== document.activeElement) return;
        fields.push(rosterField("Employee", "employeeId", current, roster));
      } catch (error) {
        if (isViewing(current)) message("workspace-error", errorMessage(error, "Could not load employees."));
        return;
      }
    }
    const requestId = newId();
    const outOptional = !!row && row.outAt == null;
    fields.push(
      field("Clock in (Manila time)", textControl("inAt", manilaInput(row?.inAt), { type: "datetime-local" })),
      field(outOptional ? "Clock out (Manila time, optional)" : "Clock out (Manila time)",
        textControl("outAt", manilaInput(row?.outAt), { type: "datetime-local", required: !outOptional })),
      field("Reason for correction", textArea("reason", "", 300, true))
    );
    openEditor(current, row ? "Correct attendance" : "Add missed attendance", fields, values => {
      const start = values.get("inAt");
      const end = values.get("outAt");
      const inAt = row && start === manilaInput(row.inAt) ? row.inAt : manilaTimestamp(start);
      const outAt = !end ? null : (row && end === manilaInput(row.outAt) ? row.outAt : manilaTimestamp(end));
      if (outAt === null && !outOptional) throw new Error("Enter the clock-out time.");
      const reason = String(values.get("reason")).trim();
      if (!reason) throw new Error("Enter the reason for the correction.");
      if (!Number.isFinite(inAt) || (outAt !== null && (!Number.isFinite(outAt) || outAt <= inAt))) {
        throw new Error("Clock-out time must be after clock-in time. For overnight shifts, choose the next date.");
      }
      return {
        resource: "attendance",
        args: ["correctAttendance", {
          ...(row && { id: row.id, revision: row.revision }),
          employeeId: row?.employeeId || values.get("employeeId"), inAt, outAt, reason, requestId
        }]
      };
    }, trigger);
  }

  function renderHistory(current, feature) {
    const team = feature.tab === "team";
    let action = null;
    if (!team) action = button("Set attendance PIN", () => editPin(current), true);
    if (team && current.home.member?.canManage) action = button("Add missed attendance", () => void editCorrection(current), true);
    const history = section(team ? "Team attendance" : "My attendance", action);
    if (team) {
      const form = make("form", "", "attendance-date fields");
      const control = textControl("date", feature.date, { type: "date" });
      const show = make("button", "Show attendance", "button secondary");
      show.type = "submit";
      form.append(field("Attendance date (Manila)", control), show);
      form.addEventListener("submit", event => {
        event.preventDefault();
        if (!isViewing(current) || !control.value) return;
        feature.date = control.value;
        render(current);
        void load(current);
      });
      history.end.append(form);
    } else {
      history.end.append(make("p", "All times are shown in Manila time.", "detail"));
    }
    const page = feature.pages.get(pageKey(feature));
    history.end.append(entries(page?.rows || [], row => punchRow(current, row, team),
      page ? "No attendance records for this view." : "Attendance records will appear here after loading."));
    if (page?.nextCursor) history.end.append(button("Load more attendance", () => void load(current, true)));
    return history.node;
  }

  function confirmRevoke(current) {
    openEditor(current, "Revoke tablet access", [
      make("p", "The shop tablet will need a new pairing code before it can record any more punches.", "detail")
    ], () => ({ resource: "attendance", args: ["revokeAttendanceKiosk", {}] }), document.activeElement, "Revoke access");
  }

  function renderSetup(current, feature) {
    const setup = section("Pair the shop tablet",
      button("Generate pairing code", () => void save(current, "attendance", "createAttendancePairing", {}), true));
    const link = make("a", "Open attendance tablet", "button secondary attendance-link");
    link.href = "hr-attendance.html";
    link.target = "_blank";
    link.rel = "noopener";
    setup.end.append(
      make("p", "Open the attendance page on the shared shop tablet and enter a pairing code.", "detail"),
      link
    );
    if (feature.pairing?.expiresAt > Date.now()) {
      const code = make("input");
      code.value = feature.pairing.code;
      code.readOnly = true;
      code.autocomplete = "off";
      const wrapper = make("div", "", "attendance-pairing fields");
      wrapper.append(field("One-time pairing code", code),
        make("p", "Expires " + attendanceTime.format(feature.pairing.expiresAt) + " Manila time.", "detail"),
        button("Copy pairing code", async () => {
          try {
            await navigator.clipboard.writeText(code.value);
            if (code.isConnected) message("workspace-status", "Pairing code copied.");
          } catch {
            code.focus();
            code.select();
            if (code.isConnected) message("workspace-status", "Select or copy the pairing code from the field.");
          }
        }));
      setup.end.append(wrapper);
    }
    const revoke = section("Revoke tablet access");
    revoke.end.append(
      make("p", "Revoke access if a tablet is lost, replaced, or no longer used for attendance.", "detail"),
      button("Revoke tablet access", () => confirmRevoke(current))
    );
    const stack = make("div", "", "stack");
    stack.append(setup.node, revoke.node);
    return stack;
  }

  function renderAttendance(current) {
    const feature = dataFor(current);
    const canManage = !!current.home.member?.canManage;
    if (!canManage && feature.tab === "setup") {
      clearPairing(current);
      feature.tab = "personal";
    }
    const choices = [
      ["personal", "My attendance"], ["team", "Team attendance"], ...(canManage ? [["setup", "Tablet setup"]] : [])
    ];
    const navigation = make("nav", "", "attendance-tabs");
    navigation.setAttribute("aria-label", "Attendance");
    for (const [id, label] of choices) {
      const control = button(label, () => selectTab(current, id));
      control.dataset.focusKey = "attendance-tab-" + id;
      if (feature.tab === id) control.setAttribute("aria-current", "page");
      navigation.append(control);
    }
    const stack = make("div", "", "stack");
    const section = feature.tab === "setup" ? renderSetup(current, feature) : renderHistory(current, feature);
    stack.append(navigation, section);
    return stack;
  }

  async function afterSave(current, action, result) {
    const feature = dataFor(current);
    if (action === "createAttendancePairing") {
      clearPairing(current);
      if (isViewing(current) && feature.tab === "setup") {
        feature.pairing = result;
        feature.expiryTimer = setTimeout(() => {
          clearPairing(current);
          if (isViewing(current)) {
            message("workspace-status", "Pairing code expired. Generate a new code if needed.");
            render(current);
          }
        }, Math.max(0, result.expiresAt - Date.now()));
        render(current);
      }
      return "Pairing code ready.";
    }
    if (action === "revokeAttendanceKiosk") {
      clearPairing(current);
      if (isViewing(current)) render(current);
      return "Tablet access revoked.";
    }
    if (action === "correctAttendance") {
      feature.pages.clear();
      feature.loads.clear();
      if (isViewing(current)) {
        render(current);
        await load(current);
      }
      return "Attendance correction saved.";
    }
    return "Attendance PIN saved.";
  }

  return { load, render: renderAttendance, reset, clearPairing, afterSave };
}
