import fs from 'node:fs';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const CashBalances = require('../functions/lib/cash-balances.js');
const finance = fs.readFileSync('src/admin/finance/00-bootstrap-ledger.js', 'utf8');
const firebaseClient = fs.readFileSync('assets/js/admin/firebase-client.mjs', 'utf8');
const core = fs.readFileSync('assets/js/admin/core.mjs', 'utf8');
const functions = fs.readFileSync('functions/index.js', 'utf8');
const undepositedControl = fs.readFileSync('src/functions/21a-undeposited-pages.js', 'utf8');

function fail(message) { throw new Error(message); }
function expect(condition, message) { if (!condition) fail(message); }

const movements = {
  sale_1: {lines: [
    {account: 'asset:register_cash', debit: 100, credit: 0},
    {account: 'revenue:sales', debit: 0, credit: 100},
  ]},
  deposit_1: {lines: [
    {account: 'asset:cash_account:gcash', debit: 250.005, credit: 0},
    {account: 'asset:cash_awaiting_deposit', debit: 0, credit: 250},
    {account: 'asset:petty_cash', debit: 10, credit: 0},
  ]},
};
const snapshot = CashBalances.snapshotFromMovements(movements, 123);
expect(snapshot.schemaVersion === CashBalances.SCHEMA_VERSION && snapshot.complete === true, 'cash summary must be versioned and complete');
expect(snapshot.balances.registerCents === 10000, 'register balance must use cent precision');
expect(snapshot.balances.cashAccountCents.gcash === 25001, 'cash-account cents were not accumulated');
expect(snapshot.balances.undepositedCents === -25000, 'Undeposited Collection direction changed');
expect(snapshot.balances.revolvingCents === 1000, 'Revolving Fund balance was not accumulated');

const publicView = CashBalances.clientBalances(snapshot, {fixedFloat: 40}, {});
expect(publicView.balances.cash_on_hand === 60, 'protected float must be excluded from available register cash');
expect(publicView.balances.cash_float === 40, 'configured float must be returned separately');
expect(publicView.balances.gcash === 250.01, 'public cash-account balances must remain cent-rounded');

const edited = {lines: [
  {account: 'asset:register_cash', debit: 125, credit: 0},
  {account: 'revenue:sales', debit: 0, credit: 125},
]};
const split = CashBalances.splitSnapshotFromMovements(movements, 123);
expect(!Object.hasOwn(snapshot, 'applied'), 'the hot cash summary must not contain the growing applied-movement history');
const editedResult = CashBalances.applyContribution(snapshot, split.applied.sale_1, edited, 456);
expect(editedResult.summary.balances.registerCents === 12500, 'movement edits must replace, not stack, the prior delta');
expect(CashBalances.contributionMatches(editedResult.applied, edited), 'the exact edited movement fingerprint must be retained separately');
const deletedResult = CashBalances.applyContribution(editedResult.summary, split.applied.deposit_1, null, 999);
expect(deletedResult.applied === null && deletedResult.summary.balances.cashAccountCents.gcash === undefined, 'movement deletion must remove its cached delta');
expect(CashBalances.contributionMatches(null, null), 'a deleted movement is applied only when its separate contribution is absent');

expect(functions.includes('exports.getCurrentCashBalances'), 'server cash-balance callable is not bundled');
expect(functions.includes('exports.updateCashBalanceSummary'), 'cash-balance summary trigger is not bundled');
expect(functions.includes('cashBalanceSummaryApplied'), 'movement idempotency rows must be stored outside the hot summary');
expect(functions.includes('cashBalanceSummaryProcessorLock'), 'cash summary updates must be serialized by a bounded lease');
expect(functions.includes('limitToFirst(CASH_SUMMARY_BATCH_SIZE)'), 'pending recovery must use bounded queue reads');
expect(!functions.includes('db.ref("/cashBalanceSummary").transaction'), 'the growing cash summary must not be downloaded inside RTDB transactions');
expect(functions.includes('rebuildCashBalanceSummary'), 'a stale schema must force one authoritative full-journal rebuild');
expect(functions.includes('ensureCashBalanceSummary'), 'all cash-control callables must share one summary validation and recovery path');
expect(undepositedControl.includes('summaryMeta.schemaVersion!==CashBalances.SCHEMA_VERSION'), 'Undeposited Collection must reject a stale summary schema');
expect(undepositedControl.includes('await ensureCashBalanceSummary(db)'), 'Undeposited Collection must invoke the authoritative summary recovery path');
expect(firebaseClient.includes("'getCurrentCashBalances'"), 'Admin callable registry is missing getCurrentCashBalances');
expect(core.includes('getCurrentCashBalances:function'), 'Admin runtime does not expose the cash-balance callable');
expect(finance.includes('a.getCurrentCashBalances()'), 'Finance must request the compact cash-balance summary');
expect(!finance.includes("a.get(a.ref(a.db,'financialMovements'))"), 'Finance cash refresh still downloads the full financialMovements node');
expect(!finance.includes('financialMovementsMap=rows[0].val()'), 'Finance cash refresh must not overwrite bounded movement history');

console.log('PASS: cash-balance materialization, cent precision, idempotent edits, and Admin download guard passed.');
