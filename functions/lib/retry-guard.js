"use strict";

// Bounded retries for `retry: true` database triggers.
//
// A retried trigger that fails deterministically (a bad record, a code bug, a
// schema mismatch) is redelivered by the platform for up to days. Every
// redelivery re-runs the handler and re-downloads whatever it reads, which is
// how a single stuck event turns into gigabytes of Realtime Database downloads
// (updateCashBalanceSummary on 15-16 Sep 2026, onOrderFinalize on 3-14 Sep 2026).
//
// Inside the retry window the original error is rethrown so transient failures
// (contention, cold starts, brief outages) still self-heal. Once the event is
// older than the window, the failure is recorded as a durable dead letter and
// the event is acknowledged. Nothing financial is skipped silently: the dead
// letter is surfaced by the operational exception scan, and every posting
// workflow keeps its own gap detector and controlled repair path.

const crypto = require("node:crypto");

const DEFAULT_MAX_RETRY_AGE_MS = 2 * 60 * 60 * 1000;
const DEAD_LETTER_ROOT = "functionDeadLetters";
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
    error: String(error && (error.stack || error.message) || error || "Unknown error").split("\n")[0].slice(0, 500),
    status: "open",
    schemaVersion: SCHEMA_VERSION,
  };
}

// deps: {now(), functionName(), recordDeadLetter(key, record), logError(message, context), maxRetryAgeMs}
function guardRetryHandler(ref, handler, deps) {
  const maxAge = Number(deps && deps.maxRetryAgeMs) > 0 ? Number(deps.maxRetryAgeMs) : DEFAULT_MAX_RETRY_AGE_MS;
  return async function boundedRetryHandler(event) {
    try {
      return await handler(event);
    } catch (error) {
      const now = deps.now(), age = eventAgeMs(event, now);
      if (!age || age < maxAge) throw error;
      const name = deps.functionName(), key = deadLetterKey(name, event), record = deadLetterRecord(name, ref, event, error, now);
      // If the dead letter cannot be written, keep the platform retry: losing
      // the audit trail is worse than one more redelivery.
      await deps.recordDeadLetter(key, record);
      deps.logError("Retry budget exhausted; event acknowledged and recorded for review", {deadLetter: key, function: record.function, ref: record.ref, params: record.params, ageMs: age, error: record.error});
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

module.exports = {DEFAULT_MAX_RETRY_AGE_MS, DEAD_LETTER_ROOT, SCHEMA_VERSION, eventAgeMs, deadLetterKey, deadLetterRecord, guardRetryHandler, wrapTriggerFactory};
