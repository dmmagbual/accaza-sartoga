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
 * FAIL summary. The browser profile is kept outside the repository (LOCALAPPDATA\accaza-screen-check)
 * because Chrome aborts when it cannot clean caches under this tree, and so repeat runs stay signed in;
 * delete that folder to start fresh. Use --profile <dir> to choose another one.
 */
import {chromium} from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
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
// GitHub Pages serves every project site from these four anycast addresses. They are used only when
// public resolution returns nothing, so the check can still run while the machine DNS is failing.
const KNOWN_HOST_IPS = ['185.199.108.153', '185.199.109.153', '185.199.110.153', '185.199.111.153'];
const tabs = String(value('tabs', 'pos,inventory,recipes,possettings')).split(',').map(s => s.trim()).filter(Boolean);
const signInSeconds = Number(value('timeout', '180')) || 180;
const outDir = path.join('test-results', 'screen-check', new Date().toISOString().replace(/[:.]/g, '-'));
// Chrome aborts if it cannot delete its own caches inside the profile, and this repo tree carries a deny
// ACE for deleting subdirectories. Keep the browser profile outside the repository.
const profileRoot = process.env.LOCALAPPDATA || os.tmpdir();
let profileDir = value('profile', '') || path.join(profileRoot, 'accaza-screen-check', 'profile');
fs.mkdirSync(outDir, {recursive: true});
fs.mkdirSync(profileDir, {recursive: true});
console.log('Browser profile: ' + profileDir);

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

async function candidateIps() {
  const forced = value('ip', '');
  if (forced) return forced.split(',').map(s => s.trim()).filter(Boolean);
  const found = [];
  for (const endpoint of [
    'https://dns.google/resolve?name=' + encodeURIComponent(host) + '&type=A',
    'https://cloudflare-dns.com/dns-query?name=' + encodeURIComponent(host) + '&type=A'
  ]) {
    try { (await resolveIps(endpoint)).forEach(ip => { if (!found.includes(ip)) found.push(ip); }); }
    catch (_error) { /* next resolver */ }
    if (found.length) break;
  }
  return found.length ? found : KNOWN_HOST_IPS;
}

async function launch(mappedIp) {
  const options = {headless: args.includes('--headless'), viewport: {width: 1440, height: 900}};
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

console.log('Opening ' + url);
// The domain's public DNS flaps between a valid answer and NXDOMAIN on some networks. Retry the
// navigation inside the browser that is already open. Relaunching per attempt threw a new Chrome
// window at the operator for every failed try, which is wrong for a desktop tool.
async function openPage() {
  const attempts = Number(value('attempts', '12')) || 12;
  const waitMs = 5000;
  // At most two browser windows: normal DNS first, then one resolved address if DNS fails. The
  // address route still verifies the TLS certificate, and it is a fallback, not the default, because
  // a custom domain can reject the direct-IP route even when DNS is broken.
  const candidates = (await candidateIps()).slice(0, 1);
  const routes = [null].concat(candidates);
  let windows = 0;
  for (const candidate of routes.slice(0, 2)) {
    windows += 1;
    route = candidate ? 'DNS-over-HTTPS -> ' + candidate : 'local DNS';
    console.log('Browser window ' + windows + ' via ' + route + '.');
    const opened = await launch(candidate);
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        await opened.page.goto(url, {waitUntil: 'domcontentloaded', timeout: 120000});
        return opened;
      } catch (error) {
        const message = String(error.message).split('\n')[0];
        console.log('Navigation attempt ' + attempt + '/' + attempts + ' via ' + route + ' failed: ' + message);
        if (/browser has been closed|Target page, context/i.test(message)) break;
        if (attempt < attempts) await opened.page.waitForTimeout(waitMs).catch(() => {});
      }
    }
    await opened.context.close().catch(() => {});
  }
  throw new Error('could not reach ' + url + ' after opening the browser twice');
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
