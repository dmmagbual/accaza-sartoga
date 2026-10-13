/* POS load profile — what is actually holding the page load event?
 *
 * Why this exists: Admin > Operations Center reports "POS launch" from `pos_boot`, which is the
 * browser's `loadEventEnd` (assets/js/admin/telemetry.js). That fires only when EVERY resource on the
 * page has finished, so the number is dominated by page weight rather than by the POS itself -- the
 * POS's own work measures 8 ms (pos_build) and 2 ms (cart_render) on the same devices. This happened
 * once before: ~16.6 MB of hidden customer-site photos held the load event and POS launch averaged
 * 11-17 s until they were made lazy (see tests/e2e/smoke.spec.mjs). So before optimising anything,
 * find out what is holding the load event now.
 *
 * Usage (from the project folder, against a running site):
 *   node tools/pos-load-profile.mjs https://acczacoffee.com/admin.html
 *   node tools/pos-load-profile.mjs http://localhost:8080/admin.html --wait 12000
 *
 * Requires Playwright with a browser installed (`npx playwright install chromium`). This is a
 * diagnostic, not a guard: it prints a ranked table and exits non-zero only when the page cannot be
 * loaded at all. Run it on the real till / the real network for numbers that mean something, and run
 * it before and after signing in to see what the POS module adds.
 */
import {chromium} from 'playwright';

const url = process.argv[2];
if (!url) {
  console.error('Give a URL, for example: node tools/pos-load-profile.mjs https://acczacoffee.com/admin.html');
  process.exit(2);
}
const waitIndex = process.argv.indexOf('--wait');
const settleMs = waitIndex > -1 ? Number(process.argv[waitIndex + 1]) || 8000 : 8000;

const browser = await chromium.launch();
const page = await browser.newPage();

/* Log every request so a resource that never appears in the performance entries (a blocked or
   abandoned request) is still visible. */
const requests = [];
page.on('request', (request) => requests.push({url: request.url(), type: request.resourceType()}));
page.on('requestfailed', (request) => requests.push({url: request.url(), type: request.resourceType(), failed: String(request.failure()?.errorText || 'failed')}));

try {
  await page.goto(url, {waitUntil: 'load', timeout: 60000});
} catch (error) {
  console.error('The page did not reach its load event:', String(error.message || error));
  console.error('Requests seen:', requests.length);
}

/* Let anything the page schedules after load (the telemetry timer runs on a setTimeout) settle. */
await page.waitForTimeout(settleMs);

const report = await page.evaluate(() => {
  const navigation = performance.getEntriesByType('navigation')[0] || {};
  const resources = performance.getEntriesByType('resource').map((entry) => ({
    name: entry.name,
    initiatorType: entry.initiatorType,
    start: Math.round(entry.startTime),
    duration: Math.round(entry.duration),
    transferSize: entry.transferSize || 0,
    decodedBodySize: entry.decodedBodySize || 0,
    renderBlockingStatus: entry.renderBlockingStatus || '',
  }));
  return {
    domContentLoaded: Math.round(navigation.domContentLoadedEventEnd || 0),
    loadEventEnd: Math.round(navigation.loadEventEnd || 0),
    responseEnd: Math.round(navigation.responseEnd || 0),
    resources,
    appCheck: globalThis.__accazaAppCheckStatus || null,
  };
});

const short = (name) => {
  try { const u = new URL(name); return `${u.host}${u.pathname}`.replace(/^\//, '') + (u.search || ''); }
  catch { return name; }
};
const kb = (bytes) => `${Math.round(bytes / 1024)} KB`;
const byDuration = [...report.resources].sort((a, b) => b.duration - a.duration).slice(0, 20);
const bySize = [...report.resources].sort((a, b) => b.decodedBodySize - a.decodedBodySize).slice(0, 20);

console.log(`\nPOS load profile — ${url}`);
console.log(`  response end        ${report.responseEnd} ms`);
console.log(`  DOMContentLoaded    ${report.domContentLoaded} ms`);
console.log(`  load event (pos_boot) ${report.loadEventEnd} ms   <-- the number Operations Center reports`);
console.log(`  resources           ${report.resources.length}`);
console.log(`  total decoded       ${kb(report.resources.reduce((sum, r) => sum + r.decodedBodySize, 0))}`);

console.log('\nSlowest 20 resources (duration ms):');
for (const resource of byDuration) console.log(`  ${String(resource.duration).padStart(6)} ms  ${kb(resource.decodedBodySize).padStart(8)}  ${resource.renderBlockingStatus.padEnd(12)}  ${short(resource.name)}`);

console.log('\nLargest 20 resources (decoded bytes):');
for (const resource of bySize) console.log(`  ${kb(resource.decodedBodySize).padStart(8)}  ${String(resource.duration).padStart(6)} ms  ${short(resource.name)}`);

const failed = report.resources.filter((r) => !r.transferSize && !r.decodedBodySize && r.duration > 0);
if (failed.length) {
  console.log('\nRequested but delivered nothing (blocked, aborted or failed):');
  for (const resource of failed.slice(0, 20)) console.log(`  ${String(resource.duration).padStart(6)} ms  ${short(resource.name)}`);
}
if (report.appCheck) console.log(`\nApp Check state recorded by the page: ${JSON.stringify(report.appCheck)}`);

const appJs = report.resources.filter((r) => /\/assets\/js\//.test(r.name));
console.log(`\nApplication JavaScript on this load: ${appJs.length} files, ${kb(appJs.reduce((sum, r) => sum + r.decodedBodySize, 0))}`);

await browser.close();
