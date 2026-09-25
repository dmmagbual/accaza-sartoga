"use strict";

// Closing background-task dead letters (25 Sep 2026).
//
// A dead letter records a trigger that stopped retrying (see retry-guard.js). It
// used to stay "open" for the whole 7-day exception window even after the linked
// record was repaired, so System Health kept showing a critical card for work that
// was already done, and staff learned to ignore red cards.
//
// Two ways to close one, both auditable and both idempotent:
// 1. Verified: the health scan reads the linked record and closes the dead letter
//    only when the record proves the work is complete. Only triggers with a probe
//    below can be verified; everything else stays open for a person.
// 2. Manual: a manager closes it with a written note. When a probe exists and the
//    linked record is found but still incomplete, a manual close is refused, so a
//    real posting gap can never be hidden by clicking a button.

const NOTE_MIN = 10;
const NOTE_MAX = 500;
// Bounded work per health scan: each verification is a few tiny field reads.
const MAX_VERIFY_PER_SCAN = 25;

const ORDER_ID = /^[A-Za-z0-9_-]{1,80}$/;

// Probes read only the named fields of the live order, then of the archived copy.
const PROBES = {
  onOrderFinalize: {
    param: "orderId",
    fields: ["status", "inventoryDeducted", "inventoryLedgerVersion"],
    complete: (row) => row.inventoryDeducted === true && Number(row.inventoryLedgerVersion) === 1,
    doneText: (id) => `Order ${id} now has its inventory posting confirmed.`,
    pendingText: (id) => `Order ${id} still has no confirmed inventory posting. Complete it first (Recipes → Sales awaiting cost → Check past sales, or Complete inventory posting); the card closes on the next health check.`,
  },
  onOrderInventoryReversal: {
    param: "orderId",
    fields: ["status", "inventoryReversed"],
    complete: (row) => row.inventoryReversed === true,
    doneText: (id) => `Order ${id} now has its stock return confirmed.`,
    pendingText: (id) => `Order ${id} still has no confirmed stock return for its void or refund. Complete the reversal first; the card closes on the next health check.`,
  },
};

function probeFor(row) {
  const probe = row && PROBES[String(row.function || "")];
  if (!probe) return null;
  const id = String((row.params || {})[probe.param] || "");
  return ORDER_ID.test(id) ? {probe, id} : null;
}

// fields: {live: {field: value}|null, archived: {field: value}|null}. A record with
// every probed field empty does not exist at that location.
function present(fields) {return !!fields && Object.keys(fields).some((key) => fields[key] !== null && fields[key] !== undefined);}
function evaluate(row, fields) {
  const target = probeFor(row);
  if (!target) return {verifiable: false, state: "unverifiable"};
  const record = present(fields && fields.live) ? fields.live : present(fields && fields.archived) ? fields.archived : null;
  if (!record) return {verifiable: false, state: "record_missing", recordId: target.id};
  if (target.probe.complete(record)) return {verifiable: true, state: "complete", recordId: target.id, text: target.probe.doneText(target.id)};
  return {verifiable: true, state: "incomplete", recordId: target.id, text: target.probe.pendingText(target.id)};
}

function cleanNote(note) {
  const text = String(note == null ? "" : note).replace(/\s+/g, " ").trim();
  if (text.length < NOTE_MIN) return {ok: false, message: `Write at least ${NOTE_MIN} characters on what was checked and fixed.`};
  return {ok: true, text: text.slice(0, NOTE_MAX)};
}

function resolutionFields({method, note, actor, evidence, now}) {
  return {
    status: "resolved",
    resolvedAt: now,
    resolution: method === "verified" ? "verified_complete" : "manual",
    resolutionNote: String(note || "").slice(0, NOTE_MAX),
    resolvedBy: method === "verified" ? "server" : String(actor && actor.uid || "").slice(0, 128),
    resolvedByRole: method === "verified" ? "server" : String(actor && actor.role || "").slice(0, 40),
    resolutionEvidence: evidence || null,
  };
}

// Transaction body: only an open dead letter changes; an already closed one is left as is.
function closeIfOpen(current, fields) {
  if (!current || current.status !== "open") return undefined;
  return Object.assign({}, current, fields);
}

// Remove one closed item from a saved scan result and recount, so the card disappears
// for every viewer at once instead of waiting for the next manual health check.
function withoutException(result, id) {
  if (!result || !Array.isArray(result.exceptions)) return result;
  const exceptions = result.exceptions.filter((x) => !(x && x.category === "background_failure" && x.id === id));
  if (exceptions.length === result.exceptions.length) return result;
  return Object.assign({}, result, {exceptions, counts: {critical: exceptions.filter((x) => x.severity === "critical").length, warning: exceptions.filter((x) => x.severity === "warning").length, total: exceptions.length}});
}

module.exports = {NOTE_MIN, NOTE_MAX, MAX_VERIFY_PER_SCAN, PROBES, probeFor, evaluate, cleanNote, resolutionFields, closeIfOpen, withoutException};
