import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function scripts(html) {
  return [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)].map((m, index) => ({
    index: index + 1,
    full: m[0],
    attrs: m[1],
    body: m[2],
    start: m.index,
    end: m.index + m[0].length,
  }));
}

function write(rel, body) {
  const target = path.join(root, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, body.replace(/^\r?\n/, '').replace(/\s*$/, '') + '\n', 'utf8');
}

function rewrite(file, replacements) {
  let html = fs.readFileSync(path.join(root, file), 'utf8');
  const found = scripts(html);
  for (const item of replacements) {
    const block = found[item.index - 1];
    if (!block) throw new Error(`${file}: script ${item.index} was not found`);
    if (item.expectId && !block.attrs.includes(`id="${item.expectId}"`)) {
      throw new Error(`${file}: script ${item.index} is not ${item.expectId}`);
    }
    if (item.out) write(item.out, block.body);
  }
  for (const item of [...replacements].sort((a, b) => b.index - a.index)) {
    const block = found[item.index - 1];
    html = html.slice(0, block.start) + item.tag + html.slice(block.end);
  }
  fs.writeFileSync(path.join(root, file), html, 'utf8');
}

rewrite('admin.html', [
  { index: 5, out: 'assets/js/admin/core.mjs', tag: '<script type="module" src="assets/js/admin/core.mjs"></script>' },
  { index: 6, tag: '<!-- Release 2D: retired customer navigation script removed from admin portal. -->' },
  { index: 7, tag: '<!-- Release 2D: retired customer UI enhancement script removed from admin portal. -->' },
  { index: 8, tag: '<!-- Release 2D: retired customer order-tracker script removed from admin portal. -->' },
  { index: 9, expectId: 'accaza-pos', out: 'assets/js/admin/pos.js', tag: '<!-- Release 2D: POS module is loaded on demand. -->' },
  { index: 10, expectId: 'accaza-analytics', out: 'assets/js/admin/analytics.js', tag: '<!-- Release 2D: analytics module is loaded on demand. -->' },
  { index: 11, expectId: 'accaza-regops', out: 'assets/js/admin/register.js', tag: '<!-- Release 2D: register module is loaded on demand. -->' },
  { index: 12, expectId: 'admin-portal-boot', out: 'assets/js/admin/portal-boot.js', tag: '<script src="assets/js/admin/portal-boot.js"></script>' },
  { index: 13, expectId: 'accaza-staffaccess', out: 'assets/js/admin/staff-access.js', tag: '<!-- Release 2D: staff-access module is loaded on demand. -->' },
  { index: 14, expectId: 'accaza-packages', out: 'assets/js/admin/packages.js', tag: '<!-- Release 2D: packages module is loaded on demand. -->' },
  { index: 15, expectId: 'accaza-cashflow', out: 'assets/js/admin/finance.js', tag: '<!-- Release 2D: finance module is loaded on demand. -->' },
]);

rewrite('index.html', [
  { index: 4, out: 'assets/js/customer/core.mjs', tag: '<script type="module" src="assets/js/customer/core.mjs"></script>' },
  { index: 5, out: 'assets/js/customer/navigation.js', tag: '<script src="assets/js/customer/navigation.js" defer></script>' },
  { index: 6, out: 'assets/js/customer/ui.js', tag: '<script src="assets/js/customer/ui.js" defer></script>' },
  { index: 7, out: 'assets/js/customer/order-tracker.js', tag: '<script src="assets/js/customer/order-tracker.js" defer></script>' },
  { index: 8, expectId: 'accaza-cust-packages', out: 'assets/js/customer/packages.js', tag: '<script src="assets/js/customer/packages.js" defer></script>' },
]);

console.log('Release 2D script extraction complete.');
