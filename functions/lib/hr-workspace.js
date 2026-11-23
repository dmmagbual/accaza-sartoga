"use strict";

const PAGE_SIZE = 25;
const HOME_SIZE = 8;
const MAX_STEPS = 30;
const PH_DATE = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
});

function createHrWorkspace({firestore, HttpsError, findPortalAccount, now = Date.now}) {
  const root = firestore.doc("hrWorkspace/pilot");
  const collection = (name) => root.collection(name);
  const account = (uid) => collection("accounts").doc(Buffer.from(uid).toString("base64url"));
  const profile = (id) => collection("members").doc(id);
  const fail = (code, message, details) => { throw new HttpsError(code, message, details); };

  function text(value, max, label, optional = false) {
    if (typeof value !== "string" || value.trim().length > max || (!optional && !value.trim())) {
      fail("invalid-argument", label + " is invalid.");
    }
    return value.trim();
  }
  function id(value) {
    if (typeof value !== "string" || (!/^[a-zA-Z0-9_-]{1,64}$/.test(value) || /^__.*__$/.test(value))) {
      fail("invalid-argument", "Record ID is invalid.");
    }
    return value;
  }
  function choice(value, allowed, label) {
    if (!allowed.includes(value)) fail("invalid-argument", label + " is invalid.");
    return value;
  }
  function flag(value, label) {
    if (typeof value !== "boolean") fail("invalid-argument", label + " is invalid.");
    return value;
  }
  function dueDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      fail("invalid-argument", "Enter a valid deadline.");
    }
    const date = new Date(value + "T00:00:00Z");
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
      fail("invalid-argument", "Enter a valid deadline.");
    }
    return value;
  }
  function instant(value) {
    // Keep timestamps sortable and representable in the staff page's date fields.
    if (!Number.isSafeInteger(value) || value < 0 || value > 253402300799999) {
      fail("invalid-argument", "Enter a valid shift time.");
    }
    return value;
  }
  function requireRevision(current, expected) {
    if (current ? expected !== current.revision : expected !== undefined && expected !== 0) {
      fail("aborted", "This record changed. Reload and try again.");
    }
  }
  function timeKey(time, recordId) {
    return String(time).padStart(15, "0") + "~" + recordId;
  }
  function employeeTaskKey(task) {
    const completed = task.steps.length > 0 && task.steps.every((step) => step.done);
    return task.assigneeId + "~" + (completed ? "1" : "0") + "~" + task.teamKey;
  }
  function memberView(member, canReview) {
    const {id, name, active, canManage, chart, revision} = member;
    return canReview ? {id, name, active, canManage, chart, revision} : {id, name, active};
  }
  function present(resource, row, time, viewerId) {
    const {id, title, revision, status} = row;
    if (resource === "announcements") return {id, title, body: row.body, revision, status};
    if (resource === "shifts") {
      const {employeeId, employeeName, startAt, endAt, note} = row;
      return {id, employeeId, employeeName, startAt, endAt, note, revision, status};
    }
    const {assigneeId, assigneeName, dueDate, steps} = row;
    const done = steps.filter((step) => step.done).length;
    const progress = steps.length ? Math.round(done * 100 / steps.length) : 0;
    let taskStatus = status;
    if (status === "active") {
      if (steps.length && done === steps.length) taskStatus = "completed";
      else if (dueDate < PH_DATE.format(time)) taskStatus = "overdue";
      else taskStatus = done ? "in-progress" : "pending";
    }
    return {id, title, assigneeId, assigneeName, dueDate, steps: viewerId === assigneeId ? steps : [], revision, status: taskStatus, progress};
  }

  async function access(actor, reader = (ref) => ref.get()) {
    const link = (await reader(account(actor.uid))).data();
    const stored = link ? (await reader(profile(link.employeeId))).data() : null;
    const member = stored?.active === true && stored.accountUid === actor.uid ? stored : null;
    const canEnroll = actor.role === "superadmin";
    if (!member && !canEnroll) fail("permission-denied", "Ask your manager to enroll you in Accaza HR.", {hrAccess: "inactive"});
    return {member, canEnroll};
  }
  function requireManager(context) {
    if (context.member?.canManage !== true) fail("permission-denied", "HR management access is required.", {hrAccess: "management-changed"});
  }
  function requireEnrollment(context) {
    if (!context.canEnroll) fail("permission-denied", "Only a Super Admin can manage HR access.");
  }
  function requireMember(context) {
    if (!context.member) fail("permission-denied", "Enroll in Accaza HR to use this feature.");
    return context.member;
  }
  function audit(transaction, actor, resource, row, time) {
    transaction.create(collection("audit").doc(), {
      actorUid: actor.uid, resource, recordId: row.id, revision: row.revision, time, record: row,
    });
  }
  function listQuery(resource, field, direction = "asc", lower, upper) {
    let query = collection(resource);
    if (lower !== undefined) query = query.where(field, ">=", lower);
    if (upper !== undefined) query = query.where(field, "<=", upper);
    return query.orderBy(field, direction);
  }
  async function page(query, field, cursor, limit) {
    if (cursor != null) query = query.startAfter(text(cursor, 160, "Page cursor"));
    const result = await query.limit(limit + 1).get();
    const docs = result.docs.slice(0, limit);
    return {
      rows: docs.map((doc) => doc.data()),
      nextCursor: result.docs.length > limit ? docs.at(-1).get(field) : null,
    };
  }
  function teamShifts(time) {
    return listQuery("shifts", "endKey", "asc", timeKey(time, ""));
  }
  async function home(context, time) {
    const {member, canEnroll} = context;
    if (!member) return {member: null, canEnroll, announcements: [], tasks: [], shifts: []};
    const prefix = member.id + "~";
    const [announcements, tasks, shifts] = await Promise.all([
      page(listQuery("announcements", "publishedKey", "desc"), "publishedKey", null, HOME_SIZE),
      page(listQuery("tasks", "employeeKey", "asc", prefix, prefix + "\uf8ff"), "employeeKey", null, HOME_SIZE),
      page(listQuery("shifts", "employeeEndKey", "asc", prefix + timeKey(time, ""), prefix + "\uf8ff"), "employeeEndKey", null, HOME_SIZE),
    ]);
    return {
      member: memberView(member, true), canEnroll,
      announcements: announcements.rows.map((row) => present("announcements", row, time)),
      tasks: tasks.rows.map((row) => present("tasks", row, time, member.id)),
      shifts: shifts.rows.map((row) => present("shifts", row, time)),
    };
  }
  async function list(context, data, time) {
    const resource = choice(data.resource, ["members", "announcements", "tasks", "shifts"], "List");
    if (resource === "members") {
      const result = await page(listQuery("members", "id"), "id", data.cursor, PAGE_SIZE);
      return {...result, rows: result.rows.map((row) => memberView(row, context.canEnroll))};
    }
    requireMember(context);
    const management = data.management === true;
    if (management) requireManager(context);
    const field = management ? "sortKey" : {
      announcements: "publishedKey", tasks: "teamKey", shifts: "endKey",
    }[resource];
    const direction = management || resource === "announcements" ? "desc" : "asc";
    const query = !management && resource === "shifts" ? teamShifts(time) : listQuery(resource, field, direction);
    const result = await page(query, field, data.cursor, PAGE_SIZE);
    return {...result, rows: result.rows.map((row) => present(resource, row, time, context.member.id))};
  }

  async function saveMember(actor, data, time) {
    // Check enrollment authority before looking up an email or making any membership writes.
    requireEnrollment(await access(actor));
    const existing = data.id != null;
    const email = existing ? null : text(data.email, 320, "Staff login email").toLowerCase();
    const accountUid = existing ? null : await findPortalAccount(email);
    const ref = existing ? profile(id(data.id)) : collection("members").doc();
    const name = text(data.name, 120, "Employee name");
    const active = flag(data.active, "Active status");
    const canManage = flag(data.canManage, "Management access");
    return firestore.runTransaction(async (transaction) => {
      const current = (await transaction.get(ref)).data();
      if (existing && !current) fail("not-found", "Employee enrollment was not found.");
      requireRevision(current, data.revision);
      const linkRef = account(current?.accountUid ?? accountUid);
      if (!existing && (await transaction.get(linkRef)).exists) {
        fail("already-exists", "This account is already enrolled. Edit its existing employee record.");
      }
      const row = {
        id: ref.id, name, active, canManage, chart: current?.chart ?? "bar",
        revision: (current?.revision ?? 0) + 1, accountUid: current?.accountUid ?? accountUid,
      };
      transaction.set(ref, row);
      if (!existing) transaction.create(linkRef, {employeeId: ref.id});
      audit(transaction, actor, "members", row, time);
      return {id: ref.id};
    });
  }

  async function saveRecord(actor, resource, data, time) {
    const recordId = id(data.id);
    const ref = collection(resource).doc(recordId);
    return firestore.runTransaction(async (transaction) => {
      const context = await access(actor, (key) => transaction.get(key));
      requireManager(context);
      const current = (await transaction.get(ref)).data();
      requireRevision(current, data.revision);
      let row = {id: recordId, sortKey: timeKey(time, recordId), revision: (current?.revision ?? 0) + 1};
      if (resource === "announcements") {
        const status = choice(data.status, ["draft", "published", "archived"], "Announcement status");
        row = {...row, status, title: text(data.title, 120, "Title"), body: text(data.body, 2000, "Announcement")};
        if (status === "published") row.publishedKey = current?.publishedKey ?? row.sortKey;
      } else if (resource === "tasks") {
        const status = choice(data.status, ["active", "archived"], "Task status");
        const assigneeId = id(data.assigneeId);
        const assignee = (await transaction.get(profile(assigneeId))).data();
        if (!assignee || (status === "active" && assignee.active !== true)) {
          fail("failed-precondition", "Assign active work to an enrolled employee.");
        }
        const deadline = dueDate(data.dueDate);
        row = {
          ...row, status, assigneeId, assigneeName: assignee.name, dueDate: deadline, title: text(data.title, 160, "Title"), steps: current?.steps ?? [],
        };
        if (status === "active") {
          row.teamKey = deadline + "~" + recordId;
          row.employeeKey = employeeTaskKey(row);
        }
      } else {
        const status = choice(data.status, ["published", "archived"], "Schedule status");
        const employeeId = id(data.employeeId);
        const employee = (await transaction.get(profile(employeeId))).data();
        if (!employee || (status === "published" && employee.active !== true)) {
          fail("failed-precondition", "Schedule an enrolled employee with active access.");
        }
        const startAt = instant(data.startAt);
        const endAt = instant(data.endAt);
        if (endAt <= startAt) fail("invalid-argument", "Shift end must be after the start.");
        row = {...row, status, employeeId, employeeName: employee.name, startAt, endAt, note: text(data.note ?? "", 300, "Shift note", true)};
        if (status === "published") {
          row.endKey = timeKey(endAt, recordId);
          row.employeeEndKey = employeeId + "~" + row.endKey;
        }
      }
      transaction.set(ref, row);
      audit(transaction, actor, resource, row, time);
      return {id: recordId};
    });
  }

  async function updateStep(actor, data, time) {
    const taskId = id(data.id);
    const stepId = id(data.stepId);
    return firestore.runTransaction(async (transaction) => {
      const member = requireMember(await access(actor, (ref) => transaction.get(ref)));
      const ref = collection("tasks").doc(taskId);
      const task = (await transaction.get(ref)).data();
      if (!task || task.assigneeId !== member.id || task.status !== "active") {
        fail("permission-denied", "You can update steps only on your assigned active tasks.");
      }
      const stepIndex = task.steps.findIndex((step) => step.id === stepId);
      let steps = task.steps.slice();
      if (data.action === "addStep") {
        const title = text(data.title, 160, "Step");
        if (stepIndex !== -1 && steps[stepIndex].title === title) return {id: taskId};
        requireRevision(task, data.revision);
        if (stepIndex !== -1) fail("already-exists", "That step already exists.");
        if (steps.length >= MAX_STEPS) fail("resource-exhausted", "This task has reached its checklist limit.");
        steps.push({id: stepId, title, done: false});
      } else {
        const done = flag(data.done, "Step status");
        if (stepIndex === -1) fail("not-found", "This task step no longer exists.");
        if (steps[stepIndex].done === done) return {id: taskId};
        requireRevision(task, data.revision);
        steps[stepIndex] = {...steps[stepIndex], done};
      }
      transaction.update(ref, {
        steps, employeeKey: employeeTaskKey({...task, steps}),
        sortKey: timeKey(time, taskId), revision: task.revision + 1,
      });
      return {id: taskId};
    });
  }

  return async (actor, data = {}) => {
    if (!data || typeof data !== "object" || Array.isArray(data)) fail("invalid-argument", "Invalid HR request.");
    const time = now();
    switch (data.action) {
      case "home": return home(await access(actor), time);
      case "list": return list(await access(actor), data, time);
      case "saveMember": return saveMember(actor, data, time);
      case "saveAnnouncement": return saveRecord(actor, "announcements", data, time);
      case "saveTask": return saveRecord(actor, "tasks", data, time);
      case "saveShift": return saveRecord(actor, "shifts", data, time);
      case "addStep":
      case "setStep": return updateStep(actor, data, time);
      case "listAttendance":
      case "setAttendancePin":
      case "createAttendancePairing":
      case "revokeAttendanceKiosk":
      case "correctAttendance": {
        const {createHrAttendance} = require("./hr-attendance");
        return createHrAttendance({firestore, HttpsError, now}).staff(actor, data, access);
      }
      case "setChart": {
        const chart = choice(data.chart, ["bar", "donut"], "Chart type");
        return firestore.runTransaction(async (transaction) => {
          const member = requireMember(await access(actor, (ref) => transaction.get(ref)));
          if (member.chart !== chart) transaction.update(profile(member.id), {chart});
          return {ok: true};
        });
      }
      default: fail("invalid-argument", "Unknown HR action.");
    }
  };
}

module.exports = {createHrWorkspace};
