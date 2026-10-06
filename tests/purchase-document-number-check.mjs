/* AP Integrity Remediation (simple references) — a purchase's own short number PUR-YYYY-NNNN.

   Purchases showed their raw internal key (pinv_…) wherever the supplier typed no invoice
   reference. This gives every purchase a short number from the existing document-number counter,
   assigned once at post time in each terminal posting path (on-account, cash/advance,
   owner-funded) and mirrored onto its bill, so the Purchases list and Books Payables read it
   instead of the key. A Super-Admin tool numbers purchases created before this.

   This runs the real purchaseDocumentNumber helper against an in-memory counter, then checks
   every posting path stamps the number, both records carry it, the display fallbacks use it, and
   the backfill is registered and gated. */
import fs from 'node:fs';
import path from 'node:path';
const root = path.join(import.meta.dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };

/* ---------- 1. the real helper allocates once and never twice ---------- */
const sales = read('src/functions/40-sales-finance.js');
const block = sales.slice(sales.indexOf('async function purchaseDocumentNumber('), sales.indexOf('// Movements known to exist'));
check(block, 'purchaseDocumentNumber must be defined in 40-sales-finance.js.');
const financeText = (v, n) => String(v == null ? '' : v).trim().slice(0, n || 160);
const financeDateFromTimestamp = () => '2026-07-01';
let counter = 0; const seen = [];
const nextDocumentNumber = async (db, prefix, year) => { counter += 1; const no = `${prefix}-${year}-${String(counter).padStart(4, '0')}`; seen.push(no); return no; };
const purchaseDocumentNumber = new Function('financeText', 'financeDateFromTimestamp', 'nextDocumentNumber', `${block}\nreturn purchaseDocumentNumber;`)(financeText, financeDateFromTimestamp, nextDocumentNumber);
const fresh = await purchaseDocumentNumber({}, {date: '2026-07-01'}, '2026-07-01');
check(fresh === 'PUR-2026-0001', `A new purchase must get PUR-2026-0001 (got ${fresh}).`);
const second = await purchaseDocumentNumber({}, {date: '2026-07-01'}, '2026-07-01');
check(second === 'PUR-2026-0002', 'Each new purchase must get the next number.');
const retry = await purchaseDocumentNumber({}, {documentNo: 'PUR-2026-0002'}, '2026-07-01');
check(retry === 'PUR-2026-0002' && counter === 2, 'A purchase that already has a number must keep it — the counter must not advance on a retry.');
const noDate = await purchaseDocumentNumber({}, {}, '');
check(noDate === 'PUR-2026-0003', 'A purchase with no date must still get a number (year from the fallback clock).');

/* ---------- 2. every terminal posting path stamps the number on the purchase (and its bill) ---------- */
const onAccount = read('src/functions/43a-purchase-payable.js');
check((onAccount.match(/purchaseDocumentNumber\(db,\s*invoice,\s*date\)/g) || []).length === 3, 'All three on-account write branches (manual link, auto-match, new payable) must stamp the number.');
check(onAccount.includes('payable.documentNo=purchaseNo'), 'A newly created supplier bill must carry the purchase number.');
check(onAccount.includes('writes[`payables/${selectedId}/documentNo`]=purchaseNo') && onAccount.includes('linkedWrites[`payables/${payableId}/documentNo`]=purchaseNo'), 'A bill linked to the purchase must carry the purchase number.');
check((onAccount.match(/writes\[`purchaseInvoices\/\$\{invoiceId\}\/documentNo`\]=purchaseNo|linkedWrites\[`purchaseInvoices\/\$\{invoiceId\}\/documentNo`\]=purchaseNo/g) || []).length === 3, 'Every on-account branch must stamp the number on the purchase record.');

const cash = read('src/functions/42b-financial-command-transactions.js');
check(cash.includes('const purchaseNo=await purchaseDocumentNumber(db,invoice,date);if(purchaseNo)writes[`purchaseInvoices/${invoiceId}/documentNo`]=purchaseNo;'), 'A cash / advance purchase must stamp the number.');
check(cash.includes('if(ownerTreatment==="reimburse"&&writes[`payables/${reimbursementId}`])writes[`payables/${reimbursementId}`].documentNo=purchaseNo;'), 'An owner-funded purchase must stamp the number (and its reimbursement bill).');

/* ---------- 3. the deployed bundle carries the stamping and the helper ---------- */
const bundle = read('functions/index.js');
check(bundle.includes('async function purchaseDocumentNumber(') && (bundle.match(/await purchaseDocumentNumber\(db,\s*invoice,\s*date\)/g) || []).length >= 5, 'The deployed functions bundle must contain the helper and every stamping call (run npm run build:artifacts).');

/* ---------- 4. displays show the number where they fell back to the raw key ---------- */
const purchasesUi = read('src/admin/pos/11h-purchase-workspace.js');
check(purchasesUi.includes("esc(p.ref||p.documentNo||p.id)"), 'The Purchases history row must show the document number before the raw id.');
check(purchasesUi.includes("esc(p.ref||p.documentNo||id)"), 'The purchase details popup must show the document number before the raw id.');
check(purchasesUi.includes("esc(a.ref||p.ref||p.documentNo||id)"), 'The applied-advance list must show the document number before the raw id.');
const booksSub = read('src/books/app/40-subledgers.js');
check((booksSub.match(/esc\(d\.ref\|\|d\.documentNo\|\|d\.id\)/g) || []).length === 2, 'Books Payables rows and the trace list must show the document number before the raw id.');
check(booksSub.includes("esc(d.ref||d.documentNo||id)") && booksSub.includes("esc(invoice.ref||invoice.documentNo||d.purchaseInvoiceId)"), 'The Books payable modal must show the document number before the raw id.');
check(read('assets/js/books/app.js').includes("esc(d.ref||d.documentNo||d.id)"), 'The Books runtime bundle must contain the display change (run npm run build:artifacts).');

/* ---------- 5. the backfill: Super-Admin only, idempotent, registered, wired ---------- */
const backfill = read('src/functions/44c-purchase-doc-numbers.js');
check(backfill.includes('exports.backfillPurchaseDocumentNumbers'), 'The backfill callable must exist.');
check(backfill.includes('actor.role !== "superadmin"') && backfill.includes('permission-denied'), 'The backfill must be Super Admin only.');
check(backfill.includes('if (financeText(inv.documentNo, 40)) { skipped += 1; continue; }'), 'The backfill must skip purchases that already have a number (idempotent).');
check(backfill.includes('/* download-ok: manual'), 'Every full read must be justified for the download guard.');
check(backfill.includes('nextDocumentNumber(db, "PUR", year)') && backfill.includes('writes[`purchaseInvoices/${id}/documentNo`]') && backfill.includes('/documentNo`] = no'), 'The backfill must number the purchase and mirror onto its bill from the same counter.');
// preview must allocate nothing: the preview continue must come BEFORE the counter call.
check(backfill.indexOf('if (preview) { numbered += 1; continue; }') < backfill.indexOf('nextDocumentNumber(db, "PUR", year)'), 'Preview mode must count without allocating a number (no counter burn).');
// the bill is mirrored whether linked by payableId or back-linked by purchaseInvoiceId, and never created as a phantom.
check(backfill.includes('billByPurchase[id] || financeText(inv.payableId, 160)') && backfill.includes('if (billKey && bills[billKey])'), 'The backfill must mirror onto an existing bill found by either link direction, never creating a phantom payable.');
check(read('assets/js/books/live-pos.mjs').includes('window.__purchaseDocBackfill=function(payload){return httpsCallable(fns,"backfillPurchaseDocumentNumbers")'), 'Finance Books must expose the backfill callable.');
check(booksSub.includes('App.runPurchaseDocBackfill=function(){') && booksSub.includes('Number old purchases</button>'), 'Finance Books Payables must have the Number-old-purchases button and handler.');
const manifest = JSON.parse(read('release-manifest.json'));
check(manifest.requiredFunctionExports.includes('backfillPurchaseDocumentNumbers'), 'The manifest must require the backfill export.');
check(manifest.authoritativeFiles.includes('src/functions/44c-purchase-doc-numbers.js'), 'The manifest must list the backfill source file.');
check(read('tests/download-read-guard-check.mjs').includes("'backfillPurchaseDocumentNumbers'"), 'The backfill must be listed as a manual full-read tool.');

/* ---------- 6. already-formatted references and internal keys are untouched ---------- */
check(sales.includes('const DOCUMENT_PREFIXES = ['), 'The finance document-number prefixes (PV/RV/PI/…) must be unchanged.');
check(purchasesUi.includes("esc(p.ref||p.documentNo||p.id)") && !purchasesUi.includes("esc(p.documentNo||p.ref"), 'A supplier’s own typed reference must still take precedence over the document number.');

if (failures.length) { console.error(`FAIL: ${failures.length} purchase document-number check(s)\n- ${failures.join('\n- ')}`); process.exit(1); }
console.log('PASS: every purchase gets a short PUR-YYYY-NNNN number at post time on both the purchase and its bill, the Purchases list and Books Payables show it instead of the raw key, supplier references are untouched, and the Super-Admin backfill numbers older purchases idempotently.');
