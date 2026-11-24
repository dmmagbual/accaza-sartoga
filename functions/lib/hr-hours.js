"use strict";

// Weekly hours engine for Accaza HR. Pure: no database, no clock, no side effects.
// Rules: docs/ACCAZA_HR_SPEC.md section 4. Business dates are Manila dates.
// Every minute value is an integer. Buckets always sum to paid minutes.

const MANILA_DATE = new Intl.DateTimeFormat("sv-SE", {timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit"});
const MINUTE_MS = 60000;
const DAY_MS = 86400000;
const REVIEW_SESSION_MIN = 16 * 60;
const SATURDAY = 6;
const SUNDAY = 0;
const HOLIDAY_TYPES = new Set(["regular", "special_non_working", "special_working"]);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function fail(message) {
  throw new RangeError(message);
}

function parseDate(value, label) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) fail(label + " must be a YYYY-MM-DD date.");
  const time = Date.parse(value + "T00:00:00Z");
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) fail(label + " is not a real calendar date.");
  return time;
}

function addDays(date, days) {
  return new Date(parseDate(date, "Date") + days * DAY_MS).toISOString().slice(0, 10);
}

function weekday(date) {
  return new Date(parseDate(date, "Date")).getUTCDay();
}

function manilaDate(instant) {
  if (!Number.isSafeInteger(instant)) fail("A time must be a whole number of milliseconds.");
  return MANILA_DATE.format(instant);
}

// Saturday on or before the given Manila date. The pay week runs Saturday to Friday.
function payWeekStart(date) {
  return addDays(date, -((weekday(date) - SATURDAY + 7) % 7));
}

function minutes(value, label, min) {
  if (!Number.isSafeInteger(value) || value < min) fail(label + " must be a whole number of at least " + min + ".");
  return value;
}

function readSettings(settings) {
  if (!settings || typeof settings !== "object") fail("Hours settings are required.");
  const dailyRegularMin = minutes(settings.dailyRegularMin, "dailyRegularMin", 1);
  const breakThresholdMin = minutes(settings.breakThresholdMin, "breakThresholdMin", 0);
  const breakDeductMin = minutes(settings.breakDeductMin, "breakDeductMin", 0);
  if (breakDeductMin > breakThresholdMin) fail("breakDeductMin cannot exceed breakThresholdMin, or a short shift could pay negative time.");
  return {dailyRegularMin, breakThresholdMin, breakDeductMin};
}

function readHolidays(holidays) {
  const types = new Map();
  for (const row of holidays ?? []) {
    parseDate(row?.date, "Holiday date");
    if (!HOLIDAY_TYPES.has(row.type)) fail("Holiday " + row.date + " has unknown type " + JSON.stringify(row.type) + ".");
    const prior = types.get(row.date);
    if (prior && prior !== row.type) fail("Holiday " + row.date + " is listed with two different types.");
    types.set(row.date, row.type);
  }
  return types;
}

function dayType(date, holidays) {
  const holiday = holidays.get(date);
  if (holiday === "regular") return "regular_holiday";
  if (holiday === "special_non_working") return "special_holiday";
  // A special working day is an ordinary day for pay purposes.
  return weekday(date) === SUNDAY ? "sunday" : "ordinary";
}

function emptyTotals() {
  return {regularMin: 0, dailyOtMin: 0, sundayMin: 0, regularHolidayMin: 0, specialHolidayMin: 0};
}

const BUCKET = {sunday: "sundayMin", regular_holiday: "regularHolidayMin", special_holiday: "specialHolidayMin"};

/**
 * @param {object} input
 * @param {string} input.weekStart Saturday, YYYY-MM-DD (Manila).
 * @param {Array<{id:string, employeeId:string, inAt:number, outAt:number|null}>} input.records
 * @param {Array<{date:string, type:"regular"|"special_non_working"|"special_working"}>} input.holidays Confirmed holidays only.
 * @param {number[]} input.holidayYears Years whose holiday list HR has confirmed as loaded.
 * @param {{dailyRegularMin:number, breakThresholdMin:number, breakDeductMin:number}} input.settings
 */
function computeWeekHours({weekStart, records, holidays, holidayYears, settings}) {
  if (weekday(weekStart) !== SATURDAY) fail("weekStart must be a Saturday. The pay week runs Saturday to Friday.");
  const weekEnd = addDays(weekStart, 6);
  const rules = readSettings(settings);
  const holidayTypes = readHolidays(holidays);
  const issues = [];
  const issue = (code, record, blocking) => issues.push({code, recordId: record?.id ?? null, employeeId: record?.employeeId ?? null, blocking});

  const loaded = new Set(holidayYears ?? []);
  for (const year of new Set([weekStart.slice(0, 4), weekEnd.slice(0, 4)])) {
    if (!loaded.has(Number(year))) issues.push({code: "holidays_not_loaded", recordId: null, employeeId: null, blocking: true, year: Number(year)});
  }

  const seen = new Map();
  const sessions = [];
  for (const record of records ?? []) {
    if (typeof record?.id !== "string" || !record.id) fail("Every attendance record needs an id.");
    if (typeof record.employeeId !== "string" || !record.employeeId) fail("Attendance record " + record.id + " has no employee.");
    if (!Number.isSafeInteger(record.inAt) || record.inAt <= 0) fail("Attendance record " + record.id + " has an invalid clock-in time.");
    if (record.outAt !== null && !Number.isSafeInteger(record.outAt)) fail("Attendance record " + record.id + " has an invalid clock-out time.");
    const date = manilaDate(record.inAt);
    if (date < weekStart || date > weekEnd) continue;

    const fingerprint = record.employeeId + "|" + record.inAt + "|" + record.outAt;
    if (seen.has(record.id)) {
      if (seen.get(record.id) !== fingerprint) issue("duplicate_conflict", record, true);
      continue;
    }
    seen.set(record.id, fingerprint);

    if (record.outAt === null) {
      issue("open", record, true);
      continue;
    }
    if (record.outAt <= record.inAt) {
      issue("invalid_duration", record, true);
      continue;
    }
    const grossMin = Math.floor((record.outAt - record.inAt) / MINUTE_MS);
    const breakMin = grossMin > rules.breakThresholdMin ? rules.breakDeductMin : 0;
    if (grossMin > REVIEW_SESSION_MIN) issue("over_16h", record, false);
    sessions.push({id: record.id, employeeId: record.employeeId, date, inAt: record.inAt, outAt: record.outAt, grossMin, breakMin, paidMin: grossMin - breakMin});
  }

  sessions.sort((a, b) => a.employeeId.localeCompare(b.employeeId) || a.inAt - b.inAt || a.id.localeCompare(b.id));
  for (let i = 1; i < sessions.length; i++) {
    const prev = sessions[i - 1];
    const next = sessions[i];
    if (prev.employeeId === next.employeeId && next.inAt < prev.outAt) issue("overlap", next, true);
  }

  const employees = new Map();
  for (const session of sessions) {
    let row = employees.get(session.employeeId);
    if (!row) {
      row = {employeeId: session.employeeId, ...emptyTotals(), grossMin: 0, breakMin: 0, paidMin: 0, days: new Map(), sessions: []};
      employees.set(session.employeeId, row);
    }
    row.grossMin += session.grossMin;
    row.breakMin += session.breakMin;
    row.paidMin += session.paidMin;
    row.sessions.push(session);
    row.days.set(session.date, (row.days.get(session.date) ?? 0) + session.paidMin);
  }

  const result = [];
  for (const row of [...employees.values()].sort((a, b) => a.employeeId.localeCompare(b.employeeId))) {
    const days = [];
    for (const [date, paidMin] of [...row.days.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const type = dayType(date, holidayTypes);
      const day = {date, dayType: type, paidMin, ...emptyTotals()};
      if (type === "ordinary") {
        day.regularMin = Math.min(paidMin, rules.dailyRegularMin);
        day.dailyOtMin = paidMin - day.regularMin;
      } else {
        day[BUCKET[type]] = paidMin;
      }
      for (const key of Object.keys(emptyTotals())) row[key] += day[key];
      days.push(day);
    }
    const bucketSum = row.regularMin + row.dailyOtMin + row.sundayMin + row.regularHolidayMin + row.specialHolidayMin;
    if (bucketSum !== row.paidMin) throw new Error("Hours buckets do not sum to paid minutes for " + row.employeeId + ".");
    result.push({...row, days, sessions: row.sessions.map(({employeeId, ...session}) => session)});
  }

  issues.sort((a, b) => a.code.localeCompare(b.code) || String(a.recordId).localeCompare(String(b.recordId)));
  return {weekStart, weekEnd, employees: result, issues, blocked: issues.some((item) => item.blocking)};
}

module.exports = {computeWeekHours, payWeekStart, manilaDate};
