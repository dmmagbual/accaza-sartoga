// Structural validation only: no network, database access or file writes.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const canonical = resolve(root, '.agents/skills');
const wrappers = resolve(root, '.claude/skills');
const mapPath = resolve(root, 'docs/accaza-capability-map.md');
const expected = [
  'accaza-workflow', 'accaza-financial-integrity',
  'accaza-pos-live-safety', 'accaza-ap-phase-gate',
  'accaza-firebase-cost-review', 'accaza-release-verify',
];
const errors = [];
const files = new Map();

function read(path) {
  if (!existsSync(path)) {
    errors.push(`Missing file: ${relative(root, path)}`);
    return '';
  }
  const text = readFileSync(path, 'utf8');
  files.set(path, text);
  return text;
}

function metadata(path, folder) {
  const text = read(path);
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) {
    errors.push(`Missing frontmatter: ${relative(root, path)}`);
    return {};
  }
  // This set uses only plain single-line name/description scalars.
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^(name|description): (.+)$/);
    if (!field || Object.hasOwn(fields, field[1])) {
      errors.push(`Invalid/duplicate metadata line in ${relative(root, path)}: ${line}`);
      continue;
    }
    fields[field[1]] = field[2];
  }
  if (fields.name !== folder || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(fields.name ?? '') || folder.length > 64) {
    errors.push(`Invalid name: ${relative(root, path)}`);
  }
  if (!fields.description || fields.description.length > 1024 || /[<>]|:\s/.test(fields.description)) {
    errors.push(`Invalid description scalar: ${relative(root, path)}`);
  }
  if (/\[TODO:|\[INSERT|\bTBD\b/.test(text)) errors.push(`Unfinished scaffold: ${relative(root, path)}`);
  const words = text.slice(match[0].length).trim().split(/\s+/).length;
  console.log(`${relative(root, path)}: ${words} body words`);
  return fields;
}

const map = read(mapPath);
for (const name of expected) {
  const primaryPath = resolve(canonical, name, 'SKILL.md');
  const wrapperPath = resolve(wrappers, name, 'SKILL.md');
  const primary = metadata(primaryPath, name);
  const wrapper = metadata(wrapperPath, name);
  if (primary.description !== wrapper.description) errors.push(`Description drift: ${name}`);
  const target = `../../../.agents/skills/${name}/SKILL.md`;
  if (!files.get(wrapperPath)?.includes(`](${target})`)) errors.push(`Incorrect Claude target: ${name}`);
  // Some domain skill names appear as readable links rather than literal IDs.
  if (!map.includes(name)) errors.push(`Skill absent from capability map: ${name}`);
}

for (const base of [canonical, wrappers]) {
  if (!existsSync(base)) continue;
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith('accaza-') && !expected.includes(entry.name)) {
      errors.push(`Unmapped Accaza skill: ${relative(root, resolve(base, entry.name))}`);
    }
  }
}

for (const name of ['AGENTS.md', 'CLAUDE.md']) {
  const text = read(resolve(root, name));
  if (!text.includes('docs/accaza-capability-map.md') || !text.includes('Default to these root instructions')) {
    errors.push(`Missing root activation route: ${name}`);
  }
}

if (map.includes('Substantive work starts with [accaza-workflow]')) {
  errors.push('Capability map forces a workflow skill for every substantive task');
}
const workflowSkill = files.get(resolve(canonical, 'accaza-workflow', 'SKILL.md')) ?? '';
if (workflowSkill.includes('accaza-token-efficiency')) {
  errors.push('Workflow skill forces the removed token-efficiency skill');
}

const firebaseSkill = files.get(resolve(canonical, 'accaza-firebase-cost-review', 'SKILL.md')) ?? '';
for (const term of [
  'RTDB downloads', 'Firestore document reads', 'Cloud Functions', 'retries',
  'execution time', 'memory', 'CPU', 'timeout', 'concurrency',
  'minimum/maximum instances', 'workload baseline', 'expected change',
  'alert/rollback threshold', 'Normalize comparisons', 'cost regression',
]) {
  if (!firebaseSkill.toLowerCase().includes(term.toLowerCase())) {
    errors.push(`Firebase cost contract missing: ${term}`);
  }
}

const releaseSkill = files.get(resolve(canonical, 'accaza-release-verify', 'SKILL.md')) ?? '';
for (const term of [
  'can affect a Firebase billing meter', 'workload-normalized', 'rollback threshold',
  'no-cost-change basis', 'accaza-pos-live-safety', 'Unresolved POS regressions block',
]) {
  if (!releaseSkill.toLowerCase().includes(term.toLowerCase())) {
    errors.push(`Release cost/POS safeguard missing: ${term}`);
  }
}

for (const name of ['AGENTS.md', 'CLAUDE.md']) {
  const text = files.get(resolve(root, name)) ?? '';
  for (const term of [
    'Every relevant change', 'Firestore document reads', 'Function compute/scaling cost',
    'new RTDB index', 'Firestore index configuration', 'workload baseline',
    'alert/rollback threshold', 'cost regression blocks the affected release',
  ]) {
    if (!text.toLowerCase().includes(term.toLowerCase())) {
      errors.push(`Root Firebase safeguard missing in ${name}: ${term}`);
    }
  }
}

for (const [path, text] of files) {
  for (const match of text.matchAll(/\[[^\]\n]*\]\(([^)\n]+)\)/g)) {
    const target = match[1];
    if (/^(?:https?:|#)/.test(target)) continue;
    const destination = resolve(dirname(path), target.split('#')[0]);
    const local = relative(root, destination);
    if (local.startsWith('..') || !existsSync(destination)) {
      errors.push(`Broken/outside-repository link in ${relative(root, path)}: ${target}`);
    }
  }
}

if (errors.length) {
  for (const error of errors) console.error(error);
  process.exitCode = 1;
} else {
  console.log(`PASS: ${expected.length} canonical skills, ${expected.length} Claude entry points, activation routes and local links.`);
  console.log('External skills, specialist registration, connector access and live POS behavior require session/task verification.');
}
