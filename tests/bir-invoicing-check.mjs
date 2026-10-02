// BIR-compliant invoicing (ranking.docx Gap 1): one sequential sales-invoice series over
// every sale (POS and online), a non-resettable cumulative grand total, the BIR permit-to-use
// (PTU) number on tax settings and receipts, and the invoice range on the Z report.
// Regression: any edit that drops the series, resets the grand total, lets a replayed sale
// burn an invoice number, or prints receipts without the invoice/PTU lines breaks BIR
// accreditation and Finance Books reconciliation.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const root = path.join(import.meta.dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const failures = [];
const must = (source, marker, message) => { if (!source.includes(marker)) failures.push(message); };
const check = (condition, message) => { if (!condition) failures.push(message); };

const offlineSync = read('functions/lib/offline-sync.js');
const ordersCreate = read('src/functions/30-orders.js');
const taxSettings = read('src/functions/20c-tax-settings.js');
const handoverLib = read('functions/lib/shift-handover.js');
const handoverFn = read('src/functions/25b-shift-handover.js');
const receipt = read('assets/js/admin/core.mjs');
const taxTab = read('src/admin/register/72-tax-compliance.js');
const zReport = read('src/admin/register/80-shift-lifecycle-zreport.js');
const salePersistence = read('src/admin/pos/50f-sale-persistence.js');
const rules = read('database.rules.json');
const pkg = read('package.json');

/* ── 1. POS sales join the sequential invoice series exactly once ── */
must(offlineSync, 'Handover.stampInvoice(db, durableOrder)', 'offline-sync must stamp the invoice series onto durableOrder via the shared shift-handover helper.');
must(offlineSync, 'durableOrder.invoiceNumber=stamp.invoiceNumber', 'the stamped invoice number must land on durableOrder so the single durable write stores it.');
must(offlineSync, 'durableOrder.invoiceSeq=stamp.invoiceSeq', 'the raw sequence must land on durableOrder for the Z report invoice range.');
must(offlineSync, 'durableOrder.cumulativeGrandTotalCents=stamp.cumulativeGrandTotalCents', 'the non-resettable cumulative grand total must land on durableOrder.');
check(offlineSync.indexOf('Handover.stampInvoice(db, durableOrder)') > offlineSync.indexOf('duplicate:true'), 'invoice numbering must happen after the duplicate acknowledgment, or a replayed offline sale burns a number.');
check(offlineSync.indexOf('Handover.stampInvoice(db, durableOrder)') > offlineSync.indexOf('if (!existing)'), 'invoice numbering must happen inside the !existing create path, never on an acknowledged replay.');
check(offlineSync.indexOf('Handover.stampInvoice(db, durableOrder)') < offlineSync.indexOf('await db.ref().update(writes)'), 'invoice numbering must complete before the durable multi-path write, so the stored order carries the number.');

/* ── 2. Online orders join the same series ── */
must(ordersCreate, 'ShiftHandover.stampInvoice(db, order)', 'the online-order create path must stamp the same sequential invoice series.');
must(ordersCreate, 'order.invoiceNumber = invoiceStamp.invoiceNumber', 'the online order must store the stamped invoice number.');
check(ordersCreate.indexOf('ShiftHandover.stampInvoice(db, order)') < ordersCreate.indexOf('await db.ref().update({[`orders/${orderId}`]: order'), 'online-order numbering must complete before the create write.');

/* ── 3. PTU flows from tax settings into every order snapshot ── */
must(taxSettings, 'const next = {mode, structure, vatRate, percentageRate, inclusive, effectiveAt, tin, branchCode, ptu, requirements', 'setTaxSettings must accept and store the BIR permit-to-use (PTU) number on the tax settings record.');
must(taxSettings, 'function taxPtu(', 'PTU needs a server-side validator, like TIN and branch code.');
must(ordersCreate, 'ptu: String(taxSettings.ptu || "")', 'the online-order tax snapshot must carry the PTU so online receipts print it.');
must(salePersistence, "ptu:(window.__taxSettings&&window.__taxSettings.ptu)||''", 'the POS charge-time tax snapshot must carry the PTU so POS receipts print it.');

/* ── 4. Receipts print the invoice number, PTU and the BIR statement ── */
must(receipt, "Invoice No.: '", 'receipts must print the sequential invoice number when the order carries one.');
must(receipt, "PTU No.: '", 'receipts must print the BIR permit-to-use number when tax is active and the PTU is set.');
must(receipt, 'This serves as your official invoice', 'with tax active and a PTU set, the receipt footer must state it serves as the official invoice (replaces the blanket disclaimer).');
must(receipt, 'permit-to-use number not yet set', 'with tax active but no PTU set, the footer must say it is not yet an official BIR invoice so the owner sets the PTU.');
must(receipt, 'This is not an official BIR receipt', 'with tax off, the existing disclaimer must stay.');

/* ── 5. Z report carries the invoice range and non-resettable counters ── */
must(handoverLib, 'async function stampInvoice(', 'the invoice stamp helper must live in functions/lib/shift-handover.js (pure module, shared by both stamp points).');
must(handoverLib, 'invoiceNumber:o.invoiceNumber', 'each counted sale row in the Z report must carry its invoice number.');
must(handoverLib, 'z.invoiceRange=', 'the Z report must derive the shift invoice range (first, last, count).');
must(handoverFn, "'invoiceRange'", 'finalizeShiftHandover must copy the invoice range into the shift record, like the other Z keys.');
must(zReport, 'Invoice series:', 'the Z report header must show the invoice series range for the shift.');

/* ── 6. Tax Compliance tab collects the PTU ── */
must(taxTab, 'id="taxPtu"', 'the Tax Compliance tab needs a PTU input alongside rate and effective date.');
must(taxTab, 'payload.ptu=', 'saving tax settings must send the PTU to setTaxSettings.');

/* ── 7. The invoice counter node is server-only ── */
check(!rules.includes('posInvoiceControl'), '/posInvoiceControl must not appear in database.rules.json — clients must never read or write the invoice series.');
must(rules, 'Everything else denied', 'the rules file must keep its catch-all deny so /posInvoiceControl stays server-only by default.');

/* ── 8. Test wiring ── */
must(pkg, '"test:bir-invoicing": "node tests/bir-invoicing-check.mjs"', 'package.json needs the test:bir-invoicing script.');
must(pkg, 'test:bir-quarterly && npm run test:bir-invoicing && npm run test:static', 'test:bir-invoicing must run inside the main npm test chain.');

/* ── 9. Executable: the stamp helper itself ── */
try {
  const ShiftHandover = require('../functions/lib/shift-handover.js');
  let controlState = undefined;
  const mockDb = {
    ref(p) {
      if (p !== '/posInvoiceControl') throw new Error('stampInvoice must use /posInvoiceControl, got ' + p);
      return {
        transaction(fn) {
          controlState = fn(controlState);
          return Promise.resolve({ committed: true, snapshot: { val: () => controlState } });
        }
      };
    }
  };
  const first = await ShiftHandover.stampInvoice(mockDb, { total: '100.50' });
  check(first.invoiceNumber === 'SI-000001', 'first stamp must produce SI-000001, got ' + first.invoiceNumber);
  check(first.invoiceSeq === 1, 'first stamp must record sequence 1.');
  check(first.cumulativeGrandTotalCents === 10050, 'first stamp must accumulate 10050 cents, got ' + first.cumulativeGrandTotalCents);
  const second = await ShiftHandover.stampInvoice(mockDb, { total: 200 });
  check(second.invoiceNumber === 'SI-000002', 'second stamp must produce SI-000002 (sequential, no gaps), got ' + second.invoiceNumber);
  check(second.cumulativeGrandTotalCents === 30050, 'the grand total must never reset: 10050 + 20000 = 30050 cents, got ' + second.cumulativeGrandTotalCents);

  /* ── 10. Executable: the Z report invoice range ── */
  const shift = { id: 's1', staff: 'A', openingFloat: 0, payIns: [], payOuts: [] };
  const handover = { at: 0, cash: { countedCash: 0, closeCount: {}, retainedFloat: 0, actualFloatRetained: 0, floatShortfall: 0, cashToSettle: 0 } };
  const order = (id, num, total) => ({ id, shiftId: 's1', status: 'Completed', channel: 'instore', total, subtotal: total, payments: [{ method: 'Cash', amount: total }], timestamp: 1, invoiceNumber: num });
  const z = ShiftHandover.report(shift, { o1: order('o1', 'SI-000001', 100), o2: order('o2', 'SI-000002', 50) }, handover);
  check(z.invoiceRange && z.invoiceRange.first === 'SI-000001' && z.invoiceRange.last === 'SI-000002' && z.invoiceRange.count === 2, 'the Z report must derive the invoice range first SI-000001, last SI-000002, count 2, got ' + JSON.stringify(z.invoiceRange));
  check(z.sales.some(r => r.invoiceNumber === 'SI-000002'), 'each Z report sales row must carry its invoice number.');
  const zEmpty = ShiftHandover.report(shift, {}, handover);
  check(zEmpty.invoiceRange === undefined, 'a shift with no invoiced sales must not report an invoice range.');
} catch (e) {
  failures.push('executable shift-handover check could not run: ' + (e && e.message || e));
}

if (failures.length) { console.error('BIR invoicing check failed:\n- ' + failures.join('\n- ')); process.exit(1); }
console.log('PASS: BIR invoicing check — sequential series, non-resettable grand total, PTU, receipt lines, Z report range.');
