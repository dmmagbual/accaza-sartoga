/* Payment routing consistency — regression guard.

   A walk-in sale stores the receiving account the cashier picked. An online sale stores no account,
   so the ledger resolves it through Financial.accountForMethod — the account whose feedMethods claims
   that method. The two agree only by configuration, never by construction, and accountForMethod
   silently keeps the LAST matching account when several claim the same method.

   That is how past and current GCash money can end up in two different accounts with no warning.
   These checks make the divergence visible in the Exception Center. */
import path from 'node:path';
import {createRequire} from 'node:module';
const root = path.join(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const {paymentRoutingIssues} = require(path.join(root, 'functions/lib/operational-exceptions.js'));
const Financial = require(path.join(root, 'functions/lib/financial.js'));
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };
const now = Date.now();
const ids = (list) => list.map((x) => x.id).sort();

/* Healthy: one account claims the method, and it is the one the cashier can pick. */
const healthy = paymentRoutingIssues(
  [{name:'Cash', cash:true}, {name:'GCash', accountIds:['acc_gcash']}],
  {acc_gcash:{name:'G-Cash', feedMethods:['GCash']}, acc_bdo:{name:'BDO', feedMethods:['Bank Transfer']}}, now);
check(healthy.length === 0, `A correctly routed method must raise nothing, got: ${JSON.stringify(ids(healthy))}`);

/* Two accounts claim GCash — accountForMethod keeps the last, so online money is unpredictable. */
const twoAccounts = {acc_gcash:{name:'G-Cash', feedMethods:['GCash']}, acc_old:{name:'Old GCash', feedMethods:['GCash']}};
const multi = paymentRoutingIssues([{name:'GCash', accountIds:['acc_gcash']}], twoAccounts, now);
check(multi.length === 1 && multi[0].severity === 'critical' && multi[0].category === 'payment_routing',
  'Two accounts claiming one method must raise a critical routing exception.');
check(/G-Cash/.test(multi[0].detail) && /Old GCash/.test(multi[0].detail),
  'The exception must name both competing accounts so the operator knows what to unpick.');
/* The library's warning must match what the ledger actually does. */
check(Financial.accountForMethod('GCash', twoAccounts) === 'acc_old',
  'accountForMethod keeps the last claimant — if this ever changes, the exception wording is wrong.');

/* Nothing claims the method: an online sale cannot be mapped at all. */
const orphan = paymentRoutingIssues([{name:'GCash', accountIds:['acc_gcash']}],
  {acc_gcash:{name:'G-Cash', feedMethods:[]}}, now);
check(orphan.length === 1 && orphan[0].severity === 'warning',
  'A method no account claims must raise a warning.');

/* The split Danilo asked about: till and online resolve to different accounts. */
const split = paymentRoutingIssues([{name:'GCash', accountIds:['acc_wrong']}],
  {acc_wrong:{name:'Wrong Wallet', feedMethods:[]}, acc_gcash:{name:'G-Cash', feedMethods:['GCash']}}, now);
check(split.length === 1 && split[0].severity === 'critical',
  'A method whose till account differs from its online account must raise a critical exception.');
check(/two different accounts/.test(split[0].detail),
  'The exception must say plainly that money is landing in two different accounts.');

/* Cash and deactivated methods route no electronic money and must stay quiet. */
check(paymentRoutingIssues([{name:'Cash', cash:true}], {}, now).length === 0, 'Cash must not be checked for a receiving account.');

/* orderPosting decides a sale is cash by the LITERAL name, not by the method's cash flag. A cash
   method named anything else keeps the till treating it as cash while the ledger sends it to an
   unmapped suspense account. */
const renamedCash = paymentRoutingIssues([{name:'Cash on Hand', cash:true}], {}, now);
check(renamedCash.length === 1 && renamedCash[0].severity === 'critical',
  'A cash-flagged method not named Cash must raise a critical exception.');
check(/suspense/.test(renamedCash[0].detail),
  'The exception must say where the money actually goes.');
check(paymentRoutingIssues([{name:'Old Wallet', active:false}], {}, now).length === 0, 'A deactivated method must not raise noise.');
check(paymentRoutingIssues(undefined, undefined, now).length === 0, 'Missing settings must not throw or invent exceptions.');

/* A method with no configured accountIds falls back to the claimant and is not a split. */
check(paymentRoutingIssues([{name:'GCash'}], {acc_gcash:{name:'G-Cash', feedMethods:['GCash']}}, now).length === 0,
  'A method with no explicit account list must not be reported as split.');

if (failures.length) { console.error('Payment routing consistency check failed:\n- ' + failures.join('\n- ')); process.exit(1); }
console.log('PASS: payment methods routing to a different account online than at the till, to several accounts, or to none, are raised in the Exception Center.');
