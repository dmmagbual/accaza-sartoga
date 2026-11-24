"use strict";

// Accaza HR hours settings: validation and effective-version resolution.
// Pure: no database access. Spec: docs/ACCAZA_HR_SPEC.md section 1A.
// Every change is a new version with an effective pay-week start (Saturday).
// Old versions are never edited, so a locked week can always be recomputed
// with the settings it used.

const DEFAULT_HOURS_SETTINGS = Object.freeze({
  dailyRegularMin: 480,
  breakThresholdMin: 300,
  breakDeductMin: 30,
  restDay: 0,
  longShiftFlagMin: 960,
});

const FIELDS = Object.freeze({
  dailyRegularMin: [1, 1440],
  breakThresholdMin: [0, 1440],
  breakDeductMin: [0, 240],
  restDay: [0, 6],
  longShiftFlagMin: [60, 1440],
});

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function settingsError(message) {
  const error = new RangeError(message);
  error.code = "invalid-argument";
  return error;
}

function validateHoursSettings(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw settingsError("Hours settings are required.");
  const extra = Object.keys(input).filter((key) => !(key in FIELDS));
  if (extra.length) throw settingsError("Unknown hours setting: " + extra.join(", ") + ".");
  const values = {};
  for (const [key, [min, max]] of Object.entries(FIELDS)) {
    const value = input[key];
    if (!Number.isSafeInteger(value) || value < min || value > max) {
      throw settingsError(key + " must be a whole number from " + min + " to " + max + ".");
    }
    values[key] = value;
  }
  if (values.breakDeductMin > values.breakThresholdMin) {
    throw settingsError("breakDeductMin cannot exceed breakThresholdMin, or a short shift could pay negative time.");
  }
  return values;
}

function isSaturday(date) {
  if (typeof date !== "string" || !DATE_PATTERN.test(date)) return false;
  const time = Date.parse(date + "T00:00:00Z");
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === date && new Date(time).getUTCDay() === 6;
}

// effectiveFrom must start a pay week and must not reach back before the
// current pay week. Once pay weeks lock, `earliest` becomes the day after the
// last locked week.
function validateEffectiveFrom(effectiveFrom, earliest) {
  if (!isSaturday(effectiveFrom)) throw settingsError("Settings take effect from the start of a pay week (a Saturday).");
  if (!isSaturday(earliest)) throw new Error("Earliest effective date must be a Saturday.");
  if (effectiveFrom < earliest) throw settingsError("Settings cannot take effect before " + earliest + ".");
  return effectiveFrom;
}

/**
 * Settings that apply to the pay week starting `weekStart`.
 * versions: [{id, status, effectiveFrom, decidedAt, values}]. Only approved count.
 */
function settingsForWeek(versions, weekStart) {
  let chosen = null;
  for (const version of versions ?? []) {
    if (version?.status !== "approved" || typeof version.effectiveFrom !== "string" || version.effectiveFrom > weekStart) continue;
    if (!chosen || version.effectiveFrom > chosen.effectiveFrom ||
        (version.effectiveFrom === chosen.effectiveFrom && (version.decidedAt > chosen.decidedAt ||
          (version.decidedAt === chosen.decidedAt && version.id > chosen.id)))) {
      chosen = version;
    }
  }
  if (!chosen) return {versionId: "default", effectiveFrom: null, values: {...DEFAULT_HOURS_SETTINGS}};
  return {versionId: chosen.id, effectiveFrom: chosen.effectiveFrom, values: validateHoursSettings(chosen.values)};
}

module.exports = {DEFAULT_HOURS_SETTINGS, validateHoursSettings, validateEffectiveFrom, settingsForWeek, isSaturday};
