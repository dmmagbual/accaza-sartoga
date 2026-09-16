"use strict";

const {canonicalJson} = require("./recovery-validation");

// Incremental daily backups (Sep 2026 download audit).
//
// The daily backup used to download the whole Realtime Database (13 MB on
// 15 Sep 2026, growing ~0.3 MB a day, so ~130 MB a day within a year). The
// large, growing history nodes below now change the backup only through the
// records that were written: a trigger marks /backupDirty/<path>/<key>, and the
// daily run copies everything else about those nodes from the previous verified
// backup file in Cloud Storage. All other nodes are still read in full. Each day
// one ~2 MB key-range slice of the tracked history (in rotation) is also read
// and compared with its incremental copy, so a missed marker is corrected and
// reported without any day re-reading a whole growing node. A full read of
// everything runs only when the previous file is missing, invalid or older than
// eight days (or when forced).
//
// The output is the same backup-v2 envelope as before, so restores and the
// isolated restore gate are unchanged.

const TRACKED_PATHS = Object.freeze([
  "archivedOrders",
  "inventoryMovements",
  "orderInventoryPlans",
  "financialMovements",
  "cashBalanceSummaryApplied",
  "books/journal",
  "shifts",
  "operationalAudit",
  "financialCommandClaims",
  "inventoryAccounting",
  "financialApprovals",
  "activityLog",
  "cfLedger",
]);
const DIRTY_ROOT = "backupDirty";
const MAX_BASE_AGE_MS = 8 * 86400000;
const DAY_MS = 86400000;
const VERIFY_SLICE_BYTES = 2 * 1024 * 1024;

// Realtime Database key order: 32-bit integer keys numerically first, then strings.
const INT_KEY = /^-?(0|[1-9]\d*)$/;
function keyCompare(a, b) {
  const ia = INT_KEY.test(a) && Math.abs(Number(a)) <= 2147483647, ib = INT_KEY.test(b) && Math.abs(Number(b)) <= 2147483647;
  if (ia && ib) return Number(a) - Number(b) || a.length - b.length;
  if (ia) return -1;
  if (ib) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}
function inSlice(key, slice) {
  return (slice.start == null || keyCompare(key, slice.start) >= 0) && (slice.before == null || keyCompare(key, slice.before) < 0);
}
// Partition every tracked path of the base into contiguous key ranges of about `budget` bytes.
function verificationSlices(base, tracked, budget) {
  const limit = Number(budget) > 0 ? Number(budget) : VERIFY_SLICE_BYTES, slices = [];
  (tracked || TRACKED_PATHS).forEach((path) => {
    const node = getAt(base && base.data, path);
    if (!node || typeof node !== "object") return;
    let start = null, size = 0;
    Object.keys(node).sort(keyCompare).forEach((key) => {
      const bytes = Buffer.byteLength(JSON.stringify(node[key]) || "");
      if (size > 0 && size + bytes > limit) { slices.push({path, start, before: key}); start = key; size = 0; }
      size += bytes;
    });
    slices.push({path, start, before: null});
  });
  return slices;
}

function dirtyKey(path) { return String(path).replace(/\//g, "~"); }
function pathOfDirtyKey(key) { return String(key).replace(/~/g, "/"); }
function splitPath(path) { return String(path).split("/").filter(Boolean); }
function getAt(root, path) { return splitPath(path).reduce((node, part) => (node == null ? undefined : node[part]), root); }
function setAt(root, path, value) {
  const parts = splitPath(path);
  let node = root;
  parts.slice(0, -1).forEach((part) => { if (!node[part] || typeof node[part] !== "object") node[part] = {}; node = node[part]; });
  const last = parts[parts.length - 1];
  if (value === null || value === undefined) delete node[last];
  else node[last] = value;
}
function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }

// Top-level nodes with a tracked child path ("books" for "books/journal").
function partialRoots(tracked) {
  const out = {};
  (tracked || TRACKED_PATHS).forEach((path) => { const parts = splitPath(path); if (parts.length > 1) (out[parts[0]] = out[parts[0]] || []).push(parts.slice(1).join("/")); });
  return out;
}

// Decide whether today's backup must be a full read.
function needsFullBackup({base, now, force}) {
  if (force) return "forced";
  if (!base) return "no_base";
  if (!(Number(base.takenAt) > 0) || now - Number(base.takenAt) > MAX_BASE_AGE_MS) return "stale_base";
  return "";
}

// The slice that is re-read and verified today.
function rotationSlice(now, slices) {
  return slices && slices.length ? slices[Math.floor(Number(now) / DAY_MS) % slices.length] : null;
}

// Plan an incremental backup.
//   topLevel: names from a shallow read of "/"; children: {root: [child names]} for partial roots.
//   dirty: {dirtyKey(path): {recordKey: timestamp}}
function planIncremental({base, topLevel, children, excluded, dirty, tracked, verify}) {
  tracked = tracked || TRACKED_PATHS;
  const skip = excluded instanceof Set ? excluded : new Set(excluded || []);
  const partial = partialRoots(tracked), trackedTop = new Set(tracked.filter((p) => splitPath(p).length === 1));
  const plan = {fullNodes: [], copyPaths: [], records: [], fullTracked: [], verifySlice: null};
  (topLevel || []).forEach((name) => {
    if (skip.has(name)) return;
    if (trackedTop.has(name)) {
      if (getAt(base.data, name) === undefined) plan.fullTracked.push(name); else plan.copyPaths.push(name);
      return;
    }
    if (partial[name]) {
      (children && children[name] || []).forEach((child) => {
        const path = `${name}/${child}`;
        if (partial[name].includes(child)) {
          if (getAt(base.data, path) === undefined) plan.fullTracked.push(path); else plan.copyPaths.push(path);
        } else plan.fullNodes.push(path);
      });
      return;
    }
    plan.fullNodes.push(name);
  });
  if (verify && plan.copyPaths.includes(verify.path)) plan.verifySlice = verify;
  const copied = new Set(plan.copyPaths);
  Object.keys(dirty || {}).forEach((key) => {
    const path = pathOfDirtyKey(key);
    if (copied.has(path)) Object.keys(dirty[key] || {}).forEach((recordKey) => plan.records.push({path, key: recordKey}));
  });
  return plan;
}

// Build the snapshot: copied tracked paths from the base, patched with the re-read records,
// plus every node read in full. `values` maps "path" (full reads) and "path/key" (records).
function mergeIncremental(base, plan, values) {
  const data = {};
  plan.copyPaths.forEach((path) => setAt(data, path, clone(getAt(base.data, path))));
  plan.records.forEach(({path, key}) => {
    const node = getAt(data, path) || {};
    const value = values[`${path}/${key}`];
    if (value === null || value === undefined) delete node[key]; else node[key] = value;
    setAt(data, path, Object.keys(node).length ? node : null);
  });
  plan.fullNodes.concat(plan.fullTracked).forEach((path) => setAt(data, path, values[path]));
  return data;
}

// Replace the verified key range with what was read today and report the records that differ.
function applyVerifiedSlice(data, slice, sliceValue) {
  if (!slice) return [];
  const node = getAt(data, slice.path) || {}, fresh = sliceValue || {}, drift = [];
  Object.keys(node).filter((key) => inSlice(key, slice)).forEach((key) => {
    if (!(key in fresh)) { drift.push(`${slice.path}/${key}`); delete node[key]; }
  });
  Object.keys(fresh).filter((key) => inSlice(key, slice)).forEach((key) => {
    if (canonicalJson(node[key] === undefined ? null : node[key]) !== canonicalJson(fresh[key])) drift.push(`${slice.path}/${key}`);
    node[key] = fresh[key];
  });
  setAt(data, slice.path, Object.keys(node).length ? node : null);
  return drift;
}

// Records whose incremental copy differs from a full read.
function driftPaths(incremental, full, tracked) {
  const out = [];
  (tracked || TRACKED_PATHS).forEach((path) => {
    const a = getAt(incremental, path) || {}, b = getAt(full, path) || {};
    new Set([...Object.keys(a), ...Object.keys(b)]).forEach((key) => {
      if (canonicalJson(a[key] === undefined ? null : a[key]) !== canonicalJson(b[key] === undefined ? null : b[key])) out.push(`${path}/${key}`);
    });
  });
  return out;
}

module.exports = {TRACKED_PATHS, DIRTY_ROOT, MAX_BASE_AGE_MS, VERIFY_SLICE_BYTES, keyCompare, inSlice, verificationSlices, rotationSlice, applyVerifiedSlice, dirtyKey, pathOfDirtyKey, getAt, setAt, partialRoots, needsFullBackup, planIncremental, mergeIncremental, driftPaths};
