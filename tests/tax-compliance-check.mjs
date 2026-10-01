// BIR tax compliance: one check that pins the whole tax pipeline end to end.
//
//  1. Financial.effectiveTaxFor — the effective-date wall and the regime defaults.
//  2. Financial.taxSplit — extraction math for VAT and percentage tax under BOTH
//     inclusive (tax inside prices) and exclusive (tax added on top) pricing.
//  3. orderPosting / reversalPosting — how Finance Books books each regime, and
//     that platform sales are always tax-inclusive even under an exclusive regime.
//  4. The orderNetSales === sourceNetSales reconciliation identity on every
//     regime × pricing combination, including partial refunds (the refund leg is
//     where an exclusive regime drifts a cent if the tax add-back is missed).
//  5. setTaxSettings — owner-only, BIR checklist gate, TIN required, effective
//     date, inclusive flag, publicTaxInfo public mirror (no TIN leak), audit.
//  6. Online ordering — the server is the pricing authority under tax-exclusive
//     pricing: it adds the tax on top, gates expectedTotal, and stamps the order.
//  7. Receipts — VAT/NON-VAT lines, added vs included wording, platform base.
//  8. Senior/PWD statutory base per pricing mode, and the customer-site mirror.
import {createRequire} from 'node:module';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const F = require('../functions/lib/financial.js');

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const cf = read('../src/functions/20c-tax-settings.js');
const orders = read('../src/functions/30-orders.js');
const receipt = read('../assets/js/admin/core.mjs');
const scoped = read('../src/admin/pos/50d-scoped-discounts.js');
const customerState = read('../src/customer/core/03-state-helpers.mjs');
const customerCatalog = read('../src/customer/core/02-catalog-model.mjs');
const customerCart = read('../src/customer/core/08-cart-checkout.mjs');
const customerSession = read('../src/customer/core/09-customer-session.mjs');
const settingsCard = read('../src/admin/register/70-settings-staff.js');
const rules = read('../database.rules.json');

const VAT12 = {mode: 'vat', rate: 12, inclusive: true};
const VAT12X = {mode: 'vat', rate: 12, inclusive: false};
const PCT3 = {mode: 'percentage', rate: 3, inclusive: true};
const PCT3X = {mode: 'percentage', rate: 3, inclusive: false};

// --- 1. effectiveTaxFor: the effective-date wall ---------------------------
assert.equal(F.effectiveTaxFor({mode: 'none'}, Date.now()), null, 'no tax category selected must mean no tax');
assert.equal(F.effectiveTaxFor({}, Date.now()), null, 'an absent taxSettings node must mean no tax');
assert.equal(F.effectiveTaxFor({mode: 'vat', effectiveAt: Date.now() + 1000}, Date.now()), null, 'a sale before effectiveAt must keep its original treatment');
assert.equal(F.effectiveTaxFor({mode: 'vat', effectiveAt: 1}, 0), null, 'an order without a timestamp must not be taxed retroactively');
{
  const t = F.effectiveTaxFor({mode: 'vat', effectiveAt: 1}, 500);
  assert.equal(t.rate, 12, 'VAT falls back to 12%');
  assert.equal(t.inclusive, true, 'inclusive must be the default so pre-flag sales stay unchanged');
  assert.equal(F.effectiveTaxFor({mode: 'percentage', effectiveAt: 1}, 500).rate, 3, 'percentage tax falls back to 3%');
  assert.equal(F.effectiveTaxFor({mode: 'vat', effectiveAt: 1, inclusive: false}, 500).inclusive, false, 'the exclusive flag must survive the wall');
  assert.equal(F.effectiveTaxFor({mode: 'vat', effectiveAt: 1, vatRate: 0}, 500).rate, 12, 'an invalid rate must fall back, never tax at 0 or a negative');
  assert.equal(F.effectiveTaxFor({mode: 'vat', effectiveAt: 1, vatRate: 150}, 500).rate, 12, 'a rate above 100 must be refused');
}

// --- 2. taxSplit: extraction math for both regimes × both pricings --------
{
  const inc = F.taxSplit(112, VAT12);
  assert.equal(inc.taxAmount, 12, 'VAT-inclusive 112 at 12% must extract 12.00');
  assert.equal(inc.net, 100, 'VAT-inclusive 112 at 12% must net 100.00');
  assert.equal(inc.inclusive, true, 'the split must echo the pricing basis');
  const exc = F.taxSplit(112, VAT12X);
  assert.equal(exc.taxAmount, 12, 'VAT extraction is the same formula when the tax was added on top: base is the amount charged');
  assert.equal(exc.net, 100, 'exclusive VAT 112 charged must net the 100 menu subtotal');
  const odd = F.taxSplit(100, VAT12);
  assert.equal(odd.taxAmount, 10.71, 'VAT on 100 at 12% must be 10.71 (base/(1+rate) rounding)');
  assert.equal(odd.net, 89.29, 'VAT-inclusive 100 at 12% must net 89.29');
  const pctInc = F.taxSplit(100, PCT3);
  assert.equal(pctInc.taxAmount, 3, 'percentage tax inclusive is 3% of the shelf price');
  assert.equal(pctInc.net, 100, 'inclusive percentage tax keeps the shelf price as net (gross sale)');
  const pctExc = F.taxSplit(103, PCT3X);
  assert.equal(pctExc.taxAmount, 3, 'percentage tax exclusive takes rate/(100+rate) of the collection: 103 at 3% = 3.00');
  assert.equal(pctExc.net, 100, 'exclusive percentage tax nets the 100 menu subtotal');
  const pctExcOdd = F.taxSplit(100, PCT3X);
  assert.equal(pctExcOdd.taxAmount, 2.91, 'percentage tax exclusive on 100 at 3% must be 2.91, not 3.00');
  assert.equal(pctExcOdd.net, 97.09, 'exclusive percentage tax on 100 must net 97.09');
  const passthrough = F.taxSplit(50, null);
  assert.equal(passthrough.taxAmount, 0, 'no tax regime means no extraction');
  assert.equal(passthrough.net, 50, 'no tax regime passes the base through as net');
}

// --- 3. orderPosting / reversalPosting: how Books books each regime -------
const posting = (order, tax) => F.orderPosting(Object.assign({id: 'T1', status: 'Completed'}, order), {}, tax);
const lineOf = (movement, account) => (movement.lines || []).filter((l) => l.account === account);
const sum = (rows, field) => rows.reduce((acc, l) => acc + l[field], 0);
{
  // Inclusive VAT: revenue net, output VAT to liability.
  const m = posting({channel: 'instore', subtotal: 112, total: 112, payments: [{method: 'Cash', amount: 112}]}, VAT12);
  assert.equal(sum(lineOf(m, 'revenue:sales'), 'credit'), 100, 'inclusive VAT credits revenue net of VAT');
  assert.equal(sum(lineOf(m, 'liability:output_vat'), 'credit'), 12, 'inclusive VAT books the output VAT payable');
  assert.equal(m.tax.amount, 12, 'the posting tax stamp carries the VAT amount');
  // Exclusive VAT: menu subtotal IS the net sale; the add-on goes to the payable.
  const x = posting({channel: 'instore', subtotal: 100, total: 112, payments: [{method: 'Cash', amount: 112}]}, VAT12X);
  assert.equal(sum(lineOf(x, 'revenue:sales'), 'credit'), 100, 'exclusive VAT credits revenue at the menu subtotal, not net of the add-on');
  assert.equal(sum(lineOf(x, 'liability:output_vat'), 'credit'), 12, 'the collected add-on goes straight to output VAT');
  assert.ok(lineOf(x, 'liability:output_vat').some((l) => /added on top/.test(l.label)), 'the exclusive output VAT line must say the tax was added on top');
  // Inclusive percentage tax: balanced expense/liability pair.
  const pi = posting({channel: 'instore', subtotal: 100, total: 100, payments: [{method: 'Cash', amount: 100}]}, PCT3);
  assert.equal(sum(lineOf(pi, 'revenue:sales'), 'credit'), 100, 'inclusive percentage tax credits revenue at gross');
  assert.equal(sum(lineOf(pi, 'expense:percentage_tax'), 'debit'), 3, 'inclusive percentage tax books its expense leg');
  assert.equal(sum(lineOf(pi, 'liability:percentage_tax'), 'credit'), 3, 'inclusive percentage tax books its payable leg');
  // Exclusive percentage tax: the customer paid it on top — payable only, no expense pair.
  const px = posting({channel: 'instore', subtotal: 100, total: 103, payments: [{method: 'Cash', amount: 103}]}, PCT3X);
  assert.equal(sum(lineOf(px, 'revenue:sales'), 'credit'), 100, 'exclusive percentage tax keeps revenue at the menu subtotal');
  assert.equal(sum(lineOf(px, 'liability:percentage_tax'), 'credit'), 3, 'the collected percentage add-on goes to the payable');
  assert.equal(lineOf(px, 'expense:percentage_tax').length, 0, 'exclusive percentage tax must never book an expense pair — the customer paid it, not the business');
  // Platforms set the final price: always inclusive, even under an exclusive regime.
  const plat = posting({channel: 'grabfood', grossPlatform: 112, total: 112, commission: 0}, VAT12X);
  assert.equal(sum(lineOf(plat, 'revenue:sales'), 'credit'), 100, 'platform sales extract VAT from the reported gross');
  assert.equal(plat.tax.inclusive, true, 'platform postings must stamp inclusive even under an exclusive regime');
  const platPct = posting({channel: 'grabfood', grossPlatform: 100, total: 100, commission: 0}, PCT3X);
  assert.equal(sum(lineOf(platPct, 'revenue:sales'), 'credit'), 100, 'platform percentage sales book revenue at gross');
  assert.equal(sum(lineOf(platPct, 'expense:percentage_tax'), 'debit'), 3, 'platform percentage sales keep the inclusive expense/liability pair');
}
{
  // Refunds reverse the same split the sale booked.
  const order = {id: 'T1', channel: 'instore', subtotal: 112, total: 112, payments: [{method: 'Cash', amount: 112}]};
  const refund = F.reversalPosting(order, 56, 'refund', {}, null, VAT12);
  assert.equal(sum(lineOf(refund, 'revenue:sales_reversal'), 'debit'), 50, 'a VAT refund reverses revenue net of VAT');
  assert.equal(sum(lineOf(refund, 'liability:output_vat'), 'debit'), 6, 'a VAT refund takes the VAT off the payable, not off revenue');
  const refundPct = F.reversalPosting(Object.assign({}, order, {subtotal: 100, total: 100}), 50, 'refund', {}, null, PCT3);
  assert.equal(sum(lineOf(refundPct, 'revenue:sales_reversal'), 'debit'), 50, 'an inclusive percentage refund reverses revenue at gross');
  assert.equal(sum(lineOf(refundPct, 'expense:percentage_tax'), 'credit'), 1.5, 'an inclusive percentage refund reverses the expense leg');
  const refundPctX = F.reversalPosting(Object.assign({}, order, {subtotal: 100, total: 103}), 51.5, 'refund', {}, null, PCT3X);
  assert.equal(sum(lineOf(refundPctX, 'revenue:sales_reversal'), 'debit'), 50, 'an exclusive percentage refund reverses only the menu value');
  assert.equal(sum(lineOf(refundPctX, 'liability:percentage_tax'), 'debit'), 1.5, 'an exclusive percentage refund takes the add-on off the payable');
  assert.equal(lineOf(refundPctX, 'expense:percentage_tax').length, 0, 'an exclusive percentage refund has no expense leg to reverse');
}

// --- 4. orderNetSales === sourceNetSales on every combination -------------
const identity = (label, order, tax) => {
  const full = Object.assign({id: 'T1', status: 'Completed'}, order);
  const sale = posting(full, tax);
  const movements = [sale];
  if (full.refundAmount > 0) movements.push(F.reversalPosting(full, full.refundAmount, 'refund', {}, null, tax));
  const expected = F.orderNetSales(full, tax);
  const actual = F.sourceNetSales(movements, 'T1');
  assert.ok(Math.abs(expected - actual) <= 0.009, `${label}: orderNetSales ${expected} must equal Finance net sales ${actual}`);
};
identity('VAT inclusive, no refund', {channel: 'instore', subtotal: 112, total: 112, payments: [{method: 'Cash', amount: 112}]}, VAT12);
identity('VAT inclusive, half refunded', {channel: 'instore', subtotal: 112, total: 112, refundAmount: 56, payments: [{method: 'Cash', amount: 112}]}, VAT12);
identity('VAT exclusive, no refund', {channel: 'instore', subtotal: 100, total: 112, payments: [{method: 'Cash', amount: 112}]}, VAT12X);
identity('VAT exclusive, half refunded', {channel: 'instore', subtotal: 100, total: 112, refundAmount: 56, payments: [{method: 'Cash', amount: 112}]}, VAT12X);
identity('percentage inclusive, half refunded', {channel: 'instore', subtotal: 100, total: 100, refundAmount: 50, payments: [{method: 'Cash', amount: 100}]}, PCT3);
identity('percentage exclusive, half refunded', {channel: 'instore', subtotal: 100, total: 103, refundAmount: 51.5, payments: [{method: 'Cash', amount: 103}]}, PCT3X);
identity('percentage exclusive, fully refunded', {channel: 'instore', subtotal: 100, total: 103, refundAmount: 103, payments: [{method: 'Cash', amount: 103}]}, PCT3X);
identity('online VAT exclusive, half refunded', {channel: 'online', subtotal: 100, total: 112, refundAmount: 56, payments: [{method: 'GCash', amount: 112}]}, VAT12X);

// --- 5. setTaxSettings: owner-only gate, checklist, mirror, audit ---------
assert.ok(/\["owner", "superadmin"\]\.includes\(actor\.role\)/.test(cf), 'only the owner can change tax settings');
assert.ok(cf.includes('Complete first the BIR requirement before tax is activated.'), 'the server must refuse activation while a BIR requirement is unconfirmed');
assert.ok(cf.includes('TAX_REQUIREMENT_IDS[mode].filter((id) => !(requirements[mode] || {})[id])'), 'the server re-validates every requirement id — a tampered client cannot skip the checklist');
assert.ok(cf.includes('cas_1905_filed') && cf.includes('pos_reports_audit') && cf.includes('pos_data_retention'), 'POS registration, on-demand reports and 10-year retention are required under BOTH categories');
assert.ok(cf.includes('vat_invoices') && cf.includes('form_2550q') && cf.includes('nonvat_invoices') && cf.includes('form_2551q'), 'each category carries its own invoice and return requirements');
assert.ok(cf.includes('Enter your BIR TIN and branch code before activating a tax category.'), 'activation without a TIN must be refused');
assert.ok(cf.includes('Effective date must be today or later'), 'the effective date cannot backdate into completed sales');
assert.ok(cf.includes('data.inclusive != null ? data.inclusive === true : (current.inclusive !== false)'), 'the inclusive flag must persist and default to inclusive');
const mirrorLine = cf.split('\n').find((l) => l.includes('publicTaxInfo:'));
assert.ok(mirrorLine, 'the public mirror write must exist');
assert.ok(!/tin|branchCode|requirements|structure/i.test(mirrorLine.replace(/publicTaxInfo: \{mode, rate: mode === "vat" \? vatRate : mode === "percentage" \? percentageRate : 0, inclusive, effectiveAt\}/, '')),
  'the public mirror must expose only mode/rate/inclusive/effectiveAt — never the TIN, checklist or structure');
assert.ok(cf.includes('action: "set_tax_settings"'), 'every tax change must be audited');
assert.ok(rules.includes('"publicTaxInfo": { ".read": true, ".write": false }'), 'the public mirror must be world-readable and server-written only');
assert.ok(rules.includes('"taxSettings"'), 'taxSettings itself must stay admin-read only');

// --- 6. online ordering: the server is the exclusive-pricing authority ---
assert.ok(orders.includes('db.ref("/taxSettings").get()'), 'online orders must price against the live tax regime');
assert.ok(orders.includes('Financial.effectiveTaxFor(taxSettings, Date.now())'), 'online pricing must respect the effective-date wall');
assert.ok(orders.includes('if (tax && tax.inclusive === false) finalTotal = money(finalTotal + Math.round(finalTotal * tax.rate) / 100);'),
  'under exclusive pricing the SERVER adds the tax on top for both VAT and percentage tax');
assert.ok(orders.includes('Math.abs(money(expectedTotal) - finalTotal) > 0.01'), 'the customer-approved total must gate the order, not trust the client');
assert.ok(orders.includes('lines: priced.lines, total: finalTotal'), 'the duplicate lock must sign the final taxed total');
assert.ok(orders.includes('tax: tax ? {mode: tax.mode, rate: tax.rate, inclusive: tax.inclusive !== false, tin: String(taxSettings.tin || ""), branchCode: String(taxSettings.branchCode || "")} : null'),
  'every online order must be stamped with the tax regime, TIN and branch code');

// --- 7. receipts: lines, wording, platform base --------------------------
assert.ok(receipt.includes("taxAmount=Math.round((tax.mode==='vat'?taxBase-taxBase/(1+taxRate/100):(taxExclusive?taxBase*taxRate/(100+taxRate):taxBase*taxRate/100))*100)/100"),
  'receipts must extract percentage-exclusive tax as rate/(100+rate), not rate/100');
assert.ok(receipt.includes("<td>VAT ('+taxRate+'%) '+(taxExclusive?'added':'included')"), 'VAT receipts must say whether the tax was added or included');
assert.ok(receipt.includes("<td>Pct. tax ('+taxRate+'%) '+(taxExclusive?'added':'included')"), 'percentage tax receipts must say added vs included too');
assert.ok(receipt.includes("o.grossPlatform!=null?o.grossPlatform"), 'platform receipts must extract tax from the reported platform gross');
assert.ok(receipt.includes('All prices are exclusive of VAT; VAT is added on top.'), 'exclusive-VAT receipts must disclose the pricing basis');
assert.ok(/All prices are exclusive of .*% percentage tax \(NON-VAT\); tax is added on top\./.test(receipt), 'exclusive percentage receipts must disclose the pricing basis');

// --- 8. Senior/PWD base and the customer-site mirror --------------------
assert.ok(scoped.includes("if(tax&&tax.mode==='vat'&&tax.inclusive!==false)base=c.unitTotal/(1+tax.rate/100);"),
  'VAT-inclusive statutory 20% must use the VAT-exempt base (RA 9994/10754)');
assert.ok(scoped.includes('the shelf price is already VAT-exempt, so the statutory 20% is computed on the full unit price.'),
  'VAT-exclusive statutory 20% must stay on the full shelf price');
assert.ok(customerCatalog.includes("publicTaxInfoRef=ref(db,'publicTaxInfo')"), 'the customer site must subscribe to the public tax mirror');
assert.ok(customerState.includes('onValue(publicTaxInfoRef,'), 'the customer site must listen live to the public tax mirror');
assert.ok(customerState.includes('var add=Math.round(net*rate)/100;'), 'the cart must add exactly the tax the server adds');
assert.ok(customerState.includes("if(t.inclusive!==false)return null;"), 'the cart must not add anything while pricing is inclusive');
assert.ok(customerCart.includes('taxLine.label'), 'the cart must show the added tax as its own row before checkout');
assert.ok(customerSession.includes('const total=taxLine?taxLine.total:netTotal;'), 'the customer must approve the taxed total, and expectedTotal must carry it');
assert.ok(settingsCard.includes('data-taxinc') && settingsCard.includes('Tax added on top (exclusive)'),
  'the settings card must offer inclusive/exclusive with the shelf-price warning');
assert.ok(settingsCard.includes('customers pay more than the shelf price.'), 'switching to exclusive must warn that customers pay more than the shelf price');
assert.ok(settingsCard.includes('payload={mode:mode,inclusive:inc,structure:structure,branchCode:branch,requirements:state.ticks}'),
  'saving must always send the inclusive flag');

console.log('PASS: BIR tax compliance end to end — effective-date wall, VAT and percentage tax split under inclusive and exclusive pricing, Finance postings and refunds, the orderNetSales reconciliation identity on every combination, owner-only checklist-gated activation with a TIN-free public mirror, server-authoritative online pricing, receipt lines, and the statutory Senior/PWD base per pricing mode.');
