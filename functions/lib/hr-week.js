"use strict";

// Accaza HR weekly hours and the holiday table.
// Spec: docs/ACCAZA_HR_SPEC.md sections 4 and 6A. All hours come from the pure
// engine in hr-hours.js; this module only gathers its inputs and writes holidays.

const {computeWeekHours} = require("./hr-hours");
const {isSaturday, settingsForWeek} = require("./hr-settings");
const {isOwner, OWNER_ONLY} = require("./hr-roles");

const HOLIDAY_TYPES = ["regular", "special_non_working", "special_working"];
const MAX_WEEK_RECORDS = 2000;
const DAY_MS = 86400000;
const timeKey = (value) => String(value).padStart(15, "0"); // same keys as hr-attendance.js
const manilaMidnight = (date) => Date.parse(date + "T00:00:00+08:00");

function createHrWeek({firestore, HttpsError, now = Date.now}) {
  const root = firestore.doc("hrWorkspace/pilot");
  const collection = (name) => root.collection(name);
  const fail = (code, message, details) => { throw new HttpsError(code, message, details); };

  function realDate(value, label) {
    const time = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? Date.parse(value + "T00:00:00Z") : NaN;
    if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) fail("invalid-argument", label + " is invalid.");
    return value;
  }
  function year(value) {
    if (!Number.isSafeInteger(value) || value < 2020 || value > 2100) fail("invalid-argument", "Year is invalid.");
    return value;
  }
  function requireRevision(current, expected) {
    if (current ? expected !== current.revision : expected !== undefined && expected !== 0) {
      fail("aborted", "This record changed. Reload and try again.");
    }
  }
  function requireOwner(context) {
    if (!isOwner(context.member)) fail("permission-denied", OWNER_ONLY, {hrAccess: "owner-required"});
    return context.member;
  }
  function audit(transaction, actor, resource, row, time) {
    transaction.create(collection("audit").doc(), {
      actorUid: actor.uid, resource, recordId: row.id, revision: row.revision, time, record: row,
    });
  }
  const addDays = (date, days) => new Date(Date.parse(date + "T00:00:00Z") + days * DAY_MS).toISOString().slice(0, 10);

  async function weeklyHours(context, data) {
    const member = context.member;
    if (!member) fail("permission-denied", "Enroll in Accaza HR to use this feature.");
    const weekStart = realDate(data.weekStart, "Week start");
    if (!isSaturday(weekStart)) fail("invalid-argument", "A pay week starts on a Saturday.");
    const weekEnd = addDays(weekStart, 6);
    const team = member.canManage === true;
    const years = [...new Set([weekStart.slice(0, 4), weekEnd.slice(0, 4)])];

    const nextWeek = addDays(weekStart, 7);
    // dayKey and personalKey are written by hr-attendance.js interval(). A team reads the week by
    // Manila start date; an employee reads only their own clock-ins inside the same instants.
    const recordQuery = team
      ? collection("attendanceRecords").where("dayKey", ">=", weekStart).where("dayKey", "<", nextWeek).orderBy("dayKey")
      : collection("attendanceRecords")
        .where("personalKey", ">=", member.id + "~" + timeKey(manilaMidnight(weekStart)))
        .where("personalKey", "<", member.id + "~" + timeKey(manilaMidnight(nextWeek))).orderBy("personalKey");
    const [records, versions, holidays, yearDocs] = await Promise.all([
      recordQuery.limit(MAX_WEEK_RECORDS + 1).get(),
      collection("hoursSettings").where("status", "==", "approved").get(),
      collection("holidays").where("date", ">=", weekStart).where("date", "<=", weekEnd).get(),
      firestore.getAll(...years.map((value) => collection("holidayYears").doc(value))),
    ]);
    if (records.size > MAX_WEEK_RECORDS) fail("resource-exhausted", "Too many attendance records in this week to total safely.");

    const confirmed = holidays.docs.map((doc) => doc.data()).filter((row) => row.active === true);
    const rows = records.docs.map((doc) => {
      const {id, employeeId, inAt, outAt} = doc.data();
      return {id, employeeId, inAt, outAt: outAt ?? null};
    }).filter((row) => team || row.employeeId === member.id);

    let settings;
    let result;
    try {
      settings = settingsForWeek(versions.docs.map((doc) => doc.data()), weekStart);
      result = computeWeekHours({
        weekStart, records: rows, settings: settings.values,
        holidays: confirmed.map(({date, type}) => ({date, type})),
        holidayYears: yearDocs.filter((doc) => doc.get("complete") === true).map((doc) => Number(doc.id)),
      });
    } catch (error) {
      if (error instanceof RangeError) fail("failed-precondition", "Hours could not be totalled: " + error.message);
      throw error;
    }

    // Names only for people in this result, so the read count follows the week, not the roster.
    const ids = [...new Set(rows.map((row) => row.employeeId))].filter((value) => value !== member.id);
    const members = ids.length ? await firestore.getAll(...ids.map((value) => collection("members").doc(value))) : [];
    const names = new Map(members.filter((doc) => doc.exists).map((doc) => [doc.id, doc.get("name")]));
    names.set(member.id, member.name);
    const name = (employeeId) => names.get(employeeId) ?? "Former employee";
    return {
      weekStart, weekEnd, team,
      settings: {versionId: settings.versionId, effectiveFrom: settings.effectiveFrom, values: settings.values},
      holidays: confirmed.map(({date, name: title, type}) => ({date, name: title, type})),
      employees: result.employees.map(({sessions, ...row}) => ({...row, name: name(row.employeeId)}))
        .sort((a, b) => a.name.localeCompare(b.name) || a.employeeId.localeCompare(b.employeeId)),
      issues: result.issues.map((issue) => ({...issue, employeeName: issue.employeeId ? name(issue.employeeId) : null})),
      blocked: result.blocked,
    };
  }

  async function listHolidays(context, data) {
    if (!context.member) fail("permission-denied", "Enroll in Accaza HR to use this feature.");
    const value = year(data.year);
    const [rows, yearDoc] = await Promise.all([
      collection("holidays").where("date", ">=", value + "-01-01").where("date", "<=", value + "-12-31").orderBy("date").get(),
      collection("holidayYears").doc(String(value)).get(),
    ]);
    return {
      year: value, complete: yearDoc.get("complete") === true, yearRevision: yearDoc.get("revision") ?? 0,
      canEdit: isOwner(context.member),
      rows: rows.docs.map((doc) => doc.data()).filter((row) => row.active === true),
    };
  }

  async function saveHoliday(actor, access, data, time) {
    const date = realDate(data.date, "Holiday date");
    year(Number(date.slice(0, 4)));
    const active = data.active !== false;
    const name = active ? (typeof data.name === "string" ? data.name.trim() : "") : null;
    if (active && (!name || name.length > 120)) fail("invalid-argument", "Enter a holiday name of up to 120 characters.");
    if (active && !HOLIDAY_TYPES.includes(data.type)) fail("invalid-argument", "Choose a holiday type.");
    const ref = collection("holidays").doc(date);
    return firestore.runTransaction(async (transaction) => {
      const member = requireOwner(await access(actor, (key) => transaction.get(key)));
      const current = (await transaction.get(ref)).data();
      // A removed holiday is hidden from lists, so adding the date again starts without a revision.
      if (current?.active === true || data.revision !== undefined) requireRevision(current, data.revision);
      if (!current?.active && !active) fail("not-found", "This holiday was not found.");
      const row = {
        id: date, date, active,
        name: active ? name : current.name, type: active ? data.type : current.type,
        revision: (current?.revision ?? 0) + 1, updatedBy: member.id, updatedByName: member.name, updatedAt: time,
      };
      transaction.set(ref, row);
      audit(transaction, actor, "holidays", row, time);
      return {id: date, revision: row.revision};
    });
  }

  async function setHolidayYear(actor, access, data, time) {
    const value = year(data.year);
    if (typeof data.complete !== "boolean") fail("invalid-argument", "Choose whether the holiday list is complete.");
    const ref = collection("holidayYears").doc(String(value));
    return firestore.runTransaction(async (transaction) => {
      const member = requireOwner(await access(actor, (key) => transaction.get(key)));
      const current = (await transaction.get(ref)).data();
      requireRevision(current, data.revision);
      const row = {
        id: String(value), year: value, complete: data.complete,
        revision: (current?.revision ?? 0) + 1, updatedBy: member.id, updatedByName: member.name, updatedAt: time,
      };
      transaction.set(ref, row);
      audit(transaction, actor, "holidayYears", row, time);
      return {year: value, complete: row.complete, revision: row.revision};
    });
  }

  return async function handle(actor, data, access) {
    const time = now();
    switch (data.action) {
      case "weeklyHours": return weeklyHours(await access(actor), data);
      case "listHolidays": return listHolidays(await access(actor), data);
      case "saveHoliday": return saveHoliday(actor, access, data, time);
      case "setHolidayYear": return setHolidayYear(actor, access, data, time);
      default: fail("invalid-argument", "Unknown HR action.");
    }
  };
}

module.exports = {createHrWeek, HOLIDAY_TYPES};
