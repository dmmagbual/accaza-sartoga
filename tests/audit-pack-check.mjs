// The audit pack (5 Nov 2026): an outside auditor gets an exact copy of one commit plus a cover page
// and the audit brief, never the working folder. Builds a real pack from HEAD and checks its contents.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'accaza-pack-test-'));
try {
  execFileSync(process.execPath, ['tools/audit-pack.mjs', '--ref', 'HEAD', '--no-fetch', '--no-live', '--out', out], {stdio: 'pipe'});
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim(), short = sha.slice(0, 8);
  const files = fs.readdirSync(out);
  assert.equal(files.length, 1, 'one zip per pack'); assert.match(files[0], new RegExp(`^accaza-audit-\\d{4}-\\d{2}-\\d{2}-${short}\\.zip$`));
  // Zip file names are stored uncompressed, so the archive's own bytes show what it holds.
  const zip = fs.readFileSync(path.join(out, files[0])).toString('latin1');
  for (const name of ['AUDIT_START_HERE.md', 'package.json', 'database.rules.json', 'src/functions/30-orders.js']) assert.ok(zip.includes(`accaza-${short}/${name}`), `the pack holds ${name}`);
  // Only committed files enter the pack. While the brief is still uncommitted (on a local branch) it must be
  // absent, which proves working-folder files cannot leak in; once committed it must be present.
  let briefCommitted = true; try { execFileSync('git', ['cat-file', '-e', 'HEAD:docs/AUDIT_BRIEF.md'], {stdio: 'ignore'}); } catch (_e) { briefCommitted = false; }
  assert.equal(zip.includes(`accaza-${short}/docs/AUDIT_BRIEF.md`), briefCommitted, briefCommitted ? 'the committed brief is in the pack' : 'an uncommitted file never enters the pack');
  for (const name of ['node_modules/', '.git/', 'audit-pack/', '_worktrees/']) assert.ok(!zip.includes(`accaza-${short}/${name}`), `the pack never holds ${name}`);
} finally { fs.rmSync(out, {recursive: true, force: true}); }

const tool = fs.readFileSync('tools/audit-pack.mjs', 'utf8');
assert.ok(/git\(\['archive', '--format=zip'/.test(tool) && !/readdirSync|cpSync|copyFileSync/.test(tool), 'the pack comes from git archive of a commit, never from the working folder');
assert.ok(/const ref = opt\('--ref'\) \|\| 'origin\/main'/.test(tool) && /NOT GitHub main/.test(tool), 'it packs GitHub main by default and labels anything else');
assert.ok(fs.readFileSync('.gitignore', 'utf8').includes('\naudit-pack/\n'), 'packs are never committed');

const brief = fs.readFileSync('docs/AUDIT_BRIEF.md', 'utf8');
for (const heading of ['## What you are auditing', '## The business', '## Where things live', '## Decisions already made', '## Severity', '## Evidence for every finding', '## What to send back']) assert.ok(brief.includes(heading), `the brief covers: ${heading}`);
assert.ok(brief.includes('docs/evidence/2026-11-04-owner-acceptances.md') && brief.includes('ops/monitoring/alert-policies.json') && brief.includes('`.validate`'), 'the brief points to the acceptances, the alerts and the rule validation');
assert.ok(!/[–—]/.test(brief), 'the brief has no dashes');
console.log('PASS: audit pack (exact commit copy with cover page and brief; no working-folder files) and audit brief.');
