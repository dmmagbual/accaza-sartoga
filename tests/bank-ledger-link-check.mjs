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
await call(fx.manageBooksAccount, {action: 'initialize'});
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

// ---- wiring ----
const bundle = read('functions/index.js'), books = read('assets/js/books/app.js'), live = read('assets/js/books/live-pos.mjs');
for (const marker of ['BankLedgerLink.planCashAccountLink(', '`books/config/cashAccountMap/${id}`', 'cashAccountCodeClaims', 'BankLedgerLink.chartChangeGuard(', 'BankLedgerLink.accountsForCode(code, accounts, cashAccountMap)', 'BankLedgerLink.resolveCashAccountCodes(accounts,'])
  assert.ok(bundle.includes(marker), `server wiring missing: ${marker}`);
for (const marker of ['App.bankAccountForm=', 'App.bankAccountCreate=', "onclick=\"App.bankAccountForm('')\">+ Add bank account", 'Make bank account', 'bankAccountsForCode(a.code)', "this.bankAccountForm('',code)"])
  assert.ok(books.includes(marker), `Books wiring missing: ${marker}`);
assert.ok(live.includes('ref(db,"/books/config/cashAccountMap")'), 'Books shows which ledger account each bank uses');
assert.ok(JSON.parse(read('release-manifest.json')).authoritativeFiles.includes('functions/lib/bank-ledger-link.js'), 'release manifest lists the link rules');

console.log('PASS: bank and e-wallet accounts are created once, linked to their own Finance Books account, selectable in every payment screen, and protected from double counting.');
