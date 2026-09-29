// The Rewards badge, end to end in a real browser, with the network to Google cut.
//
// Two things are proved here that nothing else can prove:
//   1. The badge renders with NO network at all. Firebase is loaded on demand, so a
//      member standing at the counter with a dead signal still gets a scannable badge.
//   2. The QR actually decodes back to "ACZ1:<memberId>:<code>", where <code> is the
//      exact HMAC the server will re-derive. A QR that renders but does not decode,
//      or decodes to the wrong string, fails silently at the till - so it is decoded
//      here with a real QR reader rather than eyeballed.
import {test, expect} from '@playwright/test';
import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const JSQR = path.join(fileURLToPath(new URL('../../', import.meta.url)), 'node_modules', 'jsqr', 'dist', 'jsQR.js');

const MEMBER = {
  memberId: 'm_63917abc1234',
  badgeSecret: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718',
  name: 'Maria Santos',
  maskedPhone: '0917' + '•••' + '4567',
};
const BADGE_WINDOW_SECONDS = 60;
const serverCode = (atMs) => crypto.createHmac('sha256', MEMBER.badgeSecret)
  .update(`${MEMBER.memberId}:${Math.floor(atMs / (BADGE_WINDOW_SECONDS * 1000))}`)
  .digest('hex').slice(0, 12);

async function openBadge(page) {
  // Everything off-origin is refused: no Firebase, no fonts, no analytics. If the badge
  // needed any of it, it would not appear at all.
  await page.route(/^https?:\/\/(?!127\.0\.0\.1:4173)/, (route) => route.abort());
  await page.addInitScript((member) => {
    localStorage.setItem('accaza_loyalty_member', JSON.stringify(member));
  }, MEMBER);
  await page.goto('/rewards.html', {waitUntil: 'domcontentloaded'});
}

test('an existing member sees a scannable badge with no network at all', async ({page}) => {
  await openBadge(page);

  // The badge screen, not the signup form.
  await expect(page.locator('#screenBadge')).toBeVisible();
  await expect(page.locator('#screenSignup')).toBeHidden();
  await expect(page.locator('#badgeName')).toHaveText('Hi, Maria');
  await expect(page.locator('#qrHolder svg')).toBeVisible();

  // Decode the rendered QR with a real reader.
  await page.addScriptTag({path: JSQR});
  const decoded = await page.evaluate(async () => {
    const source = document.querySelector('#qrHolder svg');
    const clone = source.cloneNode(true);
    clone.setAttribute('width', '512');
    clone.setAttribute('height', '512');
    const xml = new XMLSerializer().serializeToString(clone);
    const img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 512;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 512, 512);
    ctx.drawImage(img, 0, 0, 512, 512);
    const pixels = ctx.getImageData(0, 0, 512, 512);
    const found = window.jsQR(pixels.data, pixels.width, pixels.height);
    return found ? found.data : null;
  });

  expect(decoded, 'the badge QR must be readable by a scanner').not.toBeNull();

  // It must decode to the payload the till parses, carrying a code the server accepts.
  const parts = String(decoded).split(':');
  expect(parts[0]).toBe('ACZ1');
  expect(parts[1]).toBe(MEMBER.memberId);
  expect(parts[2]).toMatch(/^[0-9a-f]{12}$/);

  // The code is the one the server will re-derive. Allow the current window or the
  // previous one, which is exactly the drift the server itself tolerates.
  const now = Date.now();
  expect([serverCode(now), serverCode(now - BADGE_WINDOW_SECONDS * 1000)]).toContain(parts[2]);

  // And the same code is shown as text, so a cashier can key it in if a scanner jams.
  await expect(page.locator('#badgeCode')).toHaveText(parts[2].replace(/(.{4})/g, '$1 ').trim());
});

test('a visitor who is not a member yet gets the signup form, not an empty badge', async ({page}) => {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1:4173)/, (route) => route.abort());
  await page.goto('/rewards.html', {waitUntil: 'domcontentloaded'});
  await expect(page.locator('#screenSignup')).toBeVisible();
  await expect(page.locator('#screenBadge')).toBeHidden();
  await expect(page.locator('#suConsent')).not.toBeChecked();
});

test('signup refuses to send a code until name, number and consent are all given', async ({page}) => {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1:4173)/, (route) => route.abort());
  await page.goto('/rewards.html', {waitUntil: 'domcontentloaded'});

  // Nothing filled in: the form must not call out, it must say what is missing.
  await page.locator('#sendCodeBtn').click();
  await expect(page.locator('#signupError')).toHaveText('Please enter your name.');

  await page.locator('#suName').fill('Maria Santos');
  await page.locator('#sendCodeBtn').click();
  await expect(page.locator('#signupError')).toHaveText('Please enter your mobile number.');

  // Consent is a hard gate - the spec requires it before any record is created.
  await page.locator('#suPhone').fill('09171234567');
  await page.locator('#sendCodeBtn').click();
  await expect(page.locator('#signupError')).toHaveText('Please tick the box so we can create your account.');

  await expect(page.locator('#screenOtp')).toBeHidden();
});

test('the badge code rolls over to a new window', async ({page}) => {
  await openBadge(page);
  await expect(page.locator('#qrHolder svg')).toBeVisible();
  const first = await page.locator('#badgeCode').textContent();

  // Jump the clock a full window forward; the badge must re-derive rather than sit stale.
  await page.clock.install();
  await page.clock.fastForward(BADGE_WINDOW_SECONDS * 1000 + 2000);
  await expect(page.locator('#badgeCode')).not.toHaveText(String(first));
});
