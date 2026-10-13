/* Online order receiving account — regression guard.

   A walk-in sale stores the account the cashier picked. An online order has no cashier, so it used
   to store nothing at all and the ledger resolved it through Financial.accountForMethod — the
   account whose feedMethods claims the method. That is configuration, and it drifted from the
   account the customer actually paid into: Bank Transfer was taken at the till on Union Bank while
   every online Bank Transfer order posted to BDO.

   The customer now chooses the bank or wallet at checkout. /payment links each customer-facing row
   to a Finance account, createOnlineOrder validates that row and stamps the account on the payment,
   and posting, refunds and reversals use the stamped account. These checks pin the routing, the
   accounting it produces, and the legacy path for orders stored without a choice. */
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
const root = path.join(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const Financial = require(path.join(root, 'functions/lib/financial.js'));
const {paymentRoutingIssues} = require(path.join(root, 'functions/lib/operational-exceptions.js'));
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };

const accounts = {
  acc_bdo: {name: 'BDO', type: 'bank', feedMethods: ['Bank Transfer']},
  acc_union: {name: 'Union Bank', type: 'bank', active: true, feedMethods: []},
  acc_gcash: {name: 'G-Cash', type: 'ewallet', active: true, feedMethods: ['GCash']},
  acc_closed: {name: 'Closed Bank', type: 'bank', active: false, feedMethods: []},
};
const settings = {bdoNum: '0068', ubNum: '1093', gcashNum: '0927', bdoAccountId: 'acc_bdo', ubAccountId: 'acc_union', gcashAccountId: 'acc_gcash'};
const payMethods = [
  {name: 'Cash', active: true, cash: true},
  {name: 'Bank Transfer', active: true, cash: false, accountIds: ['acc_bdo', 'acc_union']},
  {name: 'GCash', active: true, cash: false, accountIds: ['acc_gcash']},
];
const choose = (row, extra) => Financial.receivingAccountForCustomerChoice('Bank Transfer', row, Object.assign({}, settings, extra), accounts);

/* ---------- the customer's choice decides the account ---------- */
check(choose('bdo').id === 'acc_bdo' && choose('bdo').name === 'BDO',
  'Choosing BDO must resolve to the BDO Finance account.');
check(choose('ub').id === 'acc_union' && choose('ub').name === 'Union Bank',
  'Choosing UnionBank must resolve to the Union Bank Finance account.');
check(Financial.receivingAccountForCustomerChoice('GCash', 'gcash', settings, accounts).id === 'acc_gcash',
  'A wallet choice must resolve to the linked wallet account.');

/* Fail closed, never guess: an unoffered row, an unlinked row, or a gone/inactive account refuses
   the order instead of posting the customer's money to some other bank. */
check(!!choose('bank3').error, 'A row the shop never linked must be refused.');
check(!!choose('').error, 'A missing choice must be refused.');
check(!!Financial.receivingAccountForCustomerChoice('Bank Transfer', 'acc_bdo', settings, accounts).error,
  'A client-supplied account id is not a row key and must be refused.');
check(!!choose('bdo', {bdoAccountId: ''}).error, 'An unlinked row must be refused.');
check(!!choose('bdo', {bdoAccountId: 'acc_deleted'}).error, 'A deleted account must be refused.');
check(!!choose('bdo', {bdoAccountId: 'acc_closed'}).error, 'A deactivated account must be refused.');
/* A row switched off after the page loaded, or a row paired with the wrong payment method, must be
   refused: a stale browser must not post money the shop has stopped offering. */
check(!!choose('ub', {ubEnabled: false}).error, 'A row disabled after the page loaded must be refused.');
check(!!Financial.receivingAccountForCustomerChoice('GCash', 'bank3', settings, accounts).error,
  'A bank row sent with a wallet method must be refused.');
check(!!Financial.receivingAccountForCustomerChoice('Bank Transfer', 'gcash', settings, accounts).error,
  'A wallet row sent with Bank Transfer must be refused.');

/* A client that sends no choice at all (an older cached bundle) resolves from the customer-facing
   links, never from the accounts' feed methods: one linked account offered at the till is a
   decision, several or none cannot be decided here and are left to the guard. */
const fallback = (methods, extra) => Financial.receivingAccountForMethodFallback('Bank Transfer', Object.assign({}, settings, extra), methods, accounts);
check(fallback(payMethods, {bdoAccountId: ''}).id === 'acc_union',
  'With only UnionBank linked, an older client must resolve to it, not to the account that claims the method.');
check(fallback(payMethods) === null,
  'Two linked accounts must not be guessed at for a client that sends no choice.');
check(fallback(payMethods, {ubEnabled: false, bdoAccountId: ''}) === null,
  'A disabled customer row must not back the fallback.');
check(Financial.receivingAccountForMethodFallback('Bank Transfer', Object.assign({}, settings, {bdoAccountId: ''}), [{name: 'Bank Transfer', active: false, accountIds: ['acc_bdo', 'acc_union']}], accounts) === null,
  'A payment method switched off at the till must not back the fallback.');
check(fallback([{name: 'Bank Transfer', active: true, accountIds: []}], {bdoAccountId: ''}).id === 'acc_union',
  'With no till account list the single linked row still decides.');
check(Financial.receivingAccountForMethodFallback('Bank Transfer', {}, payMethods, accounts) === null,
  'With nothing linked, no account is stamped and the guard reports the drift.');

/* ---------- the accountant-facing effect ---------- */
const order = (payment) => ({id: 'OO-1', channel: 'online', source: 'online', status: 'Completed', paymentStatus: 'confirmed', subtotal: 100, total: 100, payments: [payment]});
const stamped = (id, name) => ({method: 'Bank Transfer', paymentMethod: 'Bank Transfer', receivingAccountId: id, receivingAccountName: name, amount: 100});
const debits = (result) => result.lines.filter((l) => Number(l.debit) > 0).map((l) => l.account);
const unionPosting = Financial.orderPosting(order(stamped('acc_union', 'Union Bank')), accounts, null);
const bdoPosting = Financial.orderPosting(order(stamped('acc_bdo', 'BDO')), accounts, null);
check(debits(unionPosting).includes('asset:cash_account:acc_union'),
  `A customer who chose UnionBank must debit the Union Bank account, got ${JSON.stringify(debits(unionPosting))}`);
check(debits(bdoPosting).includes('asset:cash_account:acc_bdo'),
  'A customer who chose BDO must debit the BDO account even while another account claims the method.');
check(unionPosting.cashEntries.length === 1 && unionPosting.cashEntries[0].accountId === 'acc_union',
  'The cash-flow entry must name the account the customer chose.');
check(unionPosting.amount === bdoPosting.amount &&
  JSON.stringify(unionPosting.lines.filter((l) => !String(l.account).startsWith('asset:'))) === JSON.stringify(bdoPosting.lines.filter((l) => !String(l.account).startsWith('asset:'))),
  'Choosing a different bank must move only the asset side: revenue, discount and tax lines stay identical.');
check(Financial.unmappedOrderPayments(order(stamped('acc_union', 'Union Bank')), accounts).length === 0,
  'A routed online payment must not be reported as unmapped.');

/* A stamped account that no longer exists is reported, never silently re-routed to whichever
   account claims the method by feed methods. */
const orphan = order(stamped('acc_deleted', 'Gone Bank'));
check(Financial.accountForPayment(orphan.payments[0], accounts) === '',
  'A stamped account that no longer exists must stay unmapped instead of falling back to the feed scan.');
check(debits(Financial.orderPosting(orphan, accounts, null)).every((a) => !a.startsWith('asset:cash_account:')),
  'Money already sent to a deleted account must not be attributed to a different bank.');
check(Financial.unmappedOrderPayments(orphan, accounts).length === 1,
  'A stamped account that no longer exists must be raised for review.');

/* ---------- refunds and voids follow the money back ---------- */
const refund = Financial.reversalPosting(order(stamped('acc_union', 'Union Bank')), 40, 'refund', accounts, [{method: 'Bank Transfer', amount: 40}], null);
check(refund.lines.some((l) => l.account === 'asset:cash_account:acc_union' && Number(l.credit) === 40),
  'A refund tender that names only the method must credit the account the order was paid into.');
check(!refund.lines.some((l) => l.account === 'asset:cash_account:acc_bdo'),
  'A refund must never credit the account that only claims the method by feed methods.');
const voidAll = Financial.reversalPosting(order(stamped('acc_union', 'Union Bank')), 100, 'void', accounts, [], null);
check(voidAll.lines.some((l) => l.account === 'asset:cash_account:acc_union'),
  'A void with no tenders must reverse to the stored receiving account.');

/* ---------- the customer can only pick an account the shop linked ---------- */
const customerRender = read('src/customer/core/04-realtime-subscriptions.mjs');
const customerSubmit = read('src/customer/core/09-customer-session.mjs');
const customerBundle = read('assets/js/customer/core.mjs');
check(customerRender.includes("String(p[r.key+'AccountId']||'')"),
  'The checkout must offer a bank row only when the shop linked it to a receiving account.');
check(customerSubmit.includes('paymentRow:chosenRow'),
  'The order payload must carry the customer\'s chosen receiving account.');
check(customerBundle.includes('function renderBankChoice(p)') && customerBundle.includes('paymentRow:chosenRow'),
  'The built customer bundle must carry the bank choice (run npm run build:runtime).');
check(read('src/html/customer/20-commerce.html').includes('id="bankChoiceSelect"'),
  'The customer page must render the bank chooser.');

/* ---------- the server resolves and stamps it ---------- */
const source = read('src/functions/30-orders.js');
const built = read('functions/index.js');
['Financial.receivingAccountForCustomerChoice(payment, paymentRow, paymentSettings, accountsMap)',
  'Financial.receivingAccountForMethodFallback(payment, paymentSettings, posSettings.payMethods, accountsMap)',
  'receivingAccountId: receiving.id', 'receivingAccountName: receiving.name', 'paymentAccountName: receiving ? receiving.name : ""'].forEach((marker) => {
  check(source.includes(marker), `src/functions/30-orders.js must stamp the customer's receiving account: missing ${marker}`);
  check(built.includes(marker), `functions/index.js must carry the stamp: missing ${marker} (run npm run build:runtime)`);
});
check(!source.includes('payments: [{method: payment, amount: finalTotal}]'),
  'createOnlineOrder must not go back to storing an online payment with no receiving account.');
check(read('src/functions/20-portal-operations.js').includes('paymentSettings: paymentSettingsSnap.val() || {}') &&
  built.includes('paymentSettings: paymentSettingsSnap.val() || {}'),
  'The health scan must pass the payment settings, or the customer-row routing checks silently never run.');

/* ---------- the admin save cannot wipe a link it has not loaded yet ---------- */
const elements = {};
['editGcashAccountId', 'editBdoAccountId', 'editUbAccountId', 'editMayaAccountId', 'editBank3AccountId', 'editBank4AccountId'].forEach((id) => {
  elements[id] = {value: '', textContent: '', attrs: {}, children: [], appendChild(child) {this.children.push(child); if (child.selected) this.value = child.value;}, setAttribute(k, v) {this.attrs[k] = v;}, getAttribute(k) {return this.attrs[k] || null;}};
});
globalThis.document = {getElementById: (id) => elements[id] || null, createElement: () => ({value: '', textContent: '', selected: false})};
const {createPaymentAccountLinks} = await import(`file:///${path.join(root, 'assets/js/admin/payment-account-links.mjs').replace(/\\/g, '/')}`);
const links = createPaymentAccountLinks(() => ({acc_bdo: {name: 'BDO', type: 'bank', active: true}, acc_union: {name: 'Union Bank', type: 'bank', active: true}}));
links.render({bdoAccountId: 'acc_bdo', ubAccountId: 'acc_union', bdoEnabled: true, ubEnabled: true});
check(elements.editBdoAccountId.value === 'acc_bdo' && elements.editUbAccountId.value === 'acc_union',
  'The link pickers must show the stored accounts.');
check(elements.editBdoAccountId.value === links.values().bdoAccountId && Object.keys(links.values()).length === 6,
  'The save must always send every link key, so the whole-object write cannot delete one.');
delete elements.editUbAccountId.attrs['data-hydrated'];
elements.editUbAccountId.value = '';
check(links.values().ubAccountId === 'acc_union',
  'A select that was never hydrated must keep its stored link instead of saving an empty one.');
links.render({bdoAccountId: 'acc_deleted', ubAccountId: '', bdoEnabled: true});
check(elements.editBdoAccountId.value === 'acc_deleted' && links.values().bdoAccountId === 'acc_deleted',
  'A link whose account is missing must keep its value, so saving the form cannot silently clear it.');

/* ---------- the guard reports the customer-facing links ---------- */
const rows = (list) => list.map((x) => x.id).sort();
const unlinked = paymentRoutingIssues(payMethods, accounts, Date.now(), {bdoNum: '1', ubNum: '2', gcashNum: '3'});
check(rows(unlinked).includes('routing_unlinked_bdo') && rows(unlinked).includes('routing_unlinked_ub'),
  `Visible but unlinked customer rows must be reported, got ${JSON.stringify(rows(unlinked))}`);
const linked = paymentRoutingIssues(payMethods, accounts, Date.now(), settings);
check(!rows(linked).includes('routing_unlinked_bdo') && !rows(linked).includes('routing_link_missing_bdo') && !rows(linked).includes('routing_link_unassigned_bdo'),
  `Correctly linked rows must raise nothing, got ${JSON.stringify(rows(linked))}`);
const goneLink = paymentRoutingIssues([{name: 'Cash', cash: true}], accounts, Date.now(), {bdoNum: '1', bdoAccountId: 'acc_deleted'});
check(goneLink.some((x) => x.id === 'routing_link_missing_bdo' && x.severity === 'critical'),
  'A customer row linked to a deleted or deactivated account must be critical.');
const offTill = paymentRoutingIssues([{name: 'Cash', cash: true}, {name: 'Bank Transfer', active: true, accountIds: []}], accounts, Date.now(), settings);
check(offTill.some((x) => x.id === 'routing_link_unassigned_bdo' && x.severity === 'warning'),
  'An online account the till does not offer must be reported as a warning, not a refusal.');

if (failures.length) { console.error('Online order routing check failed:\n- ' + failures.join('\n- ')); process.exit(1); }
console.log('PASS: an online order posts to the bank the customer chose, refunds follow it back, and no account is ever guessed at.');
