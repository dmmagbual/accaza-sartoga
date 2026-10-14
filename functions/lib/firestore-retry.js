"use strict";

// Bounded, jittered retry for Firestore work that aborts under cross-transaction
// contention (gRPC 10 ABORTED).
//
// Firestore aborts a transaction when another transaction touches the same
// document, and the caller must retry. The Admin SDK's built-in retry is not
// enough when one document is written by many callers at once: the monthly
// sales summary (historicalSalesMonths/{YYYY-MM}) is written by every archived
// order in that month. When the abort survives every built-in attempt the
// trigger throws, the retry guard counts each throw against the per-function
// daily budget (20 distinct events), and once that budget trips every further
// failure is dead-lettered until the next day - the October 2026
// replicateArchivedOrderToFirestore dead letters ("Error 10 ABORTED: Aborted
// due to cross-transaction contention").
//
// A read-then-write transaction whose callback re-reads current state and
// writes a deterministic value is safe to replay, so transient contention is
// absorbed here instead of reaching the retry guard. Only genuinely transient
// codes are retried: a permission, validation, not-found or already-exists
// failure is rethrown on the first attempt so real faults still dead-letter and
// stay visible in Operations.

const TRANSIENT_CODES = new Set([4, 10, 14]); // DEADLINE_EXCEEDED, ABORTED, UNAVAILABLE
const TRANSIENT_TEXT = /\b(ABORTED|UNAVAILABLE|DEADLINE_EXCEEDED|ECONNRESET|ETIMEDOUT|ESOCKETTIMEDOUT)\b|socket hang up|(?:cross-)?transaction contention/i;

const DEFAULT_ATTEMPTS = 8;
const DEFAULT_BASE_DELAY_MS = 60;
const DEFAULT_MAX_DELAY_MS = 1200;

function numericCode(value) {
  // null, "" and undefined must stay "no code": Number(null) and Number("") are
  // both 0, which would silently skip the message fallback below.
  if (value === undefined || value === null || value === "") return null;
  const code = Number(value);
  return Number.isFinite(code) ? code : null;
}

function errorCode(error) {
  if (!error || typeof error !== "object") return null;
  const code = numericCode(error.code);
  return code !== null ? code : numericCode(error.status);
}

function isTransient(error) {
  if (!error) return false;
  const code = errorCode(error);
  if (code !== null && TRANSIENT_CODES.has(code)) return true;
  const text = String(error.message || error.details || error || "");
  // "code" is checked first, so a numeric permanent code is never retried on
  // account of wording in its message.
  return code === null && TRANSIENT_TEXT.test(text);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// options: {attempts, baseDelayMs, maxDelayMs, onRetry(info)}
// onRetry is how absorbed contention stays visible: a replay that is never
// logged is a silent slow path, and an exhausted budget must still be
// distinguishable from one that never had to retry.
async function retryTransient(operation, options = {}) {
  const attempts = Number(options.attempts) > 0 ? Math.floor(Number(options.attempts)) : DEFAULT_ATTEMPTS;
  const baseDelayMs = Number(options.baseDelayMs) > 0 ? Math.floor(Number(options.baseDelayMs)) : DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = Number(options.maxDelayMs) > 0 ? Math.floor(Number(options.maxDelayMs)) : DEFAULT_MAX_DELAY_MS;
  const onRetry = typeof options.onRetry === "function" ? options.onRetry : null;
  let attempt = 0;
  for (;;) {
    try {
      return await operation();
    } catch (error) {
      attempt += 1;
      if (attempt >= attempts || !isTransient(error)) throw error;
      const ceiling = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt - 1));
      // Jittered around the ceiling so concurrent retries from one contention
      // burst do not collide again in lockstep, then hard-capped so maxDelayMs
      // stays a real bound on the added latency.
      const delayMs = Math.max(1, Math.min(maxDelayMs, Math.round(ceiling * (0.5 + Math.random()))));
      if (onRetry) {
        // A logging failure must never turn a replayable failure into a thrown one.
        try {
          onRetry({attempt, attempts, code: errorCode(error), delayMs, message: String(error && error.message || error || "").slice(0, 200)});
        } catch (_logError) { /* the retry matters more than the log line */ }
      }
      await sleep(delayMs);
    }
  }
}

// One attempt per call, so the delay budget above stays authoritative and every
// replay re-reads current state instead of reusing a stale transaction read.
function runTransaction(firestore, updateFunction, options = {}) {
  return retryTransient(() => firestore.runTransaction(updateFunction, {maxAttempts: 1}), options);
}

// The rollup backfill and other batch maintenance run many transactions inside
// one callable: a shorter budget keeps one contended order from consuming the
// callable's whole timeout before it can save its progress cursor.
function batchOptions(options = {}) {
  return Object.assign({attempts: 4, maxDelayMs: 400}, options);
}

module.exports = {TRANSIENT_CODES, DEFAULT_ATTEMPTS, DEFAULT_BASE_DELAY_MS, DEFAULT_MAX_DELAY_MS, isTransient, sleep, retryTransient, runTransaction, batchOptions};
