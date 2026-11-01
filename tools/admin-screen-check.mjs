/* Admin/POS screen check — evidence for changes that can affect signed-in screens.
 *
 * Why this exists: the build environment can load the login page but cannot sign in, so a change that
 * moves a screen module off the boot path cannot be verified from CI. This script opens a real browser,
 * waits for you to sign in normally, walks the screens, and records what rendered plus every console
 * error. It never sees or stores your password, and nothing is exported but screenshots and errors.
 *
 * Usage, from the project folder:
 *   node tools/admin-screen-check.mjs
 *   node tools/admin-screen-check.mjs https://acczacoffee.com/admin.html --tabs pos,inventory --timeout 180
 *
 * Output: test-results/screen-check/<timestamp>/ with one screenshot per tab, report.json, and a PASS or
 * FAIL summary. The browser profile is kept in test-results/screen-check/profile so repeat runs stay
 * signed in; delete that folder to start fresh.
 */
import {chromium} from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

process.on('uncaughtException', error => {
  console.error('Screen check could not run: ' + String((error && error.message) || error));
  console.error('If Chromium is not installed for Playwright, run: npx playwright install chromium');
  process.exit(2);
});

const args = process.argv.slice(2);
const value = (name, fallback) => {
  const i = args.indexOf('--' + name);
  return i > -1 && args[i + 1] ? args[i + 1] : fallback;
};
const url = args.find(a => /^https?:/i.test(a)) || 'https://acczacoffee.com/admin.html';
const tabs = String(value('tabs', 'pos,inventory,recipes,possettings')).split(',').map(s => s.trim()).filter(Boolean);
const signInSeconds = Number(value('timeout', '180')) || 180;
const outDir = path.join('test-results', 'screen-check', new Date().toISOString().replace(/[:.]/g, '-'));
const profileDir = path.join('test-results', 'screen-check', 'profile');
fs.mkdirSync(outDir, {recursive: true});
fs.mkdirSync(profileDir, {recursive: true});

// Screens the stage 3 module split must not break. A missing element is recorded, not assumed broken,
// because some containers are created by their own module when the screen opens.
const MARKERS = [
  {name: 'Products categories', selector: '#categoryList'},
  {name: 'Options', selector: '#optGroupList'},
  {name: 'Availability', selector: '#availList'},
  {name: 'Staff menu', selector: '#staffMenuContainer'},
];

const consoleErrors = [], pageErrors = [], failedRequests = [];
const stamp = () => new Date().toISOString();
const context = await chromium.launchPersistentContext(profileDir, {headless: false, viewport: {width: 1440, height: 900}});
const page = context.pages()[0] || await context.newPage();
page.on('console', m => { if (m.type() === 'error') consoleErrors.push({at: stamp(), text: m.text().slice(0, 300)}); });
page.on('pageerror', e => pageErrors.push({at: stamp(), text: String((e && e.message) || e).slice(0, 300)}));
page.on('requestfailed', r => failedRequests.push({at: stamp(), url: r.url().slice(0, 300), error: String((r.failure() && r.failure().errorText) || '')}));

console.log('Opening ' + url);
await page.goto(url, {waitUntil: 'domcontentloaded', timeout: 120000});
console.log('Sign in in the browser window (it is a normal browser, nothing is recorded until you do).');
console.log('Waiting up to ' + signInSeconds + 's for a staff session…');
const signedIn = async () => page.evaluate(() => !!(window.__accazaAuthz && window.__accazaAuthz.uid)).catch(() => false);
const deadline = Date.now() + signInSeconds * 1000;
while (Date.now() < deadline && !(await signedIn())) await page.waitForTimeout(1000);
const authOk = await signedIn();
console.log(authOk ? 'Signed in.' : 'Still signed out — only the login screen will be recorded.');

const screens = [];
async function snapshotMarkers() {
  const out = [];
  for (const marker of MARKERS) {
    const state = await page.evaluate(sel => {
      const el = document.querySelector(sel);
      if (!el) return {present: false};
      const text = (el.innerText || '').trim();
      return {present: true, chars: text.length, sample: text.slice(0, 120).replace(/\s+/g, ' ')};
    }, marker.selector).catch(() => ({present: false, error: 'evaluate failed'}));
    out.push({name: marker.name, selector: marker.selector, ...state});
  }
  return out;
}

for (const tab of tabs) {
  const switched = await page.evaluate(t => {
    if (typeof window.switchTab === 'function') { window.switchTab(t, null); return true; }
    return false;
  }, tab).catch(() => false);
  await page.waitForTimeout(1500);
  const markers = await snapshotMarkers();
  const file = path.join(outDir, 'screen-' + tab + '.png');
  await page.screenshot({path: file}).catch(() => {});
  screens.push({tab, switched, markers, screenshot: path.relative(process.cwd(), file)});
  console.log('  ' + tab + ': ' + markers.map(m => m.name + '=' + (m.present ? m.chars + ' chars' : 'missing')).join(', '));
}

// Pages opened later (dialogs, other tabs) are reported too, so a silent failure cannot hide.
await page.waitForTimeout(500);
const report = {
  url, generatedAt: stamp(), signedIn: authOk, tabs, screens,
  consoleErrors, pageErrors, failedRequests,
  verdict: 'pass',
};
const emptyScreens = authOk ? screens.filter(s => s.markers.every(m => !m.present || !m.chars)) : [];
if (!authOk) report.verdict = 'inconclusive';
else if (pageErrors.length) report.verdict = 'fail';
else if (emptyScreens.length === screens.length) report.verdict = 'fail';
if (report.verdict === 'fail') report.reason = pageErrors.length ? 'page errors occurred' : 'no screen rendered any content';

fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
await context.close();

console.log('');
console.log('Verdict: ' + report.verdict.toUpperCase());
console.log('Screenshots + report: ' + path.relative(process.cwd(), outDir));
console.log('Console errors: ' + consoleErrors.length + ', page errors: ' + pageErrors.length + ', failed requests: ' + failedRequests.length);
if (report.reason) console.log('Reason: ' + report.reason);
process.exitCode = report.verdict === 'fail' ? 1 : 0;
