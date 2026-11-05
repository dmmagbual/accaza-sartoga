/* Purchase settlement binding — regression guard.
   A settlement control (cash account, supplier advance, due date) used to be rendered
   inside its radio option's <label> at all times. A browser never forwards a click on
   one form control to another, so an operator could pick "BDO" from the account list
   while "Invoice pending" stayed selected. The purchase then posted with payMode
   "pending", which credits 2090 Unrecorded Payables Clearing instead of the bank or
   e-wallet the operator chose. Each control must render only while its own option is
   selected, and no account may be pre-selected. */
import fs from 'node:fs';
import path from 'node:path';
const root = path.join(import.meta.dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const failures = [];
const must = (source, marker, message) => { if (!source.includes(marker)) failures.push(message); };

// The Purchases source is split across 20-purchasing.js, 20a-purchase-posting.js and
// 20b-ingredient-maintenance.js; the source check reads all three in bundle order.
const purchasingSource = () => ['src/admin/pos/20-purchasing.js', 'src/admin/pos/20a-purchase-posting.js', 'src/admin/pos/20b-ingredient-maintenance.js'].map(read).join('');
for (const file of ['assets/js/admin/pos.js', 'src/admin/pos/20-purchasing.js']) {
  const s = file === 'src/admin/pos/20-purchasing.js' ? purchasingSource() : read(file);
  must(s, "payAccs.length&&P.pay==='paid'?('<select class=\"pz-in\" id=\"purAcct\">",
    `${file}: the cash account list must render only while "Paid now" is the selected settlement option.`);
  must(s, "advances.length&&P.pay==='advance'?('<select class=\"pz-in\" id=\"purAdvance\">",
    `${file}: the supplier advance list must render only while the advance option is selected.`);
  must(s, "(P.pay==='account'?'<input class=\"pz-in\" id=\"purDue\"",
    `${file}: the payable due date must render only while "On account" is the selected option.`);
  must(s, "if(P.pay!=='paid')P.acct='';if(P.pay!=='advance')P.advanceId='';if(P.pay!=='account')P.due='';",
    `${file}: changing the settlement option must clear the fields belonging to the option being left.`);
}
/* Invoice pending retired for new purchases (5 Nov 2026). It was preselected on every new
   purchase, so an unpaid delivery silently went to 2090 Unrecorded Payables Clearing and could not
   be paid until a second "Finalize invoice" step. A new purchase is now Paid now, On account,
   Paid personally by owner/partner, or Apply supplier advance; nothing is preselected and the
   choice is checked before any stock posts. Legacy provisional purchases keep Finalize invoice. */
{
  const ws = read('src/admin/pos/11h-purchase-workspace.js'), pur = read('src/admin/pos/20-purchasing.js'), post = read('src/admin/pos/20a-purchase-posting.js'), posBundle = read('assets/js/admin/pos.js');
  for (const [file, s] of [['src/admin/pos/20-purchasing.js', pur], ['assets/js/admin/pos.js', posBundle]])
    if (/name="ppay"[^>]*value="pending"/.test(s)) failures.push(`${file}: new purchases must not offer an "Invoice pending" payment option.`);
  if (!ws.includes("description:'',pay:'',acct:''")) failures.push('A new purchase must start with no payment option selected.');
  if (!ws.includes("pay:(inv.payMode==='none'||inv.payMode==='pending')?'':")) failures.push('A corrected re-entry of a pending/legacy purchase must ask for a payment option again.');
  const guard = "if(['paid','account','owner_funded','advance'].indexOf(P.pay)<0){alert(";
  const fn = post.slice(post.indexOf('function postPurchases('));
  const g = fn.indexOf(guard), firstPost = fn.indexOf('postMovements(');
  if (g < 0) failures.push('postPurchases() must refuse a purchase whose payment option is not one of the four allowed.');
  else if (firstPost < 0 || g > firstPost || g > fn.indexOf('purchaseSupplierById(')) failures.push('The payment-option check must run before the supplier check and before any stock movement posts.');
  if (/P\.pay==='pending'/.test(post)) failures.push('postPurchases() must not keep a code path for new "pending" purchases.');
  if (!pur.includes('data-purchase-finalize')) failures.push('Legacy provisional purchases must keep their Finalize invoice action.');
}
/* The single-item Receive Stock dialog (src/admin/pos/11g-stock-receiving.js) lost its last
   caller on 10 Aug 2026 and was deleted on 6 Oct 2026. Deliveries are received only through the
   Purchases workspace, which the checks above cover. */
if (fs.existsSync(path.join(root, 'src/admin/pos/11g-stock-receiving.js')) || read('assets/js/admin/pos.js').includes('function receiveStock('))
  failures.push('the retired single-item Receive Stock dialog must not return; receive deliveries through Purchases.');
const bundle = read('assets/js/admin/pos.js');
const placeholders = bundle.split('var accOpts=').length - 1;
const guarded = bundle.split("var accOpts='<option value=\"\">").length - 1;
if (placeholders !== guarded) failures.push(`assets/js/admin/pos.js: ${placeholders - guarded} cash account list(s) still pre-select an account instead of an explicit placeholder.`);

/* Line preview (7 Oct 2026): live typing used a stock-only preview, so a one-time expense line
   showed "+0 · new avg ₱0.00/ · line ₱…". One preview function must serve render and live typing. */
{
  const src = read('src/admin/pos/20a-purchase-posting.js') + read('src/admin/pos/20-purchasing.js');
  const fnStart = src.indexOf('function purchaseLinePreview(');
  if (fnStart < 0) failures.push('purchaseLinePreview() must exist as the single purchase-line preview authority.');
  else {
    const body = src.slice(fnStart, src.indexOf('\nfunction purchUpdatePrev(', fnStart));
    const preview = new Function('peso', 'num', body + '\nreturn purchaseLinePreview;')((v) => '₱' + Number(v).toFixed(2), (v) => String(v));
    const c = {lineTotal: 1371.42, stockAdd: 0, stockUnit: '', newCost: 0};
    const expense = preview({mode: 'expense', expenseAccount: '6050', qty: 1}, c);
    if (!/^Expense · ₱1371\.42 · charged to 6050 · no inventory created$/.test(expense)) failures.push(`An expense line preview must describe the expense, got "${expense}".`);
    if (/new avg/.test(preview({mode: 'asset', qty: 1}, c))) failures.push('An equipment line preview must not show stock wording.');
    if (!/new avg/.test(preview({mode: 'existing'}, {lineTotal: 10, stockAdd: 5, stockUnit: 'g', newCost: 2}))) failures.push('A stock line preview must still show the new average cost.');
    if (preview({mode: 'expense'}, null) !== '') failures.push('An incomplete line must show no preview.');
  }
  if ((src.match(/new avg/g) || []).length !== 1) failures.push('Stock preview wording must live only in purchaseLinePreview(); the live-typing path must not build its own.');
  if (!src.includes('el.textContent=purchaseLinePreview(ln,c)')) failures.push('Live typing must update the preview through purchaseLinePreview().');
  if (!src.includes('var prev=esc(purchaseLinePreview(ln,c));')) failures.push('The full render must build the preview through purchaseLinePreview().');
}

if (failures.length) { console.error('Purchase settlement binding check FAILED:\n- ' + failures.join('\n- ')); process.exit(1); }
console.log('PASS: purchase and receive settlement controls are bound to their own option and pre-select no cash account.');
