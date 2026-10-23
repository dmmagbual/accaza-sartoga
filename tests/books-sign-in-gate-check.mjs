/* Finance Books sign-in gate — regression guard (books 159).
   Danilo, 23 Oct 2026: a dedicated sign-in for Finance Books. Books stays hidden until a staff account
   with Finance Books access signs in, and no live feed, presence or server call starts before that.
   The access rule must match the database rules and the Books server functions. */
import fs from 'node:fs';
import vm from 'node:vm';
const read = (p) => fs.readFileSync(p, 'utf8');
const gateSource = read('assets/js/books/books-gate.js'), live = read('assets/js/books/live-pos.mjs'), html = read('books.html'), css = read('assets/css/books.css'), sw = read('sw.js');
const rules = read('database.rules.json'), portal = read('src/functions/20-portal-auth.js'), journal = read('src/functions/10-books-bridge.js');
const failures = [], must = (s, marker, message) => { if (!s.includes(marker)) failures.push(message); };

// 1) The access rule, run for real.
const classes = new Set(), gateEl = {hidden: false, innerHTML: '', querySelector: () => null};
const context = {window: {}, location: {reload() {}}, setTimeout: () => 0,
  document: {readyState: 'complete', body: {classList: {add: (c) => classes.add(c), remove: (c) => classes.delete(c)}}, getElementById: (id) => (id === 'booksGate' ? gateEl : null), addEventListener() {}}};
vm.runInNewContext(gateSource, context);
const G = context.window.BooksGate, decide = G.decide;
const cases = [
  ['Super Admin', 'superadmin', null, true], ['legacy Owner (true)', true, null, true], ['Owner object', {role: 'owner'}, null, true],
  ['Admin', 'admin', null, true], ['Manager', {role: 'manager'}, null, true],
  ['Finance with Finance Books app', 'finance', {cashflow: true}, true], ['Staff with older payables grant', 'staff', {payables: true}, true],
  ['Finance without the permission', 'finance', {purchases: true}, false], ['Cashier', 'cashier', {pos: true}, false], ['Kitchen', 'kitchen', null, false],
  ['Not a staff account', null, null, false], ['Disabled Super Admin', {role: 'superadmin', disabled: true}, null, false], ['Inactive manager', {role: 'manager', active: false}, null, false],
];
for (const [label, raw, perms, expected] of cases) if (decide(raw, perms).allowed !== expected) failures.push(`${label} must ${expected ? '' : 'NOT '}open Finance Books.`);
if (decide('finance', null).reason !== 'no_permission') failures.push('A staff role with no permissions read yet must ask for its permissions, not be refused outright.');
if (decide(null, null).reason !== 'not_staff' || decide({role: 'admin', disabled: true}, null).reason !== 'disabled') failures.push('Refusals must say why (not staff / disabled).');
G.show('signin'); if (!classes.has('books-locked') || !gateEl.innerHTML.includes('booksGateForm')) failures.push('The sign-in state must lock Books and show the sign-in form.');
G.show('denied', {email: 'a@b.c', reason: 'no_permission'}); if (!gateEl.innerHTML.includes('Finance Books app') || !gateEl.innerHTML.includes('data-gate-signout')) failures.push('A refused account must be told which permission to ask for and be able to sign out.');
G.hide(); if (classes.has('books-locked') || gateEl.hidden !== true) failures.push('Opening Books must unlock it and hide the gate.');

// 2) The rule matches the server: management roles pass by role, others need cashflow / receivables / payables.
must(portal, 'if (["owner", "superadmin", "admin", "manager"].includes(portal.role)) return portal;', 'Server role bypass changed; update BooksGate.decide to match.');
must(journal, 'requirePortalPermission(db, request, ["cashflow", "receivables", "payables"])', 'Books server permission keys changed; update BooksGate.decide to match.');
for (const key of ['cashflow', 'receivables', 'payables']) must(rules, `root.child('adminPerms').child(auth.uid).child('${key}').val() === true`, `The Books data rules no longer accept ${key}; update BooksGate.decide.`);

// 3) Nothing loads before access is confirmed.
const handler = live.slice(live.indexOf('onAuthStateChanged(auth'));
const accessAt = handler.indexOf('const access=user?await booksAccess(user):null;');
if (accessAt < 0) failures.push('Books must check access on every sign-in.');
for (const marker of ['bindPeriodJournal();', 'startPortalPresence(', 'startPortalIdle(', "__manageBooksAccount({action:'initialize'})", '__manageSupplier({action:"initialize_legacy"})', 'syncOptionalFeeds();'])
  if (handler.indexOf(marker) >= 0 && handler.indexOf(marker) < accessAt) failures.push(`${marker} must not run before Finance Books access is confirmed.`);
must(handler, 'if(seq!==authSeq)return;', 'A slow access check must not open Books for an account that has since signed out.');
must(handler, 'if(user&&!access.allowed){ window.__booksUser=null;clearLiveCaches();', 'A refused account must leave no live data on the page.');
must(handler, 'window.BooksGate.show("signin")', 'Signing out must bring back the sign-in screen.');
must(live, 'window.__booksGateSignIn=', 'The gate needs its own sign-in that reports errors on the form.');
must(live, 'window.BooksGate.show("offline")', 'A Firebase start-up failure must show the offline screen, not an unlocked page.');

// 4) The page starts locked and stays locked without JavaScript or styles for the app.
must(html, '<body class="books-locked">', 'Books must start locked.');
if (!(html.indexOf('id="booksGate"') > 0 && html.indexOf('id="booksGate"') < html.indexOf('class="topbar"'))) failures.push('The gate must come before the Books content.');
must(html, 'assets/js/books/books-gate.js?v=', 'books.html must load the gate.');
if (!(html.indexOf('books-gate.js') < html.indexOf('live-pos.mjs'))) failures.push('The gate must load before the live connection.');
must(html, 'class="books-signout"', 'A signed-in user must be able to sign out from the top bar.');
must(css, 'body.books-locked .books-navigation,body.books-locked .wrap', 'Locked Books must hide its navigation and pages.');
must(sw, "'/assets/js/books/books-gate.js'", 'The gate must be in the offline cache with the rest of Books.');

if (failures.length) { console.error('Books sign-in gate check failed:\n- ' + failures.join('\n- ')); process.exit(1); }
console.log('PASS: Finance Books starts locked, opens only for accounts the server allows (management roles, or Finance Books app / payables / receivables), starts no feed or server call before that, and shows sign-in, no-access and offline screens.');
