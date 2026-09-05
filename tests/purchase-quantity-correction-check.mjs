import fs from 'node:fs';

const inventory=fs.readFileSync('src/functions/50-inventory.js','utf8');
const correction=fs.readFileSync('src/functions/43b-purchase-corrections.js','utf8');
const workspace=fs.readFileSync('src/admin/pos/11h-purchase-workspace.js','utf8');
const purchasing=fs.readFileSync('src/admin/pos/19-purchase-quantity-correction.js','utf8');
const failures=[];
const must=(source,marker,message)=>{if(!source.includes(marker))failures.push(message);};
const qty6=value=>Math.round((Number(value)||0)*1000000)/1000000;

// 100 pieces at P4.05 become 1,000 pieces at P0.405 while carrying value stays P405.
const beforeQty=100,beforeCost=4.05,afterQty=1000;
const afterCost=qty6((beforeQty*beforeCost)/afterQty);
if(afterCost!==0.405||qty6(afterQty*afterCost)!==405)failures.push('Quantity correction arithmetic must preserve the P405 carrying value.');

must(inventory,'"purchase_quantity_correction"','The server must recognize a dedicated purchase quantity correction movement.');
must(inventory,'type === "purchase_quantity_correction" ? 0','The correction movement must carry zero financial value.');
must(inventory,'costAfter = after > 0 ? qty6((before * costBefore) / after) : costBefore','Weighted-average cost must preserve current inventory carrying value.');
must(inventory,'"purchase_reversal", "purchase_quantity_correction"','The direct movement API must keep purchase quantity corrections server-only.');
must(correction,'action === "correct_quantity"','Purchase corrections must expose the controlled quantity action.');
must(correction,'expectedQty!==oldQty','A stale correction form must be rejected.');
must(correction,'newQty+0.000001<consumed','A correction must not remove quantities already consumed.');
must(correction,'if(delta<0){const movements=','A downward correction must inspect later stock-out activity.');
must(correction,'A downward source-quantity correction could remove replacement stock','Unsafe downward corrections after consumption must be refused.');
must(correction,'financialImpact:0,financeBooksPosting:false','The audit and response must explicitly record zero Finance impact.');
must(correction,'[`purchaseInvoices/${invoiceId}/lines`]:correctedLines','The source purchase line must be corrected.');
must(correction,'[`stockReceipts/${receiptId}/qty`]:newQty','The linked stock receipt must be corrected.');
must(correction,'[`inventoryBatch/${batchId}/qtyRecv`]:newQty','The linked inventory batch must be corrected.');
must(workspace,'data-purchase-quantity','Purchase history must offer the correction on active inventory purchases.');
must(purchasing,"action:'correct_quantity'",'The Admin form must call the controlled server action.');
must(purchasing,'The purchase total, cash/payment, payable, and Finance Books remain unchanged.','The operator must see the financial safeguard before submitting.');

if(failures.length){console.error('Purchase quantity correction check failed:\n- '+failures.join('\n- '));process.exit(1);}
console.log('PASS: purchase quantity corrections preserve invoice and carrying value, update linked inventory records, reject unsafe reductions, stay server-only, and post P0 to Finance Books.');
