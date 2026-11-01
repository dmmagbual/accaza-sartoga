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
 * Local DNS for the custom domain has been flaky on the dev machine, so the host is resolved over
 * DNS-over-HTTPS first and Chromium is given a resolver rule. If that fails it falls back to local DNS.
 *
 * Output: test-results/screen-check/<timestamp>/ with one screenshot per tab, report.json, and a PASS or
 * FAIL summary. The browser profile is kept in test-results/screen-check/profile so repeat runs stay
 * signed in; delete that folder to start fresh.
 */
import {chromium} from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';

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
const host = (() => { try { return new URL(url).hostname; } catch { return 'accazacoffee.com'; } })();
const tabs = String(value('tabs', 'pos,inventory,recipes,possettings')).split(',').map(s => s.trim()).filter(Boolean);
const signInSeconds = Number(value('timeout', '180')) || 180;
const outDir = path.join('test-results', 'screen-check', new Date().toISOString().replace(/[:.]/g, '-'));
const profileDir = path.join('test-results', 'screen-check', 'profile');
fs.mkdirSync(outDir, {recursive: true});
fs.mkdirSync(profileDir, {recursive: true});

const MARKERS = [
  {name: 'Products categories', selector: '#categoryList'},
  {name: 'Options', selector: '#optGroupList'},
  {name: 'Availability', selector: '#availList'},
  {name: 'Staff menu', selector: '#staffMenuContainer'},
];

const consoleErrors = [], pageErrors = [], failedRequests = [];
const stamp = () => new Date().toISOString();
let route = 'local DNS';

function watch(page) {
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push({at: stamp(), text: m.text().slice(0, 300)}); });
  page.on('pageerror', e => pageErrors.push({at: stamp(), text: String((e && e.message) || e).slice(0, 300)}));
  page.on('requestfailed', r => failedRequests.push({at: stamp(), url: r.url().slice(0, 300), error: String((r.failure() && r.failure().errorText) || '')}));
}

function resolveIps(endpoint) {
  return new Promise((resolve, reject) => {
    const request = https.get(endpoint, {headers: {accept: 'application/dns-json'}}, response => {
      let body = '';
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => {
        try { resolve((JSON.parse(body).Answer || []).filter(a => a.type === 1).map(a => a.data)); }
        catch (error) { reject(error); }
      });
    });
    request.on('error', reject);
    request.setTimeout(8000, () => request.destroy(new Error('resolver timeout')));
  });
}

async function firstIp(name) {
  if (/^(localhost|127\.|\[::1\])/i.test(name)) return null;
  const endpoints = [
    'https://dns.google/resolve?name=' + encodeURIComponent(name) + '&type=A',
    'https://cloudflare-dns.com/dns-query?name=' + encodeURIComponent(name) + '&type=A'
  ];
  for (const endpoint of endpoints) {
    try { const ips = await resolveIps(endpoint); if (ips.length) return ips[0]; }
    catch (_error) { /* next resolver */ }
  }
  return null;
}

async function launch(mappedIp) {
  const options = {headless: false, viewport: {width: 1440, height: 900}};
  if (mappedIp) options.args = ['--host-resolver-rules=MAP ' + host + ' ' + mappedIp];
  // Prefer the installed Chrome: it carries the operator's own DNS and secure-DNS settings, which the
  // bundled Playwright Chromium does not. Fall back to the bundled build when Chrome is not installed.
  const channel = value('channel', 'chrome');
  if (channel) options.channel = channel;
  let context;
  try {
    context = await chromium.launchPersistentContext(profileDir, options);
  } catch (error) {
    if (!channel) throw error;
    delete options.channel;
    context = await chromium.launchPersistentContext(profileDir, options);
  }
  const page = context.pages()[0] || await context.newPage();
  watch(page);
  return {context, page};
}

async function navigate(page) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try { await page.goto(url, {waitUntil: 'domcontentloaded', timeout: 120000}); return; }
    catch (error) { lastError = error; await page.waitForTimeout(2000); }
  }
  throw lastError;
}

console.log('Opening ' + url);
// Local DNS for the custom domain flaps on some machines, so keep trying both routes instead of
// failing the operator's run on one bad minute.
async function openPage() {
  // The domain's public DNS flaps between a valid answer and NXDOMAIN on this network, so allow a few
  // minutes of retries instead of failing the operator's run on one bad window.
  const attempts = Number(value('attempts', '20')) || 20;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const ip = await firstIp(host);
    const mapping = ip ? 'DNS-over-HTTPS -> ' + ip : 'local DNS';
    let opened = null;
    try {
      opened = await launch(ip);
      await navigate(opened.page);
      route = mapping;
      if (ip) console.log('Resolved ' + host + ' to ' + ip + ' over DNS-over-HTTPS.');
      return opened;
    } catch (error) {
      if (opened) await opened.context.close().catch(() => {});
      console.log('Attempt ' + attempt + '/' + attempts + ' via ' + mapping + ' failed: ' + String(error.message).split('\n')[0]);
      if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
  throw new Error('could not reach ' + url + ' after ' + attempts + ' attempts');
}
const {context, page} = await openPage();

console.log('Sign in in the browser window. Waiting up to ' + signInSeconds + 's for a staff session…');
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

const report = {url, route, generatedAt: stamp(), signedIn: authOk, tabs, screens, consoleErrors, pageErrors, failedRequests, verdict: 'pass'};
const emptyScreens = authOk ? screens.filter(s => s.markers.every(m => !m.present || !m.chars)) : [];
if (!authOk) report.verdict = 'inconclusive';
else if (pageErrors.length) report.verdict = 'fail';
else if (emptyScreens.length === screens.length) report.verdict = 'fail';
if (report.verdict === 'fail') report.reason = pageErrors.length ? 'page errors occurred' : 'no screen rendered any content';

fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
await context.close();

console.log('');
console.log('Verdict: ' + report.verdict.toUpperCase());
console.log('Route: ' + route);
console.log('Screenshots + report: ' + path.relative(process.cwd(), outDir));
console.log('Console errors: ' + consoleErrors.length + ', page errors: ' + pageErrors.length + ', failed requests: ' + failedRequests.length);
if (report.reason) console.log('Reason: ' + report.reason);
process.exitCode = report.verdict === 'fail' ? 1 : 0;
