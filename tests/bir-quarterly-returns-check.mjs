// BIR quarterly returns (2550Q / 2551Q) + VAT-exempt senior/PWD sales + input VAT.
// Pure assertions run against functions/lib/financial.js; the rest are source
// markers on the cloud function, purchase workspace, POS discount/checkout and
// receipt code so the end-to-end wiring cannot silently regress.
import {createRequire} from 'node:module';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const F = require('../functions/lib/financial.js');
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const cf20d = '../src/functions/20d-tax-returns.js';
const bridge = read('../functions/lib/books-bridge.js');
const purch = read('../src/admin/pos/11h-purchase-workspace.js');
const disc = read('../src/admin/pos/50d-scoped-discounts.js');
const cart = read('../src/admin/pos/50e-cart-checkout.js');
const sale = read('../src/admin/pos/50f-sale-persistence.js');
const close = read('../functions/lib/financial-close.js');
const receipt = read('../assets/js/admin/core.mjs');
const VAT12 = {mode: 'vat', rate: 12, inclusive: true};
const VAT12X = {mode: 'vat', rate: 12, inclusive: false};
const PCT3 = {mode: 'percentage', rate: 3, inclusive: true};
const posting = (order, tax) => F.orderPosting(Object.assign({id: 'T1', status: 'Completed', channel: 'instore'}, order), {}, tax);
const lineOf = (movement, account) => (movement.lines || []).filter((l) => l.account === account);
const sum = (rows, field) => rows.reduce((acc, l) => acc + (l[field] || 0), 0);
const money2 = (n) => Math.round(n * 100) / 100;

// ---------- 1. VAT-exempt senior/PWD sales: output VAT ----------
// RMC 72-2014: shelf 112 (VAT-inclusive) -> amount due 80, output VAT 0.
assert.equal(F.orderOutputVat({total: 80, vatExemptSales: 80}, VAT12), 0, 'fully exempt order must carry zero output VAT');
assert.equal(F.orderOutputVat({total: 304, vatExemptSales: 80}, VAT12), 24, 'mixed order VAT only on taxable 224 = 24');
assert.equal(F.orderOutputVat({total: 304, vatExemptSales: 80, refundAmount: 304}, VAT12), 0, 'full refund of mixed order reverses all output VAT');
assert.equal(F.orderOutputVat({total: 80, discountLines: [{type: 'senior', rate: 0.2, basis: 100}]}, VAT12), 0, 'exempt derivable from persisted discountLines without vatExemptSales field');
assert.equal(F.orderOutputVat({total: 80, discountLines: [{type: 'promo5', rate: 0.05, basis: 100}]}, VAT12) > 0, true, 'promo rows are merchant promos, never VAT-exempt');

// ---------- 2. Exempt-aware sale posting ----------
// Senior order: shelf 112, statutory discount 32 (20 on VAT-exclusive 100 + 12 VAT relief), pays 80.
const seniorOrder = {subtotal: 112, discount: 32, total: 80, vatExemptSales: 80, payments: [{method: 'Cash', amount: 80}]};
const seniorPost = posting(seniorOrder, VAT12);
assert.equal(money2(sum(lineOf(seniorPost, 'liability:output_vat'), 'credit')), 0, 'senior sale posts zero output VAT');
assert.equal(money2(sum(lineOf(seniorPost, 'revenue:sales'), 'credit')), 112, 'revenue credited at gross less exempt VAT');
assert.equal(money2(sum(lineOf(seniorPost, 'expense:customer_discount'), 'debit')), 32, 'statutory discount incl. VAT relief booked as discount expense');
const mixedOrder = {subtotal: 336, discount: 32, total: 304, vatExemptSales: 80, payments: [{method: 'Cash', amount: 304}]};
const mixedPost = posting(mixedOrder, VAT12);
assert.equal(money2(sum(lineOf(mixedPost, 'liability:output_vat'), 'credit')), 24, 'mixed order output VAT 24');
assert.equal(money2(sum(lineOf(mixedPost, 'revenue:sales'), 'credit')), 312, 'mixed order revenue 312 = 200 taxable net + 112 exempt gross');
const seniorExcl = {subtotal: 100, discount: 20, total: 80, vatExemptSales: 80, payments: [{method: 'Cash', amount: 80}]};
const seniorExclPost = posting(seniorExcl, VAT12X);
assert.equal(money2(sum(lineOf(seniorExclPost, 'liability:output_vat'), 'credit')), 0, 'exclusive-mode senior sale adds no VAT on exempt portion');

// ---------- 3. Exempt-aware refund reversal ----------
const seniorRefund = F.reversalPosting(seniorOrder, 80, 'refund', {}, [], VAT12);
assert.equal(money2(sum(lineOf(seniorRefund, 'liability:output_vat'), 'debit')), 0, 'senior refund reverses zero output VAT');
assert.equal(money2(sum(lineOf(seniorRefund, 'revenue:sales_reversal'), 'debit')), 80, 'senior refund reverses full charged amount');
const mixedRefund = F.reversalPosting(mixedOrder, 304, 'refund', {}, [], VAT12);
assert.equal(money2(sum(lineOf(mixedRefund, 'liability:output_vat'), 'debit')), 24, 'mixed full refund reverses exactly the 24 output VAT');

// ---------- 4. Quarterly aggregation + reconciled-close gate ----------
const qCloses = [
  {status: 'RECONCILED', grossSales: 1120, outputVat: 120, vatExemptSales: 112, percentageTax: 0},
  {status: 'RECONCILED_WITH_TIMING_ITEMS', grossSales: 560, outputVat: 60, vatExemptSales: 0, percentageTax: 0}
];
const qFigures = F.quarterlyTaxFigures(qCloses, 50);
assert.equal(qFigures.grossSales, 1680, 'quarter gross sums close summaries');
assert.equal(qFigures.vatExemptSales, 112, 'quarter exempt line sums close summaries');
assert.equal(qFigures.outputVat, 180, 'quarter output VAT sums close summaries');
assert.equal(qFigures.inputVat, 50, 'quarter input VAT from purchases');
assert.equal(qFigures.vatPayable, 130, '2550Q amount due = output VAT less input VAT');
assert.equal(F.quarterlyTaxFigures([{status: 'RECONCILED', grossSales: 1000, outputVat: 0, vatExemptSales: 0, percentageTax: 30}], 0).percentageTax, 30, '2551Q percentage tax sums close summaries');
assert.equal(F.quarterCloseGate(qCloses).ok, true, 'RECONCILED + timing-items closes pass the gate');
assert.equal(F.quarterCloseGate([{status: 'CERTIFIED', grossSales: 100, outputVat: 12, vatExemptSales: 0, percentageTax: 0}]).ok, true, 'certified closes pass the gate (certification is the strongest reconciled state)');
const gated = F.quarterCloseGate(qCloses.concat([{status: 'EXCEPTIONS_OPEN', closeId: 'c3'}]));
assert.equal(gated.ok, false, 'open exceptions block quarterly preparation');
assert.equal(F.quarterCloseGate([]).ok, false, 'empty quarter cannot be prepared');

// ---------- 5. Quarterly return cloud function wiring ----------
assert.ok(fs.existsSync(new URL(cf20d, import.meta.url)), 'src/functions/20d-tax-returns.js must exist');
const taxReturns = read(cf20d);
assert.ok(taxReturns.includes('prepareQuarterlyTaxReturn'), 'exports prepareQuarterlyTaxReturn');
assert.ok(taxReturns.includes('taxSettings'), 'reads the tax regime settings');
assert.ok(taxReturns.includes('financialCloseIndex'), 'walks the close index, not raw orders');
assert.ok(taxReturns.includes('DAILY_CLOSE'), 'a daily close takes precedence over shift closes so a mixed day is never double counted');
assert.ok(taxReturns.includes('RECONCILED'), 'gates on reconciled closes');
assert.ok(taxReturns.includes('2550Q') && taxReturns.includes('2551Q'), 'prepares both VAT and percentage-tax returns');
assert.ok(taxReturns.includes('2210') && taxReturns.includes('2220') && taxReturns.includes('1250'), 'references output VAT, percentage tax and input VAT accounts');
assert.ok(taxReturns.includes('vatExemptSales'), '2550Q exempt line uses vatExemptSales');
assert.ok(taxReturns.includes('requestId'), 'idempotency key on repeated preparation');
assert.ok(taxReturns.includes('annual') && taxReturns.includes('1701'), 'annual accountant export with 1701/1702 figures');

// ---------- 6. Input VAT on purchases ----------
assert.ok(bridge.includes('asset:input_vat') && bridge.includes('1250'), 'books bridge maps input VAT to 1250');
assert.ok(purch.includes('inputVat'), 'purchase workspace captures input VAT');

// ---------- 7. POS statutory discount compliance ----------
assert.ok(disc.includes('amountDue'), 'scoped discount computes the compliant amount due (incl. VAT relief)');
assert.ok(cart.includes('posExemptSales'), 'exclusive-mode tax add-on skips the exempt portion');
assert.ok(sale.includes('vatExemptSales'), 'chargeSale persists vatExemptSales on the order');
assert.ok(close.includes('vatExemptSales') && close.includes('percentageTax'), 'close summaries carry exempt sales and percentage tax');

// ---------- 8. Receipt exempt marking ----------
assert.ok(receipt.includes('VAT-EXEMPT'), 'receipts mark VAT-exempt sales');

// ---------- 9. Quarterly returns UI (Tax Compliance tab) ----------
const taxUi = read('../src/admin/register/72-tax-compliance.js');
assert.ok(taxUi.includes('prepareQuarterlyTaxReturn'), 'Tax Compliance tab calls the prepareQuarterlyTaxReturn callable');
assert.ok(taxUi.includes('taxReturns'), 'Tax Compliance tab reads the prepared-returns history');
assert.ok(taxUi.includes("mode:'annual'"), 'annual accountant export (1701/1702) is one click');
assert.ok(taxUi.includes('text/csv'), 'prepared returns export to CSV for eBIRForms / accountant entry');
assert.ok(taxUi.includes('QUARTER_DUE'), 'filing deadline shown per quarter');
assert.ok(taxUi.includes('quarterEnded'), 'quarters that have not ended yet cannot be prepared');
assert.ok(taxReturns.includes('pnl:'), 'return records carry the P&L summary the accountant needs for 1701/1702');
assert.ok(taxReturns.includes('expectedCogs'), 'P&L summary includes cost of sales from close summaries');

console.log('PASS: BIR quarterly returns, VAT-exempt sales and input VAT are wired end to end');
