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

for (const file of ['assets/js/admin/pos.js', 'src/admin/pos/20-purchasing.js']) {
  const s = read(file);
  must(s, "payAccs.length&&P.pay==='paid'?('<select class=\"pz-in\" id=\"purAcct\">",
    `${file}: the cash account list must render only while "Paid now" is the selected settlement option.`);
  must(s, "advances.length&&P.pay==='advance'?('<select class=\"pz-in\" id=\"purAdvance\">",
    `${file}: the supplier advance list must render only while the advance option is selected.`);
  must(s, "(P.pay==='account'?'<input class=\"pz-in\" id=\"purDue\"",
    `${file}: the payable due date must render only while "On account" is the selected option.`);
  must(s, "if(P.pay!=='paid')P.acct='';if(P.pay!=='advance')P.advanceId='';if(P.pay!=='account')P.due='';",
    `${file}: changing the settlement option must clear the fields belonging to the option being left.`);
}
for (const file of ['assets/js/admin/pos.js', 'src/admin/pos/11g-stock-receiving.js']) {
  const s = read(file);
  must(s, "rcAcctEl.onfocus=function(){rcChoosePay('paid');}",
    `${file}: choosing a cash account in the receive dialog must select its "Paid now" option.`);
  must(s, "rcDueEl.onfocus=function(){rcChoosePay('account');}",
    `${file}: entering a due date in the receive dialog must select its "On account" option.`);
}
const bundle = read('assets/js/admin/pos.js');
const placeholders = bundle.split('var accOpts=').length - 1;
const guarded = bundle.split("var accOpts='<option value=\"\">").length - 1;
if (placeholders !== guarded) failures.push(`assets/js/admin/pos.js: ${placeholders - guarded} cash account list(s) still pre-select an account instead of an explicit placeholder.`);

if (failures.length) { console.error('Purchase settlement binding check FAILED:\n- ' + failures.join('\n- ')); process.exit(1); }
console.log('PASS: purchase and receive settlement controls are bound to their own option and pre-select no cash account.');
