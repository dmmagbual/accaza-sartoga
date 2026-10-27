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
  'accaza-firebase-cost-review', 'accaza-operations-incident',
  'accaza-release-verify',
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

function instructionSection(text, title) {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = text.match(new RegExp(`^#{2,3} ${escaped}\\r?\\n([\\s\\S]*?)(?=^#{2,3} |(?![\\s\\S]))`, 'm'));
  return (match?.[1] ?? '').replace(/\r\n/g, '\n').trim();
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
  if (!text.includes('docs/accaza-capability-map.md') || !text.includes('Root instructions are the default')) {
    errors.push(`Missing root activation route: ${name}`);
  }
  if (text.length > 8000 || text.split(/\r?\n/).length > 80) {
    errors.push(`Root instruction context is too large: ${name}`);
  }
  for (const skill of expected) {
    if (!text.includes(skill)) errors.push(`Root route missing in ${name}: ${skill}`);
  }
}

const tokenEfficiencyContract = [
  'Diagnosis, review and planning are read-only',
  'do not authorize deployment, live financial mutations or external messages',
  'Freeze approved scope before implementation',
  'Use targeted file ranges and bounded output',
  'after two similar failures',
  'If token use is high',
  'pass them wholesale to agents',
  'the relevant diff and tests',
  'Never weaken a financial, inventory, security, POS, authorization, audit or verification control',
];
for (const name of ['AGENTS.md', 'CLAUDE.md']) {
  const text = files.get(resolve(root, name)) ?? '';
  for (const term of tokenEfficiencyContract) {
    if (!text.includes(term)) errors.push(`Root token-efficiency safeguard missing in ${name}: ${term}`);
  }
}

const agentsInstructions = files.get(resolve(root, 'AGENTS.md')) ?? '';
const claudeInstructions = files.get(resolve(root, 'CLAUDE.md')) ?? '';
if (agentsInstructions.replace(/\r\n/g, '\n') !== claudeInstructions.replace(/\r\n/g, '\n')) {
  errors.push('AGENTS.md and CLAUDE.md compact core drift');
}
for (const title of ['Mandatory specialists', 'Delivery and efficiency']) {
  const agentsSection = instructionSection(agentsInstructions, title);
  const claudeSection = instructionSection(claudeInstructions, title);
  if (!agentsSection || !claudeSection) errors.push(`Missing synchronized instruction section: ${title}`);
  else if (agentsSection !== claudeSection) errors.push(`Instruction section drift: ${title}`);
}
for (const term of [
  'Finance/inventory changes require Bookkeeper & Controller; add Database Optimizer',
  'Authentication, authorization, roles, permissions or approvals require Identity & Access Engineer',
  'Material architecture requires Software Architect',
  'material UI requires Frontend Developer',
  'Material completed implementations require Code Reviewer before final handoff',
]) {
  for (const [name, text] of [['AGENTS.md', agentsInstructions], ['CLAUDE.md', claudeInstructions]]) {
    if (!text.includes(term)) errors.push(`Mandatory specialist routing missing in ${name}: ${term}`);
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
  'database.rules.json', 'Firestore index configuration',
]) {
  if (!firebaseSkill.toLowerCase().includes(term.toLowerCase())) {
    errors.push(`Firebase cost contract missing: ${term}`);
  }
}

const domainContracts = new Map([
  ['accaza-financial-integrity', [
    'balanced debits/credits', 'fixed-precision', 'Posted history is immutable',
    'period locks', 'idempotency', 'Admin/POS records', 'Finance Books/GL',
    'correction/reversal', 'reconciliation',
  ]],
  ['accaza-pos-live-safety', [
    'active shift', 'IndexedDB queue', 'exactly-once', 'offline',
    'Z report', 'Unresolved POS regression blocks release',
  ]],
  ['accaza-ap-phase-gate', [
    'approved AP Integrity Remediation Plan', 'AP remediation takes precedence',
    'Decision Gates', 'R0-R4', 'one approved step at a time',
  ]],
  ['accaza-operations-incident', [
    'production', 'dead letter', 'functionFailureBudget', 'Live or not live',
    'Blast radius', 'cause is fixed', 'fix is live',
  ]],
]);
for (const [skill, terms] of domainContracts) {
  const text = files.get(resolve(canonical, skill, 'SKILL.md')) ?? '';
  for (const term of terms) {
    if (!text.toLowerCase().includes(term.toLowerCase())) {
      errors.push(`${skill} contract missing: ${term}`);
    }
  }
}

const releaseSkill = files.get(resolve(canonical, 'accaza-release-verify', 'SKILL.md')) ?? '';
for (const term of [
  'can affect a Firebase billing meter', 'workload-normalized', 'rollback threshold',
  'no-cost-change basis', 'accaza-pos-live-safety', 'Unresolved POS regressions block',
  'backup, pricing/costing, pictures, video or retired-copy paths',
]) {
  if (!releaseSkill.toLowerCase().includes(term.toLowerCase())) {
    errors.push(`Release cost/POS safeguard missing: ${term}`);
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
