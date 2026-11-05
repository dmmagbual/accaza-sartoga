// Audit R-01 (5 Nov 2026): a release may never ship a lower build number than main already has.
// The audited branch once carried admin 746 against main's 748, so a deploy from it would have
// rolled the version markers back. Compares this tree with origin/main (BUILD_BASE_REF overrides).
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';

const base = process.env.BUILD_BASE_REF || 'origin/main';
function git(args) { return execFileSync('git', args, {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}); }
let available = true;
try { git(['rev-parse', '--verify', '--quiet', `${base}^{commit}`]); } catch (_e) { available = false; }
if (!available) {
  // CI must fetch main first (quality-gate.yml does); locally a missing ref only warns.
  if (process.env.CI) throw new Error(`Build number check: ${base} is not available. Fetch main before running the release tests.`);
  console.log(`SKIP: build number check (${base} is not available locally).`);
  process.exit(0);
}
const numbers = (json, sw) => {
  const v = JSON.parse(json).builds || {}, cache = Number((String(sw).match(/const CACHE='accaza-v(\d+)'/) || [])[1]);
  return {admin: Number(v.admin), books: Number(v.books), customer: Number(v.customer), serviceWorkerCache: cache};
};
const current = numbers(fs.readFileSync('build-version.json', 'utf8'), fs.readFileSync('sw.js', 'utf8'));
const previous = numbers(git(['show', `${base}:build-version.json`]), git(['show', `${base}:sw.js`]));
const manifest = JSON.parse(fs.readFileSync('release-manifest.json', 'utf8')).builds || {};
const problems = [];
for (const key of Object.keys(current)) {
  if (!Number.isInteger(current[key]) || current[key] <= 0) problems.push(`${key} build number is missing`);
  else if (Number.isInteger(previous[key]) && current[key] < previous[key]) problems.push(`${key} build ${current[key]} is below ${base} (${previous[key]})`);
  if (Number(manifest[key]) !== current[key]) problems.push(`release-manifest.json ${key} is ${manifest[key]}, expected ${current[key]}`);
}
if (problems.length) throw new Error(`Build number check failed:\n- ${problems.join('\n- ')}`);
console.log(`PASS: build numbers never go backwards against ${base} (admin ${current.admin}, books ${current.books}, customer ${current.customer}, cache ${current.serviceWorkerCache}).`);
