#!/usr/bin/env node
// Runs an npm script with its full output written to a log file, and prints only
// the result: one PASS line, or the failing step with its last lines. Used by
// agents so a 60 KB test log costs a few lines of context instead of ~15k tokens.
// CI keeps calling the underlying scripts directly; this only changes what is printed.
import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const script = process.argv[2];
const tailArg = process.argv.indexOf('--tail');
const tail = tailArg > 0 ? Math.max(5, Number(process.argv[tailArg + 1]) || 60) : 60;
if (!script || !/^[a-z0-9:_-]+$/i.test(script)) {
  console.error('Usage: node tools/quiet-run.mjs <npm-script> [--tail N]');
  process.exit(2);
}

const dir = join(tmpdir(), 'accaza-test-logs');
mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const logPath = join(dir, `${script.replace(/[^a-z0-9_-]+/gi, '_')}-${stamp}.log`);
const log = createWriteStream(logPath);

const started = Date.now();
let steps = 0;
let current = '(start)';
let sinceStep = [];
const notices = [];
let partial = '';

const onLine = line => {
  const header = /^> (?!.*@\d)(.+)$/.exec(line);
  if (header) {
    steps += 1;
    current = header[1].trim();
    sinceStep = [];
    return;
  }
  sinceStep.push(line);
  if (sinceStep.length > tail) sinceStep.shift();
  if (/^(PENDING|WARN(ING)?\b)/.test(line) && notices.length < 10) notices.push(line);
};

const onData = chunk => {
  log.write(chunk);
  const text = partial + chunk.toString();
  const lines = text.split(/\r?\n/);
  partial = lines.pop();
  for (const line of lines) onLine(line);
};

const child = spawn(`npm run ${script}`, { shell: true, env: process.env });
child.stdout.on('data', onData);
child.stderr.on('data', onData);
child.on('error', error => {
  console.error(`FAIL npm run ${script}: could not start (${error.message})`);
  process.exit(1);
});
child.on('close', (code, signal) => {
  if (partial) onLine(partial);
  log.end();
  const seconds = Math.round((Date.now() - started) / 1000);
  const exit = code ?? 1;
  if (exit === 0) {
    console.log(`PASS npm run ${script}: ${steps} steps in ${seconds}s. Full log: ${logPath}`);
    for (const line of notices) console.log(line);
  } else {
    console.log(`FAIL npm run ${script} (exit ${exit}${signal ? `, ${signal}` : ''}) after ${steps} steps in ${seconds}s`);
    console.log(`Last step started: ${current} (the error can come from a later command chained in the same script; see the lines below)`);
    console.log(`--- last ${sinceStep.length} lines of that step ---`);
    for (const line of sinceStep) console.log(line);
    console.log(`Full log: ${logPath}`);
  }
  process.exit(exit);
});
