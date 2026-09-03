/* Payment method grouping — regression guard.

   The POS writes a payment's method as "Bank Transfer · BDO" when a receiving account resolves
   and plain "Bank Transfer" when it does not (`src/admin/pos/00-shared-state.js` resolvedPayment).
   Every report that totalled by that label therefore split one method across two rows —
   "Bank Transfer · BDO ₱985" beside "Bank Transfer ₱440", "GCash · G-Cash" beside "GCash".

   The bare method is already stored as paymentMethod. Totals must key on it, never on the label. */
import fs from 'node:fs';
import path from 'node:path';
const root = path.join(import.meta.dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const failures = [];
const must = (source, marker, message) => { if (!source.includes(marker)) failures.push(message); };
const check = (condition, message) => { if (!condition) failures.push(message); };

/* ---------- executable: the real shared resolver ---------- */
const win = {};
new Function('window', read('assets/js/shared/sales-authority.js'))(win);
const key = win.AccazaSales.paymentKey;

check(key({method:'Bank Transfer · BDO', paymentMethod:'Bank Transfer', receivingAccountName:'BDO'}) === 'Bank Transfer',
  'A suffixed payment must key on its stored bare method.');
check(key({method:'Bank Transfer'}) === 'Bank Transfer',
  'An unsuffixed legacy payment must key on the same method.');
check(key({method:'GCash · G-Cash', receivingAccountName:'G-Cash'}) === 'GCash',
  'A legacy payment with no paymentMethod field must have its account suffix trimmed.');
check(key('Bank Transfer · BDO') === 'Bank Transfer',
  'An order-level payment label string must resolve the same way.');
check(key('Cash') === 'Cash' && key({method:'Cash'}) === 'Cash',
  'Cash must stay Cash — the Z-report reads byMethod.Cash for shift reconciliation.');
check(key(null) === 'Other' && key({}) === 'Other',
  'A missing payment must fall back to Other rather than an empty bucket.');

/* The reported symptom, end to end: two labels, one row. */
const payments = [
  {method:'Bank Transfer · BDO', paymentMethod:'Bank Transfer', amount:985},
  {method:'Bank Transfer', amount:440},
  {method:'GCash · G-Cash', receivingAccountName:'G-Cash', amount:460},
  {method:'GCash', amount:605},
  {method:'Cash', amount:5230},
];
const mix = {};
payments.forEach((p) => { const k = key(p); mix[k] = (mix[k] || 0) + p.amount; });
check(Object.keys(mix).length === 3, `One row per method expected, got ${Object.keys(mix).length}: ${Object.keys(mix).join(', ')}`);
check(mix['Bank Transfer'] === 1425, `Bank Transfer must total 985 + 440 = 1425, got ${mix['Bank Transfer']}`);
check(mix['GCash'] === 1065, `GCash must total 460 + 605 = 1065, got ${mix['GCash']}`);
check(mix['Cash'] === 5230, 'Cash must be unaffected.');

/* ---------- reclassification: old method names fold into the current one ---------- */
const winAlias = {__posSettings:{payMethods:[{name:'Cash',cash:true},{name:'Bank Transfer'},{name:'E-Wallet',aliases:['GCash','PayMaya']}]}};
new Function('window', read('assets/js/shared/sales-authority.js'))(winAlias);
const aliasKey = winAlias.AccazaSales.paymentKey, account = winAlias.AccazaSales.paymentAccount;

check(aliasKey({method:'GCash · G-Cash', receivingAccountName:'G-Cash'}) === 'E-Wallet',
  'A posted GCash sale must report under the E-Wallet classification that absorbed it.');
check(aliasKey({method:'PayMaya · PayMaya', receivingAccountName:'PayMaya'}) === 'E-Wallet',
  'A posted PayMaya sale must report under E-Wallet too — the classification is the rail, not the wallet.');
check(aliasKey({method:'E-Wallet · G-Cash', paymentMethod:'E-Wallet'}) === 'E-Wallet',
  'A sale posted after the reclassification must not be double-mapped.');
check(aliasKey({method:'Bank Transfer · BDO', paymentMethod:'Bank Transfer'}) === 'Bank Transfer',
  'An unrelated method must be untouched by the alias map.');
check(account({method:'GCash · G-Cash', receivingAccountName:'G-Cash'}) === 'G-Cash'
   && account({method:'E-Wallet · PayMaya'}) === 'PayMaya'
   && account({method:'Cash'}) === '',
  'The receiving account must resolve from the stored name, or the label suffix for legacy rows.');

/* Merging the methods must not lose which wallet took the money. */
const wallet = [
  {method:'GCash · G-Cash', receivingAccountName:'G-Cash', amount:605},
  {method:'PayMaya · PayMaya', receivingAccountName:'PayMaya', amount:460},
];
const rolled = {}, byAccount = {};
wallet.forEach((p) => { const k = aliasKey(p); rolled[k] = (rolled[k]||0) + p.amount; (byAccount[k] = byAccount[k] || {})[account(p)] = p.amount; });
check(rolled['E-Wallet'] === 1065, 'E-Wallet must total both wallets.');
check(byAccount['E-Wallet']['G-Cash'] === 605 && byAccount['E-Wallet']['PayMaya'] === 460,
  'The receiving-account split must survive the merge — a single E-Wallet figure with no breakdown is a headline without its backup.');

/* ---------- online orders carry no receiving account; resolve it the way the ledger does ---------- */
const accounts = {
  acc_bdo:{name:'BDO', type:'bank', feedMethods:['Bank Transfer']},
  acc_gcash:{name:'G-Cash', type:'ewallet', feedMethods:['GCash']},
};
check(account({method:'GCash', amount:605}, accounts) === 'G-Cash',
  'An online GCash payment must resolve to the account whose feedMethods claims it — the same lookup Financial.accountForPayment uses for the ledger.');
check(account({method:'Bank Transfer'}, accounts) === 'BDO',
  'An online bank transfer must resolve the same way.');
check(account({method:'GCash · G-Cash', receivingAccountName:'G-Cash'}, accounts) === 'G-Cash',
  'A stored account name must still win over the lookup.');
check(account({receivingAccountId:'acc_bdo', method:'Bank Transfer'}, accounts) === 'BDO',
  'A stored account id must resolve to that account, mirroring accountForPayment.');
check(account({method:'Cash'}, accounts) === '',
  'Cash has no receiving account and must not be invented one.');
check(account({method:'GCash'}, {}) === '' && account({method:'GCash'}) === '',
  'With no accounts loaded the resolver must stay silent rather than guess.');

/* The dashboard scope must be registered or the cfAccounts listener silently never attaches. */
must(read('assets/js/admin/realtime-hub.mjs'), "cfAccounts:['dashboard'",
  'realtime-hub.mjs: cfAccounts must be in the dashboard scope, or Overview never receives the accounts map.');
must(read('assets/js/admin/core.mjs'), "subscriptionHub.subscribe('cfAccounts'",
  'core.mjs: Overview must subscribe to cfAccounts.');
must(read('assets/js/admin/core.mjs'), 'cashAccounts:overviewCashAccounts',
  'core.mjs: the accounts map must reach the Overview renderer.');

/* ---------- every surface that totals payments must use it ---------- */
must(read('assets/js/shared/sales-authority.js'), 'paymentKey:paymentKey',
  'sales-authority.js: paymentKey must be exported on AccazaSales.');

for (const file of ['assets/js/admin/overview-insights.mjs']) {
  const s = read(file);
  must(s, 'method=window.AccazaSales.paymentKey(p)', `${file}: Payment Split must bucket on the resolved method.`);
  must(s, 'Number(refunds[label])', `${file}: the refund lookup must stay on the FULL label — refundPayments is keyed by it.`);
  must(s, 'window.AccazaSales.paymentAccount(p,accounts)', `${file}: Payment Split must resolve the receiving account against the accounts map.`);
  must(s, 'function accountLines(method)', `${file}: Payment Split must render the receiving-account breakdown under each method.`);
}
for (const file of ['assets/js/admin/register.js', 'src/admin/register/20-z-report-payment-methods.js']) {
  const s = read(file);
  must(s, 'function zMethodRows(z,cell)', `${file}: one shared row-builder must render the Z-report method + account rows.`);
  must(s, 'window.AccazaSales.paymentAccount(p,cashAccountsMap)', `${file}: the Z-report must resolve the receiving account against the accounts map.`);
  must(s, 'z.byMethodAccount[m][acct', `${file}: the Z-report must capture the receiving-account split.`);
  must(s, 'data-pmalias', `${file}: POS Settings must let an operator record the old names a method absorbs.`);
}
for (const file of ['assets/js/admin/register.js', 'src/admin/register/60-operations-shift-review.js', 'src/admin/register/80-shift-lifecycle-zreport.js', 'src/admin/register/90-shift-review-export.js']) {
  must(read(file), "zMethodRows(", `${file}: this Z-report view must use the shared row-builder, not its own method loop.`);
}
for (const file of ['assets/js/admin/register.js', 'src/admin/register/20-z-report-payment-methods.js']) {
  must(read(file), 'z.byMethod[m]=(z.byMethod[m]||0)+amt',
    `${file}: the Z-report must total by resolved method, not by label.`);
}
for (const file of ['assets/js/admin/analytics.js', 'src/admin/analytics/20-sales-analytics.js']) {
  must(read(file), 'var payKey=window.AccazaSales.paymentKey(x.payment);byPay[payKey]',
    `${file}: the Analytics payment mix must total by method, not by label.`);
}

if (failures.length) { console.error('Payment method grouping check failed:\n- ' + failures.join('\n- ')); process.exit(1); }
console.log('PASS: Payment Split, the Z-report and Analytics total by method, absorbed method names fold into their current classification, and the receiving-account split survives the merge.');
