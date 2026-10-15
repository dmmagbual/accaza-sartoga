// Accaza data-flow map generator.
//
// The admin, POS, Finance Books and customer screens rarely call server code
// directly. They write a Realtime Database record (or call a callable), and a
// Cloud Function that watches that record reacts. Those links never appear in
// an import graph, so this tool reads the authoritative Functions source
// sections (src/functions/*.js, which build:runtime concatenates into
// functions/index.js) plus functions/lib/*.js and records, for every export:
//   - how it runs (database trigger, callable, schedule) and the path it watches
//   - the database nodes its code (and the helpers it calls) writes and reads
// It then renders docs/DATA_FLOW_MAP.md, including the curated money paths in
// tools/data-flow-money-paths.json, which are validated against the scan.
//
// Usage:  node tools/data-flow-map.mjs           (rewrite docs/DATA_FLOW_MAP.md)
//         node tools/data-flow-map.mjs --check   (exit 1 if the map is stale)
//
// Static analysis is a starting point for diagnosis, not proof. Helper calls are
// followed by name; dynamic paths and calls through variables can be missed, and
// a shared helper can make a function look like it touches more than it does.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const MAP_FILE = 'docs/DATA_FLOW_MAP.md';
export const FLOWS_FILE = 'tools/data-flow-money-paths.json';
const SOURCE_DIR = 'src/functions';
const LIB_DIR = 'functions/lib';
const WRITE_METHODS = new Set(['set', 'update', 'transaction', 'push', 'remove', 'setWithPriority', 'setPriority']);
const READ_METHODS = new Set(['get', 'once', 'on', 'orderByChild', 'orderByKey', 'orderByValue', 'limitToFirst', 'limitToLast', 'equalTo', 'startAt', 'endAt', 'startAfter', 'endBefore']);
const REGEX_KEYWORDS = new Set(['return', 'typeof', 'case', 'in', 'of', 'delete', 'void', 'throw', 'new', 'else', 'do', 'instanceof', 'await', 'yield']);
const NOT_CALLS = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'typeof', 'await', 'new', 'require']);

// ---------------------------------------------------------------------------
// Lexer: blank out comments and literals (same length, newlines kept) so brace
// and paren matching is safe, and collect string/template literals separately.
export function lex(src) {
  const out = src.split('');
  const literals = [];
  let i = 0, lastSig = '', lastWord = '';
  const blank = (a, b) => { for (let k = a; k < b; k++) if (out[k] !== '\n') out[k] = ' '; };
  const isIdent = (c) => /[A-Za-z0-9_$]/.test(c);
  function readTemplate(start) { // returns [endIndex, textWithHoles]
    let j = start + 1, text = '';
    while (j < src.length) {
      const c = src[j];
      if (c === '\\') { text += src.slice(j, j + 2); j += 2; continue; }
      if (c === '`') return [j + 1, text];
      if (c === '$' && src[j + 1] === '{') {
        let depth = 1, k = j + 2;
        while (k < src.length && depth > 0) {
          const d = src[k];
          if (d === '"' || d === "'") { k = readQuoted(k)[0]; continue; }
          if (d === '`') { k = readTemplate(k)[0]; continue; }
          if (d === '{') depth++; else if (d === '}') depth--;
          k++;
        }
        text += '{*}'; j = k; continue;
      }
      text += c; j++;
    }
    return [j, text];
  }
  function readQuoted(start) {
    const q = src[start]; let j = start + 1, text = '';
    while (j < src.length && src[j] !== q && src[j] !== '\n') { if (src[j] === '\\') { text += src[j + 1]; j += 2; continue; } text += src[j]; j++; }
    return [j + 1, text];
  }
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (c === '/' && n === '/') { const e = src.indexOf('\n', i); const end = e < 0 ? src.length : e; blank(i, end); i = end; continue; }
    if (c === '/' && n === '*') { const e = src.indexOf('*/', i + 2); const end = e < 0 ? src.length : e + 2; blank(i, end); i = end; continue; }
    if (c === '"' || c === "'") { const [end, text] = readQuoted(i); literals.push({start: i, end, text}); blank(i + 1, end - 1); i = end; lastSig = 'lit'; lastWord = ''; continue; }
    if (c === '`') { const [end, text] = readTemplate(i); literals.push({start: i, end, text}); blank(i + 1, end - 1); i = end; lastSig = 'lit'; lastWord = ''; continue; }
    if (c === '/') {
      const regexContext = lastSig === '' || '(,=:[!&|?{};+-*%<>~^'.includes(lastSig) || REGEX_KEYWORDS.has(lastWord);
      if (regexContext) {
        let j = i + 1, inClass = false;
        while (j < src.length && src[j] !== '\n') {
          if (src[j] === '\\') { j += 2; continue; }
          if (src[j] === '[') inClass = true; else if (src[j] === ']') inClass = false;
          else if (src[j] === '/' && !inClass) break;
          j++;
        }
        j++; while (j < src.length && /[a-z]/.test(src[j])) j++;
        blank(i + 1, j); i = j; lastSig = 'lit'; lastWord = ''; continue;
      }
    }
    if (isIdent(c)) { let j = i; while (j < src.length && isIdent(src[j])) j++; lastWord = src.slice(i, j); lastSig = 'id'; i = j; continue; }
    if (!/\s/.test(c)) { lastSig = c; lastWord = ''; }
    i++;
  }
  return {code: out.join(''), literals};
}

function matchClose(code, openIndex) {
  const open = code[openIndex], close = {'(': ')', '{': '}', '[': ']'}[open];
  let depth = 0;
  for (let i = openIndex; i < code.length; i++) {
    if (code[i] === open) depth++;
    else if (code[i] === close && --depth === 0) return i;
  }
  return code.length - 1;
}
const lineOf = (src, index) => src.slice(0, index).split('\n').length;

// ---------------------------------------------------------------------------
export function rootNodes(root = ROOT) {
  const rules = fs.readFileSync(path.join(root, 'database.rules.json'), 'utf8');
  return new Set([...rules.matchAll(/^ {4}"([A-Za-z_$][\w$]*)"\s*:/gm)].map((m) => m[1]));
}

export function normalizePath(text) {
  const parts = String(text).replace(/^\/+|\/+$/g, '').split('/').filter(Boolean)
    .map((p) => (/[{}]/.test(p) ? '{*}' : p));
  return parts.slice(0, 3).join('/');
}

const escapeRe = (s) => s.replace(/[$]/g, '\\$');
function methodOnVariable(code, start, end, variable) {
  const use = new RegExp(`(?<![\\w$.])${escapeRe(variable)}\\s*\\.\\s*(?:child\\([^()]*\\)\\s*\\.\\s*)*([A-Za-z_$][\\w$]*)\\s*\\(`, 'g');
  let kind = '';
  for (const u of code.slice(start, end).matchAll(use)) { if (WRITE_METHODS.has(u[1])) return 'write'; if (READ_METHODS.has(u[1])) kind = 'read'; }
  return kind;
}
function splitTopLevel(text) {
  const parts = []; let depth = 0, from = 0;
  for (let i = 0; i < text.length; i++) { const c = text[i]; if ('([{'.includes(c)) depth++; else if (')]}'.includes(c)) depth--; else if (c === ',' && depth === 0) { parts.push(text.slice(from, i)); from = i + 1; } }
  parts.push(text.slice(from)); return parts.map((p) => p.trim());
}
// A ref held in a variable and handed to a helper (`mergeAt(liveRef, ...)`): the
// write happens inside the helper on its parameter.
function writtenThroughHelper(unit, variable, resolveUnit) {
  const body = unit.code.slice(unit.start, unit.end);
  for (const occ of body.matchAll(new RegExp(`(?<![\\w$.])${escapeRe(variable)}(?![\\w$])`, 'g'))) {
    let depth = 0, i = occ.index - 1;
    for (; i >= 0; i--) { const c = body[i]; if (')]}'.includes(c)) depth++; else if ('([{'.includes(c)) { if (depth === 0) break; depth--; } }
    if (i < 0 || body[i] !== '(') continue;
    const callee = /([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)?)\s*$/.exec(body.slice(Math.max(0, i - 60), i));
    if (!callee) continue;
    const helper = resolveUnit(unit, callee[1].replace(/\s+/g, ''));
    if (!helper) continue;
    const args = splitTopLevel(body.slice(i + 1, matchClose(body, i)));
    const index = args.findIndex((a) => a === variable);
    if (index < 0) continue;
    const open = helper.code.indexOf('(', helper.start);
    const params = splitTopLevel(helper.code.slice(open + 1, matchClose(helper.code, open)));
    const param = (params[index] || '').replace(/=.*$/, '').trim();
    if (/^[A-Za-z_$][\w$]*$/.test(param) && methodOnVariable(helper.code, helper.start, helper.end, param) === 'write') return true;
  }
  return false;
}

function pathReferences(unit, nodes, resolveUnit) {
  const refs = [];
  for (const lit of unit.literals) {
    if (lit.start < unit.start || lit.end > unit.end) continue;
    const text = lit.text.trim();
    if (!/^\/?[A-Za-z_$][\w$]*(\/|$)/.test(text) || /\s/.test(text)) continue;
    const first = text.replace(/^\//, '').split('/')[0];
    if (!nodes.has(first)) continue;
    const before = unit.code.slice(Math.max(0, lit.start - 12), lit.start);
    const inRef = /\b(ref|child)\(\s*$/.test(before);
    if (!inRef && !text.includes('/')) continue;
    let kind = 'ref';
    let k = lit.end; while (/\s/.test(unit.code[k] || '')) k++;
    if (unit.code[k] === ']') { let m = k + 1; while (/\s/.test(unit.code[m] || '')) m++; if (unit.code[m] === ':' || (unit.code[m] === '=' && unit.code[m + 1] !== '=')) kind = 'write'; }
    else if (unit.code[k] === ':' && !/\?\s*$/.test(unit.code.slice(Math.max(0, lit.start - 40), lit.start))) kind = 'write';
    if (kind === 'ref' && inRef) {
      const openIndex = unit.code.lastIndexOf('(', lit.start);
      let after = matchClose(unit.code, openIndex) + 1;
      // walk a .child(...) / query chain and classify by the first terminal method
      for (let guard = 0; guard < 8; guard++) {
        const m = /^\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/.exec(unit.code.slice(after, after + 80));
        if (!m) break;
        if (WRITE_METHODS.has(m[1])) { kind = 'write'; break; }
        if (READ_METHODS.has(m[1]) && !['orderByChild', 'orderByKey', 'orderByValue', 'limitToFirst', 'limitToLast', 'equalTo', 'startAt', 'endAt', 'startAfter', 'endBefore'].includes(m[1])) { kind = 'read'; break; }
        if (READ_METHODS.has(m[1])) kind = 'read';
        after = matchClose(unit.code, after + m[0].length - 1) + 1;
      }
      // `const ref = db.ref(path); await ref.transaction(...)`: classify by how the variable is used.
      const assigned = /\b([A-Za-z_$][\w$]*)\s*=\s*(?:[A-Za-z_$][\w$]*\s*\.\s*)?ref\(\s*$/.exec(unit.code.slice(Math.max(0, openIndex - 80), openIndex + 1));
      if (kind === 'ref' && assigned) {
        kind = methodOnVariable(unit.code, unit.start, unit.end, assigned[1]) || 'ref';
        if (kind !== 'write' && resolveUnit && writtenThroughHelper(unit, assigned[1], resolveUnit)) kind = 'write';
      }
    }
    refs.push({path: normalizePath(text), kind});
  }
  return refs;
}

function calledNames(unit) {
  const body = unit.code.slice(unit.start, unit.end);
  const names = new Set();
  for (const m of body.matchAll(/(?:\b([A-Za-z_$][\w$]*)\s*\.\s*)?\b([A-Za-z_$][\w$]*)\s*\(/g)) {
    if (NOT_CALLS.has(m[2])) continue;
    names.add(m[1] ? `${m[1]}.${m[2]}` : m[2]);
  }
  return names;
}

// Top-level function/arrow declarations of one file.
function declarations(file, src, lexed) {
  const {code} = lexed; const decls = [];
  const declRe = /^(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(|^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\(|[A-Za-z_$][\w$]*\s*=>)/gm;
  let m;
  while ((m = declRe.exec(code))) {
    const name = m[1] || m[2];
    let end;
    if (m[1]) { const p = code.indexOf('(', m.index + m[0].length - 1); const b = code.indexOf('{', matchClose(code, p)); end = matchClose(code, b) + 1; }
    else {
      const arrow = code.indexOf('=>', m.index); const fn = code.indexOf('function', m.index);
      let i = arrow >= 0 && (fn < 0 || arrow < fn) ? arrow + 2 : code.indexOf('{', code.indexOf('(', fn));
      while (/\s/.test(code[i] || '')) i++;
      if (code[i] === '{') end = matchClose(code, i) + 1;
      else { let depth = 0; end = i; for (; end < code.length; end++) { const c = code[end]; if ('([{'.includes(c)) depth++; else if (')]}'.includes(c)) { if (depth === 0) break; depth--; } else if ((c === ';' || c === '\n') && depth === 0) break; } }
    }
    decls.push({name, file, start: m.index, end, line: lineOf(src, m.index)});
    declRe.lastIndex = Math.max(declRe.lastIndex, end);
  }
  return decls;
}

function requireAliases(src) {
  const map = {};
  for (const m of src.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*["']\.\/(?:lib\/)?([\w-]+)(?:\.js)?["']\s*\)/g)) map[m[1]] = `${m[2]}.js`;
  return map;
}

// ---------------------------------------------------------------------------
export function scan(root = ROOT) {
  const nodes = rootNodes(root);
  const units = new Map(); // key -> unit
  const exportsList = [];
  const sectionAliases = {};
  const sections = fs.readdirSync(path.join(root, SOURCE_DIR)).filter((f) => f.endsWith('.js')).sort();
  const libs = fs.readdirSync(path.join(root, LIB_DIR)).filter((f) => f.endsWith('.js')).sort();

  for (const f of libs) {
    const rel = `${LIB_DIR}/${f}`, src = fs.readFileSync(path.join(root, rel), 'utf8'), lexed = lex(src);
    const aliases = requireAliases(src);
    for (const d of declarations(rel, src, lexed)) units.set(`${f}:${d.name}`, Object.assign(d, lexed, {scope: f, aliases}));
  }
  for (const f of sections) {
    const rel = `${SOURCE_DIR}/${f}`, src = fs.readFileSync(path.join(root, rel), 'utf8'), lexed = lex(src);
    Object.assign(sectionAliases, requireAliases(src));
    for (const d of declarations(rel, src, lexed)) units.set(`index:${d.name}`, Object.assign(d, lexed, {scope: 'index'}));
    const re = /\bexports\.([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*\(/g; let m;
    while ((m = re.exec(lexed.code))) {
      const open = m.index + m[0].length - 1, close = matchClose(lexed.code, open);
      const unit = {name: m[1], file: rel, start: m.index, end: close + 1, line: lineOf(src, m.index), code: lexed.code, literals: lexed.literals, scope: 'index'};
      const inside = lexed.literals.filter((l) => l.start > open && l.end <= close);
      const keyed = (key) => inside.find((l) => new RegExp(`\\b${key}\\s*:\\s*$`).test(lexed.code.slice(Math.max(0, l.start - 30), l.start)));
      let kind, watches = '', schedule = '';
      const fn = m[2];
      if (fn === 'onCall' || fn === 'onRequest') kind = fn === 'onCall' ? 'callable' : 'http';
      else if (fn === 'onSchedule') { kind = 'schedule'; schedule = (keyed('schedule') || inside[0] || {}).text || ''; }
      else if (/^onValue(Created|Written|Updated|Deleted)$/.test(fn)) { kind = 'trigger'; watches = (keyed('ref') || {}).text || ''; }
      else if (/^onDocument/.test(fn)) { kind = 'firestore-trigger'; watches = (keyed('document') || {}).text || ''; }
      else if (fn === 'backupDirtyTrigger') { kind = 'backup-marker'; watches = `/${(inside[0] || {}).text || ''}/{id}`; }
      else kind = `other:${fn}`;
      exportsList.push({name: m[1], kind, event: fn, watches, schedule, file: rel, line: unit.line, unit});
      re.lastIndex = close;
    }
  }

  const resolve = (scope, aliases, call) => {
    if (call.includes('.')) {
      const [obj, fn] = call.split('.');
      const lib = (scope === 'index' ? sectionAliases : aliases || {})[obj];
      return lib && units.has(`${lib}:${fn}`) ? `${lib}:${fn}` : null;
    }
    if (units.has(`${scope}:${call}`)) return `${scope}:${call}`;
    return null;
  };
  function touches(unit) {
    const seen = new Set(), writes = new Map(), reads = new Map(), helpers = new Set();
    const stack = [unit];
    while (stack.length) {
      const u = stack.pop();
      for (const r of pathReferences(u, nodes, (from, call) => { const key = resolve(from.scope, from.aliases, call); return key ? units.get(key) : null; })) {
        const target = r.kind === 'write' ? writes : reads;
        if (r.kind === 'ref' && writes.has(r.path)) continue;
        target.set(r.path, (target.get(r.path) || 0) + 1);
      }
      for (const call of calledNames(u)) {
        const key = resolve(u.scope, u.aliases, call);
        if (key && !seen.has(key)) { seen.add(key); helpers.add(key); stack.push(units.get(key)); }
      }
    }
    for (const p of writes.keys()) reads.delete(p);
    return {writes: [...writes.keys()].sort(), reads: [...reads.keys()].sort(), helpers: [...helpers].sort()};
  }
  for (const e of exportsList) {
    Object.assign(e, touches(e.unit));
    delete e.unit;
  }
  return {nodes, exports: exportsList};
}

// ---------------------------------------------------------------------------
const rootOf = (p) => String(p).replace(/^\//, '').split('/')[0];
// Container nodes such as `books` hold unrelated children (books/journal,
// books/reviewQueue); index them one level deeper so the answer stays precise.
const nodeOf = (p) => { const [a, b] = String(p).replace(/^\//, '').split('/'); return b && b !== '{*}' && !/^\d/.test(b) ? `${a}/${b}` : a; };
const code = (s) => `\`${String(s).replace(/`/g, "'")}\``;
const nodeList = (paths, except = []) => { const skip = new Set(except.map(nodeOf)); return [...new Set(paths.map(nodeOf))].filter((n) => !skip.has(n)).sort().map(code).join(', ') || '—'; };

export function loadFlows(root = ROOT) {
  return JSON.parse(fs.readFileSync(path.join(root, FLOWS_FILE), 'utf8'));
}

// Every problem returned here is a broken or stale link in a money path.
export function validateFlows(model, flows) {
  const problems = [];
  const byName = new Map(model.exports.map((e) => [e.name, e]));
  const ids = new Set();
  for (const flow of flows.flows || []) {
    if (!flow.id || ids.has(flow.id)) problems.push(`flow id missing or duplicated: ${flow.id}`);
    ids.add(flow.id);
    const written = new Set((flow.startsFrom || []).map(rootOf));
    for (const [i, step] of (flow.steps || []).entries()) {
      const where = `${flow.id} step ${i + 1} (${step.fn})`;
      const e = byName.get(step.fn);
      if (!e) { problems.push(`${where}: no exported Cloud Function named ${step.fn}`); continue; }
      if (step.watches) {
        if (normalizePath(e.watches) !== normalizePath(step.watches)) problems.push(`${where}: map says it watches ${step.watches}, source watches ${e.watches || '(nothing)'}`);
        if (!written.has(rootOf(step.watches))) problems.push(`${where}: watches ${step.watches} but no earlier step in this flow writes /${rootOf(step.watches)}`);
      }
      for (const w of step.writes || []) {
        const actual = new Set([...e.writes, ...e.reads].map(rootOf));
        if (!e.writes.map(rootOf).includes(rootOf(w))) {
          problems.push(actual.has(rootOf(w))
            ? `${where}: map says it writes /${rootOf(w)}, but the scan found only reads or untyped references to it`
            : `${where}: map says it writes /${rootOf(w)}, but its code no longer references that node`);
        }
        written.add(rootOf(w));
      }
    }
  }
  return problems;
}

export function render(model, flows) {
  const ex = model.exports;
  const triggers = ex.filter((e) => e.kind === 'trigger' || e.kind === 'firestore-trigger').sort((a, b) => a.watches.localeCompare(b.watches) || a.name.localeCompare(b.name));
  const schedules = ex.filter((e) => e.kind === 'schedule');
  const callables = ex.filter((e) => e.kind === 'callable' || e.kind === 'http').sort((a, b) => a.name.localeCompare(b.name));
  const markers = ex.filter((e) => e.kind === 'backup-marker');
  // File only, no line numbers: the map should change when the data flow changes,
  // not every time unrelated code above a function moves it down a few lines.
  const loc = (e) => e.file;
  const L = [];
  L.push('# Accaza data-flow map', '');
  L.push('> **Generated file — do not edit by hand.** Run `npm run map:data-flow` after changing `src/functions/`, `functions/lib/` or `tools/data-flow-money-paths.json`. `npm test` fails while this file is stale or a money-path link is broken.', '');
  L.push('Use this map to find *where to look*, then confirm in the source it points to. It comes from static analysis: helpers are followed by name, so calls made through variables or paths built at runtime can be missed (absence from this map is not proof that nothing writes a node), and a shared helper can make a function look like it touches more nodes than one run really does.', '');
  L.push('Screens and server code connect through the Realtime Database rather than through imports: a screen writes a record or calls a callable, and a Cloud Function that watches that record reacts. Sources are the `src/functions/` sections that `npm run build:runtime` joins into `functions/index.js`; search the file for `exports.<name>` to find a function.', '');
  L.push(`Inventory: ${triggers.length} database triggers, ${callables.length} callables, ${schedules.length} scheduled jobs, ${markers.length} backup markers. Generated from \`${SOURCE_DIR}/\` and \`${LIB_DIR}/\`.`, '');

  L.push('## 1. Money paths', '');
  L.push('Curated in `tools/data-flow-money-paths.json` and checked against the scan on every `npm test`: each function must exist, each trigger must still watch the stated path, that path must be written by an earlier step, and each step must still write the nodes listed.', '');
  for (const flow of flows.flows) {
    L.push(`### ${flow.title}`, '');
    if (flow.summary) L.push(flow.summary, '');
    if (flow.startsFrom?.length) L.push(`Starts from: ${flow.startsFrom.map(code).join(', ')}`, '');
    L.push('| # | Function | Runs when | Writes | Source |', '|---|---|---|---|---|');
    flow.steps.forEach((s, i) => {
      const e = ex.find((x) => x.name === s.fn) || {};
      const when = s.watches ? `${code(s.watches)} changes` : (e.kind === 'callable' ? 'called by a screen' : e.kind || '?');
      L.push(`| ${i + 1} | ${code(s.fn)} | ${when} | ${(s.writes || []).map(code).join(', ') || '—'} | ${e.file ? code(loc(e)) : 'missing'} |`);
      if (s.note) L.push(`|   | ↳ ${s.note} | | | |`);
    });
    if (flow.showsIn) L.push('', `Shows in: ${flow.showsIn}`);
    if (flow.ifBroken) L.push('', `If the numbers are wrong: ${flow.ifBroken}`);
    L.push('');
  }

  L.push('## 2. When a record changes, what reacts', '');
  L.push('Database node → the triggers that fire when something under it is written.', '');
  const byNode = new Map();
  for (const t of triggers) { const n = rootOf(t.watches); if (!byNode.has(n)) byNode.set(n, []); byNode.get(n).push(t); }
  L.push('| Node | Trigger | Watches | Event | Source |', '|---|---|---|---|---|');
  for (const n of [...byNode.keys()].sort()) for (const t of byNode.get(n)) L.push(`| ${code(n)} | ${code(t.name)} | ${code(t.watches)} | ${t.event} | ${code(loc(t))} |`);
  L.push('');

  L.push('## 3. Who writes each node', '');
  L.push('Database node → every Cloud Function whose code (or helpers) writes it. Browser screens also write some operational nodes directly under `database.rules.json`; those writers are not listed here.', '');
  const writers = new Map();
  for (const e of ex) if (e.kind !== 'backup-marker') for (const w of e.writes) { const n = nodeOf(w); if (!writers.has(n)) writers.set(n, new Set()); writers.get(n).add(e.name); }
  L.push('| Node | Written by |', '|---|---|');
  for (const n of [...writers.keys()].sort()) L.push(`| ${code(n)} | ${[...writers.get(n)].sort().map(code).join(', ')} |`);
  L.push('');

  L.push('## 4. Database triggers', '');
  L.push('| Trigger | Watches | Event | Writes | Reads | Source |', '|---|---|---|---|---|---|');
  for (const t of triggers) L.push(`| ${code(t.name)} | ${code(t.watches)} | ${t.event} | ${nodeList(t.writes)} | ${nodeList(t.reads, t.writes)} | ${code(loc(t))} |`);
  L.push('');

  L.push('## 5. Scheduled jobs', '');
  L.push('| Job | Schedule | Writes | Reads | Source |', '|---|---|---|---|---|');
  for (const s of schedules) L.push(`| ${code(s.name)} | ${s.schedule} | ${nodeList(s.writes)} | ${nodeList(s.reads, s.writes)} | ${code(loc(s))} |`);
  L.push('');

  L.push('## 6. Callables (called by screens)', '');
  L.push('| Callable | Writes | Reads | Source |', '|---|---|---|---|');
  for (const c of callables) L.push(`| ${code(c.name)} | ${nodeList(c.writes)} | ${nodeList(c.reads, c.writes)} | ${code(loc(c))} |`);
  L.push('');

  L.push('## 7. Backup markers', '');
  L.push(`Each marks the nightly incremental backup dirty when its node changes: ${markers.map((m) => code(rootOf(m.watches))).join(', ')}.`, '');
  return L.join('\n');
}

export function build(root = ROOT) {
  const model = scan(root);
  const flows = loadFlows(root);
  return {model, flows, problems: validateFlows(model, flows), markdown: render(model, flows)};
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const {problems, markdown} = build();
  if (problems.length) { console.error(`Money-path map has ${problems.length} broken link(s):\n- ${problems.join('\n- ')}`); process.exit(1); }
  const target = path.join(ROOT, MAP_FILE);
  if (process.argv.includes('--check')) {
    const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n') : '';
    if (current !== markdown) { console.error(`${MAP_FILE} is stale. Run: npm run map:data-flow`); process.exit(1); }
    console.log(`${MAP_FILE} is current.`);
  } else {
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.writeFileSync(target, markdown);
    console.log(`Wrote ${MAP_FILE}.`);
  }
}
