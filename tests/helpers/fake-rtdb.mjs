// In-memory Realtime Database for server-side tests (Sep 2026 download audit).
// Implements the Admin SDK surface the functions use (ref, child, queries, get, set, update,
// transaction), orders query results the way the database does, refuses queries that the
// rules do not index (the real SDK would download the whole node instead), and records the
// size of every read so tests can prove what a function downloads.
import {rulesIndex} from '../../tools/download-read-graph.mjs';

const INT_KEY = /^-?(0|[1-9]\d*)$/;
export function keyCompare(a, b) {
  const ia = INT_KEY.test(a) && Math.abs(Number(a)) <= 2147483647, ib = INT_KEY.test(b) && Math.abs(Number(b)) <= 2147483647;
  if (ia && ib) return Number(a) - Number(b) || a.length - b.length;
  if (ia) return -1;
  if (ib) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}
const rank = (v) => v === null || v === undefined ? 0 : v === false ? 1 : v === true ? 2 : typeof v === 'number' ? 3 : typeof v === 'string' ? 4 : 5;
export function valueCompare(a, b) {
  const ra = rank(a), rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (ra === 3) return a - b;
  if (ra === 4) return a < b ? -1 : a > b ? 1 : 0;
  return 0;
}
const clone = (v) => v === undefined ? null : JSON.parse(JSON.stringify(v));
// Snapshot values the way the SDK returns them: an object whose keys are all small integers
// (and at least half of the slots are filled) comes back as an array.
export function rtdbValue(v) {
  if (v === null || v === undefined || typeof v !== 'object') return v === undefined ? null : v;
  if (Array.isArray(v)) v = Object.fromEntries(v.map((x, i) => [String(i), x]).filter(([, x]) => x !== null && x !== undefined));
  const keys = Object.keys(v).filter((k) => v[k] !== null && v[k] !== undefined && !(typeof v[k] === 'object' && !Object.keys(v[k]).length)), out = {};
  if (!keys.length) return null;
  keys.forEach((k) => { out[k] = rtdbValue(v[k]); });
  if (keys.length && keys.every((k) => /^(0|[1-9]\d*)$/.test(k))) {
    const max = Math.max(...keys.map(Number));
    if (max < keys.length * 2) { const arr = new Array(max + 1).fill(null); keys.forEach((k) => { arr[Number(k)] = out[k]; }); return arr; }
  }
  return out;
}
const parts = (path) => String(path || '').split('/').filter(Boolean);
function ordered(obj) { const out = {}; Object.keys(obj).sort(keyCompare).forEach((k) => { out[k] = obj[k]; }); return out; }
function prune(value) {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) value = Object.fromEntries(value.map((x, i) => [String(i), x]));
  const out = {};
  Object.keys(value).forEach((k) => { const v = prune(value[k]); if (v !== undefined) out[k] = v; });
  return Object.keys(out).length ? out : undefined;
}

export function createFakeDatabase(initial, {rules} = {}) {
  let root = prune(clone(initial)) || {};
  const indexed = rules ? rulesIndex(rules) : null;
  const reads = [];
  const at = (path) => parts(path).reduce((node, p) => node == null || typeof node !== 'object' ? undefined : node[p], root);
  function write(path, value) {
    const ps = parts(path);
    if (!ps.length) { root = prune(clone(value)) || {}; return; }
    const stack = [root];
    let node = root;
    for (const p of ps.slice(0, -1)) { if (!node[p] || typeof node[p] !== 'object') node[p] = {}; node = node[p]; stack.push(node); }
    const v = prune(clone(value));
    if (v === undefined) delete node[ps.at(-1)]; else node[ps.at(-1)] = v;
    // remove empty parents, as the database does
    for (let i = ps.length - 1; i > 0; i--) { const parent = stack[i - 1], key = ps[i - 1]; if (parent[key] && typeof parent[key] === 'object' && !Object.keys(parent[key]).length) delete parent[key]; else break; }
  }
  const snapshot = (key, value) => ({key, exists: () => value !== undefined && value !== null, val: () => rtdbValue(clone(value)), numChildren: () => value && typeof value === 'object' ? Object.keys(value).length : 0});
  function makeRef(path, q = {}) {
    const key = parts(path).at(-1) || null;
    const withQ = (extra) => makeRef(path, Object.assign({}, q, extra));
    const api = {
      key, path: '/' + parts(path).join('/'),
      toString: () => 'https://fake.firebaseio.test/' + parts(path).join('/'),
      child: (c) => makeRef(`${path}/${c}`),
      orderByChild: (field) => {
        if (indexed && !indexed(parts(path).join('/'), field)) throw new Error(`Unindexed query: /${parts(path).join('/')} by ${field}`);
        return withQ({by: 'child', field});
      },
      orderByKey: () => withQ({by: 'key'}),
      orderByValue: () => withQ({by: 'value'}),
      startAt: (v, k) => withQ({start: v, startKey: k}), endAt: (v, k) => withQ({end: v, endKey: k}),
      startAfter: (v) => withQ({after: v}), endBefore: (v) => withQ({before: v}),
      equalTo: (v) => withQ({start: v, end: v}),
      limitToFirst: (n) => withQ({first: n}), limitToLast: (n) => withQ({last: n}),
      async get() {
        const value = at(path);
        let result = value;
        const isQuery = q.by || q.first || q.last;
        if (isQuery) {
          const node = value && typeof value === 'object' ? value : {};
          const sortVal = (k) => q.by === 'child' ? parts(q.field).reduce((n, p) => n == null || typeof n !== 'object' ? undefined : n[p], node[k]) : q.by === 'value' ? node[k] : k;
          const cmp = (a, b) => (q.by === 'key' || !q.by ? keyCompare(a, b) : valueCompare(sortVal(a), sortVal(b)) || keyCompare(a, b));
          let keys = Object.keys(node).sort(cmp);
          const vc = (k, v) => q.by === 'key' || !q.by ? keyCompare(k, String(v)) : valueCompare(sortVal(k), v);
          if ('start' in q) keys = keys.filter((k) => vc(k, q.start) >= 0);
          if ('end' in q) keys = keys.filter((k) => vc(k, q.end) <= 0);
          if ('after' in q) keys = keys.filter((k) => vc(k, q.after) > 0);
          if ('before' in q) keys = keys.filter((k) => vc(k, q.before) < 0);
          if (q.first) keys = keys.slice(0, q.first);
          if (q.last) keys = keys.slice(-q.last);
          const out = {}; keys.forEach((k) => { out[k] = node[k]; });
          result = keys.length ? ordered(out) : undefined;
        } else if (result && typeof result === 'object') result = ordered(result);
        reads.push({path: parts(path).join('/'), query: isQuery ? Object.assign({}, q) : null, bytes: result === undefined ? 0 : JSON.stringify(result).length});
        return snapshot(key, result);
      },
      async once() { return api.get(); },
      async set(value) { write(path, value); },
      async remove() { write(path, null); },
      async update(values) {
        const base = parts(path).join('/');
        const keys = Object.keys(values);
        keys.forEach((k) => { const full = parts(`${base}/${k}`).join('/'); if (keys.some((other) => other !== k && parts(`${base}/${other}`).join('/').startsWith(full + '/'))) throw new Error(`Ancestor/descendant update: ${k}`); });
        keys.forEach((k) => write(`${base}/${k}`, values[k]));
      },
      async transaction(fn) {
        const current = clone(at(path));
        const next = fn(current === null ? null : current);
        if (next === undefined) return {committed: false, snapshot: snapshot(key, at(path))};
        write(path, next);
        return {committed: true, snapshot: snapshot(key, at(path))};
      },
    };
    return api;
  }
  return {
    ref: (path = '/') => makeRef(path),
    reads,
    data: () => clone(root),
    bytesRead: () => reads.reduce((sum, r) => sum + r.bytes, 0),
    resetReads: () => { reads.length = 0; },
  };
}
