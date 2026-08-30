"use strict";

const crypto = require("node:crypto");

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((out, key) => { out[key] = stable(value[key]); return out; }, {});
}

function canonicalJson(value) { return JSON.stringify(stable(value)); }
function fingerprint(value) { return crypto.createHash("sha256").update(canonicalJson(value)).digest("hex"); }
function cents(value) { return Math.round((Number(value) || 0) * 100); }

function validateFinancialRows(rows, label, lineKey) {
  const issues = [];
  Object.keys(rows || {}).forEach((id) => {
    const row = rows[id] || {}, lines = Array.isArray(row[lineKey]) ? row[lineKey] : [];
    let net;
    if (lines.length) net = lines.reduce((sum, line) => sum + cents(line.debit) - cents(line.credit), 0);
    else if (row.net && typeof row.net === "object") net = Object.values(row.net).reduce((sum, amount) => sum + cents(amount), 0);
    else { issues.push(`${label}/${id}: missing lines or net balances`); return; }
    if (net !== 0) issues.push(`${label}/${id}: debits and credits differ by ${net} cent(s)`);
  });
  return issues;
}

function validateSnapshot(data) {
  const issues = [];
  if (!data || typeof data !== "object" || Array.isArray(data)) return ["data: snapshot root must be an object"];
  issues.push(...validateFinancialRows(data.financialMovements, "financialMovements", "lines"));
  issues.push(...validateFinancialRows(data.books && data.books.journal, "books/journal", "lines"));
  return issues;
}

function createEnvelope(data, takenAt, excluded) {
  const hash = fingerprint(data);
  return {
    takenAt: Number(takenAt) || Date.now(), version: "backup-v2", excluded: [...(excluded || [])].sort(),
    integrity: {algorithm: "sha256", canonical: "sorted-json-v1", dataSha256: hash}, data,
  };
}

function validateEnvelope(envelope, options) {
  const issues = [];
  if (!envelope || typeof envelope !== "object") return {ok: false, issues: ["backup envelope is not an object"]};
  if (!["backup-v1", "backup-v2"].includes(envelope.version)) issues.push(`unsupported backup version: ${String(envelope.version || "missing")}`);
  if (!(Number(envelope.takenAt) > 0)) issues.push("takenAt is missing or invalid");
  if (!Array.isArray(envelope.excluded)) issues.push("excluded node list is missing");
  if (!(options && options.reconcile === false)) issues.push(...validateSnapshot(envelope.data));
  const actualSha256 = fingerprint(envelope.data || {});
  if (envelope.version === "backup-v2" && String(envelope.integrity && envelope.integrity.dataSha256 || "") !== actualSha256) issues.push("snapshot integrity fingerprint does not match its data");
  return {ok: issues.length === 0, issues, actualSha256};
}

module.exports = {canonicalJson, fingerprint, validateSnapshot, createEnvelope, validateEnvelope};
