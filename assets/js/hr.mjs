import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { browserSessionPersistence, initializeAuth, inMemoryPersistence, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js";
import { initializeAccazaAppCheck } from "./shared/firebase-app-check.mjs";
import { accazaFirebaseConfig, markUatPage } from "./shared/firebase-env.mjs";

markUatPage("Accaza HR");
const app = initializeApp(accazaFirebaseConfig(location.hostname), "accaza-hr");
initializeAccazaAppCheck(app, "HR");
const auth = initializeAuth(app, { persistence: [browserSessionPersistence, inMemoryPersistence] });
const invoke = httpsCallable(getFunctions(app, "asia-southeast1"), "manageHrWorkspace", { timeout: 35000 });

const byId = id => document.getElementById(id);
const navigation = [...document.querySelectorAll("[data-view]")];
const editor = byId("editor");
const editorForm = byId("editor-form");
const view = byId("view");
const labels = { home: "My workspace", team: "Team", attendance: "Attendance", manage: "Management" };
const resources = { announcements: "Announcements", tasks: "Tasks", shifts: "Schedules", members: "Employees" };
const statusLabels = {
  "in-progress": "In progress", in_progress: "In progress", pending: "Pending",
  overdue: "Overdue", completed: "Completed", archived: "Archived",
  draft: "Draft", published: "Published", active: "Active", inactive: "Inactive"
};
const dayFormatter = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeZone: "Asia/Manila" });
const timeFormatter = new Intl.DateTimeFormat("en-PH", { timeStyle: "short", timeZone: "Asia/Manila" });
const manilaOffset = 8 * 60 * 60 * 1000;
let state = null;
let pendingEditor = null;
let busy = false;
let session = 0;
let attendanceWorkspace = null;
let attendanceModule = null;

function make(tag, text = "", className = "") {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function button(text, action, primary = false) {
  const node = make("button", text, primary ? "button primary" : "button secondary");
  node.type = "button";
  node.addEventListener("click", action);
  return node;
}

function message(id, text) {
  const node = byId(id);
  node.textContent = text;
  node.hidden = !text;
}

function errorMessage(error, fallback) {
  if (error?.code === "functions/unauthenticated") return "Your session has ended. Sign out and sign in again.";
  if (error?.code === "functions/permission-denied") return "This Accaza account does not have permission for this HR action.";
  if (["functions/invalid-argument", "functions/failed-precondition", "functions/aborted",
    "functions/not-found", "functions/already-exists", "functions/resource-exhausted"].includes(error?.code)) {
    return error.message || fallback;
  }
  if (["functions/unavailable", "functions/deadline-exceeded", "auth/network-request-failed"].includes(error?.code)) {
    return "Could not reach Accaza HR. Check your connection and try again.";
  }
  return fallback;
}

async function request(action, data = {}) {
  const user = auth.currentUser;
  try {
    return (await invoke({ action, ...data })).data;
  } catch (error) {
    if (user && user === auth.currentUser && state) {
      if (error?.code === "functions/unauthenticated" || error?.details?.hrAccess === "inactive") {
        clearWorkspace();
        byId("login").hidden = false;
        message("login-error", errorMessage(error, "This account can no longer open HR."));
      } else if (error?.details?.hrAccess === "management-changed") {
        clearWorkspace();
        void enter(user, ++session);
      }
    }
    throw error;
  }
}

function allowed(current) {
  return state === current && current?.user === auth.currentUser && !current.user.isAnonymous;
}

function clearWorkspace() {
  attendanceWorkspace?.reset(state);
  state = null;
  busy = false;
  pendingEditor = null;
  if (editor.open) editor.close();
  editorForm.reset();
  byId("editor-fields").replaceChildren();
  byId("editor-title").textContent = "";
  byId("editor-submit").disabled = false;
  byId("editor-cancel").disabled = false;
  byId("refresh").disabled = false;
  message("editor-error", "");
  message("workspace-error", "");
  message("workspace-status", "");
  byId("workspace").hidden = true;
  byId("employee-name").textContent = "";
  view.replaceChildren();
}

function viewFor(home) {
  return home.member ? "home" : "manage";
}

function canView(current, route) {
  if (route === "manage") return current.home.canEnroll || current.home.member?.canManage;
  return !!current.home.member;
}

async function enter(user, epoch) {
  message("page-status", "Loading your HR workspace…");
  try {
    const home = await request("home");
    if (epoch !== session || user !== auth.currentUser) return;
    state = {
      user, home, route: viewFor(home), resource: home.member?.canManage ? "announcements" : "members",
      lists: new Map(), loads: new Map()
    };
    byId("workspace").hidden = false;
    message("page-status", "");
    render(state);
    await loadVisible(state);
  } catch (error) {
    if (epoch !== session || user !== auth.currentUser) return;
    message("page-status", "");
    byId("login").hidden = false;
    message("login-error", errorMessage(error, "Could not open your HR workspace. Try signing in again."));
  }
}

onAuthStateChanged(auth, user => {
  const epoch = ++session;
  clearWorkspace();
  byId("login").hidden = !!user;
  byId("sign-out").hidden = !user;
  message("page-status", "");
  if (user?.isAnonymous) {
    signOut(auth).catch(() => {
      if (epoch !== session) return;
      byId("login").hidden = false;
      message("login-error", "An individual Accaza account is required.");
    });
  } else if (user) {
    message("login-error", "");
    void enter(user, epoch);
  }
}, () => {
  clearWorkspace();
  byId("login").hidden = false;
  message("page-status", "");
  message("login-error", "Could not initialize sign-in. Reload this page to retry.");
});

byId("login-form").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const control = form.querySelector("button");
  const data = new FormData(form);
  control.disabled = true;
  message("login-error", "");
  try {
    const email = String(data.get("email")).trim().toLowerCase();
    const password = String(data.get("password"));
    if (auth.currentUser) await signOut(auth);
    await signInWithEmailAndPassword(auth, email, password);
  } catch (error) {
    message("login-error", errorMessage(error, "Sign-in failed. Check your email address and password."));
  } finally {
    form.elements.password.value = "";
    control.disabled = false;
  }
});

byId("sign-out").addEventListener("click", async () => {
  ++session;
  clearWorkspace();
  const control = byId("sign-out");
  control.disabled = true;
  try {
    await signOut(auth);
  } catch (error) {
    message("page-status", errorMessage(error, "Could not sign out. Try again."));
  } finally {
    control.disabled = false;
  }
});

function listKey(resource, management) {
  return (management ? "management:" : "team:") + resource;
}

async function readList(current, resource, { management = false, more = false } = {}) {
  const key = listKey(resource, management);
  const pending = current.loads.get(key);
  if (pending) return pending.promise;
  const previous = current.lists.get(key);
  if (more && !previous?.nextCursor) return;
  const cursor = more ? previous.nextCursor : null;
  const ticket = {};
  current.loads.set(key, ticket);
  ticket.promise = (async () => {
    try {
      const page = await request("list", { resource, ...(management && { management: true }), ...(cursor && { cursor }) });
      if (!allowed(current) || current.loads.get(key) !== ticket) return;
      const rows = new Map((more ? previous.rows : []).map(row => [row.id, row]));
      for (const row of page.rows || []) rows.set(row.id, row);
      current.lists.set(key, { rows: [...rows.values()], nextCursor: page.nextCursor || null });
    } finally {
      if (current.loads.get(key) === ticket) current.loads.delete(key);
    }
  })();
  return ticket.promise;
}

function names(current) {
  const members = [
    ...listRows(current, "members"),
    ...listRows(current, "members", true)
  ];
  const roster = new Map(members.map(member => [member.id, member.name]));
  if (current.home.member) roster.set(current.home.member.id, current.home.member.name);
  return roster;
}

function listRows(current, resource, management = false) {
  return current.lists.get(listKey(resource, management))?.rows || [];
}

async function loadAttendance(current) {
  try {
    if (!attendanceWorkspace) {
      message("workspace-status", "Loading attendance…");
      attendanceModule ||= import("./hr-attendance-workspace.mjs")
        .then(({ createAttendanceWorkspace }) => {
          attendanceWorkspace = createAttendanceWorkspace({
            allowed, button, entries, entry, errorMessage, field, formatDay, make, manilaInput, manilaTimestamp,
            message, newId, openEditor, render, request, rosterField, rosterForEditor, save, section, textArea, textControl
          });
        }).catch(error => {
          attendanceModule = null;
          throw error;
        });
      await attendanceModule;
      if (!allowed(current) || current.route !== "attendance") return;
      message("workspace-status", "");
      render(current);
    }
    await attendanceWorkspace.load(current);
  } catch (error) {
    if (!allowed(current) || current.route !== "attendance") return;
    message("workspace-status", "");
    message("workspace-error", errorMessage(error, "Could not open Attendance. Select Refresh to retry."));
  }
}

async function loadVisible(current) {
  if (!allowed(current) || current.route === "home") return;
  if (current.route === "attendance") return loadAttendance(current);
  const route = current.route;
  const resource = current.resource;
  const jobs = route === "team"
    ? [["members", false], ["tasks", false], ["shifts", false]]
    : [[resource, true]];
  if (route === "manage" && ["tasks", "shifts"].includes(resource)) jobs.push(["members", false]);
  const needed = jobs.filter(([key, management]) => !current.lists.has(listKey(key, management)));
  if (!needed.length) return;
  message("workspace-status", "Loading…");
  const results = await Promise.allSettled(needed.map(([key, management]) => readList(current, key, { management })));
  if (!allowed(current) || current.route !== route || current.resource !== resource) return;
  message("workspace-status", "");
  const failure = results.find(result => result.status === "rejected");
  if (failure) message("workspace-error", errorMessage(failure.reason, "Could not load these records. Try Refresh."));
  render(current);
}

function showRoute(route) {
  const current = state;
  if (!allowed(current) || !canView(current, route) || current.route === route) return;
  if (current.route === "attendance") attendanceWorkspace?.clearPairing(current);
  current.route = route;
  message("workspace-status", "");
  message("workspace-error", "");
  render(current);
  byId("workspace-title").focus();
  void loadVisible(current);
}

navigation.forEach(control => control.addEventListener("click", () => showRoute(control.dataset.view)));

function updateHome(current, home) {
  current.home = home;
  if (!canView(current, current.route)) current.route = viewFor(home);
  if (!home.member?.canManage || (current.resource === "members" && !home.canEnroll)) {
    current.resource = home.canEnroll ? "members" : "announcements";
  }
}

async function refreshHome(current) {
  const ticket = current.homeTicket = Symbol("home");
  const home = await request("home");
  if (allowed(current) && current.homeTicket === ticket) updateHome(current, home);
}

function discardList(current, resource, management = false) {
  const key = listKey(resource, management);
  current.loads.delete(key);
  current.lists.delete(key);
}

function discardViews(current) {
  attendanceWorkspace?.reset(current);
  current.loads.clear();
  current.lists.clear();
}

byId("refresh").addEventListener("click", async () => {
  const current = state;
  if (!allowed(current) || busy) return;
  const control = byId("refresh");
  control.disabled = true;
  message("workspace-status", "Refreshing…");
  message("workspace-error", "");
  try {
    await refreshHome(current);
    if (!allowed(current)) return;
    discardViews(current);
    render(current);
    await loadVisible(current);
  } catch (error) {
    if (!allowed(current)) return;
    if (["functions/permission-denied", "functions/unauthenticated"].includes(error.code)) {
      clearWorkspace();
      byId("login").hidden = false;
      message("login-error", errorMessage(error, "This account can no longer open HR."));
    } else {
      message("workspace-error", errorMessage(error, "Could not refresh. Try again."));
    }
  } finally {
    if (allowed(current)) {
      control.disabled = false;
      message("workspace-status", "");
    }
  }
});

function formatDay(text) {
  if (!text) return "";
  const day = new Date(text + "T12:00:00+08:00");
  return Number.isFinite(+day) ? dayFormatter.format(day) : "";
}

function formatShift(shift) {
  if (!shift.startAt || !shift.endAt) return "";
  const startDay = dayFormatter.format(shift.startAt);
  const endDay = dayFormatter.format(shift.endAt);
  const start = startDay + ", " + timeFormatter.format(shift.startAt);
  return start + " – " + (startDay === endDay ? "" : endDay + ", ") + timeFormatter.format(shift.endAt);
}

function manilaInput(stamp) {
  return stamp ? new Date(stamp + manilaOffset).toISOString().slice(0, 16) : "";
}

function manilaTimestamp(text) {
  return new Date(text + "+08:00").getTime();
}

function statusChip(status) {
  const label = make("span", statusLabels[status] || status || "", "status-chip");
  label.dataset.status = status || "";
  return label;
}

function progressChart(task, type) {
  const percent = Math.round(Math.min(100, Math.max(0, Number(task.progress) || 0)));
  const node = make("div", "", "progress");
  if (type === "donut") {
    const chart = make("span", "", "donut");
    chart.setAttribute("aria-hidden", "true");
    chart.style.setProperty("--progress", percent + "%");
    node.append(chart);
  } else {
    const progress = make("progress");
    progress.value = percent;
    progress.max = 100;
    progress.setAttribute("aria-label", task.title + " progress");
    node.append(progress);
  }
  node.append(make("span", percent + "%"));
  return node;
}

function section(title, action) {
  const node = make("section", "", "card");
  node.setAttribute("aria-label", title);
  const head = make("div", "", "section-head");
  head.append(make("h2", title));
  if (action) head.append(action);
  const end = make("div", "", "stack");
  node.append(head, end);
  return { node, end };
}

function entries(rows, createRow, emptyText) {
  if (!rows.length) return make("p", emptyText, "empty");
  const list = make("ul", "", "entries");
  list.append(...rows.map(createRow));
  return list;
}

function entry(title, status) {
  const node = make("li", "", "entry");
  const heading = make("div", "", "entry-head");
  heading.append(make("h3", title));
  if (status) heading.append(statusChip(status));
  node.append(heading);
  return node;
}

function announcementRow(row, current, management) {
  const node = entry(row.title, management ? row.status : null);
  node.append(make("p", row.body));
  if (management) node.append(button("Edit announcement", () => editRecord(current, "announcements", row)));
  return node;
}

function shiftRow(row, current, roster, mode) {
  const caption = formatShift(row);
  const name = roster.get(row.employeeId) || row.employeeName || "Team member";
  const node = entry(mode === "home" ? caption : name, mode === "manage" ? row.status : null);
  if (mode !== "home") node.append(make("p", caption, "detail"));
  if (row.note) node.append(make("p", row.note));
  if (mode === "manage") node.append(button("Edit shift", () => editRecord(current, "shifts", row)));
  return node;
}

function taskRow(row, current, roster, mode) {
  const node = entry(row.title, row.status);
  const person = roster.get(row.assigneeId) || row.assigneeName || "Team member";
  const due = "Due " + formatDay(row.dueDate);
  node.append(make("p", mode === "home" ? due : person + " · " + due, "detail"));
  node.append(progressChart(row, current.home.member?.chart));
  if (mode === "manage") node.append(button("Edit task", () => editRecord(current, "tasks", row)));
  if (row.assigneeId !== current.home.member?.id || row.status === "archived" || mode === "manage") return node;
  if (row.steps?.length) {
    const list = make("ul", "", "steps");
    for (const step of row.steps) {
      const item = make("li");
      const label = make("label");
      const control = make("input");
      control.type = "checkbox";
      control.checked = step.done;
      control.dataset.focusKey = row.id + "-" + step.id;
      control.addEventListener("change", async () => {
        const done = control.checked;
        control.checked = !done;
        control.disabled = true;
        try {
          await save(current, "tasks", "setStep", { id: row.id, stepId: step.id, done, revision: row.revision });
        } finally {
          control.disabled = false;
        }
      });
      label.append(control, make("span", step.title));
      item.append(label);
      list.append(item);
    }
    node.append(list);
  }
  node.append(button("Add step", () => editStep(current, row)));
  return node;
}

function memberRow(row, current) {
  const node = entry(row.name, row.active ? "active" : "inactive");
  if (row.canManage) node.append(make("p", "HR manager", "detail"));
  node.append(button("Edit access", () => editRecord(current, "members", row)));
  return node;
}

async function moreRecords(current, resource, management = false, first = false) {
  if (!allowed(current)) return;
  const key = listKey(resource, management);
  if (current.loads.has(key)) return;
  message("workspace-error", "");
  try {
    await readList(current, resource, { management, more: !first });
    if (!allowed(current)) return;
    render(current);
  } catch (error) {
    if (allowed(current)) message("workspace-error", errorMessage(error, "Could not load more records. Try again."));
  }
}

function appendMore(container, current, resource, management = false) {
  if (!current.lists.get(listKey(resource, management))?.nextCursor) return;
  container.append(button("Load more " + resources[resource].toLowerCase(), () => moreRecords(current, resource, management)));
}

function chartControl(current) {
  const label = make("label", "Progress view", "chart-control");
  const control = selectControl("chart", [
    ["bar", "Bar"],
    ["donut", "Donut"]
  ], current.home.member?.chart || "bar");
  control.dataset.focusKey = "chart";
  control.addEventListener("change", () => {
    const chart = control.value;
    control.value = current.home.member?.chart || "bar";
    void save(current, null, "setChart", { chart });
  });
  label.append(control);
  return label;
}

function renderHome(current) {
  const roster = names(current);
  const announcements = section("Announcements");
  announcements.node.classList.add("announcement");
  const publishedList = current.lists.get(listKey("announcements", false));
  announcements.end.append(entries(publishedList?.rows || current.home.announcements, row => announcementRow(row),
    "There are no current announcements."));
  if (publishedList) {
    appendMore(announcements.end, current, "announcements");
  } else if (current.home.announcements.length) {
    announcements.end.append(button("See all announcements", () => moreRecords(current, "announcements", false, true)));
  }
  const tasks = section("My tasks", chartControl(current));
  tasks.end.append(entries(current.home.tasks, row => taskRow(row, current, roster, "home"), "You have no active tasks."));
  if (current.home.tasks.length) tasks.end.append(button("Open the team task board", () => showRoute("team")));
  const shifts = section("My schedule");
  shifts.end.append(entries(current.home.shifts, row => shiftRow(row, current, roster, "home"), "You have no upcoming shifts."));
  if (current.home.shifts.length) shifts.end.append(button("Open the team schedule", () => showRoute("team")));
  const grid = make("div", "", "work-grid");
  grid.append(tasks.node, shifts.node);
  const stack = make("div", "", "stack");
  stack.append(announcements.node, grid);
  return stack;
}

function renderTeam(current) {
  const roster = names(current);
  const tasks = section("Team task board", chartControl(current));
  tasks.end.append(entries(listRows(current, "tasks"), row => taskRow(row, current, roster, "team"),
    current.lists.has(listKey("tasks", false)) ? "There are no active team tasks." : "Team tasks will appear here after loading."));
  appendMore(tasks.end, current, "tasks");
  const shifts = section("Team schedule");
  shifts.end.append(make("p", "All times are in Manila time.", "detail"));
  shifts.end.append(entries(listRows(current, "shifts"), row => shiftRow(row, current, roster, "team"),
    current.lists.has(listKey("shifts", false)) ? "There are no upcoming team shifts." : "Team shifts will appear here after loading."));
  appendMore(shifts.end, current, "shifts");
  appendMore(shifts.end, current, "members");
  const grid = make("div", "", "work-grid");
  grid.append(tasks.node, shifts.node);
  return grid;
}

function selectControl(name, options, value) {
  const control = make("select");
  control.name = name;
  for (const [key, label] of options) {
    const option = make("option", label);
    option.value = key;
    control.append(option);
  }
  control.value = value ?? "";
  return control;
}

function renderManagement(current) {
  const options = Object.entries(resources).filter(([key]) => key === "members"
    ? current.home.canEnroll : current.home.member?.canManage);
  const label = make("label", "Manage");
  const resourceSelect = selectControl("resource", options, current.resource);
  resourceSelect.addEventListener("change", () => {
    current.resource = resourceSelect.value;
    message("workspace-error", "");
    render(current);
    view.querySelector('select[name="resource"]')?.focus();
    void loadVisible(current);
  });
  label.append(resourceSelect);
  const filters = make("div", "", "fields");
  filters.append(label);
  const currentResource = current.resource;
  const addLabels = { announcements: "New announcement", tasks: "Assign task", shifts: "Add shift", members: "Enroll employee" };
  const active = section(resources[currentResource],
    button(addLabels[currentResource], () => editRecord(current, currentResource), true));
  const roster = names(current);
  const mappings = {
    announcements: row => announcementRow(row, current, true),
    tasks: row => taskRow(row, current, roster, "manage"),
    shifts: row => shiftRow(row, current, roster, "manage"),
    members: row => memberRow(row, current)
  };
  if (currentResource === "members") active.end.append(
    make("p", "Enroll existing Accaza account holders and control their HR access.", "detail")
  );
  active.end.append(entries(listRows(current, currentResource, true), mappings[currentResource],
    current.lists.has(listKey(currentResource, true)) ? "There are no saved records." : "Records will appear here after loading."));
  appendMore(active.end, current, currentResource, true);
  const stack = make("div", "", "stack");
  stack.append(filters, active.node);
  return stack;
}

function render(current) {
  if (!allowed(current)) return;
  const focusKey = document.activeElement?.dataset.focusKey;
  byId("workspace-title").textContent = labels[current.route];
  byId("employee-name").textContent = current.home.member?.name || "Pilot enrollment";
  for (const control of navigation) {
    control.hidden = !canView(current, control.dataset.view);
    if (control.dataset.view === current.route) control.setAttribute("aria-current", "page");
    else control.removeAttribute("aria-current");
  }
  const renders = {
    home: renderHome, team: renderTeam,
    attendance: current => attendanceWorkspace?.render(current) || make("div"),
    manage: renderManagement
  };
  view.replaceChildren(renders[current.route](current));
  if (focusKey) {
    [...view.querySelectorAll("[data-focus-key]")].find(node => node.dataset.focusKey === focusKey)?.focus();
  }
}

function textControl(name, value, { type = "text", required = true, maxLength = 120 } = {}) {
  const control = make("input");
  control.type = type;
  control.name = name;
  control.value = value ?? "";
  control.required = required;
  if (["text", "email"].includes(type)) control.maxLength = maxLength;
  return control;
}

function textArea(name, value, maxLength, required) {
  const control = make("textarea");
  control.name = name;
  control.value = value ?? "";
  control.rows = 4;
  control.maxLength = maxLength;
  control.required = required;
  return control;
}

function checkboxControl(name, checked) {
  const control = make("input");
  control.type = "checkbox";
  control.name = name;
  control.checked = checked;
  return control;
}

function field(caption, control) {
  const label = make("label");
  if (control.type === "checkbox") {
    label.classList.add("checkbox");
    label.append(control, make("span", caption));
  } else {
    label.append(make("span", caption), control);
  }
  return label;
}

function newId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, "0")).join("");
}

function openEditor(current, title, fields, saveDetails, trigger, submitLabel = "Save") {
  if (!allowed(current) || busy || editor.open) return;
  byId("editor-title").textContent = title;
  byId("editor-fields").replaceChildren(...fields);
  message("editor-error", "");
  pendingEditor = { current, saveDetails, trigger };
  byId("editor-submit").textContent = submitLabel;
  editor.showModal();
}

function closeEditor() {
  if (editor.open) editor.close();
}

editor.addEventListener("cancel", event => {
  if (busy) event.preventDefault();
});
editor.addEventListener("close", () => {
  const trigger = pendingEditor?.trigger;
  pendingEditor = null;
  byId("editor-fields").replaceChildren();
  message("editor-error", "");
  if (trigger?.isConnected) trigger.focus();
  else if (state) byId("workspace-title").focus();
});
byId("editor-cancel").addEventListener("click", () => {
  if (!busy) closeEditor();
});

function editorListOptions(roster, selected) {
  const options = [["", "Choose an employee"],
    ...roster.filter(row => row.active || row.id === selected).map(row => [row.id, row.name])];
  if (selected && !options.some(([id]) => id === selected)) options.push([selected, "Current employee"]);
  return options;
}

function rosterField(caption, property, current, roster, selected) {
  const control = selectControl(property, editorListOptions(roster, selected), selected);
  control.required = true;
  const container = make("div", "", "fields");
  const key = listKey("members", false);
  const load = button("Load more employees", async () => {
    load.disabled = true;
    message("editor-error", "");
    try {
      await readList(current, "members", { more: true });
      if (!allowed(current) || !control.isConnected) return;
      const value = control.value;
      const updated = selectControl(property, editorListOptions(listRows(current, "members"), selected), value);
      control.replaceChildren(...updated.children);
      control.value = value;
      load.hidden = !current.lists.get(key)?.nextCursor;
    } catch (error) {
      if (allowed(current) && control.isConnected) message("editor-error", errorMessage(error, "Could not load more employees."));
    } finally {
      load.disabled = false;
    }
  });
  load.hidden = !current.lists.get(key)?.nextCursor;
  container.append(field(caption, control), load);
  return container;
}

async function rosterForEditor(current) {
  if (!current.lists.has(listKey("members", false))) {
    await readList(current, "members");
  }
  return listRows(current, "members");
}

async function editRecord(current, resource, row) {
  if (!allowed(current) || busy || editor.open) return;
  const trigger = document.activeElement;
  const routeAtOpen = current.route;
  const resourceAtOpen = current.resource;
  const existing = !!row?.id;
  const id = row?.id || newId();
  const identifiers = { id, ...(existing && { revision: row.revision }) };
  let fields;
  let saveDetails;
  let title;
  switch (resource) {
    case "announcements":
      title = existing ? "Edit announcement" : "New announcement";
      fields = [
        field("Title", textControl("title", row?.title, { maxLength: 100 })),
        field("Announcement", textArea("body", row?.body, 1000, true)),
        field("Status", selectControl("status", [["draft", "Draft"], ["published", "Published"], ["archived", "Archived"]], row?.status || "draft"))
      ];
      saveDetails = data => ["saveAnnouncement", { ...identifiers, ...Object.fromEntries(data) }];
      break;
    case "members":
      title = existing ? "Edit employee access" : "Enroll employee";
      fields = [
        ...(!existing ? [field("Accaza account email", textControl("email", "", { type: "email", maxLength: 320 }))] : []),
        field("Display name", textControl("name", row?.name, { maxLength: 100 })),
        field("HR access active", checkboxControl("active", row?.active ?? true)),
        field("Can manage announcements, tasks, and schedules", checkboxControl("canManage", row?.canManage ?? false))
      ];
      saveDetails = data => ["saveMember", {
        ...(existing ? identifiers : { email: data.get("email") }),
        name: data.get("name"), active: data.has("active"), canManage: data.has("canManage")
      }];
      break;
    case "shifts":
    case "tasks": {
      let roster;
      try {
        roster = await rosterForEditor(current);
      } catch (error) {
        if (allowed(current)) message("workspace-error", errorMessage(error, "Could not load employees. Try again."));
        return;
      }
      if (!allowed(current) || current.route !== routeAtOpen || current.resource !== resourceAtOpen) return;
      if (resource === "tasks") {
        title = existing ? "Edit task" : "Assign task";
        fields = [
          field("Title", textControl("title", row?.title, { maxLength: 120 })),
          rosterField("Assignee", "assigneeId", current, roster, row?.assigneeId),
          field("Deadline (Manila date)", textControl("dueDate", row?.dueDate, { type: "date" })),
          field("Status", selectControl("status", [["active", "Active"], ["archived", "Archived"]], row?.status === "archived" ? "archived" : "active"))
        ];
        saveDetails = data => ["saveTask", { ...identifiers, ...Object.fromEntries(data) }];
      } else {
        title = existing ? "Edit shift" : "Add shift";
        fields = [
          rosterField("Employee", "employeeId", current, roster, row?.employeeId),
          field("Starts (Manila time)", textControl("start", manilaInput(row?.startAt), { type: "datetime-local" })),
          field("Ends (Manila time)", textControl("end", manilaInput(row?.endAt), { type: "datetime-local" })),
          field("Team note (optional)", textArea("note", row?.note, 300, false)),
          field("Status", selectControl("status", [["published", "Published"], ["archived", "Archived"]], row?.status || "published"))
        ];
        saveDetails = data => {
          const startAt = manilaTimestamp(data.get("start"));
          const endAt = manilaTimestamp(data.get("end"));
          if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt <= startAt) {
            throw new Error("The shift must end after it starts. For overnight shifts, choose the next date.");
          }
          return ["saveShift", { ...identifiers, employeeId: data.get("employeeId"), startAt, endAt, note: data.get("note"), status: data.get("status") }];
        };
      }
      break;
    }
    default:
      return;
  }
  openEditor(current, title, fields, data => ({ resource, args: saveDetails(data) }), trigger);
}

function editStep(current, task) {
  const stepId = newId();
  openEditor(current, "Add task step", [field("Step", textControl("title", "", { maxLength: 120 }))], data => ({
    resource: "tasks",
    args: ["addStep", { id: task.id, stepId, title: data.get("title"), revision: task.revision }]
  }), document.activeElement);
}

editorForm.addEventListener("submit", event => {
  event.preventDefault();
  if (busy || !pendingEditor) return;
  const { current, saveDetails } = pendingEditor;
  try {
    const { resource, args } = saveDetails(new FormData(editorForm));
    void save(current, resource, ...args, true);
  } catch (error) {
    message("editor-error", error.message);
  }
});

function setBusy(value) {
  busy = value;
  byId("editor-submit").disabled = value;
  byId("editor-cancel").disabled = value;
  byId("refresh").disabled = value;
}

async function save(current, resource, action, payload, fromEditor = false) {
  if (!allowed(current) || busy) return;
  const noticeId = fromEditor ? "editor-error" : "workspace-error";
  message(noticeId, "");
  setBusy(true);
  let committed = false;
  try {
    const result = await request(action, payload);
    if (!allowed(current)) return;
    committed = true;
    if (fromEditor) closeEditor();
    let confirmation = "Saved.";
    if (resource === "attendance") {
      confirmation = await attendanceWorkspace.afterSave(current, action, result);
    } else if (action === "setChart") {
      current.home.member.chart = payload.chart;
      render(current);
    } else {
      discardList(current, resource);
      discardList(current, resource, true);
      await refreshHome(current);
      if (!allowed(current)) return;
      render(current);
      await loadVisible(current);
    }
    if (allowed(current) && byId("workspace-error").hidden) message("workspace-status", confirmation);
  } catch (error) {
    if (!allowed(current)) return;
    if (committed && ["functions/permission-denied", "functions/unauthenticated"].includes(error?.code)) {
      clearWorkspace();
      byId("login").hidden = false;
      message("login-error", "Saved. This account can no longer open HR.");
      return;
    }
    if (committed) {
      message("workspace-error", "Saved, but the updated records could not be loaded. Select Refresh.");
    } else {
      message(noticeId, errorMessage(error, "Could not save. Try again."));
    }
  } finally {
    if (allowed(current)) setBusy(false);
  }
}

window.addEventListener("pageshow", event => {
  if (!event.persisted || !auth.currentUser || auth.currentUser.isAnonymous) return;
  clearWorkspace();
  void enter(auth.currentUser, ++session);
});
