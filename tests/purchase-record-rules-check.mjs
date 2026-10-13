/* AP 0.9 — a purchase record must be created by the Purchases screen, and after that only the screen's
   own retry may touch it.

   Why the rule is not simply "create only": the screen caches the purchase id
   (`P.invoiceId || (P.invoiceId = uid('pinv_'))` in src/admin/pos/20a-purchase-posting.js), so when a
   submission fails part-way and the operator tries again, the browser re-writes the **same** record. A
   create-only rule would refuse that retry and strand the purchase — a delivery that could never be
   recorded. So the rule allows exactly two things:

     1. creating a record that does not exist yet;
     2. re-writing a record that still has no bill linked (`payableId === ''`) with its total unchanged.

   Everything else is refused: deleting a purchase, changing the amount of a billed purchase, or editing
   a purchase that already has a bill. Server commands are unaffected, because the Admin SDK bypasses
   database rules, so no posting, correction or reversal path changes behaviour.

   What this guard can and cannot prove: it pins the *shape* of the rule against the rules file. It does
   not evaluate rules against a live client, so the behaviour must be confirmed on a staging database
   before this reaches production.
*/
import fs from 'node:fs';
import path from 'node:path';

const rulesPath = path.join(import.meta.dirname, '..', 'database.rules.json');
const raw = fs.readFileSync(rulesPath, 'utf8');
// The file is JSON with // comments, so strip whole-line comments before parsing.
const parsed = JSON.parse(raw.replace(/^\s*\/\/.*$/gm, ''));
const node = (parsed.rules || {}).purchaseInvoices;
const failures = [];

if (!node) failures.push('purchaseInvoices rules are missing.');
else {
  if (!node['$id']) failures.push('purchaseInvoices needs a per-record rule; a node-wide rule alone lets a client rewrite any purchase.');
  else {
    const validate = node['$id']['.validate'];
    if (!validate) failures.push('the per-record rule must constrain what may be written.');
    else {
      if (!validate.includes('(!data.exists() && newData.exists())')) failures.push('creating a purchase must require that no record exists yet.');
      if (!validate.includes("data.exists() && newData.exists()")) failures.push('the screen must be able to retry its own submission.');
      if (!validate.includes("newData.child('total').val() === data.child('total').val()")) failures.push('a retry must leave the purchase total unchanged.');
      if (!validate.includes("data.child('payableId').val() === ''")) failures.push('a purchase that already has a bill linked must not be rewriteable from the client.');
      if (validate.includes('newData.exists() ||')) failures.push('the rule must not allow a write that deletes the record.');
    }
  }
  if (!node['.write']) failures.push('the write permission must stay on the node, or the Purchases screen loses the ability to record a delivery.');
  if (!Array.isArray(node['.indexOn']) || !node['.indexOn'].includes('supplierId')) failures.push('the purchaseInvoices indexes must be preserved.');
}

if (failures.length) {
  console.error('Purchase record rules check failed:\n- ' + failures.join('\n- '));
  process.exit(1);
}
console.log('PASS: a purchase is created by the screen, only its own retry may rewrite it (total unchanged, no bill linked), and a billed or deleted purchase is closed to client writes.');
