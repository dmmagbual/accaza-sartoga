// Firebase Admin SDK transactions call the update function first with the cold local
// cache, which is null on a fresh Cloud Functions instance even after a get(). Returning
// undefined for that null aborts the transaction without asking the server. That single
// pattern stopped every POS sale sync on 22 Sep 2026 (PR 570) and silently disabled
// preparation starts, completed-order corrections and ready-order auto-completion.
// Callbacks must return null (or a proposal) for a null input, or use transactionCurrent().
import fs from 'node:fs';
import path from 'node:path';

const roots = ['src/functions', 'functions/lib'];
const files = roots.flatMap((dir) => fs.readdirSync(dir).filter((name) => name.endsWith('.js')).map((name) => path.join(dir, name)));
const failures = [];
let inspected = 0;

function callbackAt(source, start) {
  let depth = 1, index = start;
  while (index < source.length && depth) {
    const char = source[index];
    if (char === '(') depth++;
    else if (char === ')') depth--;
    index++;
  }
  return source.slice(start, index - 1);
}

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  for (const match of source.matchAll(/\.transaction\(/g)) {
    const callback = callbackAt(source, match.index + match[0].length).trim();
    const head = callback.match(/^(?:async\s*)?\(?\s*([A-Za-z_$][\w$]*)\s*\)?\s*=>\s*/);
    if (!head) continue;
    inspected++;
    const param = head[1], body = callback.slice(head[0].length).trim(), line = source.slice(0, match.index).split('\n').length;
    const first = body.startsWith('{') ? body.slice(1).replace(/^\s*(?:\/\/[^\n]*\n\s*)*/, '').replace(/^\s*[A-Za-z_$][\w$]*\s*=\s*(?:false|true|""|'')\s*;\s*/, '') : body;
    // Block form: the first statement aborts when the current value is falsy.
    const falsyGuard = new RegExp(`^if\\s*\\(\\s*!\\s*(?:${param}\\b|[A-Za-z_$][\\w$.]*\\(\\s*${param}\\b)[^)]*(?:\\)[^{;]*)?\\)\\s*(?:\\{[^}]*?)?return\\s*(?:undefined)?\\s*;`);
    // Expression form: param && ... ? proposal : undefined
    const falsyExpression = new RegExp(`^${param}\\s*&&[^?]*\\?[^:]*:\\s*undefined\\b`);
    if (falsyGuard.test(first) || falsyExpression.test(first)) failures.push(`${file}:${line} aborts on the Admin SDK cold-cache null: ${first.slice(0, 120)}`);
  }
}

if (inspected < 40) failures.push(`Only ${inspected} transaction callbacks were inspected; the scanner no longer recognizes the source layout.`);
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(`PASS: ${inspected} server transaction callbacks accept the Admin SDK cold-cache null instead of aborting.`);
