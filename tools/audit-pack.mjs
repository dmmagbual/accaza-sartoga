// Builds the pack an outside auditor reviews (5 Nov 2026). It is an exact copy of one commit on
// GitHub main, never the working folder: the 3 Nov audit read a folder that was 10 commits behind
// main with 42 uncommitted changes. Uncommitted and untracked files can never enter the pack.
//
//   npm run audit:pack                 fetch GitHub main and pack it
//   npm run audit:pack -- --ref <ref>  pack another commit (marked as not main in the cover page)
//   options: --out <dir> (default audit-pack/), --no-fetch, --no-live
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const args = process.argv.slice(2), opt = (name) => { const i = args.indexOf(name); return i > -1 ? args[i + 1] : null; };
const ref = opt('--ref') || 'origin/main', outDir = path.resolve(opt('--out') || 'audit-pack');
const git = (a) => execFileSync('git', a, {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});

if (!args.includes('--no-fetch') && ref === 'origin/main') git(['fetch', '--quiet', '--no-tags', 'origin', 'main']);
const sha = git(['rev-parse', '--verify', `${ref}^{commit}`]).trim(), short = sha.slice(0, 8);
const mainSha = (() => { try { return git(['rev-parse', '--verify', 'origin/main^{commit}']).trim(); } catch (_e) { return ''; } })();
const committedAt = git(['show', '-s', '--format=%cI', sha]).trim(), subject = git(['show', '-s', '--format=%s', sha]).trim();
const builds = JSON.parse(git(['show', `${sha}:build-version.json`])).builds || {};
const cache = (git(['show', `${sha}:sw.js`]).match(/const CACHE='accaza-v(\d+)'/) || [])[1] || '?';
const domain = (JSON.parse(git(['show', `${sha}:release-manifest.json`])).project || {}).productionDomain || 'https://accazacoffee.com';

// Best effort: what production serves right now, so the auditor knows whether the pack is live yet.
let live = 'not checked';
if (!args.includes('--no-live')) {
  try {
    const res = await fetch(`${domain}/build-version.json`, {cache: 'no-store', signal: AbortSignal.timeout(8000)});
    const served = res.ok ? ((await res.json()).builds || {}) : null;
    live = !served ? `could not read (${res.status})` : ['admin', 'books', 'customer'].every((k) => Number(served[k]) === Number(builds[k]))
      ? 'production serves these build numbers'
      : `production serves admin ${served.admin}, books ${served.books}, customer ${served.customer}; this pack is not live yet or production is ahead`;
  } catch (error) { live = `could not check (${String(error && error.message || error).slice(0, 80)})`; }
}

const isMain = sha === mainSha;
const cover = [
  '# Start here',
  '',
  `This pack is an exact copy of commit \`${sha}\`${isMain ? ' (GitHub main when the pack was built)' : ' (NOT GitHub main: findings may not apply to main)'}.`,
  '',
  `- Commit: ${short}, ${committedAt}, "${subject}"`,
  `- Builds: admin ${builds.admin}, books ${builds.books}, customer ${builds.customer}, service worker cache ${cache}`,
  `- Production: ${live}`,
  `- Pack built: ${new Date().toISOString()}`,
  '',
  'Read `docs/AUDIT_BRIEF.md` before reporting anything. Every finding must name this commit and a file and line in this pack.',
  '',
].join('\n');

fs.mkdirSync(outDir, {recursive: true});
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'accaza-audit-')), coverFile = path.join(tmp, 'AUDIT_START_HERE.md');
fs.writeFileSync(coverFile, cover);
const zip = path.join(outDir, `accaza-audit-${committedAt.slice(0, 10)}-${short}.zip`);
try {
  git(['archive', '--format=zip', `--prefix=accaza-${short}/`, `--add-file=${coverFile}`, '-o', zip, sha]);
} finally { fs.rmSync(tmp, {recursive: true, force: true}); }
console.log(`Audit pack: ${zip}`);
console.log(`Commit ${short}${isMain ? ' (main)' : ' (not main)'}; admin ${builds.admin}, books ${builds.books}, customer ${builds.customer}; production: ${live}`);
