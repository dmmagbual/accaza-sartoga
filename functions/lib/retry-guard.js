"use strict";

// Bounded retries for `retry: true` database triggers.
//
// A retried trigger that fails deterministically (a bad record, a code bug, a
// schema mismatch) is redelivered by the platform for up to days. Every
// redelivery re-runs the handler and re-downloads whatever it reads, which is
// how a single stuck event turns into gigabytes of Realtime Database downloads
// (updateCashBalanceSummary on 15-16 Sep 2026, onOrderFinalize on 3-14 Sep 2026).
//
// A failing event is retried at most MAX_RETRIES times (the first delivery plus 10
// retries). Each failure is counted in /functionRetryAttempts; while the count is
// below the cap the original error is rethrown so transient failures (contention,
// cold starts, brief outages) still self-heal. On the last allowed failure, or if
// the event is older than the age backstop, the failure is recorded as a durable
// dead letter and the event is acknowledged.
//
// A per-function daily budget stops a systematic fault (a bad release that makes
// every event fail) from multiplying retries by sales volume: once more than
// MAX_FAILED_EVENTS_PER_DAY distinct events of one function have failed on a Manila
// day, every further failure of that function that day is dead-lettered at once,
// with no retries, and flagged as a stopped function. Nothing financial is skipped silently: the dead
// letter is surfaced by the operational exception scan, and every posting
// workflow keeps its own gap detector and controlled repair path.

const crypto = require("node:crypto");

const MAX_RETRIES = 10;
const MAX_ATTEMPTS = MAX_RETRIES + 1;
const MAX_FAILED_EVENTS_PER_DAY = 20;
const BUDGET_ROOT = "functionFailureBudget";
function budgetDay(now) { return new Date(Number(now) + 8 * 3600000).toISOString().slice(0, 10); }
// Backstop only: used when the failure counter cannot be read or written.
const DEFAULT_MAX_RETRY_AGE_MS = 2 * 60 * 60 * 1000;
const DEAD_LETTER_ROOT = "functionDeadLetters";
const ATTEMPTS_ROOT = "functionRetryAttempts";
const SCHEMA_VERSION = 1;

function eventTimeMs(event) {
  const parsed = Date.parse(event && event.time || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function eventAgeMs(event, now) {
  const at = eventTimeMs(event);
  return at ? Math.max(0, Number(now) - at) : 0;
}

function deadLetterKey(functionName, event) {
  const identity = `${String(functionName || "trigger")}:${String(event && event.id || "")}:${String(event && event.time || "")}`;
  return crypto.createHash("sha256").update(identity).digest("hex").slice(0, 40);
}

function cleanParams(params) {
  const out = {};
  Object.keys(params || {}).slice(0, 10).forEach((key) => {
    const safeKey = String(key).replace(/[.#$\[\]\/]/g, "_").slice(0, 60);
    if (safeKey) out[safeKey] = String(params[key] == null ? "" : params[key]).slice(0, 160);
  });
  return out;
}

function deadLetterRecord(functionName, ref, event, error, now) {
  return {
    function: String(functionName || "unknown").slice(0, 100),
    ref: String(ref || "").slice(0, 200),
    params: cleanParams(event && event.params),
    eventId: String(event && event.id || "").slice(0, 160),
    eventTime: eventTimeMs(event) || null,
    abandonedAt: now,
    ageMs: eventAgeMs(event, now),
    attempts: null,
    error: String(error && (error.stack || error.message) || error || "Unknown error").split("\n")[0].slice(0, 500),
    status: "open",
    schemaVersion: SCHEMA_VERSION,
  };
}

// deps: {now(), functionName(), recordDeadLetter(key, record), countFailure(key, info) -> attempts,
//        clearFailures(key), recordFunctionFailure({function, day, newEvent}) -> {events},
//        logError(message, context), maxRetryAgeMs, maxAttempts, maxFailedEventsPerDay}
function guardRetryHandler(ref, handler, deps) {
  const maxAge = Number(deps && deps.maxRetryAgeMs) > 0 ? Number(deps.maxRetryAgeMs) : DEFAULT_MAX_RETRY_AGE_MS;
  const maxAttempts = Number(deps && deps.maxAttempts) > 0 ? Math.floor(Number(deps.maxAttempts)) : MAX_ATTEMPTS;
  const maxEvents = Number(deps && deps.maxFailedEventsPerDay) > 0 ? Math.floor(Number(deps.maxFailedEventsPerDay)) : MAX_FAILED_EVENTS_PER_DAY;
  return async function boundedRetryHandler(event) {
    try {
      return await handler(event);
    } catch (error) {
      const now = deps.now(), age = eventAgeMs(event, now);
      const name = deps.functionName(), key = deadLetterKey(name, event);
      let attempts = 0;
      try {
        attempts = Number(await deps.countFailure(key, {function: String(name || "unknown").slice(0, 100), eventId: String(event && event.id || "").slice(0, 160), at: now})) || 0;
      } catch (countError) {
        deps.logError("Retry counter unavailable; the age backstop applies", {function: name, error: String(countError && countError.message || countError)});
      }
      let failedEvents = 0;
      try {
        const budget = await deps.recordFunctionFailure({function: String(name || "unknown").slice(0, 100), day: budgetDay(now), newEvent: attempts === 1});
        failedEvents = Number(budget && budget.events) || 0;
      } catch (budgetError) {
        deps.logError("Daily failure budget unavailable; the per-event limit applies", {function: name, error: String(budgetError && budgetError.message || budgetError)});
      }
      const functionStopped = failedEvents > maxEvents;
      const exhausted = functionStopped || attempts >= maxAttempts || (age > 0 && age >= maxAge);
      if (!exhausted) throw error;
      const record = Object.assign(deadLetterRecord(name, ref, event, error, now), {attempts: attempts || null, functionStopped, failedEventsToday: failedEvents || null});
      // If the dead letter cannot be written, keep the platform retry: losing
      // the audit trail is worse than one more redelivery.
      await deps.recordDeadLetter(key, record);
      try { await deps.clearFailures(key); } catch (_e) { /* pruned daily */ }
      deps.logError("Retry budget exhausted; event acknowledged and recorded for review", {deadLetter: key, function: record.function, ref: record.ref, params: record.params, attempts, failedEventsToday: failedEvents, functionStopped, ageMs: age, error: record.error});
      return null;
    }
  };
}

// Wrap a firebase-functions v2 database trigger factory so every `retry: true`
// registration is bounded, including triggers added in future releases.
function wrapTriggerFactory(factory, deps) {
  return function boundedTriggerFactory(options, handler) {
    if (options && typeof options === "object" && options.retry === true && typeof handler === "function") {
      return factory(options, guardRetryHandler(options.ref, handler, deps));
    }
    return factory(options, handler);
  };
}

module.exports = {MAX_RETRIES, MAX_ATTEMPTS, MAX_FAILED_EVENTS_PER_DAY, BUDGET_ROOT, budgetDay, ATTEMPTS_ROOT, DEFAULT_MAX_RETRY_AGE_MS, DEAD_LETTER_ROOT, SCHEMA_VERSION, eventAgeMs, deadLetterKey, deadLetterRecord, guardRetryHandler, wrapTriggerFactory};
