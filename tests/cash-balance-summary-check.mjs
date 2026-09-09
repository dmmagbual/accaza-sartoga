import fs from 'node:fs';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const CashBalances = require('../functions/lib/cash-balances.js');
const finance = fs.readFileSync('src/admin/finance/00-bootstrap-ledger.js', 'utf8');
const firebaseClient = fs.readFileSync('assets/js/admin/firebase-client.mjs', 'utf8');
const core = fs.readFileSync('assets/js/admin/core.mjs', 'utf8');
const functions = fs.readFileSync('functions/index.js', 'utf8');

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
expect(snapshot.schemaVersion === 1 && snapshot.complete === true, 'cash summary must be versioned and complete');
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
const applied = CashBalances.applyEvent(snapshot, 'sale_1', movements.sale_1, edited, 456);
expect(applied && applied.balances.registerCents === 12500, 'movement edits must replace, not stack, the prior delta');
expect(CashBalances.applyEvent(applied, 'sale_1', edited, edited, 789) === undefined, 'replayed movement event must be idempotent');
const deleted = CashBalances.applyEvent(applied, 'deposit_1', movements.deposit_1, null, 999);
expect(deleted && !deleted.applied.deposit_1 && deleted.balances.cashAccountCents.gcash === undefined, 'movement deletion must remove its cached delta');

expect(functions.includes('exports.getCurrentCashBalances'), 'server cash-balance callable is not bundled');
expect(functions.includes('exports.updateCashBalanceSummary'), 'cash-balance summary trigger is not bundled');
expect(firebaseClient.includes("'getCurrentCashBalances'"), 'Admin callable registry is missing getCurrentCashBalances');
expect(core.includes('getCurrentCashBalances:function'), 'Admin runtime does not expose the cash-balance callable');
expect(finance.includes('a.getCurrentCashBalances()'), 'Finance must request the compact cash-balance summary');
expect(!finance.includes("a.get(a.ref(a.db,'financialMovements'))"), 'Finance cash refresh still downloads the full financialMovements node');
expect(!finance.includes('financialMovementsMap=rows[0].val()'), 'Finance cash refresh must not overwrite bounded movement history');

console.log('PASS: cash-balance materialization, cent precision, idempotent edits, and Admin download guard passed.');
