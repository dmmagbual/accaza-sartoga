// Bank accounts work like Xero (Sep 2026): one bank or e-wallet = one Finance Books ledger
// account plus the cash account every payment screen lists, created in one step.
// Incident: Maribank was added only as Chart of Accounts 1015, so Purchases and Cash Payments
// could never select it, and journals posted to 1015 never reached any bank balance.
// Runs the real Functions bundle against the in-memory database.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createFakeDatabase} from './helpers/fake-rtdb.mjs';
import {loadFunctions} from './helpers/functions-sandbox.mjs';

const require = createRequire(import.meta.url);
const Link = require('../functions/lib/bank-ledger-link.js');
const BooksBridge = require('../functions/lib/books-bridge.js');
const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

// ---- pure rules ----
assert.equal(Link.isBankLedgerCode('1015'), true);
assert.equal(Link.isBankLedgerCode('1030'), false, '1030 is the retired Undeposited alias');
assert.equal(Link.isBankLedgerCode('1040'), false, 'petty cash is not a bank');
assert.equal(Link.nextBankLedgerCode('bank', ['1010', '1011', '1012', '1013', '1014', '1015']), '1016');
assert.equal(Link.nextBankLedgerCode('ewallet', ['1020', '1021']), '1022');
assert.deepEqual(Link.resolveCashAccountCodes({a: {name: 'BDO'}, b: {name: 'Maribank', type: 'bank'}}, {b: '1015'}), {a: '1012', b: '1015'}, 'explicit link wins; older accounts keep the name rule');
assert.equal(Link.ledgerBalance({'2026-08': {1015: 2000}, '2026-09': {1015: -2000}}, '1015'), 0);
assert.throws(() => Link.chartChangeGuard({action: 'upsert', code: '1016', existing: null, linkedAccountIds: []}), /Add bank account/);
assert.deepEqual(Link.chartChangeGuard({action: 'upsert', code: '6100', existing: null, linkedAccountIds: []}), {});
assert.equal(Link.chartChangeGuard({action: 'upsert', code: '1015', existing: {}, linkedAccountIds: ['m']}).forceType, 'Asset');

// Oct 2026: every bank / e-wallet Books code has a Cash Flow account, and vice versa.
const seedChart = {1010: {type: 'Asset', system: true, name: 'Other Bank Accounts'}, 1011: {type: 'Asset', system: true, name: 'Union Bank'}, 1020: {type: 'Asset', system: true, name: 'GCash / Maya Wallet'}, 1021: {type: 'Asset', system: true, name: 'FoodPanda GCash Wallet'}, 1040: {type: 'Asset', system: true, name: 'Revolving Fund'}};
const liveAccounts = {u: {name: 'Union Bank'}, g: {name: 'G-Cash', type: 'ewallet'}};
assert.deepEqual(Link.cashLedgerCoverage({chart: seedChart, accounts: liveAccounts, configured: {}}), {orphanCodes: ['1021'], sharedCodes: [], unlinkedAccounts: []}, '1021 is the only chart-only wallet; 1010 fallback and 1040 petty cash are not bank accounts');
assert.deepEqual(Link.cashLedgerCoverage({chart: seedChart, accounts: Object.assign({m: {name: 'Maya', type: 'ewallet'}}, liveAccounts), configured: {}}).sharedCodes, [{code: '1020', accountIds: ['m', 'g']}], 'two wallets on one ledger code are reported');
assert.deepEqual(Link.cashLedgerCoverage({chart: seedChart, accounts: {x: {name: 'BPI'}}, configured: {}}).unlinkedAccounts, [{accountId: 'x', code: '1010'}], 'an account landing on the 1010 fallback is reported');
assert.deepEqual(Link.cashLedgerCoverage({chart: seedChart, accounts: Object.assign({f: {name: 'FP'}}, liveAccounts), configured: {f: '1021'}}).orphanCodes, [], 'the server-owned link covers the code');
assert.deepEqual(Link.resolveCashAccountCodes({f: {name: 'Kina', booksCode: '4000'}}, {}), {f: '1010'}, 'a booksCode written on the client-writable row never becomes the ledger link');
assert.deepEqual(Link.resolveCashAccountCodes({f: {name: 'Kina', booksCode: '1013'}}, {f: '1016'}), {f: '1016'}, 'the map wins over the row');
assert.deepEqual(Link.cashLedgerCoverage({chart: seedChart, accounts: Object.assign({f: {name: 'FoodPanda GCash', active: false}}, liveAccounts), configured: {}}).orphanCodes, ['1021'], 'an inactive account does not cover its code');
const seedPlan = (extra) => Link.plannedSeedCashAccounts(Object.assign({chart: seedChart, accounts: liveAccounts, configured: {}, monthlyNet: {}, monthlyReady: true}, extra));
assert.deepEqual(seedPlan().planned.map((x) => [x.code, x.accountId, x.name, x.type]), [['1021', 'acc_books_1021', 'FoodPanda GCash Wallet', 'ewallet']]);
assert.match(seedPlan({monthlyNet: {'2026-09': {1021: 150}}}).blocked[0].reason, /balance of 150\.00/, 'a code with its own balance is reported, never auto-linked');
assert.match(seedPlan({accounts: Object.assign({f: {name: 'FoodPanda GCash', active: false}}, liveAccounts)}).blocked[0].reason, /inactive/, 'a deactivated account is not recreated');
assert.match(seedPlan({chart: Object.assign({}, seedChart, {1021: {type: 'Asset', system: false, name: 'FP'}})}).blocked[0].reason, /Make bank account/, 'only seeded system codes are created automatically');
const OpEx = require('../functions/lib/operational-exceptions.js');
const coverageItems = OpEx.cashLedgerCoverageIssues(seedChart, {}, liveAccounts, 1);
assert.deepEqual(coverageItems.map((x) => [x.id, x.severity, x.tab]), [['cash_coverage_code_1021', 'warning', 'cashflow']]);
assert.match(coverageItems[0].title, /1021 FoodPanda GCash Wallet has no Cash Flow account/);
assert.deepEqual(OpEx.cashLedgerCoverageIssues({}, {}, liveAccounts, 1), [], 'no chart, no guess');

// ---- the real functions ----
const OWNER = {auth: {uid: 'owner', token: {email: 'danilomagbual@gmail.com'}}};
const call = (fn, data) => fn(Object.assign({}, OWNER, {data: Object.assign({openingDate: '2026-09-17'}, data)}));
const world = {
  admins: {owner: 'owner'},
  config: {booksChartManagers: {danilo: {email: 'danilomagbual@gmail.com', active: true}}},
  cfAccounts: {bdo: {name: 'BDO', type: 'bank', opening: 0}, gcash: {name: 'GCash', type: 'ewallet', opening: 0}},
  booksChart: {1015: {code: '1015', name: 'Maribank', type: 'Asset', note: '', active: true, system: false, sensitive: false}},
  books: {monthlyNet: {'2026-09': {1015: 5000, 3000: -5000}}, monthlyNetMeta: {schemaVersion: 2}},
};
const db = createFakeDatabase(world);
const WriteSafety = require('../functions/lib/write-safety.js');
const libOverrides = {'./lib/write-safety': Object.assign({}, WriteSafety, {safeAtomicUpdate: (target, writes) => target.ref().update(JSON.parse(JSON.stringify(writes)))})};
const {exports: fx, internal} = loadFunctions(db, {libOverrides, expose: ['booksCodeAccount', 'booksCashAccountMap', 'ensureBooksChart']});
const val = async (p) => (await db.ref(p).get()).val();
const rejects = async (promise, pattern, message) => { await assert.rejects(promise, (e) => pattern.test(String(e && e.message)), message); };

// A bank code can no longer be added as a plain ledger account.
await rejects(call(fx.manageBooksAccount, {action: 'upsert', code: '1016', name: 'Kina Bank', type: 'Asset'}), /Add bank account/, 'plain Add account refuses bank codes');
assert.equal(await val('booksChart/1016'), null);

// 1015 already holds journals that never reached a bank balance: linking would count them twice.
await rejects(call(fx.manageCashAccount, {action: 'upsert', commandId: 'c1', accountId: 'maribank', name: 'Maribank', type: 'bank', booksCode: '1015', opening: 0}), /balance of 5000\.00[\s\S]*Void or reverse/, 'a code with its own balance is not linked');
assert.equal(await val('cfAccounts/maribank'), null);

// After the journal is voided (net zero), "Make bank account" links 1015 to a new cash account.
await db.ref('books/monthlyNet/2026-09/1015').set(0);
const made = await call(fx.manageCashAccount, {action: 'upsert', commandId: 'c2', accountId: 'maribank', name: 'Maribank', type: 'bank', booksCode: '1015', opening: 0});
assert.equal(made.booksCode, '1015');
assert.equal((await val('cfAccounts/maribank')).booksCode, '1015', 'payment screens see the account');
assert.equal(await val('books/config/cashAccountMap/maribank'), '1015', 'server-owned link');
assert.equal((await val('booksChart/1015')).bankAccountId, 'maribank');
assert.equal((await val('booksChart/1015')).sensitive, true, 'bank journals need a reference');

// Postings and manual journals to 1015 now land in the Maribank bank account.
const map = await internal.booksCashAccountMap(db);
assert.equal(map.maribank, '1015');
const accounts = await val('cfAccounts'), chart = await internal.ensureBooksChart(db);
assert.equal(internal.booksCodeAccount('1015', accounts, chart, await val('books/config/cashAccountMap')).account, 'asset:cash_account:maribank');
const deposit = {id: 'm1', type: 'manual_cash', occurredAt: Date.parse('2026-09-17T09:00:00+08:00'), lines: [{account: 'asset:cash_account:maribank', debit: 250, credit: 0}, {account: 'revenue:other', debit: 0, credit: 250}]};
assert.ok(BooksBridge.buildSingle(deposit, map).entry.lines.some((l) => l.code === '1015' && l.debit === 250), 'bank movement posts to 1015');

// The same code cannot belong to two banks; a code with history cannot be moved.
await rejects(call(fx.manageCashAccount, {action: 'upsert', commandId: 'c3', accountId: 'other', name: 'Other', type: 'bank', booksCode: '1015', opening: 0}), /already linked/);
await rejects(call(fx.manageCashAccount, {action: 'upsert', commandId: 'c4', accountId: 'maribank', name: 'Maribank', type: 'bank', booksCode: '1017', opening: 0}), /not supported/);
await rejects(call(fx.manageCashAccount, {action: 'upsert', commandId: 'c5', accountId: 'bad', name: 'Bad', type: 'bank', booksCode: '6100', opening: 0}), /1010 to 1039/);

// One-step add: the next free code, a new Asset ledger row, and the link together.
const kina = await call(fx.manageCashAccount, {action: 'upsert', commandId: 'c6', accountId: 'kina', name: 'Kina Bank', type: 'bank', opening: 0});
assert.equal(kina.booksCode, '1016');
assert.deepEqual([(await val('booksChart/1016')).type, (await val('booksChart/1016')).name, (await val('booksChart/1016')).bankAccountId], ['Asset', 'Kina Bank', 'kina']);
const maya = await call(fx.manageCashAccount, {action: 'upsert', commandId: 'c7', accountId: 'maya', name: 'Maya Business', type: 'ewallet', opening: 0});
assert.equal(maya.booksCode, '1022');

// An opening balance still needs evidence, and no code is claimed when it is refused.
await rejects(call(fx.manageCashAccount, {action: 'upsert', commandId: 'c8', accountId: 'bpi', name: 'BPI', type: 'bank', opening: 900}), /reference and reason/);
assert.equal(await val('books/config/cashAccountCodeClaims/1017'), null);
const bpi = await call(fx.manageCashAccount, {action: 'upsert', commandId: 'c9', accountId: 'bpi', name: 'BPI', type: 'bank', opening: 900, openingDate: '2026-09-17', reference: 'STMT-0917', reason: 'Balance when added'});
assert.equal(bpi.booksCode, '1017');
const openingMove = await val('financialMovements/opening_adjust_bpi_c9');
assert.ok(openingMove && openingMove.lines.some((l) => l.account === 'asset:cash_account:bpi' && Number(l.debit) === 900), 'opening balance posts to the bank account');

// Older accounts get their current code written down, unchanged.
await db.ref('books/monthlyNet/2026-09/1013').set(75);
const init = await call(fx.manageBooksAccount, {action: 'initialize'});
assert.equal(await val('books/config/cashAccountMap/bdo'), '1012');
assert.equal(await val('books/config/cashAccountMap/gcash'), '1020');

// Renaming the ledger account renames the bank everywhere.
await call(fx.manageBooksAccount, {action: 'upsert', code: '1015', name: 'Maribank Savings', type: 'Expense'});
assert.equal((await val('booksChart/1015')).type, 'Asset', 'a linked bank stays an Asset');
assert.equal((await val('cfAccounts/maribank')).name, 'Maribank Savings');
assert.equal((await val('booksChart/1015')).bankAccountId, 'maribank', 'rename keeps the link marker');
// ...and renaming the bank renames the ledger account.
await call(fx.manageCashAccount, {action: 'upsert', commandId: 'c10', accountId: 'kina', name: 'Kina Bank PNG', type: 'bank', opening: 0});
assert.equal((await val('booksChart/1016')).name, 'Kina Bank PNG');
assert.equal((await val('cfAccounts/kina')).booksCode, '1016');

// Closing a bank: refused while money is in it, then the bank leaves every payment screen.
await rejects(call(fx.manageBooksAccount, {action: 'deactivate', code: '1017'}), /Transfer the remaining balance out of BPI/);
assert.notEqual((await val('cfAccounts/bpi')).active, false);
await call(fx.manageBooksAccount, {action: 'deactivate', code: '1016'});
assert.equal((await val('cfAccounts/kina')).active, false);
await call(fx.manageBooksAccount, {action: 'reactivate', code: '1016'});
assert.equal((await val('cfAccounts/kina')).active, true);
await call(fx.manageCashAccount, {action: 'upsert', commandId: 'c11', accountId: 'kina', name: 'Kina Bank PNG', type: 'bank', opening: 0});
assert.equal((await val('cfAccounts/kina')).booksCode, '1016', 'editing keeps the link');

// Opening Finance Books creates the Cash Flow account of every seeded bank / wallet code that lacks one.
const fp = await val('cfAccounts/acc_books_1021');
assert.equal(fp && fp.name, 'FoodPanda GCash Wallet', '1021 now has its Cash Flow account');
assert.deepEqual([fp.type, fp.booksCode, fp.opening, fp.createdFrom], ['ewallet', '1021', 0, 'books_chart_seed']);
assert.equal(await val('books/config/cashAccountMap/acc_books_1021'), '1021');
assert.equal((await val('booksChart/1021')).bankAccountId, 'acc_books_1021');
assert.equal(await val('cfAccounts/acc_books_1013'), null, 'a code holding a Books balance is not auto-linked');
assert.ok(init.cashAccountsBlocked.some((x) => x.code === '1013' && /balance of 75\.00/.test(x.reason)), 'and the reason is returned');
assert.ok(init.cashAccountsCreated.some((x) => x.code === '1021'));
const again = await call(fx.manageBooksAccount, {action: 'initialize'});
assert.equal(again.cashAccountsCreated.length, 0, 'idempotent: a second open creates nothing');
await rejects(call(fx.manageCashAccount, {action: 'upsert', commandId: 'c12', accountId: 'fp2', name: 'FP Wallet 2', type: 'ewallet', booksCode: '1021', opening: 0}), /already linked/, '1021 cannot be linked twice');

// ---- wiring ----
const bundle = read('functions/index.js'), books = read('assets/js/books/app.js'), controlledBooks = read('assets/js/books/controlled-transactions.js'), live = (read('assets/js/books/live-pos.mjs')+read('assets/js/books/finance-callables.mjs'));
for (const marker of ['ensureSeededCashAccounts(db, chart, cashAccounts,', 'cashLedgerCoverageIssues(input.booksChart, input.cashAccountMap, input.cfAccounts, now)', 'db.ref("/booksChart").get(),db.ref("/books/config/cashAccountMap").get()'])
  assert.ok(bundle.includes(marker) || read('functions/lib/operational-exceptions.js').includes(marker), `coverage wiring missing: ${marker}`);
const adminJs = read('assets/js/admin/analytics.js') + read('assets/js/admin/finance.js');
assert.ok(adminJs.includes("String(x.booksCode||'')==='1021'"), 'FoodPanda payouts default to the 1021 wallet');
assert.ok(!adminJs.includes("A().set(A().ref(A().db,'cfAccounts/'+uid('acc_'))") && !adminJs.includes('data-acctdel'), 'Admin no longer creates or deletes bank accounts outside Finance Books');
for (const marker of ['BankLedgerLink.planCashAccountLink(', '`books/config/cashAccountMap/${id}`', 'cashAccountCodeClaims', 'BankLedgerLink.chartChangeGuard(', 'BankLedgerLink.accountsForCode(code, accounts, cashAccountMap)', 'BankLedgerLink.resolveCashAccountCodes(accounts,'])
  assert.ok(bundle.includes(marker), `server wiring missing: ${marker}`);
for (const marker of ['App.bankAccountForm=', 'App.bankAccountCreate=', "onclick=\"App.bankAccountForm('')\">+ Add bank account", 'Make bank account', 'bankAccountsForCode(a.code)', "this.bankAccountForm('',code)"])
  assert.ok(books.includes(marker)||controlledBooks.includes(marker), `Books wiring missing: ${marker}`);
assert.ok(live.includes('ref(db,"/books/config/cashAccountMap")'), 'Books shows which ledger account each bank uses');
assert.ok(JSON.parse(read('release-manifest.json')).authoritativeFiles.includes('functions/lib/bank-ledger-link.js'), 'release manifest lists the link rules');

console.log('PASS: bank and e-wallet accounts are created once, linked to their own Finance Books account, selectable in every payment screen, and protected from double counting.');
