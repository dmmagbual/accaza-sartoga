import fs from 'node:fs';

const source = fs.readFileSync('src/admin/pos/50e-cart-checkout.js', 'utf8');
const must = (needle, message) => { if (!source.includes(needle)) throw new Error(`${message}: ${needle}`); };

must("var methods=posActiveMethods(),defaultMethod=methods.length?methods[0].name:'Cash'", 'split payment rows must retain the configured default method');
must("splitRows.push({method:defaultMethod,amount:0})", 'the existing split-payment row creation must remain intact');
must("if(!isCashMethod(r.method)){var accts=paymentAccountOptions(r.method)", 'non-cash split rows must still use receiving-account routing');
must("resolvedPayment(r.method,r.receivingAccountId,r.amount,r.ref)", 'non-cash split rows must still validate their selected receiving account');
if (source.includes("splitRows.push({method:'GCash'")) throw new Error('split payment rows must not be hardcoded to GCash');

console.log('PASS: split-payment default-method and receiving-account routing remain preserved.');
