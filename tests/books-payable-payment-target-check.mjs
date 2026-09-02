/* Finance Books payables — regression guard.
   Two defects this locks out:
   1. The Payables table offered "Pay / correct" on a provisional (GRNI) obligation that the
      Admin Payables tab correctly blocks and that the server rejects. It must show the
      finalize guidance instead, and never appear in the pay dropdown.
   2. App.correctPayable(id) discarded the id and called the generic App.txnPay(), so the
      modal opened on the FIRST open payable rather than the row the operator clicked —
      a wrong-bill-paid risk whenever more than one payable is open. */
import fs from 'node:fs';
import path from 'node:path';
const root = path.join(import.meta.dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const failures = [];
const must = (source, marker, message) => { if (!source.includes(marker)) failures.push(message); };

for (const file of ['assets/js/books/app.js', 'src/books/app/40-subledgers.js']) {
  const s = read(file);
  must(s, "d.provisional===true?'<span class=\"tiny muted\">Finalize invoice in Purchases first</span>'",
    `${file}: a provisional payable must show finalize guidance instead of a Pay button.`);
  must(s, "if(d.type!=='customer_change_refund')return App.txnPay(id);",
    `${file}: the Pay action must pay the payable that was clicked, not the first open one.`);
}
for (const file of ['assets/js/books/app.js', 'src/books/app/50-controlled-transactions.js']) {
  const s = read(file);
  must(s, 'App.txnPay=function(preselectId)',
    `${file}: txnPay must accept the payable to pay.`);
  must(s, "if(target&&target.provisional===true) return alert('Finalize the supplier invoice in Purchases before paying this provisional obligation.');",
    `${file}: txnPay must refuse a provisional obligation even when called directly.`);
  must(s, 'openDocOptions(window.__apMap,preselectId,true)',
    `${file}: the pay dropdown must preselect the clicked payable and exclude provisional ones.`);
  must(s, 'function openDocOptions(map,selectedId,skipProvisional)',
    `${file}: openDocOptions must support preselection and the provisional filter.`);
}
if (failures.length) { console.error('Books payable payment target check FAILED:\n- ' + failures.join('\n- ')); process.exit(1); }
console.log('PASS: Finance Books pays the payable that was clicked and blocks provisional obligations.');
