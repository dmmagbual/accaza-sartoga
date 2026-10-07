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

/* ---------- 1. the real helpers: a number only for an entered purchase, kept on its record ---------- */
const sales = read('src/functions/40-sales-finance.js');
const block = sales.slice(sales.indexOf('async function purchaseDocumentNumber('), sales.indexOf('// Movements known to exist'));
check(block.includes('function purchaseSupplierRef('), 'purchaseDocumentNumber and purchaseSupplierRef must be defined together in 40-sales-finance.js.');
const financeText = (v, n) => String(v == null ? '' : v).trim().slice(0, n || 160);
const financeKey = (v) => String(v);
const financeDateFromTimestamp = () => '2026-07-01';
let counter = 0;
const nextDocumentNumber = async (db, prefix, year) => { counter += 1; return `${prefix}-${year}-${String(counter).padStart(4, '0')}`; };
const helpers = new Function('financeText', 'financeKey', 'financeDateFromTimestamp', 'nextDocumentNumber', `${block}\nreturn {purchaseDocumentNumber, purchaseSupplierRef};`)(financeText, financeKey, financeDateFromTimestamp, nextDocumentNumber);
const {purchaseDocumentNumber, purchaseSupplierRef} = helpers;
/* An in-memory RTDB with the Admin SDK's transaction shape: first pass on an empty cache (null);
   undefined there aborts; otherwise it re-runs on the server value. */
function fakeDb(data) {
  const at = (p) => p.replace(/^\//, '').split('/').filter(Boolean);
  const get = (p) => at(p).reduce((n, k) => (n == null ? undefined : n[k]), data);
  const set = (p, v) => { const k = at(p), last = k.pop(); let n = data; for (const x of k) n = n[x] = n[x] || {}; n[last] = v; };
  return {data, ref: (p) => ({
    get: async () => ({val: () => (get(p) === undefined ? null : get(p))}),
    transaction: async (fn) => { const cur = get(p); let next = fn(null); if (next === undefined) return {committed: false, snapshot: {val: () => null}}; if (cur !== undefined) next = fn(cur); if (next === undefined) return {committed: false, snapshot: {val: () => cur}}; set(p, next); return {committed: true, snapshot: {val: () => next}}; },
  })};
}
const db = fakeDb({purchaseInvoices: {pinv_a: {ref: '', date: '2026-07-01'}, pinv_b: {ref: 'SI-55', date: '2026-07-01'}}});
const first = await purchaseDocumentNumber(db, Object.assign({}, db.data.purchaseInvoices.pinv_a), '2026-07-01', 'pinv_a');
check(first === 'PUR-2026-0001' && db.data.purchaseInvoices.pinv_a.documentNo === 'PUR-2026-0001', `An entered purchase must get its number and keep it on its record at once (got ${first}).`);
/* The posting failed after numbering (e.g. Undeposited Collection busy) and is retried with a stale snapshot. */
const retried = await purchaseDocumentNumber(db, {ref: '', date: '2026-07-01'}, '2026-07-01', 'pinv_a');
check(retried === 'PUR-2026-0001' && counter === 1, 'A retry of the same purchase must reuse its number, never draw a new one.');
const other = await purchaseDocumentNumber(db, Object.assign({}, db.data.purchaseInvoices.pinv_b), '2026-07-01', 'pinv_b');
check(other === 'PUR-2026-0002', 'The next entered purchase gets the next number.');
const known = await purchaseDocumentNumber(db, {documentNo: 'PUR-2026-0002'}, '2026-07-01', 'pinv_b');
check(known === 'PUR-2026-0002' && counter === 2, 'A purchase that already has a number must keep it without reading or drawing.');
const legacy = await purchaseDocumentNumber({}, {}, '');
check(legacy === 'PUR-2026-0003', 'A caller without a purchase id keeps the old behaviour.');
/* Two postings racing for one purchase: the loser's draw is discarded, both see one number. */
const race = fakeDb({purchaseInvoices: {pinv_r: {}}});
const [r1, r2] = await Promise.all([purchaseDocumentNumber(race, {}, '2026-07-01', 'pinv_r'), purchaseDocumentNumber(race, {}, '2026-07-01', 'pinv_r')]);
check(r1 === r2 && race.data.purchaseInvoices.pinv_r.documentNo === r1, 'Concurrent postings of one purchase must agree on a single number.');
check(purchaseSupplierRef({ref: 'pinv_x'}, 'pinv_x') === '' && purchaseSupplierRef({ref: 'PENDING-pinv_x'}, 'pinv_x') === '' && purchaseSupplierRef({ref: 'PUR-2026-0009', documentNo: 'PUR-2026-0009'}, 'pinv_x') === '' && purchaseSupplierRef({ref: ''}, 'x') === '', 'The internal key, a pending placeholder or the PUR number is never a supplier reference.');
check(purchaseSupplierRef({ref: 'SI-55'}, 'pinv_b') === 'SI-55', 'A real supplier invoice reference is kept.');

/* ---------- 2. every posting path numbers the purchase BEFORE any payment work and uses it as the reference ---------- */
const onAccount = read('src/functions/43a-purchase-payable.js');
check((onAccount.match(/purchaseDocumentNumber\(/g) || []).length === 1 && onAccount.includes('const purchaseNo = await purchaseDocumentNumber(db, invoice, date, invoiceId); if (!ref) ref = financeText(purchaseNo || `PENDING-${invoiceId}`, 120);'), 'The on-account path must number the purchase once, after preview, and use it as the bill reference when the supplier gave none.');
check(onAccount.indexOf('if (data.preview === true) return') < onAccount.indexOf('purchaseDocumentNumber('), 'A preview must never draw a number.');
check(onAccount.includes('data.invoiceRef || purchaseSupplierRef(invoice, invoiceId) || (provisional ? `PENDING-${invoiceId}` : "")'), 'The bill must use the supplier reference first; a pending invoice keeps its pending placeholder.');
check(onAccount.includes('payable.documentNo=purchaseNo') && onAccount.includes('writes[`payables/${selectedId}/documentNo`]=purchaseNo') && onAccount.includes('linkedWrites[`payables/${payableId}/documentNo`]=purchaseNo'), 'Every bill linked to the purchase must carry the purchase number.');
check((onAccount.match(/writes\[`purchaseInvoices\/\$\{invoiceId\}\/documentNo`\]=purchaseNo|linkedWrites\[`purchaseInvoices\/\$\{invoiceId\}\/documentNo`\]=purchaseNo/g) || []).length === 3, 'Every on-account branch must stamp the number on the purchase record.');
const cash = read('src/functions/42b-financial-command-transactions.js');
const paid = cash.slice(cash.indexOf('} else if (action === "purchase_paid") {'), cash.indexOf('} else if (action === "personal_business_cost")'));
check(paid.indexOf('const purchaseNo=await purchaseDocumentNumber(db,invoice,date,invoiceId),purchaseRef=purchaseSupplierRef(invoice,invoiceId)||purchaseNo;') > 0 && paid.indexOf('purchaseDocumentNumber(') < paid.indexOf('claimCustodyPool('), 'A cash / advance purchase must be numbered before the Undeposited Collection claim, so a refused payment still leaves the purchase numbered.');
check(paid.includes('reference:purchaseRef,payee:financeText(invoice.supplier,160)}') && paid.includes('ref:purchaseRef, auto:true}') && paid.includes('ref:financeText(purchaseRef,120),allocatedAt:now'), 'The payment movement, cash ledger and advance allocation must carry the purchase reference, never the internal key.');
const owner = cash.slice(cash.indexOf('} else if (action === "purchase_owner_funded") {'), cash.indexOf('} else if (action === "purchase_paid") {'));
check(owner.includes('const purchaseNo=await purchaseDocumentNumber(db,invoice,date,invoiceId),purchaseRef=purchaseSupplierRef(invoice,invoiceId)||purchaseNo;') && owner.includes('ref:financeText(purchaseRef,120),status:"open"') && owner.includes('writes[`payables/${reimbursementId}`].documentNo=purchaseNo;'), 'An owner-funded purchase must be numbered and use it on its reimbursement bill.');
check(!/purchaseDocumentNumber\(db,\s*invoice,\s*date\)/.test(cash + onAccount), 'No posting path may draw a number without the purchase id (that would burn a new number on every retry).');

/* ---------- 3. the deployed bundles carry it ---------- */
const bundle = read('functions/index.js');
check(bundle.includes('function purchaseSupplierRef(') && (bundle.match(/purchaseDocumentNumber\(db,\s*invoice,\s*date,\s*invoiceId\)/g) || []).length === 3, 'The deployed functions bundle must contain the helpers and every numbering call (run npm run build:artifacts).');
const bridge = read('functions/lib/books-bridge.js');
check(bridge.includes('if(purchaseNo)return {ref:purchaseNo,'), 'The Books journal must use the purchase number as the entry reference.');

/* ---------- 4. displays: the purchase number, plus the supplier reference — never the raw key ---------- */
const purchasesUi = read('src/admin/pos/11h-purchase-workspace.js');
check(purchasesUi.includes("'</td><td>'+purchaseRefHtml(p,p.id)+'</td><td>'") && purchasesUi.includes("esc(purchaseRefText(p,id))") && purchasesUi.includes("esc(p.documentNo||purchaseSupplierRef(a,id)||purchaseSupplierRef(p,id)||id)"), 'Purchases history, details and advance allocations must show the purchase number first.');
check(!/esc\(p\.ref\|\|p\.documentNo/.test(purchasesUi), 'No Purchases display may put the stored reference (possibly the raw key) before the number.');
const booksSub = read('src/books/app/40-subledgers.js');
check((booksSub.match(/esc\(billRefLabel\(d,d\.id\)\)/g) || []).length === 2 && booksSub.includes('esc(billRefLabel(d,id))') && booksSub.includes('esc(billRefLabel(invoice,d.purchaseInvoiceId))'), 'Books Payables rows, trace list and modal must use billRefLabel.');
check(read('assets/js/books/app.js').includes('function billRefLabel(d,id)'), 'The Books runtime bundle must contain the display change (run npm run build:artifacts).');
check(purchasesUi.includes("ref:purchaseSupplierRef(inv,inv.id),"), 'A corrected (amended) purchase must carry only the supplier reference forward, never the reversed purchase’s internal key or number.');
check(purchasesUi.includes("function purchaseAdvanceRegisterHtml(){var rows=allPurchaseAdvances().filter(function(x){return x.status!=='cancelled'&&x.remaining>0.005;});"), 'Payments pending inventory allocation must list only advances that still hold unallocated cash; a fully allocated advance is not pending.');
check(purchasesUi.includes("'</td><td>'+purchaseActionsMenu(p,actions)+'</td></tr>';") && purchasesUi.includes('<details class="purchase-actions">') && read('src/admin/pos/20-purchasing.js').includes("root.querySelectorAll('details.purchase-actions')"), 'Purchase history must group its actions in one Actions menu that keeps the existing button hooks.');
const posting = read('src/admin/pos/20a-purchase-posting.js');
check(posting.includes("effectiveRef=(P.ref||'').trim()||(P.pay==='pending'?('PENDING-'+invoiceId):'');") && !posting.includes("('PENDING-'+invoiceId):invoiceId)"), 'A new purchase must never store its internal key as the supplier reference.');

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
check(purchasesUi.includes("<div class=\"pz-sub\">Supplier ref '+esc(sup)+'</div>"), 'A supplier’s own typed reference must still be shown next to the purchase number.');

if (failures.length) { console.error(`FAIL: ${failures.length} purchase document-number check(s)\n- ${failures.join('\n- ')}`); process.exit(1); }
console.log('PASS: an entered purchase gets one PUR-YYYY-NNNN number, kept on its record before payment and reused on retry; it is the purchase reference in Purchases, Books journal and Payables with the supplier reference alongside; the raw key is never stored or shown; the backfill numbers older purchases idempotently.');
