"use strict";

const FORBIDDEN_PATH_CHARACTERS = /[.#$\[\]\u0000-\u001f\u007f]/;

class UnsafeAtomicUpdateError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "UnsafeAtomicUpdateError";
    this.code = "unsafe-atomic-update";
    this.details = details;
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneValue(value, path) {
  if (value === undefined || typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") throw new UnsafeAtomicUpdateError("Atomic update contains an unsupported value.", {path});
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) throw new UnsafeAtomicUpdateError("Atomic update contains a non-finite number.", {path});
    return value;
  }
  if (Array.isArray(value)) return value.map((entry, index) => cloneValue(entry, `${path}/${index}`));
  if (!isPlainObject(value)) throw new UnsafeAtomicUpdateError("Atomic update contains a non-plain object.", {path});
  const copy = {};
  Object.keys(value).forEach((key) => { copy[key] = cloneValue(value[key], `${path}/${key}`); });
  return copy;
}

function validatePath(path) {
  if (typeof path !== "string" || !path || path.startsWith("/") || path.endsWith("/") || path.includes("//")) throw new UnsafeAtomicUpdateError("Atomic update contains an invalid destination path.", {path});
  if (path.split("/").some((segment) => !segment || FORBIDDEN_PATH_CHARACTERS.test(segment))) throw new UnsafeAtomicUpdateError("Atomic update contains a forbidden destination path.", {path});
}

function equivalent(left, right) { return JSON.stringify(left) === JSON.stringify(right); }

function mergeChild(parent, relativePath, value, parentPath) {
  if (!isPlainObject(parent)) throw new UnsafeAtomicUpdateError("An atomic update mixes a record with one of its child paths.", {parentPath, childPath:`${parentPath}/${relativePath}`});
  const segments = relativePath.split("/"); let target = parent;
  while (segments.length > 1) {
    const segment = segments.shift();
    if (target[segment] == null) target[segment] = {};
    if (!isPlainObject(target[segment])) throw new UnsafeAtomicUpdateError("An atomic update would overwrite a child of a non-object value.", {parentPath, childPath:`${parentPath}/${relativePath}`});
    target = target[segment];
  }
  const leaf = segments[0];
  if (Object.prototype.hasOwnProperty.call(target, leaf) && !equivalent(target[leaf], value)) throw new UnsafeAtomicUpdateError("An atomic update assigns conflicting values to the same destination.", {parentPath, childPath:`${parentPath}/${relativePath}`});
  target[leaf] = value;
}

function normalizeAtomicUpdatePaths(input) {
  if (!isPlainObject(input)) throw new UnsafeAtomicUpdateError("Atomic update payload must be a plain object.");
  const sourcePaths = Object.keys(input);
  if (sourcePaths.length > 5000) throw new UnsafeAtomicUpdateError("Atomic update contains too many destination paths.", {count:sourcePaths.length});
  sourcePaths.forEach(validatePath);
  const sorted = sourcePaths.sort((left, right) => left.split("/").length - right.split("/").length || left.localeCompare(right));
  const normalized = {};
  for (const path of sorted) {
    const value = cloneValue(input[path], path);
    const parentPath = Object.keys(normalized).find((candidate) => path.startsWith(`${candidate}/`));
    if (!parentPath) normalized[path] = value;
    else mergeChild(normalized[parentPath], path.slice(parentPath.length + 1), value, parentPath);
  }
  return normalized;
}

async function safeAtomicUpdate(db, writes) {
  const normalized = normalizeAtomicUpdatePaths(writes);
  if (Object.keys(normalized).length) await db.ref().update(normalized);
}

module.exports = {UnsafeAtomicUpdateError, normalizeAtomicUpdatePaths, safeAtomicUpdate};
