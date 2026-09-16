// Download read graph for the Cloud Functions bundle (Sep 2026 download audit).
//
// For every exported function it lists the Realtime Database reads that download a
// node without a query, directly or through the helper functions it uses. The
// release check (tests/download-read-guard-check.mjs) uses it so that no request,
// trigger or schedule can start downloading a growing node in full again unnoticed.
//
// Dependency-free: a small tokenizer that understands comments, strings, template
// literals and regular expressions is enough for this codebase.

const KEYWORDS_BEFORE_REGEX = new Set(["return", "typeof", "case", "in", "of", "new", "delete", "void", "throw", "else", "do", "await", "yield", "instanceof"]);
const QUERY_METHODS = new Set(["orderByChild", "orderByKey", "orderByValue", "equalTo", "startAt", "endAt", "endBefore", "startAfter", "limitToFirst", "limitToLast"]);

// Returns tokens {t: "id"|"str"|"tpl"|"num"|"re"|"p"|"comment", v, s, e}.
export function tokenize(src) {
  const out = [];
  let i = 0, lastSig = null;
  const push = (tok) => { out.push(tok); if (tok.t !== "comment") lastSig = tok; };
  const regexAllowed = () => !lastSig || (lastSig.t === "p" && !/^[)\]}]$/.test(lastSig.v)) || (lastSig.t === "id" && KEYWORDS_BEFORE_REGEX.has(lastSig.v));
  // Template literal body starting after the opening backtick; returns end index (after closing backtick).
  function readTemplate(start) {
    let j = start, cooked = "", hasExpr = false;
    while (j < src.length) {
      const c = src[j];
      if (c === "\\") { cooked += src[j + 1]; j += 2; continue; }
      if (c === "`") return {end: j + 1, cooked, hasExpr};
      if (c === "$" && src[j + 1] === "{") {
        hasExpr = true; cooked += "${}"; j += 2;
        let depth = 1;
        while (j < src.length && depth > 0) {
          const d = src[j];
          if (d === "`") { j = readTemplate(j + 1).end; continue; }
          if (d === "'" || d === '"') { j = readString(j).end; continue; }
          if (d === "/" && src[j + 1] === "*") { j = src.indexOf("*/", j + 2) + 2; continue; }
          if (d === "/" && src[j + 1] === "/") { const n = src.indexOf("\n", j); j = n < 0 ? src.length : n; continue; }
          if (d === "{") depth++;
          else if (d === "}") depth--;
          j++;
        }
        continue;
      }
      cooked += c; j++;
    }
    throw new Error(`Unterminated template literal at ${start}`);
  }
  function readString(start) {
    const q = src[start]; let j = start + 1, value = "";
    while (j < src.length && src[j] !== q) { if (src[j] === "\\") { value += src[j + 1]; j += 2; } else value += src[j++]; }
    return {end: j + 1, value};
  }
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "/" && src[i + 1] === "/") { const n = src.indexOf("\n", i); const e = n < 0 ? src.length : n; push({t: "comment", v: src.slice(i, e), s: i, e}); i = e; continue; }
    if (c === "/" && src[i + 1] === "*") { const e = src.indexOf("*/", i + 2) + 2; push({t: "comment", v: src.slice(i, e), s: i, e}); i = e; continue; }
    if (c === "'" || c === '"') { const r = readString(i); push({t: "str", v: r.value, s: i, e: r.end}); i = r.end; continue; }
    if (c === "`") { const r = readTemplate(i + 1); push({t: "tpl", v: r.cooked, expr: r.hasExpr, s: i, e: r.end}); i = r.end; continue; }
    if (c === "/" && regexAllowed()) {
      let j = i + 1, inClass = false;
      while (j < src.length) { const d = src[j]; if (d === "\\") { j += 2; continue; } if (d === "[") inClass = true; else if (d === "]") inClass = false; else if (d === "/" && !inClass) break; else if (d === "\n") throw new Error(`Unterminated regex at ${i}`); j++; }
      j++; while (/[a-z]/i.test(src[j] || "")) j++;
      push({t: "re", v: src.slice(i, j), s: i, e: j}); i = j; continue;
    }
    if (/[A-Za-z_$]/.test(c)) { let j = i + 1; while (/[\w$]/.test(src[j] || "")) j++; push({t: "id", v: src.slice(i, j), s: i, e: j}); i = j; continue; }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] || ""))) { let j = i + 1; while (/[\w.]/.test(src[j] || "")) j++; push({t: "num", v: src.slice(i, j), s: i, e: j}); i = j; continue; }
    const three = src.slice(i, i + 3), two = src.slice(i, i + 2);
    const p = ["===", "!==", "...", "**=", "<<=", ">>=", "&&=", "||=", "??="].includes(three) ? three : ["=>", "==", "!=", "<=", ">=", "&&", "||", "??", "?.", "++", "--", "+=", "-=", "*=", "/=", "**", "<<", ">>"].includes(two) ? two : c;
    push({t: "p", v: p, s: i, e: i + p.length}); i += p.length;
  }
  return out;
}

// Index of the token that closes the bracket opened at `open`.
function matching(tokens, open) {
  const pairs = {"(": ")", "[": "]", "{": "}"}, want = pairs[tokens[open].v];
  let depth = 0;
  for (let k = open; k < tokens.length; k++) {
    const t = tokens[k]; if (t.t !== "p") continue;
    if (t.v === tokens[open].v) depth++;
    else if (t.v === want && --depth === 0) return k;
  }
  throw new Error(`Unbalanced ${tokens[open].v} at ${tokens[open].s}`);
}

function literalOf(tok) {
  if (!tok) return null;
  if (tok.t === "str") return tok.v;
  if (tok.t === "tpl") return tok.v;
  return "<dynamic>";
}

// Top-level definitions: {name, kind, trigger, start, end} over token ranges.
function definitions(tokens) {
  const code = tokens.map((t, k) => k).filter((k) => tokens[k].t !== "comment");
  const defs = [];
  let depth = 0;
  for (let n = 0; n < code.length; n++) {
    const k = code[n], t = tokens[k];
    if (t.t === "p" && "([{".includes(t.v)) { depth++; continue; }
    if (t.t === "p" && ")]}".includes(t.v)) { depth--; continue; }
    if (depth !== 0) continue;
    if (t.t === "id" && t.v === "function") {
      const nameTok = tokens[code[n + 1]]; if (!nameTok || nameTok.t !== "id") continue;
      let m = n + 2; while (tokens[code[m]].v !== "(") m++;
      const paramsEnd = matching(tokens, code[m]);
      let b = code.indexOf(paramsEnd) + 1; while (tokens[code[b]].v !== "{") b++;
      const end = matching(tokens, code[b]);
      defs.push({name: nameTok.v, kind: "helper", start: code[b], end});
      n = code.indexOf(end); continue;
    }
    if (t.t === "id" && (t.v === "const" || t.v === "let" || t.v === "var")) {
      const nameTok = tokens[code[n + 1]], eq = tokens[code[n + 2]];
      if (nameTok && nameTok.t === "id" && eq && eq.v === "=") {
        // statement ends at the next depth-0 ';' (or line-ending top-level token)
        let m = n + 3, d = 0;
        for (; m < code.length; m++) { const u = tokens[code[m]]; if (u.t === "p" && "([{".includes(u.v)) d++; else if (u.t === "p" && ")]}".includes(u.v)) d--; else if (d === 0 && u.v === ";") break; }
        const body = tokens.slice(code[n + 3], code[Math.min(m, code.length - 1)] + 1);
        if (body.some((u) => u.t === "id" && u.v === "function") || body.some((u) => u.v === "=>")) defs.push({name: nameTok.v, kind: "helper", start: code[n + 3], end: code[Math.min(m, code.length - 1)]});
      }
      continue;
    }
    if (t.t === "id" && t.v === "exports" && tokens[code[n + 1]].v === "." && tokens[code[n + 3]] && tokens[code[n + 3]].v === "=") {
      const name = tokens[code[n + 2]].v;
      let m = n + 4, d = 0;
      for (; m < code.length; m++) { const u = tokens[code[m]]; if (u.t === "p" && "([{".includes(u.v)) d++; else if (u.t === "p" && ")]}".includes(u.v)) d--; else if (d === 0 && u.v === ";") break; if (d === 0 && m > n + 4 && u.t === "id" && u.v === "exports" && tokens[code[m + 1]].v === ".") { m--; break; } }
      const first = tokens[code[n + 4]];
      let trigger = "";
      const open = tokens[code[n + 5]];
      if (open && open.v === "(") {
        const arg = tokens[code[n + 6]];
        if (arg && arg.v === "{") {
          const close = matching(tokens, code[n + 6]);
          for (let q = code[n + 6]; q < close; q++) if (tokens[q].t === "id" && ["ref", "schedule"].includes(tokens[q].v) && tokens[q + 1] && tokens[q + 1].v === ":") { trigger = literalOf(tokens[q + 2]); break; }
        } else if (arg && (arg.t === "str" || arg.t === "tpl")) trigger = literalOf(arg);
      }
      defs.push({name, kind: first.t === "id" ? first.v : "value", trigger, start: code[n + 4], end: code[Math.min(m, code.length - 1)], exported: true});
      n = Math.min(m, code.length - 1);
    }
  }
  return defs;
}

// Whole-node reads and referenced identifiers inside a token range.
function scanRange(tokens, src, start, end) {
  const reads = [], ids = new Set(), indexUses = [];
  for (let k = start; k <= end; k++) {
    const t = tokens[k];
    if (t.t === "id") ids.add(t.v);
    if (!(t.t === "id" && t.v === "ref" && tokens[k - 1] && tokens[k - 1].v === "." && tokens[k + 1] && tokens[k + 1].v === "(")) continue;
    const close = matching(tokens, k + 1);
    if (close !== k + 3 && !(close === k + 2)) continue; // ref(expr) with more than one token: dynamic
    let path = close === k + 2 ? "/" : literalOf(tokens[k + 2]);
    // `/${x}` names a whole top-level node chosen at run time; `/${x}/${y}` is a record.
    if (tokens[k + 2] && tokens[k + 2].t === "tpl" && tokens[k + 2].expr) path = /^\/?\$\{\}$/.test(tokens[k + 2].v) ? "<dynamic-root>" : "<dynamic>";
    if (close === k + 3 && tokens[k + 2].t === "id") path = "<dynamic-root>";
    const query = [], orderBy = [];
    let q = close + 1, method = "";
    while (tokens[q] && tokens[q].v === "." && tokens[q + 1] && tokens[q + 1].t === "id" && tokens[q + 2] && tokens[q + 2].v === "(") {
      const name = tokens[q + 1].v, argsEnd = matching(tokens, q + 2);
      if (QUERY_METHODS.has(name)) { query.push(name); if (name === "orderByChild") orderBy.push(argsEnd === q + 4 && (tokens[q + 3].t === "str" || (tokens[q + 3].t === "tpl" && !tokens[q + 3].expr)) ? tokens[q + 3].v : "<dynamic>"); }
      else if (name === "child") { const a = tokens[q + 3]; path = argsEnd === q + 4 && (a.t === "str" || (a.t === "tpl" && !a.expr)) ? `${path}/${a.v}` : "<dynamic>"; }
      else { method = name; break; }
      q = argsEnd + 1;
    }
    if (orderBy.length) indexUses.push({path: String(path).replace(/^\/+/, "").replace(/\/+$/, ""), fields: orderBy, line: src.slice(0, t.s).split("\n").length});
    if (method !== "get" && method !== "once") continue;
    // Annotation: a /* download-ok: <kind> <reason> */ comment inside the same statement, before the read.
    let annotation = null;
    // Balanced {...} before the read (object literals such as `|| {}`) belong to the statement.
    for (let a = k - 1, depth = 0; a >= 0; a--) {
      const u = tokens[a];
      if (u.t === "comment") { const m = depth === 0 && /download-ok:\s*(\w+)/.exec(u.v); if (m) { annotation = m[1]; break; } continue; }
      if (u.t !== "p") continue;
      if (u.v === "}") { depth++; continue; }
      if (u.v === "{") { if (depth === 0) break; depth--; continue; }
      if (u.v === ";" && depth === 0) break;
    }
    const line = src.slice(0, t.s).split("\n").length;
    reads.push({path: String(path).replace(/^\/+/, "").replace(/\/+$/, "") || "/", query, orderBy, annotation, line});
  }
  return {reads, ids, indexUses};
}

// Every orderByChild query in the source: {path, fields, line}.
export function indexUses(src) {
  const tokens = tokenize(src);
  return scanRange(tokens, src, 0, tokens.length - 1).indexUses;
}

// Realtime Database rules (the file allows // comments) -> function(path, field) => indexed?
export function rulesIndex(rulesText) {
  let out = "", inString = false;
  for (let i = 0; i < rulesText.length; i++) {
    const c = rulesText[i];
    if (inString) { out += c; if (c === "\\") { out += rulesText[++i]; } else if (c === '"') inString = false; continue; }
    if (c === '"') { inString = true; out += c; continue; }
    if (c === "/" && rulesText[i + 1] === "/") { while (i < rulesText.length && rulesText[i] !== "\n") i++; out += "\n"; continue; }
    out += c;
  }
  const rules = JSON.parse(out).rules;
  return function indexed(path, field) {
    let nodes = [rules];
    for (const part of String(path).split("/").filter(Boolean)) {
      nodes = nodes.flatMap((node) => [node[part], ...Object.keys(node).filter((k) => k.startsWith("$")).map((k) => node[k])]).filter((n) => n && typeof n === "object");
    }
    return nodes.some((node) => { const on = node[".indexOn"]; return on === field || (Array.isArray(on) && on.includes(field)); });
  };
}

export function readGraph(src) {
  const tokens = tokenize(src), defs = definitions(tokens);
  const helpers = new Map(), exportsList = [];
  for (const d of defs) {
    const scan = scanRange(tokens, src, d.start, d.end);
    const node = Object.assign({}, d, scan);
    if (d.exported) exportsList.push(node); else helpers.set(d.name, node);
  }
  function reach(node, seen, chain, out) {
    node.reads.forEach((r) => out.push(Object.assign({via: chain.concat(node.name)}, r)));
    node.ids.forEach((id) => { if (id !== node.name && helpers.has(id) && !seen.has(id)) { seen.add(id); reach(helpers.get(id), seen, chain.concat(node.name), out); } });
    return out;
  }
  return exportsList.map((e) => ({name: e.name, kind: e.kind, trigger: e.trigger, reads: reach(e, new Set([e.name]), [], [])}));
}
