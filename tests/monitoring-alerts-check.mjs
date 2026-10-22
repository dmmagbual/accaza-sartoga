// Owner SMS/email alerts (15 Oct 2026). Cloud Monitoring log-match alerts fire on
// exact log text, so renaming one of these log lines would silently disable an
// alert. This check ties every alert in ops/monitoring/alert-policies.json to the
// code that writes its log line, and keeps phone numbers out of this public repo.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const spec = JSON.parse(read('ops/monitoring/alert-policies.json'));
const built = read('functions/index.js'), retryGuard = read('functions/lib/retry-guard.js');
const assurance = read('src/functions/05-production-assurance.js'), orders = read('src/functions/30-orders.js');
const byName = Object.fromEntries(spec.policies.map((p) => [p.displayName, p]));

assert.equal(spec.policies.length, 6, 'six owner alerts');
for (const p of spec.policies) {
  assert.match(p.displayName, /^Accaza CRITICAL - /);
  assert.ok(p.filter && p.doc && p.subject, `${p.displayName} needs a filter, instructions and an SMS subject`);
  assert.ok(Number(String(p.rateLimit).replace('s', '')) >= 1800, `${p.displayName} must not text more than every 30 minutes`);
  assert.ok(/Do now/.test(p.doc), `${p.displayName} must tell the owner what to do`);
}

// Background task stopped: the retry guard's dead-letter log line and its fields.
const dead = byName['Accaza CRITICAL - Background task stopped'].filter;
assert.match(dead, /Retry budget exhausted/);
assert.ok(retryGuard.includes('deps.logError("Retry budget exhausted; event acknowledged and recorded for review", {deadLetter: key, function: record.function'), 'retry-guard must keep logging the dead letter with deadLetter and function fields');
assert.ok(built.includes('logError: (message, context) => logger.error(message, context)'), 'dead letters must be logged at ERROR severity');

// Backup: the alert matches by service name, which Firebase derives from the export name.
const backup = byName['Accaza CRITICAL - Daily backup failed'].filter;
for (const [service, exportName] of [['backupdatabasedaily', 'backupDatabaseDaily'], ['rundatabasebackupnow', 'runDatabaseBackupNow']]) {
  assert.ok(backup.includes(`"${service}"`), `backup alert must watch ${service}`);
  assert.ok(built.includes(`exports.${exportName} = `), `${exportName} was renamed; update the backup alert service name`);
}

// Finance safety guard.
const finance = byName['Accaza CRITICAL - Finance safety guard tripped'].filter;
assert.ok(assurance.includes('logger.error("Unsafe atomic update blocked"') && finance.includes('"Unsafe atomic update blocked"'));
assert.ok(assurance.includes('logger.error("Financial operation failed", {operation, correlationId, durationMs:Date.now()-startedAt, code:safeErrorCode(error), expected:error instanceof HttpsError});'), 'the expected flag separates staff mistakes from real crashes');
assert.ok(finance.includes('jsonPayload.expected=false'), 'only unexpected financial crashes may text the owner');

// POS sale not saved: logged once, at the moment management is notified.
const pos = byName['Accaza CRITICAL - POS sale not saved'].filter;
assert.ok(pos.includes('"POS sale not saved"'));
for (const source of [orders, built]) assert.ok(source.includes('logger.error("POS sale not saved", {alert: String(body || "").slice(0, 180)});\n        return notifyStaff(db, title, body, "/admin.html#tab-ops", "management");'), 'the POS alert log must sit inside the one-time management notification');

// Server functions failing (23 Oct 2026): a Google-side fault failed every fresh function
// start for 85 minutes with no log text, so only a request-rate alert can catch it.
const down = byName['Accaza CRITICAL - Server functions failing'];
assert.equal(down.kind, 'metricThreshold');
assert.match(down.filter, /run\.googleapis\.com\/request_count/);
assert.match(down.filter, /response_code_class="5xx"/);
assert.ok(down.threshold >= 10 && down.alignmentPeriod === '300s' && down.duration === '600s', 'one-off blips (max 20 in a 5-minute window over 14 days) must not text the owner');
const applier = read('tools/apply-monitoring-alerts.ps1');
assert.ok(applier.includes('$def.kind -eq "metricThreshold"') && applier.includes('conditionThreshold') && applier.includes('notificationPrompts = @("OPENED", "CLOSED")'), 'the apply script must build a rate condition and announce recovery');
for (const p of spec.policies.filter((x) => x.kind !== 'metricThreshold')) assert.ok(p.labelExtractors, `${p.displayName} is a log alert and needs label extractors`);

// No phone numbers or emails in the public repository.
const ops = read('ops/monitoring/alert-policies.json') + read('tools/apply-monitoring-alerts.ps1');
assert.doesNotMatch(ops, /\+\d{9,}|\b09\d{9}\b|@gmail\.com/, 'contact details belong in Google Cloud, never in this repo');

console.log('Monitoring alert checks passed.');
