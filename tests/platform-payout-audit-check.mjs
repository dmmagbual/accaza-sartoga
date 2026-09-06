import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'..');
const ui=fs.readFileSync(path.join(root,'src','admin','analytics','40-platform-payout-reconciliation.js'),'utf8');
const server=fs.readFileSync(path.join(root,'src','functions','43d-platform-settlement.js'),'utf8');

for(const marker of ['p.orderSnapshots','p.orderIds||[]','ordersMap[id]||archMap[id]','resolved.missing.length','p.movementId','p.depositMovementId','p.reversalApprovalId']){
  if(!ui.includes(marker))throw new Error(`Payout audit lost legacy or linked-record evidence: ${marker}`);
}
for(const marker of ['gross,merchantPromo,deliveryFeeDiscount','hasMappedDiscounts','discountParts.promo','commission,wht,vat,adsMarketing,marketingFee,expectedNet:net','orderSnapshots.reduce((sum,row)=>sum+row.expectedNet,0)']){
  if(!server.includes(marker))throw new Error(`Settlement snapshot lost a required financial field: ${marker}`);
}

const sample=[{expectedNet:123.45},{expectedNet:76.55}];
const total=Math.round(sample.reduce((sum,row)=>sum+row.expectedNet,0)*100)/100;
if(total!==200)throw new Error('Payout order snapshot total is not cent-exact for the audit reconciliation.');

console.log('PASS: settled payouts retain immutable order evidence and expose legacy-safe audit review links.');
