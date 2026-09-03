/* Payment routing guidance — regression guard.

   Accaza has four places money can leave: Purchases, Finance Books Payables, Cash Payments,
   and a manual journal. They all look the same at the moment of the click, which is how a
   supplier bill got settled that was never paid. The adopted rule is: the cash does not pick
   the screen — what was received for it does.

   The rule is already enforced server-side for the hardest case (a stock bill cannot be raised
   in Books). These are the on-screen signposts that tell an operator the rule BEFORE the click.
   They are guidance, so nothing breaks if they vanish — which is exactly why they need a guard. */
import fs from 'node:fs';
import path from 'node:path';
const root = path.join(import.meta.dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const failures = [];
const must = (source, marker, message) => { if (!source.includes(marker)) failures.push(message); };

/* Purchases is the destination for anything received as goods or an itemised invoice. */
for (const file of ['assets/js/admin/pos.js', 'src/admin/pos/20-purchasing.js']) {
  const s = read(file);
  must(s, 'Receiving goods or an itemised supplier invoice? Record it here',
    `${file}: Purchases must state that goods and itemised invoices belong here.`);
  must(s, 'Settling a bill already raised: Finance Books → Payables.',
    `${file}: Purchases must route an already-raised bill to Finance Books Payables.`);
  must(s, 'Paying a supplier before delivery, or a cost with no itemised invoice: Cash Payments.',
    `${file}: Purchases must route advances and non-itemised costs to Cash Payments.`);
}

/* Cash Payments must push stock purchases away, or it becomes the default for everything. */
for (const file of ['assets/js/admin/register.js', 'src/admin/register/40-revolving-fund.js']) {
  const s = read(file);
  must(s, 'For costs with no itemised supplier invoice, and for paying a supplier before delivery.',
    `${file}: Cash Payments must state what it is for.`);
  must(s, 'Goods or an itemised invoice belong in Purchases',
    `${file}: Cash Payments must send goods and itemised invoices to Purchases.`);
  must(s, 'a bill already raised is settled in Finance Books → Payables.',
    `${file}: Cash Payments must send an already-raised bill to Finance Books Payables.`);
}

/* The server-side half of the same rule. If this ever softens, the guidance above is a lie. */
must(read('functions/index.js'),
  'Inventory payables must be created from Purchases so the stock receipt, valuation, and supplier liability stay linked.',
  'functions/index.js: the server must keep refusing inventory payables raised outside Purchases.');
must(read('functions/index.js'),
  'Register Cash Float is protected and cannot be used to pay bills.',
  'functions/index.js: the protected imprest float must keep refusing bill payments.');

if (failures.length) { console.error('Payment routing guidance check failed:\n- ' + failures.join('\n- ')); process.exit(1); }
console.log('PASS: Purchases and Cash Payments each name what belongs there and where the other cases go, and the server still enforces the rule.');
