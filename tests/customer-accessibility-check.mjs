// Customer site accessibility gate (Nov 2026). Static, but every rule is one a
// screen-reader or keyboard user would hit: unlabelled checkout fields, click-only
// controls (the proof upload is mandatory, so a click-only box blocked keyboard users
// from ordering at all), text below WCAG AA contrast, and no skip link / main landmark.
import fs from 'node:fs';

const html = fs.readFileSync('index.html', 'utf8');
const css = fs.readFileSync('assets/css/customer/site.css', 'utf8');
const failures = [];
const fail = (m) => failures.push(m);

// ---- colour tokens and WCAG contrast ----
const root = (css.match(/:root\{([^}]*)\}/) || [])[1] || '';
const token = {};
for (const m of root.matchAll(/--([a-z-]+):(#[0-9a-fA-F]{6})/g)) token[m[1]] = m[2].toLowerCase();
const lum = (hex) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const resolve = (v) => { const m = String(v || '').trim().match(/^var\(--([a-z-]+)\)$/); return m ? token[m[1]] : (/^#[0-9a-f]{6}$/i.test(String(v).trim()) ? String(v).trim().toLowerCase() : null); };
for (const k of ['tl', 'tm', 'bl', 'bl-ink', 'bl-glow', 'cr', 'cd', 'bd', 'bm']) if (!token[k]) fail(`missing colour token --${k}`);
const AA = 4.5;
const pairs = [['tl', 'cr'], ['tl', '#ece4d8'], ['tl', '#ffffff'], ['tm', 'cd'], ['bl-ink', 'cr'], ['bl-ink', 'cd'], ['bl-ink', '#ffffff'], ['bl-glow', 'bm'], ['bl', 'bd']];
for (const [fg, bg] of pairs) {
  const f = token[fg], b = bg.startsWith('#') ? bg : token[bg];
  if (f && b && ratio(f, b) < AA) fail(`--${fg} on ${bg} is ${ratio(f, b).toFixed(2)}:1, below ${AA}:1`);
}
// Light-background text classes must use the text-safe gold, never the accent --bl.
for (const sel of ['.section-label', '.item-row-info .item-prices', '.cust-option-price', '.order-total-tag']) {
  const rule = css.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{([^}]*)\\}'));
  if (!rule || /(^|;)color:var\(--bl\)/.test(rule[1])) fail(`${sel} must not use --bl for text`);
}
// Each section's eyebrow label must pass AA against that section's own background.
for (const m of html.matchAll(/<section([^>]*)>([\s\S]*?)<\/section>/g)) {
  const attrs = m[1], body = m[2];
  const label = body.match(/<p class="section-label"(?: style="color:([^;"]+);?")?>([^<]*)/);
  if (!label) continue;
  const cls = (attrs.match(/class="([^"\s]+)/) || [])[1];
  const inlineBg = (attrs.match(/style="[^"]*background:([^;"]+)/) || [])[1];
  const cssBg = cls ? (css.match(new RegExp('\\.' + cls + '\\{[^}]*background:([^;}]+)')) || [])[1] : null;
  const bg = resolve(inlineBg || cssBg), fg = resolve(label[1] || 'var(--bl-ink)');
  if (!bg || !fg) { fail(`cannot resolve colours for section label "${label[2].trim()}"`); continue; }
  if (ratio(fg, bg) < AA) fail(`section label "${label[2].trim()}" is ${ratio(fg, bg).toFixed(2)}:1 on its background`);
}

// ---- labels ----
const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
for (const m of html.matchAll(/<label class="field-label"([^>]*)>([^<]*)/g)) {
  const target = (m[1].match(/for="([^"]+)"/) || [])[1];
  if (!target || !ids.has(target)) fail(`checkout label "${m[2].trim()}" is not associated with its input`);
}

// ---- keyboard: clickable non-controls must be focusable buttons ----
// Backdrop click-to-dismiss overlays (each also has its own close control) and the cart
// summary (its own "Proceed to Checkout" button is the keyboard path) are the only exceptions.
const clickOnly = new Set(['alreadyInstalledPopup', 'iosInstallPopup', 'proofModal', 'orderToast', 'lightbox']);
for (const m of html.matchAll(/<div([^>]*\sonclick="[^"]*"[^>]*)>/g)) {
  const a = m[1], id = (a.match(/\sid="([^"]+)"/) || [])[1];
  if (clickOnly.has(id) || /class="cart-box"/.test(a)) continue;
  if (!/role="button"/.test(a) || !/tabindex="0"/.test(a)) fail(`click-only <div${a.slice(0, 70)}…> is not keyboard-operable`);
}
const core = fs.readFileSync('assets/js/customer/core.mjs', 'utf8');
if (!/t\.getAttribute\('role'\) !== 'button'/.test(core) || !/t\.click\(\)/.test(core)) fail('role="button" controls have no Enter/Space activation handler');
if (!/id="uploadBox"[^>]*role="button"[^>]*tabindex="0"/.test(html)) fail('the mandatory proof-of-payment upload is not keyboard-operable');

// ---- landmarks and structure ----
const mains = html.match(/<main\b/g) || [];
if (mains.length !== 1) fail(`expected exactly one <main>, found ${mains.length}`);
const skip = html.match(/<a class="skip-link" href="#([^"]+)"/);
if (!skip || !new RegExp(`<main[^>]*id="${skip[1]}"`).test(html)) fail('skip link missing or not pointing at <main>');
const body = html.slice(html.indexOf('<body'));
const firstLink = body.search(/<(a|button)\b/);
if (firstLink !== body.indexOf('<a class="skip-link"')) fail('skip link must be the first focusable element in <body>');
for (const m of html.matchAll(/<p\b[^>]*>((?:(?!<\/p>)[\s\S])*?)<p[\s>]/g)) fail(`nested <p> near: ${m[0].slice(0, 80)}`);

if (failures.length) { console.error('Customer accessibility check failed:\n- ' + failures.join('\n- ')); process.exit(1); }
console.log('PASS: customer checkout fields are labelled, click targets are keyboard-operable, text meets WCAG AA contrast, and the page has a skip link and one main landmark.');
