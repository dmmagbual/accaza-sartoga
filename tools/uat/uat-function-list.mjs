/* Prints the Cloud Functions to deploy to the UAT project, as a firebase --only list.
   Scheduled functions are left out on purpose: UAT must not create Cloud Scheduler jobs
   (cost, and nightly backup / prune / health jobs have no purpose on synthetic data).
   Usage: node tools/uat/uat-function-list.mjs            -> functions:a,functions:b,...
          node tools/uat/uat-function-list.mjs --scheduled -> the excluded scheduled names */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function uatFunctionNames(source) {
  const all = [], scheduled = [];
  for (const m of source.matchAll(/^exports\.([A-Za-z0-9_]+)\s*=\s*([A-Za-z0-9_.]+)\s*\(/gm)) {
    (m[2] === 'onSchedule' ? scheduled : all).push(m[1]);
  }
  return {deploy: [...new Set(all)].sort(), scheduled: [...new Set(scheduled)].sort()};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const {deploy, scheduled} = uatFunctionNames(fs.readFileSync(path.join(root, 'functions', 'index.js'), 'utf8'));
  if (!deploy.length) { console.error('No functions found in functions/index.js'); process.exit(1); }
  process.stdout.write(process.argv.includes('--scheduled') ? scheduled.join(',') : deploy.map((n) => `functions:${n}`).join(','));
}
